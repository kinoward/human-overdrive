import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Point3, VehicleConfig } from '../types';
import { createVehicleModel } from './models';
import { ArcadeDriving, type Controls } from './arcade-driving';
import { RenderPose } from './render-pose';
import { VehicleStability } from './vehicle-stability';
import { VehicleDamage } from './vehicle-damage';
import { GROUND_BODY, GROUND_BODY_GROUPS, ROAD, packCollisionGroups } from './collision-groups';

export type { Controls } from './arcade-driving';

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
  private driving: ArcadeDriving;
  private visualPivot = new THREE.Group();
  private previousLean = 0;
  private currentLean = 0;
  private previousPitch = 0;
  private currentPitch = 0;
  private normal = new THREE.Vector3(0, 1, 0);
  private right = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private angular = new THREE.Vector3();
  private impulse = new THREE.Vector3();
  private angularDelta = new THREE.Vector3();
  private inertia = new THREE.Matrix3();
  private stability = new VehicleStability();

  constructor(readonly world: RAPIER.World, readonly config: VehicleConfig, position: Point3, heading: number, police = false) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y + 0.85, position.z).setRotation(q).setLinearDamping(0.08).setAngularDamping(1.8).setCcdEnabled(true));
    const motorcycle = config.kind === 'motorcycle';
    const borderRadius = motorcycle ? 0.06 : 0.1;
    const shape = RAPIER.ColliderDesc.roundCuboid((motorcycle ? 0.24 : config.width * 0.45) - borderRadius, (motorcycle ? 0.45 : 0.32) - borderRadius, config.length * 0.43 - borderRadius, borderRadius)
      .setTranslation(0, motorcycle ? 0.12 : 0.05, 0).setMass(config.mass * 0.4).setFriction(0.35).setRestitution(0.08)
      .setCollisionGroups(GROUND_BODY_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(config.mass * 0.4);
    this.collider = world.createCollider(shape, this.body);
    if (!motorcycle) world.createCollider(RAPIER.ColliderDesc.roundCuboid(config.width * 0.35 - 0.08, 0.22, config.length * 0.23 - 0.08, 0.08)
      .setTranslation(0, 0.55, -config.length * 0.04).setDensity(0).setFriction(0.35).setRestitution(0.04)
      .setCollisionGroups(GROUND_BODY_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(config.mass * 0.4), this.body);
    world.createCollider(RAPIER.ColliderDesc.ball(0.18).setTranslation(0, -0.19, 0).setMass(config.mass * 0.6).setFriction(0.25)
      .setCollisionGroups(GROUND_BODY_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(config.mass * 0.4), this.body);
    this.model = createVehicleModel(config, police);
    this.driving = new ArcadeDriving(config);
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
      this.controller.setWheelSideFrictionStiffness(index, 0);
      this.previousWheels.push(new THREE.Vector3(-0.44, 0, 0));
      this.currentWheels.push(new THREE.Vector3(-0.44, 0, 0));
    }
    const contents = new THREE.Group();
    this.visualPivot.position.y = -0.44 - this.model.wheelRadius;
    contents.position.y = -this.visualPivot.position.y;
    contents.add(...this.model.group.children);
    this.visualPivot.add(contents);
    this.model.group.add(this.visualPivot);
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

  get leanAngle(): number {
    return this.currentLean;
  }

  yawLimit(speed = this.speed): number {
    return this.driving.yawLimit(speed);
  }

  drive(input: Controls, dt: number, onRoad = true) {
    const motorcycle = this.config.kind === 'motorcycle';
    for (let i = 0; i < this.controller.numWheels(); i++) {
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
    }
    this.controller.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, packCollisionGroups(GROUND_BODY, ROAD), collider => collider.parent()?.handle !== this.body.handle);
    this.normal.set(0, 0, 0);
    let contacts = 0;
    for (let i = 0; i < this.controller.numWheels(); i++) {
      if (!this.controller.wheelIsInContact(i)) continue;
      const normal = this.controller.wheelContactNormal(i);
      if (normal && normal.y > 0.35) {
        this.normal.add(normal);
        contacts++;
      }
    }
    const grounded = contacts >= (motorcycle ? 1 : 2);
    if (grounded) this.normal.normalize();
    else this.normal.set(0, 1, 0);
    this.rotation.copy(this.body.rotation());
    this.up.set(0, 1, 0).applyQuaternion(this.rotation);
    this.forward.set(0, 0, 1).applyQuaternion(this.rotation);
    this.forward.addScaledVector(this.normal, -this.forward.dot(this.normal)).normalize();
    this.right.crossVectors(this.forward, this.normal).normalize();
    this.velocity.copy(this.body.linvel());
    this.angular.copy(this.body.angvel());
    this.balanceDisabled = Math.max(0, this.balanceDisabled - dt);
    const result = this.driving.update(input, {
      forwardSpeed: this.velocity.dot(this.forward),
      sideSpeed: this.velocity.dot(this.right),
      yawRate: this.angular.dot(this.normal),
      grounded,
      upright: this.up.dot(this.normal),
      onRoad,
      controlWeight: 1 - THREE.MathUtils.clamp(this.balanceDisabled / 1.2, 0, 1),
    }, dt);
    this.steering = result.steeringAngle;
    this.braking = result.braking;
    for (let i = 0; i < this.controller.numWheels(); i++) this.controller.setWheelSteering(i, i < (motorcycle ? 1 : 2) ? this.steering : 0);
    this.impulse.copy(this.forward).multiplyScalar(result.forwardDelta).addScaledVector(this.right, result.sideDelta).multiplyScalar(this.body.mass());
    this.body.applyImpulse(this.impulse, true);
    const inertia = this.body.effectiveAngularInertia();
    this.inertia.set(inertia.m11, inertia.m12, inertia.m13, inertia.m21, inertia.m22, inertia.m23, inertia.m31, inertia.m32, inertia.m33);
    this.angularDelta.copy(this.normal).multiplyScalar(result.yawDelta).applyMatrix3(this.inertia);
    this.body.applyTorqueImpulse(this.angularDelta, true);
    this.stability.update(this.body, this.controller, motorcycle, this.balanceDisabled, dt);
    this.previousLean = this.currentLean;
    this.currentLean = result.leanAngle;
    this.previousPitch = this.currentPitch;
    this.currentPitch = result.pitchAngle;
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
    this.visualPivot.rotation.set(THREE.MathUtils.lerp(this.previousPitch, this.currentPitch, alpha), 0, THREE.MathUtils.lerp(this.previousLean, this.currentLean, alpha));
  }

  dispose() {
    this.damage.dispose();
    this.model.group.removeFromParent();
    this.model.dispose();
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
