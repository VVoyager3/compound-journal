export const ANALYSIS_CONTRACT_VERSION = '1.0' as const;
export const CONTRACT_DIMENSIONS = ['energy', 'mental', 'connection', 'progress', 'play'] as const;

export type ContractDimension = (typeof CONTRACT_DIMENSIONS)[number];
export type Confidence = 'high' | 'medium' | 'low';
export type AnalysisErrorCode =
  | 'OFFLINE'
  | 'INPUT_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'MODEL_TIMEOUT'
  | 'INVALID_MODEL_OUTPUT'
  | 'UNSUPPORTED_CONTRACT'
  | 'SAFETY_REVIEW'
  | 'SERVICE_UNAVAILABLE';

export interface DailyAnalysisRequest {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  operation: 'daily_analysis';
  requestId: string;
  locale: 'zh-CN';
  timeZone: string;
  localDate: string;
  userInput: {
    entries: Array<{ entryId: string; revision: number; text: string }>;
  };
  context: {
    confirmedEvents: Array<{ eventId: string; localDate: string; title: string }>;
    recentStates: Array<{
      localDate: string;
      values: Partial<Record<ContractDimension, number>>;
    }>;
    goals: Array<{ goalId: string; result: string; role: 'main' | 'secondary' }>;
    bonusHabits: Array<{ habitId: string; name: string; minimumAction: string }>;
    memories: Array<{
      memoryId: string;
      type: 'preference' | 'pattern' | 'principle' | 'strength' | 'constraint';
      statement: string;
    }>;
    constraints: string[];
  };
  permissions: {
    entryIds: string[];
    includeConfirmedEvents: boolean;
    includeRecentStates: boolean;
    includeGoals: boolean;
    includeBonusHabits: boolean;
    memoryIds: string[];
  };
}

export interface AnalysisEvidence {
  entryId: string;
  quote: string;
  start: number;
  end: number;
}

export interface StateImpactCandidate {
  dimension: ContractDimension;
  direction: 'positive' | 'negative';
  strength: 'small' | 'medium' | 'large';
  suggestedDelta: number;
  reason: string;
  confidence: Confidence;
}

export interface GrowthEvidenceCandidate {
  branchId: string | null;
  suggestedBranchName: string | null;
  evidenceType: 'practice' | 'output' | 'feedback' | 'milestone';
  description: string;
  isMilestoneCandidate: boolean;
  reason: string;
}

export interface DailyEventCandidate {
  candidateId: string;
  title: string;
  description: string;
  sourceType: 'explicit' | 'inferred';
  confirmation: 'confirmed_by_default' | 'pending';
  confidence: Confidence;
  evidence: AnalysisEvidence[];
  stateImpactCandidates: StateImpactCandidate[];
  growthEvidenceCandidate: GrowthEvidenceCandidate | null;
}

export interface DailyReflection {
  whatHappened: string;
  specificCredit: string;
  patternCandidate: {
    observation: string;
    evidenceCount: number;
    neededEvidence: string;
  } | null;
  nextSmallStep: string;
}

export interface QuestSuggestion {
  type: 'main' | 'side';
  title: string;
  why: string;
  minimumVersion: string;
  estimatedMinutes: number;
  difficulty: 'light' | 'standard' | 'hard' | 'challenge';
  primaryState: ContractDimension;
  growthBranchId: string | null;
  sourceGoalId: string | null;
  isRecovery: boolean;
}

export interface MemoryCandidate {
  type: 'preference' | 'pattern' | 'principle' | 'strength' | 'constraint';
  statement: string;
  confidence: Confidence;
  supportingEventIds: string[];
  counterEvidence: string[];
  recommendedAction: 'observe' | 'review';
}

export interface DailyAnalysisResult {
  title: string;
  summary: string;
  explicitMoods: string[];
  events: DailyEventCandidate[];
  reflection: DailyReflection;
  questSuggestions: QuestSuggestion[];
  memoryCandidates: MemoryCandidate[];
}

export interface DailyAnalysisResponse {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  requestId: string;
  operation: 'daily_analysis';
  result: DailyAnalysisResult;
  warnings: string[];
}

export interface TaskFeedbackRequest {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  operation: 'task_feedback';
  requestId: string;
  locale: 'zh-CN';
  timeZone: string;
  localDate: string;
  userInput: {
    questId: string;
    questTitle: string;
    minimumAction: string;
    currentDifficulty: 'light' | 'standard' | 'hard' | 'challenge';
    feedbackText: string;
  };
  permissions: { questId: string };
}

export interface TaskFeedbackResult {
  completionCandidate: 'complete' | 'partial' | 'skipped' | 'unclear';
  actualResult: string;
  evidenceQuote: string;
  suggestedDifficultyCorrection: 'light' | 'standard' | 'hard' | 'challenge' | null;
  followUpQuestion: string | null;
  confidence: Confidence;
}

export interface TaskFeedbackResponse {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  requestId: string;
  operation: 'task_feedback';
  result: TaskFeedbackResult;
  warnings: string[];
}

export type WeeklyRelationship = 'correlation' | 'causal' | 'unknown';
export type HabitDecisionAction = 'keep' | 'lower_difficulty' | 'change_trigger' | 'pause' | 'stop';

export interface WeeklyReviewSourceVersions {
  quests: Array<{ id: string; version: number }>;
  questFeedback: Array<{ id: string; version: number }>;
  habits: Array<{ id: string; version: number }>;
  habitLogs: Array<{ id: string; version: number }>;
  branches: Array<{ id: string; version: number }>;
  xpLedger: Array<{ id: string; version: number }>;
  goals: Array<{ id: string; version: number }>;
  reviews: Array<{ id: string; version: number }>;
  memories: Array<{ id: string; version: number }>;
  stateObservations: Array<{ id: string; version: number }>;
}

export interface WeeklyReviewRequest {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  operation: 'weekly_review';
  requestId: string;
  locale: 'zh-CN';
  timeZone: string;
  period: { start: string; end: string };
  userInput: { note: string };
  context: {
    events: Array<{ eventId: string; version: number; localDate: string; title: string; description: string }>;
    /** Optional only for requests persisted before source-version validation was introduced. */
    sourceVersions?: WeeklyReviewSourceVersions;
    stateSnapshots: Array<{ localDate: string; values: Partial<Record<ContractDimension, number>> }>;
    taskResults: Array<{ questId: string; localDate: string; title: string; result: 'completed' | 'partial' | 'skipped' | 'exempt'; actual: string }>;
    habits: Array<{ habitId: string; name: string; minimumAction: string; momentum: number }>;
    growth: Array<{ branchId: string; name: string; xp: number }>;
    goals: Array<{ goalId: string; result: string; role: 'main' | 'secondary' }>;
    experiments: Array<{ reviewId: string; hypothesis: string; minimumAction: string; metric: string; endDate: string; stopCondition: string }>;
    memories: Array<{ memoryId: string; type: MemoryCandidate['type']; statement: string }>;
  };
  permissions: {
    eventIds: string[];
    includeStateSnapshots: boolean;
    includeTaskResults: boolean;
    includeHabits: boolean;
    includeGrowth: boolean;
    includeGoals: boolean;
    includeExperiments: boolean;
    memoryIds: string[];
  };
}

export interface WeeklyEvidencePattern {
  summary: string;
  evidenceEventIds: string[];
  evidenceDates: string[];
  relationship: WeeklyRelationship;
}

export interface WeeklyReviewResult {
  stateTrends: Array<WeeklyEvidencePattern & { dimension: ContractDimension; direction: 'up' | 'down' | 'stable' | 'unknown' }>;
  recurringBenefits: WeeklyEvidencePattern[];
  recurringCosts: WeeklyEvidencePattern[];
  growthDeposits: Array<{ branchId: string | null; branchName: string | null; summary: string; evidenceEventIds: string[] }>;
  habitDecisions: Array<{ habitId: string; action: HabitDecisionAction; reason: string }>;
  nextWeekTheme: { title: string; reason: string };
  nextExperiment: { hypothesis: string; minimumAction: string; metric: string; endDate: string; stopCondition: string };
  systemCandidates: MemoryCandidate[];
}

export interface WeeklyReviewResponse {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  requestId: string;
  operation: 'weekly_review';
  result: WeeklyReviewResult;
  warnings: string[];
}

export interface SystemCandidateReviewRequest {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  operation: 'system_candidate_review';
  requestId: string;
  locale: 'zh-CN';
  timeZone: string;
  userInput: {
    candidates: Array<{
      memoryId: string;
      version: number;
      type: MemoryCandidate['type'];
      statement: string;
      evidenceEvents: Array<{ eventId: string; localDate: string; title: string }>;
      counterEvidence: string[];
      confidence: Confidence;
      status: 'candidate' | 'confirmed';
    }>;
  };
  permissions: { memoryIds: string[] };
}

export interface SystemCandidateReviewResponse {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  requestId: string;
  operation: 'system_candidate_review';
  result: {
    groups: Array<{
      candidateMemoryIds: string[];
      action: 'keep_separate' | 'merge';
      mergedStatement: string | null;
      reason: string;
      confidence: Confidence;
    }>;
  };
  warnings: string[];
}

export interface GoalDecompositionRequest {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  operation: 'goal_decomposition';
  requestId: string;
  locale: 'zh-CN';
  timeZone: string;
  userInput: {
    result: string;
    why: string;
    completionEvidence: string;
  };
  context: {
    area: { areaId: string; name: string; mode: 'build' | 'maintain' | 'explore' | 'pause' };
    branch: { branchId: string; name: string };
    currentGoals: Array<{ goalId: string; result: string; role: 'main' | 'secondary' }>;
    executionEvidence: Array<{
      questId: string;
      title: string;
      result: 'completed' | 'partial' | 'skipped' | 'exempt';
      actual: string;
      completedDate: string;
    }>;
    memories: Array<{
      memoryId: string;
      type: MemoryCandidate['type'];
      statement: string;
    }>;
  };
  permissions: { memoryIds: string[]; questIds: string[]; goalIds: string[] };
}

export interface GoalDecompositionResult {
  refinedResult: string;
  completionEvidence: string;
  rationale: string;
  currentStage: string;
  estimatedInvestment: string;
  risks: string[];
  milestones: Array<{ title: string; evidence: string }>;
  nextStep: {
    title: string;
    why: string;
    minimumAction: string;
    estimatedMinutes: number;
    difficulty: 'light' | 'standard' | 'hard' | 'challenge';
  };
  assumptions: string[];
}

export interface GoalDecompositionResponse {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  requestId: string;
  operation: 'goal_decomposition';
  result: GoalDecompositionResult;
  warnings: string[];
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象。`);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  const unknown = Object.keys(record).find((key) => !expected.has(key));
  if (unknown) throw new Error(`${label}包含未知字段“${unknown}”。`);
  const missing = keys.find((key) => !(key in record));
  if (missing) throw new Error(`${label}缺少字段“${missing}”。`);
}

function textValue(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || Array.from(value).length > max) {
    throw new Error(`${label}无效。`);
  }
  return value;
}

function integerValue(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label}无效。`);
  return Number(value);
}

function oneDecimalValue(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || Math.abs(value * 10 - Math.round(value * 10)) > 1e-9) {
    throw new Error(`${label}无效。`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}无效。`);
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${label}无效。`);
  return value as T;
}

function nullableText(value: unknown, label: string, max: number): string | null {
  return value === null ? null : textValue(value, label, max);
}

function arrayValue(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}无效。`);
  return value;
}

function localDateValue(value: unknown, label: string): string {
  const result = textValue(value, label, 10);
  if (!LOCAL_DATE_PATTERN.test(result)) throw new Error(`${label}无效。`);
  const [year, month, day] = result.split('-').map(Number) as [number, number, number];
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) throw new Error(`${label}无效。`);
  return result;
}

function timeZoneValue(value: unknown): string {
  const result = textValue(value, '时区', 100);
  try { new Intl.DateTimeFormat('en-US', { timeZone: result }).format(0); }
  catch { throw new Error('时区无效。'); }
  return result;
}

function uniqueStrings(value: unknown, label: string, maxItems: number, maxLength = 200): string[] {
  const result = arrayValue(value, label, maxItems).map((item, index) => textValue(item, `${label}第${index + 1}项`, maxLength));
  if (new Set(result).size !== result.length) throw new Error(`${label}不能重复。`);
  return result;
}

function parseRequestEntry(value: unknown, index: number): DailyAnalysisRequest['userInput']['entries'][number] {
  const record = objectValue(value, `第${index + 1}条记录`);
  exactKeys(record, ['entryId', 'revision', 'text'], `第${index + 1}条记录`);
  return {
    entryId: textValue(record.entryId, '记录 ID', 200),
    revision: integerValue(record.revision, '记录版本', 1, Number.MAX_SAFE_INTEGER),
    text: textValue(record.text, '记录正文', 12_000),
  };
}

export function parseDailyAnalysisRequest(value: unknown): DailyAnalysisRequest {
  const root = objectValue(value, '请求');
  exactKeys(root, ['contractVersion', 'operation', 'requestId', 'locale', 'timeZone', 'localDate', 'userInput', 'context', 'permissions'], '请求');
  if (root.contractVersion !== ANALYSIS_CONTRACT_VERSION) throw new Error('UNSUPPORTED_CONTRACT');
  if (root.operation !== 'daily_analysis') throw new Error('不支持的整理操作。');
  if (root.locale !== 'zh-CN') throw new Error('只支持 zh-CN。');
  const requestId = textValue(root.requestId, '请求 ID', 200);
  const timeZone = timeZoneValue(root.timeZone);
  const localDate = localDateValue(root.localDate, '整理日期');

  const input = objectValue(root.userInput, '用户输入');
  exactKeys(input, ['entries'], '用户输入');
  const entries = arrayValue(input.entries, '记录列表', 30).map(parseRequestEntry);
  if (!entries.length) throw new Error('至少选择一条记录。');
  if (new Set(entries.map((entry) => entry.entryId)).size !== entries.length) throw new Error('记录不能重复。');
  if (entries.reduce((sum, entry) => sum + Array.from(entry.text).length, 0) > 20_000) throw new Error('INPUT_TOO_LARGE');

  const context = objectValue(root.context, '上下文');
  exactKeys(context, ['confirmedEvents', 'recentStates', 'goals', 'bonusHabits', 'memories', 'constraints'], '上下文');
  const confirmedEvents = arrayValue(context.confirmedEvents, '已确认事件', 30).map((value, index) => {
    const item = objectValue(value, `已确认事件${index + 1}`);
    exactKeys(item, ['eventId', 'localDate', 'title'], `已确认事件${index + 1}`);
    return { eventId: textValue(item.eventId, '事件 ID', 200), localDate: localDateValue(item.localDate, '事件日期'), title: textValue(item.title, '事件标题', 60) };
  });
  const recentStates = arrayValue(context.recentStates, '近期状态', 7).map((value, index) => {
    const item = objectValue(value, `近期状态${index + 1}`);
    exactKeys(item, ['localDate', 'values'], `近期状态${index + 1}`);
    const values = objectValue(item.values, '状态值');
    const unknown = Object.keys(values).find((key) => !CONTRACT_DIMENSIONS.includes(key as ContractDimension));
    if (unknown) throw new Error(`状态值包含未知维度“${unknown}”。`);
    const parsed: Partial<Record<ContractDimension, number>> = {};
    for (const dimension of CONTRACT_DIMENSIONS) {
      if (values[dimension] !== undefined) parsed[dimension] = integerValue(values[dimension], `${dimension}状态`, 0, 100);
    }
    return { localDate: localDateValue(item.localDate, '状态日期'), values: parsed };
  });
  const goals = arrayValue(context.goals, '当前目标', 3).map((value, index) => {
    const item = objectValue(value, `当前目标${index + 1}`);
    exactKeys(item, ['goalId', 'result', 'role'], `当前目标${index + 1}`);
    return { goalId: textValue(item.goalId, '目标 ID', 200), result: textValue(item.result, '目标结果', 160), role: enumValue(item.role, ['main', 'secondary'], '目标角色') };
  });
  const bonusHabits = arrayValue(context.bonusHabits, 'BONUS 习惯', 3).map((value, index) => {
    const item = objectValue(value, `BONUS 习惯${index + 1}`);
    exactKeys(item, ['habitId', 'name', 'minimumAction'], `BONUS 习惯${index + 1}`);
    return { habitId: textValue(item.habitId, '习惯 ID', 200), name: textValue(item.name, '习惯名称', 60), minimumAction: textValue(item.minimumAction, '习惯最小动作', 160) };
  });
  const memoryTypes = ['preference', 'pattern', 'principle', 'strength', 'constraint'] as const;
  const memories = arrayValue(context.memories, '系统记忆', 20).map((value, index) => {
    const item = objectValue(value, `系统记忆${index + 1}`);
    exactKeys(item, ['memoryId', 'type', 'statement'], `系统记忆${index + 1}`);
    return { memoryId: textValue(item.memoryId, '记忆 ID', 200), type: enumValue(item.type, memoryTypes, '记忆类型'), statement: textValue(item.statement, '记忆内容', 500) };
  });
  const constraints = uniqueStrings(context.constraints, '现实约束', 10, 300);

  const permissions = objectValue(root.permissions, '发送权限');
  exactKeys(permissions, ['entryIds', 'includeConfirmedEvents', 'includeRecentStates', 'includeGoals', 'includeBonusHabits', 'memoryIds'], '发送权限');
  const entryIds = uniqueStrings(permissions.entryIds, '允许发送的记录 ID', 30);
  if (entryIds.length !== entries.length || entries.some((entry) => !entryIds.includes(entry.entryId))) throw new Error('发送权限与记录范围不一致。');
  const memoryIds = uniqueStrings(permissions.memoryIds, '允许发送的记忆 ID', 20);
  if (memoryIds.length !== memories.length || memories.some((memory) => !memoryIds.includes(memory.memoryId))) throw new Error('发送权限与记忆范围不一致。');
  const includeConfirmedEvents = booleanValue(permissions.includeConfirmedEvents, '事件发送权限');
  const includeRecentStates = booleanValue(permissions.includeRecentStates, '状态发送权限');
  const includeGoals = booleanValue(permissions.includeGoals, '目标发送权限');
  const includeBonusHabits = booleanValue(permissions.includeBonusHabits, '习惯发送权限');
  if ((!includeConfirmedEvents && confirmedEvents.length) || (!includeRecentStates && recentStates.length) || (!includeGoals && goals.length) || (!includeBonusHabits && bonusHabits.length)) {
    throw new Error('发送权限为关闭时，对应上下文必须为空。');
  }

  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION,
    operation: 'daily_analysis',
    requestId,
    locale: 'zh-CN',
    timeZone,
    localDate,
    userInput: { entries },
    context: { confirmedEvents, recentStates, goals, bonusHabits, memories, constraints },
    permissions: {
      entryIds,
      includeConfirmedEvents,
      includeRecentStates,
      includeGoals,
      includeBonusHabits,
      memoryIds,
    },
  };
}

export function parseTaskFeedbackRequest(value: unknown): TaskFeedbackRequest {
  const root = objectValue(value, '请求');
  exactKeys(root, ['contractVersion', 'operation', 'requestId', 'locale', 'timeZone', 'localDate', 'userInput', 'permissions'], '请求');
  if (root.contractVersion !== ANALYSIS_CONTRACT_VERSION) throw new Error('UNSUPPORTED_CONTRACT');
  if (root.operation !== 'task_feedback') throw new Error('不支持的反馈操作。');
  if (root.locale !== 'zh-CN') throw new Error('只支持 zh-CN。');
  const timeZone = timeZoneValue(root.timeZone);
  const input = objectValue(root.userInput, '用户输入');
  exactKeys(input, ['questId', 'questTitle', 'minimumAction', 'currentDifficulty', 'feedbackText'], '用户输入');
  const questId = textValue(input.questId, '任务 ID', 200);
  const permissions = objectValue(root.permissions, '发送权限');
  exactKeys(permissions, ['questId'], '发送权限');
  if (permissions.questId !== questId) throw new Error('发送权限与任务不一致。');
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION,
    operation: 'task_feedback',
    requestId: textValue(root.requestId, '请求 ID', 200),
    locale: 'zh-CN',
    timeZone,
    localDate: localDateValue(root.localDate, '反馈日期'),
    userInput: {
      questId,
      questTitle: textValue(input.questTitle, '任务标题', 160),
      minimumAction: textValue(input.minimumAction, '任务最小动作', 200),
      currentDifficulty: enumValue(input.currentDifficulty, ['light', 'standard', 'hard', 'challenge'], '当前难度'),
      feedbackText: textValue(input.feedbackText, '反馈文字', 2_000),
    },
    permissions: { questId },
  };
}

export function parseWeeklyReviewRequest(value: unknown): WeeklyReviewRequest {
  const root = objectValue(value, '请求');
  exactKeys(root, ['contractVersion', 'operation', 'requestId', 'locale', 'timeZone', 'period', 'userInput', 'context', 'permissions'], '请求');
  if (root.contractVersion !== ANALYSIS_CONTRACT_VERSION) throw new Error('UNSUPPORTED_CONTRACT');
  if (root.operation !== 'weekly_review') throw new Error('不支持的复盘操作。');
  if (root.locale !== 'zh-CN') throw new Error('只支持 zh-CN。');
  const timeZone = timeZoneValue(root.timeZone);
  const period = objectValue(root.period, '复盘周期');
  exactKeys(period, ['start', 'end'], '复盘周期');
  const start = localDateValue(period.start, '周期开始日期');
  const end = localDateValue(period.end, '周期结束日期');
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  if (days < 0 || days > 6) throw new Error('周复盘周期必须在七天内。');
  const input = objectValue(root.userInput, '用户输入');
  exactKeys(input, ['note'], '用户输入');
  const context = objectValue(root.context, '上下文');
  exactKeys(
    context,
    context.sourceVersions === undefined
      ? ['events', 'stateSnapshots', 'taskResults', 'habits', 'growth', 'goals', 'experiments', 'memories']
      : ['events', 'sourceVersions', 'stateSnapshots', 'taskResults', 'habits', 'growth', 'goals', 'experiments', 'memories'],
    '上下文',
  );
  const sourceVersions = (() => {
    if (context.sourceVersions === undefined) return undefined;
    const root = objectValue(context.sourceVersions, '来源版本');
    const keys: Array<keyof WeeklyReviewSourceVersions> = [
      'quests', 'questFeedback', 'habits', 'habitLogs', 'branches', 'xpLedger', 'goals', 'reviews', 'memories', 'stateObservations',
    ];
    exactKeys(root, keys, '来源版本');
    return Object.fromEntries(keys.map((key) => {
      const values = arrayValue(root[key], `${key} 来源版本`, 1_000).map((value, index) => {
        const item = objectValue(value, `${key} 来源版本${index + 1}`);
        exactKeys(item, ['id', 'version'], `${key} 来源版本${index + 1}`);
        return { id: textValue(item.id, `${key} 来源 ID`, 200), version: integerValue(item.version, `${key} 来源版本`, 1, Number.MAX_SAFE_INTEGER) };
      });
      if (new Set(values.map((item) => item.id)).size !== values.length) throw new Error(`${key} 来源版本不能重复。`);
      return [key, values];
    })) as unknown as WeeklyReviewSourceVersions;
  })();
  const inPeriod = (date: string, label: string): string => {
    const parsed = localDateValue(date, label);
    if (parsed < start || parsed > end) throw new Error(`${label}不在复盘周期内。`);
    return parsed;
  };
  const events = arrayValue(context.events, '已确认事件', 80).map((value, index) => {
    const item = objectValue(value, `事件${index + 1}`);
    exactKeys(item, ['eventId', 'version', 'localDate', 'title', 'description'], `事件${index + 1}`);
    return {
      eventId: textValue(item.eventId, '事件 ID', 200),
      version: integerValue(item.version, '事件版本', 1, Number.MAX_SAFE_INTEGER),
      localDate: inPeriod(String(item.localDate), '事件日期'),
      title: textValue(item.title, '事件标题', 60),
      description: textValue(item.description, '事件说明', 500),
    };
  });
  if (new Set(events.map((item) => item.eventId)).size !== events.length) throw new Error('事件不能重复。');
  const stateSnapshots = arrayValue(context.stateSnapshots, '状态快照', 7).map((value, index) => {
    const item = objectValue(value, `状态快照${index + 1}`);
    exactKeys(item, ['localDate', 'values'], `状态快照${index + 1}`);
    const values = objectValue(item.values, '状态值');
    const unknown = Object.keys(values).find((key) => !CONTRACT_DIMENSIONS.includes(key as ContractDimension));
    if (unknown) throw new Error(`状态值包含未知维度“${unknown}”。`);
    const parsed: Partial<Record<ContractDimension, number>> = {};
    for (const dimension of CONTRACT_DIMENSIONS) if (values[dimension] !== undefined) parsed[dimension] = integerValue(values[dimension], `${dimension}状态`, 0, 100);
    return { localDate: inPeriod(String(item.localDate), '状态日期'), values: parsed };
  });
  const taskResults = arrayValue(context.taskResults, '任务结果', 80).map((value, index) => {
    const item = objectValue(value, `任务结果${index + 1}`);
    exactKeys(item, ['questId', 'localDate', 'title', 'result', 'actual'], `任务结果${index + 1}`);
    return {
      questId: textValue(item.questId, '任务 ID', 200), localDate: inPeriod(String(item.localDate), '任务日期'),
      title: textValue(item.title, '任务标题', 160), result: enumValue(item.result, ['completed', 'partial', 'skipped', 'exempt'] as const, '任务结果'),
      actual: textValue(item.actual, '实际结果', 500, true),
    };
  });
  const habits = arrayValue(context.habits, '习惯', 20).map((value, index) => {
    const item = objectValue(value, `习惯${index + 1}`);
    exactKeys(item, ['habitId', 'name', 'minimumAction', 'momentum'], `习惯${index + 1}`);
    return { habitId: textValue(item.habitId, '习惯 ID', 200), name: textValue(item.name, '习惯名称', 60), minimumAction: textValue(item.minimumAction, '习惯最小动作', 160), momentum: oneDecimalValue(item.momentum, '习惯动量', 0, 5) };
  });
  const growth = arrayValue(context.growth, '成长摘要', 30).map((value, index) => {
    const item = objectValue(value, `成长摘要${index + 1}`);
    exactKeys(item, ['branchId', 'name', 'xp'], `成长摘要${index + 1}`);
    return { branchId: textValue(item.branchId, '成长分支 ID', 200), name: textValue(item.name, '成长分支名称', 60), xp: integerValue(item.xp, '周期经验', 0, 100_000) };
  });
  const goals = arrayValue(context.goals, '当前目标', 3).map((value, index) => {
    const item = objectValue(value, `当前目标${index + 1}`);
    exactKeys(item, ['goalId', 'result', 'role'], `当前目标${index + 1}`);
    return { goalId: textValue(item.goalId, '目标 ID', 200), result: textValue(item.result, '目标结果', 160), role: enumValue(item.role, ['main', 'secondary'] as const, '目标角色') };
  });
  const experiments = arrayValue(context.experiments, '当前实验', 4).map((value, index) => {
    const item = objectValue(value, `当前实验${index + 1}`);
    exactKeys(item, ['reviewId', 'hypothesis', 'minimumAction', 'metric', 'endDate', 'stopCondition'], `当前实验${index + 1}`);
    return {
      reviewId: textValue(item.reviewId, '复盘 ID', 200), hypothesis: textValue(item.hypothesis, '实验假设', 500),
      minimumAction: textValue(item.minimumAction, '实验最小动作', 300), metric: textValue(item.metric, '实验指标', 300),
      endDate: localDateValue(item.endDate, '实验结束日期'), stopCondition: textValue(item.stopCondition, '实验停止条件', 300),
    };
  });
  const memories = arrayValue(context.memories, '系统记忆', 20).map((value, index) => {
    const item = objectValue(value, `系统记忆${index + 1}`);
    exactKeys(item, ['memoryId', 'type', 'statement'], `系统记忆${index + 1}`);
    return { memoryId: textValue(item.memoryId, '记忆 ID', 200), type: enumValue(item.type, ['preference', 'pattern', 'principle', 'strength', 'constraint'] as const, '记忆类型'), statement: textValue(item.statement, '记忆内容', 500) };
  });
  const permissions = objectValue(root.permissions, '发送权限');
  exactKeys(permissions, ['eventIds', 'includeStateSnapshots', 'includeTaskResults', 'includeHabits', 'includeGrowth', 'includeGoals', 'includeExperiments', 'memoryIds'], '发送权限');
  const eventIds = uniqueStrings(permissions.eventIds, '允许发送的事件 ID', 80);
  const memoryIds = uniqueStrings(permissions.memoryIds, '允许发送的记忆 ID', 20);
  if (eventIds.length !== events.length || events.some((item) => !eventIds.includes(item.eventId))) throw new Error('发送权限与事件范围不一致。');
  if (memoryIds.length !== memories.length || memories.some((item) => !memoryIds.includes(item.memoryId))) throw new Error('发送权限与记忆范围不一致。');
  const includeStateSnapshots = booleanValue(permissions.includeStateSnapshots, '状态快照发送权限');
  const includeTaskResults = booleanValue(permissions.includeTaskResults, '任务结果发送权限');
  const includeHabits = booleanValue(permissions.includeHabits, '习惯发送权限');
  const includeGrowth = booleanValue(permissions.includeGrowth, '成长发送权限');
  const includeGoals = booleanValue(permissions.includeGoals, '目标发送权限');
  const includeExperiments = booleanValue(permissions.includeExperiments, '实验发送权限');
  if ((!includeStateSnapshots && stateSnapshots.length) || (!includeTaskResults && taskResults.length) || (!includeHabits && habits.length)
    || (!includeGrowth && growth.length) || (!includeGoals && goals.length) || (!includeExperiments && experiments.length)) {
    throw new Error('发送权限为关闭时，对应周复盘上下文必须为空。');
  }
  if (sourceVersions) {
    const sameIds = (left: string[], right: string[]): boolean => left.length === right.length
      && left.every((id) => right.includes(id));
    if (!sameIds(sourceVersions.quests.map((item) => item.id), taskResults.map((item) => item.questId))) throw new Error('任务来源版本与发送范围不一致。');
    if (!sameIds(sourceVersions.habits.map((item) => item.id), habits.map((item) => item.habitId))) throw new Error('习惯来源版本与发送范围不一致。');
    if (!sameIds(sourceVersions.branches.map((item) => item.id), growth.map((item) => item.branchId))) throw new Error('成长来源版本与发送范围不一致。');
    if (!sameIds(sourceVersions.goals.map((item) => item.id), goals.map((item) => item.goalId))) throw new Error('目标来源版本与发送范围不一致。');
    if (!sameIds(sourceVersions.reviews.map((item) => item.id), experiments.map((item) => item.reviewId))) throw new Error('实验来源版本与发送范围不一致。');
    if (!sameIds(sourceVersions.memories.map((item) => item.id), memoryIds)) throw new Error('记忆来源版本与发送范围不一致。');
    if ((!includeStateSnapshots && sourceVersions.stateObservations.length)
      || (!includeTaskResults && sourceVersions.questFeedback.length)
      || (!includeHabits && sourceVersions.habitLogs.length)
      || (!includeGrowth && sourceVersions.xpLedger.length)) throw new Error('来源版本超出发送权限。');
  }
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION, operation: 'weekly_review', requestId: textValue(root.requestId, '请求 ID', 200), locale: 'zh-CN', timeZone,
    period: { start, end }, userInput: { note: textValue(input.note, '补充说明', 2_000, true) },
    context: { events, ...(sourceVersions ? { sourceVersions } : {}), stateSnapshots, taskResults, habits, growth, goals, experiments, memories },
    permissions: {
      eventIds,
      includeStateSnapshots,
      includeTaskResults,
      includeHabits,
      includeGrowth,
      includeGoals,
      includeExperiments,
      memoryIds,
    },
  };
}

export function parseSystemCandidateReviewRequest(value: unknown): SystemCandidateReviewRequest {
  const root = objectValue(value, '请求');
  exactKeys(root, ['contractVersion', 'operation', 'requestId', 'locale', 'timeZone', 'userInput', 'permissions'], '请求');
  if (root.contractVersion !== ANALYSIS_CONTRACT_VERSION) throw new Error('UNSUPPORTED_CONTRACT');
  if (root.operation !== 'system_candidate_review') throw new Error('不支持的系统候选操作。');
  if (root.locale !== 'zh-CN') throw new Error('只支持 zh-CN。');
  const timeZone = timeZoneValue(root.timeZone);
  const input = objectValue(root.userInput, '用户输入');
  exactKeys(input, ['candidates'], '用户输入');
  const candidates = arrayValue(input.candidates, '系统候选', 30).map((value, index) => {
    const item = objectValue(value, `系统候选${index + 1}`);
    exactKeys(item, ['memoryId', 'version', 'type', 'statement', 'evidenceEvents', 'counterEvidence', 'confidence', 'status'], `系统候选${index + 1}`);
    const evidenceEvents = arrayValue(item.evidenceEvents, '候选证据事件', 30).map((value, evidenceIndex) => {
      const event = objectValue(value, `候选证据${evidenceIndex + 1}`);
      exactKeys(event, ['eventId', 'localDate', 'title'], `候选证据${evidenceIndex + 1}`);
      return { eventId: textValue(event.eventId, '事件 ID', 200), localDate: localDateValue(event.localDate, '事件日期'), title: textValue(event.title, '事件标题', 60) };
    });
    return {
      memoryId: textValue(item.memoryId, '记忆 ID', 200),
      version: integerValue(item.version, '记忆版本', 1, Number.MAX_SAFE_INTEGER),
      type: enumValue(item.type, ['preference', 'pattern', 'principle', 'strength', 'constraint'] as const, '记忆类型'),
      statement: textValue(item.statement, '候选内容', 500), evidenceEvents,
      counterEvidence: uniqueStrings(item.counterEvidence, '候选反例', 30, 500),
      confidence: enumValue(item.confidence, ['high', 'medium', 'low'] as const, '候选确定程度'),
      status: enumValue(item.status, ['candidate', 'confirmed'] as const, '候选状态'),
    };
  });
  if (candidates.length < 2) throw new Error('至少需要两条候选才能检查重复。');
  if (new Set(candidates.map((item) => item.memoryId)).size !== candidates.length) throw new Error('系统候选不能重复。');
  const permissions = objectValue(root.permissions, '发送权限');
  exactKeys(permissions, ['memoryIds'], '发送权限');
  const memoryIds = uniqueStrings(permissions.memoryIds, '允许发送的记忆 ID', 30);
  if (memoryIds.length !== candidates.length || candidates.some((item) => !memoryIds.includes(item.memoryId))) throw new Error('发送权限与系统候选范围不一致。');
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION, operation: 'system_candidate_review', requestId: textValue(root.requestId, '请求 ID', 200),
    locale: 'zh-CN', timeZone, userInput: { candidates }, permissions: { memoryIds },
  };
}

export function parseGoalDecompositionRequest(value: unknown): GoalDecompositionRequest {
  const root = objectValue(value, '请求');
  exactKeys(root, ['contractVersion', 'operation', 'requestId', 'locale', 'timeZone', 'userInput', 'context', 'permissions'], '请求');
  if (root.contractVersion !== ANALYSIS_CONTRACT_VERSION) throw new Error('UNSUPPORTED_CONTRACT');
  if (root.operation !== 'goal_decomposition') throw new Error('不支持的目标拆解操作。');
  if (root.locale !== 'zh-CN') throw new Error('只支持 zh-CN。');
  const timeZone = timeZoneValue(root.timeZone);

  const input = objectValue(root.userInput, '用户输入');
  exactKeys(input, ['result', 'why', 'completionEvidence'], '用户输入');
  const context = objectValue(root.context, '上下文');
  exactKeys(context, ['area', 'branch', 'currentGoals', 'executionEvidence', 'memories'], '上下文');
  const area = objectValue(context.area, '关注领域');
  exactKeys(area, ['areaId', 'name', 'mode'], '关注领域');
  const branch = objectValue(context.branch, '成长分支');
  exactKeys(branch, ['branchId', 'name'], '成长分支');
  const currentGoals = arrayValue(context.currentGoals, '当前目标', 3).map((value, index) => {
    const item = objectValue(value, `当前目标${index + 1}`);
    exactKeys(item, ['goalId', 'result', 'role'], `当前目标${index + 1}`);
    return { goalId: textValue(item.goalId, '目标 ID', 200), result: textValue(item.result, '目标结果', 160), role: enumValue(item.role, ['main', 'secondary'] as const, '目标角色') };
  });
  if (new Set(currentGoals.map((item) => item.goalId)).size !== currentGoals.length) throw new Error('当前目标不能重复。');
  const executionEvidence = arrayValue(context.executionEvidence, '执行证据', 20).map((value, index) => {
    const item = objectValue(value, `执行证据${index + 1}`);
    exactKeys(item, ['questId', 'title', 'result', 'actual', 'completedDate'], `执行证据${index + 1}`);
    return {
      questId: textValue(item.questId, '任务 ID', 200),
      title: textValue(item.title, '任务标题', 160),
      result: enumValue(item.result, ['completed', 'partial', 'skipped', 'exempt'] as const, '任务结果'),
      actual: textValue(item.actual, '实际结果', 500, true),
      completedDate: localDateValue(item.completedDate, '实际完成日期'),
    };
  });
  if (new Set(executionEvidence.map((item) => item.questId)).size !== executionEvidence.length) throw new Error('执行证据不能重复。');
  const memories = arrayValue(context.memories, '系统记忆', 20).map((value, index) => {
    const memory = objectValue(value, `系统记忆${index + 1}`);
    exactKeys(memory, ['memoryId', 'type', 'statement'], `系统记忆${index + 1}`);
    return {
      memoryId: textValue(memory.memoryId, '记忆 ID', 200),
      type: enumValue(memory.type, ['preference', 'pattern', 'principle', 'strength', 'constraint'] as const, '记忆类型'),
      statement: textValue(memory.statement, '记忆内容', 500),
    };
  });
  if (new Set(memories.map((item) => item.memoryId)).size !== memories.length) throw new Error('系统记忆不能重复。');
  const permissions = objectValue(root.permissions, '发送权限');
  exactKeys(permissions, ['memoryIds', 'questIds', 'goalIds'], '发送权限');
  const memoryIds = uniqueStrings(permissions.memoryIds, '允许发送的记忆 ID', 20);
  const questIds = uniqueStrings(permissions.questIds, '允许发送的任务 ID', 20);
  const goalIds = uniqueStrings(permissions.goalIds, '允许发送的目标 ID', 3);
  if (memoryIds.length !== memories.length || memories.some((item) => !memoryIds.includes(item.memoryId))) throw new Error('发送权限与系统记忆范围不一致。');
  if (questIds.length !== executionEvidence.length || executionEvidence.some((item) => !questIds.includes(item.questId))) throw new Error('发送权限与执行证据范围不一致。');
  if (goalIds.length !== currentGoals.length || currentGoals.some((item) => !goalIds.includes(item.goalId))) throw new Error('发送权限与当前目标范围不一致。');
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION,
    operation: 'goal_decomposition',
    requestId: textValue(root.requestId, '请求 ID', 200),
    locale: 'zh-CN',
    timeZone,
    userInput: {
      result: textValue(input.result, '目标结果', 160),
      why: textValue(input.why, '目标理由', 500, true),
      completionEvidence: textValue(input.completionEvidence, '完成证据', 500, true),
    },
    context: {
      area: {
        areaId: textValue(area.areaId, '领域 ID', 200),
        name: textValue(area.name, '领域名称', 60),
        mode: enumValue(area.mode, ['build', 'maintain', 'explore', 'pause'] as const, '领域模式'),
      },
      branch: {
        branchId: textValue(branch.branchId, '分支 ID', 200),
        name: textValue(branch.name, '分支名称', 60),
      },
      currentGoals,
      executionEvidence,
      memories,
    },
    permissions: { memoryIds, questIds, goalIds },
  };
}

function parseEvidence(value: unknown, index: number, entries: Map<string, string>): AnalysisEvidence {
  const record = objectValue(value, `证据${index + 1}`);
  exactKeys(record, ['entryId', 'quote', 'start', 'end'], `证据${index + 1}`);
  const entryId = textValue(record.entryId, '证据记录 ID', 200);
  const source = entries.get(entryId);
  if (source === undefined) throw new Error('证据引用了本次请求之外的记录。');
  const sourceCharacters = Array.from(source);
  const start = integerValue(record.start, '证据起点', 0, sourceCharacters.length);
  const end = integerValue(record.end, '证据终点', start + 1, sourceCharacters.length);
  const quote = textValue(record.quote, '证据原文', 500);
  if (sourceCharacters.slice(start, end).join('') !== quote) throw new Error('证据原文与字符位置不一致。');
  return { entryId, quote, start, end };
}

function parseImpact(value: unknown, index: number): StateImpactCandidate {
  const record = objectValue(value, `状态候选${index + 1}`);
  exactKeys(record, ['dimension', 'direction', 'strength', 'suggestedDelta', 'reason', 'confidence'], `状态候选${index + 1}`);
  const direction = enumValue(record.direction, ['positive', 'negative'], '状态方向');
  const strength = enumValue(record.strength, ['small', 'medium', 'large'], '状态强度');
  const delta = integerValue(record.suggestedDelta, '状态变化', -15, 15);
  const [min, max] = ({ small: [2, 4], medium: [5, 8], large: [9, 15] } as const)[strength];
  if (Math.abs(delta) < min || Math.abs(delta) > max || (direction === 'positive' ? delta <= 0 : delta >= 0)) throw new Error('状态变化与方向或强度不一致。');
  return {
    dimension: enumValue(record.dimension, CONTRACT_DIMENSIONS, '状态维度'),
    direction,
    strength,
    suggestedDelta: delta,
    reason: textValue(record.reason, '状态理由', 500),
    confidence: enumValue(record.confidence, ['high', 'medium', 'low'], '状态确定程度'),
  };
}

function parseGrowthEvidence(value: unknown): GrowthEvidenceCandidate | null {
  if (value === null) return null;
  const record = objectValue(value, '成长证据');
  exactKeys(record, ['branchId', 'suggestedBranchName', 'evidenceType', 'description', 'isMilestoneCandidate', 'reason'], '成长证据');
  return {
    branchId: nullableText(record.branchId, '成长分支 ID', 200),
    suggestedBranchName: nullableText(record.suggestedBranchName, '建议成长分支', 60),
    evidenceType: enumValue(record.evidenceType, ['practice', 'output', 'feedback', 'milestone'], '成长证据类型'),
    description: textValue(record.description, '成长证据描述', 500),
    isMilestoneCandidate: booleanValue(record.isMilestoneCandidate, '里程碑候选'),
    reason: textValue(record.reason, '成长证据理由', 500),
  };
}

function parseEvent(value: unknown, index: number, entries: Map<string, string>): DailyEventCandidate {
  const record = objectValue(value, `事件${index + 1}`);
  exactKeys(record, ['candidateId', 'title', 'description', 'sourceType', 'confirmation', 'confidence', 'evidence', 'stateImpactCandidates', 'growthEvidenceCandidate'], `事件${index + 1}`);
  const sourceType = enumValue(record.sourceType, ['explicit', 'inferred'], '事件来源');
  const confirmation = enumValue(record.confirmation, ['confirmed_by_default', 'pending'], '事件确认状态');
  if ((sourceType === 'explicit' && confirmation !== 'confirmed_by_default') || (sourceType === 'inferred' && confirmation !== 'pending')) {
    throw new Error('事实与推断的默认确认状态不符合合约。');
  }
  const evidence = arrayValue(record.evidence, '事件证据', 12).map((item, evidenceIndex) => parseEvidence(item, evidenceIndex, entries));
  if (!evidence.length) throw new Error('每个事件至少需要一条证据。');
  const impacts = arrayValue(record.stateImpactCandidates, '状态候选', 5).map(parseImpact);
  if (new Set(impacts.map((impact) => impact.dimension)).size !== impacts.length) throw new Error('同一事件的状态维度不能重复。');
  return {
    candidateId: textValue(record.candidateId, '事件候选 ID', 200),
    title: textValue(record.title, '事件标题', 60),
    description: textValue(record.description, '事件说明', 500),
    sourceType,
    confirmation,
    confidence: enumValue(record.confidence, ['high', 'medium', 'low'], '事件确定程度'),
    evidence,
    stateImpactCandidates: impacts,
    growthEvidenceCandidate: parseGrowthEvidence(record.growthEvidenceCandidate),
  };
}

function parseReflection(value: unknown): DailyReflection {
  const record = objectValue(value, '每日复盘');
  exactKeys(record, ['whatHappened', 'specificCredit', 'patternCandidate', 'nextSmallStep'], '每日复盘');
  let patternCandidate: DailyReflection['patternCandidate'] = null;
  if (record.patternCandidate !== null) {
    const pattern = objectValue(record.patternCandidate, '模式候选');
    exactKeys(pattern, ['observation', 'evidenceCount', 'neededEvidence'], '模式候选');
    patternCandidate = {
      observation: textValue(pattern.observation, '模式观察', 500),
      evidenceCount: integerValue(pattern.evidenceCount, '模式证据数', 1, 999),
      neededEvidence: textValue(pattern.neededEvidence, '所需证据', 300),
    };
  }
  return {
    whatHappened: textValue(record.whatHappened, '复盘事实', 500),
    specificCredit: textValue(record.specificCredit, '具体肯定', 500, true),
    patternCandidate,
    nextSmallStep: textValue(record.nextSmallStep, '下一小步', 300, true),
  };
}

function parseQuestSuggestion(value: unknown, index: number): QuestSuggestion {
  const record = objectValue(value, `任务建议${index + 1}`);
  exactKeys(record, ['type', 'title', 'why', 'minimumVersion', 'estimatedMinutes', 'difficulty', 'primaryState', 'growthBranchId', 'sourceGoalId', 'isRecovery'], `任务建议${index + 1}`);
  return {
    type: enumValue(record.type, ['main', 'side'], '任务类型'),
    title: textValue(record.title, '任务标题', 160),
    why: textValue(record.why, '任务理由', 500),
    minimumVersion: textValue(record.minimumVersion, '任务最小版本', 200),
    estimatedMinutes: integerValue(record.estimatedMinutes, '任务预计时间', 1, 1440),
    difficulty: enumValue(record.difficulty, ['light', 'standard', 'hard', 'challenge'], '任务难度'),
    primaryState: enumValue(record.primaryState, CONTRACT_DIMENSIONS, '任务主要状态'),
    growthBranchId: nullableText(record.growthBranchId, '成长分支 ID', 200),
    sourceGoalId: nullableText(record.sourceGoalId, '目标 ID', 200),
    isRecovery: booleanValue(record.isRecovery, '恢复任务标记'),
  };
}

function parseMemoryCandidate(value: unknown, index: number, eventIds: Set<string>): MemoryCandidate {
  const record = objectValue(value, `长期候选${index + 1}`);
  exactKeys(record, ['type', 'statement', 'confidence', 'supportingEventIds', 'counterEvidence', 'recommendedAction'], `长期候选${index + 1}`);
  const supportingEventIds = uniqueStrings(record.supportingEventIds, '支持事件 ID', 12);
  if (!supportingEventIds.length || supportingEventIds.some((id) => !eventIds.has(id))) throw new Error('长期候选必须引用本次分析事件。');
  return {
    type: enumValue(record.type, ['preference', 'pattern', 'principle', 'strength', 'constraint'], '长期候选类型'),
    statement: textValue(record.statement, '长期候选内容', 500),
    confidence: enumValue(record.confidence, ['high', 'medium', 'low'], '长期候选确定程度'),
    supportingEventIds,
    counterEvidence: uniqueStrings(record.counterEvidence, '反例', 12, 500),
    recommendedAction: enumValue(record.recommendedAction, ['observe', 'review'], '长期候选建议'),
  };
}

export function parseDailyAnalysisResponse(value: unknown, request: DailyAnalysisRequest): DailyAnalysisResponse {
  const root = objectValue(value, '整理响应');
  exactKeys(root, ['contractVersion', 'requestId', 'operation', 'result', 'warnings'], '整理响应');
  if (root.contractVersion !== ANALYSIS_CONTRACT_VERSION || root.operation !== 'daily_analysis' || root.requestId !== request.requestId) {
    throw new Error('响应信封与请求不一致。');
  }
  const resultRecord = objectValue(root.result, '整理结果');
  exactKeys(resultRecord, ['title', 'summary', 'explicitMoods', 'events', 'reflection', 'questSuggestions', 'memoryCandidates'], '整理结果');
  const entryTexts = new Map(request.userInput.entries.map((entry) => [entry.entryId, entry.text]));
  const events = arrayValue(resultRecord.events, '事件', 6).map((item, index) => parseEvent(item, index, entryTexts));
  if (new Set(events.map((event) => event.candidateId)).size !== events.length) throw new Error('事件候选 ID 不能重复。');
  const questSuggestions = arrayValue(resultRecord.questSuggestions, '任务建议', 3).map(parseQuestSuggestion);
  if (questSuggestions.filter((item) => item.type === 'main').length > 1 || questSuggestions.filter((item) => item.type === 'side').length > 2) {
    throw new Error('任务建议超过一条主线或两条支线。');
  }
  const eventIds = new Set(events.map((event) => event.candidateId));
  const result: DailyAnalysisResult = {
    title: textValue(resultRecord.title, '今日标题', 20),
    summary: textValue(resultRecord.summary, '今日摘要', 120),
    explicitMoods: uniqueStrings(resultRecord.explicitMoods, '明确心情', 8, 20),
    events,
    reflection: parseReflection(resultRecord.reflection),
    questSuggestions,
    memoryCandidates: arrayValue(resultRecord.memoryCandidates, '长期候选', 6).map((item, index) => parseMemoryCandidate(item, index, eventIds)),
  };
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION,
    requestId: request.requestId,
    operation: 'daily_analysis',
    result,
    warnings: uniqueStrings(root.warnings, '警告', 10, 200),
  };
}

export function parseTaskFeedbackResponse(value: unknown, request: TaskFeedbackRequest): TaskFeedbackResponse {
  const root = objectValue(value, '反馈响应');
  exactKeys(root, ['contractVersion', 'requestId', 'operation', 'result', 'warnings'], '反馈响应');
  if (root.contractVersion !== ANALYSIS_CONTRACT_VERSION || root.operation !== 'task_feedback' || root.requestId !== request.requestId) {
    throw new Error('响应信封与请求不一致。');
  }
  const result = objectValue(root.result, '反馈结果');
  exactKeys(result, ['completionCandidate', 'actualResult', 'evidenceQuote', 'suggestedDifficultyCorrection', 'followUpQuestion', 'confidence'], '反馈结果');
  const evidenceQuote = textValue(result.evidenceQuote, '反馈证据', 500);
  if (!request.userInput.feedbackText.includes(evidenceQuote)) throw new Error('反馈证据不在用户原文中。');
  const completionCandidate = enumValue(result.completionCandidate, ['complete', 'partial', 'skipped', 'unclear'], '完成情况候选');
  const followUpQuestion = nullableText(result.followUpQuestion, '必要追问', 300);
  if ((completionCandidate === 'unclear') !== Boolean(followUpQuestion)) throw new Error('只有不明确反馈可以提出一个必要追问。');
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION,
    requestId: request.requestId,
    operation: 'task_feedback',
    result: {
      completionCandidate,
      actualResult: textValue(result.actualResult, '实际结果摘要', 500),
      evidenceQuote,
      suggestedDifficultyCorrection: result.suggestedDifficultyCorrection === null
        ? null
        : enumValue(result.suggestedDifficultyCorrection, ['light', 'standard', 'hard', 'challenge'] as const, '难度修正候选'),
      followUpQuestion,
      confidence: enumValue(result.confidence, ['high', 'medium', 'low'], '反馈确定程度'),
    },
    warnings: uniqueStrings(root.warnings, '警告', 10, 200),
  };
}

function parseWeeklyPattern(value: unknown, label: string, events: Map<string, string>): WeeklyEvidencePattern {
  const record = objectValue(value, label);
  exactKeys(record, ['summary', 'evidenceEventIds', 'evidenceDates', 'relationship'], label);
  const summary = textValue(record.summary, `${label}摘要`, 500);
  const evidenceEventIds = uniqueStrings(record.evidenceEventIds, `${label}事件证据`, 20);
  if (evidenceEventIds.some((id) => !events.has(id))) throw new Error(`${label}引用了本次复盘之外的事件。`);
  const evidenceDates = uniqueStrings(record.evidenceDates, `${label}证据日期`, 7, 10).map((date) => localDateValue(date, `${label}证据日期`));
  const actualDates = new Set(evidenceEventIds.map((id) => events.get(id)));
  if (evidenceDates.some((date) => !actualDates.has(date))) throw new Error(`${label}的日期与事件证据不一致。`);
  if (evidenceDates.length < 2 && !summary.includes('尚不足以判断趋势')) throw new Error(`${label}需要至少两个不同日期，或明确写“尚不足以判断趋势”。`);
  return {
    summary,
    evidenceEventIds,
    evidenceDates,
    relationship: enumValue(record.relationship, ['correlation', 'causal', 'unknown'] as const, `${label}关系`),
  };
}

export function parseWeeklyReviewResponse(value: unknown, request: WeeklyReviewRequest): WeeklyReviewResponse {
  const root = objectValue(value, '周复盘响应');
  exactKeys(root, ['contractVersion', 'requestId', 'operation', 'result', 'warnings'], '周复盘响应');
  if (root.contractVersion !== ANALYSIS_CONTRACT_VERSION || root.operation !== 'weekly_review' || root.requestId !== request.requestId) {
    throw new Error('响应信封与请求不一致。');
  }
  const result = objectValue(root.result, '周复盘结果');
  exactKeys(result, ['stateTrends', 'recurringBenefits', 'recurringCosts', 'growthDeposits', 'habitDecisions', 'nextWeekTheme', 'nextExperiment', 'systemCandidates'], '周复盘结果');
  const eventDates = new Map(request.context.events.map((item) => [item.eventId, item.localDate]));
  const stateTrends = arrayValue(result.stateTrends, '状态趋势', 5).map((value, index) => {
    const record = objectValue(value, `状态趋势${index + 1}`);
    exactKeys(record, ['dimension', 'direction', 'summary', 'evidenceEventIds', 'evidenceDates', 'relationship'], `状态趋势${index + 1}`);
    const direction = enumValue(record.direction, ['up', 'down', 'stable', 'unknown'] as const, '趋势方向');
    const pattern = parseWeeklyPattern({
      summary: record.summary, evidenceEventIds: record.evidenceEventIds, evidenceDates: record.evidenceDates, relationship: record.relationship,
    }, `状态趋势${index + 1}`, eventDates);
    if (pattern.evidenceDates.length < 2 && direction !== 'unknown') throw new Error('证据不足的状态趋势方向必须是 unknown。');
    return {
      dimension: enumValue(record.dimension, CONTRACT_DIMENSIONS, '趋势维度'),
      direction,
      ...pattern,
    };
  });
  if (new Set(stateTrends.map((item) => item.dimension)).size !== stateTrends.length) throw new Error('同一状态维度不能重复。');
  const recurringBenefits = arrayValue(result.recurringBenefits, '重复收益', 8).map((value, index) => parseWeeklyPattern(value, `重复收益${index + 1}`, eventDates));
  const recurringCosts = arrayValue(result.recurringCosts, '重复消耗', 8).map((value, index) => parseWeeklyPattern(value, `重复消耗${index + 1}`, eventDates));
  const branchIds = new Set(request.context.growth.map((item) => item.branchId));
  const growthDeposits = arrayValue(result.growthDeposits, '成长存入', 12).map((value, index) => {
    const record = objectValue(value, `成长存入${index + 1}`);
    exactKeys(record, ['branchId', 'branchName', 'summary', 'evidenceEventIds'], `成长存入${index + 1}`);
    const branchId = nullableText(record.branchId, '成长分支 ID', 200);
    if (branchId && !branchIds.has(branchId)) throw new Error('成长存入引用了本次复盘之外的分支。');
    const evidenceEventIds = uniqueStrings(record.evidenceEventIds, '成长事件证据', 20);
    if (evidenceEventIds.some((id) => !eventDates.has(id))) throw new Error('成长存入引用了本次复盘之外的事件。');
    return { branchId, branchName: nullableText(record.branchName, '成长分支名称', 60), summary: textValue(record.summary, '成长存入摘要', 500), evidenceEventIds };
  });
  const habitIds = new Set(request.context.habits.map((item) => item.habitId));
  const habitDecisions = arrayValue(result.habitDecisions, '习惯建议', 20).map((value, index) => {
    const record = objectValue(value, `习惯建议${index + 1}`);
    exactKeys(record, ['habitId', 'action', 'reason'], `习惯建议${index + 1}`);
    const habitId = textValue(record.habitId, '习惯 ID', 200);
    if (!habitIds.has(habitId)) throw new Error('习惯建议引用了本次复盘之外的习惯。');
    return { habitId, action: enumValue(record.action, ['keep', 'lower_difficulty', 'change_trigger', 'pause', 'stop'] as const, '习惯建议动作'), reason: textValue(record.reason, '习惯建议理由', 500) };
  });
  if (new Set(habitDecisions.map((item) => item.habitId)).size !== habitDecisions.length) throw new Error('同一习惯只能有一个建议。');
  const theme = objectValue(result.nextWeekTheme, '下周主题');
  exactKeys(theme, ['title', 'reason'], '下周主题');
  const experiment = objectValue(result.nextExperiment, '下周实验');
  exactKeys(experiment, ['hypothesis', 'minimumAction', 'metric', 'endDate', 'stopCondition'], '下周实验');
  const endDate = localDateValue(experiment.endDate, '实验结束日期');
  const experimentDays = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${request.period.end}T00:00:00Z`)) / 86_400_000);
  if (experimentDays < 1 || experimentDays > 60) throw new Error('实验结束日期必须在复盘周期之后的六十天内。');
  const eventIds = new Set(eventDates.keys());
  const systemCandidates = arrayValue(result.systemCandidates, '系统候选', 8).map((item, index) => parseMemoryCandidate(item, index, eventIds));
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION, requestId: request.requestId, operation: 'weekly_review',
    result: {
      stateTrends, recurringBenefits, recurringCosts, growthDeposits, habitDecisions,
      nextWeekTheme: { title: textValue(theme.title, '下周主题', 120), reason: textValue(theme.reason, '主题理由', 500) },
      nextExperiment: {
        hypothesis: textValue(experiment.hypothesis, '实验假设', 500), minimumAction: textValue(experiment.minimumAction, '实验最小动作', 300),
        metric: textValue(experiment.metric, '实验指标', 300), endDate, stopCondition: textValue(experiment.stopCondition, '实验停止条件', 300),
      },
      systemCandidates,
    },
    warnings: uniqueStrings(root.warnings, '警告', 10, 200),
  };
}

export function parseSystemCandidateReviewResponse(value: unknown, request: SystemCandidateReviewRequest): SystemCandidateReviewResponse {
  const root = objectValue(value, '系统候选响应');
  exactKeys(root, ['contractVersion', 'requestId', 'operation', 'result', 'warnings'], '系统候选响应');
  if (root.contractVersion !== ANALYSIS_CONTRACT_VERSION || root.operation !== 'system_candidate_review' || root.requestId !== request.requestId) {
    throw new Error('响应信封与请求不一致。');
  }
  const result = objectValue(root.result, '系统候选结果');
  exactKeys(result, ['groups'], '系统候选结果');
  const candidates = new Map(request.userInput.candidates.map((item) => [item.memoryId, item]));
  const used = new Set<string>();
  const groups = arrayValue(result.groups, '候选分组', 30).map((value, index) => {
    const record = objectValue(value, `候选分组${index + 1}`);
    exactKeys(record, ['candidateMemoryIds', 'action', 'mergedStatement', 'reason', 'confidence'], `候选分组${index + 1}`);
    const candidateMemoryIds = uniqueStrings(record.candidateMemoryIds, '分组候选 ID', 30);
    if (!candidateMemoryIds.length || candidateMemoryIds.some((id) => !candidates.has(id))) throw new Error('候选分组引用了本次请求之外的内容。');
    if (candidateMemoryIds.some((id) => used.has(id))) throw new Error('同一候选不能出现在多个分组。');
    candidateMemoryIds.forEach((id) => used.add(id));
    const action = enumValue(record.action, ['keep_separate', 'merge'] as const, '候选分组动作');
    const mergedStatement = nullableText(record.mergedStatement, '合并候选内容', 500);
    if (action === 'merge') {
      if (candidateMemoryIds.length < 2 || !mergedStatement) throw new Error('合并候选至少需要两项和一条合并陈述。');
      const types = new Set(candidateMemoryIds.map((id) => candidates.get(id)?.type));
      if (types.size !== 1) throw new Error('不同类型的系统候选不能合并。');
    } else if (mergedStatement !== null) throw new Error('保留分开的候选不能返回合并陈述。');
    return {
      candidateMemoryIds, action, mergedStatement,
      reason: textValue(record.reason, '分组理由', 500),
      confidence: enumValue(record.confidence, ['high', 'medium', 'low'] as const, '分组确定程度'),
    };
  });
  if (used.size !== candidates.size) throw new Error('每条系统候选都必须且只能审阅一次。');
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION, requestId: request.requestId, operation: 'system_candidate_review',
    result: { groups }, warnings: uniqueStrings(root.warnings, '警告', 10, 200),
  };
}

export function parseGoalDecompositionResponse(value: unknown, request: GoalDecompositionRequest): GoalDecompositionResponse {
  const root = objectValue(value, '目标拆解响应');
  exactKeys(root, ['contractVersion', 'requestId', 'operation', 'result', 'warnings'], '目标拆解响应');
  if (root.contractVersion !== ANALYSIS_CONTRACT_VERSION || root.operation !== 'goal_decomposition' || root.requestId !== request.requestId) {
    throw new Error('响应信封与请求不一致。');
  }
  const result = objectValue(root.result, '目标拆解结果');
  exactKeys(result, ['refinedResult', 'completionEvidence', 'rationale', 'currentStage', 'estimatedInvestment', 'risks', 'milestones', 'nextStep', 'assumptions'], '目标拆解结果');
  const milestones = arrayValue(result.milestones, '目标里程碑', 5).map((value, index) => {
    const milestone = objectValue(value, `目标里程碑${index + 1}`);
    exactKeys(milestone, ['title', 'evidence'], `目标里程碑${index + 1}`);
    return {
      title: textValue(milestone.title, '里程碑标题', 200),
      evidence: textValue(milestone.evidence, '里程碑证据', 500),
    };
  });
  if (milestones.length < 2) throw new Error('目标拆解至少需要两个里程碑。');
  if (new Set(milestones.map((item) => item.title)).size !== milestones.length) throw new Error('目标里程碑不能重复。');
  const nextStep = objectValue(result.nextStep, '目标下一步');
  exactKeys(nextStep, ['title', 'why', 'minimumAction', 'estimatedMinutes', 'difficulty'], '目标下一步');
  const refinedResult = textValue(result.refinedResult, '优化后的目标结果', 160);
  const completionEvidence = textValue(result.completionEvidence, '完成证据', 500);
  const risks = uniqueStrings(result.risks, '关键风险', 5, 300);
  const assumptions = uniqueStrings(result.assumptions, '待确认假设', 5, 300);
  const nextTitle = textValue(nextStep.title, '下一步标题', 160);
  const minimumAction = textValue(nextStep.minimumAction, '下一步最小动作', 200);
  const vagueOrOverbroad = /变得?更好|提升自己|全面发展|所有方面|全部做好|彻底改变|成为最好的/.test(request.userInput.result);
  if (vagueOrOverbroad && !request.userInput.completionEvidence && !assumptions.length) throw new Error('模糊或过大的目标必须列出待确认假设。');
  if (request.context.currentGoals.some((goal) => goal.role === 'main') && !risks.length && !assumptions.length) throw new Error('存在当前主目标时必须说明优先级风险或假设。');
  const deadlinePattern = /(?:[一二三四五六七八九十百两\d]+\s*(?:天|周|个月|月|年)(?:内|后|前)|月底|年底|截止)/;
  if (!deadlinePattern.test(request.userInput.result) && deadlinePattern.test(refinedResult)) throw new Error('不能为没有截止时间的目标擅自添加期限。');
  if ([request.userInput.result, refinedResult].includes(nextTitle) || [request.userInput.result, refinedResult, nextTitle].includes(minimumAction)) {
    throw new Error('下一步必须比完整目标更小且可执行。');
  }
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION,
    requestId: request.requestId,
    operation: 'goal_decomposition',
    result: {
      refinedResult,
      completionEvidence,
      rationale: textValue(result.rationale, '拆解说明', 500),
      currentStage: textValue(result.currentStage, '当前阶段', 300),
      estimatedInvestment: textValue(result.estimatedInvestment, '预计投入', 300),
      risks,
      milestones,
      nextStep: {
        title: nextTitle,
        why: textValue(nextStep.why, '下一步理由', 500),
        minimumAction,
        estimatedMinutes: integerValue(nextStep.estimatedMinutes, '下一步预计时间', 1, 240),
        difficulty: enumValue(nextStep.difficulty, ['light', 'standard', 'hard', 'challenge'] as const, '下一步难度'),
      },
      assumptions,
    },
    warnings: uniqueStrings(root.warnings, '警告', 10, 200),
  };
}

export function parseModelJson(text: string): unknown {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = withoutThinking.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? withoutThinking;
  try {
    return JSON.parse(fenced);
  } catch {
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(fenced.slice(start, end + 1)); } catch { /* handled below */ }
    }
    throw new Error('模型没有返回可解析的 JSON。');
  }
}
