import assert from 'node:assert/strict';
import test from 'node:test';

import 'fake-indexeddb/auto';

import { QiguangDb } from '../src/db.ts';
import { shiftDate } from '../src/model.ts';
import { buildWidgetSnapshot } from '../src/widget.ts';
import { chooseDailyDirection, totalXp } from '../src/rules.ts';

const start = '2026-09-01';
const dates = Array.from({ length: 14 }, (_, index) => shiftDate(start, index));

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', resolve, { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => reject(new Error(`database ${name} is still open`)), { once: true });
  });
}

test('fourteen calendar days close the guidance loop without debt after interruption', async (t) => {
  const databaseName = `qiguang-14-day-${crypto.randomUUID()}`;
  const db = await QiguangDb.open(databaseName);
  t.after(async () => { db.close(); await deleteDatabase(databaseName); });
  await db.ensureI2Defaults();

  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '完成一份可以交给别人阅读的生活系统说明', why: '把实践沉淀成真实成果',
    evidence: '有一份完整且可分享的说明', nextStep: '列出结构', areaId: area.id, branchId: branch.id,
    startDate: dates[0], role: 'main',
  });
  const milestones = [];
  for (const [description, evidence] of [
    ['列出结构', '有三个清晰章节'], ['写出第一版', '三个章节都有正文'],
    ['请一人试读', '收到一条真实反馈'], ['完成修订', '存在可分享的最终版本'],
  ]) milestones.push(await db.addMilestone(goal.id, description, evidence));
  assert.deepEqual((await db.listMilestones(goal.id)).map((item) => [item.id, item.order]), milestones.map((item, order) => [item.id, order]));
  const habit = await db.addHabit({
    name: '散步两分钟', minimumAction: '离开座位走两分钟', scheduleDays: [1, 2, 3, 4, 5, 6, 7],
    dimension: 'energy', branchId: branch.id, difficulty: 'light', bonusEnabled: true,
  });

  const activeDates = dates.filter((_, index) => index !== 7 && index !== 8);
  for (const date of activeDates) await db.addEntry(`在 ${date} 留下真实记录；今天至少完成或确认了一件小事。`, date);
  const settleBonus = async (date, result = 'completed') => {
    await db.ensureTodayBonusQuests(date);
    const bonus = (await db.listQuests(date)).find((quest) => quest.sourceId === habit.id);
    assert(bonus, `${date} should have one user-enabled BONUS`);
    await db.feedbackQuest(bonus.id, result, result === 'skipped' ? '今天主动放下，不补课' : '已留下习惯反馈', result === 'completed' ? '完成最低版本' : '', undefined, 0, date);
  };
  const addGoalMain = (date, milestone, title = milestone.description) => db.addQuest({
    localDate: date, type: 'main', sourceType: 'goal', sourceId: goal.id, milestoneId: milestone.id,
    title, reason: `推进目标“${goal.result}”`, minimumAction: `先用五分钟完成：${title}`,
    completionCriteria: milestone.evidence, estimatedMinutes: 10, difficulty: 'light', branchId: branch.id,
  });

  const first = await addGoalMain(dates[0], milestones[0]);
  assert.equal(chooseDailyDirection({ mainQuest: first, recoveryAvailable: false, activeGoalAvailable: true, previousStepAvailable: false }).kind, 'main');
  await db.feedbackQuest(first.id, 'completed', '完成结构', '列出三个章节', undefined, 2, dates[0]);
  const dayTwo = await db.createGoalFollowUpQuest(first.id, dates[1]);
  assert.equal(dayTwo.followUp?.milestoneId, milestones[1].id);
  await settleBonus(dates[0]);

  const carriedDirection = chooseDailyDirection({
    mainQuest: { status: 'pending', carriedFromPreviousDay: Boolean(dayTwo.followUp?.predecessorQuestId) },
    recoveryAvailable: false, activeGoalAvailable: true, previousStepAvailable: false,
  });
  assert.match(carriedDirection.reason, /昨天反馈后生成的下一步/);
  await db.feedbackQuest(dayTwo.followUp.id, 'partial', '只写完第一章', '第一章已有正文', undefined, 1, dates[1]);
  const dayThree = await db.createGoalFollowUpQuest(dayTwo.followUp.id, dates[2], 'partial');
  assert.match(dayThree.followUp?.title ?? '', /^缩小继续：/);
  await settleBonus(dates[1], 'partial');

  await db.feedbackQuest(dayThree.followUp.id, 'skipped', '建议不适合我，需要换一种写法', '', undefined, 0, dates[2]);
  assert.equal((await db.listQuests(dates[3])).filter((quest) => quest.sourceType === 'goal').length, 0, 'rejected advice must not copy itself');
  await settleBonus(dates[2], 'skipped');

  await db.saveAssessment({ energy: 30 }, dates[3]);
  const dayFour = await addGoalMain(dates[3], milestones[1], '只补一段最容易写的正文');
  const recovery = chooseDailyDirection({ mainQuest: dayFour, recoveryAvailable: true, activeGoalAvailable: true, previousStepAvailable: false });
  assert.equal(recovery.kind, 'recovery');
  await db.feedbackQuest(dayFour.id, 'exempt', '今天状态不足，先恢复且不扣分', '', undefined, 0, dates[3]);
  await settleBonus(dates[3], 'skipped');

  const dayFive = await addGoalMain(dates[4], milestones[1], '用最低版本完成剩余正文');
  await db.feedbackQuest(dayFive.id, 'completed', '最低版本完成', '三个章节都有正文', undefined, 2, dates[4]);
  const daySix = await db.createGoalFollowUpQuest(dayFive.id, dates[5]);
  assert.equal(daySix.followUp?.milestoneId, milestones[2].id);
  await settleBonus(dates[4]);

  await db.feedbackQuest(daySix.followUp.id, 'completed', '已经试读', '收到一条具体反馈', undefined, 2, dates[5]);
  const daySeven = await db.createGoalFollowUpQuest(daySix.followUp.id, dates[6]);
  assert.equal(daySeven.followUp?.milestoneId, milestones[3].id);
  await settleBonus(dates[5]);
  await settleBonus(dates[6]);

  assert.equal((await db.listQuests(dates[7])).length, 0, 'a day not opened must not create BONUS debt');
  assert.equal((await db.listQuests(dates[8])).length, 0, 'a second missed day must stay empty');
  assert.deepEqual((await db.listPendingBefore(dates[9])).map((quest) => quest.id), [daySeven.followUp.id], 'returning should show one unresolved MAIN, not a backlog');
  await db.feedbackQuest(daySeven.followUp.id, 'exempt', '中断后重新判断，不补旧任务', '', undefined, 0, dates[9]);
  const dayTen = await addGoalMain(dates[9], milestones[3], '根据试读反馈完成修订');
  await db.ensureTodayBonusQuests(dates[9]);
  const widgetBeforeCompletion = buildWidgetSnapshot({
    profile: await db.getProfile(), quests: await db.listQuests(dates[9]), ledger: await db.listXpLedger(),
    localDate: dates[9], generatedAt: `${dates[9]}T08:00:00.000Z`, companionState: '指导',
  });
  assert.equal(widgetBeforeCompletion.main?.id, dayTen.id);
  assert.equal(widgetBeforeCompletion.bonus.length, 1);
  await db.feedbackQuest(dayTen.id, 'completed', '完成修订', '生成可分享最终版', undefined, 3, dates[9]);
  const finished = await db.createGoalFollowUpQuest(dayTen.id, dates[10]);
  assert.equal(finished.goalReady, true);
  await db.saveGoal(goal.id, { status: 'completed' });
  await settleBonus(dates[9]);

  let priorManual = null;
  for (let index = 10; index < dates.length; index += 1) {
    const date = dates[index];
    const quest = await db.addQuest({
      localDate: date, type: 'main', sourceType: 'manual', actionId: `reflection-${index}`,
      title: index === 10 ? '写下试读后的一个收获' : `完成第 ${index + 1} 天的最小复盘`,
      reason: priorManual ? '根据昨天的真实反馈继续一个更小动作' : '目标完成后沉淀成功证据',
      minimumAction: '只写一句具体事实', completionCriteria: '留下一句可回看的事实',
      estimatedMinutes: 5, difficulty: 'light', branchId: branch.id,
    });
    const result = index === 10 ? 'partial' : index === 12 ? 'skipped' : 'completed';
    await db.feedbackQuest(quest.id, result, result === 'skipped' ? '今天主动放下' : '已核对今天的事实', result === 'completed' ? '写下一句具体收获' : '留下半句草稿', undefined, 0, date);
    await settleBonus(date, index === 12 ? 'skipped' : 'completed');
    priorManual = quest;
  }

  const entries = await db.listEntries();
  const feedback = (await db.listQuestFeedback()).filter((item) => !item.undoneAt);
  const ledger = await db.listXpLedger();
  assert.equal(entries.length, 12, 'the 14-day window intentionally contains one two-day interruption');
  assert.deepEqual(new Set(feedback.map((item) => item.result)), new Set(['completed', 'partial', 'skipped', 'exempt']));
  assert.equal((await db.listMilestones(goal.id)).filter((item) => item.status === 'completed').length, 4);
  assert.equal((await db.listGoals()).find((item) => item.id === goal.id)?.status, 'completed');
  assert.equal((await db.listQuests()).filter((item) => item.status === 'pending').length, 0);
  assert.equal((await db.listQuests()).filter((item) => dates[7] === item.localDate || dates[8] === item.localDate).length, 0);
  assert(totalXp(ledger) > 200, 'completed actions and milestones should leave visible growth without login XP');
  assert((await db.habitMomentum(habit.id, dates[13])) > 0, 'missed days lower momentum without resetting it');

  t.diagnostic(JSON.stringify({
    calendarDays: 14, activeDays: entries.length, interruptionDays: 2,
    taskFeedback: Object.fromEntries(['completed', 'partial', 'skipped', 'exempt'].map((result) => [result, feedback.filter((item) => item.result === result).length])),
    milestonesCompleted: 4, totalXp: totalXp(ledger), pendingDebt: 0,
  }));
});
