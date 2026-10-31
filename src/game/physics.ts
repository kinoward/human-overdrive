import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Point3, VehicleConfig } from '../types';
import { createVehicleModel } from './models';
import { RenderPose } from './render-pose';
import { VehicleStability } from './vehicle-stability';
import { VehicleDamage } from './vehicle-damage';
import { GROUND_BODY, GROUND_BODY_GROUPS, ROAD, packCollisionGroups } from './collision-groups';

export interface Controls { throttle: number; steer: number; brake: boolean }

export class PhysicsVehicle {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly model: ReturnType<typeof createVehicleModel>;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly damage: VehicleDamage;
  steering = 0;
  balanceDisabled = 0;
  private braking = false;
  private forward = new THREE.Vector3();
  private up = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private pose: RenderPose;
  private previousWheels: THREE.Vector3[] = [];
  private currentWheels: THREE.Vector3[] = [];
  private stability = new VehicleStability();

  constructor(readonly world: RAPIER.World, readonly config: VehicleConfig, position: Point3, heading: number, police = false) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y + 0.85, position.z).setRotation(q).setLinearDamping(0.08).setAngularDamping(1.8).setCcdEnabled(true));
    const motorcycle = config.kind === 'motorcycle';
    const shape = RAPIER.ColliderDesc.cuboid(motorcycle ? 0.24 : config.width * 0.45, motorcycle ? 0.45 : 0.32, config.length * 0.43)
      .setTranslation(0, motorcycle ? 0.12 : 0.05, 0).setMass(config.mass * 0.4).setFriction(0.35).setRestitution(0.08)
      .setCollisionGroups(GROUND_BODY_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(config.mass * 0.4);
    this.collider = world.createCollider(shape, this.body);
    if (!motorcycle) world.createCollider(RAPIER.ColliderDesc.cuboid(config.width * 0.35, 0.3, config.length * 0.23)
      .setTranslation(0, 0.55, -config.length * 0.04).setDensity(0).setFriction(0.35).setRestitution(0.04)
      .setCollisionGroups(GROUND_BODY_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(config.mass * 0.4), this.body);
    world.createCollider(RAPIER.ColliderDesc.ball(0.18).setTranslation(0, -0.19, 0).setMass(config.mass * 0.6).setFriction(0.25)
      .setCollisionGroups(GROUND_BODY_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(config.mass * 0.4), this.body);
    this.model = createVehicleModel(config, police);
    this.damage = new VehicleDamage(this.model.group, config, this.body, world);
    this.pose = new RenderPose(this.model.group);
    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    for (const wheel of this.model.wheels) {
      this.controller.addWheel({ x: wheel.position.x, y: -0.14, z: wheel.position.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.3, this.model.wheelRadius);
      const index = this.controller.numWheels() - 1;
      this.controller.setWheelSuspensionStiffness(index, motorcycle ? 42 : 30);
      this.controller.setWheelSuspensionCompression(index, 4.8);
      this.controller.setWheelSuspensionRelaxation(index, 5.8);
      this.controller.setWheelMaxSuspensionForce(index, config.mass * 15);
      this.controller.setWheelMaxSuspensionTravel(index, 0.22);
      this.controller.setWheelFrictionSlip(index, 1.8);
      this.controller.setWheelSideFrictionStiffness(index, motorcycle ? 1.8 : 1.4);
      this.previousWheels.push(new THREE.Vector3(-0.44, 0, 0));
      this.currentWheels.push(new THREE.Vector3(-0.44, 0, 0));
    }
    this.sync(0);
  }

  get speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.z);
  }

  get heading(): number {
    this.rotation.copy(this.body.rotation());
    this.forward.set(0, 0, 1).applyQuaternion(this.rotation);
    return Math.atan2(this.forward.x, this.forward.z);
  }

  get upY(): number {
    this.up.set(0, 1, 0).applyQuaternion(this.body.rotation());
    return this.up.y;
  }

  drive(input: Controls, dt: number, onRoad = true) {
    const speed = this.speed;
    const motorcycle = this.config.kind === 'motorcycle';
    const maxSteer = THREE.MathUtils.lerp(0.48, motorcycle ? 0.14 : 0.115, Math.min(1, speed / 48));
    const desired = -input.steer * maxSteer;
    this.steering = THREE.MathUtils.damp(this.steering, desired, 9, dt);
    this.braking = input.brake;
    const frontCount = motorcycle ? 1 : 2;
    const wheels = this.controller.numWheels();
    const driven = motorcycle ? 1 : 2;
    const q = this.body.rotation();
    this.forward.set(0, 0, 1).applyQuaternion(q);
    const velocity = this.body.linvel();
    const forwardSpeed = this.forward.x * velocity.x + this.forward.z * velocity.z;
    const reversingBrake = input.throttle < 0 && forwardSpeed > 1.5;
    const throttle = reversingBrake ? 0 : input.throttle;
    const maxSpeed = this.config.topSpeed / 3.6 * (onRoad ? 1 : 0.3);
    const speedFactor = throttle > 0 ? Math.max(0, 1 - (speed / maxSpeed) ** 3) : speed < 11 ? 0.45 : 0;
    const force = this.config.mass * this.config.acceleration * throttle * speedFactor / driven;
    for (let i = 0; i < wheels; i++) {
      this.controller.setWheelSteering(i, i < frontCount ? this.steering : 0);
      this.controller.setWheelEngineForce(i, i >= wheels - driven ? force : 0);
      this.controller.setWheelBrake(i, input.brake || reversingBrake ? this.config.mass * 0.022 : input.throttle === 0 ? this.config.mass * 0.00035 : 0);
    }
    this.controller.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, packCollisionGroups(GROUND_BODY, ROAD), collider => collider.parent()?.handle !== this.body.handle);
    if (!onRoad) this.body.applyImpulse({ x: -velocity.x * this.config.mass * dt * 0.55, y: 0, z: -velocity.z * this.config.mass * dt * 0.55 }, true);
    this.balanceDisabled = Math.max(0, this.balanceDisabled - dt);
    this.stability.update(this.body, this.controller, motorcycle, this.balanceDisabled, dt);
  }

  applyImpact(point: Point3, direction: Point3, strength: number) {
    this.damage.impact(new THREE.Vector3(point.x, point.y, point.z), new THREE.Vector3(direction.x, direction.y, direction.z), strength);
  }

  sync(time: number) {
    this.damage.update(1 / 60);
    this.pose.capture(this.body.translation(), this.body.rotation());
    for (let i = 0; i < this.model.wheels.length; i++) {
      this.previousWheels[i].copy(this.currentWheels[i]);
      this.currentWheels[i].set(-0.14 - (this.controller.wheelSuspensionLength(i) ?? 0.3), this.controller.wheelRotation(i) ?? 0, this.controller.wheelSteering(i) ?? 0);
    }
    for (const lamp of this.model.brakeLights) {
      const material = lamp.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = this.braking ? 3 : 0.5;
    }
    for (let i = 0; i < this.model.policeLights.length; i++) this.model.policeLights[i].visible = Math.floor(time * 8 + i) % 2 === 0;
  }

  render(alpha: number) {
    this.pose.render(alpha);
    for (let i = 0; i < this.model.wheels.length; i++) {
      const previous = this.previousWheels[i], current = this.currentWheels[i];
      this.model.wheels[i].position.y = THREE.MathUtils.lerp(previous.x, current.x, alpha);
      this.model.wheels[i].rotation.set(THREE.MathUtils.lerp(previous.y, current.y, alpha), THREE.MathUtils.lerp(previous.z, current.z, alpha), 0, 'YXZ');
    }
  }

  dispose() {
    this.damage.dispose();
    this.model.group.removeFromParent();
    this.model.dispose();
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
