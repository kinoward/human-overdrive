import type { Point3, RoadPath } from '../types';
import { nearestRoad, sampleRoad } from './road-network';
import { roadCrossSection } from './road-cross-section';
import type { TrafficFocus } from './traffic';
import type { TrafficVehicleSpec } from './traffic-vehicles';

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

export function travelHeading(focus: TrafficFocus) {
  return focus.speed > 3 && focus.velocity && Math.hypot(focus.velocity.x, focus.velocity.z) > 1 ? Math.atan2(focus.velocity.x, focus.velocity.z) : focus.heading;
}

export function laneCount(leg: TrafficLeg) {
  return leg.road.oneWay ? Math.max(1, leg.road.lanes) : Math.max(1, Math.floor(leg.road.lanes / 2));
}

export function laneOffset(leg: TrafficLeg, lane: number) {
  const count = laneCount(leg);
  return leg.road.oneWay ? roadCrossSection(leg.road).laneOffset(lane) : -leg.sign * (leg.road.width / 2 - (lane + 0.5) * leg.road.width / (2 * count));
}

export class TrafficNetwork {
  readonly legs: TrafficLeg[] = [];
  private outgoing = new Map<string, TrafficLeg[]>();
  private incoming = new Map<string, TrafficLeg[]>();
  private narrowExits = new Map<number, boolean>();
  private profileLegs = new Map<string, Set<number>>();
  private roadCurvature = new Map<string, number>();
  private cells = new Map<string, { leg: TrafficLeg; along: number }[]>();

  constructor(private roads: RoadPath[]) {
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
          if (!this.incoming.has(leg.to)) this.incoming.set(leg.to, []);
          this.incoming.get(leg.to)!.push(leg);
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

  private connects(from: TrafficLeg, to: TrafficLeg) {
    if (from.to !== to.from || (from.road === to.road && from.sign !== to.sign)) return false;
    const incoming = this.sample(from, Math.max(0, from.length - 2), 0).heading;
    const outgoing = this.sample(to, Math.min(2, to.length), 0).heading;
    const maximum = from.road.kind === 'main' && to.road.kind === 'main' ? 1.35 : 1.75;
    return Math.abs(angleDifference(outgoing, incoming)) <= maximum;
  }

  isMerge(from: TrafficLeg, to: TrafficLeg) {
    if (from.road === to.road) return false;
    return (this.incoming.get(to.from) ?? []).some(other => other !== from && this.connects(other, to) && other.road !== from.road);
  }

  canExitNarrow(leg: TrafficLeg) {
    if (leg.road.oneWay || leg.road.lanes > 1) return true;
    const cached = this.narrowExits.get(leg.id);
    if (cached !== undefined) return cached;
    const queue = [leg];
    const visited = new Set<number>();
    while (queue.length) {
      const current = queue.pop()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      for (const next of this.outgoing.get(current.to) ?? []) {
        if (!this.connects(current, next)) continue;
        if (next.road !== leg.road) { this.narrowExits.set(leg.id, true); return true }
        queue.push(next);
      }
    }
    this.narrowExits.set(leg.id, false);
    return false;
  }

  private fits(leg: TrafficLeg, profile: TrafficVehicleSpec) {
    const width = roadCrossSection(leg.road).travelWidth / (leg.road.oneWay ? laneCount(leg) : laneCount(leg) * 2);
    if (width < profile.width + (profile.heavy ? 0.45 : 0.15)) return false;
    if (!profile.heavy) return true;
    if (!leg.road.oneWay && leg.road.lanes === 1) return false;
    if (leg.road.kind !== 'ramp') return true;
    if (leg.road.length < Math.max(40, profile.length * 5)) return false;
    let curvature = this.roadCurvature.get(leg.road.id);
    if (curvature === undefined) {
      curvature = 0;
      for (let i = 1; i < leg.road.points.length - 1; i++) {
        const a = leg.road.points[i - 1], b = leg.road.points[i], c = leg.road.points[i + 1];
        const incoming = Math.atan2(b.x - a.x, b.z - a.z), outgoing = Math.atan2(c.x - b.x, c.z - b.z);
        const span = Math.max(1, (Math.hypot(b.x - a.x, b.z - a.z) + Math.hypot(c.x - b.x, c.z - b.z)) / 2);
        curvature = Math.max(curvature, Math.abs(angleDifference(outgoing, incoming)) / span);
      }
      this.roadCurvature.set(leg.road.id, curvature);
    }
    return curvature < 1 / Math.max(15, profile.length * 2.1);
  }

  private profileConnects(from: TrafficLeg, to: TrafficLeg, profile?: TrafficVehicleSpec) {
    if (!this.connects(from, to)) return false;
    if (!profile?.heavy) return true;
    const a = this.sample(from, Math.max(0, from.length - 2), 0).heading;
    const b = this.sample(to, Math.min(2, to.length), 0).heading;
    return Math.abs(angleDifference(a, b)) < 0.85;
  }

  allows(leg: TrafficLeg, profile?: TrafficVehicleSpec) {
    if (!profile) return true;
    if (!this.fits(leg, profile)) return false;
    if (!profile.heavy) return true;
    let viable = this.profileLegs.get(profile.id);
    if (!viable) {
      viable = new Set(this.legs.filter(candidate => this.fits(candidate, profile)).map(candidate => candidate.id));
      const counts = new Map<number, number>(), predecessors = new Map<number, number[]>();
      for (const id of viable) {
        const current = this.legs[id];
        const next = (this.outgoing.get(current.to) ?? []).filter(candidate => viable!.has(candidate.id) && this.profileConnects(current, candidate, profile));
        counts.set(id, next.length);
        for (const candidate of next) {
          if (!predecessors.has(candidate.id)) predecessors.set(candidate.id, []);
          predecessors.get(candidate.id)!.push(id);
        }
      }
      const queue = [...viable].filter(id => counts.get(id) === 0);
      while (queue.length) {
        const id = queue.pop()!;
        viable.delete(id);
        for (const previous of predecessors.get(id) ?? []) {
          const remaining = counts.get(previous)! - 1;
          counts.set(previous, remaining);
          if (remaining === 0) queue.push(previous);
        }
      }
      this.profileLegs.set(profile.id, viable);
    }
    return viable.has(leg.id);
  }

  next(leg: TrafficLeg, lane: number, seed: number, profile?: TrafficVehicleSpec): TrafficLeg | undefined {
    const heading = this.sample(leg, Math.max(0, leg.length - 2), 0).heading;
    const options = (this.outgoing.get(leg.to) ?? []).filter(next => {
      if (!this.profileConnects(leg, next, profile) || !this.canExitNarrow(next) || !this.allows(next, profile)) return false;
      const turn = angleDifference(this.sample(next, Math.min(2, next.length), 0).heading, heading);
      if (next.road.kind === 'ramp' && leg.road.kind !== 'ramp' && laneCount(leg) > 1) return turn < 0 ? lane === 0 : lane === laneCount(leg) - 1;
      return true;
    });
    if (!options.length) return undefined;
    const score = (next: TrafficLeg) => Math.abs(angleDifference(this.sample(next, Math.min(2, next.length), 0).heading, heading)) + (next.road === leg.road ? -1 : next.road.kind === leg.road.kind ? -0.4 : 0.2);
    options.sort((a, b) => score(a) - score(b));
    const branches = options.filter(next => next.road.kind === 'ramp' && next.road !== leg.road);
    const random = ((Math.imul(seed + 31, 1103515245) >>> 0) % 1000) / 1000;
    if (branches.length && options[0].road.kind !== 'ramp' && random < (profile?.heavy ? 0.04 : 0.13)) return branches[seed % branches.length];
    return options[0];
  }

  private previous(leg: TrafficLeg, profile: TrafficVehicleSpec) {
    const heading = this.sample(leg, Math.min(2, leg.length), 0).heading;
    return (this.incoming.get(leg.from) ?? []).filter(previous => this.profileConnects(previous, leg, profile) && this.allows(previous, profile)).sort((a, b) => {
      const score = (candidate: TrafficLeg) => Math.abs(angleDifference(this.sample(candidate, Math.max(0, candidate.length - 2), 0).heading, heading)) + (candidate.road === leg.road ? -1 : 0);
      return score(a) - score(b);
    })[0];
  }

  anchor(focus: TrafficFocus) {
    const near = nearestRoad(this.roads, focus.position.x, focus.position.z, focus.position.y - 0.79);
    if (!near) return undefined;
    const sample = sampleRoad(near.road, near.distance);
    const sign = near.road.oneWay || Math.cos(travelHeading(focus) - sample.heading) >= 0 ? 1 : -1;
    const leg = this.legs.find(candidate => candidate.road === near.road && candidate.sign === sign && near.distance >= Math.min(candidate.start, candidate.end) - 0.01 && near.distance <= Math.max(candidate.start, candidate.end) + 0.01);
    return leg ? { leg, along: (near.distance - leg.start) * leg.sign, observedSign: Math.cos(travelHeading(focus) - this.sample(leg, 0, 0).heading) >= 0 ? 1 : -1 } : undefined;
  }

  private walk(leg: TrafficLeg, along: number, distance: number, lane: number, seed: number, profile: TrafficVehicleSpec) {
    along += distance;
    for (let count = 0; count < 64; count++) {
      if (along >= 0 && along < leg.length) return { leg, along };
      if (along >= leg.length) {
        const next = this.next(leg, lane, seed + count, profile);
        if (!next) return undefined;
        along -= leg.length;
        lane = this.mappedLane(leg, next, laneOffset(leg, Math.min(lane, laneCount(leg) - 1)));
        leg = next;
      } else {
        const previous = this.previous(leg, profile);
        if (!previous) return undefined;
        along += previous.length;
        leg = previous;
        lane = Math.min(lane, laneCount(leg) - 1);
      }
    }
    return undefined;
  }

  spawnCandidates(focus: TrafficFocus, seed: number, profile: TrafficVehicleSpec, replenishing: boolean, rearPriority = false) {
    const candidates: { leg: TrafficLeg; along: number; primary: boolean; observedDistance: number; priority: number }[] = [];
    const anchor = this.anchor(focus);
    if (anchor && this.allows(anchor.leg, profile)) {
      const start = replenishing ? 220 : anchor.leg.road.kind === 'main' ? 55 : 42;
      const end = replenishing ? 420 : anchor.leg.road.kind === 'main' ? 460 : 210;
      const target = start + (seed % 8) * (end - start) / 8;
      const lane = profile.heavy ? 0 : seed % laneCount(anchor.leg);
      for (let distance = start; distance <= end; distance += 17) {
        const candidate = this.walk(anchor.leg, anchor.along, distance * anchor.observedSign, lane, seed, profile);
        if (candidate) candidates.push({ ...candidate, primary: true, observedDistance: distance, priority: (seed % 10 === 9 ? 3 : 0) + Math.abs(distance - target) / 100 });
      }
      if (replenishing && rearPriority && anchor.observedSign > 0) {
        const rearTarget = 180 + seed % 7 * 22;
        for (let distance = 180; distance <= 340; distance += 20) {
          const candidate = this.walk(anchor.leg, anchor.along, -distance, lane, seed, profile);
          if (candidate) candidates.push({ ...candidate, primary: true, observedDistance: -distance, priority: -2 + Math.abs(distance - rearTarget) / 100 });
        }
      }
      if (!replenishing) for (let distance = 65; distance <= 160; distance += 25) {
        const candidate = this.walk(anchor.leg, anchor.along, -distance * anchor.observedSign, lane, seed, profile);
        if (candidate) candidates.push({ ...candidate, primary: true, observedDistance: -distance, priority: seed % 10 === 8 ? 0 : 4 });
      }
    }
    const cx = Math.floor(focus.position.x / 256), cz = Math.floor(focus.position.z / 256);
    for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) {
      for (const candidate of this.cells.get(`${x},${z}`) ?? []) {
        if (!this.allows(candidate.leg, profile)) continue;
        const sample = this.sample(candidate.leg, candidate.along, 0);
        const dx = sample.point.x - focus.position.x, dz = sample.point.z - focus.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < (replenishing ? 160 : 55) || distance > 470 || Math.abs(sample.point.y + 0.79 - focus.position.y) > 12) continue;
        const heading = travelHeading(focus);
        const observedDistance = dx * Math.sin(heading) + dz * Math.cos(heading);
        const side = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
        const primary = !!anchor && candidate.leg.road === anchor.leg.road && candidate.leg.sign === anchor.leg.sign && side < anchor.leg.road.width;
        if (candidate.along < profile.length / 2 + 2 || candidate.leg.length - candidate.along < profile.length / 2 + 2) continue;
        candidates.push({ ...candidate, primary, observedDistance, priority: primary ? 2 + distance / 400 : (seed % 10 === 9 ? 0 : 5) + distance / 500 });
      }
    }
    return candidates.sort((a, b) => a.priority - b.priority);
  }
}
