import type { Point3, RoadPath } from '../types';

interface Node { point: Point3; links: Map<number, number> }

export class RoadNavigation {
  private nodes: Node[] = [];

  constructor(roads: RoadPath[]) {
    const keys = new Map<string, number>();
    const findOrAdd = (point: Point3) => {
      const key = `${point.x.toFixed(2)},${point.y.toFixed(2)},${point.z.toFixed(2)}`;
      const existing = keys.get(key);
      if (existing !== undefined) return existing;
      const index = this.nodes.length;
      this.nodes.push({ point: { ...point }, links: new Map() });
      keys.set(key, index);
      return index;
    };
    for (const road of roads) {
      let previous = -1;
      for (let i = 0; i < road.points.length - 1; i++) {
        const a = road.points[i], b = road.points[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 40));
        for (let j = 0; j <= steps; j++) {
          const t = j / steps;
          const index = findOrAdd({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
          if (previous >= 0 && previous !== index) {
            const p = this.nodes[previous].point;
            const distance = Math.hypot(p.x - this.nodes[index].point.x, p.z - this.nodes[index].point.z);
            this.nodes[previous].links.set(index, distance);
            this.nodes[index].links.set(previous, distance);
          }
          previous = index;
        }
      }
    }
  }

  route(from: Point3, to: Point3): Point3[] {
    const closest = (p: Point3) => {
      let best = 0, distance = Infinity;
      for (let i = 0; i < this.nodes.length; i++) {
        const d = Math.hypot(p.x - this.nodes[i].point.x, (p.y - this.nodes[i].point.y) * 5, p.z - this.nodes[i].point.z);
        if (d < distance) { distance = d; best = i }
      }
      return best;
    };
    const start = closest(from), end = closest(to);
    if (start === end) return [to];
    const costs = new Float64Array(this.nodes.length).fill(Infinity);
    const parents = new Int32Array(this.nodes.length).fill(-1);
    const open = new Set([start]);
    costs[start] = 0;
    while (open.size) {
      let current = -1, best = Infinity;
      for (const index of open) { const point = this.nodes[index].point; const estimate = costs[index] + Math.hypot(point.x - to.x, point.z - to.z); if (estimate < best) { best = estimate; current = index } }
      if (current < 0 || current === end) break;
      open.delete(current);
      for (const [next, length] of this.nodes[current].links) if (costs[current] + length < costs[next]) {
        costs[next] = costs[current] + length;
        parents[next] = current;
        open.add(next);
      }
    }
    if (parents[end] < 0) return [];
    const path = [to];
    for (let current = end; current !== start && current >= 0; current = parents[current]) path.push(this.nodes[current].point);
    return path.reverse();
  }
}
