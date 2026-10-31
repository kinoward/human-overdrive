import * as THREE from 'three';
import type { RoadPath } from '../types';

function edge(road: RoadPath, index: number, offset: number, elevation: number) {
  const point = road.points[index];
  const last = road.points.length - 1;
  const before = road.points[index > 0 ? index - 1 : road.closed ? last - 1 : 0];
  const after = road.points[index < last ? index + 1 : road.closed ? 1 : last];
  const incoming = new THREE.Vector2(point.x - before.x, point.z - before.z);
  const outgoing = new THREE.Vector2(after.x - point.x, after.z - point.z);
  if (incoming.lengthSq() === 0) incoming.copy(outgoing);
  if (outgoing.lengthSq() === 0) outgoing.copy(incoming);
  incoming.normalize(); outgoing.normalize();
  const tangent = incoming.clone().add(outgoing).normalize();
  const scale = 1 / Math.max(0.5, tangent.dot(outgoing));
  return [point.x + tangent.y * offset * scale, point.y + elevation, point.z - tangent.x * offset * scale];
}

export function roadRibbon(road: RoadPath, index: number, width: number, offset: number, elevation: number, tile: number) {
  const left = offset - width / 2, right = offset + width / 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    ...edge(road, index - 1, left, elevation), ...edge(road, index - 1, right, elevation),
    ...edge(road, index, left, elevation), ...edge(road, index, right, elevation)
  ], 3));
  const start = road.cumulative[index - 1] / tile, end = road.cumulative[index] / tile;
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, start, width / tile, start, 0, end, width / tile, end], 2));
  geometry.setIndex([0, 2, 1, 1, 2, 3]); geometry.computeVertexNormals();
  return geometry;
}
