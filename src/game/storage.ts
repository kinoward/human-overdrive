import { MAX_POLICE_COUNT } from '../config';
import type { RaceResult, VehicleId } from '../types';

const STORAGE_KEY = 'human-overdrive.results.v3';
let storageMessage = '';
let memoryResults: RaceResult[] = [];

function isRaceResult(value: unknown): value is RaceResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  const validShape = typeof result.id === 'string'
    && typeof result.createdAt === 'string'
    && typeof result.nickname === 'string'
    && typeof result.cityId === 'string'
    && (result.vehicleId === 'model-y' || result.vehicleId === 'f850gs')
    && (result.outcome === 'escaped' || result.outcome === 'flipped' || result.outcome === 'caught')
    && typeof result.fullPressureEscape === 'boolean'
    && ['score', 'stars', 'duration', 'distance', 'targetDistance', 'maxPoliceCount', 'nearMisses', 'collisions', 'topSpeed', 'cleanDistance', 'pressureDistance', 'evadedAttacks', 'techniqueScore', 'controlScore', 'pressureScore']
      .every((key) => typeof result[key] === 'number' && Number.isFinite(result[key]) && result[key] >= 0);
  if (!validShape) return false;
  const entry = value as RaceResult;
  const stars = entry.outcome === 'escaped'
    ? (entry.score >= 9500 ? 10 : Math.min(9, Math.floor(entry.score / 1000)))
    : Math.min(8, Math.floor(entry.score / 1000));
  return entry.targetDistance > 0
    && [entry.score, entry.stars, entry.maxPoliceCount, entry.nearMisses, entry.collisions, entry.evadedAttacks, entry.controlScore, entry.techniqueScore, entry.pressureScore].every(Number.isInteger)
    && entry.score <= 10000
    && entry.stars <= 10
    && entry.controlScore <= 5000
    && entry.techniqueScore <= 3500
    && entry.pressureScore <= 1500
    && entry.score === entry.controlScore + entry.techniqueScore + entry.pressureScore
    && entry.distance <= entry.targetDistance
    && entry.cleanDistance <= entry.distance + 0.11
    && entry.pressureDistance <= entry.cleanDistance + 0.11
    && entry.stars === stars
    && (!entry.fullPressureEscape || (entry.outcome === 'escaped' && entry.maxPoliceCount >= MAX_POLICE_COUNT));
}

export function loadResults(): RaceResult[] {
  let stored: string | null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    storageMessage = '浏览器暂不允许保存成绩，本次成绩会保留到页面关闭。';
    return [...memoryResults];
  }
  if (stored === null) return [...memoryResults];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    storageMessage = '本机历史成绩无法读取，本次挑战仍可正常进行。';
    return [...memoryResults];
  }
  if (!Array.isArray(parsed)) {
    storageMessage = '本机历史成绩格式有误，本次挑战仍可正常进行。';
    return [...memoryResults];
  }
  const valid = parsed.filter(isRaceResult).slice(0, 100);
  if (valid.length !== parsed.length) storageMessage = '部分历史成绩无法读取，已保留有效成绩。';
  const combined = [...memoryResults, ...valid];
  const seen = new Set<string>();
  memoryResults = combined.filter((result) => {
    if (seen.has(result.id)) return false;
    seen.add(result.id);
    return true;
  }).slice(0, 100);
  return [...memoryResults];
}

export function saveResult(result: RaceResult): void {
  const saved = loadResults();
  const results = [result, ...saved.filter((entry) => entry.id !== result.id)].slice(0, 100);
  memoryResults = results;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
    storageMessage = '';
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    storageMessage = '成绩已记入本次排行，但浏览器未能保存；关闭页面后可能丢失。';
  }
}

export function getStorageStatus(): string {
  return storageMessage;
}

export function getLeaderboard(
  results: RaceResult[],
  filter: { cityId: string; vehicleId?: VehicleId; mode: 'time' | 'score' },
): RaceResult[] {
  const matches = results.filter((result) => result.cityId === filter.cityId
    && (!filter.vehicleId || result.vehicleId === filter.vehicleId)
    && (filter.mode !== 'time' || result.outcome === 'escaped'));
  return matches.sort((first, second) => {
    if (filter.mode === 'time') return first.duration - second.duration || second.score - first.score;
    return second.stars - first.stars
      || second.score - first.score
      || Number(second.outcome === 'escaped') - Number(first.outcome === 'escaped')
      || first.duration - second.duration;
  });
}
