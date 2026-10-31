import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [inputDirectory, toolsDirectory] = process.argv.slice(2);
if (!inputDirectory || !toolsDirectory) throw new Error('请提供本批路侧原始 GLB 所在目录和模型整理工具目录。');
const assets = [
  { name: 'lush-shrub', height: 1.3, rotationY: 0, triangles: 2500, nearSloppy: { triangles: 3000, error: 0.035 }, farTriangles: 500, error: 0.025, textureSize: 1024, sourceUrl: 'https://studio.tripo3d.ai/zh/workspace/generate/5f4f43a5-f02f-4b20-a8d6-fe72cd3cba3f' },
  { name: 'bus-shelter', width: 6, rotationY: null, triangles: 6000, error: 0.012, textureSize: 2048, sourceUrl: 'https://studio.tripo3d.ai/zh/workspace/generate/5b031bec-17b8-4541-896a-91c808444996' }
];
const resolveTool = createRequire(join(resolve(toolsDirectory), 'package.json'));
const moduleAt = name => import(pathToFileURL(resolveTool.resolve(name)).href);
const { NodeIO } = await moduleAt('@gltf-transform/core');
const { ALL_EXTENSIONS } = await moduleAt('@gltf-transform/extensions');
const { dedup, prune, flatten, join: joinMeshes, weld, dequantize, simplify, compactPrimitive, getBounds, listTextureSlots, textureCompress, meshopt } = await moduleAt('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = await moduleAt('meshoptimizer');
const { default: sharp } = await moduleAt('sharp');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const outputDirectory = new URL('../public/assets/generated/', import.meta.url);
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

function reduceShrubNear(document, options) {
  const originalTriangles = triangleCount(document);
  if (originalTriangles <= options.triangles) return undefined;
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0], originalSize = dimensions(scene);
  let maximumError = 0, lockedVertices = 0;
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION'), values = position.getArray(), minimum = position.getMin([]), maximum = position.getMax([]);
    const locked = new Uint8Array(position.getCount());
    for (let vertex = 0; vertex < position.getCount(); vertex++) for (let axis = 0; axis < 3; axis++) {
      const epsilon = (maximum[axis] - minimum[axis]) * 0.000001, value = values[vertex * 3 + axis];
      if (value <= minimum[axis] + epsilon || value >= maximum[axis] - epsilon) locked[vertex] = 1;
    }
    lockedVertices += locked.reduce((total, value) => total + value, 0);
    const source = primitive.getIndices(), target = Math.max(3, Math.floor(options.triangles * source.getCount() / 3 / originalTriangles) * 3);
    const [indices, error] = MeshoptSimplifier.simplifySloppy(new Uint32Array(source.getArray()), values, 3, locked, target, options.error);
    if (indices.length < 3) throw new Error('灌木近景减面丢失全部三角面，请保留原模型并调整误差。');
    primitive.setIndices(source.clone().setArray(indices));
    compactPrimitive(primitive);
    maximumError = Math.max(maximumError, error);
  }
  const relativeDimensions = dimensions(scene).map((size, axis) => size / originalSize[axis]);
  if (relativeDimensions.some(ratio => ratio < 0.9 || ratio > 1.1)) throw new Error('灌木近景减面改变了主要外轮廓，请保留原模型并调整误差。');
  return { method: 'sloppy', originalTriangles, triangles: triangleCount(document), maximumError, lockedVertices, relativeDimensions };
}

function normalize(document, asset) {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const original = dimensions(scene);
  if (original.some(size => !Number.isFinite(size) || size <= 0)) throw new Error(`${asset.name} 的模型包围盒无效。`);
  const degrees = asset.rotationY ?? (original[2] > original[0] ? 90 : 0), angle = degrees * Math.PI / 180;
  const node = document.createNode(asset.name).setRotation([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]);
  for (const child of scene.listChildren()) { scene.removeChild(child); node.addChild(child) }
  scene.addChild(node);
  const oriented = dimensions(scene), scale = asset.width ? asset.width / oriented[0] : asset.height / oriented[1];
  node.setScale([scale, scale, scale]);
  const { min, max } = getBounds(scene);
  node.setTranslation([-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2]);
  return { scene, originalDimensions: original, dimensions: dimensions(scene), rotationY: degrees, uniformScale: scale };
}

function createShrubLevels(document, scene, targetTriangles) {
  const children = scene.listChildren(), near = document.createNode('lod_near'), far = document.createNode('lod_far');
  const meshes = new Set();
  for (const child of children) child.traverse(node => { if (node.getMesh()) meshes.add(node.getMesh()) });
  const total = [...meshes].reduce((count, mesh) => count + triangles(mesh), 0), farMeshes = new Map();
  const duplicate = source => {
    const node = document.createNode(source.getName()).setMatrix(source.getMatrix()), sourceMesh = source.getMesh();
    if (sourceMesh) {
      let mesh = farMeshes.get(sourceMesh);
      if (!mesh) {
        mesh = document.createMesh(`${sourceMesh.getName()}_far`);
        for (const primitive of sourceMesh.listPrimitives()) {
          const copy = primitive.clone(), indices = primitive.getIndices();
          const target = Math.min(indices.getCount(), Math.max(3, Math.floor(targetTriangles * indices.getCount() / 3 / total) * 3));
          const [reduced] = MeshoptSimplifier.simplifySloppy(new Uint32Array(indices.getArray()), primitive.getAttribute('POSITION').getArray(), 3, null, target, 0.08);
          if (reduced.length < 3) throw new Error('灌木远景减面丢失全部三角面，请调整面数或误差。');
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
  for (const child of children) { far.addChild(duplicate(child)); scene.removeChild(child); near.addChild(child) }
  scene.addChild(near).addChild(far);
  return { near: total, far: [...farMeshes.values()].reduce((count, mesh) => count + triangles(mesh), 0) };
}

const records = [];
for (let index = 0; index < assets.length; index++) {
  const asset = assets[index], document = documents[index];
  await document.transform(dequantize(), flatten(), dedup(), joinMeshes(), weld());
  const originalTriangles = triangleCount(document);
  await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, asset.triangles / originalTriangles), error: asset.error }));
  const nearReduction = asset.nearSloppy ? reduceShrubNear(document, asset.nearSloppy) : undefined;
  if (asset.farTriangles) for (const material of document.getRoot().listMaterials()) material.setDoubleSided(true);
  const normalized = normalize(document, asset);
  const levels = asset.farTriangles ? createShrubLevels(document, normalized.scene, asset.farTriangles) : undefined;
  if ((levels?.near ?? triangleCount(document)) > asset.triangles * 1.3) console.warn(`${asset.name} 的拓扑或误差限制使面数高于目标，请结合画面决定是否继续减面。`);
  await document.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [asset.textureSize, asset.textureSize], quality: 90 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = new URL(`${asset.name}.glb`, outputDirectory);
  await io.write(file.pathname, document);
  const root = document.getRoot();
  const textures = await Promise.all(root.listTextures().map(async texture => {
    const metadata = await sharp(Buffer.from(texture.getImage())).metadata();
    return { name: texture.getName(), slots: listTextureSlots(texture), mimeType: texture.getMimeType(), width: metadata.width, height: metadata.height };
  }));
  const { scene, ...transformation } = normalized;
  const record = { file: `${asset.name}.glb`, bytes: (await stat(file)).size, originalTriangles, triangles: triangleCount(document), ...(levels ? { levels } : {}), ...(nearReduction ? { nearReduction } : {}), materials: root.listMaterials().length, textures, ...transformation };
  records.push(record); console.log(JSON.stringify(record));
}
await writeFile(new URL('ROADSIDES_SOURCES.json', outputDirectory), JSON.stringify({
  platform: 'Tripo Studio', date: '2026-10-31', model: 'H3.1', sourceUrls: Object.fromEntries(assets.map(asset => [asset.name, asset.sourceUrl])),
  terms: 'https://www.tripo3d.ai/terms', attribution: '本批通过主办方提供的 Tripo 资源生成；公交候车设施为原创街景装饰，不标注或宣称真实站点与线路。',
  preparation: ['生成时启用 2K 纹理与 PBR，去光和分件关闭；保留导出文件实际提供的材质因子和贴图，逐项记录纹理用途与尺寸。', 'Y 向上，模型底部归零并在 XZ 居中；候车亭按宽度、灌木按高度等比归一，不拉伸生成比例。', '焊接重复顶点、按误差限制减面、合并兼容网格与材质；灌木近景再用保护边界顶点的 sloppy 减面，并记录外轮廓比例与误差，保留索引对应的 UV 和法线。', '灌木提供共享材质的 lod_near 与 lod_far，贴图限制为 1K；候车亭为 2K，转 WebP 并使用 Meshopt 压缩，不重新处理旧七项模型。'],
  tools: { gltfTransform: '4.5.1' }, assets: records
}, null, 2));
