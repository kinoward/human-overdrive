import * as THREE from 'three';
import type { Point3, RoadPath } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';
import { generatedMeshes } from './generated-assets';
import { addLandscapeScenery, meshBounds, type SceneryFootprint } from './landscape-scenery';

export function addCityScenery(roads: RoadPath[], batch: SceneryBatch, frontageOccupied?: (x: number, z: number, radius: number) => boolean) {
  const index = new RoadIndex(roads);
  const occupied = new Map<string, SceneryFootprint[]>(), blocks = new Set<string>();
  const foundation = new THREE.MeshStandardMaterial({ color: '#9b9d91', roughness: 1 });
  const path = new THREE.MeshStandardMaterial({ color: '#b4b2a3', roughness: 0.96 });
  const variants = (['residential-block', 'brick-apartment', 'office-block'] as const).map(name => {
    const meshes = generatedMeshes(name);
    for (const mesh of meshes) mesh.material.userData.airObstacle = true;
    return { meshes, bounds: meshBounds(meshes), faceRotation: name === 'residential-block' ? Math.PI : 0 };
  });
  const palette = ['#ffffff', '#f2f2eb', '#f4efe8'].map(color => new THREE.Color(color));
  const p = new THREE.Vector3(), size = new THREE.Vector3();
  const gardenSites: Point3[] = [];
  let seed = 621;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 };
  const keys = (plot: SceneryFootprint) => {
    const c = Math.abs(Math.cos(plot.heading)), s = Math.abs(Math.sin(plot.heading));
    const x = c * plot.halfWidth + s * plot.halfDepth, z = s * plot.halfWidth + c * plot.halfDepth;
    const result: string[] = [];
    for (let cellX = Math.floor((plot.x - x) / 32); cellX <= Math.floor((plot.x + x) / 32); cellX++) {
      for (let cellZ = Math.floor((plot.z - z) / 32); cellZ <= Math.floor((plot.z + z) / 32); cellZ++) result.push(`${cellX},${cellZ}`);
    }
    return result;
  };
  const overlaps = (a: SceneryFootprint, b: SceneryFootprint) => {
    const ac = Math.cos(a.heading), as = Math.sin(a.heading), bc = Math.cos(b.heading), bs = Math.sin(b.heading);
    for (const [x, z] of [[ac, -as], [as, ac], [bc, -bs], [bs, bc]]) {
      const distance = Math.abs((b.x - a.x) * x + (b.z - a.z) * z);
      const ar = a.halfWidth * Math.abs(ac * x - as * z) + a.halfDepth * Math.abs(as * x + ac * z);
      const br = b.halfWidth * Math.abs(bc * x - bs * z) + b.halfDepth * Math.abs(bs * x + bc * z);
      if (distance >= ar + br) return false;
    }
    return true;
  };
  const reserve = (footprint: SceneryFootprint, gap: number, roadClearance: number) => {
    const plot = { ...footprint, halfWidth: footprint.halfWidth + gap, halfDepth: footprint.halfDepth + gap };
    const cells = keys(plot), candidates = new Set<SceneryFootprint>();
    for (const key of cells) for (const other of occupied.get(key) ?? []) candidates.add(other);
    if ([...candidates].some(other => overlaps(plot, other))) return false;
    const c = Math.cos(footprint.heading), s = Math.sin(footprint.heading);
    const columns = Math.ceil(footprint.halfWidth * 2 / 4), rows = Math.ceil(footprint.halfDepth * 2 / 4);
    for (let ix = 0; ix <= columns; ix++) for (let iz = 0; iz <= rows; iz++) {
      const localX = footprint.halfWidth * (ix * 2 / columns - 1), localZ = footprint.halfDepth * (iz * 2 / rows - 1);
      const x = footprint.x + localX * c + localZ * s, z = footprint.z - localX * s + localZ * c;
      if (frontageOccupied?.(x, z, 2.1)) return false;
      const near = index.nearest(x, z);
      if (!near || Math.abs(near.offset) < near.road.width / 2 + roadClearance || index.covers({ x, y: near.point.y, z }, undefined, roadClearance)) return false;
    }
    for (const key of cells) {
      if (!occupied.has(key)) occupied.set(key, []);
      occupied.get(key)!.push(plot);
    }
    return true;
  };
  for (const road of roads) {
    if (road.kind === 'ramp') continue;
    for (let along = 78 + random() * 65; along < road.length - 35; along += 210 + random() * 130) for (const side of [-1, 1]) {
      const setback = 50 + random() * 43;
      const center = sampleRoad(road, along, side * (road.width / 2 + setback));
      if (center.point.y < -0.15) continue;
      const blockKey = `${Math.floor(center.point.x / 160)},${Math.floor(center.point.z / 160)}`;
      if (blocks.has(blockKey)) continue;
      const district = (Math.imul(Math.floor(center.point.x / 360), 73856093) ^ Math.imul(Math.floor(center.point.z / 360), 19349663)) >>> 0;
      if (district % 9 === 0 || district % 9 === 5) continue;
      const composition = district % 4, count = composition === 2 ? 3 : 2;
      let placed = false;
      for (let member = 0; member < count; member++) {
        const at = sampleRoad(road, along + (member - (count - 1) / 2) * 45, side * (road.width / 2 + setback + (composition === 2 && member === 1 ? 38 : random() * 12)));
        const near = index.nearest(at.point.x, at.point.z);
        if (!near) continue;
        const isOffice = district % 11 === 3 && member === 0;
        const variant = variants[isOffice ? 2 : (district + member) % 3 === 0 ? 0 : 1];
        const uniform = [0.95, 1, 1.04][Math.floor(random() * 3)];
        const baseHeading = Math.atan2(near.direction.x, near.direction.z) + (near.offset > 0 ? -Math.PI / 2 : Math.PI / 2) + (composition === 2 && member === 1 ? Math.PI / 2 : (random() - 0.5) * 0.06);
        const heading = baseHeading + variant.faceRotation;
        const width = variant.bounds.max.x - variant.bounds.min.x, depth = variant.bounds.max.z - variant.bounds.min.z;
        const footprint = { x: at.point.x, z: at.point.z, halfWidth: width * uniform / 2 + 2, halfDepth: depth * uniform / 2 + 5, heading: baseHeading };
        if (!reserve(footprint, 3, 5)) continue;
        placed = true;
        const localCenter = variant.bounds.getCenter(new THREE.Vector3()), c = Math.cos(baseHeading), s = Math.sin(baseHeading);
        const modelCos = Math.cos(heading), modelSin = Math.sin(heading);
        p.set(at.point.x - (localCenter.x * modelCos + localCenter.z * modelSin) * uniform, 0.05 - variant.bounds.min.y * uniform, at.point.z - (-localCenter.x * modelSin + localCenter.z * modelCos) * uniform);
        size.setScalar(uniform);
        const tint = palette[Math.floor(random() * palette.length)];
        for (const mesh of variant.meshes) batch.instance(mesh.material, p, size, heading, mesh.geometry, tint);
        batch.instance(foundation, p.set(at.point.x, -0.01, at.point.z), size.set(width * uniform + 1.2, 0.12, depth * uniform + 1), baseHeading);
        const entrance = depth * uniform / 2 + 2.5;
        batch.instance(path, p.set(at.point.x + s * entrance, 0, at.point.z + c * entrance), size.set(1.65, 0.06, 4.1), baseHeading);
        for (const flank of [-1, 1]) gardenSites.push({ x: at.point.x + c * flank * (width * uniform / 2 + 8.6) + s * depth * uniform * 0.25, y: 0, z: at.point.z - s * flank * (width * uniform / 2 + 8.6) + c * depth * uniform * 0.25 });
      }
      if (placed) blocks.add(blockKey);
    }
  }
  addLandscapeScenery(roads, batch, index, reserve, gardenSites);
}
