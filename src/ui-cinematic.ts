import type { CinematicKind, GameSnapshot } from './types';
import './ui-cinematic.css';

const titles: Record<CinematicKind, { label: string; title: string; detail: string }> = {
  intro: { label: '追逐序幕', title: '追逐最后的自由', detail: '20 公里 · 冲出追捕' },
  escaped: { label: '追逐终章', title: '成功逃脱', detail: '冲出封锁 · 自由在前方' },
  flipped: { label: '挑战结束', title: '翻覆失控', detail: '本次旅程到此为止' },
  caught: { label: '挑战结束', title: '突围失败', detail: '警方已封锁退路' },
};

export function raceCinematic() {
  return `<section class="race-cinematic" hidden aria-label="比赛过场">
    <div class="cinematic-location"><i aria-hidden="true"></i><b data-cinematic="label"></b></div>
    <div class="cinematic-caption"><span class="cinematic-shot" data-cinematic="shot"></span><h1 data-cinematic="title" aria-live="polite"></h1><p data-cinematic="detail"></p></div>
    <div class="cinematic-countdown" data-cinematic="countdown" aria-hidden="true" hidden></div>
    <div class="cinematic-footer"><div class="cinematic-progress" data-cinematic="progress" role="progressbar" aria-label="过场进度" aria-valuemin="0" aria-valuemax="100"><i data-cinematic="bar"></i></div><button class="cinematic-skip" data-action="skip-cinematic"><span data-cinematic="skip">跳过动画</span><kbd>空格</kbd><span aria-hidden="true">→</span></button></div>
  </section>`;
}

export class RaceCinematicController {
  private refs = new Map<string, HTMLElement>();
  private kind?: CinematicKind | 'replay';

  constructor(private root: HTMLElement, private hud: HTMLElement) {
    root.querySelectorAll<HTMLElement>('[data-cinematic]').forEach(element => this.refs.set(element.dataset.cinematic!, element));
  }

  update(snapshot: GameSnapshot) {
    const cinematic = snapshot.cinematic;
    const replay = snapshot.replay;
    const replaying = !!replay && ['replay', 'paused'].includes(snapshot.status);
    const visible = replaying || !!cinematic && ['intro', 'outro', 'paused'].includes(snapshot.status);
    this.root.hidden = !visible;
    this.root.inert = snapshot.status === 'paused';
    this.hud.hidden = visible;
    this.hud.inert = visible || snapshot.status === 'paused';
    if (replaying) {
      this.kind = 'replay';
      this.root.dataset.kind = 'replay';
      this.root.setAttribute('aria-label', '本局精彩回放');
      this.text('label', `精彩回放 ${replay.clip} / ${replay.clips}`);
      this.text('title', replay.title);
      this.text('shot', replay.slowMotion ? '关键瞬间 · 慢动作' : '追逐高光');
      const seconds = Math.floor(replay.raceTime);
      this.text('detail', `比赛 ${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')} · 本局真实追逐`);
      this.text('skip', '跳过全部高光');
      this.refs.get('countdown')!.hidden = true;
      this.progress(replay.elapsed / replay.duration, '高光回看进度');
      return;
    }
    if (!cinematic || !visible) return;
    this.root.setAttribute('aria-label', '比赛过场');
    this.text('skip', '跳过动画');
    if (this.kind !== cinematic.kind) {
      this.kind = cinematic.kind;
      this.root.dataset.kind = cinematic.kind;
      const copy = titles[cinematic.kind];
      this.text('label', copy.label);
      this.text('title', copy.title);
      this.text('detail', copy.detail);
    }
    this.text('shot', cinematic.shot);
    const remaining = cinematic.duration - cinematic.elapsed;
    const countdown = this.refs.get('countdown')!;
    countdown.hidden = cinematic.kind !== 'intro' || remaining > 3 || cinematic.duration < 3;
    if (!countdown.hidden) this.text('countdown', Math.max(1, Math.ceil(remaining)).toString().padStart(2, '0'));
    const progress = Math.min(1, Math.max(0, cinematic.elapsed / cinematic.duration));
    this.progress(progress, '过场进度');
  }

  private progress(value: number, label: string) {
    const progress = Math.min(1, Math.max(0, value));
    this.refs.get('bar')!.style.transform = `scaleX(${progress})`;
    this.refs.get('progress')!.setAttribute('aria-label', label);
    this.refs.get('progress')!.setAttribute('aria-valuenow', Math.round(progress * 100).toString());
  }

  private text(name: string, value: string) {
    const element = this.refs.get(name)!;
    if (element.textContent !== value) element.textContent = value;
  }
}
