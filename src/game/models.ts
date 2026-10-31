import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleConfig } from '../types';

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

function addCar(group: THREE.Group, config: VehicleConfig, police: boolean) {
  const bodyPaint = police ? white : paint(config.color);
  const w = config.width;
  const l = config.length;
  loft(group, bodyPaint, [
    [-l * 0.49, w * 0.80, w * 0.80, -0.16, 0.22],
    [-l * 0.38, w, w * 0.94, -0.18, 0.34],
    [l * 0.31, w, w * 0.92, -0.18, 0.25],
    [l * 0.49, w * 0.82, w * 0.80, -0.12, 0.12],
  ]);
  loft(group, glass, [
    [-l * 0.35, w * 0.86, w * 0.80, 0.26, 0.32],
    [-l * 0.18, w * 0.90, w * 0.72, 0.27, 0.86],
    [l * 0.10, w * 0.88, w * 0.70, 0.26, 0.83],
    [l * 0.31, w * 0.82, w * 0.78, 0.24, 0.28],
  ]);
  box(group, police ? dark : bodyPaint, [w * 0.71, 0.055, l * 0.29], [0, 0.86, -l * 0.04]);
  box(group, dark, [w * 0.88, 0.12, l * 0.92], [0, -0.18, 0]);
  box(group, dark, [w * 0.70, 0.10, 0.06], [0, -0.055, l * 0.49]);
  for (const side of [-1, 1]) {
    box(group, bodyPaint, [0.20, 0.12, 0.27], [side * w * 0.53, 0.42, l * 0.16]);
    box(group, dark, [0.03, 0.51, 0.06], [side * w * 0.409, 0.51, -l * 0.04]);
    box(group, headlight, [w * 0.25, 0.065, 0.045], [side * w * 0.28, 0.13, l * 0.493]);
    box(group, metal, [0.025, 0.035, 0.17], [side * w * 0.488, 0.22, -l * 0.11]);
  }
  const brakeMaterial = new THREE.MeshStandardMaterial({ color: '#9c2420', emissive: '#ff2415', emissiveIntensity: 0.7 });
  const brakeLights = [-1, 1].map((side) => box(group, brakeMaterial, [w * 0.27, 0.075, 0.045], [side * w * 0.28, 0.18, -l * 0.493]));
  const policeLights: THREE.Mesh[] = [];
  if (police) {
    box(group, dark, [w * 1.005, 0.14, l * 0.51], [0, 0.12, -l * 0.02]);
    box(group, dark, [w * 0.67, 0.08, 0.28], [0, 0.94, 0]);
    for (const side of [-1, 1]) {
      const color = side < 0 ? '#ef3e37' : '#3988ff';
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.5 });
      policeLights.push(box(group, material, [w * 0.27, 0.12, 0.24], [side * w * 0.19, 1.03, 0]));
      const label = new THREE.Mesh(new THREE.PlaneGeometry(l * 0.26, 0.35), policeTextMaterial());
      label.position.set(side * w * 0.504, 0.10, -l * 0.01);
      label.rotation.y = side * Math.PI / 2;
      group.add(label);
    }
  }
  const wheels = [
    [-w * 0.43, -0.25, l * 0.32],
    [w * 0.43, -0.25, l * 0.32],
    [-w * 0.43, -0.25, -l * 0.32],
    [w * 0.43, -0.25, -l * 0.32],
  ].map((position) => {
    const item = wheel(0.36, 0.23);
    item.position.set(position[0], position[1], position[2]);
    group.add(item);
    return item;
  });
  return { wheels, brakeLights, policeLights };
}

function addMotorcycle(group: THREE.Group, config: VehicleConfig) {
  const bodyPaint = paint(config.color);
  const l = config.length;
  box(group, dark, [0.34, 0.30, l * 0.55], [0, -0.02, -0.06]);
  sphere(group, bodyPaint, [0.28, 0.25, 0.43], [0, 0.31, 0.10]);
  box(group, dark, [0.39, 0.10, 0.55], [0, 0.34, -0.42]);
  box(group, metal, [0.38, 0.30, 0.34], [0, -0.08, 0.04]);
  box(group, dark, [0.44, 0.14, 0.22], [0, -0.23, 0.09]);
  for (const side of [-1, 1]) {
    pipe(group, metal, [side * 0.13, -0.22, l * 0.34], [side * 0.13, 0.45, l * 0.24], 0.035);
    pipe(group, dark, [side * 0.11, -0.23, -l * 0.34], [side * 0.13, 0.05, -0.12], 0.04);
    box(group, bodyPaint, [0.17, 0.34, 0.44], [side * 0.30, 0.10, -0.67]);
    pipe(group, metal, [side * 0.26, 0.13, -0.48], [side * 0.18, 0.42, -0.07], 0.035);
  }
  const windshield = box(group, glass, [0.38, 0.42, 0.035], [0, 0.66, l * 0.25]);
  windshield.rotation.x = -0.18;
  box(group, bodyPaint, [0.38, 0.14, 0.31], [0, 0.34, l * 0.29]);
  box(group, headlight, [0.26, 0.12, 0.04], [0, 0.43, l * 0.33]);
  pipe(group, dark, [-0.39, 0.51, 0.31], [0.39, 0.51, 0.31], 0.035);
  const brakeMaterial = new THREE.MeshStandardMaterial({ color: '#a21c18', emissive: '#ff2415', emissiveIntensity: 0.7 });
  const brakeLights = [box(group, brakeMaterial, [0.22, 0.065, 0.04], [0, 0.30, -l * 0.42])];
  const rider = paint('#2b3836');
  const helmet = paint('#dce5d1');
  const torso = box(group, rider, [0.40, 0.48, 0.27], [0, 0.76, -0.19]);
  torso.rotation.x = 0.18;
  sphere(group, helmet, [0.21, 0.23, 0.22], [0, 1.13, -0.11]);
  sphere(group, glass, [0.18, 0.09, 0.07], [0, 1.14, 0.075]);
  for (const side of [-1, 1]) {
    pipe(group, rider, [side * 0.17, 0.91, -0.17], [side * 0.25, 0.69, 0.08], 0.075);
    pipe(group, rider, [side * 0.25, 0.69, 0.08], [side * 0.33, 0.51, 0.31], 0.055);
    pipe(group, rider, [side * 0.14, 0.48, -0.39], [side * 0.25, 0.20, -0.14], 0.09);
    pipe(group, rider, [side * 0.25, 0.20, -0.14], [side * 0.25, -0.12, -0.37], 0.065);
    box(group, dark, [0.15, 0.10, 0.25], [side * 0.25, -0.17, -0.32]);
  }
  const wheels = [l * 0.34, -l * 0.34].map((z) => {
    const item = wheel(0.34, 0.15);
    item.position.set(0, -0.25, z);
    group.add(item);
    return item;
  });
  return { wheels, brakeLights, policeLights: [] as THREE.Mesh[] };
}

export function createVehicleModel(config: VehicleConfig, police = false) {
  const group = new THREE.Group();
  const details = config.kind === 'motorcycle' && !police ? addMotorcycle(group, config) : addCar(group, config, police);
  mergeStatic(group, [...details.brakeLights, ...details.policeLights]);
  return { group, ...details, dispose: createDisposer(group) };
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
