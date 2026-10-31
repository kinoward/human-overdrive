import { HELICOPTER_ARRIVAL_TIMES } from '../config';
import type { GameSnapshot, Outcome } from '../types';
import { MUSIC_CUES } from './music-cues';

type MusicScene = keyof typeof MUSIC_CUES;
interface MusicDeck { audio: HTMLAudioElement; gain: GainNode }

export class MusicController {
  private context?: AudioContext;
  private master?: GainNode;
  private decks: MusicDeck[] = [];
  private active = 0;
  private scene: MusicScene = 'menu';
  private paused = false;
  private muted = false;
  private revision = 0;
  private fadeTimer?: number;
  private playAttempt?: { cancelled: boolean };
  private needsGesture = false;
  private playFailed = false;

  constructor() {
    document.addEventListener('pointerdown', this.unlock);
    document.addEventListener('keydown', this.unlock);
    document.addEventListener('visibilitychange', () => this.syncPlayback());
  }

  startRace() {
    this.paused = false;
    this.select('drive', true);
  }

  showMenu() {
    this.paused = false;
    this.select('menu');
    this.syncPlayback();
  }

  finish(outcome: Outcome) {
    this.paused = false;
    this.select(outcome === 'escaped' ? 'escaped' : 'failed');
  }

  update(snapshot: GameSnapshot) {
    if (snapshot.status === 'finished') return;
    if (snapshot.status === 'ready') { this.showMenu(); return }
    this.paused = snapshot.status === 'paused';
    if (!this.paused) this.select(snapshot.elapsed >= HELICOPTER_ARRIVAL_TIMES[0] ? 'pursuit' : 'drive');
    this.syncPlayback();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.context && this.master) this.master.gain.setValueAtTime(muted ? 0 : 1, this.context.currentTime);
  }

  private unlock = () => {
    this.needsGesture = false;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.context.destination);
      this.decks = Array.from({ length: 2 }, () => {
        const audio = new Audio();
        audio.preload = 'auto';
        audio.hidden = true;
        audio.addEventListener('error', () => console.error('背景音乐加载失败', audio.error));
        const gain = this.context!.createGain();
        gain.gain.value = 0;
        this.context!.createMediaElementSource(audio).connect(gain).connect(this.master!);
        document.body.append(audio);
        return { audio, gain };
      });
      this.prepare(this.decks[this.active]);
    }
    void this.context.resume().catch(error => console.error('背景音乐启动失败', error));
    this.syncPlayback();
  };

  private prepare(deck: MusicDeck) {
    const cue = MUSIC_CUES[this.scene];
    deck.audio.src = cue.src;
    deck.audio.loop = cue.loop;
    deck.audio.dataset.musicCue = this.scene;
    deck.gain.gain.cancelScheduledValues(this.context!.currentTime);
    deck.gain.gain.value = 0;
  }

  private select(scene: MusicScene, restart = false) {
    if (this.scene === scene && !restart) return;
    this.scene = scene;
    this.revision++;
    this.playFailed = false;
    if (!this.context) return;
    if (this.playAttempt) this.playAttempt.cancelled = true;
    this.playAttempt = undefined;
    window.clearTimeout(this.fadeTimer);
    this.active = 1 - this.active;
    const incoming = this.decks[this.active];
    incoming.audio.pause();
    this.prepare(incoming);
    this.syncPlayback();
  }

  private syncPlayback() {
    if (!this.context) return;
    const current = this.decks[this.active];
    const outgoing = this.decks[1 - this.active];
    if (this.paused || document.hidden) {
      if (this.playAttempt) this.playAttempt.cancelled = true;
      this.playAttempt = undefined;
      window.clearTimeout(this.fadeTimer);
      for (const deck of this.decks) {
        deck.audio.pause();
        deck.gain.gain.cancelScheduledValues(this.context.currentTime);
        deck.gain.gain.setValueAtTime(deck === current ? MUSIC_CUES[this.scene].volume : 0, this.context.currentTime);
      }
      return;
    }
    if (this.needsGesture || this.playFailed || this.playAttempt || !current.audio.paused || current.audio.ended) return;
    const revision = this.revision;
    const attempt = { cancelled: false };
    this.playAttempt = attempt;
    void current.audio.play().then(() => {
      if (attempt.cancelled || revision !== this.revision || this.paused || document.hidden) return;
      const now = this.context!.currentTime;
      current.gain.gain.cancelAndHoldAtTime(now);
      current.gain.gain.linearRampToValueAtTime(MUSIC_CUES[this.scene].volume, now + 0.7);
      outgoing.gain.gain.cancelAndHoldAtTime(now);
      outgoing.gain.gain.linearRampToValueAtTime(0, now + 0.7);
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = window.setTimeout(() => outgoing.audio.pause(), 720);
    }).catch(error => {
      if (attempt.cancelled || revision !== this.revision || this.paused || document.hidden) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') { this.needsGesture = true; return }
      this.playFailed = true;
      console.error('背景音乐播放失败', error);
    }).finally(() => {
      if (this.playAttempt === attempt) this.playAttempt = undefined;
    });
  }
}
