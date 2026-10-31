import * as THREE from 'three';
import type { RoadPath } from '../types';
import { RoadIndex } from './road-network';

export interface SceneryFootprint { x: number; z: number; halfWidth: number; halfDepth: number; heading: number }

export function meshBounds(meshes: { geometry: THREE.BufferGeometry }[]) {
  const bounds = new THREE.Box3();
  for (const mesh of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    bounds.union(mesh.geometry.boundingBox!);
  }
  return bounds;
}

export class SceneryPlacement {
  readonly roadIndex: RoadIndex;
  private occupied = new Map<string, SceneryFootprint[]>();

  constructor(roads: RoadPath[], private frontageOccupied?: (x: number, z: number, radius: number) => boolean) {
    this.roadIndex = new RoadIndex(roads);
  }

  isFree(footprint: SceneryFootprint, gap = 0, roadClearance = 0.6) {
    const plot = this.expanded(footprint, gap);
    return this.clear(footprint, plot, this.keys(plot), roadClearance);
  }

  reserve(footprint: SceneryFootprint, gap = 0, roadClearance = 0.6) {
    const plot = this.expanded(footprint, gap), cells = this.keys(plot);
    if (!this.clear(footprint, plot, cells, roadClearance)) return false;
    for (const key of cells) {
      if (!this.occupied.has(key)) this.occupied.set(key, []);
      this.occupied.get(key)!.push(plot);
    }
    return true;
  }

  private expanded(footprint: SceneryFootprint, gap: number) {
    return { ...footprint, halfWidth: footprint.halfWidth + gap, halfDepth: footprint.halfDepth + gap };
  }

  private keys(plot: SceneryFootprint) {
    const c = Math.abs(Math.cos(plot.heading)), s = Math.abs(Math.sin(plot.heading));
    const x = c * plot.halfWidth + s * plot.halfDepth, z = s * plot.halfWidth + c * plot.halfDepth;
    const keys: string[] = [];
    for (let cellX = Math.floor((plot.x - x) / 32); cellX <= Math.floor((plot.x + x) / 32); cellX++) {
      for (let cellZ = Math.floor((plot.z - z) / 32); cellZ <= Math.floor((plot.z + z) / 32); cellZ++) keys.push(`${cellX},${cellZ}`);
    }
    return keys;
  }

  private overlaps(a: SceneryFootprint, b: SceneryFootprint) {
    const ac = Math.cos(a.heading), asin = Math.sin(a.heading), bc = Math.cos(b.heading), bsin = Math.sin(b.heading);
    for (const [x, z] of [[ac, -asin], [asin, ac], [bc, -bsin], [bsin, bc]]) {
      const distance = Math.abs((b.x - a.x) * x + (b.z - a.z) * z);
      const ar = a.halfWidth * Math.abs(ac * x - asin * z) + a.halfDepth * Math.abs(asin * x + ac * z);
      const br = b.halfWidth * Math.abs(bc * x - bsin * z) + b.halfDepth * Math.abs(bsin * x + bc * z);
      if (distance >= ar + br) return false;
    }
    return true;
  }

  private clear(footprint: SceneryFootprint, plot: SceneryFootprint, cells: string[], roadClearance: number) {
    const candidates = new Set<SceneryFootprint>();
    for (const key of cells) for (const other of this.occupied.get(key) ?? []) candidates.add(other);
    for (const other of candidates) if (this.overlaps(plot, other)) return false;
    const c = Math.cos(footprint.heading), s = Math.sin(footprint.heading);
    const columns = Math.ceil(footprint.halfWidth * 2 / 3), rows = Math.ceil(footprint.halfDepth * 2 / 3);
    for (let ix = 0; ix <= columns; ix++) for (let iz = 0; iz <= rows; iz++) {
      const localX = footprint.halfWidth * (ix * 2 / columns - 1), localZ = footprint.halfDepth * (iz * 2 / rows - 1);
      const x = footprint.x + localX * c + localZ * s, z = footprint.z - localX * s + localZ * c;
      if (this.frontageOccupied?.(x, z, 0.1)) return false;
      const near = this.roadIndex.nearest(x, z);
      if (!near || Math.abs(near.offset) < near.road.width / 2 + roadClearance || this.roadIndex.covers({ x, y: near.point.y, z }, undefined, roadClearance)) return false;
    }
    return true;
  }
}
