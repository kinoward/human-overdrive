import * as THREE from 'three';
import type { RoadPath, WorldData, Point3 } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';
import { roadRibbon } from './road-ribbon';
import { roadCrossSection } from './road-cross-section';

export interface RoadMaterials { asphalt: THREE.MeshStandardMaterial; concrete: THREE.MeshStandardMaterial; ground: THREE.MeshStandardMaterial }

function strip(a: Point3, b: Point3, width: number, offset: number, elevation: number, start: number, tile: number) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  const nx = dz / length, nz = -dx / length;
  const geometry = new THREE.BufferGeometry();
  const left = offset - width / 2, right = offset + width / 2;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    a.x + nx * left, a.y + elevation, a.z + nz * left,
    a.x + nx * right, a.y + elevation, a.z + nz * right,
    b.x + nx * left, b.y + elevation, b.z + nz * left,
    b.x + nx * right, b.y + elevation, b.z + nz * right
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, start / tile, width / tile, start / tile, 0, (start + length) / tile, width / tile, (start + length) / tile], 2));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

function signTexture(title: string, subtitle: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#12613e'; ctx.fillRect(0, 0, 1024, 320);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.strokeRect(12, 12, 1000, 296);
  ctx.fillStyle = 'white'; ctx.font = '600 76px "Overdrive Scene", "PingFang SC", sans-serif'; ctx.fillText(title, 45, 108, 790);
  ctx.font = '44px "Overdrive Scene", "PingFang SC", sans-serif'; ctx.fillText(subtitle, 48, 198, 800);
  ctx.font = '34px sans-serif'; ctx.fillText('4th Ring Road', 48, 267);
  ctx.font = '110px sans-serif'; ctx.fillText('↑', 875, 215);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function addRoadScenery(group: THREE.Group, roads: RoadPath[], materials: RoadMaterials, batch: SceneryBatch) {
  const index = new RoadIndex(roads);
  const bridgeConcrete = materials.concrete.clone();
  bridgeConcrete.onBeforeCompile = materials.concrete.onBeforeCompile;
  bridgeConcrete.userData.airObstacle = true;
  const asphalts = new Map<RoadPath['kind'], THREE.MeshStandardMaterial>();
  for (const [kind, priority] of [['main', 2], ['service', 3], ['ramp', 4]] as const) {
    const material = materials.asphalt.clone();
    material.polygonOffset = true; material.polygonOffsetFactor = -priority; material.polygonOffsetUnits = -priority;
    asphalts.set(kind, material);
  }
  const obstacles: NonNullable<WorldData['obstacles']> = [];
  const white = new THREE.MeshStandardMaterial({ color: '#f5f3df', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  white.userData.roadDecal = true;
  const metal = new THREE.MeshStandardMaterial({ color: '#9caaa9', metalness: 0.7, roughness: 0.45 });
  const black = new THREE.MeshStandardMaterial({ color: '#262b2c', roughness: 0.75 });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe6bc').multiplyScalar(6), toneMapped: false });
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 64;
  const glowContext = glowCanvas.getContext('2d')!;
  const glowGradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  glowGradient.addColorStop(0, 'rgba(255,255,255,0.38)'); glowGradient.addColorStop(0.3, 'rgba(255,255,255,0.12)'); glowGradient.addColorStop(1, 'rgba(255,255,255,0)');
  glowContext.fillStyle = glowGradient; glowContext.fillRect(0, 0, 64, 64);
  const glowTexture = new THREE.CanvasTexture(glowCanvas); glowTexture.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.MeshBasicMaterial({ map: glowTexture, color: '#ffdfae', transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const glowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const reflector = new THREE.MeshBasicMaterial({ color: '#f3e7b8' });
  const post = new THREE.CylinderGeometry(0.1, 0.15, 1, 6);
  const p = new THREE.Vector3(), size = new THREE.Vector3();
  const box = (material: THREE.Material, point: Point3, x: number, y: number, z: number, heading = 0, lift = 0, pitch = 0) => batch.instance(material, p.set(point.x, point.y + lift, point.z), size.set(x, y, z), heading, batch.box, undefined, pitch);
  const terrainTiles = new Set<string>();
  const excavations = new Set<string>();
  for (const road of roads) for (const point of road.points) {
    const x = Math.floor(point.x / 64), z = Math.floor(point.z / 64);
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) terrainTiles.add(`${x + dx},${z + dz}`);
    if (point.y < -0.1) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) excavations.add(`${x + dx},${z + dz}`);
  }
  for (const key of terrainTiles) {
    if (excavations.has(key)) continue;
    const [x, z] = key.split(',').map(Number);
    const geometry = new THREE.PlaneGeometry(64.1, 64.1).rotateX(-Math.PI / 2).translate(x * 64 + 32, -0.08, z * 64 + 32);
    batch.surface(materials.ground, geometry, x * 64, z * 64);
  }
  for (const road of roads) {
    const section = roadCrossSection(road);
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      const d = road.cumulative[i - 1], length = road.cumulative[i] - d;
      if (length < 0.01) continue;
      batch.surface(asphalts.get(road.kind)!, roadRibbon(road, i, road.width + 0.12, 0, 0.035, 3), a.x, a.z);
      batch.surface(materials.concrete, roadRibbon(road, i, road.width + 1.1, 0, 0.015, 2), a.x, a.z);

      if (Math.min(a.y, b.y) > 1) {
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        box(bridgeConcrete, middle, road.width, 0.65, length + 0.15, Math.atan2(b.x - a.x, b.z - a.z), -0.34, -Math.atan2(b.y - a.y, length));
      }
      for (const side of [-1, 1]) batch.surface(white, roadRibbon(road, i, 0.16, side * (road.width / 2 - 0.35), 0.047, 1), a.x, a.z);
      if (section.shoulderWidth > 0) {
        const boundary = section.travelOffset + section.travelWidth / 2;
        const middle = sampleRoad(road, d + length / 2, boundary).point;
        if (!index.covers(middle, road, 0.1, true)) batch.surface(white, roadRibbon(road, i, 0.2, boundary, 0.049, 1), a.x, a.z);
      }
    }
    for (let distance = 6; distance < road.length - 3; distance += 15) {
      const a = sampleRoad(road, distance), b = sampleRoad(road, Math.min(distance + 6, road.length));
      for (let lane = 1; lane < road.lanes; lane++) {
        batch.surface(white, strip(a.point, b.point, 0.15, section.travelOffset + (lane / road.lanes - 0.5) * section.travelWidth, 0.05, distance, 1), a.point.x, a.point.z);
      }
    }
    for (const side of [-1, 1]) {
      let runStart: Point3 | undefined;
      let runEnd: Point3 | undefined;
      const flush = () => {
        if (!runStart || !runEnd) return;
        const a = runStart, b = runEnd;
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 0.1) { runStart = runEnd = undefined; return }
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        const heading = Math.atan2(b.x - a.x, b.z - a.z), pitch = -Math.atan2(b.y - a.y, length);
        const baseHeight = Math.max(0.65, -middle.y + 0.3);
        box(materials.concrete, middle, 0.48, baseHeight, length + 0.18, heading, baseHeight / 2, pitch);
        box(metal, middle, 0.22, 0.28, length + 0.18, heading, 0.93, pitch);
        obstacles.push({ center: { ...middle, y: middle.y + 0.65 }, halfExtents: { x: 0.25, y: 0.65, z: length / 2 + 0.1 }, rotation: heading, pitch });
        runStart = runEnd = undefined;
      };
      const append = (a: Point3, b: Point3) => {
        if (runStart && runEnd) {
          const dx = runEnd.x - runStart.x, dz = runEnd.z - runStart.z;
          const length = Math.hypot(b.x - a.x, b.z - a.z);
          const deviation = Math.abs(dx * (b.z - runStart.z) - dz * (b.x - runStart.x)) / (Math.hypot(dx, dz) || 1);
          if (deviation > 0.08 || Math.hypot(b.x - runStart.x, b.z - runStart.z) > 24 || Math.abs(b.y - a.y - (runEnd.y - runStart.y) * length / (Math.hypot(dx, dz) || 1)) > 0.08) flush();
        }
        if (!runStart) runStart = a;
        runEnd = b;
      };
      for (let distance = 0; distance < road.length; distance += 3) {
        const a = sampleRoad(road, distance, side * (road.width / 2 + 0.4)).point;
        const b = sampleRoad(road, Math.min(distance + 3, road.length), side * (road.width / 2 + 0.4)).point;
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        const covered = [a, middle, b].map(point => index.covers(point, road, 0.05, true));
        if (covered.every(Boolean)) { flush(); continue }
        if (covered.some(Boolean)) {
          const interpolate = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
          for (let part = 0; part < 12; part++) {
            if (index.covers(interpolate((part + 0.5) / 12), road, 0.05, true)) flush();
            else append(interpolate(part / 12), interpolate((part + 1) / 12));
          }
          continue;
        }
        append(a, b);
        if (distance % 12 === 0) {
          box(metal, middle, 0.1, 0.95, 0.13, 0, 0.5);
          box(reflector, middle, 0.08, 0.12, 0.28, 0, 1.05);
        }
      }
      flush();
    }
    for (const distance of road.closed ? [] : [0, road.length]) {
      const end = sampleRoad(road, distance);
      const connected = road.junctions.some(junction => Math.hypot(junction.point.x - end.point.x, junction.point.z - end.point.z, junction.point.y - end.point.y) < 0.12);
      if (!connected) {
        box(materials.concrete, end.point, road.width + 1.5, 1.2, 0.6, end.heading, 0.6);
        obstacles.push({ center: { ...end.point, y: end.point.y + 0.6 }, halfExtents: { x: road.width / 2 + 0.75, y: 0.6, z: 0.3 }, rotation: end.heading });
      }
    }
    for (let distance = 40; distance < road.length - 10; distance += road.kind === 'main' ? 48 : 70) {
      const s = sampleRoad(road, distance, road.width / 2 + 1.7);
      if (index.covers(s.point, road, 0.5)) continue;
      batch.instance(metal, p.set(s.point.x, s.point.y + 4.5, s.point.z), size.set(1, 9, 1), 0, post);
      const arm = sampleRoad(road, distance, road.width / 2 + 0.2).point;
      box(metal, arm, 3.2, 0.12, 0.15, s.heading, 8.9);
      const head = sampleRoad(road, distance, road.width / 2 - 1).point;
      box(black, head, 1.1, 0.12, 0.45, s.heading, 8.85);
      box(lamp, head, 0.85, 0.035, 0.32, s.heading, 8.77);
      batch.instance(glow, p.set(head.x, head.y + 8.735, head.z), size.set(3.2, 1, 1.8), s.heading, glowGeometry);
      if (s.point.y > 3) box(bridgeConcrete, s.point, 0.9, s.point.y, 1.5, s.heading, -s.point.y / 2);
    }
    if (road.kind !== 'main') continue;
    for (let distance = 350; distance < road.length; distance += 1800) {
      const s = sampleRoad(road, distance);
      box(metal, s.point, road.width + 2.8, 0.2, 0.25, s.heading, 7.2);
      for (const side of [-1, 1]) {
        const at = sampleRoad(road, distance, side * (road.width / 2 + 1.2)).point;
        box(metal, at, 0.18, 7.2, 0.18, s.heading, 3.6);
      }
      const material = new THREE.MeshStandardMaterial({ map: signTexture('城市主路', '辅路出口注意右侧'), roughness: 0.65, side: THREE.DoubleSide });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(road.width - 1, 12), 3), material);
      sign.position.set(s.point.x, s.point.y + 5.65, s.point.z);
      sign.rotation.y = s.heading + Math.PI;
      group.add(sign);
    }
  }
  return obstacles;
}
