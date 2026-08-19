import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseDailyAnalysisRequest,
  parseDailyAnalysisResponse,
  parseGoalDecompositionRequest,
  parseGoalDecompositionResponse,
  parseModelJson,
  parseSystemCandidateReviewRequest,
  parseSystemCandidateReviewResponse,
  parseTaskFeedbackRequest,
  parseTaskFeedbackResponse,
  parseWeeklyReviewRequest,
  parseWeeklyReviewResponse,
} from '../src/analysis-contract.ts';

const entryText = '今天会议很多，晚上散步后好了一些。';

function evidence(quote) {
  const source = Array.from(entryText);
  const target = Array.from(quote);
  const start = source.findIndex((_, index) => source.slice(index, index + target.length).join('') === quote);
  return { entryId: 'entry-1', quote, start, end: start + target.length };
}

function validRequest() {
  return {
    contractVersion: '1.0',
    operation: 'daily_analysis',
    requestId: 'request-1',
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    localDate: '2026-08-14',
    userInput: { entries: [{ entryId: 'entry-1', revision: 2, text: entryText }] },
    context: {
      confirmedEvents: [],
      recentStates: [{ localDate: '2026-08-13', values: { energy: 55, mental: 60 } }],
      goals: [{ goalId: 'goal-1', result: '完成可验证作品', role: 'main' }],
      bonusHabits: [{ habitId: 'habit-1', name: '散步', minimumAction: '走两分钟' }],
      memories: [],
      constraints: [],
    },
    permissions: {
      entryIds: ['entry-1'],
      includeConfirmedEvents: true,
      includeRecentStates: true,
      includeGoals: true,
      includeBonusHabits: true,
      memoryIds: [],
    },
  };
}

function validResponse() {
  return {
    contractVersion: '1.0',
    requestId: 'request-1',
    operation: 'daily_analysis',
    result: {
      title: '忙碌之后重新恢复',
      summary: '白天会议较多，晚间散步后感觉有所缓解。',
      explicitMoods: ['缓和'],
      events: [
        {
          candidateId: 'event-1',
          title: '连续参加多场会议',
          description: '用户明确写到今天会议很多。',
          sourceType: 'explicit',
          confirmation: 'confirmed_by_default',
          confidence: 'high',
          evidence: [evidence('今天会议很多')],
          stateImpactCandidates: [{
            dimension: 'energy', direction: 'negative', strength: 'medium', suggestedDelta: -6,
            reason: '用户明确描述会议密集。', confidence: 'medium',
          }],
          growthEvidenceCandidate: null,
        },
        {
          candidateId: 'event-2',
          title: '散步可能帮助恢复',
          description: '散步与缓解同时出现，但暂不能确定因果。',
          sourceType: 'inferred',
          confirmation: 'pending',
          confidence: 'low',
          evidence: [evidence('散步后好了一些')],
          stateImpactCandidates: [{
            dimension: 'mental', direction: 'positive', strength: 'small', suggestedDelta: 3,
            reason: '用户写到散步后好了一些。', confidence: 'low',
          }],
          growthEvidenceCandidate: null,
        },
      ],
      reflection: {
        whatHappened: '今天会议密集，晚间散步后有所恢复。',
        specificCredit: '注意到负荷后选择了散步。',
        patternCandidate: {
          observation: '会议密集的晚上可能更需要低刺激恢复。',
          evidenceCount: 1,
          neededEvidence: '还需要至少两次相似日子的证据。',
        },
        nextSmallStep: '明天会议后留十分钟过渡。',
      },
      questSuggestions: [{
        type: 'main', title: '会议后留十分钟过渡', why: '给心力恢复留出空间。',
        minimumVersion: '十分钟不打开新工作。', estimatedMinutes: 10, difficulty: 'light',
        primaryState: 'mental', growthBranchId: null, sourceGoalId: null, isRecovery: true,
      }],
      memoryCandidates: [{
        type: 'constraint', statement: '会议密集日的晚间可用注意力可能较低。', confidence: 'low',
        supportingEventIds: ['event-1'], counterEvidence: [], recommendedAction: 'observe',
      }],
    },
    warnings: [],
  };
}

test('daily request accepts only the documented privacy envelope', () => {
  assert.deepEqual(parseDailyAnalysisRequest(validRequest()), validRequest());
  const unknown = structuredClone(validRequest());
  unknown.deviceId = 'must-not-leave-device';
  assert.throws(() => parseDailyAnalysisRequest(unknown), /未知字段/);
});

test('request time zones accept UTC and reject unknown IANA identifiers', () => {
  const utc = validRequest();
  utc.timeZone = 'UTC';
  assert.equal(parseDailyAnalysisRequest(utc).timeZone, 'UTC');
  const invalid = validRequest();
  invalid.timeZone = 'Unknown/Nowhere';
  assert.throws(() => parseDailyAnalysisRequest(invalid), /时区无效/);
});

test('disabled context permissions require their payloads to be empty', () => {
  const daily = validRequest();
  daily.permissions.includeGoals = false;
  assert.throws(() => parseDailyAnalysisRequest(daily), /对应.*上下文必须为空/);

  const weekly = weeklyRequest();
  weekly.permissions.includeHabits = false;
  assert.throws(() => parseWeeklyReviewRequest(weekly), /对应.*上下文必须为空/);
});

test('daily request rejects oversized combined text without truncating it', () => {
  const request = validRequest();
  request.userInput.entries = [
    { entryId: 'entry-1', revision: 1, text: '甲'.repeat(11_000) },
    { entryId: 'entry-2', revision: 1, text: '乙'.repeat(10_000) },
  ];
  request.permissions.entryIds = ['entry-1', 'entry-2'];
  assert.throws(() => parseDailyAnalysisRequest(request), /INPUT_TOO_LARGE/);
});

test('valid daily response keeps facts, inferences, evidence, and candidates separate', () => {
  const parsed = parseDailyAnalysisResponse(validResponse(), parseDailyAnalysisRequest(validRequest()));
  assert.equal(parsed.result.events[0].confirmation, 'confirmed_by_default');
  assert.equal(parsed.result.events[1].confirmation, 'pending');
  assert.equal(parsed.result.questSuggestions[0].primaryState, 'mental');
  assert.equal(parsed.result.memoryCandidates[0].recommendedAction, 'observe');
});

test('evidence positions use Unicode characters and must reproduce the exact quote', () => {
  const response = validResponse();
  response.result.events[0].evidence[0].start += 1;
  assert.throws(() => parseDailyAnalysisResponse(response, parseDailyAnalysisRequest(validRequest())), /原文与字符位置不一致/);
});

test('inferences cannot arrive pre-confirmed and every event needs evidence', () => {
  const confirmedInference = validResponse();
  confirmedInference.result.events[1].confirmation = 'confirmed_by_default';
  assert.throws(() => parseDailyAnalysisResponse(confirmedInference, parseDailyAnalysisRequest(validRequest())), /默认确认状态/);

  const noEvidence = validResponse();
  noEvidence.result.events[0].evidence = [];
  assert.throws(() => parseDailyAnalysisResponse(noEvidence, parseDailyAnalysisRequest(validRequest())), /至少需要一条证据/);
});

test('state direction, strength, and numeric delta must agree', () => {
  const response = validResponse();
  response.result.events[0].stateImpactCandidates[0].suggestedDelta = 10;
  assert.throws(() => parseDailyAnalysisResponse(response, parseDailyAnalysisRequest(validRequest())), /方向或强度/);
});

test('model output cannot add final XP, auto-confirmed memory, or unknown fields', () => {
  const response = validResponse();
  response.result.finalXp = 999;
  assert.throws(() => parseDailyAnalysisResponse(response, parseDailyAnalysisRequest(validRequest())), /未知字段/);
});

test('model JSON parser removes reasoning and a single JSON fence', () => {
  assert.deepEqual(parseModelJson('<think>private reasoning</think>\n```json\n{"ok":true}\n```'), { ok: true });
  assert.throws(() => parseModelJson('not json'), /可解析的 JSON/);
});

test('task feedback stays a user-confirmed candidate with exact evidence', () => {
  const request = parseTaskFeedbackRequest({
    contractVersion: '1.0', operation: 'task_feedback', requestId: 'feedback-1', locale: 'zh-CN',
    timeZone: 'Asia/Shanghai', localDate: '2026-08-14',
    userInput: {
      questId: 'quest-1', questTitle: '整理需求', minimumAction: '列出三条需求', currentDifficulty: 'standard',
      feedbackText: '我只做了前半部分，但把需求列清楚了。',
    },
    permissions: { questId: 'quest-1' },
  });
  const parsed = parseTaskFeedbackResponse({
    contractVersion: '1.0', requestId: 'feedback-1', operation: 'task_feedback',
    result: {
      completionCandidate: 'partial', actualResult: '完成了前半部分，并产出需求清单。',
      evidenceQuote: '只做了前半部分', suggestedDifficultyCorrection: 'light', followUpQuestion: null, confidence: 'high',
    },
    warnings: [],
  }, request);
  assert.equal(parsed.result.completionCandidate, 'partial');
  assert.equal(parsed.result.suggestedDifficultyCorrection, 'light');

  const invalid = structuredClone(parsed);
  invalid.result.evidenceQuote = '模型自己编的证据';
  assert.throws(() => parseTaskFeedbackResponse(invalid, request), /不在用户原文/);
});

test('unclear task feedback asks exactly one necessary question', () => {
  const request = parseTaskFeedbackRequest({
    contractVersion: '1.0', operation: 'task_feedback', requestId: 'feedback-2', locale: 'zh-CN',
    timeZone: 'Asia/Shanghai', localDate: '2026-08-14',
    userInput: { questId: 'quest-2', questTitle: '散步', minimumAction: '走两分钟', currentDifficulty: 'light', feedbackText: '差不多吧' },
    permissions: { questId: 'quest-2' },
  });
  const response = {
    contractVersion: '1.0', requestId: 'feedback-2', operation: 'task_feedback',
    result: {
      completionCandidate: 'unclear', actualResult: '完成情况不明确。', evidenceQuote: '差不多吧',
      suggestedDifficultyCorrection: null, followUpQuestion: '你实际做了这个动作的一部分吗？', confidence: 'low',
    }, warnings: [],
  };
  assert.equal(parseTaskFeedbackResponse(response, request).result.followUpQuestion, '你实际做了这个动作的一部分吗？');
  response.result.followUpQuestion = null;
  assert.throws(() => parseTaskFeedbackResponse(response, request), /必要追问/);
});

function weeklyRequest() {
  return {
    contractVersion: '1.0', operation: 'weekly_review', requestId: 'weekly-1', locale: 'zh-CN', timeZone: 'Asia/Shanghai',
    period: { start: '2026-08-10', end: '2026-08-14' }, userInput: { note: '周三临时加班。' },
    context: {
      events: [
        { eventId: 'event-a', version: 1, localDate: '2026-08-11', title: '午间散步', description: '走了十分钟。' },
        { eventId: 'event-b', version: 2, localDate: '2026-08-13', title: '晚间散步', description: '走了十五分钟。' },
      ],
      stateSnapshots: [{ localDate: '2026-08-11', values: { energy: 55 } }],
      taskResults: [{ questId: 'quest-1', localDate: '2026-08-11', title: '散步', result: 'completed', actual: '走了十分钟。' }],
      habits: [{ habitId: 'habit-1', name: '散步', minimumAction: '走两分钟', momentum: 4 }],
      growth: [{ branchId: 'branch-1', name: '健康实践', xp: 20 }],
      goals: [{ goalId: 'goal-1', result: '保持可持续节奏', role: 'main' }], experiments: [], memories: [],
    },
    permissions: {
      eventIds: ['event-a', 'event-b'], includeStateSnapshots: true, includeTaskResults: true, includeHabits: true,
      includeGrowth: true, includeGoals: true, includeExperiments: true, memoryIds: [],
    },
  };
}

function weeklyResponse() {
  return {
    contractVersion: '1.0', requestId: 'weekly-1', operation: 'weekly_review',
    result: {
      stateTrends: [{
        dimension: 'energy', direction: 'up', summary: '两次散步都与能量恢复同时出现。', evidenceEventIds: ['event-a', 'event-b'],
        evidenceDates: ['2026-08-11', '2026-08-13'], relationship: 'correlation',
      }],
      recurringBenefits: [], recurringCosts: [],
      growthDeposits: [{ branchId: 'branch-1', branchName: '健康实践', summary: '完成两次可核对行动。', evidenceEventIds: ['event-a', 'event-b'] }],
      habitDecisions: [{ habitId: 'habit-1', action: 'keep', reason: '当前最小动作仍可持续。' }],
      nextWeekTheme: { title: '保护恢复节奏', reason: '继续验证低成本散步是否稳定有益。' },
      nextExperiment: { hypothesis: '午后短走有助于恢复。', minimumAction: '午后走两分钟。', metric: '记录开始次数和主观能量。', endDate: '2026-08-21', stopCondition: '连续三天增加明显负担。' },
      systemCandidates: [{ type: 'preference', statement: '短走可能适合作为恢复动作。', confidence: 'low', supportingEventIds: ['event-a', 'event-b'], counterEvidence: [], recommendedAction: 'observe' }],
    }, warnings: [],
  };
}

test('weekly review sends summaries instead of raw journals and keeps one theme and experiment', () => {
  const request = parseWeeklyReviewRequest(weeklyRequest());
  assert.equal('entries' in request.userInput, false);
  const response = parseWeeklyReviewResponse(weeklyResponse(), request);
  assert.equal(response.result.nextWeekTheme.title, '保护恢复节奏');
  assert.equal(response.result.nextExperiment.minimumAction, '午后走两分钟。');
  assert.equal(response.result.habitDecisions[0].action, 'keep');
});

test('weekly trends need evidence from two dates or an explicit insufficient-evidence statement', () => {
  const request = parseWeeklyReviewRequest(weeklyRequest());
  const response = weeklyResponse();
  response.result.stateTrends[0].evidenceEventIds = ['event-a'];
  response.result.stateTrends[0].evidenceDates = ['2026-08-11'];
  assert.throws(() => parseWeeklyReviewResponse(response, request), /尚不足以判断趋势/);
  response.result.stateTrends[0].summary = '尚不足以判断趋势；只有一天证据。';
  response.result.stateTrends[0].direction = 'unknown';
  assert.equal(parseWeeklyReviewResponse(response, request).result.stateTrends[0].direction, 'unknown');
});

test('system candidate review can only suggest type-safe user-confirmed merges', () => {
  const request = parseSystemCandidateReviewRequest({
    contractVersion: '1.0', operation: 'system_candidate_review', requestId: 'memory-review-1', locale: 'zh-CN', timeZone: 'Asia/Shanghai',
    userInput: { candidates: [
      { memoryId: 'memory-a', version: 1, type: 'constraint', statement: '高负荷后需要过渡。', evidenceEvents: [], counterEvidence: [], confidence: 'low', status: 'candidate' },
      { memoryId: 'memory-b', version: 2, type: 'constraint', statement: '会议后适合留十分钟。', evidenceEvents: [], counterEvidence: [], confidence: 'low', status: 'confirmed' },
    ] }, permissions: { memoryIds: ['memory-a', 'memory-b'] },
  });
  const response = parseSystemCandidateReviewResponse({
    contractVersion: '1.0', requestId: 'memory-review-1', operation: 'system_candidate_review',
    result: { groups: [{ candidateMemoryIds: ['memory-a', 'memory-b'], action: 'merge', mergedStatement: '高负荷后可能需要十分钟过渡。', reason: '陈述和证据方向相近。', confidence: 'low' }] }, warnings: [],
  }, request);
  assert.equal(response.result.groups[0].action, 'merge');
  assert.equal('status' in response.result.groups[0], false);

  const duplicate = structuredClone(response);
  duplicate.result.groups.push({ ...duplicate.result.groups[0], action: 'keep_separate', mergedStatement: null });
  assert.throws(() => parseSystemCandidateReviewResponse(duplicate, request), /多个分组/);
});

test('goal decomposition stays a bounded editable draft with matching memory permission', () => {
  const request = parseGoalDecompositionRequest({
    contractVersion: '1.0', operation: 'goal_decomposition', requestId: 'goal-plan-1', locale: 'zh-CN', timeZone: 'Asia/Shanghai',
    userInput: { result: '发布一篇可阅读的文章', why: '把经验整理成作品', completionEvidence: '文章获得公开链接' },
    context: {
      area: { areaId: 'area-1', name: '创造与作品', mode: 'build' },
      branch: { branchId: 'branch-1', name: '写作实践' },
      memories: [{ memoryId: 'memory-1', type: 'constraint', statement: '长时间连续写作容易耗尽注意力。' }],
    },
    permissions: { memoryIds: ['memory-1'] },
  });
  const response = parseGoalDecompositionResponse({
    contractVersion: '1.0', requestId: request.requestId, operation: 'goal_decomposition',
    result: {
      refinedResult: '发布一篇有公开链接的文章', completionEvidence: '文章可以通过公开链接阅读', rationale: '先形成初稿，再用一次反馈修订。',
      milestones: [
        { title: '完成文章初稿', evidence: '保存一份包含开头、正文和结尾的初稿。' },
        { title: '完成一次反馈修订', evidence: '保留反馈和修订后的版本。' },
      ],
      nextStep: { title: '列出文章结构', why: '先降低开始成本', minimumAction: '只列三个要点', estimatedMinutes: 15, difficulty: 'light' },
      assumptions: ['当前没有明确截止日期。'],
    }, warnings: [],
  }, request);
  assert.equal(response.result.milestones.length, 2);
  assert.equal(response.result.nextStep.minimumAction, '只列三个要点');

  const unauthorized = structuredClone(request);
  unauthorized.permissions.memoryIds = [];
  assert.throws(() => parseGoalDecompositionRequest(unauthorized), /权限与系统记忆范围不一致/);
  const tooLarge = structuredClone(response);
  tooLarge.result.nextStep.estimatedMinutes = 241;
  assert.throws(() => parseGoalDecompositionResponse(tooLarge, request), /预计时间/);
});
