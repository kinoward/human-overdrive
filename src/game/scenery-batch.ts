import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LoadingBudget } from './loading-budget';

export class SceneryBatch {
  private instances = new Map<string, { material: THREE.Material; geometry: THREE.BufferGeometry; farGeometry?: THREE.BufferGeometry; matrices: THREE.Matrix4[]; colors: THREE.Color[] }>();
  private surfaces = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
  private dummy = new THREE.Object3D();
  readonly box = new THREE.BoxGeometry(1, 1, 1);

  constructor(readonly group: THREE.Group) {}

  instance(material: THREE.Material, position: THREE.Vector3, scale: THREE.Vector3, heading = 0, geometry: THREE.BufferGeometry = this.box, color?: THREE.Color, pitch = 0, farGeometry?: THREE.BufferGeometry) {
    const span = farGeometry ? 80 : 500;
    const key = `${material.id}:${geometry.id}:${Math.floor(position.x / span)},${Math.floor(position.z / span)}`;
    if (!this.instances.has(key)) this.instances.set(key, { material, geometry, farGeometry, matrices: [], colors: [] });
    const batch = this.instances.get(key)!;
    this.dummy.position.copy(position);
    this.dummy.rotation.set(pitch, heading, 0, 'YXZ');
    this.dummy.scale.copy(scale);
    this.dummy.updateMatrix();
    batch.matrices.push(this.dummy.matrix.clone());
    batch.colors.push(color ?? new THREE.Color('white'));
  }

  surface(material: THREE.Material, geometry: THREE.BufferGeometry, x: number, z: number) {
    const key = `${material.id}:${Math.floor(x / 500)},${Math.floor(z / 500)}`;
    if (!this.surfaces.has(key)) this.surfaces.set(key, { material, geometries: [] });
    this.surfaces.get(key)!.geometries.push(geometry);
  }

  async finish() {
    const budget = new LoadingBudget();
    for (const { material, geometry, farGeometry, matrices, colors } of this.instances.values()) {
      if (budget.exhausted) await budget.yield();
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((matrix, i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, colors[i]) });
      mesh.receiveShadow = true;
      mesh.castShadow = material instanceof THREE.MeshStandardMaterial && material.userData.sceneryShadow !== false;
      mesh.computeBoundingSphere();
      if (farGeometry) {
        const far = new THREE.InstancedMesh(farGeometry, material, matrices.length);
        far.instanceMatrix = mesh.instanceMatrix; far.instanceColor = mesh.instanceColor;
        far.receiveShadow = true; far.castShadow = false; far.computeBoundingSphere();
        const center = mesh.boundingSphere!.center.clone();
        const levels = new THREE.LOD(); levels.position.copy(center);
        mesh.position.copy(center).negate(); far.position.copy(center).negate();
        levels.addLevel(mesh, 0); levels.addLevel(far, 100, 0.15); this.group.add(levels);
      } else this.group.add(mesh);
    }
    const collisionSurfaces: { vertices: Float32Array; indices: Uint32Array }[] = [];
    for (const { material, geometries } of this.surfaces.values()) {
      if (budget.exhausted) await budget.yield();
      const geometry = mergeGeometries(geometries)!;
      geometries.forEach(item => item.dispose());
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.group.add(mesh);
      if (material.userData.roadSurface) collisionSurfaces.push({ vertices: geometry.attributes.position.array as Float32Array, indices: new Uint32Array(geometry.index!.array) });
    }
    return collisionSurfaces;
  }
}
