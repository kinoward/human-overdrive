import type { CityConfig, VehicleConfig } from './types';

export const TARGET_DISTANCE = 5000;
export const POLICE_COUNTS = [0, 1, 2, 4, 7, 10] as const;
export const HELICOPTER_COUNTS = [0, 0, 0, 1, 2, 3] as const;

export const VEHICLES: VehicleConfig[] = [
  {
    id: 'model-y',
    name: 'Model Y',
    make: 'Tesla',
    kind: 'car',
    subtitle: '电动跨界车 · 中国',
    description: '充沛的加速，沉稳的车身。找准空隙，把每一次变线连成流畅的逃亡路线。',
    region: '中国',
    topSpeed: 210,
    acceleration: 9.5,
    mass: 1900,
    width: 1.9,
    length: 4.75,
    handling: 0.74,
    color: '#d7e2de',
  },
  {
    id: 'f850gs',
    name: 'F 850 GS Adventure',
    make: 'BMW',
    kind: 'motorcycle',
    subtitle: '探险摩托 · 平衡辅助',
    description: '更窄的车身，更敏捷的路线。穿过车流的缝隙，也要留神侧面逼近的警车。',
    region: '中国',
    topSpeed: 190,
    acceleration: 10.8,
    mass: 250,
    width: 0.85,
    length: 2.3,
    handling: 0.94,
    color: '#c9d754',
  },
];

export const CITIES: CityConfig[] = [
  {
    id: 'beijing',
    name: '北京',
    district: '四环 · 主路与辅路',
    available: true,
    description: '从宽阔主路切入辅路，在城市的脉络中寻找下一次脱身的机会。',
    coordinates: '39.99° N · 116.33° E',
    targetDistance: TARGET_DISTANCE,
  },
  {
    id: 'shanghai',
    name: '上海',
    district: '高架之间',
    available: false,
    description: '沿着高架与城市灯火，寻找属于下一座城的速度。',
    coordinates: '31.23° N · 121.47° E',
    targetDistance: TARGET_DISTANCE,
  },
  {
    id: 'chongqing',
    name: '重庆',
    district: '山城回响',
    available: false,
    description: '桥梁与坡道交错，下一条路可能就在你的头顶。',
    coordinates: '29.56° N · 106.55° E',
    targetDistance: TARGET_DISTANCE,
  },
  {
    id: 'tokyo',
    name: '东京',
    district: '都市环线',
    available: false,
    description: '密集车流与紧凑弯道，等待一次新的出发。',
    coordinates: '35.68° N · 139.76° E',
    targetDistance: TARGET_DISTANCE,
  },
  {
    id: 'los-angeles',
    name: '洛杉矶',
    district: '日落公路',
    available: false,
    description: '让宽阔公路伸向远方，在另一片天空下继续逃亡。',
    coordinates: '34.05° N · 118.24° W',
    targetDistance: TARGET_DISTANCE,
  },
];
