import assert from 'node:assert/strict';
import test from 'node:test';

import { selectGrowthBadges, selectNextAchievableAchievement } from '../src/badges.ts';

const createdAt = '2026-08-01T08:00:00.000Z';
const entity = (id, patch = {}) => ({ id, createdAt, updatedAt: createdAt, version: 1, ...patch });
const branch = (id = 'branch-a', status = 'active') => ({
  ...entity(id), rootAsset: 'knowledge', name: `方向 ${id}`, order: 0, status,
});
const goal = (id = 'goal-a', branchId = 'branch-a', status = 'active', patch = {}) => ({
  ...entity(id), result: `目标 ${id}`, why: '值得推进', evidence: '完成证据', nextStep: '下一步',
  areaId: 'area-a', branchId, role: 'main', status, ...patch,
});
const milestone = (id = 'milestone-a', goalId = 'goal-a', patch = {}) => ({
  ...entity(id), goalId, order: 0, description: `里程碑 ${id}`, evidence: `证据 ${id}`,
  status: 'completed', completedAt: '2026-08-10T09:30:00.000Z', xpSettled: true, ...patch,
});
const settlement = (id = 'milestone-a', branchId = 'branch-a', patch = {}) => ({
  ...entity(`ledger-${id}`), settlementKey: `${id}:1`, sourceType: 'milestone', sourceId: id, branchId,
  baseXp: 50, ratio: 1, finalXp: 50, difficulty: 'milestone', localDate: '2026-08-10', ...patch,
});
const habit = (id = 'habit-a', status = 'active', patch = {}) => ({
  ...entity(id), name: `习惯 ${id}`, minimumAction: '完成最小动作', scheduleDays: [1, 3, 5],
  dimension: 'progress', branchId: 'branch-a', difficulty: 'light', status, bonusEnabled: true, ...patch,
});
const dateAt = (index) => new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
const habitLog = (habitId, index, patch = {}) => {
  const localDate = dateAt(index);
  return {
    ...entity(`log-${habitId}-${index}`, { updatedAt: `${localDate}T08:00:00.000Z` }), habitId, localDate,
    result: 'completed', questId: `habit-quest-${habitId}-${index}`, ...patch,
  };
};
const quest = (id, patch = {}) => ({
  ...entity(id), localDate: '2026-08-10', type: 'side', sourceType: 'recovery', actionId: `action:${id}`,
  settlementVersion: 1, title: `行动 ${id}`, reason: '有现实依据', minimumAction: '做最小一步',
  estimatedMinutes: 5, difficulty: 'light', status: 'completed', aiSuggested: false, userModified: false, ...patch,
});
const feedback = (questId, patch = {}) => ({
  ...entity(`feedback-${questId}`), questId, result: 'completed', note: '', actual: `实际完成 ${questId}`,
  settlementVersion: 1, completedDate: '2026-08-10', ...patch,
});
const review = (id = 'review-a', patch = {}) => ({
  ...entity(id), type: 'weekly', status: 'confirmed', nextTheme: '验证一个新方法',
  nextExperiment: { hypothesis: '更小更容易开始', minimumAction: '完成一次十分钟实验', metric: '是否完成', endDate: '2026-08-15', stopCondition: '不再有效' },
  ...patch,
});
const emptyInput = (patch = {}) => ({ milestones: [], goals: [], branches: [branch()], ledger: [], ...patch });

test('a settled milestone keeps its compatible fields and adds UI-ready provenance', () => {
  const source = quest('quest-a', { sourceType: 'goal', title: '完成第一份作品' });
  const badges = selectGrowthBadges({
    milestones: [milestone('milestone-a', 'goal-a', { completionSourceQuestId: source.id })],
    goals: [goal()], branches: [branch()], ledger: [settlement()], quests: [source],
  });
  assert.deepEqual(badges, [{
    id: 'milestone:milestone-a', sourceType: 'milestone', theme: 'knowledge',
    milestoneId: 'milestone-a', name: '里程碑 milestone-a', evidence: '证据 milestone-a',
    earnedOn: '2026-08-10', completedAt: '2026-08-10T09:30:00.000Z', goalId: 'goal-a', goalResult: '目标 goal-a',
    branchId: 'branch-a', branchName: '方向 branch-a', branchAsset: 'knowledge', sourceQuestId: 'quest-a',
    sourceAction: '完成第一份作品', related: { type: 'goal', id: 'goal-a', name: '目标 goal-a' }, confirmation: 'quest',
  }]);
});

test('pending, unsettled, reversed, or malformed milestone XP cannot derive a badge', () => {
  const input = { goals: [goal()], branches: [branch()] };
  assert.equal(selectGrowthBadges({ ...input, milestones: [milestone('milestone-a', 'goal-a', { status: 'pending' })], ledger: [settlement()] }).length, 0);
  assert.equal(selectGrowthBadges({ ...input, milestones: [milestone('milestone-a', 'goal-a', { xpSettled: false })], ledger: [settlement()] }).length, 0);
  assert.equal(selectGrowthBadges({ ...input, milestones: [milestone()], ledger: [settlement('milestone-a', 'branch-a', { reversedAt: '2026-08-11T08:00:00.000Z' })] }).length, 0);
  assert.equal(selectGrowthBadges({ ...input, milestones: [milestone()], ledger: [settlement('milestone-a', 'branch-a', { sourceType: 'quest' })] }).length, 0);
  assert.equal(selectGrowthBadges({ ...input, milestones: [milestone()], ledger: [settlement('milestone-a', 'branch-a', { finalXp: 40 })] }).length, 0);
});

test('a completed goal chapter requires a fully completed current path and one settled milestone', () => {
  const completedGoal = goal('goal-a', 'branch-a', 'completed', { completedAt: '2026-08-15T09:00:00.000Z', completedDate: '2026-08-15', updatedAt: '2026-08-16T09:00:00.000Z' });
  const current = [milestone('one'), milestone('two', 'goal-a', { order: 1 }), milestone('old', 'goal-a', { status: 'superseded', xpSettled: false, completedAt: undefined })];
  const ledger = [settlement('one')];
  const select = (goals = [completedGoal], milestones = current, xp = ledger) => selectGrowthBadges({ goals, milestones, branches: [branch()], ledger: xp });
  const chapter = select().find((badge) => badge.id === 'goal:goal-a');
  assert.deepEqual({
    id: chapter?.id, sourceType: chapter?.sourceType, theme: chapter?.theme, earnedOn: chapter?.earnedOn,
    evidence: chapter?.evidence, related: chapter?.related, sourceAction: chapter?.sourceAction,
  }, {
    id: 'goal:goal-a', sourceType: 'goal', theme: 'knowledge', earnedOn: '2026-08-15', evidence: '完成证据',
    related: { type: 'goal', id: 'goal-a', name: '目标 goal-a' }, sourceAction: '由你确认目标完成',
  });
  assert.equal(select([goal('goal-a')]).some((badge) => badge.sourceType === 'goal'), false, 'undoing goal completion hides only the chapter achievement');
  assert.equal(select(undefined, [current[0], { ...current[1], status: 'pending' }, current[2]]).some((badge) => badge.sourceType === 'goal'), false);
  assert.equal(select(undefined, undefined, [settlement('one', 'branch-a', { reversedAt: createdAt })]).some((badge) => badge.sourceType === 'goal'), false);
  const moved = selectGrowthBadges({
    goals: [{ ...completedGoal, branchId: 'branch-b' }], milestones: current,
    branches: [branch(), branch('branch-b')], ledger,
  }).find((badge) => badge.sourceType === 'goal');
  assert.equal(moved?.branchId, 'branch-a', 'a completed chapter keeps the settled growth branch after later edits');
});

test('habit achievements derive across nine non-consecutive evidence thresholds and survive lifecycle changes', () => {
  const logs = Array.from({ length: 365 }, (_, index) => habitLog('habit-a', index));
  logs.push({ ...logs[364], id: 'duplicate-log' });
  const select = (habits, habitLogs) => selectGrowthBadges(emptyInput({ habits, habitLogs })).filter((badge) => badge.sourceType === 'habit');
  const badges = select([habit('habit-a', 'paused')], logs);
  assert.deepEqual(badges.map((badge) => [badge.id, badge.earnedOn, badge.theme, badge.habitId]), [
    ['habit:habit-a:365', dateAt(364), 'habit', 'habit-a'],
    ['habit:habit-a:180', dateAt(179), 'habit', 'habit-a'],
    ['habit:habit-a:100', dateAt(99), 'habit', 'habit-a'],
    ['habit:habit-a:60', dateAt(59), 'habit', 'habit-a'],
    ['habit:habit-a:30', dateAt(29), 'habit', 'habit-a'],
    ['habit:habit-a:14', dateAt(13), 'habit', 'habit-a'],
    ['habit:habit-a:7', dateAt(6), 'habit', 'habit-a'],
    ['habit:habit-a:3', dateAt(2), 'habit', 'habit-a'],
    ['habit:habit-a:1', dateAt(0), 'habit', 'habit-a'],
  ]);
  assert.equal(select([habit('habit-a', 'ended')], logs).length, 9);
  assert.deepEqual(select([habit()], logs.slice(0, 29)).map((badge) => badge.id), ['habit:habit-a:14', 'habit:habit-a:7', 'habit:habit-a:3', 'habit:habit-a:1']);
  assert.deepEqual(select([habit()], logs.slice(0, 30)).map((badge) => badge.id), ['habit:habit-a:30', 'habit:habit-a:14', 'habit:habit-a:7', 'habit:habit-a:3', 'habit:habit-a:1'], 'restoring the threshold log restores the achievement');
  const firstSeven = logs.slice(0, 7);
  const lateSeventh = feedback(firstSeven[6].questId, { completedDate: '2026-08-20', updatedAt: '2026-08-20T09:00:00.000Z' });
  assert.equal(selectGrowthBadges(emptyInput({ habits: [habit()], habitLogs: firstSeven, feedbacks: [lateSeventh] }))[0]?.earnedOn, '2026-08-20', 'habit achievements use the real completion date');
});

test('habit achievements keep the growth branch of their threshold action', () => {
  const logs = Array.from({ length: 7 }, (_, index) => habitLog('habit-a', index));
  const quests = logs.map((item, index) => quest(item.questId, {
    sourceType: 'habit', sourceId: 'habit-a', branchId: index < 3 ? 'health' : 'knowledge', title: `第 ${index + 1} 次行动`,
  }));
  const badges = selectGrowthBadges(emptyInput({
    branches: [branch('health'), branch('knowledge')], habits: [habit('habit-a', 'active', { branchId: 'knowledge' })],
    habitLogs: logs, quests,
  })).filter((badge) => badge.sourceType === 'habit');
  assert.deepEqual(badges.map((badge) => [badge.id, badge.branchId, badge.sourceAction]), [
    ['habit:habit-a:7', 'knowledge', '第 7 次行动'],
    ['habit:habit-a:3', 'health', '第 3 次行动'],
    ['habit:habit-a:1', 'health', '第 1 次行动'],
  ]);
});

test('recovery achievements span seven verified thresholds and react to undo and restore', () => {
  const quests = Array.from({ length: 100 }, (_, index) => quest(`recovery-${index}`, { localDate: dateAt(index) }));
  const feedbacks = quests.map((item, index) => feedback(item.id, { completedDate: dateAt(index), updatedAt: `${dateAt(index)}T09:00:00.000Z` }));
  quests.push(quest('skipped', { status: 'skipped' }), quest('exempt', { status: 'exempt' }));
  feedbacks.push(feedback('skipped', { result: 'skipped' }), feedback('exempt', { result: 'exempt' }));
  const select = (values) => selectGrowthBadges(emptyInput({ quests, feedbacks: values })).filter((badge) => badge.sourceType === 'recovery');
  assert.deepEqual(select(feedbacks).map((badge) => [badge.id, badge.earnedOn, badge.sourceQuestId]), [
    ['recovery:100', dateAt(99), 'recovery-99'],
    ['recovery:60', dateAt(59), 'recovery-59'],
    ['recovery:30', dateAt(29), 'recovery-29'],
    ['recovery:14', dateAt(13), 'recovery-13'],
    ['recovery:7', dateAt(6), 'recovery-6'],
    ['recovery:3', dateAt(2), 'recovery-2'],
    ['recovery:1', dateAt(0), 'recovery-0'],
  ]);
  const undone = feedbacks.map((item) => item.questId === 'recovery-99' ? { ...item, undoneAt: '2026-05-01T00:00:00.000Z' } : item);
  assert.deepEqual(select(undone).map((badge) => badge.id), ['recovery:60', 'recovery:30', 'recovery:14', 'recovery:7', 'recovery:3', 'recovery:1']);
  assert.deepEqual(select(feedbacks).map((badge) => badge.id), ['recovery:100', 'recovery:60', 'recovery:30', 'recovery:14', 'recovery:7', 'recovery:3', 'recovery:1']);
});

test('a weekly experiment requires a confirmed review and its exact completed action feedback', () => {
  const weekly = review();
  const experiment = quest('experiment-quest', { sourceType: 'manual', actionId: `review:${weekly.id}:experiment`, title: weekly.nextTheme });
  const result = feedback(experiment.id, { actual: '连续三天使用了缩小后的启动方法', completedDate: '2026-08-16' });
  const select = (reviews = [weekly], quests = [experiment], feedbacks = [result]) => selectGrowthBadges(emptyInput({ reviews, quests, feedbacks }))
    .find((badge) => badge.sourceType === 'experiment');
  assert.deepEqual({
    id: select()?.id, theme: select()?.theme, evidence: select()?.evidence, earnedOn: select()?.earnedOn,
    reviewId: select()?.reviewId, sourceAction: select()?.sourceAction, related: select()?.related,
  }, {
    id: 'experiment:review-a', theme: 'experiment', evidence: '连续三天使用了缩小后的启动方法', earnedOn: '2026-08-16',
    reviewId: 'review-a', sourceAction: '验证一个新方法', related: { type: 'review', id: 'review-a', name: '验证一个新方法' },
  });
  assert.equal(select([review('review-a', { status: 'candidate' })]), undefined);
  assert.equal(select(undefined, undefined, [{ ...result, undoneAt: createdAt }]), undefined);
  assert.equal(select(undefined, [quest('wrong', { sourceType: 'manual', actionId: 'review:other:experiment' })], [feedback('wrong')]), undefined);
  assert.equal(select()?.id, 'experiment:review-a', 'restoring the action feedback restores the achievement');
});

test('mixed achievements deduplicate, sort stably, and never mutate or duplicate XP', () => {
  const completedGoal = goal('goal-a', 'branch-a', 'completed', { completedAt: '2026-08-16T10:00:00.000Z', completedDate: '2026-08-16', updatedAt: '2026-08-18T10:00:00.000Z' });
  const settledMilestone = milestone();
  const xp = settlement();
  const weekly = review('review-a');
  const experiment = quest('experiment', { sourceType: 'manual', actionId: 'review:review-a:experiment', localDate: '2026-08-15' });
  const recoveryQuests = Array.from({ length: 3 }, (_, index) => quest(`r-${index}`, { localDate: `2026-08-${String(10 + index).padStart(2, '0')}` }));
  const recoveryFeedback = recoveryQuests.map((item) => feedback(item.id, { completedDate: item.localDate }));
  const input = {
    milestones: [settledMilestone, { ...settledMilestone }], goals: [completedGoal, { ...completedGoal }], branches: [branch(), branch()],
    ledger: [xp, { ...xp }], habits: [habit(), habit()], habitLogs: Array.from({ length: 7 }, (_, index) => habitLog('habit-a', index)),
    reviews: [weekly, { ...weekly }], quests: [experiment, ...recoveryQuests, experiment],
    feedbacks: [feedback('experiment', { completedDate: '2026-08-15' }), ...recoveryFeedback],
  };
  const ledgerBefore = structuredClone(input.ledger);
  const badges = selectGrowthBadges(input);
  assert.deepEqual(badges.map((badge) => badge.id), [
    'goal:goal-a', 'experiment:review-a', 'recovery:3', 'milestone:milestone-a', 'recovery:1',
    'habit:habit-a:7', 'habit:habit-a:3', 'habit:habit-a:1',
  ]);
  assert.equal(new Set(badges.map((badge) => badge.id)).size, badges.length);
  assert.equal(badges.every((badge) => !('xp' in badge) && !('finalXp' in badge)), true);
  assert.deepEqual(input.ledger, ledgerBefore);
  assert.deepEqual(selectGrowthBadges({ ...input, milestones: input.milestones.toReversed(), quests: input.quests.toReversed() }), badges);
});

test('the next-achievable selector returns only the closest actionable BONUS habit or recovery threshold', () => {
  const habits = [habit('habit-a'), habit('habit-b'), habit('ended', 'ended')];
  const six = Array.from({ length: 6 }, (_, index) => habitLog('habit-a', index));
  const twentyNine = Array.from({ length: 29 }, (_, index) => habitLog('habit-b', index));
  const recoveryQuests = [quest('recovery-a'), quest('recovery-b')];
  const oneRecovery = [feedback('recovery-a')];
  assert.deepEqual(selectNextAchievableAchievement({ habits, habitLogs: [...six, ...twentyNine], quests: recoveryQuests, feedbacks: oneRecovery }), {
    id: 'habit:habit-a:7', sourceType: 'habit', theme: 'habit', habitId: 'habit-a', habitName: '习惯 habit-a',
    name: '习惯 habit-a · 留下节奏', evidence: '再完成 1 次真实记录即可留下这项成果。', current: 6, threshold: 7, remaining: 1,
  });
  const afterSeven = [...six, habitLog('habit-a', 6), ...twentyNine];
  assert.equal(selectNextAchievableAchievement({ habits, habitLogs: afterSeven, quests: recoveryQuests, feedbacks: oneRecovery })?.id, 'habit:habit-b:30');
  assert.equal(selectNextAchievableAchievement({ habits: [habit('habit-a', 'paused'), habit('habit-b', 'ended')], habitLogs: afterSeven, quests: recoveryQuests, feedbacks: [feedback('recovery-a'), feedback('recovery-b')] })?.id, 'recovery:3');
  assert.equal(selectNextAchievableAchievement({
    habits: [habit('habit-a', 'active', { bonusEnabled: false }), habit('habit-b')],
    habitLogs: [...six, ...Array.from({ length: 4 }, (_, index) => habitLog('habit-b', index))],
  })?.id, 'habit:habit-b:7', 'a closer but disabled habit cannot advertise an unreachable next achievement');
  assert.equal(selectNextAchievableAchievement({ habits: [habit('ended', 'ended')] }), null);
});
