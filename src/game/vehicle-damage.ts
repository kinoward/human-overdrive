import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleConfig } from '../types';
import { DamageDebris } from './damage-debris';

interface DamagePart {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  kind: 'glass' | 'detachable';
  bounds: THREE.Box3;
  removed: boolean;
}

function atlasTile(uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number) {
  return Math.floor(uv.getX(vertex) * 2048 / 340) + Math.floor(uv.getY(vertex) * 2048 / 340) * 6;
}

function subsetGeometry(source: THREE.BufferGeometry, vertices: number[]) {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = source.getAttribute(name);
    if (!attribute) continue;
    const array = new Float32Array(vertices.length * attribute.itemSize);
    for (let index = 0; index < vertices.length; index++) {
      for (let component = 0; component < attribute.itemSize; component++) {
        array[index * attribute.itemSize + component] = attribute.getComponent(vertices[index], component);
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export class VehicleDamage {
  readonly summary = { dents: 0, brokenGlass: 0, detachedParts: 0 };
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private source: THREE.BufferGeometry;
  private geometry?: THREE.BufferGeometry;
  private rest?: Float32Array;
  private deformable?: Uint8Array;
  private parts: DamagePart[] = [];
  private debris: DamageDebris;
  private meshToGroup = new THREE.Matrix4();
  private groupToMesh = new THREE.Matrix4();
  private disposed = false;

  constructor(private group: THREE.Group, private config: VehicleConfig, private body: RAPIER.RigidBody, world: RAPIER.World) {
    this.mesh = group.getObjectByName('body') as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    this.source = this.mesh.geometry;
    group.updateMatrixWorld(true);
    this.meshToGroup.multiplyMatrices(group.matrixWorld.clone().invert(), this.mesh.matrixWorld);
    this.groupToMesh.copy(this.meshToGroup).invert();
    this.debris = new DamageDebris(group, body, world);
  }

  impact(point: THREE.Vector3, direction: THREE.Vector3, severity: number) {
    if (this.disposed || severity < 0.12) return;
    this.mesh.updateWorldMatrix(true, false);
    this.meshToGroup.multiplyMatrices(this.group.matrixWorld.clone().invert(), this.mesh.matrixWorld);
    this.groupToMesh.copy(this.meshToGroup).invert();
    this.prepare();
    const rotation = new THREE.Quaternion().copy(this.body.rotation());
    const localPoint = point.clone().sub(this.body.translation()).applyQuaternion(rotation.clone().invert()).applyMatrix4(this.groupToMesh);
    const localDirection = direction.clone().applyQuaternion(rotation.invert()).transformDirection(this.groupToMesh);
    this.dent(localPoint, localDirection, severity);
    if (severity >= 0.3) {
      const candidates = this.parts.filter(part => !part.removed && part.kind === 'glass')
        .map(part => ({ part, distance: part.bounds.distanceToPoint(localPoint) }))
        .filter(entry => entry.distance < 0.4 + severity * 1.25)
        .sort((a, b) => a.distance - b.distance);
      for (const { part } of candidates.slice(0, severity > 0.82 ? 2 : 1)) this.breakGlass(part, direction, severity);
    }
    if (severity >= 0.55 && this.summary.detachedParts < 3 && this.debris.available) {
      const nearest = this.parts.filter(part => !part.removed && part.kind === 'detachable')
        .map(part => ({ part, distance: part.bounds.distanceToPoint(localPoint) }))
        .filter(entry => entry.distance < 0.25 + severity * 0.65)
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest) this.detach(nearest.part, direction, severity);
    }
  }

  update(dt: number) {
    if (!this.disposed && dt > 0) this.debris.update(dt);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.debris.dispose();
    for (const part of this.parts) {
      part.mesh.removeFromParent();
      part.mesh.geometry.dispose();
    }
    this.mesh.geometry = this.source;
    this.geometry?.dispose();
  }

  private prepare() {
    if (this.geometry) return;
    const geometry = this.source.clone();
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv');
    const glass = new Set(this.config.kind === 'car' ? [6, 15, 17, 18] : []);
    const detachable = new Set(this.config.kind === 'car' ? [1, 4, 7, 16] : [5]);
    const protectedTiles = new Set(this.config.kind === 'motorcycle' ? [0, 3, 7, 9, 13, 17] : []);
    const partitions = new Map<number, number[]>();
    const shell: number[] = [];
    const index = geometry.getIndex();
    const count = index?.count ?? position.count;
    this.deformable = new Uint8Array(position.count);
    for (let offset = 0; offset < count; offset += 3) {
      const triangle = [0, 1, 2].map(corner => index ? index.getX(offset + corner) : offset + corner);
      const tile = atlasTile(uv, triangle[0]);
      if (glass.has(tile) || detachable.has(tile)) {
        const vertices = partitions.get(tile) ?? [];
        vertices.push(...triangle);
        partitions.set(tile, vertices);
      } else {
        shell.push(...triangle);
        if (!protectedTiles.has(tile)) for (const vertex of triangle) this.deformable[vertex] = 1;
      }
    }
    for (const [tile, vertices] of partitions) {
      const partGeometry = subsetGeometry(this.source, vertices);
      const mesh = new THREE.Mesh(partGeometry, this.mesh.material);
      mesh.name = `damage_part_${tile}`;
      mesh.position.copy(this.mesh.position);
      mesh.quaternion.copy(this.mesh.quaternion);
      mesh.scale.copy(this.mesh.scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.mesh.parent!.add(mesh);
      this.parts.push({ mesh, kind: glass.has(tile) ? 'glass' : 'detachable', bounds: partGeometry.boundingBox!.clone(), removed: false });
    }
    geometry.setIndex(shell);
    position.setUsage(THREE.DynamicDrawUsage);
    this.geometry = geometry;
    this.mesh.geometry = geometry;
    this.rest = new Float32Array(position.array);
  }

  private dent(point: THREE.Vector3, direction: THREE.Vector3, severity: number) {
    const position = this.geometry!.getAttribute('position');
    const radius = this.config.kind === 'car' ? 0.45 + severity * 0.8 : 0.3 + severity * 0.45;
    const depth = severity * (this.config.kind === 'car' ? 0.19 : 0.09);
    const maximum = this.config.kind === 'car' ? 0.34 : 0.14;
    const vertex = new THREE.Vector3();
    const original = new THREE.Vector3();
    const displacement = new THREE.Vector3();
    let changed = false;
    for (let index = 0; index < position.count; index++) {
      if (!this.deformable![index]) continue;
      original.fromArray(this.rest!, index * 3);
      const distance = original.distanceTo(point);
      if (distance >= radius) continue;
      const falloff = 1 - distance / radius;
      vertex.fromBufferAttribute(position, index).addScaledVector(direction, depth * falloff * falloff * (3 - 2 * falloff));
      displacement.copy(vertex).sub(original).clampLength(0, maximum);
      vertex.copy(original).add(displacement);
      if (Math.abs(vertex.x - position.getX(index)) + Math.abs(vertex.y - position.getY(index)) + Math.abs(vertex.z - position.getZ(index)) < 0.00001) continue;
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
      changed = true;
    }
    if (!changed) return;
    position.needsUpdate = true;
    this.geometry!.computeVertexNormals();
    this.geometry!.computeBoundingBox();
    this.geometry!.computeBoundingSphere();
    this.summary.dents++;
  }

  private breakGlass(part: DamagePart, direction: THREE.Vector3, severity: number) {
    const geometry = part.mesh.geometry;
    const position = geometry.getAttribute('position');
    const size = part.bounds.getSize(new THREE.Vector3());
    const axis = size.x > size.z ? 'x' : 'z';
    const low = part.bounds.min[axis];
    const width = Math.max(size[axis], 0.01);
    const shards: number[][] = [[], [], []];
    for (let index = 0; index < position.count; index += 3) {
      const center = axis === 'x'
        ? (position.getX(index) + position.getX(index + 1) + position.getX(index + 2)) / 3
        : (position.getZ(index) + position.getZ(index + 1) + position.getZ(index + 2)) / 3;
      shards[Math.min(2, Math.floor(Math.max(0, center - low) / width * 3))].push(index, index + 1, index + 2);
    }
    for (const vertices of shards) {
      if (!vertices.length || !this.debris.available) continue;
      const shard = subsetGeometry(geometry, vertices).applyMatrix4(this.meshToGroup);
      this.debris.add(shard, part.mesh.material, direction, severity, true);
    }
    part.removed = true;
    part.mesh.visible = false;
    this.summary.brokenGlass++;
  }

  private detach(part: DamagePart, direction: THREE.Vector3, severity: number) {
    const geometry = part.mesh.geometry.clone().applyMatrix4(this.meshToGroup);
    if (!this.debris.add(geometry, part.mesh.material, direction, severity, false)) return;
    part.removed = true;
    part.mesh.visible = false;
    this.summary.detachedParts++;
  }
}
