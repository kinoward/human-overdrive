import * as THREE from 'three';
import type { Outcome, ReplaySnapshot } from '../types';
import { ReplayBuffer, REPLAY_STRIDE, type ReplayClip } from './replay-buffer';
import { ReplayVisuals, type ReplaySource } from './replay-visuals';

export class RaceReplay {
  readonly buffer = new ReplayBuffer();
  readonly focus = new THREE.Vector3();
  heading = 0;
  sceneTime = 0;
  speed = 0;
  private clips: ReplayClip[] = [];
  private clipIndex = 0;
  private playhead = 0;
  private elapsed = 0;
  private duration = 0;
  private visuals?: ReplayVisuals;
  private originals: { object: THREE.Object3D; visible: boolean }[] = [];
  private cameraPosition = new THREE.Vector3();
  private cameraRotation = new THREE.Quaternion();
  private cameraFov = 38;
  private reducedMotion = false;
  private forward = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private slowMotion = false;

  constructor(private scene: THREE.Scene) {}

  capture(time: number, sceneTime: number, sources: readonly ReplaySource[]) {
    this.buffer.capture(time, sceneTime, sources[0].root.position, sources);
  }

  mark(title: string, priority: number, time: number, subject?: string) { this.buffer.mark(title, priority, time, subject) }

  begin(outcome: Outcome, originals: THREE.Object3D[], camera: THREE.PerspectiveCamera) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.clips = this.buffer.prepare(outcome, this.reducedMotion);
    if (!this.clips.length) return false;
    this.cameraPosition.copy(camera.position); this.cameraRotation.copy(camera.quaternion); this.cameraFov = camera.fov;
    this.originals = originals.map(object => ({ object, visible: object.visible }));
    this.originals.forEach(({ object }) => { object.visible = false });
    this.clipIndex = 0; this.elapsed = 0;
    this.playhead = this.clips[0].start;
    this.duration = this.clips.reduce((total, clip) => total + clip.end - clip.start, 0);
    this.visuals = new ReplayVisuals(this.scene);
    this.update(0, camera);
    return true;
  }

  update(dt: number, camera: THREE.PerspectiveCamera): boolean {
    const clip = this.clips[this.clipIndex];
    this.slowMotion = !this.reducedMotion && Math.abs(this.playhead - clip.eventTime) < 0.65;
    this.playhead = Math.min(clip.end, this.playhead + dt * (this.reducedMotion ? 1.25 : this.slowMotion ? 0.55 : 1.2));
    let low = 0, high = clip.frames.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (clip.frames[mid].time <= this.playhead) low = mid; else high = mid - 1;
    }
    const a = clip.frames[low], b = clip.frames[Math.min(low + 1, clip.frames.length - 1)];
    const alpha = b.time > a.time ? THREE.MathUtils.clamp((this.playhead - a.time) / (b.time - a.time), 0, 1) : 0;
    this.sceneTime = THREE.MathUtils.lerp(a.sceneTime, b.sceneTime, alpha);
    this.visuals!.beginFrame();
    const subject = clip.subject === undefined ? 0 : a.ids.subarray(0, a.count).indexOf(clip.subject);
    for (let index = 0; index < a.count; index++) {
      const next = b.ids.subarray(0, b.count).indexOf(a.ids[index]);
      const offset = index * REPLAY_STRIDE;
      const compatible = next >= 0 && a.appearances[index].channels.length === b.appearances[next].channels.length;
      const root = this.visuals!.show(a.ids[index], a.appearances[index], a.data, offset,
        compatible ? b.data : a.data, compatible ? next * REPLAY_STRIDE : offset, compatible ? alpha : 0);
      if (index === (subject >= 0 ? subject : 0)) {
        this.focus.copy(root.position);
        this.speed = a.data[offset + 7];
        this.forward.set(0, 0, 1).applyQuaternion(root.quaternion);
        if (this.forward.x * this.forward.x + this.forward.z * this.forward.z > 0.2) {
          const heading = Math.atan2(this.forward.x, this.forward.z);
          const turn = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading));
          this.heading = dt === 0 ? heading : this.heading + turn * (1 - Math.exp(-dt * 6));
        }
      }
    }
    this.visuals!.endFrame(this.focus);
    const progress = (this.playhead - clip.start) / Math.max(0.001, clip.end - clip.start);
    const side = this.clipIndex % 2 === 0 ? 1 : -1;
    const angle = this.reducedMotion ? Math.PI : this.heading + side * (0.9 + progress * 0.35);
    if (this.reducedMotion) this.desired.set(-Math.sin(this.heading) * 14, 3, -Math.cos(this.heading) * 14);
    else this.desired.set(Math.sin(angle) * 14, this.clipIndex === 2 ? 5.5 + progress * 2 : 2.7 + progress * 0.7, Math.cos(angle) * 14);
    camera.position.copy(this.focus).add(this.desired);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.focus.x + this.forward.x, this.focus.y + 0.4, this.focus.z + this.forward.z);
    camera.fov = this.reducedMotion ? 40 : 38;
    camera.updateProjectionMatrix();
    if (this.playhead < clip.end) return false;
    if (this.clipIndex + 1 >= this.clips.length) return true;
    this.elapsed += clip.end - clip.start;
    this.clipIndex++;
    this.playhead = this.clips[this.clipIndex].start;
    return this.update(0, camera);
  }

  get active() { return !!this.visuals }

  get snapshot(): ReplaySnapshot | undefined {
    const clip = this.clips[this.clipIndex];
    return this.active && clip ? {
      title: clip.title, clip: this.clipIndex + 1, clips: this.clips.length,
      elapsed: this.elapsed + this.playhead - clip.start, duration: this.duration,
      raceTime: this.playhead, slowMotion: this.slowMotion,
    } : undefined;
  }

  stop(camera: THREE.PerspectiveCamera) {
    if (this.active) {
      camera.position.copy(this.cameraPosition); camera.quaternion.copy(this.cameraRotation); camera.fov = this.cameraFov;
      camera.updateProjectionMatrix();
    }
    this.visuals?.dispose(); this.visuals = undefined;
    this.originals.forEach(({ object, visible }) => { object.visible = visible });
    this.originals = []; this.clips = []; this.buffer.reset();
  }
}
