import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Point3 } from '../types';
import { AIR_ENV_GROUPS, AIR_LOS_QUERY_GROUPS, AIR_PROXIMITY_QUERY_GROUPS, AIR_QUERY_GROUPS } from './collision-groups';

export interface AirObstacle {
  center: Point3;
  halfExtents: Point3;
  rotation?: number;
  pitch?: number;
}

export interface SightResult {
  clear: boolean;
  hit?: RAPIER.Collider;
}

export class Airspace {
  private cells = new Map<string, AirObstacle[]>();
  private active = new Map<string, RAPIER.Collider[]>();
  private requested = new Set<string>();
  private retained = new Map<string, number>();
  private updateIndex = 0;

  constructor(private world: RAPIER.World, private cellSize = 500) {}

  setCell(key: string, obstacles: AirObstacle[]) {
    this.cells.set(key, obstacles);
  }

  setObstacles(obstacles: AirObstacle[]) {
    this.cells.clear();
    for (const obstacle of obstacles) {
      const key = this.cellKey(obstacle.center);
      const cell = this.cells.get(key) ?? [];
      cell.push(obstacle);
      this.cells.set(key, cell);
    }
  }

  addScene(scene: THREE.Object3D) {
    const obstacles: AirObstacle[] = [];
    scene.updateWorldMatrix(true, true);
    const instance = new THREE.Matrix4();
    const matrix = new THREE.Matrix4();
    const bounds = new THREE.Box3();
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    scene.traverse(object => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (!materials.some(material => material.userData.airObstacle)) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (!object.geometry.boundingBox) return;
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance);
        matrix.multiplyMatrices(object.matrixWorld, instance);
        bounds.copy(object.geometry.boundingBox).applyMatrix4(matrix);
        bounds.getSize(size);
        if (size.y < 0.3 || Math.max(size.x, size.z) < 3) continue;
        bounds.getCenter(center);
        obstacles.push({ center: { x: center.x, y: center.y, z: center.z }, halfExtents: { x: size.x / 2, y: size.y / 2, z: size.z / 2 } });
      }
    });
    this.setObstacles(obstacles);
  }

  update(points: readonly Point3[], radius = 650) {
    this.updateIndex++;
    this.requested.clear();
    for (const point of points) {
      const cx = Math.floor(point.x / this.cellSize), cz = Math.floor(point.z / this.cellSize);
      const span = Math.ceil(radius / this.cellSize);
      for (let x = cx - span; x <= cx + span; x++) for (let z = cz - span; z <= cz + span; z++) {
        const key = `${x},${z}`;
        this.requested.add(key);
      }
    }
    for (const key of this.requested) {
      this.retained.set(key, this.updateIndex + 120);
      this.activate(key);
    }
    for (const [key, colliders] of this.active) if (!this.requested.has(key) && (this.retained.get(key) ?? 0) < this.updateIndex) {
      for (const collider of colliders) this.world.removeCollider(collider, false);
      this.active.delete(key);
      this.retained.delete(key);
    }
  }

  lineOfSight(from: Point3, to: Point3, ownBody?: RAPIER.RigidBody, targetBody?: RAPIER.RigidBody): SightResult {
    const direction = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const length = direction.length();
    if (length < 0.01) return { clear: true };
    direction.multiplyScalar(1 / length);
    const hit = this.world.castRay(new RAPIER.Ray(from, direction), length, true, undefined, AIR_LOS_QUERY_GROUPS, undefined, ownBody);
    if (!hit) return { clear: true };
    const collider = hit.collider;
    return { clear: !targetBody || collider.parent()?.handle === targetBody.handle, hit: collider };
  }

  clearanceHeight(position: Point3, radius = 4) {
    const span = Math.ceil(radius / this.cellSize) + 1;
    const cx = Math.floor(position.x / this.cellSize), cz = Math.floor(position.z / this.cellSize);
    let top = -Infinity;
    for (let x = cx - span; x <= cx + span; x++) for (let z = cz - span; z <= cz + span; z++) {
      for (const obstacle of this.cells.get(`${x},${z}`) ?? []) {
        const dx = Math.max(0, Math.abs(position.x - obstacle.center.x) - obstacle.halfExtents.x);
        const dz = Math.max(0, Math.abs(position.z - obstacle.center.z) - obstacle.halfExtents.z);
        if (Math.hypot(dx, dz) <= radius) top = Math.max(top, obstacle.center.y + obstacle.halfExtents.y);
      }
    }
    return top;
  }

  sweep(position: Point3, rotation: RAPIER.Rotation, velocity: Point3, ownBody?: RAPIER.RigidBody) {
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed < 0.05) return undefined;
    const horizon = Math.min(145, Math.max(22, speed * speed / 36 + 20));
    return this.world.castShape(position, rotation, velocity, new RAPIER.Cuboid(1.55, 0.72, 3.15), 0.45, Math.min(2.4, horizon / speed), true, undefined, AIR_QUERY_GROUPS, undefined, ownBody);
  }

  proximity(position: Point3, rotation: RAPIER.Rotation, velocity: Point3, ownBody?: RAPIER.RigidBody) {
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed < 0.05) return undefined;
    const horizon = Math.min(145, Math.max(22, speed * speed / 36 + 20));
    return this.world.castShape(position, rotation, velocity, new RAPIER.Cuboid(1.8, 1.2, 3.7), 1.2, Math.min(2.4, horizon / speed), true, undefined, AIR_PROXIMITY_QUERY_GROUPS, undefined, ownBody);
  }

  dispose() {
    this.reset();
    this.cells.clear();
  }

  reset() {
    for (const colliders of this.active.values()) for (const collider of colliders) this.world.removeCollider(collider, false);
    this.active.clear();
    this.retained.clear();
  }

  private activate(key: string) {
    if (this.active.has(key)) return;
    const colliders = (this.cells.get(key) ?? []).map(obstacle => {
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(obstacle.pitch ?? 0, obstacle.rotation ?? 0, 0, 'YXZ'));
      return this.world.createCollider(RAPIER.ColliderDesc.cuboid(obstacle.halfExtents.x, obstacle.halfExtents.y, obstacle.halfExtents.z)
        .setTranslation(obstacle.center.x, obstacle.center.y, obstacle.center.z)
        .setRotation(rotation)
        .setCollisionGroups(AIR_ENV_GROUPS));
    });
    this.active.set(key, colliders);
  }

  private cellKey(point: Point3) {
    return `${Math.floor(point.x / this.cellSize)},${Math.floor(point.z / this.cellSize)}`;
  }
}
