import type { TrafficAgent, TrafficObstacle } from './traffic';
import { clamp, laneCount, laneOffset } from './traffic-network';

export function policeYieldOffset(agent: TrafficAgent, obstacles: TrafficObstacle[], heading: number) {
  const police: { offset: number; width: number }[] = [];
  for (const other of obstacles) {
    if (!other.emergency || Math.abs(other.position.y - agent.position.y - 0.79) > 2.2) continue;
    const dx = other.position.x - agent.position.x, dz = other.position.z - agent.position.z;
    const along = dx * Math.sin(heading) + dz * Math.cos(heading);
    const side = dx * Math.cos(heading) - dz * Math.sin(heading);
    const speed = Math.hypot(other.velocity.x, other.velocity.z);
    const alignment = Math.cos(other.heading - heading);
    const forwardSpeed = other.velocity.x * Math.sin(heading) + other.velocity.z * Math.cos(heading);
    const sameDirection = alignment > 0.3;
    const relativeX = other.velocity.x - Math.sin(heading) * agent.speed;
    const relativeZ = other.velocity.z - Math.cos(heading) * agent.speed;
    const closingSpeed = sameDirection ? forwardSpeed - agent.speed : -(dx * relativeX + dz * relativeZ) / Math.max(1, Math.hypot(dx, dz));
    if (speed < 2 || closingSpeed < 1) continue;
    const clearance = (agent.length + other.length) / 2 + 3;
    const reach = clamp(35 + closingSpeed * 5, 55, 240);
    if (sameDirection ? along < -reach || along > clearance : along < -clearance || along > reach) continue;
    const width = Math.abs(alignment) * other.width + Math.abs(Math.sin(other.heading - heading)) * other.length;
    if (agent.yieldOffset === undefined && Math.abs(alignment) > 0.7 && Math.abs(side) > (agent.width + width) / 2 + 1.4) continue;
    const offset = agent.offset + side * agent.leg.sign;
    if (Math.abs(offset) > agent.road.width / 2 + 2) continue;
    police.push({ offset, width });
  }
  if (!police.length) return undefined;
  const margin = agent.width / 2 + 0.5;
  let low = -agent.road.width / 2 + margin, high = agent.road.width / 2 - margin;
  if (!agent.road.oneWay && agent.road.lanes > 1) {
    if (agent.leg.sign > 0) high = -margin;
    else low = margin;
  }
  if (low > high) return agent.offset;
  const cost = (offset: number) => Math.abs(offset - agent.offset) +
    police.reduce((total, other) => total + Math.max(0, (agent.width + other.width) / 2 + 1.4 - Math.abs(offset - other.offset)) * 30, 0);
  const preferred = agent.leg.sign > 0 ? low : high;
  const candidates = [preferred, preferred === low ? high : low, clamp(agent.offset, low, high)];
  for (const other of police) {
    const clearance = (agent.width + other.width) / 2 + 1.5;
    candidates.push(clamp(other.offset - clearance, low, high), clamp(other.offset + clearance, low, high));
  }
  let target = candidates[0];
  for (const candidate of candidates) if (cost(candidate) < cost(target)) target = candidate;
  if (agent.yieldOffset !== undefined && cost(agent.yieldOffset) <= cost(target) + 2) target = agent.yieldOffset;
  return target;
}

export function nearestYieldLane(agent: TrafficAgent, offset: number) {
  let nearest = 0;
  for (let lane = 1; lane < laneCount(agent.leg); lane++) {
    if (Math.abs(laneOffset(agent.leg, lane) - offset) < Math.abs(laneOffset(agent.leg, nearest) - offset)) nearest = lane;
  }
  return nearest;
}
