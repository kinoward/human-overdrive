import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Point3 } from '../types';
import { AIR_BODY_GROUPS } from './collision-groups';
import { createHelicopter } from './models';
import { RenderPose } from './render-pose';
import { Airspace } from './airspace';

export interface HelicopterObservation {
  position: Point3;
  velocity?: Point3;
  time: number;
}

export class PursuitHelicopter {
  readonly model = createHelicopter();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  observation: HelicopterObservation | undefined;
  private pose: RenderPose;
  private direction = new THREE.Vector3(0, 0, 1);
  private desired = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private acceleration = new THREE.Vector3();
  private desiredVelocity = new THREE.Vector3();
  private nextQuery = 0;
  private elapsed = 0;
  private obstacleAhead = false;
  private obstacleAbove = false;
  private home = new THREE.Vector3();
  private displaced = 0;
  private orientation = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private up = new THREE.Vector3();
  private uprightTorque = new THREE.Vector3();
  private worldUp = new THREE.Vector3(0, 1, 0);

  constructor(private world: RAPIER.World, private airspace: Airspace, readonly slot: number, position: Point3) {
    const height = airspace.clearanceHeight(position, 5);
    const spawn = { x: position.x, y: Math.max(position.y, Number.isFinite(height) ? height + 14 : position.y), z: position.z };
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setGravityScale(0)
      .setLinearDamping(0.18)
      .setAngularDamping(3.4)
      .setCcdEnabled(true));
    this.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(1.45, 0.7, 3.0)
      .setMass(1300)
      .setFriction(0.15)
      .setRestitution(0.05)
      .setCollisionGroups(AIR_BODY_GROUPS), this.body);
    this.pose = new RenderPose(this.model.group);
    this.home.set(spawn.x, spawn.y, spawn.z);
    this.afterStep();
  }

  update(dt: number, target: Point3, observed: boolean, report?: Point3) {
    this.elapsed += dt;
    const position = this.body.translation();
    this.velocity.set(this.body.linvel().x, this.body.linvel().y, this.body.linvel().z);
    const reported = observed ? target : report;
    if (reported && (observed || !this.observation || Math.hypot(reported.x - this.observation.position.x, reported.y - this.observation.position.y, reported.z - this.observation.position.z) > 0.01)) {
      const previous = this.observation;
      const elapsed = previous ? Math.max(1 / 60, this.elapsed - previous.time) : 1;
      const velocity = previous ? {
        x: (reported.x - previous.position.x) / elapsed,
        y: (reported.y - previous.position.y) / elapsed,
        z: (reported.z - previous.position.z) / elapsed
      } : { x: 0, y: 0, z: 0 };
      this.observation = { position: { ...reported }, velocity, time: this.elapsed };
    }
    const tracked = this.observation;
    const observationAge = tracked ? this.elapsed - tracked.time : Infinity;
    const velocityFade = observed ? 1 : Math.exp(-observationAge * 1.25);
    const storedVelocity = tracked?.velocity ?? { x: 0, y: 0, z: 0 };
    const observedVelocity = { x: storedVelocity.x * velocityFade, y: storedVelocity.y * velocityFade, z: storedVelocity.z * velocityFade };
    const horizontal = new THREE.Vector3(observedVelocity.x, 0, observedVelocity.z);
    if (horizontal.lengthSq() > 3) this.direction.copy(horizontal).normalize();
    const right = new THREE.Vector3(this.direction.z, 0, -this.direction.x);
    const lead = Math.min(26, horizontal.length() * 0.85 + 8);
    const side = (this.slot - 1) * 19;
    const behind = this.slot === 1 ? -14 : 10;
    const base = tracked?.position ?? this.home;
    this.desired.set(base.x, base.y, base.z)
      .addScaledVector(this.direction, lead + behind)
      .addScaledVector(right, side);
    const clearance = this.airspace.clearanceHeight(this.desired, 5);
    this.desired.y = Math.max(base.y + 24 + this.slot * 5, this.desired.y + 18, Number.isFinite(clearance) ? clearance + 11 : -Infinity);
    if (this.elapsed >= this.nextQuery) {
      this.nextQuery = this.elapsed + 0.12;
      const forward = this.velocity.clone(); forward.y = 0;
      this.obstacleAhead = !!this.airspace.sweep(position, this.body.rotation(), forward, this.body) || !!this.airspace.proximity(position, this.body.rotation(), forward, this.body);
      this.obstacleAbove = !!this.airspace.sweep(position, this.body.rotation(), { x: 0, y: 12, z: 0 }, this.body);
    }
    const search = tracked?.position ?? this.home;
    if (!observed) {
      const searchClearance = this.airspace.clearanceHeight(search, 5);
      this.desired.set(search.x, Math.max(search.y + 24 + this.slot * 5, Number.isFinite(searchClearance) ? searchClearance + 11 : -Infinity), search.z);
    }
    if (this.obstacleAhead) {
      const lateral = right.clone().multiplyScalar(this.slot % 2 ? 20 : -20);
      const lateralBlocked = !!this.airspace.sweep(position, this.body.rotation(), lateral, this.body);
      if (!lateralBlocked) this.desired.add(lateral);
      else if (!this.obstacleAbove) this.desired.y += 13;
      else {
        this.desired.set(position.x, Math.max(position.y, base.y + 20), position.z);
      }
    }
    const error = this.desired.sub(new THREE.Vector3(position.x, position.y, position.z));
    this.displaced = Math.max(0, this.displaced - dt);
    const control = this.displaced > 0 ? 0.32 : 1;
    this.desiredVelocity.set(observedVelocity.x, observedVelocity.y, observedVelocity.z).addScaledVector(error, 0.95 * control);
    this.desiredVelocity.y = THREE.MathUtils.clamp(this.desiredVelocity.y, -9, 11);
    this.acceleration.copy(this.desiredVelocity).sub(this.velocity).multiplyScalar(2.4 * control);
    const horizontalAcceleration = new THREE.Vector3(this.acceleration.x, 0, this.acceleration.z).clampLength(0, 18);
    this.acceleration.x = horizontalAcceleration.x;
    this.acceleration.z = horizontalAcceleration.z;
    this.acceleration.y = THREE.MathUtils.clamp(this.acceleration.y, -9, 11);
    const horizontalSpeed = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    const horizontalSpeedMagnitude = horizontalSpeed.length();
    if (horizontalSpeedMagnitude > 65) this.acceleration.addScaledVector(horizontalSpeed.clone().multiplyScalar(1 / horizontalSpeedMagnitude), -18);
    this.body.applyImpulse({ x: this.acceleration.x * 1300 * dt, y: this.acceleration.y * 1300 * dt, z: this.acceleration.z * 1300 * dt }, true);
    const heading = Math.atan2(this.velocity.x, this.velocity.z);
    if (horizontalSpeedMagnitude > 1) {
      this.orientation.copy(this.body.rotation());
      const current = this.euler.setFromQuaternion(this.orientation, 'YXZ').y;
      const delta = Math.atan2(Math.sin(heading - current), Math.cos(heading - current));
      this.body.applyTorqueImpulse({ x: 0, y: delta * 1500 * dt, z: 0 }, true);
    }
    this.orientation.copy(this.body.rotation());
    this.up.set(0, 1, 0).applyQuaternion(this.orientation);
    this.uprightTorque.crossVectors(this.up, this.worldUp);
    const angular = this.body.angvel();
    const recovery = this.displaced > 0 ? 0.16 : 1;
    this.body.applyTorqueImpulse({
      x: (this.uprightTorque.x * 3600 - angular.x * 620) * recovery * dt,
      y: 0,
      z: (this.uprightTorque.z * 3600 - angular.z * 620) * recovery * dt
    }, true);
    this.model.rotor.rotation.y += dt * 42;
    const lightTarget = observationAge < 5 && tracked ? tracked.position : search;
    this.model.spotlight.target.position.set(lightTarget.x, lightTarget.y, lightTarget.z);
    this.model.spotlight.visible = observed;
  }

  afterStep() {
    this.pose.capture(this.body.translation(), this.body.rotation());
    let contacted = false;
    this.world.contactPairsWith(this.collider, () => { contacted = true; });
    if (contacted) this.displaced = Math.max(this.displaced, 0.55);
  }

  render(alpha: number) {
    this.pose.render(alpha);
  }

  dispose() {
    this.model.group.removeFromParent();
    this.model.spotlight.target.removeFromParent();
    this.model.dispose();
    this.world.removeRigidBody(this.body);
  }
}
