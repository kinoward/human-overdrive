import * as THREE from 'three';
import type { WorldData } from '../types';
import { sampleRoad } from './road-network';
import { buildBeijingRoads } from './beijing-road-layout';
import { SceneryBatch } from './scenery-batch';
import { addRoadScenery } from './road-scenery';
import { addCityScenery } from './city-scenery';
import { addRoadDetails } from './road-details';
import { addUrbanFrontage } from './urban-frontage';
import { addBuildingFacades } from './building-facades';
import { addStreetFurniture } from './street-furniture';
import { addVergeVariation } from './verge-material';
import { roadCrossSection } from './road-cross-section';
import { LoadingBudget } from './loading-budget';
import type { loadWorldAssets } from './world-assets';

export { sampleRoad, nearestRoad } from './road-network';

export async function buildWorld(scene: THREE.Scene, assets: Awaited<ReturnType<typeof loadWorldAssets>>, onProgress?: (progress: number, message: string) => Promise<void>): Promise<WorldData> {
  await onProgress?.(0, '整理城市道路');
  const { stored, asphaltMap, asphaltNormal, asphaltRough, concreteMap, concreteNormal, concreteRough } = assets;
  const roads = buildBeijingRoads(stored.roads);
  const points = roads.flatMap(road => road.points);
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const point of points) { bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x); bounds.minZ = Math.min(bounds.minZ, point.z); bounds.maxZ = Math.max(bounds.maxZ, point.z) }
  await onProgress?.(0.1, '准备地面材质');
  const group = new THREE.Group(); group.name = '北京四环完整路网';
  const batch = new SceneryBatch(group);
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltMap, normalMap: asphaltNormal, roughnessMap: asphaltRough, normalScale: new THREE.Vector2(0.22, 0.22), roughness: 0.94, color: '#bfc4c9' });
  asphalt.userData.roadSurface = true;
  const concrete = new THREE.MeshStandardMaterial({ map: concreteMap, normalMap: concreteNormal, roughnessMap: concreteRough, roughness: 0.95, color: '#dadeda' });
  concrete.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), 0.85);');
  };
  const grassCanvas = document.createElement('canvas'); grassCanvas.width = grassCanvas.height = 256;
  const grassContext = grassCanvas.getContext('2d')!; const grassPixels = grassContext.createImageData(256, 256);
  let seed = 261031;
  for (let i = 0; i < grassPixels.data.length; i += 4) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    const variation = (seed >>> 24) / 255;
    grassPixels.data[i] = 66 + variation * 42; grassPixels.data[i + 1] = 81 + variation * 46; grassPixels.data[i + 2] = 47 + variation * 28; grassPixels.data[i + 3] = 255;
  }
  grassContext.putImageData(grassPixels, 0, 0);
  const grass = new THREE.CanvasTexture(grassCanvas); grass.colorSpace = THREE.SRGBColorSpace; grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.repeat.set(16, 16); grass.anisotropy = 4;
  const ground = new THREE.MeshStandardMaterial({ map: grass, color: '#a9b59c', roughness: 1 });
  addVergeVariation(ground);
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 4000, bounds.maxZ - bounds.minZ + 4000), ground);
  terrain.rotation.x = -Math.PI / 2; terrain.position.set((bounds.minX + bounds.maxX) / 2, -12, (bounds.minZ + bounds.maxZ) / 2); group.add(terrain);
  await onProgress?.(0.2, '铺设城市道路');
  const obstacles = await addRoadScenery(group, roads, { asphalt, concrete, ground }, batch);
  await addRoadDetails(roads, batch);
  await onProgress?.(0.4, '布置沿街场景');
  const frontageOccupied = await addUrbanFrontage(roads, batch);
  await onProgress?.(0.6, '布置楼体与绿化');
  const city = await addCityScenery(roads, batch, frontageOccupied, placement => addStreetFurniture(roads, batch, placement));
  await onProgress?.(0.8, '补充建筑立面');
  const budget = new LoadingBudget();
  for (const building of city.buildings) {
    if (budget.exhausted) await budget.yield();
    if (building.type !== 'office-block') await addBuildingFacades(batch, { ...building, type: building.type });
  }
  await onProgress?.(0.95, '整理场景');
  const surfaces = await batch.finish();
  group.add(new THREE.HemisphereLight('#e4edf5', '#7e806d', 1.8));
  scene.add(group);
  const mainRoads = roads.filter(road => road.kind === 'main');
  const north = mainRoads.flatMap(road => road.points.map((point, i) => ({ road, point, distance: road.cumulative[i] }))).filter(item => item.point.z < -6000 && item.point.x < 0 && Math.abs(item.point.y) < 0.05 && item.distance > 60 && item.distance < item.road.length - 250);
  const origin = north.reduce((best, item) => Math.hypot(item.point.x + 5100, item.point.z + 8700) < Math.hypot(best.point.x + 5100, best.point.z + 8700) ? item : best, north[0] ?? { road: mainRoads[0], point: mainRoads[0].points[0], distance: 0 });
  const spawn = sampleRoad(origin.road, origin.distance, roadCrossSection(origin.road).laneOffset(Math.floor(origin.road.lanes / 2)));
  await onProgress?.(1, '城市场景准备完成');
  return {
    roads, bounds, surfaces, mainLoopLength: mainRoads.reduce((length, road) => length + road.length, 0) / 2, obstacles,
    source: `${stored.source.name} · ${stored.source.osmTimestamp.slice(0, 10)} · 米制改编路网`, attribution: stored.attribution,
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
      geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose());
      scene.remove(group);
    }
  };
}
