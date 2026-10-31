import * as THREE from 'three';
import type { CinematicKind, CinematicSnapshot, Point3 } from '../types';

interface CameraKeyframe {
  time: number;
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  shot: string;
}

export class RaceCinematic {
  private kind?: CinematicKind;
  private elapsed = 0;
  private duration = 0;
  private heading = 0;
  private shot = '';
  private frames: CameraKeyframe[] = [];
  private offset = new THREE.Vector3();
  private target = new THREE.Vector3();
  private worldTarget = new THREE.Vector3();

  start(kind: CinematicKind, camera: THREE.PerspectiveCamera, focus: Point3, heading: number, motorcycle: boolean, reducedMotion: boolean) {
    this.kind = kind;
    this.elapsed = 0;
    this.duration = reducedMotion ? 0.6 : kind === 'intro' ? 5.4 : 4.8;
    this.heading = heading;
    const scale = motorcycle ? 0.78 : 1;
    const height = motorcycle ? 0.55 : 0.3;
    const followDistance = motorcycle ? 11.2 : 13.2;
    const followHeight = motorcycle ? 2.35 : 2.65;
    const followFov = motorcycle ? 40 : 38;
    const frame = (time: number, x: number, y: number, z: number, fov: number, shot: string, lookAhead = 0) => ({
      time,
      position: new THREE.Vector3(x * scale, y, z * scale),
      target: new THREE.Vector3(0, height, lookAhead),
      fov,
      shot,
    });
    const follow: CameraKeyframe = {
      time: this.duration,
      position: new THREE.Vector3(0, followHeight, -followDistance),
      target: new THREE.Vector3(0, 0.55, 12),
      fov: followFov,
      shot: '准备出发',
    };
    if (reducedMotion) {
      follow.shot = kind === 'intro' ? '准备出发' : kind === 'escaped' ? '逃脱成功' : kind === 'caught' ? '追捕结束' : '挑战结束';
      this.frames = [{ ...follow, time: 0 }, follow];
    } else if (kind === 'intro') {
      this.frames = [
        frame(0, 5.8, 1.25, 8.8, 36, '雨夜集结'),
        frame(1.7, 6.3, 0.5, 1.8, 34, '引擎就绪'),
        frame(3.25, 5.2, 1.3, -6.6, 36, '准备出发'),
        follow,
      ];
    } else if (kind === 'escaped') {
      this.frames = [
        frame(0, 6.8, 1.4, 8.5, 38, '冲破追捕'),
        frame(2.1, 10.2, 2.4, 7, 35, '自由在前方', 1),
        frame(4.8, 12, 12, -15, 43, '逃脱成功', 3),
      ];
    } else if (kind === 'caught') {
      this.frames = [
        frame(0, -7.5, 1.05, 6, 40, '封锁现场'),
        frame(2, -9, 3.6, -2.5, 39, '无路可退'),
        frame(4.8, -5, 17, -10, 44, '追捕结束'),
      ];
    } else {
      this.frames = [
        frame(0, 6.8, 1.6, -5.8, 38, '失控瞬间'),
        frame(2.2, 7.3, 1.1, 2.6, 35, '事故现场'),
        frame(4.8, 4.5, 5.5, 9.5, 40, '挑战结束'),
      ];
    }
    this.shot = this.frames[0].shot;
    this.update(0, camera, focus);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, focus: Point3) {
    if (!this.kind) return false;
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    let index = 0;
    while (index < this.frames.length - 2 && this.elapsed >= this.frames[index + 1].time) index++;
    const from = this.frames[index], to = this.frames[index + 1];
    const progress = THREE.MathUtils.smootherstep(this.elapsed, from.time, to.time);
    this.offset.lerpVectors(from.position, to.position, progress);
    this.target.lerpVectors(from.target, to.target, progress);
    this.toWorld(this.offset, focus, camera.position);
    this.toWorld(this.target, focus, this.worldTarget);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.worldTarget);
    camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, progress);
    camera.updateProjectionMatrix();
    this.shot = this.elapsed >= this.duration ? to.shot : from.shot;
    return this.elapsed >= this.duration;
  }

  get snapshot(): CinematicSnapshot | undefined {
    return this.kind ? { kind: this.kind, elapsed: this.elapsed, duration: this.duration, shot: this.shot } : undefined;
  }

  reset() {
    this.kind = undefined;
    this.elapsed = 0;
    this.frames = [];
  }

  private toWorld(offset: THREE.Vector3, focus: Point3, result: THREE.Vector3) {
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    result.set(focus.x + offset.x * cos + offset.z * sin, focus.y + offset.y, focus.z - offset.x * sin + offset.z * cos);
  }
}
