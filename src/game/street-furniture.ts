import * as THREE from 'three';
import type { RoadPath } from '../types';
import { generatedMeshes } from './generated-assets';
import { RoadIndex, sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';
import { meshBounds, type SceneryPlacement } from './scenery-placement';

function stopSignMaterial() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 384;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#40645a'; context.fillRect(0, 0, 256, 384);
  context.strokeStyle = '#d8ded0'; context.lineWidth = 7; context.strokeRect(12, 12, 232, 360);
  context.fillStyle = '#f2f0df'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = '600 77px "Source Han Sans", "PingFang SC", sans-serif';
  context.fillText('公交', 128, 132); context.fillText('候车', 128, 242);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 });
}

export function addStreetFurniture(roads: RoadPath[], batch: SceneryBatch, placement: SceneryPlacement) {
  const shelter = generatedMeshes('bus-shelter'), shelterBounds = meshBounds(shelter);
  const shelterSize = shelterBounds.getSize(new THREE.Vector3()), shelterCenter = shelterBounds.getCenter(new THREE.Vector3());
  const shrubNear = generatedMeshes('lush-shrub', 'near'), shrubFar = generatedMeshes('lush-shrub', 'far');
  for (const shrub of shrubNear) shrub.material.userData.sceneryShadow = false;
  const shrubBounds = meshBounds(shrubNear), shrubSize = shrubBounds.getSize(new THREE.Vector3()), shrubCenter = shrubBounds.getCenter(new THREE.Vector3());
  const pavement = new THREE.MeshStandardMaterial({ color: '#aaa99e', roughness: 1 });
  const edge = new THREE.MeshStandardMaterial({ color: '#d2d1c4', roughness: 0.94 });
  const metal = new THREE.MeshStandardMaterial({ color: '#687671', roughness: 0.65, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: '#364942', roughness: 0.86 });
  const reflector = new THREE.MeshStandardMaterial({ color: '#e2d3a2', roughness: 0.8 });
  const sign = stopSignMaterial(), panel = new THREE.PlaneGeometry(0.55, 0.83);
  const signPole = new THREE.CylinderGeometry(0.035, 0.045, 1, 7);
  const bin = new THREE.CylinderGeometry(0.26, 0.29, 1, 9);
  const bollard = new THREE.CylinderGeometry(0.07, 0.09, 1, 6);
  const shrubTints = ['#ffffff', '#f6f5e9', '#e9efe4'].map(color => new THREE.Color(color));
  const stops = new Set<string>(), shrubDensity = new Map<string, number>();
  const mainIndex = new RoadIndex(roads.filter(road => road.kind === 'main'));
  const p = new THREE.Vector3(), size = new THREE.Vector3();
  let seed = 6419;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 };
  const roadHash = (road: RoadPath) => [...road.id].reduce((value, character) => Math.imul(value, 31) + character.charCodeAt(0) | 0, 17) >>> 0;
  const nearJunction = (road: RoadPath, distance: number, radius: number) => {
    const point = sampleRoad(road, distance).point;
    return road.junctions.some(junction => Math.hypot(junction.point.x - point.x, junction.point.z - point.z, (junction.point.y - point.y) * 4) < radius);
  };
  const level = (road: RoadPath, distance: number, span: number) => [-span, 0, span].every(shift => Math.abs(sampleRoad(road, distance + shift).point.y) < 0.15);
  for (const road of roads) {
    if (road.kind !== 'service') continue;
    for (let distance = Math.min(85 + roadHash(road) % 75, road.length / 2); distance < road.length - 25; distance += 520 + random() * 220) {
      if (!level(road, distance, 10) || nearJunction(road, distance, 45)) continue;
      const center = sampleRoad(road, distance), main = mainIndex.nearest(center.point.x, center.point.z);
      const towardMain = main ? (main.point.x - center.point.x) * center.direction.z - (main.point.z - center.point.z) * center.direction.x : 0;
      const side = towardMain > 0 ? -1 : 1;
      const heading = center.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2), c = Math.cos(heading), s = Math.sin(heading);
      const platformWidth = shelterSize.x + 2.6, platformDepth = shelterSize.z + 2.4;
      for (const setback of [6.4, 8.4]) {
        const at = sampleRoad(road, distance, side * (road.width / 2 + setback));
        const key = `${Math.floor(at.point.x / 450)},${Math.floor(at.point.z / 450)}`;
        if (stops.has(key) || !placement.reserve({ x: at.point.x, z: at.point.z, halfWidth: platformWidth / 2, halfDepth: platformDepth / 2, heading }, 0.8, 2.5)) continue;
        stops.add(key);
        const toWorld = (x: number, z: number) => ({ x: at.point.x + x * c + z * s, z: at.point.z - x * s + z * c });
        const box = (material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
          const point = toWorld(x, z);
          batch.instance(material, p.set(point.x, y, point.z), size.set(w, h, d), heading);
        };
        box(pavement, 0, -0.01, 0, platformWidth, 0.12, platformDepth);
        box(edge, 0, 0.015, platformDepth / 2 - 0.1, platformWidth, 0.17, 0.2);
        for (let x = -platformWidth / 2 + 1.5; x < platformWidth / 2; x += 1.5) box(edge, x, 0.055, 0, 0.018, 0.008, platformDepth - 0.3);
        p.set(at.point.x - (shelterCenter.x * c + shelterCenter.z * s), 0.05 - shelterBounds.min.y, at.point.z - (-shelterCenter.x * s + shelterCenter.z * c));
        size.setScalar(1);
        for (const mesh of shelter) batch.instance(mesh.material, p, size, heading, mesh.geometry);
        const signAt = toWorld(-platformWidth / 2 + 0.55, platformDepth / 2 - 0.7);
        batch.instance(metal, p.set(signAt.x, 1.15, signAt.z), size.set(1, 2.2, 1), heading, signPole);
        batch.instance(sign, p.set(signAt.x + 0.055 * s, 2.05, signAt.z + 0.055 * c), size.set(1, 1, 1), heading, panel);
        const binAt = toWorld(platformWidth / 2 - 0.55, -platformDepth / 2 + 0.65);
        batch.instance(dark, p.set(binAt.x, 0.475, binAt.z), size.set(1, 0.85, 1), heading, bin);
        box(metal, platformWidth / 2 - 0.55, 0.93, -platformDepth / 2 + 0.65, 0.61, 0.06, 0.59);
        for (const edgeSide of [-1, 1]) {
          const post = toWorld(edgeSide * (platformWidth / 2 - 0.35), platformDepth / 2 - 0.25);
          batch.instance(metal, p.set(post.x, 0.38, post.z), size.set(1, 0.66, 1), heading, bollard);
          box(reflector, edgeSide * (platformWidth / 2 - 0.35), 0.62, platformDepth / 2 - 0.25, 0.15, 0.09, 0.15);
        }
        break;
      }
    }
  }
  for (const road of roads) {
    if (road.kind === 'ramp') continue;
    for (let distance = 48 + roadHash(road) % 65; distance < road.length - 22; distance += 72 + random() * 58) for (const side of [-1, 1]) {
      if (!level(road, distance, 8) || nearJunction(road, distance, 26)) continue;
      const count = 2 + Math.floor(random() * 3), outer = road.kind === 'service' && random() < 0.34;
      const setback = outer ? 18 + random() * 10 : 4.6 + random() * 9;
      const spacing = shrubSize.x * (0.72 + random() * 0.25) + 0.3;
      for (let member = 0; member < count; member++) {
        const along = distance + (member - (count - 1) / 2) * spacing;
        if (nearJunction(road, along, 18)) continue;
        const at = sampleRoad(road, along, side * (road.width / 2 + setback + (random() - 0.5) * 0.9));
        const key = `${Math.floor(at.point.x / 240)},${Math.floor(at.point.z / 240)}`;
        if ((shrubDensity.get(key) ?? 0) >= 8) continue;
        const uniform = 0.65 + random() * 0.4, heading = at.heading + member * 2.25 + random() * 0.6;
        if (!placement.reserve({ x: at.point.x, z: at.point.z, halfWidth: shrubSize.x * uniform / 2, halfDepth: shrubSize.z * uniform / 2, heading }, 0.12, 1.7)) continue;
        shrubDensity.set(key, (shrubDensity.get(key) ?? 0) + 1);
        const c = Math.cos(heading), s = Math.sin(heading);
        p.set(at.point.x - (shrubCenter.x * c + shrubCenter.z * s) * uniform, -0.075 - shrubBounds.min.y * uniform, at.point.z - (-shrubCenter.x * s + shrubCenter.z * c) * uniform);
        size.setScalar(uniform);
        const tint = shrubTints[(member + Math.floor(distance / 90)) % shrubTints.length];
        for (let index = 0; index < shrubNear.length; index++) batch.instance(shrubNear[index].material, p, size, heading, shrubNear[index].geometry, tint, 0, shrubFar[index].geometry);
      }
    }
  }
}
