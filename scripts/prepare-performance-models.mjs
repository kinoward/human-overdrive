import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [toolsDirectory] = process.argv.slice(2);
if (!toolsDirectory) throw new Error('请提供模型整理工具目录。');
const resolveTool = createRequire(join(resolve(toolsDirectory), 'package.json'));
const moduleAt = name => import(pathToFileURL(resolveTool.resolve(name)).href);
const { NodeIO } = await moduleAt('@gltf-transform/core');
const { ALL_EXTENSIONS } = await moduleAt('@gltf-transform/extensions');
const { dedup, prune, weld, simplify, meshopt } = await moduleAt('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = await moduleAt('meshoptimizer');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const root = new URL('../public/assets/generated/', import.meta.url);
const directory = new URL('traffic/', root);
await mkdir(directory, { recursive: true });
const records = [];
for (const name of ['electric-suv', 'adventure-motorcycle', 'delivery-van', 'box-truck', 'city-bus']) {
  const source = `${name === 'electric-suv' || name === 'adventure-motorcycle' ? '' : 'traffic/'}${name}.glb`;
  const document = await io.read(new URL(source, root).pathname);
  const faces = () => document.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((total, primitive) => total + primitive.getIndices().getCount() / 3, 0), 0);
  const before = faces();
  await document.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.22, error: 0.008 }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(new URL(`${name}-lite.glb`, directory).pathname, document);
  const record = { source, file: `${name}-lite.glb`, before, triangles: faces() };
  records.push(record);
  console.log(JSON.stringify(record));
}
await writeFile(new URL('PERFORMANCE_MODELS.json', directory), JSON.stringify({ preparation: '从仓库已有授权模型派生轻量车流与警车，保留纹理、轮轴名称和尺寸；玩家保留原模型。', ratio: 0.22, error: 0.008, assets: records }, null, 2));
