export const GROUND_BODY = 1;
export const ROAD = 2;
export const BARRIER = 4;
export const AIR_ENV = 8;
export const AIR_BODY = 16;
export const DEBRIS = 32;

export function packCollisionGroups(membership: number, filter: number) {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const GROUND_BODY_GROUPS = packCollisionGroups(GROUND_BODY, GROUND_BODY | ROAD | BARRIER);
export const ROAD_GROUPS = packCollisionGroups(ROAD, GROUND_BODY | AIR_BODY | DEBRIS);
export const BARRIER_GROUPS = packCollisionGroups(BARRIER, GROUND_BODY | AIR_BODY | DEBRIS);
export const AIR_ENV_GROUPS = packCollisionGroups(AIR_ENV, AIR_BODY);
export const AIR_BODY_GROUPS = packCollisionGroups(AIR_BODY, ROAD | BARRIER | AIR_ENV | AIR_BODY);
export const AIR_QUERY_GROUPS = packCollisionGroups(AIR_BODY, GROUND_BODY | ROAD | BARRIER | AIR_ENV | AIR_BODY);
export const AIR_LOS_QUERY_GROUPS = packCollisionGroups(GROUND_BODY | AIR_BODY, GROUND_BODY | ROAD | BARRIER | AIR_ENV | AIR_BODY);
export const AIR_PROXIMITY_QUERY_GROUPS = packCollisionGroups(GROUND_BODY | AIR_BODY, GROUND_BODY | ROAD | BARRIER | AIR_ENV | AIR_BODY);
