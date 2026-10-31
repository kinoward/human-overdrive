import * as THREE from 'three';
import type { Point3, RoadPath } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';
import { generatedMeshes } from './generated-assets';
import { addLandscapeScenery, type LandscapePlot } from './landscape-scenery';
import { meshBounds, SceneryPlacement } from './scenery-placement';
import { LoadingBudget } from './loading-budget';

export interface PlacedCityBuilding {
  type: 'residential-block' | 'brick-apartment' | 'office-block';
  bounds: THREE.Box3;
  position: Point3;
  heading: number;
  baseHeading: number;
  uniform: number;
}

export async function addCityScenery(roads: RoadPath[], batch: SceneryBatch, frontageOccupied?: (x: number, z: number, radius: number) => boolean, beforeLandscape?: (placement: SceneryPlacement) => Promise<void>) {
  const budget = new LoadingBudget();
  const placement = new SceneryPlacement(roads, frontageOccupied), blocks = new Set<string>(), backgroundBlocks = new Set<string>();
  const mainRoads = new RoadIndex(roads.filter(road => road.kind === 'main'));
  const foundation = new THREE.MeshStandardMaterial({ color: '#9b9d91', roughness: 1 });
  const path = new THREE.MeshStandardMaterial({ color: '#b4b2a3', roughness: 0.96 });
  const variants = (['residential-block', 'brick-apartment', 'office-block'] as const).map(name => {
    const meshes = generatedMeshes(name);
    for (const mesh of meshes) mesh.material.userData.airObstacle = true;
    return { type: name, meshes, bounds: meshBounds(meshes), faceRotation: name === 'residential-block' ? Math.PI : 0 };
  });
  const palette = ['#ffffff', '#f2f2eb', '#f4efe8'].map(color => new THREE.Color(color));
  const p = new THREE.Vector3(), size = new THREE.Vector3();
  const gardenSites: Point3[] = [], buildingCenters: Point3[] = [], parks: LandscapePlot[] = [], buildings: PlacedCityBuilding[] = [];
  let seed = 621;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 };
  const placeBuilding = (variantIndex: number, at: Point3, baseHeading: number, uniform: number) => {
    const variant = variants[variantIndex], heading = baseHeading + variant.faceRotation, c = Math.cos(baseHeading), s = Math.sin(baseHeading);
    const width = variant.bounds.max.x - variant.bounds.min.x, depth = variant.bounds.max.z - variant.bounds.min.z;
    const footprint = { x: at.x + s * 1.9, z: at.z + c * 1.9, halfWidth: width * uniform / 2 + 1.25, halfDepth: depth * uniform / 2 + 2.9, heading: baseHeading };
    if (!placement.reserve(footprint, 1, 3)) return false;
    const localCenter = variant.bounds.getCenter(new THREE.Vector3()), modelCos = Math.cos(heading), modelSin = Math.sin(heading);
    p.set(at.x - (localCenter.x * modelCos + localCenter.z * modelSin) * uniform, 0.05 - variant.bounds.min.y * uniform, at.z - (-localCenter.x * modelSin + localCenter.z * modelCos) * uniform);
    size.setScalar(uniform);
    const tint = palette[Math.floor(random() * palette.length)];
    for (const mesh of variant.meshes) batch.instance(mesh.material, p, size, heading, mesh.geometry, tint);
    buildings.push({ type: variant.type, bounds: variant.bounds, position: { x: p.x, y: p.y, z: p.z }, heading, baseHeading, uniform });
    buildingCenters.push({ x: at.x, y: 0, z: at.z });
    batch.instance(foundation, p.set(at.x, -0.01, at.z), size.set(width * uniform + 1.2, 0.12, depth * uniform + 1), baseHeading);
    const entrance = depth * uniform / 2 + 2.5;
    batch.instance(path, p.set(at.x + s * entrance, 0, at.z + c * entrance), size.set(1.65, 0.06, 4.1), baseHeading);
    for (const flank of [-1, 1]) gardenSites.push({ x: at.x + c * flank * (width * uniform / 2 + 6.5) + s * depth * uniform * 0.1, y: 0, z: at.z - s * flank * (width * uniform / 2 + 6.5) + c * depth * uniform * 0.1 });
    gardenSites.push({ x: at.x - s * (depth * uniform / 2 + 7.5), y: 0, z: at.z - c * (depth * uniform / 2 + 7.5) });
    return true;
  };
  for (const road of roads) {
    if (road.kind === 'ramp') continue;
    for (let along = 60 + random() * 42; along < road.length - 32; along += 130 + random() * 80) for (const side of [-1, 1]) {
      if (budget.exhausted) await budget.yield();
      const setback = (road.kind === 'service' ? 34 : 39) + random() * 24;
      const center = sampleRoad(road, along, side * (road.width / 2 + setback));
      if (center.point.y < -0.15) continue;
      const blockKey = `${Math.floor(center.point.x / 105)},${Math.floor(center.point.z / 105)}`;
      if (blocks.has(blockKey)) continue;
      const district = (Math.imul(Math.floor(center.point.x / 280), 73856093) ^ Math.imul(Math.floor(center.point.z / 280), 19349663)) >>> 0;
      if (district % 10 === 0) {
        parks.push({ x: center.point.x, z: center.point.z, heading: center.heading, width: 35, depth: 64 });
        blocks.add(blockKey);
        continue;
      }
      const composition = district % 4, count = composition === 2 ? 3 : 2;
      let placed = false;
      for (let member = 0; member < count; member++) {
        const at = sampleRoad(road, along + (member - (count - 1) / 2) * 39, side * (road.width / 2 + setback + (composition === 2 && member === 1 ? 28 : random() * 7)));
        const near = placement.roadIndex.nearest(at.point.x, at.point.z);
        if (!near) continue;
        const variant = district % 11 === 3 && member === 0 ? 2 : (district + member) % 3 === 0 ? 0 : 1;
        const uniform = [0.95, 1, 1.04][Math.floor(random() * 3)];
        const baseHeading = Math.atan2(near.direction.x, near.direction.z) + (near.offset > 0 ? -Math.PI / 2 : Math.PI / 2) + (composition === 2 && member === 1 ? Math.PI / 2 : (random() - 0.5) * 0.06);
        if (placeBuilding(variant, at.point, baseHeading, uniform)) placed = true;
      }
      if (placed) blocks.add(blockKey);
      else parks.push({ x: center.point.x, z: center.point.z, heading: center.heading, width: 27, depth: 42 });
    }
  }
  for (const road of roads) {
    if (road.kind !== 'service') continue;
    for (let along = 140 + random() * 60; along < road.length - 60; along += 260 + random() * 140) {
      if (budget.exhausted) await budget.yield();
      const roadCenter = sampleRoad(road, along), main = mainRoads.nearest(roadCenter.point.x, roadCenter.point.z);
      if (Math.abs(roadCenter.point.y) > 0.15 || !main) continue;
      if ([-48, 48].some(shift => Math.abs(sampleRoad(road, along + shift).point.y) > 0.15)) continue;
      const towardMain = (main.point.x - roadCenter.point.x) * roadCenter.direction.z - (main.point.z - roadCenter.point.z) * roadCenter.direction.x;
      const side = towardMain > 0 ? -1 : 1, setback = 118 + random() * 38;
      const center = sampleRoad(road, along, side * (road.width / 2 + setback));
      const front = sampleRoad(road, along, side * (road.width / 2 + 45)).point;
      const key = `${Math.floor(center.point.x / 170)},${Math.floor(center.point.z / 170)}`;
      if (backgroundBlocks.has(key) || parks.some(park => Math.hypot(park.x - front.x, park.z - front.z) < 60)) continue;
      if (buildingCenters.filter(building => Math.hypot(building.x - center.point.x, building.z - center.point.z) < 135).length >= 4) continue;
      const shops = [-45, 0, 45].filter(shift => {
        const point = sampleRoad(road, along + shift, side * (road.width / 2 + 23)).point;
        return frontageOccupied?.(point.x, point.z, 4.5);
      });
      if (shops.length >= 2) continue;
      const district = (Math.imul(Math.floor(center.point.x / 330), 73856093) ^ Math.imul(Math.floor(center.point.z / 330), 19349663)) >>> 0;
      const count = 2 + district % 2;
      let placed = false;
      for (let member = 0; member < count; member++) {
        const at = sampleRoad(road, along + (member - (count - 1) / 2) * 40, side * (road.width / 2 + setback + (count === 3 && member === 1 ? 10 : random() * 7)));
        const heading = at.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (member === 2 && district % 3 === 0 ? Math.PI / 2 : (random() - 0.5) * 0.06);
        const variant = district % 13 === 3 && member === 1 ? 2 : (district + member) % 3 === 0 ? 0 : 1;
        if (placeBuilding(variant, at.point, heading, [0.95, 1, 1.04][Math.floor(random() * 3)])) placed = true;
      }
      if (placed) backgroundBlocks.add(key);
    }
  }
  await beforeLandscape?.(placement);
  await addLandscapeScenery(roads, batch, placement, gardenSites, parks);
  return { buildings, placement };
}
