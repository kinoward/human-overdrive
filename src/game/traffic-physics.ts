import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { TrafficAgent } from './traffic';

interface TrafficBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  driver: TrafficAgent;
}

export class TrafficCollisionResponse {
  private velocity = new THREE.Vector3();
  private otherVelocity = new THREE.Vector3();
  private target = new THREE.Vector3();
  private otherTarget = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private otherRotation = new THREE.Quaternion();
  private localRotation = new THREE.Quaternion();
  private angular = new THREE.Vector3();

  release(cars: readonly TrafficBody[], dynamicBodies: RAPIER.RigidBody[], dt: number) {
    const active = [...dynamicBodies, ...cars.filter(car => car.driver.dynamic).map(car => car.body)];
    for (let index = 0; index < active.length; index++) {
      const other = active[index];
      this.otherVelocity.copy(other.linvel());
      for (const car of cars) {
        if (car.driver.dynamic) continue;
        const body = car.body;
        const position = body.translation();
        this.velocity.copy(body.nextTranslation()).sub(position).multiplyScalar(1 / dt);
        if (car.driver.motionBlocked) this.velocity.copy(body.linvel());
        const otherPosition = other.translation();
        const range = car.driver.length / 2 + 12 + (this.velocity.length() + this.otherVelocity.length()) * dt;
        if (Math.hypot(position.x - otherPosition.x, position.y - otherPosition.y, position.z - otherPosition.z) > range) continue;
        this.rotation.copy(body.nextRotation());
        this.target.copy(car.collider.translationWrtParent()!).applyQuaternion(this.rotation).add(body.nextTranslation());
        let touching = false;
        for (let i = 0; i < other.numColliders(); i++) {
          const collider = other.collider(i);
          const hit = car.collider.castCollider(this.velocity, collider, this.otherVelocity, 0.06, dt, true);
          if (hit) { touching = true; break }
          this.otherRotation.copy(other.rotation());
          this.angular.copy(other.angvel()).multiplyScalar(dt);
          const angle = this.angular.length();
          if (angle > 0) this.otherRotation.premultiply(new THREE.Quaternion().setFromAxisAngle(this.angular.multiplyScalar(1 / angle), angle));
          this.otherTarget.copy(collider.translationWrtParent()!).applyQuaternion(this.otherRotation).add(otherPosition).addScaledVector(this.otherVelocity, dt);
          this.otherRotation.multiply(this.localRotation.copy(collider.rotationWrtParent()!));
          const contact = car.collider.shape.contactShape(this.target, this.rotation, collider.shape, this.otherTarget, this.otherRotation, 0.06);
          if (contact) { touching = true; break }
        }
        if (!touching) continue;
        this.rotation.copy(body.nextRotation()).multiply(new THREE.Quaternion().copy(body.rotation()).invert());
        if (this.rotation.w < 0) this.rotation.set(-this.rotation.x, -this.rotation.y, -this.rotation.z, -this.rotation.w);
        const angle = 2 * Math.acos(THREE.MathUtils.clamp(this.rotation.w, -1, 1));
        this.angular.set(this.rotation.x, this.rotation.y, this.rotation.z);
        if (this.angular.lengthSq() > 1e-10) this.angular.normalize().multiplyScalar(Math.min(2, angle / dt));
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        body.recomputeMassPropertiesFromColliders();
        body.setLinvel(this.velocity, true);
        body.setAngvel(this.angular, true);
        car.driver.dynamic = true;
        car.driver.indicator = 0;
        car.driver.braking = false;
        active.push(body);
      }
    }
  }
}
