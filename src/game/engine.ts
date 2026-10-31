import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CITIES, HELICOPTER_COUNTS, POLICE_COUNTS, VEHICLES } from '../config';
import type { GameSnapshot, Point3, RaceMetrics, RaceResult, VehicleId, WorldData } from '../types';
import { buildWorld, nearestRoad } from './world';
import { PhysicsVehicle } from './physics';
import { createVehicleModel } from './models';
import { PolicePursuit } from './police';
import { Airspace } from './airspace';
import { PursuitHelicopter } from './helicopter';
import { CollisionSystem } from './collisions';
import { isCaptured } from './capture';
import { BARRIER_GROUPS, GROUND_BODY_GROUPS, ROAD_GROUPS } from './collision-groups';
import { buildResult, calculateScore, getWarning } from './rules';
import { GameAudio } from './audio';
import { TrafficSimulation, type TrafficAgent, type TrafficObstacle } from './traffic';
import { TRAFFIC_COUNT, trafficVehicleForSlot } from './traffic-vehicles';
import { createTrafficVehicleModel, loadTrafficModels } from './traffic-models';
import { ArcadeCameraMotion } from './camera-motion';
import { RenderPose } from './render-pose';
import { loadGeneratedAssets } from './generated-assets';
import { VehicleDamage } from './vehicle-damage';

interface TrafficCar {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  model: ReturnType<typeof createTrafficVehicleModel>;
  driver: TrafficAgent;
  encounter: number;
  collided: boolean;
  appearance: number;
  pose: RenderPose;
  damage?: VehicleDamage;
}

export class GameEngine {
  readonly scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(58, 1, 0.5, 1400);
  private timer = new THREE.Timer();
  private physics!: RAPIER.World;
  private events!: RAPIER.EventQueue;
  private track!: WorldData;
  private airspace!: Airspace;
  private collisionSystem!: CollisionSystem;
  private pursuit?: PolicePursuit;
  private player?: PhysicsVehicle;
  private preview?: ReturnType<typeof createVehicleModel>;
  private traffic: TrafficCar[] = [];
  private helicopters: PursuitHelicopter[] = [];
  private helicopterSight = new Map<PursuitHelicopter, boolean>();
  private nextSight = 0;
  private keys = new Set<string>();
  private audio = new GameAudio();
  private cameraMotion = new ArcadeCameraMotion();
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
  private cameraHeading = 0;
  private cameraAnchor = new THREE.Vector3();
  private frameCount = 0;
  private frameWindow = performance.now();
  private longestFrame = 0;
  private physicsCost = 0;
  private renderCost = 0;
  private needsRender = true;
  private shadowRight = new THREE.Vector3(45, 0, -55).normalize();
  private shadowUp = new THREE.Vector3().crossVectors(new THREE.Vector3(55, -90, 45).normalize(), this.shadowRight).normalize();
  private shadowCenter = new THREE.Vector3();
  private barrierCells = new Map<string, NonNullable<WorldData['obstacles']>>();
  private activeBarriers = new Map<string, RAPIER.Collider[]>();
  private barrierCell = '';
  private trafficSimulation?: TrafficSimulation;
  private sun = new THREE.DirectionalLight('#fff0d8', 2.5);
  private viewMatrix = new THREE.Matrix4();
  private viewFrustum = new THREE.Frustum();
  private visibilitySphere = new THREE.Sphere();

  private get police() { return this.pursuit?.cars ?? [] }

  constructor(private onSnapshot: (snapshot: GameSnapshot) => void, private onFinish: (result: RaceResult) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
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
    await Promise.all([RAPIER.init(), loadGeneratedAssets(), loadTrafficModels()]);
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.physics.timestep = 1 / 60;
    this.events = new RAPIER.EventQueue(true);
    this.track = await buildWorld(this.scene);
    this.collisionSystem = new CollisionSystem(this.physics, this.events);
    for (const surface of this.track.surfaces) this.physics.createCollider(RAPIER.ColliderDesc.trimesh(surface.vertices, surface.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.9).setCollisionGroups(ROAD_GROUPS));
    this.airspace = new Airspace(this.physics);
    this.airspace.addScene(this.scene);
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
    this.frameWindow = performance.now();
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
    this.resetFrameStats();
    this.needsRender = true;
    this.heat = 0;
    this.capture = 0;
    this.flippedTime = 0;
    this.combo = 0;
    this.lastViolation = 0;
    this.collisionSystem.reset();
    this.nextSight = 0;
    this.pursuit = new PolicePursuit(this.physics, this.scene, this.track.roads, { isVisible: this.isVisible });
    this.accumulator = 0;
    this.simulationTime = 0;
    this.keys.clear();
    this.lastPosition.copy(this.player.body.translation());
    this.event = '自由选择路线 · 往返同样计入里程';
    this.eventTone = 'neutral';
    this.eventUntil = 5;
    this.spawnTraffic();
    this.cameraPosition.set(0, 0, 0);
    this.cameraMotion.reset();
    this.updateCamera(1);
    this.mapCanvas.style.display = '';
    this.audio.start();
    this.renderer.domElement.focus();
    this.emit();
  }

  pause() {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.needsRender = true;
    this.keys.clear();
    this.audio.update(0, 0, false);
    this.emit();
  }

  resume() {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.resetFrameStats();
    this.needsRender = true;
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
    for (const actor of this.traffic) { actor.damage?.dispose(); actor.model.group.removeFromParent(); actor.model.dispose(); this.physics.removeRigidBody(actor.body) }
    this.pursuit?.dispose();
    this.pursuit = undefined;
    for (const helicopter of this.helicopters) helicopter.dispose();
    this.airspace?.reset();
    this.collisionSystem?.reset();
    this.traffic = [];
    this.trafficSimulation = undefined;
    this.helicopters = [];
    this.helicopterSight.clear();
  }

  private updateRoadColliders(position: Point3) {
    const anchors = [position, ...this.police.map(actor => actor.vehicle.body.translation())];
    const cells = new Map<string, { x: number; z: number; span: number }>();
    for (let i = 0; i < anchors.length; i++) {
      const x = Math.floor(anchors[i].x / 500), z = Math.floor(anchors[i].z / 500);
      const key = `${x},${z}`;
      const span = i === 0 ? 2 : 1;
      if ((cells.get(key)?.span ?? -1) < span) cells.set(key, { x, z, span });
    }
    const current = [...cells.entries()].map(([key, cell]) => `${key}:${cell.span}`).sort().join(';');
    if (this.barrierCell === current) return;
    this.barrierCell = current;
    const needed = new Set<string>();
    for (const cell of cells.values()) for (let x = cell.x - cell.span; x <= cell.x + cell.span; x++) for (let z = cell.z - cell.span; z <= cell.z + cell.span; z++) needed.add(`${x},${z}`);
    for (const key of needed) {
      if (this.activeBarriers.has(key)) continue;
      const colliders = (this.barrierCells.get(key) ?? []).map(obstacle => this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(obstacle.halfExtents.x, obstacle.halfExtents.y, obstacle.halfExtents.z)
          .setTranslation(obstacle.center.x, obstacle.center.y, obstacle.center.z)
          .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(obstacle.pitch ?? 0, obstacle.rotation, 0, 'YXZ'))).setFriction(0.2).setCollisionGroups(BARRIER_GROUPS)
      ));
      this.activeBarriers.set(key, colliders);
    }
    for (const [key, colliders] of this.activeBarriers) if (!needed.has(key)) {
      let touching = false;
      for (const collider of colliders) this.physics.contactPairsWith(collider, () => { touching = true });
      if (touching) continue;
      colliders.forEach(collider => this.physics.removeCollider(collider, false));
      this.activeBarriers.delete(key);
    }
  }

  private spawnTraffic() {
    const palette = ['#d6d8ce', '#7f9a98', '#374550', '#c6aa84', '#8a929a', '#c1b5a7'];
    this.trafficSimulation = new TrafficSimulation(this.track.roads);
    const focus = { position: this.player!.body.translation(), heading: this.player!.heading, speed: 0, lookBack: false };
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const profile = trafficVehicleForSlot(i);
      const driver = this.trafficSimulation.addCar(i, profile, focus);
      if (!driver) continue;
      const model = createTrafficVehicleModel(profile, palette[i % palette.length]);
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(driver.pitch, driver.heading, 0, 'YXZ'));
      const position = { x: driver.position.x, y: driver.position.y + 0.79, z: driver.position.z };
      const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z).setRotation(rotation));
      const collider = this.physics.createCollider(RAPIER.ColliderDesc.cuboid(profile.width * 0.5, Math.max(0.25, (profile.height - 0.32) * 0.5), profile.length * 0.5).setTranslation(0, profile.height * 0.5 - 0.79, 0).setFriction(0.3).setRestitution(0.08).setCollisionGroups(GROUND_BODY_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(profile.mass * 0.4), body);
      this.scene.add(model.group);
      model.group.position.copy(position); model.group.quaternion.copy(rotation);
      this.traffic.push({ body, collider, model, driver, encounter: Infinity, collided: false, appearance: 1, pose: new RenderPose(model.group) });
    }
  }

  private spawnPolice() {
    if (!this.player || !this.pursuit) return;
    const warning = getWarning(this.heat);
    this.pursuit.spawn(POLICE_COUNTS[warning], this.player, this.trafficObstacles());
    const player = this.player.body.translation();
    while (this.helicopters.length < HELICOPTER_COUNTS[warning]) {
      const i = this.helicopters.length;
      const initial = { x: player.x + (i - 1) * 35, y: player.y + 42 + i * 12, z: player.z - 45 };
      this.airspace.update([player, initial, ...this.helicopters.map(actor => actor.body.translation())]);
      const helicopter = new PursuitHelicopter(this.physics, this.airspace, i, initial);
      this.scene.add(helicopter.model.group, helicopter.model.spotlight.target);
      helicopter.update(0, player, true);
      this.helicopters.push(helicopter);
      this.helicopterSight.set(helicopter, false);
    }
  }

  private trafficObstacles(): TrafficObstacle[] {
    return this.traffic.map(actor => ({ position: actor.body.translation(), velocity: actor.body.linvel(), heading: actor.driver.heading, length: actor.driver.length, width: actor.driver.width }));
  }

  private isVisible = (point: Point3, radius: number) => {
    this.camera.updateMatrixWorld();
    this.viewMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.viewFrustum.setFromProjectionMatrix(this.viewMatrix);
    this.visibilitySphere.center.set(point.x, point.y, point.z);
    this.visibilitySphere.radius = radius;
    return this.viewFrustum.intersectsSphere(this.visibilitySphere);
  };

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
    this.collisionSystem.beforeStep({ body: this.player.body, collider: this.player.collider, kind: 'player' }, [
      ...this.police.map(actor => ({ body: actor.vehicle.body, collider: actor.vehicle.collider, kind: 'police' as const })),
      ...this.traffic.map(actor => ({ body: actor.body, collider: actor.collider, kind: 'traffic' as const }))
    ], dt);
    this.physics.step(this.events);
    this.player.sync(this.simulationTime);
    this.pursuit?.sync(this.simulationTime);
    for (const helicopter of this.helicopters) helicopter.afterStep();
    for (const actor of this.traffic) { actor.pose.capture(actor.body.translation(), actor.body.rotation()); actor.damage?.update(dt) }
    const contactBodies = this.processCollisions(dt);
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
    const nearbyPolice = this.pursuit?.effective(this.player).filter(actor => {
      const p = actor.vehicle.body.translation();
      return Math.hypot(p.x - next.x, p.z - next.z) < 180;
    }) ?? [];
    if (warning === 5 && this.police.length >= 10 && this.helicopters.length >= 3 && nearbyPolice.length >= 3 && this.player.speed > 5 && distance > 0) {
      this.metrics.maxPressureTime += dt;
      this.metrics.maxPressureDistance += distance;
    } else if (this.metrics.maxPressureTime < 20 || this.metrics.maxPressureDistance < 500) {
      this.metrics.maxPressureTime = 0;
      this.metrics.maxPressureDistance = 0;
    }
    const blockaded = this.player.speed < 1.8 && isCaptured(this.physics, { body: this.player.body, collider: this.player.collider, width: this.player.config.width, length: this.player.config.length }, this.police.map(actor => ({
      body: actor.vehicle.body, collider: actor.vehicle.collider, width: actor.vehicle.config.width, length: actor.vehicle.config.length, activePursuit: actor.activePursuit
    })), nextRoad, contactBodies);
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
    if (!this.player || !this.trafficSimulation) return;
    const obstacles: TrafficObstacle[] = [this.player, ...this.police.map(actor => actor.vehicle)].map(vehicle => ({
      position: vehicle.body.translation(), velocity: vehicle.body.linvel(), heading: vehicle.heading,
      length: vehicle.config.length, width: vehicle.config.width,
    }));
    this.trafficSimulation.update(dt, { position: this.player.body.translation(), heading: this.player.heading, speed: this.player.speed, lookBack: this.lookBack, velocity: this.player.body.linvel() }, obstacles);
    for (const actor of this.traffic) {
      const driver = actor.driver;
      const translation = { x: driver.position.x, y: driver.position.y + 0.79, z: driver.position.z };
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(driver.pitch, driver.heading, 0, 'YXZ'));
      if (driver.relocated) {
        actor.appearance = 0;
        actor.damage?.dispose();
        actor.damage = undefined;
        actor.body.setTranslation(translation, true);
        actor.body.setRotation(rotation, true);
        actor.pose.snap(translation, rotation);
        actor.encounter = Infinity; actor.collided = false;
      }
      actor.appearance = Math.min(1, actor.appearance + dt / 1.5);
      actor.model.setOpacity(actor.appearance);
      actor.body.setNextKinematicTranslation(translation);
      actor.body.setNextKinematicRotation(rotation);
      for (const light of actor.model.brakeLights) (light.material as THREE.MeshStandardMaterial).emissiveIntensity = driver.braking ? 3 : 0.7;
      const blink = Math.floor(this.simulationTime * 2.5) % 2 === 0;
      for (const light of actor.model.turnSignals) {
        const active = blink && driver.indicator === Math.sign(light.position.x);
        (light.material as THREE.MeshStandardMaterial).emissiveIntensity = active ? 3 : 0;
      }
    }
  }

  private updatePolice(dt: number) {
    if (!this.player || !this.pursuit) return;
    const player = this.player.body.translation();
    this.airspace.update([player, ...this.police.map(actor => actor.vehicle.body.translation()), ...this.helicopters.map(actor => actor.body.translation())]);
    if (this.simulationTime >= this.nextSight) {
      this.nextSight = this.simulationTime + 0.12;
      for (const helicopter of this.helicopters) {
        const position = helicopter.body.translation();
        const inRange = Math.hypot(position.x - player.x, position.y - player.y, position.z - player.z) < 450;
        this.helicopterSight.set(helicopter, inRange && this.airspace.lineOfSight(position, player, helicopter.body, this.player.body).clear);
      }
    }
    let observation: Point3 | undefined;
    const groundObservation = this.pursuit.observation;
    for (const helicopter of this.helicopters) {
      const visible = this.helicopterSight.get(helicopter) ?? false;
      helicopter.update(dt, player, visible, groundObservation && groundObservation.age < 0.25 ? groundObservation.position : undefined);
      if (visible) observation = helicopter.observation?.position;
    }
    this.pursuit.update(dt, this.simulationTime, this.player, this.trafficObstacles(), observation);
  }

  private processCollisions(dt: number) {
    const result = this.collisionSystem.afterStep(dt);
    if (!this.player) return result.contactBodies;
    for (const impact of result.impacts) {
      if (impact.newIncident) {
        this.metrics.collisions++;
        this.combo = 0;
        this.heat = Math.min(100, Math.max(1, this.heat) + 12);
      }
      if (impact.feedback) {
        this.renderer.domElement.dataset.impact = JSON.stringify({ severity: impact.severity, deltaV: impact.deltaV, approachSpeed: impact.approachSpeed, strength: impact.strength });
        this.player.balanceDisabled = Math.max(this.player.balanceDisabled, impact.balanceDisabled);
        this.player.applyImpact(impact.point, impact.direction, impact.strength);
        const localDirection = new THREE.Vector3(impact.direction.x, impact.direction.y, impact.direction.z).applyQuaternion(new THREE.Quaternion().copy(this.player.body.rotation()).invert());
        this.cameraMotion.impact(impact.strength, localDirection.x);
        this.audio.impact(impact.strength);
        const struckPolice = this.police.find(actor => actor.vehicle.body.handle === impact.otherBodyHandle);
        if (struckPolice) {
          struckPolice.vehicle.balanceDisabled = Math.max(struckPolice.vehicle.balanceDisabled, impact.balanceDisabled);
          struckPolice.vehicle.applyImpact(impact.point, { x: -impact.direction.x, y: -impact.direction.y, z: -impact.direction.z }, impact.strength);
        }
        const text = impact.severity === 'heavy' ? '猛烈撞击 · 稳住车身' : impact.severity === 'medium' ? '发生撞击 · 连续干净驾驶已中断' : '车身擦碰 · 注意保持间距';
        this.message(text, 'danger', impact.severity === 'heavy' ? 2.5 : 1.5);
      }
      for (const actor of this.traffic) if (actor.body.handle === impact.otherBodyHandle) {
        actor.collided = true;
        if (impact.feedback && actor.model.group.userData.damageModel) {
          const base = VEHICLES.find(vehicle => vehicle.kind === actor.model.group.userData.damageModel)!;
          actor.damage ??= new VehicleDamage(actor.model.group, { ...base, width: actor.driver.width, length: actor.driver.length }, actor.body, this.physics);
          actor.damage.impact(new THREE.Vector3(impact.point.x, impact.point.y, impact.point.z), new THREE.Vector3(-impact.direction.x, -impact.direction.y, -impact.direction.z), impact.strength);
        }
      }
    }
    return result.contactBodies;
  }

  private checkNearMisses() {
    if (!this.player) return;
    const position = this.player.body.translation();
    for (const actor of this.traffic) {
      const p = actor.body.translation();
      const distance = Math.hypot(position.x - p.x, position.z - p.z);
      if (Math.abs(position.y - p.y) > 2) { actor.encounter = Infinity; continue }
      if (distance < 9 && this.player.speed > actor.driver.speed + 4) actor.encounter = Math.min(actor.encounter, distance);
      if (distance > 10 && actor.encounter < Infinity) {
        if (!actor.collided && actor.encounter > (this.player.config.width + actor.driver.width) * 0.5 + 0.1 && actor.encounter < (this.player.config.width + actor.driver.width) * 0.5 + 1.6) {
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
    this.needsRender = true;
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
    if (this.player) this.renderer.domElement.dataset.drive = JSON.stringify({ position: this.player.body.translation(), heading: this.player.heading, steering: this.player.steering, leanAngle: this.player.leanAngle, rotation: this.player.body.rotation(), upright: this.player.upY, speed: this.player.speed, damage: this.player.damage.summary, wheels: this.player.model.wheels.map((_, index) => this.player!.controller.wheelIsInContact(index)) });
    this.renderer.domElement.dataset.pursuit = JSON.stringify({ police: this.police.map(actor => ({ id: actor.id, role: actor.role, state: actor.state, active: actor.activePursuit, position: actor.vehicle.body.translation(), speed: actor.vehicle.speed })), helicopters: this.helicopters.map(actor => ({ position: actor.body.translation(), speed: actor.body.linvel(), observed: this.helicopterSight.get(actor) })), capture: this.capture, collisions: this.metrics.collisions });
    if (this.player) {
      const position = this.player.body.translation(), heading = this.player.heading;
      const types: Record<string, number> = {};
      let nearby = 0, ahead = 0;
      for (const actor of this.traffic) {
        const driver = actor.driver, dx = driver.position.x - position.x, dz = driver.position.z - position.z;
        types[driver.profile.id] = (types[driver.profile.id] ?? 0) + 1;
        if (Math.hypot(dx, dz) < 260 && Math.abs(driver.position.y + 0.79 - position.y) < 2.2) {
          nearby++;
          if (dx * Math.sin(heading) + dz * Math.cos(heading) > 15 && Math.cos(driver.heading - heading) > 0.6) ahead++;
        }
      }
      this.renderer.domElement.dataset.traffic = JSON.stringify({ total: this.traffic.length, nearby, ahead, types });
    }
    this.onSnapshot({ status: this.status, speedKmh: this.player ? this.player.speed * 3.6 : 0, distance: this.metrics.distance, targetDistance: this.metrics.targetDistance, elapsed: this.metrics.elapsed, heat: this.heat, warning: getWarning(this.heat), policeCount: this.police.length, helicopterCount: this.helicopters.length, score: score.score, stars: score.stars, combo: this.combo, nearMisses: this.metrics.nearMisses, collisions: this.metrics.collisions, wrongWay: this.wrongWay, captureProgress: this.capture, event: this.simulationTime < this.eventUntil ? this.event : '', eventTone: this.eventTone, vehicleId: this.metrics.vehicleId });
  }

  private updateCamera(dt: number) {
    const target = this.player?.model.group.position ?? this.track.spawn.position;
    const rotation = this.player?.model.group.quaternion;
    const forward = rotation ? new THREE.Vector3(0, 0, 1).applyQuaternion(rotation) : undefined;
    const heading = forward ? Math.atan2(forward.x, forward.z) : this.track.spawn.heading;
    const texel = 130 / this.sun.shadow.mapSize.x;
    this.shadowCenter.copy(target);
    for (const axis of [this.shadowRight, this.shadowUp]) {
      const value = this.shadowCenter.dot(axis);
      this.shadowCenter.addScaledVector(axis, Math.round(value / texel) * texel - value);
    }
    this.sun.position.copy(this.shadowCenter).add(new THREE.Vector3(-55, 90, -45));
    this.sun.target.position.copy(this.shadowCenter);
    if (this.status === 'ready') {
      const angle = this.simulationTime * 0.05 + heading + 0.6;
      this.cameraPosition.set(target.x + Math.sin(angle) * 25, target.y + 14, target.z + Math.cos(angle) * 25);
      this.camera.position.copy(this.cameraPosition);
      this.camera.lookAt(target.x, target.y + 1, target.z);
      this.camera.fov = 52;
    } else {
      const desiredHeading = heading + (this.lookBack ? Math.PI : 0);
      if (this.cameraPosition.lengthSq() === 0) { this.cameraHeading = desiredHeading; this.cameraAnchor.copy(target) }
      const turn = Math.atan2(Math.sin(desiredHeading - this.cameraHeading), Math.cos(desiredHeading - this.cameraHeading));
      this.cameraHeading += turn * (1 - Math.exp(-dt * 7));
      this.cameraAnchor.set(target.x, THREE.MathUtils.damp(this.cameraAnchor.y, target.y, 6, dt), target.z);
      const speed = this.player?.speed ?? 0;
      const distance = 8.5 + speed * 0.035;
      this.cameraPosition.set(this.cameraAnchor.x - Math.sin(this.cameraHeading) * distance, this.cameraAnchor.y + 3.4 + speed * 0.008, this.cameraAnchor.z - Math.cos(this.cameraHeading) * distance);
      this.camera.position.copy(this.cameraPosition);
      this.cameraTarget.set(this.cameraAnchor.x + Math.sin(this.cameraHeading) * 12, this.cameraAnchor.y + 0.8, this.cameraAnchor.z + Math.cos(this.cameraHeading) * 12);
      this.camera.lookAt(this.cameraTarget);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 56 + Math.min(7, speed * 0.12), 3, dt);
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

  private resetFrameStats() {
    this.frameCount = 0; this.longestFrame = 0; this.physicsCost = 0; this.renderCost = 0; this.frameWindow = performance.now();
  }

  private frame = () => {
    this.timer.update();
    if ((this.status === 'paused' || this.status === 'finished') && !this.needsRender) return;
    const delta = this.timer.getDelta();
    const dt = Math.min(0.08, delta);
    this.frameCount++;
    this.longestFrame = Math.max(this.longestFrame, delta);
    const physicsStarted = performance.now();
    if (this.status === 'running') {
      this.accumulator += dt;
      let ticks = 0;
      while (this.accumulator >= 1 / 60 && ticks++ < 5 && this.status === 'running') { this.step(1 / 60); this.accumulator -= 1 / 60 }
    } else if (this.status === 'ready') this.simulationTime += dt;
    this.physicsCost += performance.now() - physicsStarted;
    const alpha = Math.min(1, this.accumulator * 60);
    this.player?.render(alpha);
    this.pursuit?.render(alpha);
    for (const helicopter of this.helicopters) helicopter.render(alpha);
    for (const actor of this.traffic) {
      actor.pose.render(alpha);
      for (const wheel of actor.model.wheels) wheel.rotation.x = (actor.driver.wheelDistance - (1 - alpha) / 60 * actor.driver.speed) / actor.model.wheelRadius;
    }
    if (this.ready) {
      this.updateCamera(dt);
      const steer = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      this.cameraMotion.update(this.camera, this.player?.speed ?? 0, steer, this.player?.config.kind === 'motorcycle', dt, this.status === 'running', this.lookBack);
    }
    this.audio.update(this.player?.speed ?? 0, getWarning(this.heat), this.status === 'running');
    if (this.timer.getElapsed() - this.hudAt > 0.08) {
      this.hudAt = this.timer.getElapsed();
      if (this.status !== 'ready') { this.emit(); this.drawMap() }
    }
    const renderStarted = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.renderCost += performance.now() - renderStarted;
    this.needsRender = false;
    const duration = (performance.now() - this.frameWindow) / 1000;
    if (duration >= 1) {
      this.renderer.domElement.dataset.performance = JSON.stringify({ fps: Math.round(this.frameCount / duration), physicsMs: Math.round(this.physicsCost / this.frameCount * 10) / 10, renderMs: Math.round(this.renderCost / this.frameCount * 10) / 10, longestFrameMs: Math.round(this.longestFrame * 1000), calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles });
      this.frameCount = 0; this.longestFrame = 0; this.physicsCost = 0; this.renderCost = 0; this.frameWindow = performance.now();
    }
  };

  private resize = () => {
    this.needsRender = true;
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
  private visibility = () => { this.resetFrameStats(); this.needsRender = true; if (document.hidden) this.pause() };
}
