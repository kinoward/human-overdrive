import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BARRIER, DEBRIS, ROAD, packCollisionGroups } from './collision-groups';

interface DebrisPiece {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  age: number;
  material?: THREE.Material;
  lifetime: number;
}

const budgets = new WeakMap<RAPIER.World, { active: number }>();

export class DamageDebris {
  private pieces: DebrisPiece[] = [];
  readonly limit = 8;
  private budget: { active: number };

  constructor(private group: THREE.Group, private owner: RAPIER.RigidBody, private world: RAPIER.World) {
    this.budget = budgets.get(world) ?? { active: 0 };
    budgets.set(world, this.budget);
  }

  static activeCount(world: RAPIER.World) { return budgets.get(world)?.active ?? 0 }

  get available() { return Math.min(this.limit - this.pieces.length, 48 - this.budget.active) }

  add(geometry: THREE.BufferGeometry, material: THREE.Material, direction: THREE.Vector3, strength: number, glass: boolean) {
    if (!this.available) { geometry.dispose(); return false }
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const center = bounds.getCenter(new THREE.Vector3());
    const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    geometry.translate(-center.x, -center.y, -center.z);
    const rotation = new THREE.Quaternion().copy(this.owner.rotation());
    const position = center.applyQuaternion(rotation).add(this.owner.translation());
    const velocity = new THREE.Vector3().copy(this.owner.velocityAtPoint(position));
    velocity.addScaledVector(direction, strength * (glass ? 2.2 : 1.2));
    velocity.y += glass ? 0.45 : 0.25;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setAngvel(this.owner.angvel())
      .setLinearDamping(0.25)
      .setAngularDamping(0.55)
      .setCcdEnabled(true));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(Math.max(half.x, 0.025), Math.max(half.y, 0.025), Math.max(half.z, 0.025))
      .setMass(glass ? 0.08 : 2.5)
      .setFriction(0.55)
      .setRestitution(glass ? 0.18 : 0.1)
      .setCollisionGroups(packCollisionGroups(DEBRIS, ROAD | BARRIER)), body);
    const ownedMaterial = glass ? material.clone() : undefined;
    if (ownedMaterial instanceof THREE.MeshStandardMaterial) {
      ownedMaterial.transparent = true;
      ownedMaterial.opacity = 0.78;
      ownedMaterial.roughness = 0.18;
      ownedMaterial.depthWrite = false;
      ownedMaterial.side = THREE.DoubleSide;
    }
    const mesh = new THREE.Mesh(geometry, ownedMaterial ?? material);
    mesh.position.copy(position);
    mesh.quaternion.copy(rotation);
    mesh.castShadow = false;
    let root: THREE.Object3D = this.group;
    while (root.parent) root = root.parent;
    root.add(mesh);
    this.pieces.push({ mesh, body, age: 0, material: ownedMaterial, lifetime: glass ? 2.5 : 7 });
    this.budget.active++;
    return true;
  }

  update(dt: number) {
    for (let index = this.pieces.length - 1; index >= 0; index--) {
      const piece = this.pieces[index];
      piece.age += dt;
      if (piece.age >= piece.lifetime) { this.remove(index); continue }
      if (!piece.body.isSleeping()) {
        piece.mesh.position.copy(piece.body.translation());
        piece.mesh.quaternion.copy(piece.body.rotation());
      }
      piece.mesh.scale.setScalar(Math.min(1, (piece.lifetime - piece.age) / 0.7));
    }
  }

  dispose() {
    while (this.pieces.length) this.remove(this.pieces.length - 1);
  }

  private remove(index: number) {
    const piece = this.pieces[index];
    piece.mesh.removeFromParent();
    piece.mesh.geometry.dispose();
    piece.material?.dispose();
    this.world.removeRigidBody(piece.body);
    this.pieces.splice(index, 1);
    this.budget.active--;
  }
}
