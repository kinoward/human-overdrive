import * as THREE from 'three';
import { readReplayChannel, ReplayVisualCache, type ReplayAppearance, type ReplaySource } from './replay-visuals';
import type { Outcome } from '../types';

export const REPLAY_STRIDE = 48;
const MAX_ACTORS = 96;
const HISTORY_FRAMES = 1201;

export interface ReplayFrame {
  time: number;
  sceneTime: number;
  count: number;
  ids: Int32Array;
  data: Float32Array;
  appearances: ReplayAppearance[];
  references: number;
}

export interface ReplayClip {
  title: string;
  priority: number;
  eventTime: number;
  subject?: number;
  start: number;
  end: number;
  frames: ReplayFrame[];
}

export class ReplayBuffer {
  private history: (ReplayFrame | undefined)[] = new Array(HISTORY_FRAMES);
  private head = 0;
  private size = 0;
  private candidates: ReplayClip[] = [];
  private pool = new Map<number, ReplayFrame[]>();
  private identities = new Map<string, { id: number; seen: number }>();
  private nextId = 1;
  private assets = new ReplayVisualCache();
  private time = 0;
  private lastCleanup = 0;
  private liveBytes = 0;
  private samples = 0;
  private selection: { source: ReplaySource; distance: number }[] = [];

  capture(time: number, sceneTime: number, focus: THREE.Vector3, sources: readonly ReplaySource[]) {
    this.time = time;
    this.selection.length = 0;
    for (const source of sources) {
      const distance = source.root.position.distanceToSquared(focus);
      if (source.priority > 0 && distance > 480 * 480) continue;
      this.selection.push({ source, distance: source.priority * 1000000 + distance });
    }
    this.selection.sort((a, b) => a.distance - b.distance);
    const count = Math.min(MAX_ACTORS, this.selection.length);
    const capacity = Math.max(16, Math.ceil(count / 16) * 16);
    if (this.size === HISTORY_FRAMES) {
      this.release(this.history[this.head]!);
    } else this.size++;
    const frame = this.pool.get(capacity)?.pop() ?? {
      time: 0, sceneTime: 0, count: 0,
      ids: new Int32Array(capacity), data: new Float32Array(capacity * REPLAY_STRIDE),
      appearances: [], references: 0,
    };
    frame.time = time; frame.sceneTime = sceneTime; frame.count = count; frame.references = 1;
    this.liveBytes += frame.data.byteLength + frame.ids.byteLength;
    for (let index = 0; index < count; index++) {
      const source = this.selection[index].source;
      let identity = this.identities.get(source.key);
      if (!identity) { identity = { id: this.nextId++, seen: time }; this.identities.set(source.key, identity) }
      identity.seen = time;
      frame.ids[index] = identity.id;
      frame.appearances[index] = this.assets.capture(source);
      const offset = index * REPLAY_STRIDE, root = source.root;
      root.position.toArray(frame.data, offset);
      root.quaternion.toArray(frame.data, offset + 3);
      frame.data[offset + 7] = source.speed();
      frame.data[offset + 8] = source.opacity();
      root.scale.toArray(frame.data, offset + 9);
      frame.data[offset + 12] = Number(root.visible);
      source.channels.forEach((channel, component) => { frame.data[offset + 13 + component] = readReplayChannel(channel) });
    }
    this.history[this.head] = frame;
    this.head = (this.head + 1) % HISTORY_FRAMES;
    this.samples++;
    for (const clip of this.candidates) {
      if (time > clip.end + 0.001 || time < clip.start) continue;
      clip.frames.push(frame); frame.references++;
    }
    if (time - this.lastCleanup > 1) {
      this.lastCleanup = time;
      for (const [key, identity] of this.identities) if (time - identity.seen > 21) this.identities.delete(key);
    }
  }

  mark(title: string, priority: number, time = this.time, subjectKey?: string) {
    const identity = subjectKey ? this.identities.get(subjectKey) : undefined;
    const subject = identity?.id;
    if (subjectKey && (!identity || time - identity.seen > 0.1)) return;
    const overlapping = this.candidates.find(clip => time >= clip.start && time <= clip.end && time - clip.start < 7);
    if (overlapping) {
      overlapping.end = Math.min(overlapping.start + 8, Math.max(overlapping.end, time + 4));
      if (priority > overlapping.priority) Object.assign(overlapping, { title, priority, eventTime: time, subject });
      return;
    }
    if (this.candidates.length >= 6) {
      const weakest = this.candidates.reduce((a, b) => a.priority < b.priority ? a : b);
      if (weakest.priority >= priority) return;
      this.drop(weakest);
      this.candidates.splice(this.candidates.indexOf(weakest), 1);
    }
    const clip: ReplayClip = { title, priority, eventTime: time, subject, start: Math.max(0, time - 3), end: time + 4, frames: [] };
    for (let index = 0; index < this.size; index++) {
      const frame = this.history[(this.head - this.size + index + HISTORY_FRAMES) % HISTORY_FRAMES]!;
      if (frame.time >= clip.start && frame.time <= clip.end) { clip.frames.push(frame); frame.references++ }
    }
    this.candidates.push(clip);
  }

  prepare(outcome: Outcome, reducedMotion: boolean) {
    const title = outcome === 'escaped' ? '最后的突围' : outcome === 'flipped' ? '失控之前' : '最后的追逐';
    this.mark(title, 12, this.time);
    const selected: ReplayClip[] = [];
    for (const clip of [...this.candidates].sort((a, b) => b.priority - a.priority)) {
      if (clip.subject !== undefined) {
        while (clip.frames.length && !clip.frames[0].ids.subarray(0, clip.frames[0].count).includes(clip.subject)) this.release(clip.frames.shift()!);
        const missing = clip.frames.findIndex(frame => !frame.ids.subarray(0, frame.count).includes(clip.subject!));
        if (missing >= 0) clip.frames.splice(missing).forEach(frame => this.release(frame));
      }
      if (clip.frames.length < 2 || clip.frames.at(-1)!.time - clip.frames[0].time < 0.5) continue;
      clip.start = clip.frames[0].time;
      clip.end = clip.frames.at(-1)!.time;
      if (selected.some(other => clip.start <= other.end + 0.4 && clip.end >= other.start - 0.4)) continue;
      selected.push(clip);
      if (selected.length >= (reducedMotion ? 1 : 3)) break;
    }
    if (!selected.length) {
      this.candidates.forEach(clip => this.drop(clip));
      this.candidates = [];
      this.mark(title, 12, this.time);
      const fallback = this.candidates[0];
      if (fallback?.frames.length >= 2) {
        fallback.start = fallback.frames[0].time;
        fallback.end = fallback.frames.at(-1)!.time;
        selected.push(fallback);
      }
    }
    for (const clip of this.candidates) if (!selected.includes(clip)) this.drop(clip);
    this.candidates = selected.sort((a, b) => a.start - b.start);
    for (const frame of this.history) if (frame) this.release(frame);
    this.history.fill(undefined); this.size = 0; this.head = 0;
    this.pool.clear(); this.identities.clear(); this.assets.reset(); this.selection.length = 0;
    return this.candidates;
  }

  get stats() {
    return { samples: this.samples, candidates: this.candidates.length, historyFrames: this.size, poseMiB: Math.round(this.liveBytes / 1048576 * 10) / 10 };
  }

  reset() {
    for (const frame of this.history) if (frame) this.release(frame);
    for (const clip of this.candidates) this.drop(clip);
    this.history.fill(undefined); this.head = 0; this.size = 0;
    this.candidates = []; this.pool.clear(); this.identities.clear(); this.assets.reset();
    this.nextId = 1; this.time = 0; this.samples = 0; this.lastCleanup = 0; this.liveBytes = 0; this.selection.length = 0;
  }

  private drop(clip: ReplayClip) { clip.frames.forEach(frame => this.release(frame)); clip.frames = [] }

  private release(frame: ReplayFrame) {
    if (--frame.references > 0) return;
    this.liveBytes -= frame.data.byteLength + frame.ids.byteLength;
    frame.appearances.length = 0;
    const capacity = frame.ids.length;
    const pool = this.pool.get(capacity) ?? [];
    if (pool.length < 4) { pool.push(frame); this.pool.set(capacity, pool) }
  }
}
