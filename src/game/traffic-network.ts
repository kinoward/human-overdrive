import type { Point3, RoadPath } from '../types';
import { sampleRoad } from './road-network';

export interface TrafficLeg {
  id: number;
  road: RoadPath;
  start: number;
  end: number;
  sign: 1 | -1;
  length: number;
  from: string;
  to: string;
}

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const key = (point: Point3) => `${point.x.toFixed(2)},${point.y.toFixed(2)},${point.z.toFixed(2)}`;

export function laneCount(leg: TrafficLeg) {
  return leg.road.oneWay ? Math.max(1, leg.road.lanes) : Math.max(1, Math.floor(leg.road.lanes / 2));
}

export function laneOffset(leg: TrafficLeg, lane: number) {
  const count = laneCount(leg);
  return leg.road.oneWay ? ((lane + 0.5) / count - 0.5) * leg.road.width : leg.sign * (lane + 0.5) * leg.road.width / (2 * count);
}

export class TrafficNetwork {
  readonly legs: TrafficLeg[] = [];
  private outgoing = new Map<string, TrafficLeg[]>();
  private cells = new Map<string, { leg: TrafficLeg; along: number }[]>();

  constructor(roads: RoadPath[]) {
    for (const road of roads) {
      const junctions = new Set(road.junctions.map(junction => key(junction.point)));
      const cuts = [0];
      for (let i = 1; i < road.points.length - 1; i++) if (junctions.has(key(road.points[i]))) cuts.push(road.cumulative[i]);
      cuts.push(road.length);
      for (let i = 1; i < cuts.length; i++) {
        if (cuts[i] - cuts[i - 1] < 0.1) continue;
        const a = sampleRoad(road, cuts[i - 1]).point;
        const b = sampleRoad(road, cuts[i] === road.length && road.closed ? cuts[i] - 0.00001 : cuts[i]).point;
        for (const sign of road.oneWay ? [1] as const : [1, -1] as const) {
          const leg: TrafficLeg = { id: this.legs.length, road, start: sign > 0 ? cuts[i - 1] : cuts[i], end: sign > 0 ? cuts[i] : cuts[i - 1], sign, length: cuts[i] - cuts[i - 1], from: key(sign > 0 ? a : b), to: key(sign > 0 ? b : a) };
          this.legs.push(leg);
          if (!this.outgoing.has(leg.from)) this.outgoing.set(leg.from, []);
          this.outgoing.get(leg.from)!.push(leg);
          const steps = Math.max(1, Math.ceil(leg.length / 35));
          for (let step = 0; step < steps; step++) {
            const along = leg.length * (step + 0.5) / steps;
            const point = this.sample(leg, along, 0).point;
            const cell = `${Math.floor(point.x / 256)},${Math.floor(point.z / 256)}`;
            if (!this.cells.has(cell)) this.cells.set(cell, []);
            this.cells.get(cell)!.push({ leg, along });
          }
        }
      }
    }
  }

  sample(leg: TrafficLeg, along: number, offset: number) {
    const distance = leg.start + leg.sign * clamp(along, 0, leg.length);
    const sample = sampleRoad(leg.road, distance === leg.road.length && leg.road.closed ? distance - 0.00001 : distance, offset);
    return { point: sample.point, heading: sample.heading + (leg.sign < 0 ? Math.PI : 0), pitch: -Math.atan(sample.direction.y * leg.sign), distance };
  }

  mappedLane(from: TrafficLeg, to: TrafficLeg, offset: number) {
    const point = this.sample(from, from.length, offset).point;
    let lane = 0, best = Infinity;
    for (let i = 0; i < laneCount(to); i++) {
      const target = this.sample(to, 0, laneOffset(to, i)).point;
      const distance = Math.hypot(point.x - target.x, point.z - target.z);
      if (distance < best) { best = distance; lane = i }
    }
    return lane;
  }

  next(leg: TrafficLeg, lane: number, seed: number): TrafficLeg | undefined {
    const heading = this.sample(leg, Math.max(0, leg.length - 2), 0).heading;
    const options = (this.outgoing.get(leg.to) ?? []).filter(next => {
      if (next.road === leg.road && next.sign !== leg.sign) return false;
      const turn = angleDifference(this.sample(next, Math.min(2, next.length), 0).heading, heading);
      if (Math.abs(turn) > 1.35) return false;
      if (next.road.kind === 'ramp' && leg.road.kind !== 'ramp' && laneCount(leg) > 1) return turn < 0 ? lane === 0 : lane === laneCount(leg) - 1;
      return true;
    });
    if (!options.length) return undefined;
    const score = (next: TrafficLeg) => Math.abs(angleDifference(this.sample(next, Math.min(2, next.length), 0).heading, heading)) + (next.road === leg.road ? -1 : next.road.kind === leg.road.kind ? -0.4 : 0.2);
    options.sort((a, b) => score(a) - score(b));
    const branches = options.filter(next => next.road.kind === 'ramp' && next.road !== leg.road);
    const random = ((Math.imul(seed + 31, 1103515245) >>> 0) % 1000) / 1000;
    if (branches.length && options[0].road.kind !== 'ramp' && random < 0.13) return branches[seed % branches.length];
    return options[0];
  }

  spawnCandidates(focus: Point3, seed: number) {
    const cx = Math.floor(focus.x / 256), cz = Math.floor(focus.z / 256);
    const candidates: { leg: TrafficLeg; along: number }[] = [];
    for (let x = cx - 3; x <= cx + 3; x++) for (let z = cz - 3; z <= cz + 3; z++) {
      for (const candidate of this.cells.get(`${x},${z}`) ?? []) {
        const point = this.sample(candidate.leg, candidate.along, 0).point;
        const distance = Math.hypot(point.x - focus.x, point.z - focus.z);
        if (distance > 125 && distance < 560 && Math.abs(point.y + 0.79 - focus.y) < 15 && candidate.leg.length > 12 && candidate.along > 6 && candidate.leg.length - candidate.along > 6) candidates.push(candidate);
      }
    }
    if (!candidates.length) return candidates;
    const rotation = (seed * 37) % candidates.length;
    return [...candidates.slice(rotation), ...candidates.slice(0, rotation)];
  }
}
