import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export type GeneratedAsset = 'electric-suv' | 'adventure-motorcycle' | 'residential-block' | 'roadside-tree';
interface AssetMesh { geometry: THREE.BufferGeometry; material: THREE.Material }
const models = new Map<GeneratedAsset, THREE.Group>();
const meshCache = new Map<string, AssetMesh[]>();

function floatGeometry(source: THREE.BufferGeometry) {
  const geometry = source.clone();
  for (const name of ['position', 'normal']) {
    const input = geometry.getAttribute(name);
    if (!input || input.array instanceof Float32Array) continue;
    const values = new Float32Array(input.count * 3);
    for (let i = 0; i < input.count; i++) { values[i * 3] = input.getX(i); values[i * 3 + 1] = input.getY(i); values[i * 3 + 2] = input.getZ(i) }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, 3));
  }
  return geometry;
}

export async function loadGeneratedAssets() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  await Promise.all((['electric-suv', 'adventure-motorcycle', 'residential-block', 'roadside-tree'] as const).map(async name => {
    const asset = await loader.loadAsync(`/assets/generated/${name}.glb`);
    asset.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true; object.receiveShadow = true;
      if (name === 'electric-suv' || name === 'adventure-motorcycle') {
        const geometry = floatGeometry(object.geometry);
        object.updateMatrix(); geometry.applyMatrix4(object.matrix);
        object.geometry = toCreasedNormals(geometry, Math.PI / 3);
        object.position.set(0, 0, 0); object.quaternion.identity(); object.scale.setScalar(1); object.updateMatrix();
      }
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.anisotropy = 4;
      }
    });
    models.set(name, asset.scene);
  }));
}

export function cloneGeneratedVehicle(name: 'electric-suv' | 'adventure-motorcycle') {
  return models.get(name)!.clone(true);
}

export function generatedMeshes(name: GeneratedAsset, level?: 'near' | 'far'): AssetMesh[] {
  const key = `${name}:${level ?? 'all'}`;
  if (meshCache.has(key)) return meshCache.get(key)!;
  const root = models.get(name)!;
  root.updateMatrixWorld(true);
  const meshes: AssetMesh[] = [];
  const source = level ? root.getObjectByName(`lod_${level}`)! : root;
  source.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = floatGeometry(object.geometry);
    geometry.applyMatrix4(object.matrixWorld);
    meshes.push({ geometry, material: object.material as THREE.Material });
  });
  meshCache.set(key, meshes); return meshes;
}
