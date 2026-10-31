import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleConfig } from '../types';
import { cloneGeneratedVehicle } from './generated-assets';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 14);
const wheelCylinder = unitCylinder.clone().rotateZ(Math.PI / 2);
const unitSphere = new THREE.SphereGeometry(1, 12, 8);
const sharedGeometries = new Set<THREE.BufferGeometry>([unitBox, unitCylinder, wheelCylinder, unitSphere]);
const dark = new THREE.MeshStandardMaterial({ color: '#192221', roughness: 0.75 });
const tire = new THREE.MeshStandardMaterial({ color: '#101514', roughness: 0.98 });
const glass = new THREE.MeshStandardMaterial({ color: '#263b41', roughness: 0.22, metalness: 0.42 });
const metal = new THREE.MeshStandardMaterial({ color: '#a1aaa7', roughness: 0.3, metalness: 0.75 });
const white = new THREE.MeshStandardMaterial({ color: '#ecefe7', roughness: 0.37, metalness: 0.18 });
const headlight = new THREE.MeshStandardMaterial({ color: '#fff5d5', emissive: '#fff0c0', emissiveIntensity: 1.7 });
const paints = new Map<string, THREE.MeshStandardMaterial>();
let policeLabel: THREE.MeshBasicMaterial | undefined;

function paint(color: string) {
  if (!paints.has(color)) paints.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.22 }));
  return paints.get(color)!;
}

function box(group: THREE.Group, material: THREE.Material, size: number[], position: number[]) {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function sphere(group: THREE.Group, material: THREE.Material, size: number[], position: number[]) {
  const mesh = new THREE.Mesh(unitSphere, material);
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function pipe(group: THREE.Group, material: THREE.Material, from: number[], to: number[], radius: number) {
  const start = new THREE.Vector3(from[0], from[1], from[2]);
  const end = new THREE.Vector3(to[0], to[1], to[2]);
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(unitCylinder, material);
  mesh.position.copy(start.add(end).multiplyScalar(0.5));
  mesh.scale.set(radius, direction.length(), radius);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function loft(group: THREE.Group, material: THREE.Material, rings: number[][]) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [z, lowerWidth, upperWidth, bottom, top] of rings) {
    positions.push(-lowerWidth / 2, bottom, z, lowerWidth / 2, bottom, z, upperWidth / 2, top, z, -upperWidth / 2, top, z);
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let side = 0; side < 4; side++) {
      const a = ring * 4 + side;
      const b = ring * 4 + (side + 1) % 4;
      const c = b + 4;
      const d = a + 4;
      indices.push(a, b, d, b, c, d);
    }
  }
  const last = (rings.length - 1) * 4;
  indices.push(0, 2, 1, 0, 3, 2, last, last + 1, last + 2, last, last + 2, last + 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function wheel(radius: number, width: number) {
  const group = new THREE.Group();
  const rubber = new THREE.Mesh(wheelCylinder, tire);
  rubber.scale.set(width, radius, radius);
  rubber.castShadow = true;
  group.add(rubber);
  const hub = new THREE.Mesh(wheelCylinder, metal);
  hub.scale.set(width * 1.05, radius * 0.57, radius * 0.57);
  group.add(hub);
  return group;
}

function mergeStatic(group: THREE.Group, excluded: THREE.Mesh[]) {
  const materials = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of [...group.children]) {
    if (!(child instanceof THREE.Mesh) || excluded.includes(child) || Array.isArray(child.material)) continue;
    if ('map' in child.material && child.material.map) continue;
    const meshes = materials.get(child.material) ?? [];
    meshes.push(child);
    materials.set(child.material, meshes);
  }
  for (const [material, meshes] of materials) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      return mesh.geometry.clone().applyMatrix4(mesh.matrix);
    });
    const geometry = mergeGeometries(geometries);
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      group.add(mesh);
      meshes.forEach((child) => group.remove(child));
      const consumed = new Set(meshes.map((child) => child.geometry));
      consumed.forEach((entry) => {
        if (!sharedGeometries.has(entry)) entry.dispose();
      });
    }
    geometries.forEach((entry) => entry.dispose());
  }
}

function createDisposer(group: THREE.Group) {
  const sharedMaterials = new Set<THREE.Material>([dark, tire, glass, metal, white, headlight, ...paints.values()]);
  if (policeLabel) sharedMaterials.add(policeLabel);
  const sharedTextures = new Set<THREE.Texture>();
  for (const material of sharedMaterials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) sharedTextures.add(value);
    }
  }
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!sharedGeometries.has(object.geometry)) geometries.add(object.geometry);
    const entries = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of entries) {
      if (sharedMaterials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !sharedTextures.has(value)) textures.add(value);
      }
    }
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
  };
}

function policeTextMaterial() {
  if (policeLabel) return policeLabel;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#f2f3ec';
  context.fillRect(0, 0, 256, 128);
  context.fillStyle = '#182429';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = 'bold 82px "PingFang SC", sans-serif';
  context.fillText('警察', 128, 65);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  policeLabel = new THREE.MeshBasicMaterial({ map: texture });
  return policeLabel;
}

const vehiclePaints = new Map<string, THREE.MeshStandardMaterial>();

function addCar(group: THREE.Group, config: VehicleConfig, police: boolean) {
  const asset = cloneGeneratedVehicle('electric-suv');
  group.add(asset);
  const body = asset.getObjectByName('body') as THREE.Mesh;
  const tint = police ? '#ffffff' : config.color;
  if (!vehiclePaints.has(tint)) {
    const material = (body.material as THREE.MeshStandardMaterial).clone();
    material.color.set(tint); vehiclePaints.set(tint, material);
  }
  body.material = vehiclePaints.get(tint)!;
  const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(name => asset.getObjectByName(name) as THREE.Group);
  const owned = new THREE.Group(); group.add(owned);
  const brakeMaterial = new THREE.MeshStandardMaterial({ color: '#8b1812', emissive: '#ff2415', emissiveIntensity: 0.4 });
  const brakeLights = [-1, 1].map(side => box(owned, brakeMaterial, [0.16, 0.025, 0.018], [side * 0.78, 0.32, -2.26]));
  const turnSignals = [-1, 1].flatMap(side => {
    const material = new THREE.MeshStandardMaterial({ color: '#b47722', emissive: '#ff9e19', emissiveIntensity: 0 });
    return [-1, 1].map(end => box(owned, material, [0.10, 0.025, 0.018], [side * 0.75, end > 0 ? 0.06 : 0.31, end * 2.29]));
  });
  const policeLights: THREE.Mesh[] = [];
  if (police) {
    box(owned, dark, [1.25, 0.08, 0.28], [0, 0.94, -0.05]);
    for (const side of [-1, 1]) {
      const color = side < 0 ? '#ef3e37' : '#3988ff';
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.5 });
      policeLights.push(box(owned, material, [0.52, 0.12, 0.24], [side * 0.32, 1.04, -0.05]));
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.32), policeTextMaterial());
      label.position.set(side * 1.005, 0.08, -0.15); label.rotation.y = side * Math.PI / 2; owned.add(label);
    }
  }
  return { wheels, brakeLights, policeLights, turnSignals, dispose: createDisposer(owned) };
}

function addMotorcycle(group: THREE.Group, _config: VehicleConfig) {
  const asset = cloneGeneratedVehicle('adventure-motorcycle'); group.add(asset);
  const wheels = ['wheel_front', 'wheel_rear'].map(name => asset.getObjectByName(name) as THREE.Group);
  const owned = new THREE.Group(); group.add(owned);
  const material = new THREE.MeshStandardMaterial({ color: '#8d1713', emissive: '#ff2415', emissiveIntensity: 0.4 });
  const brakeLights = [box(owned, material, [0.12, 0.035, 0.025], [0, 0.28, -0.93])];
  return { wheels, brakeLights, policeLights: [] as THREE.Mesh[], turnSignals: [] as THREE.Mesh[], dispose: createDisposer(owned) };
}

export function createVehicleModel(config: VehicleConfig, police = false) {
  const group = new THREE.Group();
  group.userData.damageModel = config.kind === 'motorcycle' && !police ? 'motorcycle' : 'car';
  const details: { wheels: THREE.Group[]; brakeLights: THREE.Mesh[]; policeLights: THREE.Mesh[]; turnSignals: THREE.Mesh[]; dispose?: () => void } = config.kind === 'motorcycle' && !police ? addMotorcycle(group, config) : addCar(group, config, police);
  mergeStatic(group, [...details.brakeLights, ...details.policeLights, ...details.turnSignals]);
  return { group, ...details, wheelRadius: config.kind === 'motorcycle' && !police ? 0.36 : 0.378, dispose: details.dispose ?? createDisposer(group) };
}

export function createHelicopter() {
  const group = new THREE.Group();
  sphere(group, white, [1.10, 0.85, 2.05], [0, 0, 0]);
  sphere(group, glass, [0.97, 0.66, 1.12], [0, 0.07, 1.14]);
  pipe(group, dark, [0, 0.10, -1.45], [0, 0.60, -5.15], 0.22);
  box(group, white, [0.12, 1.38, 0.94], [0, 0.98, -4.77]);
  box(group, dark, [2.0, 0.10, 0.54], [0, 0.60, -4.45]);
  pipe(group, metal, [0, 0.65, 0], [0, 1.42, 0], 0.10);
  for (const side of [-1, 1]) {
    pipe(group, dark, [side * 1.12, -0.98, -1.6], [side * 1.12, -0.98, 1.9], 0.07);
    pipe(group, metal, [side * 0.62, -0.5, -0.82], [side * 1.12, -0.98, -0.82], 0.055);
    pipe(group, metal, [side * 0.62, -0.5, 0.93], [side * 1.12, -0.98, 0.93], 0.055);
  }
  const tailRotor = box(group, dark, [0.07, 1.8, 0.12], [0.25, 0.75, -5.12]);
  tailRotor.rotation.x = Math.PI / 4;
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.43, 0);
  box(rotor, dark, [10.2, 0.045, 0.22], [0, 0, 0]);
  box(rotor, dark, [0.22, 0.045, 10.2], [0, 0.012, 0]);
  group.add(rotor);
  sphere(group, metal, [0.21, 0.17, 0.21], [0, -0.70, 0.87]);
  const spotlight = new THREE.SpotLight('#fff6c3', 600, 120, Math.PI / 7, 0.65, 1.5);
  spotlight.position.set(0, -0.77, 0.92);
  spotlight.castShadow = false;
  spotlight.target.position.set(0, -24, 6);
  group.add(spotlight, spotlight.target);
  mergeStatic(group, []);
  return { group, rotor, spotlight, dispose: createDisposer(group) };
}
