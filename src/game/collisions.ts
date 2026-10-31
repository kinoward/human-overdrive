import RAPIER from '@dimforge/rapier3d-compat';
import type { Point3 } from '../types';
import { AIR_BODY, AIR_ENV, BARRIER, ROAD } from './collision-groups';

export type CollisionActorKind = 'player' | 'police' | 'traffic';
export type ImpactSeverity = 'light' | 'medium' | 'heavy';

export interface CollisionActor {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  kind: CollisionActorKind;
  id?: string | number;
}

export interface ImpactEvent {
  point: Point3;
  direction: Point3;
  strength: number;
  otherBodyHandle?: number;
  otherColliderHandle: number;
  severity: ImpactSeverity;
  deltaV: number;
  approachSpeed: number;
  balanceDisabled: number;
  newIncident: boolean;
  feedback: boolean;
  otherKind?: Exclude<CollisionActorKind, 'player'>;
}

export interface VehicleImpactEvent extends Omit<ImpactEvent, 'otherKind'> {
  bodyHandle: number;
  otherKind?: CollisionActorKind;
}

export interface CollisionFrame {
  impacts: ImpactEvent[];
  policeImpacts: VehicleImpactEvent[];
  trafficImpacts: VehicleImpactEvent[];
  contactBodies: Set<number>;
}

interface BodySnapshot {
  position: Point3;
  linvel: Point3;
  angvel: Point3;
}

interface ContactSample {
  point: Point3;
  direction: Point3;
  key: string;
  otherCollider: RAPIER.Collider;
  otherBody?: RAPIER.RigidBody;
  otherActor?: CollisionActor;
  approachSpeed: number;
  impulse: number;
}

interface ContactProcess {
  peak: number;
  lastSeen: number;
  incident: boolean;
  lastFeedback: number;
  approachSpeed: number;
}

export class CollisionSystem {
  contactCount = 0;
  peakContacts = 0;
  private player?: CollisionActor;
  private actors = new Map<number, CollisionActor>();
  private snapshots = new Map<number, BodySnapshot>();
  private processes = new Map<string, ContactProcess>();
  private vehicleContacts = new Map<string, { lastSeen: number; launched: boolean }>();
  private forceByKey = new Map<string, number>();
  private step = 0;

  constructor(private world: RAPIER.World, private events: RAPIER.EventQueue) {}

  beforeStep(player: CollisionActor, actors: readonly CollisionActor[], dt = 1 / 60) {
    this.player = player;
    this.actors.clear();
    for (const actor of [player, ...actors]) {
      this.actors.set(actor.body.handle, actor);
      let snapshot = this.snapshots.get(actor.body.handle);
      if (!snapshot) {
        snapshot = { position: { x: 0, y: 0, z: 0 }, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } };
        this.snapshots.set(actor.body.handle, snapshot);
      }
      actor.body.worldCom(snapshot.position);
      if (actor.body.isKinematic()) this.kinematicVelocity(actor.body, dt, snapshot.linvel);
      else actor.body.linvel(snapshot.linvel);
      actor.body.angvel(snapshot.angvel);
    }
    for (const handle of this.snapshots.keys()) if (!this.actors.has(handle)) this.snapshots.delete(handle);
  }

  afterStep(dt: number): CollisionFrame {
    this.step += dt;
    const contactBodies = new Set<number>();
    const impacts: ImpactEvent[] = [];
    const policeImpacts: VehicleImpactEvent[] = [];
    const trafficImpacts: VehicleImpactEvent[] = [];
    const player = this.player;
    this.events.drainCollisionEvents(() => {});
    this.forceByKey.clear();
    this.events.drainContactForceEvents(event => {
      const first = this.world.getCollider(event.collider1());
      const second = this.world.getCollider(event.collider2());
      if (!first || !second) return;
      const firstActor = first.parent() ? this.actors.get(first.parent()!.handle) : undefined;
      const secondActor = second.parent() ? this.actors.get(second.parent()!.handle) : undefined;
      if (firstActor) this.recordForce(firstActor, first, second, event.totalForceMagnitude());
      if (secondActor) this.recordForce(secondActor, second, first, event.totalForceMagnitude());
    });
    if (!player) return { impacts, policeImpacts, trafficImpacts, contactBodies };
    for (const actor of this.actors.values()) {
      if (actor.kind === 'traffic' && !actor.body.isDynamic()) continue;
      for (const sample of this.collectContacts(actor, actor.kind === 'player' ? contactBodies : undefined)) {
        this.launchVehicles(actor, sample);
        const impact = this.impact(sample, actor, dt);
        if (!impact) continue;
        if (actor.kind === 'player') impacts.push({ ...impact, otherKind: sample.otherActor?.kind === 'player' ? undefined : sample.otherActor?.kind });
        else if (actor.kind === 'police') policeImpacts.push({ ...impact, bodyHandle: actor.body.handle, otherKind: sample.otherActor?.kind });
        else trafficImpacts.push({ ...impact, bodyHandle: actor.body.handle, otherKind: sample.otherActor?.kind });
      }
    }
    this.contactCount = contactBodies.size;
    this.peakContacts = Math.max(this.peakContacts, this.contactCount);
    for (const [key, process] of this.processes) if (this.step - process.lastSeen > 0.25) this.processes.delete(key);
    for (const [key, contact] of this.vehicleContacts) if (this.step - contact.lastSeen > 0.25) this.vehicleContacts.delete(key);
    return { impacts, policeImpacts, trafficImpacts, contactBodies };
  }

  reset() {
    this.contactCount = 0;
    this.peakContacts = 0;
    this.player = undefined;
    this.actors.clear();
    this.snapshots.clear();
    this.processes.clear();
    this.vehicleContacts.clear();
    this.forceByKey.clear();
    this.step = 0;
  }

  private collectContacts(subject: CollisionActor, contactBodies?: Set<number>) {
    const current = new Map<string, ContactSample>();
    for (let index = 0; index < subject.body.numColliders(); index++) {
      const subjectCollider = subject.body.collider(index);
      this.world.contactPairsWith(subjectCollider, other => {
        const sample = this.sampleContact(subject, subjectCollider, other);
        if (!sample) return;
        const previous = current.get(sample.key);
        if (!previous) current.set(sample.key, sample);
        else {
          if (sample.approachSpeed > previous.approachSpeed) {
            previous.point = sample.point;
            previous.direction = sample.direction;
            previous.otherCollider = sample.otherCollider;
          }
          previous.impulse += sample.impulse;
          previous.approachSpeed = Math.max(previous.approachSpeed, sample.approachSpeed);
        }
        if (contactBodies && sample.otherBody && sample.otherActor) contactBodies.add(sample.otherBody.handle);
      });
    }
    return current.values();
  }

  private impact(sample: ContactSample, subject: CollisionActor, dt: number): Omit<ImpactEvent, 'otherKind'> | undefined {
    const force = this.forceByKey.get(sample.key) ?? 0;
    const mass = Math.max(1, subject.body.mass());
    const otherMass = sample.otherActor?.body.mass();
    const massShare = otherMass === undefined ? 0.5 : otherMass / (mass + otherMass);
    const deltaV = Math.max(sample.impulse / mass, force * dt / mass, sample.approachSpeed * 0.44 * massShare);
    let process = this.processes.get(sample.key);
    if (!process) {
      process = { peak: 0, lastSeen: this.step, incident: false, lastFeedback: -Infinity, approachSpeed: 0 };
      this.processes.set(sample.key, process);
    }
    process.peak *= Math.exp(-(this.step - process.lastSeen) * 2.5);
    process.lastSeen = this.step;
    const qualifying = sample.approachSpeed >= 0.45 && deltaV >= 0.12;
    const newIncident = qualifying && !process.incident;
    const renewed = sample.approachSpeed > process.approachSpeed + 0.6;
    const feedback = qualifying && (newIncident || this.step - process.lastFeedback >= 0.35 && (renewed || deltaV > Math.max(0.8, process.peak * 1.5)));
    process.incident ||= qualifying;
    process.peak = Math.max(process.peak, deltaV);
    process.approachSpeed = sample.approachSpeed;
    if (feedback) process.lastFeedback = this.step;
    if (!newIncident && !feedback) return undefined;
    const severity: ImpactSeverity = deltaV >= 4 ? 'heavy' : deltaV >= 1.2 ? 'medium' : 'light';
    return {
      point: sample.point,
      direction: sample.direction,
      strength: Math.min(1, deltaV / 7),
      otherBodyHandle: sample.otherBody?.handle,
      otherColliderHandle: sample.otherCollider.handle,
      severity,
      deltaV,
      approachSpeed: sample.approachSpeed,
      balanceDisabled: Math.min(1.45, deltaV * 0.18),
      newIncident,
      feedback
    };
  }

  private launchVehicles(subject: CollisionActor, sample: ContactSample) {
    const other = sample.otherActor;
    if (!other || !subject.body.isDynamic() || !other.body.isDynamic()) return;
    const first = Math.min(subject.body.handle, other.body.handle);
    const second = Math.max(subject.body.handle, other.body.handle);
    const key = `${first}:${second}`;
    let contact = this.vehicleContacts.get(key);
    if (!contact) {
      contact = { lastSeen: this.step, launched: false };
      this.vehicleContacts.set(key, contact);
    }
    contact.lastSeen = this.step;
    if (contact.launched || sample.approachSpeed < 7 || sample.impulse <= 0 || Math.abs(sample.direction.y) > 0.65) return;
    contact.launched = true;
    const firstMass = subject.body.mass(), secondMass = other.body.mass();
    const reducedMass = firstMass * secondMass / (firstMass + secondMass);
    const lift = Math.min(reducedMass * (sample.approachSpeed - 7) * 0.36, Math.min(firstMass, secondMass) * 5.5);
    for (const body of [subject.body, other.body]) {
      const mass = body.mass();
      if (sample.impulse / mass < 4) continue;
      const otherMass = body === subject.body ? secondMass : firstMass;
      const impulse = Math.min(lift * Math.min(1, otherMass / mass), mass * Math.max(0, 5.5 - body.linvel().y));
      if (impulse > 0) body.applyImpulseAtPoint({ x: 0, y: impulse, z: 0 }, sample.point, true);
    }
  }

  private recordForce(subject: CollisionActor, first: RAPIER.Collider, second: RAPIER.Collider, force: number) {
    const sample = this.resolvePair(subject, first, second);
    if (!sample) return;
    this.forceByKey.set(sample.key, (this.forceByKey.get(sample.key) ?? 0) + force);
  }

  private sampleContact(subject: CollisionActor, subjectCollider: RAPIER.Collider, other: RAPIER.Collider): ContactSample | undefined {
    const resolved = this.resolvePair(subject, subjectCollider, other);
    if (!resolved || other.isSensor()) return undefined;
    let approachSpeed = 0;
    let impulse = 0;
    let solverContacts = 0;
    this.world.contactPair(subjectCollider, other, (manifold, flipped) => {
      if (manifold.numSolverContacts() === 0) return;
      solverContacts += manifold.numSolverContacts();
      const normal = manifold.normal();
      const direction = flipped ? { x: -normal.x, y: -normal.y, z: -normal.z } : normal;
      for (let index = 0; index < manifold.numSolverContacts(); index++) {
        const point = manifold.solverContactPoint(index);
        if (!point) continue;
        const subjectVelocity = this.velocityAtPoint(subject.body, point);
        const otherVelocity = resolved.otherBody ? this.velocityAtPoint(resolved.otherBody, point) : { x: 0, y: 0, z: 0 };
        const closing =
          (subjectVelocity.x - otherVelocity.x) * direction.x +
          (subjectVelocity.y - otherVelocity.y) * direction.y +
          (subjectVelocity.z - otherVelocity.z) * direction.z;
        if (closing >= approachSpeed) {
          approachSpeed = closing;
          resolved.point = this.copy(point);
          resolved.direction = { x: -direction.x, y: -direction.y, z: -direction.z };
        }
      }
      for (let index = 0; index < manifold.numContacts(); index++) impulse += Math.abs(manifold.contactImpulse(index));
    });
    if (solverContacts === 0) return undefined;
    resolved.approachSpeed = Math.max(0, approachSpeed);
    resolved.impulse = impulse;
    return resolved;
  }

  private resolvePair(subject: CollisionActor, first: RAPIER.Collider, second: RAPIER.Collider): ContactSample | undefined {
    const firstBody = first.parent();
    const secondBody = second.parent();
    const firstSubject = firstBody?.handle === subject.body.handle;
    const secondSubject = secondBody?.handle === subject.body.handle;
    if (!firstSubject && !secondSubject) return undefined;
    const otherCollider = firstSubject ? second : first;
    const otherBody = otherCollider.parent() ?? undefined;
    const otherActor = otherBody ? this.actors.get(otherBody.handle) : undefined;
    const membership = (otherCollider.collisionGroups() >>> 16) & 0xffff;
    if (membership & (AIR_ENV | AIR_BODY)) return undefined;
    if (membership & ROAD) {
      if (subject.kind !== 'police') return undefined;
      const rotation = subject.body.rotation();
      const up = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
      const falling = this.snapshots.get(subject.body.handle)?.linvel.y ?? 0;
      if (up > 0.55 && falling > -5) return undefined;
    } else if (!otherActor && !(membership & BARRIER)) return undefined;
    const identity = otherBody ? `body:${otherBody.handle}` : membership & ROAD ? 'road' : 'barrier';
    const key = subject.kind === 'player' ? identity : `subject:${subject.body.handle}:${identity}`;
    return { key, otherCollider, otherBody, otherActor, approachSpeed: 0, impulse: 0, point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } };
  }

  private kinematicVelocity(body: RAPIER.RigidBody, dt: number, velocity: Point3) {
    const next = body.nextTranslation();
    const current = body.translation();
    velocity.x = (next.x - current.x) / dt;
    velocity.y = (next.y - current.y) / dt;
    velocity.z = (next.z - current.z) / dt;
  }

  private velocityAtPoint(body: RAPIER.RigidBody, point: Point3) {
    const snapshot = this.snapshots.get(body.handle);
    if (!snapshot) return { x: 0, y: 0, z: 0 };
    const rx = point.x - snapshot.position.x;
    const ry = point.y - snapshot.position.y;
    const rz = point.z - snapshot.position.z;
    return {
      x: snapshot.linvel.x + snapshot.angvel.y * rz - snapshot.angvel.z * ry,
      y: snapshot.linvel.y + snapshot.angvel.z * rx - snapshot.angvel.x * rz,
      z: snapshot.linvel.z + snapshot.angvel.x * ry - snapshot.angvel.y * rx
    };
  }

  private copy(vector: Point3): Point3 {
    return { x: vector.x, y: vector.y, z: vector.z };
  }
}
