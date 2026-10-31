import * as THREE from 'three';
import type { RoadPath } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { roadCrossSection } from './road-cross-section';
import { SceneryBatch } from './scenery-batch';

function skidTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 512;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(canvas.width, canvas.height);
  let seed = 41729;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    const t = y / (canvas.height - 1);
    const edge = Math.min(Math.abs(x - 18), Math.abs(x - 110));
    const tire = 1 - THREE.MathUtils.smoothstep(edge, 5, 10);
    const fade = THREE.MathUtils.smoothstep(t, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(t, 0.72, 1));
    const groove = x % 7 < 2 ? 0.5 : 1;
    const grain = 0.48 + (seed >>> 24) / 255 * 0.52;
    const i = (y * canvas.width + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
    pixels.data[i + 3] = tire * fade * groove * grain * 245;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

export function addRoadSkidMarks(roads: RoadPath[], batch: SceneryBatch, index: RoadIndex) {
  const rubber = new THREE.MeshStandardMaterial({ map: skidTexture(), color: '#090b0d', transparent: true, opacity: 0.88, roughness: 1, metalness: 0, envMapIntensity: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
  rubber.userData.roadDecal = true;
  for (const road of roads) {
    if (road.kind !== 'main') continue;
    const section = roadCrossSection(road);
    const seed = [...road.id].reduce((value, character) => Math.imul(value, 31) + character.charCodeAt(0) | 0, 0) >>> 0;
    const spacing = 150 + seed % 79;
    for (let start = 38 + seed % 61, mark = 0; start < road.length - 35; start += spacing, mark++) {
      const length = 12 + (seed + mark * 13) % 19;
      const lane = (seed + mark) % road.lanes;
      const offset = section.laneOffset(lane);
      const middle = sampleRoad(road, start + length / 2, offset).point;
      if (road.junctions.some(junction => Math.hypot(junction.point.x - middle.x, junction.point.z - middle.z, (junction.point.y - middle.y) * 4) < 35)) continue;
      if ([start, start + length / 2, start + length].some(distance => index.covers(sampleRoad(road, distance, offset).point, road, 0.15))) continue;
      const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
      const steps = Math.ceil(length / 1.5), drift = ((seed + mark * 7) % 11 - 5) * 0.065;
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const sample = sampleRoad(road, start + t * length, offset + drift * Math.sin(t * Math.PI * 0.8));
        for (const side of [-1, 1]) positions.push(sample.point.x + sample.direction.z * side * 1.1, sample.point.y + 0.048, sample.point.z - sample.direction.x * side * 1.1);
        uvs.push(0, t, 1, t);
        if (step < steps) {
          const a = step * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      batch.surface(rubber, geometry, middle.x, middle.z);
    }
  }
}
