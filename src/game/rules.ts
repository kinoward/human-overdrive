import { MAX_POLICE_COUNT, VEHICLES } from '../config';
import type { Outcome, RaceMetrics, RaceResult } from '../types';

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function calculateScore(metrics: RaceMetrics) {
  const vehicle = VEHICLES.find((entry) => entry.id === metrics.vehicleId)!;
  const completion = clamp(metrics.distance / metrics.targetDistance);
  const averageSpeed = metrics.elapsed > 0 ? metrics.distance / metrics.elapsed * 3.6 : 0;
  const speedFactor = clamp(averageSpeed / (vehicle.topSpeed * 0.7));
  const controlFactor = clamp(1 - metrics.collisions * 0.025);
  const pressureFactor = clamp(clamp(metrics.nearMisses / 45) * 0.7 + clamp(metrics.maxPressureDistance / 1200) * 0.3);
  const speedScore = Math.round(3000 * speedFactor * completion);
  const controlScore = Math.round(4000 * controlFactor * completion);
  const pressureScore = Math.round(3000 * pressureFactor * completion);
  const score = speedScore + controlScore + pressureScore;
  const stars = Math.min(9, Math.floor(score / 1000));
  return { score, stars, speedScore, controlScore, pressureScore };
}

export function buildResult(metrics: RaceMetrics, outcome: Outcome, nickname: string): RaceResult {
  const rating = calculateScore(metrics);
  const fullPressureEscape = outcome === 'escaped'
    && metrics.maxPoliceCount >= MAX_POLICE_COUNT
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
    maxPoliceCount: metrics.maxPoliceCount,
    nearMisses: metrics.nearMisses,
    collisions: metrics.collisions,
    topSpeed: Math.round(metrics.topSpeed * 10) / 10,
  };
}
