import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeDirectWithBridge } from '../src/direct-ai.ts';

function goalRequest(result = '发布一篇文章') {
  return {
    contractVersion: '1.0', operation: 'goal_decomposition', requestId: 'direct-goal-1', locale: 'zh-CN', timeZone: 'Asia/Shanghai',
    userInput: { result, why: '沉淀经验', completionEvidence: '文章有可访问链接' },
    context: {
      area: { areaId: 'area-1', name: '创造与作品', mode: 'build' },
      branch: { branchId: 'branch-1', name: '写作实践' }, currentGoals: [], executionEvidence: [], memories: [],
    }, permissions: { memoryIds: [], questIds: [], goalIds: [] },
  };
}

function validGoalResponse(request) {
  return {
    contractVersion: '1.0', requestId: request.requestId, operation: request.operation,
    result: {
      refinedResult: request.userInput.result,
      completionEvidence: request.userInput.completionEvidence,
      rationale: request.userInput.why,
      currentStage: '尚未开始', estimatedInvestment: '约两周，每周两小时', risks: [],
      milestones: [
        { title: '完成初稿', evidence: '保存一份可阅读初稿' },
        { title: '完成发布', evidence: '得到一个可访问链接' },
      ],
      nextStep: { title: '列出文章结构', why: '降低开始成本', minimumAction: '写三个标题', estimatedMinutes: 15, difficulty: 'light' },
      assumptions: [],
    }, warnings: [],
  };
}

test('personal direct AI validates, repairs once, and scopes a custom key to the native bridge payload', async () => {
  const request = goalRequest();
  const payloads = [];
  const bridge = {
    async request({ payload }) {
      payloads.push(payload);
      const content = payloads.length === 1 ? '{}' : JSON.stringify(validGoalResponse(request));
      return { status: 200, data: JSON.stringify({ choices: [{ message: { content } }] }) };
    },
  };
  const response = await analyzeDirectWithBridge(request, bridge, 'MiniMax-M2.7', 'custom-local-key');
  assert.equal(response.result.refinedResult, request.userInput.result);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].model, 'MiniMax-M2.7');
  assert.equal(payloads[0].apiKey, 'custom-local-key');
  assert.equal(JSON.stringify(payloads[0].messages).includes('custom-local-key'), false);
  assert.equal(payloads[1].messages.length, 4, 'second attempt must include contract repair context');
  assert(!JSON.stringify(payloads).includes('Authorization'));
  assert(!JSON.stringify(payloads).includes('MINIMAX_API_KEY'));
});

test('personal direct AI blocks immediate danger before invoking the model bridge', async () => {
  let calls = 0;
  const bridge = { async request() { calls += 1; throw new Error('must not run'); } };
  await assert.rejects(() => analyzeDirectWithBridge(goalRequest('我现在想自杀'), bridge), (error) => error.code === 'SAFETY_REVIEW');
  assert.equal(calls, 0);
});

test('model ingress repairs only provable evidence coordinates and optional metadata', async () => {
  const request = {
    contractVersion: '1.0', operation: 'daily_analysis', requestId: 'direct-daily-1', locale: 'zh-CN', timeZone: 'Asia/Shanghai', localDate: '2026-08-20',
    userInput: { entries: [{ entryId: 'entry-1', revision: 1, text: '😀今天早晨写作很顺利。' }] },
    context: {
      confirmedEvents: [], recentStates: [], goals: [], bonusHabits: [], constraints: [],
      memories: [{ memoryId: 'memory-1', type: 'pattern', statement: '早晨通常不适合写作' }],
    },
    permissions: { entryIds: ['entry-1'], includeConfirmedEvents: false, includeRecentStates: false, includeGoals: false, includeBonusHabits: false, memoryIds: ['memory-1'] },
  };
  const response = {
    contractVersion: '1.0', requestId: request.requestId, operation: request.operation,
    result: {
      title: '早晨写作顺利', summary: '今天早晨写作顺利。', explicitMoods: [],
      events: [{
        candidateId: 'event-1', title: '早晨写作', description: '早晨写作顺利。', sourceType: 'explicit', confirmation: 'confirmed_by_default', confidence: 'high',
        evidence: [{ entryId: 'entry-1', quote: '今天早晨写作很顺利。', start: 99, end: 100 }], stateImpactCandidates: [], growthEvidenceCandidate: null,
      }],
      reflection: { whatHappened: '早晨写作顺利。', specificCredit: '完成了写作。', patternCandidate: null },
      questSuggestions: [{ type: 'side', title: '继续写', why: '保持推进', minimumVersion: '', estimatedMinutes: 10, difficulty: 'light', primaryState: 'progress', growthBranchId: null, sourceGoalId: null, isRecovery: false }],
      memoryCandidates: [{ type: 'pattern', statement: '早晨写作效果可能取决于条件。', confidence: 'low', supportingEventIds: ['event-1'], counterEvidence: [{ memoryId: 'memory-1' }], recommendedAction: 'observe', description: '模型多给的字段' }],
    }, warnings: [],
  };
  response.result.events.push({ ...structuredClone(response.result.events[0]), candidateId: 'event-duplicate' });
  const bridge = { async request() { return { status: 200, data: JSON.stringify({ choices: [{ message: { content: `结果如下：${JSON.stringify(response)}` } }] }) }; } };
  const parsed = await analyzeDirectWithBridge(request, bridge);
  assert.deepEqual(parsed.result.events[0].evidence[0], { entryId: 'entry-1', quote: '今天早晨写作很顺利。', start: 1, end: 11 });
  assert.equal(parsed.result.events.length, 1);
  assert.equal(parsed.result.questSuggestions.length, 0);
  assert.equal(parsed.result.reflection.nextSmallStep, '暂不额外安排。');
  assert.deepEqual(parsed.result.memoryCandidates[0].counterEvidence, ['memory-1']);
  assert.equal('description' in parsed.result.memoryCandidates[0], false);
});
