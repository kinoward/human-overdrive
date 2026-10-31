import RAPIER from '@dimforge/rapier3d-compat';
import type { RoadPosition } from '../types';
import { BARRIER, GROUND_BODY, packCollisionGroups } from './collision-groups';

export interface CaptureVehicle {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  width: number;
  length: number;
  activePursuit?: boolean;
}

export interface CapturePlayer extends CaptureVehicle {}

const CAPTURE_QUERY_GROUPS = packCollisionGroups(GROUND_BODY, GROUND_BODY | BARRIER);

export function isCaptured(
  world: RAPIER.World,
  player: CapturePlayer,
  police: readonly CaptureVehicle[],
  road: RoadPosition | null,
  contactBodies: ReadonlySet<number>
) {
  if (!road) return false;
  const position = player.body.translation();
  const direction = road.direction;
  const valid = police.filter(actor => {
    if (actor.body.handle === player.body.handle || actor.activePursuit !== true) return false;
    const rotation = actor.body.rotation();
    if (1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z) <= 0.3) return false;
    const point = actor.body.translation();
    const dx = point.x - position.x;
    const dz = point.z - position.z;
    const longitudinal = dx * direction.x + dz * direction.z;
    const lateral = dx * direction.z - dz * direction.x;
    const close = Math.hypot(dx, dz) <= Math.max(7, (player.length + actor.length) * 0.6);
    return Math.abs(point.y - position.y) < 2.2 && Math.abs(lateral) < road.road.width / 2 + actor.width && (contactBodies.has(actor.body.handle) || close) && Math.abs(longitudinal) < 9;
  });
  if (valid.length < 2) return false;
  const validHandles = new Set(valid.map(actor => actor.body.handle));
  let front = false;
  let rear = false;
  for (const actor of valid) {
    if (!contactBodies.has(actor.body.handle)) continue;
    const point = actor.body.translation();
    const longitudinal = (point.x - position.x) * direction.x + (point.z - position.z) * direction.z;
    if (longitudinal > 0.45) front = true;
    if (longitudinal < -0.45) rear = true;
  }
  const frontHit = blocked(world, player, validHandles, direction.x, direction.z);
  const rearHit = blocked(world, player, validHandles, -direction.x, -direction.z);
  const policeFront = front || frontHit === 'police';
  const policeRear = rear || rearHit === 'police';
  return (policeFront && (policeRear || rearHit === 'barrier')) || (policeRear && frontHit === 'barrier');
}

function blocked(world: RAPIER.World, player: CapturePlayer, police: Set<number>, x: number, z: number) {
  const position = player.body.translation();
  const shape = new RAPIER.Cuboid(player.width * 0.43, 0.42, player.length * 0.4);
  const hit = world.castShape(
    position,
    player.body.rotation(),
    { x, y: 0, z },
    shape,
    0.04,
    6,
    false,
    undefined,
    CAPTURE_QUERY_GROUPS,
    undefined,
    player.body,
    collider => {
      if (collider.isSensor()) return false;
      const body = collider.parent();
      const obstacle = body?.translation() ?? collider.translation();
      const ahead = (obstacle.x - position.x) * x + (obstacle.z - position.z) * z > 0.25;
      if (body) return ahead && police.has(body.handle);
      return ahead && (((collider.collisionGroups() >>> 16) & 0xffff) & BARRIER) !== 0;
    }
  );
  if (!hit) return undefined;
  if (hit.collider.parent()) return 'police';
  const normal = hit.normal1;
  return Math.abs(normal.x * x + normal.z * z) > 0.65 ? 'barrier' : undefined;
}
