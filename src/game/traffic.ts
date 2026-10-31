import type { Point3, RoadPath } from '../types';
import { TrafficNetwork, angleDifference, clamp, laneCount, laneOffset, travelHeading, type TrafficLeg } from './traffic-network';
import { TrafficRightOfWay } from './traffic-right-of-way';
import type { TrafficVehicleSpec } from './traffic-vehicles';

export interface TrafficFocus {
  position: Point3;
  heading: number;
  speed: number;
  lookBack: boolean;
  velocity?: Point3;
}

export interface TrafficObstacle {
  position: Point3;
  velocity: Point3;
  heading: number;
  length: number;
  width: number;
}

export interface TrafficAgent {
  id: number;
  profile: TrafficVehicleSpec;
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
  changePaused: boolean;
  changeReturning: boolean;
  cooldown: number;
  decisionTime: number;
  desiredSpeed: number;
  acceleration: number;
  visits: number;
  next?: TrafficLeg;
  previous?: TrafficLeg;
  previousOffset: number;
}

interface TrafficPose {
  position: Point3;
  heading: number;
}

interface SeenVehicle extends TrafficObstacle {
  agent?: TrafficAgent;
  trajectory: TrafficPose[];
}

interface LaneView {
  gap: number;
  leaderSpeed: number;
  safe: boolean;
  rearBrake: number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const roadSpeed = (road: RoadPath, id: number, profile: TrafficVehicleSpec) => profile.speeds[road.kind] * (0.92 + id % 5 * 0.025);
const bodyPosition = (agent: TrafficAgent) => ({ x: agent.position.x, y: agent.position.y + 0.79, z: agent.position.z });

export class TrafficSimulation {
  readonly cars: TrafficAgent[] = [];
  private network: TrafficNetwork;
  private obstacles: TrafficObstacle[] = [];
  private rightOfWay: TrafficRightOfWay;
  private recycleTimer = 0;
  private viewGuard = 0;
  private previousLookBack = false;

  constructor(roads: RoadPath[]) {
    this.network = new TrafficNetwork(roads);
    this.rightOfWay = new TrafficRightOfWay(this.network);
  }

  addCar(id: number, profile: TrafficVehicleSpec, focus: TrafficFocus): TrafficAgent | undefined {
    const { length, width } = profile;
    const candidate = this.findSpawn(id, profile, focus);
    if (!candidate) return undefined;
    const { leg, along, lane } = candidate;
    const offset = laneOffset(leg, lane);
    const sample = this.network.sample(leg, along, offset);
    const agent: TrafficAgent = {
      id, profile, length, width, road: leg.road, leg, along, lane, targetLane: lane, offset, distance: sample.distance,
      position: sample.point, heading: sample.heading, pitch: sample.pitch, speed: roadSpeed(leg.road, id, profile) * 0.58,
      desiredSpeed: roadSpeed(leg.road, id, profile), acceleration: 0, wheelDistance: 0, braking: false, indicator: 0,
      relocated: true, changeFrom: offset, changeTime: 3, changePaused: false, changeReturning: false, cooldown: 2 + id % 4, decisionTime: id % 5 * 0.08,
      visits: 0, previousOffset: offset, next: this.network.next(leg, lane, id, profile)
    };
    this.cars.push(agent);
    return agent;
  }

  update(dt: number, focus: TrafficFocus, obstacles: TrafficObstacle[]) {
    this.obstacles = obstacles;
    if (focus.lookBack !== this.previousLookBack) { this.previousLookBack = focus.lookBack; this.viewGuard = 1 }
    this.viewGuard = Math.max(0, this.viewGuard - dt);
    this.rightOfWay.update(this.cars, obstacles, dt);
    for (const agent of this.cars) agent.relocated = false;
    this.recycleTimer -= dt;
    if (this.recycleTimer <= 0) {
      this.recycleTimer = 0.18;
      const recyclable = this.cars.filter(agent => this.canRecycle(agent, focus)).sort((a, b) => Math.hypot(b.position.x - focus.position.x, b.position.z - focus.position.z) - Math.hypot(a.position.x - focus.position.x, a.position.z - focus.position.z));
      for (const agent of recyclable) {
        this.relocate(agent, focus);
        if (agent.relocated) break;
      }
    }
    if (this.cars.some(agent => agent.relocated)) this.rightOfWay.update(this.cars, obstacles, 0);
    const snapshots = this.cars.map(agent => ({ ...agent, position: { ...agent.position } }));
    const seen = this.observe(snapshots, obstacles);
    const plans = snapshots.map(agent => ({ ...agent, position: { ...agent.position } }));
    const proposals: { agent: TrafficAgent; lane: number; gain: number }[] = [];
    for (const agent of plans) {
      agent.cooldown = Math.max(0, agent.cooldown - dt);
      agent.decisionTime -= dt;
      agent.desiredSpeed = this.targetSpeed(agent);
      if (agent.decisionTime > 0) continue;
      agent.decisionTime = 0.25 + agent.id % 3 * 0.04;
      if (agent.cooldown > 0 || agent.changeTime < 3 || laneCount(agent.leg) < 2 || agent.speed < 2) continue;
      const view = this.sense(agent, agent.offset, seen);
      const currentAcceleration = this.followAcceleration(agent, view);
      let bestLane = agent.lane, bestGain = 0.55;
      for (const lane of [agent.lane - 1, agent.lane + 1]) {
        if (lane < 0 || lane >= laneCount(agent.leg) || !this.laneChangeRoom(agent, lane)) continue;
        const candidate = this.sense(agent, laneOffset(agent.leg, lane), seen);
        const gain = this.followAcceleration(agent, candidate) - currentAcceleration - 0.3 * candidate.rearBrake + (agent.profile.heavy ? lane < agent.lane ? 0.4 : -0.6 : 0);
        if (candidate.safe && gain > bestGain) { bestLane = lane; bestGain = gain }
      }
      if (bestLane !== agent.lane) proposals.push({ agent, lane: bestLane, gain: bestGain });
    }
    const reservations = plans.filter(agent => agent.changeTime < 3);
    proposals.sort((a, b) => b.gain - a.gain || a.agent.id - b.agent.id);
    for (const proposal of proposals) {
      const agent = proposal.agent;
      const candidate = { ...agent, targetLane: proposal.lane, changeFrom: agent.offset, changeTime: 0, changePaused: false, changeReturning: false };
      candidate.next = this.network.next(candidate.leg, candidate.targetLane, candidate.id + candidate.visits, candidate.profile);
      if (reservations.some(other => this.reservationConflict(candidate, other))) continue;
      agent.targetLane = candidate.targetLane; agent.next = candidate.next;
      agent.changeFrom = agent.offset; agent.changeTime = 0; agent.changePaused = false; agent.changeReturning = false;
      agent.cooldown = (agent.profile.heavy ? 8 : 5) + agent.id % 4; agent.indicator = agent.targetLane > agent.lane ? 1 : -1;
      reservations.push(agent);
    }
    const continuing: TrafficAgent[] = [];
    const ongoing = plans.filter(agent => agent.changeTime < 3).sort((a, b) => b.changeTime - a.changeTime || a.id - b.id);
    for (const agent of ongoing) {
      if (agent.changeReturning) continue;
      agent.changePaused = false;
      if (agent.speed < 0.01 || continuing.some(other => this.reservationConflict({ ...agent, changePaused: false }, { ...other, changePaused: false }))) this.returnToLane(agent);
      else continuing.push(agent);
    }
    const waitingForReturn = new Set<number>();
    for (const agent of ongoing) if (agent.changeReturning) for (const other of continuing) {
      if (this.reservationConflict({ ...agent, changePaused: false }, { ...other, changePaused: false })) waitingForReturn.add(other.id);
    }
    const waitingPlans = plans.map(agent => waitingForReturn.has(agent.id) ? { ...agent, changePaused: true, acceleration: Math.min(-agent.profile.comfortableBrake, agent.acceleration) } : agent);
    const retreatSeen = this.observe(waitingPlans, obstacles);
    const retreatPauses = plans.filter(agent => agent.changeReturning).map(agent => ({ agent, paused: !this.sweepClear(agent, retreatSeen) }));
    for (const pause of retreatPauses) pause.agent.changePaused = pause.paused;
    const motionSeen = this.observe(plans.map(agent => waitingForReturn.has(agent.id) ? { ...agent, changePaused: true, acceleration: Math.min(-agent.profile.comfortableBrake, agent.acceleration) } : agent), obstacles);
    const motions = plans.map(agent => {
      const destinationLane = agent.changeReturning ? agent.lane : agent.targetLane;
      const targetView = this.sense(agent, laneOffset(agent.leg, destinationLane), motionSeen);
      let view = targetView;
      if (agent.changeTime < 3) {
        const currentView = this.sense(agent, agent.offset, motionSeen);
        if (currentView.gap < view.gap) view = currentView;
      }
      const remaining = agent.leg.length - agent.along;
      let stop = this.rightOfWay.stopDistance(agent);
      if (!agent.next || (agent.changeTime < 3 && agent.next.road !== agent.road)) stop = Math.min(stop, remaining - agent.length / 2 - 2);
      else if (this.network.isMerge(agent.leg, agent.next) && remaining < Math.max(45, agent.speed * 3) && !this.mergeSafe(agent, motionSeen)) stop = Math.min(stop, remaining - agent.length / 2 - 2);
      if (stop < view.gap) view = { ...view, gap: stop, leaderSpeed: 0 };
      let acceleration = clamp(this.followAcceleration(agent, view), -agent.profile.emergencyBrake, agent.profile.acceleration);
      const closing = agent.speed - view.leaderSpeed;
      if (closing > 0 && view.gap / closing < 1.2) acceleration = -agent.profile.emergencyBrake;
      const shifting = agent.changeTime < 3;
      const corridorSafe = !shifting || (!waitingForReturn.has(agent.id) && targetView.safe && this.sweepClear(agent, motionSeen));
      if (!corridorSafe) acceleration = Math.min(acceleration, -agent.profile.comfortableBrake);
      let motion = this.integrate(agent.speed, acceleration, dt);
      const available = Math.max(0, view.gap - 0.2 + Math.max(0, view.leaderSpeed) * dt);
      if (motion.advance > available) motion = { advance: available, speed: Math.min(motion.speed, available / dt) };
      const shiftSafe = !shifting || (corridorSafe && (agent.changeReturning || motion.advance > 0.000001));
      const changeAdvance = shiftSafe ? Math.min(dt * (agent.profile.heavy ? 2 / 3 : 1), agent.changeReturning ? Math.max(dt * 0.35, motion.advance / 4.5) : motion.advance / 4.5) : 0;
      return { agent, ...motion, acceleration, shiftSafe, changeAdvance };
    });
    for (const motion of motions) {
      const agent = motion.agent;
      agent.acceleration = motion.acceleration; agent.speed = motion.speed;
      agent.braking = motion.acceleration < -0.6 || motion.advance < 0.001;
      agent.changePaused = !motion.shiftSafe;
      if (motion.shiftSafe) agent.changeTime = clamp(agent.changeTime + (agent.changeReturning ? -motion.changeAdvance : motion.changeAdvance), 0, 3);
      agent.offset = agent.changeFrom + (laneOffset(agent.leg, agent.targetLane) - agent.changeFrom) * smooth(agent.changeTime / 3);
      if (agent.changeReturning && agent.changeTime <= 0) this.cancelChange(agent);
      else if (agent.changeTime >= 3) { agent.lane = agent.targetLane; agent.indicator = 0; agent.changePaused = false; agent.changeReturning = false }
      this.advance(agent, motion.advance);
      agent.wheelDistance += motion.advance;
      const sample = this.sample(agent, 0, agent.offset);
      agent.position = sample.point;
      agent.distance = agent.leg.start + agent.leg.sign * agent.along;
      const ahead = this.predict(agent, 0.2);
      const dx = ahead.position.x - sample.point.x, dz = ahead.position.z - sample.point.z;
      if (Math.hypot(dx, dz) > 0.1) {
        const heading = agent.speed > 1 ? Math.atan2(dx, dz) : this.network.sample(agent.leg, agent.along, agent.offset).heading;
        agent.heading += angleDifference(heading, agent.heading) * Math.min(1, dt * 8);
        agent.pitch = -Math.atan2(ahead.position.y - sample.point.y - 0.79, Math.hypot(dx, dz));
      }
    }
    const byId = new Map(plans.map(agent => [agent.id, agent]));
    for (const agent of this.cars) Object.assign(agent, byId.get(agent.id)!);
  }

  private integrate(speed: number, acceleration: number, duration: number) {
    if (acceleration < 0 && speed + acceleration * duration < 0) return { advance: speed * speed / (-2 * acceleration), speed: 0 };
    return { advance: Math.max(0, speed * duration + acceleration * duration * duration / 2), speed: Math.max(0, speed + acceleration * duration) };
  }

  private returnToLane(agent: TrafficAgent) {
    if (agent.changeTime <= 0) { this.cancelChange(agent); return }
    agent.changeReturning = true; agent.changePaused = false;
    agent.indicator = agent.targetLane > agent.lane ? -1 : 1;
  }

  private cancelChange(agent: TrafficAgent) {
    agent.targetLane = agent.lane; agent.offset = agent.changeFrom;
    agent.changeTime = 3; agent.changeReturning = false; agent.changePaused = false; agent.indicator = 0;
    agent.next = this.network.next(agent.leg, agent.lane, agent.id + agent.visits, agent.profile);
    agent.cooldown = Math.max(2, agent.cooldown);
  }

  private changeProgress(agent: TrafficAgent, duration: number) {
    if (agent.changePaused) return agent.changeTime;
    const travel = Math.min(this.integrate(agent.speed, agent.acceleration, duration).advance, Math.max(0, this.rightOfWay.stopDistance(agent)));
    const amount = Math.min(duration * (agent.profile.heavy ? 2 / 3 : 1), agent.changeReturning ? Math.max(duration * 0.35, travel / 4.5) : travel / 4.5);
    return clamp(agent.changeTime + (agent.changeReturning ? -amount : amount), 0, 3);
  }

  private predict(agent: TrafficAgent, time: number, fixedOffset?: number): TrafficPose {
    if (time === 0 && fixedOffset === undefined) return { position: bodyPosition(agent), heading: agent.heading };
    const motion = this.integrate(agent.speed, agent.acceleration, time);
    const stop = Math.max(0, this.rightOfWay.stopDistance(agent));
    const changeTime = this.changeProgress(agent, time);
    const offset = fixedOffset ?? agent.changeFrom + (laneOffset(agent.leg, agent.targetLane) - agent.changeFrom) * smooth(changeTime / 3);
    const sample = this.sample(agent, Math.min(motion.advance, stop), offset);
    const laterTime = time + 0.08;
    const laterChange = this.changeProgress(agent, laterTime);
    const laterOffset = fixedOffset ?? agent.changeFrom + (laneOffset(agent.leg, agent.targetLane) - agent.changeFrom) * smooth(laterChange / 3);
    const ahead = this.sample(agent, Math.min(this.integrate(agent.speed, agent.acceleration, laterTime).advance, stop), laterOffset);
    const dx = ahead.point.x - sample.point.x, dz = ahead.point.z - sample.point.z;
    return { position: { x: sample.point.x, y: sample.point.y + 0.79, z: sample.point.z }, heading: motion.speed > 1 && Math.hypot(dx, dz) > 0.02 ? Math.atan2(dx, dz) : sample.heading };
  }

  private observe(cars: TrafficAgent[], obstacles: TrafficObstacle[]): SeenVehicle[] {
    const seen: SeenVehicle[] = cars.map(agent => ({ agent, position: bodyPosition(agent), velocity: { x: Math.sin(agent.heading) * agent.speed, y: 0, z: Math.cos(agent.heading) * agent.speed }, heading: agent.heading, length: agent.length, width: agent.width, trajectory: [] }));
    seen.push(...obstacles.map(other => ({ ...other, position: { ...other.position }, velocity: { ...other.velocity }, trajectory: [] })));
    for (const other of seen) for (let step = 0; step <= 7; step++) other.trajectory.push(this.predictOther(other, step * 0.4));
    return seen;
  }

  private predictOther(other: SeenVehicle, time: number): TrafficPose {
    return other.agent ? this.predict(other.agent, time) : { position: { x: other.position.x + other.velocity.x * time, y: other.position.y + other.velocity.y * time, z: other.position.z + other.velocity.z * time }, heading: other.heading };
  }

  private overlap(a: TrafficPose, aLength: number, aWidth: number, b: TrafficPose, bLength: number, bWidth: number, margin: number) {
    if (Math.abs(a.position.y - b.position.y) > 2.2) return false;
    const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
    for (const heading of [a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2]) {
      const extentA = Math.abs(Math.cos(heading - a.heading)) * aLength / 2 + Math.abs(Math.sin(heading - a.heading)) * aWidth / 2;
      const extentB = Math.abs(Math.cos(heading - b.heading)) * bLength / 2 + Math.abs(Math.sin(heading - b.heading)) * bWidth / 2;
      if (Math.abs(dx * Math.sin(heading) + dz * Math.cos(heading)) > extentA + extentB + margin) return false;
    }
    return true;
  }

  private sweptConflict(a: TrafficPose, nextA: TrafficPose, aLength: number, aWidth: number, b: TrafficPose, nextB: TrafficPose, bLength: number, bWidth: number, margin: number) {
    const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
    const vx = nextB.position.x - b.position.x - nextA.position.x + a.position.x;
    const vz = nextB.position.z - b.position.z - nextA.position.z + a.position.z;
    const fraction = clamp(-(dx * vx + dz * vz) / Math.max(0.0001, vx * vx + vz * vz), 0, 1);
    const interpolate = (from: TrafficPose, to: TrafficPose): TrafficPose => ({ position: { x: from.position.x + (to.position.x - from.position.x) * fraction, y: from.position.y + (to.position.y - from.position.y) * fraction, z: from.position.z + (to.position.z - from.position.z) * fraction }, heading: from.heading + angleDifference(to.heading, from.heading) * fraction });
    return this.overlap(interpolate(a, nextA), aLength, aWidth, interpolate(b, nextB), bLength, bWidth, margin) ? fraction : undefined;
  }

  private reservationConflict(agent: TrafficAgent, other: TrafficAgent) {
    if (agent.id === other.id) return false;
    if (agent.road === other.road && agent.leg.sign === other.leg.sign && agent.targetLane === other.targetLane) {
      let gap = Math.abs(agent.distance - other.distance);
      if (agent.road.closed) gap = Math.min(gap, agent.road.length - gap);
      if (gap < 12 + Math.max(agent.speed, other.speed) * 1.2) return true;
    }
    for (let time = 0.5; time <= 3; time += 0.5) if (this.overlap(this.predict(agent, time), agent.length, agent.width, this.predict(other, time), other.length, other.width, 0.6)) return true;
    return false;
  }

  private sweepClear(agent: TrafficAgent, seen: SeenVehicle[]) {
    const shifting = { ...agent, changePaused: false };
    const future = Array.from({ length: 4 }, (_, step) => this.predict(shifting, step * 0.4));
    for (const other of seen) {
      if (other.agent?.id === agent.id || Math.hypot(other.position.x - agent.position.x, other.position.z - agent.position.z) > 90) continue;
      if (this.overlap(future[0], agent.length, agent.width, other.trajectory[0], other.length, other.width, 0.35)) return false;
      for (let step = 1; step < future.length; step++) if (this.sweptConflict(future[step - 1], future[step], agent.length, agent.width, other.trajectory[step - 1], other.trajectory[step], other.length, other.width, 0.35) !== undefined) return false;
    }
    return true;
  }

  private canRecycle(agent: TrafficAgent, focus: TrafficFocus) {
    if (this.viewGuard > 0 || agent.changeTime < 3) return false;
    const dx = agent.position.x - focus.position.x, dz = agent.position.z - focus.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < Math.max(120, focus.speed * 2)) return false;
    const heading = travelHeading(focus);
    const forward = dx * Math.sin(heading) + dz * Math.cos(heading);
    const side = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
    const viewHeading = focus.heading + (focus.lookBack ? Math.PI : 0);
    const observed = Math.abs(angleDifference(Math.atan2(dx, dz), viewHeading)) < 1.1;
    if (observed && distance < 620) return false;
    return distance > 820 || forward < -(190 + Math.min(60, focus.speed)) || (side > 160 && distance > 240) || (focus.lookBack && forward > 280);
  }

  private hiddenSpawn(point: Point3, profile: TrafficVehicleSpec, focus: TrafficFocus) {
    const dx = point.x - focus.position.x, dz = point.z - focus.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < Math.max(140, focus.speed * 2.2)) return false;
    if (this.viewGuard > 0 && distance < 420) return false;
    const viewHeading = focus.heading + (focus.lookBack ? Math.PI : 0);
    if (Math.abs(angleDifference(Math.atan2(dx, dz), viewHeading)) > 1.1 || distance > 365) return true;
    const eyeY = focus.position.y + 2.6, targetY = point.y + profile.height * 0.5;
    return this.cars.some(other => {
      const t = ((other.position.x - focus.position.x) * dx + (other.position.z - focus.position.z) * dz) / (distance * distance);
      if (t < 0.08 || t > 0.9) return false;
      const lateral = Math.hypot(other.position.x - focus.position.x - dx * t, other.position.z - focus.position.z - dz * t);
      const lineY = eyeY + (targetY - eyeY) * t;
      return lateral < other.width * 0.45 && lineY > other.position.y + 0.2 && lineY < other.position.y + other.profile.height - 0.15;
    });
  }

  private findSpawn(id: number, profile: TrafficVehicleSpec, focus: TrafficFocus, exclude?: TrafficAgent) {
    const replenishing = !!exclude;
    const anchor = this.network.anchor(focus);
    const main = anchor?.leg.road.kind === 'main';
    let nearbyFront = 0, distantFront = 0, background = 0;
    for (const other of this.cars) {
      if (other === exclude) continue;
      const dx = other.position.x - focus.position.x, dz = other.position.z - focus.position.z;
      const heading = travelHeading(focus);
      const forward = dx * Math.sin(heading) + dz * Math.cos(heading);
      const side = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
      const aligned = !!anchor && Math.abs(other.position.y + 0.79 - focus.position.y) < 2.5 && side < anchor.leg.road.width * 1.6 && Math.abs(angleDifference(other.heading, this.network.sample(anchor.leg, anchor.along, 0).heading)) < 0.6;
      if (aligned && forward > 30 && forward < (main ? 270 : 180)) nearbyFront++;
      else if (aligned && forward >= (main ? 270 : 180) && forward < 460) distantFront++;
      else if (Math.hypot(dx, dz) < 500) background++;
    }
    for (const candidate of this.network.spawnCandidates(focus, id, profile, replenishing)) {
      if (!this.rightOfWay.allowsSpawn(candidate.leg, this.cars)) continue;
      if (candidate.primary && candidate.observedDistance > 0) {
        if (candidate.observedDistance < (main ? 270 : 180) && nearbyFront >= (main ? 14 : 9)) continue;
        if (candidate.observedDistance >= (main ? 270 : 180) && distantFront >= (main ? 16 : 10)) continue;
      } else if (background >= 12) continue;
      const count = laneCount(candidate.leg);
      const lanes = profile.heavy ? [0, Math.min(1, count - 1)] : Array.from({ length: count }, (_, attempt) => (id + attempt) % count);
      for (const lane of new Set(lanes)) {
        const sample = this.network.sample(candidate.leg, candidate.along, laneOffset(candidate.leg, lane));
        if (Math.hypot(sample.point.x - focus.position.x, sample.point.z - focus.position.z) < (replenishing ? 140 : 38)) continue;
        if (replenishing && !this.hiddenSpawn(sample.point, profile, focus)) continue;
        const next = this.network.next(candidate.leg, lane, id, profile);
        if (!next && candidate.leg.length - candidate.along < profile.length / 2 + 15) continue;
        const speed = roadSpeed(candidate.leg.road, id, profile) * (replenishing ? 0.85 : 0.58);
        const occupied = this.cars.some(other => {
          if (other === exclude || Math.abs(other.position.y - sample.point.y) > 2.5) return false;
          const dx = other.position.x - sample.point.x, dz = other.position.z - sample.point.z;
          const along = dx * Math.sin(sample.heading) + dz * Math.cos(sample.heading);
          const side = Math.abs(dx * Math.cos(sample.heading) - dz * Math.sin(sample.heading));
          const angle = angleDifference(other.heading, sample.heading);
          const halfWidth = (Math.abs(Math.cos(angle)) * other.width + Math.abs(Math.sin(angle)) * other.length) / 2;
          if (side > profile.width / 2 + halfWidth + 0.35) return false;
          const halfLength = (Math.abs(Math.cos(angle)) * other.length + Math.abs(Math.sin(angle)) * other.width) / 2;
          const free = Math.abs(along) - profile.length / 2 - halfLength;
          const follower = along > 0 ? profile : other.profile;
          const followerSpeed = along > 0 ? speed : other.speed;
          const leaderSpeed = along > 0 ? Math.max(0, other.speed * Math.cos(angle)) : speed;
          const closing = Math.max(0, followerSpeed - leaderSpeed);
          return free < follower.minGap + followerSpeed * follower.headway * 0.75 + closing * closing / (2 * follower.comfortableBrake);
        });
        const pose = { position: { ...sample.point, y: sample.point.y + 0.79 }, heading: sample.heading };
        const blocked = this.obstacles.some(other => this.overlap(pose, profile.length, profile.width, { position: other.position, heading: other.heading }, other.length, other.width, 2));
        if (!occupied && !blocked) return { ...candidate, lane };
      }
    }
    return undefined;
  }

  private relocate(agent: TrafficAgent, focus: TrafficFocus) {
    const candidate = this.findSpawn(agent.id + agent.visits * 13, agent.profile, focus, agent);
    if (!candidate) return;
    agent.leg = candidate.leg; agent.road = candidate.leg.road; agent.along = candidate.along;
    agent.lane = candidate.lane; agent.targetLane = candidate.lane;
    agent.offset = laneOffset(agent.leg, agent.lane); agent.changeFrom = agent.offset;
    agent.changeTime = 3; agent.changePaused = false; agent.changeReturning = false; agent.cooldown = 3; agent.indicator = 0;
    agent.speed = roadSpeed(agent.road, agent.id, agent.profile) * 0.85; agent.desiredSpeed = roadSpeed(agent.road, agent.id, agent.profile);
    agent.next = this.network.next(agent.leg, agent.lane, agent.id + ++agent.visits, agent.profile);
    agent.previous = undefined;
    const sample = this.network.sample(agent.leg, agent.along, agent.offset);
    agent.position = sample.point; agent.distance = sample.distance; agent.heading = sample.heading; agent.pitch = sample.pitch;
    agent.relocated = true;
  }

  private targetSpeed(agent: TrafficAgent) {
    let speed = roadSpeed(agent.road, agent.id, agent.profile);
    const a = this.sample(agent, 2, agent.offset);
    const b = this.sample(agent, 16, agent.offset);
    const c = this.sample(agent, 30, agent.offset);
    const curvature = Math.abs(angleDifference(Math.atan2(c.point.x - b.point.x, c.point.z - b.point.z), Math.atan2(b.point.x - a.point.x, b.point.z - a.point.z))) / 14;
    if (curvature > 0.002) speed = Math.min(speed, Math.sqrt(agent.profile.maxLateralAcceleration / curvature));
    if (agent.next && agent.next.road.kind !== agent.road.kind) {
      const nextSpeed = roadSpeed(agent.next.road, agent.id, agent.profile);
      speed = Math.min(speed, Math.sqrt(nextSpeed * nextSpeed + 2 * agent.profile.comfortableBrake * Math.max(0, agent.leg.length - agent.along - 5)));
    }
    return Math.max(3, speed);
  }

  private followAcceleration(agent: TrafficAgent, view: LaneView) {
    const desired = Math.max(3, agent.desiredSpeed);
    const profile = agent.profile;
    const dynamicGap = profile.minGap + Math.max(0, agent.speed * profile.headway + agent.speed * (agent.speed - view.leaderSpeed) / (2 * Math.sqrt(profile.acceleration * profile.comfortableBrake)));
    return profile.acceleration * (1 - (agent.speed / desired) ** 4 - (dynamicGap / Math.max(0.2, view.gap)) ** 2);
  }

  private sense(agent: TrafficAgent, offset: number, seen: SeenVehicle[]): LaneView {
    const horizon = Math.min(130, Math.max(45, agent.speed * 4 + 15));
    const path: { point: Point3; along: number; heading: number }[] = [];
    for (let along = 0; along <= horizon; along += 7) {
      const sample = this.sample(agent, along, offset);
      path.push({ point: sample.point, heading: sample.heading, along });
    }
    const future = Array.from({ length: 8 }, (_, step) => this.predict(agent, step * 0.4, offset));
    let gap = Infinity, leaderSpeed = agent.desiredSpeed, safe = true, rearBrake = 0;
    const origin = this.network.sample(agent.leg, agent.along, offset);
    for (const other of seen) {
      if (other.agent?.id === agent.id || Math.hypot(other.position.x - agent.position.x, other.position.z - agent.position.z) > horizon + 50) continue;
      const angle = angleDifference(other.heading, origin.heading);
      const halfLength = (Math.abs(Math.cos(angle)) * other.length + Math.abs(Math.sin(angle)) * other.width) / 2;
      const halfWidth = (Math.abs(Math.sin(angle)) * other.length + Math.abs(Math.cos(angle)) * other.width) / 2;
      const dx = other.position.x - origin.point.x, dz = other.position.z - origin.point.z;
      const alongNow = dx * Math.sin(origin.heading) + dz * Math.cos(origin.heading);
      const lateralNow = Math.abs(dx * Math.cos(origin.heading) - dz * Math.sin(origin.heading));
      const projectedSpeed = other.velocity.x * Math.sin(origin.heading) + other.velocity.z * Math.cos(origin.heading);
      if (Math.abs(other.position.y - origin.point.y - 0.79) < 2.2 && lateralNow < agent.width / 2 + halfWidth + 0.45) {
        const free = Math.abs(alongNow) - agent.length / 2 - halfLength;
        const closing = alongNow >= 0 ? agent.speed - projectedSpeed : projectedSpeed - agent.speed;
        const required = 4 + (alongNow >= 0 ? agent.speed : Math.max(0, projectedSpeed)) * 0.9 + Math.max(0, closing) * 1.5;
        if (free < required) safe = false;
        if (alongNow < 0 && projectedSpeed > 0) {
          const follower = other.agent?.profile ?? agent.profile;
          const desiredGap = follower.minGap + projectedSpeed * follower.headway + projectedSpeed * Math.max(0, closing) / (2 * Math.sqrt(follower.acceleration * follower.comfortableBrake));
          const brake = follower.acceleration * (desiredGap / Math.max(0.2, free)) ** 2;
          rearBrake = Math.max(rearBrake, brake);
          if (brake > Math.min(4, follower.comfortableBrake + 1)) safe = false;
        }
      }
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const vx = b.point.x - a.point.x, vz = b.point.z - a.point.z;
        const squared = vx * vx + vz * vz;
        if (squared < 0.01) continue;
        const t = clamp(((other.position.x - a.point.x) * vx + (other.position.z - a.point.z) * vz) / squared, 0, 1);
        const along = a.along + (b.along - a.along) * t;
        if (along < 0.5 && alongNow < -agent.length / 2) continue;
        const y = a.point.y + (b.point.y - a.point.y) * t + 0.79;
        if (Math.abs(other.position.y - y) > 2.2) continue;
        const heading = Math.atan2(vx, vz);
        const relative = angleDifference(other.heading, heading);
        const extent = Math.abs(Math.cos(relative)) * other.width / 2 + Math.abs(Math.sin(relative)) * other.length / 2;
        const lateral = Math.hypot(other.position.x - a.point.x - vx * t, other.position.z - a.point.z - vz * t);
        if (lateral > agent.width / 2 + extent + 0.3) continue;
        const front = Math.abs(Math.cos(relative)) * other.length / 2 + Math.abs(Math.sin(relative)) * other.width / 2;
        const free = along - agent.length / 2 - front;
        if (free < gap) { gap = free; leaderSpeed = other.velocity.x * Math.sin(heading) + other.velocity.z * Math.cos(heading) }
      }
      const stableFront = other.agent && other.agent.road === agent.road && other.agent.leg.sign === agent.leg.sign && other.agent.changeTime >= 3 && agent.changeTime >= 3 && alongNow > 0 && Math.abs(angle) < 0.25;
      if (stableFront || (other.agent && this.hasMergePriority(agent, other.agent))) continue;
      const followingBehind = alongNow < -(agent.length / 2 + halfLength) && Math.abs(angle) < 0.25 && lateralNow < agent.width / 2 + halfWidth + 0.3;
      if (followingBehind && agent.changeTime >= 3 && Math.abs(offset - agent.offset) < 0.1) continue;
      for (let step = 1; step < future.length; step++) {
        const fraction = this.sweptConflict(future[step - 1], future[step], agent.length, agent.width, other.trajectory[step - 1], other.trajectory[step], other.length, other.width, 0.35);
        if (fraction === undefined) continue;
        safe = false;
        const distance = this.integrate(agent.speed, agent.acceleration, (step - 1 + fraction) * 0.4).advance;
        const free = Math.max(0, distance - agent.length / 2 - halfLength);
        if (free < gap) { gap = free; leaderSpeed = 0 }
        break;
      }
    }
    return { gap, leaderSpeed, safe, rearBrake };
  }

  private laneChangeRoom(agent: TrafficAgent, lane: number) {
    const required = agent.speed * (agent.profile.heavy ? 4.5 : 3) + 15;
    let leg = agent.leg, available = leg.length - agent.along, visits = agent.visits;
    for (let i = 0; i < 24; i++) {
      if (available > required) return true;
      const next = this.network.next(leg, lane, agent.id + visits, agent.profile);
      if (!next || next.road !== agent.road) return false;
      available += next.length;
      leg = next;
      visits++;
    }
    return false;
  }

  private sourceFollower(agent: TrafficAgent, other: TrafficAgent) {
    if (other.road !== agent.road || other.leg.sign !== agent.leg.sign || other.targetLane !== agent.targetLane) return false;
    let behind = (agent.distance - other.distance) * agent.leg.sign;
    if (agent.road.closed) behind = (behind + agent.road.length) % agent.road.length;
    return behind > 0 && behind < 160;
  }

  private hasMergePriority(agent: TrafficAgent, other: TrafficAgent) {
    if (!agent.next || !other.next || agent.leg.to !== other.leg.to || agent.next !== other.next || agent.road === other.road || other.road === agent.next.road) return false;
    const lane = this.network.mappedLane(agent.leg, agent.next, agent.offset);
    if (lane !== this.network.mappedLane(other.leg, other.next, other.offset)) return false;
    if (other.speed > 3 || other.leg.length - other.along < other.length / 2 + 1.5) return false;
    const arrival = Math.max(0, agent.leg.length - agent.along - agent.length / 2 - 2) / Math.max(2, agent.speed);
    const otherArrival = Math.max(0, other.leg.length - other.along - other.length / 2 - 2) / Math.max(2, other.speed);
    return arrival < otherArrival - 0.5 || (Math.abs(arrival - otherArrival) <= 0.5 && agent.id < other.id);
  }

  private mergeSafe(agent: TrafficAgent, seen: SeenVehicle[]) {
    const next = agent.next!;
    const lane = this.network.mappedLane(agent.leg, next, agent.offset);
    const sample = this.network.sample(next, Math.min(next.length, agent.length / 2 + 1), laneOffset(next, lane));
    const arrival = clamp((agent.leg.length - agent.along - agent.length / 2) / Math.max(agent.speed, 2), 0, 3);
    for (const other of seen) {
      if (other.agent?.id === agent.id) continue;
      if (other.agent && (this.sourceFollower(agent, other.agent) || this.hasMergePriority(agent, other.agent))) continue;
      for (const time of [0, Math.max(0, arrival - 0.4), arrival, arrival + 0.4]) {
        const pose = this.predictOther(other, time);
        if (Math.abs(pose.position.y - sample.point.y - 0.79) > 2.2) continue;
        const dx = pose.position.x - sample.point.x, dz = pose.position.z - sample.point.z;
        const along = dx * Math.sin(sample.heading) + dz * Math.cos(sample.heading);
        const side = Math.abs(dx * Math.cos(sample.heading) - dz * Math.sin(sample.heading));
        const relative = angleDifference(pose.heading, sample.heading);
        const halfWidth = Math.abs(Math.cos(relative)) * other.width / 2 + Math.abs(Math.sin(relative)) * other.length / 2;
        if (side > agent.width / 2 + halfWidth + 0.4) continue;
        const speed = Math.max(0, other.agent ? other.agent.speed * Math.cos(relative) : other.velocity.x * Math.sin(sample.heading) + other.velocity.z * Math.cos(sample.heading));
        const halfLength = Math.abs(Math.cos(relative)) * other.length / 2 + Math.abs(Math.sin(relative)) * other.width / 2;
        const gap = Math.abs(along) - agent.length / 2 - halfLength;
        const closing = along < 0 ? Math.max(0, speed - agent.speed) : Math.max(0, agent.speed - speed);
        const required = 4 + (along >= 0 ? agent.speed : speed) * 1.1 + closing * closing / 8;
        if (gap < required) return false;
      }
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
        agent.changeTime = 3; agent.changePaused = false; agent.changeReturning = false; agent.indicator = 0;
      }
      agent.leg = next; agent.road = next.road;
      agent.next = this.network.next(next, agent.targetLane, agent.id + ++agent.visits, agent.profile);
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
      next = this.network.next(leg, lane, agent.id + agent.visits + count, agent.profile);
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
