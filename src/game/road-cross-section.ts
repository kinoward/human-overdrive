import type { RoadPath } from '../types';

export function roadCrossSection(road: RoadPath) {
  const shoulderWidth = road.kind === 'main' && road.oneWay ? 3 : 0;
  const travelWidth = road.width - shoulderWidth;
  const travelOffset = -shoulderWidth / 2;
  const laneWidth = travelWidth / road.lanes;
  const laneOffset = (lane: number) => travelOffset + (lane + 0.5) * laneWidth - travelWidth / 2;
  return { shoulderWidth, travelWidth, travelOffset, laneWidth, laneOffset };
}
