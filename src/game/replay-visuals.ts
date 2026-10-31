import * as THREE from 'three';
import { cloneReplayMaterial } from './damage-materials';

export type ReplayProperty = 'position' | 'rotation' | 'visible' | 'emissive' | 'wheel' | 'target';
export interface ReplayChannel {
  node: THREE.Object3D;
  property: ReplayProperty;
  axis?: 'x' | 'y' | 'z';
  read?: () => number;
  wheel?: { axis: THREE.Vector3; base: THREE.Quaternion; radius: number; direction: number };
}

export interface ReplaySource {
  key: string;
  root: THREE.Object3D;
  channels: ReplayChannel[];
  speed: () => number;
  opacity: () => number;
  revision: () => number;
  priority: number;
}

interface RecordedChannel extends Omit<ReplayChannel, 'node' | 'read'> { index: number }
const PAGE_COMPONENTS = 192;
interface GeometryState {
  base: THREE.BufferGeometry;
  pages: Map<string, Float32Array[]>;
  versions: number[];
}

export interface ReplayAppearance {
  template: THREE.Object3D;
  geometry: { index: number; state: GeometryState }[];
  channels: RecordedChannel[];
}

const nodesOf = (root: THREE.Object3D) => {
  const nodes: THREE.Object3D[] = [];
  root.traverse(node => nodes.push(node));
  return nodes;
};

export function readReplayChannel(channel: ReplayChannel) {
  if (channel.read) return channel.read();
  if (channel.property === 'visible') return Number(channel.node.visible);
  if (channel.property === 'emissive') return ((channel.node as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity;
  if (channel.property === 'target') return (channel.node as THREE.SpotLight).target.position[channel.axis!];
  return channel.node[channel.property as 'position' | 'rotation'][channel.axis!];
}

export class ReplayVisualCache {
  private geometry = new WeakMap<THREE.BufferGeometry, GeometryState>();
  private appearances = new WeakMap<THREE.Object3D, { key: string; revision: number; appearance: ReplayAppearance }>();

  capture(source: ReplaySource) {
    const previous = this.appearances.get(source.root);
    const revision = source.revision();
    if (previous?.key === source.key && previous.revision === revision) return previous.appearance;
    const original = nodesOf(source.root), template = source.root.clone(true), nodes = nodesOf(template);
    const geometry: ReplayAppearance['geometry'] = [];
    const materials = new Map<THREE.Material, THREE.Material>();
    const material = (entry: THREE.Material) => {
      if (!materials.has(entry)) {
        const copy = cloneReplayMaterial(entry);
        copy.opacity = Math.min(1, entry.opacity / Math.max(0.001, source.opacity()));
        copy.transparent = copy.opacity < 0.99 || source.opacity() >= 0.99 && entry.transparent;
        if (source.opacity() < 0.95) copy.depthWrite = copy.opacity >= 0.95;
        materials.set(entry, copy);
      }
      return materials.get(entry)!;
    };
    original.forEach((node, index) => {
      if (!(node instanceof THREE.Mesh)) return;
      const copy = nodes[index] as THREE.Mesh;
      const state = this.captureGeometry(node.geometry);
      copy.geometry = state.base;
      copy.material = Array.isArray(node.material) ? node.material.map(material) : material(node.material);
      geometry.push({ index, state });
    });
    const appearance: ReplayAppearance = {
      template, geometry,
      channels: source.channels.map(({ node, read, ...channel }) => ({ ...channel, index: original.indexOf(node) })),
    };
    this.appearances.set(source.root, { key: source.key, revision, appearance });
    return appearance;
  }

  reset() {
    this.geometry = new WeakMap();
    this.appearances = new WeakMap();
  }

  private captureGeometry(source: THREE.BufferGeometry) {
    const attributes = ['position', 'normal'].map(name => source.getAttribute(name));
    const versions = attributes.map(attribute => attribute ? attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.version : attribute.version : -1);
    const previous = this.geometry.get(source);
    if (previous && versions.every((version, index) => version === previous.versions[index])) return previous;
    const base = previous?.base ?? source.clone();
    const pages = new Map<string, Float32Array[]>();
    ['position', 'normal'].forEach((name, index) => {
      const attribute = attributes[index];
      if (!attribute) return;
      const old = previous?.pages.get(name);
      if (old && versions[index] === previous!.versions[index]) { pages.set(name, old); return }
      const values = (base.getAttribute(name) as THREE.BufferAttribute).array as Float32Array;
      const parts: Float32Array[] = [];
      for (let offset = 0; offset < values.length; offset += PAGE_COMPONENTS) {
        const length = Math.min(PAGE_COMPONENTS, values.length - offset);
        const prior = old?.[parts.length] ?? values.subarray(offset, offset + length);
        let changed = false;
        for (let component = 0; component < length; component++) {
          const cursor = offset + component;
          if (prior[component] !== attribute.getComponent(Math.floor(cursor / attribute.itemSize), cursor % attribute.itemSize)) { changed = true; break }
        }
        if (!changed) { parts.push(prior); continue }
        const page = new Float32Array(length);
        for (let component = 0; component < length; component++) {
          const cursor = offset + component;
          page[component] = attribute.getComponent(Math.floor(cursor / attribute.itemSize), cursor % attribute.itemSize);
        }
        parts.push(page);
      }
      pages.set(name, parts);
    });
    const state = { base, pages, versions };
    this.geometry.set(source, state);
    return state;
  }
}

interface ReplayInstance {
  appearance: ReplayAppearance;
  root: THREE.Object3D;
  nodes: THREE.Object3D[];
  geometry: Set<GeometryState>;
  materials: Set<THREE.Material>;
  targets: THREE.Object3D[];
}

export class ReplayVisuals {
  private instances = new Map<number, ReplayInstance>();
  private geometry = new Map<GeometryState, { geometry: THREE.BufferGeometry; users: number }>();
  private rotationA = new THREE.Quaternion();
  private rotationB = new THREE.Quaternion();
  private wheelRotation = new THREE.Quaternion();
  private headlamps = Array.from({ length: 4 }, () => new THREE.SpotLight('#fff2dc', 0, 65, 0.36, 0.65, 2));

  constructor(private scene: THREE.Scene) {
    for (const light of this.headlamps) scene.add(light, light.target);
  }

  beginFrame() { for (const instance of this.instances.values()) instance.root.visible = false }

  show(id: number, appearance: ReplayAppearance, from: Float32Array, offset: number, to: Float32Array, nextOffset: number, alpha: number) {
    let instance = this.instances.get(id);
    if (instance?.appearance !== appearance) {
      const next = this.create(appearance);
      if (instance) this.remove(id);
      this.instances.set(id, next);
      instance = next;
    }
    const root = instance.root;
    root.position.set(
      THREE.MathUtils.lerp(from[offset], to[nextOffset], alpha),
      THREE.MathUtils.lerp(from[offset + 1], to[nextOffset + 1], alpha),
      THREE.MathUtils.lerp(from[offset + 2], to[nextOffset + 2], alpha),
    );
    this.rotationA.fromArray(from, offset + 3); this.rotationB.fromArray(to, nextOffset + 3);
    root.quaternion.slerpQuaternions(this.rotationA, this.rotationB, alpha);
    const opacity = THREE.MathUtils.lerp(from[offset + 8], to[nextOffset + 8], alpha);
    root.userData.headlightOpacity = opacity;
    root.scale.set(
      THREE.MathUtils.lerp(from[offset + 9], to[nextOffset + 9], alpha),
      THREE.MathUtils.lerp(from[offset + 10], to[nextOffset + 10], alpha),
      THREE.MathUtils.lerp(from[offset + 11], to[nextOffset + 11], alpha),
    );
    root.visible = from[offset + 12] > 0 && opacity > 0.005;
    for (const material of instance.materials) {
      material.opacity = material.userData.replayOpacity * opacity;
      material.depthWrite = material.userData.replayDepthWrite && opacity >= 0.95;
      const transparent = material.userData.replayTransparent || opacity < 0.99;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true }
    }
    appearance.channels.forEach((channel, index) => {
      const a = from[offset + 13 + index], b = to[nextOffset + 13 + index];
      const value = channel.property === 'visible' || channel.property === 'emissive' ? a : THREE.MathUtils.lerp(a, b, alpha);
      const node = instance!.nodes[channel.index];
      if (channel.property === 'visible') node.visible = value > 0;
      else if (channel.property === 'emissive') ((node as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = value;
      else if (channel.property === 'target') (node as THREE.SpotLight).target.position[channel.axis!] = value;
      else if (channel.property === 'wheel') {
        const wheel = channel.wheel!;
        this.wheelRotation.setFromAxisAngle(wheel.axis, value / wheel.radius * wheel.direction);
        node.quaternion.copy(wheel.base).multiply(this.wheelRotation);
      } else node[channel.property][channel.axis!] = value;
    });
    return root;
  }

  endFrame(focus: THREE.Vector3) {
    const lamps: { mount: THREE.Object3D; distance: number }[] = [];
    for (const [id, instance] of this.instances) {
      if (!instance.root.visible) { this.remove(id); continue }
      const mount = instance.root.getObjectByName('车辆前灯挂点');
      if (mount) lamps.push({ mount, distance: instance.root.position.distanceToSquared(focus) });
    }
    lamps.sort((a, b) => a.distance - b.distance);
    this.headlamps.forEach((light, index) => {
      const mount = lamps[index]?.mount;
      light.intensity = mount ? 700 : 0;
      if (!mount) return;
      mount.updateWorldMatrix(true, false);
      light.position.setFromMatrixPosition(mount.matrixWorld);
      light.target.position.set(0, -0.8, 30).applyMatrix4(mount.matrixWorld);
    });
  }

  dispose() {
    for (const id of this.instances.keys()) this.remove(id);
    for (const light of this.headlamps) { light.removeFromParent(); light.target.removeFromParent(); light.dispose() }
  }

  private create(appearance: ReplayAppearance): ReplayInstance {
    const root = appearance.template.clone(true), nodes = nodesOf(root);
    const geometry = new Set<GeometryState>(), materials = new Set<THREE.Material>(), copies = new Map<THREE.Material, THREE.Material>();
    const material = (source: THREE.Material) => {
      if (!copies.has(source)) {
        const copy = cloneReplayMaterial(source);
        copy.userData.replayOpacity = source.opacity;
        copy.userData.replayTransparent = source.transparent;
        copy.userData.replayDepthWrite = source.depthWrite;
        copies.set(source, copy); materials.add(copy);
      }
      return copies.get(source)!;
    };
    for (const entry of appearance.geometry) {
      let pooled = this.geometry.get(entry.state);
      if (!pooled) {
        const meshGeometry = entry.state.base.clone();
        for (const [name, pages] of entry.state.pages) {
          const attribute = meshGeometry.getAttribute(name) as THREE.BufferAttribute;
          pages.forEach((page, index) => (attribute.array as Float32Array).set(page, index * PAGE_COMPONENTS));
        }
        pooled = { geometry: meshGeometry, users: 0 }; this.geometry.set(entry.state, pooled);
      }
      if (!geometry.has(entry.state)) { pooled.users++; geometry.add(entry.state) }
      const mesh = nodes[entry.index] as THREE.Mesh;
      mesh.geometry = pooled.geometry;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(material) : material(mesh.material);
    }
    const targets = nodes.filter((node): node is THREE.SpotLight => node instanceof THREE.SpotLight).map(light => light.target);
    this.scene.add(root, ...targets);
    return { root, nodes, appearance, geometry, materials, targets };
  }

  private remove(id: number) {
    const instance = this.instances.get(id)!;
    instance.root.removeFromParent();
    instance.targets.forEach(target => target.removeFromParent());
    instance.materials.forEach(material => material.dispose());
    for (const state of instance.geometry) {
      const pooled = this.geometry.get(state)!;
      if (--pooled.users === 0) { pooled.geometry.dispose(); this.geometry.delete(state) }
    }
    this.instances.delete(id);
  }
}
