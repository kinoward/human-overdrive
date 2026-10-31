import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [inputDirectory, toolsDirectory] = process.argv.slice(2);
if (!inputDirectory || !toolsDirectory) throw new Error('请提供原始 GLB 所在目录和模型整理工具目录。');
const resolveTool = createRequire(join(resolve(toolsDirectory), 'package.json'));
const moduleAt = name => import(pathToFileURL(resolveTool.resolve(name)).href);
const { NodeIO } = await moduleAt('@gltf-transform/core');
const { ALL_EXTENSIONS } = await moduleAt('@gltf-transform/extensions');
const { dedup, prune, weld, simplify, textureCompress, meshopt, joinPrimitives, transformPrimitive, compactPrimitive } = await moduleAt('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = await moduleAt('meshoptimizer');
const { default: sharp } = await moduleAt('sharp');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const targetDirectory = new URL('../public/assets/generated/', import.meta.url);
await mkdir(targetDirectory, { recursive: true });
const records = [];

async function optimize(document, name, ratio, error) {
  await document.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error }), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 86 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = new URL(`${name}.glb`, targetDirectory);
  await io.write(file.pathname, document);
  const faces = document.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((total, primitive) => total + primitive.getIndices().getCount() / 3, 0), 0);
  const record = { file: `${name}.glb`, bytes: (await stat(file)).size, triangles: faces, materials: document.getRoot().listMaterials().length, textures: document.getRoot().listTextures().length };
  records.push(record); console.log(JSON.stringify(record));
}

async function prepareVehicle(sourceName, name, wheelNames, targetLength, sourceLength, wheelY, forwardAxis, glassParts = new Set()) {
  const car = await io.read(resolve(inputDirectory, `${sourceName}.glb`));
  const carRoot = car.getRoot();
  const parts = carRoot.listNodes().filter(node => node.getMesh());
  const columns = 6, cell = 340, atlasSize = 2048, padding = 3;
  const baseTiles = [], packedTiles = [];
  const scale = targetLength / sourceLength, yOffset = wheelY * scale + 0.44;
  const matrix = forwardAxis === 'Z' ? [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, -yOffset, 0, 1] : [0, 0, -scale, 0, 0, scale, 0, 0, scale, 0, 0, 0, 0, -yOffset, 0, 1];
  const atlas = car.createTexture('车辆共享底色'), packed = car.createTexture('车辆共享材质参数');
  const material = car.createMaterial('车辆共享材质').setBaseColorTexture(atlas).setMetallicRoughnessTexture(packed).setRoughnessFactor(1).setMetallicFactor(1).setDoubleSided(false);
  const bodyPrimitives = [], wheelPrimitives = new Map();
  const rootNode = carRoot.listScenes()[0].listChildren()[0];
  for (let index = 0; index < parts.length; index++) {
    const node = parts[index], primitive = node.getMesh().listPrimitives()[0], partName = node.getName();
    const image = primitive.getMaterial().getBaseColorTexture().getImage();
    const x = index % columns * cell, y = Math.floor(index / columns) * cell;
    baseTiles.push({ input: await sharp(Buffer.from(image)).resize(cell - padding * 2, cell - padding * 2).extend({ top: padding, bottom: padding, left: padding, right: padding, extendWith: 'copy' }).png().toBuffer(), left: x, top: y });
    const isWheel = wheelNames.has(partName), isGlass = glassParts.has(partName);
    const roughness = isWheel ? 0.88 : isGlass ? 0.16 : 0.44, metallic = isWheel ? 0.08 : isGlass ? 0.3 : 0.25;
    packedTiles.push({ input: { create: { width: cell, height: cell, channels: 3, background: { r: 255, g: Math.round(roughness * 255), b: Math.round(metallic * 255) } } }, left: x, top: y });
    const uv = primitive.getAttribute('TEXCOORD_0'), values = new Float32Array(uv.getArray());
    for (let i = 0; i < values.length; i += 2) { values[i] = (x + padding + values[i] * (cell - padding * 2)) / atlasSize; values[i + 1] = (y + padding + values[i + 1] * (cell - padding * 2)) / atlasSize }
    uv.setArray(values); primitive.setMaterial(material); transformPrimitive(primitive, matrix);
    if (isWheel) {
      const wheelName = wheelNames.get(partName);
      if (!wheelPrimitives.has(wheelName)) wheelPrimitives.set(wheelName, []);
      wheelPrimitives.get(wheelName).push(primitive);
    } else bodyPrimitives.push(primitive);
    node.getParentNode()?.removeChild(node); node.dispose();
  }
  for (const [wheelName, primitives] of wheelPrimitives) {
    const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
    for (const primitive of primitives) {
      const positions = primitive.getAttribute('POSITION').getArray();
      for (let i = 0; i < positions.length; i++) { const axis = i % 3; minimum[axis] = Math.min(minimum[axis], positions[i]); maximum[axis] = Math.max(maximum[axis], positions[i]) }
    }
    const pivot = minimum.map((value, axis) => (value + maximum[axis]) / 2);
    for (const primitive of primitives) transformPrimitive(primitive, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -pivot[0], -pivot[1], -pivot[2], 1]);
    const mesh = car.createMesh(`${wheelName}_mesh`).addPrimitive(joinPrimitives(primitives));
    rootNode.addChild(car.createNode(wheelName).setTranslation(pivot).addChild(car.createNode(`${wheelName}_mesh`).setMesh(mesh)));
  }
  atlas.setImage(await sharp({ create: { width: atlasSize, height: atlasSize, channels: 3, background: '#ffffff' } }).composite(baseTiles).webp({ quality: 90 }).toBuffer()).setMimeType('image/webp');
  packed.setImage(await sharp({ create: { width: atlasSize, height: atlasSize, channels: 3, background: '#ff5555' } }).composite(packedTiles).webp({ lossless: true }).toBuffer()).setMimeType('image/webp');
  rootNode.addChild(car.createNode('body').setMesh(car.createMesh('body').addPrimitive(joinPrimitives(bodyPrimitives))));
  await optimize(car, name, 1, 0.001);
}

await prepareVehicle('beijing-electric-suv', 'electric-suv', new Map([['tripo_part_2', 'wheel_fl'], ['tripo_part_4', 'wheel_fr'], ['tripo_part_3', 'wheel_rl'], ['tripo_part_5', 'wheel_rr']]), 4.75, 0.979827880859375, 0.078, 'Z', new Set(['tripo_part_7', 'tripo_part_8', 'tripo_part_15', 'tripo_part_16']));
await prepareVehicle('beijing-adventure-motorcycle', 'adventure-motorcycle', new Map([['tripo_part_1', 'wheel_front'], ['tripo_part_6', 'wheel_rear'], ['tripo_part_16', 'wheel_rear']]), 2.3, 0.980621337890625, 0.15785, '-X');

for (const [source, name, matrix, ratio] of [
  ['beijing-residential-block', 'residential-block', [0, 0, -16 / 0.42948925495147705, 0, 0, 27 / 0.77410888671875, 0, 0, 28 / 0.98431396484375, 0, 0, 0, 0, 0, 0, 1], 0.35],
  ['beijing-roadside-tree', 'roadside-tree', [5.5 / 0.9698486328125, 0, 0, 0, 0, 8 / 0.972991943359375, 0, 0, 0, 0, 5.5 / 0.93231201171875, 0, 0, 0, 0, 1], 0.2]
]) {
  const document = await io.read(resolve(inputDirectory, `${source}.glb`));
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) transformPrimitive(primitive, matrix);
  for (const material of document.getRoot().listMaterials()) { material.setDoubleSided(name === 'roadside-tree'); material.setRoughnessFactor(name === 'roadside-tree' ? 0.95 : 0.85); material.setMetallicFactor(0) }
  if (name === 'roadside-tree') {
    await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.007 }));
    const scene = document.getRoot().listScenes()[0];
    const near = scene.listChildren()[0]; near.setName('lod_near');
    const farMesh = document.createMesh('tree_far');
    for (const primitive of near.getMesh().listPrimitives()) {
      const far = primitive.clone();
      const [indices] = MeshoptSimplifier.simplifySloppy(new Uint32Array(primitive.getIndices().getArray()), primitive.getAttribute('POSITION').getArray(), 3, null, 3600, 0.1);
      far.setIndices(document.createAccessor().setType('SCALAR').setArray(indices).setBuffer(primitive.getIndices().getBuffer()));
      farMesh.addPrimitive(compactPrimitive(far));
    }
    scene.addChild(document.createNode('lod_far').setMesh(farMesh));
    await optimize(document, name, 1, 0.001);
  } else await optimize(document, name, ratio, 0.007);
}
await writeFile(new URL('SOURCES.json', targetDirectory), JSON.stringify({
  platform: 'Tripo Studio', date: '2026-10-31', model: 'H3.1', sourceUrls: {
    'electric-suv': 'https://studio.tripo3d.ai/zh/workspace/generate/9ac1bd6b-2e7d-430f-bf67-7ce26b443dee',
    'adventure-motorcycle': 'https://studio.tripo3d.ai/zh/workspace/generate/515ae50d-0a3b-437c-9cf6-fcc6b31d84f5',
    'residential-block': 'https://studio.tripo3d.ai/zh/workspace/generate/147554eb-8dac-4326-ac2e-76a062ec8e11',
    'roadside-tree': 'https://studio.tripo3d.ai/zh/workspace/generate/2b89b4ea-2869-4ed9-961d-a78eb5b02996'
  }, terms: 'https://www.tripo3d.ai/terms', attribution: '本项目通过主办方提供的 Tripo 资源生成；保留平台来源，不宣称 CC0 或指定现实车型的精确模型。',
  preparation: ['汽车与摩托分件并生成纹理，整理独立轮轴，每种车型共享一套底色和材质参数贴图。', '统一米制、Y 向上与车辆 Z 向前；建筑与树木减面，材质和网格仅加载一次供重复实例使用。', '贴图转 WebP，几何使用 Meshopt 压缩。'], tools: { gltfTransform: '4.5.1' }, assets: records
}, null, 2));
