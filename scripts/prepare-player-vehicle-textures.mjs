import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [inputDirectory, toolsDirectory] = process.argv.slice(2);
if (!inputDirectory || !toolsDirectory) throw new Error('请提供原始 GLB 所在目录和模型整理工具目录。');
const resolveTool = createRequire(join(resolve(toolsDirectory), 'package.json'));
const moduleAt = name => import(pathToFileURL(resolveTool.resolve(name)).href);
const { NodeIO } = await moduleAt('@gltf-transform/core');
const { ALL_EXTENSIONS } = await moduleAt('@gltf-transform/extensions');
const { default: sharp } = await moduleAt('sharp');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const targetDirectory = new URL('../public/assets/generated/player/', import.meta.url);
await mkdir(targetDirectory, { recursive: true });
const padding = 4;

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function pack(parts, size) {
  let free = [{ x: 0, y: 0, width: size, height: size }];
  const rectangles = new Map();
  const sorted = [...parts].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || b.width * b.height - a.width * a.height || a.index - b.index);
  for (const part of sorted) {
    const width = part.width + padding * 2, height = part.height + padding * 2;
    const candidates = free.filter(rectangle => rectangle.width >= width && rectangle.height >= height)
      .sort((a, b) => Math.min(a.width - width, a.height - height) - Math.min(b.width - width, b.height - height) || a.width * a.height - b.width * b.height);
    if (!candidates.length) return;
    const used = { x: candidates[0].x, y: candidates[0].y, width, height };
    rectangles.set(part.index, used);
    const next = [];
    for (const rectangle of free) {
      const right = rectangle.x + rectangle.width, bottom = rectangle.y + rectangle.height;
      const usedRight = used.x + used.width, usedBottom = used.y + used.height;
      if (used.x >= right || usedRight <= rectangle.x || used.y >= bottom || usedBottom <= rectangle.y) { next.push(rectangle); continue; }
      if (used.x > rectangle.x) next.push({ ...rectangle, width: used.x - rectangle.x });
      if (usedRight < right) next.push({ ...rectangle, x: usedRight, width: right - usedRight });
      if (used.y > rectangle.y) next.push({ ...rectangle, height: used.y - rectangle.y });
      if (usedBottom < bottom) next.push({ ...rectangle, y: usedBottom, height: bottom - usedBottom });
    }
    free = next.filter((rectangle, index) => !next.some((other, otherIndex) => otherIndex !== index && contains(other, rectangle) && (!contains(rectangle, other) || otherIndex < index)));
  }
  return rectangles;
}

for (const [sourceName, name, sourceUrl] of [
  ['beijing-electric-suv', 'electric-suv', 'https://studio.tripo3d.ai/zh/workspace/generate/9ac1bd6b-2e7d-430f-bf67-7ce26b443dee'],
  ['beijing-adventure-motorcycle', 'adventure-motorcycle', 'https://studio.tripo3d.ai/zh/workspace/generate/515ae50d-0a3b-437c-9cf6-fcc6b31d84f5'],
]) {
  const document = await io.read(resolve(inputDirectory, `${sourceName}.glb`));
  const nodes = document.getRoot().listNodes().filter(node => node.getMesh());
  const parts = await Promise.all(nodes.map(async (node, index) => {
    const texture = node.getMesh().listPrimitives()[0].getMaterial().getBaseColorTexture();
    const image = Buffer.from(texture.getImage());
    const { width, height } = await sharp(image).metadata();
    return { index, part: node.getName(), width, height, image };
  }));
  let atlasSize, rectangles;
  for (const size of [2048, 3072]) {
    const packed = pack(parts, size);
    if (packed) { atlasSize = size; rectangles = packed; break; }
  }
  if (!rectangles) throw new Error(`${name} 的原生部件贴图无法装入 3072 像素图集。`);
  const layers = await Promise.all(parts.map(async part => {
    const rectangle = rectangles.get(part.index);
    return {
      input: await sharp(part.image).removeAlpha().extend({ top: padding, bottom: padding, left: padding, right: padding, extendWith: 'copy' }).png().toBuffer(),
      left: rectangle.x,
      top: rectangle.y,
    };
  }));
  const image = await sharp({ create: { width: atlasSize, height: atlasSize, channels: 3, background: '#ffffff' } }).composite(layers).webp({ lossless: true, effort: 6 }).toBuffer();
  const texture = `${name}.webp`;
  await writeFile(new URL(texture, targetDirectory), image);
  const metadata = {
    atlasSize,
    texture,
    sourceAtlas: { size: 2048, columns: 6, cell: 340, padding: 3 },
    tiles: parts.map(part => ({
      part: part.part,
      x: rectangles.get(part.index).x + padding,
      y: rectangles.get(part.index).y + padding,
      width: part.width,
      height: part.height,
    })),
    platform: 'Tripo Studio',
    model: 'H3.1',
    date: '2026-10-31',
    sourceFile: `${sourceName}.glb`,
    sourceUrl,
    terms: 'https://www.tripo3d.ai/terms',
    attribution: '本项目通过主办方提供的 Tripo 资源生成；保留平台来源，不宣称 CC0 或指定现实车型的精确模型。',
    preparation: '保留各部件原生底色像素，四像素边缘延拓并紧凑打包，无缩放及无损 WebP 编码；新图集供玩家第二套 UV 使用，原始图集与车损分件保持不变。',
    bytes: image.length,
    nativePixels: parts.reduce((sum, part) => sum + part.width * part.height, 0),
    padding,
  };
  await writeFile(new URL(`${name}.json`, targetDirectory), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify({ name, atlasSize, bytes: image.length, nativePixels: metadata.nativePixels, tiles: parts.length }));
}
