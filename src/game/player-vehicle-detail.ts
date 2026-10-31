import * as THREE from 'three';
import { assetUrl } from '../asset-url';

interface VehicleAtlas {
  atlasSize: number;
  texture: string;
  sourceAtlas: { size: number; columns: number; cell: number; padding: number };
  tiles: { x: number; y: number; width: number; height: number }[];
}

export async function preparePlayerVehicle(name: string, source: THREE.Group) {
  const directory = 'assets/generated/player/';
  const response = await fetch(assetUrl(`${directory}${name}.json`));
  if (!response.ok) throw new Error(`玩家车辆纹理配置加载失败：${name}`);
  const atlas: VehicleAtlas = await response.json();
  const texture = await new THREE.TextureLoader().loadAsync(assetUrl(`${directory}${atlas.texture}`));
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.channel = 1;
  texture.anisotropy = 8;
  const model = source.clone(true);
  const materials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const { size, columns, cell, padding } = atlas.sourceAtlas;
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!geometries.has(object.geometry)) {
      const geometry = object.geometry.clone();
      const uv = geometry.getAttribute('uv');
      const detail = new Float32Array(uv.count * 2);
      for (let vertex = 0; vertex < uv.count; vertex++) {
        const x = uv.getX(vertex) * size, y = uv.getY(vertex) * size;
        const column = Math.floor(x / cell), row = Math.floor(y / cell);
        const tile = atlas.tiles[row * columns + column];
        detail[vertex * 2] = (tile.x + (x - column * cell - padding) / (cell - padding * 2) * tile.width) / atlas.atlasSize;
        detail[vertex * 2 + 1] = (tile.y + (y - row * cell - padding) / (cell - padding * 2) * tile.height) / atlas.atlasSize;
      }
      geometry.setAttribute('uv1', new THREE.BufferAttribute(detail, 2));
      geometries.set(object.geometry, geometry);
    }
    object.geometry = geometries.get(object.geometry)!;
    const material = object.material as THREE.MeshStandardMaterial;
    if (!materials.has(material)) {
      const detailed = material.clone();
      detailed.map = texture;
      materials.set(material, detailed);
    }
    object.material = materials.get(material)!;
  });
  return model;
}
