import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canAddQuest,
  clampDailyStateDelta,
  habitMomentum,
  levelFromXp,
  levelRequirement,
  questXp,
  resolvedStateValue,
  resolveStateTimeline,
  totalXp,
} from '../src/rules.ts';

test('difficulty, partial completion, and no-penalty results use the fixed XP table', () => {
  assert.equal(questXp('light', 'completed'), 5);
  assert.equal(questXp('standard', 'completed'), 10);
  assert.equal(questXp('hard', 'completed'), 20);
  assert.equal(questXp('challenge', 'completed'), 40);
  assert.equal(questXp('light', 'partial'), 3);
  assert.equal(questXp('hard', 'partial'), 10);
  assert.equal(questXp('challenge', 'skipped'), 0);
  assert.equal(questXp('challenge', 'exempt'), 0);
});

test('levels cross multiple thresholds and stay fixed at 100 XP after level 30', () => {
  assert.deepEqual(levelFromXp(0), { level: 0, currentXp: 0, nextLevelXp: 20 });
  assert.deepEqual(levelFromXp(145), { level: 4, currentXp: 5, nextLevelXp: 50 });
  assert.equal(levelRequirement(30), 100);
  assert.deepEqual(levelFromXp(14_285), { level: 153, currentXp: 45, nextLevelXp: 100 });
});

test('ledger totals are idempotent and reversed settlements do not become negative XP', () => {
  const values = Array.from({ length: 10_000 }, (_, index) => ({ settlementKey: `action-${index}:1`, finalXp: 5 }));
  values.push({ settlementKey: 'action-0:1', finalXp: 40 });
  values.push({ settlementKey: 'reversed:1', finalXp: 20, reversedAt: new Date().toISOString() });
  assert.equal(totalXp(values), 50_000);
});

test('momentum uses the latest seven planned days, counts partial as half, and ignores exemptions', () => {
  const sixOfSeven = Array.from({ length: 7 }, (_, index) => ({ localDate: `2026-08-${String(index + 1).padStart(2, '0')}`, result: index === 6 ? 'skipped' : 'completed' }));
  assert.equal(habitMomentum(sixOfSeven), 4.3);
  assert.equal(habitMomentum([
    { localDate: '2026-08-01', result: 'completed' },
    { localDate: '2026-08-02', result: 'completed' },
    { localDate: '2026-08-03', result: 'completed' },
    { localDate: '2026-08-04', result: 'partial' },
    { localDate: '2026-08-05', result: 'partial' },
    { localDate: '2026-08-06', result: 'skipped' },
    { localDate: '2026-08-07', result: 'exempt' },
  ]), 3.3);
});

test('state deltas clamp per day and an explicit user calibration wins', () => {
  assert.equal(clampDailyStateDelta([-8, -7, -7]), -15);
  assert.equal(clampDailyStateDelta([10, 9]), 15);
  assert.equal(resolvedStateValue(50, [-20]), 35);
  assert.equal(resolvedStateValue(50, [-20], 60), 60);
  assert.equal(resolvedStateValue(undefined, [10]), undefined);
});

test('state timeline is re-computable, clamps a day, and lets same-day calibration win', () => {
  const values = [
    { id: 'base', dimension: 'energy', localDate: '2026-08-10', observedAt: '2026-08-10T08:00:00.000Z', kind: 'user-self-assessment', value: 50, active: true },
    { id: 'impact-a', dimension: 'energy', localDate: '2026-08-11', observedAt: '2026-08-11T08:00:00.000Z', kind: 'event-impact', delta: -12, active: true },
    { id: 'impact-b', dimension: 'energy', localDate: '2026-08-11', observedAt: '2026-08-11T09:00:00.000Z', kind: 'event-impact', delta: -10, active: true },
    { id: 'rejected', dimension: 'energy', localDate: '2026-08-12', observedAt: '2026-08-12T08:00:00.000Z', kind: 'event-impact', delta: -5, active: false },
    { id: 'impact-c', dimension: 'energy', localDate: '2026-08-13', observedAt: '2026-08-13T07:00:00.000Z', kind: 'event-impact', delta: -5, active: true },
    { id: 'calibration', dimension: 'energy', localDate: '2026-08-13', observedAt: '2026-08-13T09:00:00.000Z', kind: 'user-calibration', value: 70, active: true },
  ];
  assert.deepEqual(resolveStateTimeline(values), [{
    dimension: 'energy', value: 70, localDate: '2026-08-13', observedAt: '2026-08-13T09:00:00.000Z',
    observationIds: ['calibration'], dailyDelta: 0, clamped: false,
  }]);
  assert.deepEqual(resolveStateTimeline(values, '2026-08-12'), [{
    dimension: 'energy', value: 35, localDate: '2026-08-11', observedAt: '2026-08-11T09:00:00.000Z',
    observationIds: ['base', 'impact-a', 'impact-b'], dailyDelta: -15, clamped: true,
  }]);
});

test('daily quest limits stay at one main, three BONUS, and two side quests', () => {
  assert.equal(canAddQuest('main', []), true);
  assert.equal(canAddQuest('main', ['main']), false);
  assert.equal(canAddQuest('bonus', ['bonus', 'bonus']), true);
  assert.equal(canAddQuest('bonus', ['bonus', 'bonus', 'bonus']), false);
  assert.equal(canAddQuest('side', ['side', 'side']), false);
});
