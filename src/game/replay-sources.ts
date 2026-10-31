import * as THREE from 'three';
import type { PhysicsVehicle } from './physics';
import type { PursuitHelicopter } from './helicopter';
import type { createTrafficVehicleModel } from './traffic-models';
import type { TrafficAgent } from './traffic';
import type { VehicleDamage } from './vehicle-damage';
import type { ReplayChannel, ReplaySource } from './replay-visuals';

const axisChannel = (node: THREE.Object3D, property: 'position' | 'rotation' | 'target', axis: 'x' | 'y' | 'z'): ReplayChannel => ({ node, property, axis });
const lights = (brake: THREE.Mesh[], signals: THREE.Mesh[], police: THREE.Mesh[]): ReplayChannel[] => [
  ...[...brake, ...signals].map(node => ({ node, property: 'emissive' as const })),
  ...police.map(node => ({ node, property: 'visible' as const })),
];

export function vehicleReplaySource(vehicle: PhysicsVehicle, player = false): ReplaySource {
  return {
    key: vehicle.model.group.uuid, root: vehicle.model.group,
    speed: () => vehicle.speed, opacity: () => 1, revision: () => vehicle.damage.revision,
    priority: player ? 0 : 1,
    channels: [
      axisChannel(vehicle.visualPivot, 'rotation', 'x'), axisChannel(vehicle.visualPivot, 'rotation', 'z'),
      ...vehicle.model.wheels.flatMap(wheel => [axisChannel(wheel, 'position', 'y'), axisChannel(wheel, 'rotation', 'x'), axisChannel(wheel, 'rotation', 'y')]),
      ...lights(vehicle.model.brakeLights, vehicle.model.turnSignals, vehicle.model.policeLights),
    ],
  };
}

export function trafficReplaySource(actor: { model: ReturnType<typeof createTrafficVehicleModel>; driver: TrafficAgent; appearance: number; damage?: VehicleDamage; replayGeneration: number }): ReplaySource {
  return {
    key: `${actor.model.group.uuid}:${actor.replayGeneration}`, root: actor.model.group,
    speed: () => actor.driver.speed, opacity: () => actor.appearance, revision: () => actor.damage?.revision ?? 0,
    priority: 1,
    channels: [
      ...actor.model.wheelSpecs.map(wheel => ({
        node: wheel.object, property: 'wheel' as const, read: () => actor.driver.wheelDistance,
        wheel: { axis: wheel.axis.clone(), base: wheel.baseRotation.clone(), radius: wheel.radius, direction: wheel.direction },
      })),
      ...lights(actor.model.brakeLights, actor.model.turnSignals, actor.model.policeLights),
    ],
  };
}

export function helicopterReplaySource(actor: PursuitHelicopter): ReplaySource {
  return {
    key: actor.model.group.uuid, root: actor.model.group,
    speed: () => { const velocity = actor.body.linvel(); return Math.hypot(velocity.x, velocity.z) },
    opacity: () => 1, revision: () => 0, priority: 1,
    channels: [axisChannel(actor.model.rotor, 'rotation', 'y'),
      ...(['x', 'y', 'z'] as const).map(axis => axisChannel(actor.model.spotlight, 'target', axis)),
      { node: actor.model.spotlight, property: 'visible' },
    ],
  };
}

export function debrisReplaySource(mesh: THREE.Mesh): ReplaySource {
  return { key: mesh.uuid, root: mesh, channels: [], speed: () => 0, opacity: () => 1, revision: () => 0, priority: 2 };
}
