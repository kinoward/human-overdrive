import type { Point3, RoadPath } from '../types';
import { TrafficNetwork, angleDifference, clamp, laneCount, laneOffset, type TrafficLeg } from './traffic-network';

export interface TrafficObstacle {
  position: Point3;
  velocity: Point3;
  heading: number;
  length: number;
  width: number;
}

export interface TrafficAgent {
  id: number;
  road: RoadPath;
  distance: number;
  offset: number;
  speed: number;
  length: number;
  width: number;
  position: Point3;
  heading: number;
  pitch: number;
  relocated: boolean;
  braking: boolean;
  indicator: -1 | 0 | 1;
  wheelDistance: number;
  leg: TrafficLeg;
  along: number;
  lane: number;
  targetLane: number;
  changeFrom: number;
  changeTime: number;
  cooldown: number;
  decisionTime: number;
  desiredSpeed: number;
  acceleration: number;
  visits: number;
  next?: TrafficLeg;
  previous?: TrafficLeg;
  previousOffset: number;
}

interface SeenVehicle extends TrafficObstacle {
  agent?: TrafficAgent;
}

interface LaneView {
  gap: number;
  leaderSpeed: number;
  safe: boolean;
  rearBrake: number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const roadSpeed = (road: RoadPath, id: number) => (road.kind === 'main' ? 19 + id % 6 : road.kind === 'service' ? 8.5 + id % 5 * 0.8 : 7 + id % 4 * 0.7);
const bodyPosition = (agent: TrafficAgent) => ({ x: agent.position.x, y: agent.position.y + 0.79, z: agent.position.z });

export class TrafficSimulation {
  readonly cars: TrafficAgent[] = [];
  private network: TrafficNetwork;
  private obstacles: TrafficObstacle[] = [];

  constructor(roads: RoadPath[]) {
    this.network = new TrafficNetwork(roads);
  }

  addCar(id: number, length: number, width: number, focus: Point3): TrafficAgent | undefined {
    const candidate = this.findSpawn(id, length, width, focus);
    if (!candidate) return undefined;
    const { leg, along, lane } = candidate;
    const offset = laneOffset(leg, lane);
    const sample = this.network.sample(leg, along, offset);
    const agent: TrafficAgent = {
      id, length, width, road: leg.road, leg, along, lane, targetLane: lane, offset, distance: sample.distance,
      position: sample.point, heading: sample.heading, pitch: sample.pitch, speed: roadSpeed(leg.road, id) * 0.7,
      desiredSpeed: roadSpeed(leg.road, id), acceleration: 0, wheelDistance: 0, braking: false, indicator: 0,
      relocated: true, changeFrom: offset, changeTime: 3, cooldown: 2 + id % 4, decisionTime: id % 5 * 0.08,
      visits: 0, previousOffset: offset, next: this.network.next(leg, lane, id)
    };
    this.cars.push(agent);
    return agent;
  }

  update(dt: number, focus: Point3, obstacles: TrafficObstacle[]) {
    this.obstacles = obstacles;
    for (const agent of this.cars) {
      agent.relocated = false;
      if (Math.hypot(agent.position.x - focus.x, agent.position.z - focus.z) > 680) this.relocate(agent, focus);
    }
    const seen: SeenVehicle[] = [
      ...this.cars.map(agent => ({ agent, position: bodyPosition(agent), velocity: { x: Math.sin(agent.heading) * agent.speed, y: 0, z: Math.cos(agent.heading) * agent.speed }, heading: agent.heading, length: agent.length, width: agent.width })),
      ...obstacles
    ];
    for (const agent of this.cars) {
      agent.cooldown = Math.max(0, agent.cooldown - dt);
      agent.decisionTime -= dt;
      const targetOffset = laneOffset(agent.leg, agent.targetLane);
      let view = this.sense(agent, targetOffset, seen);
      const remaining = agent.leg.length - agent.along;
      if (agent.decisionTime <= 0) {
        agent.decisionTime = 0.25 + agent.id % 3 * 0.04;
        if (agent.cooldown === 0 && agent.changeTime >= 3 && laneCount(agent.leg) > 1 && agent.along > 15) {
          const currentAcceleration = this.followAcceleration(agent, view);
          let bestLane = agent.lane;
          let bestGain = 0.55;
          for (const lane of [agent.lane - 1, agent.lane + 1]) {
            if (lane < 0 || lane >= laneCount(agent.leg) || !this.laneChangeRoom(agent, lane)) continue;
            const candidate = this.sense(agent, laneOffset(agent.leg, lane), seen);
            const gain = this.followAcceleration(agent, candidate) - currentAcceleration - 0.3 * candidate.rearBrake;
            const reservation = this.cars.some(other => other !== agent && other.leg === agent.leg && other.targetLane === lane && Math.abs(other.along - agent.along) < 16 + agent.speed && other.changeTime < 3);
            if (candidate.safe && !reservation && gain > bestGain) { bestLane = lane; bestGain = gain }
          }
          if (bestLane !== agent.lane) {
            agent.targetLane = bestLane;
            agent.next = this.network.next(agent.leg, bestLane, agent.id + agent.visits);
            agent.changeFrom = agent.offset;
            agent.changeTime = 0;
            agent.cooldown = 5 + agent.id % 4;
            agent.indicator = bestLane > agent.lane ? 1 : -1;
            view = this.sense(agent, laneOffset(agent.leg, bestLane), seen);
          }
        }
      }
      if (agent.changeTime < 3) {
        const currentView = this.sense(agent, agent.offset, seen);
        if (currentView.gap < view.gap) view = currentView;
      }
      if (!agent.next) {
        const gap = remaining - agent.length / 2 - 2;
        if (gap < view.gap) view = { ...view, gap, leaderSpeed: 0 };
      } else if (this.requiresYield(agent) && remaining < 45 && !this.mergeSafe(agent, seen)) {
        const gap = remaining - agent.length / 2 - 2;
        if (gap < view.gap) view = { ...view, gap, leaderSpeed: 0 };
      }
      agent.desiredSpeed = this.targetSpeed(agent);
      agent.acceleration = clamp(this.followAcceleration(agent, view), -8, 2.1);
      const closing = agent.speed - view.leaderSpeed;
      if (closing > 0 && view.gap / closing < 1.2) agent.acceleration = -8;
      const nextSpeed = Math.max(0, agent.speed + agent.acceleration * dt);
      let advance = (agent.speed + nextSpeed) * dt * 0.5;
      if (view.gap < advance + 0.25 && view.leaderSpeed < agent.speed) advance = Math.max(0, view.gap - 0.2 + Math.max(0, view.leaderSpeed) * dt);
      agent.braking = agent.acceleration < -0.6 || advance < 0.001;
      agent.speed = advance < (agent.speed + nextSpeed) * dt * 0.5 - 0.001 ? advance / dt : nextSpeed;
      agent.changeTime = Math.min(3, agent.changeTime + dt);
      agent.offset = agent.changeFrom + (laneOffset(agent.leg, agent.targetLane) - agent.changeFrom) * smooth(agent.changeTime / 3);
      if (agent.changeTime >= 3) { agent.lane = agent.targetLane; agent.indicator = 0 }
      this.advance(agent, advance);
      agent.wheelDistance += advance;
      const sample = this.sample(agent, 0, agent.offset);
      agent.position = sample.point;
      agent.distance = agent.leg.start + agent.leg.sign * agent.along;
      const lookAhead = Math.max(1.5, Math.min(5, agent.speed * 0.18));
      const futureOffset = agent.changeFrom + (laneOffset(agent.leg, agent.targetLane) - agent.changeFrom) * smooth(Math.min(1, (agent.changeTime + lookAhead / Math.max(1, agent.speed)) / 3));
      const ahead = this.sample(agent, lookAhead, futureOffset);
      const dx = ahead.point.x - sample.point.x, dz = ahead.point.z - sample.point.z;
      if (Math.hypot(dx, dz) > 0.1) {
        const heading = Math.atan2(dx, dz);
        agent.heading += angleDifference(heading, agent.heading) * Math.min(1, dt * 8);
        agent.pitch = -Math.atan2(ahead.point.y - sample.point.y, Math.hypot(dx, dz));
      }
    }
  }

  private findSpawn(id: number, length: number, width: number, focus: Point3, exclude?: TrafficAgent) {
    for (const candidate of this.network.spawnCandidates(focus, id)) {
      const count = laneCount(candidate.leg);
      for (let attempt = 0; attempt < count; attempt++) {
        const lane = (id + attempt) % count;
        const point = this.network.sample(candidate.leg, candidate.along, laneOffset(candidate.leg, lane)).point;
        const spacing = Math.max(18, roadSpeed(candidate.leg.road, id) * 1.3);
        const occupied = this.cars.some(other => other !== exclude && Math.abs(other.position.y - point.y) < 2.5 && Math.hypot(other.position.x - point.x, other.position.z - point.z) < Math.max(spacing, (length + other.length) / 2 + 5));
        const blocked = this.obstacles.some(other => Math.abs(other.position.y - point.y - 0.79) < 2.5 && Math.hypot(other.position.x - point.x, other.position.z - point.z) < (length + other.length) / 2 + width + 12);
        if (!occupied && !blocked) return { ...candidate, lane };
      }
    }
    return undefined;
  }

  private relocate(agent: TrafficAgent, focus: Point3) {
    const candidate = this.findSpawn(agent.id + agent.visits * 13, agent.length, agent.width, focus, agent);
    if (!candidate) return;
    agent.leg = candidate.leg; agent.road = candidate.leg.road; agent.along = candidate.along;
    agent.lane = candidate.lane; agent.targetLane = candidate.lane;
    agent.offset = laneOffset(agent.leg, agent.lane); agent.changeFrom = agent.offset;
    agent.changeTime = 3; agent.cooldown = 3; agent.indicator = 0;
    agent.speed = roadSpeed(agent.road, agent.id) * 0.7; agent.desiredSpeed = roadSpeed(agent.road, agent.id);
    agent.next = this.network.next(agent.leg, agent.lane, agent.id + ++agent.visits);
    agent.previous = undefined;
    const sample = this.network.sample(agent.leg, agent.along, agent.offset);
    agent.position = sample.point; agent.distance = sample.distance; agent.heading = sample.heading; agent.pitch = sample.pitch;
    agent.relocated = true;
  }

  private targetSpeed(agent: TrafficAgent) {
    let speed = roadSpeed(agent.road, agent.id);
    const a = this.sample(agent, 2, agent.offset);
    const b = this.sample(agent, 16, agent.offset);
    const c = this.sample(agent, 30, agent.offset);
    const curvature = Math.abs(angleDifference(Math.atan2(c.point.x - b.point.x, c.point.z - b.point.z), Math.atan2(b.point.x - a.point.x, b.point.z - a.point.z))) / 14;
    if (curvature > 0.002) speed = Math.min(speed, Math.sqrt(2.6 / curvature));
    if (agent.next && agent.next.road.kind !== agent.road.kind) {
      const nextSpeed = roadSpeed(agent.next.road, agent.id);
      speed = Math.min(speed, Math.sqrt(nextSpeed * nextSpeed + 5 * Math.max(0, agent.leg.length - agent.along - 5)));
    }
    return Math.max(3, speed);
  }

  private followAcceleration(agent: TrafficAgent, view: LaneView) {
    const desired = Math.max(3, agent.desiredSpeed);
    const dynamicGap = 2.8 + Math.max(0, agent.speed * (1.3 + agent.id % 3 * 0.15) + agent.speed * (agent.speed - view.leaderSpeed) / (2 * Math.sqrt(2.1 * 3)));
    return 2.1 * (1 - (agent.speed / desired) ** 4 - (dynamicGap / Math.max(0.2, view.gap)) ** 2);
  }

  private sense(agent: TrafficAgent, offset: number, seen: SeenVehicle[]): LaneView {
    const horizon = Math.min(130, Math.max(45, agent.speed * 4 + 15));
    const path: { point: Point3; along: number; heading: number }[] = [];
    for (let along = 0; along <= horizon; along += 7) {
      const sample = this.sample(agent, along, offset);
      path.push({ point: sample.point, heading: sample.heading, along });
    }
    let gap = Infinity, leaderSpeed = agent.desiredSpeed, safe = true, rearBrake = 0;
    const origin = this.network.sample(agent.leg, agent.along, offset);
    for (const other of seen) {
      if (other.agent === agent || Math.hypot(other.position.x - agent.position.x, other.position.z - agent.position.z) > horizon + 45) continue;
      const angle = angleDifference(other.heading, origin.heading);
      const halfLength = (Math.abs(Math.cos(angle)) * other.length + Math.abs(Math.sin(angle)) * other.width) / 2;
      const halfWidth = (Math.abs(Math.sin(angle)) * other.length + Math.abs(Math.cos(angle)) * other.width) / 2;
      const dx = other.position.x - origin.point.x, dz = other.position.z - origin.point.z;
      const alongNow = dx * Math.sin(origin.heading) + dz * Math.cos(origin.heading);
      const lateralNow = Math.abs(dx * Math.cos(origin.heading) - dz * Math.sin(origin.heading));
      const projectedSpeed = other.velocity.x * Math.sin(origin.heading) + other.velocity.z * Math.cos(origin.heading);
      if (Math.abs(other.position.y - origin.point.y - 0.79) < 2.2 && lateralNow < (agent.width / 2 + halfWidth + 0.45)) {
        const free = Math.abs(alongNow) - agent.length / 2 - halfLength;
        const closing = alongNow >= 0 ? agent.speed - projectedSpeed : projectedSpeed - agent.speed;
        const required = 4 + (alongNow >= 0 ? agent.speed : Math.max(0, projectedSpeed)) * 0.9 + Math.max(0, closing) * 1.5;
        if (free < required) safe = false;
        if (alongNow < 0 && projectedSpeed > 0) {
          const desiredGap = 2.8 + projectedSpeed * 1.3 + projectedSpeed * Math.max(0, closing) / (2 * Math.sqrt(2.1 * 3));
          const brake = 2.1 * (desiredGap / Math.max(0.2, free)) ** 2;
          rearBrake = Math.max(rearBrake, brake);
          if (brake > 4) safe = false;
        }
      }
      const predictionLimit = other.agent && Math.abs(angle) < 0.35 && other.agent.changeTime >= 3 ? 0 : 2;
      for (let prediction = 0; prediction <= predictionLimit; prediction += 0.5) {
        const x = other.position.x + other.velocity.x * prediction;
        const z = other.position.z + other.velocity.z * prediction;
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1], b = path[i];
          const vx = b.point.x - a.point.x, vz = b.point.z - a.point.z;
          const squared = vx * vx + vz * vz;
          if (squared < 0.01) continue;
          const t = clamp(((x - a.point.x) * vx + (z - a.point.z) * vz) / squared, 0, 1);
          const s = a.along + (b.along - a.along) * t;
          const y = a.point.y + (b.point.y - a.point.y) * t + 0.79;
          if (Math.abs(other.position.y + other.velocity.y * prediction - y) > 2.2) continue;
          const lateral = Math.hypot(x - a.point.x - vx * t, z - a.point.z - vz * t);
          if (lateral > agent.width / 2 + halfWidth + 0.3) continue;
          if (prediction > 0 && Math.abs(s / Math.max(agent.speed, 4) - prediction) > 0.9) continue;
          if (s < 0.5 && alongNow < -agent.length / 2) continue;
          const heading = Math.atan2(vx, vz);
          const forwardSpeed = other.velocity.x * Math.sin(heading) + other.velocity.z * Math.cos(heading);
          const free = s - agent.length / 2 - halfLength;
          if (free < gap) { gap = free; leaderSpeed = prediction > 0 && Math.abs(angle) > 0.6 ? 0 : forwardSpeed }
        }
      }
      if (other.agent && other.agent.changeTime < 3 && other.agent.leg === agent.leg && other.agent.targetLane !== other.agent.lane) {
        const reservedOffset = laneOffset(other.agent.leg, other.agent.targetLane);
        if (Math.abs(reservedOffset - offset) < agent.width + 0.4 && Math.abs(other.agent.along - agent.along) < 10 + agent.speed) safe = false;
      }
    }
    return { gap, leaderSpeed, safe, rearBrake };
  }

  private laneChangeRoom(agent: TrafficAgent, lane: number) {
    const required = agent.speed * 3 + 15;
    let leg = agent.leg, available = leg.length - agent.along, visits = agent.visits;
    for (let i = 0; i < 24; i++) {
      if (available > required) return true;
      const next = this.network.next(leg, lane, agent.id + visits);
      if (!next || next.road !== agent.road) return false;
      available += next.length;
      leg = next;
      visits++;
    }
    return false;
  }

  private requiresYield(agent: TrafficAgent) {
    if (!agent.next || agent.next.road === agent.road) return false;
    const next = agent.next;
    const incoming = this.network.sample(agent.leg, Math.max(0, agent.leg.length - 2), 0).heading;
    const outgoing = this.network.sample(next, Math.min(2, next.length), 0).heading;
    if (agent.road.kind === 'main') return false;
    return next.road.kind === 'main' || (agent.road.kind === 'ramp' && next.road.kind === 'service') || Math.abs(angleDifference(outgoing, incoming)) > 0.4;
  }

  private mergeSafe(agent: TrafficAgent, seen: SeenVehicle[]) {
    const next = agent.next!;
    const lane = this.network.mappedLane(agent.leg, next, agent.offset);
    const sample = this.network.sample(next, Math.min(next.length, agent.length / 2 + 1), laneOffset(next, lane));
    for (const other of seen) {
      if (other.agent === agent || Math.abs(other.position.y - sample.point.y - 0.79) > 2.2) continue;
      if (other.agent && other.agent.leg === agent.leg && other.agent.along < agent.along) continue;
      const sourceX = other.position.x - agent.position.x, sourceZ = other.position.z - agent.position.z;
      const sourceAlong = sourceX * Math.sin(agent.heading) + sourceZ * Math.cos(agent.heading);
      const sourceSide = Math.abs(sourceX * Math.cos(agent.heading) - sourceZ * Math.sin(agent.heading));
      if (sourceAlong < 0 && sourceSide < (agent.width + other.width) / 2 + 0.4 && Math.abs(angleDifference(other.heading, agent.heading)) < 0.3) continue;
      const dx = other.position.x - sample.point.x, dz = other.position.z - sample.point.z;
      const along = dx * Math.sin(sample.heading) + dz * Math.cos(sample.heading);
      const side = Math.abs(dx * Math.cos(sample.heading) - dz * Math.sin(sample.heading));
      if (side > (agent.width + other.width) / 2 + 0.5) continue;
      const speed = Math.max(0, other.velocity.x * Math.sin(sample.heading) + other.velocity.z * Math.cos(sample.heading));
      const gap = Math.abs(along) - (agent.length + other.length) / 2;
      if (gap < 4 + (along >= 0 ? agent.speed : speed) * 1.1) return false;
    }
    return true;
  }

  private advance(agent: TrafficAgent, advance: number) {
    agent.along += advance;
    let transitions = 0;
    while (agent.along >= agent.leg.length && agent.next && transitions++ < 8) {
      agent.along -= agent.leg.length;
      agent.previous = agent.leg; agent.previousOffset = agent.offset;
      const next = agent.next;
      if (next.road !== agent.road) {
        agent.lane = this.network.mappedLane(agent.leg, next, agent.offset);
        agent.targetLane = agent.lane; agent.offset = laneOffset(next, agent.lane); agent.changeFrom = agent.offset;
        agent.changeTime = 3; agent.indicator = 0;
      }
      agent.leg = next; agent.road = next.road;
      agent.next = this.network.next(next, agent.targetLane, agent.id + ++agent.visits);
    }
    agent.along = Math.min(agent.along, agent.leg.length);
  }

  private sample(agent: TrafficAgent, advance: number, offset: number) {
    let leg = agent.leg, along = agent.along + advance;
    let next = agent.next, previous = agent.previous, previousOffset = agent.previousOffset;
    let lane = agent.targetLane, count = 0;
    while (along > leg.length && next && count++ < 8) {
      along -= leg.length;
      previous = leg; previousOffset = offset;
      if (next.road !== leg.road) {
        lane = this.network.mappedLane(leg, next, offset);
        offset = laneOffset(next, lane);
      }
      leg = next;
      next = this.network.next(leg, lane, agent.id + agent.visits + count);
    }
    const base = this.network.sample(leg, along, offset);
    let from: TrafficLeg | undefined, to: TrafficLeg | undefined, fromOffset = offset, toOffset = offset, progress = 0;
    if (next && next.road !== leg.road && leg.length - along < Math.min(10, leg.length * 0.3, next.length * 0.3)) {
      from = leg; to = next;
      toOffset = laneOffset(next, this.network.mappedLane(leg, next, offset));
      const span = Math.min(10, leg.length * 0.3, next.length * 0.3);
      progress = (span - (leg.length - along)) / (span * 2);
    } else if (previous && previous.road !== leg.road && along < Math.min(10, previous.length * 0.3, leg.length * 0.3)) {
      from = previous; to = leg; fromOffset = previousOffset;
      const span = Math.min(10, previous.length * 0.3, leg.length * 0.3);
      progress = (span + along) / (span * 2);
    }
    if (!from || !to) return base;
    const span = Math.min(10, from.length * 0.3, to.length * 0.3);
    const a = this.network.sample(from, from.length - span, fromOffset);
    const b = this.network.sample(to, span, toOffset);
    const t = clamp(progress, 0, 1), u = 1 - t;
    const control = span * 0.67;
    const point = {
      x: u ** 3 * a.point.x + 3 * u * u * t * (a.point.x + Math.sin(a.heading) * control) + 3 * u * t * t * (b.point.x - Math.sin(b.heading) * control) + t ** 3 * b.point.x,
      y: a.point.y + (b.point.y - a.point.y) * smooth(t),
      z: u ** 3 * a.point.z + 3 * u * u * t * (a.point.z + Math.cos(a.heading) * control) + 3 * u * t * t * (b.point.z - Math.cos(b.heading) * control) + t ** 3 * b.point.z
    };
    return { ...base, point, heading: a.heading + angleDifference(b.heading, a.heading) * smooth(t) };
  }
}
