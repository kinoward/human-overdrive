import { MAX_POLICE_COUNT } from '../config';
import type { Outcome, RaceMetrics, RaceResult } from '../types';

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function calculateScore(metrics: RaceMetrics) {
  const completion = clamp(metrics.distance / metrics.targetDistance);
  const controlScore = Math.floor(5000 * Math.min(completion, clamp(metrics.cleanDistance / metrics.targetDistance)));
  const techniqueScore = Math.floor(3500 * Math.min(completion, clamp((metrics.nearMisses + metrics.evadedAttacks * 2) / (metrics.targetDistance / 500))));
  const pressureScore = Math.floor(1500 * Math.min(completion, clamp(metrics.pressureDistance / (metrics.targetDistance * 0.35))));
  const score = controlScore + techniqueScore + pressureScore;
  const stars = Math.min(9, Math.floor(score / 1000));
  return { score, stars, controlScore, techniqueScore, pressureScore };
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
    stars: outcome === 'escaped' ? (rating.score >= 9500 ? 10 : rating.stars) : Math.min(8, rating.stars),
    duration: Math.round(metrics.elapsed * 100) / 100,
    distance: Math.round(Math.min(metrics.distance, metrics.targetDistance) * 10) / 10,
    targetDistance: metrics.targetDistance,
    maxPoliceCount: metrics.maxPoliceCount,
    nearMisses: metrics.nearMisses,
    collisions: metrics.collisions,
    topSpeed: Math.round(metrics.topSpeed * 10) / 10,
    cleanDistance: Math.round(metrics.cleanDistance * 10) / 10,
    pressureDistance: Math.round(metrics.pressureDistance * 10) / 10,
    evadedAttacks: metrics.evadedAttacks,
    fullPressureEscape,
  };
}
