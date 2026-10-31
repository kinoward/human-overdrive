import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Point3 } from '../types';
import { SceneryBatch } from './scenery-batch';
import { generatedMeshes } from './generated-assets';
import { LoadingBudget } from './loading-budget';

export interface PlacedBuildingFacade {
  type: 'residential-block' | 'brick-apartment';
  bounds: THREE.Box3;
  position: Readonly<Point3>;
  uniform: number;
  heading: number;
}

type FacadePart = 'frame' | 'glass' | 'recess' | 'metal';
interface FacadeResources {
  material: THREE.MeshStandardMaterial;
  surfaces: Record<FacadePart, { color: THREE.Color; roughness: number }>;
  designs: Map<string, THREE.BufferGeometry | null>;
}

const resources = new WeakMap<SceneryBatch, FacadeResources>();

function facadeResources(batch: SceneryBatch) {
  let shared = resources.get(batch);
  if (!shared) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0.1 });
    material.userData.sceneryShadow = false;
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float facadeRoughness;\nvarying float vFacadeRoughness;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacadeRoughness = facadeRoughness;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFacadeRoughness;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vFacadeRoughness;');
    };
    material.customProgramCacheKey = () => '建筑立面顶点粗糙度1';
    shared = {
      material,
      surfaces: {
        frame: { color: new THREE.Color('#bcbdb4'), roughness: 0.84 },
        glass: { color: new THREE.Color('#344b57'), roughness: 0.32 },
        recess: { color: new THREE.Color('#4d5352'), roughness: 0.94 },
        metal: { color: new THREE.Color('#9b9e96'), roughness: 0.72 }
      },
      designs: new Map()
    };
    resources.set(batch, shared);
  }
  return shared;
}

async function createFacadeDesign(building: PlacedBuildingFacade, style: number, shared: FacadeResources) {
  const budget = new LoadingBudget();
  const { min, max } = building.bounds;
  const width = max.x - min.x, height = max.y - min.y, depth = max.z - min.z;
  const centerX = (min.x + max.x) / 2, centerZ = (min.z + max.z) / 2;
  const rearSide = building.type === 'residential-block' ? 1 : -1;
  const rearZ = rearSide > 0 ? max.z : min.z;
  const floors = Math.max(1, Math.round((height - 1) / 3.3));
  const floorHeight = (height - 1) / floors;
  const rayMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const targets = generatedMeshes(building.type).map(source => {
    const mesh = new THREE.Mesh(source.geometry, rayMaterial);
    mesh.updateMatrixWorld(true);
    return mesh;
  });
  const raycaster = new THREE.Raycaster(), origin = new THREE.Vector3(), direction = new THREE.Vector3();
  const wallSamples = new Map<string, number | undefined>();
  const wallAt = (side: number, along: number, y: number, rear = false) => {
    const key = `${rear}:${side}:${along}:${y}`;
    if (wallSamples.has(key)) return wallSamples.get(key);
    if (rear) {
      origin.set(along, y, rearZ + rearSide);
      direction.set(0, 0, -rearSide);
    } else {
      origin.set((side > 0 ? max.x : min.x) + side, y, along);
      direction.set(-side, 0, 0);
    }
    raycaster.set(origin, direction);
    raycaster.far = (rear ? depth : width) + 2;
    const hit = raycaster.intersectObjects(targets, false).find(hit => hit.face && Math.abs(rear ? hit.face.normal.z : hit.face.normal.x) > 0.65 && Math.abs(hit.face.normal.y) < 0.45 && (rear ? rearSide * (hit.point.z - centerZ) > depth * 0.2 : side * (hit.point.x - centerX) > width * 0.2));
    const wall = hit ? rear ? hit.point.z : hit.point.x : undefined;
    wallSamples.set(key, wall);
    return wall;
  };
  const referenceWall = (side: number, along: number, rear = false) => {
    const samples = [0.37, 0.51, 0.63].map(level => wallAt(side, along, min.y + height * level, rear)).filter((wall): wall is number => wall !== undefined).sort((a, b) => a - b);
    return samples.length ? samples[Math.floor(samples.length / 2)] : undefined;
  };
  const parts: Record<FacadePart, THREE.BufferGeometry[]> = { frame: [], glass: [], recess: [], metal: [] };
  const box = (part: FacadePart, x: number, y: number, z: number, w: number, h: number, d: number) => {
    parts[part].push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  };
  const window = (side: number, along: number, y: number, rear = false, narrow = false) => {
    const windowWidth = narrow ? 1.35 : style === 1 ? 1.8 : 1.55;
    const windowHeight = style === 2 ? 1.95 : 1.8;
    const samples = [[0, 0], [-0.48, -0.46], [-0.48, 0.46], [0.48, -0.46], [0.48, 0.46]].map(([horizontal, vertical]) => wallAt(side, along + horizontal * windowWidth, y + vertical * windowHeight, rear));
    if (samples.some(wall => wall === undefined)) return undefined;
    const planes = samples as number[];
    if (Math.max(...planes) - Math.min(...planes) > 0.12) return undefined;
    const normal = rear ? rearSide : side;
    const wall = normal > 0 ? Math.max(...planes) : Math.min(...planes);
    const piece = (part: FacadePart, horizontal: number, vertical: number, out: number, w: number, h: number, d: number) => {
      if (rear) box(part, along + horizontal, y + vertical, wall + rearSide * out, w, h, d);
      else box(part, wall + side * out, y + vertical, along + horizontal, d, h, w);
    };
    piece('recess', 0, 0, 0.025, windowWidth + 0.22, windowHeight + 0.22, 0.03);
    piece('glass', 0, 0, 0.055, windowWidth, windowHeight, 0.025);
    for (const edge of [-1, 1]) {
      piece('frame', edge * (windowWidth / 2 + 0.045), 0, 0.075, 0.1, windowHeight + 0.22, 0.09);
      piece('frame', 0, edge * (windowHeight / 2 + 0.045), 0.075, windowWidth + 0.1, 0.1, 0.09);
    }
    piece('frame', windowWidth * (style === 1 ? -0.18 : 0), 0, 0.083, 0.065, windowHeight, 0.07);
    piece('metal', 0, -windowHeight / 2 - 0.14, 0.1, windowWidth + 0.3, 0.11, 0.08);
    return wall;
  };
  const columns = style === 2 || depth > 20 && style === 0 ? 3 : 2;
  const spread = Math.min(depth - 5.4, columns === 3 ? 10 : 7.2);
  for (const side of [-1, 1]) {
    for (const segment of [-1, 0, 1]) {
      const z = centerZ + segment * (depth - 0.8) / 3;
      const wallX = referenceWall(side, z);
      if (wallX !== undefined) box('frame', wallX + side * 0.035, min.y + 0.27, z, 0.07, 0.55, (depth - 0.8) / 3);
    }
    for (let floor = 0; floor < floors; floor++) {
      if (budget.exhausted) await budget.yield();
      const y = min.y + 1.72 + floor * floorHeight;
      for (let column = 0; column < columns; column++) {
        const z = centerZ + (column / (columns - 1) - 0.5) * spread;
        const windowWall = window(side, z, y);
        if (windowWall !== undefined && (floor + column + style + (side > 0 ? 1 : 0)) % 5 === 2) {
          const unitZ = z + (column === columns - 1 ? -1 : 1) * 1.35;
          const wallX = wallAt(side, unitZ, y - 0.62);
          if (wallX === undefined) continue;
          box('metal', wallX + side * 0.2, y - 0.62, unitZ, 0.28, 0.6, 0.84);
          const fan = new THREE.CircleGeometry(0.18, 8).rotateY(side * Math.PI / 2).translate(wallX + side * 0.345, y - 0.62, unitZ);
          parts.recess.push(fan);
          box('metal', wallX + side * 0.15, y - 0.99, unitZ, 0.2, 0.08, 1.02);
        }
      }
    }
    const pipeZ = rearZ - rearSide * 0.38;
    const pipeWall = referenceWall(side, pipeZ);
    if (pipeWall !== undefined) {
      parts.metal.push(new THREE.CylinderGeometry(0.045, 0.045, height - 1.1, 6).translate(pipeWall + side * 0.095, min.y + height / 2 - 0.15, pipeZ));
      for (let y = min.y + 2.2; y < max.y - 1; y += floorHeight * 2) box('metal', pipeWall + side * 0.085, y, pipeZ, 0.15, 0.08, 0.2);
    }
  }
  for (let floor = style % 2; floor < floors - 1; floor += 2) {
    if (budget.exhausted) await budget.yield();
    const y = min.y + 1.72 + floor * floorHeight;
    for (const side of [-1, 1]) window(side, centerX + side * width * 0.24, y, true, true);
  }
  for (const segment of [-1, 0, 1]) {
    const x = centerX + segment * (width - 0.8) / 3;
    const wallZ = referenceWall(1, x, true);
    if (wallZ !== undefined) box('frame', x, min.y + 0.27, wallZ + rearSide * 0.035, (width - 0.8) / 3, 0.55, 0.07);
  }
  if (style === 2 && floors > 4) {
    const side = building.type === 'residential-block' ? 1 : -1;
    const frontZ = rearSide > 0 ? min.z : max.z;
    const z = frontZ + rearSide * 3.3;
    const y = min.y + 0.66 + floorHeight * 3;
    const wallX = wallAt(side, z, y + 0.6);
    if (wallX !== undefined) {
      box('frame', wallX + side * 0.35, y, z, 0.7, 0.15, 2.7);
      box('metal', wallX + side * 0.68, y + 0.58, z, 0.06, 0.9, 2.7);
      for (const end of [-1, 1]) box('metal', wallX + side * 0.35, y + 0.58, z + end * 1.32, 0.7, 0.9, 0.055);
      box('metal', wallX + side * 0.7, y + 1.06, z, 0.08, 0.07, 2.75);
    }
  }
  const mergedParts: THREE.BufferGeometry[] = [];
  for (const part of Object.keys(parts) as FacadePart[]) {
    if (!parts[part].length) continue;
    const geometry = mergeGeometries(parts[part])!;
    parts[part].forEach(piece => piece.dispose());
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3), roughness = new Float32Array(count);
    const surface = shared.surfaces[part];
    for (let i = 0; i < count; i++) {
      colors[i * 3] = surface.color.r;
      colors[i * 3 + 1] = surface.color.g;
      colors[i * 3 + 2] = surface.color.b;
    }
    roughness.fill(surface.roughness);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('facadeRoughness', new THREE.BufferAttribute(roughness, 1));
    mergedParts.push(geometry);
  }
  rayMaterial.dispose();
  if (!mergedParts.length) return null;
  const geometry = mergeGeometries(mergedParts)!;
  mergedParts.forEach(part => part.dispose());
  return geometry;
}

export async function addBuildingFacades(batch: SceneryBatch, building: PlacedBuildingFacade) {
  const shared = facadeResources(batch);
  const district = (Math.imul(Math.floor(building.position.x / 120), 73856093) ^ Math.imul(Math.floor(building.position.z / 120), 19349663)) >>> 0;
  const style = district % 3;
  const { min, max } = building.bounds;
  const key = `${building.type}:${style}:${min.toArray().join(',')}:${max.toArray().join(',')}`;
  if (!shared.designs.has(key)) shared.designs.set(key, await createFacadeDesign(building, style, shared));
  const design = shared.designs.get(key);
  if (!design) return;
  const position = new THREE.Vector3(building.position.x, building.position.y, building.position.z);
  const scale = new THREE.Vector3().setScalar(building.uniform);
  batch.instance(shared.material, position, scale, building.heading, design);
}
