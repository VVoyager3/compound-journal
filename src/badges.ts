import type {
  AssetKey,
  Dimension,
  Goal,
  GrowthBranch,
  Habit,
  HabitLog,
  Milestone,
  Quest,
  QuestFeedback,
  Review,
  XpLedger,
} from './model.ts';

export const HABIT_ACHIEVEMENT_THRESHOLDS = [1, 3, 7, 14, 30, 60, 100, 180, 365] as const;
export const RECOVERY_ACHIEVEMENT_THRESHOLDS = [1, 3, 7, 14, 30, 60, 100] as const;

type HabitAchievementThreshold = typeof HABIT_ACHIEVEMENT_THRESHOLDS[number];
type RecoveryAchievementThreshold = typeof RECOVERY_ACHIEVEMENT_THRESHOLDS[number];

const HABIT_ACHIEVEMENT_TITLES: Record<HabitAchievementThreshold, string> = {
  1: '第一次完成', 3: '开始生根', 7: '留下节奏', 14: '稳步积累', 30: '成为日常',
  60: '持续同行', 100: '百次沉淀', 180: '深深扎根', 365: '长期相伴',
};
const RECOVERY_ACHIEVEMENT_TITLES: Record<RecoveryAchievementThreshold, string> = {
  1: '先照顾自己', 3: '懂得停靠', 7: '恢复有方', 14: '稳稳复原',
  30: '照顾成习', 60: '恢复韧性', 100: '百次照顾',
};

export type GrowthBadgeSourceType = 'milestone' | 'goal' | 'habit' | 'recovery' | 'experiment';
export type GrowthBadgeTheme = Dimension | 'habit' | 'recovery' | 'experiment';
export type GrowthBadgeId = `milestone:${string}` | `goal:${string}` | `habit:${string}:${HabitAchievementThreshold}`
  | `recovery:${RecoveryAchievementThreshold}` | `experiment:${string}`;

export interface GrowthBadge {
  id: GrowthBadgeId;
  sourceType: GrowthBadgeSourceType;
  theme: GrowthBadgeTheme;
  name: string;
  evidence: string;
  earnedOn: string;
  completedAt: string;
  sourceAction: string;
  related: { type: 'goal' | 'habit' | 'recovery' | 'review'; id?: string; name: string };
  milestoneId: string;
  goalId: string;
  goalResult: string;
  dimension: Dimension;
  /** Legacy display metadata; no longer required to earn a badge. */
  branchId?: string;
  branchName?: string;
  branchAsset?: AssetKey;
  habitId?: string;
  habitName?: string;
  reviewId?: string;
  threshold?: HabitAchievementThreshold | RecoveryAchievementThreshold;
  count?: number;
  sourceQuestId?: string;
  confirmation: 'manual' | 'quest';
}

export interface AchievementEvidenceInput {
  habits?: readonly Habit[];
  habitLogs?: readonly HabitLog[];
  quests?: readonly Quest[];
  feedbacks?: readonly QuestFeedback[];
}

export interface GrowthBadgeSelectionInput extends AchievementEvidenceInput {
  milestones: readonly Milestone[];
  goals: readonly Goal[];
  branches?: readonly GrowthBranch[];
  ledger: readonly XpLedger[];
  reviews?: readonly Review[];
}

export interface NextAchievableAchievement {
  id: `habit:${string}:${HabitAchievementThreshold}` | `recovery:${RecoveryAchievementThreshold}`;
  sourceType: 'habit' | 'recovery';
  theme: 'habit' | 'recovery';
  name: string;
  evidence: string;
  current: number;
  threshold: HabitAchievementThreshold | RecoveryAchievementThreshold;
  remaining: number;
  habitId?: string;
  habitName?: string;
}

function newestById<T extends { id: string; updatedAt: string; version: number }>(items: readonly T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const current = result.get(item.id);
    if (!current || item.version > current.version || (item.version === current.version && item.updatedAt > current.updatedAt)) result.set(item.id, item);
  }
  return result;
}

function milestoneSettlements(ledger: readonly XpLedger[]): Map<string, XpLedger> {
  const result = new Map<string, XpLedger>();
  ledger.filter((item) => item.sourceType === 'milestone' && item.difficulty === 'milestone'
    && item.ratio === 1 && (item.finalXp === 5 || item.finalXp === 50) && item.baseXp === item.finalXp && !item.reversedAt)
    .slice()
    .sort((left, right) => right.localDate.localeCompare(left.localDate)
      || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .forEach((item) => {
      if (item.settlementKey === `${item.sourceId}:1` && !result.has(item.sourceId)) result.set(item.sourceId, item);
    });
  return result;
}

interface CompletedHabitEvidence { log: HabitLog; earnedOn: string; completedAt: string }

function completedHabitLogs(logs: readonly HabitLog[], feedbacks: readonly QuestFeedback[] = []): Map<string, CompletedHabitEvidence[]> {
  const feedbackByQuest = new Map<string, QuestFeedback>();
  feedbacks.filter((item) => item.result === 'completed' && !item.undoneAt).slice()
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id))
    .forEach((item) => feedbackByQuest.set(item.questId, item));
  const unique = new Map<string, HabitLog>();
  logs.filter((item) => item.result === 'completed').forEach((item) => {
      const key = `${item.habitId}:${item.localDate}`;
      const current = unique.get(key);
      if (!current || item.updatedAt > current.updatedAt || (item.updatedAt === current.updatedAt && item.id < current.id)) unique.set(key, item);
    });
  const byHabit = new Map<string, CompletedHabitEvidence[]>();
  for (const log of unique.values()) {
    const feedback = feedbackByQuest.get(log.questId);
    const evidence = { log, earnedOn: feedback?.completedDate ?? log.localDate, completedAt: feedback?.updatedAt ?? log.updatedAt };
    const values = byHabit.get(log.habitId) ?? [];
    values.push(evidence);
    byHabit.set(log.habitId, values);
  }
  byHabit.forEach((values) => values.sort((left, right) => left.earnedOn.localeCompare(right.earnedOn)
    || left.completedAt.localeCompare(right.completedAt) || left.log.id.localeCompare(right.log.id)));
  return byHabit;
}

function activeCompletedFeedback(feedbacks: readonly QuestFeedback[]): Map<string, QuestFeedback> {
  const result = new Map<string, QuestFeedback>();
  feedbacks.filter((item) => item.result === 'completed' && !item.undoneAt).slice()
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id))
    .forEach((item) => result.set(item.questId, item));
  return result;
}

function completedRecoveryActions(input: AchievementEvidenceInput): Array<{ quest: Quest; feedback: QuestFeedback; earnedOn: string }> {
  const feedback = activeCompletedFeedback(input.feedbacks ?? []);
  return [...newestById(input.quests ?? []).values()]
    .filter((quest) => quest.sourceType === 'recovery' && quest.status === 'completed' && feedback.has(quest.id))
    .map((quest) => ({ quest, feedback: feedback.get(quest.id)!, earnedOn: feedback.get(quest.id)!.completedDate ?? quest.localDate }))
    .sort((left, right) => left.earnedOn.localeCompare(right.earnedOn)
      || left.feedback.updatedAt.localeCompare(right.feedback.updatedAt) || left.quest.id.localeCompare(right.quest.id));
}

function sortBadges(badges: GrowthBadge[]): GrowthBadge[] {
  return [...new Map(badges.map((badge) => [badge.id, badge])).values()]
    .sort((left, right) => right.earnedOn.localeCompare(left.earnedOn)
      || right.completedAt.localeCompare(left.completedAt) || left.id.localeCompare(right.id));
}

export function selectGrowthBadges(input: GrowthBadgeSelectionInput): GrowthBadge[] {
  const goals = newestById(input.goals);
  const branches = newestById(input.branches ?? []);
  const milestones = newestById(input.milestones);
  const quests = newestById(input.quests ?? []);
  const settlements = milestoneSettlements(input.ledger);
  const badges: GrowthBadge[] = [];

  for (const milestone of [...milestones.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (milestone.status !== 'completed' || !milestone.xpSettled || !milestone.completedAt) continue;
    const goal = goals.get(milestone.goalId);
    const settlement = settlements.get(milestone.id);
    const branch = settlement?.branchId ? branches.get(settlement.branchId) : undefined;
    if (!goal || !settlement) continue;
    const sourceQuest = milestone.completionSourceQuestId ? quests.get(milestone.completionSourceQuestId) : undefined;
    const dimension = settlement.dimension ?? sourceQuest?.dimension ?? goal.dimension ?? 'progress';
    const badge: GrowthBadge = {
      id: `milestone:${milestone.id}`, sourceType: 'milestone', theme: dimension,
      milestoneId: milestone.id, name: milestone.description, evidence: milestone.evidence,
      earnedOn: settlement.localDate, completedAt: milestone.completedAt,
      goalId: goal.id, goalResult: goal.result, dimension,
      sourceAction: sourceQuest?.title ?? (milestone.completionSourceQuestId ? '已确认的阶段行动' : '由你手动确认阶段完成'),
      related: { type: 'goal', id: goal.id, name: goal.result },
      confirmation: milestone.completionSourceQuestId ? 'quest' : 'manual',
    };
    if (branch) Object.assign(badge, { branchId: branch.id, branchName: branch.name, branchAsset: branch.rootAsset });
    if (milestone.completionSourceQuestId) badge.sourceQuestId = milestone.completionSourceQuestId;
    badges.push(badge);
  }

  const milestonesByGoal = new Map<string, Milestone[]>();
  for (const milestone of milestones.values()) {
    if (milestone.status === 'superseded') continue;
    const values = milestonesByGoal.get(milestone.goalId) ?? [];
    values.push(milestone);
    milestonesByGoal.set(milestone.goalId, values);
  }
  for (const goal of [...goals.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const path = milestonesByGoal.get(goal.id) ?? [];
    const settled = path.filter((milestone) => settlements.has(milestone.id));
    if (goal.status !== 'completed' || !goal.completedAt || !goal.completedDate || !path.length || path.some((milestone) => milestone.status !== 'completed') || !settled.length) continue;
    const sourceMilestone = settled.slice().sort((left, right) => settlements.get(right.id)!.localDate.localeCompare(settlements.get(left.id)!.localDate)
      || right.id.localeCompare(left.id))[0]!;
    const settlement = settlements.get(sourceMilestone.id)!;
    const branch = settlement.branchId ? branches.get(settlement.branchId) : undefined;
    const sourceQuest = sourceMilestone.completionSourceQuestId ? quests.get(sourceMilestone.completionSourceQuestId) : undefined;
    const dimension = settlement.dimension ?? sourceQuest?.dimension ?? goal.dimension ?? 'progress';
    const badge: GrowthBadge = {
      id: `goal:${goal.id}`, sourceType: 'goal', theme: dimension,
      milestoneId: sourceMilestone.id, name: `完成目标：${goal.result}`,
      evidence: goal.evidence.trim() || `当前计划的 ${path.length} 个子任务均已确认完成。`,
      earnedOn: goal.completedDate, completedAt: goal.completedAt,
      goalId: goal.id, goalResult: goal.result, dimension,
      sourceQuestId: sourceMilestone.completionSourceQuestId, sourceAction: sourceQuest?.title ?? '由你确认目标完成',
      related: { type: 'goal', id: goal.id, name: goal.result }, confirmation: 'manual',
    };
    if (branch) Object.assign(badge, { branchId: branch.id, branchName: branch.name, branchAsset: branch.rootAsset });
    badges.push(badge);
  }

  const habitLogs = completedHabitLogs(input.habitLogs ?? [], input.feedbacks ?? []);
  for (const habit of [...newestById(input.habits ?? []).values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const logs = habitLogs.get(habit.id) ?? [];
    for (const threshold of HABIT_ACHIEVEMENT_THRESHOLDS) {
      const source = logs[threshold - 1];
      if (!source) continue;
      const sourceQuest = quests.get(source.log.questId);
      const legacyBranchId = sourceQuest?.branchId ?? habit.branchId;
      const branch = legacyBranchId ? branches.get(legacyBranchId) : undefined;
      const badge: GrowthBadge = {
        id: `habit:${habit.id}:${threshold}`, sourceType: 'habit', theme: 'habit', threshold, count: threshold,
        milestoneId: '', name: `${habit.name} · ${HABIT_ACHIEVEMENT_TITLES[threshold]}`, evidence: `已留下 ${threshold} 次真实完成记录；不要求连续。`,
        earnedOn: source.earnedOn, completedAt: source.completedAt,
        goalId: '', goalResult: habit.name, dimension: sourceQuest?.dimension ?? habit.dimension,
        habitId: habit.id, habitName: habit.name, sourceQuestId: source.log.questId,
        sourceAction: sourceQuest?.title ?? habit.minimumAction,
        related: { type: 'habit', id: habit.id, name: habit.name }, confirmation: 'quest',
      };
      if (branch) Object.assign(badge, { branchId: branch.id, branchName: branch.name, branchAsset: branch.rootAsset });
      badges.push(badge);
    }
  }

  const recovery = completedRecoveryActions(input);
  for (const threshold of RECOVERY_ACHIEVEMENT_THRESHOLDS) {
    const source = recovery[threshold - 1];
    if (!source) continue;
    badges.push({
      id: `recovery:${threshold}`, sourceType: 'recovery', theme: 'recovery', threshold, count: threshold,
      milestoneId: '', name: `恢复行动 · ${RECOVERY_ACHIEVEMENT_TITLES[threshold]}`, evidence: `已完成 ${threshold} 个由你确认的恢复行动。`,
      earnedOn: source.earnedOn, completedAt: source.feedback.updatedAt,
      goalId: '', goalResult: '恢复能力', dimension: 'energy',
      sourceQuestId: source.quest.id, sourceAction: source.quest.title,
      related: { type: 'recovery', name: '恢复能力' }, confirmation: 'quest',
    });
  }

  const feedback = activeCompletedFeedback(input.feedbacks ?? []);
  for (const review of [...newestById(input.reviews ?? []).values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (review.type !== 'weekly' || review.status !== 'confirmed') continue;
    const quest = [...quests.values()].filter((item) => item.actionId === `review:${review.id}:experiment`
      && item.sourceType === 'manual' && item.status === 'completed' && feedback.has(item.id))
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    if (!quest) continue;
    const result = feedback.get(quest.id)!;
    const branch = quest.branchId ? branches.get(quest.branchId) : undefined;
    const badge: GrowthBadge = {
      id: `experiment:${review.id}`, sourceType: 'experiment', theme: 'experiment',
      milestoneId: '', name: `实践：${review.nextTheme}`,
      evidence: result.actual.trim() || result.note.trim() || review.nextExperiment.minimumAction,
      earnedOn: result.completedDate ?? quest.localDate, completedAt: result.updatedAt,
      goalId: '', goalResult: review.nextTheme, dimension: quest.dimension ?? 'mind',
      reviewId: review.id, sourceQuestId: quest.id, sourceAction: quest.title,
      related: { type: 'review', id: review.id, name: review.nextTheme }, confirmation: 'quest',
    };
    if (branch) Object.assign(badge, { branchId: branch.id, branchName: branch.name, branchAsset: branch.rootAsset });
    badges.push(badge);
  }

  return sortBadges(badges);
}

export function selectNextAchievableAchievement(input: AchievementEvidenceInput): NextAchievableAchievement | null {
  const candidates: NextAchievableAchievement[] = [];
  const logs = completedHabitLogs(input.habitLogs ?? [], input.feedbacks ?? []);
  for (const habit of newestById(input.habits ?? []).values()) {
    if (habit.status !== 'active' || !habit.bonusEnabled) continue;
    const current = logs.get(habit.id)?.length ?? 0;
    const threshold = HABIT_ACHIEVEMENT_THRESHOLDS.find((value) => value > current);
    if (!threshold) continue;
    const remaining = threshold - current;
    candidates.push({
      id: `habit:${habit.id}:${threshold}`, sourceType: 'habit', theme: 'habit', habitId: habit.id, habitName: habit.name,
      name: `${habit.name} · ${HABIT_ACHIEVEMENT_TITLES[threshold]}`, evidence: `再完成 ${remaining} 次真实记录即可留下这项成果。`,
      current, threshold, remaining,
    });
  }
  const recovery = completedRecoveryActions(input);
  if ((input.quests ?? []).some((quest) => quest.sourceType === 'recovery')) {
    const current = recovery.length;
    const threshold = RECOVERY_ACHIEVEMENT_THRESHOLDS.find((value) => value > current);
    if (threshold) {
      const remaining = threshold - current;
      candidates.push({
        id: `recovery:${threshold}`, sourceType: 'recovery', theme: 'recovery', name: `恢复行动 · ${RECOVERY_ACHIEVEMENT_TITLES[threshold]}`,
        evidence: `再完成 ${remaining} 个由你确认的恢复行动即可留下这项成果。`, current, threshold, remaining,
      });
    }
  }
  return candidates.sort((left, right) => left.remaining - right.remaining || left.id.localeCompare(right.id))[0] ?? null;
}
