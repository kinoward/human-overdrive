import { VEHICLES } from '../config';
import type { Outcome, RaceMetrics, RaceResult } from '../types';

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function getWarning(heat: number): number {
  if (heat >= 100) return 5;
  if (heat >= 75) return 4;
  if (heat >= 50) return 3;
  if (heat >= 25) return 2;
  return heat >= 1 ? 1 : 0;
}

export function calculateScore(metrics: RaceMetrics) {
  const vehicle = VEHICLES.find((entry) => entry.id === metrics.vehicleId)!;
  const completion = clamp(metrics.distance / metrics.targetDistance);
  const averageSpeed = metrics.elapsed > 0 ? metrics.distance / metrics.elapsed * 3.6 : 0;
  const speedFactor = clamp(averageSpeed / (vehicle.topSpeed * 0.7));
  const controlFactor = clamp(1 - metrics.collisions * 0.075);
  const riskFactor = clamp(clamp(metrics.nearMisses / 15) * 0.7 + clamp(metrics.maxPressureDistance / 800) * 0.3);
  const speedScore = Math.round(3000 * speedFactor * completion);
  const controlScore = Math.round(4000 * controlFactor * completion);
  const riskScore = Math.round(3000 * riskFactor * completion);
  const score = speedScore + controlScore + riskScore;
  const stars = Math.min(9, Math.floor(score / 1000));
  return { score, stars, speedScore, controlScore, riskScore };
}

export function buildResult(metrics: RaceMetrics, outcome: Outcome, nickname: string): RaceResult {
  const rating = calculateScore(metrics);
  const fullPressureEscape = outcome === 'escaped'
    && metrics.maxWarning === 5
    && metrics.maxPressureTime >= 20
    && metrics.maxPressureDistance >= 500;
  const cleanNickname = Array.from(nickname.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 16).join('');
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    nickname: cleanNickname || '公路旅人',
    cityId: 'beijing',
    vehicleId: metrics.vehicleId,
    outcome,
    ...rating,
    stars: fullPressureEscape ? 10 : rating.stars,
    duration: Math.round(metrics.elapsed * 100) / 100,
    distance: Math.round(Math.min(metrics.distance, metrics.targetDistance) * 10) / 10,
    targetDistance: metrics.targetDistance,
    maxWarning: metrics.maxWarning,
    nearMisses: metrics.nearMisses,
    collisions: metrics.collisions,
    topSpeed: Math.round(metrics.topSpeed * 10) / 10,
  };
}
