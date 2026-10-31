import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VEHICLES } from '../config';
import { createVehicleModel } from './models';
import type { TrafficVehicleSpec } from './traffic-vehicles';

const vehicles = new Map<string, THREE.Group>();
const lightGeometry = new THREE.BoxGeometry(1, 1, 1);

interface VehicleModel {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  brakeLights: THREE.Mesh[];
  turnSignals: THREE.Mesh[];
  policeLights: THREE.Mesh[];
  wheelRadius: number;
  dispose: () => void;
}

function withAppearance(model: VehicleModel) {
  const materials = new Map<THREE.Material, THREE.Material>();
  const opacity = new Map<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();
  model.group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const clone = (source: THREE.Material) => {
      if (!materials.has(source)) {
        const material = source.clone();
        materials.set(source, material);
        opacity.set(material, { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
      }
      return materials.get(source)!;
    };
    object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
  });
  return { ...model, setOpacity: (alpha: number) => {
    for (const [material, original] of opacity) {
      const transparent = original.transparent || alpha < 1;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true }
      material.opacity = original.opacity * alpha;
      material.depthWrite = alpha >= 0.95 && original.depthWrite;
    }
  }, dispose: () => { model.dispose(); materials.forEach(material => material.dispose()) } };
}

export async function loadTrafficModels() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(['delivery-van', 'box-truck', 'city-bus'].map(async name => {
    const model = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/generated/traffic/${name}.glb`);
    model.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true; object.receiveShadow = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.anisotropy = 4;
      }
    });
    vehicles.set(name, model.scene);
  }));
}

export function createTrafficVehicleModel(profile: TrafficVehicleSpec, color: string) {
  if (profile.id === 'suv' || profile.id === 'motorcycle') {
    const base = VEHICLES.find(vehicle => vehicle.kind === profile.kind)!;
    return withAppearance(createVehicleModel({ ...base, color, name: profile.label, width: profile.width, length: profile.length, mass: profile.mass }));
  }
  const group = new THREE.Group();
  group.name = profile.label;
  const asset = vehicles.get(profile.asset)!.clone(true);
  asset.position.y = -0.79;
  group.add(asset);
  const wheels: THREE.Object3D[] = [];
  asset.traverse(object => {
    if (object.name.startsWith('wheel_') && !object.name.endsWith('_mesh')) wheels.push(object);
  });
  const brakeMaterial = new THREE.MeshStandardMaterial({ color: '#861c17', emissive: '#ff2415', emissiveIntensity: 0.7 });
  const signalMaterials = [-1, 1].map(() => new THREE.MeshStandardMaterial({ color: '#a96b13', emissive: '#ff9e19', emissiveIntensity: 0 }));
  const lamp = (material: THREE.Material, x: number, y: number, z: number, width: number) => {
    const mesh = new THREE.Mesh(lightGeometry, material);
    mesh.position.set(x, y - 0.79, z);
    mesh.scale.set(width, 0.09, 0.035);
    group.add(mesh);
    return mesh;
  };
  const brakeLights = [-1, 1].map(side => lamp(brakeMaterial, side * profile.width * 0.38, 0.75, -profile.length * 0.502, 0.21));
  const turnSignals = [-1, 1].flatMap((side, index) => [-1, 1].map(end => lamp(signalMaterials[index], side * profile.width * 0.42, 0.9, end * profile.length * 0.502, 0.1)));
  return withAppearance({ group, wheels, brakeLights, turnSignals, policeLights: [] as THREE.Mesh[], wheelRadius: profile.wheelRadius, dispose: () => { brakeMaterial.dispose(); signalMaterials.forEach(material => material.dispose()) } });
}
