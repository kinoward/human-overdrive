import * as THREE from 'three';
import { assetUrl } from '../asset-url';
import type { RoadPath } from '../types';

interface StoredWorld {
  source: { name: string; osmTimestamp: string };
  attribution: string;
  roads: Omit<RoadPath, 'cumulative'>[];
  mainLoopLength: number;
}

export async function loadWorldAssets(onProgress?: (loaded: number, total: number) => Promise<void>) {
  const loader = new THREE.TextureLoader();
  let loaded = 0;
  const report = async () => { await onProgress?.(++loaded, 8) };
  const loadTexture = async (path: string, color = false) => {
    const texture = await loader.loadAsync(assetUrl(`assets/art/Textures/${path}`));
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    await report();
    return texture;
  };
  const loadRoads = async () => {
    const response = await fetch(assetUrl('data/beijing-roads.json'));
    if (!response.ok) throw new Error('道路加载失败，请重新进入关卡。');
    const stored = await response.json() as StoredWorld;
    await report();
    return stored;
  };
  const loadFont = async () => {
    const font = new FontFace('Overdrive Scene', `url(${assetUrl('assets/art/Fonts/OverdriveScene-Regular.woff2')})`);
    document.fonts.add(await font.load());
    await report();
  };
  const [stored, asphaltMap, asphaltNormal, asphaltRough, concreteMap, concreteNormal, concreteRough] = await Promise.all([
    loadRoads(),
    loadTexture('Asphalt02/asphalt_02_diff_2k.webp', true),
    loadTexture('Asphalt02/asphalt_02_nor_gl_2k.webp'),
    loadTexture('Asphalt02/asphalt_02_rough_2k.webp'),
    loadTexture('ConcreteWall006/concrete_wall_006_diff_2k.webp', true),
    loadTexture('ConcreteWall006/concrete_wall_006_nor_gl_2k.webp'),
    loadTexture('ConcreteWall006/concrete_wall_006_rough_2k.webp'),
    loadFont(),
  ]);
  return { stored, asphaltMap, asphaltNormal, asphaltRough, concreteMap, concreteNormal, concreteRough };
}
