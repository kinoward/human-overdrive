import type { Point3, RaceMetrics } from '../types';
import type { ImpactSeverity } from './collisions';

interface PassingVehicle {
  id: number;
  position: Point3;
  heading: number;
  speed: number;
  width: number;
  length: number;
}

export class DrivingScore {
  combo = 0;
  private recoveryDistance = 0;
  private controlled = false;
  private lastSkillDistance = -Infinity;
  private lastSkillTime = -Infinity;
  private encounters = new Map<number, { gap: number; invalid: boolean }>();
  private passedTraffic = new Set<number>();
  private evasionTimes = new Map<number, number>();
  private pendingEvasions = new Set<number>();

  impact(severity: ImpactSeverity) {
    const distance = severity === 'heavy' ? 350 : severity === 'medium' ? 150 : 50;
    this.recoveryDistance = Math.max(this.recoveryDistance, distance);
    this.combo = 0;
    this.encounters.clear();
  }

  evade(id: number) {
    this.pendingEvasions.add(id);
  }

  resetTraffic(id: number) {
    this.encounters.delete(id);
    this.passedTraffic.delete(id);
  }

  update(metrics: RaceMetrics, frame: { dt: number; distance: number; controlled: boolean; nearbyPolice: number; fullPressure: boolean }) {
    if (metrics.elapsed - this.lastSkillTime > 8) this.combo = 0;
    const recovering = Math.min(frame.distance, this.recoveryDistance);
    this.recoveryDistance -= recovering;
    const clean = frame.controlled ? frame.distance - recovering : 0;
    this.controlled = frame.controlled && recovering === 0 && frame.distance > 0;
    metrics.cleanDistance += clean;
    metrics.pressureDistance += clean * Math.min(3, frame.nearbyPolice) / 3;
    if (frame.fullPressure && this.controlled) {
      metrics.maxPressureTime += frame.dt;
      metrics.maxPressureDistance += frame.distance;
    }
    if (!this.controlled) this.encounters.clear();
    let awarded = false;
    for (const id of this.pendingEvasions) {
      const previous = this.evasionTimes.get(id) ?? -Infinity;
      this.evasionTimes.set(id, metrics.elapsed);
      if (metrics.elapsed - previous < 20 || !this.reward(metrics)) continue;
      metrics.evadedAttacks++;
      awarded = true;
    }
    this.pendingEvasions.clear();
    return awarded;
  }

  nearMiss(metrics: RaceMetrics, player: Omit<PassingVehicle, 'id'>, other: PassingVehicle) {
    const dx = player.position.x - other.position.x;
    const dz = player.position.z - other.position.z;
    const along = dx * Math.sin(other.heading) + dz * Math.cos(other.heading);
    const lateral = Math.abs(dx * Math.cos(other.heading) - dz * Math.sin(other.heading));
    const alignment = Math.cos(player.heading - other.heading);
    const halfLength = (player.length + other.length) / 2;
    const gap = lateral - (player.width + other.width) / 2;
    if (!this.controlled || Math.abs(player.position.y - other.position.y) > 2 || Math.hypot(dx, dz) > 60 || alignment < 0.8) {
      this.encounters.delete(other.id);
      return false;
    }
    if (this.passedTraffic.has(other.id)) return false;
    let encounter = this.encounters.get(other.id);
    if (!encounter && along < -halfLength - 2 && gap < 3 && player.speed * alignment > other.speed + 4) {
      encounter = { gap: Infinity, invalid: false };
      this.encounters.set(other.id, encounter);
    }
    if (!encounter) return false;
    if (Math.abs(along) <= halfLength) {
      encounter.gap = Math.min(encounter.gap, gap);
      if (gap <= 0.1 || player.speed * alignment <= other.speed + 4) encounter.invalid = true;
    }
    if (along <= halfLength + 2) return false;
    this.encounters.delete(other.id);
    if (encounter.invalid || encounter.gap <= 0.1 || encounter.gap >= 1.6) return false;
    this.passedTraffic.add(other.id);
    if (!this.reward(metrics)) return false;
    metrics.nearMisses++;
    return true;
  }

  private reward(metrics: RaceMetrics) {
    if (!this.controlled || metrics.distance - this.lastSkillDistance < 60) return false;
    this.lastSkillDistance = metrics.distance;
    this.lastSkillTime = metrics.elapsed;
    this.combo++;
    return true;
  }
}
