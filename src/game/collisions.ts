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

export interface CollisionFrame {
  impacts: ImpactEvent[];
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
}

export class CollisionSystem {
  private player?: CollisionActor;
  private actors = new Map<number, CollisionActor>();
  private snapshots = new Map<number, BodySnapshot>();
  private processes = new Map<string, ContactProcess>();
  private forceByKey = new Map<string, number>();
  private step = 0;

  constructor(private world: RAPIER.World, private events: RAPIER.EventQueue) {}

  beforeStep(player: CollisionActor, actors: readonly CollisionActor[], dt = 1 / 60) {
    this.player = player;
    this.actors.clear();
    this.snapshots.clear();
    for (const actor of [player, ...actors]) {
      this.actors.set(actor.body.handle, actor);
      this.snapshots.set(actor.body.handle, {
        position: this.copy(actor.body.worldCom()),
        linvel: actor.body.isKinematic() ? this.kinematicVelocity(actor.body, dt) : this.copy(actor.body.linvel()),
        angvel: this.copy(actor.body.angvel())
      });
    }
  }

  afterStep(dt: number): CollisionFrame {
    this.step += dt;
    const contactBodies = new Set<number>();
    const impacts: ImpactEvent[] = [];
    const player = this.player;
    this.events.drainCollisionEvents(() => {});
    this.forceByKey.clear();
    this.events.drainContactForceEvents(event => {
      if (!player) return;
      const first = this.world.getCollider(event.collider1());
      const second = this.world.getCollider(event.collider2());
      if (!first || !second) return;
      const sample = this.resolvePair(player, first, second);
      if (!sample) return;
      this.forceByKey.set(sample.key, (this.forceByKey.get(sample.key) ?? 0) + event.totalForceMagnitude());
    });
    if (!player) return { impacts, contactBodies };
    const current = new Map<string, ContactSample>();
    for (let index = 0; index < player.body.numColliders(); index++) {
      const playerCollider = player.body.collider(index);
      this.world.contactPairsWith(playerCollider, other => {
        const sample = this.sampleContact(player, playerCollider, other);
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
        if (sample.otherBody && sample.otherActor) contactBodies.add(sample.otherBody.handle);
      });
    }
    for (const sample of current.values()) {
      const force = this.forceByKey.get(sample.key) ?? 0;
      const mass = Math.max(1, player.body.mass());
      const deltaV = Math.max(sample.impulse / mass, force * dt / mass, sample.approachSpeed * 0.22);
      let process = this.processes.get(sample.key);
      if (!process) {
        process = { peak: 0, lastSeen: this.step, incident: false };
        this.processes.set(sample.key, process);
      }
      process.lastSeen = this.step;
      const qualifying = sample.approachSpeed >= 0.45 && deltaV >= 0.12;
      const newIncident = qualifying && !process.incident;
      const feedback = qualifying && (newIncident || deltaV > Math.max(0.8, process.peak * 1.7));
      process.incident ||= qualifying;
      process.peak = Math.max(process.peak, deltaV);
      if (!newIncident && !feedback) continue;
      const severity: ImpactSeverity = deltaV >= 1.7 || sample.approachSpeed >= 7 ? 'heavy' : deltaV >= 0.55 || sample.approachSpeed >= 2.5 ? 'medium' : 'light';
      impacts.push({
        point: sample.point,
        direction: sample.direction,
        strength: Math.min(1, Math.max(deltaV / 7, sample.approachSpeed / 24)),
        otherBodyHandle: sample.otherBody?.handle,
        otherColliderHandle: sample.otherCollider.handle,
        severity,
        deltaV,
        approachSpeed: sample.approachSpeed,
        balanceDisabled: severity === 'heavy' ? 1.45 : severity === 'medium' ? 0.7 : 0.08,
        newIncident,
        feedback,
        otherKind: sample.otherActor?.kind === 'player' ? undefined : sample.otherActor?.kind
      });
    }
    for (const [key, process] of this.processes) if (this.step - process.lastSeen > 0.25) this.processes.delete(key);
    return { impacts, contactBodies };
  }

  reset() {
    this.player = undefined;
    this.actors.clear();
    this.snapshots.clear();
    this.processes.clear();
    this.forceByKey.clear();
    this.step = 0;
  }

  private sampleContact(player: CollisionActor, playerCollider: RAPIER.Collider, other: RAPIER.Collider): ContactSample | undefined {
    const resolved = this.resolvePair(player, playerCollider, other);
    if (!resolved || other.isSensor()) return undefined;
    let approachSpeed = 0;
    let impulse = 0;
    let solverContacts = 0;
    this.world.contactPair(playerCollider, other, (manifold, flipped) => {
      if (manifold.numSolverContacts() === 0) return;
      solverContacts += manifold.numSolverContacts();
      const normal = manifold.normal();
      const direction = flipped ? { x: -normal.x, y: -normal.y, z: -normal.z } : normal;
      for (let index = 0; index < manifold.numSolverContacts(); index++) {
        const point = manifold.solverContactPoint(index);
        if (!point) continue;
        const playerVelocity = this.velocityAtPoint(player.body, point);
        const otherVelocity = resolved.otherBody ? this.velocityAtPoint(resolved.otherBody, point) : { x: 0, y: 0, z: 0 };
        const closing =
          (playerVelocity.x - otherVelocity.x) * direction.x +
          (playerVelocity.y - otherVelocity.y) * direction.y +
          (playerVelocity.z - otherVelocity.z) * direction.z;
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

  private resolvePair(player: CollisionActor, first: RAPIER.Collider, second: RAPIER.Collider): ContactSample | undefined {
    const firstBody = first.parent();
    const secondBody = second.parent();
    const firstPlayer = firstBody?.handle === player.body.handle;
    const secondPlayer = secondBody?.handle === player.body.handle;
    if (!firstPlayer && !secondPlayer) return undefined;
    const otherCollider = firstPlayer ? second : first;
    const otherBody = otherCollider.parent() ?? undefined;
    const otherActor = otherBody ? this.actors.get(otherBody.handle) : undefined;
    const membership = (otherCollider.collisionGroups() >>> 16) & 0xffff;
    if (membership & (AIR_ENV | AIR_BODY)) return undefined;
    if (membership & ROAD) {
      const rotation = player.body.rotation();
      const up = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
      const falling = this.snapshots.get(player.body.handle)?.linvel.y ?? 0;
      if (up > 0.55 && falling > -5) return undefined;
    } else if (!otherActor && !(membership & BARRIER)) return undefined;
    if (otherActor?.kind === 'player') return undefined;
    const identity = otherBody ? `body:${otherBody.handle}` : membership & ROAD ? 'road' : 'barrier';
    return { key: identity, otherCollider, otherBody, otherActor, approachSpeed: 0, impulse: 0, point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } };
  }

  private kinematicVelocity(body: RAPIER.RigidBody, dt: number): Point3 {
    const next = body.nextTranslation();
    const current = body.translation();
    return { x: (next.x - current.x) / dt, y: (next.y - current.y) / dt, z: (next.z - current.z) / dt };
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
