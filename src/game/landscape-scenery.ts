import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Point3, RoadPath } from '../types';
import { generatedMeshes } from './generated-assets';
import { RoadIndex, sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';

export interface SceneryFootprint { x: number; z: number; halfWidth: number; halfDepth: number; heading: number }
type ReserveFootprint = (footprint: SceneryFootprint, gap: number, roadClearance: number) => boolean;

export function meshBounds(meshes: { geometry: THREE.BufferGeometry }[]) {
  const bounds = new THREE.Box3();
  for (const mesh of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    bounds.union(mesh.geometry.boundingBox!);
  }
  return bounds;
}

export function addLandscapeScenery(roads: RoadPath[], batch: SceneryBatch, index: RoadIndex, reserve: ReserveFootprint, gardenSites: Point3[]) {
  const variants = (['roadside-tree', 'slender-tree'] as const).map(name => {
    const near = generatedMeshes(name, 'near');
    const far = generatedMeshes(name, 'far');
    const bounds = meshBounds(near);
    return { near, far, bounds, center: bounds.getCenter(new THREE.Vector3()) };
  });
  const foliage = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  const hedge = new RoundedBoxGeometry(1, 1, 1, 2, 0.2);
  const groundcover = new THREE.IcosahedronGeometry(1, 1);
  const rootPatch = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const soil = new THREE.Color('#77715a'), rootColors = new Float32Array(rootPatch.getAttribute('position').count * 4);
  for (let i = 0; i < rootColors.length / 4; i++) rootColors.set([soil.r, soil.g, soil.b, i === 0 ? 0.52 : 0], i * 4);
  rootPatch.setAttribute('color', new THREE.BufferAttribute(rootColors, 4));
  const rootMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const greens = ['#5b6b50', '#677555', '#73805c', '#7c8261'].map(color => new THREE.Color(color));
  const tints = ['#ffffff', '#faf7e8', '#eee7c7', '#e6e9d4'].map(color => new THREE.Color(color));
  const p = new THREE.Vector3(), size = new THREE.Vector3();
  let seed = 9137;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 };
  const hashAt = (x: number, z: number) => (Math.imul(Math.floor(x / 210), 73856093) ^ Math.imul(Math.floor(z / 210), 19349663)) >>> 0;
  const plant = (x: number, z: number, variantIndex: number, uniform: number, heading: number, tint: THREE.Color) => {
    const variant = variants[variantIndex];
    const halfWidth = Math.max(2.4, (variant.bounds.max.x - variant.bounds.min.x) * uniform / 2), halfDepth = Math.max(2.4, (variant.bounds.max.z - variant.bounds.min.z) * uniform / 2);
    if (!reserve({ x, z, halfWidth, halfDepth, heading }, 0.8, 1.8)) return;
    const c = Math.cos(heading), s = Math.sin(heading);
    p.set(x - (variant.center.x * c + variant.center.z * s) * uniform, -0.075 - variant.bounds.min.y * uniform, z - (-variant.center.x * s + variant.center.z * c) * uniform);
    size.setScalar(uniform);
    for (let i = 0; i < variant.near.length; i++) batch.instance(variant.near[i].material, p, size, heading, variant.near[i].geometry, tint, 0, variant.far[i].geometry);
    const rootRadius = 1.2 + (Math.sin(x * 0.027 + z * 0.019) * 0.5 + 0.5) * 0.6;
    batch.instance(rootMaterial, p.set(x, -0.072, z), size.set(rootRadius, 1, rootRadius * 0.78), heading, rootPatch);
    if (random() < 0.4) {
      for (let clump = 0; clump < 3; clump++) {
        const angle = random() * Math.PI * 2, distance = 0.7 + random() * 0.55;
        batch.instance(foliage, p.set(x + Math.sin(angle) * distance, 0.02, z + Math.cos(angle) * distance), size.set(0.7 + random() * 0.4, 0.18 + random() * 0.13, 0.65 + random() * 0.3), angle, groundcover, greens[Math.floor(random() * greens.length)]);
      }
    }
  };
  for (const site of gardenSites) {
    const district = hashAt(site.x, site.z);
    plant(site.x, site.z, district % 3 === 0 ? 0 : 1, 0.9 + random() * 0.18, random() * Math.PI * 2, district % 7 === 0 ? tints[2] : tints[0]);
  }
  for (const road of roads) {
    if (road.kind === 'ramp') continue;
    for (let along = 24 + random() * 20; along < road.length - 12; along += 76 + random() * 63) for (const side of [-1, 1]) {
      const center = sampleRoad(road, along, side * (road.width / 2 + 9));
      if (Math.abs(center.point.y) > 0.15) continue;
      const district = hashAt(center.point.x, center.point.z);
      if (district % 7 === 2 && random() < 0.55) continue;
      const count = 2 + district % 3;
      for (let member = 0; member < count; member++) {
        const at = sampleRoad(road, along + (member - (count - 1) / 2) * (7.5 + random() * 2.5), side * (road.width / 2 + 6.5 + random() * 9));
        if (Math.abs(at.point.y) > 0.15) continue;
        const variantIndex = (district + member) % 4 === 0 ? 0 : 1;
        const tint = district % 8 === 0 && member === 0 ? tints[2] : district % 5 === 0 ? tints[1] : tints[0];
        plant(at.point.x, at.point.z, variantIndex, 0.84 + random() * 0.3, random() * Math.PI * 2, tint);
      }
      if (district % 3 === 1) continue;
      const at = sampleRoad(road, along + 29 + random() * 9, side * (road.width / 2 + 3.4));
      if (Math.abs(at.point.y) > 0.15) continue;
      const length = 10 + random() * 7;
      const footprint = { x: at.point.x, z: at.point.z, halfWidth: 0.8, halfDepth: length / 2, heading: at.heading };
      if (!reserve(footprint, 0.5, 1.7)) continue;
      const parts = Math.ceil(length / 3.5);
      for (let part = 0; part < parts; part++) {
        const distance = (part + 0.5) * length / parts - length / 2;
        const x = at.point.x + Math.sin(at.heading) * distance, z = at.point.z + Math.cos(at.heading) * distance;
        const height = 0.52 + random() * 0.22;
        batch.instance(foliage, p.set(x, height / 2 - 0.04, z), size.set(1.05 + random() * 0.15, height, length / parts + 0.05), at.heading, hedge, greens[(district + part) % greens.length]);
      }
    }
    for (let along = 112; along < road.length - 30; along += 185 + random() * 95) for (const side of [-1, 1]) {
      const at = sampleRoad(road, along, side * (road.width / 2 + 28 + random() * 16));
      if (Math.abs(at.point.y) > 0.15) continue;
      const district = hashAt(at.point.x, at.point.z);
      for (let member = 0; member < 2 + district % 2; member++) {
        const angle = member * 2.3 + random() * 0.4, distance = member * 5.7;
        const x = at.point.x + Math.sin(angle) * distance, z = at.point.z + Math.cos(angle) * distance;
        const near = index.nearest(x, z);
        if (!near || Math.abs(near.offset) < near.road.width / 2 + 6) continue;
        plant(x, z, (district + member) % 2, 0.92 + random() * 0.22, random() * Math.PI * 2, district % 9 === 0 ? tints[3] : tints[0]);
      }
    }
  }
}
