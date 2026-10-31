import type { RoadPath } from '../types';

export type TrafficVehicleId = 'suv' | 'motorcycle' | 'van' | 'truck' | 'bus';

export interface TrafficVehicleSpec {
  id: TrafficVehicleId;
  label: string;
  kind: 'car' | 'motorcycle';
  asset: string;
  length: number;
  width: number;
  height: number;
  mass: number;
  wheelRadius: number;
  speeds: Record<RoadPath['kind'], number>;
  acceleration: number;
  comfortableBrake: number;
  emergencyBrake: number;
  headway: number;
  minGap: number;
  maxLateralAcceleration: number;
  heavy: boolean;
  weight: number;
}

export const TRAFFIC_VEHICLES: Record<TrafficVehicleId, TrafficVehicleSpec> = {
  suv: { id: 'suv', label: '城市 SUV', kind: 'car', asset: 'electric-suv', length: 4.75, width: 2, height: 1.75, mass: 1800, wheelRadius: 0.378, speeds: { main: 24, service: 12, ramp: 8.5 }, acceleration: 2.1, comfortableBrake: 3, emergencyBrake: 8, headway: 1.3, minGap: 2.8, maxLateralAcceleration: 2.6, heavy: false, weight: 0.5 },
  motorcycle: { id: 'motorcycle', label: '城市摩托', kind: 'motorcycle', asset: 'adventure-motorcycle', length: 2.3, width: 0.85, height: 1.8, mass: 280, wheelRadius: 0.36, speeds: { main: 27, service: 13.5, ramp: 9.5 }, acceleration: 2.8, comfortableBrake: 3.2, emergencyBrake: 8, headway: 1.1, minGap: 2.2, maxLateralAcceleration: 3, heavy: false, weight: 0.2 },
  van: { id: 'van', label: '城市配送车', kind: 'car', asset: 'delivery-van', length: 5.5, width: 2.05, height: 2.5, mass: 3200, wheelRadius: 0.37, speeds: { main: 20.5, service: 10.5, ramp: 7 }, acceleration: 1.7, comfortableBrake: 2.8, emergencyBrake: 7, headway: 1.65, minGap: 3.3, maxLateralAcceleration: 2, heavy: false, weight: 0.15 },
  truck: { id: 'truck', label: '厢式大货车', kind: 'car', asset: 'box-truck', length: 9.2, width: 2.5, height: 3.5, mass: 12000, wheelRadius: 0.5, speeds: { main: 17.5, service: 8.5, ramp: 6 }, acceleration: 1.15, comfortableBrake: 2.4, emergencyBrake: 6, headway: 2.1, minGap: 4.5, maxLateralAcceleration: 1.35, heavy: true, weight: 0.1 },
  bus: { id: 'bus', label: '城市公交', kind: 'car', asset: 'city-bus', length: 10.5, width: 2.5, height: 3.2, mass: 11000, wheelRadius: 0.48, speeds: { main: 17, service: 9.5, ramp: 5.5 }, acceleration: 1.25, comfortableBrake: 2.5, emergencyBrake: 6, headway: 2, minGap: 4.2, maxLateralAcceleration: 1.4, heavy: true, weight: 0.05 },
};

export const TRAFFIC_COUNT = 42;
const population: TrafficVehicleId[] = ['suv', 'motorcycle', 'van', 'suv', 'truck', 'suv', 'motorcycle', 'suv', 'bus', 'suv', 'suv', 'van', 'motorcycle', 'suv', 'truck', 'suv', 'van', 'motorcycle', 'suv', 'suv'];

export function trafficVehicleForSlot(slot: number) {
  return TRAFFIC_VEHICLES[population[slot % population.length]];
}
