import * as THREE from 'three';
import type { RoadPath } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';
import { LoadingBudget } from './loading-budget';

function shopSigns() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const names = ['街角便利', '京北书店', '晨光面馆', '街角咖啡', '城市花房', '顺路生鲜', '邻里食堂', '远行车品'];
  const colors = ['#49615b', '#4c5962', '#8b5b43', '#4d4540', '#62715d', '#657368', '#826853', '#535e67'];
  for (let i = 0; i < names.length; i++) {
    const x = i % 2 * 512, y = Math.floor(i / 2) * 128;
    ctx.fillStyle = colors[i]; ctx.fillRect(x, y, 512, 128);
    ctx.strokeStyle = '#c9c6ae'; ctx.lineWidth = 3; ctx.strokeRect(x + 12, y + 12, 488, 104);
    ctx.fillStyle = '#f1ecdf'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '500 61px "Overdrive Scene", "PingFang SC", sans-serif';
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

export async function addUrbanFrontage(roads: RoadPath[], batch: SceneryBatch) {
  const budget = new LoadingBudget();
  const cellSize = 6;
  const index = new RoadIndex(roads), occupied = new Set<string>(), lastTemplates = new Map<string, number>();
  const wall = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94 });
  wall.userData.airObstacle = true;
  const trim = new THREE.MeshStandardMaterial({ color: '#d4d3c8', roughness: 0.84 });
  const roof = new THREE.MeshStandardMaterial({ color: '#696f70', roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: '#344b55', roughness: 0.28, metalness: 0.24 });
  const pavement = new THREE.MeshStandardMaterial({ color: '#aaa99d', roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#424b4d', roughness: 0.8 });
  const foliage = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  const soil = new THREE.MeshStandardMaterial({ color: '#797963', roughness: 1 });
  const shrub = new THREE.IcosahedronGeometry(1, 1), bed = new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2);
  shrub.computeBoundingBox();
  const shrubBottom = shrub.boundingBox!.min.y;
  const signs = shopSigns();
  const position = new THREE.Vector3(), size = new THREE.Vector3();
  const palette = ['#b6afa0', '#b9b8ae', '#a4a7a3', '#c5beac', '#b6b0a2'].map(color => new THREE.Color(color));
  const greens = ['#69775a', '#7a8262', '#5f7158'].map(color => new THREE.Color(color));
  let seed = 761;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 };
  for (const road of roads) {
    if (road.kind !== 'service') continue;
    for (let along = 74; along < road.length - 38; along += 76) for (const side of [-1, 1]) {
      if (budget.exhausted) await budget.yield();
      const at = sampleRoad(road, along, side * (road.width / 2 + 23));
      if (Math.abs(at.point.y) > 0.15) continue;
      if ([along - 22, along + 22].some(distance => Math.abs(sampleRoad(road, distance).point.y) > 0.15)) continue;
      const heading = at.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      const c = Math.cos(heading), s = Math.sin(heading);
      const toWorld = (x: number, z: number) => ({ x: at.point.x + x * c + z * s, z: at.point.z - x * s + z * c });
      const width = 25 + random() * 7, depth = 14;
      const parcelKeys = new Set<string>();
      const parcelX = Array.from({ length: Math.ceil((width + 5.2) / 3) + 1 }, (_, i) => -width / 2 - 2.6 + Math.min(i * 3, width + 5.2));
      const parcelZ = Array.from({ length: Math.ceil((depth + 7) / 3) + 1 }, (_, i) => -depth / 2 - 2 + Math.min(i * 3, depth + 7));
      let clear = true;
      for (const x of parcelX) {
        if (!clear) break;
        for (const z of parcelZ) {
          const point = toWorld(x, z);
          const near = index.nearest(point.x, point.z);
          const key = `${Math.floor(point.x / cellSize)},${Math.floor(point.z / cellSize)}`;
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
      const plant = (x: number, z: number, w: number, d: number, base: number, tall = false) => {
        const point = toWorld(x, z);
        batch.instance(soil, position.set(point.x, base + 0.006, point.z), size.set(w / 2, 1, d / 2), heading, bed);
        for (let n = 0; n < 3; n++) {
          const shift = (n - 1) * w * 0.24, height = (tall ? 0.48 : 0.2) + random() * 0.13;
          const p = toWorld(x + shift, z + (random() - 0.5) * 0.35);
          batch.instance(foliage, position.set(p.x, base - shrubBottom * height + 0.01, p.z), size.set(w * 0.23, height, d * 0.4), heading + n, shrub, greens[n]);
        }
      };
      const volume = (x: number, z: number, w: number, d: number, h: number, base: number, tint: THREE.Color) => {
        box(wall, x, base + h / 2, z, w, h, d, tint);
        box(trim, x, base + 0.3, z, w + 0.12, 0.6, d + 0.12);
        box(roof, x, base + h + 0.12, z, w + 0.45, 0.24, d + 0.45);
        box(trim, x, base + h + 0.34, z + d / 2, w + 0.3, 0.35, 0.18);
      };
      const sign = (x: number, y: number, z: number, w: number, h: number, number: number) => {
        const point = toWorld(x, z);
        batch.instance(signs.material, position.set(point.x, y, point.z), size.set(w, h, 1), heading, signs.panels[number % signs.panels.length]);
      };
      const bench = (x: number, z: number) => {
        box(roof, x, 0.55, z, 2.2, 0.14, 0.6);
        for (const shift of [-0.8, 0.8]) box(trim, x + shift, 0.27, z, 0.15, 0.5, 0.45);
      };
      const district = Math.abs((Math.floor(at.point.x / 650) * 31 + Math.floor(at.point.z / 650) * 17) % 10);
      const slot = Math.floor(along / 76), isOffice = (district === 2 || district === 7) && slot % 3 !== 0;
      const isWarehouse = district === 4 && slot % 3 !== 0;
      const templateStart = isOffice ? 3 : isWarehouse ? 5 : 0, templateCount = isOffice || isWarehouse ? 2 : 3;
      const sideKey = `${road.id}:${side}`;
      let template = templateStart + Math.floor(random() * templateCount);
      if (lastTemplates.get(sideKey) === template) template = templateStart + (template - templateStart + 1) % templateCount;
      lastTemplates.set(sideKey, template);
      const tint = palette[(slot + template + district) % palette.length];
      box(pavement, 0, 0.035, 8.7, width + 2.6, 0.14, 3.1);
      box(trim, 0, 0.13, 10.3, width - 4, 0.2, 0.2);
      for (let x = -width / 2 + 1.5; x < width / 2; x += 5.2) box(trim, x, 0.115, 8.7, 0.035, 0.025, 3);
      for (const edge of [-1, 1]) {
        plant(edge * (width / 2 + 0.2), 6.7, 2.8, 3.3, -0.08, true);
        plant(edge * (width / 2 - 2.5), 10.25, 3.5, 1.5, -0.08);
      }
      if (isOffice) {
        const height = 17 + Math.floor(random() * 4) * 3.3;
        const stepped = template === 4;
        const upperWidth = stepped ? width * 0.73 : width - 1.2;
        const upperDepth = stepped ? 10 : 12.2;
        const upperX = stepped ? (side > 0 ? 1 : -1) * width * 0.1 : 0;
        const upperZ = stepped ? -1.5 : -0.7;
        const baseHeight = stepped ? 4 : 0;
        box(pavement, 0, 0.025, 5.6, width + 1, 0.12, 4);
        if (stepped) {
          volume(0, -0.8, width - 0.4, 12.5, baseHeight, 0, tint);
          box(glass, 0, 1.95, 5.53, width - 2.4, 2.6, 0.16);
          plant(-upperX * 3.5, 3.9, 4.2, 1.5, baseHeight + 0.24);
          bench(upperX > 0 ? -width / 3 : width / 3, 6.5);
        }
        volume(upperX, upperZ, upperWidth, upperDepth, height - baseHeight, baseHeight, tint);
        for (let y = baseHeight + 2.5; y < height - 1.2; y += 3.3) {
          const front = upperZ + upperDepth / 2 + 0.08, rear = upperZ - upperDepth / 2 - 0.08;
          box(trim, upperX, y - 1.35, front, upperWidth + 0.12, stepped ? 0.24 : 0.14, 0.2);
          if (!stepped) {
            box(glass, upperX, y, front, upperWidth - 1.5, 2.25, 0.16);
            for (let x = -upperWidth / 2 + 1.4; x < upperWidth / 2; x += 4.2) box(trim, upperX + x, y, front + 0.12, 0.12, 2.4, 0.14);
          } else for (let x = -upperWidth / 2 + 2; x < upperWidth / 2 - 1; x += 3.7) {
            box(glass, upperX + x, y, front, 2.45, 2.05, 0.16);
            box(trim, upperX + x, y - 1.04, front + 0.12, 2.7, 0.12, 0.3);
          }
          for (const edge of [-1, 1]) {
            box(trim, upperX + edge * (upperWidth / 2 + 0.08), y - 1.35, upperZ, 0.2, 0.14, upperDepth + 0.12);
            for (const z of [-2.7, 2.7]) box(glass, upperX + edge * (upperWidth / 2 + 0.08), y, upperZ + z, 0.16, 2.15, 3.4);
          }
          for (const x of [-upperWidth / 3, 0, upperWidth / 3]) box(glass, upperX + x, y, rear, 2.6, 2.05, 0.16);
        }
        box(roof, upperX - upperWidth / 4, height + 0.7, upperZ - 1.7, 2.8, 1.1, 2.1);
        box(roof, 0, 3.35, 6.1, 6.8, 0.18, 2.4);
      } else if (isWarehouse) {
        const height = template === 5 ? 7.1 : 8.4, front = template === 5 ? 5.8 : 4.7;
        volume(0, front - 6.3, width - 0.6, 12.6, height, 0, tint);
        box(pavement, 0, 0.025, 6.5, width + 0.7, 0.12, 3.2);
        const doors = template === 5 ? 3 : 2, bayWidth = (width - 3) / doors;
        for (let door = 0; door < doors; door++) {
          const x = (door + 0.5) * bayWidth - (width - 3) / 2;
          box(trim, x, 2.3, front + 0.08, bayWidth - 1, 4.5, 0.22);
          box(dark, x, 2.2, front + 0.22, bayWidth - 1.4, 4.2, 0.14);
          for (let y = 0.6; y < 4.4; y += 0.65) box(roof, x, y, front + 0.32, bayWidth - 1.4, 0.07, 0.06);
          box(glass, x, 5.8, front + 0.09, bayWidth - 2, 0.95, 0.18);
        }
        box(roof, -width / 4, height + 0.28, -1, 2.4, 0.3, 6);
        if (template === 6) box(trim, width / 2 - 2.3, 4, front + 0.22, 0.35, height, 0.5);
      } else {
        const courtyard = template === 1, bays = courtyard ? 2 : template === 2 ? 4 : 3;
        const weights = Array.from({ length: bays }, () => 0.85 + random() * 0.5);
        const usableWidth = width - (courtyard ? 5.2 : 0), weightTotal = weights.reduce((a, b) => a + b, 0);
        let cursor = -width / 2;
        for (let bay = 0; bay < bays; bay++) {
          const bayWidth = weights[bay] / weightTotal * usableWidth;
          if (courtyard && bay === 1) cursor += 5.2;
          const x = cursor + bayWidth / 2;
          const height = 4.8 + random() * 1.7 + (template === 2 && bay % 2 === 0 ? 2.3 : 0);
          const front = 4.6 + random() * 1.3 - (courtyard ? 0.9 : 0), buildingDepth = 10.4 + random() * 1.4;
          const bayTint = palette[(slot + bay + template) % palette.length];
          volume(x, front - buildingDepth / 2, bayWidth - 0.16, buildingDepth, height, 0, bayTint);
          box(pavement, x, 0.025, (front + 7.3) / 2, bayWidth + 0.1, 0.12, 7.3 - front + 0.4);
          box(glass, x, 1.63, front + 0.09, bayWidth - 0.85, 2.65, 0.16);
          box(trim, x + bayWidth * 0.16, 1.63, front + 0.2, 0.1, 2.7, 0.09);
          box(trim, x, 0.4, front + 0.23, bayWidth - 0.8, 0.12, 0.1);
          box(template === 2 ? trim : roof, x, 3.2, front + 0.6, bayWidth - 0.25, 0.16, 1.4);
          sign(x, 4.02, front + 0.14, bayWidth - 0.7, 1.15, district + bay + slot);
          if (height > 7) for (const shift of [-0.24, 0.24]) box(glass, x + bayWidth * shift, 6.35, front + 0.08, Math.min(2.1, bayWidth * 0.29), 1.3, 0.16);
          if (bay % 2 === 0) box(roof, x - bayWidth * 0.17, height + 0.65, front - 4.5, 1.6, 1, 1.5);
          cursor += bayWidth;
        }
        if (courtyard) {
          const courtyardX = -width / 2 + weights[0] / weightTotal * usableWidth + 2.6;
          box(pavement, courtyardX, 0.025, 4.3, 5.2, 0.12, 5.7);
          plant(courtyardX, 3.1, 4.3, 2.8, 0.085, true);
          bench(courtyardX, 5.9);
        }
      }
      box(wall, 0, 0.55, -8.2, width - 1.8, 1.1, 0.3, palette[(district + 2) % palette.length]);
    }
  }
  return (x: number, z: number, radius: number) => {
    for (let cellX = Math.floor((x - radius) / cellSize); cellX <= Math.floor((x + radius) / cellSize); cellX++) {
      for (let cellZ = Math.floor((z - radius) / cellSize); cellZ <= Math.floor((z + radius) / cellSize); cellZ++) {
        if (occupied.has(`${cellX},${cellZ}`)) return true;
      }
    }
    return false;
  };
}
