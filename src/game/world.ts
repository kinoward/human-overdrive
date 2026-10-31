import * as THREE from 'three';
import type { Point3, RoadPath, RoadPosition, WorldData } from '../types';

interface StoredRoad extends Omit<RoadPath, 'cumulative'> {
  osmWayIds: number[];
}

interface StoredWorld {
  title: string;
  source: { name: string; url: string; osmTimestamp: string };
  attribution: string;
  roads: StoredRoad[];
}

const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));
const distanceBetween = (a: Point3, b: Point3) => Math.hypot(b.x - a.x, b.z - a.z);

export function sampleRoad(road: RoadPath, distance: number, offset = 0): { point: Point3; direction: Point3; heading: number } {
  const along = clamp(distance, 0, road.length);
  let index = 1;
  while (index < road.cumulative.length - 1 && road.cumulative[index] < along) index++;
  const start = road.points[index - 1];
  const end = road.points[index];
  const segmentLength = road.cumulative[index] - road.cumulative[index - 1];
  const fraction = segmentLength > 0 ? clamp((along - road.cumulative[index - 1]) / segmentLength, 0, 1) : 0;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const scale = Math.hypot(dx, dz) || 1;
  const direction = { x: dx / scale, y: 0, z: dz / scale };
  return {
    point: { x: start.x + dx * fraction + direction.z * offset, y: start.y + (end.y - start.y) * fraction, z: start.z + dz * fraction - direction.x * offset },
    direction,
    heading: Math.atan2(direction.x, direction.z)
  };
}

export function nearestRoad(roads: RoadPath[], x: number, z: number): RoadPosition | null {
  let best: RoadPosition | null = null;
  let bestDistanceSquared = Infinity;
  for (const road of roads) {
    for (let index = 1; index < road.points.length; index++) {
      const start = road.points[index - 1];
      const end = road.points[index];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared < 0.001) continue;
      const fraction = clamp(((x - start.x) * dx + (z - start.z) * dz) / lengthSquared, 0, 1);
      const px = start.x + dx * fraction;
      const pz = start.z + dz * fraction;
      const squared = (x - px) ** 2 + (z - pz) ** 2;
      if (squared >= bestDistanceSquared) continue;
      const segmentLength = Math.sqrt(lengthSquared);
      const direction = { x: dx / segmentLength, y: 0, z: dz / segmentLength };
      const side = (x - px) * direction.z - (z - pz) * direction.x;
      bestDistanceSquared = squared;
      best = {
        road,
        distance: road.cumulative[index - 1] + segmentLength * fraction,
        offset: Math.sqrt(squared) * (side < 0 ? -1 : 1),
        point: { x: px, y: start.y + (end.y - start.y) * fraction, z: pz },
        direction
      };
    }
  }
  return best;
}

function seededRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function ribbon(road: RoadPath, width: number, height: number, material: THREE.Material): THREE.Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  road.points.forEach((point, index) => {
    const before = road.points[Math.max(0, index - 1)];
    const after = road.points[Math.min(road.points.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const scale = Math.hypot(dx, dz) || 1;
    const nx = dz / scale * width / 2;
    const nz = -dx / scale * width / 2;
    vertices.push(point.x - nx, height, point.z - nz, point.x + nx, height, point.z + nz);
    if (index < road.points.length - 1) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function makeSignTexture(title: string, destination: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 320;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#1c6c59';
  context.fillRect(0, 0, 1024, 320);
  context.strokeStyle = '#e8eee2';
  context.lineWidth = 7;
  context.strokeRect(12, 12, 1000, 296);
  context.textAlign = 'left';
  context.fillStyle = '#ffffff';
  context.font = 'bold 92px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(title, 55, 123);
  context.font = '52px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(destination, 58, 220);
  context.font = 'bold 118px sans-serif';
  context.fillText('↑', 842, 219);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function addRoadFurniture(group: THREE.Group, roads: RoadPath[]): void {
  const lineMatrices: THREE.Matrix4[] = [];
  const edgeMatrices: THREE.Matrix4[] = [];
  const poleMatrices: THREE.Matrix4[] = [];
  const lampMatrices: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  const roadLines = new THREE.MeshStandardMaterial({ color: '#eee9cd', roughness: 1 });
  const edgeLines = new THREE.MeshStandardMaterial({ color: '#ece9d9', roughness: 1 });
  const metal = new THREE.MeshStandardMaterial({ color: '#586663', roughness: 0.75, metalness: 0.25 });
  const lightMaterial = new THREE.MeshBasicMaterial({ color: '#fff1b8' });
  for (const road of roads) {
    const lanes = road.kind === 'main' ? 4 : road.kind === 'service' ? 3 : 1;
    for (let along = 3; along < road.length - 3; along += 17) {
      const sampled = sampleRoad(road, along);
      for (let lane = 1; lane < lanes; lane++) {
        const offset = -road.width / 2 + road.width * lane / lanes;
        const positioned = sampleRoad(road, along, offset);
        dummy.position.set(positioned.point.x, 0.047, positioned.point.z);
        dummy.rotation.set(0, sampled.heading, 0);
        dummy.scale.set(0.16, 0.015, Math.min(7.2, road.length - along));
        dummy.updateMatrix();
        lineMatrices.push(dummy.matrix.clone());
      }
    }
    for (let along = 0; along < road.length; along += 12) {
      const sampled = sampleRoad(road, along + 6);
      for (const side of [-1, 1]) {
        const positioned = sampleRoad(road, along + 6, side * (road.width / 2 - 0.25));
        dummy.position.set(positioned.point.x, 0.049, positioned.point.z);
        dummy.rotation.set(0, sampled.heading, 0);
        dummy.scale.set(0.17, 0.015, Math.min(12.3, road.length - along));
        dummy.updateMatrix();
        edgeMatrices.push(dummy.matrix.clone());
      }
    }
    if (road.kind !== 'main') continue;
    for (let along = 70; along < road.length - 50; along += 125) {
      const position = sampleRoad(road, along, road.width / 2 + 2.4);
      const near = nearestRoad(roads, position.point.x, position.point.z);
      if (near && Math.abs(near.offset) < near.road.width / 2 + 0.7) continue;
      dummy.position.set(position.point.x, 4.3, position.point.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.13, 8.6, 0.13);
      dummy.updateMatrix();
      poleMatrices.push(dummy.matrix.clone());
      dummy.position.set(position.point.x - position.direction.z * 0.7, 8.55, position.point.z + position.direction.x * 0.7);
      dummy.rotation.y = position.heading;
      dummy.scale.set(1.8, 0.12, 0.5);
      dummy.updateMatrix();
      lampMatrices.push(dummy.matrix.clone());
    }
    const signDistances = [650, 2050, 3650, 4950].filter((value) => value < road.length - 150);
    signDistances.forEach((along, index) => {
      const sampled = sampleRoad(road, along);
      const frame = new THREE.Group();
      frame.position.set(sampled.point.x, 0, sampled.point.z);
      frame.rotation.y = sampled.heading;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(road.width + 4, 0.23, 0.23), metal);
      bar.position.y = 8.5;
      frame.add(bar);
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 8.5, 6), metal);
        pole.position.set(side * (road.width / 2 + 1.8), 4.25, 0);
        frame.add(pole);
      }
      const texture = makeSignTexture(index % 2 ? '北四环中路' : '北四环西路', ['中关村  /  学院路', '保福寺桥  /  学院桥', '学院路  /  京藏高速', '中关村  /  万泉河'][index]);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(10.8, 3.38), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, side: THREE.DoubleSide }));
      sign.position.set(0, 6.55, -0.18);
      sign.rotation.y = Math.PI;
      frame.add(sign);
      group.add(frame);
    });
  }
  const makeInstances = (matrices: THREE.Matrix4[], material: THREE.Material, castShadow = false) => {
    if (!matrices.length) return;
    const instances = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, matrices.length);
    matrices.forEach((matrix, index) => instances.setMatrixAt(index, matrix));
    instances.castShadow = castShadow;
    instances.receiveShadow = true;
    instances.computeBoundingSphere();
    group.add(instances);
  };
  makeInstances(lineMatrices, roadLines);
  makeInstances(edgeMatrices, edgeLines);
  makeInstances(poleMatrices, metal, true);
  makeInstances(lampMatrices, lightMaterial);
  const signals = roads.filter((road) => road.kind === 'service' && road.length > 600);
  signals.forEach((road, index) => {
    const sample = sampleRoad(road, Math.min(road.length * 0.55, 850 + index * 230), road.width / 2 + 1.2);
    const signal = new THREE.Group();
    signal.position.set(sample.point.x, 0, sample.point.z);
    signal.rotation.y = sample.heading;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.8, 6), metal);
    pole.position.y = 2.4;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.45, 0.36), new THREE.MeshStandardMaterial({ color: '#26342d', roughness: 0.8 }));
    housing.position.set(0, 4.1, -0.16);
    const green = new THREE.Mesh(new THREE.CircleGeometry(0.17, 12), new THREE.MeshBasicMaterial({ color: '#7cffb2', side: THREE.DoubleSide }));
    green.position.set(0, 3.71, -0.35);
    green.rotation.y = Math.PI;
    signal.add(pole, housing, green);
    group.add(signal);
  });
}

function addCity(group: THREE.Group, roads: RoadPath[], bounds: WorldData['bounds'], obstacles: NonNullable<WorldData['obstacles']>): void {
  const random = seededRandom(20261031);
  const buildingMatrices: THREE.Matrix4[] = [];
  const buildingColors: THREE.Color[] = [];
  const windowMatrices: THREE.Matrix4[] = [];
  const treePositions: Point3[] = [];
  const dummy = new THREE.Object3D();
  const colors = ['#c4c5b8', '#cbd0c7', '#c5bfb0', '#b6c2bf', '#d4cbbc', '#aebcb9', '#ded8c9'];
  for (let x = bounds.minX - 350; x < bounds.maxX + 350; x += 83) {
    for (let z = -860; z < 860; z += 95) {
      if (random() < 0.23) continue;
      const px = x + (random() - 0.5) * 33;
      const pz = z + (random() - 0.5) * 34;
      const width = 18 + random() * 26;
      const depth = 19 + random() * 27;
      const near = nearestRoad(roads, px, pz);
      if (near && Math.abs(near.offset) < near.road.width / 2 + Math.max(width, depth) * 0.8 + 13) continue;
      const height = Math.abs(pz) < 160 ? 13 + random() * 24 : 20 + random() ** 2 * 110;
      dummy.position.set(px, height / 2, pz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      buildingMatrices.push(dummy.matrix.clone());
      buildingColors.push(new THREE.Color(colors[Math.floor(random() * colors.length)]));
      if (near && Math.abs(near.offset) < 190) obstacles.push({ center: { x: px, y: height / 2, z: pz }, halfExtents: { x: width / 2, y: height / 2, z: depth / 2 }, rotation: 0 });
      for (let floor = 5; floor < height - 3; floor += 6.5) {
        for (const side of [-1, 1]) {
          dummy.position.set(px, floor, pz + side * (depth / 2 + 0.04));
          dummy.rotation.set(0, side < 0 ? Math.PI : 0, 0);
          dummy.scale.set(width * 0.8, 1.8, 1);
          dummy.updateMatrix();
          windowMatrices.push(dummy.matrix.clone());
        }
      }
    }
  }
  const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92 }), buildingMatrices.length);
  buildingMatrices.forEach((matrix, index) => { buildings.setMatrixAt(index, matrix); buildings.setColorAt(index, buildingColors[index]); });
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  buildings.computeBoundingSphere();
  group.add(buildings);
  const windows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#728a86', metalness: 0.3, roughness: 0.38 }), windowMatrices.length);
  windowMatrices.forEach((matrix, index) => windows.setMatrixAt(index, matrix));
  windows.computeBoundingSphere();
  group.add(windows);
  for (const road of roads.filter((item) => item.kind !== 'ramp')) {
    for (let along = 28; along < road.length - 25; along += 36) {
      const sample = sampleRoad(road, along, road.width / 2 + 7 + random() * 4);
      const nearest = nearestRoad(roads, sample.point.x, sample.point.z);
      if (nearest && Math.abs(nearest.offset) < nearest.road.width / 2 + 2.5) continue;
      treePositions.push(sample.point);
    }
  }
  for (let index = 0; index < 260; index++) {
    const x = bounds.minX + random() * (bounds.maxX - bounds.minX);
    const z = (random() - 0.5) * 900;
    const nearest = nearestRoad(roads, x, z);
    if (nearest && Math.abs(nearest.offset) < nearest.road.width / 2 + 7) continue;
    treePositions.push({ x, y: 0, z });
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.38, 4.6, 5), new THREE.MeshStandardMaterial({ color: '#6b6453', roughness: 1 }), treePositions.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#738b54', roughness: 1 }), treePositions.length);
  treePositions.forEach((point, index) => {
    const size = 0.8 + random() * 0.75;
    dummy.position.set(point.x, 2.3, point.z);
    dummy.rotation.set(0, random() * Math.PI, 0);
    dummy.scale.set(size, 1, size);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);
    dummy.position.y = 5.4;
    dummy.scale.set(2.8 * size, 3.5 * size, 2.8 * size);
    dummy.updateMatrix();
    crowns.setMatrixAt(index, dummy.matrix);
    crowns.setColorAt(index, new THREE.Color().setHSL(0.18 + random() * 0.08, 0.21 + random() * 0.12, 0.33 + random() * 0.15));
  });
  trunks.castShadow = true;
  crowns.castShadow = true;
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();
  group.add(trunks, crowns);
}

export async function buildWorld(scene: THREE.Scene): Promise<WorldData> {
  const response = await fetch('/data/beijing-roads.json');
  if (!response.ok) throw new Error('北京道路加载失败，请重新进入关卡。');
  const stored = await response.json() as StoredWorld;
  const roads: RoadPath[] = stored.roads.map((road) => {
    const cumulative = [0];
    for (let index = 1; index < road.points.length; index++) cumulative.push(cumulative[index - 1] + distanceBetween(road.points[index - 1], road.points[index]));
    return { ...road, cumulative, length: cumulative[cumulative.length - 1] };
  });
  const points = roads.flatMap((road) => road.points);
  const bounds = {
    minX: Math.min(...points.map((point) => point.x)) - 180,
    maxX: Math.max(...points.map((point) => point.x)) + 180,
    minZ: Math.min(...points.map((point) => point.z)) - 250,
    maxZ: Math.max(...points.map((point) => point.z)) + 250
  };
  const group = new THREE.Group();
  const obstacles: NonNullable<WorldData['obstacles']> = [];
  group.name = '北京北四环';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 1600, bounds.maxZ - bounds.minZ + 2400), new THREE.MeshStandardMaterial({ color: '#939c7a', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bounds.minX + bounds.maxX) / 2, -0.035, (bounds.minZ + bounds.maxZ) / 2);
  ground.receiveShadow = true;
  group.add(ground);
  const shoulderMaterial = new THREE.MeshStandardMaterial({ color: '#c5c3ad', roughness: 1 });
  const asphaltMaterial = new THREE.MeshStandardMaterial({ color: '#3e4647', roughness: 0.94 });
  const serviceMaterial = new THREE.MeshStandardMaterial({ color: '#505758', roughness: 1 });
  for (const road of [...roads].sort((a, b) => a.width - b.width)) {
    group.add(ribbon(road, road.width + 1.3, 0.008, shoulderMaterial));
    group.add(ribbon(road, road.width, 0.025, road.kind === 'main' ? asphaltMaterial : serviceMaterial));
  }
  addRoadFurniture(group, roads);
  addCity(group, roads, bounds, obstacles);
  const mainRoads = roads.filter((road) => road.kind === 'main');
  const medianMatrices: THREE.Matrix4[] = [];
  const medianDummy = new THREE.Object3D();
  if (mainRoads.length > 1) {
    const reference = mainRoads[0];
    const opposite = mainRoads.slice(1);
    for (let along = 20; along < reference.length - 20; along += 15) {
      const sample = sampleRoad(reference, along);
      const other = nearestRoad(opposite, sample.point.x, sample.point.z);
      if (!other) continue;
      const separation = distanceBetween(sample.point, other.point);
      const gap = separation - (reference.width + other.road.width) / 2;
      if (gap < 1.5 || gap > 16) continue;
      const center = { x: (sample.point.x + other.point.x) / 2, y: 0.42, z: (sample.point.z + other.point.z) / 2 };
      const crossing = nearestRoad(roads.filter((road) => road.kind === 'ramp'), center.x, center.z);
      if (crossing && Math.abs(crossing.offset) < crossing.road.width / 2 + 3) continue;
      medianDummy.position.set(center.x, center.y, center.z);
      medianDummy.rotation.set(0, sample.heading, 0);
      medianDummy.scale.set(0.95, 0.84, 14.6);
      medianDummy.updateMatrix();
      medianMatrices.push(medianDummy.matrix.clone());
      obstacles.push({ center, halfExtents: { x: 0.475, y: 0.42, z: 7.3 }, rotation: sample.heading });
    }
  }
  if (medianMatrices.length) {
    const median = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#d2cdb8', roughness: 0.9 }), medianMatrices.length);
    medianMatrices.forEach((matrix, index) => median.setMatrixAt(index, matrix));
    median.castShadow = true;
    median.receiveShadow = true;
    median.computeBoundingSphere();
    group.add(median);
  }
  const ambient = new THREE.HemisphereLight('#f4f1d9', '#738275', 2.2);
  group.add(ambient);
  scene.add(group);
  const main = roads.filter((road) => road.kind === 'main').find((road) => road.points[road.points.length - 1].x > road.points[0].x) ?? roads.find((road) => road.kind === 'main')!;
  const spawnDistance = Math.min(400, main.length * 0.1);
  const spawn = sampleRoad(main, spawnDistance, main.width / 8);
  return {
    roads,
    bounds,
    source: `${stored.source.name} · ${stored.source.osmTimestamp.slice(0, 10)} · 水平路网重构`,
    attribution: stored.attribution,
    obstacles,
    spawn: { position: spawn.point, heading: spawn.heading, roadId: main.id, distance: spawnDistance },
    dispose: () => {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => { if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose(); material.dispose(); });
      scene.remove(group);
    }
  };
}
