const dot = (plane, vertex) => plane[0] * vertex.p[0] + plane[1] * vertex.p[1] + plane[2] * vertex.p[2] - plane[3];
const mix = (a, b, t) => ({ p: a.p.map((v, i) => v + (b.p[i] - v) * t), n: a.n.map((v, i) => v + (b.n[i] - v) * t), uv: a.uv.map((v, i) => v + (b.uv[i] - v) * t) });
const triangles = polygon => polygon.slice(1, -1).map((_, i) => [polygon[0], polygon[i + 1], polygon[i + 2]]);

function clip(polygon, plane, inside) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = dot(plane, a), db = dot(plane, b);
    const keepA = inside ? da <= 1e-8 : da >= -1e-8, keepB = inside ? db <= 1e-8 : db >= -1e-8;
    if (keepA) result.push(a);
    if (keepA !== keepB) result.push(mix(a, b, da / (da - db)));
  }
  return result;
}

function capBoundaries(faces) {
  const key = vertex => vertex.p.map(v => Math.round(v * 100000)).join(',');
  const edges = new Map();
  for (const face of faces) for (let i = 0; i < 3; i++) {
    const a = face[i], b = face[(i + 1) % 3], ka = key(a), kb = key(b);
    if (ka === kb) continue;
    const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const edge = edges.get(id);
    if (edge) edge.count++;
    else edges.set(id, { a, b, ka, kb, count: 1 });
  }
  const boundary = [...edges.values()].filter(edge => edge.count === 1);
  const adjacent = new Map();
  for (const edge of boundary) for (const key of [edge.ka, edge.kb]) { const list = adjacent.get(key) ?? []; list.push(edge); adjacent.set(key, list) }
  const used = new Set(), caps = [];
  for (const initial of boundary) {
    if (used.has(initial)) continue;
    const queue = [initial], segment = [], vertices = new Map();
    while (queue.length) {
      const edge = queue.pop();
      if (used.has(edge)) continue;
      used.add(edge); segment.push(edge); vertices.set(edge.ka, edge.a); vertices.set(edge.kb, edge.b);
      for (const key of [edge.ka, edge.kb]) for (const next of adjacent.get(key) ?? []) if (!used.has(next)) queue.push(next);
    }
    const points = [...vertices.values()];
    if (points.length < 3) continue;
    const center = { p: [0, 1, 2].map(axis => points.reduce((sum, vertex) => sum + vertex.p[axis], 0) / points.length), n: [1, 0, 0], uv: initial.a.uv };
    for (const item of segment) {
      const u = item.b.p.map((v, i) => v - center.p[i]), v = item.a.p.map((value, i) => value - center.p[i]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const magnitude = Math.hypot(...normal);
      if (magnitude < 1e-10) continue;
      const n = normal.map(value => value / magnitude);
      caps.push([{ ...center, n }, { ...item.b, n, uv: initial.a.uv }, { ...item.a, n, uv: initial.a.uv }]);
    }
  }
  return caps;
}

function createPrimitive(document, buffer, material, faces) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (const face of faces) for (const vertex of face) {
    positions.push(...vertex.p);
    const length = Math.hypot(...vertex.n) || 1;
    normals.push(...vertex.n.map(value => value / length)); uvs.push(...vertex.uv); indices.push(indices.length);
  }
  return document.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer))
    .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer));
}

const profiles = {
  'box-truck': { x: 0.145, inner: 0.1035, outer: 0.1855, axles: [{ z: 0.3075, y: 0.0745, radius: 0.0752 }, { z: -0.1578, y: 0.0751, radius: 0.0758 }, { z: -0.2972, y: 0.0752, radius: 0.0759 }] },
  'delivery-van': { x: 0.1268, inner: 0.0985, outer: 0.157, axles: [{ z: 0.3296, y: 0.06225, radius: 0.0622 }, { z: -0.2918, y: 0.062, radius: 0.068, inner: 0.094, outer: 0.158 }] },
  'city-bus': { x: 0.134, inner: 0.1045, outer: 0.1605, axles: [{ z: 0.2592, y: 0.058, radius: 0.0592 }, { z: -0.225, y: 0.059, radius: 0.065, inner: 0.0825, outer: 0.1605 }] }
};

export function splitTrafficWheels(document, spec, scale, translation, transformPrimitive) {
  const profile = profiles[spec.name];
  const source = document.getRoot().listMeshes()[0].listPrimitives()[0];
  const buffer = document.getRoot().listBuffers()[0], material = source.getMaterial();
  const positions = source.getAttribute('POSITION').getArray(), normals = source.getAttribute('NORMAL').getArray(), uvs = source.getAttribute('TEXCOORD_0').getArray(), indices = source.getIndices().getArray();
  let body = [];
  for (let i = 0; i < indices.length; i += 3) body.push([0, 1, 2].map(j => { const id = indices[i + j]; return { p: [...positions.slice(id * 3, id * 3 + 3)], n: [...normals.slice(id * 3, id * 3 + 3)], uv: [...uvs.slice(id * 2, id * 2 + 2)] } }));
  const parent = body.map((_, i) => i), joined = new Map();
  const find = i => parent[i] === i ? i : parent[i] = find(parent[i]);
  for (let i = 0; i < body.length; i++) for (const vertex of body[i]) {
    const key = vertex.p.map(value => Math.round(value * 100000)).join(',');
    if (joined.has(key)) parent[find(i)] = find(joined.get(key));
    else joined.set(key, i);
  }
  const groups = new Map();
  for (let i = 0; i < body.length; i++) { const key = find(i), group = groups.get(key) ?? []; group.push(body[i]); groups.set(key, group) }
  const components = [...groups.values()].filter(faces => faces.length > 40 && faces.length < 2000).map(faces => ({ faces: new Set(faces), min: [0, 1, 2].map(axis => Math.min(...faces.flatMap(face => face.map(vertex => vertex.p[axis])))), max: [0, 1, 2].map(axis => Math.max(...faces.flatMap(face => face.map(vertex => vertex.p[axis])))) }));
  const wheels = [];
  for (let axleIndex = 0; axleIndex < profile.axles.length; axleIndex++) for (const side of [-1, 1]) {
    const axle = profile.axles[axleIndex];
    let center = [side * profile.x * scale[0] + translation[0], axle.y * scale[1] + translation[1], axle.z * scale[2] + translation[2]];
    const component = components.find(item => Math.sign(item.min[0] + item.max[0]) === side && Math.abs((item.min[1] + item.max[1]) / 2 - center[1]) < axle.radius * scale[1] * 0.3 && Math.abs((item.min[2] + item.max[2]) / 2 - center[2]) < axle.radius * scale[2] * 0.3 && item.max[0] - item.min[0] < 0.1 * scale[0] && item.max[1] - item.min[1] < axle.radius * scale[1] * 2.2);
    if (component) center = component.min.map((value, axis) => (value + component.max[axis]) / 2);
    const ry = axle.radius * scale[1] * 1.018, rz = axle.radius * scale[2] * 1.018;
    const x0 = side > 0 ? (axle.inner ?? profile.inner) * scale[0] + translation[0] : -(axle.outer ?? profile.outer) * scale[0] + translation[0];
    const x1 = side > 0 ? (axle.outer ?? profile.outer) * scale[0] + translation[0] : -(axle.inner ?? profile.inner) * scale[0] + translation[0];
    const planes = [[-1, 0, 0, -x0], [1, 0, 0, x1]];
    for (let step = 0; step < 48; step++) {
      const y = Math.cos(step * Math.PI / 24) / ry, z = Math.sin(step * Math.PI / 24) / rz;
      planes.push([0, y, z, 1 + center[1] * y + center[2] * z]);
    }
    if (profile.axles[axleIndex - 1]) planes.push([0, 0, 1, (axle.z + profile.axles[axleIndex - 1].z) / 2 * scale[2] + translation[2]]);
    if (profile.axles[axleIndex + 1]) planes.push([0, 0, -1, -(axle.z + profile.axles[axleIndex + 1].z) / 2 * scale[2] - translation[2]]);
    const remaining = [], selected = [];
    for (const face of body) {
      if (component) { if (component.faces.has(face)) selected.push(face); else remaining.push(face); continue }
      if (face.every(vertex => vertex.p[0] < x0) || face.every(vertex => vertex.p[0] > x1) || face.every(vertex => vertex.p[1] > center[1] + ry) || face.every(vertex => vertex.p[1] < center[1] - ry) || face.every(vertex => vertex.p[2] > center[2] + rz) || face.every(vertex => vertex.p[2] < center[2] - rz)) { remaining.push(face); continue }
      let polygon = face;
      for (const plane of planes) {
        remaining.push(...triangles(clip(polygon, plane, false)));
        polygon = clip(polygon, plane, true);
        if (polygon.length < 3) break;
      }
      if (polygon.length >= 3) selected.push(...triangles(polygon));
    }
    body = remaining;
    const caps = capBoundaries(selected);
    const primitive = createPrimitive(document, buffer, material, [...selected, ...caps]);
    const correction = component ? (component.max[1] - component.min[1]) / (component.max[2] - component.min[2]) : scale[1] / scale[2];
    transformPrimitive(primitive, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, correction, 0, -center[0], -center[1], -center[2] * correction, 1]);
    const local = primitive.getAttribute('POSITION').getArray();
    const radius = center[1];
    let maximumRadius = 0;
    for (let i = 0; i < local.length; i += 3) maximumRadius = Math.max(maximumRadius, Math.hypot(local[i + 1], local[i + 2]));
    const shoulder = maximumRadius * 0.93;
    for (let i = 0; i < local.length; i += 3) {
      const radial = Math.hypot(local[i + 1], local[i + 2]);
      if (radial < 1e-8) continue;
      const targetRadius = radial < shoulder ? radial / shoulder * radius * 0.98 : radius * (0.98 + 0.02 * (radial - shoulder) / (maximumRadius - shoulder));
      local[i + 1] *= targetRadius / radial; local[i + 2] *= targetRadius / radial;
    }
    const name = axleIndex === 0 ? side < 0 ? 'wheel_fl' : 'wheel_fr' : axleIndex === 1 ? side < 0 ? 'wheel_rl' : 'wheel_rr' : side < 0 ? 'wheel_rl2' : 'wheel_rr2';
    wheels.push({ name, center, radius, triangles: primitive.getIndices().getCount() / 3, capTriangles: caps.length, primitive });
  }
  const scene = document.getRoot().listScenes()[0];
  for (const node of [...scene.listChildren()]) { scene.removeChild(node); node.dispose() }
  const root = document.createNode('vehicle'); scene.addChild(root);
  root.addChild(document.createNode('body').setMesh(document.createMesh('body').addPrimitive(createPrimitive(document, buffer, material, body))));
  for (const wheel of wheels) {
    root.addChild(document.createNode(wheel.name).setTranslation(wheel.center).setExtras({ wheelRadius: wheel.radius, wheelAxis: [1, 0, 0], wheelDirection: 1 }).addChild(document.createNode(wheel.name.replace('wheel_', 'mesh_')).setMesh(document.createMesh(`${wheel.name}_mesh`).addPrimitive(wheel.primitive))));
  }
  return wheels.map(({ primitive, ...record }) => record);
}
