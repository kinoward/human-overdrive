import { readFile, mkdir, writeFile } from 'node:fs/promises';

const endpoint = 'https://overpass-api.de/api/interpreter';
const bbox = { south: 39.978, west: 116.295, north: 39.994, east: 116.360 };
const origin = { lat: 39.9848, lon: 116.3275 };
const query = `[out:json][timeout:45];way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|tertiary|service|unclassified)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out geom;`;
const localIndex = process.argv.indexOf('--input');
let raw;
if (localIndex >= 0) {
  raw = JSON.parse(await readFile(process.argv[localIndex + 1], 'utf8'));
} else {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: query });
  if (!response.ok) throw new Error(`道路数据获取失败：${response.status}`);
  raw = await response.json();
}

const projected = (point) => ({
  x: Math.round((point.lon - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180) * 100) / 100,
  y: 0,
  z: Math.round(-(point.lat - origin.lat) * 111320 * 100) / 100
});
const key = (p) => `${p.x},${p.z}`;
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const crop = (a, b) => {
  let lower = 0;
  let upper = 1;
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const pairs = [[-dx, a.lon - bbox.west], [dx, bbox.east - a.lon], [-dy, a.lat - bbox.south], [dy, bbox.north - a.lat]];
  for (const [p, q] of pairs) {
    if (p === 0 && q < 0) return null;
    if (p === 0) continue;
    const ratio = q / p;
    if (p < 0) lower = Math.max(lower, ratio);
    else upper = Math.min(upper, ratio);
    if (lower > upper) return null;
  }
  return [projected({ lon: a.lon + dx * lower, lat: a.lat + dy * lower }), projected({ lon: a.lon + dx * upper, lat: a.lat + dy * upper })];
};

const pieces = [];
for (const way of raw.elements) {
  const tags = way.tags ?? {};
  const ring = /北四环/.test(tags.name ?? '');
  const ramp = tags.highway === 'trunk_link';
  if (!ring && !ramp) continue;
  if (!way.geometry || way.geometry.length < 2) continue;
  const kind = ramp ? 'ramp' : tags.highway === 'trunk' || tags.highway === 'motorway' ? 'main' : 'service';
  const lanes = Number.parseInt(tags.lanes ?? (kind === 'main' ? '4' : kind === 'service' ? '3' : '1'), 10);
  const width = kind === 'main' ? 15.6 : kind === 'service' ? Math.min(12.4, Math.max(7.8, lanes * 3.4 + 0.8)) : 6.2;
  let current = [];
  const flush = () => {
    if (current.length > 1 && current.reduce((total, point, index) => total + (index ? distance(current[index - 1], point) : 0), 0) > 4) {
      pieces.push({ id: `osm-${way.id}-${pieces.length}`, name: kind === 'ramp' ? '四环进出匝道' : kind === 'service' ? `${tags.name?.replace(/辅路$/, '') ?? '北四环'}辅路` : tags.name, kind, width, oneWay: tags.oneway === 'yes', osmWayIds: [way.id], points: current });
    }
    current = [];
  };
  for (let index = 1; index < way.geometry.length; index++) {
    const segment = crop(way.geometry[index - 1], way.geometry[index]);
    if (!segment) { flush(); continue; }
    if (current.length && distance(current[current.length - 1], segment[0]) > 0.1) flush();
    if (!current.length) current.push(segment[0]);
    current.push(segment[1]);
  }
  flush();
}

const roads = [];
const remaining = new Set(pieces);
while (remaining.size) {
  let road = { ...remaining.values().next().value };
  road.points = [...road.points];
  road.osmWayIds = [...road.osmWayIds];
  remaining.delete([...remaining].find((item) => item.id === road.id));
  let changed = true;
  while (changed) {
    changed = false;
    const after = [...remaining].filter((item) => item.kind === road.kind && key(item.points[0]) === key(road.points[road.points.length - 1]));
    if (after.length === 1) {
      const next = after[0];
      road.points.push(...next.points.slice(1));
      road.osmWayIds.push(...next.osmWayIds);
      remaining.delete(next);
      changed = true;
    }
    const before = [...remaining].filter((item) => item.kind === road.kind && key(item.points[item.points.length - 1]) === key(road.points[0]));
    if (before.length === 1) {
      const next = before[0];
      road.points.unshift(...next.points.slice(0, -1));
      road.osmWayIds.unshift(...next.osmWayIds);
      remaining.delete(next);
      changed = true;
    }
  }
  road.length = road.points.reduce((total, point, index) => total + (index ? distance(road.points[index - 1], point) : 0), 0);
  if (road.length > 12) roads.push(road);
}
roads.sort((a, b) => a.kind.localeCompare(b.kind) || b.length - a.length);
const data = {
  title: '北京北四环 · 中关村至学院桥路网',
  origin,
  bbox,
  source: { name: 'OpenStreetMap / Overpass API', url: endpoint, query, fetchedAt: new Date().toISOString(), osmTimestamp: raw.osm3s?.timestamp_osm_base },
  attribution: '© OpenStreetMap contributors',
  license: 'ODbL 1.0 · https://www.openstreetmap.org/copyright',
  simplifications: ['真实道路水平中心线与连接关系；桥梁高程平面化。', '道路宽度由车道标签与统一游戏尺度推定；建筑、植被与护栏为程序化场景，不是实景重建。'],
  roads
};
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/data/beijing-roads.json', import.meta.url), JSON.stringify(data));
console.log(`已保存北京道路：${roads.length} 条，主路 ${roads.filter((road) => road.kind === 'main').length} 条，匝道 ${roads.filter((road) => road.kind === 'ramp').length} 条。`);
