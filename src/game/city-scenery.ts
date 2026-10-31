import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoadPath } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';

function buildingGeometry(floors: number) {
  const height = floors * 3.2;
  const walls: THREE.BufferGeometry[] = [new RoundedBoxGeometry(28, height, 18, 2, 0.3).translate(0, height / 2, 0)];
  const trim: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const part = (target: THREE.BufferGeometry[], width: number, h: number, depth: number, x: number, y: number, z: number) => target.push(new THREE.BoxGeometry(width, h, depth).translate(x, y, z));
  part(trim, 29, 0.45, 19, 0, height + 0.05, 0);
  part(walls, 8, 2.6, 6, 6, height + 1.3, 2);
  part(trim, 8.4, 0.22, 6.4, 6, height + 2.65, 2);
  part(trim, 29, 0.4, 19, 0, 0.2, 0);
  for (let floor = 0; floor < floors; floor++) {
    const y = floor * 3.2 + 1.65;
    if (floor % 3 === 0) part(trim, 28.35, 0.15, 18.35, 0, floor * 3.2 + 0.1, 0);
    for (let bay = -5; bay <= 5; bay++) for (const side of [-1, 1]) {
      part(trim, 1.75, 1.9, 0.24, bay * 2.35, y, side * 9.07);
      part(glass, 1.45, 1.6, 0.08, bay * 2.35, y, side * 9.21);
      part(trim, 0.075, 1.6, 0.12, bay * 2.35, y, side * 9.26);
      if (bay % 4 === 0 && floor > 0) {
        part(trim, 1.9, 0.16, 1, bay * 2.35, y - 1, side * 9.45);
        part(trim, 1.9, 0.13, 0.12, bay * 2.35, y - 0.35, side * 9.9);
        part(trim, 0.1, 0.65, 0.12, bay * 2.35 - 0.85, y - 0.67, side * 9.9);
        part(trim, 0.1, 0.65, 0.12, bay * 2.35 + 0.85, y - 0.67, side * 9.9);
      }
    }
    for (let bay = -3; bay <= 3; bay++) for (const side of [-1, 1]) {
      part(trim, 0.24, 1.9, 1.75, side * 14.07, y, bay * 2.35);
      part(glass, 0.08, 1.6, 1.45, side * 14.21, y, bay * 2.35);
    }
  }
  for (const side of [-1, 1]) {
    part(trim, 0.4, height, 0.4, side * 13.6, height / 2, -8.6);
    part(trim, 0.4, height, 0.4, side * 13.6, height / 2, 8.6);
  }
  const merge = (parts: THREE.BufferGeometry[]) => { const normalized = parts.map(part => part.index ? part.toNonIndexed() : part); const result = mergeGeometries(normalized)!; new Set([...parts, ...normalized]).forEach(part => part.dispose()); return result };
  return { walls: merge(walls), trim: merge(trim), glass: merge(glass) };
}

function treeGeometry() {
  const branches: THREE.BufferGeometry[] = [];
  const crown: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const [x, y, z] of [[0, 5.5, 0], [-1.5, 7, 0.3], [1.7, 7.4, 0.4], [0.1, 7.2, -1.6]]) {
    const start = new THREE.Vector3(0, x ? 3.7 : 0, 0), end = new THREE.Vector3(x, y, z);
    const direction = end.clone().sub(start);
    const branch = new THREE.CylinderGeometry(0.12, x ? 0.24 : 0.38, direction.length(), 7);
    branch.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize())); branch.translate(...start.add(end).multiplyScalar(0.5).toArray()); branches.push(branch);
  }
  for (const [x, y, z, radius] of [[0, 8.2, 0, 2.4], [-1.7, 7, 0.2, 1.9], [1.8, 7.2, 0.3, 2], [0.1, 7, -1.7, 1.8], [-0.5, 9, 0.5, 1.65]]) {
    crown.push(new THREE.IcosahedronGeometry(radius, 2).scale(1, 0.9, 1).translate(x, y, z));
  }
  const result = { trunk: mergeGeometries(branches)!, crown: mergeGeometries(crown)! };
  [...branches, ...crown].forEach(part => part.dispose()); return result;
}

export function addCityScenery(roads: RoadPath[], batch: SceneryBatch, frontageOccupied?: (x: number, z: number, radius: number) => boolean) {
  const index = new RoadIndex(roads), occupied = new Set<string>();
  const walls = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88 });
  const trim = new THREE.MeshStandardMaterial({ color: '#e1d8c4', roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: '#4d7885', metalness: 0.3, roughness: 0.35 });
  const trunk = new THREE.MeshStandardMaterial({ color: '#6f5643', roughness: 1 });
  const foliage = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  const planter = new RoundedBoxGeometry(3.2, 0.45, 1.6, 2, 0.16);
  const shrub = new THREE.IcosahedronGeometry(1, 2);
  const tree = treeGeometry();
  const buildings = [4, 7, 11, 15].map(buildingGeometry);
  const p = new THREE.Vector3(), size = new THREE.Vector3();
  const palette = ['#c9b398', '#d1c4ae', '#b3bfc1', '#bb8a72', '#d8cfae'];
  let seed = 621;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 };
  for (const road of roads) {
    if (road.kind === 'ramp') continue;
    for (let along = 45; along < road.length; along += 88) for (const side of [-1, 1]) {
      const sample = sampleRoad(road, along, side * (road.width / 2 + 68 + random() * 75));
      const key = `${Math.floor(sample.point.x / 54)},${Math.floor(sample.point.z / 54)}`;
      if (occupied.has(key) || frontageOccupied?.(sample.point.x, sample.point.z, 24)) continue;
      const near = index.nearest(sample.point.x, sample.point.z);
      if (!near || Math.abs(near.offset) < near.road.width / 2 + 33) continue;
      occupied.add(key);
      const building = buildings[Math.floor(random() * buildings.length)];
      p.set(sample.point.x, 0, sample.point.z); size.set(0.85 + random() * 0.5, 1, 0.9 + random() * 0.5);
      batch.instance(walls, p, size, sample.heading, building.walls, new THREE.Color(palette[Math.floor(random() * palette.length)]));
      batch.instance(trim, p, size, sample.heading, building.trim);
      batch.instance(glass, p, size, sample.heading, building.glass);
    }
    for (let along = 18; along < road.length; along += 26) for (const side of [-1, 1]) {
      const sample = sampleRoad(road, along, side * (road.width / 2 + 5.5));
      const near = index.nearest(sample.point.x, sample.point.z);
      if (!near || Math.abs(near.offset) < near.road.width / 2 + 3 || Math.abs(sample.point.y) > 0.2) continue;
      const key = `tree:${Math.floor(sample.point.x / 11)},${Math.floor(sample.point.z / 11)}`;
      if (occupied.has(key) || frontageOccupied?.(sample.point.x, sample.point.z, 4)) continue;
      occupied.add(key);
      const color = new THREE.Color(['#64836b', '#719b7b', '#94a96f', '#c3a96c'][Math.floor(random() * 4)]);
      p.set(sample.point.x, 0, sample.point.z); const scale = 0.8 + random() * 0.3; size.set(scale, scale, scale);
      batch.instance(trunk, p, size, sample.heading, tree.trunk);
      batch.instance(foliage, p, size, sample.heading, tree.crown, color);
      const at = sampleRoad(road, along + 10, side * (road.width / 2 + 3)).point;
      if (index.covers(at, undefined, 1.2) || frontageOccupied?.(at.x, at.z, 2)) continue;
      batch.instance(trim, p.set(at.x, 0.22, at.z), size.set(1, 1, 1), sample.heading, planter);
      for (const shift of [-0.8, 0, 0.8]) batch.instance(foliage, p.set(at.x + Math.cos(sample.heading) * shift, 0.72, at.z - Math.sin(sample.heading) * shift), size.set(0.7, 0.5, 0.65), sample.heading, shrub, new THREE.Color('#5b7e67'));
    }
  }
}
