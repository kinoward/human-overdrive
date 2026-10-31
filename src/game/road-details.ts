import * as THREE from 'three';
import type { Point3, RoadPath } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';
import { LoadingBudget } from './loading-budget';
import { roadCrossSection } from './road-cross-section';
import { addRoadSkidMarks } from './road-skid-marks';

function wheelTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 256;
  const context = canvas.getContext('2d')!;
  for (const center of [35, 93]) {
    const gradient = context.createLinearGradient(center - 15, 0, center + 15, 0);
    gradient.addColorStop(0, 'rgba(39, 44, 49, 0)');
    gradient.addColorStop(0.38, 'rgba(39, 44, 49, 0.18)');
    gradient.addColorStop(0.62, 'rgba(39, 44, 49, 0.18)');
    gradient.addColorStop(1, 'rgba(39, 44, 49, 0)');
    context.fillStyle = gradient; context.fillRect(center - 15, 0, 30, 256);
  }
  context.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < 256; y += 9) {
    context.fillStyle = `rgba(0, 0, 0, ${0.04 + (y % 7) * 0.025})`;
    context.fillRect(0, y, 128, 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
  return texture;
}

function chevronTexture(right: boolean) {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 96;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#e3dfc9'; context.fillRect(0, 0, 128, 96);
  context.strokeStyle = '#354248'; context.lineWidth = 3; context.strokeRect(3, 3, 122, 90);
  context.fillStyle = '#39454a';
  context.beginPath();
  const direction = right ? 1 : -1, center = 64;
  context.moveTo(center - direction * 35, 12); context.lineTo(center + direction * 2, 12);
  context.lineTo(center + direction * 39, 48); context.lineTo(center + direction * 2, 84);
  context.lineTo(center - direction * 35, 84); context.lineTo(center + direction * 2, 48);
  context.closePath(); context.fill();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function arrowGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.14, 0, -2, 0.14, 0, -2, -0.14, 0, 0.35, 0.14, 0, 0.35,
    -0.67, 0, 0.35, 0.67, 0, 0.35, 0, 0, 2.1
  ], 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3, 4, 6, 5]); geometry.computeVertexNormals();
  return geometry;
}

export async function addRoadDetails(roads: RoadPath[], batch: SceneryBatch) {
  const budget = new LoadingBudget();
  const index = new RoadIndex(roads);
  const wear = new THREE.MeshStandardMaterial({ map: wheelTexture(), transparent: true, opacity: 0.42, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const paint = new THREE.MeshStandardMaterial({ color: '#dddccd', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 });
  const joint = new THREE.MeshStandardMaterial({ color: '#353d40', transparent: true, opacity: 0.18, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  for (const material of [wear, paint, joint]) material.userData.roadDecal = true;
  const edging = new THREE.MeshStandardMaterial({ color: '#7d817b', roughness: 1 });
  const curb = new THREE.MeshStandardMaterial({ color: '#b6b8b0', roughness: 0.98 });
  const metal = new THREE.MeshStandardMaterial({ color: '#929e9c', metalness: 0.55, roughness: 0.62 });
  const post = new THREE.MeshStandardMaterial({ color: '#d4d6ca', roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: '#394348', roughness: 0.9 });
  const amber = new THREE.MeshStandardMaterial({ color: '#dbc67d', roughness: 0.6 });
  const screenBase = new THREE.MeshStandardMaterial({ color: '#718c84', roughness: 0.82, metalness: 0.12 });
  const screenTop = new THREE.MeshStandardMaterial({ color: '#afc1be', roughness: 0.45, metalness: 0.14 });
  const chevrons = [false, true].map(right => new THREE.MeshStandardMaterial({ map: chevronTexture(right), roughness: 0.82 }));
  const arrow = arrowGeometry(), board = new THREE.PlaneGeometry(0.94, 0.7);
  const p = new THREE.Vector3(), scale = new THREE.Vector3();
  const surfaces = new Map<string, { material: THREE.Material; positions: number[]; uvs: number[]; indices: number[]; x: number; z: number }>();
  const ribbon = (material: THREE.Material, road: RoadPath, from: number, to: number, width: number, offset: number, elevation: number, repeat = 1) => {
    const a = sampleRoad(road, from), b = sampleRoad(road, to);
    const key = `${material.id}:${Math.floor(a.point.x / 500)},${Math.floor(a.point.z / 500)}`;
    let surface = surfaces.get(key);
    if (!surface) {
      surface = { material, positions: [], uvs: [], indices: [], x: a.point.x, z: a.point.z };
      surfaces.set(key, surface);
    }
    const start = surface.positions.length / 3;
    for (const sample of [a, b]) for (const side of [-1, 1]) {
      const distance = offset + side * width / 2;
      surface.positions.push(sample.point.x + sample.direction.z * distance, sample.point.y + elevation, sample.point.z - sample.direction.x * distance);
    }
    surface.uvs.push(0, from / 12, repeat, from / 12, 0, to / 12, repeat, to / 12);
    surface.indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
  };
  const box = (material: THREE.Material, point: Point3, width: number, height: number, length: number, heading: number, elevation: number, pitch = 0) => {
    batch.instance(material, p.set(point.x, point.y + elevation, point.z), scale.set(width, height, length), heading, batch.box, undefined, pitch);
  };
  const clear = (road: RoadPath, distance: number, offset: number, halfLength: number, margin: number) => {
    return [-halfLength, 0, halfLength].every(shift => !index.covers(sampleRoad(road, distance + shift, offset).point, road, margin));
  };
  const nearJunction = (road: RoadPath, point: Point3, radius: number) => road.junctions.some(junction => Math.hypot(junction.point.x - point.x, junction.point.z - point.z, (junction.point.y - point.y) * 4) < radius);
  for (const road of roads) {
    if (budget.exhausted) await budget.yield();
    const section = roadCrossSection(road), laneWidth = section.laneWidth;
    for (let distance = 0; distance < road.length; distance += 18) {
      if (budget.exhausted) await budget.yield();
      const end = Math.min(distance + 18, road.length), middle = (distance + end) / 2;
      const sample = sampleRoad(road, middle);
      if (index.covers(sample.point, road, 0.1)) continue;
      ribbon(wear, road, distance, end, section.travelWidth - 0.5, section.travelOffset, 0.042, road.lanes);
      for (const side of [-1, 1]) {
        if (!clear(road, middle, side * (road.width / 2 + 0.12), (end - distance) / 2, 0.2)) continue;
        ribbon(edging, road, distance, end, 0.16, side * (road.width / 2 - 0.04), 0.041);
      }
    }
    if (road.oneWay && road.width > 3) for (let distance = 75; distance < road.length - 40; distance += road.kind === 'main' ? 240 : 180) {
      const middle = sampleRoad(road, distance);
      if (nearJunction(road, middle.point, 45) || index.covers(middle.point, road, 0)) continue;
      for (let lane = 0; lane < road.lanes; lane++) {
        const sample = sampleRoad(road, distance, section.laneOffset(lane));
        const width = Math.min(1, laneWidth / 3.2);
        batch.instance(paint, p.set(sample.point.x, sample.point.y + 0.057, sample.point.z), scale.set(width, 1, 1), sample.heading, arrow, undefined, -Math.atan(sample.direction.y));
      }
    }
    for (let distance = 18; distance < road.length - 8; distance += 12) {
      if (budget.exhausted) await budget.yield();
      const center = sampleRoad(road, distance), pitch = -Math.atan(center.direction.y);
      if (nearJunction(road, center.point, 18)) continue;
      for (const side of [-1, 1]) {
        const offset = side * (road.width / 2 + 1.04);
        if (!clear(road, distance, offset, 5.7, 0.5)) continue;
        const sample = sampleRoad(road, distance, offset);
        if (road.kind === 'service' && Math.abs(sample.point.y) < 0.12) {
          box(curb, sample.point, 0.28, 0.18, 11.75, sample.heading, 0.09, pitch);
        } else if (sample.point.y > 1.5) {
          box(metal, sample.point, 0.12, 0.1, 11.85, sample.heading, 1.13, pitch);
        }
      }
      if (center.point.y > 1.5 && distance % 36 === 18 && !index.covers(center.point, road, 0.2)) ribbon(joint, road, distance, distance + 0.07, road.width - 0.4, 0, 0.044);
    }
    for (let distance = 32; distance < road.length - 12; distance += road.kind === 'ramp' ? 32 : 96) {
      const center = sampleRoad(road, distance);
      if (nearJunction(road, center.point, 24)) continue;
      for (const side of [-1, 1]) {
        const offset = side * (road.width / 2 + 1.13);
        if (!clear(road, distance, offset, 0.5, 0.45)) continue;
        const sample = sampleRoad(road, distance, offset);
        box(post, sample.point, 0.1, 1.18, 0.15, sample.heading, 0.59);
        box(dark, sample.point, 0.12, 0.28, 0.17, sample.heading, 0.88);
        box(side > 0 ? amber : post, sample.point, 0.08, 0.13, 0.19, sample.heading, 0.9);
      }
      if (road.kind !== 'ramp') continue;
      const before = sampleRoad(road, distance - 12), after = sampleRoad(road, distance + 12);
      const turn = Math.atan2(Math.sin(after.heading - before.heading), Math.cos(after.heading - before.heading));
      if (Math.abs(turn) < 0.065) continue;
      const offset = -Math.sign(turn) * (road.width / 2 + 1.3);
      if (!clear(road, distance, offset, 1, 0.6)) continue;
      const sample = sampleRoad(road, distance, offset);
      box(metal, sample.point, 0.1, 1.5, 0.1, sample.heading, 0.75);
      batch.instance(chevrons[turn > 0 ? 0 : 1], p.set(sample.point.x, sample.point.y + 1.53, sample.point.z), scale.set(1, 1, 1), sample.heading + Math.PI, board);
    }
    if (road.kind !== 'main') continue;
    const roadSeed = [...road.id].reduce((value, character) => value + character.charCodeAt(0), 0);
    for (let distance = 24; distance < road.length - 24; distance += 8) {
      if (budget.exhausted) await budget.yield();
      if ((roadSeed + Math.floor(distance / 320)) % 5 !== 0 || distance % 320 > 152) continue;
      const offset = road.width / 2 + 1.65;
      const sample = sampleRoad(road, distance, offset);
      if (Math.abs(sample.point.y) > 0.15 || nearJunction(road, sample.point, 45) || !clear(road, distance, offset, 4.1, 0.65)) continue;
      const pitch = -Math.atan(sample.direction.y);
      box(screenBase, sample.point, 0.16, 1.24, 7.9, sample.heading, 0.62, pitch);
      box(screenTop, sample.point, 0.12, 1.35, 7.9, sample.heading, 1.92, pitch);
      box(metal, sample.point, 0.2, 0.08, 8, sample.heading, 2.62, pitch);
      const upright = sampleRoad(road, distance - 4, offset);
      box(metal, upright.point, 0.18, 2.65, 0.16, sample.heading, 1.325);
    }
  }
  addRoadSkidMarks(roads, batch, index);
  for (const surface of surfaces.values()) {
    if (budget.exhausted) await budget.yield();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(surface.uvs, 2));
    geometry.setIndex(surface.indices); geometry.computeVertexNormals();
    batch.surface(surface.material, geometry, surface.x, surface.z);
  }
}
