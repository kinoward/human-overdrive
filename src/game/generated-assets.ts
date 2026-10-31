import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { assetUrl } from '../asset-url';
import { preparePlayerVehicle } from './player-vehicle-detail';

export type GeneratedAsset = 'electric-suv' | 'adventure-motorcycle' | 'residential-block' | 'roadside-tree' | 'brick-apartment' | 'office-block' | 'slender-tree' | 'lush-shrub' | 'bus-shelter';
interface AssetMesh { geometry: THREE.BufferGeometry; material: THREE.Material }
const models = new Map<GeneratedAsset, THREE.Group>();
const playerModels = new Map<GeneratedAsset, THREE.Group>();
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

export async function loadGeneratedAssets(onProgress?: (loaded: number, total: number) => Promise<void>) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const names = ['electric-suv', 'adventure-motorcycle', 'residential-block', 'roadside-tree', 'brick-apartment', 'office-block', 'slender-tree', 'lush-shrub', 'bus-shelter'] as const;
  let loaded = 0;
  await Promise.all(names.map(async name => {
    const asset = await loader.loadAsync(assetUrl(`assets/generated/${name}.glb`));
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
        if (name === 'slender-tree' && material instanceof THREE.MeshStandardMaterial) {
          material.onBeforeCompile = shader => {
            shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nfloat leafLight = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));\nfloat leafMask = step(0.18, leafLight) * step(diffuseColor.b * 2.0, diffuseColor.g) * step(diffuseColor.r * 0.68, diffuseColor.g);\ndiffuseColor.rgb = mix(diffuseColor.rgb, leafLight * vec3(0.42, 0.64, 0.28), leafMask * 0.92);');
          };
          material.customProgramCacheKey = () => '自然行道树叶色';
        }
      }
    });
    models.set(name, asset.scene);
    if (name === 'electric-suv' || name === 'adventure-motorcycle') playerModels.set(name, await preparePlayerVehicle(name, asset.scene));
    await onProgress?.(++loaded, names.length);
  }));
}

export function cloneGeneratedVehicle(name: 'electric-suv' | 'adventure-motorcycle', detailed = false) {
  return (detailed ? playerModels : models).get(name)!.clone(true);
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
