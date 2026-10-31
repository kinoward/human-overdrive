import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export class VehicleStability {
  private up = new THREE.Vector3();
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private support = new THREE.Vector3();
  private error = new THREE.Vector3();
  private angular = new THREE.Vector3();
  private impulse = new THREE.Vector3();
  private rotation = new THREE.Quaternion();

  update(body: RAPIER.RigidBody, controller: RAPIER.DynamicRayCastVehicleController, motorcycle: boolean, recovery: number, dt: number) {
    this.support.set(0, 0, 0);
    let contacts = 0;
    for (let i = 0; i < controller.numWheels(); i++) {
      if (!controller.wheelIsInContact(i)) continue;
      const normal = controller.wheelContactNormal(i);
      if (!normal || normal.y < 0.3) continue;
      this.support.add(normal);
      contacts++;
    }
    if (contacts < (motorcycle ? 1 : 2)) return;
    this.support.normalize();
    this.rotation.copy(body.rotation());
    this.up.set(0, 1, 0).applyQuaternion(this.rotation);
    if (this.up.dot(this.support) < (motorcycle ? 0.45 : 0.65)) return;
    const assistance = THREE.MathUtils.clamp(1 - recovery / 0.45, 0, 1);
    if (assistance === 0) return;
    this.forward.set(0, 0, 1).applyQuaternion(this.rotation);
    this.right.set(1, 0, 0).applyQuaternion(this.rotation);
    this.angular.copy(body.angvel());
    this.error.crossVectors(this.up, this.support);
    const inertia = body.principalInertia();
    const roll = THREE.MathUtils.clamp(this.error.dot(this.forward) * (motorcycle ? 32 : 12) - this.angular.dot(this.forward) * (motorcycle ? 7 : 3), motorcycle ? -18 : -3.5, motorcycle ? 18 : 3.5);
    this.impulse.copy(this.forward).multiplyScalar(roll * inertia.z);
    if (motorcycle) {
      const pitch = THREE.MathUtils.clamp(this.error.dot(this.right) * 16 - this.angular.dot(this.right) * 4, -8, 8);
      this.impulse.addScaledVector(this.right, pitch * inertia.x);
    }
    this.impulse.multiplyScalar(dt * assistance);
    body.applyTorqueImpulse(this.impulse, true);
  }
}
