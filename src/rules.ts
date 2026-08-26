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
export type MonthlyAreaSignal = 'progress' | 'maintain' | 'decline' | 'missing' | 'paused';

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

export function monthlyAreaSignal(
  mode: 'build' | 'maintain' | 'explore' | 'pause',
  currentEvidence: number,
  previousEvidence: number,
  monthEnd: string,
  today: string,
): MonthlyAreaSignal {
  if (mode === 'pause') return 'paused';
  if (currentEvidence === 0) return monthEnd < today && previousEvidence > 0 ? 'decline' : 'missing';
  if (mode === 'maintain') return 'maintain';
  if (monthEnd < today && currentEvidence < previousEvidence) return 'decline';
  return currentEvidence > previousEvidence ? 'progress' : 'maintain';
}

export interface DailyDirection {
  kind: 'recovery' | 'main' | 'goal' | 'reflection' | 'explore';
  reason: string;
}

export interface DailyDirectionInput {
  mainQuest: { status: 'pending' | 'completed' | 'partial' | 'skipped' | 'exempt'; deadlineRisk?: boolean; carriedFromPreviousDay?: boolean } | null;
  recoveryAvailable: boolean;
  activeGoalAvailable: boolean;
  previousStepAvailable: boolean;
  milestoneDue?: boolean;
  stagnantGoal?: boolean;
  areaBalanceNeeded?: boolean;
  goalMode?: 'build' | 'maintain' | 'explore' | 'pause';
}

/**
 * Chooses one visible starting direction. It deliberately returns a reason so the UI
 * can explain the recommendation instead of presenting an unexplained priority.
 */
export function chooseDailyDirection(input: DailyDirectionInput): DailyDirection {
  if (input.recoveryAvailable) return { kind: 'recovery', reason: '近期行动能力较低，先恢复再推进；原任务不会因此失败。' };
  if (input.mainQuest?.status === 'pending') return { kind: 'main', reason: input.mainQuest.deadlineRisk ? '这条主线的可选截止时间临近，先处理最小版本；截止后仍由你决定。' : input.mainQuest.carriedFromPreviousDay ? '这是昨天反馈后生成的下一步；先核对它今天是否仍适合。' : '今天已经有一条确认过的主线，先完成最小版本。' };
  if (input.mainQuest) return { kind: 'main', reason: '今天的主线已经留下反馈，可以决定继续、维持或停下。' };
  if (input.activeGoalAvailable) return {
    kind: 'goal',
    reason: input.stagnantGoal ? '这个目标近 7 天没有推进证据，先缩小一步；仍由你决定是否换路。' : input.milestoneDue ? '当前重点目标的下一里程碑已有明确证据要求，先推进它。' : input.areaBalanceNeeded ? '这个重点建设领域近 7 天的推进证据较少，先补一个最小行动。' : input.goalMode === 'maintain' ? '这个领域当前选择稳定维持，先做一个不会透支的保持动作。' : input.goalMode === 'explore' ? '这个领域当前处于探索期，先用一个小实验获得真实反馈。' : '当前重点目标已经提供了下一步。',
  };
  if (input.previousStepAvailable) return { kind: 'reflection', reason: '昨天留下了一个可核对的最小步骤。' };
  return { kind: 'explore', reason: '还没有足够依据指定方向，先记录真实发生的事。' };
}
