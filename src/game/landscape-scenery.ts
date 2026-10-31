import * as THREE from 'three';
import type { Point3, RoadPath } from '../types';
import { generatedMeshes } from './generated-assets';
import { sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';
import { LoadingBudget } from './loading-budget';
import { meshBounds, SceneryPlacement } from './scenery-placement';

export interface LandscapePlot { x: number; z: number; width: number; depth: number; heading: number }

function grassGeometry() {
  const positions: number[] = [];
  for (let blade = 0; blade < 5; blade++) {
    const angle = blade * 2.4, x = Math.sin(angle) * 0.18, z = Math.cos(angle) * 0.18;
    const dx = Math.cos(angle) * 0.065, dz = -Math.sin(angle) * 0.065;
    positions.push(x - dx, 0, z - dz, x + dx, 0, z + dz, x + Math.sin(angle + 0.6) * 0.21, 0.45 + blade % 3 * 0.11, z + Math.cos(angle + 0.6) * 0.21);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
  return geometry;
}

export async function addLandscapeScenery(roads: RoadPath[], batch: SceneryBatch, placement: SceneryPlacement, gardenSites: Point3[], parks: LandscapePlot[]) {
  const budget = new LoadingBudget();
  const variants = (['roadside-tree', 'slender-tree'] as const).map(name => {
    const near = generatedMeshes(name, 'near'), far = generatedMeshes(name, 'far');
    const bounds = meshBounds(near);
    return { near, far, bounds, center: bounds.getCenter(new THREE.Vector3()) };
  });
  const foliage = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  foliage.userData.sceneryShadow = false;
  const grassMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide });
  const leaf = new THREE.IcosahedronGeometry(1, 1), grass = grassGeometry();
  const rootPatch = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const soil = new THREE.Color('#77715a'), rootColors = new Float32Array(rootPatch.getAttribute('position').count * 4);
  for (let i = 0; i < rootColors.length / 4; i++) rootColors.set([soil.r, soil.g, soil.b, i === 0 ? 0.52 : 0], i * 4);
  rootPatch.setAttribute('color', new THREE.BufferAttribute(rootColors, 4));
  const rootMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const greens = ['#5c704f', '#687958', '#798462', '#6b7d5c', '#827f5b'].map(color => new THREE.Color(color));
  const tints = ['#ffffff', '#faf7e8', '#eee7c7', '#e6e9d4'].map(color => new THREE.Color(color));
  const p = new THREE.Vector3(), size = new THREE.Vector3();
  let seed = 9137;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296 };
  const hashAt = (x: number, z: number) => (Math.imul(Math.floor(x / 210), 73856093) ^ Math.imul(Math.floor(z / 210), 19349663)) >>> 0;
  const scatterGrass = (x: number, z: number, radius: number, count: number) => {
    for (let clump = 0; clump < count; clump++) {
      const angle = random() * Math.PI * 2, distance = radius * (0.25 + random() * 0.45), uniform = Math.min(0.65 + random() * 0.45, radius * 0.9);
      batch.instance(grassMaterial, p.set(x + Math.sin(angle) * distance, -0.09, z + Math.cos(angle) * distance), size.set(uniform, uniform, uniform), angle, grass, greens[Math.floor(random() * greens.length)]);
    }
  };
  const plantTree = (x: number, z: number, variantIndex: number, uniform: number, heading: number, tint: THREE.Color) => {
    const variant = variants[variantIndex];
    const halfWidth = Math.max(2.1, (variant.bounds.max.x - variant.bounds.min.x) * uniform / 2), halfDepth = Math.max(2.1, (variant.bounds.max.z - variant.bounds.min.z) * uniform / 2);
    if (!placement.reserve({ x, z, halfWidth, halfDepth, heading }, 0.18, 0.8)) return false;
    const c = Math.cos(heading), s = Math.sin(heading);
    p.set(x - (variant.center.x * c + variant.center.z * s) * uniform, -0.075 - variant.bounds.min.y * uniform, z - (-variant.center.x * s + variant.center.z * c) * uniform);
    size.setScalar(uniform);
    for (let i = 0; i < variant.near.length; i++) batch.instance(variant.near[i].material, p, size, heading, variant.near[i].geometry, tint, 0, variant.far[i].geometry);
    const rootRadius = 1.2 + (Math.sin(x * 0.027 + z * 0.019) * 0.5 + 0.5) * 0.6;
    batch.instance(rootMaterial, p.set(x, -0.072, z), size.set(rootRadius, 1, rootRadius * 0.78), heading, rootPatch);
    for (let clump = 0; clump < 2; clump++) {
      const angle = random() * Math.PI * 2, distance = 0.55 + random() * 0.55;
      batch.instance(foliage, p.set(x + Math.sin(angle) * distance, -0.01, z + Math.cos(angle) * distance), size.set(0.55 + random() * 0.3, 0.16 + random() * 0.12, 0.5 + random() * 0.3), angle, leaf, greens[Math.floor(random() * greens.length)]);
    }
    scatterGrass(x, z, Math.min(halfWidth, halfDepth) * 0.82, 3);
    return true;
  };
  const plantShrub = (x: number, z: number, radius: number, depth: number, height: number, heading: number, color: number) => {
    if (!placement.reserve({ x, z, halfWidth: radius, halfDepth: depth, heading }, 0.08, 0.5)) return;
    const c = Math.cos(heading), s = Math.sin(heading);
    batch.instance(rootMaterial, p.set(x, -0.072, z), size.set(radius * 0.98, 1, depth * 0.98), heading, rootPatch);
    for (let crown = 0; crown < 4; crown++) {
      const angle = crown * 2.2, localX = Math.sin(angle) * radius * 0.34, localZ = Math.cos(angle) * depth * 0.32;
      const h = height * (0.35 + random() * 0.17);
      batch.instance(foliage, p.set(x + localX * c + localZ * s, -0.08 + h * 0.82, z - localX * s + localZ * c), size.set(radius * 0.54, h, depth * 0.56), heading + (random() - 0.5) * 0.25, leaf, greens[(color + crown % 2) % greens.length]);
    }
    scatterGrass(x, z, Math.min(radius, depth) * 0.65, 2);
  };
  for (const site of gardenSites) {
    if (budget.exhausted) await budget.yield();
    const district = hashAt(site.x, site.z);
    plantTree(site.x, site.z, district % 3 === 0 ? 0 : 1, 0.88 + random() * 0.2, random() * Math.PI * 2, district % 7 === 0 ? tints[2] : tints[0]);
  }
  for (const park of parks) {
    const c = Math.cos(park.heading), s = Math.sin(park.heading), district = hashAt(park.x, park.z);
    const count = Math.floor(park.width * park.depth / 115);
    for (let member = 0; member < count; member++) {
      if (budget.exhausted) await budget.yield();
      const localX = (random() - 0.5) * park.width, localZ = (random() - 0.5) * park.depth;
      const x = park.x + localX * c + localZ * s, z = park.z - localX * s + localZ * c;
      plantTree(x, z, member % 3 === 0 ? 1 : 0, 0.9 + random() * 0.22, random() * Math.PI * 2, district % 7 === 0 && member % 4 === 0 ? tints[2] : tints[0]);
      if (member % 2 === 0) plantShrub(x + 3.7, z - 2.8, 1.3, 1.15, 0.9, random() * Math.PI * 2, district % greens.length);
    }
  }
  for (const road of roads) {
    if (road.kind === 'ramp') continue;
    for (let along = 28 + random() * 18; along < road.length - 10; along += 47 + random() * 38) for (const side of [-1, 1]) {
      if (budget.exhausted) await budget.yield();
      const center = sampleRoad(road, along, side * (road.width / 2 + 12));
      if (Math.abs(center.point.y) > 0.15) continue;
      const district = hashAt(center.point.x, center.point.z), count = 3 + district % 3;
      for (let member = 0; member < count; member++) {
        const distance = along + (member - (count - 1) / 2) * (6.5 + random() * 2.5);
        const offset = side * (road.width / 2 + 7.3 + random() * 11.5);
        const at = sampleRoad(road, distance, offset);
        const uniform = 0.84 + random() * 0.31, yaw = random() * Math.PI * 2;
        const tint = district % 8 === 0 && member === 0 ? tints[2] : district % 5 === 0 ? tints[1] : tints[0];
        if (!plantTree(at.point.x, at.point.z, (district + member) % 4 === 0 ? 0 : 1, uniform, yaw, tint)) {
          const farther = sampleRoad(road, distance + 3, offset + side * 9);
          plantTree(farther.point.x, farther.point.z, (district + member) % 2, uniform, yaw, tint);
        }
      }
    }
    for (let along = 46; along < road.length - 25; along += 69 + random() * 43) for (const side of [-1, 1]) {
      if (budget.exhausted) await budget.yield();
      const center = sampleRoad(road, along, side * (road.width / 2 + 31));
      if (Math.abs(center.point.y) > 0.15) continue;
      const district = hashAt(center.point.x, center.point.z);
      for (let member = 0; member < 3; member++) {
        const at = sampleRoad(road, along + (member - 1) * 7.7, side * (road.width / 2 + 23 + random() * 17));
        plantTree(at.point.x, at.point.z, (district + member) % 2, 0.92 + random() * 0.2, random() * Math.PI * 2, district % 9 === 0 ? tints[3] : tints[0]);
        if (member === 1) plantShrub(at.point.x + Math.cos(at.heading) * 4.3, at.point.z - Math.sin(at.heading) * 4.3, 1.4, 1.2, 1.1, at.heading, district % greens.length);
      }
    }
    for (let along = 71; along < road.length - 25; along += 100 + random() * 45) for (const side of [-1, 1]) {
      if (budget.exhausted) await budget.yield();
      const center = sampleRoad(road, along, side * (road.width / 2 + 64));
      if (Math.abs(center.point.y) > 0.15 || hashAt(center.point.x, center.point.z) % 7 === 3) continue;
      for (let member = 0; member < 4; member++) {
        const at = sampleRoad(road, along + (member - 1.5) * 7.6, side * (road.width / 2 + 52 + random() * 27));
        plantTree(at.point.x, at.point.z, member % 3 === 0 ? 1 : 0, 0.96 + random() * 0.18, random() * Math.PI * 2, tints[0]);
      }
    }
    for (let along = 20 + random() * 16; along < road.length - 10; along += 26 + random() * 18) for (const side of [-1, 1]) {
      if (budget.exhausted) await budget.yield();
      const center = sampleRoad(road, along, side * (road.width / 2 + 5.1));
      if (Math.abs(center.point.y) > 0.15) continue;
      const district = hashAt(center.point.x, center.point.z);
      if (district % 13 === 4 && Math.floor(along / 35) % 3 === 0) continue;
      for (let member = 0; member < 2 + district % 2; member++) {
        const at = sampleRoad(road, along + member * 3.4 + (random() - 0.5) * 2.5, side * (road.width / 2 + 3.1 + random() * 5.7));
        const radius = 0.8 + random() * 0.6;
        plantShrub(at.point.x, at.point.z, radius, radius * (0.76 + random() * 0.18), 0.55 + random() * 0.5, at.heading + random() * 2, district % greens.length);
      }
    }
  }
}
