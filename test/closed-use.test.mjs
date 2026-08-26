import assert from 'node:assert/strict';
import test from 'node:test';

import 'fake-indexeddb/auto';

import { QiguangDb } from '../src/db.ts';
import { shiftDate } from '../src/model.ts';
import { buildWidgetSnapshot } from '../src/widget.ts';
import { chooseDailyDirection, monthlyAreaSignal, totalXp } from '../src/rules.ts';

const start = '2026-09-01';
const dates = Array.from({ length: 30 }, (_, index) => shiftDate(start, index));
const interruptionIndexes = new Set([7, 8, 16]);
const analysisIndexes = new Set([0, 5, 9, 12, 17, 19, 24, 26]);

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', resolve, { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => reject(new Error(`database ${name} is still open`)), { once: true });
  });
}

function analysisRequest(entry, requestId) {
  return {
    contractVersion: '1.0', operation: 'daily_analysis', requestId, locale: 'zh-CN',
    timeZone: 'Asia/Shanghai', localDate: entry.localDate,
    userInput: { entries: [{ entryId: entry.id, revision: entry.version, text: entry.body }] },
    context: { confirmedEvents: [], recentStates: [], goals: [], bonusHabits: [], memories: [], constraints: [] },
    permissions: {
      entryIds: [entry.id], includeConfirmedEvents: false, includeRecentStates: false,
      includeGoals: false, includeBonusHabits: false, memoryIds: [],
    },
  };
}

function analysisResponse(request, suggestRecovery = false) {
  const body = request.userInput.entries[0].text;
  const factQuote = '会议很多';
  const inferenceQuote = '散步后好了一些';
  const factStart = Array.from(body.slice(0, body.indexOf(factQuote))).length;
  const inferenceStart = Array.from(body.slice(0, body.indexOf(inferenceQuote))).length;
  return {
    contractVersion: '1.0', requestId: request.requestId, operation: 'daily_analysis', warnings: [],
    result: {
      title: '行动与恢复', summary: '会议较多，散步后有所缓解。', explicitMoods: ['平静'],
      events: [
        {
          candidateId: 'fact-1', title: '完成当天记录', description: '记录明确提到会议较多。',
          sourceType: 'explicit', confirmation: 'confirmed_by_default', confidence: 'high',
          evidence: [{ entryId: request.userInput.entries[0].entryId, quote: factQuote, start: factStart, end: factStart + Array.from(factQuote).length }],
          stateImpactCandidates: [], growthEvidenceCandidate: null,
        },
        {
          candidateId: 'inference-1', title: '散步可能帮助恢复', description: '目前只观察到同时出现。',
          sourceType: 'inferred', confirmation: 'pending', confidence: 'low',
          evidence: [{ entryId: request.userInput.entries[0].entryId, quote: inferenceQuote, start: inferenceStart, end: inferenceStart + Array.from(inferenceQuote).length }],
          stateImpactCandidates: [], growthEvidenceCandidate: null,
        },
      ],
      reflection: {
        whatHappened: '完成了现实行动，也留意了恢复。', specificCredit: '主动记录了一件小小成功。',
        patternCandidate: { observation: '散步可能帮助恢复。', evidenceCount: 1, neededEvidence: '继续观察不同日期。' },
        nextSmallStep: '明天先做十分钟最小版本。',
      },
      questSuggestions: suggestRecovery ? [{
        type: 'side', title: '留十分钟低压力过渡', why: '继续观察恢复方法是否有效。', minimumVersion: '十分钟不打开新工作。',
        estimatedMinutes: 10, difficulty: 'light', primaryState: 'mental', growthBranchId: null, sourceGoalId: null, isRecovery: true,
      }] : [],
      memoryCandidates: [{
        type: 'constraint', statement: '会议密集的晚上注意力可能较低。', confidence: 'low',
        supportingEventIds: ['fact-1'], counterEvidence: [], recommendedAction: 'observe',
      }],
    },
  };
}

function weeklyRequest(events, startDate, endDate, requestId) {
  return {
    contractVersion: '1.0', operation: 'weekly_review', requestId, locale: 'zh-CN', timeZone: 'Asia/Shanghai',
    period: { start: startDate, end: endDate }, userInput: { note: '' },
    context: {
      events: events.map((event) => ({ eventId: event.id, version: event.version, localDate: event.localDate, title: event.title, description: event.description })),
      sourceVersions: {
        quests: [], questFeedback: [], habits: [], habitLogs: [], branches: [], xpLedger: [], goals: [], reviews: [], memories: [], stateObservations: [],
      },
      stateSnapshots: [], taskResults: [], habits: [], growth: [], goals: [], experiments: [], memories: [],
    },
    permissions: {
      eventIds: events.map((event) => event.id), includeStateSnapshots: false, includeTaskResults: false, includeHabits: false,
      includeGrowth: false, includeGoals: false, includeExperiments: false, memoryIds: [],
    },
  };
}

function weeklyResponse(request) {
  const [first, second] = request.context.events;
  return {
    contractVersion: '1.0', requestId: request.requestId, operation: 'weekly_review', warnings: [],
    result: {
      stateTrends: [{
        dimension: 'energy', direction: 'stable', summary: '两天都留下了行动与恢复证据。',
        evidenceEventIds: [first.eventId, second.eventId], evidenceDates: [first.localDate, second.localDate], relationship: 'correlation',
      }],
      recurringBenefits: [], recurringCosts: [], growthDeposits: [], habitDecisions: [],
      nextWeekTheme: { title: '保持最小行动', reason: '一周只验证一个低成本变化。' },
      nextExperiment: {
        hypothesis: '更小的开始成本有助于继续行动。', minimumAction: '每天先做十分钟。', metric: '记录实际开始的天数。',
        endDate: shiftDate(request.period.end, 7), stopCondition: '连续三天明显增加负担时停止。',
      },
      systemCandidates: [{
        type: 'pattern', statement: '会议之后可能需要恢复过渡。', confidence: 'low',
        supportingEventIds: [first.eventId, second.eventId], counterEvidence: [], recommendedAction: 'observe',
      }],
    },
  };
}

test('thirty-day closed-use simulation exercises the implemented daily loop and exposes blocked boundaries', async (t) => {
  const databaseName = `qiguang-30-day-${crypto.randomUUID()}`;
  const restoredName = `${databaseName}-restored`;
  let db = await QiguangDb.open(databaseName);
  let restored;
  t.after(async () => {
    db.close();
    restored?.close();
    await deleteDatabase(databaseName);
    await deleteDatabase(restoredName);
  });
  await db.ensureI2Defaults();
  await db.saveProfile({ userName: '30 天模拟用户', companionName: '栖栖' });

  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const draftGoal = await db.addGoal({
    result: '完成一份可以交给别人阅读的生活系统说明', why: '', evidence: '', nextStep: '先列出结构',
    areaId: area.id, branchId: branch.id, startDate: dates[0], role: 'main',
  });
  const planned = await db.replaceGoalPlan(draftGoal.id, {
    result: draftGoal.result, evidence: '有一份完整且可分享的说明', nextStep: '列出三个清晰章节',
  }, [
    { description: '列出结构', evidence: '有三个清晰章节' },
    { description: '写出第一版', evidence: '三个章节都有正文' },
    { description: '请一人试读', evidence: '收到一条真实反馈' },
    { description: '完成修订', evidence: '存在可分享的最终版本' },
  ], draftGoal.version);
  const goal = planned.goal;
  const milestones = planned.milestones;
  const walking = await db.addHabit({
    name: '散步两分钟', minimumAction: '离开座位走两分钟', scheduleDays: [1, 2, 3, 4, 5, 6, 7],
    dimension: 'energy', branchId: branch.id, difficulty: 'light', bonusEnabled: true,
  }, dates[0]);
  const gratitude = await db.addHabit({
    name: '写一句感谢', minimumAction: '写下一句具体感谢', scheduleDays: [1, 2, 3, 4, 5, 6, 7],
    dimension: 'mind', branchId: branch.id, difficulty: 'light', bonusEnabled: false,
  }, dates[0]);

  const organizeEntry = async (entry, index) => {
    if (!analysisIndexes.has(index)) return;
    const request = analysisRequest(entry, `daily-${index + 1}`);
    const job = await db.createDailyAnalysisJob(request);
    await db.markAnalysisJobProcessing(job.id);
    const analysis = await db.saveDailyAnalysis(job.id, analysisResponse(request, index === 17));
    const inference = (await db.listJournalEvents(entry.localDate)).find((event) => event.sourceType === 'inferred');
    assert(inference, `${entry.localDate} should preserve the AI inference as a candidate`);
    await db.decideEvent(inference.id, index % 2 === 0 ? 'confirmed' : 'rejected');
    if (index === 5) {
      const memory = (await db.listMemories('candidate')).find((item) => item.analysisId === analysis.id);
      assert(memory);
      await db.decideMemory(memory.id, 'confirmed');
    }
    if (index === 17) {
      assert.equal((await db.acceptAnalysisQuestSuggestion(analysis.id, 0)).created, true);
      assert.equal((await db.acceptAnalysisQuestSuggestion(analysis.id, 0)).created, false);
    }
  };
  const recordDay = async (index) => {
    const date = dates[index];
    let entry = await db.addEntry(
      `第 ${index + 1} 天：今天会议很多，晚上散步后好了一些。`,
      date,
      'text',
      index % 3 === 0 ? 'success' : 'journal',
    );
    if (index === 0) {
      entry = await db.editEntry(entry.id, entry.version, `${entry.body} 临时补充。`);
      entry = await db.undoLastEdit(entry.id);
      assert.equal(entry.body.endsWith('临时补充。'), false, 'journal editing must remain undoable during long use');
      assert.equal((await db.searchEntries('会议很多', date)).length, 1);
    }
    await organizeEntry(entry, index);
    return entry;
  };
  const settleBonuses = async (index, result = 'completed') => {
    const date = dates[index];
    await db.ensureTodayBonusQuests(date);
    const bonuses = (await db.listQuests(date)).filter((quest) => quest.type === 'bonus' && quest.status === 'pending');
    for (const bonus of bonuses) {
      await db.feedbackQuest(bonus.id, result, result === 'skipped' ? '今天主动放下，不补课' : '已留下真实习惯反馈', result === 'completed' ? '完成最低版本' : '', undefined, result === 'completed' ? 1 : 0, date);
    }
    return bonuses;
  };
  const addGoalMain = (index, milestone, title = milestone.description) => db.addQuest({
    localDate: dates[index], type: 'main', sourceType: 'goal', sourceId: goal.id, milestoneId: milestone.id,
    title, reason: `推进目标“${goal.result}”`, minimumAction: `先用五分钟完成：${title}`,
    completionCriteria: milestone.evidence, estimatedMinutes: 10, difficulty: 'light', branchId: branch.id,
  });
  const runWeeklyReview = async (endIndex, decision) => {
    const startDate = dates[endIndex - 6];
    const endDate = dates[endIndex];
    const events = (await db.listJournalEvents()).filter((event) => event.active && event.confirmation === 'confirmed' && event.sourceType === 'explicit' && event.localDate >= startDate && event.localDate <= endDate);
    assert(events.length >= 2, `week ending ${endDate} should have evidence from at least two days`);
    const request = weeklyRequest(events, startDate, endDate, `weekly-${endIndex + 1}`);
    const job = await db.createWeeklyReviewJob(request);
    await db.markAnalysisJobProcessing(job.id);
    const review = await db.saveWeeklyReview(job.id, weeklyResponse(request));
    if (decision === 'confirm') await db.confirmWeeklyReview(review.id, review.nextTheme, review.nextExperiment, endDate);
    else await db.rejectWeeklyReview(review.id);
  };

  await db.saveAssessment({ energy: 70, mind: 65, connection: 60, progress: 55, play: 50 }, dates[0]);
  await recordDay(0);
  const first = await addGoalMain(0, milestones[0]);
  assert.equal(chooseDailyDirection({ mainQuest: first, recoveryAvailable: false, activeGoalAvailable: true, previousStepAvailable: false }).kind, 'main');
  await db.feedbackQuest(first.id, 'completed', '完成结构', '列出三个章节', undefined, 2, dates[0]);
  const dayTwo = await db.createGoalFollowUpQuest(first.id, dates[1]);
  assert.equal(dayTwo.followUp?.milestoneId, milestones[1].id);
  await settleBonuses(0);

  await recordDay(1);
  assert.match(chooseDailyDirection({ mainQuest: { status: 'pending', carriedFromPreviousDay: true }, recoveryAvailable: false, activeGoalAvailable: true, previousStepAvailable: false }).reason, /昨天反馈后生成的下一步/);
  await db.feedbackQuest(dayTwo.followUp.id, 'partial', '只写完第一章', '第一章已有正文', undefined, 1, dates[1]);
  const dayThree = await db.createGoalFollowUpQuest(dayTwo.followUp.id, dates[2], 'partial');
  assert.match(dayThree.followUp?.title ?? '', /^缩小继续：/);
  await settleBonuses(1, 'partial');

  await recordDay(2);
  await db.feedbackQuest(dayThree.followUp.id, 'skipped', '建议不适合我，需要换一种写法', '', undefined, 0, dates[2]);
  assert.equal((await db.listQuests(dates[3])).filter((quest) => quest.sourceType === 'goal').length, 0, 'rejected advice must not copy itself');
  await settleBonuses(2, 'skipped');

  await recordDay(3);
  await db.saveAssessment({ energy: 30 }, dates[3]);
  const dayFour = await addGoalMain(3, milestones[1], '只补一段最容易写的正文');
  assert.equal(chooseDailyDirection({ mainQuest: dayFour, recoveryAvailable: true, activeGoalAvailable: true, previousStepAvailable: false }).kind, 'recovery');
  await db.feedbackQuest(dayFour.id, 'exempt', '今天状态不足，先恢复且不扣分', '', undefined, 0, dates[3]);
  await settleBonuses(3, 'skipped');

  await recordDay(4);
  const dayFive = await addGoalMain(4, milestones[1], '用最低版本完成剩余正文');
  await db.feedbackQuest(dayFive.id, 'completed', '最低版本完成', '三个章节都有正文', undefined, 2, dates[4]);
  const daySix = await db.createGoalFollowUpQuest(dayFive.id, dates[5]);
  await settleBonuses(4);

  await recordDay(5);
  await db.feedbackQuest(daySix.followUp.id, 'completed', '已经试读', '收到一条具体反馈', undefined, 2, dates[5]);
  const daySeven = await db.createGoalFollowUpQuest(daySix.followUp.id, dates[6]);
  await settleBonuses(5);
  await recordDay(6);
  await settleBonuses(6);
  await runWeeklyReview(6, 'reject');

  assert.equal((await db.listQuests(dates[7])).length, 0, 'a day not opened must not create BONUS debt');
  assert.equal((await db.listQuests(dates[8])).length, 0, 'a second missed day must stay empty');
  db.close();
  db = await QiguangDb.open(databaseName);
  assert.deepEqual((await db.listPendingBefore(dates[9])).map((quest) => quest.id), [daySeven.followUp.id], 'returning should show one unresolved MAIN, not a backlog');

  await recordDay(9);
  await db.feedbackQuest(daySeven.followUp.id, 'exempt', '中断后重新判断，不补旧任务', '', undefined, 0, dates[9]);
  const dayTen = await addGoalMain(9, milestones[3], '根据试读反馈完成修订');
  await db.ensureTodayBonusQuests(dates[9]);
  const widgetBeforeCompletion = buildWidgetSnapshot({
    quests: await db.listQuests(dates[9]), localDate: dates[9], generatedAt: `${dates[9]}T08:00:00.000Z`,
  });
  assert.equal(widgetBeforeCompletion.tasks[0]?.id, dayTen.id);
  assert.equal(widgetBeforeCompletion.tasks.filter((item) => item.type === 'bonus').length, 1);
  await db.feedbackQuest(dayTen.id, 'completed', '完成修订', '生成可分享最终版', undefined, 3, dates[9]);
  const finished = await db.createGoalFollowUpQuest(dayTen.id, dates[10]);
  assert.equal(finished.goalReady, true);
  await db.saveGoal(goal.id, { status: 'completed' });
  await settleBonuses(9);

  let finalWidget;
  for (let index = 10; index < dates.length; index += 1) {
    if (interruptionIndexes.has(index)) {
      assert.equal((await db.listQuests(dates[index])).length, 0, `${dates[index]} was not opened and must stay debt-free`);
      continue;
    }
    const date = dates[index];
    await recordDay(index);
    if (index === 10) await db.saveAssessment({ energy: 62, mind: 68, connection: 61, progress: 66, play: 58 }, date);

    let main = [...await db.listPendingBefore(date), ...await db.listQuests(date)].find((quest) => quest.type === 'main' && quest.status === 'pending');
    if (!main) main = await db.addQuest({
      localDate: date, type: 'main', sourceType: 'manual', actionId: `reflection-${index}`,
      title: `第 ${index + 1} 天的最小复盘`, reason: index === 10 ? '目标完成后沉淀成功证据' : '根据最近的真实反馈继续一个更小动作',
      minimumAction: '只写一句具体事实', completionCriteria: '留下一句可回看的事实',
      estimatedMinutes: 5, difficulty: index % 6 === 0 ? 'hard' : 'light', branchId: branch.id,
      deadlineAt: index === 15 ? `${date}T20:00:00.000Z` : undefined,
    });

    if (index === 15) {
      await settleBonuses(index);
      continue;
    }
    if (index === 18) {
      await db.feedbackQuest(main.id, 'completed', '先误记为完成', '完成一句', undefined, 0, date);
      await db.undoQuestFeedback(main.id);
      await db.feedbackQuest(main.id, 'partial', '撤销后按事实改为部分完成', '只写了半句', undefined, 0, date);
    } else if (index === 22) {
      await db.feedbackQuest(main.id, 'skipped', '今天主动放下', '', undefined, 0, date);
    } else if (index === 23) {
      await db.feedbackQuest(main.id, 'exempt', '外部原因，不归咎执行力', '', undefined, 0, date);
    } else {
      await db.feedbackQuest(main.id, 'completed', main.localDate < date ? '晚于计划完成，仍按事实结算' : '完成今天的最小行动', '写下一句具体收获', undefined, 0, date);
    }

    for (const side of (await db.listQuests(date)).filter((quest) => quest.type === 'side' && quest.status === 'pending')) {
      await db.feedbackQuest(side.id, index % 2 ? 'partial' : 'completed', '支线只保留真实进展', '完成最低版本', undefined, 0, date);
    }

    if (index === 11) {
      await settleBonuses(index);
      await db.saveHabit(walking.id, { status: 'paused' }, date);
      await db.saveHabit(gratitude.id, { bonusEnabled: true }, date);
    } else if (index === 14) {
      await db.saveHabit(gratitude.id, { status: 'paused' }, date);
      await db.saveHabit(walking.id, { status: 'active' }, date);
      await settleBonuses(index);
    } else {
      await settleBonuses(index, index === 24 ? 'skipped' : 'completed');
    }

    if ([13, 20, 27].includes(index)) await runWeeklyReview(index, 'confirm');
    if (index === 21) {
      const backup = JSON.parse(JSON.stringify(await db.exportBundle()));
      await t.test('day 22 backup restores a goal progression exactly', async () => {
        restored = await QiguangDb.restoreFromBackup(JSON.stringify(backup), restoredName);
        assert.deepEqual((await restored.exportBundle()).data, backup.data, 'a month-in-progress backup must restore exactly');
      });
      restored?.close();
      restored = undefined;
    }
    if (index === 28) await db.saveHabit(walking.id, { status: 'ended' }, date);
    if (index === 29) finalWidget = buildWidgetSnapshot({
      quests: await db.listQuests(date), localDate: date, generatedAt: `${date}T20:00:00.000Z`,
    });
  }

  const entries = await db.listEntries();
  const feedback = (await db.listQuestFeedback()).filter((item) => !item.undoneAt);
  const ledger = await db.listXpLedger();
  const activeDays = dates.filter((_, index) => !interruptionIndexes.has(index));
  assert.equal(entries.length, activeDays.length);
  assert.ok(entries.some((entry) => entry.kind === 'success'));
  assert.ok(entries.some((entry) => entry.kind === 'journal'));
  assert.deepEqual(new Set(feedback.map((item) => item.result)), new Set(['completed', 'partial', 'skipped', 'exempt']));
  assert.equal((await db.listMilestones(goal.id)).filter((item) => item.status === 'completed').length, 4);
  assert.equal((await db.listGoals()).find((item) => item.id === goal.id)?.status, 'completed');
  assert.equal((await db.listQuests()).filter((item) => item.status === 'pending').length, 0);
  assert.equal((await db.listReviews('weekly')).length, 4);
  assert.deepEqual(new Set((await db.listReviews('weekly')).map((item) => item.status)), new Set(['confirmed', 'rejected']));
  assert.equal((await db.listDailyAnalyses()).length, analysisIndexes.size);
  assert.ok((await db.listMemories('confirmed')).length >= 1);
  assert.ok(totalXp(ledger) > 300, 'thirty days of real actions and milestones should leave visible growth without login XP');
  assert((await db.habitMomentum(walking.id, dates[29])) > 0, 'missed and paused days lower momentum without resetting it');
  assert.equal(monthlyAreaSignal(area.mode, ledger.length, 0, dates[29], dates[29]), 'progress');
  assert.equal(finalWidget?.tasks.length, 0, 'completed work and an ended habit must not remain in the final widget');
  const lateQuest = (await db.listQuests()).find((quest) => quest.deadlineAt);
  assert(lateQuest);
  const lateFeedback = (await db.listQuestFeedback(lateQuest.id)).find((item) => !item.undoneAt);
  const lateXp = ledger.find((item) => item.sourceType === 'quest' && item.sourceId === lateQuest.id && !item.reversedAt);
  assert(lateFeedback);
  assert(lateXp);
  assert.equal(lateFeedback.completedDate, dates[17]);
  assert.equal(lateXp.localDate, dates[17], 'late completion XP belongs to the real completion date');
  for (const date of dates) {
    const pending = (await db.listQuests(date)).filter((quest) => quest.status === 'pending');
    assert.ok(pending.filter((quest) => quest.type === 'main').length <= 1);
    assert.ok(pending.filter((quest) => quest.type === 'bonus').length <= 3);
    assert.ok(pending.filter((quest) => quest.type === 'side').length <= 2);
  }

  t.diagnostic(JSON.stringify({
    simulationKind: 'deterministic-closed-use', calendarDays: 30, activeDays: entries.length, interruptionDays: interruptionIndexes.size,
    journalEntries: entries.length, dailyAnalyses: analysisIndexes.size, weeklyReviews: 4,
    taskFeedback: Object.fromEntries(['completed', 'partial', 'skipped', 'exempt'].map((result) => [result, feedback.filter((item) => item.result === result).length])),
    milestonesCompleted: 4, totalXp: totalXp(ledger), pendingDebt: 0,
    testedFlows: ['journal-edit-search-undo', 'confirmed-goal-plan', 'MAIN-and-side-feedback', 'BONUS-pause-resume-end', 'late-completion', 'feedback-undo', 'daily-analysis', 'weekly-review', 'memory-confirmation', 'widget'],
    knownProductGaps: ['real retention and trust need human longitudinal use'],
  }));
});

test('pausing a habit retires an already generated pending BONUS', async (t) => {
  const name = `qiguang-paused-bonus-${crypto.randomUUID()}`;
  const db = await QiguangDb.open(name);
  t.after(async () => { db.close(); await deleteDatabase(name); });
  await db.ensureI2Defaults();
  const branch = (await db.listBranches())[0];
  const habit = await db.addHabit({
    name: '暂停测试', minimumAction: '做一分钟', scheduleDays: [1, 2, 3, 4, 5, 6, 7],
    dimension: 'energy', branchId: branch.id, difficulty: 'light', bonusEnabled: true,
  }, dates[0]);
  await db.ensureTodayBonusQuests(dates[0]);
  await db.saveHabit(habit.id, { status: 'paused' }, dates[0]);
  const pending = (await db.listQuests(dates[0])).filter((quest) => quest.sourceId === habit.id && quest.status === 'pending').length;
  assert.equal(pending, 0);
});

test('redoing an undone milestone restores its XP on the real completion date', async (t) => {
  const name = `qiguang-milestone-redo-${crypto.randomUUID()}`;
  const db = await QiguangDb.open(name);
  t.after(async () => { db.close(); await deleteDatabase(name); });
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '完成可检查成果', why: '', evidence: '存在成果', nextStep: '先做一步',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const milestone = await db.addMilestone(goal.id, '形成第一版', '存在第一版');
  await db.completeMilestone(milestone.id, dates[0]);
  await db.undoMilestone(milestone.id);
  await db.completeMilestone(milestone.id, dates[1]);
  const ledger = (await db.listXpLedger(branch.id)).filter((item) => item.sourceType === 'milestone' && item.sourceId === milestone.id && !item.reversedAt);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].localDate, dates[1]);
  assert.equal((await db.branchProgress(branch.id)).totalXp, 50);
});
