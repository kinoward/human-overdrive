import { readFile, mkdir, writeFile } from 'node:fs/promises';

const endpoint = 'https://overpass.private.coffee/api/interpreter';
const bbox = { south: 39.80, west: 116.18, north: 40.02, east: 116.53 };
const origin = { lat: 39.9075, lon: 116.3913 };
const area = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
const query = `[out:json][timeout:90];(way["highway"]["name"~"四环"](${area});way["highway"~"^(trunk|motorway|trunk_link|motorway_link|primary_link|secondary_link|tertiary_link)$"](${area}););out geom;`;
const inputAt = process.argv.indexOf('--input');
let raw;
if (inputAt >= 0) raw = JSON.parse(await readFile(process.argv[inputAt + 1], 'utf8'));
else {
  const response = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`);
  if (!response.ok) throw new Error(`道路数据获取失败：${response.status}`);
  raw = await response.json();
}
const permitted = /^(motorway|trunk|primary|secondary|tertiary|unclassified|service|residential)(_link)?$/;
const ring = raw.elements.filter(way => permitted.test(way.tags?.highway ?? '') && /四环/.test(way.tags?.name ?? '') && way.geometry?.length > 1);
const mainByNode = new Map();
for (const way of raw.elements.filter(way => /^(trunk|motorway)$/.test(way.tags?.highway ?? '') && way.geometry?.length > 1)) for (const node of way.nodes) {
  if (!mainByNode.has(node)) mainByNode.set(node, []);
  mainByNode.get(node).push(way);
}
const mainQueue = ring.filter(way => /^(trunk|motorway)$/.test(way.tags.highway));
const mainSeen = new Set(mainQueue.map(way => way.id));
for (let at = 0; at < mainQueue.length; at++) for (const node of mainQueue[at].nodes) for (const way of mainByNode.get(node) ?? []) {
  if (!mainSeen.has(way.id)) { mainSeen.add(way.id); mainQueue.push(way); ring.push(way) }
}
const cycleNodes = new Map();
for (const way of mainQueue) for (let i = 1; i < way.nodes.length; i++) {
  const a = way.nodes[i - 1], b = way.nodes[i];
  if (!cycleNodes.has(a)) cycleNodes.set(a, new Set()); if (!cycleNodes.has(b)) cycleNodes.set(b, new Set());
  cycleNodes.get(a).add(b); cycleNodes.get(b).add(a);
}
const leaves = [...cycleNodes.keys()].filter(node => cycleNodes.get(node).size < 2);
for (let at = 0; at < leaves.length; at++) {
  const node = leaves[at];
  for (const neighbor of cycleNodes.get(node) ?? []) { cycleNodes.get(neighbor).delete(node); if (cycleNodes.get(neighbor).size < 2) leaves.push(neighbor) }
  cycleNodes.delete(node);
}
for (let i = ring.length - 1; i >= 0; i--) if (/^(trunk|motorway)$/.test(ring[i].tags.highway) && ring[i].nodes.some(node => !cycleNodes.has(node))) ring.splice(i, 1);
const ringNodes = new Set(ring.flatMap(way => way.nodes));
const links = raw.elements.filter(way => /_link$/.test(way.tags?.highway ?? '') && !ring.includes(way) && way.geometry?.length > 1);
const linkNodes = new Map();
for (const way of links) for (const node of way.nodes) {
  if (!linkNodes.has(node)) linkNodes.set(node, []);
  linkNodes.get(node).push(way);
}
const visited = new Set(), retainedLinks = [];
for (const way of links) {
  if (visited.has(way)) continue;
  const component = [], queue = [way], connections = new Set();
  visited.add(way);
  for (let at = 0; at < queue.length; at++) {
    const current = queue[at]; component.push(current);
    for (const node of current.nodes) {
      if (ringNodes.has(node)) connections.add(node);
      for (const next of linkNodes.get(node) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next) }
    }
  }
  if (connections.size >= 2) retainedLinks.push(...component);
}
const selected = [...new Map([...ring, ...retainedLinks].map(way => [way.id, way])).values()];
const radians = Math.PI / 180;
const project = ({ lat, lon }) => {
  const phi = lat * radians, lambda = (lon - origin.lon) * radians, phi0 = origin.lat * radians;
  const c = Math.acos(Math.min(1, Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda)));
  const k = c > 1e-12 ? c / Math.sin(c) : 1;
  return { x: 6371008.8 * k * Math.cos(phi) * Math.sin(lambda), y: 0, z: -6371008.8 * k * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda)) };
};
const nodes = new Map(), edges = new Map();
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
for (const way of selected) {
  const tags = way.tags;
  const layer = Number.parseInt(tags.layer ?? (tags.bridge && tags.bridge !== 'no' ? '1' : tags.tunnel && tags.tunnel !== 'no' ? '-1' : '0'), 10);
  const height = layer * 6.5;
  way.nodes.forEach((id, i) => {
    if (!nodes.has(id)) nodes.set(id, { ...project(way.geometry[i]), up: 0, down: 0 });
    const node = nodes.get(id);
    node.up = Math.max(node.up, height); node.down = Math.max(node.down, -height);
    if (!edges.has(id)) edges.set(id, new Map());
    if (i) {
      const previous = way.nodes[i - 1];
      const length = distance(nodes.get(previous), node);
      edges.get(previous).set(id, length); edges.get(id).set(previous, length);
    }
  });
}
for (const field of ['up', 'down']) {
  const queue = [...nodes.keys()].filter(id => nodes.get(id)[field] > 0);
  for (let at = 0; at < queue.length; at++) {
    const id = queue[at];
    for (const [next, length] of edges.get(id)) {
      const height = nodes.get(id)[field] - length * 0.055;
      if (height > nodes.get(next)[field] + 0.001) { nodes.get(next)[field] = height; queue.push(next) }
    }
  }
}
const round = number => Math.round(number * 100) / 100;
const point = id => { const p = nodes.get(id); return { x: round(p.x), y: round(p.up > p.down ? p.up : -p.down), z: round(p.z) } };
const pieces = selected.map(way => {
  const kind = /_link$/.test(way.tags.highway) ? 'ramp' : /^(trunk|motorway)$/.test(way.tags.highway) ? 'main' : 'service';
  const lanes = Math.max(1, Math.min(6, Number.parseInt(way.tags.lanes ?? (kind === 'main' ? '4' : kind === 'service' ? '2' : '1'), 10)));
  const width = Number.parseFloat(way.tags.width) || lanes * (kind === 'main' ? 3.5 : 3.25) + (kind === 'main' ? 1.5 : 1);
  const ids = way.tags.oneway === '-1' ? [...way.nodes].reverse() : way.nodes;
  return { id: `osm-${way.id}`, name: kind === 'ramp' ? '四环进出匝道' : kind === 'service' ? `${way.tags.name.replace(/辅路$/, '')}辅路` : way.tags.name ?? '四环主路', kind, lanes, width, oneWay: way.tags.oneway === 'yes' || way.tags.oneway === '-1', osmWayIds: [way.id], nodeIds: [...ids] };
});
const remaining = new Set(pieces), merged = [];
for (const start of pieces) {
  if (!remaining.delete(start)) continue;
  const road = { ...start, nodeIds: [...start.nodeIds], osmWayIds: [...start.osmWayIds] };
  const compatible = other => other.kind === road.kind && other.name === road.name && other.lanes === road.lanes && Math.abs(other.width - road.width) < 0.1 && other.oneWay === road.oneWay;
  let changed = true;
  while (changed) {
    changed = false;
    const after = [...remaining].filter(other => compatible(other) && other.nodeIds[0] === road.nodeIds.at(-1));
    if (after.length === 1) { const next = after[0]; road.nodeIds.push(...next.nodeIds.slice(1)); road.osmWayIds.push(...next.osmWayIds); remaining.delete(next); changed = true }
    const before = [...remaining].filter(other => compatible(other) && other.nodeIds.at(-1) === road.nodeIds[0]);
    if (before.length === 1) { const next = before[0]; road.nodeIds.unshift(...next.nodeIds.slice(0, -1)); road.osmWayIds.unshift(...next.osmWayIds); remaining.delete(next); changed = true }
  }
  merged.push(road);
}
const memberships = new Map();
for (const road of merged) for (const node of road.nodeIds) {
  if (!memberships.has(node)) memberships.set(node, new Set());
  memberships.get(node).add(road.id);
}
const roads = merged.map(road => {
  const points = [point(road.nodeIds[0])];
  for (let i = 1; i < road.nodeIds.length; i++) {
    const a = point(road.nodeIds[i - 1]), b = point(road.nodeIds[i]);
    const steps = Math.max(1, Math.ceil(distance(a, b) / 12));
    for (let step = 1; step <= steps; step++) points.push({ x: round(a.x + (b.x - a.x) * step / steps), y: round(a.y + (b.y - a.y) * step / steps), z: round(a.z + (b.z - a.z) * step / steps) });
  }
  const { nodeIds, ...rest } = road;
  return { ...rest, junctions: [...new Set(nodeIds)].flatMap(node => [...memberships.get(node)].filter(id => id !== road.id).map(roadId => ({ roadId, point: point(node) }))), closed: nodeIds[0] === nodeIds.at(-1), points, length: points.reduce((sum, p, i) => sum + (i ? distance(points[i - 1], p) : 0), 0) };
}).filter(road => road.length > 2);
const mains = selected.filter(way => /^(trunk|motorway)$/.test(way.tags.highway));
const mainGraph = new Map();
for (const way of mains) for (let i = 1; i < way.nodes.length; i++) {
  const a = way.nodes[i - 1], b = way.nodes[i];
  if (!mainGraph.has(a)) mainGraph.set(a, new Set()); if (!mainGraph.has(b)) mainGraph.set(b, new Set());
  mainGraph.get(a).add(b); mainGraph.get(b).add(a);
}
const seen = new Set(), mainLoops = [];
for (const start of mainGraph.keys()) {
  if (seen.has(start)) continue;
  const component = [start]; seen.add(start); let length = 0, closed = true;
  for (let at = 0; at < component.length; at++) {
    const node = component[at]; if (mainGraph.get(node).size !== 2) closed = false;
    for (const next of mainGraph.get(node)) { length += distance(nodes.get(node), nodes.get(next)) / 2; if (!seen.has(next)) { seen.add(next); component.push(next) } }
  }
  mainLoops.push({ length: round(length), closed, nodes: component.length });
}
mainLoops.sort((a, b) => b.length - a.length);
if (mainLoops.length < 2 || mainLoops[1].length < 60000 || !mainLoops[0].closed || !mainLoops[1].closed) throw new Error(`四环主路未形成两个完整闭环：${JSON.stringify(mainLoops)}`);
const data = {
  title: '北京完整四环 · 主路、辅路与连接匝道', origin, bbox,
  source: { name: 'OpenStreetMap / Overpass API', url: endpoint, query, fetchedAt: new Date().toISOString(), osmTimestamp: raw.osm3s.timestamp_osm_base },
  attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0 · https://www.openstreetmap.org/copyright',
  mainLoopLength: round((mainLoops[0].length + mainLoops[1].length) / 2), mainLoops,
  simplifications: ['真实经纬度按局部等距投影转换为米，1 场景米对应 1 地理投影米；不缩短或强制拉伸至公布里程。', '桥隧层级按每层 6.5 米和连续缓坡推定，并非实测高程；道路宽度按 OSM 车道或宽度标签推定。', '建筑与绿化采用简化沿线场景；仅纳入连接四环路网的匝道，通往外部路网的末端封闭。'],
  roads
};
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/data/beijing-roads.json', import.meta.url), JSON.stringify(data));
await writeFile(new URL('../public/data/beijing-roads.source.json', import.meta.url), JSON.stringify({ ...raw, elements: selected }));
const allPoints = roads.flatMap(road => road.points);
const minX = Math.min(...allPoints.map(p => p.x)), maxX = Math.max(...allPoints.map(p => p.x)), minZ = Math.min(...allPoints.map(p => p.z)), maxZ = Math.max(...allPoints.map(p => p.z));
const scale = Math.min(540 / (maxX - minX), 300 / (maxZ - minZ));
const mapPoint = point => `${round((point.x - (minX + maxX) / 2) * scale + 320)},${round((point.z - (minZ + maxZ) / 2) * scale + 195)}`;
const paths = roads.map(road => `<path d="M${road.points.map(mapPoint).join('L')}" stroke="${road.kind === 'main' ? '#ddf3ae' : road.kind === 'service' ? '#729278' : '#4f6a61'}" stroke-width="${road.kind === 'main' ? '1.5' : '0.65'}"/>`).join('');
await writeFile(new URL('../public/data/beijing-map.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 390"><rect width="640" height="390" fill="#172d27"/><g fill="none" stroke-linejoin="round">${paths}</g><g fill="#ccdacb" font-family="sans-serif" font-size="14" text-anchor="middle"><text x="320" y="25">北</text><text x="592" y="195">东</text><text x="320" y="379">南</text><text x="47" y="195">西</text><text x="320" y="216">双向主路 65.17 / 65.29 公里</text></g></svg>`);
console.log(`已保存完整四环：${roads.length} 条道路，双向主路闭环 ${mainLoops.slice(0, 2).map(loop => (loop.length / 1000).toFixed(3)).join(' / ')} 公里，辅路 ${roads.filter(road => road.kind === 'service').length} 条，匝道 ${roads.filter(road => road.kind === 'ramp').length} 条。`);
