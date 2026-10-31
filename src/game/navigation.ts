import type { Point3, RoadPath } from '../types';

interface Node { point: Point3; links: Map<number, number> }

export class RoadNavigation {
  private nodes: Node[] = [];

  constructor(roads: RoadPath[]) {
    const findOrAdd = (point: Point3) => {
      const existing = this.nodes.findIndex(node => Math.hypot(node.point.x - point.x, node.point.z - point.z) < 5);
      if (existing >= 0) return existing;
      this.nodes.push({ point: { ...point }, links: new Map() });
      return this.nodes.length - 1;
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
    for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
      const distance = Math.hypot(this.nodes[i].point.x - this.nodes[j].point.x, this.nodes[i].point.z - this.nodes[j].point.z);
      if (distance < 7) {
        this.nodes[i].links.set(j, distance);
        this.nodes[j].links.set(i, distance);
      }
    }
  }

  route(from: Point3, to: Point3): Point3[] {
    const closest = (p: Point3) => {
      let best = 0, distance = Infinity;
      for (let i = 0; i < this.nodes.length; i++) {
        const d = Math.hypot(p.x - this.nodes[i].point.x, p.z - this.nodes[i].point.z);
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
      for (const index of open) if (costs[index] < best) { best = costs[index]; current = index }
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
