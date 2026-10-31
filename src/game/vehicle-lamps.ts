import * as THREE from 'three';

export interface VehicleLampSource {
  owner: THREE.Group;
  mount: THREE.Object3D;
  target: THREE.Vector3;
  intensity: number;
  distance: number;
  angle: number;
}

interface VehicleLampConfig {
  width: number;
  length: number;
  motorcycle?: boolean;
  height?: number;
  front?: number;
  intensity?: number;
}

export const vehicleLampSources = new Map<THREE.Group, VehicleLampSource>();

export function addVehicleLamps(owner: THREE.Group, config: VehicleLampConfig) {
  const motorcycle = config.motorcycle ?? false;
  const height = config.height ?? (motorcycle ? 0.3 : 0.06);
  const mount = new THREE.Group();
  mount.name = '车辆前灯挂点';
  mount.position.set(0, height, config.front ?? config.length * 0.502);
  const geometry = new THREE.BoxGeometry(motorcycle ? 0.18 : 0.24, motorcycle ? 0.12 : 0.085, 0.045);
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1d9').multiplyScalar(3.6), toneMapped: false });
  for (const side of motorcycle ? [0] : [-1, 1]) {
    const lamp = new THREE.Mesh(geometry, material);
    lamp.position.x = side * config.width * 0.38;
    mount.add(lamp);
  }
  owner.add(mount);
  owner.userData.headlightOpacity = 1;
  vehicleLampSources.set(owner, {
    owner, mount,
    target: new THREE.Vector3(0, -height - 0.8, motorcycle ? 28 : 34),
    intensity: config.intensity ?? (motorcycle ? 550 : 800),
    distance: motorcycle ? 58 : 68,
    angle: motorcycle ? 0.31 : 0.38,
  });
  return () => {
    vehicleLampSources.delete(owner);
    owner.userData.headlightOpacity = 0;
    mount.removeFromParent();
    geometry.dispose(); material.dispose();
  };
}
