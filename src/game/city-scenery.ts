import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { RoadPath } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';
import { generatedMeshes } from './generated-assets';

export function addCityScenery(roads: RoadPath[], batch: SceneryBatch, frontageOccupied?: (x: number, z: number, radius: number) => boolean) {
  const index = new RoadIndex(roads), occupied = new Set<string>();
  const trim = new THREE.MeshStandardMaterial({ color: '#e1d8c4', roughness: 0.8 });
  const foliage = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  const planter = new RoundedBoxGeometry(3.2, 0.45, 1.6, 2, 0.16);
  const shrub = new THREE.IcosahedronGeometry(1, 2);
  const buildings = generatedMeshes('residential-block');
  const trees = generatedMeshes('roadside-tree', 'near');
  const distantTrees = generatedMeshes('roadside-tree', 'far');
  const p = new THREE.Vector3(), size = new THREE.Vector3();
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
      p.set(sample.point.x, 0, sample.point.z); size.set(0.85 + random() * 0.4, 0.85 + random() * 0.45, 0.85 + random() * 0.35);
      const heading = Math.atan2(near.direction.x, near.direction.z) + Math.sign(near.offset) * Math.PI / 2;
      for (const building of buildings) batch.instance(building.material, p, size, heading, building.geometry);

    }
    for (let along = 18; along < road.length; along += 26) for (const side of [-1, 1]) {
      const sample = sampleRoad(road, along, side * (road.width / 2 + 5.5));
      const near = index.nearest(sample.point.x, sample.point.z);
      if (!near || Math.abs(near.offset) < near.road.width / 2 + 3 || Math.abs(sample.point.y) > 0.2) continue;
      const key = `tree:${Math.floor(sample.point.x / 11)},${Math.floor(sample.point.z / 11)}`;
      if (occupied.has(key) || frontageOccupied?.(sample.point.x, sample.point.z, 4)) continue;
      occupied.add(key);
      p.set(sample.point.x, 0, sample.point.z); const scale = 0.85 + random() * 0.3; size.set(scale, scale, scale);
      for (let i = 0; i < trees.length; i++) batch.instance(trees[i].material, p, size, sample.heading + random() * 6, trees[i].geometry, undefined, 0, distantTrees[i].geometry);
      const at = sampleRoad(road, along + 10, side * (road.width / 2 + 3)).point;
      if (index.covers(at, undefined, 1.2) || frontageOccupied?.(at.x, at.z, 2)) continue;
      batch.instance(trim, p.set(at.x, 0.22, at.z), size.set(1, 1, 1), sample.heading, planter);
      for (const shift of [-0.8, 0, 0.8]) batch.instance(foliage, p.set(at.x + Math.cos(sample.heading) * shift, 0.72, at.z - Math.sin(sample.heading) * shift), size.set(0.7, 0.5, 0.65), sample.heading, shrub, new THREE.Color('#5b7e67'));
    }
  }
}
