import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitTrafficWheels } from './split-traffic-wheels.mjs';

const [inputDirectory, toolsDirectory, requested] = process.argv.slice(2);
if (!inputDirectory || !toolsDirectory) throw new Error('请提供原始车辆目录和模型工具目录。');
const requireTool = createRequire(join(resolve(toolsDirectory), 'package.json'));
const moduleAt = name => import(pathToFileURL(requireTool.resolve(name)).href);
const { NodeIO } = await moduleAt('@gltf-transform/core');
const { ALL_EXTENSIONS } = await moduleAt('@gltf-transform/extensions');
const { flatten, getBounds, transformPrimitive, dedup, weld, prune, textureCompress, meshopt } = await moduleAt('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = await moduleAt('meshoptimizer');
const { default: sharp } = await moduleAt('sharp');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const target = new URL('../public/assets/generated/traffic/', import.meta.url);
await mkdir(target, { recursive: true });
const specifications = [
  { name: 'box-truck', length: 9.2, width: 2.5, height: 3.5, rotation: 0, project: 'fc1abe30-9d77-419d-b75c-06439b8b3abb' },
  { name: 'delivery-van', length: 5.5, width: 2.05, height: 2.5, rotation: 0, project: '6302f7b8-0382-4895-95e3-5e5b7fb7788a' },
  { name: 'city-bus', length: 10.5, width: 2.5, height: 3.2, rotation: 0, project: '2768afbc-b88f-4789-86b9-1a4d44903af0' }
];
for (const spec of specifications.filter(item => !requested || item.name === requested)) {
  const document = await io.read(resolve(inputDirectory, `${spec.name}-original.glb`));
  await document.transform(flatten());
  if (spec.rotation) {
    const c = Math.cos(spec.rotation), s = Math.sin(spec.rotation);
    for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) transformPrimitive(primitive, [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }
  const bounds = getBounds(document.getRoot().listScenes()[0]);
  const scale = [spec.width, spec.height, spec.length].map((value, axis) => value / (bounds.max[axis] - bounds.min[axis]));
  const translation = [-(bounds.min[0] + bounds.max[0]) / 2 * scale[0], -bounds.min[1] * scale[1], -(bounds.min[2] + bounds.max[2]) / 2 * scale[2]];
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) transformPrimitive(primitive, [scale[0], 0, 0, 0, 0, scale[1], 0, 0, 0, 0, scale[2], 0, ...translation, 1]);
  const wheels = splitTrafficWheels(document, spec, scale, translation, transformPrimitive);
  for (const material of document.getRoot().listMaterials()) { material.setDoubleSided(false); material.setRoughnessFactor(0.65); material.setMetallicFactor(0.12) }
  await document.transform(dedup(), weld(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 84 }), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16 }));
  const output = new URL(`${spec.name}.glb`, target);
  await io.write(output.pathname, document);
  const record = { file: `${spec.name}.glb`, bytes: (await stat(output)).size, triangles: document.getRoot().listMeshes().reduce((total, mesh) => total + mesh.listPrimitives().reduce((sum, primitive) => sum + primitive.getIndices().getCount() / 3, 0), 0), materials: document.getRoot().listMaterials().length, textures: document.getRoot().listTextures().length, dimensions: { length: spec.length, width: spec.width, height: spec.height }, front: '+Z', ground: 'minY约0，轮胎圆度处理保留毫米级余量', bounds: getBounds(document.getRoot().listScenes()[0]), wheelCorrection: '保留轮心，按Y半径校正Z向椭圆拉伸，外胎单调径向归圆，切面封口，轮轴局部X向旋转', source: `https://studio.tripo3d.ai/zh/workspace/generate/${spec.project}`, structure: 'body车体与独立wheel_*轮轴，轮胎及轮毂从原始真实网格裁出，切面补齐，局部X轴旋转', wheels };
  await writeFile(new URL(`${spec.name}.json`, target), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
}
