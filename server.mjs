import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANALYSIS_CONTRACT_VERSION,
  parseDailyAnalysisRequest,
  parseDailyAnalysisResponse,
  parseGoalDecompositionRequest,
  parseGoalDecompositionResponse,
  parseSystemCandidateReviewRequest,
  parseSystemCandidateReviewResponse,
  parseTaskFeedbackRequest,
  parseTaskFeedbackResponse,
  parseWeeklyReviewRequest,
  parseWeeklyReviewResponse,
} from './src/analysis-contract.ts';
import { analyzeWithModel, hasImmediateDangerSignal, modelPayload } from './src/ai-engine.ts';

export { hasImmediateDangerSignal, modelPayload };

const DIST_DIR = fileURLToPath(new URL('./dist/', import.meta.url));
const BODY_LIMIT = 256 * 1024;
const MODEL_TIMEOUT_MS = 45_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 5;
const IDEMPOTENCY_TTL_MS = 10 * 60_000;
const rates = new Map();
const completed = new Map();
const inFlight = new Map();

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};


function json(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  response.end(payload);
}

function fail(response, status, code, message, headers) {
  json(response, status, { error: { code, message } }, headers);
}

function appOriginAllowed(request) {
  const configured = String(process.env.QIGUANG_APP_ORIGIN ?? '').replace(/\/$/, '');
  return Boolean(configured && request.headers.origin === configured);
}

function clientAddress(request) {
  return `${request.socket.remoteAddress ?? 'unknown'}:${request.socket.localPort ?? 'unknown'}`;
}

function rateAllowed(key) {
  const now = Date.now();
  const recent = (rates.get(key) ?? []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    rates.set(key, recent);
    return false;
  }
  recent.push(now);
  rates.set(key, recent);
  return true;
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > BODY_LIMIT) {
      rejectBody(Object.assign(new Error('请求超过 256KB。'), { code: 'INPUT_TOO_LARGE' }));
      request.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        rejectBody(Object.assign(new Error('请求超过 256KB。'), { code: 'INPUT_TOO_LARGE' }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        rejectBody(new Error('请求不是有效 JSON。'));
      }
    });
    request.on('error', rejectBody);
  });
}


async function callModel(payload) {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw Object.assign(new Error('服务端尚未配置 MiniMax API 密钥。'), { code: 'SERVICE_UNAVAILABLE' });
  let endpoint;
  try {
    endpoint = new URL(process.env.MINIMAX_API_URL || 'https://api.minimaxi.com/v1/chat/completions');
  } catch {
    throw Object.assign(new Error('模型服务地址无效。'), { code: 'SERVICE_UNAVAILABLE' });
  }
  if (endpoint.protocol !== 'https:') throw Object.assign(new Error('模型服务地址必须使用 HTTPS。'), { code: 'SERVICE_UNAVAILABLE' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => null);
    if (response.status === 429) throw Object.assign(new Error('模型服务请求过快，请稍后再试。'), { code: 'RATE_LIMITED' });
    if (!response.ok) throw Object.assign(new Error('模型服务暂时不可用。'), { code: 'SERVICE_UNAVAILABLE', retryable: response.status >= 500 });
    if (raw?.input_sensitive === true) throw Object.assign(new Error('本次内容需要进入安全支持流程。'), { code: 'SAFETY_REVIEW' });
    const content = raw?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw Object.assign(new Error('模型没有返回可用内容。'), { code: 'INVALID_MODEL_OUTPUT' });
    return content;
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('模型响应超时。'), { code: 'MODEL_TIMEOUT', retryable: true });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function fixtureAnalysis(request) {
  const entry = request.userInput.entries[0];
  const characters = Array.from(entry.text);
  const firstLength = Math.min(6, characters.length);
  const secondLength = Math.min(7, characters.length);
  const secondStart = characters.length - secondLength;
  return {
    contractVersion: '1.0', requestId: request.requestId, operation: 'daily_analysis',
    result: {
      title: '测试整理结果', summary: characters.slice(0, 60).join(''), explicitMoods: [],
      events: [
        {
          candidateId: 'fixture-fact', title: '记录中的明确事件', description: '这条事件直接来自原文。',
          sourceType: 'explicit', confirmation: 'confirmed_by_default', confidence: 'high',
          evidence: [{ entryId: entry.entryId, quote: characters.slice(0, firstLength).join(''), start: 0, end: firstLength }],
          stateImpactCandidates: [{ dimension: 'energy', direction: 'negative', strength: 'small', suggestedDelta: -2, reason: '仅用于桌面测试确定性重算。', confidence: 'medium' }],
          growthEvidenceCandidate: null,
        },
        {
          candidateId: 'fixture-inference', title: '等待用户决定的推断', description: '这条推断确认前不会生效。',
          sourceType: 'inferred', confirmation: 'pending', confidence: 'low',
          evidence: [{ entryId: entry.entryId, quote: characters.slice(secondStart).join(''), start: secondStart, end: characters.length }],
          stateImpactCandidates: [{ dimension: 'mental', direction: 'positive', strength: 'small', suggestedDelta: 3, reason: '仅用于桌面测试确认流程。', confidence: 'low' }],
          growthEvidenceCandidate: null,
        },
      ],
      reflection: {
        whatHappened: '保留事实与推断的边界。', specificCredit: '留下了可核对的原始记录。',
        patternCandidate: { observation: '一次记录还不足以判断长期趋势。', evidenceCount: 1, neededEvidence: '还需要至少两天的独立证据。' },
        nextSmallStep: '明天安排十分钟低压力过渡。',
      },
      questSuggestions: [{
        type: 'main', title: '留十分钟过渡', why: '先观察低压力恢复是否有帮助。', minimumVersion: '十分钟不打开新工作。',
        estimatedMinutes: 10, difficulty: 'light', primaryState: 'mental', growthBranchId: null, sourceGoalId: null, isRecovery: true,
      }],
      memoryCandidates: [{
        type: 'constraint', statement: '高负荷之后可能需要过渡时间。', confidence: 'low',
        supportingEventIds: ['fixture-fact'], counterEvidence: [], recommendedAction: 'observe',
      }],
    },
    warnings: ['桌面测试夹具，不代表真实模型质量。'],
  };
}

function fixtureTaskFeedback(request) {
  const text = request.userInput.feedbackText;
  const partial = /一部分|前半|没做完|只做/u.test(text);
  const skipped = /没做|没有做|跳过|今天不做/u.test(text);
  const completionCandidate = skipped ? 'skipped' : partial ? 'partial' : 'complete';
  return {
    contractVersion: '1.0', requestId: request.requestId, operation: 'task_feedback',
    result: {
      completionCandidate,
      actualResult: text.slice(0, 500),
      evidenceQuote: text.slice(0, 500),
      suggestedDifficultyCorrection: partial ? 'light' : null,
      followUpQuestion: null,
      confidence: 'high',
    },
    warnings: ['桌面测试夹具，不代表真实模型质量。'],
  };
}

function fixtureWeeklyReview(request) {
  const firstEvent = request.context.events[0];
  const firstHabit = request.context.habits[0];
  const firstGrowth = request.context.growth[0];
  const end = new Date(`${request.period.end}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    contractVersion: '1.0', requestId: request.requestId, operation: 'weekly_review',
    result: {
      stateTrends: [{
        dimension: 'energy', direction: 'unknown', summary: '尚不足以判断趋势；继续观察不同日期的独立证据。',
        evidenceEventIds: firstEvent ? [firstEvent.eventId] : [], evidenceDates: firstEvent ? [firstEvent.localDate] : [], relationship: 'unknown',
      }],
      recurringBenefits: [], recurringCosts: [],
      growthDeposits: firstGrowth ? [{ branchId: firstGrowth.branchId, branchName: firstGrowth.name, summary: `本周记录了 ${firstGrowth.xp} XP 的现实行动。`, evidenceEventIds: [] }] : [],
      habitDecisions: firstHabit ? [{ habitId: firstHabit.habitId, action: 'keep', reason: '先维持当前最小动作，再观察一周。' }] : [],
      nextWeekTheme: { title: '保留可持续节奏', reason: '先用一周验证一个小变化。' },
      nextExperiment: { hypothesis: '更小的开始成本有助于持续行动。', minimumAction: '每天留出十分钟只做最小版本。', metric: '记录实际开始的天数。', endDate: end.toISOString().slice(0, 10), stopCondition: '连续三天明显增加负担时停止。' },
      systemCandidates: [],
    },
    warnings: ['桌面测试夹具，不代表真实模型质量。'],
  };
}

function fixtureSystemCandidateReview(request) {
  const byType = new Map();
  for (const candidate of request.userInput.candidates) {
    const values = byType.get(candidate.type) ?? [];
    values.push(candidate);
    byType.set(candidate.type, values);
  }
  const groups = [];
  for (const values of byType.values()) {
    if (values.length > 1) groups.push({
      candidateMemoryIds: values.map((item) => item.memoryId), action: 'merge',
      mergedStatement: values.map((item) => item.statement).join('；').slice(0, 500), reason: '同类型候选仅用于桌面测试合并流程。', confidence: 'low',
    });
    else groups.push({ candidateMemoryIds: [values[0].memoryId], action: 'keep_separate', mergedStatement: null, reason: '没有同类型候选。', confidence: 'high' });
  }
  return {
    contractVersion: '1.0', requestId: request.requestId, operation: 'system_candidate_review',
    result: { groups }, warnings: ['桌面测试夹具，不代表真实模型质量。'],
  };
}

function fixtureGoalDecomposition(request) {
  const replanning = request.context.executionEvidence.length > 0;
  return {
    contractVersion: '1.0', requestId: request.requestId, operation: 'goal_decomposition',
    result: {
      refinedResult: request.userInput.result,
      completionEvidence: request.userInput.completionEvidence || `留下一份可检查的“${request.userInput.result}”成果。`,
      rationale: replanning ? '根据真实执行反馈缩小原路径。' : '先用可验证的里程碑降低开始成本。',
      currentStage: replanning ? '已经尝试过原路径，正在根据反馈调整。' : '目标已经明确，尚未形成第一份可检查成果。',
      estimatedInvestment: '先投入 20 分钟完成第一步，再根据真实反馈调整后续投入。',
      risks: [replanning ? '继续照搬原计划会忽略已经出现的执行阻力。' : '一次把范围铺得过大，导致迟迟无法开始。'],
      milestones: replanning ? [
        { title: '完成缩小后的可检查成果', evidence: '留下一份范围更小但可以查看的成果。' },
        { title: '根据新路径完成一次修订', evidence: '保存新路径的反馈和修订结果。' },
      ] : [
        { title: '完成第一段可检查成果', evidence: '留下一份可以查看或使用的初版成果。' },
        { title: '根据一次真实反馈完成修订', evidence: '保存反馈内容和对应的修订结果。' },
      ],
      nextStep: replanning
        ? { title: '把原行动缩小一半', why: '执行反馈说明原路径需要降低开始成本。', minimumAction: '只保留最关键的一个要点。', estimatedMinutes: 10, difficulty: 'light' }
        : { title: '写下第一版结构', why: request.userInput.why || '先降低开始成本。', minimumAction: '只列出三个要点。', estimatedMinutes: 20, difficulty: 'light' },
      assumptions: ['当前尚未提供明确截止日期。'],
    },
    warnings: ['桌面测试夹具，不代表真实模型质量。'],
  };
}

async function analyze(request) {
  if (process.env.NODE_ENV === 'test' && process.env.QIGUANG_TEST_AI === 'fixture') {
    const parsed = request.operation === 'daily_analysis'
      ? parseDailyAnalysisResponse(fixtureAnalysis(request), request)
      : request.operation === 'task_feedback'
        ? parseTaskFeedbackResponse(fixtureTaskFeedback(request), request)
        : request.operation === 'weekly_review'
          ? parseWeeklyReviewResponse(fixtureWeeklyReview(request), request)
          : request.operation === 'system_candidate_review'
            ? parseSystemCandidateReviewResponse(fixtureSystemCandidateReview(request), request)
            : parseGoalDecompositionResponse(fixtureGoalDecomposition(request), request);
    if (parsed.warnings.includes('SAFETY_REVIEW')) throw Object.assign(new Error('本次内容需要进入安全支持流程。'), { code: 'SAFETY_REVIEW' });
    return parsed;
  }
  return analyzeWithModel(request, callModel, process.env.MINIMAX_MODEL || 'MiniMax-M3');
}

async function handleAnalyze(request, response) {
  if (request.method !== 'POST') {
    fail(response, 405, 'METHOD_NOT_ALLOWED', '只支持 POST。', { Allow: 'POST' });
    return;
  }
  const contentType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    fail(response, 415, 'UNSUPPORTED_MEDIA_TYPE', '只接受 application/json。');
    return;
  }
  const origin = request.headers.origin;
  let crossSite = request.headers['sec-fetch-site'] === 'cross-site';
  try { if (origin && new URL(origin).host !== request.headers.host) crossSite = true; } catch { crossSite = true; }
  if (crossSite && !appOriginAllowed(request)) {
    fail(response, 403, 'CROSS_SITE_REQUEST', '不接受跨站整理请求。');
    return;
  }
  if (!rateAllowed(clientAddress(request))) {
    fail(response, 429, 'RATE_LIMITED', '请求过快，请一分钟后再试。', { 'Retry-After': '60' });
    return;
  }
  let parsed;
  try {
    const body = await readJsonBody(request);
    parsed = body?.operation === 'task_feedback' ? parseTaskFeedbackRequest(body)
      : body?.operation === 'weekly_review' ? parseWeeklyReviewRequest(body)
        : body?.operation === 'system_candidate_review' ? parseSystemCandidateReviewRequest(body)
          : body?.operation === 'goal_decomposition' ? parseGoalDecompositionRequest(body) : parseDailyAnalysisRequest(body);
  } catch (error) {
    const code = error?.code || (error instanceof Error && error.message === 'UNSUPPORTED_CONTRACT' ? 'UNSUPPORTED_CONTRACT' : error instanceof Error && error.message === 'INPUT_TOO_LARGE' ? 'INPUT_TOO_LARGE' : 'INVALID_REQUEST');
    fail(response, code === 'UNSUPPORTED_CONTRACT' ? 426 : code === 'INPUT_TOO_LARGE' ? 413 : 400, code, error instanceof Error ? error.message : '请求无效。');
    return;
  }
  if (hasImmediateDangerSignal(parsed)) {
    fail(response, 422, 'SAFETY_REVIEW', '当下安全最重要；请先查看本地求助资源或联系可信任的人。');
    return;
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
  const cached = completed.get(parsed.requestId);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.fingerprint !== fingerprint) {
      fail(response, 409, 'REQUEST_CONFLICT', '同一请求 ID 的内容不一致。');
      return;
    }
    json(response, 200, cached.result);
    return;
  }
  const active = inFlight.get(parsed.requestId);
  if (active && active.fingerprint !== fingerprint) {
    fail(response, 409, 'REQUEST_CONFLICT', '同一请求 ID 的内容不一致。');
    return;
  }
  const owned = !active;
  const pending = active?.promise ?? analyze(parsed);
  if (owned) inFlight.set(parsed.requestId, { fingerprint, promise: pending });
  try {
    const result = await pending;
    if (owned) {
      const cacheEntry = { fingerprint, result, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS };
      completed.set(parsed.requestId, cacheEntry);
      setTimeout(() => {
        if (completed.get(parsed.requestId) === cacheEntry) completed.delete(parsed.requestId);
      }, IDEMPOTENCY_TTL_MS).unref();
    }
    json(response, 200, result);
  } catch (error) {
    const code = error?.code || 'SERVICE_UNAVAILABLE';
    const status = code === 'RATE_LIMITED' ? 429 : code === 'SAFETY_REVIEW' ? 422 : code === 'INVALID_MODEL_OUTPUT' ? 502 : code === 'MODEL_TIMEOUT' ? 504 : 503;
    fail(response, status, code, error instanceof Error ? error.message : '整理服务暂时不可用。');
  } finally {
    if (owned && inFlight.get(parsed.requestId)?.promise === pending) inFlight.delete(parsed.requestId);
  }
}

async function serveStatic(request, response) {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    fail(response, 405, 'METHOD_NOT_ALLOWED', '不支持该请求方法。');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    fail(response, 400, 'INVALID_PATH', '路径无效。');
    return;
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let target = resolve(DIST_DIR, relative);
  if (target !== resolve(DIST_DIR) && !target.startsWith(`${resolve(DIST_DIR)}${sep}`)) {
    fail(response, 404, 'NOT_FOUND', '页面不存在。');
    return;
  }
  let info;
  try {
    info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    const isNavigation = /(?:^|,)\s*text\/html\b/i.test(String(request.headers.accept ?? '')) && extname(pathname) === '';
    if (relative !== 'index.html' && !isNavigation) {
      fail(response, 404, 'NOT_FOUND', '资源不存在。');
      return;
    }
    target = resolve(DIST_DIR, 'index.html');
    try { info = await stat(target); } catch {
      fail(response, 503, 'BUILD_MISSING', '请先运行 npm run build。');
      return;
    }
  }
  const fixedName = pathname === '/sw.js' || pathname === '/manifest.webmanifest';
  const hashedAsset = /^\/assets\/[^/]+-[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(pathname);
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(target)] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': target.endsWith('index.html') || fixedName ? 'no-cache' : hashedAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; media-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'microphone=(), camera=(), geolocation=()',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(target).pipe(response);
}

export function startServer(port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1') {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const apiRoute = pathname === '/api/health' || pathname === '/api/analyze';
    if (apiRoute && appOriginAllowed(request)) {
      response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Vary', 'Origin');
    }
    if (apiRoute && request.method === 'OPTIONS') {
      if (!appOriginAllowed(request)) fail(response, 403, 'CROSS_SITE_REQUEST', '不接受未授权应用来源。');
      else response.writeHead(204, { 'Access-Control-Max-Age': '600' }).end();
      return;
    }
    if (pathname === '/api/health') {
      json(response, 200, {
        configured: Boolean(process.env.MINIMAX_API_KEY),
        model: process.env.MINIMAX_MODEL || 'MiniMax-M3',
        contractVersion: ANALYSIS_CONTRACT_VERSION,
      });
      return;
    }
    if (pathname === '/api/analyze') {
      await handleAnalyze(request, response);
      return;
    }
    await serveStatic(request, response);
  });
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`栖光本地服务已启动：http://${host}:${actualPort}`);
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
