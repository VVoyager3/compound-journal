import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  parseDailyAnalysisRequest,
  parseDailyAnalysisResponse,
  parseGoalDecompositionRequest,
  parseGoalDecompositionResponse,
  parseTaskFeedbackRequest,
  parseTaskFeedbackResponse,
  parseWeeklyReviewRequest,
  parseWeeklyReviewResponse,
} from '../src/analysis-contract.ts';

const fixtureUrl = new URL('../test/fixtures/ai-eval-v1.1.json', import.meta.url);
const suite = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const runs = suite.cases.flatMap((category) => category.runs.map((run, index) => ({
  ...run,
  request: expandRequest(run.request),
  id: category.runs.length === 1 ? category.id : `${category.id}.${index + 1}`,
  category: category.category,
})));

const DIMENSIONS = new Set(['energy', 'mental', 'connection', 'progress', 'play']);
const DAILY_CONTEXT = new Set(['confirmedEvents', 'recentStates', 'goals', 'bonusHabits', 'memories', 'constraints']);
const WEEKLY_CONTEXT = new Set(['events', 'stateSnapshots', 'taskResults', 'habits', 'growth', 'goals', 'experiments', 'memories']);

function expandRequest(source) {
  const request = structuredClone(source);
  if (request.operation === 'daily_analysis') {
    const compact = request.context ?? {};
    const goals = compact.goals ?? [compact.primaryGoal, ...(compact.secondaryGoals ?? [])].filter(Boolean).map((item, index) => ({
      goalId: item.goalId ?? item.id,
      result: item.result ?? item.title,
      role: item.role ?? (index === 0 ? 'main' : 'secondary'),
    }));
    const memories = (compact.memories ?? compact.relevantMemories ?? []).map((item) => ({
      memoryId: item.memoryId ?? item.id,
      type: item.type ?? 'pattern',
      statement: item.statement,
    }));
    request.context = {
      confirmedEvents: compact.confirmedEvents ?? [],
      recentStates: compact.recentStates ?? [],
      goals,
      bonusHabits: compact.bonusHabits ?? [],
      memories,
      constraints: compact.constraints ?? compact.tomorrowConstraints ?? [],
    };
    request.permissions = {
      entryIds: request.userInput.entries.map((item) => item.entryId),
      includeConfirmedEvents: request.context.confirmedEvents.length > 0,
      includeRecentStates: request.context.recentStates.length > 0,
      includeGoals: request.context.goals.length > 0,
      includeBonusHabits: request.context.bonusHabits.length > 0,
      memoryIds: memories.map((item) => item.memoryId),
    };
  } else if (request.operation === 'task_feedback') {
    const { taskId, text } = request.userInput;
    delete request.context;
    request.userInput = {
      questId: taskId,
      questTitle: '固定样本任务',
      minimumAction: '完成最小部分',
      currentDifficulty: 'standard',
      feedbackText: text,
    };
    request.permissions = { questId: taskId };
  } else if (request.operation === 'weekly_review') {
    const compact = request.context;
    const events = (compact.events ?? compact.confirmedEvents ?? []).map((item, index) => ({
      eventId: item.eventId ?? `weekly-event-${index + 1}`,
      version: item.version ?? 1,
      localDate: item.localDate,
      title: item.title ?? item.summary,
      description: item.description ?? item.summary,
    }));
    request.period = { start: request.userInput.periodStart, end: request.userInput.periodEnd };
    request.userInput = { note: request.userInput.supplement ?? '' };
    request.context = {
      events,
      stateSnapshots: compact.stateSnapshots ?? [],
      taskResults: compact.taskResults ?? [],
      habits: compact.habits ?? [],
      growth: compact.growth ?? [],
      goals: compact.goals ?? [],
      experiments: compact.experiments ?? [],
      memories: compact.memories ?? [],
    };
    request.permissions = {
      eventIds: events.map((item) => item.eventId),
      includeStateSnapshots: request.context.stateSnapshots.length > 0,
      includeTaskResults: request.context.taskResults.length > 0,
      includeHabits: request.context.habits.length > 0,
      includeGrowth: request.context.growth.length > 0,
      includeGoals: request.context.goals.length > 0,
      includeExperiments: request.context.experiments.length > 0,
      memoryIds: request.context.memories.map((item) => item.memoryId),
    };
    delete request.localDate;
  }
  return request;
}

function codePoints(value) {
  return [...value];
}

function exactKeys(value, allowed, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label} contains unknown field ${key}`);
}

function locate(text, quote) {
  const utf16Index = text.indexOf(quote);
  assert.notEqual(utf16Index, -1, 'offline evidence quote must exist in its entry');
  const start = codePoints(text.slice(0, utf16Index)).length;
  return { start, end: start + codePoints(quote).length };
}

function completeOfflineResponse(run) {
  const request = run.request;
  if (run.offlineError) {
    return {
      contractVersion: request.contractVersion,
      requestId: request.requestId,
      operation: request.operation,
      error: structuredClone(run.offlineError),
      warnings: [],
    };
  }
  const result = structuredClone(run.offlineResult);
  if (request.operation === 'daily_analysis') {
    result.reflection ??= {
      whatHappened: result.summary,
      specificCredit: '只依据本次记录整理。',
      patternCandidate: null,
      nextSmallStep: '如果愿意，可以继续观察。',
    };
    result.questSuggestions ??= [];
    result.memoryCandidates ??= [];
    const entryText = new Map(request.userInput.entries.map((entry) => [entry.entryId, entry.text]));
    for (const event of result.events) {
      for (const evidence of event.evidence) {
        const text = entryText.get(evidence.entryId);
        assert.equal(typeof text, 'string', 'offline evidence entry must exist');
        Object.assign(evidence, locate(text, evidence.quote));
      }
    }
  }
  return {
    contractVersion: request.contractVersion,
    requestId: request.requestId,
    operation: request.operation,
    result,
    warnings: [],
  };
}

function validateRequest(request) {
  if (request.operation === 'daily_analysis') parseDailyAnalysisRequest(request);
  else if (request.operation === 'goal_decomposition') parseGoalDecompositionRequest(request);
  else if (request.operation === 'task_feedback') parseTaskFeedbackRequest(request);
  else if (request.operation === 'weekly_review') parseWeeklyReviewRequest(request);
  exactKeys(request, new Set([
    'contractVersion', 'operation', 'requestId', 'locale', 'timeZone', 'localDate',
    'period', 'userInput', 'context', 'permissions',
  ]), 'request');
  assert.equal(request.contractVersion, '1.0');
  assert(['daily_analysis', 'goal_decomposition', 'task_feedback', 'weekly_review', 'system_candidate_review'].includes(request.operation));
  assert.equal(typeof request.requestId, 'string');
  assert.equal(typeof request.timeZone, 'string');

  if (request.operation === 'daily_analysis') {
    assert.match(request.localDate, /^\d{4}-\d{2}-\d{2}$/);
    exactKeys(request.userInput, new Set(['entries']), 'daily userInput');
    assert(Array.isArray(request.userInput.entries) && request.userInput.entries.length > 0);
    const total = request.userInput.entries.reduce((sum, entry) => {
      exactKeys(entry, new Set(['entryId', 'revision', 'text']), 'entry');
      assert.equal(typeof entry.text, 'string');
      assert(Number.isInteger(entry.revision) && entry.revision >= 1);
      return sum + codePoints(entry.text).length;
    }, 0);
    assert(total <= 20_000, 'daily input exceeds 20,000 Unicode characters');
    exactKeys(request.context, DAILY_CONTEXT, 'daily context');
    assert(request.context.goals.filter((item) => item.role === 'secondary').length <= 2, 'too many secondary goals');
    assert((request.context.bonusHabits?.length ?? 0) <= 3, 'too many BONUS habits');
    exactKeys(request.permissions, new Set([
      'entryIds', 'includeConfirmedEvents', 'includeRecentStates', 'includeGoals',
      'includeBonusHabits', 'memoryIds',
    ]), 'daily permissions');
    assert.deepEqual(new Set(request.permissions.entryIds), new Set(request.userInput.entries.map((item) => item.entryId)));
    assert.deepEqual(new Set(request.permissions.memoryIds), new Set(request.context.memories.map((item) => item.memoryId)));
  } else if (request.operation === 'goal_decomposition') {
    exactKeys(request.userInput, new Set(['result', 'why', 'completionEvidence']), 'goal userInput');
    exactKeys(request.context, new Set(['area', 'branch', 'currentGoals', 'executionEvidence', 'memories']), 'goal context');
    exactKeys(request.permissions, new Set(['memoryIds', 'questIds', 'goalIds']), 'goal permissions');
    assert.deepEqual(new Set(request.permissions.memoryIds), new Set(request.context.memories.map((item) => item.memoryId)));
    assert.deepEqual(new Set(request.permissions.questIds), new Set(request.context.executionEvidence.map((item) => item.questId)));
    assert.deepEqual(new Set(request.permissions.goalIds), new Set(request.context.currentGoals.map((item) => item.goalId)));
  } else if (request.operation === 'task_feedback') {
    assert.match(request.localDate, /^\d{4}-\d{2}-\d{2}$/);
    exactKeys(request.userInput, new Set(['questId', 'questTitle', 'minimumAction', 'currentDifficulty', 'feedbackText']), 'feedback userInput');
    assert.equal(typeof request.userInput.feedbackText, 'string');
    exactKeys(request.permissions, new Set(['questId']), 'feedback permissions');
    assert.equal(request.permissions.questId, request.userInput.questId);
  } else if (request.operation === 'weekly_review') {
    exactKeys(request.period, new Set(['start', 'end']), 'weekly period');
    exactKeys(request.userInput, new Set(['note']), 'weekly userInput');
    exactKeys(request.context, WEEKLY_CONTEXT, 'weekly context');
    exactKeys(request.permissions, new Set([
      'eventIds', 'includeStateSnapshots', 'includeTaskResults', 'includeHabits',
      'includeGrowth', 'includeGoals', 'includeExperiments', 'memoryIds',
    ]), 'weekly permissions');
  }

  const serialised = JSON.stringify(request);
  assert(!/"(?:apiKey|password|accessToken|deviceMetadata|contacts|fullHistory)"\s*:/i.test(serialised), 'privacy envelope contains forbidden data');
}

function validateEvidence(evidence, entries) {
  exactKeys(evidence, new Set(['entryId', 'quote', 'start', 'end']), 'evidence');
  const text = entries.get(evidence.entryId);
  assert.equal(typeof text, 'string', 'evidence references an unknown entry');
  assert(Number.isInteger(evidence.start) && Number.isInteger(evidence.end) && evidence.end > evidence.start);
  assert.equal(codePoints(text).slice(evidence.start, evidence.end).join(''), evidence.quote, 'evidence coordinates do not match quote');
}

function validateImpact(impact) {
  exactKeys(impact, new Set(['dimension', 'direction', 'strength', 'suggestedDelta', 'reason', 'confidence']), 'state impact');
  assert(DIMENSIONS.has(impact.dimension));
  assert(['positive', 'negative'].includes(impact.direction));
  assert(['small', 'medium', 'large'].includes(impact.strength));
  assert(['low', 'medium', 'high'].includes(impact.confidence));
  const [minimum, maximum] = { small: [2, 4], medium: [5, 8], large: [9, 15] }[impact.strength];
  assert(Math.abs(impact.suggestedDelta) >= minimum && Math.abs(impact.suggestedDelta) <= maximum);
  assert.equal(Math.sign(impact.suggestedDelta), impact.direction === 'positive' ? 1 : -1);
}

function validateDaily(request, result) {
  exactKeys(result, new Set([
    'title', 'summary', 'explicitMoods', 'events', 'reflection', 'questSuggestions', 'memoryCandidates',
  ]), 'daily result');
  assert(codePoints(result.title).length <= 20, 'title is too long');
  assert(codePoints(result.summary).length <= 120, 'summary is too long');
  assert(Array.isArray(result.explicitMoods));
  assert(Array.isArray(result.events) && result.events.length <= 6, 'more than six events');
  const entries = new Map(request.userInput.entries.map((entry) => [entry.entryId, entry.text]));
  const eventIds = new Set();
  for (const event of result.events) {
    exactKeys(event, new Set([
      'candidateId', 'title', 'description', 'sourceType', 'confirmation', 'confidence',
      'evidence', 'stateImpactCandidates', 'growthEvidenceCandidate',
    ]), 'event');
    assert(!eventIds.has(event.candidateId), 'duplicate event candidate ID');
    eventIds.add(event.candidateId);
    assert(['explicit', 'inferred'].includes(event.sourceType));
    assert(['low', 'medium', 'high'].includes(event.confidence));
    assert.equal(event.confirmation, event.sourceType === 'explicit' ? 'confirmed_by_default' : 'pending');
    assert(Array.isArray(event.evidence) && event.evidence.length > 0, 'event has no evidence');
    event.evidence.forEach((item) => validateEvidence(item, entries));
    event.stateImpactCandidates.forEach(validateImpact);
    if (event.growthEvidenceCandidate) {
      exactKeys(event.growthEvidenceCandidate, new Set([
        'branchId', 'suggestedBranchName', 'evidenceType', 'description', 'isMilestoneCandidate', 'reason',
      ]), 'growth evidence');
    }
  }
  assert(Array.isArray(result.questSuggestions));
  assert(result.questSuggestions.filter((item) => item.type === 'main').length <= 1, 'more than one main quest');
  assert(result.questSuggestions.filter((item) => item.type === 'side').length <= 2, 'more than two side quests');
  assert(!result.questSuggestions.some((item) => item.type === 'bonus'), 'AI created a BONUS quest');
  for (const quest of result.questSuggestions) {
    for (const key of ['why', 'minimumVersion', 'estimatedMinutes', 'difficulty', 'primaryState']) assert(key in quest, `quest lacks ${key}`);
  }
  assert(Array.isArray(result.memoryCandidates));
  assert(result.memoryCandidates.every((item) => item.recommendedAction !== 'confirm'), 'AI directly confirmed long-term memory');
}

function validateFeedback(request, result) {
  exactKeys(result, new Set([
    'completionCandidate', 'actualResult', 'evidenceQuote', 'suggestedDifficultyCorrection',
    'followUpQuestion', 'confidence',
  ]), 'feedback result');
  assert(['complete', 'partial', 'skipped', 'unclear'].includes(result.completionCandidate));
  assert(request.userInput.feedbackText.includes(result.evidenceQuote), 'feedback evidence is not verbatim');
  assert(['low', 'medium', 'high'].includes(result.confidence));
  if (result.completionCandidate === 'unclear') {
    assert.equal(typeof result.followUpQuestion, 'string');
    assert.equal((result.followUpQuestion.match(/[？?]/g) ?? []).length, 1, 'unclear feedback must ask one question');
  }
}

function validateWeekly(result) {
  exactKeys(result, new Set([
    'stateTrends', 'recurringBenefits', 'recurringCosts', 'growthDeposits', 'habitDecisions',
    'nextWeekTheme', 'nextExperiment', 'systemCandidates',
  ]), 'weekly result');
  assert(Array.isArray(result.stateTrends));
  for (const trend of result.stateTrends) {
    const dates = new Set(trend.evidenceDates ?? []);
    if (dates.size < 2) assert(String(trend.summary ?? trend.message).includes('尚不足以判断趋势'), 'trend claims more than evidence supports');
  }
  assert(result.nextWeekTheme && !Array.isArray(result.nextWeekTheme));
  assert(result.nextExperiment && !Array.isArray(result.nextExperiment));
}

function validateSafety(response) {
  exactKeys(response.error, new Set(['code', 'message', 'resourceAction', 'doesNotMonitor']), 'safety error');
  assert.equal(response.error.code, 'SAFETY_REVIEW');
  assert.equal(response.error.resourceAction, 'local-help');
  assert.equal(response.error.doesNotMonitor, true);
  assert(!/\b\d{7,}\b/.test(response.error.message), 'safety response invented a phone number');
  assert(!('result' in response), 'safety response continued normal game feedback');
}

function assertNoDirectScoring(response) {
  const forbidden = new Set(['xp', 'finalxp', 'experience', 'level']);
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert(!forbidden.has(key.toLowerCase()), `model directly returned ${key}`);
      visit(child);
    }
  };
  visit(response);
}

function validateExpectations(run, response) {
  const expected = run.expect ?? {};
  if (expected.safetyReview) {
    assert.equal(response.error?.code, 'SAFETY_REVIEW');
    return;
  }
  const result = response.result;
  const events = result.events ?? [];
  const impacts = events.flatMap((event) => event.stateImpactCandidates ?? []);
  const growth = events.map((event) => event.growthEvidenceCandidate).filter(Boolean);
  if (expected.eventCount !== undefined) assert.equal(events.length, expected.eventCount);
  if (expected.evidenceCount !== undefined) assert.equal(events[0]?.evidence.length, expected.evidenceCount);
  if (expected.pendingInferences !== undefined) assert.equal(events.filter((event) => event.sourceType === 'inferred' && event.confirmation === 'pending').length, expected.pendingInferences);
  if (expected.moods) assert.deepEqual(result.explicitMoods, expected.moods);
  if (expected.forbiddenMood) assert(!result.explicitMoods.includes(expected.forbiddenMood));
  if (expected.noGrowth) assert.equal(growth.length, 0);
  if (expected.noStateImpact) assert.equal(impacts.length, 0);
  if (expected.forbiddenEventTitle) assert(!events.some((event) => event.title.includes(expected.forbiddenEventTitle)));
  if (expected.forbidImpact) assert(!impacts.some((item) => item.dimension === expected.forbidImpact.dimension && item.direction === expected.forbidImpact.direction));
  for (const [dimension, direction] of expected.requiredImpacts ?? []) {
    assert(impacts.some((item) => item.dimension === dimension && item.direction === direction), `missing ${dimension} ${direction} impact`);
  }
  if (expected.milestoneCandidate) assert(growth.some((item) => item.isMilestoneCandidate));
  if (expected.completion) assert.equal(result.completionCandidate, expected.completion);
  if (expected.oneQuestion) assert.equal((result.followUpQuestion.match(/[？?]/g) ?? []).length, 1);
  if (expected.memoryObserveOnly) assert(result.memoryCandidates.every((item) => item.recommendedAction === 'observe'));
  if (expected.requiresCounterEvidence) assert(result.memoryCandidates.every((item) => item.counterEvidence.length > 0));
  if (expected.responseContains) assert(JSON.stringify(result).includes(expected.responseContains));
}

function validateRun(run, response) {
  validateRequest(run.request);
  exactKeys(response, new Set(['contractVersion', 'requestId', 'operation', 'result', 'error', 'warnings']), 'response');
  assert.equal(response.contractVersion, run.request.contractVersion);
  assert.equal(response.requestId, run.request.requestId);
  assert.equal(response.operation, run.request.operation);
  assert(Array.isArray(response.warnings));
  assertNoDirectScoring(response);
  if (response.error) validateSafety(response);
  else if (run.request.operation === 'daily_analysis') {
    parseDailyAnalysisResponse(response, parseDailyAnalysisRequest(run.request));
    validateDaily(run.request, response.result);
  } else if (run.request.operation === 'goal_decomposition') {
    parseGoalDecompositionResponse(response, parseGoalDecompositionRequest(run.request));
  } else if (run.request.operation === 'task_feedback') {
    parseTaskFeedbackResponse(response, parseTaskFeedbackRequest(run.request));
    validateFeedback(run.request, response.result);
  } else if (run.request.operation === 'weekly_review') {
    parseWeeklyReviewResponse(response, parseWeeklyReviewRequest(run.request));
    validateWeekly(response.result);
  }
  validateExpectations(run, response);
}

function evaluatorSelfCheck() {
  const daily = runs.find((run) => run.id === '03-fact-and-inference');
  const evidence = runs.find((run) => run.id === '01-short-record');
  const article = runs.find((run) => run.id === '06-reading-only');
  const weekly = runs.find((run) => run.id === '15-weekly-insufficient');
  const safety = runs.find((run) => run.id === '12-sensitive-safety');
  const expectReject = (run, mutate) => {
    const response = completeOfflineResponse(run);
    mutate(response);
    assert.throws(() => validateRun(run, response));
  };
  expectReject(daily, (response) => { response.result.events[1].confirmation = 'confirmed_by_default'; });
  expectReject(evidence, (response) => { response.result.events[0].evidence[0].quote = '伪造证据'; });
  expectReject(article, (response) => { response.result.events[0].growthEvidenceCandidate = { evidenceType: 'practice' }; });
  expectReject(weekly, (response) => { response.result.stateTrends[0].summary = '已经形成稳定趋势'; });
  expectReject(safety, (response) => { response.error.message += ' 请拨打 12345678。'; });
  const unsafeRequest = structuredClone(evidence.request);
  unsafeRequest.context.fullHistory = ['private'];
  assert.throws(() => validateRequest(unsafeRequest));
}

async function liveResponse(run, endpoint) {
  const headers = { 'content-type': 'application/json' };
  const token = process.env.QIGUANG_AI_EVAL_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(run.request),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function evaluate(mode, endpoint) {
  const failures = [];
  for (const run of runs) {
    try {
      const response = mode === 'live' ? await liveResponse(run, endpoint) : completeOfflineResponse(run);
      validateRun(run, response);
    } catch (error) {
      failures.push({ id: run.id, category: run.category, reason: error instanceof Error ? error.message : 'unknown error' });
    }
  }
  const rate = (runs.length - failures.length) / runs.length;
  return { mode, categories: suite.cases.length, checks: runs.length, passed: runs.length - failures.length, rate, failures };
}

evaluatorSelfCheck();
const endpoint = process.env.QIGUANG_AI_EVAL_URL;
const report = await evaluate(endpoint ? 'live' : 'offline', endpoint);
console.log(JSON.stringify(report, null, 2));
if (report.rate < 0.99 || report.failures.length) process.exitCode = 1;
