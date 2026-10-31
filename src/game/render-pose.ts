import * as THREE from 'three';
import type { Point3 } from '../types';

export class RenderPose {
  private previousPosition = new THREE.Vector3();
  private currentPosition = new THREE.Vector3();
  private previousRotation = new THREE.Quaternion();
  private currentRotation = new THREE.Quaternion();
  private initialized = false;

  constructor(readonly object: THREE.Object3D) {}

  snap(position: Point3, rotation: THREE.QuaternionLike) {
    this.previousPosition.copy(position); this.currentPosition.copy(position);
    this.previousRotation.copy(rotation); this.currentRotation.copy(rotation);
    this.object.position.copy(position); this.object.quaternion.copy(rotation);
    this.initialized = true;
  }

  capture(position: Point3, rotation: THREE.QuaternionLike) {
    if (!this.initialized) { this.snap(position, rotation); return }
    this.previousPosition.copy(this.currentPosition); this.currentPosition.copy(position);
    this.previousRotation.copy(this.currentRotation); this.currentRotation.copy(rotation);
  }

  render(alpha: number) {
    if (!this.initialized) return;
    this.object.position.lerpVectors(this.previousPosition, this.currentPosition, alpha);
    this.object.quaternion.slerpQuaternions(this.previousRotation, this.currentRotation, alpha);
  }
}
