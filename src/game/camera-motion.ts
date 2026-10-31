import * as THREE from 'three';

export class ArcadeCameraMotion {
  private initialized = false;
  private previousSpeed = 0;
  private acceleration = 0;
  private pullback = 0;
  private drop = 0;
  private roll = 0;
  private fov = 38;
  private offset = new THREE.Vector3();
  private rollAxis = new THREE.Vector3(0, 0, 1);
  private rollRotation = new THREE.Quaternion();
  private collisionKick = 0;
  private collisionSide = 0;

  impact(strength: number, side: number) {
    this.collisionKick = Math.max(this.collisionKick, THREE.MathUtils.clamp(strength, 0, 1));
    this.collisionSide = THREE.MathUtils.clamp(side, -1, 1);
  }

  update(camera: THREE.PerspectiveCamera, speed: number, steering: number, motorcycle: boolean, dt: number, active: boolean, lookBack: boolean) {
    if (!active) {
      this.reset();
      return;
    }

    if (dt <= 0) return;

    if (!this.initialized) {
      this.initialized = true;
      this.previousSpeed = speed;
      this.fov = motorcycle ? 40 : 38;
    }

    const rawAcceleration = THREE.MathUtils.clamp((speed - this.previousSpeed) / dt, 0, 12);
    this.previousSpeed = speed;
    const accelerationTarget = rawAcceleration / 12;
    this.acceleration = THREE.MathUtils.damp(this.acceleration, accelerationTarget, motorcycle ? 10 : 8, dt);

    const speedRatio = THREE.MathUtils.smoothstep(speed, 0, 55);
    const baseFov = motorcycle ? 40 : 38;
    const fovTarget = baseFov + speedRatio * 5 + this.acceleration * (lookBack ? 0.4 : 1.2);
    const pullbackTarget = speedRatio * 0.4 + this.acceleration * 0.55;
    const dropTarget = speedRatio * 0.5 + this.acceleration * 0.08;
    const maxRoll = THREE.MathUtils.degToRad(motorcycle ? 1.8 : 1.1);
    const rollTarget = lookBack ? 0 : -steering * maxRoll * (0.35 + speedRatio * 0.65);
    const response = motorcycle ? 9 : 7;
    this.collisionKick *= Math.exp(-dt * 8);

    this.fov = THREE.MathUtils.damp(this.fov, fovTarget, response, dt);
    this.pullback = THREE.MathUtils.damp(this.pullback, pullbackTarget, response, dt);
    this.drop = THREE.MathUtils.damp(this.drop, dropTarget, response, dt);
    this.roll = THREE.MathUtils.damp(this.roll, rollTarget, lookBack ? 24 : motorcycle ? 20 : 16, dt);

    this.offset.set(0, 0, this.pullback * (lookBack ? 0.8 : 1)).applyQuaternion(camera.quaternion);
    camera.position.add(this.offset);
    camera.position.y -= this.drop * (lookBack ? 0.6 : 1);
    this.offset.set(this.collisionSide * this.collisionKick * 0.18, this.collisionKick * 0.1, this.collisionKick * 0.35).applyQuaternion(camera.quaternion);
    camera.position.add(this.offset);
    this.rollRotation.setFromAxisAngle(this.rollAxis, this.roll + this.collisionSide * this.collisionKick * 0.035);
    camera.quaternion.multiply(this.rollRotation);
    camera.fov = this.fov;
    camera.updateProjectionMatrix();
  }

  reset() {
    this.initialized = false;
    this.previousSpeed = 0;
    this.acceleration = 0;
    this.pullback = 0;
    this.drop = 0;
    this.roll = 0;
    this.fov = 38;
    this.collisionKick = 0;
    this.collisionSide = 0;
  }
}
