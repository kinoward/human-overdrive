import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CITIES, HELICOPTER_COUNTS, POLICE_COUNTS, VEHICLES } from '../config';
import type { GameSnapshot, Point3, RaceMetrics, RaceResult, VehicleConfig, VehicleId, WorldData, RoadPath } from '../types';
import { buildWorld, nearestRoad, sampleRoad } from './world';
import { PhysicsVehicle } from './physics';
import { createHelicopter, createVehicleModel } from './models';
import { RoadNavigation } from './navigation';
import { buildResult, calculateScore, getWarning } from './rules';
import { GameAudio } from './audio';

interface TrafficCar {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  model: ReturnType<typeof createVehicleModel>;
  road: RoadPath;
  distance: number;
  offset: number;
  speed: number;
  encounter: number;
  collided: boolean;
}

interface PoliceCar { vehicle: PhysicsVehicle; route: Point3[]; routeAt: number; role: number }

export class GameEngine {
  readonly scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(58, 1, 0.15, 1800);
  private timer = new THREE.Timer();
  private physics!: RAPIER.World;
  private events!: RAPIER.EventQueue;
  private track!: WorldData;
  private navigation!: RoadNavigation;
  private player?: PhysicsVehicle;
  private preview?: ReturnType<typeof createVehicleModel>;
  private traffic: TrafficCar[] = [];
  private police: PoliceCar[] = [];
  private helicopters: ReturnType<typeof createHelicopter>[] = [];
  private keys = new Set<string>();
  private audio = new GameAudio();
  private accumulator = 0;
  private simulationTime = 0;
  private status: GameSnapshot['status'] = 'ready';
  private metrics!: RaceMetrics;
  private heat = 0;
  private nickname = '公路旅人';
  private wrongWay = false;
  private capture = 0;
  private captureOrigin = new THREE.Vector3();
  private escapeTime = 0;
  private flippedTime = 0;
  private combo = 0;
  private lastViolation = 0;
  private lastCollision = -10;
  private lastPosition = new THREE.Vector3();
  private event = '沿四环自由驾驶，累计 5 公里即可逃脱';
  private eventTone: GameSnapshot['eventTone'] = 'neutral';
  private eventUntil = 0;
  private cameraPosition = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  private hudAt = 0;
  private mapCanvas = document.createElement('canvas');
  private mapContext: CanvasRenderingContext2D;
  private lookBack = false;
  private ready = false;
  private barrierCells = new Map<string, NonNullable<WorldData['obstacles']>>();
  private activeBarriers = new Map<string, RAPIER.Collider[]>();
  private barrierCell = '';
  private nearbyTrafficRoads: RoadPath[] = [];
  private sun = new THREE.DirectionalLight('#fff0d8', 2.5);

  constructor(private onSnapshot: (snapshot: GameSnapshot) => void, private onFinish: (result: RaceResult) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color('#b9cbc7');
    this.scene.fog = new THREE.FogExp2('#b9cbc7', 0.0011);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -65;
    this.sun.shadow.camera.right = 65;
    this.sun.shadow.camera.top = 65;
    this.sun.shadow.camera.bottom = -65;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 240;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.renderer.domElement.setAttribute('aria-label', '北京四环驾驶场景');
    this.renderer.domElement.tabIndex = 0;
    document.querySelector('#scene')!.append(this.renderer.domElement);
    this.mapCanvas.width = 420;
    this.mapCanvas.height = 280;
    this.mapCanvas.className = 'race-map';
    this.mapCanvas.style.cssText = 'position:fixed;left:28px;bottom:28px;width:210px;height:140px;z-index:3;pointer-events:none;display:none;border:1px solid #ffffff24;border-radius:10px;background:#14201dec';
    this.mapContext = this.mapCanvas.getContext('2d')!;
    document.querySelector('#scene')!.append(this.mapCanvas);
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
    this.resize();
  }

  async init() {
    await RAPIER.init();
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.physics.timestep = 1 / 60;
    this.events = new RAPIER.EventQueue(true);
    this.track = await buildWorld(this.scene);
    this.navigation = new RoadNavigation(this.track.roads);
    for (const surface of this.track.surfaces) this.physics.createCollider(RAPIER.ColliderDesc.trimesh(surface.vertices, surface.indices).setFriction(0.9));
    for (const obstacle of this.track.obstacles ?? []) {
      const key = `${Math.floor(obstacle.center.x / 500)},${Math.floor(obstacle.center.z / 500)}`;
      if (!this.barrierCells.has(key)) this.barrierCells.set(key, []);
      this.barrierCells.get(key)!.push(obstacle);
    }
    this.updateRoadColliders(this.track.spawn.position);
    this.renderer.domElement.dataset.course = JSON.stringify({ mainLoopKm: this.track.mainLoopLength / 1000, roads: this.track.roads.length, source: this.track.source });
    this.preview = createVehicleModel(VEHICLES[0]);
    for (const wheel of this.preview.wheels) wheel.position.y = -0.49;
    this.preview.group.position.set(this.track.spawn.position.x, this.track.spawn.position.y + 0.85, this.track.spawn.position.z);
    this.preview.group.rotation.y = this.track.spawn.heading;
    this.scene.add(this.preview.group);
    this.ready = true;
    this.timer.connect(document);
    this.renderer.setAnimationLoop(this.frame);
  }

  start(vehicleId: VehicleId, nickname: string) {
    if (!this.ready) return;
    this.clearRace();
    const config = VEHICLES.find(vehicle => vehicle.id === vehicleId)!;
    this.nickname = nickname;
    this.player = new PhysicsVehicle(this.physics, config, this.track.spawn.position, this.track.spawn.heading);
    this.scene.add(this.player.model.group);
    if (this.preview) this.preview.group.visible = false;
    this.metrics = { vehicleId, elapsed: 0, distance: 0, targetDistance: CITIES[0].targetDistance, nearMisses: 0, collisions: 0, maxWarning: 0, maxPressureTime: 0, maxPressureDistance: 0, topSpeed: 0 };
    this.status = 'running';
    this.heat = 0;
    this.capture = 0;
    this.flippedTime = 0;
    this.combo = 0;
    this.lastViolation = 0;
    this.lastCollision = -10;
    this.accumulator = 0;
    this.simulationTime = 0;
    this.keys.clear();
    this.lastPosition.copy(this.player.body.translation());
    this.event = '自由选择路线 · 往返同样计入里程';
    this.eventTone = 'neutral';
    this.eventUntil = 5;
    this.spawnTraffic();
    this.cameraPosition.set(0, 0, 0);
    this.updateCamera(1);
    this.mapCanvas.style.display = '';
    this.audio.start();
    this.renderer.domElement.focus();
    this.emit();
  }

  pause() {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.keys.clear();
    this.audio.update(0, 0, false);
    this.emit();
  }

  resume() {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.accumulator = 0;
    this.keys.clear();
    this.audio.start();
    this.renderer.domElement.focus();
    this.emit();
  }

  restart() { if (this.metrics) this.start(this.metrics.vehicleId, this.nickname) }

  leave() {
    this.clearRace();
    this.status = 'ready';
    this.keys.clear();
    this.mapCanvas.style.display = 'none';
    if (this.preview) this.preview.group.visible = true;
    this.audio.update(0, 0, false);
  }

  setMuted(muted: boolean) { this.audio.setMuted(muted) }

  private clearRace() {
    this.player?.dispose();
    this.player = undefined;
    for (const actor of this.traffic) { actor.model.group.removeFromParent(); actor.model.dispose(); this.physics.removeRigidBody(actor.body) }
    for (const actor of this.police) actor.vehicle.dispose();
    for (const helicopter of this.helicopters) { helicopter.group.removeFromParent(); helicopter.spotlight.target.removeFromParent(); helicopter.dispose() }
    this.traffic = [];
    this.police = [];
    this.helicopters = [];
  }

  private updateRoadColliders(position: Point3) {
    const cx = Math.floor(position.x / 500), cz = Math.floor(position.z / 500);
    const current = `${cx},${cz}`;
    if (this.barrierCell === current) return;
    this.barrierCell = current;
    const needed = new Set<string>();
    for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) {
      const key = `${x},${z}`;
      needed.add(key);
      if (this.activeBarriers.has(key)) continue;
      const colliders = (this.barrierCells.get(key) ?? []).map(obstacle => this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(obstacle.halfExtents.x, obstacle.halfExtents.y, obstacle.halfExtents.z)
          .setTranslation(obstacle.center.x, obstacle.center.y, obstacle.center.z)
          .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(obstacle.pitch ?? 0, obstacle.rotation, 0, 'YXZ'))).setFriction(0.2)
      ));
      this.activeBarriers.set(key, colliders);
    }
    for (const [key, colliders] of this.activeBarriers) if (!needed.has(key)) { colliders.forEach(collider => this.physics.removeCollider(collider, false)); this.activeBarriers.delete(key) }
  }

  private spawnTraffic() {
    const palette = ['#d6d8ce', '#7f9a98', '#374550', '#c6aa84', '#8a929a', '#c1b5a7'];
    const spawn = this.track.spawn.position;
    this.nearbyTrafficRoads = this.track.roads.filter(road => road.kind !== 'ramp');
    const local = this.nearbyTrafficRoads.filter(road => road.points.some(point => Math.hypot(point.x - spawn.x, point.z - spawn.z) < 900));
    for (let i = 0; i < 34; i++) {
      const road = i < 12 ? this.track.roads.find(item => item.id === this.track.spawn.roadId)! : local[i % local.length];
      const near = nearestRoad([road], spawn.x, spawn.z)!;
      const distance = Math.min(road.length - 8, near.distance + 80 + i * 18);
      const offset = (i % 2 ? 0.23 : -0.16) * road.width;
      const sample = sampleRoad(road, distance, offset);
      const config: VehicleConfig = { ...VEHICLES[0], color: palette[i % palette.length], name: '城市交通', mass: 1550, length: i % 7 === 0 ? 5.5 : 4.5 };
      const model = createVehicleModel(config);
      for (const wheel of model.wheels) wheel.position.y = -0.43;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan(sample.direction.y), sample.heading, 0, 'YXZ'));
      const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(sample.point.x, sample.point.y + 0.79, sample.point.z).setRotation(q));
      const collider = this.physics.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.42, config.length * 0.45).setFriction(0.3).setRestitution(0.08), body);
      this.scene.add(model.group);
      model.group.position.set(sample.point.x, sample.point.y + 0.79, sample.point.z); model.group.quaternion.copy(q);
      this.traffic.push({ body, collider, model, road, distance, offset, speed: road.kind === 'main' ? 17 + i % 5 * 1.5 : 10, encounter: Infinity, collided: false });
    }
  }

  private spawnPolice() {
    if (!this.player) return;
    const warning = getWarning(this.heat);
    const near = nearestRoad(this.track.roads, this.player.body.translation().x, this.player.body.translation().z, this.player.body.translation().y - 0.85);
    if (!near) return;
    while (this.police.length < POLICE_COUNTS[warning]) {
      const i = this.police.length;
      const behind = i < 2 || i % 2 === 0;
      let d = near.distance + (behind ? -70 - i * 15 : 110 + i * 8);
      if (d < 15 || d > near.road.length - 15) d = THREE.MathUtils.clamp(near.distance + (behind ? 80 : -80), 20, near.road.length - 20);
      const p = sampleRoad(near.road, d, ((i % 3) - 1) * near.road.width * 0.2);
      const heading = p.heading + (behind ? 0 : Math.PI);
      const config = { ...VEHICLES[0], name: '北京警车', mass: 1850, acceleration: 11, color: '#e4e8e5' };
      const vehicle = new PhysicsVehicle(this.physics, config, p.point, heading, true);
      vehicle.body.setLinvel({ x: Math.sin(heading) * 13, y: 0, z: Math.cos(heading) * 13 }, true);
      this.scene.add(vehicle.model.group);
      this.police.push({ vehicle, route: [], routeAt: -10, role: i });
    }
    while (this.helicopters.length < HELICOPTER_COUNTS[warning]) {
      const helicopter = createHelicopter();
      this.scene.add(helicopter.group, helicopter.spotlight.target);
      this.helicopters.push(helicopter);
    }
  }

  private step(dt: number) {
    if (!this.player) return;
    this.metrics.elapsed += dt;
    this.simulationTime += dt;
    const position = this.player.body.translation();
    this.updateRoadColliders(position);
    const near = nearestRoad(this.track.roads, position.x, position.z, position.y - 0.85);
    const onRoad = !!near && Math.abs(near.offset) <= near.road.width / 2 + 1;
    const throttle = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const steer = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    this.player.drive({ throttle, steer, brake: this.keys.has('Space') }, dt, onRoad);
    this.lookBack = this.keys.has('KeyC');
    this.updateTraffic(dt);
    this.updatePolice(dt);
    this.physics.step(this.events);
    this.processCollisions();
    const next = this.player.body.translation();
    const nextRoad = nearestRoad(this.track.roads, next.x, next.z, next.y - 0.85);
    const roadValid = !!nextRoad && Math.abs(nextRoad.offset) < nextRoad.road.width / 2 + 0.7;
    const moved = new THREE.Vector3(next.x - this.lastPosition.x, next.y - this.lastPosition.y, next.z - this.lastPosition.z);
    let distance = 0;
    const grounded = this.player.model.wheels.some((_, index) => this.player!.controller.wheelIsInContact(index));
    if (roadValid && grounded && this.player.speed > 0.75 && this.player.upY > 0.35 && nextRoad && Math.abs(next.y - nextRoad.point.y) < 2 && moved.length() < 5) distance = Math.abs(moved.x * nextRoad.direction.x + moved.z * nextRoad.direction.z);
    this.metrics.distance = Math.min(this.metrics.targetDistance, this.metrics.distance + distance);
    this.metrics.topSpeed = Math.max(this.metrics.topSpeed, this.player.speed * 3.6);
    this.lastPosition.set(next.x, next.y, next.z);
    const velocity = this.player.body.linvel();
    this.wrongWay = !!nextRoad && nextRoad.road.oneWay && this.player.speed > 3 && (velocity.x * nextRoad.direction.x + velocity.z * nextRoad.direction.z) < -this.player.speed * 0.35;
    this.advanceWarning(dt);
    this.checkNearMisses();
    const warning = getWarning(this.heat);
    this.metrics.maxWarning = Math.max(this.metrics.maxWarning, warning);
    this.spawnPolice();
    const nearbyPolice = this.police.filter(actor => {
      const p = actor.vehicle.body.translation();
      return Math.hypot(p.x - next.x, p.z - next.z) < 180 && actor.vehicle.upY > 0.1;
    });
    if (warning === 5 && this.police.length >= 10 && this.helicopters.length >= 3 && nearbyPolice.length >= 3 && this.player.speed > 5 && distance > 0) {
      this.metrics.maxPressureTime += dt;
      this.metrics.maxPressureDistance += distance;
    } else if (this.metrics.maxPressureTime < 20 || this.metrics.maxPressureDistance < 500) {
      this.metrics.maxPressureTime = 0;
      this.metrics.maxPressureDistance = 0;
    }
    const blockingPolice = nearbyPolice.filter(actor => {
      const p = actor.vehicle.body.translation();
      return Math.hypot(p.x - next.x, p.z - next.z) < 5.5;
    });
    const blockaded = this.player.speed < 1.8 && blockingPolice.length >= 2;
    if (blockaded) {
      if (this.capture === 0) this.captureOrigin.copy(next);
      this.capture += dt / 5;
      this.escapeTime = 0;
    } else {
      this.escapeTime = this.player.speed > 4 ? this.escapeTime + dt : 0;
      if (this.captureOrigin.distanceTo(next as THREE.Vector3) > 6 || this.escapeTime > 0.8) this.capture = 0;
    }
    this.flippedTime = this.player.upY < (this.player.config.kind === 'motorcycle' ? 0.2 : 0.1) ? this.flippedTime + dt : 0;
    if (this.flippedTime > 0.9 || next.y < -25) { this.finish('flipped'); return }
    if (this.capture >= 1) { this.finish('caught'); return }
    if (this.metrics.distance >= this.metrics.targetDistance) { this.finish('escaped'); return }
    if (!roadValid && this.simulationTime > this.eventUntil) this.message('驶回公路 · 路外不累计里程', 'danger', 1);
    this.player.sync(this.simulationTime);
  }

  private advanceWarning(dt: number) {
    if (!this.player) return;
    if (this.heat > 0) this.heat = Math.min(100, this.heat + dt * 0.48);
    if (this.simulationTime - this.lastViolation >= 2) {
      const speeding = this.player.speed * 3.6 > 100;
      if (speeding || this.wrongWay) {
        const previous = getWarning(this.heat);
        this.heat = Math.min(100, Math.max(1, this.heat) + (this.wrongWay ? 7 : 3));
        this.lastViolation = this.simulationTime;
        if (previous === 0) this.message('违规记录 · 警方已开始追捕', 'danger', 4);
        else if (this.wrongWay) this.message('逆行中 · 里程有效，追捕压力上升', 'danger', 2);
      }
    }
  }

  private updateTraffic(dt: number) {
    if (!this.player) return;
    const player = this.player.body.translation();
    for (const actor of this.traffic) {
      let speed = actor.speed;
      for (const other of this.traffic) if (other !== actor && actor.road.id === other.road.id && Math.abs(actor.offset - other.offset) < 2 && other.distance > actor.distance && other.distance - actor.distance < 12) speed *= 0.4;
      actor.distance += speed * dt;
      let relocate = false;
      if (actor.distance >= actor.road.length) {
        const end = actor.road.points.at(-1)!;
        const next = this.track.roads.find(road => road !== actor.road && road.kind === actor.road.kind && Math.hypot(road.points[0].x - end.x, road.points[0].z - end.z, road.points[0].y - end.y) < 0.15);
        if (next) { actor.distance -= actor.road.length; actor.road = next; actor.offset = Math.min(actor.road.width * 0.3, Math.max(-actor.road.width * 0.3, actor.offset)) }
        else if (actor.road.closed) actor.distance %= actor.road.length;
        else { actor.distance = actor.road.length - 2; speed = 0 }
      }
      let sample = sampleRoad(actor.road, actor.distance, actor.offset);
      if (Math.hypot(sample.point.x - player.x, sample.point.z - player.z) > 650) {
        const near = nearestRoad(this.nearbyTrafficRoads, player.x, player.z, player.y - 0.85)!;
        actor.road = near.road;
        actor.offset = ((this.traffic.indexOf(actor) % 3) - 1) * actor.road.width * 0.23;
        actor.distance = Math.min(actor.road.length - 10, near.distance + 160 + this.traffic.indexOf(actor) * 12);
        sample = sampleRoad(actor.road, actor.distance, actor.offset);
        actor.encounter = Infinity; actor.collided = false; relocate = true;
      }
      const translation = { x: sample.point.x, y: sample.point.y + 0.79, z: sample.point.z };
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan(sample.direction.y), sample.heading, 0, 'YXZ'));
      if (relocate) actor.body.setTranslation(translation, true);
      actor.body.setNextKinematicTranslation(translation);
      actor.body.setNextKinematicRotation(rotation);
      actor.model.group.position.copy(translation); actor.model.group.quaternion.copy(rotation);
      for (const wheel of actor.model.wheels) wheel.rotation.x += speed * dt / 0.36;
    }
  }

  private updatePolice(dt: number) {
    if (!this.player) return;
    const player = this.player.body.translation();
    const velocity = this.player.body.linvel();
    const destination = { x: player.x + velocity.x * 0.5, y: player.y - 0.85, z: player.z + velocity.z * 0.5 };
    for (const actor of this.police) {
      const position = actor.vehicle.body.translation();
      const distance = Math.hypot(player.x - position.x, player.z - position.z);
      if (this.simulationTime - actor.routeAt > 1 + actor.role * 0.04) {
        actor.route = this.navigation.route(position, destination);
        actor.routeAt = this.simulationTime;
      }
      let target = destination;
      if (distance > 35 && actor.route.length) {
        while (actor.route.length > 1 && Math.hypot(actor.route[0].x - position.x, actor.route[0].z - position.z) < 15 + actor.vehicle.speed * 0.2) actor.route.shift();
        target = actor.route[0];
      }
      const desiredHeading = Math.atan2(target.x - position.x, target.z - position.z);
      const angle = Math.atan2(Math.sin(desiredHeading - actor.vehicle.heading), Math.cos(desiredHeading - actor.vehicle.heading));
      const steering = THREE.MathUtils.clamp(-angle * 2.5, -1, 1);
      const targetSpeed = Math.max(12, Math.min(53, this.player.speed * 1.13 + 5)) * Math.max(0.3, 1 - Math.abs(angle) * 0.7);
      actor.vehicle.drive({ throttle: actor.vehicle.speed < targetSpeed ? 1 : 0, steer: steering, brake: actor.vehicle.speed > targetSpeed + 3 }, dt);
      actor.vehicle.sync(this.simulationTime);
    }
    for (let i = 0; i < this.helicopters.length; i++) {
      const actor = this.helicopters[i];
      const angle = this.simulationTime * 0.17 + i * Math.PI * 2 / 3;
      actor.group.position.set(player.x + Math.cos(angle) * (30 + i * 10), 32 + i * 12, player.z + Math.sin(angle) * 45);
      actor.group.rotation.y = -angle;
      actor.rotor.rotation.y += dt * 42;
      actor.spotlight.target.position.set(player.x, 0, player.z);
    }
  }

  private processCollisions() {
    if (!this.player) return;
    const handle = this.player.body.handle;
    this.events.drainCollisionEvents((a, b, started) => {
      if (!started || !this.player) return;
      const first = this.physics.getCollider(a), second = this.physics.getCollider(b);
      if (!first || !second) return;
      const firstHandle = first.parent()?.handle, secondHandle = second.parent()?.handle;
      if (firstHandle !== handle && secondHandle !== handle) return;
      if (this.player.speed < 2 || this.simulationTime - this.lastCollision < 0.8) return;
      const other = firstHandle === handle ? second : first;
      if (!other.parent() && other.translation().y < 0) return;
      this.metrics.collisions++;
      this.combo = 0;
      this.lastCollision = this.simulationTime;
      this.heat = Math.min(100, Math.max(1, this.heat) + 12);
      this.player.balanceDisabled = 1.2;
      for (const actor of this.traffic) if (actor.body.handle === other.parent()?.handle) actor.collided = true;
      this.message('发生碰撞 · 连续干净驾驶已中断', 'danger', 2.5);
    });
  }

  private checkNearMisses() {
    if (!this.player) return;
    const position = this.player.body.translation();
    for (const actor of this.traffic) {
      const p = actor.body.translation();
      const distance = Math.hypot(position.x - p.x, position.z - p.z);
      if (distance < 9 && this.player.speed > actor.speed + 4) actor.encounter = Math.min(actor.encounter, distance);
      if (distance > 10 && actor.encounter < Infinity) {
        if (!actor.collided && actor.encounter > this.player.config.width * 0.5 + 0.8 && actor.encounter < this.player.config.width * 0.5 + 2.3) {
          this.metrics.nearMisses++;
          this.combo++;
          this.message(`干净擦身 +1 · ${this.combo > 1 ? `${this.combo} 连击` : '漂亮的超越'}`, 'good', 2.5);
        }
        actor.encounter = Infinity;
        actor.collided = false;
      }
    }
  }

  private finish(outcome: RaceResult['outcome']) {
    if (this.status !== 'running') return;
    this.status = 'finished';
    this.keys.clear();
    this.audio.update(0, 0, false);
    const result = buildResult(this.metrics, outcome, this.nickname);
    this.mapCanvas.style.display = 'none';
    this.emit();
    this.onFinish(result);
  }

  private message(text: string, tone: GameSnapshot['eventTone'], seconds: number) {
    this.event = text;
    this.eventTone = tone;
    this.eventUntil = this.simulationTime + seconds;
  }

  private emit() {
    if (!this.metrics) return;
    const score = calculateScore(this.metrics);
    if (this.player) this.renderer.domElement.dataset.drive = JSON.stringify({ position: this.player.body.translation(), heading: this.player.heading, steering: this.player.steering, upright: this.player.upY, speed: this.player.speed, wheels: this.player.model.wheels.map((_, index) => this.player!.controller.wheelIsInContact(index)) });
    this.onSnapshot({ status: this.status, speedKmh: this.player ? this.player.speed * 3.6 : 0, distance: this.metrics.distance, targetDistance: this.metrics.targetDistance, elapsed: this.metrics.elapsed, heat: this.heat, warning: getWarning(this.heat), policeCount: this.police.length, helicopterCount: this.helicopters.length, score: score.score, stars: score.stars, combo: this.combo, nearMisses: this.metrics.nearMisses, collisions: this.metrics.collisions, wrongWay: this.wrongWay, captureProgress: this.capture, event: this.simulationTime < this.eventUntil ? this.event : '', eventTone: this.eventTone, vehicleId: this.metrics.vehicleId });
  }

  private updateCamera(dt: number) {
    const target = this.player?.body.translation() ?? this.track.spawn.position;
    const heading = this.player?.heading ?? this.track.spawn.heading;
    this.sun.position.set(target.x - 55, target.y + 90, target.z - 45);
    this.sun.target.position.set(target.x, target.y, target.z);
    if (this.status === 'ready') {
      const angle = this.simulationTime * 0.05 + heading + 0.6;
      this.cameraPosition.set(target.x + Math.sin(angle) * 25, target.y + 14, target.z + Math.cos(angle) * 25);
      this.camera.position.copy(this.cameraPosition);
      this.camera.lookAt(target.x, target.y + 1, target.z);
      this.camera.fov = 52;
    } else {
      const speed = this.player?.speed ?? 0;
      const sign = this.lookBack ? 1 : -1;
      const follow = new THREE.Vector3(target.x + Math.sin(heading) * (8 + speed * 0.04) * sign, target.y + 4.2 + speed * 0.012, target.z + Math.cos(heading) * (8 + speed * 0.04) * sign);
      if (this.cameraPosition.lengthSq() === 0) this.cameraPosition.copy(follow);
      this.cameraPosition.lerp(follow, 1 - Math.exp(-dt * 7));
      this.camera.position.copy(this.cameraPosition);
      this.cameraTarget.set(target.x + Math.sin(heading) * (this.lookBack ? -6 : 12), target.y + 0.8, target.z + Math.cos(heading) * (this.lookBack ? -6 : 12));
      this.camera.lookAt(this.cameraTarget);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 57 + Math.min(14, speed * 0.25), 3, dt);
    }
    this.camera.updateProjectionMatrix();
  }

  private drawMap() {
    if (!this.player) return;
    const ctx = this.mapContext, p = this.player.body.translation();
    ctx.clearRect(0, 0, 420, 280);
    const scale = 0.6;
    ctx.save();
    ctx.translate(210, 140);
    ctx.lineCap = 'round';
    for (const road of this.track.roads) {
      ctx.beginPath();
      road.points.forEach((point, i) => { const x = (point.x - p.x) * scale, y = (point.z - p.z) * scale; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) });
      ctx.strokeStyle = road.kind === 'main' ? '#a4ad9b' : '#536759';
      ctx.lineWidth = road.kind === 'main' ? 5 : 2.5;
      ctx.stroke();
    }
    for (const actor of this.police) {
      const point = actor.vehicle.body.translation();
      ctx.beginPath(); ctx.arc((point.x - p.x) * scale, (point.z - p.z) * scale, 4, 0, Math.PI * 2); ctx.fillStyle = '#ef715b'; ctx.fill();
    }
    ctx.rotate(-this.player.heading);
    ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(-7, -7); ctx.lineTo(7, -7); ctx.closePath(); ctx.fillStyle = '#dcfa73'; ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#e2e8d7'; ctx.font = '18px system-ui'; ctx.fillText('四环全线 · 主辅路', 18, 28);
    ctx.fillStyle = '#92a18e'; ctx.font = '15px system-ui'; ctx.fillText('© OpenStreetMap', 18, 264);
  }

  private frame = () => {
    this.timer.update();
    const dt = Math.min(0.08, this.timer.getDelta());
    if (this.status === 'running') {
      this.accumulator += dt;
      let ticks = 0;
      while (this.accumulator >= 1 / 60 && ticks++ < 5 && this.status === 'running') { this.step(1 / 60); this.accumulator -= 1 / 60 }
    } else if (this.status === 'ready') this.simulationTime += dt;
    if (this.ready) this.updateCamera(dt);
    this.audio.update(this.player?.speed ?? 0, getWarning(this.heat), this.status === 'running');
    if (this.timer.getElapsed() - this.hudAt > 0.08) {
      this.hudAt = this.timer.getElapsed();
      if (this.status !== 'ready') { this.emit(); this.drawMap() }
    }
    this.renderer.render(this.scene, this.camera);
  };

  private resize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  private keyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement)?.matches('input,textarea,select')) return;
    if (event.code === 'Escape' && !event.repeat) { event.preventDefault(); if (this.status === 'running') this.pause(); else if (this.status === 'paused') this.resume(); return }
    if (this.status !== 'running') return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC'].includes(event.code)) { event.preventDefault(); this.keys.add(event.code) }
  };

  private keyUp = (event: KeyboardEvent) => { this.keys.delete(event.code) };
  private blur = () => { this.keys.clear(); this.pause() };
  private visibility = () => { if (document.hidden) this.pause() };
}
