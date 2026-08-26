import assert from 'node:assert/strict';
import test from 'node:test';

import 'fake-indexeddb/auto';

import { selectGrowthBadges } from '../src/badges.ts';
import { DB_VERSION, LEGACY_SUCCESS_PROMPT, QiguangDb, migrateLegacyJournalContent, parseBackup } from '../src/db.ts';

function databaseName(label) {
  return `qiguang-test-${label}-${crypto.randomUUID()}`;
}

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => reject(new Error(`database ${name} is still open`)), { once: true });
  });
}

async function withDatabase(t, label) {
  const name = databaseName(label);
  const db = await QiguangDb.open(name);
  t.after(async () => {
    db.close();
    await deleteDatabase(name);
  });
  return db;
}

function openRawDatabase(name, version = DB_VERSION, onUpgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.addEventListener('upgradeneeded', () => onUpgrade?.(request.result, request.transaction), { once: true });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function storeShape(store) {
  return {
    keyPath: store.keyPath,
    autoIncrement: store.autoIncrement,
    indexes: Array.from(store.indexNames, (name) => {
      const index = store.index(name);
      return {
        name,
        keyPath: index.keyPath,
        unique: index.unique,
        multiEntry: index.multiEntry,
      };
    }),
  };
}

function emptyBackupData() {
  return Object.fromEntries([
    'profile', 'areas', 'entries', 'revisions', 'observations', 'goals', 'milestones',
    'analyses', 'events', 'snapshots', 'quests', 'questFeedback', 'habits', 'habitLogs',
    'branches', 'xpLedger', 'reviews', 'memories', 'analysisJobs', 'settings',
  ].map((name) => [name, []]));
}

function analysisRequest(entry, requestId = crypto.randomUUID()) {
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

function analysisResponse(request) {
  const quote = '会议很多';
  const source = Array.from(request.userInput.entries[0].text);
  const start = source.join('').indexOf(quote);
  return {
    contractVersion: '1.0', requestId: request.requestId, operation: 'daily_analysis', warnings: [],
    result: {
      title: '会议之后恢复', summary: '会议较多，散步后有所缓解。', explicitMoods: ['缓和'],
      events: [
        {
          candidateId: 'fact-1', title: '会议较多', description: '记录明确提到会议很多。',
          sourceType: 'explicit', confirmation: 'confirmed_by_default', confidence: 'high',
          evidence: [{ entryId: request.userInput.entries[0].entryId, quote, start, end: start + Array.from(quote).length }],
          stateImpactCandidates: [{
            dimension: 'energy', direction: 'negative', strength: 'medium', suggestedDelta: -6,
            reason: '密集会议消耗体力。', confidence: 'medium',
          }],
          growthEvidenceCandidate: null,
        },
        {
          candidateId: 'inference-1', title: '散步可能帮助恢复', description: '只观察到同时出现。',
          sourceType: 'inferred', confirmation: 'pending', confidence: 'low',
          evidence: [{
            entryId: request.userInput.entries[0].entryId, quote: '散步后好了一些',
            start: source.join('').indexOf('散步后好了一些'), end: source.join('').indexOf('散步后好了一些') + 7,
          }],
          stateImpactCandidates: [{
            dimension: 'mental', direction: 'positive', strength: 'small', suggestedDelta: 3,
            reason: '散步后感觉有所缓解。', confidence: 'low',
          }],
          growthEvidenceCandidate: null,
        },
      ],
      reflection: {
        whatHappened: '会议较多，散步后有所恢复。', specificCredit: '主动留出了恢复时间。',
        patternCandidate: { observation: '会议日可能需要过渡。', evidenceCount: 1, neededEvidence: '再观察两次。' },
        nextSmallStep: '会议后留十分钟。',
      },
      questSuggestions: [],
      memoryCandidates: [{
        type: 'constraint', statement: '会议密集的晚上注意力可能较低。', confidence: 'low',
        supportingEventIds: ['fact-1'], counterEvidence: [], recommendedAction: 'observe',
      }],
    },
  };
}

function weeklyRequest(events, requestId = crypto.randomUUID()) {
  return {
    contractVersion: '1.0', operation: 'weekly_review', requestId, locale: 'zh-CN', timeZone: 'Asia/Shanghai',
    period: { start: '2026-08-10', end: '2026-08-14' }, userInput: { note: '' },
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
        dimension: 'energy', direction: 'stable', summary: '两天都记录了相似的现实事件。',
        evidenceEventIds: [first.eventId, second.eventId], evidenceDates: [first.localDate, second.localDate], relationship: 'correlation',
      }],
      recurringBenefits: [], recurringCosts: [], growthDeposits: [], habitDecisions: [],
      nextWeekTheme: { title: '保护恢复节奏', reason: '用一个小实验继续观察。' },
      nextExperiment: { hypothesis: '短休息可能帮助恢复。', minimumAction: '每天休息十分钟。', metric: '记录开始次数。', endDate: '2026-08-21', stopCondition: '明显增加负担时停止。' },
      systemCandidates: [{
        type: 'pattern', statement: '密集会议后可能需要恢复时间。', confidence: 'low',
        supportingEventIds: [first.eventId, second.eventId], counterEvidence: [], recommendedAction: 'observe',
      }],
    },
  };
}

async function weeklyVersionFixture(t, name) {
  const db = await withDatabase(t, name);
  await db.ensureI2Defaults();
  for (const [date, requestId] of [['2026-08-11', `${name}-event-a`], ['2026-08-13', `${name}-event-b`]]) {
    const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', date);
    const request = analysisRequest(entry, requestId);
    const job = await db.createDailyAnalysisJob(request);
    await db.markAnalysisJobProcessing(job.id);
    await db.saveDailyAnalysis(job.id, analysisResponse(request));
  }
  const branch = (await db.listBranches())[0];
  const habit = await db.addHabit({
    name: '每日短走', minimumAction: '走两分钟', scheduleDays: [1, 2, 3, 4, 5, 6, 7],
    dimension: 'energy', branchId: branch.id, difficulty: 'light', bonusEnabled: true,
  }, '2026-08-10');
  const raw = await openRawDatabase(db.name);
  const habitTransaction = raw.transaction('habits', 'readwrite');
  habitTransaction.objectStore('habits').put({ ...habit, createdAt: '2026-08-09T00:00:00.000Z' });
  await new Promise((resolve, reject) => {
    habitTransaction.addEventListener('complete', resolve, { once: true });
    habitTransaction.addEventListener('error', () => reject(habitTransaction.error), { once: true });
  });
  raw.close();
  const bonus = (await db.ensureTodayBonusQuests('2026-08-10')).find((item) => item.sourceId === habit.id);
  await db.feedbackQuest(bonus.id, 'completed', '已完成', '走了两分钟', undefined, 0, '2026-08-10');
  const [currentHabit, currentQuest] = await Promise.all([
    db.listHabits().then((items) => items.find((item) => item.id === habit.id)),
    db.listQuests().then((items) => items.find((item) => item.id === bonus.id)),
  ]);
  const feedback = (await db.listQuestFeedback(bonus.id)).find((item) => !item.undoneAt);
  const log = (await db.listHabitLogs(habit.id)).find((item) => item.questId === bonus.id);
  const events = (await db.listJournalEvents()).filter((item) => item.sourceType === 'explicit');
  const request = weeklyRequest(events, `${name}-weekly`);
  request.context.taskResults = [{
    questId: currentQuest.id, localDate: feedback.completedDate ?? currentQuest.localDate, title: currentQuest.title,
    result: currentQuest.status, actual: feedback.actual,
  }];
  request.context.habits = [{
    habitId: currentHabit.id, name: currentHabit.name, minimumAction: currentHabit.minimumAction,
    momentum: await db.habitMomentum(currentHabit.id, request.period.end),
  }];
  request.context.sourceVersions = {
    quests: [{ id: currentQuest.id, version: currentQuest.version }],
    questFeedback: [{ id: feedback.id, version: feedback.version }],
    habits: [{ id: currentHabit.id, version: currentHabit.version }],
    habitLogs: [{ id: log.id, version: log.version }],
    branches: [], xpLedger: [], goals: [], reviews: [], memories: [], stateObservations: [],
  };
  request.permissions.includeTaskResults = true;
  request.permissions.includeHabits = true;
  return { db, request, habit: currentHabit, quest: currentQuest };
}

async function patchRawRecord(database, storeName, id, patch) {
  const raw = await openRawDatabase(database.name);
  const transaction = raw.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  const current = await new Promise((resolve, reject) => {
    const request = store.get(id);
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
  store.put({ ...current, ...patch });
  await new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
  raw.close();
}

test('v5 schema contains all twenty documented stores and integrity indexes', async (t) => {
  const db = await withDatabase(t, 'schema');
  const raw = await openRawDatabase(db.name);
  try {
    assert.equal(raw.version, 5);
    assert.deepEqual(Array.from(raw.objectStoreNames), [
      'analyses', 'analysisJobs', 'areas', 'branches', 'entries', 'events', 'goals', 'habitLogs',
      'habits', 'memories', 'milestones', 'observations', 'profile', 'questFeedback', 'quests',
      'reviews', 'revisions', 'settings', 'snapshots', 'xpLedger',
    ]);

    const transaction = raw.transaction(Array.from(raw.objectStoreNames), 'readonly');
    assert.equal(transaction.objectStore('revisions').index('byEntryVersion').unique, true);
    assert.equal(transaction.objectStore('observations').index('byAssessmentDimension').unique, true);
    assert.equal(transaction.objectStore('observations').index('byEvidenceId').unique, false);
    assert.equal(transaction.objectStore('habitLogs').index('byHabitDate').unique, true);
    assert.equal(transaction.objectStore('xpLedger').index('bySettlementKey').unique, true);
    assert.equal(transaction.objectStore('analyses').index('byRequestId').unique, true);
    assert.equal(transaction.objectStore('analysisJobs').index('byRequestId').unique, true);
    await new Promise((resolve, reject) => {
      transaction.addEventListener('complete', resolve, { once: true });
      transaction.addEventListener('error', () => reject(transaction.error), { once: true });
    });
  } finally {
    raw.close();
  }
});

test('opening v5 migrates a v1 journal without losing data', async (t) => {
  const name = databaseName('v1-migration');
  const timestamp = new Date().toISOString();
  const raw = await openRawDatabase(name, 1, (database) => {
    database.createObjectStore('entries', { keyPath: 'id' }).createIndex('byLocalDateCreatedAt', ['localDate', 'createdAt']);
    database.createObjectStore('revisions', { keyPath: 'id' }).createIndex('byEntryId', 'entryId');
    database.createObjectStore('observations', { keyPath: 'id' });
    database.createObjectStore('settings', { keyPath: 'id' });
  });
  const transaction = raw.transaction(['entries', 'revisions', 'observations', 'settings'], 'readwrite');
  transaction.objectStore('entries').add({
    id: 'legacy-entry', localDate: '2026-08-13', body: '旧记录', inputMethod: 'text',
    createdAt: timestamp, updatedAt: timestamp, version: 1,
  });
  transaction.objectStore('entries').add({
    id: 'legacy-success', localDate: '2026-08-13', body: `  ${LEGACY_SUCCESS_PROMPT}\n保留这段成功正文`, inputMethod: 'text',
    createdAt: timestamp, updatedAt: timestamp, version: 2,
  });
  transaction.objectStore('entries').add({
    id: 'legacy-mixed', localDate: '2026-08-13', body: `普通经历\n\n${LEGACY_SUCCESS_PROMPT}完成了关键一步`, inputMethod: 'text',
    createdAt: timestamp, updatedAt: timestamp, version: 4,
  });
  transaction.objectStore('entries').add({
    id: 'explicit-journal', localDate: '2026-08-13', body: `${LEGACY_SUCCESS_PROMPT}\n显式普通日记`, inputMethod: 'text', kind: 'journal',
    createdAt: timestamp, updatedAt: timestamp, version: 1,
  });
  transaction.objectStore('revisions').add({
    id: 'legacy-revision', entryId: 'legacy-success', fromVersion: 1,
    previousBody: `${LEGACY_SUCCESS_PROMPT}\n旧版本正文`, reason: 'user-edit',
    createdAt: timestamp, updatedAt: timestamp, version: 1,
  });
  transaction.objectStore('settings').add({
    id: 'app', reduceMotion: true, onboardingSeen: true, createdAt: timestamp, updatedAt: timestamp, version: 1,
  });
  transaction.objectStore('observations').add({
    id: 'legacy-observation', assessmentId: 'legacy-assessment', localDate: '2026-08-13',
    dimension: 'energy', kind: 'user-self-assessment', value: 48, observedAt: timestamp,
    createdAt: timestamp, updatedAt: timestamp, version: 1,
  });
  await new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
  raw.close();

  const db = await QiguangDb.open(name);
  t.after(async () => {
    db.close();
    await deleteDatabase(name);
  });
  assert.equal((await db.getEntry('legacy-entry')).body, '旧记录');
  assert.equal((await db.getEntry('legacy-entry')).kind, 'journal');
  assert.equal((await db.getEntry('legacy-entry')).version, 1);
  assert.equal((await db.getEntry('legacy-entry')).analysisStatus, 'not-submitted');
  assert.deepEqual(
    { body: (await db.getEntry('legacy-success')).body, kind: (await db.getEntry('legacy-success')).kind },
    { body: '保留这段成功正文', kind: 'success' },
  );
  assert.equal((await db.getEntry('legacy-success')).version, 3);
  assert.deepEqual(
    { body: (await db.getEntry('legacy-mixed')).body, kind: (await db.getEntry('legacy-mixed')).kind },
    { body: '普通经历', kind: 'journal' },
  );
  assert.equal((await db.getEntry('legacy-mixed')).version, 5);
  assert.deepEqual(
    { body: (await db.getEntry('legacy-mixed:legacy-success')).body, kind: (await db.getEntry('legacy-mixed:legacy-success')).kind },
    { body: '完成了关键一步', kind: 'success' },
  );
  assert.deepEqual(
    { body: (await db.getEntry('explicit-journal')).body, kind: (await db.getEntry('explicit-journal')).kind },
    { body: `${LEGACY_SUCCESS_PROMPT}\n显式普通日记`, kind: 'journal' },
  );
  assert.equal((await db.getEntry('explicit-journal')).version, 1);
  assert.deepEqual(
    { body: (await db.listRevisions('legacy-success'))[0].previousBody, kind: (await db.listRevisions('legacy-success'))[0].previousKind },
    { body: '旧版本正文', kind: 'success' },
  );
  assert.equal((await db.listRevisions('legacy-success'))[0].version, 2);
  assert.equal((await db.getSettings()).reduceMotion, true);
  assert.equal((await db.getSettings()).aiAllowed, false);
  assert.equal((await db.listStateObservations('energy'))[0].active, true);
  assert.equal((await db.exportBundle()).data.areas.length, 0);
});

test('opening v5 gives legacy completed goals one stable completion timestamp', async (t) => {
  const name = databaseName('v4-goal-completed-at');
  const timestamp = '2026-08-14T08:00:00.000Z';
  const raw = await openRawDatabase(name, 4, (database) => {
    const goals = database.createObjectStore('goals', { keyPath: 'id' });
    goals.createIndex('byStatus', 'status');
    goals.createIndex('byRole', 'role');
  });
  const write = raw.transaction('goals', 'readwrite');
  write.objectStore('goals').add({
    id: 'legacy-completed-goal', result: '旧目标', why: '', evidence: '', nextStep: '已完成',
    areaId: 'legacy-area', branchId: 'legacy-branch', role: 'main', status: 'completed',
    createdAt: timestamp, updatedAt: timestamp, version: 3,
  });
  await new Promise((resolve, reject) => {
    write.addEventListener('complete', resolve, { once: true });
    write.addEventListener('error', () => reject(write.error), { once: true });
  });
  raw.close();

  const db = await QiguangDb.open(name);
  t.after(async () => {
    db.close();
    await deleteDatabase(name);
  });
  assert.equal((await db.listGoals())[0].completedAt, timestamp);
  assert.equal((await db.listGoals())[0].completedDate, '2026-08-14');
});

test('format v3 backups without weekly reviews upgrade safely to format v4', async (t) => {
  const db = await withDatabase(t, 'backup-v3-upgrade');
  await db.addEntry('旧版备份中的真实记录', '2026-08-14');
  const backup = await db.exportBundle();
  backup.formatVersion = 3;
  const parsed = parseBackup(JSON.stringify(backup));
  assert.equal(parsed.formatVersion, 4);
  assert.equal(parsed.data.entries[0].body, '旧版备份中的真实记录');
});

test('daily analysis stays queued locally, saves candidates atomically, and applies only confirmed events', async (t) => {
  const db = await withDatabase(t, 'i3-analysis');
  const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-14');
  await db.saveAssessment({ energy: 50, mind: 50 }, '2026-08-13');
  const request = analysisRequest(entry, 'analysis-request-1');
  const queued = await db.createDailyAnalysisJob(request);
  assert.equal(queued.status, 'queued');
  assert.equal((await db.getEntry(entry.id)).analysisStatus, 'queued');

  await db.markAnalysisJobProcessing(queued.id);
  const analysis = await db.saveDailyAnalysis(queued.id, analysisResponse(request));
  assert.equal(analysis.status, 'ready');
  assert.equal((await db.getEntry(entry.id)).analysisStatus, 'succeeded');
  assert.equal((await db.listAnalysisJobs('2026-08-14'))[0].status, 'succeeded');
  const events = await db.listJournalEvents('2026-08-14');
  assert.deepEqual(events.map((item) => item.confirmation), ['confirmed', 'pending']);
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).energy.value, 44);
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).mind.value, 50);
  const memory = (await db.listMemories('candidate'))[0];
  await db.decideMemory(memory.id, 'confirmed');
  assert.equal((await db.listMemories('confirmed')).length, 1);

  await db.decideEvent(events[1].id, 'confirmed');
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).mind.value, 53);
  await db.decideEvent(events[0].id, 'rejected');
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).energy.value, 50);
  assert.equal((await db.listMemories('candidate')).length, 1);
  await assert.rejects(() => db.decideMemory(memory.id, 'confirmed'), /没有有效证据/);
});

test('a successful reanalysis supersedes the previous daily summary without double-counting effects', async (t) => {
  const db = await withDatabase(t, 'i3-reanalysis');
  await db.saveAssessment({ energy: 50 }, '2026-08-13');
  const firstEntry = await db.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-14');
  const firstRequest = analysisRequest(firstEntry, 'reanalysis-first');
  const firstJob = await db.createDailyAnalysisJob(firstRequest);
  await db.markAnalysisJobProcessing(firstJob.id);
  const first = await db.saveDailyAnalysis(firstJob.id, analysisResponse(firstRequest));
  const oldMemory = (await db.listMemories('candidate'))[0];
  await db.decideMemory(oldMemory.id, 'confirmed');
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).energy.value, 44);

  const secondEntry = await db.addEntry('补充记录：晚上没有继续工作。', '2026-08-14');
  const secondRequest = analysisRequest(firstEntry, 'reanalysis-second');
  secondRequest.userInput.entries.push({ entryId: secondEntry.id, revision: secondEntry.version, text: secondEntry.body });
  secondRequest.permissions.entryIds.push(secondEntry.id);
  const secondJob = await db.createDailyAnalysisJob(secondRequest);
  await db.markAnalysisJobProcessing(secondJob.id);
  const second = await db.saveDailyAnalysis(secondJob.id, analysisResponse(secondRequest));

  const analyses = await db.listDailyAnalyses('2026-08-14');
  assert.equal(analyses.find((item) => item.id === first.id).status, 'stale');
  assert.equal(analyses.find((item) => item.id === second.id).status, 'ready');
  assert.ok((await db.listJournalEvents('2026-08-14')).filter((item) => item.analysisId === first.id).every((item) => !item.active));
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).energy.value, 44);
  assert.equal((await db.listMemories('candidate')).find((item) => item.id === oldMemory.id).evidenceIds.length, 0);
});

test('an older in-flight daily request cannot overwrite a newer request that finishes first', async (t) => {
  const db = await withDatabase(t, 'i3-reanalysis-order');
  const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-14');
  const omittedEntry = await db.addEntry('这条记录不进入后一次发送范围。', '2026-08-14');
  const olderRequest = analysisRequest(entry, 'reanalysis-older');
  olderRequest.userInput.entries.push({ entryId: omittedEntry.id, revision: omittedEntry.version, text: omittedEntry.body });
  olderRequest.permissions.entryIds.push(omittedEntry.id);
  const olderJob = await db.createDailyAnalysisJob(olderRequest);
  await db.markAnalysisJobProcessing(olderJob.id);

  const newerRequest = analysisRequest(entry, 'reanalysis-newer');
  const newerJob = await db.createDailyAnalysisJob(newerRequest);
  assert.equal((await db.listAnalysisJobs('2026-08-14')).find((item) => item.id === olderJob.id).status, 'stale');
  assert.equal((await db.getEntry(omittedEntry.id)).analysisStatus, 'not-submitted');
  await db.markAnalysisJobProcessing(newerJob.id);
  const newer = await db.saveDailyAnalysis(newerJob.id, analysisResponse(newerRequest));
  await assert.rejects(() => db.saveDailyAnalysis(olderJob.id, analysisResponse(olderRequest)), /更新请求取代/);
  assert.equal((await db.listDailyAnalyses('2026-08-14')).find((item) => item.id === newer.id).status, 'ready');
});

test('an interrupted request resumes only after expiry and old attempts lose CAS', async (t) => {
  const db = await withDatabase(t, 'i3-interrupted-resume');
  const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-14');
  const request = analysisRequest(entry, 'interrupted-request');
  const job = await db.createDailyAnalysisJob(request);
  const firstAttempt = await db.markAnalysisJobProcessing(job.id);

  await assert.rejects(
    () => db.markAnalysisJobProcessing(job.id, { expectedVersion: firstAttempt.version, staleBefore: new Date(0).toISOString() }),
    /状态已经改变/,
  );
  assert.equal((await db.listAnalysisJobs('2026-08-14'))[0].version, firstAttempt.version);

  const resumed = await db.markAnalysisJobProcessing(job.id, {
    expectedVersion: firstAttempt.version,
    staleBefore: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(resumed.attemptCount, firstAttempt.attemptCount + 1);
  assert.equal(resumed.version, firstAttempt.version + 1);

  await assert.rejects(
    () => db.failAnalysisJob(job.id, 'MODEL_TIMEOUT', '旧请求超时。', undefined, firstAttempt.version),
    /新的重试接管/,
  );
  await assert.rejects(
    () => db.saveDailyAnalysis(job.id, analysisResponse(request), firstAttempt.version),
    /新的重试接管/,
  );
  const saved = await db.saveDailyAnalysis(job.id, analysisResponse(request), resumed.version);
  assert.equal(saved.requestId, request.requestId);
  assert.equal((await db.listAnalysisJobs('2026-08-14'))[0].status, 'succeeded');
});

test('retry uses one request and editing the source makes old analysis and impacts stale', async (t) => {
  const db = await withDatabase(t, 'i3-stale');
  const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-14');
  await db.saveAssessment({ energy: 60 }, '2026-08-13');
  const request = analysisRequest(entry, 'stable-request-id');
  const firstJob = await db.createDailyAnalysisJob(request);
  assert.equal((await db.createDailyAnalysisJob(request)).id, firstJob.id);
  await db.markAnalysisJobProcessing(firstJob.id);
  const firstAnalysis = await db.saveDailyAnalysis(firstJob.id, analysisResponse(request));
  assert.equal((await db.saveDailyAnalysis(firstJob.id, analysisResponse(request))).id, firstAnalysis.id);
  assert.equal((await db.listDailyAnalyses('2026-08-14')).length, 1);
  const memory = (await db.listMemories('candidate'))[0];
  await db.decideMemory(memory.id, 'confirmed');

  await db.editEntry(entry.id, 1, '今天会议取消了，晚上只是在家休息。');
  assert.equal((await db.listDailyAnalyses('2026-08-14'))[0].status, 'stale');
  assert.equal((await db.listAnalysisJobs('2026-08-14'))[0].status, 'stale');
  assert.ok((await db.listJournalEvents('2026-08-14')).every((item) => !item.active));
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).energy.value, 60);
  const staleMemory = (await db.listMemories('candidate'))[0];
  assert.deepEqual(staleMemory.evidenceIds, []);
  await assert.rejects(() => db.decideMemory(staleMemory.id, 'confirmed'), /没有有效证据/);
});

test('analysis quest suggestions are accepted atomically once and stale suggestions are rejected', async (t) => {
  const db = await withDatabase(t, 'i3-quest-suggestion');
  const makeSuggestion = () => ({
    type: 'main', title: '留十分钟过渡', why: '先观察低压力恢复是否有帮助。', minimumVersion: '十分钟不打开新工作。',
    estimatedMinutes: 10, difficulty: 'light', primaryState: 'mental', growthBranchId: null, sourceGoalId: null, isRecovery: true,
  });
  const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-14');
  const request = analysisRequest(entry, 'quest-suggestion-ready');
  const response = analysisResponse(request);
  response.result.questSuggestions = [makeSuggestion()];
  const job = await db.createDailyAnalysisJob(request);
  await db.markAnalysisJobProcessing(job.id);
  const analysis = await db.saveDailyAnalysis(job.id, response);
  assert.equal((await db.acceptAnalysisQuestSuggestion(analysis.id, 0)).created, true);
  assert.equal((await db.acceptAnalysisQuestSuggestion(analysis.id, 0)).created, false);
  assert.equal((await db.listQuests('2026-08-15')).length, 1);

  const staleEntry = await db.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-13');
  const staleRequest = analysisRequest(staleEntry, 'quest-suggestion-stale');
  const staleResponse = analysisResponse(staleRequest);
  staleResponse.result.questSuggestions = [makeSuggestion()];
  const staleJob = await db.createDailyAnalysisJob(staleRequest);
  await db.markAnalysisJobProcessing(staleJob.id);
  const staleAnalysis = await db.saveDailyAnalysis(staleJob.id, staleResponse);
  await db.editEntry(staleEntry.id, staleEntry.version, '原始记录已被修改，旧建议不能继续使用。');
  await assert.rejects(() => db.acceptAnalysisQuestSuggestion(staleAnalysis.id, 0), /已经过期/);
});

test('I3 analyses, events, queue, and memory survive exact backup restore', async (t) => {
  const db = await withDatabase(t, 'i3-roundtrip');
  const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-14');
  const request = analysisRequest(entry, 'portable-analysis');
  const job = await db.createDailyAnalysisJob(request);
  await db.markAnalysisJobProcessing(job.id);
  await db.saveDailyAnalysis(job.id, analysisResponse(request));
  const before = await db.exportBundle();
  await db.clearAll();
  await db.importBundle(JSON.stringify(before));
  assert.deepEqual((await db.exportBundle()).data, before.data);
});

test('merging I3 data keeps two auditable copies and remaps every analysis reference', async (t) => {
  const db = await withDatabase(t, 'i3-merge');
  const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-14');
  const request = analysisRequest(entry, 'merge-analysis');
  const job = await db.createDailyAnalysisJob(request);
  await db.markAnalysisJobProcessing(job.id);
  await db.saveDailyAnalysis(job.id, analysisResponse(request));
  const backup = await db.exportBundle();
  await db.importBundle(JSON.stringify(backup));
  const merged = await db.exportBundle();
  assert.equal(merged.data.entries.length, 2);
  assert.equal(merged.data.analysisJobs.length, 2);
  assert.equal(merged.data.analyses.length, 2);
  assert.equal(merged.data.events.length, 4);
  assert.equal(merged.data.memories.length, 2);
  assert.equal(new Set(merged.data.analysisJobs.map((item) => item.requestId)).size, 2);
  assert.equal(new Set(merged.data.analyses.map((item) => item.requestId)).size, 2);
  assert.doesNotThrow(() => parseBackup(JSON.stringify(merged)));
});

test('weekly review uses confirmed event versions, stays idempotent, and only applies after user confirmation', async (t) => {
  const db = await withDatabase(t, 'i3-weekly-review');
  for (const [date, requestId] of [['2026-08-11', 'week-day-a'], ['2026-08-13', 'week-day-b']]) {
    const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', date);
    const request = analysisRequest(entry, requestId);
    const job = await db.createDailyAnalysisJob(request);
    await db.markAnalysisJobProcessing(job.id);
    await db.saveDailyAnalysis(job.id, analysisResponse(request));
  }
  const events = (await db.listJournalEvents()).filter((item) => item.sourceType === 'explicit');
  const request = weeklyRequest(events, 'weekly-review-1');
  const job = await db.createWeeklyReviewJob(request);
  assert.equal(job.status, 'queued');
  await db.markAnalysisJobProcessing(job.id);
  const review = await db.saveWeeklyReview(job.id, weeklyResponse(request));
  assert.equal(review.status, 'candidate');
  assert.equal((await db.saveWeeklyReview(job.id, weeklyResponse(request))).id, review.id);
  assert.equal((await db.listMemories('candidate')).filter((item) => item.reviewId === review.id).length, 1);

  const confirmed = await db.confirmWeeklyReview(review.id, '我确认的恢复主题', review.nextExperiment, '2026-08-20');
  assert.equal(confirmed.review.status, 'confirmed');
  assert.equal(confirmed.questCreated, true);
  assert.equal(confirmed.questScheduled, true);
  assert.equal((await db.listQuests('2026-08-15')).length, 0, 'late confirmation must not create historical pending debt');
  const experimentQuest = (await db.listQuests('2026-08-20'))[0];
  assert.equal(experimentQuest.title, '我确认的恢复主题');
  await db.feedbackQuest(experimentQuest.id, 'completed', '实验已完成', '留下具体实验结果', undefined, 0, '2026-08-21');
  const backup = await db.exportBundle();
  assert.doesNotThrow(() => parseBackup(JSON.stringify(backup)));
  const corrupted = structuredClone(backup);
  corrupted.data.reviews[0].stateTrends = [null];
  assert.throws(() => parseBackup(JSON.stringify(corrupted)), /原始响应不一致/);
  await db.importBundle(JSON.stringify(backup));
  const merged = await db.exportBundle();
  assert.equal(merged.data.reviews.length, 2);
  assert.equal(merged.data.analysisJobs.filter((item) => item.operation === 'weekly_review').length, 2);
  assert.doesNotThrow(() => parseBackup(JSON.stringify(merged)));
  const importedReview = merged.data.reviews.find((item) => item.importedFromId === review.id);
  assert(importedReview);
  const importedExperiment = merged.data.quests.find((item) => item.actionId === `review:${importedReview.id}:experiment`);
  assert.equal(importedExperiment?.status, 'completed');
  assert.equal(selectGrowthBadges({ ...merged.data, ledger: merged.data.xpLedger, feedbacks: merged.data.questFeedback }).filter((item) => item.sourceType === 'experiment').length, 2);
  const restored = await withDatabase(t, 'i3-weekly-review-merged-restore');
  await restored.importBundle(JSON.stringify(merged));
  const restoredBundle = await restored.exportBundle();
  assert.doesNotThrow(() => parseBackup(JSON.stringify(restoredBundle)));
  assert.equal(selectGrowthBadges({ ...restoredBundle.data, ledger: restoredBundle.data.xpLedger, feedbacks: restoredBundle.data.questFeedback }).filter((item) => item.sourceType === 'experiment').length, 2);
});

test('a full MAIN day keeps a stable weekly experiment candidate that can be scheduled later', async (t) => {
  const db = await withDatabase(t, 'i3-weekly-review-full');
  for (const [date, requestId] of [['2026-08-11', 'full-week-a'], ['2026-08-13', 'full-week-b']]) {
    const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', date);
    const request = analysisRequest(entry, requestId);
    const job = await db.createDailyAnalysisJob(request);
    await db.markAnalysisJobProcessing(job.id);
    await db.saveDailyAnalysis(job.id, analysisResponse(request));
  }
  const events = (await db.listJournalEvents()).filter((item) => item.sourceType === 'explicit');
  const request = weeklyRequest(events, 'weekly-review-full');
  const job = await db.createWeeklyReviewJob(request);
  await db.markAnalysisJobProcessing(job.id);
  const review = await db.saveWeeklyReview(job.id, weeklyResponse(request));
  const existing = await db.addQuest({
    localDate: '2026-08-20', type: 'main', sourceType: 'manual', title: '已有今日主线',
    reason: '保留用户现有计划', minimumAction: '先做一步', estimatedMinutes: 5, difficulty: 'light',
  });
  const confirmed = await db.confirmWeeklyReview(review.id, review.nextTheme, review.nextExperiment, '2026-08-20');
  assert.equal(confirmed.review.status, 'confirmed');
  assert.equal(confirmed.questCreated, true);
  assert.equal(confirmed.questScheduled, false);
  const capacityCandidate = (await db.listQuests('2026-08-20')).find((item) => item.actionId === `review:${review.id}:experiment`);
  assert.equal(capacityCandidate?.status, 'exempt');
  assert.equal(capacityCandidate?.systemRetiredReason, 'capacity');
  assert.equal(await db.scheduleCapacityQuest(capacityCandidate.id, '2026-08-20'), null);
  const scheduled = await db.scheduleCapacityQuest(capacityCandidate.id, '2026-08-21');
  assert.equal(scheduled?.id, capacityCandidate.id);
  assert.equal(scheduled?.actionId, `review:${review.id}:experiment`);
  assert.equal(scheduled?.status, 'pending');
  await db.feedbackQuest(scheduled.id, 'completed', '完成实验', '留下真实结果', undefined, 0, '2026-08-21');
  const badgeData = await db.exportBundle();
  assert.equal(selectGrowthBadges({ ...badgeData.data, ledger: badgeData.data.xpLedger, feedbacks: badgeData.data.questFeedback }).filter((item) => item.id === `experiment:${review.id}`).length, 1);
  assert.equal((await db.listQuests('2026-08-20')).find((item) => item.id === existing.id)?.status, 'pending');
  assert.equal((await db.listQuests('2026-08-15')).length, 0);
});

test('weekly result is rejected when a selected event changes during the request', async (t) => {
  const db = await withDatabase(t, 'i3-weekly-stale');
  for (const [date, requestId] of [['2026-08-11', 'stale-day-a'], ['2026-08-13', 'stale-day-b']]) {
    const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', date);
    const request = analysisRequest(entry, requestId);
    const job = await db.createDailyAnalysisJob(request);
    await db.markAnalysisJobProcessing(job.id);
    await db.saveDailyAnalysis(job.id, analysisResponse(request));
  }
  const events = (await db.listJournalEvents()).filter((item) => item.sourceType === 'explicit');
  const request = weeklyRequest(events, 'weekly-stale-1');
  const job = await db.createWeeklyReviewJob(request);
  await db.markAnalysisJobProcessing(job.id);
  await db.decideEvent(events[0].id, 'confirmed', { title: '用户核对后的事件' });
  await assert.rejects(() => db.saveWeeklyReview(job.id, weeklyResponse(request)), /旧结果没有应用/);
  assert.equal((await db.listAnalysisJobs('2026-08-14')).find((item) => item.id === job.id).status, 'stale');
  assert.equal((await db.listReviews('weekly')).length, 0);
});

test('weekly source versions reject task undo between preview and queue creation', async (t) => {
  const { db, request, quest } = await weeklyVersionFixture(t, 'weekly-version-create');
  await db.undoQuestFeedback(quest.id);
  await assert.rejects(() => db.createWeeklyReviewJob(request), /来源已改变/);
});

test('weekly source versions stale a queued job after its habit changes', async (t) => {
  const { db, request, habit } = await weeklyVersionFixture(t, 'weekly-version-processing');
  const job = await db.createWeeklyReviewJob(request);
  await db.saveHabit(habit.id, { name: '改过的每日短走' }, '2026-08-14');
  await assert.rejects(() => db.markAnalysisJobProcessing(job.id), /版本已经改变/);
  assert.equal((await db.listAnalysisJobs(request.period.end)).find((item) => item.id === job.id).status, 'stale');
});

test('weekly source versions reject an in-flight result after task feedback is undone', async (t) => {
  const { db, request, quest } = await weeklyVersionFixture(t, 'weekly-version-save');
  const job = await db.createWeeklyReviewJob(request);
  await db.markAnalysisJobProcessing(job.id);
  await db.undoQuestFeedback(quest.id);
  await assert.rejects(() => db.saveWeeklyReview(job.id, weeklyResponse(request)), /旧结果没有应用/);
  assert.equal((await db.listAnalysisJobs(request.period.end)).find((item) => item.id === job.id).status, 'stale');
  assert.equal((await db.listReviews('weekly')).length, 0);
});

test('weekly source versions reject candidate confirmation after its habit changes', async (t) => {
  const { db, request, habit } = await weeklyVersionFixture(t, 'weekly-version-confirm');
  const job = await db.createWeeklyReviewJob(request);
  await db.markAnalysisJobProcessing(job.id);
  const review = await db.saveWeeklyReview(job.id, weeklyResponse(request));
  await db.saveHabit(habit.id, { minimumAction: '走三分钟' }, '2026-08-14');
  await assert.rejects(() => db.confirmWeeklyReview(review.id, review.nextTheme, review.nextExperiment), /来源已改变/);
  assert.equal((await db.listReviews('weekly')).find((item) => item.id === review.id).status, 'candidate');
});

test('weekly source set stales an in-flight result when a new completed task becomes eligible', async (t) => {
  const { db, request } = await weeklyVersionFixture(t, 'weekly-version-new-task');
  const job = await db.createWeeklyReviewJob(request);
  await db.markAnalysisJobProcessing(job.id);
  const added = await db.addQuest({
    localDate: '2026-08-12', type: 'side', sourceType: 'manual', title: '预览后完成的新任务',
    reason: '验证来源集合', minimumAction: '做一步', estimatedMinutes: 5, difficulty: 'light',
  });
  await db.feedbackQuest(added.id, 'completed', '完成', '留下结果', undefined, 0, '2026-08-12');
  await assert.rejects(() => db.saveWeeklyReview(job.id, weeklyResponse(request)), /旧结果没有应用/);
});

test('weekly source set rejects confirmation when a new confirmed memory becomes eligible', async (t) => {
  const { db, request } = await weeklyVersionFixture(t, 'weekly-version-new-memory');
  const job = await db.createWeeklyReviewJob(request);
  await db.markAnalysisJobProcessing(job.id);
  const review = await db.saveWeeklyReview(job.id, weeklyResponse(request));
  const memory = await db.addConfirmedMemory('strength', '我能把复杂任务拆成小步。');
  await patchRawRecord(db, 'memories', memory.id, {
    createdAt: '2026-08-14T08:00:00.000Z', confirmedAt: '2026-08-14T08:00:00.000Z',
  });
  await assert.rejects(() => db.confirmWeeklyReview(review.id, review.nextTheme, review.nextExperiment), /来源已改变/);
});

test('weekly source set rejects confirmation when a new active goal becomes eligible', async (t) => {
  const { db, request } = await weeklyVersionFixture(t, 'weekly-version-new-goal');
  request.permissions.includeGoals = true;
  const job = await db.createWeeklyReviewJob(request);
  await db.markAnalysisJobProcessing(job.id);
  const review = await db.saveWeeklyReview(job.id, weeklyResponse(request));
  const goal = await db.addGoal({ result: '完成一个清晰成果', why: '', evidence: '', nextStep: '先列一步', role: 'main' });
  await patchRawRecord(db, 'goals', goal.id, { createdAt: '2026-08-14T08:00:00.000Z' });
  await assert.rejects(() => db.confirmWeeklyReview(review.id, review.nextTheme, review.nextExperiment), /来源已改变/);
});

test('weekly state source validation is stable when key order opposes observation time order', async (t) => {
  const { db, request } = await weeklyVersionFixture(t, 'weekly-version-state-order');
  const raw = await openRawDatabase(db.name);
  const transaction = raw.transaction('observations', 'readwrite');
  const store = transaction.objectStore('observations');
  store.add({
    id: 'z-earlier-baseline', assessmentId: 'baseline', localDate: '2026-08-10', dimension: 'energy',
    kind: 'user-self-assessment', value: 50, active: true, observedAt: '2026-08-10T08:00:00.000Z',
    createdAt: '2026-08-10T08:00:00.000Z', updatedAt: '2026-08-10T08:00:00.000Z', version: 1,
  });
  store.add({
    id: 'a-later-impact', assessmentId: 'impact', localDate: '2026-08-11', dimension: 'energy',
    kind: 'event-impact', delta: 5, evidenceId: request.context.events[0].eventId, reason: '状态回升', active: true,
    observedAt: '2026-08-11T08:00:00.000Z', createdAt: '2026-08-11T08:00:00.000Z', updatedAt: '2026-08-11T08:00:00.000Z', version: 1,
  });
  await new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
  raw.close();
  const resolved = await db.resolvedStateAtOrBefore('2026-08-11');
  const usedIds = new Set(Object.values(resolved).flatMap((item) => item.observationIds));
  const observations = await db.listStateObservations();
  request.context.stateSnapshots = [{
    localDate: '2026-08-11',
    values: Object.fromEntries(Object.entries(resolved).map(([dimension, value]) => [dimension === 'mind' ? 'mental' : dimension, value.value])),
  }];
  request.context.sourceVersions.stateObservations = observations.filter((item) => usedIds.has(item.id))
    .map((item) => ({ id: item.id, version: item.version }));
  request.permissions.includeStateSnapshots = true;
  const job = await db.createWeeklyReviewJob(request);
  await db.markAnalysisJobProcessing(job.id);
  assert.equal((await db.saveWeeklyReview(job.id, weeklyResponse(request))).status, 'candidate');
});

test('legacy in-flight weekly jobs without source versions become stale instead of applying', async (t) => {
  const { db, request } = await weeklyVersionFixture(t, 'weekly-version-legacy-job');
  const job = await db.createWeeklyReviewJob(request);
  const processing = await db.markAnalysisJobProcessing(job.id);
  const legacyRequest = structuredClone(processing.request);
  delete legacyRequest.context.sourceVersions;
  await patchRawRecord(db, 'analysisJobs', job.id, { request: legacyRequest });
  await assert.rejects(() => db.saveWeeklyReview(job.id, weeklyResponse(request)), /旧结果没有应用/);
  assert.equal((await db.listAnalysisJobs(request.period.end)).find((item) => item.id === job.id).status, 'stale');
});

test('new weekly jobs require source versions even though old backups remain parseable', async (t) => {
  const { db, request } = await weeklyVersionFixture(t, 'weekly-version-required');
  delete request.context.sourceVersions;
  await assert.rejects(() => db.createWeeklyReviewJob(request), /来源已改变/);
});

test('legacy weekly candidates without source versions stay read-only and cannot confirm', async (t) => {
  const { db, request } = await weeklyVersionFixture(t, 'weekly-version-legacy-candidate');
  const job = await db.createWeeklyReviewJob(request);
  await db.markAnalysisJobProcessing(job.id);
  const review = await db.saveWeeklyReview(job.id, weeklyResponse(request));
  const legacyRequest = structuredClone(review.request);
  delete legacyRequest.context.sourceVersions;
  await patchRawRecord(db, 'reviews', review.id, { request: legacyRequest });
  await assert.rejects(() => db.confirmWeeklyReview(review.id, review.nextTheme, review.nextExperiment), /来源已改变/);
  assert.equal((await db.listReviews('weekly')).find((item) => item.id === review.id).status, 'candidate');
});

test('weekly confirmation atomically rejects an experiment ending before its first schedulable day', async (t) => {
  const { db, request } = await weeklyVersionFixture(t, 'weekly-experiment-date');
  const job = await db.createWeeklyReviewJob(request);
  await db.markAnalysisJobProcessing(job.id);
  const review = await db.saveWeeklyReview(job.id, weeklyResponse(request));
  await assert.rejects(
    () => db.confirmWeeklyReview(review.id, review.nextTheme, review.nextExperiment, '2026-08-22'),
    /结束日期早于可安排日期/,
  );
  assert.equal((await db.listReviews('weekly')).find((item) => item.id === review.id).status, 'candidate');
  assert.equal((await db.listQuests()).some((item) => item.actionId === `review:${review.id}:experiment`), false);
  const accepted = await db.confirmWeeklyReview(review.id, review.nextTheme, { ...review.nextExperiment, endDate: '2026-08-22' }, '2026-08-22');
  assert.equal(accepted.review.status, 'confirmed');
  assert.equal(accepted.questScheduled, true);
});

test('an older in-flight weekly review cannot become visible after a newer review finishes', async (t) => {
  const db = await withDatabase(t, 'i3-weekly-order');
  for (const [date, requestId] of [['2026-08-11', 'weekly-order-day-a'], ['2026-08-13', 'weekly-order-day-b']]) {
    const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', date);
    const request = analysisRequest(entry, requestId);
    const job = await db.createDailyAnalysisJob(request);
    await db.markAnalysisJobProcessing(job.id);
    await db.saveDailyAnalysis(job.id, analysisResponse(request));
  }
  const events = (await db.listJournalEvents()).filter((item) => item.sourceType === 'explicit');
  const olderRequest = weeklyRequest(events, 'weekly-order-older');
  const olderJob = await db.createWeeklyReviewJob(olderRequest);
  await db.markAnalysisJobProcessing(olderJob.id);
  const newerRequest = weeklyRequest(events, 'weekly-order-newer');
  const newerJob = await db.createWeeklyReviewJob(newerRequest);
  assert.equal((await db.listAnalysisJobs('2026-08-14')).find((item) => item.id === olderJob.id).status, 'stale');
  await db.markAnalysisJobProcessing(newerJob.id);
  const newer = await db.saveWeeklyReview(newerJob.id, weeklyResponse(newerRequest));
  await assert.rejects(() => db.saveWeeklyReview(olderJob.id, weeklyResponse(olderRequest)), /更新请求取代/);
  assert.deepEqual((await db.listReviews('weekly')).map((item) => item.id), [newer.id]);
});

test('merging duplicate memories stays a candidate and never preserves automatic confirmation', async (t) => {
  const db = await withDatabase(t, 'i3-memory-merge');
  const entries = [];
  for (const [date, requestId] of [['2026-08-12', 'memory-day-a'], ['2026-08-14', 'memory-day-b']]) {
    const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', date);
    entries.push(entry);
    const request = analysisRequest(entry, requestId);
    const job = await db.createDailyAnalysisJob(request);
    await db.markAnalysisJobProcessing(job.id);
    await db.saveDailyAnalysis(job.id, analysisResponse(request));
  }
  const candidates = await db.listMemories('candidate');
  await db.decideMemory(candidates[0].id, 'confirmed');
  await assert.rejects(() => db.mergeMemoryCandidates(candidates, '旧检查结果不应被应用。'), /已经改变/);
  const current = [...await db.listMemories('candidate'), ...await db.listMemories('confirmed')];
  const merged = await db.mergeMemoryCandidates(current, '会议密集后可能需要一段恢复时间。');
  assert.equal(merged.status, 'candidate');
  assert.equal(merged.userEdited, true);
  assert.equal(merged.evidenceIds.length, 2);
  assert.equal((await db.listMemories('forgotten')).length, 1);
  await db.decideMemory(merged.id, 'confirmed');
  assert.equal((await db.listMemories('confirmed')).length, 1);

  const supportingEvents = (await db.listJournalEvents()).filter((item) => merged.evidenceIds.includes(item.id));
  await db.decideEvent(supportingEvents[0].id, 'rejected');
  assert.equal((await db.listMemories('confirmed')).length, 1);
  const replacementRequest = analysisRequest(entries[1], 'memory-day-b-refresh');
  const replacementJob = await db.createDailyAnalysisJob(replacementRequest);
  await db.markAnalysisJobProcessing(replacementJob.id);
  await db.saveDailyAnalysis(replacementJob.id, analysisResponse(replacementRequest));
  assert.equal((await db.listMemories('candidate')).find((item) => item.id === merged.id).status, 'candidate');
  const exportAfterRefresh = await db.exportBundle();
  assert.doesNotThrow(() => parseBackup(JSON.stringify(exportAfterRefresh)));
});

test('I2 defaults are created once with eight areas and six root assets', async (t) => {
  const db = await withDatabase(t, 'i2-defaults');
  await Promise.all([db.ensureI2Defaults(), db.ensureI2Defaults()]);
  const bundle = await db.exportBundle();
  assert.equal(bundle.data.profile.length, 1);
  assert.equal(bundle.data.areas.length, 8);
  assert.equal(bundle.data.branches.length, 6);
  assert.equal(new Set(bundle.data.branches.map((item) => item.rootAsset)).size, 6);
  assert.ok(bundle.data.areas.every((item) => item.mode === 'explore'));
});

test('build areas and active goal roles keep their documented caps', async (t) => {
  const db = await withDatabase(t, 'i2-goal-caps');
  await db.ensureI2Defaults();
  const areas = await db.listAreas();
  const branches = await db.listBranches();
  await db.saveArea(areas[0].id, { mode: 'build' });
  await db.saveArea(areas[1].id, { mode: 'build' });
  await assert.rejects(() => db.saveArea(areas[2].id, { mode: 'build' }), /最多两个/);

  const input = (result, role) => ({
    result, role, why: '值得长期建设', evidence: '形成可验证成果', nextStep: '先做最小一步',
    areaId: areas[0].id, branchId: branches[0].id,
  });
  assert.equal((await db.addGoal(input('主目标', 'main'))).role, 'main');
  assert.equal((await db.addGoal(input('第一个次目标', 'secondary'))).role, 'secondary');
  assert.equal((await db.addGoal(input('第二个次目标', 'secondary'))).role, 'secondary');
  const overflow = await db.addGoal(input('第四个目标', 'secondary'));
  assert.equal(overflow.role, 'wishlist');
  assert.equal(overflow.status, 'idea');
});

test('user-authored companion memory stays editable and can stop proactive reminders without being forgotten', async (t) => {
  const db = await withDatabase(t, 'user-authored-memory');
  const memory = await db.addConfirmedMemory('constraint', '连续会议后不要立刻安排高专注任务。');
  assert.equal(memory.status, 'confirmed');
  assert.deepEqual(memory.evidenceIds, []);
  const muted = await db.setMemoryReminder(memory.id, true);
  assert.equal(muted.reminderMuted, true);
  const edited = await db.decideMemory(memory.id, 'confirmed', '连续会议后先留十分钟恢复时间。');
  assert.equal(edited.statement, '连续会议后先留十分钟恢复时间。');
  assert.equal(edited.reminderMuted, true);
  const backup = await db.exportBundle();
  assert.doesNotThrow(() => parseBackup(JSON.stringify(backup)));
  assert.equal((await db.listMemories('confirmed'))[0].status, 'confirmed');
});

test('a goal can start from one sentence while optional context stays editable', async (t) => {
  const db = await withDatabase(t, 'minimal-goal');
  await db.ensureI2Defaults();
  const [areas, branches] = await Promise.all([db.listAreas(), db.listBranches()]);
  const goal = await db.addGoal({
    result: '完成第一次公开分享', why: '', evidence: '', nextStep: '先写三个要点',
    role: 'main',
  });
  assert.equal(goal.areaId, areas.at(0).id);
  assert.equal(goal.branchId, branches.at(0).id);
  assert.equal(goal.why, '');
  assert.equal(goal.evidence, '');
  assert.equal((await db.saveGoal(goal.id, { why: '记录真实经验' })).why, '记录真实经验');
  const backup = parseBackup(JSON.stringify(await db.exportBundle())).data.goals[0];
  assert.equal(backup.evidence, '');
});

test('goals and habits can be edited or paused without deleting their history', async (t) => {
  const db = await withDatabase(t, 'i2-edit-pause');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '旧结果', why: '真实原因', evidence: '真实证据', nextStep: '旧下一步',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const updatedGoal = await db.saveGoal(goal.id, { result: '新结果', nextStep: '新下一步', status: 'completed' });
  assert.equal(updatedGoal.result, '新结果');
  assert.equal(updatedGoal.status, 'completed');
  assert.ok(updatedGoal.completedAt);
  assert.ok(updatedGoal.completedDate);
  const stillCompleted = await db.saveGoal(goal.id, { why: '完成后的补充说明' });
  assert.equal(stillCompleted.completedAt, updatedGoal.completedAt);
  assert.equal(stillCompleted.completedDate, updatedGoal.completedDate);
  const reopenedGoal = await db.saveGoal(goal.id, { status: 'paused' });
  assert.equal(reopenedGoal.completedAt, undefined);
  assert.equal(reopenedGoal.completedDate, undefined);
  assert.ok((await db.saveGoal(goal.id, { status: 'completed' })).completedAt);
  assert.equal((await db.addGoal({
    result: '新主目标', why: '继续建设', evidence: '新证据', nextStep: '先做一步',
    areaId: area.id, branchId: branch.id, role: 'main',
  })).role, 'main');

  const habit = await db.addHabit({
    name: '散步', minimumAction: '走两分钟', scheduleDays: [5], dimension: 'energy',
    branchId: branch.id, difficulty: 'light', bonusEnabled: true,
  });
  await db.saveHabit(habit.id, { name: '晚饭后散步', status: 'paused' });
  assert.equal((await db.listHabits())[0].name, '晚饭后散步');
  assert.equal((await db.ensureTodayBonusQuests('2026-08-14')).length, 0);
  const lifecycleBackup = await db.exportBundle();
  assert.doesNotThrow(() => parseBackup(JSON.stringify(lifecycleBackup)));
  const legacyGoalBackup = structuredClone(lifecycleBackup);
  const legacyCompletedGoal = legacyGoalBackup.data.goals.find((item) => item.id === goal.id);
  legacyCompletedGoal.completedAt = '2026-08-13T16:30:00.000Z';
  legacyCompletedGoal.updatedAt = legacyCompletedGoal.completedAt;
  delete legacyCompletedGoal.completedDate;
  legacyGoalBackup.data.profile[0].timezone = 'Asia/Shanghai';
  const migratedGoal = parseBackup(JSON.stringify(legacyGoalBackup)).data.goals.find((item) => item.id === goal.id);
  assert.equal(migratedGoal.completedAt, '2026-08-13T16:30:00.000Z');
  assert.equal(migratedGoal.completedDate, '2026-08-14');
  assert.equal(parseBackup(JSON.stringify(parseBackup(JSON.stringify(legacyGoalBackup)))).data.goals.find((item) => item.id === goal.id).completedDate, '2026-08-14');
});

test('goal status transitions close related pending tasks', async (t) => {
  const db = await withDatabase(t, 'i2-goal-close-tasks');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '形成真实作品', why: '可验证成果', evidence: '真实输出', nextStep: '先写提纲',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const mainQuest = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id, branchId: branch.id,
    title: '写下第一版', reason: '完成目标下一步', minimumAction: '用十分钟快速起草', estimatedMinutes: 20,
    difficulty: 'standard',
  });
  const sideQuest = await db.addQuest({
    localDate: '2026-08-15', type: 'side', sourceType: 'goal', sourceId: goal.id, branchId: branch.id,
    title: '补充结构', reason: '避免重复', minimumAction: '列三条论点', estimatedMinutes: 15,
    difficulty: 'standard',
  });
  const unrelated = await db.addQuest({
    localDate: '2026-08-14', type: 'side', sourceType: 'manual',
    title: '独立任务', reason: '不应受目标状态影响', minimumAction: '先处理', estimatedMinutes: 10,
    difficulty: 'light',
  });

  await db.saveGoal(goal.id, { status: 'paused' });
  const quests = await db.listQuests('2026-08-14');
  const closedMain = quests.find((item) => item.id === mainQuest.id);
  const untouched = quests.find((item) => item.id === unrelated.id);
  assert.equal(closedMain?.status, 'exempt');
  assert.equal(closedMain?.systemRetiredReason, 'source-invalidated');
  assert.equal(untouched?.status, 'pending');

  const nextDayQuests = await db.listQuests('2026-08-15');
  const closedSide = nextDayQuests.find((item) => item.id === sideQuest.id);
  assert.equal(closedSide?.status, 'exempt');
  assert.equal(closedSide?.systemRetiredReason, 'source-invalidated');
});

test('wishlist or idea goals leave the action surface and cannot restore capacity candidates', async (t) => {
  const db = await withDatabase(t, 'goal-actionable-boundary');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '发布一份作品', why: '', evidence: '', nextStep: '先列提纲', areaId: area.id, branchId: branch.id, role: 'main',
  });
  const pending = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id, branchId: branch.id,
    title: '列提纲', reason: '目标下一步', minimumAction: '列三个点', estimatedMinutes: 10, difficulty: 'light',
  });
  const capacity = await db.addQuest({
    localDate: '2026-08-15', type: 'main', sourceType: 'goal', sourceId: goal.id, branchId: branch.id,
    title: '写初稿', reason: '容量候选', minimumAction: '写一句', estimatedMinutes: 10, difficulty: 'light',
  });
  await patchRawRecord(db, 'quests', capacity.id, {
    status: 'exempt', systemRetiredAt: '2026-08-14T08:00:00.000Z', systemRetiredReason: 'capacity',
  });

  await db.saveGoal(goal.id, { role: 'wishlist' });
  const retired = (await db.listQuests()).find((item) => item.id === pending.id);
  assert.equal(retired.status, 'exempt');
  assert.equal(retired.systemRetiredReason, 'source-invalidated');
  assert.equal(await db.scheduleCapacityQuest(capacity.id, '2026-08-16'), null);

  await db.saveGoal(goal.id, { role: 'main', status: 'active' });
  const ideaPending = await db.addQuest({
    localDate: '2026-08-17', type: 'main', sourceType: 'goal', sourceId: goal.id, branchId: branch.id,
    title: '继续初稿', reason: '目标下一步', minimumAction: '再写一句', estimatedMinutes: 10, difficulty: 'light',
  });
  await db.saveGoal(goal.id, { status: 'idea' });
  assert.equal((await db.listQuests()).find((item) => item.id === ideaPending.id).systemRetiredReason, 'source-invalidated');
});

test('confirmed replanning preserves history and retires the old action path atomically', async (t) => {
  const db = await withDatabase(t, 'goal-replan');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '发布作品', why: '积累真实成果', evidence: '公开链接', nextStep: '一次写完整稿',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const oldMilestone = await db.addMilestone(goal.id, '一次完成初稿', '保存完整初稿');
  const oldQuest = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id, milestoneId: oldMilestone.id, branchId: branch.id,
    title: '一次写完', reason: '旧计划', minimumAction: '先写一小时', estimatedMinutes: 60, difficulty: 'hard',
  });

  const replaced = await db.replaceGoalPlan(goal.id, {
    result: '分两次完成并发布作品', evidence: '公开链接和校对记录', nextStep: '先列三个要点',
  }, [
    { description: '完成结构', evidence: '三个要点齐全' },
    { description: '发布校对稿', evidence: '留下公开链接' },
  ], goal.version);

  assert.equal(replaced.goal.nextStep, '先列三个要点');
  assert.equal(replaced.milestones.length, 2);
  assert.equal((await db.listMilestones(goal.id)).find((item) => item.id === oldMilestone.id)?.status, 'superseded');
  assert.equal((await db.listQuests('2026-08-14')).find((item) => item.id === oldQuest.id)?.status, 'exempt');
  await assert.rejects(() => db.completeMilestone(oldMilestone.id), /新计划替换/);
  await assert.rejects(() => db.replaceGoalPlan(goal.id, {
    result: '过期草案', evidence: '不应覆盖', nextStep: '不应执行',
  }, [
    { description: '旧步骤一', evidence: '旧证据一' },
    { description: '旧步骤二', evidence: '旧证据二' },
  ], goal.version), /目标已经改变/);
});

test('task feedback is atomic, editable, undoable, and XP stays idempotent', async (t) => {
  const db = await withDatabase(t, 'i2-feedback');
  await db.ensureI2Defaults();
  const branch = (await db.listBranches())[0];
  const quest = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'manual', title: '完成困难行动',
    reason: '推进真实目标', minimumAction: '先专注十分钟', estimatedMinutes: 45,
    difficulty: 'hard', branchId: branch.id, actionId: 'same-real-action',
  });

  await db.feedbackQuest(quest.id, 'completed', '完成了', '产出一份结果');
  assert.deepEqual(await db.branchProgress(branch.id), { totalXp: 20, level: 1, currentXp: 0, nextLevelXp: 30 });
  await db.feedbackQuest(quest.id, 'partial', '只完成一部分', '完成最小动作');
  assert.equal((await db.branchProgress(branch.id)).totalXp, 10);
  assert.equal((await db.listXpLedger(branch.id)).filter((item) => !item.reversedAt).length, 1);

  await db.undoQuestFeedback(quest.id);
  assert.equal((await db.branchProgress(branch.id)).totalXp, 0);
  assert.equal((await db.listQuests('2026-08-14'))[0].status, 'pending');

  await db.feedbackQuest(quest.id, 'completed');
  const duplicate = await db.addQuest({
    localDate: '2026-08-14', type: 'side', sourceType: 'manual', title: '同一行动的另一种呈现',
    reason: '验证不重复结算', minimumAction: '确认结果', estimatedMinutes: 5,
    difficulty: 'challenge', branchId: branch.id, actionId: 'same-real-action',
  });
  await db.feedbackQuest(duplicate.id, 'completed');
  assert.equal((await db.branchProgress(branch.id)).totalXp, 20);
});

test('confirmed task effects form a clamped and undoable state ledger', async (t) => {
  const db = await withDatabase(t, 'i2-state-ledger');
  await db.ensureI2Defaults();
  await db.saveAssessment({ energy: 50 }, '2026-08-13');
  const common = {
    localDate: '2026-08-14', sourceType: 'manual', reason: '验证状态明细', minimumAction: '做一步',
    estimatedMinutes: 10, difficulty: 'light', dimension: 'energy',
  };
  const first = await db.addQuest({ ...common, type: 'main', title: '消耗体力的行动' });
  const second = await db.addQuest({ ...common, type: 'side', title: '另一项消耗' });
  await db.feedbackQuest(first.id, 'completed', '', '', undefined, -12, '2026-08-14');
  await db.feedbackQuest(second.id, 'completed', '', '', undefined, -10, '2026-08-14');
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).energy.value, 35);
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).energy.clamped, true);

  await db.feedbackQuest(second.id, 'partial', '', '', undefined, 5, '2026-08-14');
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).energy.value, 43);
  await db.undoQuestFeedback(first.id);
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).energy.value, 55);
  const ledger = await db.listStateObservations('energy');
  assert.equal(ledger.filter((item) => item.kind === 'event-impact' && item.active).length, 1);
  assert.equal(ledger.filter((item) => item.kind === 'event-impact' && !item.active).length, 2);
});

test('pending daily quests never exceed one main, three BONUS, and two side quests', async (t) => {
  const db = await withDatabase(t, 'i2-quest-caps');
  await db.ensureI2Defaults();
  const common = { localDate: '2026-08-14', sourceType: 'manual', reason: '手动安排', minimumAction: '做一步', estimatedMinutes: 10, difficulty: 'light' };
  await assert.rejects(() => db.addQuest({ ...common, type: 'main', title: '过长行动标识', actionId: 'x'.repeat(181) }), /现实行动 ID/);
  await db.addQuest({ ...common, type: 'main', title: '主线' });
  await assert.rejects(() => db.addQuest({ ...common, type: 'main', title: '额外主线' }), /达到上限/);
  for (let index = 0; index < 3; index += 1) await db.addQuest({ ...common, type: 'bonus', title: `BONUS ${index}` });
  await assert.rejects(() => db.addQuest({ ...common, type: 'bonus', title: '额外 BONUS' }), /达到上限/);
  for (let index = 0; index < 2; index += 1) await db.addQuest({ ...common, type: 'side', title: `支线 ${index}` });
  await assert.rejects(() => db.addQuest({ ...common, type: 'side', title: '额外支线' }), /达到上限/);
  assert.deepEqual((await db.listQuests('2026-08-14')).map((item) => item.type), ['main', 'bonus', 'bonus', 'bonus', 'side', 'side']);
});

test('overdue pending actions stay user-decided and late XP uses the real completion date', async (t) => {
  const db = await withDatabase(t, 'i2-overdue-actions');
  await db.ensureI2Defaults();
  await db.saveAssessment({ energy: 50 }, '2026-08-14');
  const branch = (await db.listBranches())[0];
  const quest = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'manual', branchId: branch.id,
    title: '晚完成的行动', reason: '验证跨日处理', minimumAction: '做五分钟', estimatedMinutes: 5,
    difficulty: 'standard', dimension: 'energy',
  });
  assert.deepEqual((await db.listPendingBefore('2026-08-15')).map((item) => item.id), [quest.id]);
  await db.feedbackQuest(quest.id, 'completed', '', '', undefined, 5, '2026-08-15');
  assert.equal((await db.listPendingBefore('2026-08-15')).length, 0);
  assert.equal((await db.listQuestFeedback(quest.id))[0].completedDate, '2026-08-15');
  assert.equal((await db.listXpLedger(branch.id))[0].localDate, '2026-08-15');
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-14')).energy.value, 50);
  assert.equal((await db.resolvedStateAtOrBefore('2026-08-15')).energy.value, 55);
  assert.equal((await db.listStateObservations('energy')).find((item) => item.kind === 'event-impact')?.localDate, '2026-08-15');
});

test('pending quests can be shrunk, replaced, or moved without bypassing daily caps', async (t) => {
  const db = await withDatabase(t, 'i2-adjust-quest');
  await db.ensureI2Defaults();
  const quest = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'manual', title: '原行动', reason: '原理由',
    minimumAction: '做二十分钟', estimatedMinutes: 20, difficulty: 'standard',
  });
  const adjusted = await db.savePendingQuest(quest.id, {
    localDate: '2026-08-15', title: '更适合的行动', minimumAction: '只做五分钟', estimatedMinutes: 5, difficulty: 'light',
    deadlineAt: '2026-08-15T12:00:00.000Z',
  });
  assert.deepEqual({ date: adjusted.localDate, title: adjusted.title, minutes: adjusted.estimatedMinutes, modified: adjusted.userModified }, {
    date: '2026-08-15', title: '更适合的行动', minutes: 5, modified: true,
  });
  assert.equal(adjusted.deadlineAt, '2026-08-15T12:00:00.000Z');
  await db.addQuest({
    localDate: '2026-08-16', type: 'main', sourceType: 'manual', title: '已有主线', reason: '占用当天名额',
    minimumAction: '做一步', estimatedMinutes: 5, difficulty: 'light',
  });
  await assert.rejects(() => db.savePendingQuest(quest.id, { localDate: '2026-08-16' }), /达到上限/);
  await db.feedbackQuest(quest.id, 'completed');
  await assert.rejects(() => db.savePendingQuest(quest.id, { title: '完成后不能改' }), /只有待完成任务/);
});

test('only user-enabled habits create BONUS quests and momentum does not reset after a miss', async (t) => {
  const db = await withDatabase(t, 'i2-habits');
  await db.ensureI2Defaults();
  const branch = (await db.listBranches())[0];
  const makeHabit = (name, bonusEnabled = true) => db.addHabit({
    name, minimumAction: '做两分钟', scheduleDays: [1, 2, 3, 4, 5, 6, 7],
    dimension: 'energy', branchId: branch.id, difficulty: 'light', bonusEnabled,
  }, '2026-08-08');
  const habit = await makeHabit('散步');
  await makeHabit('拉伸');
  await makeHabit('早睡');
  await assert.rejects(() => makeHabit('第四个启用习惯'), /最多三个/);
  await makeHabit('未启用的候选', false);

  for (const [date, result] of [
    ['2026-08-08', 'partial'], ['2026-08-09', 'completed'], ['2026-08-10', 'skipped'],
    ['2026-08-11', 'completed'], ['2026-08-12', 'exempt'], ['2026-08-13', 'partial'],
  ]) {
    await db.ensureTodayBonusQuests(date);
    const quest = (await db.listQuests(date)).find((item) => item.sourceId === habit.id);
    await db.feedbackQuest(quest.id, result);
  }
  assert.equal((await db.ensureTodayBonusQuests('2026-08-14')).length, 3);
  assert.equal((await db.ensureTodayBonusQuests('2026-08-14')).length, 0);
  const first = (await db.listQuests('2026-08-14')).find((item) => item.sourceId === habit.id);
  await db.feedbackQuest(first.id, 'completed');
  assert.equal(await db.habitMomentum(habit.id, '2026-08-14'), 3.3);
});

test('overdue habit BONUS stays user-decided and accepts a real late completion or no-penalty exemption', async (t) => {
  const db = await withDatabase(t, 'i2-bonus-elapsed');
  await db.ensureI2Defaults();
  const branch = (await db.listBranches())[0];
  const habit = await db.addHabit({
    name: '每日拉伸', minimumAction: '拉伸两分钟', scheduleDays: [1, 2, 3, 4, 5, 6, 7],
    dimension: 'energy', branchId: branch.id, difficulty: 'light', bonusEnabled: true,
  }, '2026-08-14');
  const first = (await db.ensureTodayBonusQuests('2026-08-14'))[0];
  assert(first);
  assert.deepEqual((await db.listPendingBefore('2026-08-15')).map((item) => item.id), [first.id]);

  const next = (await db.ensureTodayBonusQuests('2026-08-15'))[0];
  const overdue = (await db.listQuests('2026-08-14')).find((item) => item.id === first.id);
  assert.equal(overdue?.status, 'pending');
  assert.equal(overdue?.systemRetiredReason, undefined);
  assert.equal(next?.sourceId, habit.id);
  assert.equal(next?.status, 'pending');
  await db.feedbackQuest(first.id, 'completed', '今天补记', '昨天实际拉伸了两分钟', undefined, 0, '2026-08-14');
  assert.equal((await db.listQuestFeedback(first.id)).find((item) => !item.undoneAt)?.completedDate, '2026-08-14');
  assert.equal((await db.listHabitLogs(habit.id)).find((item) => item.questId === first.id)?.result, 'completed');
  assert.equal((await db.listXpLedger(branch.id)).find((item) => item.sourceId === first.id)?.localDate, '2026-08-14');

  await db.feedbackQuest(next.id, 'exempt', '今天现实条件不适合，主动放下', '', undefined, 0, '2026-08-15');
  assert.equal((await db.listHabitLogs(habit.id)).find((item) => item.questId === next.id)?.result, 'exempt');
  assert.equal((await db.listXpLedger(branch.id)).filter((item) => item.sourceId === next.id).length, 0);
  assert.deepEqual(await db.listPendingBefore('2026-08-16'), []);
  assert.equal((await db.ensureTodayBonusQuests('2026-08-16'))[0]?.sourceId, habit.id);
  const backup = await db.exportBundle();
  assert.doesNotThrow(() => parseBackup(JSON.stringify(backup)));
});

test('habit momentum follows effective schedule history without backfilling creation, pause, or ended dates', async (t) => {
  const db = await withDatabase(t, 'i2-habit-history');
  await db.ensureI2Defaults();
  const branch = (await db.listBranches())[0];
  const habit = await db.addHabit({
    name: '按历史计算', minimumAction: '做两分钟', scheduleDays: [6, 7],
    dimension: 'energy', branchId: branch.id, difficulty: 'light', bonusEnabled: true,
  }, '2026-08-08');
  assert.equal((await db.ensureTodayBonusQuests('2026-08-07')).length, 0, 'creation must be the first tracked date');

  const settle = async (date, result) => {
    await db.ensureTodayBonusQuests(date);
    const quest = (await db.listQuests(date)).find((item) => item.sourceId === habit.id && item.status === 'pending');
    assert(quest, `${date} should be scheduled by the rule effective that day`);
    await db.feedbackQuest(quest.id, result, '', '', undefined, 0, date);
  };
  await settle('2026-08-08', 'completed');
  await settle('2026-08-09', 'skipped');
  await db.saveHabit(habit.id, { scheduleDays: [1, 2] }, '2026-08-10');
  await settle('2026-08-10', 'completed');
  assert.equal(await db.habitMomentum(habit.id, '2026-08-10'), 3.3, 'weekend history must survive a weekday frequency change');

  await db.ensureTodayBonusQuests('2026-08-11');
  await db.saveHabit(habit.id, { status: 'paused' }, '2026-08-11');
  const pausedQuest = (await db.listQuests('2026-08-11')).find((item) => item.sourceId === habit.id);
  assert.equal(pausedQuest?.status, 'exempt');
  assert.equal(pausedQuest?.systemRetiredReason, 'tracking-disabled');
  assert.equal(await db.habitMomentum(habit.id, '2026-08-17'), 3.3, 'paused dates must not dilute prior momentum');

  await db.saveHabit(habit.id, { status: 'active' }, '2026-08-18');
  await settle('2026-08-18', 'completed');
  assert.equal(await db.habitMomentum(habit.id, '2026-08-18'), 3.8, 'tracking resumes only from its effective date');
  await db.ensureTodayBonusQuests('2026-08-24');
  await db.saveHabit(habit.id, { scheduleDays: [3] }, '2026-08-19');
  const frequencyRetired = (await db.listQuests('2026-08-24')).find((item) => item.sourceId === habit.id);
  assert.equal(frequencyRetired?.status, 'exempt');
  assert.equal(frequencyRetired?.systemRetiredReason, 'schedule-changed');
  assert.equal((await db.listQuestFeedback(frequencyRetired.id)).length, 0);
  await settle('2026-08-19', 'skipped');
  assert.equal(await db.habitMomentum(habit.id, '2026-08-19'), 3, 'new frequency must not rewrite results under the old frequency');

  await db.ensureTodayBonusQuests('2026-08-26');
  await db.saveHabit(habit.id, { bonusEnabled: false }, '2026-08-26');
  assert.equal((await db.listQuests('2026-08-26')).find((item) => item.sourceId === habit.id)?.systemRetiredReason, 'tracking-disabled');
  await db.saveHabit(habit.id, { bonusEnabled: true, scheduleDays: [1, 2, 3, 4, 5, 6, 7] }, '2026-08-27');
  await db.ensureTodayBonusQuests('2026-08-27');
  await db.saveHabit(habit.id, { status: 'ended' }, '2026-08-27');
  assert.equal((await db.listQuests('2026-08-27')).find((item) => item.sourceId === habit.id)?.systemRetiredReason, 'tracking-disabled');
  assert.equal(await db.habitMomentum(habit.id, '2026-09-30'), 3, 'ending must preserve the last active momentum indefinitely');

  const backup = JSON.parse(JSON.stringify(await db.exportBundle()));
  const invalidHistory = structuredClone(backup);
  invalidHistory.data.habits[0].scheduleHistory[0].trackingEnabled = 'yes';
  assert.throws(() => parseBackup(JSON.stringify(invalidHistory)), /习惯计划历史/);
  const restored = await withDatabase(t, 'i2-habit-history-restore');
  await restored.importBundle(JSON.stringify(backup));
  assert.deepEqual((await restored.exportBundle()).data, backup.data);
  assert.equal(await restored.habitMomentum(habit.id, '2026-09-30'), 3);

  const legacy = structuredClone(backup);
  delete legacy.data.habits[0].scheduleHistory;
  legacy.data.habits[0].status = 'paused';
  legacy.data.habits[0].bonusEnabled = true;
  assert.doesNotThrow(() => parseBackup(JSON.stringify(legacy)));
  const legacyDb = await withDatabase(t, 'i2-habit-history-legacy');
  await legacyDb.importBundle(JSON.stringify(legacy));
  assert.equal(await legacyDb.habitMomentum(habit.id, '2026-09-30'), 0);
  assert.equal((await legacyDb.ensureTodayBonusQuests('2026-09-30')).length, 0);
});

test('a milestone adds 50 XP once and undo reverses it', async (t) => {
  const db = await withDatabase(t, 'i2-milestone');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '发布一个作品', why: '形成创造杠杆', evidence: '公开链接', nextStep: '完成草稿',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const milestone = await db.addMilestone(goal.id, '完成可公开版本', '有真实链接');
  await db.completeMilestone(milestone.id, '2026-08-14');
  await db.completeMilestone(milestone.id, '2026-08-14');
  assert.equal((await db.branchProgress(branch.id)).totalXp, 50);
  await db.undoMilestone(milestone.id);
  assert.equal((await db.branchProgress(branch.id)).totalXp, 0);
  await db.completeMilestone(milestone.id, '2026-08-15');
  const ledger = (await db.listXpLedger(branch.id)).filter((item) => item.sourceType === 'milestone' && item.sourceId === milestone.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].reversedAt, undefined);
  assert.equal(ledger[0].localDate, '2026-08-15');
  assert.equal((await db.branchProgress(branch.id)).totalXp, 50);
});

test('a completed goal action creates one next-milestone quest without duplicating it', async (t) => {
  const db = await withDatabase(t, 'i2-goal-follow-up');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '完成公开作品', why: '留下真实成果', evidence: '公开链接', nextStep: '先完成结构',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const firstMilestone = await db.addMilestone(goal.id, '完成结构', '有三个清晰要点');
  const milestone = await db.addMilestone(goal.id, '完成可校对初稿', '有一份完整初稿');
  const quest = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id, milestoneId: firstMilestone.id, branchId: branch.id,
    title: '先完成结构', reason: '降低开始成本', minimumAction: '列三个要点', completionCriteria: firstMilestone.evidence, estimatedMinutes: 10, difficulty: 'light',
  });
  await db.feedbackQuest(quest.id, 'completed', '', '', undefined, 0, '2026-08-14');
  const progression = await db.createGoalFollowUpQuest(quest.id, '2026-08-14');
  assert.equal(progression.followUp?.actionId, `goal:${goal.id}:after:${quest.id}:milestone:${milestone.id}`);
  assert.equal(progression.followUp?.milestoneId, milestone.id);
  assert.equal(progression.followUp?.type, 'main');
  assert.equal(progression.milestoneCompleted?.id, firstMilestone.id);
  assert.equal((await db.listGoals()).find((item) => item.id === goal.id)?.nextStep, progression.followUp?.title);
  assert.equal((await db.listMilestones(goal.id)).find((item) => item.id === firstMilestone.id)?.status, 'completed');
  assert.equal((await db.createGoalFollowUpQuest(quest.id, '2026-08-14')).followUp, null);
  assert.equal((await db.listQuests('2026-08-14')).filter((item) => item.status === 'pending').length, 1);
  assert.equal((await db.branchProgress(branch.id)).totalXp, 55);
  const backup = JSON.parse(JSON.stringify(await db.exportBundle()));
  assert.doesNotThrow(() => parseBackup(JSON.stringify(backup)));
  const restored = await withDatabase(t, 'i2-goal-follow-up-restore');
  await restored.importBundle(JSON.stringify(backup));
  assert.deepEqual((await restored.exportBundle()).data, backup.data);

  await db.feedbackQuest(quest.id, 'partial', '还差一点', '保留已有结构', undefined, 0, '2026-08-15');
  assert.equal((await db.listMilestones(goal.id)).find((item) => item.id === firstMilestone.id)?.status, 'pending');
  assert.equal((await db.listQuests()).find((item) => item.id === progression.followUp?.id)?.status, 'exempt');
  assert.equal((await db.listXpLedger(branch.id)).find((item) => item.sourceType === 'milestone' && item.sourceId === firstMilestone.id)?.reversedAt !== undefined, true);
  const partialProgression = await db.createGoalFollowUpQuest(quest.id, '2026-08-15', 'partial');
  assert.equal(partialProgression.followUp?.milestoneId, firstMilestone.id);
  assert.equal(partialProgression.followUp?.status, 'pending');

  await db.feedbackQuest(quest.id, 'completed', '补完了', '结构已经可检查', undefined, 0, '2026-08-16');
  assert.equal((await db.listQuests()).find((item) => item.id === partialProgression.followUp?.id)?.status, 'exempt');
  const editedBack = await db.createGoalFollowUpQuest(quest.id, '2026-08-16');
  assert.equal(editedBack.milestoneCompleted?.id, firstMilestone.id);
  assert.equal(editedBack.followUp?.id, progression.followUp?.id, 'redo should restore the existing derived action');
  assert.equal(editedBack.followUp?.status, 'pending');
  assert.equal(editedBack.followUp?.localDate, '2026-08-16');
  assert.equal((await db.listQuests()).filter((item) => item.predecessorQuestId === quest.id && item.status === 'pending').length, 1);
  assert.equal((await db.listXpLedger(branch.id)).filter((item) => item.sourceType === 'milestone' && item.sourceId === firstMilestone.id).length, 1);

  for (const [result, changedDate, redoDate] of [
    ['skipped', '2026-08-18', '2026-08-19'],
    ['exempt', '2026-08-20', '2026-08-21'],
  ]) {
    await db.feedbackQuest(quest.id, result, '', '', undefined, 0, changedDate);
    assert.equal((await db.listMilestones(goal.id)).find((item) => item.id === firstMilestone.id)?.status, 'pending');
    assert.equal((await db.listQuests()).find((item) => item.id === progression.followUp?.id)?.status, 'exempt');
    await db.feedbackQuest(quest.id, 'completed', '', '', undefined, 0, redoDate);
    const restoredAgain = await db.createGoalFollowUpQuest(quest.id, redoDate);
    assert.equal(restoredAgain.followUp?.id, progression.followUp?.id);
    assert.equal(restoredAgain.followUp?.status, 'pending');
    assert.equal((await db.listXpLedger(branch.id)).filter((item) => item.sourceType === 'milestone' && item.sourceId === firstMilestone.id).length, 1);
  }

  await db.undoQuestFeedback(quest.id);
  assert.equal((await db.listMilestones(goal.id)).find((item) => item.id === firstMilestone.id)?.status, 'pending');
  assert.equal((await db.listQuests()).find((item) => item.id === progression.followUp?.id)?.status, 'exempt');
  assert.equal((await db.listGoals()).find((item) => item.id === goal.id)?.nextStep, quest.title);
  assert.equal((await db.branchProgress(branch.id)).totalXp, 0);
  await db.feedbackQuest(quest.id, 'completed', '', '', undefined, 0, '2026-08-22');
  const redone = await db.createGoalFollowUpQuest(quest.id, '2026-08-22');
  assert.equal(redone.milestoneCompleted?.id, firstMilestone.id);
  assert.equal(redone.followUp?.id, progression.followUp?.id);
  assert.equal(redone.followUp?.status, 'pending');
  const milestoneLedger = (await db.listXpLedger(branch.id)).filter((item) => item.sourceType === 'milestone' && item.sourceId === firstMilestone.id);
  assert.equal(milestoneLedger.length, 1);
  assert.equal(milestoneLedger[0].reversedAt, undefined);
  assert.equal(milestoneLedger[0].localDate, '2026-08-22');
  assert.equal((await db.listGoals()).find((item) => item.id === goal.id)?.nextStep, redone.followUp?.title);
  assert.equal((await db.branchProgress(branch.id)).totalXp, 55);
});

test('one atomic feedback call keeps quest and milestone dates on the same settlement day', async (t) => {
  const db = await withDatabase(t, 'i2-atomic-goal-feedback-date');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '交付一个可检查版本', why: '验证原子推进', evidence: '有成品', nextStep: '先做结构',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const firstMilestone = await db.addMilestone(goal.id, '完成结构', '结构可检查');
  await db.addMilestone(goal.id, '完成成品', '成品可检查');
  const quest = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id,
    milestoneId: firstMilestone.id, branchId: branch.id, title: '先做结构', reason: '开始推进',
    minimumAction: '列三个要点', completionCriteria: firstMilestone.evidence, estimatedMinutes: 10, difficulty: 'light',
  });

  const settled = await db.feedbackAndProgressQuest(quest.id, 'completed', '完成', '结构已写好', undefined, 0, '2026-08-15');
  assert.equal(settled.feedback.completedDate, '2026-08-15');
  assert.equal(settled.milestoneCompleted?.id, firstMilestone.id);
  assert.equal(settled.followUp?.status, 'pending');
  const firstCompletion = (await db.listMilestones(goal.id)).find((item) => item.id === firstMilestone.id);
  const noteOnly = await db.feedbackAndProgressQuest(quest.id, 'completed', '只修改备注', '结构已写好');
  assert.equal(noteOnly.feedback.completedDate, '2026-08-15');
  assert.equal((await db.listMilestones(goal.id)).find((item) => item.id === firstMilestone.id)?.completedAt, firstCompletion?.completedAt);

  await db.feedbackAndProgressQuest(quest.id, 'completed', '日期核对', '结构已写好', undefined, 0, '2026-08-17');
  const settlementLedger = (await db.listXpLedger(branch.id)).filter((item) => item.sourceId === quest.id || item.sourceId === firstMilestone.id);
  assert.equal(settlementLedger.length, 2, 'note/date edits reuse the unique quest and milestone settlement facts');
  assert.ok(settlementLedger.every((item) => item.localDate === '2026-08-17' && !item.reversedAt));
  const movedMilestone = (await db.listMilestones(goal.id)).find((item) => item.id === firstMilestone.id);
  assert.ok((movedMilestone?.version ?? 0) > (firstCompletion?.version ?? 0));
  assert.equal((await db.listQuestFeedback(quest.id)).filter((item) => !item.undoneAt)[0].completedDate, '2026-08-17');
  await db.feedbackQuest(quest.id, 'completed', '兼容入口也改日期', '结构已写好', undefined, 0, '2026-08-18');
  const compatibilityLedger = (await db.listXpLedger(branch.id)).filter((item) => item.sourceId === quest.id || item.sourceId === firstMilestone.id);
  assert.equal(compatibilityLedger.length, 2);
  assert.ok(compatibilityLedger.every((item) => item.localDate === '2026-08-18' && !item.reversedAt));
  assert.ok(((await db.listMilestones(goal.id)).find((item) => item.id === firstMilestone.id)?.version ?? 0) > (movedMilestone?.version ?? 0));
  assert.equal((await db.branchProgress(branch.id)).totalXp, 55);
});

test('goal progression failure aborts feedback, XP, and milestone writes together', async (t) => {
  const source = await withDatabase(t, 'i2-atomic-abort-source');
  await source.ensureI2Defaults();
  const area = (await source.listAreas())[0];
  const branch = (await source.listBranches())[0];
  const goal = await source.addGoal({
    result: '验证事务回滚', why: '', evidence: '没有半完成事实', nextStep: '第一步',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const firstMilestone = await source.addMilestone(goal.id, '第一步', '第一步证据');
  await source.addMilestone(goal.id, '第二步', '第二步证据');
  const quest = await source.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id, milestoneId: firstMilestone.id,
    branchId: branch.id, title: '第一步', reason: '触发推进', minimumAction: '做一步', estimatedMinutes: 5, difficulty: 'light',
  });
  const backup = JSON.parse(JSON.stringify(await source.exportBundle()));
  const longGoalId = `goal-${'x'.repeat(170)}`;
  backup.data.goals.find((item) => item.id === goal.id).id = longGoalId;
  backup.data.milestones.filter((item) => item.goalId === goal.id).forEach((item) => { item.goalId = longGoalId; });
  backup.data.quests.find((item) => item.id === quest.id).sourceId = longGoalId;

  const db = await withDatabase(t, 'i2-atomic-abort-target');
  await db.importBundle(JSON.stringify(backup));
  await assert.rejects(
    () => db.feedbackAndProgressQuest(quest.id, 'completed', '', '', undefined, 0, '2026-08-14'),
    /现实行动 ID/,
  );
  assert.equal((await db.listQuests()).find((item) => item.id === quest.id)?.status, 'pending');
  assert.deepEqual(await db.listQuestFeedback(quest.id), []);
  assert.equal((await db.listMilestones(longGoalId)).find((item) => item.id === firstMilestone.id)?.status, 'pending');
  assert.equal((await db.listXpLedger(branch.id)).length, 0);
});

test('redo restores the same edited derived action without overwriting user content', async (t) => {
  const db = await withDatabase(t, 'i2-derived-user-edits');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '完成两阶段成果', why: '验证可编辑路径', evidence: '有成品', nextStep: '完成第一阶段',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const firstMilestone = await db.addMilestone(goal.id, '完成第一阶段', '第一阶段可检查');
  await db.addMilestone(goal.id, '完成第二阶段', '第二阶段可检查');
  const quest = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id, milestoneId: firstMilestone.id,
    branchId: branch.id, title: '完成第一阶段', reason: '开始', minimumAction: '做五分钟',
    completionCriteria: firstMilestone.evidence, estimatedMinutes: 10, difficulty: 'light',
  });
  const first = await db.feedbackAndProgressQuest(quest.id, 'completed', '', '', undefined, 0, '2026-08-14');
  assert(first.followUp);
  const edited = await db.savePendingQuest(first.followUp.id, {
    title: '我自己的第二阶段', reason: '这是我确认过的理由', minimumAction: '先完成我定义的一小步', completionCriteria: '出现我定义的证据',
  });
  assert.equal((await db.listGoals()).find((item) => item.id === goal.id)?.nextStep, edited.title);
  await db.feedbackAndProgressQuest(quest.id, 'skipped', '先纠正事实', '', undefined, 0, '2026-08-15');
  const retired = (await db.listQuests()).find((item) => item.id === edited.id);
  assert.equal(retired?.systemRetiredReason, 'source-invalidated');
  const redone = await db.feedbackAndProgressQuest(quest.id, 'completed', '重新确认', '', undefined, 0, '2026-08-16');
  assert.equal(redone.followUp?.id, edited.id);
  assert.deepEqual(
    (({ title, reason, minimumAction, completionCriteria }) => ({ title, reason, minimumAction, completionCriteria }))(redone.followUp),
    { title: edited.title, reason: edited.reason, minimumAction: edited.minimumAction, completionCriteria: edited.completionCriteria },
  );
  assert.equal(redone.followUp?.systemRetiredAt, undefined);
  assert.equal((await db.listGoals()).find((item) => item.id === goal.id)?.nextStep, edited.title);
});

test('a full day keeps one stable goal follow-up candidate and schedules it after capacity frees', async (t) => {
  const db = await withDatabase(t, 'i2-goal-capacity-candidate');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '完成两步发布', why: '验证不断链', evidence: '已发布', nextStep: '完成第一步',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const firstMilestone = await db.addMilestone(goal.id, '完成第一步', '第一步可检查');
  const secondMilestone = await db.addMilestone(goal.id, '完成第二步', '第二步可检查');
  const first = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id, milestoneId: firstMilestone.id,
    branchId: branch.id, title: '完成第一步', reason: '开始', minimumAction: '做五分钟', estimatedMinutes: 5, difficulty: 'light',
  });
  await db.addQuest({ localDate: '2026-08-15', type: 'main', sourceType: 'manual', title: '已有主线', reason: '占用名额', minimumAction: '做一步', estimatedMinutes: 5, difficulty: 'light' });
  const sides = [];
  for (const title of ['已有支线一', '已有支线二']) {
    sides.push(await db.addQuest({ localDate: '2026-08-15', type: 'side', sourceType: 'manual', title, reason: '占用名额', minimumAction: '做一步', estimatedMinutes: 5, difficulty: 'light' }));
  }

  const settled = await db.feedbackAndProgressQuest(first.id, 'completed', '', '', undefined, 0, '2026-08-15');
  const candidate = settled.followUp;
  assert(candidate);
  assert.equal(candidate.status, 'exempt');
  assert.equal(candidate.systemRetiredReason, 'capacity');
  assert.equal(candidate.sourceType, 'goal');
  assert.equal(candidate.milestoneId, secondMilestone.id);
  assert.equal((await db.listGoals()).find((item) => item.id === goal.id)?.nextStep, candidate.title);
  const candidateBackup = await db.exportBundle();
  assert.doesNotThrow(() => parseBackup(JSON.stringify(candidateBackup)));
  assert.equal(await db.scheduleGoalFollowUpQuest(candidate.id, '2026-08-15'), null);

  await db.feedbackQuest(sides[0].id, 'completed', '', '', undefined, 0, '2026-08-15');
  const scheduled = await db.scheduleGoalFollowUpQuest(candidate.id, '2026-08-15');
  assert.equal(scheduled?.id, candidate.id);
  assert.equal(scheduled?.actionId, candidate.actionId);
  assert.equal(scheduled?.milestoneId, secondMilestone.id);
  assert.equal(scheduled?.sourceType, 'goal');
  assert.equal(scheduled?.status, 'pending');
  assert.equal((await db.listQuests()).filter((item) => item.actionId === candidate.actionId).length, 1);
  const finished = await db.feedbackAndProgressQuest(scheduled.id, 'completed', '', '', undefined, 0, '2026-08-16');
  assert.equal(finished.milestoneCompleted?.id, secondMilestone.id);
  assert.equal(finished.goalReady, true);
});

test('undoing an older goal action keeps the newest valid pending path as nextStep', async (t) => {
  const db = await withDatabase(t, 'i2-goal-older-undo');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '连续交付三个版本', why: '验证真实推进路径', evidence: '三个版本都可检查', nextStep: '完成第一版',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const firstMilestone = await db.addMilestone(goal.id, '完成第一版', '第一版可检查');
  await db.addMilestone(goal.id, '完成第二版', '第二版可检查');
  const thirdMilestone = await db.addMilestone(goal.id, '完成第三版', '第三版可检查');
  const first = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id, milestoneId: firstMilestone.id, branchId: branch.id,
    title: '完成第一版', reason: '开始推进', minimumAction: '先做五分钟', completionCriteria: firstMilestone.evidence, estimatedMinutes: 10, difficulty: 'light',
  });
  await db.feedbackQuest(first.id, 'completed', '', '', undefined, 0, '2026-08-14');
  const second = (await db.createGoalFollowUpQuest(first.id, '2026-08-15')).followUp;
  assert(second);
  await db.feedbackQuest(second.id, 'completed', '', '', undefined, 0, '2026-08-15');
  const third = (await db.createGoalFollowUpQuest(second.id, '2026-08-16')).followUp;
  assert.equal(third?.milestoneId, thirdMilestone.id);

  await db.undoQuestFeedback(first.id);
  assert.equal((await db.listQuests()).find((item) => item.id === second.id)?.status, 'completed');
  assert.equal((await db.listQuests()).find((item) => item.id === third?.id)?.status, 'pending');
  assert.equal((await db.listGoals()).find((item) => item.id === goal.id)?.nextStep, third?.title);
});

test('a partially completed goal creates one smaller continuation action', async (t) => {
  const db = await withDatabase(t, 'i2-goal-partial-follow-up');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({ result: '完成作品', why: '留下成果', evidence: '公开链接', nextStep: '先写结构', areaId: area.id, branchId: branch.id, role: 'main' });
  const milestone = await db.addMilestone(goal.id, '完成初稿', '有完整初稿');
  const quest = await db.addQuest({ localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id, branchId: branch.id, title: '先写结构', reason: '降低开始成本', minimumAction: '列三个要点', estimatedMinutes: 10, difficulty: 'light' });
  await db.feedbackQuest(quest.id, 'partial', '完成开头', '列出三个要点', undefined, 0, '2026-08-14');
  const continuation = await db.createGoalFollowUpQuest(quest.id, '2026-08-14', 'partial');
  assert.equal(continuation.followUp?.actionId, `goal:${goal.id}:after:${quest.id}:milestone:${milestone.id}:partial`);
  assert.equal(continuation.followUp?.milestoneId, milestone.id);
  assert.match(continuation.followUp?.title ?? '', /^缩小继续：/);
  assert.equal(continuation.milestoneCompleted, null);
  assert.equal((await db.createGoalFollowUpQuest(quest.id, '2026-08-14', 'partial')).followUp, null);
  await db.undoQuestFeedback(quest.id);
  assert.equal((await db.listQuests('2026-08-14')).find((item) => item.id === continuation.followUp?.id)?.status, 'exempt');
  assert.equal((await db.listGoals()).find((item) => item.id === goal.id)?.nextStep, quest.title);
});

test('I2 goals, feedback, habits, and XP survive exact backup restore', async (t) => {
  const db = await withDatabase(t, 'i2-roundtrip');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '形成真实成果', why: '长期复利', evidence: '公开证据', nextStep: '先做十分钟',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const quest = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id,
    title: '先做十分钟', reason: '来自真实目标', minimumAction: '打开文档', estimatedMinutes: 10,
    difficulty: 'standard', branchId: branch.id,
  });
  await db.feedbackQuest(quest.id, 'partial', '继续缩小', '完成开头');
  await db.addHabit({
    name: '短散步', minimumAction: '走两分钟', scheduleDays: [5], dimension: 'energy',
    branchId: branch.id, difficulty: 'light', bonusEnabled: true,
  });
  const before = await db.exportBundle();
  const portable = JSON.parse(JSON.stringify(before));
  await db.clearAll();
  await db.importBundle(JSON.stringify(portable));
  assert.deepEqual((await db.exportBundle()).data, portable.data);
  assert.equal((await db.branchProgress(branch.id)).totalXp, 5);
});

test('merging a complete I2 backup remaps references and settlement keys', async (t) => {
  const db = await withDatabase(t, 'i2-merge');
  await db.ensureI2Defaults();
  const area = (await db.listAreas())[0];
  const branch = (await db.listBranches())[0];
  const goal = await db.addGoal({
    result: '交付成果', why: '积累作品', evidence: '可见链接', nextStep: '完成一页',
    areaId: area.id, branchId: branch.id, role: 'main',
  });
  const quest = await db.addQuest({
    localDate: '2026-08-14', type: 'main', sourceType: 'goal', sourceId: goal.id,
    title: '完成一页', reason: '推进作品', minimumAction: '写一个段落', estimatedMinutes: 20,
    difficulty: 'hard', branchId: branch.id, actionId: 'merge-action',
  });
  await db.feedbackQuest(quest.id, 'completed');
  const backup = await db.exportBundle();
  await db.importBundle(JSON.stringify(backup));
  const merged = await db.exportBundle();
  assert.equal(merged.data.goals.length, 2);
  assert.equal(merged.data.quests.length, 2);
  assert.equal(merged.data.questFeedback.length, 2);
  assert.equal(merged.data.xpLedger.length, 2);
  assert.equal(new Set(merged.data.xpLedger.map((item) => item.settlementKey)).size, 2);
  assert.doesNotThrow(() => JSON.stringify(merged));
});

test('merge-import exempts pending quests whose goal or BONUS habit loses an action slot', async (t) => {
  const source = await withDatabase(t, 'i2-merge-source-eligibility');
  await source.ensureI2Defaults();
  const sourceArea = (await source.listAreas())[0];
  const sourceBranch = (await source.listBranches())[0];
  const importedGoalSource = await source.addGoal({
    result: '导入的主目标', why: '', evidence: '存在结果', nextStep: '推进一步',
    areaId: sourceArea.id, branchId: sourceBranch.id, role: 'main',
  });
  await source.addQuest({
    localDate: '2026-08-21', type: 'main', sourceType: 'goal', sourceId: importedGoalSource.id,
    title: '导入目标行动', reason: '原设备上的计划', minimumAction: '做一步', estimatedMinutes: 5,
    difficulty: 'light', branchId: sourceBranch.id,
  });
  const importedHabitSource = await source.addHabit({
    name: '导入的 BONUS', minimumAction: '做两分钟', scheduleDays: [5], dimension: 'energy',
    branchId: sourceBranch.id, difficulty: 'light', bonusEnabled: true,
  }, '2026-08-14');
  await source.ensureTodayBonusQuests('2026-08-14');
  const completedBonus = (await source.listQuests('2026-08-14')).find((item) => item.sourceId === importedHabitSource.id);
  await source.feedbackQuest(completedBonus.id, 'completed', '', '', undefined, 0, '2026-08-14');
  await source.ensureTodayBonusQuests('2026-08-21');
  const sourceBackup = JSON.parse(JSON.stringify(await source.exportBundle()));

  const target = await withDatabase(t, 'i2-merge-target-eligibility');
  await target.ensureI2Defaults();
  const targetArea = (await target.listAreas())[0];
  const targetBranch = (await target.listBranches())[0];
  await target.addGoal({
    result: '已有主目标', why: '', evidence: '已有结果', nextStep: '已有下一步',
    areaId: targetArea.id, branchId: targetBranch.id, role: 'main',
  });
  for (const name of ['已有 BONUS 一', '已有 BONUS 二', '已有 BONUS 三']) {
    await target.addHabit({
      name, minimumAction: '做一分钟', scheduleDays: [1, 2, 3, 4, 5, 6, 7], dimension: 'energy',
      branchId: targetBranch.id, difficulty: 'light', bonusEnabled: true,
    }, '2026-08-01');
  }

  await target.importBundle(JSON.stringify(sourceBackup), '2026-08-22');
  const importedGoal = (await target.listGoals()).find((item) => item.result === '导入的主目标');
  const importedHabit = (await target.listHabits()).find((item) => item.name === '导入的 BONUS');
  assert.equal(importedGoal?.role, 'wishlist');
  assert.equal(importedHabit?.bonusEnabled, false);
  assert.deepEqual(importedHabit?.scheduleHistory?.at(-1), {
    effectiveFrom: '2026-08-22', scheduleDays: [5], trackingEnabled: false,
  });
  const importedPending = (await target.listQuests()).filter((item) =>
    (item.sourceId === importedGoal?.id || item.sourceId === importedHabit?.id) && item.localDate === '2026-08-21');
  assert.equal(importedPending.length, 2);
  assert.ok(importedPending.every((item) => item.status === 'exempt'));
  assert.ok(importedPending.every((item) => item.systemRetiredAt));
  assert.deepEqual(new Set(importedPending.map((item) => item.systemRetiredReason)), new Set(['source-invalidated', 'elapsed']));
  assert.equal((await target.listQuestFeedback()).filter((item) => importedPending.some((quest) => quest.id === item.questId)).length, 0);
  assert.equal((await target.listHabitLogs(importedHabit.id)).filter((item) => importedPending.some((quest) => quest.id === item.questId)).length, 0);
  assert.equal((await target.listXpLedger()).filter((item) => importedPending.some((quest) => quest.id === item.sourceId)).length, 0);
  assert.equal(await target.habitMomentum(importedHabit.id, '2026-08-21'), 2.5);
  assert.equal(await target.habitMomentum(importedHabit.id, '2026-08-29'), 2.5, 'forced BONUS disable must not add future pending momentum dates');
  assert.equal((await target.ensureTodayBonusQuests('2026-08-28')).filter((item) => item.sourceId === importedHabit.id).length, 0);
});

test('merge capacity candidates from every quest source restore on a valid empty day', async (t) => {
  const source = await withDatabase(t, 'i2-merge-capacity-source');
  await source.ensureI2Defaults();
  const sourceArea = (await source.listAreas())[0];
  const sourceBranch = (await source.listBranches())[0];
  const goal = await source.addGoal({
    result: '导入后继续推进', why: '', evidence: '有结果', nextStep: '目标主线',
    areaId: sourceArea.id, branchId: sourceBranch.id, role: 'main',
  });
  const milestone = await source.addMilestone(goal.id, '目标主线', '主线证据');
  await source.addQuest({
    localDate: '2026-08-21', type: 'main', sourceType: 'goal', sourceId: goal.id, milestoneId: milestone.id,
    branchId: sourceBranch.id, title: '目标主线', reason: '来源目标', minimumAction: '推进五分钟', estimatedMinutes: 5, difficulty: 'light',
  });
  const habit = await source.addHabit({
    name: '导入每日 BONUS', minimumAction: '做两分钟', scheduleDays: [1, 2, 3, 4, 5, 6, 7],
    dimension: 'energy', branchId: sourceBranch.id, difficulty: 'light', bonusEnabled: true,
  }, '2026-08-20');
  await source.ensureTodayBonusQuests('2026-08-21');
  await source.addQuest({ localDate: '2026-08-21', type: 'side', sourceType: 'recovery', title: '恢复支线', reason: '先恢复', minimumAction: '休息两分钟', estimatedMinutes: 5, difficulty: 'light' });
  await source.addQuest({ localDate: '2026-08-21', type: 'side', sourceType: 'manual', title: '手动支线', reason: '手动安排', minimumAction: '做一步', estimatedMinutes: 5, difficulty: 'light' });
  const sourceBackup = await source.exportBundle();

  const target = await withDatabase(t, 'i2-merge-capacity-target');
  await target.ensureI2Defaults();
  const fillers = [
    ['main', '占位主线'],
    ['bonus', '占位 BONUS 一'], ['bonus', '占位 BONUS 二'], ['bonus', '占位 BONUS 三'],
    ['side', '占位支线一'], ['side', '占位支线二'],
  ];
  for (const [type, title] of fillers) {
    await target.addQuest({ localDate: '2026-08-21', type, sourceType: 'manual', title, reason: '占用当天位置', minimumAction: '做一步', estimatedMinutes: 5, difficulty: 'light' });
  }
  await target.importBundle(JSON.stringify(sourceBackup), '2026-08-21');
  const candidates = (await target.listQuests('2026-08-21')).filter((item) => ['目标主线', '导入每日 BONUS', '恢复支线', '手动支线'].includes(item.title));
  assert.equal(candidates.length, 4);
  assert.ok(candidates.every((item) => item.status === 'exempt' && item.systemRetiredReason === 'capacity'));

  const restored = [];
  for (const candidate of candidates.sort((left, right) => ({ main: 0, bonus: 1, side: 2 })[left.type] - ({ main: 0, bonus: 1, side: 2 })[right.type])) {
    const value = await target.scheduleCapacityQuest(candidate.id, '2026-08-22');
    assert(value);
    assert.equal(value.id, candidate.id);
    assert.equal(value.actionId, candidate.actionId);
    assert.equal(value.systemRetiredAt, undefined);
    restored.push(value);
  }
  assert.deepEqual(restored.map((item) => item.type).sort(), ['bonus', 'main', 'side', 'side']);
  const restoredGoal = restored.find((item) => item.title === '目标主线');
  assert.equal(restoredGoal?.sourceType, 'goal');
  assert.ok(restoredGoal?.milestoneId);
  const restoredBonus = restored.find((item) => item.sourceId && item.title === habit.name);
  assert.equal(restoredBonus?.sourceType, 'habit');
  assert.equal((await target.listQuestFeedback()).filter((item) => restored.some((quest) => quest.id === item.questId)).length, 0);
  const restoredBackup = await target.exportBundle();
  assert.doesNotThrow(() => parseBackup(JSON.stringify(restoredBackup)));
});

test('100 records can each be added, edited, and read back', async (t) => {
  const db = await withDatabase(t, 'hundred-records');
  const created = [];

  for (let index = 0; index < 100; index += 1) {
    created.push(await db.addEntry(`original ${index}`, '2026-08-14'));
  }
  assert.equal((await db.listEntries('2026-08-14')).length, 100);

  for (let index = 0; index < created.length; index += 1) {
    const updated = await db.editEntry(created[index].id, 1, `updated ${index}`);
    assert.equal(updated.version, 2);
    assert.equal((await db.getEntry(created[index].id)).body, `updated ${index}`);
  }

  const all = await db.listEntries('2026-08-14');
  assert.equal(all.length, 100);
  assert.ok(all.every((entry) => entry.version === 2));
});

test('same-day entries have a stable chronological order', async (t) => {
  const db = await withDatabase(t, 'stable-order');
  await Promise.all([
    db.addEntry('one', '2026-08-14'),
    db.addEntry('two', '2026-08-14'),
    db.addEntry('three', '2026-08-14'),
    db.addEntry('four', '2026-08-14'),
  ]);

  const first = await db.listEntries('2026-08-14');
  const second = await db.listEntries('2026-08-14');
  assert.deepEqual(first.map((entry) => entry.body), ['one', 'two', 'three', 'four']);
  assert.deepEqual(first.map((entry) => entry.id), second.map((entry) => entry.id));
  assert.deepEqual(
    first.map((entry) => entry.createdAt),
    [...first].map((entry) => entry.createdAt).sort((left, right) => left.localeCompare(right)),
  );
});

test('original leading and trailing whitespace is preserved', async (t) => {
  const db = await withDatabase(t, 'verbatim-body');
  const body = '\n  an intentionally quiet opening  \n';
  const entry = await db.addEntry(body, '2026-08-14');
  assert.equal((await db.getEntry(entry.id)).body, body);
});

test('edit creates a revision and undo restores the previous body as a new version', async (t) => {
  const db = await withDatabase(t, 'undo');
  const original = await db.addEntry('before', '2026-08-14');

  const edited = await db.editEntry(original.id, original.version, 'after');
  assert.equal(edited.body, 'after');
  assert.equal(edited.version, 2);
  assert.deepEqual(
    (await db.listRevisions(original.id)).map(({ fromVersion, previousBody, reason, undoneAt }) => ({
      fromVersion,
      previousBody,
      reason,
      undone: Boolean(undoneAt),
    })),
    [{ fromVersion: 1, previousBody: 'before', reason: 'user-edit', undone: false }],
  );

  const undone = await db.undoLastEdit(original.id);
  assert.equal(undone.body, 'before');
  assert.equal(undone.version, 3);
  assert.deepEqual(
    (await db.listRevisions(original.id)).map(({ fromVersion, previousBody, reason, undoneAt }) => ({
      fromVersion,
      previousBody,
      reason,
      undone: Boolean(undoneAt),
    })),
    [
      { fromVersion: 2, previousBody: 'after', reason: 'undo', undone: false },
      { fromVersion: 1, previousBody: 'before', reason: 'user-edit', undone: true },
    ],
  );
  await assert.rejects(() => db.undoLastEdit(original.id));
});

test('success journal kind defaults explicitly, is editable and undoable, and survives backup restore', async (t) => {
  const db = await withDatabase(t, 'success-journal-kind');
  const regular = await db.addEntry('普通记录', '2026-08-14');
  const success = await db.addEntry('我完成了困难的一步', '2026-08-14', 'text', 'success');
  assert.equal(regular.kind, 'journal');
  assert.equal(success.kind, 'success');

  const corrected = await db.editEntry(success.id, success.version, success.body, 'journal');
  assert.equal(corrected.kind, 'journal');
  assert.equal((await db.listRevisions(success.id))[0].previousKind, 'success');
  const undone = await db.undoLastEdit(success.id);
  assert.equal(undone.kind, 'success');

  const backup = JSON.parse(JSON.stringify(await db.exportBundle()));
  assert.doesNotThrow(() => parseBackup(JSON.stringify(backup)));
  await db.clearAll();
  await db.importBundle(JSON.stringify(backup));
  assert.deepEqual((await db.exportBundle()).data, backup.data);
  assert.equal((await db.getEntry(success.id)).kind, 'success');

  const legacy = structuredClone(backup);
  legacy.data.entries[0].body = `普通正文\n\n ${LEGACY_SUCCESS_PROMPT}\n拆分出的成功`;
  const migratedEntryVersion = legacy.data.entries[0].version + 1;
  const untouchedLegacyVersion = legacy.data.entries[1].version;
  const untouchedLegacyBody = legacy.data.entries[1].body;
  legacy.data.entries.forEach((entry) => delete entry.kind);
  legacy.data.revisions[0].previousBody = `${LEGACY_SUCCESS_PROMPT}\n修改前的小成功`;
  const migratedRevisionVersion = legacy.data.revisions[0].version + 1;
  legacy.data.revisions.forEach((revision) => delete revision.previousKind);
  const migrated = parseBackup(JSON.stringify(legacy));
  const migratedOriginal = migrated.data.entries.find((entry) => entry.id === legacy.data.entries[0].id);
  const migratedOrdinary = migrated.data.entries.find((entry) => entry.id === legacy.data.entries[1].id);
  const migratedSuccess = migrated.data.entries.find((entry) => entry.id === `${legacy.data.entries[0].id}:legacy-success`);
  assert.deepEqual({ body: migratedOriginal.body, kind: migratedOriginal.kind }, { body: '普通正文', kind: 'journal' });
  assert.deepEqual({ body: migratedOrdinary.body, kind: migratedOrdinary.kind }, { body: untouchedLegacyBody, kind: 'journal' });
  assert.deepEqual({ body: migratedSuccess.body, kind: migratedSuccess.kind }, { body: '拆分出的成功', kind: 'success' });
  assert.equal(migratedOriginal.version, migratedEntryVersion);
  assert.equal(migratedOriginal.analysisStatus, 'not-submitted');
  assert.equal(migratedOrdinary.version, untouchedLegacyVersion);
  assert.deepEqual(
    { body: migrated.data.revisions[0].previousBody, kind: migrated.data.revisions[0].previousKind },
    { body: '修改前的小成功', kind: 'success' },
  );
  assert.equal(migrated.data.revisions[0].version, migratedRevisionVersion);
  const legacyDb = await withDatabase(t, 'success-journal-legacy-import');
  await legacyDb.importBundle(JSON.stringify(legacy));
  assert.deepEqual(
    Object.fromEntries((await legacyDb.listEntries('2026-08-14')).map(({ body, kind }) => [body, kind])),
    Object.fromEntries(migrated.data.entries.map(({ body, kind }) => [body, kind])),
  );
  assert.deepEqual(migrateLegacyJournalContent(`开头\n\t${LEGACY_SUCCESS_PROMPT}\n结尾`), { body: '开头\n结尾', kind: 'journal' });
  assert.deepEqual(migrateLegacyJournalContent(`  ${LEGACY_SUCCESS_PROMPT}同一行成功\n下一行`), { body: '同一行成功\n下一行', kind: 'journal' });
  assert.deepEqual(migrateLegacyJournalContent(`${LEGACY_SUCCESS_PROMPT}\n唯一答案`), { body: '唯一答案', kind: 'success' });
  assert.deepEqual(migrateLegacyJournalContent(`正文\n${LEGACY_SUCCESS_PROMPT}\n`), { body: '正文', kind: 'journal' });
  assert.deepEqual(migrateLegacyJournalContent(`正文提到${LEGACY_SUCCESS_PROMPT}但不是独立行`), {
    body: `正文提到${LEGACY_SUCCESS_PROMPT}但不是独立行`, kind: 'journal',
  });
  assert.deepEqual(migrateLegacyJournalContent(`${LEGACY_SUCCESS_PROMPT}\n显式正文`, 'journal'), {
    body: `${LEGACY_SUCCESS_PROMPT}\n显式正文`, kind: 'journal',
  });
  const invalid = structuredClone(backup);
  invalid.data.entries[0].kind = 'achievement';
  assert.throws(() => parseBackup(JSON.stringify(invalid)), /记录类型/);
});

test('legacy success backup migration bumps the entry revision and invalidates derived AI facts', async (t) => {
  const source = await withDatabase(t, 'legacy-success-analysis-source');
  await source.saveAssessment({ energy: 50 }, '2026-08-13');
  const entry = await source.addEntry(`今天会议很多，晚上散步后好了一些。\n\n${LEGACY_SUCCESS_PROMPT}\n我仍然完成了十分钟散步`, '2026-08-14');
  const request = analysisRequest(entry, 'legacy-success-analysis');
  const job = await source.createDailyAnalysisJob(request);
  await source.markAnalysisJobProcessing(job.id);
  await source.saveDailyAnalysis(job.id, analysisResponse(request));
  const memory = (await source.listMemories('candidate'))[0];
  await source.decideMemory(memory.id, 'confirmed');
  await source.resolvedStateAtOrBefore('2026-08-14');
  const legacy = JSON.parse(JSON.stringify(await source.exportBundle()));
  delete legacy.data.entries.find((item) => item.id === entry.id).kind;

  const migrated = parseBackup(JSON.stringify(legacy));
  const migratedEntry = migrated.data.entries.find((item) => item.id === entry.id);
  const migratedAnalysis = migrated.data.analyses.find((item) => item.requestId === request.requestId);
  const migratedJob = migrated.data.analysisJobs.find((item) => item.requestId === request.requestId);
  const relatedEvents = migrated.data.events.filter((item) => item.sourceEntryIds.includes(entry.id));
  const migratedSuccess = migrated.data.entries.find((item) => item.id === `${entry.id}:legacy-success`);
  assert.equal(migratedEntry.kind, 'journal');
  assert.equal(migratedEntry.body, '今天会议很多，晚上散步后好了一些。');
  assert.deepEqual({ body: migratedSuccess.body, kind: migratedSuccess.kind }, { body: '我仍然完成了十分钟散步', kind: 'success' });
  assert.equal(migratedEntry.version, entry.version + 1);
  assert.equal(migratedEntry.analysisStatus, 'not-submitted');
  assert.equal(migratedAnalysis.status, 'stale');
  assert.ok(migratedAnalysis.sourceEntries.every((sourceEntry) => sourceEntry.revision < migratedEntry.version));
  assert.equal(migratedJob.status, 'stale');
  assert.ok(relatedEvents.length > 0 && relatedEvents.every((item) => !item.active));
  assert.ok(migrated.data.observations.filter((item) => relatedEvents.some((event) => event.id === item.evidenceId)).every((item) => !item.active));
  assert.deepEqual(migrated.data.snapshots, []);
  const migratedMemory = migrated.data.memories.find((item) => item.id === memory.id);
  assert.equal(migratedMemory.status, 'candidate');
  assert.deepEqual(migratedMemory.evidenceIds, []);
  assert.equal(migratedMemory.confirmedAt, undefined);

  const restored = await withDatabase(t, 'legacy-success-analysis-restore');
  await restored.importBundle(JSON.stringify(legacy));
  assert.equal((await restored.getEntry(entry.id)).version, entry.version + 1);
  assert.equal((await restored.listDailyAnalyses('2026-08-14'))[0].status, 'stale');
  assert.equal((await restored.listAnalysisJobs('2026-08-14'))[0].status, 'stale');
  assert.ok((await restored.listJournalEvents('2026-08-14')).every((item) => !item.active));
});

test('ordinary legacy journals gain an explicit kind without invalidating ready AI facts', async (t) => {
  const source = await withDatabase(t, 'legacy-ordinary-analysis-source');
  await source.saveAssessment({ energy: 50 }, '2026-08-13');
  const entry = await source.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-14');
  const request = analysisRequest(entry, 'legacy-ordinary-analysis');
  const job = await source.createDailyAnalysisJob(request);
  await source.markAnalysisJobProcessing(job.id);
  await source.saveDailyAnalysis(job.id, analysisResponse(request));
  const event = (await source.listJournalEvents('2026-08-14'))[0];
  await source.decideEvent(event.id, 'confirmed');
  await source.resolvedStateAtOrBefore('2026-08-14');
  const legacy = JSON.parse(JSON.stringify(await source.exportBundle()));
  const legacyEntry = legacy.data.entries.find((item) => item.id === entry.id);
  delete legacyEntry.kind;
  const baselineObservation = legacy.data.observations.find((item) => item.kind === 'user-self-assessment');
  legacy.data.snapshots.push({
    id: 'legacy-ordinary-snapshot', localDate: '2026-08-14', values: { energy: 50 },
    lastEvidenceAt: { energy: baselineObservation.observedAt }, observationIds: [baselineObservation.id],
    createdAt: baselineObservation.createdAt, updatedAt: baselineObservation.updatedAt, version: 1,
  });

  const migrated = parseBackup(JSON.stringify(legacy));
  const migratedEntry = migrated.data.entries.find((item) => item.id === entry.id);
  assert.equal(migratedEntry.kind, 'journal');
  assert.equal(migratedEntry.version, entry.version);
  assert.equal(migratedEntry.updatedAt, legacyEntry.updatedAt);
  assert.equal(migrated.data.analyses.find((item) => item.requestId === request.requestId).status, 'ready');
  assert.equal(migrated.data.analysisJobs.find((item) => item.requestId === request.requestId).status, 'succeeded');
  assert.equal(migrated.data.events.find((item) => item.id === event.id).active, true);
  assert.ok(migrated.data.snapshots.length > 0);
});

test('concurrent edits with the same expectedVersion allow exactly one winner', async (t) => {
  const db = await withDatabase(t, 'optimistic-lock');
  const original = await db.addEntry('original', '2026-08-14');

  const attempts = await Promise.allSettled([
    db.editEntry(original.id, 1, 'first contender'),
    db.editEntry(original.id, 1, 'second contender'),
  ]);
  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);

  const saved = await db.getEntry(original.id);
  assert.equal(saved.version, 2);
  assert.ok(['first contender', 'second contender'].includes(saved.body));
  assert.equal((await db.listRevisions(original.id)).length, 1);
});

test('all five assessment dimensions accept inclusive boundaries and latest values win', async (t) => {
  const db = await withDatabase(t, 'assessments');
  await db.saveAssessment({
    energy: 0,
    mind: 25,
    connection: 50,
    progress: 75,
    play: 100,
  }, '2026-08-13');

  const baseline = await db.latestAssessment();
  assert.deepEqual(
    Object.fromEntries(Object.entries(baseline).map(([key, value]) => [key, value.value])),
    { energy: 0, mind: 25, connection: 50, progress: 75, play: 100 },
  );
  await assert.rejects(() => db.saveAssessment({ energy: -1 }, '2026-08-14'));
  await assert.rejects(() => db.saveAssessment({ play: 101 }, '2026-08-14'));

  await new Promise((resolve) => setTimeout(resolve, 2));
  await db.saveAssessment({ energy: 100, mind: 0 }, '2026-08-14');
  const latest = await db.latestAssessment();
  assert.equal(latest.energy.value, 100);
  assert.equal(latest.mind.value, 0);
  assert.equal(latest.connection.value, 50);

  const historical = await db.assessmentAtOrBefore('2026-08-13');
  assert.equal(historical.energy.value, 0);
  assert.equal(historical.mind.value, 25);
});

test('an empty database restores an export without changing its data', async (t) => {
  const db = await withDatabase(t, 'roundtrip');
  const entry = await db.addEntry('portable journal', '2026-08-14');
  await db.editEntry(entry.id, 1, 'portable journal, edited');
  await db.saveAssessment({ energy: 64, play: 81 }, '2026-08-14');
  await db.saveSettings({ onboardingSeen: true, reduceMotion: true, guidanceTone: 'direct' });
  const before = await db.exportBundle();

  await db.clearAll();
  const empty = await db.exportBundle();
  assert.deepEqual(empty.data, emptyBackupData());

  await db.importBundle(JSON.stringify(before));
  const restored = await db.exportBundle();
  assert.deepEqual(restored.data, before.data);
  assert.equal((await db.getSettings()).guidanceTone, 'direct');
});

test('invalid backup is rejected before it can change existing data', async (t) => {
  const db = await withDatabase(t, 'invalid-import');
  await db.addEntry('must survive', '2026-08-14');
  await db.saveSettings({ onboardingSeen: true });
  const before = await db.exportBundle();
  const corrupt = structuredClone(before);
  corrupt.data.revisions.push({
    id: crypto.randomUUID(),
    entryId: 'missing-entry',
    fromVersion: 1,
    previousBody: 'orphan',
    reason: 'user-edit',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  });

  await assert.rejects(() => db.importBundle(JSON.stringify(corrupt)));
  assert.deepEqual((await db.exportBundle()).data, before.data);

  const missingObservationTime = structuredClone(before);
  missingObservationTime.data.observations.push({
    id: crypto.randomUUID(),
    assessmentId: crypto.randomUUID(),
    localDate: '2026-08-14',
    dimension: 'energy',
    kind: 'user-self-assessment',
    value: 50,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  });
  await assert.rejects(() => db.importBundle(JSON.stringify(missingObservationTime)));
  assert.deepEqual((await db.exportBundle()).data, before.data);

  const invalidObservationKind = structuredClone(before);
  const observationTime = new Date().toISOString();
  invalidObservationKind.data.observations.push({
    id: crypto.randomUUID(),
    assessmentId: crypto.randomUUID(),
    localDate: '2026-08-14',
    dimension: 'energy',
    kind: 'automatic-guess',
    value: 50,
    active: true,
    observedAt: observationTime,
    createdAt: observationTime,
    updatedAt: observationTime,
    version: 1,
  });
  await assert.rejects(() => db.importBundle(JSON.stringify(invalidObservationKind)));
  assert.deepEqual((await db.exportBundle()).data, before.data);

  const invalidSettings = structuredClone(before);
  invalidSettings.data.settings[0].reduceMotion = 'sometimes';
  await assert.rejects(() => db.importBundle(JSON.stringify(invalidSettings)));
  assert.deepEqual((await db.exportBundle()).data, before.data);

  const invalidTone = structuredClone(before);
  invalidTone.data.settings[0].guidanceTone = 'dramatic';
  await assert.rejects(() => db.importBundle(JSON.stringify(invalidTone)));
  assert.deepEqual((await db.exportBundle()).data, before.data);
});

test('repeated import keeps both copies and remaps revision and assessment references', async (t) => {
  const db = await withDatabase(t, 'merge-import');
  const original = await db.addEntry('first version', '2026-08-14');
  await db.editEntry(original.id, 1, 'second version');
  await db.saveAssessment({ energy: 40, mind: 60 }, '2026-08-14');
  await db.saveSettings({ onboardingSeen: true, reduceMotion: true });
  const backup = await db.exportBundle();

  await db.saveSettings({ reduceMotion: false });
  await db.importBundle(JSON.stringify(backup));
  const merged = await db.exportBundle();

  assert.equal(merged.data.entries.length, 2);
  const importedEntry = merged.data.entries.find((entry) => entry.id !== original.id);
  assert.ok(importedEntry);
  assert.equal(importedEntry.importedFromId, original.id);
  assert.equal(importedEntry.body, 'second version');
  assert.equal(importedEntry.version, 2);

  assert.equal(merged.data.revisions.length, 2);
  const originalRevisionId = backup.data.revisions[0].id;
  const importedRevision = merged.data.revisions.find((revision) => revision.id !== originalRevisionId);
  assert.ok(importedRevision);
  assert.equal(importedRevision.entryId, importedEntry.id);
  assert.equal(importedRevision.fromVersion, 1);

  assert.equal(merged.data.observations.length, 4);
  const originalObservationIds = new Set(backup.data.observations.map((item) => item.id));
  const importedObservations = merged.data.observations.filter((item) => !originalObservationIds.has(item.id));
  assert.equal(importedObservations.length, 2);
  assert.equal(new Set(importedObservations.map((item) => item.assessmentId)).size, 1);
  assert.notEqual(importedObservations[0].assessmentId, backup.data.observations[0].assessmentId);

  assert.equal(merged.data.settings.length, 1);
  assert.equal(merged.data.settings[0].reduceMotion, false);
});

test('restore after an app reload replaces bootstrap settings when user data is empty', async (t) => {
  const db = await withDatabase(t, 'reload-settings');
  await db.saveSettings({ onboardingSeen: true, reduceMotion: true });
  const backup = await db.exportBundle();

  await db.clearAll();
  await db.saveSettings({ onboardingSeen: true, reduceMotion: false });
  await db.importBundle(JSON.stringify(backup));

  assert.deepEqual((await db.exportBundle()).data.settings, backup.data.settings);
});

test('backup export never includes the local custom AI key', async (t) => {
  const db = await withDatabase(t, 'backup-local-ai-key');
  await db.saveSettings({ aiApiKey: 'secret-local-minimax-key' });

  const backup = await db.exportBundle();
  assert.equal(backup.data.settings[0].aiApiKey, undefined);
  assert.equal(JSON.stringify(backup).includes('secret-local-minimax-key'), false);
  assert.equal((await db.getSettings()).aiApiKey, 'secret-local-minimax-key');
});

test('import preserves local customisation even when there are no activity records', async (t) => {
  const db = await withDatabase(t, 'merge-custom-empty');
  await db.ensureI2Defaults();
  const backup = await db.exportBundle();
  const [firstArea] = await db.listAreas();

  await db.saveProfile({ userName: '本机用户' });
  await db.saveSettings({ onboardingSeen: true, reduceMotion: true });
  await db.saveArea(firstArea.id, { name: '本机健康' });
  await db.importBundle(JSON.stringify(backup));

  assert.equal((await db.getProfile()).userName, '本机用户');
  assert.equal((await db.getSettings()).reduceMotion, true);
  const areas = await db.listAreas();
  assert.equal(areas.length, 16);
  assert.ok(areas.some((area) => area.name === '本机健康'));
});

test('deleting the whole database allows reopening a new empty database', async (t) => {
  const db = await withDatabase(t, 'delete-database');
  await db.addEntry('temporary', '2026-08-14');
  await db.saveAssessment({ play: 100 }, '2026-08-14');
  await db.saveSettings({ onboardingSeen: true });

  await db.deleteDatabase();
  const reopened = await QiguangDb.open(db.name);
  assert.deepEqual((await reopened.exportBundle()).data, emptyBackupData());
  reopened.close();
});

test('blocked deletion waits for the blocking connection instead of reporting a false failure', async (t) => {
  const db = await withDatabase(t, 'blocked-delete');
  await db.addEntry('temporary', '2026-08-14');
  const blocker = await openRawDatabase(db.name);
  t.after(() => blocker.close());

  let outcome = 'pending';
  const deletion = db.deleteDatabase().then(
    () => { outcome = 'resolved'; },
    () => { outcome = 'rejected'; },
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(outcome, 'pending');

  blocker.close();
  await deletion;
  assert.equal(outcome, 'resolved');
});

test('explicit recovery replaces an unreadable database with a validated backup', async (t) => {
  const name = databaseName('recovery-import');
  const source = await QiguangDb.open(name);
  let restored;
  t.after(async () => {
    source.close();
    restored?.close();
    await deleteDatabase(name);
  });

  await source.addEntry('saved in backup', '2026-08-14');
  await source.saveAssessment({ energy: 72 }, '2026-08-14');
  const backup = await source.exportBundle();
  await source.addEntry('not in backup', '2026-08-14');
  source.close();

  restored = await QiguangDb.restoreFromBackup(JSON.stringify(backup), name);
  assert.deepEqual((await restored.exportBundle()).data, backup.data);
});

test('deleting an entry cascades its revisions without touching other entries', async (t) => {
  const db = await withDatabase(t, 'cascade');
  const doomed = await db.addEntry('delete me', '2026-08-14');
  const survivor = await db.addEntry('keep me', '2026-08-14');
  await db.editEntry(doomed.id, 1, 'delete me edited');
  await db.editEntry(survivor.id, 1, 'keep me edited');

  await db.deleteEntry(doomed.id);
  assert.equal(await db.getEntry(doomed.id), undefined);
  assert.deepEqual(await db.listRevisions(doomed.id), []);
  assert.equal((await db.getEntry(survivor.id)).body, 'keep me edited');
  assert.equal((await db.listRevisions(survivor.id)).length, 1);
});

test('deleting an analysed entry leaves an importable backup with only inactive references', async (t) => {
  const db = await withDatabase(t, 'delete-analysed-entry');
  const entry = await db.addEntry('今天会议很多，晚上散步后好了一些。', '2026-08-14');
  const request = analysisRequest(entry, 'delete-analysis');
  const job = await db.createDailyAnalysisJob(request);
  await db.markAnalysisJobProcessing(job.id);
  await db.saveDailyAnalysis(job.id, analysisResponse(request));

  await db.deleteEntry(entry.id);
  const backup = await db.exportBundle();
  assert.doesNotThrow(() => parseBackup(JSON.stringify(backup)));
  assert.equal(backup.data.analyses[0].status, 'stale');
  assert.ok(backup.data.events.every((event) => !event.active));
  assert.ok(backup.data.observations.filter((item) => item.kind === 'event-impact').every((item) => !item.active));
  assert.equal(backup.data.analysisJobs[0].status, 'stale');
});
