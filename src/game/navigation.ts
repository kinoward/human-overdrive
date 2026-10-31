import type { Point3, RoadPath, RoadPosition } from '../types';
import { RoadIndex, sampleRoad } from './road-network';
import { TrafficNetwork, angleDifference, clamp, type TrafficLeg } from './traffic-network';

interface NavigationLeg extends TrafficLeg { wrongWay: boolean }

export interface PoliceRoutePoint extends Point3 {
  road: RoadPath;
  distance: number;
  sign: 1 | -1;
}

export interface PoliceRoute {
  points: PoliceRoutePoint[];
  length: number;
  wrongWay: boolean;
}

export class RoadNavigation {
  readonly traffic: TrafficNetwork;
  private index: RoadIndex;
  private roadIndexes = new Map<RoadPath, RoadIndex>();
  private legs: NavigationLeg[] = [];
  private outgoing = new Map<string, NavigationLeg[]>();
  private roadLegs = new Map<RoadPath, NavigationLeg[]>();

  constructor(readonly roads: RoadPath[]) {
    this.index = new RoadIndex(roads);
    this.traffic = new TrafficNetwork(roads);
    for (const source of this.traffic.legs) {
      this.addLeg({ ...source, id: this.legs.length, wrongWay: false });
      if (source.road.oneWay) this.addLeg({ ...source, id: this.legs.length, start: source.end, end: source.start, sign: -1, from: source.to, to: source.from, wrongWay: true });
    }
  }

  private addLeg(leg: NavigationLeg) {
    this.legs.push(leg);
    if (!this.outgoing.has(leg.from)) this.outgoing.set(leg.from, []);
    this.outgoing.get(leg.from)!.push(leg);
    if (!this.roadLegs.has(leg.road)) this.roadLegs.set(leg.road, []);
    this.roadLegs.get(leg.road)!.push(leg);
  }

  private roadIndex(road: RoadPath) {
    if (!this.roadIndexes.has(road)) this.roadIndexes.set(road, new RoadIndex([road]));
    return this.roadIndexes.get(road)!;
  }

  locate(position: Point3, previous?: RoadPosition, heading?: number): RoadPosition | null {
    const nearest = this.index.nearest(position.x, position.z, position.y);
    if (!previous || !nearest) return nearest;
    const candidates = new Set([previous.road, nearest.road]);
    for (const junction of previous.road.junctions) {
      if (Math.hypot(junction.point.x - position.x, junction.point.z - position.z) > 55) continue;
      const road = this.roads.find(item => item.id === junction.roadId);
      if (road) candidates.add(road);
    }
    let best = nearest, score = Infinity;
    for (const road of candidates) {
      const location = this.roadIndex(road).nearest(position.x, position.z, position.y)!;
      const outside = Math.max(0, Math.abs(location.offset) - road.width / 2);
      const connected = road === previous.road || previous.road.junctions.some(junction => junction.roadId === road.id && Math.hypot(junction.point.x - position.x, junction.point.z - position.z) < 55);
      const alignment = heading === undefined ? 0 : 1 - Math.abs(location.direction.x * Math.sin(heading) + location.direction.z * Math.cos(heading));
      const value = location.offset ** 2 + outside ** 2 * 8 + ((position.y - location.point.y) * 5) ** 2 + (connected ? 0 : 25) + alignment * 4;
      if (value < score) { best = location; score = value }
    }
    return best;
  }

  position(road: RoadPath, distance: number, offset = 0): RoadPosition {
    const sample = sampleRoad(road, distance, offset);
    return { road, distance: road.closed ? ((distance % road.length) + road.length) % road.length : clamp(distance, 0, road.length), offset, point: sample.point, direction: sample.direction };
  }

  legAt(location: RoadPosition, sign: 1 | -1, allowWrongWay = false): TrafficLeg | undefined {
    return this.roadLegs.get(location.road)?.find(leg => leg.sign === sign && (!leg.wrongWay || allowWrongWay) && (location.distance - leg.start) * sign >= 0 && (leg.end - location.distance) * sign >= 0);
  }

  advance(location: RoadPosition, distance: number, sign: 1 | -1, offset = location.offset): RoadPosition {
    let current = location, remaining = Math.abs(distance), direction: 1 | -1 = distance < 0 ? sign === 1 ? -1 : 1 : sign;
    for (let count = 0; count < 12; count++) {
      const leg = (this.roadLegs.get(current.road) ?? []).find(candidate => candidate.sign === direction && (current.distance - candidate.start) * direction >= -0.05 && (candidate.end - current.distance) * direction > 0.05);
      if (!leg) return this.position(current.road, current.distance, offset);
      const available = (leg.end - current.distance) * direction;
      if (remaining <= available) return this.position(current.road, current.distance + remaining * direction, offset);
      remaining -= available;
      const options = (this.outgoing.get(leg.to) ?? []).filter(candidate => this.connects(leg, candidate) && (!candidate.wrongWay || leg.wrongWay));
      options.sort((a, b) => this.turn(leg, a) - this.turn(leg, b));
      const next = options[0];
      if (!next) return this.position(current.road, leg.end - direction * 0.01, offset);
      current = this.position(next.road, next.start + next.sign * 0.001, offset);
      direction = next.sign;
      const margin = Math.max(0, next.road.width / 2 - 1.4);
      offset = clamp(offset, -margin, margin);
    }
    return current;
  }

  private turn(from: NavigationLeg, to: NavigationLeg) {
    const a = this.traffic.sample(from, Math.max(0, from.length - 3), 0).heading;
    const b = this.traffic.sample(to, Math.min(3, to.length), 0).heading;
    return Math.abs(angleDifference(a, b)) + (from.road === to.road ? -0.4 : 0);
  }

  private connects(from: NavigationLeg, to: NavigationLeg) {
    if (from.to !== to.from || (from.road === to.road && from.sign !== to.sign)) return false;
    const angle = this.turn(from, to) + (from.road === to.road ? 0.4 : 0);
    return angle < (from.road.kind === 'main' && to.road.kind === 'main' ? 1.4 : 1.8);
  }

  direct(from: RoadPosition, to: RoadPosition, heading: number, allowWrongWay = false): PoliceRoute | null {
    if (from.road !== to.road) return null;
    const baseHeading = Math.atan2(from.direction.x, from.direction.z);
    const sign: 1 | -1 = Math.cos(heading - baseHeading) >= 0 ? 1 : -1;
    if (Math.abs(angleDifference(baseHeading + (sign < 0 ? Math.PI : 0), heading)) > 1.35 || (sign < 0 && from.road.oneWay && !allowWrongWay)) return null;
    let length = (to.distance - from.distance) * sign;
    if (length < 0 && from.road.closed) length += from.road.length;
    if (length < 0 || length > 350) return null;
    const points: PoliceRoutePoint[] = [];
    const steps = Math.max(1, Math.ceil(length / 7));
    for (let step = 0; step <= steps; step++) {
      const location = this.position(from.road, from.distance + sign * length * step / steps);
      points.push({ ...location.point, road: from.road, distance: location.distance, sign });
    }
    return { points, length, wrongWay: from.road.oneWay && sign < 0 };
  }

  plan(from: RoadPosition, to: RoadPosition, heading: number, allowWrongWay = false, speed = 0): PoliceRoute | null {
    const starts = (this.roadLegs.get(from.road) ?? []).filter(leg => {
      if (leg.wrongWay && !allowWrongWay) return false;
      if ((from.distance - leg.start) * leg.sign < -0.05 || (leg.end - from.distance) * leg.sign < -0.05) return false;
      const sample = sampleRoad(from.road, from.distance);
      const difference = Math.abs(angleDifference(sample.heading + (leg.sign < 0 ? Math.PI : 0), heading));
      return difference < 1.35 || (speed < 1 && from.road.width > 13);
    });
    if (!starts.length) return null;
    const costs = new Float64Array(this.legs.length).fill(Infinity);
    const parents = new Int32Array(this.legs.length).fill(-1);
    const open = new Set<number>();
    for (const leg of starts) { costs[leg.id] = 0; open.add(leg.id) }
    let end: NavigationLeg | undefined;
    let visits = 0;
    while (open.size && visits++ < 5000) {
      let current = -1, best = Infinity;
      for (const id of open) {
        const leg = this.legs[id];
        const point = this.traffic.sample(leg, leg.length, 0).point;
        const estimate = costs[id] + Math.hypot(point.x - to.point.x, point.z - to.point.z) / 64;
        if (estimate < best) { best = estimate; current = id }
      }
      if (current < 0) break;
      const leg = this.legs[current];
      const beginning = parents[current] < 0 ? from.distance : leg.start;
      if (leg.road === to.road && (to.distance - beginning) * leg.sign >= -0.05 && (leg.end - to.distance) * leg.sign >= -0.05) { end = leg; break }
      open.delete(current);
      const remaining = Math.max(0, (leg.end - beginning) * leg.sign);
      for (const next of this.outgoing.get(leg.to) ?? []) {
        if ((next.wrongWay && !allowWrongWay) || !this.connects(leg, next) || next.road.width < 3.1) continue;
        const cost = costs[current] + remaining / (leg.road.kind === 'ramp' ? 17 : 48) * (leg.wrongWay ? 2 : 1) + this.turn(leg, next) * 1.5 + (leg.wrongWay !== next.wrongWay ? 3 : 0);
        if (cost >= costs[next.id]) continue;
        costs[next.id] = cost; parents[next.id] = current; open.add(next.id);
      }
    }
    if (!end) return null;
    const route: NavigationLeg[] = [];
    for (let id = end.id; id >= 0; id = parents[id]) { route.push(this.legs[id]); if (route.length > this.legs.length) return null }
    route.reverse();
    const points: PoliceRoutePoint[] = [];
    let length = 0;
    for (let i = 0; i < route.length; i++) {
      const leg = route[i];
      const a = i === 0 ? from.distance : leg.start;
      const b = i === route.length - 1 ? to.distance : leg.end;
      const span = Math.max(0, (b - a) * leg.sign);
      const steps = Math.max(1, Math.ceil(Math.min(span, 700 - length) / 7));
      for (let step = 0; step <= steps && length < 700; step++) {
        const distance = a + leg.sign * Math.min(span, 700 - length) * step / steps;
        const point = sampleRoad(leg.road, distance).point;
        if (points.length && Math.hypot(point.x - points.at(-1)!.x, point.y - points.at(-1)!.y, point.z - points.at(-1)!.z) < 0.05) continue;
        points.push({ ...point, road: leg.road, distance, sign: leg.sign });
      }
      length += span;
    }
    return { points, length, wrongWay: route.some(leg => leg.wrongWay) };
  }

  route(from: Point3, to: Point3): Point3[] {
    const start = this.locate(from), end = this.locate(to);
    return start && end ? this.plan(start, end, Math.atan2(start.direction.x, start.direction.z))?.points ?? [] : [];
  }

  sameCorridor(from: RoadPosition, to: RoadPosition, maximum = 80) {
    if (Math.abs(from.point.y - to.point.y) > 2.2) return false;
    if (from.road === to.road) {
      const distance = Math.abs(from.distance - to.distance);
      return Math.min(distance, from.road.closed ? from.road.length - distance : Infinity) < maximum;
    }
    return from.road.junctions.some(junction => junction.roadId === to.road.id && Math.hypot(junction.point.x - from.point.x, junction.point.z - from.point.z) + Math.hypot(junction.point.x - to.point.x, junction.point.z - to.point.z) < maximum);
  }
}
