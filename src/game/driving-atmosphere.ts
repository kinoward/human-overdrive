import * as THREE from 'three';

export function createDrivingAtmosphere(scene: THREE.Scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 1024;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 0, 1024);
  gradient.addColorStop(0, '#527fa6');
  gradient.addColorStop(0.25, '#87aec7');
  gradient.addColorStop(0.46, '#d4dedc');
  gradient.addColorStop(0.52, '#e0e0cf');
  gradient.addColorStop(1, '#929c91');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 2048, 1024);
  const pixels = context.getImageData(0, 0, 2048, 512);
  const hash = (x: number, y: number) => {
    const value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    return ((Math.imul(value ^ value >>> 13, 1274126177) ^ value >>> 16) >>> 0) / 4294967295;
  };
  const noise = (x: number, y: number, span: number) => {
    const sx = x / span, sy = y / span;
    const ix = Math.floor(sx), iy = Math.floor(sy);
    const fx = sx - ix, fy = sy - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u);
    const b = THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u);
    return THREE.MathUtils.lerp(a, b, v);
  };
  for (let y = 60; y < 470; y++) for (let x = 0; x < 2048; x++) {
    const longitude = Math.cos(x / 2048 * Math.PI * 2) * 300 + 400;
    const longitudeZ = Math.sin(x / 2048 * Math.PI * 2) * 300 + 400;
    const field = noise(longitude + y * 0.2, longitudeZ + y * 2, 96) * 0.65
      + noise(longitude + 70, longitudeZ + y * 3, 38) * 0.25
      + noise(longitude, longitudeZ + y * 5, 14) * 0.1;
    const fade = Math.min(1, (y - 60) / 100) * Math.min(1, (470 - y) / 90);
    const alpha = THREE.MathUtils.clamp((field - 0.51) * 3.2, 0, 0.65) * fade;
    const offset = (y * 2048 + x) * 4;
    for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] = THREE.MathUtils.lerp(pixels.data[offset + channel], 242 + channel * 2, alpha);
  }
  context.putImageData(pixels, 0, 0);
  const sky = new THREE.CanvasTexture(canvas);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
  scene.fog = new THREE.FogExp2('#d2dcd9', 0.00105);
  scene.environmentIntensity = 0.4;
  return sky;
}
