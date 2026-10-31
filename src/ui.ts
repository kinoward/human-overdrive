import { CITIES, TARGET_DISTANCE, VEHICLES } from './config';
import { assetUrl } from './asset-url';
import { getLeaderboard, getStorageStatus, loadResults } from './game/storage';
import type { CityConfig, GameSnapshot, RaceResult, VehicleConfig, VehicleId } from './types';
import { cityMapArt, uiIcon } from './ui-art';
import { CityGlobe } from './ui-globe';
import { raceHud, RaceHudController } from './ui-race';
import './style.css';
import './ui-motion.css';

interface UICallbacks {
  onStart: (vehicleId: VehicleId, nickname: string) => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onLeave: () => void;
  onSound: (muted: boolean) => void;
}

type Panel = 'home' | 'cities' | 'globe' | 'garage' | 'options' | 'leaderboard' | 'rules' | 'race' | 'pause' | 'result';

const arrow = '<span class="button-arrow" aria-hidden="true">→</span>';
const logo = '<svg viewBox="0 0 38 28" aria-hidden="true"><path d="M0 26 15 1h10L10 26zm19 0L34 1h4L23 26z" fill="currentColor"/></svg>';
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const number = (value: number) => Math.round(value).toLocaleString('zh-CN');
const time = (value: number) => {
  const tenths = Math.floor(value * 10);
  return `${Math.floor(tenths / 600).toString().padStart(2, '0')}:${Math.floor(tenths / 10 % 60).toString().padStart(2, '0')}.${tenths % 10}`;
};
const distance = (value: number) => `${(value / 1000).toFixed(2)}`;
const stars = (value: number) => `<span class="stars" aria-label="${value}星">${Array.from({ length: 10 }, (_, index) => `<span class="${index < value ? 'lit' : ''}" aria-hidden="true">★</span>`).join('')}</span>`;

function roadMap(className = '', detailed = false) {
  return `<img class="road-map ${className}" src="${assetUrl('data/beijing-map.svg')}" alt="北京完整四环主辅路地图${detailed ? '，北、东、南、西四环按真实线形连接' : ''}">`;
}

function vehicleArt(vehicle: VehicleConfig) {
  return `<img class="vehicle-art vehicle-photo-${vehicle.kind}" src="${assetUrl(`assets/ui-racing/${vehicle.kind === 'car' ? 'racing-hero-v1' : 'garage-motorcycle-v1'}.webp`)}" alt="${vehicle.kind === 'car' ? '电动 SUV 竞速风格图' : '探险摩托竞速风格图'}"/>`;
}

export class GameUI {
  private root = document.querySelector<HTMLDivElement>('#app')!;
  private panel: Panel = 'home';
  private previousPanel: Panel = 'home';
  private ready = false;
  private muted = false;
  private vehicleId: VehicleId = 'model-y';
  private cityId = 'beijing';
  private cityTab: 'map' | 'records' | 'guide' = 'map';
  private nickname = '公路旅人';
  private boardMode: 'time' | 'score' = 'score';
  private boardVehicle: VehicleId | undefined;
  private snapshot: GameSnapshot | null = null;
  private result: RaceResult | null = null;
  private error = '';
  private raceHud: RaceHudController | null = null;
  private swipeStart: { x: number; y: number } | null = null;
  private swipeAt = -1000;
  private globe: CityGlobe | null = null;
  private readonly motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private screenAnimation: Animation | null = null;
  private transitionId = 0;
  private pendingPanel: Panel | null = null;
  private countFrame = 0;

  constructor(private callbacks: UICallbacks) {
    this.motionQuery.addEventListener('change', () => this.screenAnimation?.cancel());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.screenAnimation?.finish(); });
    this.root.addEventListener('click', event => this.handleClick(event));
    this.root.addEventListener('keydown', event => this.handleKey(event));
    this.root.addEventListener('pointerdown', event => {
      if (this.panel === 'cities' && event.pointerType === 'touch') this.swipeStart = { x: event.clientX, y: event.clientY };
    });
    this.root.addEventListener('pointerup', event => {
      if (!this.swipeStart) return;
      const dx = event.clientX - this.swipeStart.x;
      const dy = event.clientY - this.swipeStart.y;
      this.swipeStart = null;
      if (this.panel === 'cities' && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
        this.swipeAt = performance.now();
        this.changeCity(dx < 0 ? 1 : -1);
      }
    });
    this.root.addEventListener('pointercancel', () => { this.swipeStart = null; });
    this.root.addEventListener('input', event => {
      const target = event.target as HTMLInputElement;
      if (target.name === 'nickname') this.nickname = target.value.slice(0, 16);
    });
    this.root.addEventListener('change', event => {
      const target = event.target as HTMLSelectElement;
      if (target.name === 'board-vehicle') {
        this.boardVehicle = target.value ? target.value as VehicleId : undefined;
        this.render();
      }
    });
    this.root.addEventListener('wheel', event => {
      const deck = (event.target as HTMLElement).closest<HTMLElement>('.city-deck');
      if (!deck || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      deck.scrollBy({ left: event.deltaY, behavior: this.motionQuery.matches ? 'auto' : 'smooth' });
    }, { passive: false });
    this.render();
  }

  setReady() {
    this.ready = true;
    const start = this.root.querySelector<HTMLButtonElement>('[data-action="start"]');
    if (start && !this.error) { start.disabled = false; start.textContent = '开始驾驶'; }
  }

  update(snapshot: GameSnapshot) {
    this.snapshot = snapshot;
    if (snapshot.status === 'paused' && this.panel === 'race' && this.pendingPanel !== 'pause') {
      void this.transitionTo('pause', undefined, true);
    } else if (snapshot.status === 'running' && this.panel === 'pause' && this.pendingPanel !== 'race') {
      void this.transitionTo('race');
    } else if (snapshot.status === 'ready' && (this.panel === 'race' || this.panel === 'pause') && this.pendingPanel !== 'home') {
      void this.transitionTo('home', undefined, true);
    }
    if (this.panel === 'race' || this.panel === 'pause') this.updateHud(snapshot);
  }

  showResult(result: RaceResult) {
    this.result = result;
    this.cityId = result.cityId;
    void this.transitionTo('result', undefined, true);
  }

  showError(message: string) {
    this.error = message;
    this.render();
  }

  private navigate(panel: Panel) {
    if (this.pendingPanel || this.panel === panel) return;
    const leavingResult = this.panel === 'result' && ['home', 'cities', 'globe', 'garage', 'options', 'leaderboard', 'rules'].includes(panel);
    this.previousPanel = leavingResult ? 'home' : this.panel;
    void this.transitionTo(panel, leavingResult ? () => this.callbacks.onLeave() : undefined);
  }

  private async animateScreen(element: HTMLElement | null, entering: boolean) {
    if (!element || this.motionQuery.matches || document.hidden) return;
    const frames = entering
      ? [{ opacity: 0, translate: '18px 0' }, { opacity: 1, translate: '0 0' }]
      : [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '-12px 0' }];
    const animation = element.animate(frames, { duration: entering ? 260 : 100, easing: 'cubic-bezier(.2,.75,.25,1)' });
    this.screenAnimation = animation;
    try {
      await animation.finished;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    } finally {
      if (this.screenAnimation === animation) this.screenAnimation = null;
    }
  }

  private async transitionTo(panel: Panel, onEnter?: () => void, skipExit = false) {
    if (this.pendingPanel === panel) return;
    const id = ++this.transitionId;
    this.pendingPanel = panel;
    this.screenAnimation?.cancel();
    this.root.inert = true;
    try {
      if (!skipExit) await this.animateScreen(this.root.querySelector<HTMLElement>(this.panel === 'pause' ? '.pause-panel' : '.screen-content'), false);
      if (id !== this.transitionId) return;
      this.panel = panel;
      this.render();
      window.scrollTo(0, 0);
      onEnter?.();
      if (id !== this.transitionId) return;
      await this.animateScreen(this.root.querySelector<HTMLElement>(panel === 'pause' ? '.pause-panel' : '.screen-content'), true);
    } finally {
      if (id === this.transitionId) {
        this.pendingPanel = null;
        this.root.inert = false;
        if (panel === 'pause') this.root.querySelector<HTMLButtonElement>('[data-action="resume"]')?.focus({ preventScroll: true });
        else if (panel !== 'race') this.root.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
      }
    }
  }

  private changeCity(direction: number) {
    const index = CITIES.findIndex(city => city.id === this.cityId);
    const next = Math.max(0, Math.min(CITIES.length - 1, index + direction));
    this.selectCity(CITIES[next].id);
  }

  private selectCity(cityId: string) {
    if (this.cityId === cityId) { this.globe?.selectCity(cityId); return; }
    const focused = document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement) ? document.activeElement : null;
    this.cityId = cityId;
    const selected = CITIES.find(city => city.id === cityId)!;
    const index = CITIES.indexOf(selected);
    const tabs = this.root.querySelector<HTMLElement>('.city-tabs');
    this.root.querySelectorAll<HTMLElement>('.city-card').forEach(card => {
      const active = card.dataset.city === cityId;
      card.classList.toggle('is-selected', active);
      const button = card.querySelector<HTMLButtonElement>('.city-select')!;
      button.setAttribute('aria-pressed', String(active));
      button.tabIndex = active ? 0 : -1;
      card.querySelector<HTMLElement>('.city-card-body')!.innerHTML = this.cityCardBody(CITIES.find(city => city.id === card.dataset.city)!, active);
      if (active && tabs) card.append(tabs);
    });
    const deck = this.root.querySelector<HTMLElement>('.city-deck');
    const target = deck?.querySelector<HTMLElement>(`[data-city="${cityId}"].city-card`);
    if (deck && target) deck.scrollTo({ left: Math.max(0, target.offsetLeft - (deck.clientWidth - target.clientWidth) / 2), behavior: this.motionQuery.matches ? 'auto' : 'smooth' });
    const previous = this.root.querySelector<HTMLButtonElement>('[data-action="previous-city"]');
    const next = this.root.querySelector<HTMLButtonElement>('[data-action="next-city"]');
    if (previous) previous.disabled = index === 0;
    if (next) next.disabled = index === CITIES.length - 1;
    this.root.querySelectorAll<HTMLButtonElement>('.globe-city-list [data-action="city"]').forEach(button => {
      button.classList.toggle('selected', button.dataset.city === cityId);
      button.setAttribute('aria-pressed', String(button.dataset.city === cityId));
    });
    const summary = this.root.querySelector<HTMLElement>('.globe-city-summary');
    if (summary) summary.innerHTML = this.globeSummary(selected);
    const departure = this.root.querySelector<HTMLElement>('.city-departure');
    if (departure) departure.innerHTML = this.departure(selected);
    const announce = this.root.querySelector<HTMLElement>('.city-announcement');
    if (announce) announce.textContent = `${selected.name}，${selected.available ? '可挑战' : '未开放'}`;
    this.globe?.selectCity(cityId);
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    else if (focused && !focused.isConnected) this.root.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }

  private updateCityTab() {
    const selected = CITIES.find(city => city.id === this.cityId)!;
    const body = this.root.querySelector<HTMLElement>('.city-card.is-selected .city-card-body, .globe-city-summary .city-card-body');
    if (body) {
      body.innerHTML = this.cityCardBody(selected, true);
      if (!this.motionQuery.matches) body.animate([{ opacity: 0, translate: '0 7px' }, { opacity: 1, translate: '0 0' }], { duration: 180, easing: 'ease-out' });
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-action="city-tab"]').forEach(button => {
      button.classList.toggle('selected', button.dataset.tab === this.cityTab);
      button.setAttribute('aria-pressed', String(button.dataset.tab === this.cityTab));
    });
  }

  private selectVehicle(vehicleId: VehicleId) {
    this.vehicleId = vehicleId;
    this.root.querySelectorAll<HTMLButtonElement>('[data-action="vehicle"]').forEach(button => {
      const selected = button.dataset.vehicle === vehicleId;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const vehicle = VEHICLES.find(item => item.id === vehicleId)!;
    const specs = this.root.querySelector<HTMLElement>('.garage-setup > p:first-child');
    if (specs) specs.innerHTML = `${vehicle.topSpeed} km/h <span>·</span> ${vehicle.width.toFixed(2)} m <span>·</span> 目标 ${TARGET_DISTANCE / 1000} 公里 · 约 10 分钟`;
  }

  private handleKey(event: KeyboardEvent) {
    if ((event.target as HTMLElement).matches('input, select, textarea')) return;
    if (this.panel === 'pause' && event.key === 'Tab') {
      const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('.pause-panel button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[0]?.focus(); }
    }
    if (this.pendingPanel) return;
    if (['cities', 'globe'].includes(this.panel) && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      this.changeCity(event.key === 'ArrowRight' ? 1 : -1);
    }
    if (event.key === 'Escape' && ['cities', 'globe', 'garage', 'options', 'leaderboard', 'rules'].includes(this.panel)) {
      event.preventDefault();
      this.navigate(this.panel === 'garage' ? 'cities' : 'home');
    }
  }

  private handleClick(event: Event) {
    if (this.pendingPanel || performance.now() - this.swipeAt < 350) return;
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!button || button.hasAttribute('disabled')) return;
    const action = button.dataset.action;
    if (action === 'home') this.navigate('home');
    if (action === 'options') this.navigate('options');
    if (action === 'globe') this.navigate('globe');
    if (action === 'city-tab') {
      this.cityTab = button.dataset.tab as 'map' | 'records' | 'guide';
      this.updateCityTab();
    }
    if (action === 'reload') window.location.reload();
    if (action === 'cities') this.navigate('cities');
    if (action === 'garage') {
      if (!CITIES.find(city => city.id === this.cityId)!.available) this.cityId = 'beijing';
      this.navigate('garage');
    }
    if (action === 'previous-city') this.changeCity(-1);
    if (action === 'next-city') this.changeCity(1);
    if (action === 'choose-city' && CITIES.find(city => city.id === this.cityId)!.available) this.navigate('garage');
    if (action === 'rules') this.navigate('rules');
    if (action === 'leaderboard') this.navigate('leaderboard');
    if (action === 'back') this.navigate(this.previousPanel === 'rules' ? 'home' : this.previousPanel);
    if (action === 'city') {
      const city = CITIES.find(item => item.id === button.dataset.city);
      if (city) {
        this.selectCity(city.id);
      }
    }
    if (action === 'vehicle') {
      this.selectVehicle(button.dataset.vehicle as VehicleId);
    }
    if (action === 'mode') {
      this.boardMode = button.dataset.mode as 'time' | 'score';
      this.render();
    }
    if (action === 'start' && this.ready && !this.error && CITIES.find(city => city.id === this.cityId)!.available) {
      this.nickname = this.nickname.trim() || '公路旅人';
      void this.transitionTo('race', () => this.callbacks.onStart(this.vehicleId, this.nickname));
    }
    if (action === 'pause') this.callbacks.onPause();
    if (action === 'resume') this.callbacks.onResume();
    if (action === 'restart') {
      void this.transitionTo('race', () => this.callbacks.onRestart());
    }
    if (action === 'leave') {
      void this.transitionTo('home', () => this.callbacks.onLeave());
    }
    if (action === 'sound') {
      this.muted = !this.muted;
      this.callbacks.onSound(this.muted);
      button.innerHTML = this.soundLabel();
      button.setAttribute('aria-label', this.muted ? '开启声音' : '关闭声音');
      button.setAttribute('aria-pressed', String(this.muted));
    }
  }

  private soundLabel() {
    return `${uiIcon(this.muted ? 'muted' : 'sound')}<span>声音${this.muted ? '关' : '开'}</span>`;
  }

  private header() {
    return `<header class="site-header"><button class="icon-button" data-action="home" aria-label="返回首页">${uiIcon('arrow-left')}</button><nav aria-label="主导航"><button class="nav-link" data-action="cities">城市</button><button class="nav-link" data-action="leaderboard">排行</button><button class="nav-link" data-action="rules">指南</button><button class="icon-button sound-button" data-action="sound" aria-label="${this.muted ? '开启声音' : '关闭声音'}" aria-pressed="${this.muted}">${this.soundLabel()}</button></nav></header>`;
  }

  private render() {
    this.raceHud?.dispose();
    this.raceHud = null;
    this.globe?.dispose();
    this.globe = null;
    cancelAnimationFrame(this.countFrame);
    const racing = this.panel === 'race' || this.panel === 'pause';
    const focused = document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement) ? document.activeElement : null;
    const focusAction = focused?.dataset.action;
    const focusValue = focused?.dataset.tab ?? focused?.dataset.city ?? focused?.dataset.vehicle ?? focused?.dataset.mode;
    const focusCity = focused?.dataset.city;
    const focusHeading = focused?.matches('main h1');
    const focusId = focused?.id;
    const focusName = focused?.getAttribute('name');
    const menu = ['home', 'cities', 'globe', 'garage', 'options'].includes(this.panel);
    this.root.className = `game-ui panel-${this.panel}${menu ? ' menu-screen' : ''}`;
    this.root.innerHTML = `${racing || menu ? '' : this.header()}${this.error ? `<div class="error-banner" role="alert"><strong>暂时无法出发</strong><span>${escapeHTML(this.error)}</span><button data-action="reload">重新载入</button></div>` : ''}<div class="screen-content">${this.content()}</div>${racing || menu ? '' : '<footer class="site-footer"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap 贡献者</a></footer>'}`;
    this.root.querySelectorAll<HTMLElement>('main h1').forEach(heading => heading.tabIndex = -1);
    const hudRoot = this.root.querySelector<HTMLElement>('.race-hud');
    if (hudRoot) this.raceHud = new RaceHudController(hudRoot);
    if (racing && this.snapshot) this.updateHud(this.snapshot);
    const globeHost = this.root.querySelector<HTMLElement>('.globe-canvas-host');
    if (globeHost) this.globe = new CityGlobe(globeHost, CITIES, this.cityId, cityId => this.selectCity(cityId));
    if (this.panel === 'cities') {
      const deck = this.root.querySelector<HTMLElement>('.city-deck')!;
      const selected = deck.querySelector<HTMLElement>('.city-card.is-selected')!;
      deck.scrollLeft = Math.max(0, selected.offsetLeft - (deck.clientWidth - selected.clientWidth) / 2);
    }
    if (this.panel === 'result') this.animateResultNumbers();
    if (this.panel === 'pause') {
      this.root.querySelector('.race-hud')?.setAttribute('inert', '');
      this.root.querySelector<HTMLButtonElement>('[data-action="resume"]')?.focus({ preventScroll: true });
    } else if (focusAction) {
      [...this.root.querySelectorAll<HTMLElement>('[data-action]')].find(element => element.dataset.action === focusAction && (element.dataset.tab ?? element.dataset.city ?? element.dataset.vehicle ?? element.dataset.mode) === focusValue && element.dataset.city === focusCity)?.focus({ preventScroll: true });
    } else if (focusHeading) {
      this.root.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
    } else if (focusId || focusName) {
      [...this.root.querySelectorAll<HTMLElement>('input, select')].find(element => focusId ? element.id === focusId : element.getAttribute('name') === focusName)?.focus({ preventScroll: true });
    }
  }

  private content() {
    if (this.panel === 'home') return this.home();
    if (this.panel === 'cities') return this.cities();
    if (this.panel === 'garage') return this.garage();
    if (this.panel === 'globe') return this.globePanel();
    if (this.panel === 'options') return this.options();
    if (this.panel === 'leaderboard') return this.leaderboard();
    if (this.panel === 'rules') return this.rules();
    if (this.panel === 'result') return this.resultPanel();
    return this.hud() + (this.panel === 'pause' ? this.pause() : '');
  }

  private home() {
    return `<main class="menu-stage home-main"><section class="title-menu"><p class="menu-location">北京 · 四环</p><h1>人类<span>超频</span></h1><span class="game-wordmark">HUMAN OVERDRIVE</span><div class="title-actions"><button class="menu-button" data-action="cities"><span>开始游戏</span>${uiIcon('arrow-right')}</button><button class="menu-button menu-secondary" data-action="options">选项</button></div></section><button class="corner-sound" data-action="sound" aria-label="${this.muted ? '开启声音' : '关闭声音'}" aria-pressed="${this.muted}">${this.soundLabel()}</button></main>`;
  }

  private cityCardBody(city: CityConfig, active: boolean) {
    const summaries: Record<string, string> = {
      beijing: '完整四环 · 主路与辅路',
      shanghai: '黄浦江 · 城市高架',
      chongqing: '两江交汇 · 山城路网',
      tokyo: '东京湾 · 都市高速',
      'los-angeles': '市区路网 · 城市高速',
    };
    const results = loadResults();
    const best = results.filter(result => result.cityId === city.id).reduce((score, result) => Math.max(score, result.score), 0);
    let detail = `<p class="card-description">${summaries[city.id]}</p><div class="card-divider"></div><p class="card-best"><span>最佳车技</span><strong>${number(best)}<small> 分</small></strong></p>`;
    if (active && this.cityTab === 'records') {
      const top = getLeaderboard(results, { cityId: city.id, mode: 'time' }).slice(0, 3);
      detail = `<p class="card-description">最快逃脱</p><div class="card-divider"></div>${top.length ? `<ol class="card-records">${top.map(result => `<li><span>${escapeHTML(result.nickname)}</span><b>${time(result.duration)}</b></li>`).join('')}</ol>` : '<p class="card-empty">暂无纪录</p>'}<button class="card-link" data-action="leaderboard">查看排行榜 ${uiIcon('arrow-right')}</button>`;
    }
    if (active && this.cityTab === 'guide') detail = `<p class="card-description">${city.available ? `目标：${city.targetDistance / 1000} 公里 · 约 10 分钟` : '暂未开放'}</p><div class="card-divider"></div><p class="card-guide">${city.available ? '累计有效里程即可逃脱。翻车或持续被围堵则挑战结束。' : '此城市当前仅展示地图预告。'}</p><button class="card-link" data-action="rules">驾驶指南 ${uiIcon('arrow-right')}</button>`;
    return `<h2>${escapeHTML(city.name)}</h2>${detail}`;
  }

  private cityTabs() {
    return `<nav class="city-tabs" aria-label="关卡信息">${([['map', 'pin', '城市介绍'], ['records', 'records', '城市纪录'], ['guide', 'medal', '挑战规则']] as const).map(([tab, icon, label]) => `<button class="${this.cityTab === tab ? 'selected' : ''}" data-action="city-tab" data-tab="${tab}" aria-label="${label}" aria-pressed="${this.cityTab === tab}">${uiIcon(icon)}</button>`).join('')}</nav>`;
  }

  private departure(city: CityConfig) {
    return `<span>${city.available ? `目标 ${city.targetDistance / 1000} 公里 · 约 10 分钟` : '当前仅开放北京'}</span><button class="menu-button city-play" data-action="choose-city" ${city.available ? '' : 'disabled'}>${city.available ? '选择车辆' : '未开放'}${uiIcon(city.available ? 'arrow-right' : 'lock')}</button>`;
  }

  private cityViewSwitch(globe: boolean) {
    return `<nav class="city-view-switch" aria-label="城市选择视角"><button class="${globe ? '' : 'selected'}" data-action="cities" aria-pressed="${!globe}">卡片视角</button><button class="${globe ? 'selected' : ''}" data-action="globe" aria-pressed="${globe}">${uiIcon('globe')} 地球视角</button></nav>`;
  }

  private cities() {
    const selectedIndex = CITIES.findIndex(city => city.id === this.cityId);
    const selected = CITIES[selectedIndex];
    return `<main class="menu-stage cities-main"><button class="menu-back" data-action="home" aria-label="返回首页">${uiIcon('arrow-left')}</button><div class="selection-title"><h1>选择城市</h1><span>← → 切换 · 滚动浏览</span></div>${this.cityViewSwitch(false)}<div class="city-list-arrows"><button class="icon-button" data-action="previous-city" aria-label="上一座城市" ${selectedIndex === 0 ? 'disabled' : ''}>${uiIcon('arrow-left')}</button><button class="icon-button" data-action="next-city" aria-label="下一座城市" ${selectedIndex === CITIES.length - 1 ? 'disabled' : ''}>${uiIcon('arrow-right')}</button></div><section class="city-deck" aria-label="城市选择，北京位于列表第一项，使用左右方向键切换" aria-roledescription="轮播">${CITIES.map(city => {
      const active = city.id === this.cityId;
      return `<article class="city-card city-${city.id} ${active ? 'is-selected' : ''} ${city.available ? '' : 'city-locked'}" data-city="${city.id}" aria-label="${city.name}"><button class="city-select" tabindex="${active ? 0 : -1}" data-action="city" data-city="${city.id}" aria-label="选择${city.name}${city.available ? '' : '，即将开放'}" aria-pressed="${active}"></button><div class="city-color"><div class="city-art">${cityMapArt(city.id)}</div><span class="city-status ${city.available ? 'available' : ''}">${city.available ? '可挑战' : '未开放'}</span><span class="city-map-caption">真实路网 · 风格地图</span></div><div class="city-card-body">${this.cityCardBody(city, active)}</div>${active ? this.cityTabs() : ''}</article>`;
    }).join('')}</section><div class="city-departure">${this.departure(selected)}</div><p class="visually-hidden city-announcement" aria-live="polite">${selected.name}，${selected.available ? '可挑战' : '未开放'}</p><div class="city-map-attribution">地图参考 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a><span>·</span><a href="https://www.arcgis.com/home/item.html?id=3b93337983e9436f8db950e38a8629af" target="_blank" rel="noreferrer">Esri 及数据提供者</a></div></main>`;
  }

  private globeSummary(city: CityConfig) {
    return `<div class="globe-preview ${city.available ? '' : 'is-locked'}">${cityMapArt(city.id)}<span class="city-status ${city.available ? 'available' : ''}">${city.available ? '可挑战' : '未开放'}</span></div><div class="city-card-body">${this.cityCardBody(city, true)}</div>${this.cityTabs()}`;
  }

  private globePanel() {
    const selected = CITIES.find(city => city.id === this.cityId)!;
    return `<main class="menu-stage globe-main"><button class="menu-back" data-action="home" aria-label="返回首页">${uiIcon('arrow-left')}</button><div class="selection-title"><h1>地球选城</h1><span>拖拽旋转 · 滚轮缩放</span></div>${this.cityViewSwitch(true)}<div class="globe-canvas-host" aria-label="可交互地球，点击城市标记进行选择"></div><aside class="globe-selection-panel"><div class="globe-city-list" role="group" aria-label="城市列表">${CITIES.map(city => `<button class="${city.id === this.cityId ? 'selected' : ''} ${city.available ? '' : 'is-locked'}" data-action="city" data-city="${city.id}" aria-pressed="${city.id === this.cityId}">${escapeHTML(city.name)}${city.available ? '' : uiIcon('lock')}</button>`).join('')}</div><article class="globe-city-summary">${this.globeSummary(selected)}</article><div class="city-departure">${this.departure(selected)}</div></aside><p class="globe-hint">点击地球上的城市标记，或从右侧列表选择。</p><p class="visually-hidden city-announcement" aria-live="polite">${selected.name}，${selected.available ? '可挑战' : '未开放'}</p><a class="city-map-attribution" href="https://visibleearth.nasa.gov/collection/1484/blue-marble" target="_blank" rel="noreferrer">地表与云层：NASA · 夜光：NASA / NOAA</a></main>`;
  }

  private garage() {
    const vehicle = VEHICLES.find(item => item.id === this.vehicleId)!;
    return `<main class="menu-stage garage-main"><button class="menu-back" data-action="cities" aria-label="返回城市选择">${uiIcon('arrow-left')}</button><h1>选择车辆</h1><section class="garage-choice" aria-label="车辆选择">${VEHICLES.map(item => `<button class="garage-vehicle ${item.id === vehicle.id ? 'selected' : ''}" data-action="vehicle" data-vehicle="${item.id}" aria-pressed="${item.id === vehicle.id}"><span class="garage-vehicle-art">${vehicleArt(item)}</span><strong>${escapeHTML(item.name)}</strong><span>${item.kind === 'car' ? '稳定 · 强劲加速' : '灵活 · 平衡辅助'}</span></button>`).join('')}</section><div class="garage-setup"><p>${vehicle.topSpeed} km/h <span>·</span> ${vehicle.width.toFixed(2)} m <span>·</span> 目标 ${TARGET_DISTANCE / 1000} 公里 · 约 10 分钟</p><label for="nickname">昵称 <input id="nickname" name="nickname" maxlength="16" value="${escapeHTML(this.nickname)}" autocomplete="nickname" spellcheck="false"/></label><button class="menu-button" data-action="start" ${this.ready && !this.error ? '' : 'disabled'}>${this.error ? '加载失败' : this.ready ? '开始驾驶' : '准备中'}</button><p class="garage-keys">WASD / 方向键驾驶 · 空格刹车 · Esc 暂停</p></div></main>`;
  }

  private options() {
    return `<main class="menu-stage options-main"><button class="menu-back" data-action="home" aria-label="返回首页">${uiIcon('arrow-left')}</button><section class="options-list"><h1>选项</h1><button class="menu-button option-sound" data-action="sound" aria-label="${this.muted ? '开启声音' : '关闭声音'}" aria-pressed="${this.muted}">${this.soundLabel()}</button><button class="menu-button" data-action="leaderboard">排行榜</button><button class="menu-button" data-action="rules">驾驶指南</button><a class="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap 贡献者</a></section></main>`;
  }

  private leaderboard() {
    const results = getLeaderboard(loadResults(), { cityId: 'beijing', vehicleId: this.boardVehicle, mode: this.boardMode });
    return `<main class="page-main leaderboard-main"><div class="page-heading"><div><h1>排行榜</h1></div><p>成绩保存在当前浏览器。</p></div><div class="board-toolbar"><div class="segmented" role="group" aria-label="排行类型"><button class="${this.boardMode === 'time' ? 'selected' : ''}" data-action="mode" data-mode="time" aria-pressed="${this.boardMode === 'time'}">最快逃脱</button><button class="${this.boardMode === 'score' ? 'selected' : ''}" data-action="mode" data-mode="score" aria-pressed="${this.boardMode === 'score'}">车技得分</button></div><div class="board-filters"><span>北京 · 四环逃亡</span><select name="board-vehicle" aria-label="按车型筛选"><option value="">全部车型</option>${VEHICLES.map(vehicle => `<option value="${vehicle.id}" ${vehicle.id === this.boardVehicle ? 'selected' : ''}>${escapeHTML(vehicle.name)}</option>`).join('')}</select></div></div><div class="leaderboard-table"><div class="board-row board-labels"><span>名次</span><span>驾驶者 / 座驾</span><span>${this.boardMode === 'time' ? '逃脱用时' : '车技分'}</span><span>评级</span><span>最高完好警车</span><span>挑战日期</span></div>${results.length ? results.slice(0, 20).map((result, index) => `<div class="board-row ${index === 0 ? 'first-place' : ''}"><strong class="board-rank">${(index + 1).toString().padStart(2, '0')}</strong><span class="board-player"><strong>${escapeHTML(result.nickname)}</strong><small>${escapeHTML(VEHICLES.find(vehicle => vehicle.id === result.vehicleId)?.name ?? result.vehicleId)}${result.outcome !== 'escaped' ? ' · 未逃脱' : ''}</small></span><strong class="board-value">${this.boardMode === 'time' ? time(result.duration) : number(result.score)}</strong><span class="board-rating">${result.stars}<small> 星</small></span><span class="board-police">${result.maxPoliceCount} 辆</span><span class="board-date">${new Date(result.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span></div>`).join('') : `<div class="board-empty">${roadMap()}<span class="eyebrow subtle">这里还没有纪录</span><h2>暂无纪录</h2><p>完成挑战后，成绩保存在本机。</p><button class="button primary" data-action="garage">游玩 ${arrow}</button></div>`}</div>${this.storageNotice()}<div class="page-note"><span>${this.boardMode === 'time' ? '仅成功逃脱的成绩进入计时榜；跨车型用时仅供比较。' : '按星级、车技分排序；失败局最高 8 星，旧版成绩单独保留。'}</span><button data-action="rules">评分如何计算 ↗</button></div></main>`;
  }

  private rules() {
    return `<main class="page-main rules-main"><div class="page-heading"><div><h1>驾驶指南</h1></div><button class="button secondary" data-action="garage">去选车 ${arrow}</button></div><div class="rules-layout"><section class="rule-overview">${roadMap('', true)}<h2>目标：${TARGET_DISTANCE / 1000} 公里</h2><p>单局约 10 分钟，实际用时取决于车技。<br>主路、辅路、匝道都可以走。<br>逆行与同路往返，实际行驶均计入里程。<br>原地空转与碰撞抖动不计。</p><div class="rule-controls"><span><kbd>W A S D</kbd> 或方向键驾驶</span><span><kbd>空格</kbd> 刹车</span><span><kbd>Esc</kbd> 暂停 / 继续</span></div></section><section class="rule-details"><article><span>01</span><div><h3>随时间增援</h3><p>开局 3 辆完好警车，每 75 秒增加 1 辆，8 分 45 秒时达到 10 辆。损坏警车留在道路上，替补从远处驶入；直升机在第 3 分钟起陆续加入，最多 3 架。</p></div></article><article><span>02</span><div><h3>失败条件</h3><p>警车接近、超过或接触你都不直接判负。翻车，或被警方围堵到无法脱困持续数秒，才会结束挑战。摩托有平衡辅助，强撞击仍可能失控。</p></div></article><article><span>03</span><div><h3>车技评分</h3><p>车技分上限 10000，按已完成里程逐步计入。干净驾驶、完整近失超车与闪开警方冲撞得分；实际警车在身边追逐时加分。速度只比较逃脱用时。轻擦、中撞、重撞分别有 50、150、350 米恢复区，期间不积干净驾驶与追逐分。</p><div class="score-weights"><span><b>50%</b> 干净驾驶</span><span><b>35%</b> 交互技巧</span><span><b>15%</b> 有效追逐</span></div></div></article><article><span>04</span><div><h3>车技星级</h3><p>每 1000 分升一星，成功逃脱且达到 9500 分获 10 星，失败局最高 8 星。满警力下累计完成 20 秒、500 米干净驾驶并逃脱，另获「满警力逃脱」成就。近失记 1 技巧，闪避记 2 技巧；技巧事件至少间隔 60 米，同车不重复近失，同一警车闪避间隔 20 秒。本局 ${TARGET_DISTANCE / 500} 技巧单位达到技巧分上限；3 辆有效警车追逐 ${(TARGET_DISTANCE * 0.35 / 1000).toFixed(1)} 公里可积满追逐分，较少警车按比例累计。连击只提示连续次数。</p></div></article><article><span>05</span><div><h3>本机排行榜</h3><p>最快逃脱榜记录成功用时；车技分榜记录驾驶表现。可以按车型筛选，没有升级、改装和贴纸，胜负只在这一次驾驶。</p></div></article></section></div></main>`;
  }

  private hud() {
    return raceHud(this.muted, this.soundLabel());
  }

  private pause() {
    return `<div class="modal-backdrop"><section class="pause-panel" role="dialog" aria-modal="true" aria-labelledby="pause-title"><h1 id="pause-title">暂停</h1><button class="button primary" data-action="resume">继续</button><button class="button secondary" data-action="restart">重新开始</button><button class="text-button" data-action="leave">主菜单</button></section></div>`;
  }

  private resultPanel() {
    const result = this.result!;
    const escaped = result.outcome === 'escaped';
    const vehicle = VEHICLES.find(item => item.id === result.vehicleId)!;
    const title = escaped ? '成功逃脱' : result.outcome === 'flipped' ? '车辆翻覆' : '被警方围堵';
    const rating = result.stars === 10 ? '大佬 · 车技卓越' : result.stars >= 8 ? '城市游侠' : result.stars >= 5 ? '公路高手' : result.stars >= 2 ? '正在上手' : '初次上路';
    const board = getLeaderboard(loadResults(), { cityId: result.cityId, vehicleId: result.vehicleId, mode: 'score' });
    const rank = board.findIndex(item => item.id === result.id) + 1;
    return `<main class="page-main result-main ${escaped ? 'result-success' : 'result-failed'}"><div class="result-kicker"><span class="status-badge ${escaped ? '' : 'failed'}">${escaped ? '挑战完成' : '挑战结束'}</span><span>北京 · 四环逃亡</span></div><div class="result-heading"><h1>${title}</h1><p>${escaped ? `已完成 ${distance(result.targetDistance)} 公里目标里程` : `已完成 ${Math.min(100, Math.round(result.distance / result.targetDistance * 100))}% 目标里程`}</p></div><div class="result-layout"><section class="rating-panel"><span class="eyebrow subtle">本次车技评级</span><div class="rating-number"><b class="result-number" data-count="${result.stars}">${result.stars}</b><span>/ 10</span></div>${stars(result.stars)}<h2>${rating}</h2><p>${escapeHTML(result.nickname)} <span>·</span> ${escapeHTML(vehicle.name)}</p><div class="result-rank"><span>本车型车技榜</span><strong>${rank ? `第 ${rank} 名` : '成绩尚未保存'}</strong></div></section><section class="result-details"><div class="result-score"><span>本次车技分</span><strong class="result-number" data-count="${result.score}">${number(result.score)}</strong><span>${result.fullPressureEscape ? '成就：满警力逃脱 · ' : ''}最高完好警车 ${result.maxPoliceCount} 辆</span></div><div class="result-metrics"><div><span>${escaped ? '完成时间' : '存活时间'}</span><strong>${time(result.duration)}</strong></div><div><span>有效里程</span><strong>${distance(result.distance)}<small> km</small></strong></div><div><span>近失 / 成功闪避</span><strong>${result.nearMisses} / ${result.evadedAttacks}<small> 次</small></strong></div><div><span>发生碰撞</span><strong>${result.collisions}<small> 次</small></strong></div></div><div class="result-breakdown"><h3>得分分项</h3>${[['干净驾驶', result.controlScore, 50], ['交互技巧', result.techniqueScore, 35], ['有效追逐', result.pressureScore, 15]].map(([label, value, weight]) => `<div><span>${label}</span><span class="breakdown-track"><i style="width:${Math.min(100, Number(value) / (Number(weight) * 100) * 100)}%"></i></span><b>${number(Number(value))}<small> / ${number(Number(weight) * 100)}</small></b><small>权重 ${weight}%</small></div>`).join('')}<p>干净里程 ${distance(result.cleanDistance)} km · 加权追逐 ${distance(result.pressureDistance)} km<br>${escaped ? '成功逃脱，9500 分及以上获 10 星。' : '得分保留已完成表现，失败局最高 8 星。'}</p></div>${this.storageNotice()}<div class="result-actions"><button class="button primary" data-action="restart">再跑一次 ${uiIcon('restart')}</button><button class="button secondary" data-action="leaderboard">查看排行 ${uiIcon('records')}</button><button class="text-button" data-action="leave">返回首页</button></div></section></div></main>`;
  }

  private animateResultNumbers() {
    if (this.motionQuery.matches) return;
    const elements = [...this.root.querySelectorAll<HTMLElement>('[data-count]')];
    const start = performance.now();
    const frame = (now: number) => {
      const progress = this.motionQuery.matches ? 1 : Math.min(1, (now - start) / 820);
      const eased = 1 - (1 - progress) ** 3;
      for (const element of elements) element.textContent = number(Number(element.dataset.count) * eased);
      if (progress < 1) this.countFrame = requestAnimationFrame(frame);
    };
    this.countFrame = requestAnimationFrame(frame);
  }

  private storageNotice() {
    const message = getStorageStatus();
    return message ? `<p class="storage-notice" role="status">${escapeHTML(message)}</p>` : '';
  }

  private updateHud(snapshot: GameSnapshot) {
    this.raceHud?.update(snapshot);
  }
}
