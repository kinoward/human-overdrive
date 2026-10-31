import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { RoadPath, WorldData } from '../types';
import { sampleRoad } from './road-network';
import { SceneryBatch } from './scenery-batch';
import { addRoadScenery } from './road-scenery';
import { addCityScenery } from './city-scenery';
import { createDrivingAtmosphere } from './driving-atmosphere';
import { addRoadDetails } from './road-details';
import { addUrbanFrontage } from './urban-frontage';

export { sampleRoad, nearestRoad } from './road-network';

interface StoredWorld {
  source: { name: string; osmTimestamp: string };
  attribution: string;
  roads: Omit<RoadPath, 'cumulative'>[];
  mainLoopLength: number;
}

export async function buildWorld(scene: THREE.Scene): Promise<WorldData> {
  const response = await fetch('/data/beijing-roads.json');
  if (!response.ok) throw new Error('北京道路加载失败，请重新进入关卡。');
  const stored = await response.json() as StoredWorld;
  const roads: RoadPath[] = stored.roads.map(road => {
    const cumulative = [0];
    for (let i = 1; i < road.points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(road.points[i].x - road.points[i - 1].x, road.points[i].z - road.points[i - 1].z));
    return { ...road, cumulative, length: cumulative[cumulative.length - 1] };
  });
  const points = roads.flatMap(road => road.points);
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const point of points) { bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x); bounds.minZ = Math.min(bounds.minZ, point.z); bounds.maxZ = Math.max(bounds.maxZ, point.z) }
  const loader = new THREE.TextureLoader();
  const load = async (path: string, color = false) => {
    const texture = await loader.loadAsync(`/assets/art/${path}`);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const [asphaltMap, asphaltNormal, asphaltRough, concreteMap, concreteNormal, concreteRough, environment] = await Promise.all([
    load('Textures/Asphalt02/asphalt_02_diff_2k.jpg', true), load('Textures/Asphalt02/asphalt_02_nor_gl_2k.png'), load('Textures/Asphalt02/asphalt_02_rough_2k.jpg'),
    load('Textures/ConcreteWall006/concrete_wall_006_diff_2k.jpg', true), load('Textures/ConcreteWall006/concrete_wall_006_nor_gl_2k.png'), load('Textures/ConcreteWall006/concrete_wall_006_rough_2k.jpg'),
    new HDRLoader().loadAsync('/assets/art/Environment/venice_sunset_2k.hdr')
  ]);
  const font = new FontFace('Source Han Sans', 'url(/assets/art/Fonts/SourceHanSansCN-Regular.otf)');
  document.fonts.add(await font.load());
  environment.mapping = THREE.EquirectangularReflectionMapping;
  const skyTexture = createDrivingAtmosphere(scene);
  scene.environment = environment;
  const group = new THREE.Group(); group.name = '北京四环完整路网';
  const batch = new SceneryBatch(group);
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltMap, normalMap: asphaltNormal, roughnessMap: asphaltRough, normalScale: new THREE.Vector2(0.22, 0.22), roughness: 0.94, color: '#bfc4c9' });
  asphalt.userData.roadSurface = true;
  const concrete = new THREE.MeshStandardMaterial({ map: concreteMap, normalMap: concreteNormal, roughnessMap: concreteRough, roughness: 0.95, color: '#c9c8bd' });
  const ground = new THREE.MeshStandardMaterial({ color: '#819478', roughness: 1 });
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 4000, bounds.maxZ - bounds.minZ + 4000), ground);
  terrain.rotation.x = -Math.PI / 2; terrain.position.set((bounds.minX + bounds.maxX) / 2, -12, (bounds.minZ + bounds.maxZ) / 2); group.add(terrain);
  const obstacles = addRoadScenery(group, roads, { asphalt, concrete, ground }, batch);
  addRoadDetails(roads, batch);
  const frontageOccupied = addUrbanFrontage(roads, batch);
  addCityScenery(roads, batch, frontageOccupied);
  const surfaces = batch.finish();
  group.add(new THREE.HemisphereLight('#e4edf5', '#7e806d', 1.8));
  scene.add(group);
  const mainRoads = roads.filter(road => road.kind === 'main');
  const north = mainRoads.flatMap(road => road.points.map((point, i) => ({ road, point, distance: road.cumulative[i] }))).filter(item => item.point.z < -6000 && item.point.x < 0 && Math.abs(item.point.y) < 0.05 && item.distance > 60 && item.distance < item.road.length - 250);
  const origin = north.reduce((best, item) => Math.hypot(item.point.x + 5100, item.point.z + 8700) < Math.hypot(best.point.x + 5100, best.point.z + 8700) ? item : best, north[0] ?? { road: mainRoads[0], point: mainRoads[0].points[0], distance: 0 });
  const spawn = sampleRoad(origin.road, origin.distance, origin.road.width / 8);
  return {
    roads, bounds, surfaces, mainLoopLength: stored.mainLoopLength, obstacles,
    source: `${stored.source.name} · ${stored.source.osmTimestamp.slice(0, 10)} · 1:1 米制路网`, attribution: stored.attribution,
    spawn: { position: spawn.point, heading: spawn.heading, roadId: origin.road.id, distance: origin.distance },
    dispose: () => {
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
      geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose()); environment.dispose(); skyTexture.dispose();
      scene.environment = null; scene.remove(group);
    }
  };
}
