import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleConfig } from '../types';
import { DamageDebris } from './damage-debris';
import { DamageMaterial } from './damage-materials';

interface DamagePart {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  kind: 'glass' | 'detachable' | 'protected';
  bounds: THREE.Box3;
  removed: boolean;
  broken: boolean;
  chipped: boolean;
  material?: DamageMaterial;
}

interface PendingImpact {
  point: THREE.Vector3;
  direction: THREE.Vector3;
  worldDirection: THREE.Vector3;
  severity: number;
  amount: number;
}

interface WeldNode {
  point: THREE.Vector3;
  vertices: number[];
  neighbors: Set<number>;
  distance: number;
}

function atlasTile(uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number) {
  return Math.floor(uv.getX(vertex) * 2048 / 340) + Math.floor(uv.getY(vertex) * 2048 / 340) * 6;
}

function subsetGeometry(source: THREE.BufferGeometry, vertices: number[]) {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'uv1']) {
    const attribute = source.getAttribute(name);
    if (!attribute) continue;
    const array = new Float32Array(vertices.length * attribute.itemSize);
    for (let index = 0; index < vertices.length; index++) {
      for (let component = 0; component < attribute.itemSize; component++) array[index * attribute.itemSize + component] = attribute.getComponent(vertices[index], component);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

interface DamageTopology {
  shell: number[];
  parts: { tile: number; kind: DamagePart['kind']; geometry: THREE.BufferGeometry }[];
  weights: Float32Array;
  grid: Map<string, number[]>;
  adjacency: number[][];
  rest: Float32Array;
  restNormals: Float32Array;
  bounds: THREE.Box3;
  sphere: THREE.Sphere;
  users: number;
}

const topologyCache = new WeakMap<THREE.BufferGeometry, DamageTopology>();

export function prepareDamageTopology(group: THREE.Group, kind: VehicleConfig['kind']) {
  damageTopology((group.getObjectByName('body') as THREE.Mesh).geometry, kind);
}

function cellKey(x: number, y: number, z: number) { return `${Math.floor(x / 0.35)}:${Math.floor(y / 0.35)}:${Math.floor(z / 0.35)}` }

function damageTopology(source: THREE.BufferGeometry, kind: VehicleConfig['kind']) {
  const cached = topologyCache.get(source);
  if (cached) return cached;
  const geometry = source;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv');
  const glass = new Set(kind === 'car' ? [6, 15, 17, 18] : []);
  const detachable = new Set(kind === 'car' ? [1, 4] : [5]);
  const protectedTiles = new Set(kind === 'motorcycle' ? [0, 3, 7, 9, 13, 17] : []);
  const partitions = new Map<number, number[]>();
  const shell: number[] = [];
  const index = geometry.getIndex();
  const count = index?.count ?? position.count;
  const grid = new Map<string, number[]>();
  const seams = new Map<string, number>();
  for (let vertex = 0; vertex < position.count; vertex++) {
    const key = `${Math.round(position.getX(vertex) * 10000)}:${Math.round(position.getY(vertex) * 10000)}:${Math.round(position.getZ(vertex) * 10000)}`;
    const tile = atlasTile(uv, vertex);
    const previous = seams.get(key);
    if (previous === undefined) seams.set(key, tile);
    else if (previous !== tile) seams.set(key, -1);
  }
  const nodes: WeldNode[] = [];
  const nodeKeys = new Map<string, number>();
  const edges = new Map<string, { a: number; b: number; count: number }>();
  const weights = new Float32Array(position.count);
  const adjacency: number[][] = Array.from({ length: position.count }, () => []);
  for (let offset = 0; offset < count; offset += 3) {
    const triangle = [0, 1, 2].map(corner => index ? index.getX(offset + corner) : offset + corner);
    const tile = atlasTile(uv, triangle[0]);
    if (glass.has(tile) || detachable.has(tile) || protectedTiles.has(tile)) {
      const part = protectedTiles.has(tile) ? -1 : tile;
      const vertices = partitions.get(part) ?? [];
      vertices.push(...triangle);
      partitions.set(part, vertices);
      continue;
    }
    const triangleOffset = shell.length;
    shell.push(...triangle);
    const welded = triangle.map(vertex => {
      adjacency[vertex].push(triangleOffset);
      const point = new THREE.Vector3().fromBufferAttribute(position, vertex);
      const key = `${tile}:${Math.round(point.x * 10000)}:${Math.round(point.y * 10000)}:${Math.round(point.z * 10000)}`;
      let id = nodeKeys.get(key);
      if (id === undefined) {
        id = nodes.length;
        const seam = `${Math.round(point.x * 10000)}:${Math.round(point.y * 10000)}:${Math.round(point.z * 10000)}`;
        nodes.push({ point, vertices: [], neighbors: new Set(), distance: seams.get(seam) === -1 ? 0 : Infinity });
        nodeKeys.set(key, id);
      }
      nodes[id].vertices.push(vertex);
      return id;
    });
    for (let corner = 0; corner < 3; corner++) {
      const a = welded[corner], b = welded[(corner + 1) % 3];
      if (a === b) continue;
      nodes[a].neighbors.add(b); nodes[b].neighbors.add(a);
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  }
  const queue = nodes.flatMap((node, index) => node.distance === 0 ? [index] : []);
  for (const edge of edges.values()) if (edge.count === 1) {
    for (const id of [edge.a, edge.b]) if (nodes[id].distance !== 0) { nodes[id].distance = 0; queue.push(id) }
  }
  const band = kind === 'car' ? 0.16 : 0.09;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const node = nodes[queue[cursor]];
    for (const id of node.neighbors) {
      const distance = node.distance + node.point.distanceTo(nodes[id].point);
      if (distance < band && distance < nodes[id].distance) { nodes[id].distance = distance; queue.push(id) }
    }
  }
  for (const node of nodes) {
    const distance = Math.min(1, node.distance / band);
    const weight = distance * distance * (3 - 2 * distance);
    for (const vertex of node.vertices) weights[vertex] = weight;
    if (weight === 0) continue;
    const key = cellKey(node.point.x, node.point.y, node.point.z);
    const vertices = grid.get(key) ?? [];
    vertices.push(...new Set(node.vertices));
    grid.set(key, vertices);
  }
  const parts = [...partitions].map(([tile, vertices]) => ({
    tile,
    kind: (tile === -1 ? 'protected' : glass.has(tile) ? 'glass' : 'detachable') as DamagePart['kind'],
    geometry: subsetGeometry(source, vertices),
  }));
  const bounds = new THREE.Box3().setFromBufferAttribute(position).expandByScalar(0.15);
  const topology: DamageTopology = {
    shell, parts, weights, grid, adjacency,
    rest: new Float32Array(position.array),
    restNormals: new Float32Array(source.getAttribute('normal').array),
    bounds,
    sphere: bounds.getBoundingSphere(new THREE.Sphere()),
    users: 0,
  };
  topologyCache.set(source, topology);
  return topology;
}

export class VehicleDamage {
  revision = 0;
  readonly summary = { dents: 0, brokenGlass: 0, detachedParts: 0 };
  readonly performance = { geometryPasses: 0, vertexVisits: 0, normalUpdates: 0 };
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private source: THREE.BufferGeometry;
  private sourceMaterial: THREE.Material;
  private geometry?: THREE.BufferGeometry;
  private topology?: DamageTopology;
  private material?: DamageMaterial;
  private rest?: Float32Array;
  private restNormals?: Float32Array;
  private weights?: Float32Array;
  private grid = new Map<string, number[]>();
  private adjacency: number[][] = [];
  private parts: DamagePart[] = [];
  private caps: THREE.Mesh[] = [];
  private pending = new Map<string, PendingImpact>();
  private zones = new Map<string, number>();
  private interval = 0;
  private debris: DamageDebris;
  private meshToGroup = new THREE.Matrix4();
  private groupToMesh = new THREE.Matrix4();
  private disposed = false;

  constructor(private group: THREE.Group, private config: VehicleConfig, private body: RAPIER.RigidBody, world: RAPIER.World) {
    this.mesh = group.getObjectByName('body') as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    this.source = this.mesh.geometry;
    this.sourceMaterial = this.mesh.material;
    this.debris = new DamageDebris(group, body, world);
  }

  impact(point: THREE.Vector3, direction: THREE.Vector3, severity: number) {
    if (this.disposed || severity < 0.12) return;
    this.refreshTransform();
    const inverse = new THREE.Quaternion().copy(this.body.rotation()).invert();
    const localPoint = point.clone().sub(this.body.translation()).applyQuaternion(inverse).applyMatrix4(this.groupToMesh);
    const localDirection = direction.clone().applyQuaternion(inverse).transformDirection(this.groupToMesh);
    const key = this.zoneKey(localPoint, localDirection);
    const previous = this.zones.get(key) ?? 0;
    const amount = Math.min(severity * 0.5, 1 - previous);
    if (amount < 0.025) return;
    const existing = this.pending.get(key);
    if (existing) {
      if (severity > existing.severity) Object.assign(existing, { point: localPoint, direction: localDirection, worldDirection: direction.clone(), severity, amount });
    } else if (this.pending.size < 6) this.pending.set(key, { point: localPoint, direction: localDirection, worldDirection: direction.clone(), severity, amount });
  }

  update(dt: number) {
    if (this.disposed || dt <= 0) return;
    this.debris.update(dt);
    this.interval -= dt;
    if (!this.pending.size || this.interval > 0) return;
    this.interval = 0.09;
    this.prepare();
    this.refreshTransform();
    const changed = new Set<number>();
    for (const [key, hit] of this.pending) {
      this.zones.set(key, Math.min(1, (this.zones.get(key) ?? 0) + hit.amount));
      this.material!.add(hit.point, hit.direction, hit.amount * 1.7, 0.35 + hit.severity * 0.65);
      if (this.dent(hit, changed)) this.summary.dents++;
      this.damageParts(hit);
    }
    this.pending.clear();
    if (changed.size) this.refreshNormals(changed);
    this.revision++;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.debris.dispose();
    for (const part of this.parts) {
      part.mesh.removeFromParent();
      part.material?.dispose();
    }
    for (const cap of this.caps) {
      cap.removeFromParent();
      cap.geometry.dispose();
      (cap.material as THREE.Material).dispose();
    }
    this.mesh.geometry = this.source;
    this.mesh.material = this.sourceMaterial;
    this.geometry?.dispose();
    this.material?.dispose();
    if (this.topology && --this.topology.users === 0) {
      for (const part of this.topology.parts) part.geometry.dispose();
    }
    this.topology = undefined;
    this.pending.clear();
    this.grid = new Map();
    this.adjacency = [];
    this.rest = undefined;
    this.restNormals = undefined;
    this.weights = undefined;
    this.zones.clear();
  }

  private refreshTransform() {
    this.mesh.updateWorldMatrix(true, false);
    this.meshToGroup.multiplyMatrices(this.group.matrixWorld.clone().invert(), this.mesh.matrixWorld);
    this.groupToMesh.copy(this.meshToGroup).invert();
  }

  private zoneKey(point: THREE.Vector3, direction: THREE.Vector3) {
    const axis = Math.abs(direction.y) > Math.max(Math.abs(direction.x), Math.abs(direction.z)) ? 'y' : Math.abs(direction.x) > Math.abs(direction.z) ? 'x' : 'z';
    const first = axis === 'z' ? point.x : point.z;
    const second = axis === 'y' ? point.x : point.y;
    return `${axis}:${Math.sign(direction[axis])}:${THREE.MathUtils.clamp(Math.floor(first / 0.75), -2, 2)}:${THREE.MathUtils.clamp(Math.floor(second / 0.5), -1, 1)}`;
  }

  private prepare() {
    if (this.geometry) return;
    const topology = damageTopology(this.source, this.config.kind);
    this.topology = topology;
    topology.users++;
    const geometry = this.source.clone();
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (const { tile, kind, geometry: partGeometry } of topology.parts) {
      const mesh = new THREE.Mesh(partGeometry, this.sourceMaterial);
      mesh.name = `damage_part_${tile}`;
      mesh.position.copy(this.mesh.position); mesh.quaternion.copy(this.mesh.quaternion); mesh.scale.copy(this.mesh.scale);
      mesh.castShadow = kind !== 'glass'; mesh.receiveShadow = true;
      this.mesh.parent!.add(mesh);
      this.parts.push({ mesh, kind, bounds: partGeometry.boundingBox!, removed: false, broken: false, chipped: false });
    }
    geometry.setIndex(topology.shell);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.boundingBox = topology.bounds.clone();
    geometry.boundingSphere = topology.sphere.clone();
    this.geometry = geometry;
    this.material = new DamageMaterial(this.sourceMaterial);
    this.mesh.geometry = geometry;
    this.mesh.material = this.material.material;
    this.weights = topology.weights;
    this.grid = topology.grid;
    this.adjacency = topology.adjacency;
    this.rest = topology.rest;
    this.restNormals = topology.restNormals;
  }

  private dent(hit: PendingImpact, changed: Set<number>) {
    const position = this.geometry!.getAttribute('position');
    const radius = this.config.kind === 'car' ? 0.4 + hit.severity * 0.65 : 0.25 + hit.severity * 0.4;
    const depth = hit.amount * (this.config.kind === 'car' ? 0.12 : 0.06);
    const maximum = this.config.kind === 'car' ? 0.12 : 0.055;
    const vertex = new THREE.Vector3(), original = new THREE.Vector3(), displacement = new THREE.Vector3();
    let modified = false;
    for (let x = Math.floor((hit.point.x - radius) / 0.35); x <= Math.floor((hit.point.x + radius) / 0.35); x++) {
      for (let y = Math.floor((hit.point.y - radius) / 0.35); y <= Math.floor((hit.point.y + radius) / 0.35); y++) {
        for (let z = Math.floor((hit.point.z - radius) / 0.35); z <= Math.floor((hit.point.z + radius) / 0.35); z++) {
          const vertices = this.grid.get(`${x}:${y}:${z}`);
          if (!vertices) continue;
          for (const index of vertices) {
            this.performance.vertexVisits++;
            original.fromArray(this.rest!, index * 3);
            const distance = original.distanceTo(hit.point);
            if (distance >= radius) continue;
            const falloff = 1 - distance / radius;
            const weight = this.weights![index];
            vertex.fromBufferAttribute(position, index).addScaledVector(hit.direction, depth * falloff * falloff * (3 - 2 * falloff) * weight);
            displacement.copy(vertex).sub(original).clampLength(0, maximum * weight);
            vertex.copy(original).add(displacement);
            if (Math.abs(vertex.x - position.getX(index)) + Math.abs(vertex.y - position.getY(index)) + Math.abs(vertex.z - position.getZ(index)) < 0.00001) continue;
            position.setXYZ(index, vertex.x, vertex.y, vertex.z);
            for (const offset of this.adjacency[index]) changed.add(offset);
            modified = true;
          }
        }
      }
    }
    if (modified) position.needsUpdate = true;
    return modified;
  }

  private refreshNormals(changed: Set<number>) {
    const position = this.geometry!.getAttribute('position');
    const normal = this.geometry!.getAttribute('normal');
    const index = this.geometry!.getIndex()!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const oldNormal = new THREE.Vector3(), newNormal = new THREE.Vector3(), value = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    for (const offset of changed) {
      const vertices = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
      a.fromArray(this.rest!, vertices[0] * 3); b.fromArray(this.rest!, vertices[1] * 3); c.fromArray(this.rest!, vertices[2] * 3);
      oldNormal.crossVectors(b.sub(a), c.sub(a)).normalize();
      a.fromBufferAttribute(position, vertices[0]); b.fromBufferAttribute(position, vertices[1]); c.fromBufferAttribute(position, vertices[2]);
      newNormal.crossVectors(b.sub(a), c.sub(a)).normalize();
      if (newNormal.lengthSq() < 0.5 || oldNormal.lengthSq() < 0.5) continue;
      rotation.setFromUnitVectors(oldNormal, newNormal);
      for (const vertex of vertices) {
        value.fromArray(this.restNormals!, vertex * 3).applyQuaternion(rotation);
        normal.setXYZ(vertex, value.x, value.y, value.z);
      }
    }
    normal.needsUpdate = true;
    this.performance.geometryPasses++;
    this.performance.normalUpdates += changed.size;
  }

  private damageParts(hit: PendingImpact) {
    if (hit.severity >= 0.3) {
      const candidates = this.parts.filter(part => part.kind === 'glass')
        .map(part => ({ part, distance: part.bounds.distanceToPoint(hit.point) }))
        .filter(entry => entry.distance < 0.35 + hit.severity * 1.2)
        .sort((a, b) => a.distance - b.distance);
      for (const { part } of candidates.slice(0, hit.severity > 0.82 ? 2 : 1)) this.crackGlass(part, hit);
    }
    if (hit.severity < 0.68 || this.summary.detachedParts >= 2 || !this.debris.available) return;
    const nearest = this.parts.filter(part => !part.removed && part.kind === 'detachable')
      .map(part => ({ part, distance: part.bounds.distanceToPoint(hit.point) }))
      .filter(entry => entry.distance < 0.2 + hit.severity * 0.55)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest) return;
    const part = nearest.part;
    const geometry = part.mesh.geometry.clone().applyMatrix4(this.meshToGroup);
    if (!this.debris.add(geometry, part.mesh.material, hit.worldDirection, hit.severity, false)) return;
    part.removed = true;
    part.mesh.visible = false;
    const center = part.bounds.getCenter(new THREE.Vector3());
    center.x *= 0.87;
    const capGeometry = new THREE.SphereGeometry(1, 8, 6).scale(0.05, 0.045, 0.05).translate(center.x, center.y, center.z);
    const cap = new THREE.Mesh(capGeometry, new THREE.MeshStandardMaterial({ color: '#161b1f', roughness: 0.92 }));
    cap.position.copy(this.mesh.position); cap.quaternion.copy(this.mesh.quaternion); cap.scale.copy(this.mesh.scale);
    this.mesh.parent!.add(cap); this.caps.push(cap);
    this.summary.detachedParts++;
  }

  private crackGlass(part: DamagePart, hit: PendingImpact) {
    const contact = part.bounds.clampPoint(hit.point, new THREE.Vector3());
    if (!part.material) {
      part.material = new DamageMaterial(this.sourceMaterial, true);
      part.mesh.material = part.material.material;
    }
    part.material.add(contact, hit.direction, Math.max(0.35, hit.amount * 1.8), 0.3 + hit.severity * 0.9);
    if (!part.broken) { part.broken = true; this.summary.brokenGlass++ }
    if (part.chipped || hit.severity < 0.5 || !this.debris.available) return;
    part.chipped = true;
    const geometry = part.mesh.geometry;
    const position = geometry.getAttribute('position');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), center = new THREE.Vector3();
    const triangles: { index: number; distance: number }[] = [];
    for (let index = 0; index < position.count; index += 3) {
      a.fromBufferAttribute(position, index); b.fromBufferAttribute(position, index + 1); c.fromBufferAttribute(position, index + 2);
      if (Math.max(a.distanceTo(b), a.distanceTo(c), b.distanceTo(c)) > 0.14) continue;
      center.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const distance = center.distanceTo(contact);
      if (distance < 0.2) triangles.push({ index, distance });
    }
    triangles.sort((a, b) => a.distance - b.distance);
    const shardCount = Math.min(2, this.debris.available);
    for (let shard = 0; shard < shardCount; shard++) {
      const vertices = triangles.slice(shard * 3, shard * 3 + 3).flatMap(triangle => [triangle.index, triangle.index + 1, triangle.index + 2]);
      if (!vertices.length) continue;
      this.debris.add(subsetGeometry(geometry, vertices).applyMatrix4(this.meshToGroup), this.sourceMaterial, hit.worldDirection, hit.severity, true);
    }
  }
}
