import * as THREE from 'three';
import type { RoadPath } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';

function shopSigns() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const names = ['四环便利', '京北书店', '晨光面馆', '街角咖啡', '城市花房', '顺路生鲜', '邻里食堂', '远行车品'];
  const colors = ['#49615b', '#4c5962', '#8b5b43', '#4d4540', '#62715d', '#657368', '#826853', '#535e67'];
  for (let i = 0; i < names.length; i++) {
    const x = i % 2 * 512, y = Math.floor(i / 2) * 128;
    ctx.fillStyle = colors[i]; ctx.fillRect(x, y, 512, 128);
    ctx.strokeStyle = '#c9c6ae'; ctx.lineWidth = 3; ctx.strokeRect(x + 12, y + 12, 488, 104);
    ctx.fillStyle = '#f1ecdf'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '500 61px "Source Han Sans", "PingFang SC", sans-serif';
    ctx.fillText(names[i], x + 256, y + 66);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
  const panels = names.map((_, i) => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const uv = geometry.getAttribute('uv');
    for (let v = 0; v < uv.count; v++) uv.setXY(v, (i % 2 + uv.getX(v)) / 2, 1 - (Math.floor(i / 2) + 1 - uv.getY(v)) / 4);
    return geometry;
  });
  return { material, panels };
}

export function addUrbanFrontage(roads: RoadPath[], batch: SceneryBatch) {
  const index = new RoadIndex(roads), occupied = new Set<string>();
  const wall = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94 });
  const trim = new THREE.MeshStandardMaterial({ color: '#d4d3c8', roughness: 0.84 });
  const roof = new THREE.MeshStandardMaterial({ color: '#696f70', roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: '#344b55', roughness: 0.28, metalness: 0.24 });
  const pavement = new THREE.MeshStandardMaterial({ color: '#a6a59a', roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#424b4d', roughness: 0.8 });
  const signs = shopSigns();
  const position = new THREE.Vector3(), size = new THREE.Vector3();
  const palette = ['#b6afa0', '#b9b8ae', '#a4a7a3', '#c5beac', '#b6b0a2'].map(color => new THREE.Color(color));
  let seed = 761;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 };
  for (const road of roads) {
    if (road.kind !== 'service') continue;
    for (let along = 74; along < road.length - 38; along += 76) for (const side of [-1, 1]) {
      const at = sampleRoad(road, along, side * (road.width / 2 + 23));
      if (Math.abs(at.point.y) > 0.15) continue;
      if ([along - 22, along + 22].some(distance => Math.abs(sampleRoad(road, distance).point.y) > 0.15)) continue;
      const heading = at.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      const c = Math.cos(heading), s = Math.sin(heading);
      const toWorld = (x: number, z: number) => ({ x: at.point.x + x * c + z * s, z: at.point.z - x * s + z * c });
      const width = 26 + random() * 6, depth = 14;
      const parcelKeys = new Set<string>();
      const parcelX = Array.from({ length: Math.ceil((width + 4) / 3) + 1 }, (_, i) => -width / 2 - 2 + Math.min(i * 3, width + 4));
      const parcelZ = Array.from({ length: Math.ceil((depth + 7) / 3) + 1 }, (_, i) => -depth / 2 - 2 + Math.min(i * 3, depth + 7));
      let clear = true;
      for (const x of parcelX) {
        if (!clear) break;
        for (const z of parcelZ) {
          const point = toWorld(x, z);
          const near = index.nearest(point.x, point.z);
          const key = `${Math.floor(point.x / 18)},${Math.floor(point.z / 18)}`;
          if (!near || Math.abs(near.offset) < near.road.width / 2 + 8 || occupied.has(key)) { clear = false; break }
          parcelKeys.add(key);
        }
      }
      if (!clear) continue;
      parcelKeys.forEach(key => occupied.add(key));
      const box = (material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, color?: THREE.Color) => {
        const point = toWorld(x, z);
        batch.instance(material, position.set(point.x, y, point.z), size.set(w, h, d), heading, batch.box, color);
      };
      const district = Math.abs((Math.floor(at.point.x / 650) * 31 + Math.floor(at.point.z / 650) * 17) % 10);
      const tint = palette[Math.floor(random() * palette.length)];
      const isOffice = (district === 2 || district === 7) && Math.floor(along / 76) % 3 !== 0;
      const isWarehouse = district === 4;
      const height = isOffice ? 17 + Math.floor(random() * 3) * 3.4 : isWarehouse ? 7.3 : 5.4;
      box(pavement, 0, 0.06, 1, width + 4, 0.16, depth + 6);
      box(trim, 0, 0.18, depth / 2 + 3.9, width + 4, 0.28, 0.22);
      for (let x = -width / 2; x < width / 2; x += 4) box(trim, x, 0.15, depth / 2 + 2, 0.035, 0.025, 3.6);
      box(wall, 0, height / 2, 0, width, height, depth, tint);
      box(trim, 0, 0.3, 0, width + 0.18, 0.6, depth + 0.18);
      box(roof, 0, height + 0.15, 0, width + 0.65, 0.3, depth + 0.65);
      box(trim, 0, height + 0.38, depth / 2, width + 0.5, 0.45, 0.22);
      box(roof, -width / 4, height + 0.75, -1.7, 2.8, 1.2, 2.1);
      box(trim, -width / 4, height + 1.38, -1.7, 3.05, 0.12, 2.35);
      box(wall, 0, 0.65, -depth / 2 - 1.3, width + 3, 1.3, 0.3, palette[2]);
      if (isOffice) {
        for (let y = 2.5; y < height - 1.4; y += 3.4) {
          box(trim, 0, y - 1.4, depth / 2 + 0.08, width + 0.12, 0.14, 0.2);
          for (let x = -width / 2 + 2.5; x < width / 2 - 1.4; x += 3.8) {
            box(glass, x, y, depth / 2 + 0.08, 2.65, 2.25, 0.16);
            box(trim, x, y, depth / 2 + 0.19, 0.07, 2.25, 0.08);
          }
          for (const side of [-1, 1]) {
            box(trim, side * (width / 2 + 0.08), y - 1.4, 0, 0.2, 0.14, depth + 0.12);
            for (const z of [-3.2, 3.2]) {
              box(glass, side * (width / 2 + 0.08), y, z, 0.16, 2.25, 3.7);
              box(trim, side * (width / 2 + 0.19), y, z, 0.08, 2.25, 0.07);
            }
          }
        }
        box(roof, 0, 3.6, depth / 2 + 0.8, 7.4, 0.2, 2.3);
      } else if (isWarehouse) {
        for (const x of [-width / 3, 0, width / 3]) {
          box(trim, x, 2.3, depth / 2 + 0.08, width / 4 + 0.4, 4.5, 0.22);
          box(dark, x, 2.2, depth / 2 + 0.22, width / 4, 4.2, 0.14);
          for (let y = 0.6; y < 4.4; y += 0.5) box(roof, x, y, depth / 2 + 0.32, width / 4, 0.07, 0.06);
          box(glass, x, 5.8, depth / 2 + 0.09, width / 4, 0.95, 0.18);
        }
      } else {
        const bays = 3, bayWidth = width / bays;
        for (let bay = 0; bay < bays; bay++) {
          const x = (bay + 0.5) * bayWidth - width / 2;
          box(glass, x, 1.65, depth / 2 + 0.09, bayWidth - 0.8, 2.7, 0.16);
          for (const shift of [-0.27, 0.27]) box(trim, x + shift * bayWidth, 1.65, depth / 2 + 0.21, 0.1, 2.7, 0.09);
          box(trim, x, 0.4, depth / 2 + 0.23, bayWidth - 0.75, 0.12, 0.1);
          box(roof, x, 3.25, depth / 2 + 0.65, bayWidth - 0.3, 0.18, 1.5);
          const point = toWorld(x, depth / 2 + 0.14);
          const sign = (district + bay + Math.floor(along / 76)) % signs.panels.length;
          batch.instance(signs.material, position.set(point.x, 4.28, point.z), size.set(bayWidth - 0.7, 1.28, 1), heading, signs.panels[sign]);
        }
      }
    }
  }
  return (x: number, z: number, radius: number) => {
    for (let cellX = Math.floor((x - radius) / 18); cellX <= Math.floor((x + radius) / 18); cellX++) {
      for (let cellZ = Math.floor((z - radius) / 18); cellZ <= Math.floor((z + radius) / 18); cellZ++) {
        if (occupied.has(`${cellX},${cellZ}`)) return true;
      }
    }
    return false;
  };
}
