import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { TrafficMotionGuard } from './traffic';
import { BARRIER, GROUND_BODY, ROAD, packCollisionGroups } from './collision-groups';

interface TrafficBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  shape: RAPIER.Shape;
}

const queryGroups = packCollisionGroups(GROUND_BODY, GROUND_BODY | BARRIER);
const contactSkin = 0.08;
const separationEpsilon = 0.0001;

export class TrafficMotionLimiter {
  private vehicles = new Map<number, TrafficBody>();
  private obstacles: { collider: RAPIER.Collider; position: RAPIER.Vector; velocity: RAPIER.Vector; body: number }[] = [];
  private rotation = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private target = new THREE.Vector3();
  private delta = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private relativePosition = new THREE.Vector3();

  constructor(private world: RAPIER.World) {}

  register(id: number, body: RAPIER.RigidBody, collider: RAPIER.Collider) {
    this.vehicles.set(id, { body, collider, shape: collider.shape });
  }

  prepare(dynamicColliders: RAPIER.Collider[]) {
    this.obstacles = [...[...this.vehicles.values()].map(vehicle => vehicle.collider), ...dynamicColliders].map(collider => {
      const body = collider.parent()!;
      return { collider, body: body.handle, position: collider.translation(), velocity: body.linvel() };
    });
  }

  readonly allows: TrafficMotionGuard = (agent, next, dt) => {
    const vehicle = this.vehicles.get(agent.id)!;
    this.rotation.setFromEuler(this.euler.set(next.pitch, next.heading, 0, 'YXZ'));
    this.target.set(0, agent.profile.height * 0.5 - 0.79, 0).applyQuaternion(this.rotation);
    this.target.x += next.position.x; this.target.y += next.position.y + 0.79; this.target.z += next.position.z;
    const position = vehicle.collider.translation();
    this.delta.copy(this.target).sub(position);
    const separating = new Map<number, boolean>();
    const include = (other: RAPIER.Collider) => {
      const cached = separating.get(other.handle);
      if (cached !== undefined) return !cached;
      const membership = other.collisionGroups() >>> 16;
      let allowed = false;
      if (!agent.relocated && dt > 0 && other.parent() && (membership & GROUND_BODY) !== 0 && (membership & (ROAD | BARRIER)) === 0) {
        const current = vehicle.collider.contactCollider(other, contactSkin);
        if (current && current.distance <= contactSkin) {
          this.relativePosition.copy(other.translation()).sub(position);
          const candidate = vehicle.shape.contactShape(this.delta, this.rotation, other.shape, this.relativePosition, other.rotation(), contactSkin);
          allowed = !candidate || candidate.distance > current.distance + separationEpsilon;
        }
      }
      separating.set(other.handle, allowed);
      return !allowed;
    };
    let blocked = false;
    this.world.intersectionsWithShape(this.target, this.rotation, vehicle.shape, () => { blocked = true; return false }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups, vehicle.collider, vehicle.body, include);
    if (blocked || agent.relocated || dt === 0) return !blocked;
    if (this.delta.lengthSq() < 1e-10) return true;
    const distance = this.delta.length();
    this.velocity.copy(this.delta).multiplyScalar(1 / dt);
    const hit = this.world.castShape(position, vehicle.collider.rotation(), this.velocity, vehicle.shape, contactSkin, dt, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups, vehicle.collider, vehicle.body, include);
    if (hit && hit.time_of_impact <= dt) return false;
    for (const other of this.obstacles) {
      if (other.body === vehicle.body.handle) continue;
      const radius = agent.length / 2 + 12 + distance + Math.hypot(other.velocity.x, other.velocity.y, other.velocity.z) * dt;
      if ((other.position.x - position.x) ** 2 + (other.position.y - position.y) ** 2 + (other.position.z - position.z) ** 2 > radius * radius) continue;
      if (!include(other.collider)) continue;
      const relativeHit = vehicle.collider.castCollider(this.velocity, other.collider, other.velocity, contactSkin, dt, true);
      if (relativeHit && relativeHit.time_of_impact <= dt) return false;
    }
    return true;
  };
}
