import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { VEHICLES } from '../config';
import type { Point3, RoadPath, RoadPosition } from '../types';
import { PhysicsVehicle } from './physics';
import { RoadNavigation, type PoliceRoute } from './navigation';
import { sampleRoad } from './road-network';
import { angleDifference, clamp, laneCount, laneOffset, type TrafficLeg } from './traffic-network';
import type { TrafficObstacle } from './traffic';
import type { CollisionActorKind } from './collisions';
import { AIR_BODY, AIR_ENV, BARRIER, GROUND_BODY, packCollisionGroups } from './collision-groups';

export type PoliceRole = 'tail' | 'left' | 'right' | 'intercept' | 'support';
export type PoliceState = 'closing' | 'positioning' | 'contact' | 'recovering' | 'disabled';
export type PoliceTactic = 'ram' | 'pit' | 'brake-check' | 'box';
export type PoliceEvent = { type: 'windup' | 'evaded' | 'disabled' | 'flipped'; id: number; side?: 'rear' | 'left' | 'right' | 'front'; damage?: number };

export interface PoliceCar {
  id: number;
  vehicle: PhysicsVehicle;
  role: PoliceRole;
  tactic: PoliceTactic;
  state: PoliceState;
  road?: RoadPosition;
  activePursuit: boolean;
  route: PoliceRoute | null;
  routeIndex: number;
  routeAt: number;
  slot: number;
  offset: number;
  readyTime: number;
  actionUntil: number;
  recoverUntil: number;
  stuckTime: number;
  wrongWay: boolean;
  directionUntil: number;
  reverseUntil: number;
  operational: boolean;
  damage: number;
  overturnedTime: number;
  damagedTippedTime: number;
  damagedStuckTime: number;
  disabledAt: number;
  removeAfter: number;
  attackOffset: number;
  attackAlong: number;
  attackStarted: number;
  attackSpeed: number;
  lastPlayerImpact: number;
  passingOffset: number;
  passingUntil: number;
  passingAt: number;
  impactAt: number;
  impactPeak: number;
}

interface PursuitOptions {
  isVisible?: (point: Point3, radius: number) => boolean;
  isTrafficBody: (handle: number) => boolean;
}

const QUERY_GROUPS = packCollisionGroups(GROUND_BODY, GROUND_BODY | BARRIER);
const VISION_GROUPS = packCollisionGroups(GROUND_BODY | AIR_BODY, BARRIER | AIR_ENV);
const groundPosition = (vehicle: PhysicsVehicle): Point3 => {
  const point = vehicle.body.translation();
  return { x: point.x, y: point.y - 0.85, z: point.z };
};

export class PolicePursuit {
  readonly cars: PoliceCar[] = [];
  readonly navigation: RoadNavigation;
  private time = 0;
  private nextId = 0;
  private targetCount = 0;
  private spawnAt = 0;
  private assignAt = 0;
  private observeAt = 0;
  private lastObserved = -Infinity;
  private target?: Point3;
  private targetVelocity: Point3 = { x: 0, y: 0, z: 0 };
  private targetRoad?: RoadPosition;
  private targetSign: 1 | -1 = 1;
  private reverseTime = 0;
  private directionUntil = 0;
  private nextRouteAt = 0;
  private spawnAttempts = 0;
  private shape: RAPIER.Cuboid;
  private nextAttackAt = 0;
  private events: PoliceEvent[] = [];

  constructor(private world: RAPIER.World, private scene: THREE.Scene, roads: RoadPath[], private options: PursuitOptions) {
    this.navigation = new RoadNavigation(roads);
    this.shape = new RAPIER.Cuboid(VEHICLES[0].width / 2 + 0.06, 0.34, VEHICLES[0].length / 2 + 0.06);
  }

  get observation(): { position: Point3; age: number } | undefined {
    return this.target ? { position: { ...this.target }, age: Math.max(0, this.time - this.lastObserved) } : undefined;
  }

  get activeCars(): PoliceCar[] {
    return this.cars.filter(actor => actor.operational);
  }

  get healthyCars(): PoliceCar[] {
    return this.cars.filter(actor => actor.operational && actor.damage === 0);
  }

  registerImpact(bodyHandle: number, strength: number, deltaV: number, approachSpeed: number, otherKind?: CollisionActorKind) {
    const actor = this.cars.find(candidate => candidate.vehicle.body.handle === bodyHandle);
    if (!actor || !actor.operational) return;
    const impact = clamp(Math.max(strength * 0.42, deltaV * 0.12, approachSpeed * 0.018), 0, 0.48);
    const damage = this.time - actor.impactAt < 0.4 ? Math.max(0, impact - actor.impactPeak) * 0.55 : impact;
    actor.damage = clamp(actor.damage + damage, 0, 1);
    actor.impactPeak = this.time - actor.impactAt < 0.4 ? Math.max(actor.impactPeak, impact) : impact;
    actor.impactAt = this.time;
    const playerImpact = otherKind === 'player';
    if (playerImpact) actor.lastPlayerImpact = this.time;
    if (actor.vehicle.upY < 0.3) {
      actor.state = 'recovering';
      actor.readyTime = 0;
      actor.attackStarted = -Infinity;
      actor.recoverUntil = Math.max(actor.recoverUntil, this.time + 0.25);
      actor.routeAt = -Infinity;
      actor.vehicle.balanceDisabled = Math.max(actor.vehicle.balanceDisabled, 0.25);
    } else {
      actor.vehicle.balanceDisabled = Math.max(actor.vehicle.balanceDisabled, 0.12);
    }
  }

  drainEvents(): PoliceEvent[] {
    return this.events.splice(0);
  }

  initialize(count: number, player: PhysicsVehicle, obstacles: TrafficObstacle[] = []) {
    this.remember(player.body.translation(), player.body.linvel());
    const location = this.navigation.locate(groundPosition(player));
    if (location) {
      this.targetRoad = location;
      const velocity = player.body.linvel();
      const heading = Math.hypot(velocity.x, velocity.z) > 2 ? Math.atan2(velocity.x, velocity.z) : player.heading;
      this.targetSign = location.direction.x * Math.sin(heading) + location.direction.z * Math.cos(heading) < 0 ? -1 : 1;
    }
    for (let index = 0; index < count; index++) {
      const previous = this.healthyCars.length;
      this.spawn(count, player, obstacles, true);
      if (this.healthyCars.length === previous) break;
    }
  }

  launch() {
    for (const actor of this.activeCars) {
      const vehicle = actor.vehicle;
      const speed = Math.min(14, vehicle.config.topSpeed / 3.6);
      vehicle.body.setLinvel({ x: Math.sin(vehicle.heading) * speed, y: vehicle.body.linvel().y, z: Math.cos(vehicle.heading) * speed }, true);
    }
  }

  spawn(count: number, player: PhysicsVehicle, obstacles: TrafficObstacle[] = [], initial = false) {
    this.targetCount = count;
    if (!count || this.healthyCars.length >= count || !initial && this.time < this.spawnAt) return;
    if (!this.target) this.remember(player.body.translation(), player.body.linvel());
    const location = this.navigation.locate(groundPosition(player));
    if (!location) return;
    const config = { ...VEHICLES[0], name: '北京警车', mass: 1850, acceleration: player.config.acceleration, accelerationTopSpeed: player.config.topSpeed, topSpeed: player.config.topSpeed * 1.1, color: '#e4e8e5' };
    const velocity = player.body.linvel();
    const travelHeading = Math.hypot(velocity.x, velocity.z) > 2 ? Math.atan2(velocity.x, velocity.z) : this.targetRoad ? Math.atan2(this.targetRoad.direction.x * this.targetSign, this.targetRoad.direction.z * this.targetSign) : player.heading;
    const candidates = this.spawnCandidates(location, travelHeading, initial, player.speed).flatMap(candidate =>
      Array.from({ length: laneCount(candidate.leg) }, (_, index) => ({ ...candidate, lane: (this.nextId + index) % laneCount(candidate.leg) }))
    );
    let planningUsed = false;
    this.spawnAttempts++;
    for (const candidate of candidates) {
      if (candidate.leg.road.width < config.width + 1.2 || candidate.along < 14 || candidate.leg.length - candidate.along < 14) continue;
      const offset = laneOffset(candidate.leg, candidate.lane);
      const sample = this.navigation.traffic.sample(candidate.leg, candidate.along, offset);
      if (!initial && this.options.isVisible?.({ ...sample.point, y: sample.point.y + 0.85 }, 5)) continue;
      const ahead = this.navigation.traffic.sample(candidate.leg, candidate.along + 13, offset);
      const behind = this.navigation.traffic.sample(candidate.leg, candidate.along - 13, offset);
      if (Math.abs(angleDifference(ahead.heading, behind.heading)) > 0.45) continue;
      const position = { ...sample.point, y: sample.point.y + 0.85 };
      if (obstacles.some(other => Math.abs(other.position.y - position.y) < 2.2 && Math.hypot(other.position.x - position.x, other.position.z - position.z) < (other.length + config.length) / 2 + 5)) continue;
      if (this.cars.some(other => {
        const point = other.vehicle.body.translation();
        if (!initial) return Math.hypot(point.x - position.x, point.z - position.z) < 14;
        if (Math.abs(point.y - position.y) >= 2.2) return false;
        const dx = point.x - position.x, dz = point.z - position.z;
        const longitudinal = Math.abs(dx * Math.sin(sample.heading) + dz * Math.cos(sample.heading));
        const lateral = Math.abs(dx * Math.cos(sample.heading) - dz * Math.sin(sample.heading));
        return longitudinal < (config.length + other.vehicle.config.length) / 2 + 2 && lateral < (config.width + other.vehicle.config.width) / 2 + 0.8;
      })) continue;
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sample.heading);
      if (this.world.intersectionWithShape(position, rotation, this.shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, QUERY_GROUPS)) continue;
      const from = this.navigation.position(candidate.leg.road, sample.distance, offset);
      const initialSpeed = initial ? Math.min(player.speed, config.topSpeed / 3.6) : Math.min(clamp(player.speed + 2, 12, 60), config.topSpeed / 3.6);
      const wrongWay = candidate.leg.road.oneWay && candidate.leg.sign < 0;
      const target = candidate.distance > 0 ? this.navigation.advance(location, candidate.intercept, candidate.sign, location.offset) : location;
      let route = this.navigation.direct(from, target, sample.heading, wrongWay);
      if (!route && (initial || !planningUsed)) {
        if (!initial) planningUsed = true;
        route = this.navigation.plan(from, target, sample.heading, wrongWay, initialSpeed);
      }
      if (!route || route.length > (this.cars.length ? 700 : 210)) continue;
      const vehicle = new PhysicsVehicle(this.world, config, sample.point, sample.heading, true);
      vehicle.body.setLinvel({ x: Math.sin(sample.heading) * initialSpeed, y: Math.tan(-sample.pitch) * initialSpeed, z: Math.cos(sample.heading) * initialSpeed }, true);
      this.scene.add(vehicle.model.group);
      this.cars.push({
        id: this.nextId++, vehicle, role: this.activeCars.length ? 'support' : 'tail', tactic: 'ram', state: 'closing', road: from, activePursuit: true,
        route, routeIndex: 0, routeAt: -Infinity, slot: this.activeCars.length, offset, readyTime: 0, actionUntil: 0,
        recoverUntil: 0, stuckTime: 0, wrongWay, directionUntil: this.time + 0.6, reverseUntil: 0, operational: true,
        damage: 0, overturnedTime: 0, damagedTippedTime: 0, damagedStuckTime: 0, disabledAt: Infinity, removeAfter: Infinity, attackOffset: offset, attackAlong: -1, attackStarted: -Infinity, attackSpeed: 0,
        lastPlayerImpact: -Infinity, passingOffset: offset, passingUntil: 0, passingAt: 0, impactAt: -Infinity, impactPeak: 0
      });
      this.targetRoad = this.navigation.locate({ x: this.target!.x, y: this.target!.y - 0.85, z: this.target!.z }, this.targetRoad) ?? undefined;
      this.assignRoles();
      this.assignAt = this.time + 0.4;
      this.spawnAt = this.time + 0.45;
      return;
    }
    this.spawnAt = this.time + 0.8;
  }

  private spawnCandidates(location: RoadPosition, travelHeading: number, initial: boolean, playerSpeed: number) {
    const sign: 1 | -1 = location.direction.x * Math.sin(travelHeading) + location.direction.z * Math.cos(travelHeading) < 0 ? -1 : 1;
    const intercept = Math.max(22, Math.min(75, playerSpeed * 1.3)) + Math.min(playerSpeed * 0.45, 26);
    const front = clamp(intercept - 12, 55, 100);
    const rear = initial ? [-18, -26, -36, -48, -65, -85, -110] : [-55, -70, -85, -100, -120, -150, -190];
    const forward = playerSpeed > 15 ? [front, Math.min(110, front + 20)] : [];
    const frontFirst = !initial && this.spawnAttempts % 2 === 1;
    const shift = initial ? 0 : this.spawnAttempts % rear.length;
    const rotatedRear = [...rear.slice(shift), ...rear.slice(0, shift)];
    const distances = initial ? rear : frontFirst ? [...forward, ...rotatedRear] : [...rotatedRear, ...forward];
    const candidates: { leg: TrafficLeg; along: number; distance: number; intercept: number; sign: 1 | -1 }[] = [];
    const seen = new Set<string>();
    for (const distance of distances) {
      const point = this.navigation.advance(location, distance, sign);
      if (Math.hypot(point.point.x - location.point.x, point.point.z - location.point.z) < (initial ? 12 : 50)) continue;
      const key = `${point.road.id}:${point.distance.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const allowWrongWay = this.targetSign < 0 && this.reverseTime === 0 && this.time > this.directionUntil - 0.4;
      const direction = point.road.oneWay && !allowWrongWay || point.direction.x * Math.sin(travelHeading) + point.direction.z * Math.cos(travelHeading) >= 0 ? 1 : -1;
      const leg = this.navigation.legAt(point, direction, allowWrongWay);
      if (leg) candidates.push({ leg, along: (point.distance - leg.start) * leg.sign, distance, intercept, sign });
    }
    return candidates;
  }

  update(dt: number, time: number, player: PhysicsVehicle, obstacles: TrafficObstacle[] = [], observedTarget?: Point3) {
    this.time = time;
    if (observedTarget) {
      const age = Math.max(dt, time - this.lastObserved);
      const velocity = this.target && age < 2 ? { x: (observedTarget.x - this.target.x) / age, y: 0, z: (observedTarget.z - this.target.z) / age } : this.targetVelocity;
      const speed = Math.hypot(velocity.x, velocity.z);
      const scale = speed > 70 ? 70 / speed : 1;
      this.remember(observedTarget, { x: velocity.x * scale, y: velocity.y, z: velocity.z * scale });
    }
    if (time >= this.observeAt) {
      this.observeAt = time + 0.05;
      for (const actor of this.cars) if (this.sees(actor, player)) {
        this.remember(player.body.translation(), player.body.linvel());
        break;
      }
    }
    if (!this.target) return;
    const age = time - this.lastObserved;
    const targetGround = { x: this.target.x, y: this.target.y - 0.85, z: this.target.z };
    const previousRoad = this.targetRoad?.road;
    this.targetRoad = this.navigation.locate(targetGround, this.targetRoad, Math.atan2(this.targetVelocity.x, this.targetVelocity.z)) ?? undefined;
    if (!this.targetRoad) return;
    const signedSpeed = this.targetVelocity.x * this.targetRoad.direction.x + this.targetVelocity.z * this.targetRoad.direction.z;
    const desiredSign: 1 | -1 = signedSpeed < -2 ? -1 : signedSpeed > 2 ? 1 : this.targetSign;
    if (previousRoad && previousRoad !== this.targetRoad.road) { this.targetSign = desiredSign; this.reverseTime = 0 }
    this.reverseTime = desiredSign !== this.targetSign && age < 1 ? this.reverseTime + dt : 0;
    if (this.reverseTime > 0.2 && time > this.directionUntil) { this.targetSign = desiredSign; this.directionUntil = time + 0.6; this.reverseTime = 0 }
    if (time >= this.assignAt) { this.assignRoles(); this.assignAt = time + 0.4 }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const actor = this.cars[i];
      const position = actor.vehicle.body.translation();
      const playerPosition = player.body.translation();
      const distance = Math.hypot(position.x - playerPosition.x, position.z - playerPosition.z);
      if (actor.operational) {
        const angular = actor.vehicle.body.angvel();
        const velocity = actor.vehicle.body.linvel();
        const nearSurface = !!actor.road && Math.abs(position.y - actor.road.point.y - 0.85) < 1.2;
        const settled = nearSurface && actor.vehicle.speed < 0.8 && Math.abs(velocity.y) < 0.4 && Math.hypot(angular.x, angular.y, angular.z) < 0.35;
        actor.overturnedTime = actor.vehicle.upY < 0.18 && settled ? actor.overturnedTime + dt : 0;
        actor.damagedTippedTime = actor.damage > 0 && actor.vehicle.upY < 0.45 && settled ? actor.damagedTippedTime + dt : 0;
        const pursuingWhileStuck = actor.state === 'closing' || actor.reverseUntil > this.time || actor.state === 'recovering' && actor.damagedStuckTime > 0;
        const damagedAndStuck = actor.damage > 0 && actor.role !== 'support' && actor.role !== 'intercept' && distance > 28 && pursuingWhileStuck && settled;
        actor.damagedStuckTime = damagedAndStuck ? actor.damagedStuckTime + dt : 0;
        if (actor.vehicle.upY < 0.3 || actor.damagedTippedTime > 0) {
          if (actor.state !== 'recovering') {
            actor.state = 'recovering'; actor.readyTime = 0; actor.attackStarted = -Infinity; actor.routeAt = -Infinity;
            this.assignAt = 0;
          }
          actor.recoverUntil = Math.max(actor.recoverUntil, this.time + 0.25);
        }
        if (actor.overturnedTime > 1.05) this.disable(actor, 'flipped');
        else if (actor.damagedTippedTime > 2 || actor.damagedStuckTime > 6) this.disable(actor, 'disabled');
      }
      if (!actor.operational) {
        actor.activePursuit = false;
        actor.state = 'disabled';
        const removable = distance > 100 || distance > 20 && !this.options.isVisible?.(position, 7);
        if (this.time > actor.removeAfter && removable && !this.touchingPlayer(actor, player)) {
          actor.vehicle.dispose(); this.cars.splice(i, 1); this.assignAt = 0;
        }
        continue;
      }
      const retired = distance > 950 || Math.abs(position.y - playerPosition.y) > 30 || (actor.stuckTime > 9 && distance > 220);
      if (retired && !this.options.isVisible?.(position, 7) && !this.touching(actor, player)) {
        actor.vehicle.dispose(); this.cars.splice(i, 1); this.assignAt = 0;
        continue;
      }
      this.drive(actor, dt, player, age);
    }
    this.spawn(this.targetCount, player, obstacles);
  }

  private remember(position: Point3, velocity: Point3) {
    this.target = { ...position };
    this.targetVelocity = { ...velocity };
    this.lastObserved = this.time;
  }

  private disable(actor: PoliceCar, type: 'disabled' | 'flipped') {
    if (!actor.operational) return;
    actor.operational = false;
    actor.activePursuit = false;
    actor.state = 'disabled';
    actor.readyTime = 0;
    actor.attackStarted = -Infinity;
    actor.disabledAt = this.time;
    actor.removeAfter = this.time + 2;
    actor.route = null;
    actor.routeAt = Infinity;
    for (const light of actor.vehicle.model.policeLights) light.visible = false;
    this.events.push({ type, id: actor.id, damage: actor.damage });
    this.assignAt = 0;
  }

  private claimRoute() {
    if (this.time < this.nextRouteAt) return false;
    this.nextRouteAt = this.time + 0.05;
    return true;
  }

  private arrivalTime(actor: PoliceCar, distance: number, targetSpeed: number) {
    const speed = actor.vehicle.speed;
    const maximum = Math.min(actor.vehicle.config.topSpeed / 3.6, Math.max(speed, targetSpeed + 6));
    const accelerationTime = Math.max(0, maximum - speed) / 6;
    const accelerationDistance = (speed + maximum) / 2 * accelerationTime;
    return distance < accelerationDistance ? (Math.sqrt(speed ** 2 + 12 * distance) - speed) / 6 : accelerationTime + (distance - accelerationDistance) / Math.max(1, maximum);
  }

  private sees(actor: PoliceCar, player: PhysicsVehicle) {
    if (!actor.operational || actor.vehicle.upY < 0.3) return false;
    const from = actor.vehicle.body.translation(), to = player.body.translation();
    const eye = { x: from.x, y: from.y + 0.55, z: from.z };
    const delta = { x: to.x - eye.x, y: to.y + 0.45 - eye.y, z: to.z - eye.z };
    const distance = Math.hypot(delta.x, delta.y, delta.z);
    if (distance > 260 || Math.abs(delta.y) > 18) return false;
    if (distance < 1) return true;
    const ray = new RAPIER.Ray(eye, { x: delta.x / distance, y: delta.y / distance, z: delta.z / distance });
    return !this.world.castRay(ray, Math.max(0, distance - 2), true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, VISION_GROUPS, undefined, actor.vehicle.body);
  }

  private touching(actor: PoliceCar, player?: PhysicsVehicle) {
    let contact = false;
    for (let i = 0; i < actor.vehicle.body.numColliders(); i++) {
      const collider = actor.vehicle.body.collider(i);
      this.world.contactPairsWith(collider, other => {
        const body = other.parent();
        if (!body) return;
        if (!player) { contact = true; return }
        if (other.isSensor()) return;
        if (body.handle !== player.body.handle) {
          const position = body.translation(), target = player.body.translation();
          if (Math.hypot(position.x - target.x, position.z - target.z) > 220 || Math.abs(position.y - target.y) > 3) return;
          const police = this.cars.find(candidate => candidate.vehicle.body.handle === body.handle);
          if (police && (!police.activePursuit || police.vehicle.upY <= 0.3)) return;
        }
        this.world.contactPair(collider, other, manifold => {
          for (let index = 0; index < manifold.numContacts(); index++) if (manifold.contactDist(index) <= 0) { contact = true; break }
        });
      });
    }
    return contact;
  }

  private touchingPlayer(actor: PoliceCar, player: PhysicsVehicle) {
    let contact = false;
    for (let i = 0; i < actor.vehicle.body.numColliders(); i++) {
      const collider = actor.vehicle.body.collider(i);
      this.world.contactPairsWith(collider, other => {
        if (other.isSensor() || other.parent()?.handle !== player.body.handle) return;
        this.world.contactPair(collider, other, manifold => {
          for (let index = 0; index < manifold.numContacts(); index++) if (manifold.contactDist(index) <= 0) { contact = true; break }
        });
      });
    }
    return contact;
  }

  private assignRoles() {
    if (!this.targetRoad) return;
    const target = this.targetRoad;
    const ranked = this.activeCars.sort((a, b) => {
      const pa = a.vehicle.body.translation(), pb = b.vehicle.body.translation();
      return Math.hypot(pa.x - target.point.x, pa.z - target.point.z) - Math.hypot(pb.x - target.point.x, pb.z - target.point.z);
    });
    const committed = ranked.filter(actor => actor.state === 'positioning' || actor.state === 'contact');
    const occupied = new Set(committed.map(actor => actor.role));
    const roles: PoliceRole[] = (target.road.width > 9 ? ['tail', 'left', 'right'] as PoliceRole[] : ['tail'] as PoliceRole[]).filter(role => !occupied.has(role));
    const targetSpeed = Math.hypot(this.targetVelocity.x, this.targetVelocity.z);
    const forwardDistance = Math.max(22, Math.min(75, targetSpeed * 1.3)) + Math.min(targetSpeed * 0.45, 26);
    const interceptGoal = this.navigation.advance(target, forwardDistance, this.targetSign, target.offset);
    const playerEta = forwardDistance / Math.max(2, targetSpeed);
    const candidates = ranked.filter(actor => {
      if (!actor.road || actor.state === 'positioning' || actor.state === 'contact' || this.time < actor.recoverUntil) return false;
      const position = actor.vehicle.body.translation();
      return ((position.x - target.point.x) * target.direction.x + (position.z - target.point.z) * target.direction.z) * this.targetSign > actor.vehicle.config.length;
    });
    const eligible: { actor: PoliceCar; route: PoliceRoute; eta: number }[] = [];
    const graphCandidates: { actor: PoliceCar; lowerBound: number }[] = [];
    for (const actor of candidates) {
      const direct = this.navigation.direct(actor.road!, interceptGoal, actor.vehicle.heading, actor.wrongWay);
      if (direct) {
        const eta = this.arrivalTime(actor, direct.length, targetSpeed);
        if (eta < playerEta + 0.6) eligible.push({ actor, route: direct, eta });
      } else {
        const position = actor.vehicle.body.translation();
        const lowerBound = this.arrivalTime(actor, Math.hypot(interceptGoal.point.x - position.x, interceptGoal.point.z - position.z), targetSpeed);
        if (lowerBound < playerEta + 0.6) graphCandidates.push({ actor, lowerBound });
      }
    }
    graphCandidates.sort((a, b) => a.lowerBound - b.lowerBound);
    const candidate = graphCandidates[0]?.actor;
    if (candidate && this.claimRoute()) {
      const route = this.navigation.plan(candidate.road!, interceptGoal, candidate.vehicle.heading, candidate.wrongWay, candidate.vehicle.speed);
      if (route) {
        const eta = this.arrivalTime(candidate, route.length, targetSpeed);
        if (eta < playerEta + 0.6) eligible.push({ actor: candidate, route, eta });
      }
    }
    eligible.sort((a, b) => a.eta - b.eta);
    const interception = occupied.has('intercept') ? undefined : eligible[0];
    const interceptor = interception?.actor;
    let slot = 0;
    for (let i = 0; i < ranked.length; i++) {
      const actor = ranked[i];
      if (actor.state === 'positioning' || actor.state === 'contact' || this.time < actor.recoverUntil) continue;
      let role: PoliceRole = actor === interceptor ? 'intercept' : roles[slot++] ?? 'support';
      if (role === 'left' || role === 'right') {
        const margin = Math.max(0, target.road.width / 2 - actor.vehicle.config.width / 2 - 0.6);
        const desired = target.offset + (role === 'left' ? -1 : 1) * this.targetSign * 2.6;
        if (Math.abs(clamp(desired, -margin, margin) - target.offset) < actor.vehicle.config.width + 0.35) role = 'support';
      }
      if (actor.role !== role) { actor.readyTime = 0; actor.routeAt = -Infinity }
      actor.role = role; actor.slot = i;
      if (actor === interceptor && interception) { actor.route = interception.route; actor.routeIndex = 0; actor.routeAt = this.time }
    }
  }

  private tactic(actor: PoliceCar, playerSpeed: number): PoliceTactic {
    if (playerSpeed < 7) return 'box';
    if (actor.role === 'intercept') return 'brake-check';
    if (actor.role === 'left' || actor.role === 'right') return 'pit';
    return 'ram';
  }

  private attackPlan(actor: PoliceCar, tactic: PoliceTactic, player: PhysicsVehicle) {
    const road = this.targetRoad!;
    const margin = Math.max(0, road.road.width / 2 - actor.vehicle.config.width / 2 - 0.6);
    const playerOffset = clamp(road.offset, -margin, margin);
    const side = actor.role === 'left' ? -1 : actor.role === 'right' ? 1 : 0;
    const playerHalfWidth = player.config.kind === 'motorcycle' ? 0.24 : player.config.width * 0.45;
    const sideContact = Math.max(0.65, playerHalfWidth + actor.vehicle.config.width * 0.45 - 0.15);
    if (tactic === 'pit') {
      const rearContact = player.config.length * 0.28 + actor.vehicle.config.length * 0.43;
      return { offset: clamp(playerOffset + side * this.targetSign * sideContact, -margin, margin), along: -rearContact };
    }
    if (tactic === 'brake-check') {
      return { offset: clamp(playerOffset + (actor.id % 2 ? -0.35 : 0.35) * this.targetSign, -margin, margin), along: 2.8 };
    }
    if (tactic === 'box') {
      const along = actor.role === 'intercept' || actor.role === 'left' ? 2.5 : -2.5;
      return { offset: clamp(playerOffset + side * this.targetSign * sideContact, -margin, margin), along };
    }
    return { offset: playerOffset, along: -0.8 };
  }

  private goal(actor: PoliceCar, age: number) {
    const road = this.targetRoad!;
    const speed = Math.hypot(this.targetVelocity.x, this.targetVelocity.z);
    const narrow = road.road.width < 9;
    const prediction = Math.min(age, 1.5) * speed + (actor.role === 'intercept' ? Math.min(speed * 0.45, 26) : 0);
    const margin = Math.max(0, road.road.width / 2 - actor.vehicle.config.width / 2 - 0.6);
    const playerOffset = clamp(road.offset, -margin, margin);
    let offset = playerOffset;
    let along = -2.5;
    if (!narrow && speed < 7 && (actor.role === 'left' || actor.role === 'right')) {
      offset += (actor.role === 'left' ? -1 : 1) * this.targetSign * 2.6;
      along = actor.role === 'left' ? 5 : -2.5;
    } else if (!narrow && (actor.role === 'left' || actor.role === 'right')) {
      offset += (actor.role === 'left' ? -1 : 1) * this.targetSign * 2.6;
      along = -0.5;
    } else if (actor.role === 'intercept') along = Math.max(22, Math.min(75, speed * 1.3));
    else if (actor.role === 'support') along = -8 - actor.slot * 3;
    if (actor.state === 'positioning' || actor.state === 'contact') {
      offset = clamp(actor.attackOffset, -margin, margin);
      along = actor.attackAlong;
    } else if (actor.passingUntil > this.time && actor.road?.road === road.road) offset = clamp(actor.passingOffset, -margin, margin);
    if (actor.state === 'recovering') along -= 14;
    return this.navigation.advance(road, prediction + along, this.targetSign, clamp(offset, -margin, margin));
  }

  private drive(actor: PoliceCar, dt: number, player: PhysicsVehicle, age: number) {
    const vehicle = actor.vehicle;
    actor.road = this.navigation.locate(groundPosition(vehicle), actor.road, vehicle.heading) ?? undefined;
    if (!actor.road) { vehicle.drive({ throttle: 0, steer: 0, brake: true }, dt, false); actor.activePursuit = false; return }
    const onRoad = Math.abs(actor.road.offset) < actor.road.road.width / 2 + 0.5 && Math.abs(vehicle.body.translation().y - actor.road.point.y - 0.85) < 2;
    const alignedReverse = actor.road.direction.x * Math.sin(vehicle.heading) + actor.road.direction.z * Math.cos(vehicle.heading) < -0.3;
    const permitReverse = this.targetSign < 0 && this.reverseTime === 0 && this.time > this.directionUntil - 0.4 && this.navigation.sameCorridor(actor.road, this.targetRoad!, 200) && (alignedReverse || (vehicle.speed < 1 && actor.road.road.width > 13));
    if (this.time > actor.directionUntil && actor.wrongWay !== permitReverse) { actor.wrongWay = permitReverse; actor.directionUntil = this.time + 0.6; actor.routeAt = -Infinity }
    if (actor.state === 'contact' && this.time > actor.actionUntil) {
      if (actor.lastPlayerImpact >= actor.attackStarted) {
        actor.state = 'closing'; actor.routeAt = -Infinity; actor.readyTime = 0;
        this.assignRoles();
        this.assignAt = this.time + 0.4;
      } else {
        this.events.push({ type: 'evaded', id: actor.id, side: this.eventSide(actor.role), damage: actor.damage });
        actor.state = 'recovering'; actor.recoverUntil = this.time + 0.1; actor.routeAt = -Infinity; actor.readyTime = 0;
      }
      this.nextAttackAt = Math.max(this.nextAttackAt, this.time + 0.05);
    }
    if (actor.state === 'recovering' && this.time > actor.recoverUntil) {
      actor.state = 'closing';
      this.assignRoles();
      this.assignAt = this.time + 0.4;
    }
    this.updatePassing(actor, player);
    let goal = this.goal(actor, age);
    const local = actor.road.road === goal.road;
    const alignedWithTarget = (actor.road.direction.x * Math.sin(vehicle.heading) + actor.road.direction.z * Math.cos(vehicle.heading)) * this.targetSign > 0.3;
    let gap = Math.hypot(goal.point.x - actor.road.point.x, goal.point.z - actor.road.point.z);
    if (local && alignedWithTarget) {
      gap = (goal.distance - actor.road.distance) * this.targetSign;
      if (actor.road.road.closed) {
        const length = actor.road.road.length;
        gap = ((gap + length / 2) % length + length) % length - length / 2;
      }
    }
    if (this.time - actor.routeAt > (local ? 0.1 : 0.55 + actor.id % 5 * 0.04)) {
      const minimumAhead = clamp(8 + vehicle.speed * 0.45, 12, 35);
      const trackingGoal = local && alignedWithTarget && gap < minimumAhead ? this.navigation.advance(actor.road, minimumAhead, this.targetSign, goal.offset) : goal;
      const direct = this.navigation.direct(actor.road, trackingGoal, vehicle.heading, actor.wrongWay);
      if (direct || this.claimRoute()) {
        actor.route = direct ?? this.navigation.plan(actor.road, trackingGoal, vehicle.heading, actor.wrongWay, vehicle.speed);
        actor.routeIndex = 0; actor.routeAt = this.time;
      }
      if (actor.role === 'intercept' && actor.state === 'closing' && actor.route) {
        const targetSpeed = Math.hypot(this.targetVelocity.x, this.targetVelocity.z);
        const playerEta = Math.max(22, Math.min(75, targetSpeed * 1.3)) / Math.max(2, targetSpeed) + 0.45;
        const eta = this.arrivalTime(actor, actor.route.length, targetSpeed);
        if (eta > playerEta + 0.6) {
          actor.role = 'support'; actor.route = null; actor.routeAt = -Infinity;
          goal = this.goal(actor, age);
        }
      }
    }
    const route = actor.route;
    const playerPosition = player.body.translation();
    const position = vehicle.body.translation();
    const distance = Math.hypot(playerPosition.x - position.x, playerPosition.z - position.z);
    actor.activePursuit = onRoad && vehicle.upY > 0.3 && age < 6 && !!route && route.length < 400 && distance < 220 && Math.abs(playerPosition.y - position.y) < 3;
    actor.stuckTime = vehicle.speed < 0.8 && distance > 12 ? actor.stuckTime + dt : 0;
    if (actor.stuckTime > 0.9 && onRoad && !this.touching(actor) && vehicle.upY > 0.5) {
      const rear = { x: position.x - Math.sin(vehicle.heading) * 5, y: position.y, z: position.z - Math.cos(vehicle.heading) * 5 };
      if (this.clearSweep(actor, rear, player, false)) {
        actor.reverseUntil = this.time + 0.45; actor.state = 'recovering'; actor.recoverUntil = this.time + 0.55;
        actor.routeAt = -Infinity; actor.stuckTime = 0;
      }
    }
    if (actor.reverseUntil > this.time) {
      vehicle.drive({ throttle: -0.55, steer: 0, brake: false }, dt, onRoad);
      return;
    }
    if (!route || !route.points.length || vehicle.upY < 0.2) {
      vehicle.drive({ throttle: 0, steer: 0, brake: true }, dt, onRoad);
      actor.readyTime = 0;
      return;
    }
    const same = this.navigation.sameCorridor(actor.road, this.targetRoad!, 65) && Math.abs(playerPosition.y - position.y) < 2.2;
    const maxAttackers = this.targetRoad!.road.width > 9 ? 3 : 1;
    const attackers = this.activeCars.filter(other => other.state === 'positioning' || other.state === 'contact').length;
    const playerSpeed = Math.hypot(this.targetVelocity.x, this.targetVelocity.z);
    const playerMoving = playerSpeed > 2;
    const intendedTactic = actor.state === 'closing' ? this.tactic(actor, playerSpeed) : actor.tactic;
    const plan = actor.state === 'closing' ? this.attackPlan(actor, intendedTactic, player) : { offset: actor.attackOffset, along: actor.attackAlong };
    const approach = this.navigation.advance(this.targetRoad!, plan.along, this.targetSign, plan.offset).point;
    const approachPosition = { ...approach, y: approach.y + 0.85 };
    const stationaryHeading = plan.along > 0 ? Math.atan2(this.targetRoad!.direction.x * this.targetSign, this.targetRoad!.direction.z * this.targetSign) : Math.atan2(approach.x - position.x, approach.z - position.z);
    const heading = playerMoving ? Math.atan2(this.targetVelocity.x, this.targetVelocity.z) : stationaryHeading;
    const headingError = Math.abs(angleDifference(vehicle.heading, heading));
    const readyDistance = intendedTactic === 'brake-check' ? 32 : intendedTactic === 'pit' ? 26 : intendedTactic === 'box' ? 26 : 32;
    const playerAlong = (playerPosition.x - position.x) * Math.sin(vehicle.heading) + (playerPosition.z - position.z) * Math.cos(vehicle.heading);
    const slotReady = plan.along > 1 ? playerAlong < -0.4 : intendedTactic === 'ram' || plan.along < -1 ? playerAlong > 0.4 : Math.abs(playerAlong) < 9;
    const alignedForAttack = headingError < 0.8;
    const attackPathClear = this.clearAttack(actor, approachPosition, player);
    const approachClear = same && age < 0.8 && distance < readyDistance * 1.8 && alignedForAttack && attackPathClear;
    const sustainedAttack = actor.lastPlayerImpact >= actor.attackStarted && same && age < 0.8 && distance < readyDistance * 2.2 && attackPathClear;
    const ready = approachClear && age < 0.55 && distance < readyDistance && slotReady && headingError < 0.65 && actor.role !== 'support';
    const boxDirectionOccupied = intendedTactic === 'box' && this.activeCars.some(other => other !== actor && (other.state === 'positioning' || other.state === 'contact') && other.tactic === 'box' && (other.attackAlong > 0) === (plan.along > 0));
    if (actor.state === 'closing' && ready && attackers < maxAttackers && !boxDirectionOccupied && this.time >= this.nextAttackAt) {
      const maximum = vehicle.config.topSpeed / 3.6;
      actor.tactic = intendedTactic;
      actor.attackOffset = plan.offset;
      actor.attackAlong = plan.along;
      if (intendedTactic === 'brake-check') actor.attackSpeed = Math.min(maximum, Math.max(0, playerSpeed - 12));
      else if (intendedTactic === 'box') actor.attackSpeed = plan.along > 0 ? 0 : Math.min(maximum, Math.max(6, playerSpeed + 4));
      else if (intendedTactic === 'pit') actor.attackSpeed = Math.min(maximum, Math.max(vehicle.speed, playerSpeed + 7));
      else actor.attackSpeed = Math.min(maximum, Math.max(vehicle.speed, playerSpeed + 9));
      actor.state = 'positioning'; actor.readyTime = 0; actor.attackStarted = this.time; actor.routeAt = -Infinity;
      this.nextAttackAt = this.time + 0.06;
      this.events.push({ type: 'windup', id: actor.id, side: this.eventSide(actor.role), damage: actor.damage });
    } else if (actor.state === 'contact' && !approachClear) {
      if (!sustainedAttack) {
        if (actor.lastPlayerImpact < actor.attackStarted) this.events.push({ type: 'evaded', id: actor.id, side: this.eventSide(actor.role), damage: actor.damage });
        actor.state = 'recovering'; actor.recoverUntil = this.time + 0.1; actor.readyTime = 0; actor.routeAt = -Infinity;
      }
    } else if (actor.state === 'positioning') {
      actor.readyTime += dt;
      if (!approachClear && !sustainedAttack && actor.readyTime > 0.12) {
        actor.state = 'recovering'; actor.recoverUntil = this.time + 0.1; actor.readyTime = 0; actor.routeAt = -Infinity;
      } else if (actor.readyTime >= 0.12) {
        actor.state = 'contact'; actor.actionUntil = this.time + (actor.tactic === 'box' ? 2.2 : 1.8); actor.readyTime = 0; actor.routeAt = -Infinity;
      }
    }
    const reverseDistance = Math.min(8, distance + 2);
    const reversePoint = { x: position.x - Math.sin(vehicle.heading) * reverseDistance, y: position.y, z: position.z - Math.cos(vehicle.heading) * reverseDistance };
    const reverseRoad = this.navigation.locate({ x: reversePoint.x, y: reversePoint.y - 0.85, z: reversePoint.z }, actor.road);
    const reverseOnRoad = !!reverseRoad && Math.abs(reverseRoad.offset) <= reverseRoad.road.width / 2 - vehicle.config.width / 2 - 0.35;
    const velocity = vehicle.body.linvel();
    const forwardSpeed = velocity.x * Math.sin(vehicle.heading) + velocity.z * Math.cos(vehicle.heading);
    const reverseBox = actor.state === 'contact' && actor.tactic === 'box' && actor.attackAlong > 0 && distance > (player.config.length + vehicle.config.length) * 0.42;
    if (reverseBox && same && attackPathClear && reverseOnRoad && this.clearAttack(actor, reversePoint, player)) {
      vehicle.drive({ throttle: forwardSpeed > -2.8 ? -0.45 : 0, steer: 0, brake: forwardSpeed < -3.6 }, dt, onRoad);
      return;
    }
    let lookAhead = clamp(8 + vehicle.speed * 0.45, 8, 35);
    let followed = this.follow(actor, lookAhead, dt);
    let corridorLimited = false;
    let clear = this.clearSweep(actor, followed.target, player, true, true);
    for (let attempt = 0; !clear && attempt < 3; attempt++) {
      corridorLimited = true; lookAhead = Math.max(3.5, lookAhead * 0.55);
      followed = this.follow(actor, lookAhead, 0);
      clear = this.clearSweep(actor, followed.target, player, true, true);
    }
    if (actor.state === 'contact' && actor.tactic !== 'brake-check' && actor.attackAlong <= 0 && (approachClear || sustainedAttack)) followed.target = { ...goal.point, y: goal.point.y + 0.85 };
    const dx = followed.target.x - position.x, dz = followed.target.z - position.z;
    const lateral = dx * Math.cos(vehicle.heading) - dz * Math.sin(vehicle.heading);
    const curvature = 2 * lateral / Math.max(4, dx * dx + dz * dz);
    const yawLimit = vehicle.yawLimit(vehicle.speed);
    let steer = clamp(-vehicle.speed * curvature / yawLimit, -1, 1);
    const error = angleDifference(Math.atan2(dx, dz), vehicle.heading);
    if (vehicle.speed < 5 && Math.abs(error) > 0.7) steer = clamp(-error * 1.8, -1, 1);
    let targetSpeed = Math.min(vehicle.config.topSpeed / 3.6, Math.max(12, playerSpeed + Math.min(12, 4 + gap * 0.24)));
    const curveSpeed = Math.sqrt(6.8 / Math.max(0.0008, followed.curvature, Math.abs(curvature)));
    targetSpeed = Math.min(targetSpeed, curveSpeed);
    if (followed.remaining < lookAhead + 5) targetSpeed = Math.min(targetSpeed, Math.sqrt(playerSpeed ** 2 + 2 * 7 * Math.max(0, followed.remaining - 4)));
    if (gap < 14) targetSpeed = Math.min(targetSpeed, Math.max(0, playerSpeed + (gap - 4) * 0.7));
    const aligningSlot = actor.state === 'closing' && same && age < 0.8 && distance < readyDistance * 1.8 && playerSpeed < 2 && actor.role !== 'intercept' && Math.abs(actor.road.offset - goal.offset) > 0.75;
    if (aligningSlot) targetSpeed = Math.min(curveSpeed, Math.max(targetSpeed, 3));
    if (actor.state === 'contact') {
      const blocking = actor.tactic === 'brake-check' || actor.tactic === 'box' && actor.attackAlong > 0;
      targetSpeed = Math.min(blocking ? Math.min(targetSpeed, actor.attackSpeed) : Math.max(targetSpeed, actor.attackSpeed), curveSpeed);
    }
    if (age > 6) targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * 5 * Math.max(0, followed.remaining - 4)));
    if (corridorLimited) targetSpeed = Math.min(targetSpeed, clear ? Math.sqrt(2 * 7 * Math.max(0, lookAhead - 3)) : 0);
    if (Math.abs(error) > 0.6) targetSpeed = Math.min(targetSpeed, Math.max(4, 15 * (1 - Math.min(1, Math.abs(error) / 2))));
    const approachingPlayer = approachClear && actor.role !== 'support' && actor.state !== 'recovering';
    targetSpeed = this.obstacleSpeed(actor, targetSpeed, player, approachingPlayer);
    const probe = Math.min(lookAhead, Math.max(5, vehicle.speed * 0.65));
    const probeTarget = { x: position.x + Math.sin(vehicle.heading) * probe, y: position.y, z: position.z + Math.cos(vehicle.heading) * probe };
    if (!this.clearSweep(actor, probeTarget, player, approachingPlayer)) targetSpeed = Math.min(targetSpeed, 3);
    const corridor = this.navigation.locate({ x: followed.target.x, y: followed.target.y - 0.85, z: followed.target.z });
    if (!corridor || Math.abs(corridor.offset) > corridor.road.width / 2 - vehicle.config.width / 2) targetSpeed = Math.min(targetSpeed, 4);
    if (!onRoad) targetSpeed = Math.min(targetSpeed, 6);
    targetSpeed = clamp(targetSpeed, 0, vehicle.config.topSpeed / 3.6);
    const throttle = targetSpeed > vehicle.speed + 0.5 ? Math.abs(error) > 1 ? 0.35 : 1 : 0;
    vehicle.drive({ throttle, steer, brake: vehicle.speed > targetSpeed + 0.8 || targetSpeed < 0.5 }, dt, onRoad);
  }

  private eventSide(role: PoliceRole): 'rear' | 'left' | 'right' | 'front' {
    if (role === 'left') return 'left';
    if (role === 'right') return 'right';
    if (role === 'intercept') return 'front';
    return 'rear';
  }

  private updatePassing(actor: PoliceCar, player: PhysicsVehicle) {
    if (!actor.road || actor.state === 'positioning' || actor.state === 'contact' || actor.state === 'recovering' || this.time < actor.passingAt) return;
    actor.passingAt = this.time + 0.1;
    const vehicle = actor.vehicle;
    const position = vehicle.body.translation();
    const forwardX = Math.sin(vehicle.heading), forwardZ = Math.cos(vehicle.heading);
    const rightX = Math.cos(vehicle.heading), rightZ = -Math.sin(vehicle.heading);
    const blockers = this.cars.filter(other => other !== actor).map(other => this.obstacle(other.vehicle));
    const blocker = blockers.find(other => {
      if (Math.abs(other.position.y - position.y) > 2.2) return false;
      const dx = other.position.x - position.x, dz = other.position.z - position.z;
      const along = dx * forwardX + dz * forwardZ;
      const side = Math.abs(dx * rightX + dz * rightZ);
      return along > 7 && along < 34 && side < (vehicle.config.width + other.width) * 0.5 + 0.5;
    });
    if (!blocker) {
      if (this.time > actor.passingUntil) actor.passingOffset = actor.offset;
      return;
    }
    const margin = Math.max(0, actor.road.road.width / 2 - vehicle.config.width / 2 - 0.65);
    const currentOffset = actor.road.offset;
    const travelSign = actor.road.direction.x * forwardX + actor.road.direction.z * forwardZ < 0 ? -1 : 1;
    const shift = Math.max(2.5, vehicle.config.width + 0.75);
    const choices = [clamp(currentOffset - shift, -margin, margin), clamp(currentOffset + shift, -margin, margin)]
      .filter((value, index, values) => Math.abs(value - currentOffset) > 1.3 && values.indexOf(value) === index)
      .sort((a, b) => Math.abs(a - this.targetRoad!.offset) - Math.abs(b - this.targetRoad!.offset));
    for (const offset of choices) {
      const lateral = (offset - currentOffset) * travelSign;
      const occupied = this.cars.some(other => {
        if (other === actor) return false;
        const point = other.vehicle.body.translation();
        if (Math.abs(point.y - position.y) > 2.2) return false;
        const dx = point.x - position.x, dz = point.z - position.z;
        const along = dx * forwardX + dz * forwardZ;
        if (along < -5 || along > 30) return false;
        if (other.passingUntil > this.time && other.road?.road === actor.road!.road && Math.abs(other.passingOffset - offset) < vehicle.config.width + 1) return true;
        return Math.abs(dx * rightX + dz * rightZ - lateral) < vehicle.config.width + 1;
      });
      if (occupied) continue;
      const passingPoint = this.navigation.advance(actor.road, 18, travelSign, offset).point;
      const probe = { x: passingPoint.x, y: passingPoint.y + 0.85, z: passingPoint.z };
      if (!this.clearSweep(actor, probe, player, false)) continue;
      actor.passingOffset = offset;
      actor.passingUntil = this.time + 1;
      actor.routeAt = -Infinity;
      return;
    }
  }

  private follow(actor: PoliceCar, lookAhead: number, dt: number) {
    const points = actor.route!.points;
    const position = actor.vehicle.body.translation();
    let best = actor.routeIndex, distance = Infinity, projection = 0;
    for (let i = Math.max(0, actor.routeIndex - 2); i < Math.min(points.length - 1, actor.routeIndex + 20); i++) {
      const a = points[i], b = points[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = clamp(((position.x - a.x) * dx + (position.z - a.z) * dz) / Math.max(0.01, dx * dx + dz * dz), 0, 1);
      const value = Math.hypot(position.x - a.x - dx * t, position.z - a.z - dz * t) + Math.abs(position.y - 0.85 - a.y - (b.y - a.y) * t) * 4;
      if (value < distance) { best = i; distance = value; projection = t }
    }
    actor.routeIndex = best;
    const reference = points[Math.min(best + 1, points.length - 1)];
    const referenceMargin = Math.max(0, reference.road.width / 2 - actor.vehicle.config.width / 2 - 0.55);
    const desiredOffset = actor.state === 'closing' && actor.passingUntil > this.time && reference.road === actor.road?.road ? actor.passingOffset : reference.road === this.targetRoad!.road ? this.goal(actor, Math.max(0, this.time - this.lastObserved)).offset : clamp(actor.offset, -referenceMargin, referenceMargin);
    actor.offset = THREE.MathUtils.damp(actor.offset, clamp(desiredOffset, -referenceMargin, referenceMargin), actor.state === 'contact' ? 6 : 3.5, dt);
    const last = points.at(-1)!;
    let remaining = 0, curvature = 0, target: Point3 = { x: last.x, y: last.y + 0.85, z: last.z };
    let selected = false;
    for (let i = best; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const segment = Math.hypot(b.x - a.x, b.z - a.z);
      const initial = i === best ? projection : 0;
      const span = segment * (1 - initial);
      if (!selected && remaining + span >= lookAhead) {
        const t = initial + (lookAhead - remaining) / Math.max(0.01, segment);
        const margin = Math.max(0, a.road.width / 2 - actor.vehicle.config.width / 2 - 0.55);
        const offset = a.road === b.road ? clamp(actor.offset, -margin, margin) : 0;
        const direction = sampleRoad(a.road, a.distance).direction;
        target = { x: a.x + (b.x - a.x) * t + direction.z * offset, y: a.y + (b.y - a.y) * t + 0.85, z: a.z + (b.z - a.z) * t - direction.x * offset };
        selected = true;
      }
      if (i > best && remaining < Math.max(lookAhead * 2, actor.vehicle.speed ** 2 / 14 + 15)) {
        const p = points[i - 1];
        const turn = Math.abs(angleDifference(Math.atan2(b.x - a.x, b.z - a.z), Math.atan2(a.x - p.x, a.z - p.z)));
        curvature = Math.max(curvature, turn / Math.max(4, (segment + Math.hypot(a.x - p.x, a.z - p.z)) / 2));
      }
      remaining += span;
    }
    if (!selected) {
      const sample = sampleRoad(last.road, last.distance, actor.offset);
      target = { x: sample.point.x, y: sample.point.y + 0.85, z: sample.point.z };
    }
    return { target, curvature, remaining };
  }

  private obstacleSpeed(actor: PoliceCar, speed: number, player: PhysicsVehicle, approachingPlayer: boolean) {
    const vehicle = actor.vehicle, position = vehicle.body.translation();
    const playerObstacle = this.obstacle(player);
    const seen = this.cars.filter(other => other !== actor).map(other => this.obstacle(other.vehicle));
    if (!approachingPlayer && actor.state !== 'contact' && actor.state !== 'positioning') seen.push(playerObstacle);
    for (const other of seen) {
      if (Math.abs(other.position.y - position.y) > 2.2 || Math.hypot(other.position.x - position.x, other.position.z - position.z) < 0.2) continue;
      const dx = other.position.x - position.x, dz = other.position.z - position.z;
      const along = dx * Math.sin(vehicle.heading) + dz * Math.cos(vehicle.heading);
      const side = Math.abs(dx * Math.cos(vehicle.heading) - dz * Math.sin(vehicle.heading));
      const angle = angleDifference(other.heading, vehicle.heading);
      const halfWidth = Math.abs(Math.cos(angle)) * other.width / 2 + Math.abs(Math.sin(angle)) * other.length / 2;
      if (along < 0 || side > halfWidth + vehicle.config.width / 2 + 0.45) continue;
      const halfLength = Math.abs(Math.cos(angle)) * other.length / 2 + Math.abs(Math.sin(angle)) * other.width / 2;
      const gap = along - halfLength - vehicle.config.length / 2 - 2;
      const forward = Math.max(0, other.velocity.x * Math.sin(vehicle.heading) + other.velocity.z * Math.cos(vehicle.heading));
      const headway = other === playerObstacle && actor.role !== 'support' ? 0.08 : 0.45;
      speed = Math.min(speed, Math.sqrt(forward ** 2 + 2 * 7 * Math.max(0, gap)), Math.max(0, forward + (gap - vehicle.speed * headway) * 0.8));
    }
    return speed;
  }

  private obstacle(vehicle: PhysicsVehicle): TrafficObstacle {
    return { position: vehicle.body.translation(), velocity: vehicle.body.linvel(), heading: vehicle.heading, length: vehicle.config.length, width: vehicle.config.width };
  }

  private clearSweep(actor: PoliceCar, target: Point3, player: PhysicsVehicle, ignorePlayer: boolean, staticOnly = false) {
    const from = actor.vehicle.body.translation();
    const velocity = { x: target.x - from.x, y: target.y - from.y, z: target.z - from.z };
    return !this.world.castShape(from, actor.vehicle.body.rotation(), velocity, this.shape, 0.08, 1, false, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, QUERY_GROUPS, undefined, actor.vehicle.body, collider => (!staticOnly || !collider.parent()) && !this.isTrafficCollider(collider) && (!ignorePlayer || collider.parent()?.handle !== player.body.handle));
  }

  private clearAttack(actor: PoliceCar, target: Point3, player: PhysicsVehicle) {
    const from = actor.vehicle.body.translation();
    const velocity = { x: target.x - from.x, y: target.y - from.y, z: target.z - from.z };
    const hit = this.world.castShape(from, actor.vehicle.body.rotation(), velocity, this.shape, 0.08, 1, false, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, QUERY_GROUPS, undefined, actor.vehicle.body, collider => !this.isTrafficCollider(collider));
    return !hit || hit.collider.parent()?.handle === player.body.handle;
  }

  private isTrafficCollider(collider: RAPIER.Collider) {
    const body = collider.parent();
    return !!body && this.options.isTrafficBody(body.handle);
  }

  effective(player: PhysicsVehicle) {
    const road = this.navigation.locate(groundPosition(player));
    if (!road) return [];
    return this.activeCars.filter(actor => actor.activePursuit && actor.road && this.navigation.sameCorridor(actor.road, road, 220));
  }

  sync(time: number) {
    for (const actor of this.cars) {
      actor.vehicle.sync(time);
      if (!actor.operational) for (const light of actor.vehicle.model.policeLights) light.visible = false;
    }
  }
  render(alpha: number) { for (const actor of this.cars) actor.vehicle.render(alpha) }
  dispose() { for (const actor of this.cars) actor.vehicle.dispose(); this.cars.length = 0; this.events.length = 0 }
}
