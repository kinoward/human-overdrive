import * as THREE from 'three';
import type { VehicleConfig } from '../types';

export interface Controls {
  throttle: number;
  steer: number;
  brake: boolean;
}

export interface ArcadeDriveState {
  forwardSpeed: number;
  sideSpeed: number;
  yawRate: number;
  grounded: boolean;
  upright: number;
  onRoad: boolean;
  controlWeight: number;
}

export interface ArcadeDriveOutput {
  forwardDelta: number;
  sideDelta: number;
  yawDelta: number;
  steeringAngle: number;
  leanAngle: number;
  pitchAngle: number;
  braking: boolean;
  slide: number;
}

export class ArcadeDriving {
  private steeringAngle = 0;
  private leanAngle = 0;
  private pitchAngle = 0;
  private slide = 0;

  constructor(readonly config: VehicleConfig) {}

  yawLimit(speed: number): number {
    const motorcycle = this.config.kind === 'motorcycle';
    const ratio = THREE.MathUtils.clamp(Math.abs(speed) / 45, 0, 1);
    const handling = 0.78 + this.config.handling * 0.3;
    const curve = THREE.MathUtils.lerp(motorcycle ? 1.6 : 1.3, motorcycle ? 0.65 : 0.5, ratio) * handling;
    return Math.min(curve, (motorcycle ? 16 : 14) / Math.max(Math.abs(speed), 4));
  }

  update(input: Controls, state: ArcadeDriveState, dt: number): ArcadeDriveOutput {
    const motorcycle = this.config.kind === 'motorcycle';
    const speed = Math.abs(state.forwardSpeed);
    const active = state.grounded && state.upright > 0.45;
    const reverseBrake = input.throttle < 0 && state.forwardSpeed > 0.8 || input.throttle > 0 && state.forwardSpeed < -0.8;
    const braking = input.brake || reverseBrake;
    const visualSpeed = THREE.MathUtils.clamp((speed - 1.5) / 18, 0, 1);

    if (!active) {
      this.steeringAngle = THREE.MathUtils.damp(this.steeringAngle, 0, motorcycle ? 12 : 9, dt);
      this.leanAngle = THREE.MathUtils.damp(this.leanAngle, 0, 12, dt);
      this.pitchAngle = THREE.MathUtils.damp(this.pitchAngle, 0, 10, dt);
      this.slide = THREE.MathUtils.damp(this.slide, 0, 10, dt);
      return this.output(0, 0, 0, braking);
    }

    const topSpeed = this.config.topSpeed / 3.6 * (state.onRoad ? 1 : 0.34);
    const reverseSpeed = state.onRoad ? 8 : 4;
    const controlWeight = state.controlWeight;
    const powerWeight = (0.2 + controlWeight * 0.8) * (state.onRoad ? 1 : 0.35);
    let forwardDelta = 0;

    if (braking) {
      forwardDelta = this.approach(state.forwardSpeed, 0, (motorcycle ? 24 : 20) * dt);
    } else if (input.throttle !== 0) {
      const direction = Math.sign(input.throttle);
      const limit = direction > 0 ? topSpeed : reverseSpeed;
      const targetSpeed = direction * limit;
      if (Math.abs(state.forwardSpeed) >= limit && Math.sign(state.forwardSpeed) === direction) {
        forwardDelta = this.approach(state.forwardSpeed, targetSpeed, 4 * dt);
      } else {
        const speedRatio = THREE.MathUtils.clamp(Math.abs(state.forwardSpeed) / limit, 0, 1);
        const acceleration = this.config.acceleration * 1.15 * (1 - speedRatio * speedRatio) * Math.abs(input.throttle) * powerWeight;
        const requested = direction * acceleration * dt;
        forwardDelta = direction > 0
          ? Math.min(requested, targetSpeed - state.forwardSpeed)
          : Math.max(requested, targetSpeed - state.forwardSpeed);
      }
    } else {
      forwardDelta = this.approach(state.forwardSpeed, 0, (motorcycle ? 0.9 : 1.25) * dt);
    }

    if (!state.onRoad) forwardDelta += this.approach(state.forwardSpeed + forwardDelta, 0, 2.6 * dt);

    const steerSpeed = THREE.MathUtils.clamp(speed / 45, 0, 1);
    const maxSteer = THREE.MathUtils.lerp(motorcycle ? 0.52 : 0.48, motorcycle ? 0.14 : 0.12, steerSpeed);
    const steerTarget = -input.steer * maxSteer * (0.25 + controlWeight * 0.75);
    this.steeringAngle = THREE.MathUtils.damp(this.steeringAngle, steerTarget, (motorcycle ? 13 : 9) * (0.7 + this.config.handling * 0.3), dt);

    const slideSpeed = THREE.MathUtils.clamp((speed - 12) / 30, 0, 1);
    const slideTarget = motorcycle ? 0 : slideSpeed * Math.abs(input.steer) * (input.brake ? 0.85 : 0.32) * controlWeight;
    this.slide = THREE.MathUtils.damp(this.slide, slideTarget, motorcycle ? 10 : 5, dt);

    const yawActivation = THREE.MathUtils.clamp((speed - 0.4) / 4, 0, 1);
    const yawLimit = this.yawLimit(speed);
    const direction = state.forwardSpeed < -0.5 ? -1 : 1;
    const desiredYaw = -input.steer * direction * yawLimit * yawActivation * (motorcycle ? 1 : 1 + this.slide * 0.15);
    const yawResponse = motorcycle ? 7.5 : THREE.MathUtils.lerp(6.5, 4, this.slide);
    const yawRequested = (desiredYaw - state.yawRate) * (1 - Math.exp(-yawResponse * dt));
    const yawDelta = THREE.MathUtils.clamp(yawRequested, -(motorcycle ? 7.5 : 5.5) * dt, (motorcycle ? 7.5 : 5.5) * dt) * controlWeight * (state.onRoad ? 1 : 0.7);

    const grip = state.onRoad ? motorcycle ? 10.5 : THREE.MathUtils.lerp(8.5, 2.4, this.slide) : 5;
    const sideRequested = -state.sideSpeed * (1 - Math.exp(-grip * dt));
    const sideLimit = (motorcycle ? 24 : 20) * dt;
    const sideDelta = THREE.MathUtils.clamp(sideRequested, -sideLimit, sideLimit) * controlWeight;

    const leanTarget = motorcycle
      ? input.steer * 0.58 * visualSpeed * controlWeight
      : -input.steer * 0.04 * visualSpeed * controlWeight * (0.75 + this.slide * 0.25);
    this.leanAngle = THREE.MathUtils.damp(this.leanAngle, leanTarget, motorcycle ? 9 : 7, dt);
    const accelerationSignal = THREE.MathUtils.clamp(forwardDelta / dt / this.config.acceleration, -1, 1);
    const pitchTarget = braking ? 0.025 : -accelerationSignal * (motorcycle ? 0.018 : 0.022);
    this.pitchAngle = THREE.MathUtils.damp(this.pitchAngle, pitchTarget * controlWeight, 8, dt);

    return this.output(forwardDelta, sideDelta, yawDelta, braking);
  }

  private approach(value: number, target: number, maxChange: number) {
    return THREE.MathUtils.clamp(target - value, -maxChange, maxChange);
  }

  private output(forwardDelta: number, sideDelta: number, yawDelta: number, braking: boolean): ArcadeDriveOutput {
    return {
      forwardDelta,
      sideDelta,
      yawDelta,
      steeringAngle: this.steeringAngle,
      leanAngle: this.leanAngle,
      pitchAngle: this.pitchAngle,
      braking,
      slide: this.slide,
    };
  }
}
