import type { Point3, RoadPath, RoadPosition } from '../types';

export function sampleRoad(road: RoadPath, distance: number, offset = 0) {
  const along = road.closed ? ((distance % road.length) + road.length) % road.length : Math.max(0, Math.min(distance, road.length));
  let low = 1;
  let high = road.cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (road.cumulative[middle] < along) low = middle + 1;
    else high = middle;
  }
  const a = road.points[low - 1];
  const b = road.points[low];
  const length = road.cumulative[low] - road.cumulative[low - 1];
  const t = length ? (along - road.cumulative[low - 1]) / length : 0;
  const dx = b.x - a.x, dz = b.z - a.z;
  const horizontal = Math.hypot(dx, dz) || 1;
  const direction = { x: dx / horizontal, y: (b.y - a.y) / horizontal, z: dz / horizontal };
  return { point: { x: a.x + dx * t + direction.z * offset, y: a.y + (b.y - a.y) * t, z: a.z + dz * t - direction.x * offset }, direction, heading: Math.atan2(dx, dz) };
}

interface Segment { road: RoadPath; index: number; a: Point3; b: Point3; length: number }

export class RoadIndex {
  private cells = new Map<string, Segment[]>();
  private segments: Segment[] = [];

  constructor(readonly roads: RoadPath[]) {
    for (const road of roads) for (let index = 1; index < road.points.length; index++) {
      const a = road.points[index - 1], b = road.points[index];
      const segment = { road, index, a, b, length: Math.hypot(b.x - a.x, b.z - a.z) };
      if (segment.length < 0.001) continue;
      this.segments.push(segment);
      const padding = road.width / 2 + 4;
      for (let x = Math.floor((Math.min(a.x, b.x) - padding) / 128); x <= Math.floor((Math.max(a.x, b.x) + padding) / 128); x++) {
        for (let z = Math.floor((Math.min(a.z, b.z) - padding) / 128); z <= Math.floor((Math.max(a.z, b.z) + padding) / 128); z++) {
          const key = `${x},${z}`;
          if (!this.cells.has(key)) this.cells.set(key, []);
          this.cells.get(key)!.push(segment);
        }
      }
    }
  }

  private project(segment: Segment, x: number, z: number): RoadPosition {
    const { road, index, a, b, length } = segment;
    const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / length ** 2));
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    const direction = { x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length };
    const side = (x - point.x) * direction.z - (z - point.z) * direction.x;
    return { road, distance: road.cumulative[index - 1] + length * t, offset: Math.hypot(x - point.x, z - point.z) * (side < 0 ? -1 : 1), point, direction };
  }

  nearest(x: number, z: number, y?: number, roadMargin?: number): RoadPosition | null {
    const cx = Math.floor(x / 128), cz = Math.floor(z / 128);
    const candidates = new Set<Segment>();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const segment of this.cells.get(`${cx + dx},${cz + dz}`) ?? []) candidates.add(segment);
    let best: RoadPosition | null = null;
    let score = Infinity;
    for (const segment of candidates.size ? candidates : this.segments) {
      const projected = this.project(segment, x, z);
      if (roadMargin !== undefined && (Math.abs(projected.offset) > segment.road.width / 2 + roadMargin || y === undefined || Math.abs(y - projected.point.y) >= 0.8)) continue;
      const value = projected.offset ** 2 + (y === undefined ? 0 : ((y - projected.point.y) * 5) ** 2);
      if (value < score) { best = projected; score = value }
    }
    return best;
  }

  covers(point: Point3, exclude?: RoadPath, margin = 0, connectedOnly = false): boolean {
    for (const segment of this.cells.get(`${Math.floor(point.x / 128)},${Math.floor(point.z / 128)}`) ?? []) {
      if (segment.road === exclude) continue;
      if (connectedOnly && exclude && !exclude.junctions.some(junction => junction.roadId === segment.road.id && Math.hypot(junction.point.x - point.x, junction.point.z - point.z) < 80)) continue;
      const projected = this.project(segment, point.x, point.z);
      if (Math.abs(projected.offset) < segment.road.width / 2 + margin && Math.abs(projected.point.y - point.y) < 0.8) return true;
    }
    return false;
  }
}

const indexes = new WeakMap<RoadPath[], RoadIndex>();

function roadIndex(roads: RoadPath[]) {
  let index = indexes.get(roads);
  if (!index) { index = new RoadIndex(roads); indexes.set(roads, index) }
  return index;
}

export function nearestRoad(roads: RoadPath[], x: number, z: number, y?: number): RoadPosition | null {
  return roadIndex(roads).nearest(x, z, y);
}

export function roadAt(roads: RoadPath[], point: Point3, margin = 0): RoadPosition | null {
  return roadIndex(roads).nearest(point.x, point.z, point.y, margin);
}
