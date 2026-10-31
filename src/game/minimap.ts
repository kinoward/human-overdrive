import type { Point3, RoadPath } from '../types';

export interface MinimapState {
  position: Point3;
  heading: number;
  speedKmh: number;
  elapsed: number;
  police: { position: Point3; heading: number; operational: boolean }[];
  helicopters: Point3[];
}

interface MapSegment {
  road: RoadPath;
  index: number;
  along: number;
  a: Point3;
  b: Point3;
  kind: RoadPath['kind'];
  width: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface MapRun {
  path: Path2D;
  kind: RoadPath['kind'];
  width: number;
  dashOffset: number;
}

interface MapLayer {
  elevated: boolean;
  distance: number;
  runs: MapRun[];
}

export class RaceMinimap {
  private context: CanvasRenderingContext2D;
  private cells = new Map<string, MapSegment[]>();
  private heading: number | null = null;
  private range = 140;
  private elapsed: number | null = null;

  constructor(private canvas: HTMLCanvasElement, roads: RoadPath[]) {
    this.context = canvas.getContext('2d')!;
    for (const road of roads) {
      for (let index = 1; index < road.points.length; index++) {
        const a = road.points[index - 1], b = road.points[index];
        const padding = road.width * .5;
        const segment: MapSegment = {
          road, index, along: road.cumulative[index - 1], a, b, kind: road.kind, width: road.width,
          minX: Math.min(a.x, b.x) - padding, maxX: Math.max(a.x, b.x) + padding,
          minZ: Math.min(a.z, b.z) - padding, maxZ: Math.max(a.z, b.z) + padding,
        };
        for (let x = Math.floor(segment.minX / 256); x <= Math.floor(segment.maxX / 256); x++) {
          for (let z = Math.floor(segment.minZ / 256); z <= Math.floor(segment.maxZ / 256); z++) {
            const key = `${x},${z}`;
            if (!this.cells.has(key)) this.cells.set(key, []);
            this.cells.get(key)!.push(segment);
          }
        }
      }
    }
  }

  reset() {
    this.heading = null;
    this.range = 140;
    this.elapsed = null;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    delete this.canvas.dataset.mapHeading;
    delete this.canvas.dataset.mapRange;
    delete this.canvas.dataset.mapScale;
    delete this.canvas.dataset.mapSegments;
  }

  draw(state: MinimapState) {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const targetRange = 140 + Math.min(1, Math.abs(state.speedKmh) / 180) * 100;
    const dt = this.elapsed === null ? 0 : Math.max(0, Math.min(.2, state.elapsed - this.elapsed));
    if (this.heading === null) {
      this.heading = state.heading;
      this.range = targetRange;
    } else {
      const turn = Math.atan2(Math.sin(state.heading - this.heading), Math.cos(state.heading - this.heading));
      this.heading += turn * (1 - Math.exp(-dt * 9));
      this.range += (targetRange - this.range) * (1 - Math.exp(-dt * 3));
    }
    this.elapsed = state.elapsed;
    const anchorX = width * .5, anchorY = height * .62;
    const scale = (anchorY - 15) / this.range;
    const angle = this.heading - Math.PI, cosine = Math.cos(angle), sine = Math.sin(angle);
    const project = (point: Point3) => {
      const dx = point.x - state.position.x, dz = point.z - state.position.z;
      return { x: anchorX + (dx * cosine - dz * sine) * scale, y: anchorY + (dx * sine + dz * cosine) * scale };
    };
    const radius = Math.hypot(width * .5, anchorY) / scale + 30;
    const segments = this.nearby(state.position, radius);
    const ctx = this.context;
    const uiScale = Math.max(.72, Math.min(1, width / 230));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.scale(width / 2, height / 2);
    const backdrop = ctx.createRadialGradient(1, 1.1, .1, 1, 1, 1.2);
    backdrop.addColorStop(0, '#04111a8c');
    backdrop.addColorStop(.58, '#04111a57');
    backdrop.addColorStop(1, '#04111a00');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, 2, 2);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(3, 3, width - 6, height - 6);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const layers = this.paths(segments, state.position.y, scale, project);
    for (const layer of layers) {
      ctx.globalAlpha = layer.elevated ? .3 : 1;
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = '#02101ed9';
      for (const run of layer.runs) { ctx.lineWidth = run.width + 2.5; ctx.stroke(run.path); }
      for (const run of layer.runs) {
        ctx.strokeStyle = run.kind === 'main' ? '#c6f0ff' : run.kind === 'ramp' ? '#81d2e4' : '#7da3b7';
        ctx.lineWidth = run.width; ctx.stroke(run.path);
      }
      for (const run of layer.runs) {
        ctx.strokeStyle = run.kind === 'main' ? '#254659' : '#24404e';
        ctx.lineWidth = Math.max(1, run.width - 1.7); ctx.stroke(run.path);
      }
      if (!layer.elevated) {
        ctx.setLineDash([4, 5]); ctx.lineWidth = .65; ctx.strokeStyle = '#c6f0ff8c';
        for (const run of layer.runs) {
          if (run.kind !== 'main') continue;
          ctx.lineDashOffset = run.dashOffset; ctx.stroke(run.path);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    for (const actor of state.police) {
      const point = project(actor.position);
      if (point.x < 6 || point.x > width - 6 || point.y < 6 || point.y > height - 13) continue;
      ctx.save();
      ctx.globalAlpha = Math.abs(actor.position.y - state.position.y) > 4 ? .4 : 1;
      ctx.translate(point.x, point.y);
      ctx.rotate(this.heading - actor.heading);
      ctx.scale(uiScale, uiScale);
      ctx.beginPath();
      ctx.moveTo(0, -5.5); ctx.lineTo(4.5, 4); ctx.lineTo(0, 2); ctx.lineTo(-4.5, 4); ctx.closePath();
      ctx.fillStyle = actor.operational ? '#ff727d' : '#8b9ca7';
      ctx.strokeStyle = '#071322'; ctx.lineWidth = 2.2;
      ctx.stroke(); ctx.fill();
      ctx.restore();
    }
    for (const helicopter of state.helicopters) {
      const point = project(helicopter);
      if (point.x < 9 || point.x > width - 9 || point.y < 9 || point.y > height - 14) continue;
      ctx.save();
      ctx.translate(point.x, point.y); ctx.scale(uiScale, uiScale);
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(5, 0); ctx.lineTo(0, 5); ctx.lineTo(-5, 0); ctx.closePath();
      ctx.strokeStyle = '#06121f'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = '#ffa19e'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-7, -8); ctx.lineTo(7, -8); ctx.moveTo(0, -10); ctx.lineTo(0, -5); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.scale(width / 2, height / 2);
    const fade = ctx.createRadialGradient(1, 1, .64, 1, 1, 1.12);
    fade.addColorStop(0, '#fff'); fade.addColorStop(1, '#fff0');
    ctx.fillStyle = fade; ctx.fillRect(0, 0, 2, 2);
    ctx.restore();
    ctx.restore();
    this.drawPlayer(anchorX, anchorY, uiScale);
    this.drawCompass(width, angle, uiScale);
    this.drawScale(width, height, scale, uiScale);
    this.canvas.dataset.mapHeading = this.heading.toFixed(3);
    this.canvas.dataset.mapRange = this.range.toFixed(0);
    this.canvas.dataset.mapScale = scale.toFixed(3);
    this.canvas.dataset.mapSegments = segments.length.toString();
  }

  dispose() {
    this.cells.clear();
    this.reset();
  }

  private nearby(position: Point3, radius: number) {
    const segments = new Set<MapSegment>();
    for (let x = Math.floor((position.x - radius) / 256); x <= Math.floor((position.x + radius) / 256); x++) {
      for (let z = Math.floor((position.z - radius) / 256); z <= Math.floor((position.z + radius) / 256); z++) {
        for (const segment of this.cells.get(`${x},${z}`) ?? []) {
          if (segment.maxX >= position.x - radius && segment.minX <= position.x + radius && segment.maxZ >= position.z - radius && segment.minZ <= position.z + radius) segments.add(segment);
        }
      }
    }
    return [...segments];
  }

  private paths(segments: MapSegment[], playerY: number, scale: number, project: (point: Point3) => { x: number; y: number }) {
    const roads = new Map<RoadPath, MapSegment[]>();
    const layers = new Map<string, MapLayer>();
    for (const segment of segments) {
      if (!roads.has(segment.road)) roads.set(segment.road, []);
      roads.get(segment.road)!.push(segment);
    }
    for (const roadSegments of roads.values()) {
      roadSegments.sort((a, b) => a.index - b.index);
      let previousIndex = -2, previousLayer = '';
      let run: MapRun | null = null;
      for (const segment of roadSegments) {
        const elevation = (segment.a.y + segment.b.y) * .5;
        const distance = Math.abs(elevation - playerY);
        const elevated = distance > 4;
        const key = elevated ? `height:${Math.round(elevation / 6.5)}` : 'current';
        let layer = layers.get(key);
        if (!layer) { layer = { elevated, distance, runs: [] }; layers.set(key, layer); }
        layer.distance = Math.max(layer.distance, distance);
        if (!run || segment.index !== previousIndex + 1 || key !== previousLayer) {
          const a = project(segment.a);
          run = {
            path: new Path2D(), kind: segment.kind,
            width: Math.max(segment.kind === 'main' ? 3.5 : 2, Math.min(segment.kind === 'main' ? 10 : 6, segment.width * scale)),
            dashOffset: -(segment.along * scale) % 9,
          };
          run.path.moveTo(a.x, a.y);
          layer.runs.push(run);
        }
        const b = project(segment.b);
        run.path.lineTo(b.x, b.y);
        previousIndex = segment.index;
        previousLayer = key;
      }
    }
    return [...layers.values()].sort((a, b) => b.distance - a.distance);
  }

  private drawPlayer(x: number, y: number, scale: number) {
    const ctx = this.context;
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    const glow = ctx.createRadialGradient(0, 0, 3, 0, 0, 17);
    glow.addColorStop(0, '#e1fb5070'); glow.addColorStop(1, '#e1fb5000');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 7); ctx.lineTo(0, 4); ctx.lineTo(-7, 7); ctx.closePath();
    ctx.strokeStyle = '#08131d'; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = '#f7ffd4'; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.fillStyle = '#e1fb50'; ctx.fill();
    ctx.restore();
  }

  private drawCompass(width: number, angle: number, scale: number) {
    const ctx = this.context;
    const x = width - 17, y = 16;
    ctx.save();
    ctx.font = `700 ${Math.max(8, 9 * scale)}px Arial,"PingFang SC",sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#02101f'; ctx.shadowBlur = 4;
    ctx.strokeStyle = '#06121fe0'; ctx.lineWidth = 2.5; ctx.strokeText('北', x - 13, y);
    ctx.fillStyle = '#dceff8'; ctx.fillText('北', x - 13, y);
    ctx.translate(x, y); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(3.5, 4); ctx.lineTo(0, 1.5); ctx.lineTo(-3.5, 4); ctx.closePath();
    ctx.fillStyle = '#d1edf8'; ctx.strokeStyle = '#071322'; ctx.lineWidth = 2;
    ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  private drawScale(width: number, height: number, scale: number, uiScale: number) {
    const ctx = this.context;
    const target = 43 * uiScale;
    const meters = [20, 50, 100, 200].reduce((best, value) => Math.abs(value * scale - target) < Math.abs(best * scale - target) ? value : best);
    const length = meters * scale;
    const x = 11, y = height - 14;
    ctx.save();
    ctx.shadowColor = '#02101f'; ctx.shadowBlur = 4;
    ctx.strokeStyle = '#c5e5f0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x, y); ctx.lineTo(x + length, y); ctx.lineTo(x + length, y - 3); ctx.stroke();
    ctx.fillStyle = '#cce3ed'; ctx.font = `600 ${Math.max(8, 9 * uiScale)}px Arial,"PingFang SC",sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = '#06121fe0'; ctx.lineWidth = 2.5; ctx.strokeText(`${meters} 米`, x, y - 4);
    ctx.fillText(`${meters} 米`, x, y - 4);
    ctx.font = `${Math.max(7, 8 * uiScale)}px Arial,sans-serif`;
    ctx.fillStyle = '#aac5d4'; ctx.textAlign = 'right';
    ctx.strokeText('© OpenStreetMap', width - 7, height - 3); ctx.fillText('© OpenStreetMap', width - 7, height - 3);
    ctx.restore();
  }
}
