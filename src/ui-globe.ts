import * as THREE from 'three';
import type { CityConfig } from './types';
import { globeMaterials } from './ui-globe-material';

const minimumDistance = 3.45;

const locations: Record<string, readonly [number, number]> = {
  beijing: [39.9042, 116.4074],
  shanghai: [31.2304, 121.4737],
  chongqing: [29.563, 106.5516],
  tokyo: [35.6762, 139.6503],
  'los-angeles': [34.0522, -118.2437],
};

const labelOffsets: Record<string, readonly [number, number]> = {
  beijing: [15, -28],
  shanghai: [18, 8],
  chongqing: [-72, 9],
  tokyo: [18, -14],
  'los-angeles': [18, -14],
};

interface CityMarker {
  city: CityConfig;
  point: THREE.Vector3;
  group: THREE.Group;
  dot: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  hit: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  label: HTMLButtonElement;
  leader: SVGLineElement;
  front: boolean;
}

interface DragState {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

function cityPoint(latitude: number, longitude: number, radius = 1) {
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).multiplyScalar(radius);
}

export class CityGlobe {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 25);
  private renderer: THREE.WebGLRenderer;
  private planet = new THREE.Group();
  private labels = document.createElement('div');
  private leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private status = document.createElement('div');
  private markers: CityMarker[] = [];
  private labelOrder: CityMarker[] = [];
  private observer: ResizeObserver;
  private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private reduced = this.motion.matches;
  private textures: THREE.Texture[];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private worldPoint = new THREE.Vector3();
  private toCamera = new THREE.Vector3();
  private projected = new THREE.Vector3();
  private surfaceNormal = new THREE.Vector3();
  private width = 1;
  private height = 1;
  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private distance = 3.65;
  private targetDistance = 3.65;
  private velocityYaw = 0;
  private velocityPitch = 0;
  private lastInteraction = performance.now();
  private lastFrame = 0;
  private selectedId: string;
  private hoveredId: string | null = null;
  private drag: DragState | null = null;
  private frameId = 0;
  private disposed = false;

  constructor(private container: HTMLElement, cities: readonly CityConfig[], selectedId: string, private onSelect: (cityId: string) => void) {
    this.selectedId = selectedId;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    const canvas = this.renderer.domElement;
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' });
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '地球城市选择，拖拽或方向键旋转，滚轮或加减键缩放');
    this.labels.className = 'globe-labels';
    Object.assign(this.labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    this.leaders.setAttribute('class', 'globe-leaders');
    Object.assign(this.leaders.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    this.labels.append(this.leaders);
    this.status.className = 'globe-status';
    this.status.textContent = '正在加载地球影像…';
    this.status.setAttribute('role', 'status');
    this.container.append(canvas, this.labels, this.status);
    this.scene.add(this.planet);
    let remaining = 4;
    let failed = false;
    const loader = new THREE.TextureLoader();
    const load = (name: string, color: boolean) => {
      const texture = loader.load(`/assets/ui-racing/globe/earth-${name}.webp`, loaded => {
        if (this.disposed) { loaded.dispose(); return; }
        remaining--;
        if (!remaining && !failed) this.status.hidden = true;
        this.requestFrame();
      }, undefined, () => {
        if (this.disposed) return;
        failed = true;
        this.status.textContent = '地球影像暂时无法载入，请返回后重试。';
      });
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
      return texture;
    };
    const maps = { day: load('day', true), night: load('night', true), clouds: load('clouds', false), surface: load('surface', false) };
    this.textures = Object.values(maps);
    const materials = globeMaterials(maps);
    this.planet.add(
      new THREE.Mesh(new THREE.SphereGeometry(1.05, 96, 64), materials.earth),
      new THREE.Mesh(new THREE.SphereGeometry(1.052, 96, 64), materials.clouds),
      new THREE.Mesh(new THREE.SphereGeometry(1.1, 96, 64), materials.atmosphere),
    );
    this.addStars();
    for (const city of cities) this.addCity(city);
    this.selectCity(selectedId);
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(this.container);
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerCancel);
    canvas.addEventListener('pointerleave', this.pointerLeave);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('keydown', this.keyDown);
    document.addEventListener('visibilitychange', this.visibility);
    this.motion.addEventListener('change', this.motionChange);
    this.resize();
  }

  selectCity(cityId: string) {
    this.selectedId = cityId;
    const [latitude, longitude] = locations[cityId];
    const yaw = -Math.PI / 2 - THREE.MathUtils.degToRad(longitude);
    this.targetYaw = this.yaw + Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
    this.targetPitch = THREE.MathUtils.degToRad(latitude);
    this.velocityYaw = 0;
    this.velocityPitch = 0;
    this.lastInteraction = performance.now();
    for (const marker of this.markers) {
      marker.label.classList.toggle('is-selected', marker.city.id === cityId);
      marker.label.setAttribute('aria-pressed', String(marker.city.id === cityId));
    }
    this.labelOrder = [...this.markers].sort((a, b) => Number(b.city.id === cityId) - Number(a.city.id === cityId));
    this.requestFrame();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.visibility);
    this.motion.removeEventListener('change', this.motionChange);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.pointerDown);
    canvas.removeEventListener('pointermove', this.pointerMove);
    canvas.removeEventListener('pointerup', this.pointerUp);
    canvas.removeEventListener('pointercancel', this.pointerCancel);
    canvas.removeEventListener('pointerleave', this.pointerLeave);
    canvas.removeEventListener('wheel', this.wheel);
    canvas.removeEventListener('keydown', this.keyDown);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
    this.labels.remove();
    this.status.remove();
    this.markers.length = 0;
    this.labelOrder.length = 0;
  }

  private addStars() {
    const positions: number[] = [];
    const sizes: number[] = [];
    let seed = 20261031;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for (let i = 0; i < 200; i++) {
      positions.push((random() - 0.5) * 13, (random() - 0.5) * 9, -3 - random() * 4);
      sizes.push(0.6 + Math.pow(random(), 4) * 1.7);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    this.scene.add(new THREE.Points(geometry, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { pixelRatio: { value: this.renderer.getPixelRatio() } },
      vertexShader: 'attribute float size;uniform float pixelRatio;varying float brightness;void main(){brightness=size*.22;gl_PointSize=size*pixelRatio;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying float brightness;void main(){float a=1.0-smoothstep(.1,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.72,.8,.9,a*brightness);}',
    })));
  }

  private addCity(city: CityConfig) {
    const [latitude, longitude] = locations[city.id];
    const point = cityPoint(latitude, longitude, 1.061);
    const group = new THREE.Group();
    group.position.copy(point);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), point.clone().normalize());
    const color = city.available ? 0xdcf45b : 0xa5b3be;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshBasicMaterial({ color }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.021, 36), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false }));
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.039, 12, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.userData.cityId = city.id;
    group.add(dot, ring, hit);
    this.planet.add(group);
    const label = document.createElement('button');
    label.type = 'button';
    label.className = `globe-city-label ${city.available ? 'is-available' : 'is-locked'}`;
    label.textContent = city.name;
    label.setAttribute('aria-label', `${city.name}，${city.available ? '可挑战' : '未开放，可预览'}`);
    Object.assign(label.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'auto' });
    label.addEventListener('click', event => { event.stopPropagation(); this.selectCity(city.id); this.onSelect(city.id); });
    label.addEventListener('pointerenter', () => { this.hoveredId = city.id; this.requestFrame(); });
    label.addEventListener('pointerleave', () => { this.hoveredId = null; this.requestFrame(); });
    label.addEventListener('focus', () => { this.lastInteraction = performance.now(); this.hoveredId = city.id; this.requestFrame(); });
    label.addEventListener('blur', () => { this.hoveredId = null; this.requestFrame(); });
    const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    leader.setAttribute('stroke', city.available ? '#dcf45b' : '#8aa2b1');
    leader.setAttribute('stroke-opacity', city.available ? '.5' : '.35');
    leader.setAttribute('stroke-width', '1');
    this.leaders.append(leader);
    this.labels.append(label);
    this.markers.push({ city, point, group, dot, ring, hit, label, leader, front: true });
  }

  private resize = () => {
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.leaders.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.requestFrame();
  };

  private requestFrame() {
    if (!this.disposed && !document.hidden && !this.frameId) this.frameId = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.frameId = 0;
    if (this.disposed || document.hidden) return;
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.05) : 1 / 60;
    this.lastFrame = now;
    if (!this.drag && !this.reduced) {
      this.targetYaw += this.velocityYaw * dt;
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + this.velocityPitch * dt, -1.35, 1.35);
      this.velocityYaw *= Math.exp(-5 * dt);
      this.velocityPitch *= Math.exp(-5 * dt);
      if (now - this.lastInteraction > 10000 && !this.container.contains(document.activeElement)) this.targetYaw += dt * 0.026;
    }
    const blend = this.reduced ? 1 : 1 - Math.exp(-8 * dt);
    this.yaw = THREE.MathUtils.lerp(this.yaw, this.targetYaw, blend);
    this.pitch = THREE.MathUtils.lerp(this.pitch, this.targetPitch, blend);
    this.distance = THREE.MathUtils.lerp(this.distance, this.targetDistance, blend);
    this.planet.rotation.set(this.pitch, this.yaw, 0, 'XYZ');
    this.camera.position.set(0, 0, this.distance);
    this.camera.lookAt(0, 0, 0);
    this.planet.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const placed: { left: number; top: number; width: number; height: number }[] = [];
    for (const marker of this.labelOrder) {
      marker.group.getWorldPosition(this.worldPoint);
      this.toCamera.copy(this.camera.position).sub(this.worldPoint).normalize();
      marker.front = this.surfaceNormal.copy(this.worldPoint).normalize().dot(this.toCamera) > 0.04;
      marker.group.visible = marker.front;
      marker.label.hidden = !marker.front;
      marker.label.style.display = marker.front ? '' : 'none';
      marker.leader.style.display = marker.front ? '' : 'none';
      if (!marker.front) continue;
      this.projected.copy(this.worldPoint).project(this.camera);
      const [offsetX, offsetY] = labelOffsets[marker.city.id];
      const anchorX = (this.projected.x * 0.5 + 0.5) * this.width;
      const anchorY = (-this.projected.y * 0.5 + 0.5) * this.height;
      const width = marker.label.offsetWidth || 64;
      const height = marker.label.offsetHeight || 28;
      const left = THREE.MathUtils.clamp(anchorX + offsetX, 8, Math.max(8, this.width - width - 8));
      let top = THREE.MathUtils.clamp(anchorY + offsetY, 8, Math.max(8, this.height - height - 8));
      for (const shift of [0, height + 8, -height - 8, height * 2 + 16, -height * 2 - 16, height * 3 + 24, -height * 3 - 24]) {
        const candidate = top + shift;
        if (candidate < 8 || candidate + height > this.height - 8) continue;
        if (placed.some(other => left < other.left + other.width + 8 && left + width + 8 > other.left && candidate < other.top + other.height + 7 && candidate + height + 7 > other.top)) continue;
        top = candidate;
        break;
      }
      placed.push({ left, top, width, height });
      marker.label.style.transform = `translate(${left}px,${top}px)`;
      marker.leader.setAttribute('x1', String(anchorX));
      marker.leader.setAttribute('y1', String(anchorY));
      marker.leader.setAttribute('x2', String(anchorX < left + width / 2 ? left : left + width));
      marker.leader.setAttribute('y2', String(THREE.MathUtils.clamp(anchorY, top + 5, top + height - 5)));
      const selected = marker.city.id === this.selectedId;
      const hovered = marker.city.id === this.hoveredId;
      marker.dot.scale.setScalar(hovered ? 1.65 : selected ? 1.25 : 1);
      marker.ring.scale.setScalar(hovered ? 1.3 : selected ? 1.15 : 1);
      marker.ring.material.opacity = selected || hovered ? 0.9 : 0.32;
    }
    this.renderer.render(this.scene, this.camera);
    if (!this.reduced || this.drag) this.requestFrame();
  };

  private pick(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.markers.filter(marker => marker.front).map(marker => marker.hit), false);
    return hits[0]?.object.userData.cityId as string | undefined;
  }

  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.velocityYaw = 0;
    this.velocityPitch = 0;
    this.lastInteraction = performance.now();
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private pointerMove = (event: PointerEvent) => {
    if (this.drag?.id === event.pointerId) {
      const dx = (event.clientX - this.drag.lastX) / this.width * 3.8;
      const dy = (event.clientY - this.drag.lastY) / this.height * 2.8;
      this.targetYaw += dx;
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + dy, -1.35, 1.35);
      this.velocityYaw = this.reduced ? 0 : dx * 18;
      this.velocityPitch = this.reduced ? 0 : dy * 18;
      this.drag.moved ||= Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 5;
      this.drag.lastX = event.clientX;
      this.drag.lastY = event.clientY;
      this.lastInteraction = performance.now();
    } else {
      this.hoveredId = this.pick(event.clientX, event.clientY) ?? null;
      this.renderer.domElement.style.cursor = this.hoveredId ? 'pointer' : 'grab';
    }
    this.requestFrame();
  };

  private pointerUp = (event: PointerEvent) => {
    if (this.drag?.id !== event.pointerId) return;
    const moved = this.drag.moved;
    this.drag = null;
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
    if (!moved) {
      const cityId = this.pick(event.clientX, event.clientY);
      if (cityId) { this.selectCity(cityId); this.onSelect(cityId); }
    }
    this.requestFrame();
  };

  private pointerCancel = () => {
    this.drag = null;
    this.velocityYaw = 0;
    this.velocityPitch = 0;
    this.renderer.domElement.style.cursor = 'grab';
  };

  private pointerLeave = () => {
    if (this.drag) return;
    this.hoveredId = null;
    this.renderer.domElement.style.cursor = 'grab';
    this.requestFrame();
  };

  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance + event.deltaY * (event.deltaMode === 1 ? 0.032 : 0.002), minimumDistance, 5.4);
    this.lastInteraction = performance.now();
    this.requestFrame();
  };

  private keyDown = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowLeft') this.targetYaw -= 0.18;
    if (event.key === 'ArrowRight') this.targetYaw += 0.18;
    if (event.key === 'ArrowUp') this.targetPitch = Math.max(-1.35, this.targetPitch - 0.14);
    if (event.key === 'ArrowDown') this.targetPitch = Math.min(1.35, this.targetPitch + 0.14);
    if (event.key === '+' || event.key === '=') this.targetDistance = Math.max(minimumDistance, this.targetDistance - 0.3);
    if (event.key === '-') this.targetDistance = Math.min(5.4, this.targetDistance + 0.3);
    if (event.key === 'Home') this.selectCity(this.selectedId);
    this.velocityYaw = 0;
    this.velocityPitch = 0;
    this.lastInteraction = performance.now();
    this.requestFrame();
  };

  private visibility = () => {
    if (document.hidden) { cancelAnimationFrame(this.frameId); this.frameId = 0; return; }
    this.lastFrame = 0;
    this.lastInteraction = performance.now();
    this.requestFrame();
  };

  private motionChange = () => {
    this.reduced = this.motion.matches;
    this.velocityYaw = 0;
    this.velocityPitch = 0;
    this.requestFrame();
  };
}
