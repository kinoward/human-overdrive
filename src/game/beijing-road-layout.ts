import type { Point3, RoadPath } from '../types';

interface RoadBend {
  axis: 'x' | 'z';
  start: number;
  end: number;
  center: number;
  amplitude: number;
  shape: 's' | 'sweep';
}

const bends: RoadBend[] = [
  { axis: 'x', start: -6750, end: -5550, center: -8550, amplitude: 55, shape: 's' },
  { axis: 'x', start: -8650, end: -7100, center: -8450, amplitude: -80, shape: 'sweep' },
  { axis: 'x', start: -4300, end: -2750, center: -8660, amplitude: -75, shape: 'sweep' },
  { axis: 'x', start: -1700, end: 200, center: -8800, amplitude: 70, shape: 's' },
  { axis: 'z', start: -6100, end: -4100, center: -10420, amplitude: 85, shape: 's' },
  { axis: 'z', start: -2800, end: -500, center: -10420, amplitude: -90, shape: 'sweep' },
  { axis: 'x', start: -7600, end: -5800, center: 8690, amplitude: -85, shape: 'sweep' },
  { axis: 'x', start: -3600, end: -1700, center: 8620, amplitude: 85, shape: 's' },
  { axis: 'x', start: 0, end: 1900, center: 8520, amplitude: -80, shape: 'sweep' },
  { axis: 'z', start: -3900, end: -2000, center: 7890, amplitude: 85, shape: 's' },
  { axis: 'z', start: -800, end: 1200, center: 7890, amplitude: -95, shape: 'sweep' },
  { axis: 'z', start: 4300, end: 6200, center: 7700, amplitude: 75, shape: 'sweep' }
];

function curvePoint(point: Point3): Point3 {
  let x = point.x, z = point.z;
  for (const bend of bends) {
    const t = (point[bend.axis] - bend.start) / (bend.end - bend.start);
    const lateral = Math.abs(point[bend.axis === 'x' ? 'z' : 'x'] - bend.center);
    if (t <= 0 || t >= 1 || lateral >= 1300) continue;
    const fade = Math.max(0, (lateral - 650) / 650);
    const weight = 1 - fade ** 3 * (10 - 15 * fade + 6 * fade ** 2);
    const envelope = 64 * t ** 3 * (1 - t) ** 3;
    const shape = bend.shape === 's' ? (2 * t - 1) * (343 * Math.sqrt(7) / 216) : 1;
    const offset = bend.amplitude * envelope * shape * weight;
    if (bend.axis === 'x') z += offset;
    else x += offset;
  }
  return { x, y: point.y, z };
}

export function buildBeijingRoads(storedRoads: Omit<RoadPath, 'cumulative'>[]): RoadPath[] {
  return storedRoads.map(road => {
    const points = road.points.map(curvePoint);
    const junctions = road.junctions.map(junction => ({ ...junction, point: curvePoint(junction.point) }));
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    return { ...road, points, junctions, cumulative, length: cumulative[cumulative.length - 1] };
  });
}
