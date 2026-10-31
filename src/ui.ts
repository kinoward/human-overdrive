import { CITIES, VEHICLES } from './config';
import { getLeaderboard, getStorageStatus, loadResults } from './game/storage';
import type { GameSnapshot, RaceResult, VehicleConfig, VehicleId } from './types';
import './style.css';

interface UICallbacks {
  onStart: (vehicleId: VehicleId, nickname: string) => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onLeave: () => void;
  onSound: (muted: boolean) => void;
}

type Panel = 'home' | 'cities' | 'garage' | 'leaderboard' | 'rules' | 'race' | 'pause' | 'result';

const arrow = '<span aria-hidden="true">↗</span>';
const logo = '<svg viewBox="0 0 38 28" aria-hidden="true"><path d="M0 26 15 1h10L10 26zm19 0L34 1h4L23 26z" fill="currentColor"/></svg>';
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const number = (value: number) => Math.round(value).toLocaleString('zh-CN');
const time = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}.${Math.floor((value % 1) * 10)}`;
const distance = (value: number) => `${(value / 1000).toFixed(2)}`;
const stars = (value: number) => `<span class="stars" aria-label="${value}星">${Array.from({ length: 10 }, (_, index) => `<span class="${index < value ? 'lit' : ''}" aria-hidden="true">★</span>`).join('')}</span>`;

function roadMap(className = '', detailed = false) {
  return `<svg class="road-map ${className}" viewBox="0 0 640 390" fill="none" aria-hidden="true">
    <g class="map-grid"><path d="M0 65h640M0 130h640M0 195h640M0 260h640M0 325h640M80 0v390M160 0v390M240 0v390M320 0v390M400 0v390M480 0v390M560 0v390"/></g>
    <g class="map-streets"><path d="m-10 88 158 18 96-12 86 12 160-1 160 22M-10 120l170 15 115-6 130 5 122-10 123 23M-20 284l168-27 97-7 104 15 121-10 180 20M-10 310l178-24 117-7 126 20 104-20 135 25M102-10l10 104-10 76 19 90-8 140M191-10l-9 121 9 133-9 156M282-10l-9 124 9 131-1 155M393-10l9 120-5 126 22 164M490-10l-3 130 19 112-8 168M570-10l-10 136 13 119 17 155"/></g>
    <path class="map-river" d="M-10 330c100-70 150-34 220-71s78-93 154-90 127 38 172-12 45-86 114-105"/>
    <path class="map-highway-shadow" d="M-20 195c91 0 118 9 174-1s80-1 129 3 99-14 152-7 123 0 225 0"/>
    <path class="map-highway" d="M-20 195c91 0 118 9 174-1s80-1 129 3 99-14 152-7 123 0 225 0"/>
    <path class="map-service" d="M-20 217c91 0 119 9 177-1s80-1 129 3 97-14 151-7 123 0 223 0M-20 173c91 0 118 9 172-1s80-1 129 3 100-14 153-7 124 0 226 0"/>
    <path class="map-ramps" d="M142 194c-34-3-52-21-40-34 16-17 49 8 53 34m34 2c0 26 20 43 32 34 13-13-6-37-32-34m247-6c-4-27-20-44-35-32s5 33 35 32m31 0c34 5 49 18 40 31s-41-7-40-31"/>
    <g class="map-mark"><circle cx="182" cy="195" r="8"/><circle cx="182" cy="195" r="3"/><circle cx="445" cy="190" r="4"/></g>
    ${detailed ? '<g class="map-label"><text x="159" y="151">中关村</text><text x="362" y="146">学院路</text><text x="284" y="252">北四环</text><text x="472" y="241">主辅路互通</text></g>' : ''}
  </svg>`;
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
  private nickname = '公路旅人';
  private boardMode: 'time' | 'score' = 'time';
  private boardVehicle: VehicleId | undefined;
  private snapshot: GameSnapshot | null = null;
  private result: RaceResult | null = null;
  private error = '';
  private refs = new Map<string, HTMLElement>();

  constructor(private callbacks: UICallbacks) {
    this.root.addEventListener('click', event => this.handleClick(event));
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
    const leavingResult = this.panel === 'result' && ['home', 'cities', 'garage', 'leaderboard', 'rules'].includes(panel);
    if (leavingResult) this.callbacks.onLeave();
    this.previousPanel = leavingResult ? 'home' : this.panel;
    this.panel = panel;
    this.render();
  }

  private handleClick(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!button || button.hasAttribute('disabled')) return;
    const action = button.dataset.action;
    if (action === 'home') this.navigate('home');
    if (action === 'reload') window.location.reload();
    if (action === 'cities') this.navigate('cities');
    if (action === 'garage') this.navigate('garage');
    if (action === 'rules') this.navigate('rules');
    if (action === 'leaderboard') this.navigate('leaderboard');
    if (action === 'back') this.navigate(this.previousPanel === 'rules' ? 'home' : this.previousPanel);
    if (action === 'city') {
      const city = CITIES.find(item => item.id === button.dataset.city);
      if (city?.available) {
        this.cityId = city.id;
        this.navigate('garage');
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
    }
  }

  private soundLabel() {
    return `${this.muted ? '◌' : '◉'} <span>声音${this.muted ? '关' : '开'}</span>`;
  }

  private header() {
    return `<header class="site-header"><button class="brand" data-action="home" aria-label="人类超频首页">${logo}<span>人类超频<small>城市逃亡计划</small></span></button><nav aria-label="主导航"><button class="nav-link ${this.panel === 'cities' || this.panel === 'garage' ? 'active' : ''}" data-action="cities"><span>01</span> 城市关卡</button><button class="nav-link ${this.panel === 'leaderboard' ? 'active' : ''}" data-action="leaderboard"><span>02</span> 本机排行</button><button class="nav-link ${this.panel === 'rules' ? 'active' : ''}" data-action="rules"><span>03</span> 驾驶指南</button></nav><button class="sound-button" data-action="sound" aria-label="${this.muted ? '开启声音' : '关闭声音'}">${this.soundLabel()}</button></header>`;
  }

  private render() {
    const racing = this.panel === 'race' || this.panel === 'pause';
    this.root.className = `game-ui panel-${this.panel}`;
    this.root.innerHTML = `${racing ? '' : this.header()}${this.error ? `<div class="error-banner" role="alert"><strong>暂时无法出发</strong><span>${escapeHTML(this.error)}</span><button data-action="reload">重新载入</button></div>` : ''}${this.content()}${racing ? '' : '<footer class="site-footer"><span>一座城市。一辆车。你自己的逃跑路线。</span><span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap 贡献者</a><span class="footer-dot">·</span> 仅限游戏内虚构驾驶</span></footer>'}`;
    this.refs.clear();
    this.root.querySelectorAll<HTMLElement>('[data-hud]').forEach(element => this.refs.set(element.dataset.hud!, element));
    if (racing && this.snapshot) this.updateHud(this.snapshot);
  }

  private content() {
    if (this.panel === 'home') return this.home();
    if (this.panel === 'cities') return this.cities();
    if (this.panel === 'garage') return this.garage();
    if (this.panel === 'leaderboard') return this.leaderboard();
    if (this.panel === 'rules') return this.rules();
    if (this.panel === 'result') return this.resultPanel();
    return this.hud() + (this.panel === 'pause' ? this.pause() : '');
  }

  private home() {
    const results = loadResults();
    const completed = results.filter(result => result.outcome === 'escaped');
    const bestScore = results.length ? Math.max(...results.map(result => result.score)) : null;
    return `<main class="home-main"><div class="hero-copy"><p class="eyebrow"><span class="live-dot"></span> 北京篇 <span class="eyebrow-rule"></span> 城市逃亡挑战</p><h1>人类<span>超频</span><i>↗</i></h1><p class="hero-tagline">把北京，<br>开成你的赛道。</p><p class="hero-description">在熟悉的道路上，选择不熟悉的方向。<br>穿过车流，摆脱围堵，把自由开到最后。</p><button class="button primary hero-button" data-action="cities">选择你的城市 ${arrow}</button><div class="hero-controls"><span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span><span>驾驶</span><span class="control-divider"></span><span class="key key-wide">空格</span><span>刹车</span></div></div><div class="scene-annotation"><span class="annotation-cross">+</span><div>中国 · 北京<small>北四环 / 主辅路自由穿行</small></div><span class="coordinates">39.99° N<br>116.32° E</span></div><div class="hero-bottom"><button class="featured-course" data-action="garage"><div class="course-mini-map">${roadMap()}</div><div><span class="eyebrow subtle">当前开放 · 关卡 001</span><h2>北京 · 四环逃亡</h2><p>5 公里目标里程 <span>·</span> 双向自由路线 <span>·</span> 五级追捕</p></div><span class="course-arrow">↗</span></button><div class="personal-stat"><span class="eyebrow subtle">你的城市足迹</span><strong>${completed.length.toString().padStart(2, '0')}<small> 次逃脱</small></strong><span>${bestScore === null ? '第一条纪录，等你写下' : `最高车技分 ${number(bestScore)}`}</span></div><div class="home-edition"><span>先选城市，再选座驾。</span><strong>纯粹竞速<br>没有升级与改装</strong></div></div></main>`;
  }

  private cities() {
    return `<main class="page-main cities-main"><div class="page-heading"><div><p class="eyebrow"><span class="section-number">01</span> 选择城市</p><h1>下一站，<em>哪里？</em></h1></div><p>真实道路，不同城市。<br>从北京开始，开出你自己的路线。</p></div><div class="city-grid">${CITIES.map((city, index) => `<button class="city-card ${city.available ? 'city-open' : 'city-soon'}" ${city.available ? `data-action="city" data-city="${city.id}"` : 'disabled'}><div class="city-card-top"><span class="city-number">${(index + 1).toString().padStart(3, '0')}</span><span class="city-status">${city.available ? '<span class="live-dot"></span> 现已开放' : '后续开放'}</span></div><div class="city-art">${roadMap('', city.available)}</div><div class="city-card-body"><span class="city-coordinates">${escapeHTML(city.coordinates)}</span><h2>${escapeHTML(city.name)}<span>${city.available ? '↗' : '＋'}</span></h2><p>${escapeHTML(city.district)}</p><div class="city-card-line"></div><span class="city-description">${escapeHTML(city.description)}</span></div></button>`).join('')}</div><div class="page-note"><span class="live-dot"></span> 本次开放北京精选路段，其他城市正在路上。<button data-action="home">返回首页 ←</button></div></main>`;
  }

  private garage() {
    const vehicle = VEHICLES.find(item => item.id === this.vehicleId)!;
    return `<main class="page-main garage-main"><div class="page-heading"><div><p class="eyebrow"><span class="section-number">02</span> 选择座驾</p><h1>用你的方式，<em>出发。</em></h1></div><button class="text-button" data-action="cities">北京 · 四环精选 <span>更换城市 ↗</span></button></div><div class="garage-layout"><section class="vehicle-showcase"><div class="vehicle-tabs" role="group" aria-label="车辆选择">${VEHICLES.map((item, index) => `<button class="vehicle-tab ${item.id === vehicle.id ? 'selected' : ''}" data-action="vehicle" data-vehicle="${item.id}"><span>0${index + 1}</span>${item.kind === 'car' ? '公路汽车' : '探险摩托'}<span>${item.id === vehicle.id ? '●' : '○'}</span></button>`).join('')}</div><div class="vehicle-stage"><span class="vehicle-watermark">${vehicle.kind === 'car' ? '01' : '02'}</span>${vehicleArt(vehicle)}<div class="vehicle-stage-caption"><span>${escapeHTML(vehicle.make)}</span><span>原型外观 · 街机调校</span></div></div><div class="vehicle-description"><span class="eyebrow subtle">驾驶性格</span><p>${escapeHTML(vehicle.description)}</p></div></section><section class="vehicle-detail"><p class="eyebrow subtle">${escapeHTML(vehicle.region)} · ${vehicle.kind === 'car' ? '纯电汽车' : '探险摩托'}</p><h2>${escapeHTML(vehicle.name)}</h2><p class="vehicle-subtitle">${escapeHTML(vehicle.subtitle)}</p><div class="spec-grid"><div><span>极速</span><strong>${vehicle.topSpeed}<small> km/h</small></strong></div><div><span>车重</span><strong>${vehicle.mass.toLocaleString('zh-CN')}<small> kg</small></strong></div><div><span>车宽</span><strong>${vehicle.width.toFixed(2)}<small> m</small></strong></div><div><span>操控灵活度</span><strong>${vehicle.handling <= 1 ? Math.round(vehicle.handling * 100) : Math.round(vehicle.handling)}<small> /100</small></strong></div></div><label class="nickname-label" for="nickname">你的榜单昵称 <span>仅保存在本机</span></label><input id="nickname" name="nickname" class="nickname-input" maxlength="16" value="${escapeHTML(this.nickname)}" autocomplete="off" spellcheck="false"/><button class="button primary start-button" data-action="start" ${this.ready && !this.error ? '' : 'disabled'}>${this.ready ? '开始逃亡' : '正在准备道路…'} ${arrow}</button><p class="start-note">目标 5 公里 · 预计 2–3 分钟<br>推荐使用键盘，全绿灯，自由往返。</p><button class="text-button small" data-action="rules">出发前，了解挑战规则 ↗</button></section></div></main>`;
  }

  private leaderboard() {
    const results = getLeaderboard(loadResults(), { cityId: this.cityId, vehicleId: this.boardVehicle, mode: this.boardMode });
    return `<main class="page-main leaderboard-main"><div class="page-heading"><div><p class="eyebrow"><span class="section-number">03</span> 本机排行榜</p><h1>把名字，<em>留在北京。</em></h1></div><p>每一次逃脱，都值得被记住。<br>记录保存在当前浏览器，不与其他玩家联网。</p></div><div class="board-toolbar"><div class="segmented" role="group" aria-label="排行类型"><button class="${this.boardMode === 'time' ? 'selected' : ''}" data-action="mode" data-mode="time">最快逃脱</button><button class="${this.boardMode === 'score' ? 'selected' : ''}" data-action="mode" data-mode="score">车技得分</button></div><div class="board-filters"><span>北京 · 四环逃亡</span><select name="board-vehicle" aria-label="按车型筛选"><option value="">全部车型</option>${VEHICLES.map(vehicle => `<option value="${vehicle.id}" ${vehicle.id === this.boardVehicle ? 'selected' : ''}>${escapeHTML(vehicle.name)}</option>`).join('')}</select></div></div><div class="leaderboard-table"><div class="board-row board-labels"><span>名次</span><span>驾驶者 / 座驾</span><span>${this.boardMode === 'time' ? '逃脱用时' : '车技分'}</span><span>评级</span><span>最高警告</span><span>挑战日期</span></div>${results.length ? results.slice(0, 20).map((result, index) => `<div class="board-row ${index === 0 ? 'first-place' : ''}"><strong class="board-rank">${(index + 1).toString().padStart(2, '0')}</strong><span class="board-player"><strong>${escapeHTML(result.nickname)}</strong><small>${escapeHTML(VEHICLES.find(vehicle => vehicle.id === result.vehicleId)?.name ?? result.vehicleId)}${result.outcome !== 'escaped' ? ' · 未逃脱' : ''}</small></span><strong class="board-value">${this.boardMode === 'time' ? time(result.duration) : number(result.score)}</strong><span class="board-rating">${result.stars}<small> 星</small></span><span class="board-warning">${result.maxWarning} 级</span><span class="board-date">${new Date(result.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span></div>`).join('') : `<div class="board-empty">${roadMap()}<span class="eyebrow subtle">这里还没有纪录</span><h2>${this.boardMode === 'time' ? '第一位逃脱者，会是你吗？' : '每一次挑战，都能留下车技分。'}</h2><p>${this.boardMode === 'time' ? '成功完成挑战后，你的用时会出现在这里。' : '出发吧，用一次干净的超车写下第一条纪录。'}</p><button class="button primary" data-action="garage">去写下纪录 ${arrow}</button></div>`}</div>${this.storageNotice()}<div class="page-note"><span>${this.boardMode === 'time' ? '仅成功逃脱的成绩进入计时榜；跨车型用时仅供比较。' : '按统一车技规则评分；失败局也记录已完成的表现。'}</span><button data-action="rules">评分如何计算 ↗</button></div></main>`;
  }

  private rules() {
    return `<main class="page-main rules-main"><div class="page-heading"><div><p class="eyebrow"><span class="section-number">驾驶指南</span> 出发前的三十秒</p><h1>路线自由，<em>后果真实。</em></h1></div><button class="button secondary" data-action="garage">去选车 ${arrow}</button></div><div class="rules-layout"><section class="rule-overview">${roadMap('', true)}<h2>不用冲线。<br>把里程开够，<br><em>就算逃脱。</em></h2><p>主路、辅路、匝道都可以走。<br>逆行与同路往返，实际行驶均计入里程。<br>原地空转与碰撞抖动不计。</p><div class="rule-controls"><span><kbd>W A S D</kbd> 或方向键驾驶</span><span><kbd>空格</kbd> 刹车</span><span><kbd>Esc</kbd> 暂停 / 继续</span></div></section><section class="rule-details"><article><span>01</span><div><h3>先是警告，然后越来越难。</h3><p>第一次违规触发追捕。警告从 1 级逐步升到 5 级，持续行驶也不会消退；超速、逆行与碰撞会加快升级。最高 10 辆警车、3 架直升机。</p></div></article><article><span>02</span><div><h3>追上你，还不算抓到你。</h3><p>警车接近、超过或接触你都不直接判负。翻车，或被警方围堵到无法脱困持续数秒，才会结束挑战。摩托有平衡辅助，强撞击仍可能失控。</p></div></article><article><span>03</span><div><h3>快，也要开得漂亮。</h3><p>车技分由速度表现、干净操控和有效风险技巧组成。成功近失超车、高压下行驶可以加分；碰撞打断连击，反复贴着同一辆车不会连续加分。</p><div class="score-weights"><span><b>30%</b> 速度表现</span><span><b>40%</b> 干净操控</span><span><b>30%</b> 风险技巧</span></div></div></article><article><span>04</span><div><h3>五级警告，十星车技。</h3><p>普通表现评为 0–9 星。在最高警力的有效追捕下完成一段驾驶并成功逃脱，可获得 10 星「大佬」评级。警告级别与车技星级分别计算。</p></div></article><article><span>05</span><div><h3>两张榜，留下两种精彩。</h3><p>最快逃脱榜记录成功用时；车技分榜记录驾驶表现。可以按车型筛选，没有升级、改装和贴纸，胜负只在这一次驾驶。</p></div></article></section></div></main>`;
  }

  private hud() {
    return `<div class="race-hud"><div class="race-top"><div class="race-title">${logo}<div><strong>北京 · 四环逃亡</strong><span>自由路线 / 目标 5 公里</span></div></div><div class="race-warning"><div class="warning-heading"><span>警告 <b data-hud="warning">0</b> 级</span><span class="warning-bars" data-hud="warning-bars">${Array.from({ length: 5 }, () => '<i></i>').join('')}</span></div><div class="pursuer-counts"><span>警车 <b data-hud="police">0</b></span><span>直升机 <b data-hud="helicopters">0</b></span></div></div><div class="race-actions"><button class="hud-button" data-action="sound" aria-label="${this.muted ? '开启声音' : '关闭声音'}">${this.soundLabel()}</button><button class="hud-button" data-action="pause">Ⅱ <span>暂停</span></button></div></div><div class="race-event" data-hud="event" aria-live="polite"></div><div class="wrong-way" data-hud="wrong-way" aria-hidden="true">↶ 逆向行驶 <span>里程仍然计入</span></div><div class="capture-alert" data-hud="capture" aria-hidden="true"><strong>正在被围堵</strong><span>恢复行驶，冲出包围</span><div><i data-hud="capture-bar"></i></div></div><div class="race-bottom"><div class="speedometer"><span class="speed-label">当前时速</span><div><strong data-hud="speed">000</strong><span>km/h</span></div><div class="speed-ticks"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div><div class="live-score"><span>车技分</span><strong data-hud="score">0</strong><div><span data-hud="combo">干净驾驶</span><span>近失 <b data-hud="near-miss">0</b></span></div></div><div class="race-progress"><div class="progress-title"><span>逃脱里程</span><strong><b data-hud="distance">0.00</b><small> / <span data-hud="target">5.00</span> km</small></strong></div><div class="distance-track"><i data-hud="progress"></i><span>↗</span></div><div class="progress-meta"><span data-hud="elapsed">00:00.0</span><span>往返与逆行均计入</span></div></div></div><div class="race-key-hint"><span>WASD / 方向键 驾驶</span><span>空格 刹车</span><span>Esc 暂停</span></div></div>`;
  }

  private pause() {
    return `<div class="modal-backdrop"><section class="pause-panel" role="dialog" aria-modal="true" aria-labelledby="pause-title"><p class="eyebrow"><span class="live-dot"></span> 时间已经暂停</p><h1 id="pause-title">喘口气，<br><em>再上路。</em></h1><p>追捕与计时已暂停。<br>准备好后，继续你的逃亡。</p><button class="button primary" data-action="resume">继续驾驶 ${arrow}</button><button class="button secondary" data-action="restart">重新挑战 ↻</button><button class="text-button" data-action="leave">返回城市首页 ←</button></section></div>`;
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
