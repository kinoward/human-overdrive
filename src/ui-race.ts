import { TARGET_DISTANCE, VEHICLES } from './config';
import type { GameSnapshot } from './types';
import { uiIcon } from './ui-art';
import './ui-race.css';

const numeric = (value: number) => Math.round(value).toLocaleString('zh-CN');
const clock = (value: number) => {
  const tenths = Math.floor(value * 10);
  return `${Math.floor(tenths / 600).toString().padStart(2, '0')}:${Math.floor(tenths / 10 % 60).toString().padStart(2, '0')}.${tenths % 10}`;
};

export function raceHud(muted: boolean, soundLabel: string) {
  return `<div class="race-hud race-hud-arcade" data-race="hud" role="region" aria-label="比赛信息">
    <div class="r-speed-lines" aria-hidden="true">${Array.from({ length: 8 }, () => '<i></i>').join('')}</div>
    <div class="r-impact" data-race="impact" aria-hidden="true"></div>
    <section class="r-distance r-enter"><span class="r-eyebrow">逃脱进度</span><div class="r-percent"><strong data-race="percent">0</strong><span>%</span></div><div class="r-kilometers"><b data-race="distance">0.00</b><span> / <span data-race="target">${(TARGET_DISTANCE / 1000).toFixed(2)}</span> km</span></div></section>
    <section class="r-timer r-enter"><span class="r-eyebrow">逃亡计时</span><strong data-race="elapsed">00:00.0</strong><div class="r-route-track"><i data-race="progress"></i><span aria-hidden="true">▸</span></div><span class="r-route-caption">累计里程 · 冲出追捕</span></section>
    <section class="r-speed r-enter" aria-label="当前车速"><div class="r-speed-number"><strong data-race="speed">000</strong><span>km/h</span></div><div class="r-speed-meter" data-race="speed-bars" aria-hidden="true">${Array.from({ length: 20 }, () => '<i></i>').join('')}</div><span class="r-speed-status" data-race="speed-status">准备出发</span></section>
    <div class="r-actions"><button class="hud-button r-control" data-action="sound" aria-label="${muted ? '开启声音' : '关闭声音'}" aria-pressed="${muted}">${soundLabel}</button><button class="hud-button r-control" data-action="pause" aria-label="暂停驾驶">${uiIcon('pause')}<span>暂停</span></button></div>
    <section class="r-pursuit r-enter" data-race="pursuit"><div class="r-pursuit-head"><span class="r-eyebrow">完好警车</span><div><strong data-race="police">3</strong><span> / <b data-race="police-target">3</b></span></div></div><div class="r-police-meter" data-race="police-bars" aria-hidden="true">${Array.from({ length: 10 }, () => '<i></i>').join('')}</div><div class="r-air"><span>空中追踪</span><strong data-race="helicopters">0</strong><span>架</span></div></section>
    <div class="r-event" data-race="event-wrap" data-tone="neutral" aria-hidden="true"><span class="r-event-kicker" data-race="event-label">驾驶提示</span><strong data-race="event" aria-live="polite"></strong></div>
    <div class="r-alerts"><div class="r-wrong-way" data-race="wrong-way" aria-hidden="true"><span aria-hidden="true">↶</span><strong>逆向行驶</strong><span>注意迎面车流</span></div><div class="r-capture" data-race="capture" role="status" aria-hidden="true"><div class="r-capture-heading"><span aria-hidden="true">!</span><strong>冲出包围</strong><b><span data-race="capture-seconds">5.0</span><small> 秒后被捕</small></b></div><div class="r-capture-track"><i data-race="capture-bar"></i></div><span>恢复行驶，摆脱警方围堵</span></div></div>
    <section class="r-score r-enter" data-race="score-panel"><span class="r-eyebrow">车技分</span><strong class="r-score-number" data-race="score">0</strong><div class="r-score-detail"><span data-race="combo-label">干净驾驶</span><span>近失超车 <b data-race="near-miss">0</b></span></div><div class="r-combo" data-race="combo" aria-hidden="true"><span>连续成功交互</span><strong><b data-race="combo-count">1</b><small> 次</small></strong></div></section>
    <div class="r-map-frame" aria-hidden="true"><i></i><span>周边路况<small>车头朝上</small></span></div>
    <div class="r-key-hint"><span><kbd>WASD</kbd> / 方向键 驾驶</span><span><kbd>空格</kbd> 刹车</span><span><kbd>C</kbd> 后视</span><span><kbd>Esc</kbd> 暂停</span></div>
  </div>`;
}

export class RaceHudController {
  private refs = new Map<string, HTMLElement>();
  private previous: GameSnapshot | null = null;
  private animations = new Map<string, Animation>();
  private motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private motionChanged = () => {
    if (this.motionQuery.matches) {
      this.animations.forEach(animation => animation.cancel());
      this.animations.clear();
    }
  };

  constructor(root: HTMLElement) {
    if (root.dataset.race) this.refs.set(root.dataset.race, root);
    root.querySelectorAll<HTMLElement>('[data-race]').forEach(element => this.refs.set(element.dataset.race!, element));
    this.motionQuery.addEventListener('change', this.motionChanged);
  }

  update(snapshot: GameSnapshot) {
    const hud = this.refs.get('hud')!;
    const previous = this.previous;
    const freshRace = previous && snapshot.elapsed < previous.elapsed;
    const running = snapshot.status === 'running';
    const speed = Math.abs(snapshot.speedKmh);
    const topSpeed = VEHICLES.find(vehicle => vehicle.id === snapshot.vehicleId)!.topSpeed;
    const ratio = Math.min(1, speed / topSpeed);
    const progress = Math.min(1, snapshot.distance / snapshot.targetDistance);
    const capture = Math.min(1, snapshot.captureProgress);
    hud.dataset.paused = String(!running);
    hud.dataset.fast = String(speed >= 120);
    hud.dataset.speedLines = String(speed > 100 && running);
    hud.dataset.captured = String(capture > 0);
    hud.style.setProperty('--race-speed', Math.max(0, Math.min(1, (speed - 100) / 90)).toFixed(2));
    this.text('speed', Math.round(speed).toString().padStart(3, '0'));
    this.text('speed-status', speed < 1 ? '准备出发' : speed >= 160 ? '极速穿行' : speed >= 120 ? '高速行驶' : '保持行驶');
    this.text('percent', Math.floor(progress * 100).toString());
    this.text('distance', (snapshot.distance / 1000).toFixed(2));
    this.text('target', (snapshot.targetDistance / 1000).toFixed(2));
    this.text('elapsed', clock(snapshot.elapsed));
    this.text('police', snapshot.policeCount.toString());
    this.text('police-target', snapshot.policeTarget.toString());
    this.text('helicopters', snapshot.helicopterCount.toString());
    this.text('score', numeric(snapshot.score));
    this.text('near-miss', snapshot.nearMisses.toString());
    this.text('combo-count', snapshot.combo.toString());
    this.text('combo-label', snapshot.combo > 1 ? '保持连击' : '干净驾驶');
    this.text('capture-seconds', ((1 - capture) * 5).toFixed(1));
    this.refs.get('progress')!.style.transform = `scaleX(${progress})`;
    this.refs.get('capture-bar')!.style.transform = `scaleX(${capture})`;
    Array.from(this.refs.get('speed-bars')!.children).forEach((bar, index) => bar.classList.toggle('is-lit', index < Math.round(ratio * 20)));
    Array.from(this.refs.get('police-bars')!.children).forEach((bar, index) => {
      bar.classList.toggle('is-lit', index < snapshot.policeCount);
      bar.classList.toggle('is-called', index < snapshot.policeTarget);
    });
    this.visible('wrong-way', snapshot.wrongWay);
    this.visible('capture', capture > 0);
    this.visible('combo', snapshot.combo > 1);
    this.visible('event-wrap', Boolean(snapshot.event));
    this.refs.get('event-wrap')!.dataset.tone = snapshot.eventTone;
    this.text('event-label', snapshot.eventTone === 'good' ? '漂亮操作' : snapshot.eventTone === 'danger' ? '追捕警报' : '驾驶提示');
    this.text('event', snapshot.event);
    if (freshRace) {
      this.animations.forEach(animation => animation.cancel());
      this.animations.clear();
    }
    if (previous && !freshRace && running) {
      if (snapshot.event && (snapshot.event !== previous.event || snapshot.eventTone !== previous.eventTone)) this.animate('event-wrap', [{ opacity: 0, translate: '30px 0' }, { opacity: 1, translate: '0 0' }], 300);
      if (snapshot.nearMisses > previous.nearMisses) {
        if (snapshot.combo > 1) this.animate('combo', [{ scale: '.85', opacity: .3 }, { scale: '1.12', opacity: 1, offset: .35 }, { scale: '1', opacity: 1 }], 420);
        this.animate('score-panel', [{ translate: '0 0' }, { translate: '-8px 0', offset: .3 }, { translate: '0 0' }], 320);
      }
      if (snapshot.collisions > previous.collisions) this.animate('impact', [{ opacity: 0 }, { opacity: .7, offset: .12 }, { opacity: 0 }], 420);
      if (snapshot.policeCount !== previous.policeCount || snapshot.policeTarget !== previous.policeTarget || snapshot.helicopterCount !== previous.helicopterCount) this.animate('pursuit', [{ opacity: .45 }, { opacity: 1, offset: .35 }, { opacity: .6, offset: .6 }, { opacity: 1 }], 550);
    }
    if (previous?.status !== snapshot.status) this.animations.forEach(animation => running ? animation.play() : animation.pause());
    this.previous = { ...snapshot };
  }

  dispose() {
    this.motionQuery.removeEventListener('change', this.motionChanged);
    this.animations.forEach(animation => animation.cancel());
    this.animations.clear();
  }

  private text(name: string, value: string) {
    const element = this.refs.get(name)!;
    if (element.textContent !== value) element.textContent = value;
  }

  private visible(name: string, visible: boolean) {
    const element = this.refs.get(name)!;
    element.classList.toggle('is-visible', visible);
    element.setAttribute('aria-hidden', String(!visible));
  }

  private animate(name: string, frames: Keyframe[], duration: number) {
    if (this.motionQuery.matches || document.hidden) return;
    this.animations.get(name)?.cancel();
    const animation = this.refs.get(name)!.animate(frames, { duration, easing: 'cubic-bezier(.2,.75,.25,1)' });
    this.animations.set(name, animation);
    animation.onfinish = () => { if (this.animations.get(name) === animation) this.animations.delete(name); };
  }
}
