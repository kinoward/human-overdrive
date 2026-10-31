import { CITIES, VEHICLES } from './config';
import { getLeaderboard, getStorageStatus, loadResults } from './game/storage';
import type { GameSnapshot, RaceResult, VehicleConfig, VehicleId } from './types';
import { cityMapArt, menuRoadArt, uiIcon } from './ui-art';
import './style.css';

interface UICallbacks {
  onStart: (vehicleId: VehicleId, nickname: string) => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onLeave: () => void;
  onSound: (muted: boolean) => void;
}

type Panel = 'home' | 'cities' | 'garage' | 'options' | 'leaderboard' | 'rules' | 'race' | 'pause' | 'result';

const arrow = '<span class="button-arrow" aria-hidden="true">→</span>';
const logo = '<svg viewBox="0 0 38 28" aria-hidden="true"><path d="M0 26 15 1h10L10 26zm19 0L34 1h4L23 26z" fill="currentColor"/></svg>';
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const number = (value: number) => Math.round(value).toLocaleString('zh-CN');
const time = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}.${Math.floor((value % 1) * 10)}`;
const distance = (value: number) => `${(value / 1000).toFixed(2)}`;
const stars = (value: number) => `<span class="stars" aria-label="${value}星">${Array.from({ length: 10 }, (_, index) => `<span class="${index < value ? 'lit' : ''}" aria-hidden="true">★</span>`).join('')}</span>`;

function roadMap(className = '', detailed = false) {
  return `<img class="road-map ${className}" src="/data/beijing-map.svg" alt="北京完整四环主辅路地图${detailed ? '，北、东、南、西四环按真实线形连接' : ''}">`;
}

function vehicleArt(vehicle: VehicleConfig) {
  if (vehicle.kind === 'motorcycle') {
    return `<svg class="vehicle-art motorcycle-art" viewBox="0 0 660 300" role="img" aria-label="摩托车侧面示意图">
      <ellipse cx="333" cy="261" rx="265" ry="14" fill="#000" opacity=".3"/>
      <g fill="#101514" stroke="#55605c" stroke-width="4"><circle cx="163" cy="216" r="54"/><circle cx="505" cy="216" r="54"/></g>
      <g fill="none" stroke="#8c9690" stroke-width="5"><circle cx="163" cy="216" r="33"/><circle cx="505" cy="216" r="33"/><path d="m143 193 40 46m-43-3 45-40m297-3 45 45m-45 0 45-45"/></g>
      <path d="m161 216 102-61 94 57-94-13-102 17m102-61 55-42 77 32-38 67m-94-57 24 47" fill="none" stroke="#a7afa8" stroke-width="10" stroke-linejoin="round"/>
      <path d="m405 123 33 16 68 77" fill="none" stroke="#d2d8ce" stroke-width="11"/>
      <path d="m229 141 23-31 66-16 67 23 31 38-51 9-70-19z" fill="${vehicle.color}" stroke="#d9e8e3" stroke-opacity=".25" stroke-width="2"/>
      <path d="m231 143-59-25-52 12 4 20 80 8 28-4m84-51-33-9-23 7-8 10 64 5" fill="#242f2b"/>
      <path d="m394 124 7-51 26-20 16 73" fill="#d5e4d7" fill-opacity=".3" stroke="#b8c6ba" stroke-width="2"/>
      <path d="m408 122 34-8 20 32-36 6z" fill="${vehicle.color}"/>
      <path d="m438 125 17 4 3 10-17-2z" fill="#edffd1"/>
      <path d="m238 175 80-10 32 31-11 29-68 3-39-22z" fill="#313c37" stroke="#69766c" stroke-width="3"/>
      <path d="m120 122-10-47 63-4 22 58" fill="#28322d" stroke="#8b978b" stroke-width="3"/>
      <path d="m392 80-31-12m7 2-8-16m18 30 35 12" stroke="#c1cbc0" stroke-width="5" stroke-linecap="round"/>
      <path d="m307 225 51 10 58-14 4-12-66 4" fill="#9aa699"/><path d="m126 149-20 17h-15m408 17 37 5" stroke="#c7d0c4" stroke-width="4"/>
    </svg>`;
  }
  return `<svg class="vehicle-art" viewBox="0 0 760 300" role="img" aria-label="汽车侧面示意图">
    <ellipse cx="382" cy="261" rx="314" ry="16" fill="#000" opacity=".3"/>
    <path d="m65 206 15-42 106-27 77-75c38-26 156-29 224-7l105 80 86 25 15 44-8 33H72z" fill="${vehicle.color}" stroke="#e9eee6" stroke-opacity=".32" stroke-width="2"/>
    <path d="m207 134 65-65c33-18 130-25 184-8l85 73z" fill="#26322e" stroke="#6b7a70" stroke-width="2"/>
    <path d="m350 57-9 79m116-76 30 74" stroke="#a7b5ab" stroke-width="6"/>
    <path d="m75 196 74-9 468 1 73 18M225 148l-6 81m129-89-4 87m164-83 19 84" fill="none" stroke="#56635a" stroke-opacity=".45" stroke-width="2"/>
    <path d="m277 149 26-1m131 0 26 1" stroke="#445448" stroke-width="5" stroke-linecap="round"/>
    <path d="m85 166 51-6-8 18-51 4m565-17 34 10-1 12-25-7" fill="#e9ffce"/>
    <path d="m622 168 8 10 28 5" fill="none" stroke="#fb845f" stroke-width="6"/>
    <path d="M74 222h620l-6 20H73z" fill="#25302a"/>
    <g fill="#111714" stroke="#4b574e" stroke-width="4"><circle cx="204" cy="222" r="49"/><circle cx="570" cy="222" r="49"/></g>
    <g fill="#748174" stroke="#a8b4a6" stroke-width="2"><circle cx="204" cy="222" r="31"/><circle cx="570" cy="222" r="31"/></g>
    <g stroke="#252f28" stroke-width="10"><path d="m204 192 0 60m-28-44 56 27m-55 0 55-27m338-16v60m-28-44 56 27m-55 0 55-27"/></g>
    <g fill="#b8c4b4"><circle cx="204" cy="222" r="8"/><circle cx="570" cy="222" r="8"/></g>
    <path d="m198 140-12-10-24 5 2 12 28 3" fill="#667365"/>
  </svg>`;
}

export class GameUI {
  private root = document.querySelector<HTMLDivElement>('#app')!;
  private panel: Panel = 'home';
  private previousPanel: Panel = 'home';
  private ready = false;
  private muted = false;
  private vehicleId: VehicleId = 'model-y';
  private cityId = 'beijing';
  private palette: 'day' | 'night' | 'paper' = 'day';
  private cityTab: 'map' | 'records' | 'guide' = 'map';
  private nickname = '公路旅人';
  private boardMode: 'time' | 'score' = 'time';
  private boardVehicle: VehicleId | undefined;
  private snapshot: GameSnapshot | null = null;
  private result: RaceResult | null = null;
  private error = '';
  private refs = new Map<string, HTMLElement>();
  private swipeStart: { x: number; y: number } | null = null;
  private swipeAt = -1000;

  constructor(private callbacks: UICallbacks) {
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
    this.render();
  }

  setReady() {
    this.ready = true;
    this.render();
  }

  update(snapshot: GameSnapshot) {
    this.snapshot = snapshot;
    if (snapshot.status === 'paused' && this.panel === 'race') {
      this.panel = 'pause';
      this.render();
    } else if (snapshot.status === 'running' && this.panel === 'pause') {
      this.panel = 'race';
      this.render();
    } else if (snapshot.status === 'ready' && (this.panel === 'race' || this.panel === 'pause')) {
      this.panel = 'home';
      this.render();
    }
    if (this.panel === 'race' || this.panel === 'pause') this.updateHud(snapshot);
  }

  showResult(result: RaceResult) {
    this.result = result;
    this.panel = 'result';
    this.render();
  }

  showError(message: string) {
    this.error = message;
    this.render();
  }

  private navigate(panel: Panel) {
    const leavingResult = this.panel === 'result' && ['home', 'cities', 'garage', 'options', 'leaderboard', 'rules'].includes(panel);
    if (leavingResult) this.callbacks.onLeave();
    this.previousPanel = leavingResult ? 'home' : this.panel;
    this.panel = panel;
    this.render();
    window.scrollTo(0, 0);
    this.root.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }

  private changeCity(direction: number) {
    const index = CITIES.findIndex(city => city.id === this.cityId);
    this.cityId = CITIES[(index + direction + CITIES.length) % CITIES.length].id;
    this.render();
  }

  private handleKey(event: KeyboardEvent) {
    if ((event.target as HTMLElement).matches('input, select, textarea')) return;
    if (this.panel === 'pause' && event.key === 'Tab') {
      const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('.pause-panel button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[0]?.focus(); }
    }
    if (this.panel === 'cities' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      this.changeCity(event.key === 'ArrowRight' ? 1 : -1);
    }
    if (event.key === 'Escape' && ['cities', 'garage', 'options', 'leaderboard', 'rules'].includes(this.panel)) {
      event.preventDefault();
      this.navigate(this.panel === 'garage' ? 'cities' : 'home');
    }
  }

  private handleClick(event: Event) {
    if (performance.now() - this.swipeAt < 350) return;
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!button || button.hasAttribute('disabled')) return;
    const action = button.dataset.action;
    if (action === 'home') this.navigate('home');
    if (action === 'options') this.navigate('options');
    if (action === 'city-tab') {
      this.cityTab = button.dataset.tab as 'map' | 'records' | 'guide';
      this.render();
    }
    if (action === 'palette') {
      this.palette = button.dataset.palette as 'day' | 'night' | 'paper';
      this.cityId = button.dataset.city!;
      this.render();
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
        this.cityId = city.id;
        this.render();
      }
    }
    if (action === 'vehicle') {
      this.vehicleId = button.dataset.vehicle as VehicleId;
      this.render();
    }
    if (action === 'mode') {
      this.boardMode = button.dataset.mode as 'time' | 'score';
      this.render();
    }
    if (action === 'start' && this.ready) {
      this.nickname = this.nickname.trim() || '公路旅人';
      this.panel = 'race';
      this.render();
      this.callbacks.onStart(this.vehicleId, this.nickname);
    }
    if (action === 'pause') this.callbacks.onPause();
    if (action === 'resume') this.callbacks.onResume();
    if (action === 'restart') {
      this.panel = 'race';
      this.render();
      this.callbacks.onRestart();
    }
    if (action === 'leave') {
      this.panel = 'home';
      this.render();
      this.callbacks.onLeave();
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
    const racing = this.panel === 'race' || this.panel === 'pause';
    const focused = document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement) ? document.activeElement : null;
    const focusAction = focused?.dataset.action;
    const focusValue = focused?.dataset.palette ?? focused?.dataset.tab ?? focused?.dataset.city ?? focused?.dataset.vehicle ?? focused?.dataset.mode;
    const focusCity = focused?.dataset.city;
    const focusHeading = focused?.matches('main h1');
    const focusId = focused?.id;
    const focusName = focused?.getAttribute('name');
    const menu = ['home', 'cities', 'garage', 'options'].includes(this.panel);
    this.root.className = `game-ui panel-${this.panel}${menu ? ` menu-screen palette-${this.palette}` : ''}`;
    this.root.innerHTML = `${racing || menu ? '' : this.header()}${this.error ? `<div class="error-banner" role="alert"><strong>暂时无法出发</strong><span>${escapeHTML(this.error)}</span><button data-action="reload">重新载入</button></div>` : ''}${this.content()}${racing || menu ? '' : '<footer class="site-footer"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap 贡献者</a></footer>'}`;
    this.root.querySelectorAll<HTMLElement>('main h1').forEach(heading => heading.tabIndex = -1);
    this.refs.clear();
    this.root.querySelectorAll<HTMLElement>('[data-hud]').forEach(element => this.refs.set(element.dataset.hud!, element));
    if (racing && this.snapshot) this.updateHud(this.snapshot);
    if (this.panel === 'pause') {
      this.root.querySelector('.race-hud')?.setAttribute('inert', '');
      this.root.querySelector<HTMLButtonElement>('[data-action="resume"]')?.focus({ preventScroll: true });
    } else if (focusAction) {
      [...this.root.querySelectorAll<HTMLElement>('[data-action]')].find(element => element.dataset.action === focusAction && (element.dataset.palette ?? element.dataset.tab ?? element.dataset.city ?? element.dataset.vehicle ?? element.dataset.mode) === focusValue && element.dataset.city === focusCity)?.focus({ preventScroll: true });
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
    if (this.panel === 'options') return this.options();
    if (this.panel === 'leaderboard') return this.leaderboard();
    if (this.panel === 'rules') return this.rules();
    if (this.panel === 'result') return this.resultPanel();
    return this.hud() + (this.panel === 'pause' ? this.pause() : '');
  }

  private home() {
    return `<main class="menu-stage home-main"><div class="menu-road">${menuRoadArt()}</div><section class="title-menu"><h1 aria-label="人类超频">Human Overdrive<span class="title-pin" aria-hidden="true"></span></h1><div class="title-actions"><button class="menu-button" data-action="cities">游玩</button><button class="menu-button" data-action="options">选项</button></div></section><button class="corner-sound" data-action="sound" aria-label="${this.muted ? '开启声音' : '关闭声音'}" aria-pressed="${this.muted}">${this.soundLabel()}</button></main>`;
  }

  private cities() {
    const selectedIndex = CITIES.findIndex(city => city.id === this.cityId);
    const selected = CITIES[selectedIndex];
    const results = loadResults();
    const summaries: Record<string, string> = {
      beijing: '沿着北京四环驾驶，穿过车流，摆脱追捕。',
      shanghai: '穿行高架与江岸。<br>即将开放。',
      chongqing: '在桥梁与坡道间穿行。<br>即将开放。',
      tokyo: '穿过繁忙的都市环线。<br>即将开放。',
      'los-angeles': '驶向日落下的城市公路。<br>即将开放。',
    };
    return `<main class="menu-stage cities-main"><h1 class="visually-hidden">选择城市</h1><button class="menu-back" data-action="home" aria-label="返回首页">${uiIcon('arrow-left')}</button><div class="selector-road" aria-hidden="true"><i></i><i></i></div><section class="city-deck" aria-label="城市选择，使用左右方向键切换" aria-roledescription="轮播">${CITIES.map((city, index) => {
      let offset = index - selectedIndex;
      if (offset > CITIES.length / 2) offset -= CITIES.length;
      if (offset < -CITIES.length / 2) offset += CITIES.length;
      const active = offset === 0;
      const best = results.filter(result => result.cityId === city.id).reduce((score, result) => Math.max(score, result.score), 0);
      const top = getLeaderboard(results, { cityId: city.id, mode: 'time' }).slice(0, 3);
      let detail = `<p class="card-best">最佳：${number(best)}</p><div class="card-divider"></div><p class="card-description">${summaries[city.id]}</p>`;
      if (active && this.cityTab === 'records') detail = `<p class="card-best">最快逃脱</p><div class="card-divider"></div>${top.length ? `<ol class="card-records">${top.map(result => `<li><span>${escapeHTML(result.nickname)}</span><b>${time(result.duration)}</b></li>`).join('')}</ol>` : '<p class="card-description">暂无纪录</p>'}<button class="card-link" data-action="leaderboard">查看排行榜</button>`;
      if (active && this.cityTab === 'guide') detail = `<p class="card-best">${city.available ? '目标：5 公里' : '即将开放'}</p><div class="card-divider"></div><p class="card-description">${city.available ? '累计有效行驶里程即可逃脱。翻车或持续被围堵则挑战结束。' : '此城市暂未开放挑战。'}</p><button class="card-link" data-action="rules">驾驶指南</button>`;
      return `<article class="city-card city-${city.id} ${active ? 'is-selected' : ''}" style="--offset:${offset}" aria-label="${city.name}"><button class="city-select" tabindex="${active ? 0 : -1}" data-action="city" data-city="${city.id}" aria-label="选择${city.name}${city.available ? '' : '，即将开放'}" aria-pressed="${active}"></button><div class="city-color"><div class="city-art">${cityMapArt(city.id)}</div></div><div class="city-palette" role="group" aria-label="${city.name}配色">${(['day', 'night', 'paper'] as const).map((palette, paletteIndex) => `<button class="palette-swatch swatch-${palette} ${this.palette === palette ? 'selected' : ''}" tabindex="${active ? 0 : -1}" data-action="palette" data-palette="${palette}" data-city="${city.id}" aria-label="${city.name}${['日间', '夜间', '纸色'][paletteIndex]}配色" aria-pressed="${this.palette === palette}"></button>`).join('')}</div><div class="city-card-body"><h2>${escapeHTML(city.name)}</h2>${detail}</div>${active ? `<nav class="city-tabs" aria-label="关卡信息">${([['map', 'pin', '城市介绍'], ['records', 'records', '城市纪录'], ['guide', 'medal', '挑战规则']] as const).map(([tab, icon, label]) => `<button class="${this.cityTab === tab ? 'selected' : ''}" data-action="city-tab" data-tab="${tab}" aria-label="${label}" aria-pressed="${this.cityTab === tab}">${uiIcon(icon)}</button>`).join('')}</nav>` : ''}</article>`;
    }).join('')}</section><button class="menu-button city-play" data-action="choose-city" ${selected.available ? '' : 'disabled'}>${selected.available ? '游玩' : '未开放'}</button></main>`;
  }

  private garage() {
    const vehicle = VEHICLES.find(item => item.id === this.vehicleId)!;
    return `<main class="menu-stage garage-main"><button class="menu-back" data-action="cities" aria-label="返回城市选择">${uiIcon('arrow-left')}</button><h1>选择车辆</h1><section class="garage-choice" aria-label="车辆选择">${VEHICLES.map(item => `<button class="garage-vehicle ${item.id === vehicle.id ? 'selected' : ''}" data-action="vehicle" data-vehicle="${item.id}" aria-pressed="${item.id === vehicle.id}"><span class="garage-vehicle-art">${vehicleArt(item)}</span><strong>${escapeHTML(item.name)}</strong><span>${escapeHTML(item.make)}</span></button>`).join('')}</section><div class="garage-setup"><p>${vehicle.topSpeed} km/h <span>·</span> ${vehicle.width.toFixed(2)} m <span>·</span> 目标 5 公里</p><label for="nickname">昵称 <input id="nickname" name="nickname" maxlength="16" value="${escapeHTML(this.nickname)}" autocomplete="nickname" spellcheck="false"/></label><button class="menu-button" data-action="start" ${this.ready && !this.error ? '' : 'disabled'}>${this.error ? '加载失败' : this.ready ? '出发' : '准备中'}</button><p class="garage-keys">WASD / 方向键驾驶 · 空格刹车 · Esc 暂停</p></div></main>`;
  }

  private options() {
    return `<main class="menu-stage options-main"><button class="menu-back" data-action="home" aria-label="返回首页">${uiIcon('arrow-left')}</button><section class="options-list"><h1>选项</h1><button class="menu-button option-sound" data-action="sound" aria-label="${this.muted ? '开启声音' : '关闭声音'}" aria-pressed="${this.muted}">${this.soundLabel()}</button><button class="menu-button" data-action="leaderboard">排行榜</button><button class="menu-button" data-action="rules">驾驶指南</button><a class="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap 贡献者</a></section></main>`;
  }

  private leaderboard() {
    const results = getLeaderboard(loadResults(), { cityId: 'beijing', vehicleId: this.boardVehicle, mode: this.boardMode });
    return `<main class="page-main leaderboard-main"><div class="page-heading"><div><h1>排行榜</h1></div><p>成绩保存在当前浏览器。</p></div><div class="board-toolbar"><div class="segmented" role="group" aria-label="排行类型"><button class="${this.boardMode === 'time' ? 'selected' : ''}" data-action="mode" data-mode="time" aria-pressed="${this.boardMode === 'time'}">最快逃脱</button><button class="${this.boardMode === 'score' ? 'selected' : ''}" data-action="mode" data-mode="score" aria-pressed="${this.boardMode === 'score'}">车技得分</button></div><div class="board-filters"><span>北京 · 四环逃亡</span><select name="board-vehicle" aria-label="按车型筛选"><option value="">全部车型</option>${VEHICLES.map(vehicle => `<option value="${vehicle.id}" ${vehicle.id === this.boardVehicle ? 'selected' : ''}>${escapeHTML(vehicle.name)}</option>`).join('')}</select></div></div><div class="leaderboard-table"><div class="board-row board-labels"><span>名次</span><span>驾驶者 / 座驾</span><span>${this.boardMode === 'time' ? '逃脱用时' : '车技分'}</span><span>评级</span><span>最高警告</span><span>挑战日期</span></div>${results.length ? results.slice(0, 20).map((result, index) => `<div class="board-row ${index === 0 ? 'first-place' : ''}"><strong class="board-rank">${(index + 1).toString().padStart(2, '0')}</strong><span class="board-player"><strong>${escapeHTML(result.nickname)}</strong><small>${escapeHTML(VEHICLES.find(vehicle => vehicle.id === result.vehicleId)?.name ?? result.vehicleId)}${result.outcome !== 'escaped' ? ' · 未逃脱' : ''}</small></span><strong class="board-value">${this.boardMode === 'time' ? time(result.duration) : number(result.score)}</strong><span class="board-rating">${result.stars}<small> 星</small></span><span class="board-warning">${result.maxWarning} 级</span><span class="board-date">${new Date(result.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span></div>`).join('') : `<div class="board-empty">${roadMap()}<span class="eyebrow subtle">这里还没有纪录</span><h2>暂无纪录</h2><p>完成挑战后，成绩保存在本机。</p><button class="button primary" data-action="garage">游玩 ${arrow}</button></div>`}</div>${this.storageNotice()}<div class="page-note"><span>${this.boardMode === 'time' ? '仅成功逃脱的成绩进入计时榜；跨车型用时仅供比较。' : '按统一车技规则评分；失败局也记录已完成的表现。'}</span><button data-action="rules">评分如何计算 ↗</button></div></main>`;
  }

  private rules() {
    return `<main class="page-main rules-main"><div class="page-heading"><div><h1>驾驶指南</h1></div><button class="button secondary" data-action="garage">去选车 ${arrow}</button></div><div class="rules-layout"><section class="rule-overview">${roadMap('', true)}<h2>目标：5 公里</h2><p>主路、辅路、匝道都可以走。<br>逆行与同路往返，实际行驶均计入里程。<br>原地空转与碰撞抖动不计。</p><div class="rule-controls"><span><kbd>W A S D</kbd> 或方向键驾驶</span><span><kbd>空格</kbd> 刹车</span><span><kbd>Esc</kbd> 暂停 / 继续</span></div></section><section class="rule-details"><article><span>01</span><div><h3>警告与追捕</h3><p>第一次违规触发追捕。警告从 1 级逐步升到 5 级，持续行驶也不会消退；超速、逆行与碰撞会加快升级。最高 10 辆警车、3 架直升机。</p></div></article><article><span>02</span><div><h3>失败条件</h3><p>警车接近、超过或接触你都不直接判负。翻车，或被警方围堵到无法脱困持续数秒，才会结束挑战。摩托有平衡辅助，强撞击仍可能失控。</p></div></article><article><span>03</span><div><h3>车技评分</h3><p>车技分由速度表现、干净操控和有效风险技巧组成。成功近失超车、高压下行驶可以加分；碰撞打断连击，反复贴着同一辆车不会连续加分。</p><div class="score-weights"><span><b>30%</b> 速度表现</span><span><b>40%</b> 干净操控</span><span><b>30%</b> 风险技巧</span></div></div></article><article><span>04</span><div><h3>车技星级</h3><p>普通表现评为 0–9 星。在最高警力的有效追捕下完成一段驾驶并成功逃脱，可获得 10 星「大佬」评级。警告级别与车技星级分别计算。</p></div></article><article><span>05</span><div><h3>本机排行榜</h3><p>最快逃脱榜记录成功用时；车技分榜记录驾驶表现。可以按车型筛选，没有升级、改装和贴纸，胜负只在这一次驾驶。</p></div></article></section></div></main>`;
  }

  private hud() {
    return `<div class="race-hud"><div class="race-top"><div class="race-title">${logo}<div><strong>北京 · 四环逃亡</strong><span>原尺度完整四环 / 本局目标 5 公里</span></div></div><div class="race-warning"><div class="warning-heading"><span>警告 <b data-hud="warning">0</b> 级</span><span class="warning-bars" data-hud="warning-bars">${Array.from({ length: 5 }, () => '<i></i>').join('')}</span></div><div class="pursuer-counts"><span>警车 <b data-hud="police">0</b></span><span>直升机 <b data-hud="helicopters">0</b></span></div></div><div class="race-actions"><button class="hud-button" data-action="sound" aria-label="${this.muted ? '开启声音' : '关闭声音'}">${this.soundLabel()}</button><button class="hud-button" data-action="pause" aria-label="暂停驾驶">${uiIcon('pause')} <span>暂停</span></button></div></div><div class="race-event" data-hud="event" aria-live="polite"></div><div class="wrong-way" data-hud="wrong-way" aria-hidden="true">↶ 逆向行驶 <span>里程仍然计入</span></div><div class="capture-alert" data-hud="capture" aria-hidden="true"><strong>正在被围堵</strong><span>恢复行驶，冲出包围</span><div><i data-hud="capture-bar"></i></div></div><div class="race-bottom"><div class="speedometer"><span class="speed-label">当前时速</span><div><strong data-hud="speed">000</strong><span>km/h</span></div><div class="speed-ticks"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div><div class="live-score"><span>车技分</span><strong data-hud="score">0</strong><div><span data-hud="combo">干净驾驶</span><span>近失 <b data-hud="near-miss">0</b></span></div></div><div class="race-progress"><div class="progress-title"><span>逃脱里程</span><strong><b data-hud="distance">0.00</b><small> / <span data-hud="target">5.00</span> km</small></strong></div><div class="distance-track"><i data-hud="progress"></i><span>↗</span></div><div class="progress-meta"><span data-hud="elapsed">00:00.0</span><span>往返与逆行均计入</span></div></div></div><div class="race-key-hint"><span>WASD / 方向键 驾驶</span><span>空格 刹车</span><span>Esc 暂停</span></div></div>`;
  }

  private pause() {
    return `<div class="modal-backdrop"><section class="pause-panel" role="dialog" aria-modal="true" aria-labelledby="pause-title"><h1 id="pause-title">暂停</h1><button class="button primary" data-action="resume">继续</button><button class="button secondary" data-action="restart">重新开始</button><button class="text-button" data-action="leave">主菜单</button></section></div>`;
  }

  private resultPanel() {
    const result = this.result!;
    const escaped = result.outcome === 'escaped';
    const vehicle = VEHICLES.find(item => item.id === result.vehicleId)!;
    const title = escaped ? '这一程，你自由了。' : result.outcome === 'flipped' ? '失控，只是一瞬间。' : '这次，被围住了。';
    const subtitle = escaped ? '北京的这条路，记住了你的名字。' : '记住这次转向，下次开得更漂亮。';
    const rating = result.stars === 10 ? '大佬 · 满警力逃脱' : result.stars >= 8 ? '城市游侠' : result.stars >= 5 ? '公路高手' : result.stars >= 2 ? '正在上手' : '初次上路';
    const board = getLeaderboard(loadResults(), { cityId: result.cityId, vehicleId: result.vehicleId, mode: escaped ? 'time' : 'score' });
    const rank = board.findIndex(item => item.id === result.id) + 1;
    return `<main class="page-main result-main"><div class="result-kicker"><span class="status-badge ${escaped ? '' : 'failed'}">${escaped ? '成功逃脱' : result.outcome === 'flipped' ? '翻车 · 挑战结束' : '被捕 · 挑战结束'}</span><span>北京 · 四环逃亡</span></div><div class="result-heading"><h1>${title}</h1><p>${subtitle}</p></div><div class="result-layout"><section class="rating-panel"><span class="eyebrow subtle">本次车技评级</span><div class="rating-number">${result.stars}<span>/ 10</span></div>${stars(result.stars)}<h2>${rating}</h2><p>${escapeHTML(result.nickname)} <span>·</span> ${escapeHTML(vehicle.name)}</p><div class="result-rank"><span>${escaped ? '本车型最快逃脱榜' : '本车型车技分榜'}</span><strong>${rank ? `第 ${rank} 名` : '本次挑战已结束'}</strong></div></section><section class="result-details"><div class="result-score"><span>本次车技分</span><strong>${number(result.score)}</strong><span>最高警告 ${result.maxWarning} 级</span></div><div class="result-metrics"><div><span>${escaped ? '逃脱用时' : '存活时间'}</span><strong>${time(result.duration)}</strong></div><div><span>有效里程</span><strong>${distance(result.distance)}<small> km</small></strong></div><div><span>近失超车</span><strong>${result.nearMisses}<small> 次</small></strong></div><div><span>发生碰撞</span><strong>${result.collisions}<small> 次</small></strong></div></div><div class="result-breakdown"><h3>每一分，都来自驾驶。</h3>${[['速度表现', result.speedScore, 30], ['干净操控', result.controlScore, 40], ['风险技巧', result.riskScore, 30]].map(([label, value, weight]) => `<div><span>${label}</span><span class="breakdown-track"><i style="width:${Math.min(100, Number(value) / (Number(weight) * 100) * 100)}%"></i></span><b>${number(Number(value))}<small> / ${number(Number(weight) * 100)}</small></b><small>权重 ${weight}%</small></div>`).join('')}<p>${escaped ? '完成目标里程，表现全部计入车技分。' : `本次完成 ${Math.min(100, Math.round(result.distance / result.targetDistance * 100))}% 目标里程，车技分已按完成比例计入。`}</p></div>${this.storageNotice()}<div class="result-actions"><button class="button primary" data-action="restart">再跑一次 ${arrow}</button><button class="button secondary" data-action="leaderboard">查看排行 ↗</button><button class="text-button" data-action="leave">回到首页</button></div></section></div></main>`;
  }

  private storageNotice() {
    const message = getStorageStatus();
    return message ? `<p class="storage-notice" role="status">${escapeHTML(message)}</p>` : '';
  }

  private text(name: string, value: string) {
    const element = this.refs.get(name);
    if (element && element.textContent !== value) element.textContent = value;
  }

  private updateHud(snapshot: GameSnapshot) {
    this.text('speed', Math.round(Math.abs(snapshot.speedKmh)).toString().padStart(3, '0'));
    this.text('warning', snapshot.warning.toString());
    this.text('police', snapshot.policeCount.toString());
    this.text('helicopters', snapshot.helicopterCount.toString());
    this.text('score', number(snapshot.score));
    this.text('combo', snapshot.combo > 1 ? `${snapshot.combo} 连续干净超车` : '干净驾驶');
    this.text('near-miss', snapshot.nearMisses.toString());
    this.text('distance', distance(snapshot.distance));
    this.text('target', distance(snapshot.targetDistance));
    this.text('elapsed', time(snapshot.elapsed));
    this.text('event', snapshot.event);
    const event = this.refs.get('event');
    if (event) event.className = `race-event ${snapshot.event ? 'visible' : ''} ${snapshot.eventTone}`;
    const progress = this.refs.get('progress');
    if (progress) progress.style.width = `${Math.min(100, snapshot.distance / snapshot.targetDistance * 100)}%`;
    const bars = this.refs.get('warning-bars');
    if (bars) Array.from(bars.children).forEach((bar, index) => bar.classList.toggle('active', index < snapshot.warning));
    const wrongWay = this.refs.get('wrong-way');
    wrongWay?.classList.toggle('visible', snapshot.wrongWay);
    wrongWay?.setAttribute('aria-hidden', String(!snapshot.wrongWay));
    const capture = snapshot.captureProgress <= 1 ? snapshot.captureProgress : snapshot.captureProgress / 100;
    const captureAlert = this.refs.get('capture');
    captureAlert?.classList.toggle('visible', capture > 0);
    captureAlert?.setAttribute('aria-hidden', String(capture <= 0));
    const captureBar = this.refs.get('capture-bar');
    if (captureBar) captureBar.style.width = `${Math.min(100, capture * 100)}%`;
  }
}
