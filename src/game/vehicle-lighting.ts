import * as THREE from 'three';
import { vehicleLampSources, type VehicleLampSource } from './vehicle-lamps';
import { createPoliceLighting } from './police-lighting';

function lowBeamTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const u = (x + 0.5) / 64, v = (y + 0.5) / 64;
    const cutoff = THREE.MathUtils.smoothstep(v, 0.46, 0.5);
    const lower = 1 - THREE.MathUtils.smoothstep(v, 0.72, 1);
    const edge = 1 - THREE.MathUtils.smoothstep(Math.abs(u - 0.5), 0.28, 0.5);
    const index = (y * 64 + x) * 4;
    pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = 255 * cutoff * lower * edge;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

export function createVehicleLighting(scene: THREE.Scene) {
  const policeLighting = createPoliceLighting(scene);
  const group = new THREE.Group();
  group.name = '车辆道路照明';
  scene.add(group);
  const beamTexture = lowBeamTexture();
  const slots = Array.from({ length: 2 }, () => {
    const light = new THREE.SpotLight('#fff2dc', 0, 65, 0.38, 0.65, 2);
    light.castShadow = false;
    light.map = beamTexture;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.updateProjectionMatrix();
    group.add(light, light.target);
    return { light, source: null as VehicleLampSource | null };
  });
  const cameraPosition = new THREE.Vector3(), target = new THREE.Vector3(), origin = new THREE.Vector3();
  const viewProjection = new THREE.Matrix4(), frustum = new THREE.Frustum(), beam = new THREE.Sphere();
  let previousTime: number | null = null;
  const place = (light: THREE.SpotLight, source: VehicleLampSource) => {
    source.mount.updateWorldMatrix(true, false);
    light.position.setFromMatrixPosition(source.mount.matrixWorld);
    light.target.position.copy(source.target).applyMatrix4(source.mount.matrixWorld);
    light.distance = source.distance;
    light.angle = source.angle;
  };
  return {
    update: (time: number, camera: THREE.Camera, focus: THREE.Vector3) => {
      const reset = previousTime === null || time < previousTime;
      const delta = reset ? 0.1 : THREE.MathUtils.clamp(time - previousTime!, 0, 0.1);
      previousTime = time;
      const blend = 1 - Math.exp(-delta * 12);
      camera.updateMatrixWorld();
      policeLighting.update(camera);
      cameraPosition.setFromMatrixPosition(camera.matrixWorld);
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      const candidates: { source: VehicleLampSource; score: number }[] = [];
      for (const source of vehicleLampSources.values()) {
        if (source.owner.parent !== scene || !source.owner.visible || source.owner.userData.headlightOpacity < 0.01) continue;
        source.mount.updateWorldMatrix(true, false);
        origin.setFromMatrixPosition(source.mount.matrixWorld);
        const distance = origin.distanceTo(cameraPosition);
        if (distance > 150) continue;
        target.copy(source.target).applyMatrix4(source.mount.matrixWorld);
        beam.center.copy(origin).lerp(target, 0.5);
        beam.radius = source.distance * 0.6;
        const player = source.owner.position.distanceToSquared(focus) < 0.01;
        if (!player && !frustum.intersectsSphere(beam)) continue;
        const retained = slots.some(slot => slot.source === source);
        candidates.push({ source, score: player ? -1 : distance * (retained ? 0.8 : 1) });
      }
      candidates.sort((a, b) => a.score - b.score);
      const selected = new Set(candidates.slice(0, slots.length).map(candidate => candidate.source));
      for (const slot of slots) {
        if (reset || slot.source && (slot.source.owner.parent !== scene || !vehicleLampSources.has(slot.source.owner))) {
          slot.source = null;
          slot.light.intensity = 0;
        }
        if (!slot.source) continue;
        place(slot.light, slot.source);
        const alpha = slot.source.owner.userData.headlightOpacity;
        const distance = slot.light.position.distanceTo(cameraPosition);
        const strength = selected.has(slot.source) ? slot.source.intensity * alpha * (1 - THREE.MathUtils.smoothstep(distance, 100, 150)) : 0;
        slot.light.intensity = THREE.MathUtils.lerp(slot.light.intensity, strength, blend);
        if (!selected.has(slot.source) && slot.light.intensity < 1) {
          slot.source = null;
          slot.light.intensity = 0;
        }
      }
      for (const { source } of candidates.slice(0, slots.length)) {
        if (slots.some(slot => slot.source === source)) continue;
        const slot = slots.find(slot => !slot.source);
        if (!slot) break;
        slot.source = source;
        place(slot.light, source);
        const distance = slot.light.position.distanceTo(cameraPosition);
        slot.light.intensity = source.intensity * source.owner.userData.headlightOpacity * (1 - THREE.MathUtils.smoothstep(distance, 100, 150)) * blend;
      }
    },
    dispose: () => {
      policeLighting.dispose();
      group.removeFromParent();
      for (const { light } of slots) light.dispose();
      beamTexture.dispose();
    }
  };
}
