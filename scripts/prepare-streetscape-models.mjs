import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [inputDirectory, toolsDirectory] = process.argv.slice(2);
if (!inputDirectory || !toolsDirectory) throw new Error('请提供本批原始 GLB 所在目录和模型整理工具目录。');
const assets = [
  { name: 'brick-apartment', width: 26, rotationY: 270, triangles: 8000, error: 0.012, sourceUrl: 'https://studio.tripo3d.ai/zh/workspace/generate/79a93984-f6ca-4a6b-be3c-0812b7519df3' },
  { name: 'office-block', width: 22, rotationY: 0, triangles: 8000, error: 0.012, fragments: { positionTolerance: 0.000001, minDistance: 0.18, maxSize: 0.35 }, sourceUrl: 'https://studio.tripo3d.ai/zh/workspace/generate/5aab6e2d-1a3f-4a1b-aa81-5782b22d25c2' },
  { name: 'slender-tree', height: 11, rotationY: 0, triangles: 4000, farTriangles: 1000, error: 0.02, sourceUrl: 'https://studio.tripo3d.ai/zh/workspace/generate/7e709162-74cf-408e-8a22-a81705e66af1' }
];
const resolveTool = createRequire(join(resolve(toolsDirectory), 'package.json'));
const moduleAt = name => import(pathToFileURL(resolveTool.resolve(name)).href);
const { NodeIO } = await moduleAt('@gltf-transform/core');
const { ALL_EXTENSIONS } = await moduleAt('@gltf-transform/extensions');
const { dedup, prune, flatten, join: joinMeshes, weld, dequantize, simplify, compactPrimitive, getBounds, textureCompress, meshopt } = await moduleAt('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = await moduleAt('meshoptimizer');
const { default: sharp } = await moduleAt('sharp');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const outputDirectory = new URL('../public/assets/generated/', import.meta.url);
const sourceFile = new URL('STREETSCAPE_SOURCES.json', outputDirectory);
const documents = await Promise.all(assets.map(asset => io.read(resolve(inputDirectory, `${asset.name}.glb`))));
await mkdir(outputDirectory, { recursive: true });

function triangles(mesh) {
  return mesh.listPrimitives().reduce((total, primitive) => total + (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3, 0);
}

function triangleCount(document) {
  return document.getRoot().listMeshes().reduce((total, mesh) => total + triangles(mesh), 0);
}

function dimensions(node) {
  const { min, max } = getBounds(node);
  return max.map((value, axis) => value - min[axis]);
}

function removeDistantFragments(document, options) {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const positionIds = new Map(), parents = [], points = [], entries = [];
  const find = index => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index] }
    return index;
  };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parents[b] = a };
  scene.traverse(node => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const matrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION'), ids = [];
      for (let index = 0; index < position.getCount(); index++) {
        const [x, y, z] = position.getElement(index, []);
        const point = [matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13], matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]];
        const key = point.map(value => Math.round(value / options.positionTolerance)).join(',');
        let id = positionIds.get(key);
        if (id === undefined) { id = points.length; positionIds.set(key, id); points.push(point); parents.push(id) }
        ids.push(id);
      }
      const indices = primitive.getIndices().getArray();
      for (let index = 0; index < indices.length; index += 3) {
        unite(ids[indices[index]], ids[indices[index + 1]]);
        unite(ids[indices[index]], ids[indices[index + 2]]);
      }
      entries.push({ mesh, primitive, indices, ids });
    }
  });
  const components = new Map();
  for (const { indices, ids } of entries) for (let index = 0; index < indices.length; index += 3) {
    const id = find(ids[indices[index]]);
    let component = components.get(id);
    if (!component) { component = { id, triangles: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; components.set(id, component) }
    component.triangles++;
    for (let corner = 0; corner < 3; corner++) for (let axis = 0; axis < 3; axis++) {
      const value = points[ids[indices[index + corner]]][axis];
      component.min[axis] = Math.min(component.min[axis], value);
      component.max[axis] = Math.max(component.max[axis], value);
    }
  }
  const sorted = [...components.values()].sort((a, b) => b.triangles - a.triangles), main = sorted[0];
  const removed = sorted.filter(component => {
    const size = component.max.map((value, axis) => value - component.min[axis]);
    const gap = component.max.map((value, axis) => Math.max(0, main.min[axis] - value, component.min[axis] - main.max[axis]));
    return Math.max(...size) < options.maxSize && Math.hypot(...gap) > options.minDistance;
  });
  const removedIds = new Set(removed.map(component => component.id));
  for (const { mesh, primitive, indices, ids } of entries) {
    const kept = [];
    for (let index = 0; index < indices.length; index += 3) if (!removedIds.has(find(ids[indices[index]]))) kept.push(indices[index], indices[index + 1], indices[index + 2]);
    if (!kept.length) { mesh.removePrimitive(primitive); primitive.dispose(); continue }
    primitive.setIndices(primitive.getIndices().clone().setArray(new Uint32Array(kept)));
    compactPrimitive(primitive);
  }
  return { criteria: options, components: sorted.length, removedTriangles: removed.reduce((total, component) => total + component.triangles, 0), removed: removed.map(({ triangles, min, max }) => ({ triangles, min, max })) };
}

function normalize(document, asset) {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const original = dimensions(scene);
  if (original.some(size => !Number.isFinite(size) || size <= 0)) throw new Error(`${asset.name} 的模型包围盒无效。`);
  const degrees = asset.rotationY ?? (original[2] > original[0] ? 90 : 0);
  const angle = degrees * Math.PI / 180;
  const node = document.createNode(asset.name).setRotation([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]);
  for (const child of scene.listChildren()) { scene.removeChild(child); node.addChild(child) }
  scene.addChild(node);
  const oriented = dimensions(scene);
  const scale = asset.width ? asset.width / oriented[0] : asset.height / oriented[1];
  node.setScale([scale, scale, scale]);
  const { min, max } = getBounds(scene);
  node.setTranslation([-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2]);
  return { scene, originalDimensions: original, dimensions: dimensions(scene), rotationY: degrees, scale };
}

function createTreeLevels(document, scene, targetTriangles) {
  const children = scene.listChildren();
  const near = document.createNode('lod_near');
  const far = document.createNode('lod_far');
  const meshes = new Set();
  for (const child of children) child.traverse(node => { if (node.getMesh()) meshes.add(node.getMesh()) });
  const total = [...meshes].reduce((count, mesh) => count + triangles(mesh), 0);
  const farMeshes = new Map();
  const duplicate = source => {
    const node = document.createNode(source.getName()).setMatrix(source.getMatrix());
    const sourceMesh = source.getMesh();
    if (sourceMesh) {
      let mesh = farMeshes.get(sourceMesh);
      if (!mesh) {
        mesh = document.createMesh(`${sourceMesh.getName()}_far`);
        for (const primitive of sourceMesh.listPrimitives()) {
          const copy = primitive.clone();
          const indices = primitive.getIndices();
          const count = Math.max(3, Math.floor(targetTriangles * (indices.getCount() / 3) / total) * 3);
          const [reduced] = MeshoptSimplifier.simplifySloppy(new Uint32Array(indices.getArray()), primitive.getAttribute('POSITION').getArray(), 3, null, Math.min(indices.getCount(), count), 0.06);
          if (reduced.length < 3) throw new Error('细长行道树远景减面丢失全部三角面，请调整 farTriangles 或误差。');
          copy.setIndices(indices.clone().setArray(reduced));
          mesh.addPrimitive(compactPrimitive(copy));
        }
        farMeshes.set(sourceMesh, mesh);
      }
      node.setMesh(mesh);
    }
    for (const child of source.listChildren()) node.addChild(duplicate(child));
    return node;
  };
  for (const child of children) {
    far.addChild(duplicate(child));
    scene.removeChild(child); near.addChild(child);
  }
  scene.addChild(near).addChild(far);
  return { near: [...meshes].reduce((count, mesh) => count + triangles(mesh), 0), far: [...farMeshes.values()].reduce((count, mesh) => count + triangles(mesh), 0) };
}

const records = [];
for (let i = 0; i < assets.length; i++) {
  const asset = assets[i], document = documents[i];
  await document.transform(dequantize(), flatten(), dedup(), joinMeshes(), weld());
  const originalTriangles = triangleCount(document);
  const fragmentCleanup = asset.fragments ? removeDistantFragments(document, asset.fragments) : undefined;
  if (fragmentCleanup) {
    await document.transform(prune());
    console.log(JSON.stringify({ name: asset.name, fragmentCleanup }));
  }
  const cleanedTriangles = triangleCount(document);
  await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, asset.triangles / cleanedTriangles), error: asset.error }));
  for (const material of document.getRoot().listMaterials()) {
    material.setDoubleSided(Boolean(asset.farTriangles));
    material.setRoughnessFactor(asset.farTriangles ? 0.95 : 0.86);
    material.setMetallicFactor(0);
  }
  const normalized = normalize(document, asset);
  const levels = asset.farTriangles ? createTreeLevels(document, normalized.scene, asset.farTriangles) : undefined;
  const preparedTriangles = levels?.near ?? triangleCount(document);
  if (preparedTriangles > asset.triangles * 1.3) console.warn(`${asset.name} 受拓扑和误差限制，近景为 ${preparedTriangles} 面，高于目标 ${asset.triangles} 面；请结合预览决定是否调整减面误差。`);
  await document.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 86 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = new URL(`${asset.name}.glb`, outputDirectory);
  await io.write(file.pathname, document);
  const record = { file: `${asset.name}.glb`, bytes: (await stat(file)).size, triangles: triangleCount(document), ...(levels ? { levels } : {}), materials: document.getRoot().listMaterials().length, textures: document.getRoot().listTextures().length, originalTriangles, ...(fragmentCleanup ? { cleanedTriangles, fragmentCleanup } : {}), originalDimensions: normalized.originalDimensions, dimensions: normalized.dimensions, rotationY: normalized.rotationY, uniformScale: normalized.scale };
  records.push(record); console.log(JSON.stringify(record));
}

let previous = {};
try { previous = JSON.parse(await readFile(sourceFile, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const names = new Set(assets.map(asset => `${asset.name}.glb`));
const previousAssets = (previous.assets ?? []).filter(asset => names.has(asset.file));
const combined = new Map(previousAssets.map(asset => [asset.file, asset]));
for (const record of records) combined.set(record.file, record);
await writeFile(sourceFile, JSON.stringify({
  platform: 'Tripo Studio', date: '2026-10-31', model: 'H3.1',
  sourceUrls: Object.fromEntries(assets.map(asset => [asset.name, asset.sourceUrl])),
  terms: 'https://www.tripo3d.ai/terms',
  attribution: '本批通过主办方提供的 Tripo 资源生成；保留平台来源，不宣称 CC0 或真实街区的精确复原。',
  rendering: { 'slender-tree': '运行时按底色亮度与色相校正过亮的黄色叶片为低饱和绿叶，保留较暗的树干；不修改其他共享资产材质。' },
  preparation: ['三项 H3.1 文字生成几何，关闭平台分件；几何完成后另行并行生成 2K 纹理。', '最终模型仅保留底色贴图，粗糙度与金属度使用常量，不包含法线或金属粗糙度贴图。', '按世界包围盒整理 Y 向上、中心 XZ 与底部 Y 为零；建筑以宽度、树木以高度等比缩放，保留生成比例。', '办公楼按同位置焊接后的连通分量清理远离主体且尺寸较小的碎片，保留主体与邻近组件。', '焊接重复顶点，按误差限制减面，合并兼容材质与网格；树木共享材质并提供 lod_near 与 lod_far。', '贴图转 WebP 并限制为 2K，几何使用 Meshopt 压缩；不重新处理旧车辆、住宅和树木。'],
  tools: { gltfTransform: '4.5.1' }, assets: [...combined.values()]
}, null, 2));
