export const DIFFICULTY_XP = {
  light: 5,
  standard: 10,
  hard: 20,
  challenge: 40,
} as const;

export const QUEST_LIMITS = { main: 1, bonus: 3, side: 2 } as const;

export type Difficulty = keyof typeof DIFFICULTY_XP;
export type QuestType = keyof typeof QUEST_LIMITS;
export type FeedbackResult = 'completed' | 'partial' | 'skipped' | 'exempt';
export type HabitResult = FeedbackResult | 'pending';

export interface LevelProgress {
  level: number;
  currentXp: number;
  nextLevelXp: number;
}

export interface LedgerValue {
  settlementKey: string;
  finalXp: number;
  reversedAt?: string;
}

export interface MomentumValue {
  localDate: string;
  result: HabitResult;
}

export interface StateTimelineValue {
  id: string;
  dimension: string;
  localDate: string;
  observedAt: string;
  kind: 'user-self-assessment' | 'user-calibration' | 'event-impact';
  value?: number;
  delta?: number;
  active: boolean;
}

export interface StateTimelineResult {
  dimension: string;
  value: number;
  localDate: string;
  observedAt: string;
  observationIds: string[];
  dailyDelta: number;
  clamped: boolean;
}

export function questXp(difficulty: Difficulty, result: FeedbackResult): number {
  if (result === 'completed') return DIFFICULTY_XP[difficulty];
  if (result === 'partial') return Math.ceil(DIFFICULTY_XP[difficulty] / 2);
  return 0;
}

export function levelRequirement(level: number): number {
  if (!Number.isInteger(level) || level < 0) throw new Error('等级无效。');
  if (level === 0) return 20;
  if (level === 1) return 30;
  if (level === 2) return 40;
  if (level < 10) return 50;
  if (level < 30) return 75;
  return 100;
}

export function levelFromXp(totalXp: number): LevelProgress {
  if (!Number.isSafeInteger(totalXp) || totalXp < 0) throw new Error('经验总量无效。');
  let level = 0;
  let currentXp = totalXp;
  while (level < 30 && currentXp >= levelRequirement(level)) {
    currentXp -= levelRequirement(level);
    level += 1;
  }
  if (level >= 30 && currentXp >= 100) {
    level += Math.floor(currentXp / 100);
    currentXp %= 100;
  }
  return { level, currentXp, nextLevelXp: levelRequirement(level) };
}

export function totalXp(values: LedgerValue[]): number {
  const seen = new Set<string>();
  return values.reduce((sum, value) => {
    if (value.reversedAt || seen.has(value.settlementKey)) return sum;
    if (!Number.isSafeInteger(value.finalXp) || value.finalXp < 0) throw new Error('经验明细无效。');
    seen.add(value.settlementKey);
    return sum + value.finalXp;
  }, 0);
}

export function habitMomentum(values: MomentumValue[]): number {
  const recent = values.slice().sort((a, b) => a.localDate.localeCompare(b.localDate)).slice(-7);
  const effective = recent.filter((value) => value.result !== 'exempt');
  if (!effective.length) return 0;
  const completed = effective.reduce((sum, value) => sum
    + (value.result === 'completed' ? 1 : value.result === 'partial' ? 0.5 : 0), 0);
  return Math.round((5 * completed / effective.length) * 10) / 10;
}

export function clampDailyStateDelta(values: number[]): number {
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.max(-15, Math.min(15, sum));
}

export function resolvedStateValue(previous: number | undefined, deltas: number[], userCalibration?: number): number | undefined {
  if (userCalibration !== undefined) return Math.max(0, Math.min(100, userCalibration));
  if (previous === undefined) return undefined;
  return Math.max(0, Math.min(100, previous + clampDailyStateDelta(deltas)));
}

export function resolveStateTimeline(values: StateTimelineValue[], throughDate?: string): StateTimelineResult[] {
  const active = values.filter((item) => item.active && (!throughDate || item.localDate <= throughDate));
  const results: StateTimelineResult[] = [];
  for (const dimension of new Set(active.map((item) => item.dimension))) {
    const observations = active.filter((item) => item.dimension === dimension)
      .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.observedAt.localeCompare(right.observedAt));
    let current: StateTimelineResult | undefined;
    for (const date of new Set(observations.map((item) => item.localDate))) {
      const sameDay = observations.filter((item) => item.localDate === date);
      const direct = sameDay.filter((item) => item.kind !== 'event-impact' && item.value !== undefined).at(-1);
      if (direct?.value !== undefined) {
        current = {
          dimension, value: Math.max(0, Math.min(100, direct.value)), localDate: date,
          observedAt: direct.observedAt, observationIds: [direct.id], dailyDelta: 0, clamped: false,
        };
        continue;
      }
      if (!current) continue;
      const impacts = sameDay.filter((item) => item.kind === 'event-impact' && item.delta !== undefined);
      if (!impacts.length) continue;
      const rawDelta = impacts.reduce((sum, item) => sum + (item.delta ?? 0), 0);
      const dailyDelta = clampDailyStateDelta(impacts.map((item) => item.delta ?? 0));
      current = {
        ...current,
        value: Math.max(0, Math.min(100, current.value + dailyDelta)),
        localDate: date,
        observedAt: impacts.at(-1)?.observedAt ?? current.observedAt,
        observationIds: [...current.observationIds, ...impacts.map((item) => item.id)],
        dailyDelta,
        clamped: rawDelta !== dailyDelta,
      };
    }
    if (current) results.push(current);
  }
  return results;
}

export function canAddQuest(type: QuestType, current: QuestType[]): boolean {
  return current.filter((value) => value === type).length < QUEST_LIMITS[type];
}
