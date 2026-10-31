export type VehicleId = 'model-y' | 'f850gs';
export type Outcome = 'escaped' | 'flipped' | 'caught';
export type CinematicKind = 'intro' | Outcome;

export interface CinematicSnapshot {
  kind: CinematicKind;
  elapsed: number;
  duration: number;
  shot: string;
}

export interface ReplaySnapshot {
  title: string;
  clip: number;
  clips: number;
  elapsed: number;
  duration: number;
  raceTime: number;
  slowMotion: boolean;
}

export interface VehicleConfig {
  id: VehicleId;
  name: string;
  make: string;
  kind: 'car' | 'motorcycle';
  subtitle: string;
  description: string;
  region: string;
  topSpeed: number;
  acceleration: number;
  mass: number;
  width: number;
  length: number;
  handling: number;
  color: string;
}

export interface CityConfig {
  id: string;
  name: string;
  district: string;
  available: boolean;
  description: string;
  coordinates: string;
  targetDistance: number;
}

export interface GameSnapshot {
  status: 'ready' | 'intro' | 'running' | 'paused' | 'outro' | 'replay' | 'finished';
  cinematic?: CinematicSnapshot;
  replay?: ReplaySnapshot;
  speedKmh: number;
  distance: number;
  targetDistance: number;
  elapsed: number;
  policeCount: number;
  damagedPoliceCount: number;
  policeTarget: number;
  helicopterCount: number;
  score: number;
  stars: number;
  combo: number;
  nearMisses: number;
  collisions: number;
  wrongWay: boolean;
  captureProgress: number;
  event: string;
  eventTone: 'neutral' | 'good' | 'danger';
  vehicleId: VehicleId;
}

export interface RaceResult {
  id: string;
  createdAt: string;
  nickname: string;
  cityId: string;
  vehicleId: VehicleId;
  outcome: Outcome;
  score: number;
  stars: number;
  duration: number;
  distance: number;
  targetDistance: number;
  maxPoliceCount: number;
  nearMisses: number;
  collisions: number;
  topSpeed: number;
  cleanDistance: number;
  pressureDistance: number;
  evadedAttacks: number;
  fullPressureEscape: boolean;
  techniqueScore: number;
  controlScore: number;
  pressureScore: number;
}

export interface RaceMetrics {
  vehicleId: VehicleId;
  elapsed: number;
  distance: number;
  targetDistance: number;
  nearMisses: number;
  collisions: number;
  maxPoliceCount: number;
  maxPressureTime: number;
  maxPressureDistance: number;
  topSpeed: number;
  cleanDistance: number;
  pressureDistance: number;
  evadedAttacks: number;
}

export interface Point3 { x: number; y: number; z: number }

export interface RoadPath {
  id: string;
  name: string;
  kind: 'main' | 'service' | 'ramp';
  width: number;
  points: Point3[];
  length: number;
  cumulative: number[];
  oneWay: boolean;
  lanes: number;
  closed: boolean;
  junctions: { roadId: string; point: Point3 }[];
}

export interface RoadPosition {
  road: RoadPath;
  distance: number;
  offset: number;
  point: Point3;
  direction: Point3;
}

export interface WorldData {
  roads: RoadPath[];
  spawn: { position: Point3; heading: number; roadId: string; distance: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  source: string;
  attribution: string;
  obstacles?: { center: Point3; halfExtents: Point3; rotation: number; pitch?: number }[];
  surfaces: { vertices: Float32Array; indices: Uint32Array }[];
  mainLoopLength: number;
  dispose: () => void;
}
