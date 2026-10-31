import type { Point3, RoadPath } from '../types';
import { RoadIndex } from './road-network';
import { angleDifference, laneOffset, type TrafficLeg, type TrafficNetwork } from './traffic-network';
import type { TrafficAgent, TrafficObstacle } from './traffic';

interface Passage {
  road: RoadPath;
  index: RoadIndex;
  occupants: Map<number, { sign: number; entering?: boolean; exitedAt?: number }>;
  reserved?: number;
  direction: number;
  external: boolean;
}

interface EntryRequest {
  agent: TrafficAgent;
  leg: TrafficLeg;
  distance: number;
  visits: number;
}

const shared = (leg: TrafficLeg) => !leg.road.oneWay && leg.road.lanes === 1;

export class TrafficRightOfWay {
  private passages = new Map<string, Passage>();
  private limits = new Map<number, number>();
  private waiting = new Map<number, { road: string; since: number }>();
  private time = 0;

  constructor(private network: TrafficNetwork) {
    for (const leg of network.legs) if (shared(leg) && !this.passages.has(leg.road.id)) {
      this.passages.set(leg.road.id, { road: leg.road, index: new RoadIndex([leg.road]), occupants: new Map(), direction: 0, external: false });
    }
  }

  update(cars: TrafficAgent[], obstacles: TrafficObstacle[], dt: number) {
    this.time += dt;
    this.limits.clear();
    const byId = new Map(cars.map(car => [car.id, car]));
    const requests = new Map<string, EntryRequest[]>();
    for (const passage of this.passages.values()) {
      for (const [id, occupant] of passage.occupants) {
        const car = byId.get(id);
        if (!car) { passage.occupants.delete(id); continue }
        if (car.road === passage.road) { occupant.exitedAt = undefined; occupant.entering = false }
        else if (occupant.entering) {
          const entry = this.entryRequest(car);
          if (!entry || entry.leg.road !== passage.road) passage.occupants.delete(id);
        }
        else {
          occupant.exitedAt ??= car.wheelDistance;
          if (car.wheelDistance - occupant.exitedAt > car.length / 2 + 3) passage.occupants.delete(id);
        }
      }
      for (const car of cars) if (car.road === passage.road && !passage.occupants.has(car.id)) passage.occupants.set(car.id, { sign: car.leg.sign });
      passage.external = obstacles.some(obstacle => this.contains(passage, obstacle));
    }
    for (const car of cars) {
      const request = this.entryRequest(car);
      if (!request) continue;
      const list = requests.get(request.leg.road.id) ?? [];
      list.push(request);
      requests.set(request.leg.road.id, list);
    }
    const queuedIds = new Set<number>();
    for (const [roadId, passage] of this.passages) {
      const candidates = requests.get(roadId) ?? [];
      const signs = new Set([...passage.occupants.values()].map(occupant => occupant.sign));
      if (signs.size === 1) passage.direction = [...signs][0];
      if (!passage.occupants.size) {
        const reservation = candidates.find(request => request.agent.id === passage.reserved && this.exitClear(request, cars, obstacles));
        if (reservation) passage.direction = reservation.leg.sign;
        else {
          candidates.sort((a, b) => this.order(a) - this.order(b) || a.agent.id - b.agent.id);
          const first = candidates.find(request => this.exitClear(request, cars, obstacles));
          passage.reserved = first?.agent.id;
          passage.direction = first?.leg.sign ?? 0;
        }
      } else passage.reserved = undefined;
      const opposed = candidates.some(request => request.leg.sign !== passage.direction);
      for (const request of candidates) {
        const committed = passage.occupants.has(request.agent.id);
        const blocked = passage.external || signs.size > 1 || request.leg.sign !== passage.direction || (!committed && passage.occupants.size > 0 && opposed) || !this.exitClear(request, cars, obstacles);
        if (!blocked) {
          if (request.distance < request.agent.length / 2 + 4) passage.occupants.set(request.agent.id, { sign: request.leg.sign, entering: true });
          continue;
        }
        const limit = Math.max(0, request.distance - request.agent.length / 2 - 3);
        this.limits.set(request.agent.id, Math.min(this.limits.get(request.agent.id) ?? Infinity, limit));
        const previous = this.waiting.get(request.agent.id);
        if (!previous || previous.road !== roadId) this.waiting.set(request.agent.id, { road: roadId, since: this.time });
        queuedIds.add(request.agent.id);
      }
    }
    for (const id of this.waiting.keys()) if (!queuedIds.has(id)) this.waiting.delete(id);
  }

  stopDistance(agent: TrafficAgent) {
    return this.limits.get(agent.id) ?? Infinity;
  }

  allowsSpawn(leg: TrafficLeg, cars: TrafficAgent[]) {
    if (!shared(leg)) return true;
    if (!this.network.canExitNarrow(leg)) return false;
    const passage = this.passages.get(leg.road.id)!;
    if (passage.external || (passage.direction && passage.direction !== leg.sign)) return false;
    if ([...passage.occupants.values()].some(occupant => occupant.sign !== leg.sign)) return false;
    return !cars.some(car => car.road === leg.road && car.leg.sign !== leg.sign);
  }

  private order(request: EntryRequest) {
    const waiting = this.waiting.get(request.agent.id);
    return waiting?.road === request.leg.road.id ? waiting.since : this.time + request.distance / Math.max(3, request.agent.speed);
  }

  private entryRequest(agent: TrafficAgent): EntryRequest | undefined {
    let leg = agent.leg, lane = agent.targetLane, distance = leg.length - agent.along, next = agent.next;
    const horizon = Math.max(45, agent.speed * agent.speed / 6 + agent.speed * 1.5 + 15);
    for (let count = 0; next && count < 48 && distance < horizon; count++) {
      if (shared(next) && next.road !== agent.road) return { agent, leg: next, distance, visits: agent.visits + count + 1 };
      const offset = laneOffset(leg, lane);
      lane = this.network.mappedLane(leg, next, offset);
      leg = next;
      distance += leg.length;
      next = this.network.next(leg, lane, agent.id + agent.visits + count + 1, agent.profile);
    }
    return undefined;
  }

  private contains(passage: Passage, obstacle: TrafficObstacle) {
    const near = passage.index.nearest(obstacle.position.x, obstacle.position.z, obstacle.position.y - 0.79)!;
    if (Math.abs(near.point.y + 0.79 - obstacle.position.y) > 2.2) return false;
    const dx = obstacle.position.x - near.point.x, dz = obstacle.position.z - near.point.z;
    const longitudinal = Math.abs(dx * near.direction.x + dz * near.direction.z);
    const side = Math.abs(dx * near.direction.z - dz * near.direction.x);
    return longitudinal < obstacle.length / 2 + 1 && side < passage.road.width / 2 + obstacle.width / 2;
  }

  private exitClear(request: EntryRequest, cars: TrafficAgent[], obstacles: TrafficObstacle[]) {
    let leg = request.leg, lane = 0;
    for (let count = 0; count < 48; count++) {
      const next = this.network.next(leg, lane, request.agent.id + request.visits + count, request.agent.profile);
      if (!next) return false;
      lane = this.network.mappedLane(leg, next, laneOffset(leg, lane));
      if (next.road !== request.leg.road) {
        const exit = this.network.sample(next, Math.min(next.length, request.agent.length / 2 + 4), laneOffset(next, lane));
        const blocked = (position: Point3, heading: number, length: number, width: number, speed: number) => {
          if (speed > 2 || Math.abs(position.y - exit.point.y - 0.79) > 2.2) return false;
          const dx = position.x - exit.point.x, dz = position.z - exit.point.z;
          const angle = angleDifference(heading, exit.heading);
          const along = Math.abs(dx * Math.sin(exit.heading) + dz * Math.cos(exit.heading));
          const side = Math.abs(dx * Math.cos(exit.heading) - dz * Math.sin(exit.heading));
          const halfWidth = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * length) / 2;
          return along < (request.agent.length + length) / 2 + 3 && side < request.agent.width / 2 + halfWidth + 0.4;
        };
        return !cars.some(car => car !== request.agent && blocked({ ...car.position, y: car.position.y + 0.79 }, car.heading, car.length, car.width, car.speed)) && !obstacles.some(obstacle => blocked(obstacle.position, obstacle.heading, obstacle.length, obstacle.width, Math.hypot(obstacle.velocity.x, obstacle.velocity.z)));
      }
      leg = next;
    }
    return false;
  }
}
