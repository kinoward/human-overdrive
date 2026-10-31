import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CITIES, getHelicopterTarget, getPoliceTarget, INITIAL_POLICE_COUNT, MAX_POLICE_COUNT, VEHICLES } from '../config';
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
import { buildResult, calculateScore } from './rules';
import { DrivingScore } from './driving-score';
import { GameAudio } from './audio';
import { TrafficSimulation, type TrafficAgent, type TrafficObstacle } from './traffic';
import { TRAFFIC_COUNT, trafficVehicleForSlot } from './traffic-vehicles';
import { TrafficMotionLimiter } from './traffic-motion';
import { TrafficCollisionResponse } from './traffic-physics';
import { animateTrafficWheels, createTrafficVehicleModel, loadTrafficModels } from './traffic-models';
import { ArcadeCameraMotion } from './camera-motion';
import type { Controls } from './arcade-driving';
import { roadAt } from './road-network';
import { RenderPose } from './render-pose';
import { loadGeneratedAssets } from './generated-assets';
import { VehicleDamage } from './vehicle-damage';
import { DamageDebris } from './damage-debris';
import { RaceMinimap } from './minimap';
import { createCyberScene } from './cyber-scene';

interface TrafficCar {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  model: ReturnType<typeof createTrafficVehicleModel>;
  driver: TrafficAgent;
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
  private scenery?: ReturnType<typeof createCyberScene>;
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
  private nickname = '公路旅人';
  private wrongWay = false;
  private capture = 0;
  private captureOrigin = new THREE.Vector3();
  private escapeTime = 0;
  private flippedTime = 0;
  private drivingScore = new DrivingScore();
  private lastPosition = new THREE.Vector3();
  private event = '沿四环自由驾驶，累计 20 公里即可逃脱';
  private eventTone: GameSnapshot['eventTone'] = 'neutral';
  private eventUntil = 0;
  private cameraPosition = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  private hudAt = 0;
  private mapCanvas = document.createElement('canvas');
  private minimap?: RaceMinimap;
  private lookBack = false;
  private ready = false;
  private cameraHeading = 0;
  private cameraAnchor = new THREE.Vector3();
  private frameCount = 0;
  private frameWindow = performance.now();
  private longestFrame = 0;
  private physicsCost = 0;
  private renderCost = 0;
  private sectionCost = { traffic: 0, police: 0, world: 0, contacts: 0 };
  private needsRender = true;
  private shadowRight = new THREE.Vector3(45, 0, -55).normalize();
  private shadowUp = new THREE.Vector3().crossVectors(new THREE.Vector3(55, -90, 45).normalize(), this.shadowRight).normalize();
  private shadowCenter = new THREE.Vector3();
  private barrierCells = new Map<string, NonNullable<WorldData['obstacles']>>();
  private activeBarriers = new Map<string, RAPIER.Collider[]>();
  private barrierCell = '';
  private trafficSimulation?: TrafficSimulation;
  private trafficMotion?: TrafficMotionLimiter;
  private trafficResponse = new TrafficCollisionResponse();
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
    this.mapCanvas.className = 'race-map';
    this.mapCanvas.style.display = 'none';
    this.mapCanvas.setAttribute('role', 'img');
    this.mapCanvas.setAttribute('aria-label', '车头朝上的附近路网与追捕位置');
    document.querySelector('#scene')!.append(this.mapCanvas);
    new ResizeObserver(this.resize).observe(document.querySelector('#scene')!);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
    this.resize();
  }

  async init(onProgress?: (progress: number, message: string) => Promise<void>) {
    await onProgress?.(0.05, '加载车辆与场景模型');
    let physicsReady = 0, modelsProgress = 0, trafficReady = 0;
    const reportAssets = async () => { await onProgress?.(0.05 + (physicsReady + modelsProgress + trafficReady) / 3 * 0.4, '加载车辆与场景模型'); };
    await Promise.all([
      RAPIER.init().then(async () => { physicsReady = 1; await reportAssets(); }),
      loadGeneratedAssets(async (loaded, total) => { modelsProgress = loaded / total; await reportAssets(); }),
      loadTrafficModels().then(async () => { trafficReady = 1; await reportAssets(); }),
    ]);
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.physics.timestep = 1 / 60;
    this.events = new RAPIER.EventQueue(true);
    this.track = await buildWorld(this.scene, async (progress, message) => { await onProgress?.(0.45 + progress * 0.4, message); });
    await onProgress?.(0.87, '准备道路碰撞');
    this.minimap = new RaceMinimap(this.mapCanvas, this.track.roads);
    this.collisionSystem = new CollisionSystem(this.physics, this.events);
    for (const surface of this.track.surfaces) this.physics.createCollider(RAPIER.ColliderDesc.trimesh(surface.vertices, surface.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.9).setCollisionGroups(ROAD_GROUPS));
    await onProgress?.(0.92, '准备空域与道路边界');
    this.airspace = new Airspace(this.physics);
    this.airspace.addScene(this.scene);
    this.scenery = createCyberScene(this.renderer, this.scene, this.track.roads, this.track.spawn.position, this.sun);
    for (const obstacle of this.track.obstacles ?? []) {
      const key = `${Math.floor(obstacle.center.x / 500)},${Math.floor(obstacle.center.z / 500)}`;
      if (!this.barrierCells.has(key)) this.barrierCells.set(key, []);
      this.barrierCells.get(key)!.push(obstacle);
    }
    this.updateRoadColliders(this.track.spawn.position);
    this.renderer.domElement.dataset.course = JSON.stringify({ mainLoopKm: this.track.mainLoopLength / 1000, roads: this.track.roads.length, source: this.track.source });
    await onProgress?.(0.97, '准备驾驶场景');
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
    this.metrics = { vehicleId, elapsed: 0, distance: 0, targetDistance: CITIES[0].targetDistance, nearMisses: 0, collisions: 0, maxPoliceCount: 0, maxPressureTime: 0, maxPressureDistance: 0, topSpeed: 0, cleanDistance: 0, pressureDistance: 0, evadedAttacks: 0 };
    this.status = 'running';
    this.resetFrameStats();
    this.needsRender = true;
    this.capture = 0;
    this.flippedTime = 0;
    this.drivingScore = new DrivingScore();
    this.collisionSystem.reset();
    this.nextSight = 0;
    this.pursuit = new PolicePursuit(this.physics, this.scene, this.track.roads, { isVisible: this.isVisible });
    this.accumulator = 0;
    this.simulationTime = 0;
    this.keys.clear();
    this.lastPosition.copy(this.player.body.translation());
    this.event = '20 公里逃脱 · 警方已出动，随时间增援';
    this.eventTone = 'neutral';
    this.eventUntil = 5;
    this.spawnTraffic();
    this.cameraPosition.set(0, 0, 0);
    this.cameraMotion.reset();
    this.updateCamera(1);
    this.pursuit.initialize(INITIAL_POLICE_COUNT, this.player, this.trafficObstacles());
    this.metrics.maxPoliceCount = this.pursuit.activeCars.length;
    this.updateRoadColliders(this.player.body.translation());
    this.mapCanvas.style.display = '';
    this.minimap!.reset();
    this.drawMap();
    this.audio.start();
    this.renderer.domElement.focus();
    this.emit();
  }

  pause() {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.needsRender = true;
    this.keys.clear();
    this.audio.update(0, false, false);
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
    this.audio.update(0, false, false);
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
    this.trafficMotion = undefined;
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
        RAPIER.ColliderDesc.roundCuboid(obstacle.halfExtents.x - 0.12, obstacle.halfExtents.y - 0.12, obstacle.halfExtents.z - 0.12, 0.12)
          .setTranslation(obstacle.center.x, obstacle.center.y, obstacle.center.z)
          .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(obstacle.pitch ?? 0, obstacle.rotation, 0, 'YXZ'))).setFriction(0.02).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setCollisionGroups(BARRIER_GROUPS)
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
    this.trafficMotion = new TrafficMotionLimiter(this.physics);
    const focus = { position: this.player!.body.translation(), heading: this.player!.heading, speed: 0, lookBack: false };
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const profile = trafficVehicleForSlot(i);
      const driver = this.trafficSimulation.addCar(i, profile, focus);
      if (!driver) continue;
      const model = createTrafficVehicleModel(profile, palette[i % palette.length]);
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(driver.pitch, driver.heading, 0, 'YXZ'));
      const position = { x: driver.position.x, y: driver.position.y + 0.79, z: driver.position.z };
      const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z).setRotation(rotation).setLinearDamping(0.12).setAngularDamping(0.65).setCcdEnabled(true));
      const collider = this.physics.createCollider(RAPIER.ColliderDesc.roundCuboid(profile.width * 0.5 - 0.1, Math.max(0.25, (profile.height - 0.32) * 0.5) - 0.1, profile.length * 0.5 - 0.1, 0.1).setTranslation(0, profile.height * 0.5 - 0.79, 0).setMass(profile.mass).setFriction(0.3).setRestitution(0.08).setCollisionGroups(GROUND_BODY_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(profile.mass * 0.4), body);
      this.trafficMotion.register(driver.id, body, collider);
      this.scene.add(model.group);
      model.group.position.copy(position); model.group.quaternion.copy(rotation);
      this.traffic.push({ body, collider, model, driver, appearance: 1, pose: new RenderPose(model.group) });
    }
  }

  private spawnPolice() {
    if (!this.player || !this.pursuit) return;
    this.pursuit.spawn(getPoliceTarget(this.metrics.elapsed), this.player, this.trafficObstacles());
    const player = this.player.body.translation();
    while (this.helicopters.length < getHelicopterTarget(this.metrics.elapsed)) {
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
    const onRoad = !!roadAt(this.track.roads, { x: position.x, y: position.y - 0.85, z: position.z }, 1);
    this.player.drive(this.readControls(), dt, onRoad);
    this.lookBack = this.keys.has('KeyC');
    const trafficAt = performance.now();
    this.updateTraffic(dt);
    this.sectionCost.traffic += performance.now() - trafficAt;
    const pursuitAt = performance.now();
    this.updatePolice(dt);
    this.sectionCost.police += performance.now() - pursuitAt;
    this.trafficResponse.release(this.traffic, [this.player.body, ...this.police.map(actor => actor.vehicle.body)], dt);
    this.collisionSystem.beforeStep({ body: this.player.body, collider: this.player.collider, kind: 'player' }, [
      ...this.police.map(actor => ({ body: actor.vehicle.body, collider: actor.vehicle.collider, kind: 'police' as const })),
      ...this.traffic.map(actor => ({ body: actor.body, collider: actor.collider, kind: 'traffic' as const }))
    ], dt);
    const worldAt = performance.now();
    this.physics.step(this.events);
    this.sectionCost.world += performance.now() - worldAt;
    const contactsAt = performance.now();
    this.player.sync(this.simulationTime);
    this.pursuit?.sync(this.simulationTime);
    for (const helicopter of this.helicopters) helicopter.afterStep();
    for (const actor of this.traffic) {
      actor.pose.capture(actor.body.translation(), actor.body.rotation());
      actor.damage?.update(dt);
      if (actor.driver.dynamic) {
        const position = actor.body.translation(), velocity = actor.body.linvel();
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(actor.body.rotation());
        actor.driver.position = { x: position.x, y: position.y - 0.79, z: position.z };
        actor.driver.heading = Math.atan2(forward.x, forward.z);
        actor.driver.speed = Math.hypot(velocity.x, velocity.z);
        actor.driver.wheelDistance += (velocity.x * forward.x + velocity.z * forward.z) * dt;
      }
    }
    const contactBodies = this.processCollisions(dt);
    this.sectionCost.contacts += performance.now() - contactsAt;
    const next = this.player.body.translation();
    const roadPoint = { x: next.x, y: next.y - 0.85, z: next.z };
    const coveredRoad = roadAt(this.track.roads, roadPoint, 0.7);
    const nextRoad = coveredRoad ?? nearestRoad(this.track.roads, next.x, next.z, roadPoint.y);
    const roadValid = !!coveredRoad;
    const moved = new THREE.Vector3(next.x - this.lastPosition.x, next.y - this.lastPosition.y, next.z - this.lastPosition.z);
    let distance = 0;
    const grounded = this.player.model.wheels.some((_, index) => this.player!.controller.wheelIsInContact(index));
    if (roadValid && grounded && this.player.speed > 0.75 && this.player.upY > 0.35 && nextRoad && Math.abs(next.y - nextRoad.point.y) < 2 && moved.length() < 5) distance = Math.abs(moved.x * nextRoad.direction.x + moved.z * nextRoad.direction.z);
    distance = Math.min(distance, this.metrics.targetDistance - this.metrics.distance);
    this.metrics.distance += distance;
    this.metrics.topSpeed = Math.max(this.metrics.topSpeed, this.player.speed * 3.6);
    this.lastPosition.set(next.x, next.y, next.z);
    const velocity = this.player.body.linvel();
    this.wrongWay = !!nextRoad && nextRoad.road.oneWay && this.player.speed > 3 && (velocity.x * nextRoad.direction.x + velocity.z * nextRoad.direction.z) < -this.player.speed * 0.35;
    const previousTarget = getPoliceTarget(Math.max(0, this.metrics.elapsed - dt));
    const target = getPoliceTarget(this.metrics.elapsed);
    if (target > previousTarget) this.message(`警方增援 · 目标警力 ${target} 辆`, 'danger', 3);
    this.spawnPolice();
    this.metrics.maxPoliceCount = Math.max(this.metrics.maxPoliceCount, this.pursuit?.activeCars.length ?? 0);
    const nearbyPolice = this.pursuit?.effective(this.player).filter(actor => {
      const p = actor.vehicle.body.translation();
      return Math.hypot(p.x - next.x, p.z - next.z) < 180;
    }) ?? [];
    const controlled = distance > 0 && contactBodies.size === 0 && this.player.upY > 0.7 && this.player.speed > 5
      && velocity.x * Math.sin(this.player.heading) + velocity.z * Math.cos(this.player.heading) > this.player.speed * 0.5;
    const evaded = this.drivingScore.update(this.metrics, { dt, distance, controlled, nearbyPolice: nearbyPolice.length,
      fullPressure: (this.pursuit?.activeCars.length ?? 0) >= MAX_POLICE_COUNT && this.helicopters.length >= 3 && nearbyPolice.length >= 3 });
    if (evaded && !this.pursuit?.activeCars.some(actor => actor.state === 'positioning' || actor.state === 'contact')) {
      this.message('干净闪避 +2 技巧 · 继续拉开距离', 'good', 2);
    }
    this.checkNearMisses();
    const blockaded = this.player.speed < 1.8 && isCaptured(this.physics, { body: this.player.body, collider: this.player.collider, width: this.player.config.width, length: this.player.config.length }, (this.pursuit?.activeCars ?? []).map(actor => ({
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

  private updateTraffic(dt: number) {
    if (!this.player || !this.trafficSimulation) return;
    const obstacles: TrafficObstacle[] = [this.player, ...this.police.map(actor => actor.vehicle)].map(vehicle => ({
      position: vehicle.body.translation(), velocity: vehicle.body.linvel(), heading: vehicle.heading,
      length: vehicle.config.length, width: vehicle.config.width,
    }));
    obstacles.push(...this.traffic.filter(actor => actor.driver.dynamic).map(actor => ({ position: actor.body.translation(), velocity: actor.body.linvel(), heading: actor.driver.heading, length: actor.driver.length, width: actor.driver.width })));
    this.trafficMotion!.prepare([this.player.collider, ...this.police.map(actor => actor.vehicle.collider)]);
    this.trafficSimulation.update(dt, { position: this.player.body.translation(), heading: this.player.heading, speed: this.player.speed, lookBack: this.lookBack, velocity: this.player.body.linvel() }, obstacles, this.trafficMotion!.allows);
    for (const actor of this.traffic) {
      const driver = actor.driver;
      const translation = { x: driver.position.x, y: driver.position.y + 0.79, z: driver.position.z };
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(driver.pitch, driver.heading, 0, 'YXZ'));
      if (driver.relocated) {
        actor.appearance = 0;
        actor.damage?.dispose();
        actor.damage = undefined;
        actor.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        actor.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        actor.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        actor.body.setTranslation(translation, true);
        actor.body.setRotation(rotation, true);
        actor.pose.snap(translation, rotation);
        this.drivingScore.resetTraffic(actor.driver.id);
      }
      actor.appearance = Math.min(1, actor.appearance + dt / 1.5);
      actor.model.setOpacity(actor.appearance);
      if (!driver.dynamic) {
        actor.body.setNextKinematicTranslation(translation);
        actor.body.setNextKinematicRotation(rotation);
      }
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
    this.showPoliceEvents();
  }

  private showPoliceEvents() {
    if (!this.pursuit) return;
    const events = this.pursuit.drainEvents();
    if (!events.length) return;
    for (const event of events) if (event.type === 'evaded') this.drivingScore.evade(event.id);
    const attacks = this.pursuit.activeCars.filter(actor => actor.state === 'positioning' || actor.state === 'contact');
    const loss = events.find(event => event.type === 'flipped' || event.type === 'disabled');
    if (events.some(event => event.type === 'windup')) {
      const sides = [...new Set(attacks.map(actor => actor.role === 'left' ? '左侧' : actor.role === 'right' ? '右侧' : actor.role === 'intercept' ? '前方' : '后方'))];
      this.message(`${sides.join('、') || '附近'}警车准备冲撞 · 变线或刹车躲开`, 'danger', 1.7);
    } else if (loss) {
      const text = loss.type === 'flipped' ? '警车翻覆' : '警车受损退出追捕';
      this.message(`${text} · ${attacks.length ? '仍有警车逼近' : '抓住突围空档'}`, attacks.length ? 'neutral' : 'good', 2.8);
    } else if (events.some(event => event.type === 'evaded')) {
      this.message(attacks.length ? '躲开一轮冲撞 · 仍有警车逼近' : '闪开冲撞 · 趁警车恢复拉开距离', attacks.length ? 'neutral' : 'good', 2);
    }
  }

  private processCollisions(dt: number) {
    const result = this.collisionSystem.afterStep(dt);
    if (!this.player) return result.contactBodies;
    for (const impact of result.impacts) {
      if (impact.newIncident) {
        this.metrics.collisions++;
      }
      if (impact.newIncident || impact.feedback) this.drivingScore.impact(impact.severity);
      if (impact.feedback) {
        this.renderer.domElement.dataset.impact = JSON.stringify({ severity: impact.severity, deltaV: impact.deltaV, approachSpeed: impact.approachSpeed, strength: impact.strength });
        this.player.balanceDisabled = Math.max(this.player.balanceDisabled, impact.balanceDisabled);
        this.player.applyImpact(impact.point, impact.direction, impact.strength);
        const localDirection = new THREE.Vector3(impact.direction.x, impact.direction.y, impact.direction.z).applyQuaternion(new THREE.Quaternion().copy(this.player.body.rotation()).invert());
        this.cameraMotion.impact(impact.strength, localDirection.x);
        this.audio.impact(impact.strength);
        const text = impact.severity === 'heavy' ? '猛烈撞击 · 稳住车身' : impact.severity === 'medium' ? '发生撞击 · 连续干净驾驶已中断' : '车身擦碰 · 注意保持间距';
        this.message(text, 'danger', impact.severity === 'heavy' ? 2.5 : 1.5);
      }
      for (const actor of this.traffic) if (actor.body.handle === impact.otherBodyHandle) {
        if (impact.feedback && actor.model.group.userData.damageModel) {
          const base = VEHICLES.find(vehicle => vehicle.kind === actor.model.group.userData.damageModel)!;
          actor.damage ??= new VehicleDamage(actor.model.group, { ...base, width: actor.driver.width, length: actor.driver.length }, actor.body, this.physics);
          actor.damage.impact(new THREE.Vector3(impact.point.x, impact.point.y, impact.point.z), new THREE.Vector3(-impact.direction.x, -impact.direction.y, -impact.direction.z), impact.strength);
        }
      }
    }
    for (const impact of result.policeImpacts) {
      const actor = this.police.find(car => car.vehicle.body.handle === impact.bodyHandle);
      if (!actor || !impact.feedback) continue;
      actor.vehicle.applyImpact(impact.point, impact.direction, impact.strength);
      actor.vehicle.balanceDisabled = Math.max(actor.vehicle.balanceDisabled, impact.balanceDisabled);
      this.pursuit?.registerImpact(impact.bodyHandle, impact.strength, impact.deltaV, impact.approachSpeed, impact.otherBodyHandle === this.player.body.handle);
    }
    this.showPoliceEvents();
    return result.contactBodies;
  }

  private checkNearMisses() {
    if (!this.player) return;
    const player = { position: this.player.body.translation(), heading: this.player.heading, speed: this.player.speed,
      width: this.player.config.width, length: this.player.config.length };
    for (const actor of this.traffic) {
      if (actor.appearance < 1) continue;
      if (this.drivingScore.nearMiss(this.metrics, player, { id: actor.driver.id, position: actor.body.translation(),
        heading: actor.driver.heading, speed: actor.driver.speed, width: actor.driver.width, length: actor.driver.length })) {
        if (!this.pursuit?.activeCars.some(actor => actor.state === 'positioning' || actor.state === 'contact')
          && (this.eventTone !== 'danger' || this.simulationTime >= this.eventUntil)) {
          this.message(`干净超车 +1 技巧 · ${this.drivingScore.combo > 1 ? `${this.drivingScore.combo} 次连续交互` : '漂亮的擦身'}`, 'good', 2.5);
        }
      }
    }
  }

  private finish(outcome: RaceResult['outcome']) {
    if (this.status !== 'running') return;
    this.status = 'finished';
    this.needsRender = true;
    this.keys.clear();
    this.audio.update(0, false, false);
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
    this.renderer.domElement.dataset.scoring = JSON.stringify({ ...score, cleanDistance: this.metrics.cleanDistance, pressureDistance: this.metrics.pressureDistance, nearMisses: this.metrics.nearMisses, evadedAttacks: this.metrics.evadedAttacks, maxPressureTime: this.metrics.maxPressureTime, maxPressureDistance: this.metrics.maxPressureDistance });
    if (this.player) this.renderer.domElement.dataset.drive = JSON.stringify({ position: this.player.body.translation(), heading: this.player.heading, steering: this.player.steering, leanAngle: this.player.leanAngle, rotation: this.player.body.rotation(), upright: this.player.upY, speed: this.player.speed, controls: this.readControls(), damage: this.player.damage.summary, damageWork: this.player.damage.performance, wheels: this.player.model.wheels.map((_, index) => this.player!.controller.wheelIsInContact(index)) });
    this.renderer.domElement.dataset.pursuit = JSON.stringify({ police: this.police.map(actor => ({ id: actor.id, role: actor.role, state: actor.state, active: actor.activePursuit, operational: actor.operational, damage: actor.damage, upright: actor.vehicle.upY, disabledAt: actor.disabledAt, position: actor.vehicle.body.translation(), speed: actor.vehicle.speed })), helicopters: this.helicopters.map(actor => ({ position: actor.body.translation(), speed: actor.body.linvel(), observed: this.helicopterSight.get(actor) })), contacts: this.collisionSystem.contactCount, peakContacts: this.collisionSystem.peakContacts, capture: this.capture, collisions: this.metrics.collisions });
    if (this.player) {
      const position = this.player.body.translation(), heading = this.player.heading;
      const road = nearestRoad(this.track.roads, position.x, position.z, position.y - 0.85);
      this.renderer.domElement.dataset.road = JSON.stringify(road ? { id: road.road.id, along: road.distance, offset: road.offset, heading: Math.atan2(road.direction.x, road.direction.z), width: road.road.width } : null);
      const types: Record<string, number> = {};
      const wheels: Record<string, { count: number; radii: number[]; roll: number }> = {};
      let nearby = 0, ahead = 0;
      for (const actor of this.traffic) {
        const driver = actor.driver, dx = driver.position.x - position.x, dz = driver.position.z - position.z;
        types[driver.profile.id] = (types[driver.profile.id] ?? 0) + 1;
        if (!wheels[driver.profile.id]) wheels[driver.profile.id] = { count: actor.model.wheelSpecs.length, radii: actor.model.wheelSpecs.map(wheel => Math.round(wheel.radius * 1000) / 1000), roll: Math.round((actor.model.wheelSpecs[0]?.object.rotation.x ?? 0) * 1000) / 1000 };
        if (Math.hypot(dx, dz) < 260 && Math.abs(driver.position.y + 0.79 - position.y) < 2.2) {
          nearby++;
          if (dx * Math.sin(heading) + dz * Math.cos(heading) > 15 && Math.cos(driver.heading - heading) > 0.6) ahead++;
        }
      }
      this.renderer.domElement.dataset.traffic = JSON.stringify({ total: this.traffic.length, nearby, ahead, types, wheels });
    }
    this.onSnapshot({ status: this.status, speedKmh: this.player ? this.player.speed * 3.6 : 0, distance: this.metrics.distance, targetDistance: this.metrics.targetDistance, elapsed: this.metrics.elapsed, policeTarget: getPoliceTarget(this.metrics.elapsed), policeCount: this.pursuit?.activeCars.length ?? 0, helicopterCount: this.helicopters.length, score: score.score, stars: score.stars, combo: this.drivingScore.combo, nearMisses: this.metrics.nearMisses, collisions: this.metrics.collisions, wrongWay: this.wrongWay, captureProgress: this.capture, event: this.simulationTime < this.eventUntil ? this.event : '', eventTone: this.eventTone, vehicleId: this.metrics.vehicleId });
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
    if (!this.player || !this.minimap) return;
    this.minimap.draw({
      position: this.player.body.translation(),
      heading: this.player.heading,
      speedKmh: this.player.speed * 3.6,
      elapsed: this.metrics.elapsed,
      police: this.police.map(actor => ({ position: actor.vehicle.body.translation(), heading: actor.vehicle.heading, operational: actor.operational })),
      helicopters: this.helicopters.map(actor => actor.body.translation()),
    });
  }

  private resetFrameStats() {
    this.sectionCost = { traffic: 0, police: 0, world: 0, contacts: 0 };
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
      animateTrafficWheels(actor.model, actor.driver.wheelDistance - (1 - alpha) / 60 * actor.driver.speed);
    }
    if (this.ready) {
      this.updateCamera(dt);
      const { steer } = this.readControls();
      this.cameraMotion.update(this.camera, this.player?.speed ?? 0, steer, this.player?.config.kind === 'motorcycle', dt, this.status === 'running', this.lookBack);
    }
    this.audio.update(this.player?.speed ?? 0, (this.pursuit?.activeCars.length ?? 0) > 0, this.status === 'running');
    if (this.timer.getElapsed() - this.hudAt > 0.08) {
      this.hudAt = this.timer.getElapsed();
      if (this.status !== 'ready') { this.emit(); this.drawMap() }
    }
    const renderStarted = performance.now();
    const focus = this.player?.model.group.position ?? this.track.spawn.position;
    this.scenery!.render(this.camera, this.simulationTime, focus, this.player?.heading ?? this.track.spawn.heading);
    this.renderCost += performance.now() - renderStarted;
    this.needsRender = false;
    const duration = (performance.now() - this.frameWindow) / 1000;
    if (duration >= 1) {
      this.renderer.domElement.dataset.performance = JSON.stringify({ fps: Math.round(this.frameCount / duration), physicsMs: Math.round(this.physicsCost / this.frameCount * 10) / 10, renderMs: Math.round(this.renderCost / this.frameCount * 10) / 10, trafficMs: Math.round(this.sectionCost.traffic / this.frameCount * 10) / 10, pursuitMs: Math.round(this.sectionCost.police / this.frameCount * 10) / 10, worldMs: Math.round(this.sectionCost.world / this.frameCount * 10) / 10, contactMs: Math.round(this.sectionCost.contacts / this.frameCount * 10) / 10, longestFrameMs: Math.round(this.longestFrame * 1000), calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, bodies: this.physics.bodies.len(), colliders: this.physics.colliders.len(), fragments: DamageDebris.activeCount(this.physics) });
      this.frameCount = 0; this.longestFrame = 0; this.physicsCost = 0; this.renderCost = 0; this.frameWindow = performance.now();
      this.sectionCost = { traffic: 0, police: 0, world: 0, contacts: 0 };
    }
  };

  private resize = () => {
    const { width, height } = this.renderer.domElement.parentElement!.getBoundingClientRect();
    this.needsRender = true;
    this.renderer.setSize(width, height);
    this.scenery?.resize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.drawMap();
  };

  private readControls(): Controls {
    let throttle = 0, steer = 0;
    for (const code of this.keys) {
      if (code === 'KeyW' || code === 'ArrowUp') throttle = 1;
      else if (code === 'KeyS' || code === 'ArrowDown') throttle = -1;
      else if (code === 'KeyD' || code === 'ArrowRight') steer = 1;
      else if (code === 'KeyA' || code === 'ArrowLeft') steer = -1;
    }
    return { throttle, steer, brake: this.keys.has('Space') };
  }

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
