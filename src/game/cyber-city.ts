import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoadPath } from '../types';
import { nearestRoad, sampleRoad } from './road-network';
import { createCyberSignage } from './cyber-signage';

export function createCyberCity(roads: RoadPath[], focus: THREE.Vector3, occupied: THREE.Box3[] = []) {
  const seed = 2749;
  let state = seed | 0;
  const random = () => { state = Math.imul(state, 1664525) + 1013904223 | 0; return (state >>> 0) / 4294967296; };
  const range = (a: number, b: number) => a + random() * (b - a);
  const group = new THREE.Group();
  group.name = '赛博朋克视觉街区';
  group.userData.cyberVisual = true;
  let content = new THREE.Group();
  let buildGroup = content;
  group.add(content);
  const neonLights = Array.from({ length: 2 }, () => {
    const light = new THREE.PointLight('#ffad66', 0, 43, 2);
    group.add(light);
    return light;
  });
  let neonSites: { color: string; position: THREE.Vector3 }[] = [];
  const updateNeonLights = (center: THREE.Vector3) => {
    neonSites.sort((a, b) => a.position.distanceToSquared(center) - b.position.distanceToSquared(center));
    neonLights.forEach((light, index) => {
      const site = neonSites[index];
      light.intensity = site ? 220 : 0;
      if (site) { light.color.set(site.color);light.position.copy(site.position) }
    });
  };
  const signage = createCyberSignage();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const textures: THREE.Texture[] = [];
  const matrix = new THREE.Matrix4();
  const frame = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3(1, 1, 1);
  const put = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    quaternion.setFromEuler(euler.set(rx, ry, rz));
    matrix.compose(new THREE.Vector3(x, y, z), quaternion, scale);
    geometry.applyMatrix4(matrix).applyMatrix4(frame);
    if (geometry.index) geometry = geometry.toNonIndexed();
    if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
    const list = buckets.get(material) ?? [];
    list.push(geometry);
    buckets.set(material, list);
  };
  const box = (material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0, facade = false) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    if (facade) {
      const uv = geometry.getAttribute('uv');
      const normal = geometry.getAttribute('normal');
      for (let i = 0; i < uv.count; i++) {
        const horizontal = Math.abs(normal.getX(i)) > 0.5 ? d / 19.2 : w / 19.2;
        const vertical = Math.abs(normal.getY(i)) > 0.5 ? d / 44.8 : h / 44.8;
        uv.setXY(i, uv.getX(i) * horizontal, uv.getY(i) * vertical);
      }
    }
    put(geometry, material, x, y, z, 0, ry);
  };
  const cylinder = (material: THREE.Material, x: number, y: number, z: number, radius: number, height: number, rz = 0, rx = 0) => put(new THREE.CylinderGeometry(radius, radius, height, 8), material, x, y, z, rx, 0, rz);
  const standard = (color: string, roughness = 0.75, metalness = 0.15) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const concrete = standard('#617078', 0.88, 0.08);
  const darkConcrete = standard('#39484e', 0.88, 0.06);
  const metal = standard('#536770', 0.42, 0.75);
  const darkMetal = standard('#1a2c33', 0.5, 0.68);
  const trim = standard('#99a6a3', 0.58, 0.45);
  const rust = standard('#77514a', 0.8, 0.4);
  const makeInterior = (variant: number) => {
    const savedState = state;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const lightCanvas = document.createElement('canvas'); lightCanvas.width = lightCanvas.height = 512;
    const lit = lightCanvas.getContext('2d')!;
    const roughCanvas = document.createElement('canvas'); roughCanvas.width = roughCanvas.height = 512;
    const rough = roughCanvas.getContext('2d')!;
    const warm = variant === 0;
    const closed = variant === 2;
    ctx.fillStyle = '#081317'; ctx.fillRect(0, 0, 512, 512);
    lit.fillStyle = '#000'; lit.fillRect(0, 0, 512, 512);
    rough.fillStyle = '#636363'; rough.fillRect(0, 0, 512, 512);
    if (!closed) {
      const back = ctx.createLinearGradient(0, 80, 0, 400);
      back.addColorStop(0, warm ? '#42352c' : '#183038'); back.addColorStop(1, '#10191c');
      ctx.fillStyle = back; ctx.fillRect(97, 74, 320, 320);
      ctx.fillStyle = '#0c1c22';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(97, 74); ctx.lineTo(97, 394); ctx.lineTo(0, 512); ctx.fill();
      ctx.fillStyle = warm ? '#1d2423' : '#15282e';
      ctx.beginPath(); ctx.moveTo(512, 0); ctx.lineTo(417, 74); ctx.lineTo(417, 394); ctx.lineTo(512, 512); ctx.fill();
      ctx.fillStyle = '#142328';
      ctx.beginPath(); ctx.moveTo(0, 512); ctx.lineTo(97, 394); ctx.lineTo(417, 394); ctx.lineTo(512, 512); ctx.fill();
      ctx.strokeStyle = 'rgba(85,106,105,0.4)'; ctx.lineWidth = 2;
      for (let x = 0; x < 600; x += 110) { ctx.beginPath(); ctx.moveTo(x, 512); ctx.lineTo(257 + (x - 257) * 0.55, 394); ctx.stroke(); }
      for (const y of [421, 459, 509]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
      const light = ctx.createRadialGradient(240, 132, 4, 240, 132, 180);
      light.addColorStop(0, warm ? 'rgba(171,115,65,0.5)' : 'rgba(57,132,138,0.4)'); light.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = light; ctx.fillRect(80, 70, 340, 320);
      lit.fillStyle = warm ? '#876247' : '#3d6c70'; lit.fillRect(115, 80, 195, 105);
      lit.fillStyle = warm ? '#b28c64' : '#7aa7a4'; lit.fillRect(145, 88, 140, 5);
      ctx.fillStyle = warm ? '#a98d67' : '#82a4a7'; ctx.fillRect(145, 88, 140, 5);
      for (let shelf = 0; shelf < 4; shelf++) {
        const y = 181 + shelf * 48;
        ctx.fillStyle = '#0a171a'; ctx.fillRect(112, y + 32, 190, 7);
        ctx.fillStyle = '#58615b'; ctx.fillRect(112, y + 31, 190, 2);
        for (let item = 0; item < 11; item++) {
          const x = 118 + item * 16;
          const height = 12 + random() * 17;
          ctx.fillStyle = ['#4c5550', '#655342', '#344f51', '#68594d', '#39464a'][(item + shelf + variant) % 5];
          ctx.fillRect(x, y + 31 - height, 8 + random() * 5, height);
          ctx.fillStyle = '#8d8066'; ctx.fillRect(x + 2, y + 25 - height, 5, 4);
          if ((item + shelf) % 4 === 0) { lit.fillStyle = warm ? '#51402d' : '#1e4448'; lit.fillRect(x, y + 31 - height, 9, height); }
        }
      }
      ctx.fillStyle = '#0d191d'; ctx.fillRect(328, 116, 72, 128);
      ctx.strokeStyle = '#727d70'; ctx.lineWidth = 2; ctx.strokeRect(328, 116, 72, 128);
      ctx.fillStyle = warm ? '#ae9a6b' : '#71a6a8'; ctx.font = '500 15px "Overdrive Scene", "PingFang SC", sans-serif';
      ctx.fillText(warm ? '深夜茶事' : '维护中', 334, 142);
      for (let row = 0; row < 6; row++) {
        ctx.fillStyle = warm ? '#78715c' : '#467176'; ctx.fillRect(336, 159 + row * 12, 40 - row % 3 * 8, 2);
        lit.fillStyle = warm ? '#746345' : '#3f7377'; lit.fillRect(336, 159 + row * 12, 40 - row % 3 * 8, 2);
      }
      ctx.fillStyle = '#292c26'; ctx.fillRect(76, 354, 352, 44);
      ctx.fillStyle = '#7b6a51'; ctx.fillRect(76, 350, 352, 8);
      for (const x of [144, 337]) { ctx.fillStyle = '#273d3e'; ctx.fillRect(x, 320, 18, 29); ctx.fillStyle = '#a3967c'; ctx.fillRect(x + 2, 316, 14, 6); }
      lit.fillStyle = warm ? '#7b5638' : '#305256'; lit.fillRect(96, 350, 292, 5);
      ctx.fillStyle = '#091517'; ctx.fillRect(0, 0, 512, 41); ctx.fillRect(0, 475, 512, 37);
      for (const x of [14, 252, 490]) { ctx.fillStyle = '#2a3a3e'; ctx.fillRect(x, 38, 8, 440); lit.fillStyle = '#000'; lit.fillRect(x - 1, 38, 10, 440); }
    } else {
      ctx.fillStyle = '#25353a'; ctx.fillRect(5, 30, 502, 462);
      for (let y = 35; y < 490; y += 11) { ctx.fillStyle = y % 22 === 13 ? '#1a2b30' : '#38474a'; ctx.fillRect(5, y, 502, 2); rough.fillStyle = '#b0b0b0'; rough.fillRect(5, y, 502, 2); }
      ctx.fillStyle = '#405256'; ctx.fillRect(249, 345, 17, 7);
      ctx.fillStyle = '#ad7253'; ctx.fillRect(365, 282, 52, 87);
      ctx.fillStyle = '#302e28'; ctx.font = '600 10px "Overdrive Scene", "PingFang SC", sans-serif'; ctx.fillText('暂停营业', 370, 313); ctx.fillText('请走侧门', 370, 335);
    }
    ctx.strokeStyle = 'rgba(106,149,157,0.17)'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(44, 0); ctx.lineTo(174, 512); ctx.stroke();
    for (let i = 0; i < 1000; i++) {
      const x = random() * 512, y = random() * 512;
      ctx.fillStyle = 'rgba(7,17,18,0.18)'; ctx.fillRect(x, y, 1 + random() * 2, 8 + random() * 44);
      rough.fillStyle = 'rgba(190,190,190,0.17)'; rough.fillRect(x, y, 1 + random() * 3, 4 + random() * 35);
    }
    const maps = [canvas, lightCanvas, roughCanvas].map((source, i) => {
      const texture = new THREE.CanvasTexture(source); texture.anisotropy = 8;
      if (i < 2) texture.colorSpace = THREE.SRGBColorSpace;
      textures.push(texture); return texture;
    });
    state = savedState;
    return new THREE.MeshStandardMaterial({ map: maps[0], emissiveMap: maps[1], emissive: '#ffffff', emissiveIntensity: closed ? 0 : 0.83, roughnessMap: maps[2], roughness: 0.72, metalness: closed ? 0.55 : 0.2 });
  };
  const interiors = [makeInterior(0), makeInterior(1), makeInterior(2)];
  const weathered = (material: THREE.MeshStandardMaterial, panel: boolean) => {
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 cityPosition; varying vec3 cityNormal;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncityPosition = (modelMatrix * vec4(position, 1.0)).xyz; cityNormal = mat3(modelMatrix) * normal;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 cityPosition; varying vec3 cityNormal; float cityHash(vec2 p) {return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);} float cityNoise(vec2 p) {vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(cityHash(i),cityHash(i+vec2(1.,0.)),f.x),mix(cityHash(i+vec2(0.,1.)),cityHash(i+vec2(1.,1.)),f.x),f.y);}');
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float cityAxis = abs(cityNormal.x) > 0.5 ? cityPosition.z : cityPosition.x;
float cityStreak = cityNoise(vec2(cityAxis * 3.1, cityPosition.y * 0.08));
float cityPatch = cityNoise(vec2(cityAxis * 0.45, cityPosition.y * 0.4));
diffuseColor.rgb *= (0.72 + 0.3 * cityPatch) * (0.86 + cityStreak * 0.14);
${panel ? 'float citySeamX = min(mod(cityAxis+1000.,3.6),3.6-mod(cityAxis+1000.,3.6)); float citySeamY = min(mod(cityPosition.y+1000.,1.8),1.8-mod(cityPosition.y+1000.,1.8)); diffuseColor.rgb *= mix(0.47, 1.0, smoothstep(0.012,0.038,min(citySeamX,citySeamY)));' : ''}`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (cityPatch - 0.4) * 0.23, 0.34, 1.0);');
    };
    material.customProgramCacheKey = () => panel ? 'city-panels-weathered' : 'city-metal-weathered';
  };
  weathered(concrete, true); weathered(darkConcrete, true); weathered(metal, false); weathered(darkMetal, false);
  const cyan = new THREE.MeshStandardMaterial({ color: '#73c3cd', emissive: '#49b9cf', emissiveIntensity: 3.4, roughness: 0.35 });
  const amber = new THREE.MeshStandardMaterial({ color: '#ffcb9f', emissive: '#ffb85c', emissiveIntensity: 2.8, roughness: 0.35 });
  const red = new THREE.MeshStandardMaterial({ color: '#bd4e36', emissive: '#e65235', emissiveIntensity: 2.2, roughness: 0.4 });
  const makeFacade = (variant: number) => {
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = 512; colorCanvas.height = 1024;
    const colorContext = colorCanvas.getContext('2d')!;
    const lightCanvas = document.createElement('canvas');
    lightCanvas.width = 512; lightCanvas.height = 1024;
    const lightContext = lightCanvas.getContext('2d')!;
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 512; bumpCanvas.height = 1024;
    const bumpContext = bumpCanvas.getContext('2d')!;
    const roughCanvas = document.createElement('canvas'); roughCanvas.width = 512; roughCanvas.height = 1024;
    const roughContext = roughCanvas.getContext('2d')!; roughContext.fillStyle = '#d0d0d0'; roughContext.fillRect(0, 0, 512, 1024);
    colorContext.fillStyle = ['#536169', '#5a6467', '#464f57'][variant];
    colorContext.fillRect(0, 0, 512, 1024);
    lightContext.fillStyle = '#000'; lightContext.fillRect(0, 0, 512, 1024);
    bumpContext.fillStyle = '#999'; bumpContext.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 10000; i++) {
      colorContext.fillStyle = random() > 0.5 ? 'rgba(190,200,198,0.08)' : 'rgba(0,10,15,0.09)';
      colorContext.fillRect(random() * 512, random() * 1024, range(1, 3), range(2, 8));
    }
    for (let row = 0; row < 16; row++) {
      const y = row * 64;
      colorContext.fillStyle = '#263a40'; colorContext.fillRect(0, y, 512, variant === 2 ? 11 : 6);
      bumpContext.fillStyle = '#555'; bumpContext.fillRect(0, y, 512, 5);
      for (let column = 0; column < 8; column++) {
        const x = column * 64;
        const bright = random() < (variant === 1 ? 0.27 : 0.18);
        const shade = random();
        colorContext.fillStyle = '#5e7072'; colorContext.fillRect(x + 6, y + 13, 52, 43);
        roughContext.fillStyle = '#535353'; roughContext.fillRect(x + 9, y + 16, 46, 37);
        colorContext.fillStyle = 'rgba(8,21,26,0.28)'; colorContext.fillRect(x + 1, y + 3, 2, 61);
        colorContext.fillStyle = 'rgba(133,151,148,0.16)'; colorContext.fillRect(x + 4, y + 4, 58, 2);
        colorContext.fillStyle = bright ? '#394b50' : '#142d36';
        colorContext.fillRect(x + 9, y + 16, 46, 37);
        colorContext.fillStyle = 'rgba(121,154,160,0.25)'; colorContext.fillRect(x + 11, y + 18, 43, 3);
        colorContext.fillStyle = '#263a41'; colorContext.fillRect(x + 31, y + 16, 3, 37);
        bumpContext.fillStyle = '#404040'; bumpContext.fillRect(x + 9, y + 16, 46, 37);
        bumpContext.fillStyle = '#c4c4c4'; bumpContext.fillRect(x + 6, y + 53, 52, 3);
        if (bright) {
          lightContext.fillStyle = shade < 0.18 ? '#579399' : shade > 0.73 ? '#8b7e60' : '#b49a70';
          lightContext.fillRect(x + 10, y + 17, 44, 35);
          lightContext.fillStyle = '#0c1619'; lightContext.fillRect(x + 31, y + 17, 3, 35);
          if (random() > 0.6) { lightContext.fillStyle = '#373325'; lightContext.fillRect(x + 10, y + 17, 44, range(10, 24)); }
          if (random() > 0.6) { lightContext.fillStyle = '#111c1e'; lightContext.fillRect(x + 17, y + 36, 9, 16); }
        }
      }
    }
    const savedFacadeState = state;
    for (let mark = 0; mark < 110; mark++) {
      const x = random() * 512, y = random() * 1024;
      const width = range(2, 12), height = range(25, 160);
      const streak = colorContext.createLinearGradient(0, y, 0, y + height);
      streak.addColorStop(0, 'rgba(3,18,23,0.22)'); streak.addColorStop(1, 'rgba(3,18,23,0)');
      colorContext.fillStyle = streak; colorContext.fillRect(x, y, width, height);
      roughContext.fillStyle = 'rgba(190,190,190,0.3)'; roughContext.fillRect(x, y, width, height * 0.8);
    }
    state = savedFacadeState;
    const maps = [colorCanvas, lightCanvas, bumpCanvas, roughCanvas].map((canvas, i) => {
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      if (i < 2) texture.colorSpace = THREE.SRGBColorSpace;
      textures.push(texture);
      return texture;
    });
    return new THREE.MeshStandardMaterial({ map: maps[0], emissiveMap: maps[1], emissive: '#ffffff', emissiveIntensity: 1.18, bumpMap: maps[2], bumpScale: 0.13, roughnessMap: maps[3], roughness: variant === 2 ? 0.78 : 0.94, metalness: variant === 2 ? 0.48 : 0.15 });
  };
  const facades = [makeFacade(0), makeFacade(1), makeFacade(2)];
  const sign = (text: string, caption: string, color: string, x: number, y: number, z: number, width: number, height: number, vertical = false, angle = 0) => {
    const mesh = signage.sign(text, caption, color, width, height, vertical);
    mesh.position.set(x, y, z); mesh.rotation.y = angle;
    mesh.applyMatrix4(frame);
    buildGroup.add(mesh);
    box(darkMetal, x, y, z - 0.15, width + 0.32, height + 0.32, 0.26, angle);
    return mesh;
  };
  const animatedSigns: THREE.Mesh[] = [];
  const building = (side: number, edge: number, width: number, depth: number, height: number, index: number) => {
    const z = 0;
    const x = side * (edge + width / 2);
    const podiumHeight = range(7, 10.2);
    const facade = facades[index % facades.length];
    box(darkConcrete, x, podiumHeight / 2, z, width + 0.2, podiumHeight, depth);
    box(facade, x + side * 0.6, (height + podiumHeight) / 2, z, width - 1, height - podiumHeight, depth - 1, 0, true);
    box(concrete, x + side * 0.6, height + 0.45, z, width - 0.3, 0.9, depth - 0.3);
    box(metal, side * (edge + 0.15), podiumHeight + 0.3, z, 0.3, 0.55, depth + 0.7);
    box(darkMetal, x, podiumHeight - 0.7, z, width + 0.9, 0.6, depth + 0.8);
    const roofH = range(3, 9);
    box(facade, x + side * 2.0, height + roofH / 2 + 0.9, z + 0.8, width * 0.62, roofH, depth * 0.68, 0, true);
    box(darkMetal, x + side * 2.0, height + roofH + 1.2, z + 0.8, width * 0.68, 0.6, depth * 0.74);
    for (let band = 0; band < Math.floor((height - podiumHeight) / 15); band++) {
      const y = podiumHeight + 12 + band * 15;
      box(darkConcrete, side * (edge - 0.1), y, z, 0.65, 0.8, depth + 0.5);
      for (let panel = 0; panel < 4; panel++) {
        box(metal, side * (edge - 0.47), y + 0.15, z - depth / 2 + 2 + panel * (depth - 4) / 3, 0.16, 0.22, 2.5);
      }
    }
    for (const end of [-1, 1]) {
      box(facade, x, (height + podiumHeight) / 2, z + end * (depth / 2 - 0.4), width - 0.3, height - podiumHeight, 0.5, 0, true);
      box(trim, side * (edge + 0.2), height / 2 + podiumHeight / 2, z + end * (depth / 2 - 1), 0.42, height - podiumHeight, 0.5);
    }
    const shopCount = Math.max(2, Math.floor(depth / 5));
    for (let j = 0; j < shopCount; j++) {
      const shopZ = z - depth / 2 + (j + 0.5) * depth / shopCount;
      const shopD = depth / shopCount - 0.35;
      box(interiors[(index + j) % 5 === 0 ? 0 : (index + j) % 5 === 1 ? 1 : 2], side * (edge - 0.11), 2.6, shopZ, 0.14, 3.8, shopD);
      box(metal, side * (edge - 0.3), 0.7, shopZ, 0.3, 0.3, shopD);
      box(metal, side * (edge - 0.3), 4.57, shopZ, 0.35, 0.2, shopD);
      for (const split of [-1, 0, 1]) box(darkMetal, side * (edge - 0.26), 2.6, shopZ + split * shopD * 0.47, 0.25, 4.1, 0.12);
      box(darkMetal, side * (edge - 0.7), 4.9, shopZ, 1.8, 0.22, shopD + 0.2);
      if (j % 2 === 0) box(index % 3 === 0 ? cyan : amber, side * (edge - 1.27), 4.72, shopZ, 0.055, 0.065, shopD * 0.76);
      if (j % 2 === 1) {
        box(metal, side * (edge - 0.66), 6.4, shopZ, 1, 1, 1.8);
        for (let l = 0; l < 5; l++) box(darkMetal, side * (edge - 1.18), 6.03 + l * 0.16, shopZ, 0.06, 0.07, 1.55);
      }
    }
    if (index % 2 === 0) {
      const pipeZ = z + depth / 2 - 2;
      cylinder(metal, side * (edge - 0.5), height * 0.44, pipeZ, 0.16, height * 0.75);
      cylinder(rust, side * (edge - 0.85), 9, pipeZ - 0.5, 0.13, 16);
      for (let p = 0; p < 4; p++) box(darkMetal, side * (edge - 0.5), 5 + p * height * 0.17, pipeZ, 0.6, 0.2, 0.7);
    }
    if (index % 3 === 0) {
      box(darkMetal, side * (edge - 0.65), height * 0.52, z - 1, 1.1, 1.6, depth * 0.5);
      for (let rail = 0; rail < 4; rail++) box(trim, side * (edge - 1.2), height * 0.52 + 0.95, z - depth * 0.2 + rail * depth * 0.14, 0.09, 1.25, 0.09);
      box(metal, side * (edge - 1.2), height * 0.52 + 1.55, z - 1, 0.1, 0.1, depth * 0.5);
    }
    const roofY = height + roofH + 2;
    cylinder(metal, x, roofY + 2.3, z, 0.8, 4.5);
    box(darkMetal, x + side * 3, roofY, z + 2, 2.9, 1.9, 3.3);
    for (let p = 0; p < 5; p++) box(trim, x + side * 3, roofY + 0.98, z + 0.7 + p * 0.65, 2.55, 0.07, 0.14);
    if (index % 4 === 0) {
      cylinder(metal, x, roofY + 6.5, z, 0.07, 13);
      box(red, x, roofY + 13.1, z, 0.18, 0.18, 0.18);
    }
  };
  interface RoadSegment { ax: number; az: number; bx: number; bz: number; radius: number }
  interface Footprint { x: number; z: number; rightX: number; rightZ: number; backX: number; backZ: number; halfWidth: number; halfDepth: number }
  const cells = new Map<string, RoadSegment[]>();
  for (const road of roads) {
    const radius = road.width / 2 + 3.3;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      const segment = { ax: a.x, az: a.z, bx: b.x, bz: b.z, radius };
      for (let x = Math.floor((Math.min(a.x, b.x) - radius) / 128); x <= Math.floor((Math.max(a.x, b.x) + radius) / 128); x++) {
        for (let z = Math.floor((Math.min(a.z, b.z) - radius) / 128); z <= Math.floor((Math.max(a.z, b.z) + radius) / 128); z++) {
          const key = `${x},${z}`;
          const list = cells.get(key) ?? []; list.push(segment); cells.set(key, list);
        }
      }
    }
  }
  const footprints: Footprint[] = [];
  const existingFootprints: Footprint[] = occupied.map(bounds => ({ x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2, rightX: 1, rightZ: 0, backX: 0, backZ: 1, halfWidth: (bounds.max.x - bounds.min.x) / 2, halfDepth: (bounds.max.z - bounds.min.z) / 2 }));
  const overlaps = (a: Footprint, b: Footprint) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    for (const [axisX, axisZ] of [[a.rightX, a.rightZ], [a.backX, a.backZ], [b.rightX, b.rightZ], [b.backX, b.backZ]]) {
      const separation = Math.abs(dx * axisX + dz * axisZ);
      const radiusA = a.halfWidth * Math.abs(a.rightX * axisX + a.rightZ * axisZ) + a.halfDepth * Math.abs(a.backX * axisX + a.backZ * axisZ);
      const radiusB = b.halfWidth * Math.abs(b.rightX * axisX + b.rightZ * axisZ) + b.halfDepth * Math.abs(b.backX * axisX + b.backZ * axisZ);
      if (separation > radiusA + radiusB + 1) return false;
    }
    return true;
  };
  const existingCells = new Map<string, Footprint[]>();
  for (const foot of existingFootprints) {
    for (let x = Math.floor((foot.x - foot.halfWidth) / 128); x <= Math.floor((foot.x + foot.halfWidth) / 128); x++) {
      for (let z = Math.floor((foot.z - foot.halfDepth) / 128); z <= Math.floor((foot.z + foot.halfDepth) / 128); z++) {
        const key = `${x},${z}`, list = existingCells.get(key) ?? []; list.push(foot); existingCells.set(key, list);
      }
    }
  }
  const intersectsExisting = (foot: Footprint) => {
    const extentX = Math.abs(foot.rightX) * foot.halfWidth + Math.abs(foot.backX) * foot.halfDepth + 1;
    const extentZ = Math.abs(foot.rightZ) * foot.halfWidth + Math.abs(foot.backZ) * foot.halfDepth + 1;
    const candidates = new Set<Footprint>();
    for (let x = Math.floor((foot.x - extentX) / 128); x <= Math.floor((foot.x + extentX) / 128); x++) {
      for (let z = Math.floor((foot.z - extentZ) / 128); z <= Math.floor((foot.z + extentZ) / 128); z++) for (const existing of existingCells.get(`${x},${z}`) ?? []) candidates.add(existing);
    }
    for (const existing of candidates) if (overlaps(foot, existing)) return true;
    return false;
  };
  const intersectsRoad = (foot: Footprint) => {
    const extentX = Math.abs(foot.rightX) * foot.halfWidth + Math.abs(foot.backX) * foot.halfDepth;
    const extentZ = Math.abs(foot.rightZ) * foot.halfWidth + Math.abs(foot.backZ) * foot.halfDepth;
    const segments = new Set<RoadSegment>();
    for (let x = Math.floor((foot.x - extentX) / 128); x <= Math.floor((foot.x + extentX) / 128); x++) {
      for (let z = Math.floor((foot.z - extentZ) / 128); z <= Math.floor((foot.z + extentZ) / 128); z++) for (const segment of cells.get(`${x},${z}`) ?? []) segments.add(segment);
    }
    for (const segment of segments) {
      const aX = (segment.ax - foot.x) * foot.rightX + (segment.az - foot.z) * foot.rightZ;
      const aZ = (segment.ax - foot.x) * foot.backX + (segment.az - foot.z) * foot.backZ;
      const bX = (segment.bx - foot.x) * foot.rightX + (segment.bz - foot.z) * foot.rightZ;
      const bZ = (segment.bx - foot.x) * foot.backX + (segment.bz - foot.z) * foot.backZ;
      const ex = foot.halfWidth + segment.radius, ez = foot.halfDepth + segment.radius;
      if (Math.min(aX, bX) > ex || Math.max(aX, bX) < -ex || Math.min(aZ, bZ) > ez || Math.max(aZ, bZ) < -ez) continue;
      let enter = 0, leave = 1;
      let hit = true;
      for (const [a, b, extent] of [[aX, bX, ex], [aZ, bZ, ez]]) {
        const delta = b - a;
        if (Math.abs(delta) < 0.0001) { if (Math.abs(a) > extent) hit = false; continue; }
        const t1 = (-extent - a) / delta, t2 = (extent - a) / delta;
        enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2));
        if (enter > leave) { hit = false; break; }
      }
      if (hit) return true;
    }
    return false;
  };
  const place = (road: RoadPath, distance: number, side: number, width: number, depth: number, nearEdge: number) => {
    const sample = sampleRoad(road, distance);
    const angle = sample.heading + Math.PI;
    const rightX = Math.cos(angle), rightZ = -Math.sin(angle), backX = Math.sin(angle), backZ = Math.cos(angle);
    for (let edge = nearEdge; edge < nearEdge + 89; edge += 8) {
      const center = side * (edge + width / 2);
      const foot = { x: sample.point.x + rightX * center, z: sample.point.z + rightZ * center, rightX, rightZ, backX, backZ, halfWidth: width / 2 + 3.4, halfDepth: depth / 2 + 1.5 };
      if (intersectsRoad(foot) || intersectsExisting(foot) || footprints.some(existing => overlaps(foot, existing))) continue;
      footprints.push(foot);
      frame.makeRotationY(angle); frame.setPosition(sample.point.x, 0, sample.point.z);
      return { edge, angle, point: sample.point, foot };
    }
    return null;
  };
  const lastFocus = new THREE.Vector3(Infinity, Infinity, Infinity);
  const materials = new Set<THREE.Material>([concrete, darkConcrete, metal, darkMetal, trim, rust, cyan, amber, red, ...interiors, ...facades]);
  const clearGeometry = (target: THREE.Group) => {
    target.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    target.clear();
  };
  function* rebuild(center: THREE.Vector3): Generator<void> {
    const near = nearestRoad(roads, center.x, center.z, center.y);
    if (!near) return;
    buildGroup = new THREE.Group();
    const lightSites: { color: string; position: THREE.Vector3 }[] = [];
    footprints.length = 0; animatedSigns.length = 0;
    const connected = new Set(near.road.junctions.map(junction => junction.roadId));
    const windows: { road: RoadPath; start: number; end: number; priority: number; distance: number }[] = [];
    for (const road of roads) {
      yield;
      let start = Infinity, end = -Infinity, best = Infinity;
      for (let i = 0; i < road.points.length; i++) {
        const point = road.points[i];
        const distance = Math.hypot(point.x - center.x, point.z - center.z);
        if (distance < best) best = distance;
        if (distance <= 1110) { start = Math.min(start, road.cumulative[i]); end = Math.max(end, road.cumulative[i]); }
      }
      if (!Number.isFinite(start) || road.length < 20) continue;
      windows.push({ road, start: Math.max(0, start - 12), end: Math.min(road.length, end + 12), priority: road === near.road ? 0 : connected.has(road.id) ? 1 : road.kind === 'ramp' ? 3 : 2, distance: best });
    }
    windows.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
    const signCounts = new Map<number, number>([[-1, 0], [1, 0]]);
    const lastSignDistances = new Map<number, number>();
    let detailedBuildings = 0, distantBuildings = 0, foregroundBuildings = 0, backgroundTowers = 0;
    const roadHash = (road: RoadPath) => { let hash = seed; for (const letter of road.id) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619); return hash; };
    for (const window of windows) {
      if (foregroundBuildings >= 80) break;
      const hash = roadHash(window.road);
      for (const side of [-1, 1]) {
        for (let slot = Math.ceil(window.start / 38); slot * 38 <= window.end; slot++) {
          yield;
          if (foregroundBuildings >= 80) break;
          state = (hash ^ Math.imul(slot, 73856093) ^ Math.imul(side, 19349663)) | 0;
          const distance = slot * 38;
          const sample = sampleRoad(window.road, distance);
          const radial = Math.hypot(sample.point.x - center.x, sample.point.z - center.z);
          if (radial > 1080) continue;
          const width = range(12, 20), depth = range(21, 28), height = range(43, 96);
          const placement = place(window.road, distance, side, width, depth, Math.max(23, window.road.width / 2 + 15));
          if (!placement) continue;
          const { edge } = placement;
          const x = side * (edge + width / 2);
          const index = Math.abs(slot + hash + (side < 0 ? 0 : 2));
          if (radial < 300 && detailedBuildings < 24) {
            building(side, edge, width, depth, height, index); detailedBuildings++;
          } else {
            box(facades[index % 3], x, height / 2, 0, width, height, depth, 0, true);
            box(darkConcrete, x, 4.1, 0, width + 0.8, 8.2, depth + 0.8);
            box(darkMetal, x, height + 0.6, 0, width + 0.6, 1.2, depth + 0.6);
            box(facades[index % 3], x + side * 2, height + 4, 1, width * 0.57, 7, depth * 0.62, 0, true); distantBuildings++;
          }
          foregroundBuildings++;
          const dx = sample.point.x - center.x, dz = sample.point.z - center.z;
          const ahead = dx * near.direction.x + dz * near.direction.z;
          const across = (placement.foot.x - center.x) * near.direction.z - (placement.foot.z - center.z) * near.direction.x;
          const viewSide = across > 0 ? -1 : 1;
          const signCount = signCounts.get(viewSide)!;
          const aligned = sample.direction.x * near.direction.x + sample.direction.z * near.direction.z > 0.5;
          const firstSign = aligned && signCount === 0 && ahead >= 120 && ahead <= 220;
          const secondSign = aligned && signCount === 1 && ahead >= 280 && ahead <= 400 && ahead - lastSignDistances.get(viewSide)! > 120;
          if (firstSign || secondSign) {
            const title = firstSign ? viewSide < 0 ? '眠港旅社' : '云间' : viewSide < 0 ? '星际通讯' : '九号档案';
            const caption = firstSign ? viewSide < 0 ? '夜行者驿站' : '二十四小时' : viewSide < 0 ? '全城接入' : '记忆修复';
            const color = firstSign ? viewSide < 0 ? '#ffb76b' : '#86dce2' : viewSide < 0 ? '#68b8c2' : '#ffba7c';
            const signY = Math.min(height - 9, firstSign ? 26 : 32);
            const mesh = sign(title, caption, color, side * (edge - 1), signY, depth / 2 + 0.3, firstSign ? 3.3 : 3.8, firstSign ? 12.8 : 14.8, true);
            animatedSigns.push(mesh);
            for (const y of [signY - 4.5, signY + 4.5]) box(darkMetal, side * (edge + 0.1), y, depth / 2 + 0.05, 2.8, 0.17, 0.22);
            if (firstSign) {
              sign(viewSide < 0 ? '南站茶室' : '义体修复', viewSide < 0 ? '夜雨 · 茶 · 旧唱片' : '精密维护 / 夜间营业', viewSide < 0 ? '#efc395' : '#87cbd2', side * (edge - 0.32), 6.2, 0, 8, 2.4, false, side < 0 ? Math.PI / 2 : -Math.PI / 2);
              lightSites.push({ color: viewSide < 0 ? '#ffad66' : '#50b7ce', position: new THREE.Vector3(side * (edge - 1.5), 9.5, depth / 2 + 1).applyMatrix4(frame) });
              if (viewSide > 0) {
                const poster = signage.poster(8.8, 15.5);
                poster.position.set(x, Math.min(height - 10, signY + 11), depth / 2 + 0.42); poster.applyMatrix4(frame); buildGroup.add(poster);
                box(darkMetal, x, Math.min(height - 10, signY + 11), depth / 2 + 0.15, 9.3, 16, 0.35);
                box(amber, x, Math.min(height - 10, signY + 11) + 8.1, depth / 2 + 0.5, 8.5, 0.055, 0.07);
              }
            }
            signCounts.set(viewSide, signCount + 1); lastSignDistances.set(viewSide, ahead);
          }
        }
      }
    }
    for (const window of windows) {
      if (backgroundTowers >= 20) break;
      if (window.road.kind === 'ramp') continue;
      const hash = roadHash(window.road);
      for (const side of [-1, 1]) {
        for (let slot = Math.ceil(window.start / 83); slot * 83 <= window.end; slot++) {
          yield;
          if (backgroundTowers >= 20) break;
          state = (hash ^ Math.imul(slot, 83492791) ^ Math.imul(side, 2971215073)) | 0;
          const width = range(20, 32), depth = range(22, 35), height = range(95, 181);
          const placement = place(window.road, slot * 83, side, width, depth, range(75, 110));
          if (!placement) continue;
          const x = side * (placement.edge + width / 2), index = Math.abs(slot + hash);
          box(facades[index % 3], x, height / 2, 0, width, height, depth, 0, true);
          box(darkMetal, x, height + 0.75, 0, width + 0.7, 1.5, depth + 0.7);
          box(facades[(index + 1) % 3], x + side * 2, height + 6, 0, width * 0.61, 11, depth * 0.65, 0, true);
          cylinder(darkMetal, x, height + 19, 0, 0.12, 25);
          box(red, x, height + 31.7, 0, 0.4, 0.35, 0.4); distantBuildings++; backgroundTowers++;
        }
      }
    }
    frame.identity();
    for (const [material, geometries] of buckets) {
      yield;
      const merged = mergeGeometries(geometries, false)!;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = material !== cyan && material !== amber && material !== red;
      mesh.receiveShadow = true; buildGroup.add(mesh);
      geometries.forEach(geometry => geometry.dispose());
      buckets.delete(material);
    }
    buckets.clear();
    buildGroup.traverse(object => { object.userData.cyberVisual = true; });
    clearGeometry(content);content.removeFromParent();
    content = buildGroup;group.add(content);
    neonSites = lightSites;
    updateNeonLights(center);
    group.userData.detailedBuildings = detailedBuildings;
    group.userData.distantBuildings = distantBuildings;
    group.userData.focusRoadId = near.road.id;
    group.userData.backgroundTowers = backgroundTowers;
    lastFocus.copy(center);
  }
  let pending: Generator<void> | undefined;
  const update = (center: THREE.Vector3) => {
    updateNeonLights(center);
    if (!pending && Math.hypot(center.x - lastFocus.x, center.z - lastFocus.z) >= 280) pending = rebuild(center.clone());
    if (!pending) return false;
    const deadline = performance.now() + 1.5;
    do {
      if (pending.next().done) { pending = undefined; return true }
    } while (performance.now() < deadline);
    return false;
  };
  const dispose = () => {
    pending?.return(undefined);pending = undefined;
    clearGeometry(content);
    if (buildGroup !== content) clearGeometry(buildGroup);
    for (const geometries of buckets.values()) geometries.forEach(geometry => geometry.dispose());
    buckets.clear();
    materials.forEach(material => material.dispose());
    new Set(textures).forEach(texture => texture.dispose());
    signage.dispose(); group.removeFromParent();
  };
  for (const _ of rebuild(focus)) {}
  return { group, update, dispose };
}
