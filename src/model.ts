export const DIMENSIONS = [
  { key: 'energy', label: '体力', description: '睡眠、饮食、运动、疼痛与恢复' },
  { key: 'mind', label: '心力', description: '压力、安定感、掌控感与精神负荷' },
  { key: 'connection', label: '连接', description: '与重要他人的真实联系' },
  { key: 'progress', label: '推进', description: '工作与重要目标的方向感' },
  { key: 'play', label: '玩心', description: '好奇、兴趣、创作与无功利快乐' },
] as const;

export type Dimension = (typeof DIMENSIONS)[number]['key'];

export const DEFAULT_AREA_NAMES = ['身心健康', '工作与责任', '创造与作品', '学习与能力', '关系与连接', '内在与情绪', '生活与兴趣', '财富与自主'] as const;
export const ROOT_ASSETS = [
  { key: 'health', name: '健康资本' },
  { key: 'judgment', name: '判断力' },
  { key: 'knowledge', name: '特定知识' },
  { key: 'trust', name: '信任资本' },
  { key: 'leverage', name: '创造杠杆' },
  { key: 'autonomy', name: '自主权' },
] as const;

export type AssetKey = (typeof ROOT_ASSETS)[number]['key'];
export type AreaMode = 'build' | 'maintain' | 'explore' | 'pause';
export type GoalRole = 'main' | 'secondary' | 'wishlist';
export type GoalStatus = 'idea' | 'active' | 'paused' | 'completed' | 'abandoned';
export type QuestType = 'main' | 'bonus' | 'side';
export type QuestStatus = 'pending' | 'completed' | 'partial' | 'skipped' | 'exempt';
export type QuestSystemRetiredReason = 'elapsed' | 'schedule-changed' | 'tracking-disabled' | 'capacity' | 'source-invalidated';
export type HabitStatus = 'active' | 'paused' | 'ended';

/**
 * Canonical product vocabulary. Keep UI copy and persistence fields aligned:
 * area = life context; state = recent capacity signal; goal = desired result;
 * milestone = verifiable phase; habit = repeatable behavior; quest = dated action;
 * growth evidence = confirmed proof of change; system memory = user-confirmed rule.
 * A quest always carries sourceType/sourceId when generated and its feedback is
 * the only completion evidence that can settle XP.
 */

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ImportableEntity extends BaseEntity {
  importedFromId?: string;
}

export interface JournalEntry extends ImportableEntity {
  localDate: string;
  body: string;
  inputMethod: 'text' | 'import';
  /** Explicit user intent; absent on legacy records and defaults to a regular journal entry. */
  kind?: 'journal' | 'success';
  analysisStatus: 'not-submitted' | 'queued' | 'processing' | 'succeeded' | 'failed';
}

export interface JournalRevision extends ImportableEntity {
  entryId: string;
  fromVersion: number;
  previousBody: string;
  /** The kind before this revision; absent on legacy revisions and defaults to journal. */
  previousKind?: NonNullable<JournalEntry['kind']>;
  reason: 'user-edit' | 'undo' | 'import';
  undoneAt?: string;
}

export interface StateObservation extends BaseEntity {
  assessmentId: string;
  localDate: string;
  dimension: Dimension;
  kind: 'user-self-assessment' | 'user-calibration' | 'event-impact';
  value?: number;
  delta?: number;
  evidenceId?: string;
  reason?: string;
  active: boolean;
  observedAt: string;
  version: number;
}

export interface ResolvedDimensionState {
  dimension: Dimension;
  value: number;
  localDate: string;
  observedAt: string;
  observationIds: string[];
  dailyDelta: number;
  clamped: boolean;
}

export interface AppSettings extends BaseEntity {
  id: 'app';
  reduceMotion: boolean;
  onboardingSeen: boolean;
  aiAllowed: boolean;
  previewBeforeSend: boolean;
  guidanceTone: 'gentle' | 'direct';
  aiModel?: 'MiniMax-M3' | 'MiniMax-M2.7';
  aiApiKey?: string;
}

export interface Profile extends ImportableEntity {
  userName: string;
  companionName: string;
  avatar: 'male' | 'female' | null;
  chapterTitle: string;
  chapterStartedOn: string;
  timezone: string;
  weekStartsOn: 1;
}

export interface Area extends ImportableEntity {
  /** User-facing “人生领域”; separate from the five recent-state sensors. */
  name: string;
  mode: AreaMode;
  order: number;
  isDefault: boolean;
}

export interface GrowthBranch extends ImportableEntity {
  /** Internal entity behind the user-facing “成长方向”. */
  rootAsset: AssetKey;
  parentId?: string;
  name: string;
  order: number;
  status: 'active' | 'paused';
}

export interface Goal extends ImportableEntity {
  result: string;
  why: string;
  evidence: string;
  startDate?: string;
  targetDate?: string;
  nextStep: string;
  areaId: string;
  branchId: string;
  role: GoalRole;
  status: GoalStatus;
  /** Real transition time into completed; absent on legacy completed goals. */
  completedAt?: string;
  /** Local calendar day of completion; avoids deriving a user-facing date from UTC later. */
  completedDate?: string;
}

export interface Milestone extends ImportableEntity {
  goalId: string;
  /** Stable sequence inside the confirmed plan; legacy records may omit it. */
  order?: number;
  description: string;
  evidence: string;
  status: 'pending' | 'completed' | 'superseded';
  completedAt?: string;
  /** Present only when a confirmed task completion settled this milestone. */
  completionSourceQuestId?: string;
  xpSettled: boolean;
}

export interface Quest extends ImportableEntity {
  localDate: string;
  type: QuestType;
  sourceType: 'goal' | 'habit' | 'recovery' | 'manual';
  sourceId?: string;
  /** Explicit milestone provenance; actionId remains the idempotency key. */
  milestoneId?: string;
  /** Confirmed action that produced this derived follow-up. */
  predecessorQuestId?: string;
  actionId: string;
  settlementVersion: number;
  title: string;
  reason: string;
  minimumAction: string;
  /** The smallest observable evidence that counts as completion. */
  completionCriteria?: string;
  estimatedMinutes: number;
  deadlineAt?: string;
  difficulty: import('./rules.ts').Difficulty;
  dimension?: Dimension;
  branchId?: string;
  status: QuestStatus;
  /** System-only retirement is not user feedback and must stay read-only until explicitly restored. */
  systemRetiredAt?: string;
  systemRetiredReason?: QuestSystemRetiredReason;
  aiSuggested: boolean;
  userModified: boolean;
}

export interface DailyAnalysis extends ImportableEntity {
  localDate: string;
  requestId: string;
  contractVersion: '1.0';
  modelOutputVersion: '1.0';
  status: 'ready' | 'stale';
  sourceEntries: Array<{ entryId: string; revision: number }>;
  contextSummary: string;
  result: import('./analysis-contract.ts').DailyAnalysisResult;
  warnings: string[];
  rawResponse: string;
}

export interface JournalEvent extends ImportableEntity {
  analysisId: string;
  candidateId: string;
  localDate: string;
  sourceEntryIds: string[];
  title: string;
  description: string;
  sourceType: 'explicit' | 'inferred';
  confirmation: 'confirmed' | 'pending' | 'rejected';
  confidence: import('./analysis-contract.ts').Confidence;
  evidence: import('./analysis-contract.ts').AnalysisEvidence[];
  stateImpactCandidates: import('./analysis-contract.ts').StateImpactCandidate[];
  growthEvidenceCandidate: import('./analysis-contract.ts').GrowthEvidenceCandidate | null;
  active: boolean;
  userEdited: boolean;
}

export interface StateSnapshot extends ImportableEntity {
  localDate: string;
  values: Partial<Record<Dimension, number>>;
  lastEvidenceAt: Partial<Record<Dimension, string>>;
  observationIds: string[];
}

export interface AnalysisJob extends ImportableEntity {
  requestId: string;
  operation: 'daily_analysis' | 'weekly_review';
  localDate: string;
  contractVersion: '1.0';
  idempotencyKey: string;
  request: import('./analysis-contract.ts').DailyAnalysisRequest | import('./analysis-contract.ts').WeeklyReviewRequest;
  status: 'queued' | 'processing' | 'succeeded' | 'failed' | 'stale' | 'safety-review';
  attemptCount: number;
  nextAttemptAt?: string;
  errorCode?: import('./analysis-contract.ts').AnalysisErrorCode;
  errorMessage?: string;
  analysisId?: string;
  reviewId?: string;
}

export interface Review extends ImportableEntity {
  requestId: string;
  type: 'weekly' | 'monthly';
  periodStart: string;
  periodEnd: string;
  contractVersion: '1.0';
  status: 'candidate' | 'confirmed' | 'rejected';
  rejectedAt?: string;
  request: import('./analysis-contract.ts').WeeklyReviewRequest;
  stateTrends: Array<import('./analysis-contract.ts').WeeklyEvidencePattern & { dimension: Dimension; direction: 'up' | 'down' | 'stable' | 'unknown' }>;
  recurringBenefits: import('./analysis-contract.ts').WeeklyEvidencePattern[];
  recurringCosts: import('./analysis-contract.ts').WeeklyEvidencePattern[];
  growthDeposits: Array<{ branchId: string | null; branchName: string | null; summary: string; evidenceEventIds: string[] }>;
  habitDecisions: Array<{ habitId: string; action: import('./analysis-contract.ts').HabitDecisionAction; reason: string }>;
  nextTheme: string;
  nextThemeReason: string;
  nextExperiment: {
    hypothesis: string;
    minimumAction: string;
    metric: string;
    endDate: string;
    stopCondition: string;
  };
  warnings: string[];
  rawResponse: string;
}

export interface SystemMemory extends ImportableEntity {
  analysisId?: string;
  reviewId?: string;
  type: 'preference' | 'pattern' | 'principle' | 'strength' | 'constraint';
  statement: string;
  evidenceIds: string[];
  counterEvidence: string[];
  confidence: import('./analysis-contract.ts').Confidence;
  recommendedAction: 'observe' | 'review';
  status: 'candidate' | 'confirmed' | 'forgotten';
  /** Keep the memory visible while excluding it from proactive AI reminders. */
  reminderMuted?: boolean;
  confirmedAt?: string;
  forgottenAt?: string;
  userEdited: boolean;
}

export interface QuestFeedback extends ImportableEntity {
  questId: string;
  result: Exclude<QuestStatus, 'pending'>;
  note: string;
  actual: string;
  settlementVersion: number;
  /** The day the user says the action actually happened; absent on legacy feedback. */
  completedDate?: string;
  undoneAt?: string;
}

export interface Habit extends ImportableEntity {
  name: string;
  minimumAction: string;
  scheduleDays: number[];
  /** Effective-dated BONUS tracking rules; absent on legacy records. */
  scheduleHistory?: Array<{
    effectiveFrom: string;
    scheduleDays: number[];
    trackingEnabled: boolean;
  }>;
  trigger?: string;
  dimension: Dimension;
  branchId: string;
  difficulty: import('./rules.ts').Difficulty;
  status: HabitStatus;
  bonusEnabled: boolean;
}

export interface HabitLog extends ImportableEntity {
  habitId: string;
  localDate: string;
  result: Exclude<QuestStatus, 'pending'>;
  questId: string;
  settlementKey?: string;
}

export interface XpLedger extends ImportableEntity {
  settlementKey: string;
  sourceType: 'quest' | 'habit' | 'milestone';
  sourceId: string;
  branchId: string;
  baseXp: number;
  ratio: 0.5 | 1;
  finalXp: number;
  difficulty: import('./rules.ts').Difficulty | 'milestone';
  localDate: string;
  reversedAt?: string;
}

export interface BackupData {
  profile: Profile[];
  areas: Area[];
  entries: JournalEntry[];
  revisions: JournalRevision[];
  analyses: DailyAnalysis[];
  events: JournalEvent[];
  observations: StateObservation[];
  snapshots: StateSnapshot[];
  goals: Goal[];
  milestones: Milestone[];
  quests: Quest[];
  questFeedback: QuestFeedback[];
  habits: Habit[];
  habitLogs: HabitLog[];
  branches: GrowthBranch[];
  xpLedger: XpLedger[];
  reviews: Review[];
  memories: SystemMemory[];
  analysisJobs: AnalysisJob[];
  settings: AppSettings[];
}

export interface BackupBundle {
  format: 'qiguang-backup';
  formatVersion: 4;
  exportedAt: string;
  appVersion: string;
  data: BackupData;
}

let lastTimestamp = 0;

export function nowIso(): string {
  const timestamp = Math.max(Date.now(), lastTimestamp + 1);
  lastTimestamp = timestamp;
  return new Date(timestamp).toISOString();
}

export function localDate(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export function parseLocalDate(value: string): Date {
  if (!isLocalDate(value)) throw new Error('日期格式无效。');
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

export function shiftDate(value: string, days: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    ...options,
  }).format(parseLocalDate(value));
}

export function validateBody(value: string): string {
  if (!value.trim()) throw new Error('先写下一点真实发生的事。');
  if (value.length > 12_000) throw new Error('单条记录最多 12000 个字符。');
  return value;
}

export function dimensionLabel(key: Dimension): string {
  return DIMENSIONS.find((item) => item.key === key)?.label ?? key;
}

export function stateBand(value: number): string {
  if (value < 25) return '优先照顾';
  if (value < 45) return '需要关注';
  if (value < 65) return '基本稳定';
  if (value < 85) return '状态良好';
  return '当前充足';
}
