import * as THREE from 'three';

const lampNames = ['警车红灯', '警车蓝灯'];

export function addPoliceLampGlow(lamp: THREE.Mesh, index: number) {
  lamp.name = lampNames[index];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.12, '#ffffffbb');
  gradient.addColorStop(0.4, '#ffffff35');
  gradient.addColorStop(1, '#ffffff00');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const material = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas),
    color: index === 0 ? '#ff2920' : '#2475ff',
    transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(2.4, 1.5);
  const glow = new THREE.Group();
  glow.scale.set(1 / lamp.scale.x, 1 / lamp.scale.y, 1 / lamp.scale.z);
  lamp.add(glow);
  for (const angle of [0, Math.PI / 2]) {
    const halo = new THREE.Mesh(geometry, material);
    halo.rotation.y = angle;
    glow.add(halo);
  }
}

export function updatePoliceLamps(lamps: THREE.Mesh[], time: number) {
  for (let index = 0; index < lamps.length; index++) {
    const phase = ((time + index * 0.4) % 0.8 + 0.8) % 0.8;
    lamps[index].visible = phase < 0.09 || phase >= 0.15 && phase < 0.24;
  }
}

export function createPoliceLighting(scene: THREE.Scene) {
  const lights = Array.from({ length: 4 }, (_, index) => {
    const light = new THREE.PointLight(index % 2 === 0 ? '#ff2920' : '#2475ff', 0, 24, 2);
    light.name = '警灯环境照明';
    light.castShadow = false;
    scene.add(light);
    return light;
  });
  const position = new THREE.Vector3(), cameraPosition = new THREE.Vector3();
  return {
    update(camera: THREE.Camera) {
      camera.getWorldPosition(cameraPosition);
      const candidates: { lamps: THREE.Object3D[]; distance: number }[] = [];
      for (const root of scene.children) {
        if (!root.visible || !root.userData.policeLighting) continue;
        root.getWorldPosition(position);
        const distance = position.distanceTo(cameraPosition);
        if (distance > 110) continue;
        const lamps = lampNames.map(name => root.getObjectByName(name)!);
        if (!lamps.some(lamp => lamp.visible)) continue;
        candidates.push({ lamps, distance });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      for (let index = 0; index < lights.length; index++) {
        const source = candidates[Math.floor(index / 2)];
        const lamp = source?.lamps[index % 2];
        const light = lights[index];
        light.intensity = lamp?.visible ? 1100 * (1 - THREE.MathUtils.smoothstep(source.distance, 65, 110)) : 0;
        if (lamp) lamp.getWorldPosition(light.position);
      }
    },
    dispose() {
      for (const light of lights) { light.removeFromParent(); light.dispose() }
    },
  };
}
