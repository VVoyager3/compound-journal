import { QiguangDb, migrateLegacyJournalContent, parseBackup } from './db.ts';
import { actionButton, actionGroup, avatarChoice, avatarChoiceGroup, choiceGroup, choiceRow, disclosure, emptyState, fileButton, formStack, infoRow, labelledControl, listGroup, listRow, listSection, metricGroup, optionalDetails, overflowMenu, periodNavigator, primaryButton, recordItem, sectionHeading, segmentedControl, segmentedItem, statusMessage, taskRow, textAction, titleBar, titlebarAction } from './ui-list.ts';
import {
  DEFAULT_WEEKLY_REVIEW_SCOPE,
  DIMENSIONS,
  type AnalysisJob,
  type AppSettings,
  type DailyAnalysis,
  type DailyReviewNote,
  type Dimension,
  type Goal,
  type Habit,
  type HabitLog,
  type JournalEvent,
  type JournalEntry,
  type Profile,
  type Quest,
  type QuestFeedback,
  type Review,
  type ResolvedDimensionState,
  type StateObservation,
  type SystemMemory,
  type WeeklyReviewNote,
  dimensionLabel,
  formatDate,
  isLocalDate,
  localDate,
  parseLocalDate,
  shiftDate,
} from './model.ts';
import {
  ANALYSIS_CONTRACT_VERSION,
  parseDailyAnalysisResponse,
  parseGoalDecompositionResponse,
  parseSystemCandidateReviewResponse,
  parseTaskFeedbackResponse,
  parseWeeklyReviewResponse,
  type AnalysisErrorCode,
  type ContractDimension,
  type DailyAnalysisRequest,
  type GoalDecompositionRequest,
  type GoalDecompositionResult,
  type QuestSuggestion,
  type SystemCandidateReviewRequest,
  type TaskFeedbackRequest,
  type WeeklyReviewRequest,
} from './analysis-contract.ts';
import { DIFFICULTY_XP, chooseDailyDirection, type Difficulty, type FeedbackResult } from './rules.ts';
import { buildWidgetSnapshot, consumeWidgetAction, requestWidgetPin, saveWidgetSnapshot, widgetPinState } from './widget.ts';
import { analyzeWithNativeAi, nativeAiConfiguration } from './direct-ai.ts';
import { selectGrowthBadges, type GrowthBadge } from './badges.ts';
import { assessmentQuestions, scoreAssessment, scoreDimensionAssessment, type AssessmentLength } from './assessment.ts';
import type { AnalysisRequest } from './ai-engine.ts';
import { Capacitor } from '@capacitor/core';
import maleCompanionImage from '../design-assets/pre-development/character-frames/male/01-idle-front.png';
import femaleCompanionImage from '../design-assets/pre-development/character-frames/female/01-idle-front.png';
import badgeMilestoneImage from '../design-assets/generated/growth-icons/badge-milestone.png';
import badgeGoalImage from '../design-assets/generated/growth-icons/badge-goal.png';
import badgeHabitImage from '../design-assets/generated/growth-icons/badge-habit.png';
import badgeRecoveryImage from '../design-assets/generated/growth-icons/badge-recovery.png';
import badgeExperimentImage from '../design-assets/generated/growth-icons/badge-experiment.png';
import branchHealthImage from '../design-assets/generated/growth-icons/branch-health.png';
import branchTrustImage from '../design-assets/generated/growth-icons/branch-trust.png';
import branchAutonomyImage from '../design-assets/generated/growth-icons/branch-autonomy.png';
import habitWalkingImage from '../design-assets/generated/habit-icons/walking.png';
import habitStudyImage from '../design-assets/generated/habit-icons/study.png';
import habitPhoneImage from '../design-assets/generated/habit-icons/phone.png';
import habitBedtimeImage from '../design-assets/generated/habit-icons/bedtime.png';
import habitChecklistImage from '../design-assets/generated/habit-icons/checklist.png';
import navTodayIcon from '../design-assets/generated/ui-icons/nav-today.png';
import navTasksIcon from '../design-assets/generated/ui-icons/nav-tasks.png';
import navRecordIcon from '../design-assets/generated/ui-icons/nav-record.png';
import navGrowthIcon from '../design-assets/generated/ui-icons/nav-growth.png';
import navSettingsIcon from '../design-assets/generated/ui-icons/nav-settings.png';
import calendarIcon from '../design-assets/generated/ui-icons/calendar.png';
import successRecordIcon from '../design-assets/generated/ui-icons/success-record.png';
import habitIcon from '../design-assets/generated/ui-icons/habit.png';
import weeklyReviewIcon from '../design-assets/generated/ui-icons/weekly-review.png';
import goalIcon from '../design-assets/generated/ui-icons/goal.png';
import rulesIcon from '../design-assets/generated/ui-icons/rules.png';
import aiIcon from '../design-assets/generated/ui-icons/ai.png';
import costIcon from '../design-assets/generated/ui-icons/cost.png';
import connectionIcon from '../design-assets/generated/ui-icons/connection.png';
import notificationIcon from '../design-assets/generated/ui-icons/notification.png';
import storageIcon from '../design-assets/generated/ui-icons/storage.png';
import transferIcon from '../design-assets/generated/ui-icons/transfer.png';
import privacyIcon from '../design-assets/generated/ui-icons/privacy.png';
import deleteIcon from '../design-assets/generated/ui-icons/delete.png';
import assessmentIcon from '../design-assets/generated/ui-icons/assessment.png';
import displayToneIcon from '../design-assets/generated/ui-icons/display-tone.png';
import widgetIcon from '../design-assets/generated/ui-icons/widget.png';
import searchIcon from '../design-assets/generated/ui-icons/search.png';
import taskFocusIcon from '../design-assets/generated/ui-icons/task-focus.png';
import experienceIcon from '../design-assets/generated/ui-icons/experience.png';
import providerIcon from '../design-assets/generated/ui-icons/provider.png';
import organizeIcon from '../design-assets/generated/ui-icons/organize.png';


type RouteName = 'today' | 'calendar' | 'record' | 'tasks' | 'growth' | 'system' | 'day' | 'review' | 'task-analysis' | 'habit-analysis';
type SemanticIcon = 'nav-today' | 'nav-tasks' | 'nav-record' | 'nav-growth' | 'nav-settings' | 'calendar'
  | 'success-record' | 'habit' | 'weekly-review' | 'goal' | 'rules' | 'ai' | 'cost' | 'connection'
  | 'notification' | 'storage' | 'transfer' | 'privacy' | 'delete' | 'assessment'
  | 'display-tone' | 'widget' | 'search' | 'task-focus' | 'experience' | 'provider' | 'organize';
interface Route { name: RouteName; date?: string; entityId?: string }
type SnapshotVariant = 'steady' | 'rest' | 'focus' | 'play' | 'connection' | 'bright';
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface RecordDraft {
  body: string;
  fullBody: string;
  kind: NonNullable<JournalEntry['kind']>;
  summary: string;
  imageDataUrl?: string;
}

interface TaskFeedbackDraft {
  result: FeedbackResult;
  completedDate: string;
  difficulty: Difficulty;
  actual: string;
  note: string;
  skipReason: string;
  stateDelta?: number;
}

const DRAFT_KEY = 'qiguang.record-drafts.v2';
const TASK_FEEDBACK_DRAFT_PREFIX = 'qiguang.task-feedback-draft.';
const SEEN_BADGES_KEY = 'qiguang.seen-badges.v1';
const RECORD_IMAGE_MAX_BYTES = 1_500_000;
const INTERRUPTED_TAKEOVER_MS = 2 * 60_000;
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');
const AVAILABLE_AI_MODELS = ['MiniMax-M3', 'MiniMax-M2.7'] as const;
type AiModelChoice = (typeof AVAILABLE_AI_MODELS)[number];
const DEFAULT_AI_MODEL: AiModelChoice = AVAILABLE_AI_MODELS[0];
const MEMORY_TYPE_LABELS: Record<SystemMemory['type'], string> = {
  constraint: '需要尊重的边界',
  preference: '更适合我的方式',
  pattern: '对我有效的方法',
  strength: '已经证明的优势',
  principle: '我认同的原则',
};
const CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' } as const;
const NATIVE_PLATFORM = Capacitor.isNativePlatform();
const NATIVE_AI_UNAVAILABLE = 'AI 未配置';
const BASE_AI_READY = !NATIVE_PLATFORM || (() => {
  try { return new URL(API_ORIGIN).protocol === 'https:'; } catch { return false; }
})();
let NATIVE_DIRECT_AI_READY = false;
let NATIVE_AI_READY = BASE_AI_READY;

function apiUrl(path: '/api/analyze' | '/api/health'): string {
  if (!NATIVE_AI_READY) throw new Error(NATIVE_AI_UNAVAILABLE);
  return `${API_ORIGIN}${path}`;
}

function canonicalAiModel(value: AppSettings['aiModel']): AiModelChoice {
  return value === 'MiniMax-M2.7' ? value : DEFAULT_AI_MODEL;
}

function nativeAiConfig(): { model: AiModelChoice; apiKey: string | undefined } {
  return { model: canonicalAiModel(settings.aiModel), apiKey: (settings.aiApiKey ?? '').trim() || undefined };
}

async function initializeNativeAi(): Promise<void> {
  if (!NATIVE_PLATFORM) return;
  const configuration = await nativeAiConfiguration();
  NATIVE_DIRECT_AI_READY = configuration.configured;
  syncNativeAiAvailability();
}

function directAiErrorResponse(error: unknown): Response {
  const code = (error as { code?: AnalysisErrorCode })?.code ?? 'SERVICE_UNAVAILABLE';
  const status = code === 'INPUT_TOO_LARGE' ? 413 : code === 'RATE_LIMITED' ? 429 : code === 'SAFETY_REVIEW' ? 422 : code === 'UNSUPPORTED_CONTRACT' ? 426 : 503;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (code === 'RATE_LIMITED') headers['Retry-After'] = '60';
  const body = code === 'SAFETY_REVIEW'
    ? { error: { code, message: errorMessage(error), resourceAction: 'local-help', doesNotMonitor: true } }
    : { error: { code, message: errorMessage(error) } };
  return new Response(JSON.stringify(body), { status, headers });
}

async function requestAnalysis(request: AnalysisRequest, signal: AbortSignal): Promise<Response> {
  const hasCustomApiKey = Boolean((settings.aiApiKey ?? '').trim());
  if (NATIVE_PLATFORM && (NATIVE_DIRECT_AI_READY || hasCustomApiKey)) {
    const nativeConfig = nativeAiConfig();
    try {
      const result = await analyzeWithNativeAi(request, nativeConfig.model, nativeConfig.apiKey);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      return directAiErrorResponse(error);
    }
  }
  return fetch(apiUrl('/api/analyze'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
  });
}

function userSuccessCredits(entries: JournalEntry[]): string[] {
  const values = entries.filter((entry) => entry.kind === 'success').map((entry) => entry.body.trim());
  return [...new Set(values)].slice(0, 5);
}

function successCredits(entries: JournalEntry[], quests: Quest[] = [], events: JournalEvent[] = []): string[] {
  const confirmedActions = quests.flatMap((quest) => quest.status === 'completed'
    ? [`完成：${quest.title}`]
    : quest.status === 'partial' ? [`推进：${quest.title}`] : []);
  const confirmedEvents = events
    .filter((event) => event.active && event.confirmation === 'confirmed' && event.growthEvidenceCandidate)
    .map((event) => event.title);
  return [...new Set([
    ...userSuccessCredits(entries),
    ...confirmedActions,
    ...confirmedEvents,
  ])].slice(0, 5);
}

function activeFeedbackByQuest(feedbacks: QuestFeedback[]): Map<string, QuestFeedback> {
  const result = new Map<string, QuestFeedback>();
  feedbacks.filter((item) => !item.undoneAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .forEach((item) => { if (!result.has(item.questId)) result.set(item.questId, item); });
  return result;
}

function questResultDate(quest: Quest, feedbacks: Map<string, QuestFeedback>): string {
  return feedbacks.get(quest.id)?.completedDate ?? quest.localDate;
}
const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('页面缺少应用容器。');
const root: HTMLElement = appRoot;

document.addEventListener('click', (event) => {
  const panel = root.querySelector<HTMLElement>('.character-panel:not([hidden])');
  const target = event.target;
  if (!panel || !(target instanceof Node) || panel.contains(target)) return;
  if (target instanceof Element && target.closest('.companion-trigger')) return;
  const trigger = root.querySelector<HTMLButtonElement>('.companion-trigger');
  panel.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (panel.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
});

let db: QiguangDb;
let settings: AppSettings;
function syncNativeAiAvailability(): void {
  NATIVE_AI_READY = BASE_AI_READY || NATIVE_DIRECT_AI_READY || (NATIVE_PLATFORM && Boolean(settings?.aiApiKey?.trim()));
}
let currentRoute = parseRoute();
let previousRouteKey = routeKey(currentRoute);
let routeNavigationPending = false;
let focusRecordInputOnNextRender = false;
let focusAfterRenderSelector = '';
let skipFocusRequested = false;
let renderToken = 0;
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarSelectedDate = localDate();
let toastTimer = 0;
let draftNeedsUnloadWarning = false;
let draftsLoaded = false;
let memoryDrafts: Record<string, RecordDraft> = {};
let installPrompt: InstallPromptEvent | null = null;
let reloadingForUpdate = false;
let updateAcceptedInThisTab = false;

function avatarAsset(avatar: Exclude<Profile['avatar'], null>): string {
  return avatar === 'male' ? maleCompanionImage : femaleCompanionImage;
}

function avatarName(avatar: Profile['avatar']): string {
  return avatar === 'male' ? '包包' : '鱼鱼';
}

function resolvedCompanionName(profile: Profile | undefined): string {
  const saved = profile?.companionName.trim();
  return saved && saved !== '小栖' ? saved : avatarName(profile?.avatar ?? null);
}


function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

const SEMANTIC_ICON_ASSETS: Record<SemanticIcon, string> = {
  'nav-today': navTodayIcon,
  'nav-tasks': navTasksIcon,
  'nav-record': navRecordIcon,
  'nav-growth': navGrowthIcon,
  'nav-settings': navSettingsIcon,
  calendar: calendarIcon,
  'success-record': successRecordIcon,
  habit: habitIcon,
  'weekly-review': weeklyReviewIcon,
  goal: goalIcon,
  rules: rulesIcon,
  ai: aiIcon,
  cost: costIcon,
  connection: connectionIcon,
  notification: notificationIcon,
  storage: storageIcon,
  transfer: transferIcon,
  privacy: privacyIcon,
  delete: deleteIcon,
  assessment: assessmentIcon,
  'display-tone': displayToneIcon,
  widget: widgetIcon,
  search: searchIcon,
  'task-focus': taskFocusIcon,
  experience: experienceIcon,
  provider: providerIcon,
  organize: organizeIcon,
};

function semanticIcon(icon: SemanticIcon, className = ''): HTMLImageElement {
  const mark = node('img', `semantic-icon${className ? ` ${className}` : ''}`);
  mark.src = SEMANTIC_ICON_ASSETS[icon];
  mark.alt = '';
  mark.draggable = false;
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function interruptedRetryButton(job: AnalysisJob, onClick: () => void): HTMLButtonElement {
  const button = primaryButton('处理中；2 分钟后可检查重试', onClick);
  const refresh = () => {
    const remaining = Date.parse(job.updatedAt) + INTERRUPTED_TAKEOVER_MS - Date.now();
    button.disabled = remaining > 0;
    button.textContent = remaining > 0 ? '处理中；2 分钟后可检查重试' : '检查同一请求并重试';
    if (remaining > 0) window.setTimeout(() => { if (button.isConnected) refresh(); }, remaining + 50);
  };
  refresh();
  return button;
}

function routeKey(route: Route): string {
  return route.date ? `${route.name}:${route.date}` : route.entityId ? `${route.name}:${route.entityId}` : route.name;
}

function parseRoute(): Route {
  const value = location.hash.replace(/^#/, '') || '/today';
  const dated = value.match(/^\/(day|record|review)\/(\d{4}-\d{2}-\d{2})$/);
  if (dated?.[1] && dated[2] && isLocalDate(dated[2])) return { name: dated[1] as 'day' | 'record' | 'review', date: dated[2] };
  const entity = value.match(/^\/(habit-analysis)\/([^/]+)$/);
  if (entity?.[1] && entity[2]) return { name: entity[1] as 'habit-analysis', entityId: entity[2] };
  const legacyRoutes: Record<string, RouteName> = { diary: 'record', quests: 'tasks', history: 'calendar', status: 'system', settings: 'system' };
  const rawName = value.replace(/^\//, '');
  const name = legacyRoutes[rawName] ?? rawName as RouteName;
  if (['today', 'calendar', 'record', 'tasks', 'growth', 'system', 'review', 'task-analysis', 'habit-analysis'].includes(name)) return { name };
  return { name: 'today' };
}

function go(route: Route): void {
  location.hash = route.date ? `#/${route.name}/${route.date}` : route.entityId ? `#/${route.name}/${route.entityId}` : `#/${route.name}`;
}

function showToast(
  message: string,
  tone: 'normal' | 'error' | 'completion' = 'normal',
  action?: { label: string; run: () => void },
): void {
  document.querySelector('.toast-layer, .toast')?.remove();
  window.clearTimeout(toastTimer);
  const toast = node('div', `toast${tone === 'error' ? ' is-error' : tone === 'completion' ? ' is-completion' : ''}`);
  toast.append(node('span', 'toast-copy', message));
  const removeToast = () => (toast.closest('.toast-layer') ?? toast).remove();
  if (action) {
    const button = node('button', 'toast-action', action.label);
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      action.run();
      removeToast();
    });
    toast.append(button);
  }
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  if (action && tone !== 'completion') {
    const layer = node('div', 'toast-layer');
    layer.addEventListener('click', (event) => { if (event.target === layer) removeToast(); });
    layer.append(toast);
    document.body.append(layer);
  } else document.body.append(toast);
  toastTimer = window.setTimeout(removeToast, action ? 8_000 : tone === 'completion' ? 2_800 : 3_600);
}

function showCompletionToast(message: string, action?: { label: string; run: () => void }): void {
  const experience = message.match(/([\p{Script=Han}/]+)成长 ([+-]\d+)/u);
  const badge = message.match(/已解锁“([^”]+)”徽章/u);
  const title = message.includes('目标已完成') ? '目标已完成'
    : message.includes('子任务已完成') || message.includes('最后一个子任务') ? '子任务已完成'
      : '任务已完成';
  const detail = [
    experience && Number(experience[2]) !== 0 ? `${experience[1]} ${experience[2]} 成长值` : '',
    badge ? `新徽章 · ${badge[1]}` : '',
  ].filter(Boolean).join('\n');
  showToast(`${title}${detail ? `\n${detail}` : ''}`, 'completion', action);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生了未知错误。';
}

function toContractDimension(dimension: Dimension): ContractDimension {
  return dimension;
}

function fromContractDimension(dimension: ContractDimension): Dimension {
  return dimension;
}

function analysisErrorCopy(code: AnalysisErrorCode | undefined, fallback = ''): string {
  return ({
    OFFLINE: '当前离线；任务已保存在本机，联网后由你手动重试。',
    INPUT_TOO_LARGE: '本次发送超过 20000 个字符，请减少记录范围。',
    RATE_LIMITED: '整理请求过快，请稍后手动重试。',
    MODEL_TIMEOUT: '模型响应超时；原文仍在本机，可手动重试。',
    INVALID_MODEL_OUTPUT: 'AI 返回的内容无法识别；结果没有写入正式数据，请稍后重试。',
    UNSUPPORTED_CONTRACT: '当前 AI 整理功能需要更新应用后再使用。',
    SAFETY_REVIEW: '当下安全最重要；普通任务、成长值和游戏化反馈已暂停。',
    SERVICE_UNAVAILABLE: '整理服务暂时不可用；本地记录与任务不受影响。',
  } satisfies Record<AnalysisErrorCode, string>)[code ?? 'SERVICE_UNAVAILABLE'] || fallback;
}

async function analysisContext(date: string): Promise<{
  events: JournalEvent[];
  recentStates: DailyAnalysisRequest['context']['recentStates'];
  goals: DailyAnalysisRequest['context']['goals'];
  habits: DailyAnalysisRequest['context']['bonusHabits'];
  memories: SystemMemory[];
  recentTaskResults: DailyAnalysisRequest['context']['recentTaskResults'];
}> {
  const [events, goals, habits, memories, quests, feedbacks, ...states] = await Promise.all([
    db.listJournalEvents(date),
    db.listGoals(),
    db.listHabits(),
    db.listMemories('confirmed'),
    db.listQuests(date),
    db.listQuestFeedback(),
    ...Array.from({ length: 7 }, (_, offset) => db.resolvedStateAtOrBefore(shiftDate(date, -offset))),
  ]);
  const recentStates = states.flatMap((resolved, offset) => {
    const values = Object.fromEntries(Object.entries(resolved).map(([dimension, value]) => [
      toContractDimension(dimension as Dimension), value.value,
    ])) as Partial<Record<ContractDimension, number>>;
    return Object.keys(values).length ? [{ localDate: shiftDate(date, -offset), values }] : [];
  });
  const feedbackByQuest = activeFeedbackByQuest(feedbacks);
  return {
    events: events.filter((item) => item.active && item.confirmation === 'confirmed'),
    recentStates,
    goals: goals.filter((item) => item.status === 'active').slice(0, 3).map((item) => ({
      goalId: item.id, result: item.result,
    })),
    habits: habits.filter((item) => item.status === 'active' && item.bonusEnabled).slice(0, 3).map((item) => ({
      habitId: item.id, name: item.name, minimumAction: item.minimumAction,
    })),
    memories: memories.filter((item) => !item.reminderMuted).slice(0, 20),
    recentTaskResults: quests.flatMap((quest) => {
      const feedback = feedbackByQuest.get(quest.id);
      if (!feedback || (feedback.result !== 'completed' && feedback.result !== 'partial')) return [];
      return [{ questId: quest.id, localDate: feedback.completedDate ?? quest.localDate, title: quest.title, result: feedback.result, actual: feedback.actual || feedback.note }];
    }),
  };
}

async function submitAnalysisJob(job: AnalysisJob, resumeInterrupted = false): Promise<void> {
  if (job.operation !== 'daily_analysis') throw new Error('这不是每日整理任务。');
  if (!NATIVE_AI_READY) {
    showToast(NATIVE_AI_UNAVAILABLE, 'error');
    await render();
    return;
  }
  if (!settings.aiAllowed) {
    showToast('AI 权限已关闭；没有发送任何内容。', 'error');
    await render();
    return;
  }
  if (!navigator.onLine) {
    showToast('已保存在本机；联网后由你手动重试。');
    await render();
    return;
  }
  let processing: AnalysisJob;
  try {
    processing = await db.markAnalysisJobProcessing(job.id, resumeInterrupted ? {
      expectedVersion: job.version,
      staleBefore: new Date(Date.now() - INTERRUPTED_TAKEOVER_MS).toISOString(),
    } : undefined);
  } catch (error) {
    showToast(errorMessage(error), 'error');
    await render();
    return;
  }
  await render();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await requestAnalysis(processing.request, controller.signal);
    const body = await response.json().catch(() => null) as { error?: { code?: AnalysisErrorCode; message?: string } } | null;
    if (!response.ok) {
      const apiError = new Error(body?.error?.message || '整理服务暂时不可用。') as Error & { code?: AnalysisErrorCode; nextAttemptAt?: string };
      apiError.code = body?.error?.code ?? 'SERVICE_UNAVAILABLE';
      const retryAfter = Number(response.headers.get('Retry-After') ?? 0);
      if (retryAfter > 0) apiError.nextAttemptAt = new Date(Date.now() + retryAfter * 1000).toISOString();
      throw apiError;
    }
    if (processing.operation !== 'daily_analysis') throw new Error('整理队列操作发生变化。');
    parseDailyAnalysisResponse(body, processing.request as DailyAnalysisRequest);
    await db.saveDailyAnalysis(processing.id, body, processing.version);
    showToast('整理已保存；推断仍等你确认。');
  } catch (error) {
    const current = (await db.listAnalysisJobs(processing.localDate)).find((item) => item.id === processing.id);
    if (current?.status === 'processing' && current.version === processing.version) {
      const typed = error as Error & { code?: AnalysisErrorCode; nextAttemptAt?: string };
      const code: AnalysisErrorCode = typed.name === 'AbortError' ? 'MODEL_TIMEOUT'
        : typed.code ?? (navigator.onLine ? 'SERVICE_UNAVAILABLE' : 'OFFLINE');
      await db.failAnalysisJob(processing.id, code, analysisErrorCopy(code, errorMessage(error)), typed.nextAttemptAt, processing.version);
      showToast(analysisErrorCopy(code, errorMessage(error)), 'error');
    } else if (current?.status === 'stale') {
      showToast('记录已改变，旧整理结果没有应用。', 'error');
    } else showToast('同一请求已由新的重试接管，旧结果没有应用。');
  } finally {
    window.clearTimeout(timeout);
    await render();
  }
}

function loadDrafts(): void {
  if (draftsLoaded) return;
  draftsLoaded = true;
  let migratedLegacyDraft = false;
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as unknown;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [date, value] of Object.entries(saved)) {
        if (!isLocalDate(date)) continue;
        if (typeof value === 'string' && value.length <= 12_000) {
          memoryDrafts[date] = { ...migrateLegacyJournalContent(value), fullBody: '', summary: '' };
          migratedLegacyDraft = true;
        }
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
          const draft = value as Partial<RecordDraft>;
          if (typeof draft.body === 'string' && draft.body.length <= 12_000) {
            const summary = typeof draft.summary === 'string' && draft.summary.length <= 120 ? draft.summary : '';
            const fullBody = typeof draft.fullBody === 'string' && draft.fullBody.length <= 12_000 ? draft.fullBody : '';
            const imageDataUrl = typeof draft.imageDataUrl === 'string' && draft.imageDataUrl.length <= 2_200_000 ? draft.imageDataUrl : undefined;
            if (draft.kind === 'journal' || draft.kind === 'success' || draft.kind === 'fun') memoryDrafts[date] = { body: draft.body, fullBody, kind: draft.kind, summary, imageDataUrl };
            else { memoryDrafts[date] = { ...migrateLegacyJournalContent(draft.body), fullBody, summary, imageDataUrl }; migratedLegacyDraft = true; }
          }
        }
      }
      if (migratedLegacyDraft) persistDrafts();
    }
  } catch {
    // A malformed or unavailable draft store should not prevent recording.
  }
}

function persistDrafts(): void {
  try {
    if (Object.keys(memoryDrafts).length) localStorage.setItem(DRAFT_KEY, JSON.stringify(memoryDrafts));
    else localStorage.removeItem(DRAFT_KEY);
    draftNeedsUnloadWarning = false;
  } catch {
    draftNeedsUnloadWarning = Object.values(memoryDrafts).some((draft) => Boolean(draft.body || draft.fullBody || draft.summary || draft.imageDataUrl));
  }
}

function readDraft(date: string): RecordDraft {
  loadDrafts();
  return memoryDrafts[date] ?? { body: '', fullBody: '', kind: 'journal', summary: '' };
}

function saveDraft(date: string, body: string, kind: RecordDraft['kind'], summary?: string, imageDataUrl?: string | null, fullBody?: string): void {
  loadDrafts();
  const savedSummary = summary ?? memoryDrafts[date]?.summary ?? '';
  const savedImage = imageDataUrl === undefined ? memoryDrafts[date]?.imageDataUrl : imageDataUrl || undefined;
  const savedFullBody = fullBody ?? memoryDrafts[date]?.fullBody ?? '';
  if (body || savedFullBody || savedSummary || savedImage || kind === 'success') memoryDrafts[date] = { body, fullBody: savedFullBody, kind, summary: savedSummary, imageDataUrl: savedImage };
  else delete memoryDrafts[date];
  persistDrafts();
}

function openSuccessRecord(date: string): void {
  go({ name: 'record', date });
}

function clearDraft(date?: string): void {
  loadDrafts();
  if (date) delete memoryDrafts[date];
  else memoryDrafts = {};
  persistDrafts();
}

function readRecordImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片。');
  if (file.size > RECORD_IMAGE_MAX_BYTES) throw new Error('图片请压缩到 1.5MB 以内。');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败。')));
    reader.addEventListener('error', () => reject(new Error('图片读取失败。')));
    reader.readAsDataURL(file);
  });
}

function pageHeader(title: string, options: {
  action?: HTMLElement;
  back?: boolean;
  fallback?: Route;
  meta?: string;
} = {}): HTMLElement {
  const tail = options.action ?? (options.meta && options.meta !== title ? node('span', 'page-header-meta', options.meta) : undefined);
  const { header, heading } = titleBar(title, {
    className: `page-header${options.back ? ' secondary-page-header' : ''}`,
    back: options.back ? { onClick: () => history.length > 1 ? history.back() : go(options.fallback ?? { name: 'today' }), className: 'secondary-back' } : undefined,
    tail,
  });
  heading.title = title;
  heading.tabIndex = -1;
  return header;
}

function networkBadge(): HTMLElement {
  const badge = node('span', `network-badge${navigator.onLine ? '' : ' is-offline'}`, navigator.onLine ? '本地可用' : '离线 · 本地可用');
  badge.dataset.networkBadge = '';
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');
  return badge;
}

function bottomNavigation(route: Route): HTMLElement {
  const nav = node('nav', 'bottom-nav');
  nav.setAttribute('aria-label', '主要导航');
  const items: Array<[RouteName, string]> = [
    ['today', '今日'],
    ['tasks', '任务'],
    ['record', '记录'],
    ['growth', '轨迹'],
    ['system', '设置'],
  ];
  const outlines: Record<string, string> = {
    today: '<circle cx="12" cy="12" r="5"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    tasks: '<rect x="5" y="2" width="15" height="20" rx="1.5"/><path d="m8 8 1.5 1.5L12 6m2 2h3m-9 6 1.5 1.5L12 12m2 2h3m-9 5h9"/>',
    record: '<path d="M12 4C9 2 5 2 2 3v17c3-1 7-1 10 1 3-2 7-2 10-1V3c-3-1-7-1-10 1Zm0 0v17"/>',
    growth: '<path d="M12 22V10C12 4 7 3 2 4c0 6 4 8 10 7m0 0c0-6 4-8 10-7 0 6-4 8-10 7"/>',
    system: '<path d="m9 3 1-2h4l1 2 2 1 2-.5 2 3-1 2v3l1 2-2 3-2-.5-2 1-1 3h-4l-1-3-2-1-2 .5-2-3 1-2v-3l-1-2 2-3 2 .5Z"/><circle cx="12" cy="10.5" r="3.5"/>',
  };
  for (const [name, label] of items) {
    const active = route.name === name || (name === 'growth' && ['calendar', 'day', 'review'].includes(route.name))
      || (name === 'tasks' && ['task-analysis', 'habit-analysis'].includes(route.name));
    const link = node('a', `nav-item${active ? ' is-active' : ''}`);
    link.href = `#/${name}`;
    if (active) link.setAttribute('aria-current', 'page');
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('viewBox', '0 0 24 24');
    mark.setAttribute('class', 'navigation-icon');
    mark.setAttribute('aria-hidden', 'true');
    const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${outlines[name] ?? ''}</svg>`, 'image/svg+xml');
    mark.append(...Array.from(parsed.documentElement.children));
    link.append(mark, node('span', '', label));
    nav.append(link);
  }
  return nav;
}

function renderShell(main: HTMLElement, route: Route): void {
  main.id = 'main-content';
  main.tabIndex = -1;
  const secondary = ['day', 'task-analysis', 'habit-analysis'].includes(route.name);
  const shell = node('div', `app-shell${secondary ? ' is-secondary' : ''}`);
  const connectivity = networkBadge();
  connectivity.classList.add('shell-network-status');
  shell.append(connectivity, main);
  shell.append(bottomNavigation(route));
  root.replaceChildren(shell);
  if (skipFocusRequested) {
    skipFocusRequested = false;
    requestAnimationFrame(() => main.focus({ preventScroll: false }));
    return;
  }
  if (!routeNavigationPending && !focusAfterRenderSelector) return;
  const requestedFocus = focusAfterRenderSelector;
  focusAfterRenderSelector = '';
  if (!routeNavigationPending) {
    requestAnimationFrame(() => main.querySelector<HTMLElement>(requestedFocus)?.focus({ preventScroll: true }));
    return;
  }
  routeNavigationPending = false;
  requestAnimationFrame(() => {
    const stored = Number(sessionStorage.getItem(`qiguang.scroll.${routeKey(route)}`) ?? 0);
    window.scrollTo({ top: Number.isFinite(stored) ? stored : 0, behavior: 'auto' });
    const target = focusRecordInputOnNextRender ? main.querySelector<HTMLElement>('.life-diary-input, .journal-input') : main.querySelector<HTMLElement>('h1');
    focusRecordInputOnNextRender = false;
    target?.focus({ preventScroll: true });
  });
}


function roomStage(compact = false, avatar: Profile['avatar'] = null, companionName = '鱼鱼', snapshotDate: string | null = null): HTMLElement {
  const stage = node('section', `room-stage companion-stage${compact ? ' is-compact' : ''}`);
  stage.setAttribute('aria-label', '生活分身');
  if (snapshotDate) stage.dataset.snapshotDate = snapshotDate;
  const portrait = node('img', 'companion-figure');
  portrait.src = avatar === 'male' ? maleCompanionImage : femaleCompanionImage;
  portrait.alt = companionName;
  if (compact) {
    stage.append(portrait);
    return stage;
  }
  const button = node('button', 'companion-trigger');
  button.type = 'button';
  button.setAttribute('aria-label', '生活分身');
  button.setAttribute('aria-expanded', 'false');
  button.append(portrait);
  const panel = node('div', 'character-panel');
  panel.id = `character-panel-${crypto.randomUUID()}`;
  panel.hidden = true;
  button.setAttribute('aria-controls', panel.id);
  const closePanel = (): void => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.focus({ preventScroll: true });
  };
  const close = node('button', 'character-panel-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭生活分身');
  close.addEventListener('click', closePanel);
  panel.append(close, node('strong', '', companionName || avatarName(avatar)));
  const actions = actionGroup('character-actions');
  actions.append(
    primaryButton('回看今天', () => go({ name: 'day', date: localDate() })),
    actionButton('再记一件事', () => go({ name: 'record' }), { variant: 'quiet' }),
  );
  panel.append(actions);
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) close.focus();
  });
  stage.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); closePanel(); }
  });
  stage.append(button, panel);
  return stage;
}

function observationIsStale(observation: { localDate: string }, referenceDate = localDate()): boolean {
  return (parseLocalDate(referenceDate).getTime() - parseLocalDate(observation.localDate).getTime()) / 86_400_000 > 7;
}

function localDateTimeInput(timestamp?: string): string {
  if (!timestamp) return '';
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return '';
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function entryTime(entry: JournalEntry): string {
  return new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function isoFromDateTimeInput(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function snapshotVariantFor(
  date: string,
  entries: JournalEntry[],
  observations: Partial<Record<Dimension, ResolvedDimensionState>>,
  quests: Quest[],
  analysis?: DailyAnalysis,
): SnapshotVariant {
  const scores: Record<SnapshotVariant, number> = { steady: 1, rest: 0, focus: 0, play: 0, connection: 0, bright: 0 };
  const lowVariant: Record<Dimension, SnapshotVariant> = { energy: 'rest', mind: 'rest', connection: 'connection', progress: 'focus', play: 'play' };
  const highVariant: Record<Dimension, SnapshotVariant> = { energy: 'bright', mind: 'steady', connection: 'connection', progress: 'focus', play: 'play' };
  for (const state of Object.values(observations)) {
    if (!state || observationIsStale(state, date)) continue;
    if (state.value < 45) scores[lowVariant[state.dimension]] += 2 + (45 - state.value) / 10;
    else if (state.value > 68) scores[highVariant[state.dimension]] += 1 + (state.value - 68) / 16;
  }

  const journal = `${entries.map((entry) => entry.body).join(' ')} ${(analysis?.result.explicitMoods ?? []).join(' ')}`;
  const journalSignals: Array<[SnapshotVariant, RegExp]> = [
    ['connection', /朋友|家人|伴侣|同事|见面|聊天|一起|陪伴|联系|关系/],
    ['play', /有趣|开心|游戏|电影|音乐|散步|旅行|玩|放松|好笑/],
    ['rest', /疲惫|很累|睡眠|休息|生病|难受|焦虑|压力|低落/],
    ['focus', /工作|学习|项目|完成|推进|专注|写作|解决|交付/],
  ];
  journalSignals.forEach(([variant, pattern]) => { if (pattern.test(journal)) scores[variant] += 3; });

  for (const event of analysis?.result.events ?? []) {
    for (const impact of event.stateImpactCandidates) {
      const dimension = fromContractDimension(impact.dimension);
      const variant = impact.direction === 'negative' ? lowVariant[dimension] : highVariant[dimension];
      scores[variant] += Math.max(1, Math.abs(impact.suggestedDelta) / 5);
    }
  }
  if (entries.some((entry) => entry.kind === 'success')) scores.bright += 2;
  if (quests.some((quest) => quest.status === 'completed' || quest.status === 'partial')) scores.bright += 2;
  return (Object.entries(scores) as Array<[SnapshotVariant, number]>).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'steady';
}

function snapshotRoomStage(
  date: string,
  entries: JournalEntry[],
  observations: Partial<Record<Dimension, ResolvedDimensionState>>,
  quests: Quest[],
  profile: Profile | undefined,
  analysis?: DailyAnalysis,
): HTMLElement {
  const stage = roomStage(true, profile?.avatar ?? null, resolvedCompanionName(profile), date);
  const variant = snapshotVariantFor(date, entries, observations, quests, analysis);
  stage.classList.add(`is-snapshot-${variant}`);
  stage.dataset.snapshotVariant = variant;
  return stage;
}

async function openStateDetail(dimension: (typeof DIMENSIONS)[number], observation?: ResolvedDimensionState, referenceDate = localDate()): Promise<void> {
  const [ledger, quests, feedbacks, events, entries] = await Promise.all([
    db.listStateObservations(dimension.key, referenceDate),
    db.listQuests(),
    db.listQuestFeedback(),
    db.listJournalEvents(),
    db.listEntries(),
  ]);
  const sameDayCalibrationOverrides = observation && ledger.some((item) => item.active && item.kind === 'event-impact'
    && item.localDate === observation.localDate && !observation.observationIds.includes(item.id));
  const { dialog, content, actions } = dialogShell(dimension.label, { back: true, className: 'ui-rebuilt-page ui-state-page', fullScreen: true });
  const scoreSection = node('section', 'ui-state-summary');
  content.append(scoreSection);
  if (observation) {
    const stale = observationIsStale(observation, referenceDate);
    const score = node('p', 'ui-state-score');
    score.setAttribute('aria-label', `当前分数 ${observation.value}`);
    score.append(node('strong', '', String(observation.value)), node('span', '', '分'));
    scoreSection.append(score, node('p', 'caption ui-state-date', formatDate(observation.localDate, { weekday: undefined })));
    if (stale || sameDayCalibrationOverrides || observation.clamped) content.append(
      node('p', stale ? 'danger-copy' : 'caption', stale
        ? referenceDate === localDate() ? '这个分数已经超过 7 天，建议重新评估。' : '这是当天能够找到的最近一次分数。'
        : sameDayCalibrationOverrides ? '当天填写的问卷分数优先。'
          : `当天记录使分数变化了 ${observation.dailyDelta > 0 ? '+' : ''}${observation.dailyDelta}。`),
    );
  } else {
    scoreSection.append(emptyState('暂无分数'));
  }

  const feedbackByQuest = activeFeedbackByQuest(feedbacks);
  const impactByEvidence = new Map(ledger
    .filter((item) => item.active && item.kind === 'event-impact' && item.evidenceId)
    .map((item) => [item.evidenceId!, item]));
  const relatedQuests = quests
    .filter((quest) => quest.dimension === dimension.key && quest.localDate <= referenceDate)
    .sort((left, right) => questResultDate(right, feedbackByQuest).localeCompare(questResultDate(left, feedbackByQuest))
      || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 4);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const seenEntryIds = new Set<string>();
  const relatedEntries = events
    .filter((event) => event.active && event.confirmation === 'confirmed' && event.localDate <= referenceDate
      && (event.stateImpactCandidates.some((impact) => fromContractDimension(impact.dimension) === dimension.key)
        || (event.growthEvidenceCandidate && fromContractDimension(event.growthEvidenceCandidate.dimension) === dimension.key)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .flatMap((event) => event.sourceEntryIds.map((entryId) => ({ event, entry: entryById.get(entryId) })))
    .filter((item): item is { event: JournalEvent; entry: JournalEntry } => {
      if (!item.entry || seenEntryIds.has(item.entry.id)) return false;
      seenEntryIds.add(item.entry.id);
      return true;
    })
    .slice(0, 4);

  const appendRelatedSection = (title: string, emptyText: string, rows: Array<{ title: string; meta: string; delta?: number }>): void => {
    const section = listSection(title, { className: 'ui-state-related' });
    const list = listGroup();
    if (!rows.length) {
      list.append(infoRow(emptyText, '', { className: 'is-empty' }));
    } else {
      rows.forEach((item) => {
        const meta = node('span', '', item.meta);
        if (item.delta !== undefined) {
          const delta = node('span', '', `${item.delta > 0 ? '+' : ''}${item.delta}`);
          delta.dataset.stateDelta = 'true';
          meta.append(' ', delta);
        }
        list.append(infoRow(item.title, meta));
      });
    }
    section.append(list);
    content.append(section);
  };

  appendRelatedSection('相关任务', '暂无相关任务', relatedQuests.map((quest) => {
    const feedback = feedbackByQuest.get(quest.id);
    const impact = feedback ? impactByEvidence.get(feedback.id) : undefined;
    return {
      title: quest.title,
      meta: `${formatDate(questResultDate(quest, feedbackByQuest), { weekday: undefined })} · ${feedback ? FEEDBACK_LABELS[feedback.result] : quest.status === 'pending' ? '待完成' : FEEDBACK_LABELS[quest.status]}`,
      delta: impact?.delta,
    };
  }));
  appendRelatedSection('相关记录', '暂无相关记录', relatedEntries.map(({ event, entry }) => ({
    title: entry.body,
    meta: formatDate(entry.localDate, { weekday: undefined }),
    delta: impactByEvidence.get(event.id)?.delta,
  })));

  if (ledger.length) {
    const summary = listRow('summary', 'ui-info-row ui-disclosure-row');
    summary.append(node('span', 'ui-row-label', '分数变化'), node('span', 'ui-row-chevron', '›'));
    const history = disclosure(summary, 'ui-state-history');
    const historyList = listGroup();
    ledger.slice(0, 20).forEach((item) => {
      const value = item.kind === 'event-impact'
        ? `${(item.delta ?? 0) > 0 ? '+' : ''}${item.delta ?? 0}`
        : `问卷分数 ${item.value}`;
      historyList.append(infoRow(`${value} · ${item.kind === 'event-impact' ? item.reason ?? '你确认过的日记影响' : '状态问卷'}`,
        `${formatDate(item.localDate)} · ${item.active ? '已计入' : '已撤销'}`, { multiline: true }));
    });
    history.append(historyList);
    content.append(history);
  }
  actions.remove();
  if (referenceDate === localDate()) {
    const assess = primaryButton('重新评估', () => { dialog.close(); openAssessmentQuestionnaire(30, dimension.key); });
    scoreSection.append(assess);
  }
  dialog.showModal();
  content.querySelector<HTMLButtonElement>('.ui-back-button')?.focus();
}

function statusSummary(observations: Partial<Record<Dimension, ResolvedDimensionState>>, referenceDate = localDate()): HTMLElement {
  const section = node('section', 'surface ui-surface-plain status-summary');
  section.append(sectionHeading('五维状态'));
  const grid = node('div', 'status-grid');
  for (const dimension of DIMENSIONS) {
    const observation = observations[dimension.key];
    const shortLabel = dimension.label;
    const item = node('button', 'status-item');
    item.type = 'button';
    item.setAttribute('aria-label', observation
      ? `${shortLabel}当前分数 ${observation.value}，点击查看`
      : `${shortLabel}暂无分数，点击评估`);
    item.addEventListener('click', () => { void openStateDetail(dimension, observation, referenceDate); });
    item.append(
      node('span', 'status-name', shortLabel),
      node('strong', '', observation ? String(observation.value) : '—'),
    );
    item.style.setProperty('--status-value', `${observation?.value ?? 0}%`);
    grid.append(item);
  }
  section.append(grid);
  return section;
}

const DIFFICULTY_LABELS: Record<string, string> = { light: '简单', standard: '普通', hard: '挑战' };
const FEEDBACK_LABELS: Record<FeedbackResult, string> = { completed: '完成', partial: '部分完成', skipped: '跳过', exempt: '豁免' };

interface RecoverySuggestion {
  title: string;
  minimumAction: string;
  estimatedMinutes: number;
}

const RECOVERY_SUGGESTIONS: Record<Dimension, RecoverySuggestion[]> = {
  energy: [
    { title: '先让身体缓一缓', minimumAction: '喝一杯水，离开屏幕慢走五分钟', estimatedMinutes: 5 },
    { title: '做一次很短的舒展', minimumAction: '活动肩颈并伸展三分钟', estimatedMinutes: 3 },
  ],
  mind: [
    { title: '给大脑留三分钟空白', minimumAction: '闭眼慢呼吸六次，只观察此刻感受', estimatedMinutes: 3 },
    { title: '暂时停止继续输入', minimumAction: '离开信息流，安静坐着或走动十分钟', estimatedMinutes: 10 },
  ],
  connection: [
    { title: '和一个信任的人重新连上', minimumAction: '发一句真实近况，不要求对方立刻回复', estimatedMinutes: 3 },
    { title: '留下一个小小的善意', minimumAction: '向一个具体的人表达一次感谢', estimatedMinutes: 5 },
  ],
  progress: [
    { title: '把工作缩到下一步', minimumAction: '关掉无关页面，只做当前任务五分钟', estimatedMinutes: 5 },
    { title: '先卸下一项不必要的推进', minimumAction: '把今天不重要的一项移到稍后', estimatedMinutes: 3 },
  ],
  play: [
    { title: '留一点没有产出要求的时间', minimumAction: '听歌、玩或发呆十分钟，不做成果记录', estimatedMinutes: 10 },
    { title: '跟着好奇心走一小步', minimumAction: '做一件纯粹觉得有趣的小事五分钟', estimatedMinutes: 5 },
  ],
};

function selectOption(value: string, label: string, selected = false): HTMLOptionElement {
  const option = node('option', '', label);
  option.value = value;
  option.selected = selected;
  return option;
}

function taskDimensionSelect(selected: Dimension = 'progress'): HTMLSelectElement {
  const control = node('select', 'input');
  DIMENSIONS.forEach((item) => control.append(selectOption(item.key, item.label, item.key === selected)));
  return control;
}

function taskDifficultySelect(selected: Difficulty = 'standard'): HTMLSelectElement {
  const control = node('select', 'input');
  (Object.keys(DIFFICULTY_XP) as Difficulty[]).forEach((value) => {
    control.append(selectOption(value, DIFFICULTY_LABELS[value] ?? value, value === selected));
  });
  return control;
}

function taskReminderAt(date: string, time: string): string | undefined {
  return time && isLocalDate(date) ? isoFromDateTimeInput(`${date}T${time}`) : undefined;
}

function distributedStageDate(index: number, count: number, targetDate: string): string {
  const start = parseLocalDate(localDate()).getTime();
  const end = parseLocalDate(targetDate).getTime();
  const timestamp = start + Math.round(Math.max(0, end - start) * (index + 1) / Math.max(1, count));
  return localDate(new Date(timestamp));
}

function questFeedbackFocusSelector(quest: Quest): string {
  const id = CSS.escape(quest.id);
  return `[data-quest-feedback-for="${id}"],[data-habit-checkin-for="${id}"]`;
}

type GoalProgression = Awaited<ReturnType<QiguangDb['feedbackAndProgressQuest']>>;

function goalProgressMessage(progression: GoalProgression, result: FeedbackResult, fallback: string): string {
  if (progression.followUp) return `${result === 'partial' ? '已保留进展；缩小后的下一步' : progression.milestoneCompleted ? '子任务已完成；下一步' : '已完成；下一步'}“${progression.followUp.title}”已加入今天。`;
  if (progression.goalReady) return '最后一个子任务已完成；请在目标卡确认最终结果。';
  if (progression.milestoneCompleted) return '子任务已完成，可以继续安排下一步。';
  return fallback;
}

function seenGrowthBadgeIds(): Set<string> {
  let seen = new Set<string>();
  try {
    const stored = JSON.parse(localStorage.getItem(SEEN_BADGES_KEY) ?? '[]') as unknown;
    if (Array.isArray(stored)) seen = new Set(stored.filter((item): item is string => typeof item === 'string'));
  } catch { /* A broken display preference must not block settlement feedback. */ }
  return seen;
}

function saveSeenGrowthBadgeIds(seen: Set<string>): void {
  try { localStorage.setItem(SEEN_BADGES_KEY, JSON.stringify([...seen])); } catch { /* Private storage may be unavailable. */ }
}

async function loadGrowthBadges(): Promise<GrowthBadge[]> {
  const [milestones, goals, ledger, habits, habitLogs, quests, feedbacks, reviews] = await Promise.all([
    db.listMilestones(), db.listGoals(), db.listXpLedger(), db.listHabits(), db.listHabitLogs(),
    db.listQuests(), db.listQuestFeedback(), db.listReviews('weekly'),
  ]);
  return selectGrowthBadges({ milestones, goals, ledger, habits, habitLogs, quests, feedbacks, reviews });
}

async function growthBadgeIds(): Promise<Set<string>> {
  return new Set((await loadGrowthBadges()).map((badge) => badge.id));
}

async function announceNewGrowthBadge(before: Set<string>, fallback: string, completion = false): Promise<void> {
  const badges = await loadGrowthBadges();
  const seen = seenGrowthBadgeIds();
  const unlocked = badges.filter((badge) => !before.has(badge.id) && !seen.has(badge.id));
  if (!unlocked.length) { completion ? showCompletionToast(fallback) : showToast(fallback); return; }
  unlocked.forEach((badge) => seen.add(badge.id));
  saveSeenGrowthBadgeIds(seen);
  const badge = unlocked[0]!;
  sessionStorage.setItem('qiguang.character-celebration', badge.id);
  const action = { label: '查看', run: () => go({ name: 'growth' }) };
  if (completion) showCompletionToast(`${fallback} 已解锁“${badge.name}”徽章。`, action);
  else showToast(`已解锁“${badge.name}”徽章。${unlocked.length > 1 ? `另有 ${unlocked.length - 1} 枚。` : ''}${fallback}`, 'normal', action);
}

type QuestProgress = Awaited<ReturnType<QiguangDb['dimensionProgress']>>;

async function questProgress(quest: Quest): Promise<QuestProgress | null> {
  return quest.dimension ? db.dimensionProgress(quest.dimension) : null;
}

async function feedbackSettlementMessage(
  quest: Quest,
  result: FeedbackResult,
  actual: string,
  progression: GoalProgression,
  fallback: string,
  before: QuestProgress | null,
): Promise<string> {
  const progress = goalProgressMessage(progression, result, fallback);
  const record = actual.trim().replace(/[。！？!?]+$/, '') || quest.title;
  const recordLabel = result === 'completed' || result === 'partial' ? '完成记录' : '行动记录';
  if (!before || !quest.dimension) return `${progress} ${recordLabel}：${record}。`;
  const after = await db.dimensionProgress(quest.dimension);
  const delta = after.totalXp - before.totalXp;
  const level = before.level === after.level ? `${after.level}` : `${before.level}→${after.level}`;
  return `${progress} ${recordLabel}：${record}。${dimensionLabel(quest.dimension)}成长 ${delta >= 0 ? '+' : ''}${delta} · 累计 ${after.totalXp} · 等级 ${level}。`;
}

async function completeQuestFromRow(quest: Quest, item: HTMLElement): Promise<void> {
  item.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true; });
  try {
    const achievementsBefore = await growthBadgeIds();
    const before = await questProgress(quest);
    const progression = await db.feedbackAndProgressQuest(quest.id, 'completed', '', '', quest.difficulty, 0, localDate());
    sessionStorage.setItem('qiguang.character-celebration', quest.id);
    focusAfterRenderSelector = `[data-quest-id="${CSS.escape(quest.id)}"]`;
    const message = await feedbackSettlementMessage(quest, 'completed', '', progression, '已完成；可在任务列表中撤销。', before);
    await render();
    await announceNewGrowthBadge(achievementsBefore, message, true);
  } catch (error) {
    item.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false; });
    showToast(errorMessage(error), 'error');
  }
}

function questDifficultyLabel(quest: Quest, difficulty = quest.difficulty): string {
  const label = DIFFICULTY_LABELS[difficulty] ?? difficulty;
  return quest.dimension ? `${label} · ${DIFFICULTY_XP[difficulty]} 成长值` : label;
}

function questMinimumAction(quest: Quest): string {
  return quest.minimumAction?.trim() || quest.title;
}

async function changeCountQuestProgress(quest: Quest, delta: -1 | 1, controls: HTMLElement): Promise<void> {
  const progress = quest.progressCount ?? 0;
  const target = quest.targetCount ?? 1;
  if (delta === 1 && progress + 1 >= target) {
    await openQuestFeedbackDialog(quest, 'completed');
    return;
  }
  controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true; });
  try {
    const updated = await db.changeQuestProgress(quest.id, delta);
    focusAfterRenderSelector = `[data-quest-id="${CSS.escape(quest.id)}"]`;
    showToast(delta > 0 ? `已记录 ${updated.progressCount}/${target}${quest.countUnit || '次'}。` : '已减去一次记录。');
    await render();
  } catch (error) {
    showToast(errorMessage(error), 'error');
    controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false; });
  }
}

function recordQuestCheckIn(quest: Quest, controls: HTMLElement): void {
  const target = quest.targetCount ?? 1;
  if ((quest.progressCount ?? 0) + 1 < target) void changeCountQuestProgress(quest, 1, controls);
  else void completeQuestFromRow(quest, controls);
}

function countQuestActions(quest: Quest): HTMLElement {
  const actions = actionGroup('quest-actions quest-count-actions');
  const progress = quest.progressCount ?? 0;
  const target = quest.targetCount ?? 1;
  const minus = actionButton('−1', () => { void changeCountQuestProgress(quest, -1, actions); }, { variant: 'quiet' });
  minus.disabled = progress === 0;
  minus.setAttribute('aria-label', `减少一次：${quest.title}`);
  const count = node('output', 'quest-count-progress', `${progress}/${target} ${quest.countUnit || '次'}`);
  count.setAttribute('aria-live', 'polite');
  const plus = primaryButton('+1', () => { void changeCountQuestProgress(quest, 1, actions); });
  plus.setAttribute('aria-label', `记录一次：${quest.title}`);
  const skip = actionButton('跳过今天', () => { void openQuestFeedbackDialog(quest, 'skipped'); }, { variant: 'quiet' });
  skip.setAttribute('aria-label', `跳过今天：${quest.title}`);
  const details = actionButton('补充记录', () => { void openQuestFeedbackDialog(quest); }, { variant: 'quiet' });
  details.setAttribute('aria-label', `补充任务记录：${quest.title}`);
  const adjust = actionButton('编辑任务', () => { void openQuestAdjustmentDialog(quest); }, { variant: 'quiet' });
  adjust.setAttribute('aria-label', `编辑任务：${quest.title}`);
  const more = overflowMenu('•••', [skip, details, adjust], { ariaLabel: '更多操作', compactTrigger: true });
  actions.append(minus, count, plus, more);
  return actions;
}

function quickQuestActions(quest: Quest): HTMLElement {
  const actions = actionGroup('quest-actions quest-quick-actions quest-result-actions');
  const choices: Array<[Extract<FeedbackResult, 'completed' | 'partial' | 'skipped'>, string, 'primary' | 'secondary' | 'quiet']> = [
    ['completed', '完成', 'primary'],
    ['partial', '有进展', 'secondary'],
    ['skipped', '跳过今天', 'quiet'],
  ];
  for (const [result, label, variant] of choices) {
    const button = actionButton(label, () => { void openQuestFeedbackDialog(quest, result); }, { variant });
    button.setAttribute('aria-label', `${label}：${quest.title}`);
    actions.append(button);
  }
  const details = actionButton('补充记录', () => { void openQuestFeedbackDialog(quest); }, { variant: 'quiet' });
  details.setAttribute('aria-label', `补充任务记录：${quest.title}`);
  const adjust = actionButton('编辑任务', () => { void openQuestAdjustmentDialog(quest); }, { variant: 'quiet' });
  adjust.setAttribute('aria-label', `编辑任务：${quest.title}`);
  const more = overflowMenu('•••', [details, adjust], { ariaLabel: '更多操作', compactTrigger: true });
  actions.append(more);
  return actions;
}

async function confirmRemoveTaskItem(label: string, remove: () => Promise<unknown>, trigger: HTMLButtonElement, parentDialog?: HTMLDialogElement): Promise<void> {
  if (!await confirmAction('删除这一项？', `“${label}”会从任务页移除，已有进展会保留。`, '删除', true)) return;
  trigger.disabled = true;
  try {
    await remove();
    parentDialog?.close();
    showToast('已删除；历史记录保留。');
    await render();
  } catch (error) {
    trigger.disabled = false;
    showToast(errorMessage(error), 'error');
  }
}

async function openQuestFeedbackDialog(quest: Quest, initialResult?: FeedbackResult): Promise<void> {
  const [feedbackHistory, stateHistory] = await Promise.all([
    db.listQuestFeedback(quest.id),
    quest.dimension ? db.listStateObservations(quest.dimension) : Promise.resolve([]),
  ]);
  const previousFeedback = feedbackHistory.find((item) => !item.undoneAt);
  let draft: TaskFeedbackDraft | undefined;
  try {
    const stored = JSON.parse(localStorage.getItem(`${TASK_FEEDBACK_DRAFT_PREFIX}${quest.id}`) ?? 'null') as Partial<TaskFeedbackDraft> | null;
    if (stored && ['completed', 'partial', 'skipped', 'exempt'].includes(stored.result ?? '')
      && typeof stored.actual === 'string' && typeof stored.note === 'string') draft = stored as TaskFeedbackDraft;
  } catch { /* A broken draft must not block the result form. */ }
  const skippedAttempts = feedbackHistory.filter((item) => !item.undoneAt && item.result === 'skipped').length;
  const previousEffect = previousFeedback ? stateHistory.find((item) => item.evidenceId === previousFeedback.id && item.active) : undefined;
  const { dialog, content, actions, titlebar } = dialogShell(quest.status === 'pending' ? '记录任务结果' : '修改任务结果', { className: 'task-feedback-dialog', fullScreen: true });
  const closeDialog = titlebarAction('关闭任务结果', '×', () => dialog.close());
  const taskContext = node('div', 'feedback-task-context');
  const taskContextCopy = node('div', 'feedback-task-copy');
  const taskContextHeading = node('div', 'feedback-task-heading');
  taskContextHeading.append(node('strong', '', quest.title));
  if (quest.estimatedMinutes) taskContextHeading.append(node('span', 'caption', `· ${quest.estimatedMinutes} 分钟`));
  taskContextCopy.append(taskContextHeading);
  if (quest.minimumAction && quest.minimumAction !== quest.title) taskContextCopy.append(node('span', 'caption', `完成标准：${quest.minimumAction}`));
  taskContext.append(semanticIcon('task-focus', 'feedback-task-icon'), taskContextCopy);
  titlebar.append(closeDialog);
  content.append(taskContext);

  const result = node('select', 'input');
  const selectedResult = draft?.result ?? previousFeedback?.result ?? initialResult ?? (quest.status === 'pending' ? 'completed' : quest.status);
  const resultOptions: Array<[FeedbackResult, string]> = [
    ['completed', '已完成'], ['partial', '有进展'], ['skipped', '今天跳过'], ['exempt', '不再需要'],
  ];
  for (const [value, label] of resultOptions) {
    result.append(selectOption(value, label, selectedResult === value));
  }
  const resultLabel = labelledControl('结果', result);
  resultLabel.classList.add('feedback-result-select');
  const resultChoices = choiceGroup('feedback-result-choices');
  const resultChoiceButtons = resultOptions.slice(0, 3).map(([value]) => {
    const button = choiceRow(({ completed: '完成', partial: '进展', skipped: '跳过' } as const)[value as 'completed' | 'partial' | 'skipped'], {
      className: 'feedback-result-choice',
      selected: result.value === value,
      value,
      onSelect: () => {
        result.value = value;
        result.dispatchEvent(new Event('change'));
      },
    });
    resultChoices.append(button);
    return button;
  });

  const completedDate = node('input', 'input');
  completedDate.type = 'date';
  completedDate.max = localDate();
  completedDate.value = draft?.completedDate ?? previousFeedback?.completedDate ?? localDate();
  const completedDateControl = node('label', 'field-label feedback-date-control');
  const completedDateValue = node('span', 'feedback-date-value');
  const updateCompletedDateValue = () => { completedDateValue.textContent = formatDate(completedDate.value, { year: 'numeric', weekday: undefined }); };
  completedDate.addEventListener('change', updateCompletedDateValue);
  updateCompletedDateValue();
  const completedDatePicker = node('span', 'feedback-date-picker');
  completedDatePicker.append(completedDateValue, node('span', 'settings-overview-chevron', '›'), completedDate);
  completedDateControl.append(semanticIcon('calendar'), node('span', '', '完成日期'), completedDatePicker);
  const updateCompletedDateVisibility = () => {
    completedDateControl.hidden = result.value !== 'completed' && result.value !== 'partial';
    completedDate.required = !completedDateControl.hidden;
  };

  const difficulty = node('select', 'input');
  for (const value of Object.keys(DIFFICULTY_XP) as Difficulty[]) {
    difficulty.append(selectOption(value, questDifficultyLabel(quest, value), (draft?.difficulty ?? quest.difficulty) === value));
  }
  const difficultyLabel = labelledControl('实际难度', difficulty);

  const actual = node('textarea', 'input compact-textarea');
  actual.maxLength = 150;
  actual.placeholder = '简单写下这次做到哪里';
  actual.value = draft?.actual ?? previousFeedback?.actual ?? '';
  const actualLabel = labelledControl('备注（可选）', actual, 150);
  actualLabel.classList.add('feedback-note-label');
  const note = node('textarea', 'input compact-textarea');
  note.maxLength = 2_000;
  note.placeholder = '例如：十分钟版本更容易开始。';
  note.value = draft?.note ?? previousFeedback?.note ?? '';
  const noteLabel = labelledControl('下次怎么调整（可选）', note);
  const skipReason = node('select', 'input');
  skipReason.append(
    selectOption('', skippedAttempts ? '请选择最主要的阻力' : '不填写原因'),
    selectOption('状态不合适', '状态不合适'),
    selectOption('难度太高', '难度太高'),
    selectOption('建议不适合我', '建议不适合我'),
    selectOption('任务不重要', '任务不重要'),
    selectOption('时间不足', '时间不足'),
    selectOption('其他原因', '其他原因'),
  );
  skipReason.value = draft?.skipReason ?? '';
  const skipReasonControl = labelledControl(skippedAttempts ? '主要阻力' : '为什么跳过（可选）', skipReason);
  const updateSkipReasonVisibility = () => { skipReasonControl.hidden = result.value !== 'skipped'; };
  result.addEventListener('change', () => {
    updateSkipReasonVisibility();
    updateCompletedDateVisibility();
    resultChoiceButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.value === result.value)));
  });
  updateSkipReasonVisibility();
  updateCompletedDateVisibility();
  let stateDelta: HTMLSelectElement | undefined;
  let stateControl: HTMLLabelElement | undefined;
  let applyHabitDifficulty: HTMLInputElement | undefined;
  let applyHabitDifficultyControl: HTMLLabelElement | undefined;
  if (quest.dimension) {
    const dimension = DIMENSIONS.find((item) => item.key === quest.dimension);
    stateDelta = node('select', 'input');
    for (const value of [-5, -3, 0, 3, 5]) {
      const label = value === 0 ? '没有明确变化' : `${value > 0 ? '+' : ''}${value} · ${value > 0 ? '有所补足' : '有所消耗'}`;
      stateDelta.append(selectOption(String(value), label, value === (draft?.stateDelta ?? previousEffect?.delta ?? 0)));
    }
    stateControl = labelledControl(`对${dimension?.label ?? '状态'}的实际影响`, stateDelta);
  }
  if (quest.sourceType === 'habit' && quest.sourceId) {
    applyHabitDifficulty = node('input');
    applyHabitDifficulty.type = 'checkbox';
applyHabitDifficultyControl = listRow('label', 'ui-control-row');
    applyHabitDifficultyControl.append(node('span', '', '以后这个习惯也使用本次实际难度'), applyHabitDifficulty);
  }
  const status = statusMessage();
  const partialPreview = node('p', 'privacy-boundary');
  const updatePartialPreview = () => {
    partialPreview.hidden = result.value !== 'partial';
    partialPreview.textContent = quest.sourceType === 'goal'
      ? '保存后会保留这次进展，并为目标建立一个更小的下一步；确认保存前不会修改任务或增加成长值。'
      : '保存后会记录这次进展并结算对应成长值；确认保存前不会修改任务。';
  };
  const aiPanel = node('div', 'feedback-ai-panel');
  const understand = actionButton(NATIVE_AI_READY ? 'AI 帮我判断结果' : 'AI 未配置', undefined, { variant: 'quiet' });
  const updateUnderstandState = () => { understand.disabled = !NATIVE_AI_READY || !actual.value.trim(); };
  updateUnderstandState();
  actual.addEventListener('input', updateUnderstandState);
  understand.addEventListener('click', async () => {
    if (!navigator.onLine) {
      status.textContent = '当前离线；仍可直接选择结果并保存，不会上传。';
      status.classList.add('is-error');
      return;
    }
    if (!settings.aiAllowed) {
      const allowed = await confirmAction(
        '允许这一次 AI 理解？',
        '将通过同源中转发送本页明确列出的任务信息和反馈文字。API 密钥不在设备中；发送前仍由你主动点击。',
        '允许并继续',
      );
      if (!allowed) return;
      settings = await db.saveSettings({ aiAllowed: true, previewBeforeSend: true });
    }
    understand.disabled = true;
    status.classList.remove('is-error');
    status.textContent = '正在理解；结果只会作为建议。';
    const request: TaskFeedbackRequest = {
      contractVersion: ANALYSIS_CONTRACT_VERSION,
      operation: 'task_feedback',
      requestId: crypto.randomUUID(),
      locale: 'zh-CN',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      localDate: quest.localDate,
      userInput: {
        questId: quest.id,
        questTitle: quest.title,
        minimumAction: questMinimumAction(quest),
        currentDifficulty: difficulty.value as Difficulty,
        feedbackText: actual.value,
      },
      permissions: { questId: quest.id },
    };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 50_000);
    try {
      const response = await requestAnalysis(request, controller.signal);
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const errorBody = body as { error?: { message?: string } } | null;
        throw new Error(errorBody?.error?.message || '反馈理解服务暂时不可用。');
      }
      const parsed = parseTaskFeedbackResponse(body, request).result;
      const mapped = ({ complete: 'completed', partial: 'partial', skipped: 'skipped' } as const)[parsed.completionCandidate as 'complete' | 'partial' | 'skipped'];
      if (mapped) result.value = mapped;
      actual.value = parsed.actualResult;
      actual.dispatchEvent(new Event('input'));
      if (parsed.suggestedDifficultyCorrection) difficulty.value = parsed.suggestedDifficultyCorrection;
      status.textContent = parsed.completionCandidate === 'unclear'
        ? `AI 仍不确定：${parsed.followUpQuestion}`
        : `AI 建议“${mapped ? FEEDBACK_LABELS[mapped] : '不明确'}”；依据：“${parsed.evidenceQuote}”。请核对后再确认。`;
    } catch (error) {
      status.textContent = error instanceof DOMException && error.name === 'AbortError' ? '反馈理解超时；原文字仍在，可以直接手动选择。' : errorMessage(error);
      status.classList.add('is-error');
    } finally {
      window.clearTimeout(timeout);
      understand.disabled = false;
    }
  });
  aiPanel.append(understand);
  const coreFields = node('div', 'feedback-core-fields');
  coreFields.append(completedDateControl);
  const experience = node('div', 'feedback-experience');
  experience.append(semanticIcon('experience', 'feedback-experience-icon'), node('div', '', `成长值\n完成后增加 ${quest.dimension ? DIFFICULTY_XP[quest.difficulty] : 0}，可撤销。`));
  const extra = disclosure('更多记录', 'feedback-extra');
  const extraFields = node('div', 'feedback-extra-fields');
  extraFields.append(resultLabel, difficultyLabel, noteLabel, aiPanel, ...(stateControl ? [stateControl] : []), ...(applyHabitDifficultyControl ? [applyHabitDifficultyControl] : []));
  extra.append(extraFields);
  content.append(resultChoices, partialPreview, actualLabel, coreFields, experience, skipReasonControl, extra, status);
  const saveDraft = () => {
    try {
      localStorage.setItem(`${TASK_FEEDBACK_DRAFT_PREFIX}${quest.id}`, JSON.stringify({
        result: result.value as FeedbackResult,
        completedDate: completedDate.value,
        difficulty: difficulty.value as Difficulty,
        actual: actual.value,
        note: note.value,
        skipReason: skipReason.value,
        stateDelta: stateDelta ? Number(stateDelta.value) : undefined,
      } satisfies TaskFeedbackDraft));
    } catch { /* The form remains usable if local storage is unavailable. */ }
  };
  [result, completedDate, difficulty, actual, note, skipReason, ...(stateDelta ? [stateDelta] : [])]
    .forEach((control) => control.addEventListener('input', saveDraft));
  result.addEventListener('change', () => { updatePartialPreview(); saveDraft(); });
  updatePartialPreview();

  const cancel = actionButton('取消', () => dialog.close(), { variant: 'quiet' });
  const secondaryAction = actionButton('撤销结果', undefined, { variant: 'quiet', className: 'feedback-undo-action' });
  if (quest.status === 'pending') {
    const taskSettings = disclosure('编辑或删除任务', 'feedback-extra task-item-management');
    const taskSettingsActions = actionGroup('quest-adjust-shortcuts');
    const edit = actionButton('编辑任务', () => {
      dialog.close();
      void openQuestAdjustmentDialog(quest);
    });
    edit.setAttribute('aria-label', `编辑任务：${quest.title}`);
    const remove = actionButton('删除任务', () => {
      void confirmRemoveTaskItem(quest.title, () => db.removePendingQuest(quest.id), remove, dialog);
    }, { variant: 'quiet', className: 'danger-button' });
    remove.setAttribute('aria-label', `删除任务：${quest.title}`);
    taskSettingsActions.append(edit, remove);
    taskSettings.append(taskSettingsActions);
    content.append(taskSettings);
  } else {
    secondaryAction.setAttribute('aria-label', `撤销任务“${quest.title}”的反馈`);
    secondaryAction.addEventListener('click', async () => {
      secondaryAction.disabled = true;
      try {
        await db.undoQuestFeedback(quest.id);
        dialog.close();
        focusAfterRenderSelector = `[data-quest-id="${CSS.escape(quest.id)}"]`;
        showToast('反馈与对应成长值已撤销。');
        await render();
      } catch (error) {
        secondaryAction.disabled = false;
        status.textContent = errorMessage(error);
        status.classList.add('is-error');
      }
    });
  }
  const save = actionButton('保存结果', undefined, { variant: 'primary' });
  save.addEventListener('click', async () => {
    let committed = false;
    save.disabled = true;
    status.textContent = '正在保存反馈和成长账本…';
    try {
      if (result.value === 'skipped' && skippedAttempts > 0 && !skipReason.value) {
        save.disabled = false;
        status.textContent = '请先选一个最主要的阻力；系统不会再次机械安排同一行动。';
        status.classList.add('is-error');
        return;
      }
      if ((result.value === 'completed' || result.value === 'partial') && !isLocalDate(completedDate.value)) {
        save.disabled = false;
        status.textContent = '请选择真实发生日期。';
        status.classList.add('is-error');
        completedDate.focus();
        return;
      }
      const savedNote = result.value === 'skipped' && skipReason.value
        ? `${skipReason.value}${note.value.trim() ? `：${note.value.trim()}` : ''}` : note.value;
      const pathDecisionReason = result.value === 'skipped' && quest.sourceType === 'goal' && quest.sourceId
        && (skipReason.value === '建议不适合我' || skipReason.value === '任务不重要') ? skipReason.value : '';
      const achievementsBefore = await growthBadgeIds();
      const before = await questProgress(quest);
      const progression = await db.feedbackAndProgressQuest(quest.id, result.value as FeedbackResult, savedNote, actual.value, difficulty.value as Difficulty, Number(stateDelta?.value ?? 0),
        result.value === 'completed' || result.value === 'partial' ? completedDate.value : undefined);
      committed = true;
      if (applyHabitDifficulty?.checked && quest.sourceId) await db.saveHabit(quest.sourceId, { difficulty: difficulty.value as Difficulty });
      if (result.value === 'completed') sessionStorage.setItem('qiguang.character-celebration', quest.id);
      localStorage.removeItem(`${TASK_FEEDBACK_DRAFT_PREFIX}${quest.id}`);
      dialog.close();
      focusAfterRenderSelector = questFeedbackFocusSelector(quest);
      const message = await feedbackSettlementMessage(quest, result.value as FeedbackResult, actual.value, progression, '反馈已保存；可以在任务卡上撤销。', before);
      await render();
      await announceNewGrowthBadge(achievementsBefore, message, result.value === 'completed');
      if (pathDecisionReason) void openGoalPathDecision(quest.sourceId!, pathDecisionReason);
    } catch (error) {
      if (committed) {
        if (dialog.open) dialog.close();
        showToast(`反馈已保存；附加更新未完成：${errorMessage(error)}`, 'error');
        await render();
        return;
      }
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(...(quest.status === 'pending' ? [] : [secondaryAction]), cancel, save);
  dialog.showModal();
  result.focus();
}

async function openGoalPathDecision(goalId: string, reason: string): Promise<void> {
  const goal = (await db.listGoals()).find((item) => item.id === goalId);
  if (!goal || goal.status !== 'active') return;
  const { dialog, content, actions } = dialogShell('这条目标路径还值得继续吗？');
  content.append(
    node('p', 'privacy-boundary', `已记录：${reason}`),
    node('p', '', `关联目标：${goal.result}`),
  );
  const choices = actionGroup('quest-adjust-shortcuts');
  const edit = actionButton('修改目标或下一步', () => { dialog.close(); void openGoalSettingsDialog(goal); });
  choices.append(edit);
  if (NATIVE_AI_READY) {
    const replan = actionButton('根据进展重新规划', () => { dialog.close(); void openGoalReplanDialog(goal); });
    choices.append(replan);
  }
  const pause = actionButton('先暂停目标', async () => {
    pause.disabled = true;
    try { await db.saveGoal(goal.id, { status: 'paused' }); dialog.close(); showToast('目标已暂停；历史和成长值保留。'); await render(); }
    catch (error) { pause.disabled = false; showToast(errorMessage(error), 'error'); }
  }, { variant: 'quiet' });
  const end = actionButton('结束这个目标', async () => {
    dialog.close();
    if (!await confirmAction('结束这个目标？', '待完成任务会退出行动面；历史、反馈和成长值仍会保留，也可以以后重新编辑状态。', '确认结束', true)) return;
    try { await db.saveGoal(goal.id, { status: 'abandoned' }); showToast('目标已结束；没有扣分，历史仍可回看。'); await render(); }
    catch (error) { showToast(errorMessage(error), 'error'); }
  }, { variant: 'quiet', className: 'danger-button' });
  choices.append(pause, end); content.append(choices);
  const later = primaryButton('暂不改变目标', () => dialog.close());
  actions.append(later); dialog.showModal(); later.focus();
}

async function openQuestAdjustmentDialog(quest: Quest): Promise<void> {
  const { dialog, content, actions } = dialogShell('修改任务', { back: true, className: 'ui-rebuilt-page ui-form-page', fullScreen: true });
  const title = node('input', 'input'); title.maxLength = 160; title.value = quest.title;
  const date = node('input', 'input'); date.type = 'date'; date.min = localDate(); date.value = quest.localDate;
  if (quest.sourceType === 'habit') date.disabled = true;
  const reminder = node('input', 'input'); reminder.type = 'time'; reminder.value = localDateTimeInput(quest.deadlineAt).slice(11, 16);
  const dimension = taskDimensionSelect(quest.dimension ?? 'progress');
  const difficulty = taskDifficultySelect(quest.difficulty);
  const status = statusMessage();
  const fields = formStack();
  fields.append(
    labelledControl('任务名称', title),
    labelledControl(quest.sourceType === 'habit' ? '日期由习惯计划决定' : '安排日期', date),
    labelledControl('提醒时间（应用内，可选）', reminder),
    labelledControl('五维状态', dimension),
    labelledControl('难度', difficulty),
    status,
  );
  content.append(fields);
  actions.classList.add('ui-actions-pair');
  const remove = actionButton('删除任务', () => {
    void confirmRemoveTaskItem(quest.title, () => db.removePendingQuest(quest.id), remove, dialog);
  }, { variant: 'quiet', className: 'danger-button' });
  const save = actionButton('保存修改', async () => {
    save.disabled = true;
    try {
      const updated = await db.savePendingQuest(quest.id, {
        localDate: date.value,
        title: title.value,
        difficulty: difficulty.value as Difficulty,
        dimension: dimension.value as Dimension,
        deadlineAt: taskReminderAt(date.value, reminder.value),
      });
      dialog.close();
      showToast(updated.localDate === quest.localDate ? '行动已调整。' : `已顺延到${formatDate(updated.localDate)}；没有扣分。`);
      await render();
    } catch (error) { save.disabled = false; status.textContent = errorMessage(error); status.classList.add('is-error'); }
  }, { variant: 'primary' });
  actions.append(remove, save); dialog.showModal(); title.focus();
}

interface TaskRowPresentation {
  title?: string;
  detailsLabel?: string;
  onDetails?: () => void;
  actionLabel?: string;
}

function taskListQuest(quest: Quest, overdue = false, directComplete = false, reorderable = false, presentation: TaskRowPresentation = {}): HTMLElement {
  const deadlinePassed = Boolean(quest.deadlineAt && Date.parse(quest.deadlineAt) < Date.now() && quest.status === 'pending');
  const progress = quest.progressCount ?? 0;
  const target = quest.targetCount ?? 1;
  const primaryActionLabel = quest.status !== 'pending' ? `修改任务“${quest.title}”的反馈` : overdue
    ? `记录“${quest.title}”的实际结果` : quest.targetCount ? `记录一次：${quest.title}，当前 ${progress}/${target}${quest.countUnit || '次'}` : `完成：${quest.title}`;
  const runPrimaryAction = () => {
    if (quest.status !== 'pending' || overdue) { void openQuestFeedbackDialog(quest, overdue ? 'completed' : undefined); return; }
    if (quest.targetCount && directComplete) recordQuestCheckIn(quest, item);
    else if (quest.targetCount) void changeCountQuestProgress(quest, 1, item);
    else if (directComplete) void completeQuestFromRow(quest, item);
    else void openQuestFeedbackDialog(quest, 'completed');
  };
  const item = taskRow({
    title: presentation.title ?? quest.title, status: quest.status,
    className: `is-source-${quest.sourceType} is-dimension-${quest.dimension ?? 'progress'}${overdue ? ' is-overdue' : ''}${deadlinePassed ? ' is-deadline-passed' : ''}`,
    targetCount: quest.targetCount, progressCount: progress, countUnit: quest.countUnit,
    actionLabel: presentation.actionLabel, reorderable,
    primaryLabel: primaryActionLabel,
    detailsLabel: presentation.detailsLabel ?? `${directComplete && !reorderable ? '编辑' : '查看'}任务：${quest.title}`,
    onPrimary: runPrimaryAction,
    onDetails: () => {
      if (presentation.onDetails) { presentation.onDetails(); return; }
      if (directComplete && !reorderable && quest.status === 'pending' && !overdue) void openQuestAdjustmentDialog(quest);
      else void openQuestFeedbackDialog(quest);
    },
  });
  item.dataset.questId = quest.id;
  const details = item.querySelector<HTMLElement>('.task-item-details');
  if (details) details.dataset.questFeedbackFor = quest.id;
  return item;
}

function enableTaskReordering(list: HTMLElement, date: string): void {
  const rows = () => [...list.querySelectorAll<HTMLElement>('.task-list-item[data-reorderable="true"]')];
  const persist = async (): Promise<void> => {
    try {
      await db.reorderPendingQuests(date, rows().map((item) => item.dataset.questId!));
      showToast('任务顺序已保存。');
    } catch (error) {
      showToast(errorMessage(error), 'error');
      await render();
    }
  };
  rows().forEach((item) => {
    const handle = item.querySelector<HTMLButtonElement>('.task-drag-handle')!;
    let dragging = false;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      handle.setPointerCapture(event.pointerId);
      item.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      event.preventDefault();
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.task-list-item[data-reorderable="true"]');
      if (!target || target === item || target.parentElement !== list) return;
      const after = event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
      list.insertBefore(item, after ? target.nextSibling : target);
    });
    handle.addEventListener('pointerup', (event) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture(event.pointerId);
      item.classList.remove('is-dragging');
      void persist();
    });
    handle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const sibling = event.key === 'ArrowUp' ? item.previousElementSibling : item.nextElementSibling;
      if (!(sibling instanceof HTMLElement) || sibling.dataset.reorderable !== 'true') return;
      if (event.key === 'ArrowUp') list.insertBefore(item, sibling);
      else list.insertBefore(sibling, item);
      void persist();
      handle.focus();
    });
  });
}

function todayHabitQuests(quests: Quest[]): Quest[] {
  const rows = new Map<string, Quest>();
  for (const quest of quests.filter(item => item.sourceType === 'habit' && !item.systemRetiredAt && !item.userRemovedAt)) {
    const previous = rows.get(quest.sourceId!);
    if (!previous || quest.status === 'pending' || previous.status !== 'pending') rows.set(quest.sourceId!, quest);
  }
  return [...rows.values()];
}

function habitTodayRow(habit: Habit, quest: Quest): HTMLElement {
  const row = taskListQuest(quest, false, true, false, {
    title: habit.name,
    actionLabel: quest.targetCount ? '+1' : '打卡',
    detailsLabel: `查看习惯：${habit.name}`,
    onDetails: () => { void openHabitDetailDialog(habit); },
  });
  row.classList.add('is-habit-checkin');
  row.dataset.habitId = habit.id;
  return row;
}

function questCard(quest: Quest, milestone?: { description: string }, managementOnly = false): HTMLElement {
  const deadlinePassed = Boolean(quest.deadlineAt && Date.parse(quest.deadlineAt) < Date.now() && quest.status === 'pending');
  const card = node('article', `surface quest-card is-${quest.status} is-source-${quest.sourceType} is-dimension-${quest.dimension ?? 'progress'}${deadlinePassed ? ' is-deadline-passed' : ''}`);
  card.dataset.questId = quest.id;
  card.tabIndex = -1;
  const heading = node('div', 'quest-heading');
  if (quest.sourceType !== 'manual') {
    const sourceLabel = ({ goal: '目标', habit: '习惯', recovery: '恢复' } as const)[quest.sourceType];
    heading.append(node('span', `quest-source-label is-${quest.sourceType}`, sourceLabel));
  } else heading.classList.add('is-manual');
  heading.append(node('span', 'caption', questDifficultyLabel(quest)));
  card.append(heading, node('h3', '', quest.title));
  if (quest.localDate !== localDate()) card.append(node('p', 'caption', `计划日期：${formatDate(quest.localDate)}`));
  const planning = [quest.minimumAction && quest.minimumAction !== quest.title ? `先做这一步：${quest.minimumAction}` : '', quest.estimatedMinutes ? `约 ${quest.estimatedMinutes} 分钟` : ''].filter(Boolean);
  if (planning.length) card.append(node('p', 'quest-minimum', planning.join(' · ')));
  const completionCriteria = quest.completionCriteria?.trim();
  if (completionCriteria && completionCriteria !== questMinimumAction(quest)) card.append(node('p', 'caption', `完成标准：${completionCriteria}`));
  if (milestone) card.append(node('p', 'caption', `关联子任务：${milestone.description}`));
  if (quest.deadlineAt) card.append(node('p', deadlinePassed ? 'caption danger-copy' : 'caption', `${deadlinePassed ? '截止已过，仍由你决定' : '可选截止'}：${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(quest.deadlineAt))}`));
  if (quest.status === 'pending' && managementOnly) {
    const actions = actionGroup('quest-actions');
    const edit = actionButton('编辑计划', () => { void openQuestAdjustmentDialog(quest); }, { className: 'button-compact' });
    edit.setAttribute('aria-label', `编辑计划：${quest.title}`);
    const remove = actionButton('删除', () => {
      void confirmRemoveTaskItem(quest.title, () => db.removePendingQuest(quest.id), remove);
    }, { variant: 'quiet', className: 'danger-button button-compact' });
    remove.setAttribute('aria-label', `删除任务：${quest.title}`);
    actions.append(edit, remove);
    card.append(actions);
  }
  else if (quest.status === 'pending') card.append(quest.targetCount ? countQuestActions(quest) : quickQuestActions(quest));
  else if (quest.systemRetiredAt) {
    const retiredLabels: Record<NonNullable<Quest['systemRetiredReason']>, string> = {
      elapsed: '已过期',
      'schedule-changed': '安排已改',
      'tracking-disabled': '已暂停',
      capacity: '已停用',
      'source-invalidated': '来源失效',
      'goal-inactive': '目标已暂停',
    };
    const retired = actionGroup('quest-actions quest-system-retired');
    retired.append(node('span', 'caption', retiredLabels[quest.systemRetiredReason!]));
    card.append(retired);
  }
  else {
    const actions = actionGroup('quest-actions');
    const feedback = actionButton(`结果：${FEEDBACK_LABELS[quest.status]}`, () => { void openQuestFeedbackDialog(quest); });
    feedback.dataset.questFeedbackFor = quest.id;
    feedback.setAttribute('aria-label', `修改任务“${quest.title}”的反馈`);
    actions.append(feedback);
    const undo = actionButton('撤销反馈', async () => {
      undo.disabled = true;
      try {
        await db.undoQuestFeedback(quest.id);
        focusAfterRenderSelector = `[data-quest-id="${CSS.escape(quest.id)}"]`;
        showToast('反馈与对应成长值已撤销。');
        await render();
      } catch (error) {
        undo.disabled = false;
        showToast(errorMessage(error), 'error');
      }
    }, { variant: 'quiet' });
    undo.setAttribute('aria-label', `撤销任务“${quest.title}”的反馈`);
    actions.append(undo);
    if (quest.sourceType === 'goal' && quest.sourceId) {
      const next = actionButton('更新目标下一步', async () => {
        const goal = (await db.listGoals()).find((item) => item.id === quest.sourceId);
        if (goal) void openGoalSettingsDialog(goal); else showToast('关联目标已经不存在。', 'error');
      }, { variant: 'quiet' });
      actions.append(next);
    }
    card.append(actions);
  }
  return card;
}

function recoveryPanel(state: ResolvedDimensionState, date: string): HTMLElement {
  const suggestions = RECOVERY_SUGGESTIONS[state.dimension];
  let suggestionIndex = 0;
  const panel = node('section', 'surface recovery-action');
  panel.append(node('span', 'tag tag-warn', '状态照顾'), sectionHeading(`先补足${dimensionLabel(state.dimension)}`));
  panel.append(node('p', '', `${dimensionLabel(state.dimension)} ${state.value}/100`));
  const title = node('strong', 'recovery-title');
  const detail = node('p', 'quest-minimum');
  const renderSuggestion = () => {
    const suggestion = suggestions[suggestionIndex] ?? suggestions[0];
    if (!suggestion) return;
    title.textContent = suggestion.title;
    detail.textContent = `先做：${suggestion.minimumAction} · 约 ${suggestion.estimatedMinutes} 分钟 · 轻量`;
  };
  renderSuggestion();
  panel.append(title, detail);
  const actions = actionGroup('quest-actions');
  const accept = actionButton('加入今天', async () => {
    const suggestion = suggestions[suggestionIndex] ?? suggestions[0];
    if (!suggestion) return;
    [...actions.querySelectorAll<HTMLButtonElement>('button')].forEach((button) => { button.disabled = true; });
    try {
      const quest = await db.addQuest({
        localDate: date,
        sourceType: 'recovery',
        actionId: `recovery:${date}:${state.dimension}:${suggestionIndex}`,
        title: suggestion.title,
        reason: `${dimensionLabel(state.dimension)}近期状态较低，先恢复再决定是否推进。`,
        minimumAction: suggestion.minimumAction,
        estimatedMinutes: suggestion.estimatedMinutes,
        difficulty: 'light',
        dimension: state.dimension,
        aiSuggested: false,
        userModified: false,
      });
      focusAfterRenderSelector = `[data-quest-id="${CSS.escape(quest.id)}"]`;
      showToast('恢复行动已加入今天；不完成也不会扣分。');
      await render();
    } catch (error) {
      [...actions.querySelectorAll<HTMLButtonElement>('button')].forEach((button) => { button.disabled = false; });
      showToast(errorMessage(error), 'error');
    }
  }, { variant: 'primary' });
  const another = actionButton('换一个', () => {
    suggestionIndex = (suggestionIndex + 1) % suggestions.length;
    renderSuggestion();
    title.focus({ preventScroll: true });
  });
  title.tabIndex = -1;
  const dismiss = actionButton('暂时不用', () => {
    sessionStorage.setItem(`qiguang.recovery-dismissed.${date}.${state.dimension}`, '1');
    const next = panel.nextElementSibling as HTMLElement | null;
    panel.remove();
    if (next) {
      next.tabIndex = -1;
      next.focus({ preventScroll: true });
    }
    showToast('已收起；没有扣分，也不会改变状态。');
  }, { variant: 'quiet' });
  actions.append(accept, another, dismiss);
  panel.append(actions);
  return panel;
}

function overdueQuestPanel(quests: Quest[], limit = 3): HTMLElement {
  const visible = quests.slice(0, limit);
  const panel = listSection(`待决定 · ${quests.length}`, { className: 'surface overdue-quests' });
  const list = node('div', 'overdue-quest-list');
  for (const quest of visible) {
    list.append(taskListQuest(quest, true));
  }
  if (quests.length > visible.length) {
    const more = actionButton(`打开任务板继续处理另外 ${quests.length - visible.length} 项`, () => go({ name: 'tasks' }));
    list.append(more);
  }
  panel.append(list);
  return panel;
}

async function todayPage(): Promise<HTMLElement> {
  const today = localDate();
  await db.ensureTodayBonusQuests(today);
  const [entries, observations, quests, profile, entryHistory, overdueQuests, allQuests, allFeedback, previousAnalyses, goals, milestones, habits] = await Promise.all([
    db.listEntries(today), db.resolvedStateAtOrBefore(today), db.listQuests(today), db.getProfile(), db.listEntries(),
    db.listPendingBefore(today), db.listQuests(), db.listQuestFeedback(), db.listDailyAnalyses(shiftDate(today, -1)), db.listGoals(), db.listMilestones(), db.listHabits(),
  ]);
  const main = node('main', 'page page-today');
  main.append(pageHeader('今日', { meta: formatDate(today) }));

  const latestEntry = entryHistory.at(-1);
  const isReturning = Boolean(latestEntry
    && (Date.now() - Date.parse(latestEntry.createdAt)) / 86_400_000 >= 14
    && sessionStorage.getItem(`qiguang.return-dismissed.${today}`) !== '1');
  const lowest = Object.values(observations)
    .filter((item) => !observationIsStale(item, today))
    .sort((left, right) => left.value - right.value)[0];
  const nextQuest = (values: Quest[]): Quest | undefined => [...values]
    .filter((quest) => quest.status === 'pending' && quest.sourceType !== 'habit' && !quest.systemRetiredAt)
    .sort((left, right) => {
      const leftDeadline = left.deadlineAt ? Date.parse(left.deadlineAt) : Number.POSITIVE_INFINITY;
      const rightDeadline = right.deadlineAt ? Date.parse(right.deadlineAt) : Number.POSITIVE_INFINITY;
      return leftDeadline - rightDeadline || left.localDate.localeCompare(right.localDate) || left.createdAt.localeCompare(right.createdAt);
    })[0];
  const pendingToday = nextQuest(quests);
  const showRecovery = Boolean(lowest && lowest.value < 45
    && sessionStorage.getItem(`qiguang.recovery-dismissed.${today}.${lowest.dimension}`) !== '1'
    && !quests.some((quest) => quest.sourceType === 'recovery'));

  const hero = node('section', 'home-hero');
  hero.append(roomStage(false, profile?.avatar ?? null, resolvedCompanionName(profile)));
  main.append(hero, statusSummary(observations));

  if (isReturning) {
    const returning = node('section', 'home-return');
    const actions = actionGroup('home-return-actions');
    const record = actionButton('记录近况', () => go({ name: 'record' }));
    const history = actionButton('先看看以前', () => go({ name: 'calendar' }), { variant: 'quiet' });
    const dismiss = actionButton('暂时不用', () => {
      sessionStorage.setItem(`qiguang.return-dismissed.${today}`, '1');
      returning.remove();
      main.querySelector<HTMLElement>('.today-focus-list h2, .today-focus-list button')?.focus({ preventScroll: true });
    }, { variant: 'quiet' });
    actions.append(record, history, dismiss);
    returning.append(node('strong', '', '欢迎回来'), actions);
    main.append(returning);
  }

  if (showRecovery && lowest) main.append(recoveryPanel(lowest, today));

  const directionQuest = pendingToday ?? nextQuest(overdueQuests);
  const feedbackByQuest = activeFeedbackByQuest(allFeedback);
  const questById = new Map(allQuests.map((item) => [item.id, item]));
  const blockedGoalIds = new Set(allFeedback.flatMap((item) => {
    const quest = questById.get(item.questId);
    return !item.undoneAt && item.result === 'skipped' && (item.completedDate ?? quest?.localDate) === today && quest?.sourceType === 'goal' && quest.sourceId ? [quest.sourceId] : [];
  }));
  const goalProgressSince = shiftDate(today, -7);
  const activeGoal = goals
    .filter((item) => item.status === 'active' && !blockedGoalIds.has(item.id))
    .sort((left, right) => (left.targetDate ?? '9999-12-31').localeCompare(right.targetDate ?? '9999-12-31') || left.createdAt.localeCompare(right.createdAt))[0];
  const latestGoalQuest = activeGoal ? allQuests
    .filter((item) => item.sourceType === 'goal' && item.sourceId === activeGoal.id)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] : undefined;
  const skippedGoalQuest = latestGoalQuest?.status === 'skipped' ? latestGoalQuest : undefined;
  const previousReflection = previousAnalyses.find((item) => item.status === 'ready')?.result.reflection;
  const direction = chooseDailyDirection({
    mainQuest: directionQuest ? {
      status: directionQuest.status,
      deadlineRisk: Boolean(directionQuest.deadlineAt && Date.parse(directionQuest.deadlineAt) - Date.now() <= 24 * 60 * 60 * 1000),
      carriedFromPreviousDay: directionQuest.localDate < today,
    } : null,
    recoveryAvailable: showRecovery,
    activeGoalAvailable: Boolean(activeGoal),
    previousStepAvailable: Boolean(previousReflection?.nextSmallStep),
    milestoneDue: Boolean(activeGoal && milestones.some((item) => item.goalId === activeGoal.id && item.status === 'pending')),
    stagnantGoal: Boolean(activeGoal && parseLocalDate(today).getTime() - parseLocalDate(activeGoal.startDate ?? today).getTime() >= 7 * 86_400_000
      && !allQuests.some((item) => {
        const feedback = feedbackByQuest.get(item.id);
        return item.sourceType === 'goal' && item.sourceId === activeGoal.id && feedback
          && questResultDate(item, feedbackByQuest) >= goalProgressSince
          && (feedback.result === 'completed' || feedback.result === 'partial');
      })),
  });
  if (!pendingToday && direction.kind !== 'recovery' && direction.kind !== 'explore') {
    const guide = node('article', 'surface daily-guide');
    if (direction.kind === 'main' && directionQuest) {
      guide.append(node('h2', '', directionQuest.title));
      if (directionQuest.minimumAction && directionQuest.minimumAction !== directionQuest.title) guide.append(node('p', 'quest-minimum', `先做：${directionQuest.minimumAction}`));
      guide.append(primaryButton('处理这项后续行动', () => go({ name: 'tasks' })));
    } else if (direction.kind === 'goal' && activeGoal) {
      if (skippedGoalQuest) {
        guide.append(node('h2', '', `重新决定：${skippedGoalQuest.title}`), node('p', 'caption', `目标：${activeGoal.result}`));
        guide.append(primaryButton('确认或调整这一步', () => { void openQuestDialog(activeGoal, skippedGoalQuest.title); }));
      } else {
        guide.append(node('h2', '', activeGoal.nextStep), node('p', '', direction.reason), node('p', '', `来自目标：${activeGoal.result}`));
        guide.append(primaryButton('把这一步安排到今天', () => { void openQuestDialog(activeGoal); }));
      }
    } else if (direction.kind === 'reflection' && previousReflection?.nextSmallStep) {
      guide.append(node('h2', '', previousReflection.nextSmallStep));
      guide.append(primaryButton('确认或调整这一步', () => { void openQuestDialog(undefined, previousReflection.nextSmallStep); }));
    }
    if (guide.childElementCount) main.append(guide);
  }

  const pendingTodayQuests = quests.filter((quest) => quest.status === 'pending' && quest.sourceType !== 'habit' && !quest.systemRetiredAt);
  const todayTasks = listSection('今日任务', {
    className: 'today-focus-list',
    tail: node('span', 'caption', `${pendingTodayQuests.length} 项待完成`),
  });
  if (!pendingTodayQuests.length) todayTasks.append(emptyState('今天已经安排好了'));
  const todayTaskList = listGroup();
  pendingTodayQuests.slice(0, 3).forEach((quest) => todayTaskList.append(taskListQuest(quest, false, true)));
  if (todayTaskList.childElementCount) todayTasks.append(todayTaskList);
  const visibleHabits = todayHabitQuests(quests);
  if (visibleHabits.length) {
    const habitGroup = listSection('习惯打卡', {
      className: 'task-today-habits',
      headingClassName: 'task-subsection-heading',
      tail: node('span', 'caption', `${visibleHabits.filter((quest) => quest.status === 'pending').length} 项待打卡`),
    });
    const habitList = listGroup();
    visibleHabits.forEach((quest) => {
      const habit = habits.find((item) => item.id === quest.sourceId);
      if (habit) habitList.append(habitTodayRow(habit, quest));
    });
    habitGroup.append(habitList);
    todayTasks.append(habitGroup);
  }
  main.append(todayTasks);

  const todayRecord = node('section', 'today-record-preview');
  const openDay = textAction('查看今天 ›', () => go({ name: 'day', date: today }));
  todayRecord.append(sectionHeading('今天留下的', { tail: openDay }));
  const recentTodayEntries = entries.slice(-3).reverse();
  if (recentTodayEntries.length) {
    recentTodayEntries.forEach((entry) => {
    const previewIcon = node('span', `today-record-icon is-${entry.kind}`);
    previewIcon.append(semanticIcon(entry.kind === 'success' ? 'success-record' : 'nav-record'));
    todayRecord.append(recordItem({
      variant: 'preview', body: entry.body, time: entryTime(entry), kind: entry.kind,
      leading: previewIcon, onOpen: () => { void openEntryDetailDialog(entry); },
    }));
    });
  } else todayRecord.append(emptyState('今天还没有记录'));
  main.append(todayRecord);

  return main;

}

async function recordPage(route: Route): Promise<HTMLElement> {
  const today = localDate();
  const targetDate = route.date ?? today;
  const main = node('main', 'page page-record');

  const dateInput = node('input', 'input');
  dateInput.type = 'date';
  dateInput.max = localDate();
  dateInput.value = targetDate;
  const dateControl = node('label', 'record-date-control');
  const dateText = node('span', '', formatDate(targetDate, { weekday: undefined }));
  dateControl.append(semanticIcon('calendar'), dateText, dateInput);

  const tabs = segmentedControl('nav', 'record-subtabs record-mode-tabs');
  tabs.classList.add('ui-segmented-inline');
  tabs.setAttribute('aria-label', '记录方式');
  const quickButton = segmentedItem('button', '随记', { className: 'record-subtab' });
  const fullButton = segmentedItem('button', '整记', { className: 'record-subtab' });
  tabs.append(quickButton, fullButton);
  const header = route.date && route.date !== today
    ? pageHeader('补记', { back: true, action: tabs })
    : pageHeader('记录', { action: tabs });
  main.append(header);

  const initialDraft = readDraft(targetDate);
  const savedEntries = await db.listEntries(targetDate);
  let activeDraftDate = targetDate;
  let selectedKind: NonNullable<JournalEntry['kind']> = initialDraft.kind === 'success' ? 'success' : 'journal';
  let selectedImage = initialDraft.imageDataUrl;

  const lifePanel = node('section', 'record-tab-panel life-diary-panel');
  const lifeHeader = node('div', 'life-diary-header record-toolbar');
  const lifeActions = node('div', 'life-diary-actions');
  const analysableEntries = savedEntries.filter((entry) => entry.body.trim());
  const aiArchive = textAction('AI整理', () => { void openAnalysisPreview(activeDraftDate, analysableEntries); });
  aiArchive.disabled = !NATIVE_AI_READY || !analysableEntries.length;
  const viewToday = textAction('查看今天', () => { sessionStorage.setItem('qiguang.day-view', 'records'); go({ name: 'day', date: activeDraftDate }); });
  lifeActions.append(aiArchive, viewToday);
  lifeHeader.append(dateControl, lifeActions);

  const recordFeed = (className: string): HTMLElement => {
    const feed = node('div', className);
    if (!savedEntries.length) feed.append(emptyState('还没有记录', 'journal-empty'));
    savedEntries.forEach((entry) => {
      feed.append(recordItem({
        variant: 'bubble', body: entry.body, time: entryTime(entry), kind: entry.kind,
        imageSource: entry.imageDataUrl, onOpen: () => { void openEntryDetailDialog(entry); },
      }));
    });
    return feed;
  };
  const feed = recordFeed('life-diary-feed');

  const composer = node('form', 'life-diary-composer');
  const imageInput = node('input', 'life-diary-file') as HTMLInputElement;
  imageInput.type = 'file';
  imageInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
  imageInput.setAttribute('aria-label', '选择图片');
  const imageButton = actionButton('图片', () => imageInput.click(), { variant: 'quiet', className: 'life-diary-image-button' });
  const input = node('textarea', 'life-diary-input');
  input.name = 'body';
  input.rows = 3;
  input.maxLength = 12_000;
  input.placeholder = '现在的想法';
  input.value = initialDraft.body;
  input.setAttribute('aria-label', '现在的想法');
  const send = actionButton('发送', undefined, { variant: 'primary', className: 'life-diary-send', type: 'submit' });
  const imagePreview = node('div', 'life-diary-image-preview');
  const saveState = statusMessage();
  saveState.setAttribute('role', 'status');
  const renderImagePreview = (): void => {
    imagePreview.replaceChildren();
    imagePreview.hidden = !selectedImage;
    if (!selectedImage) return;
    const image = node('img') as HTMLImageElement;
    image.src = selectedImage;
    image.alt = '待保存图片';
    const remove = textAction('移除', () => {
      selectedImage = undefined;
      imageInput.value = '';
      updateDraftState();
      renderImagePreview();
    });
    imagePreview.append(image, remove);
  };
  const composerRow = node('div', 'life-diary-composer-row');
  composerRow.append(imageButton, saveState, send, imageInput);
  composer.append(imagePreview, input, composerRow);
  lifePanel.append(feed, composer);

  const fullPanel = node('section', 'record-tab-panel life-diary-panel full-diary-panel');
  const fullForm = node('form', 'full-diary-form');
  const fullInput = node('textarea', 'input full-diary-input');
  fullInput.name = 'body';
  fullInput.rows = 12;
  fullInput.maxLength = 12_000;
  fullInput.placeholder = '写下完整记录';
  fullInput.value = initialDraft.fullBody;
  fullInput.setAttribute('aria-label', '完整记录');
  const fullStatus = statusMessage();
  fullStatus.setAttribute('role', 'status');
  const fullSubmit = actionButton('保存记录', undefined, { variant: 'primary', className: 'button-wide', type: 'submit' });
  fullForm.append(fullInput, fullStatus, fullSubmit);
  const fullHistory = node('section', 'full-diary-history');
  fullHistory.append(sectionHeading('当日记录'), recordFeed('life-diary-feed full-diary-feed'));
  fullPanel.append(fullForm, fullHistory);
  main.append(lifeHeader, lifePanel, fullPanel);

  const updateDraftState = (): void => {
    saveDraft(activeDraftDate, input.value, selectedKind, '', selectedImage ?? null, fullInput.value);
    send.disabled = !input.value.trim() && !selectedImage;
    saveState.textContent = draftNeedsUnloadWarning ? '应用未能保存草稿，请先不要关闭页面' : input.value || selectedImage ? '草稿已保存' : '';
    saveState.hidden = !saveState.textContent;
    saveState.classList.toggle('is-error', draftNeedsUnloadWarning);
  };
  input.addEventListener('input', updateDraftState);
  const updateFullDraftState = (): void => {
    saveDraft(activeDraftDate, input.value, selectedKind, '', selectedImage ?? null, fullInput.value);
    fullSubmit.disabled = !fullInput.value.trim();
    fullStatus.textContent = draftNeedsUnloadWarning ? '应用未能保存草稿，请先不要关闭页面' : fullInput.value ? '草稿已保存' : '';
    fullStatus.hidden = !fullStatus.textContent;
    fullStatus.classList.toggle('is-error', draftNeedsUnloadWarning);
  };
  fullInput.addEventListener('input', updateFullDraftState);
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    try {
      selectedImage = await readRecordImage(file);
      updateDraftState();
      renderImagePreview();
    } catch (error) {
      imageInput.value = '';
      showToast(errorMessage(error), 'error');
    }
  });
  dateInput.addEventListener('change', async () => {
    if (!isLocalDate(dateInput.value)) {
      saveState.textContent = '请选择有效日期；当前草稿已保留。';
      saveState.hidden = false;
      saveState.classList.add('is-error');
      return;
    }
    updateDraftState();
    go({ name: 'record', date: dateInput.value });
  });
  composer.addEventListener('submit', async (event) => {
    event.preventDefault();
    send.disabled = true;
    send.textContent = '保存中';
    saveState.hidden = true;
    try {
      await db.addEntry(input.value, dateInput.value, 'text', selectedKind, selectedImage);
      input.value = '';
      selectedImage = undefined;
      saveDraft(dateInput.value, '', selectedKind, '', null, fullInput.value);
      showToast('记录已保存。');
      sessionStorage.setItem('qiguang.day-view', 'records');
      go({ name: 'day', date: dateInput.value });
    } catch (error) {
      send.disabled = false;
      send.textContent = '重试';
      saveState.textContent = `尚未保存：${errorMessage(error)}`;
      saveState.hidden = false;
      saveState.classList.add('is-error');
      showToast(errorMessage(error), 'error');
    }
  });
  fullForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    fullSubmit.disabled = true;
    fullStatus.hidden = true;
    try {
      await db.addEntry(fullInput.value, dateInput.value, 'text', 'journal');
      fullInput.value = '';
      saveDraft(dateInput.value, input.value, selectedKind, '', selectedImage ?? null, '');
      showToast('记录已保存。');
      sessionStorage.setItem('qiguang.day-view', 'records');
      go({ name: 'day', date: activeDraftDate });
    } catch (error) {
      fullSubmit.disabled = false;
      fullStatus.textContent = `尚未保存：${errorMessage(error)}`;
      fullStatus.hidden = false;
      fullStatus.classList.add('is-error');
    }
  });
  const selectTab = (tab: 'quick' | 'full'): void => {
    sessionStorage.setItem('qiguang.record-tab', tab);
    lifePanel.hidden = tab !== 'quick';
    fullPanel.hidden = tab !== 'full';
    quickButton.classList.toggle('is-active', tab === 'quick');
    fullButton.classList.toggle('is-active', tab === 'full');
    quickButton.setAttribute('aria-pressed', String(tab === 'quick'));
    fullButton.setAttribute('aria-pressed', String(tab === 'full'));
  };
  quickButton.addEventListener('click', () => selectTab('quick'));
  fullButton.addEventListener('click', () => selectTab('full'));
  selectTab(sessionStorage.getItem('qiguang.record-tab') === 'full' ? 'full' : 'quick');
  renderImagePreview();
  updateDraftState();
  updateFullDraftState();
  return main;
}

function calendarDates(cursor: Date): string[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  return Array.from({ length: Math.ceil((mondayOffset + daysInMonth) / 7) * 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return localDate(date);
  });
}

function trailTabs(active: 'calendar' | 'growth' | 'review'): HTMLElement {
  const nav = segmentedControl('nav', 'trail-tabs');
  nav.setAttribute('aria-label', '轨迹分段');
  const tabs: Array<[string, string]> = [['calendar', '日历'], ['review', '本周'], ['growth', '成长']];
  tabs.forEach(([route, label]) => {
    const link = segmentedItem('a', label, { className: 'trail-tab', active: route === active });
    link.href = route === 'review' ? `#/review/${localDate()}` : `#/${route}`;
    if (route === active) link.setAttribute('aria-current', 'page');
    nav.append(link);
  });
  return nav;
}

async function openDayCaptionDialog(date: string, entries: JournalEntry[], suggestedCaption?: string): Promise<void> {
  const [caption, analyses] = await Promise.all([db.getDayCaption(date), db.listDailyAnalyses(date)]);
  const readyAnalysis = analyses.find((item) => item.status === 'ready');
  const { dialog, content, actions } = dialogShell('编辑当日一句', { className: 'day-caption-dialog' });

  const captionBlock = node('section', 'day-snapshot-block day-caption-block');
  captionBlock.append(node('p', 'caption', formatDate(date, { year: 'numeric' })));
  const captionInput = node('textarea', 'input day-caption-input');
  captionInput.maxLength = 120;
  captionInput.rows = 2;
  captionInput.placeholder = '用一句话记住这一天';
  captionInput.value = suggestedCaption ?? caption?.text ?? '';
  captionInput.setAttribute('aria-label', '当日一句话');
  const captionStatus = node('p', 'caption', suggestedCaption ? '待保存' : caption ? '已保存' : '');
  captionStatus.setAttribute('role', 'status');
  const captionActions = actionGroup('day-caption-actions');
  const useAi = actionButton(readyAnalysis ? '采用 AI 概括' : NATIVE_AI_READY ? '让 AI 概括' : 'AI 未配置', () => {
    if (readyAnalysis) {
      captionInput.value = readyAnalysis.result.summary;
      captionStatus.textContent = '已填入 AI 概括，修改后再保存。';
      captionInput.focus();
      return;
    }
    void openAnalysisPreview(date, entries, undefined, (summary) => {
      if (!dialog.isConnected) {
        void openDayCaptionDialog(date, entries, summary);
        return;
      }
      captionInput.value = summary;
      captionStatus.textContent = '已填入 AI 概括，修改后再保存。';
      captionInput.focus();
    });
  }, { variant: 'quiet' });
  useAi.disabled = !readyAnalysis && (!NATIVE_AI_READY || !entries.length);
  const saveCaption = actionButton('保存一句话', async () => {
    saveCaption.disabled = true;
    try {
      const saved = await db.saveDayCaption(date, captionInput.value);
      captionInput.value = saved?.text ?? '';
      captionStatus.textContent = saved ? '当日一句话已保存。' : '当日一句话已清除。';
    } catch (error) {
      captionStatus.textContent = errorMessage(error);
      captionStatus.classList.add('is-error');
    } finally {
      saveCaption.disabled = false;
    }
  });
  captionActions.append(useAi, saveCaption);
  captionBlock.append(captionInput, captionActions, captionStatus);
  content.append(captionBlock);

  const close = actionButton('关闭', () => dialog.close());
  actions.append(close);
  dialog.showModal();
  captionInput.focus();
}

async function calendarPage(): Promise<HTMLElement> {
  const [entries, allQuests, allFeedback, habits, habitLogs, ledger] = await Promise.all([
    db.listEntries(), db.listQuests(), db.listQuestFeedback(), db.listHabits(), db.listHabitLogs(), db.listXpLedger(),
  ]);
  const entryDates = new Set(entries.map((entry) => entry.localDate));
  const entriesByDate = new Map<string, JournalEntry[]>();
  for (const entry of entries) entriesByDate.set(entry.localDate, [...(entriesByDate.get(entry.localDate) ?? []), entry]);
  const feedbackByQuest = activeFeedbackByQuest(allFeedback);
  const completedTaskDates = new Set(allQuests.filter((quest) => quest.sourceType !== 'habit' && feedbackByQuest.get(quest.id)?.result === 'completed')
    .map((quest) => questResultDate(quest, feedbackByQuest)));
  const completedHabitLogs = habitLogs.filter((item) => item.result === 'completed');
  const habitDates = new Set(completedHabitLogs.map((item) => item.localDate));
  const habitsById = new Map(habits.map((habit) => [habit.id, habit]));
  const main = node('main', 'page page-calendar');
  let searchPanel: HTMLElement;
  const searchAction = titlebarAction('查找记录', semanticIcon('search'), () => {
    searchPanel.hidden = false;
    searchPanel.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    searchPanel.scrollIntoView({ behavior: settings.reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });
  main.append(pageHeader('轨迹', { action: searchAction }));
  main.append(trailTabs('calendar'));

  const panel = node('section', 'surface ui-surface-plain calendar-panel');
  const moveMonth = (offset: number): void => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + offset, 1);
    const today = new Date();
    calendarSelectedDate = today.getFullYear() === calendarCursor.getFullYear() && today.getMonth() === calendarCursor.getMonth()
      ? localDate(today) : localDate(calendarCursor);
    void render();
  };
  const toolbar = periodNavigator(new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(calendarCursor), {
    ariaLabel: '日历月份',
    className: 'calendar-toolbar',
    previousLabel: '上个月',
    nextLabel: '下个月',
    onPrevious: () => moveMonth(-1),
    onNext: () => moveMonth(1),
  });
  panel.append(toolbar);
  const weekdays = node('div', 'weekday-row');
  ['一', '二', '三', '四', '五', '六', '日'].forEach((day) => weekdays.append(node('span', '', day)));
  panel.append(weekdays);
  const grid = node('div', 'calendar-grid');
  for (const dateValue of calendarDates(calendarCursor)) {
    const date = parseLocalDate(dateValue);
    const isOutside = date.getMonth() !== calendarCursor.getMonth();
    const hasEntry = entryDates.has(dateValue);
    const hasTask = completedTaskDates.has(dateValue);
    const hasHabit = habitDates.has(dateValue);
    const button = node('button', `calendar-day${isOutside ? ' is-outside' : ''}${dateValue === localDate() ? ' is-today' : ''}${hasEntry ? ' has-entry' : ''}${hasTask ? ' has-task' : ''}${hasHabit ? ' has-habit' : ''}`);
    button.type = 'button';
    const activityLabels = [hasEntry ? '有记录' : '', hasTask ? '有完成任务' : '', hasHabit ? '有习惯打卡' : ''].filter(Boolean);
    button.setAttribute('aria-label', `${formatDate(dateValue, { year: 'numeric' })}${activityLabels.length ? `，${activityLabels.join('，')}` : '，没有记录或完成事项'}`);
    if (dateValue === localDate()) button.setAttribute('aria-current', 'date');
    if (dateValue === calendarSelectedDate) button.classList.add('is-selected');
    button.append(node('span', '', String(date.getDate())));
    if (activityLabels.length) {
      const dots = node('span', 'calendar-date-dots');
      dots.setAttribute('aria-hidden', 'true');
      if (hasEntry) dots.append(node('span', 'date-dot is-entry', '记录'));
      if (hasTask) dots.append(node('span', 'date-dot is-task', '任务'));
      if (hasHabit) dots.append(node('span', 'date-dot is-habit', '习惯'));
      button.append(dots);
    }
    button.addEventListener('click', () => {
      calendarSelectedDate = dateValue;
      grid.querySelectorAll('.calendar-day').forEach((cell) => cell.classList.toggle('is-selected', cell === button));
      void showPreview();
    });
    grid.append(button);
  }
  panel.append(grid);
  const footer = node('div', 'calendar-footer');
  const legend = node('span', 'legend');
  legend.append(node('span', 'legend-dot'), node('span', '', '有记录'));
  footer.append(legend, primaryButton('回到今天', () => {
    calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    go({ name: 'day', date: localDate() });
  }));
  panel.append(footer);
  main.append(panel);

  const showPreview = async (): Promise<void> => {
  const selectedQuests = allQuests.filter((quest) => quest.sourceType !== 'habit' && feedbackByQuest.get(quest.id)?.result === 'completed' && questResultDate(quest, feedbackByQuest) === calendarSelectedDate);
  const selectedHabitLogs = completedHabitLogs.filter((item) => item.localDate === calendarSelectedDate);
  const selectedEntries = entriesByDate.get(calendarSelectedDate) ?? [];
  const selectedPreview = node('section', 'calendar-day-preview');
  selectedPreview.append(sectionHeading(formatDate(calendarSelectedDate).replace('日周', '日 周'), { className: 'calendar-preview-heading' }));
  const selectedStats = node('p', 'calendar-preview-stats');
  selectedStats.append(
    node('span', 'is-entry', `${selectedEntries.length} 条记录`),
    node('span', 'is-task', `${selectedQuests.length} 项完成`),
    node('span', 'is-habit', `${selectedHabitLogs.length} 次习惯`),
  );
  selectedPreview.append(selectedStats);
  const selectedEntry = selectedEntries.at(-1);
  const selectedHabit = habitsById.get(selectedHabitLogs.at(-1)?.habitId ?? '');
  const previewLead = node('div', 'calendar-preview-lead');
  const previewIcon = node('span', `calendar-preview-icon${selectedEntry?.kind === 'success' ? ' is-success' : ''}`);
  if (selectedEntry) previewIcon.append(semanticIcon(selectedEntry.kind === 'success' ? 'success-record' : 'nav-record'));
  else if (selectedQuests.length) previewIcon.append(semanticIcon('nav-tasks'));
  else if (selectedHabit) previewIcon.append(semanticIcon('habit'));
  previewLead.append(
    previewIcon,
    node('p', selectedEntry ? 'line-clamp' : 'empty-copy', selectedEntry ? selectedEntry.body || '图片记录' : selectedQuests[0]?.title ?? selectedHabit?.name ?? '这一天还没有记录或完成事项'),
  );
  selectedPreview.append(previewLead);
  const previewActions = node('div', 'calendar-preview-actions');
  const editCaption = textAction('编辑当日一句', () => { void openDayCaptionDialog(calendarSelectedDate, selectedEntries); });
  const openReview = textAction('打开回顾 ›', () => go({ name: 'day', date: calendarSelectedDate }));
  previewActions.append(editCaption, openReview);
  selectedPreview.append(previewActions);
  const [profile, observations, analyses] = await Promise.all([db.getProfile(), db.resolvedStateAtOrBefore(calendarSelectedDate), db.listDailyAnalyses(calendarSelectedDate)]);
  const { dialog, content, actions } = dialogShell(formatDate(calendarSelectedDate), { className: 'day-snapshot-dialog' });
  content.append(snapshotRoomStage(calendarSelectedDate, selectedEntries, observations, selectedQuests, profile, analyses.find((item) => item.status === 'ready')), selectedPreview);
  const close = actionButton('关闭', () => dialog.close(), { variant: 'quiet' });
  actions.append(close);
  openReview.addEventListener('click', () => dialog.close());
  dialog.showModal();

  };

  const monthStart = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1));
  const monthEnd = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 0));
  const previousMonthStart = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1));
  const previousMonthEnd = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 0));
  const monthly = listSection('本月变化', { className: 'surface monthly-snapshot' });
  const completedTaskCount = (start: string, end: string): number => allQuests.filter((quest) => {
    const feedback = feedbackByQuest.get(quest.id);
    const date = questResultDate(quest, feedbackByQuest);
    return quest.sourceType !== 'habit' && feedback?.result === 'completed' && date >= start && date <= end;
  }).length;
  const habitScheduleOn = (habit: Habit, date: string): { scheduleDays: number[]; trackingEnabled: boolean } | undefined => {
    const history = habit.scheduleHistory?.length ? habit.scheduleHistory : [{
      effectiveFrom: localDate(new Date(habit.createdAt)), scheduleDays: habit.scheduleDays,
      trackingEnabled: habit.status === 'active' && habit.bonusEnabled,
    }];
    return history.filter((item) => item.effectiveFrom <= date).sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  };
  const habitRate = (start: string, end: string | null): number => {
    if (!end || end < start) return 0;
    const logs = new Map(habitLogs.map((item) => [`${item.habitId}:${item.localDate}`, item]));
    let planned = 0;
    let completed = 0;
    for (let date = start; date <= end; date = shiftDate(date, 1)) {
      const weekday = parseLocalDate(date).getDay() || 7;
      for (const habit of habits) {
        const schedule = habitScheduleOn(habit, date);
        if (!schedule?.trackingEnabled || !schedule.scheduleDays.includes(weekday)) continue;
        const log = logs.get(`${habit.id}:${date}`);
        if (log?.result === 'exempt') continue;
        planned += 1;
        if (log?.result === 'completed') completed += 1;
        else if (log?.result === 'partial') completed += .5;
      }
    }
    return planned ? Math.round(completed / planned * 100) : 0;
  };
  const observedEnd = (start: string, end: string): string | null => localDate() < start ? null : localDate() < end ? localDate() : end;
  const monthlyStats = node('div', 'monthly-stat-grid');
  const monthRecordDays = new Set(entries.filter((entry) => entry.localDate >= monthStart && entry.localDate <= monthEnd).map((entry) => entry.localDate)).size;
  const previousRecordDays = new Set(entries.filter((entry) => entry.localDate >= previousMonthStart && entry.localDate <= previousMonthEnd).map((entry) => entry.localDate)).size;
  const monthTaskCount = completedTaskCount(monthStart, monthEnd);
  const previousTaskCount = completedTaskCount(previousMonthStart, previousMonthEnd);
  const monthHabitRate = habitRate(monthStart, observedEnd(monthStart, monthEnd));
  const previousHabitRate = habitRate(previousMonthStart, observedEnd(previousMonthStart, previousMonthEnd));
  const comparison = (difference: number, unit: string): string => difference === 0 ? '与上月持平' : `较上月 ${difference > 0 ? '+' : ''}${difference}${unit}`;
  const stat = (label: string, value: string, comparisonText: string, kind: 'entry' | 'task' | 'habit', current: number, previous: number): HTMLElement => {
    const item = node('article', `monthly-stat is-${kind}`);
    item.append(node('span', 'monthly-stat-label', label), node('strong', '', value), node('span', 'monthly-stat-comparison', comparisonText));
    if (kind === 'habit') {
      const meter = node('span', 'monthly-stat-meter');
      meter.setAttribute('aria-hidden', 'true');
      meter.style.setProperty('--monthly-value', `${Math.max(0, Math.min(100, current))}%`);
      item.append(meter);
    } else {
      const maximum = Math.max(current, previous, 1);
      const y = (amount: number): number => 15 - Math.round(amount / maximum * 10);
      const trend = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      trend.classList.add('monthly-stat-trend');
      trend.setAttribute('viewBox', '0 0 72 18');
      trend.setAttribute('aria-hidden', 'true');
      const line = document.createElementNS(trend.namespaceURI, 'polyline');
      line.setAttribute('points', `4,${y(previous)} 68,${y(current)}`);
      trend.append(line);
      for (const [x, amount] of [[4, previous], [68, current]] as const) {
        const point = document.createElementNS(trend.namespaceURI, 'circle');
        point.setAttribute('cx', String(x));
        point.setAttribute('cy', String(y(amount)));
        point.setAttribute('r', '2');
        trend.append(point);
      }
      item.append(trend);
    }
    return item;
  };
  monthlyStats.append(
    stat('记录', `${monthRecordDays} 天`, comparison(monthRecordDays - previousRecordDays, ' 天'), 'entry', monthRecordDays, previousRecordDays),
    stat('完成任务', `${monthTaskCount} 项`, comparison(monthTaskCount - previousTaskCount, ' 项'), 'task', monthTaskCount, previousTaskCount),
    stat('习惯养成率', `${monthHabitRate}%`, comparison(monthHabitRate - previousHabitRate, '%'), 'habit', monthHabitRate, previousHabitRate),
  );
  monthly.append(monthlyStats);
  const growthDetails = optionalDetails('查看五维成长', 'monthly-growth-details');
  const activeGrowth = ledger.filter((item) => !item.reversedAt && item.dimension);
  for (const dimension of DIMENSIONS) {
    const amount = (start: string, end: string): number => activeGrowth
      .filter((item) => item.dimension === dimension.key && item.localDate >= start && item.localDate <= end)
      .reduce((sum, item) => sum + item.finalXp, 0);
    const current = amount(monthStart, monthEnd);
    const previous = amount(previousMonthStart, previousMonthEnd);
    const delta = current - previous;
    growthDetails.append(node('p', 'monthly-growth-row', `${dimension.label} · +${current}${delta === 0 ? ' · 与上月持平' : ` · 比上月${delta > 0 ? '多' : '少'} ${Math.abs(delta)}`}`));
  }
  monthly.append(growthDetails);
  const monthlyDetails = optionalDetails('本月变化', 'calendar-monthly-details');
  monthlyDetails.append(monthly);

  const search = listSection('查找记录', { className: 'search-section calendar-search-panel' });
  search.hidden = false;
  searchPanel = search;
  const searchForm = node('form', 'search-form');
  const query = node('input', 'input');
  query.type = 'search';
  query.placeholder = '搜索记录文字';
  query.setAttribute('aria-label', '搜索记录文字');
  const dateFilter = node('input', 'input');
  dateFilter.type = 'date';
  dateFilter.setAttribute('aria-label', '限定记录日期');
  const dateField = node('label', 'date-filter-field');
  const datePlaceholder = node('span', 'date-filter-placeholder', '选择日期');
  const syncDatePlaceholder = () => dateField.classList.toggle('has-value', Boolean(dateFilter.value));
  dateFilter.addEventListener('input', syncDatePlaceholder);
  syncDatePlaceholder();
  dateField.append(dateFilter, datePlaceholder);
  const searchButton = actionButton('查找', undefined, { type: 'submit' });
  const searchStatus = statusMessage();
  searchStatus.setAttribute('role', 'status');
  searchStatus.setAttribute('aria-live', 'polite');
  const results = listGroup('search-results');
  searchForm.append(query, dateField, searchButton);
  search.append(searchForm, searchStatus, results);
  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const found = await db.searchEntries(query.value, dateFilter.value || undefined);
    results.replaceChildren();
    if (!found.length) {
      searchStatus.textContent = '没有找到匹配记录。';
      return;
    }
    searchStatus.textContent = `找到 ${found.length} 条记录。`;
    for (const entry of found.slice().reverse()) {
      const item = listRow('button', 'ui-info-row is-multiline search-result-row');
      item.type = 'button';
      item.append(node('span', 'caption', formatDate(entry.localDate)), node('span', 'line-clamp', entry.body || '图片记录'));
      item.addEventListener('click', () => go({ name: 'day', date: entry.localDate }));
      results.append(item);
    }
  });
  const closeSearch = actionButton('关闭查找', () => { search.hidden = true; searchAction.focus(); }, { variant: 'quiet', className: 'calendar-search-close' });
  search.append(closeSearch);
  main.append(search, monthlyDetails);
  return main;
}

function dialogShell(title: string, options: {
  back?: boolean;
  className?: string;
  fullScreen?: boolean;
} = {}): { dialog: HTMLDialogElement; content: HTMLElement; actions: HTMLElement; titlebar: HTMLElement } {
  const dialog = node('dialog', ['dialog', options.fullScreen && 'full-screen-editor', options.className].filter(Boolean).join(' '));
  const content = node('div', 'dialog-content');
  const { header: titlebar, heading } = titleBar(title, {
    level: 'h2',
    className: 'ui-dialog-titlebar',
    back: options.back ? { onClick: () => dialog.close(), className: 'dialog-back' } : undefined,
  });
  heading.id = `dialog-title-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  content.append(titlebar);
  const actions = node('div', 'dialog-actions');
  dialog.append(content, actions);
  const navigation = bottomNavigation(currentRoute);
  navigation.classList.add('dialog-navigation');
  navigation.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) {
      document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((open) => open.close());
    }
  });
  dialog.append(navigation);
  document.body.append(dialog);
  const viewport = window.visualViewport;
  const syncViewport = (): void => {
    dialog.style.setProperty('--dialog-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
    dialog.style.setProperty('--dialog-viewport-top', `${viewport?.offsetTop ?? 0}px`);
  };
  syncViewport();
  viewport?.addEventListener('resize', syncViewport);
  viewport?.addEventListener('scroll', syncViewport);
  dialog.addEventListener('close', () => {
    viewport?.removeEventListener('resize', syncViewport);
    viewport?.removeEventListener('scroll', syncViewport);
    dialog.remove();
  }, { once: true });
  dialog.addEventListener('cancel', () => dialog.close());
  return { dialog, content, actions, titlebar };
}

function showOnboarding(): void {
  const { dialog, content, actions } = dialogShell('选一个陪伴角色');
  const choices = avatarChoiceGroup();
  const selected = statusMessage();
  let avatar: Profile['avatar'] = null;
  const begin = primaryButton('写下第一件事', () => {
    if (!avatar) return;
    begin.disabled = true;
    void (async () => {
      try {
        await db.saveProfile({ avatar, companionName: avatarName(avatar) });
        settings = await db.saveSettings({ onboardingSeen: true });
        dialog.close();
        if (currentRoute.name === 'record') document.querySelector<HTMLTextAreaElement>('.journal-input')?.focus();
        else {
          focusRecordInputOnNextRender = true;
          go({ name: 'record' });
        }
      } catch (error) {
        begin.disabled = false;
        showToast(errorMessage(error), 'error');
      }
    })();
  });
  begin.disabled = true;
  (['female', 'male'] as const).forEach((choice) => {
    const label = avatarName(choice);
    const button = avatarChoice(label, avatarAsset(choice), () => {
      avatar = choice;
      choices.querySelectorAll<HTMLButtonElement>('.avatar-choice').forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-selected', active);
        item.setAttribute('aria-pressed', String(active));
      });
      selected.textContent = `已选择${label}`;
      begin.disabled = false;
    });
    choices.append(button);
  });
  content.append(choices, selected);
  actions.append(begin);
  dialog.showModal();
  const heading = content.querySelector<HTMLHeadingElement>('h2');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

function confirmAction(title: string, message: string, confirmLabel: string, dangerous = false): Promise<boolean> {
  return new Promise((resolve) => {
    const { dialog, content, actions } = dialogShell(title);
    content.append(node('p', '', message));
    const cancel = actionButton('取消', () => { resolve(false); dialog.close(); });
    const confirm = actionButton(confirmLabel, () => { resolve(true); dialog.close(); }, { variant: dangerous ? 'danger' : 'primary' });
    dialog.addEventListener('cancel', () => resolve(false), { once: true });
    actions.append(cancel, confirm);
    dialog.showModal();
    cancel.focus();
  });
}

function previewContextRow(title: string, detail: string, checked = true): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = node('label', 'preview-option');
  const input = node('input');
  input.type = 'checkbox';
  input.checked = checked;
  const copy = node('span');
  copy.append(node('strong', '', title), node('span', 'caption', detail));
  label.append(input, copy);
  return { label, input };
}

function appendStoredRequestPreview(content: HTMLElement, request: DailyAnalysisRequest): void {
  const scope = node('div', 'analysis-preview-scope');
  const records = listSection(`记录正文 · ${request.userInput.entries.length} 条`, { className: 'preview-group' });
  request.userInput.entries.forEach((entry) => {
    const item = node('article', 'preview-record');
    item.append(node('p', 'caption', `记录 ${entry.entryId.slice(0, 8)} · v${entry.revision}`), node('p', 'entry-body', entry.text));
    records.append(item);
  });
  const context = listSection('上下文摘要', { className: 'preview-group' });
  context.append(node('p', '', [
    `已确认事件 ${request.context.confirmedEvents.length} 条`,
    `五维状态 ${request.context.recentStates.length} 天`,
    `当前目标 ${request.context.goals.length} 个`,
    `习惯 ${request.context.bonusHabits.length} 个`,
    `当天任务结果 ${request.context.recentTaskResults.length} 条`,
    `长期记忆 ${request.context.memories.length} 条`,
    `现实约束 ${request.context.constraints.length} 条`,
  ].join(' · ')));
  if (request.context.memories.length) context.append(node('p', 'caption', request.context.memories.map((item) => `「${item.statement}」`).join('；')));
  if (request.context.constraints.length) context.append(node('p', 'caption', request.context.constraints.join('；')));
  scope.append(records, context);
  content.append(scope, node('p', 'privacy-boundary', '这些内容将离开设备并发送到已配置的 AI 服务；原文不会进入栖光服务端普通日志。'));
}

async function openAnalysisPreview(date: string, entries: JournalEntry[], retryJob?: AnalysisJob, onSummary?: (summary: string) => void): Promise<void> {
  if (!NATIVE_AI_READY) { showToast(NATIVE_AI_UNAVAILABLE, 'error'); return; }
  const textEntries = entries.filter((entry) => entry.body.trim());
  if (!retryJob && !textEntries.length) { showToast('先写一条文字记录。', 'error'); return; }
  const { dialog, content, actions } = dialogShell(retryJob ? '检查并重试整理' : '发送内容', { back: true, className: 'analysis-preview-dialog', fullScreen: true });
  if (retryJob) {
    if (retryJob.operation !== 'daily_analysis') throw new Error('这不是每日整理任务。');
    appendStoredRequestPreview(content, retryJob.request as DailyAnalysisRequest);
    const cancel = actionButton('取消', () => dialog.close());
    const send = actionButton(navigator.onLine ? '使用同一请求重试' : '当前离线', undefined, { variant: 'primary' });
    send.disabled = !navigator.onLine;
    send.addEventListener('click', () => {
      dialog.close();
      void submitAnalysisJob(retryJob, retryJob.status === 'processing');
    });
    actions.append(cancel, send);
    dialog.showModal();
    cancel.focus();
    return;
  }

  const choices = await analysisContext(date);
  const recordOptions = textEntries.map((entry, index) => {
    const option = previewContextRow(`记录 ${index + 1} · v${entry.version}`, entry.body, true);
    option.label.classList.add('is-record');
    content.append(option.label);
    return { entry, input: option.input };
  });
  const contextGroup = listSection('附加信息（可选）', { className: 'preview-group' });
  const eventOption = previewContextRow('当天已确认事件', `${choices.events.length} 条；用于避免重复提取`);
  const stateOption = previewContextRow('最近七天五维摘要', `${choices.recentStates.length} 天；不包含历史原文`);
  const goalOption = previewContextRow('当前目标', choices.goals.map((item) => item.result).join('；') || '无');
  const habitOption = previewContextRow('习惯打卡', choices.habits.map((item) => item.name).join('；') || '无');
  const taskResultOption = previewContextRow('当天已记录的任务', `${choices.recentTaskResults.length} 条；用于避免重复计算成长值`);
  [eventOption, stateOption, goalOption, habitOption, taskResultOption].forEach((option) => contextGroup.append(option.label));
  const memoryOptions = choices.memories.map((memory) => {
    const option = previewContextRow(`已保存的信息 · ${MEMORY_TYPE_LABELS[memory.type]}`, memory.statement, true);
    contextGroup.append(option.label);
    return { memory, input: option.input };
  });
  const constraints = node('textarea', 'input preview-constraints');
  constraints.maxLength = 600;
  constraints.placeholder = '例如：明天下午只有 20 分钟，今晚需要优先休息。';
  const constraintLabel = labelledControl('这次需要考虑的现实约束（可选）', constraints);
  contextGroup.append(constraintLabel);
  content.append(contextGroup);

  let consent: HTMLInputElement | undefined;
  if (!settings.aiAllowed) {
    const consentRow = node('label', 'confirm-check ai-consent');
    consent = node('input');
    consent.type = 'checkbox';
    consentRow.append(consent, node('span', '', '我允许将本次选中的内容发送到配置的 AI 服务，并保留随时关闭权限的选择。'));
    content.append(consentRow);
  }
  content.append(node('p', 'privacy-boundary', '默认不会发送全部历史日记、未确认或已忘记的长期内容、设备标识，也不会自动在联网后上传。'));
  const status = statusMessage();
  status.setAttribute('role', 'status');
  content.append(status);

  const cancel = actionButton('取消发送', () => dialog.close());
  const send = actionButton(navigator.onLine ? '确认并整理' : '保存为待整理', undefined, { variant: 'primary' });
  const update = (): void => {
    const selected = recordOptions.filter((option) => option.input.checked);
    const characters = selected.reduce((sum, option) => sum + Array.from(option.entry.body).length, 0);
    const allowed = selected.length > 0 && characters <= 20_000 && (!consent || consent.checked);
    send.disabled = !allowed;
    status.textContent = selected.length ? `将发送 ${selected.length} 条记录，共 ${characters} 个字符${characters > 20_000 ? '；请减少范围' : ''}` : '至少选择一条记录。';
    status.classList.toggle('is-error', !selected.length || characters > 20_000);
  };
  [...recordOptions.map((item) => item.input), ...(consent ? [consent] : [])].forEach((input) => input.addEventListener('change', update));
  update();
  send.addEventListener('click', async () => {
    send.disabled = true;
    const selectedEntries = recordOptions.filter((option) => option.input.checked).map((option) => option.entry);
    const selectedMemories = memoryOptions.filter((option) => option.input.checked).map((option) => option.memory);
    const constraintValues = constraints.value.split(/\n|；/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
    const request: DailyAnalysisRequest = {
      contractVersion: ANALYSIS_CONTRACT_VERSION,
      operation: 'daily_analysis',
      requestId: crypto.randomUUID(),
      locale: 'zh-CN',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      localDate: date,
      userInput: { entries: selectedEntries.map((entry) => ({ entryId: entry.id, revision: entry.version, text: entry.body })) },
      context: {
        confirmedEvents: eventOption.input.checked ? choices.events.map((item) => ({ eventId: item.id, localDate: item.localDate, title: item.title })) : [],
        recentStates: stateOption.input.checked ? choices.recentStates : [],
        goals: goalOption.input.checked ? choices.goals : [],
        bonusHabits: habitOption.input.checked ? choices.habits : [],
        recentTaskResults: taskResultOption.input.checked ? choices.recentTaskResults : [],
        memories: selectedMemories.map((item) => ({ memoryId: item.id, type: item.type, statement: item.statement })),
        constraints: constraintValues,
      },
      permissions: {
        entryIds: selectedEntries.map((entry) => entry.id),
        includeConfirmedEvents: eventOption.input.checked,
        includeRecentStates: stateOption.input.checked,
        includeGoals: goalOption.input.checked,
        includeBonusHabits: habitOption.input.checked,
        taskResultQuestIds: taskResultOption.input.checked ? choices.recentTaskResults.map((item) => item.questId) : [],
        memoryIds: selectedMemories.map((item) => item.id),
      },
    };
    try {
      if (!settings.aiAllowed) settings = await db.saveSettings({ aiAllowed: true, previewBeforeSend: true });
      const job = await db.createDailyAnalysisJob(request);
      dialog.close();
      await submitAnalysisJob(job);
      const ready = (await db.listDailyAnalyses(date)).find((item) => item.status === 'ready');
      if (ready && onSummary) onSummary(ready.result.summary);
    } catch (error) {
      send.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, send);
  dialog.showModal();
  cancel.focus();
}

async function deleteEntry(entry: JournalEntry, dialog?: HTMLDialogElement): Promise<void> {
  if (!await confirmAction('删除这条记录？', '正文及其修改历史会从本机永久删除，无法撤销。', '删除', true)) return;
  try {
    await db.deleteEntry(entry.id);
    dialog?.close();
    showToast('记录已从本机删除。');
    await render();
  } catch (error) { showToast(errorMessage(error), 'error'); }
}

async function openEntryDetailDialog(entry: JournalEntry): Promise<void> {
  return openEditDialog(entry);
}

async function openEditDialog(entry: JournalEntry): Promise<void> {
  const { dialog, content, actions, titlebar } = dialogShell('记录详情', { back: true, className: 'record-detail-editor', fullScreen: true });
  const bodyLabel = node('label', 'ui-list-section');
  bodyLabel.append(node('span', 'ui-list-heading', '正文'));
  const textarea = node('textarea', 'journal-input compact');
  textarea.maxLength = 12_000;
  textarea.value = entry.body;
  bodyLabel.append(textarea);
  const kind = entry.kind ?? 'journal';
  let imageDataUrl = entry.imageDataUrl;
  const imageInput = node('input') as HTMLInputElement;
  imageInput.type = 'file';
  imageInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
  imageInput.hidden = true;
  const imageBox = node('div', 'record-detail-image-box');
  const renderImage = (): void => {
    imageBox.replaceChildren();
    if (imageDataUrl) {
      const image = node('img') as HTMLImageElement;
      image.src = imageDataUrl;
      image.alt = '记录图片';
      imageBox.append(image);
    }
    const replace = actionButton(imageDataUrl ? '更换图片' : '添加图片', () => imageInput.click());
    const remove = actionButton('移除图片', () => { imageDataUrl = undefined; imageInput.value = ''; renderImage(); }, { variant: 'quiet' });
    remove.hidden = !imageDataUrl;
    imageBox.append(replace, remove, imageInput);
  };
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    try {
      imageDataUrl = await readRecordImage(file);
      renderImage();
    } catch (error) {
      imageInput.value = '';
      showToast(errorMessage(error), 'error');
    }
  });
  renderImage();
  const status = statusMessage(`${formatDate(entry.localDate)} · v${entry.version}`);
  const more = disclosure('⋮', 'record-detail-more');
  const moreActions = actionGroup('record-detail-more-actions');
  const history = actionButton('修改历史', () => { dialog.close(); void openHistoryDialog(entry); }, { variant: 'quiet' });
  const remove = actionButton('删除记录', () => { void deleteEntry(entry, dialog); }, { variant: 'quiet', className: 'danger-button' });
  moreActions.append(history, remove);
  more.append(moreActions);
  titlebar.append(more);
  content.append(bodyLabel, imageBox, status);
  const save = actionButton('保存修改', async () => {
    save.disabled = true;
    status.textContent = '正在保存修改…';
    try {
      await db.editEntry(entry.id, entry.version, textarea.value, kind, imageDataUrl);
      dialog.close();
      showToast('修改已保存，可撤销一次。');
      await render();
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  }, { variant: 'primary' });
  actions.append(save);
  dialog.showModal();
  textarea.focus();
}

async function openHistoryDialog(entry: JournalEntry): Promise<void> {
  const history = await db.listRevisions(entry.id);
  const { dialog, content, actions } = dialogShell('修改历史');
  if (!history.length) content.append(emptyState('暂无修改'));
  for (const revision of history) {
    const item = node('article', 'revision-item');
    item.append(
      node('strong', '', `v${revision.fromVersion} · ${revision.reason === 'user-edit' ? '修改前版本' : '撤销前版本'}`),
      node('time', 'caption', new Date(revision.createdAt).toLocaleString('zh-CN')),
      node('p', '', revision.previousBody),
    );
    content.append(item);
  }
  const close = actionButton('关闭', () => dialog.close());
  actions.append(close);
  const latest = history[0];
  if (latest?.reason === 'user-edit' && !latest.undoneAt && latest.fromVersion + 1 === entry.version) {
    const undo = actionButton('撤销最近修改', async () => {
      undo.disabled = true;
      try {
        await db.undoLastEdit(entry.id);
        dialog.close();
        showToast('已恢复到修改前记录。');
        await render();
      } catch (error) {
        undo.disabled = false;
        showToast(errorMessage(error), 'error');
      }
    }, { variant: 'primary' });
    actions.append(undo);
  }
  dialog.showModal();
  close.focus();
}

function openSafetyResources(): void {
  const { dialog, content, actions } = dialogShell('本地求助资源');
  content.append(
    node('p', 'danger-copy', '如果你或他人正处于立即危险中，请先离开危险环境，并联系身边可信任的人或所在地紧急服务。'),
    node('p', '', '中国大陆：公安紧急求助 110 · 医疗急救 120 · 全国统一心理援助热线 12356。'),
    node('p', 'caption', '栖光不能监控风险、代替专业帮助或自动通知任何人；这组号码由国家卫生健康委及政府公开信息配置，不由模型临时生成。'),
  );
  const close = primaryButton('我知道了', () => dialog.close());
  actions.append(close);
  dialog.showModal();
  close.focus();
}

async function openEventDecision(item: JournalEvent): Promise<void> {
  const { dialog, content, actions } = dialogShell('核对 AI 整理');
  const type = node('p', `event-kind is-${item.sourceType}`, item.sourceType === 'explicit' ? '记录中的事实' : 'AI 的推断');
  const title = node('input', 'input');
  title.value = item.title;
  title.maxLength = 60;
  const description = node('textarea', 'input event-edit-description');
  description.value = item.description;
  description.maxLength = 500;
  content.append(type, labelledControl('事件标题', title), labelledControl('事件说明', description));
  const evidence = listSection('对应原文', { className: 'event-evidence' });
  item.evidence.forEach((value) => evidence.append(node('blockquote', '', `“${value.quote}”`)));
  content.append(evidence);
  if (item.stateImpactCandidates.length) {
    const impacts = listSection('状态建议', { className: 'event-evidence' });
    item.stateImpactCandidates.forEach((impact) => impacts.append(node('p', '', `${dimensionLabel(fromContractDimension(impact.dimension))} ${impact.suggestedDelta > 0 ? '+' : ''}${impact.suggestedDelta}`)));
    content.append(impacts);
  }
  let growthDimension: HTMLSelectElement | undefined;
  let growthXp: HTMLSelectElement | undefined;
  if (item.growthEvidenceCandidate) {
    const growth = listSection('成长建议', { className: 'event-growth-decision' });
    if (item.growthEvidenceCandidate.matchedQuestId) {
      growth.append(node('p', '', '这件事已在任务中记录成长值，本次只补充到日记。'));
    } else {
      growthDimension = taskDimensionSelect(fromContractDimension(item.growthEvidenceCandidate.dimension));
      growthXp = node('select', 'input');
      for (const value of [1, 2, 3] as const) growthXp.append(selectOption(String(value), `${value} 成长值`, item.growthEvidenceCandidate.suggestedXp === value));
      growth.append(labelledControl('五维状态', growthDimension), labelledControl('成长值', growthXp));
    }
    content.append(growth);
  }
  const eventPatch = () => ({
    title: title.value,
    description: description.value,
    growthEvidenceCandidate: item.growthEvidenceCandidate ? {
      ...item.growthEvidenceCandidate,
      dimension: toContractDimension((growthDimension?.value as Dimension | undefined) ?? fromContractDimension(item.growthEvidenceCandidate.dimension)),
      suggestedXp: Number(growthXp?.value ?? item.growthEvidenceCandidate.suggestedXp) as 1 | 2 | 3,
    } : null,
  });
  const status = statusMessage();
  status.setAttribute('role', 'status');
  content.append(status);
  const cancel = actionButton('取消', () => dialog.close());
  const reject = actionButton(item.confirmation === 'rejected' ? '保持否认' : '否认并撤销影响', undefined, { variant: 'quiet' });
  reject.addEventListener('click', async () => {
    reject.disabled = true;
    try {
      await db.decideEvent(item.id, 'rejected', eventPatch());
      dialog.close();
      showToast('已否认；相关状态和成长值已撤销。');
      await render();
    } catch (error) {
      reject.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  const confirm = actionButton(item.confirmation === 'confirmed' ? '保存核对结果' : '确认并应用建议', undefined, { variant: 'primary' });
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await db.decideEvent(item.id, 'confirmed', eventPatch());
      dialog.close();
      showToast('已确认；状态和成长值已更新。');
      await render();
    } catch (error) {
      confirm.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, reject, confirm);
  dialog.showModal();
  cancel.focus();
}

async function acceptQuestSuggestion(analysis: DailyAnalysis, suggestion: QuestSuggestion, index: number): Promise<void> {
  void suggestion;
  const accepted = await db.acceptAnalysisQuestSuggestion(analysis.id, index);
  showToast(accepted.created ? '任务草案已由你确认并加入任务板。' : '这条建议已经加入任务板。');
  await render();
}

function eventCard(item: JournalEvent): HTMLElement {
  const card = node('article', `analysis-event is-${item.sourceType} is-${item.confirmation}`);
  const header = node('header', 'analysis-event-header');
  header.append(
    node('span', `event-kind is-${item.sourceType}`, item.sourceType === 'explicit' ? '来自原文' : 'AI 推断'),
    node('span', `confirmation-tag is-${item.confirmation}`, ({ confirmed: '已确认', pending: '待确认', rejected: '已否认' } as const)[item.confirmation]),
    node('span', 'caption', `确定程度：${({ high: '高', medium: '中', low: '低' } as const)[item.confidence]}`),
  );
  card.append(header, node('h4', '', item.title), node('p', '', item.description));
  const evidence = node('div', 'event-evidence-list');
  item.evidence.forEach((value) => evidence.append(node('blockquote', '', `“${value.quote}”`)));
  card.append(evidence);
  if (item.stateImpactCandidates.length) {
    const impacts = node('ul', 'impact-list');
    item.stateImpactCandidates.forEach((impact) => {
      impacts.append(node('li', '', `${dimensionLabel(fromContractDimension(impact.dimension))} ${impact.suggestedDelta > 0 ? '+' : ''}${impact.suggestedDelta} · ${impact.reason}`));
    });
    card.append(impacts);
  }
  if (item.growthEvidenceCandidate) card.append(node('p', 'growth-candidate', item.growthEvidenceCandidate.matchedQuestId
    ? '已在任务中记录成长值'
    : `${dimensionLabel(fromContractDimension(item.growthEvidenceCandidate.dimension))}成长 +${item.growthEvidenceCandidate.suggestedXp}`));
  const decisionLabel = item.confirmation === 'pending'
    ? item.sourceType === 'explicit' ? '确认这条记录' : '核对 AI 推断'
    : '修改或撤销';
  card.append(actionButton(decisionLabel, () => { void openEventDecision(item); }));
  return card;
}

async function dailyAnalysisSection(date: string, entries: JournalEntry[], quests: Quest[]): Promise<HTMLElement> {
  const [analyses, jobs, events, tomorrowQuests] = await Promise.all([
    db.listDailyAnalyses(date), db.listAnalysisJobs(date), db.listJournalEvents(date), db.listQuests(shiftDate(date, 1)),
  ]);
  const dailyJobs = jobs.filter((item) => item.operation === 'daily_analysis');
  const section = node('section', 'surface daily-analysis');
  const latestJob = dailyJobs[0];
  const ready = analyses.find((item) => item.status === 'ready');
  section.append(sectionHeading(ready ? '整理结果' : '今天的整理'));

  if (latestJob?.status === 'safety-review') {
    const safety = node('aside', 'safety-review');
    safety.append(
      node('strong', '', '先暂停普通游戏化反馈'),
      node('p', '', analysisErrorCopy('SAFETY_REVIEW')),
      node('p', '', '如果有立即危险，请联系所在地紧急服务或身边可信任的人。原始记录仍只按你的选择保存在本机。'),
      primaryButton('查看本地求助资源', openSafetyResources),
    );
    section.append(safety);
  } else if (latestJob?.status === 'processing') {
    const state = node('div', 'analysis-job-state is-running');
    state.append(
      node('strong', '', '正在整理'),
      node('p', '', '可以离开本页；原文已在本机保存。另一标签也可能仍在处理，请暂时不要修改这批记录。'),
      interruptedRetryButton(latestJob, () => { void openAnalysisPreview(date, entries, latestJob); }),
    );
    section.append(state);
  } else if (latestJob && ['queued', 'failed'].includes(latestJob.status)) {
    const state = node('div', `analysis-job-state is-${latestJob.status}`);
    state.append(node('strong', '', latestJob.status === 'queued' ? '已保存在本机，等待你继续' : '整理尚未完成'));
    state.append(node('p', '', latestJob.errorCode ? analysisErrorCopy(latestJob.errorCode, latestJob.errorMessage) : '不会自动联网上传；由你检查范围后继续。'));
    const retry = actionButton(!NATIVE_AI_READY ? 'MiniMax 未配置' : navigator.onLine ? '检查范围并重试' : '当前离线', undefined, { variant: 'primary' });
    retry.disabled = !navigator.onLine || !NATIVE_AI_READY;
    retry.addEventListener('click', () => { void openAnalysisPreview(date, entries, latestJob); });
    state.append(retry);
    section.append(state);
  }

  if (!ready) {
    const successes = successCredits(entries, quests, events);
    const successBlock = node('section', 'success-evidence');
    successBlock.append(node('strong', '', '今天做成的事'));
    if (successes.length) {
      const list = node('ul', 'success-list');
      successes.forEach((item) => list.append(node('li', '', item)));
      successBlock.append(list);
    }
    successBlock.append(actionButton('写生活日记', () => openSuccessRecord(date)));
    section.append(successBlock);
    if (!entries.length && successes.length) section.append(node('p', 'muted', '已有行动反馈'));
    else if (!NATIVE_AI_READY) section.append(node('p', 'caption', 'AI 未配置'));
    else if (!latestJob || !['queued', 'processing', 'failed', 'safety-review'].includes(latestJob.status)) {
      section.append(primaryButton('检查范围并整理', () => { void openAnalysisPreview(date, entries); }));
    }
    const staleCount = analyses.filter((item) => item.status === 'stale').length;
    if (staleCount) section.append(node('p', 'caption', `${staleCount} 份旧整理因原文版本变化已失效，相关影响不再生效。`));
    return section;
  }

  const hero = node('header', 'analysis-summary');
  if (ready.result.explicitMoods.length) hero.append(node('p', 'eyebrow', `明确心情 · ${ready.result.explicitMoods.join(' / ')}`));
  hero.append(node('h3', '', ready.result.title), node('p', '', ready.result.summary));
  section.append(hero);
  if (ready.warnings.length) section.append(node('p', 'analysis-warning', ready.warnings.join('；')));

  const analysisEvents = events.filter((item) => item.analysisId === ready.id);
  const pendingEvents = analysisEvents.filter((item) => item.confirmation === 'pending');
  const reviewedEvents = analysisEvents.filter((item) => item.confirmation !== 'pending');
  const eventList = node('div', 'analysis-events');
  if (pendingEvents.length) {
    eventList.append(sectionHeading(`待你核对 · ${pendingEvents.length}`, { level: 'h3' }));
    pendingEvents.forEach((item) => eventList.append(eventCard(item)));
  }
  if (reviewedEvents.length) {
    const history = optionalDetails(`已核对事件 · ${reviewedEvents.length}`, 'analysis-event-history');
    reviewedEvents.forEach((item) => history.append(eventCard(item)));
    eventList.append(history);
  }
  if (eventList.childElementCount) section.append(eventList);

  const reflection = listSection('今天留下的', { className: 'daily-reflection' });
  const successes = successCredits(entries, quests, events);
  const successBlock = node('section', 'success-evidence');
  successBlock.append(node('strong', '', '今日记录'));
  if (successes.length) {
    const list = node('ul', 'success-list');
    successes.forEach((item) => list.append(node('li', '', item)));
    successBlock.append(list);
  }
  reflection.append(successBlock);
  const nextStep = node('div', 'reflection-row');
  nextStep.append(node('strong', '', '明天最小一步'), node('p', '', ready.result.reflection.nextSmallStep));
  reflection.append(nextStep);
  const moreReflection = optionalDetails('更多复盘', 'daily-reflection-more');
  const whatHappened = node('div', 'reflection-row');
  whatHappened.append(node('strong', '', '发生了什么'), node('p', '', ready.result.reflection.whatHappened));
  moreReflection.append(whatHappened);
  if (ready.result.reflection.patternCandidate) {
    const pattern = ready.result.reflection.patternCandidate;
    moreReflection.append(node('p', 'pattern-candidate', `待观察模式：${pattern.observation} · 目前记录 ${pattern.evidenceCount} 次；${pattern.neededEvidence.replaceAll('证据', '记录')}`));
  }
  reflection.append(moreReflection);
  section.append(reflection);

  if (ready.result.questSuggestions.length) {
    const suggestions = listSection('明日任务草案', { className: 'quest-suggestions' });
    ready.result.questSuggestions.forEach((suggestion, index) => {
      const actionId = `analysis:${ready.id}:suggestion:${index}`;
      const accepted = tomorrowQuests.some((quest) => quest.actionId === actionId);
      const card = node('article', 'ui-panel quest-suggestion');
      card.append(node('span', 'tag', '任务建议'), node('h4', '', suggestion.title), node('p', '', suggestion.why), node('p', 'caption', `最小一步：${suggestion.minimumVersion} · ${suggestion.estimatedMinutes} 分钟`));
      const accept = actionButton(accepted ? '已加入任务板' : '由我确认并加入', undefined);
      accept.disabled = accepted;
      accept.addEventListener('click', async () => {
        accept.disabled = true;
        try { await acceptQuestSuggestion(ready, suggestion, index); }
        catch (error) { accept.disabled = false; showToast(errorMessage(error), 'error'); }
      });
      card.append(accept);
      suggestions.append(card);
    });
    section.append(suggestions);
  }
  const candidateCount = ready.result.memoryCandidates.length;
  if (candidateCount) section.append(actionButton(`待确认建议 · ${candidateCount}`, () => go({ name: 'system' }), { variant: 'quiet' }));
  const sourceVersions = new Map(ready.sourceEntries.map((item) => [item.entryId, item.revision]));
  const uncovered = entries.filter((entry) => sourceVersions.get(entry.id) !== entry.version).length;
  const refresh = actionButton(uncovered ? `有 ${uncovered} 条新增记录，重新整理` : '重新检查范围并整理', () => { void openAnalysisPreview(date, entries); });
  if (uncovered) section.append(refresh);
  else {
    const maintenance = optionalDetails('整理范围与更新', 'analysis-maintenance');
    if (ready.contextSummary) maintenance.append(node('p', 'caption', ready.contextSummary));
    maintenance.append(refresh);
    section.append(maintenance);
  }
  return section;
}

type ReviewFieldKey = keyof DailyReviewNote | keyof WeeklyReviewNote;
const DAILY_REVIEW_FIELDS: Array<[ReviewFieldKey, string]> = [
  ['progress', '今天推进了什么'],
  ['takeaway', '今天留下了什么'],
  ['problem', '最大问题'],
  ['tomorrowFocus', '明天最重要的一件事'],
];
const WEEKLY_REVIEW_FIELDS: Array<[ReviewFieldKey, string]> = [
  ['progress', '本周进展'],
  ['assets', '本周形成的资产'],
  ['biggestProgress', '最大进步'],
  ['biggestWaste', '最大浪费'],
  ['stopOrReduce', '停止或减少'],
  ['nextFocus', '下周最重要的一件事'],
];

function reviewFieldValue(review: DailyReviewNote | WeeklyReviewNote | undefined, key: ReviewFieldKey): string {
  return review && key in review ? String(Reflect.get(review, key) ?? '') : '';
}

function openPersonalReviewEditor(
  title: string,
  current: DailyReviewNote | WeeklyReviewNote | undefined,
  fields: Array<[ReviewFieldKey, string]>,
  save: (values: Partial<Record<ReviewFieldKey, string>>) => Promise<void>,
): void {
  const { dialog, content, actions } = dialogShell(title, { back: true, className: 'personal-review-editor', fullScreen: true });
  const inputs = new Map<ReviewFieldKey, HTMLTextAreaElement>();
  const form = formStack('personal-review-fields');
  fields.forEach(([key, label]) => {
    const input = node('textarea', 'input compact-textarea');
    input.maxLength = 1_000;
    input.value = reviewFieldValue(current, key);
    input.setAttribute('aria-label', label);
    inputs.set(key, input);
    form.append(labelledControl(label, input));
  });
  const status = statusMessage();
  content.append(form, status);
  const submit = actionButton('保存复盘', undefined, { variant: 'primary' });
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    try {
      await save(Object.fromEntries([...inputs].map(([key, input]) => [key, input.value])));
      dialog.close();
      showToast('复盘已保存。');
      await render();
    } catch (error) {
      submit.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(submit);
  dialog.showModal();
  inputs.values().next().value?.focus();
}

function personalReviewSection(
  title: string,
  current: DailyReviewNote | WeeklyReviewNote | undefined,
  fields: Array<[ReviewFieldKey, string]>,
  edit: () => void,
): HTMLElement {
  const section = node('section', 'personal-review-card');
  const button = textAction(current ? '修改' : '填写', edit);
  const header = sectionHeading(title, { tail: button });
  const list = node('div', 'personal-review-list');
  fields.forEach(([key, label]) => {
    const row = node('div', 'personal-review-row');
    const value = reviewFieldValue(current, key);
    row.append(node('strong', '', label), node('p', value ? '' : 'is-empty', value || '—'));
    list.append(row);
  });
  if (fields === WEEKLY_REVIEW_FIELDS) section.classList.add('weekly-review-summary');
  section.append(header, list);
  return section;
}

async function dayPage(date: string): Promise<HTMLElement> {
  const [entries, observations, allQuests, allFeedback, profile, analyses, caption] = await Promise.all([
    db.listEntries(date), db.resolvedStateAtOrBefore(date), db.listQuests(), db.listQuestFeedback(), db.getProfile(), db.listDailyAnalyses(date), db.getDayCaption(date),
  ]);
  const activeFeedback = activeFeedbackByQuest(allFeedback);
  const quests = allQuests.filter((quest) => {
    const feedback = activeFeedback.get(quest.id);
    return feedback && questResultDate(quest, activeFeedback) === date;
  });
  const main = node('main', 'page page-day');
  const addRecord = textAction('新增', () => go({ name: 'record', date }), 'page-header-text-action');
  main.append(pageHeader(formatDate(date).replace('日周', '日 周'), { back: true, action: addRecord }));

  const journal = listSection('今天留下的', { className: 'journal-sheet' });
  if (caption?.text) {
    const summary = node('article', 'day-record-summary');
    summary.append(node('strong', '', '今日一句'), node('p', '', caption.text));
    journal.append(summary);
  }
  if (!entries.length && !caption?.text) journal.append(emptyState('暂无记录', 'journal-empty'));
  for (const entry of entries) {
    journal.append(recordItem({
      variant: 'detail', body: entry.body, time: entryTime(entry), kind: entry.kind,
      imageSource: entry.imageDataUrl, onOpen: () => { void openEntryDetailDialog(entry); },
    }));
  }

  const actionResults = listSection('行动结果', { className: 'day-action-results' });
  if (!quests.length) actionResults.append(emptyState('这一天还没有行动结果'));
  const resultLabels: Record<FeedbackResult, string> = { completed: '已完成', partial: '有进展', skipped: '已跳过', exempt: '无需完成' };
  quests.forEach((quest) => {
    const feedback = activeFeedback.get(quest.id)!;
    const row = node('article', `day-action-row is-${feedback.result} is-${quest.sourceType}`);
    row.setAttribute('aria-label', `“${quest.title}”的任务结果：${resultLabels[feedback.result]}`);
    const result = node('span', 'day-action-result');
    if (quest.targetCount) {
      const progress = Math.min(quest.targetCount, quest.progressCount ?? (feedback.result === 'completed' ? quest.targetCount : 0));
      result.append(node('span', '', `${progress}/${quest.targetCount}`));
      const meter = node('span', 'day-action-meter');
      meter.setAttribute('aria-hidden', 'true');
      meter.style.setProperty('--day-action-progress', `${Math.round(progress / quest.targetCount * 100)}%`);
      result.append(meter);
    } else result.append(node('span', 'day-action-status', quest.sourceType === 'habit' && feedback.result === 'completed' ? '已打卡' : resultLabels[feedback.result]));
    const copy = node('span', 'day-action-copy');
    copy.append(node('strong', '', quest.title));
    if (feedback?.actual) copy.append(node('span', 'caption line-clamp', feedback.actual));
    row.append(copy, result);
    actionResults.append(row);
  });

  const snapshot = snapshotRoomStage(date, entries, observations, quests, profile, analyses.find((item) => item.status === 'ready'));
  snapshot.id = `day-room-${date}`;
  const roomPreview = node('section', 'day-room-preview');
  const roomLink = node('button', 'day-room-link', '查看完整房间 ›');
  roomLink.type = 'button';
  roomLink.setAttribute('aria-controls', snapshot.id);
  roomLink.setAttribute('aria-expanded', 'false');
  roomLink.addEventListener('click', () => {
    const expanded = roomPreview.classList.toggle('is-expanded');
    roomLink.setAttribute('aria-expanded', String(expanded));
    roomLink.textContent = expanded ? '收起房间 ↑' : '查看完整房间 ›';
  });
  roomPreview.append(snapshot, roomLink);
  const overview = node('section', 'day-tab-panel day-overview-panel');
  const overviewFacts = node('section', 'day-overview-facts');
  const recordFact = node('button', '', `记录 ${entries.length}`);
  const actionFact = node('button', '', `行动 ${quests.length}`);
  recordFact.type = actionFact.type = 'button';
  overviewFacts.append(recordFact, actionFact);
  overview.append(roomPreview, statusSummary(observations, date), overviewFacts);
  const dailyReview = personalReviewSection('每日复盘', caption?.dailyReview, DAILY_REVIEW_FIELDS, () => {
    openPersonalReviewEditor('每日复盘', caption?.dailyReview, DAILY_REVIEW_FIELDS, async (values) => {
      await db.saveReview(date, 'daily', {
        progress: values.progress ?? '', takeaway: values.takeaway ?? '', problem: values.problem ?? '', tomorrowFocus: values.tomorrowFocus ?? '',
      });
    });
  });
  const dayTabs = segmentedControl('nav', 'day-section-tabs');
  dayTabs.setAttribute('aria-label', '日期回顾分段');
  const requestedView = sessionStorage.getItem('qiguang.day-view');
  const initialView = requestedView === 'records' ? 'records' : requestedView === 'actions' ? 'actions' : requestedView === 'review' ? 'review' : 'overview';
  const sectionTargets: Array<[string, string, HTMLElement]> = [['总览', 'overview', overview], ['记录', 'records', journal], ['行动', 'actions', actionResults], ['复盘', 'review', dailyReview]];
  const selectDayView = (view: string): void => {
    sectionTargets.forEach(([, key, target]) => { target.hidden = key !== view; });
    dayTabs.querySelectorAll<HTMLButtonElement>('.day-section-tab').forEach((item) => {
      const active = item.dataset.view === view;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
  };
  recordFact.addEventListener('click', () => { sessionStorage.setItem('qiguang.day-view', 'records'); selectDayView('records'); });
  actionFact.addEventListener('click', () => { sessionStorage.setItem('qiguang.day-view', 'actions'); selectDayView('actions'); });
  sectionTargets.forEach(([label, view]) => {
    const button = segmentedItem('button', label, { className: 'day-section-tab', active: view === initialView });
    button.dataset.view = view;
    button.setAttribute('aria-pressed', String(view === initialView));
    button.addEventListener('click', () => { sessionStorage.setItem('qiguang.day-view', view); selectDayView(view); });
    dayTabs.append(button);
  });
  main.append(dayTabs, overview, journal, actionResults, dailyReview);
  selectDayView(initialView);

  if (entries.length || quests.length) {
    const analysis = optionalDetails('查看当天整理', 'day-evidence-details day-analysis-details');
    analysis.append(await dailyAnalysisSection(date, entries, quests));
    main.append(analysis);
  }

  const dayNav = node('nav', 'day-navigation');
  dayNav.setAttribute('aria-label', '日期导航');
  const calendar = actionButton('返回日历', undefined);
  calendar.addEventListener('click', () => go({ name: 'calendar' }));
  dayNav.append(calendar, primaryButton('再写一篇', () => go({ name: 'record', date })));
  main.append(dayNav);
  return main;
}

function weekRange(anchor = localDate()): { start: string; end: string } {
  const safeAnchor = anchor > localDate() ? localDate() : anchor;
  const weekday = parseLocalDate(safeAnchor).getDay() || 7;
  const start = shiftDate(safeAnchor, 1 - weekday);
  const sunday = shiftDate(start, 6);
  return { start, end: sunday > localDate() ? localDate() : sunday };
}

async function weeklyReviewRequest(period: { start: string; end: string }, note: string): Promise<WeeklyReviewRequest> {
  const [events, quests, feedback, habits, habitLogs, ledger, goals, memories, reviews, observations] = await Promise.all([
    db.listJournalEvents(), db.listQuests(), db.listQuestFeedback(), db.listHabits(), db.listHabitLogs(),
    db.listXpLedger(), db.listGoals(), db.listMemories('confirmed'), db.listReviews('weekly'), db.listStateObservations(undefined, period.end),
  ]);
  const confirmedEvents = events.filter((item) => item.active && item.confirmation === 'confirmed' && item.localDate >= period.start && item.localDate <= period.end);
  const feedbackByQuest = activeFeedbackByQuest(feedback);
  const periodQuests = quests.filter((item) => {
    const resultDate = questResultDate(item, feedbackByQuest);
    return feedbackByQuest.has(item.id) && resultDate >= period.start && resultDate <= period.end && item.status !== 'pending';
  });
  const states = await Promise.all(Array.from({ length: Math.round((Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / 86_400_000) + 1 }, (_, offset) => {
    const date = shiftDate(period.start, offset);
    return db.resolvedStateAtOrBefore(date).then((values) => ({ date, values }));
  }));
  const periodEndExclusive = parseLocalDate(shiftDate(period.end, 1)).getTime();
  const existedByPeriodEnd = (timestamp: string): boolean => Date.parse(timestamp) < periodEndExclusive;
  const activeHabits = habits.filter((item) => item.status === 'active' && existedByPeriodEnd(item.createdAt));
  const proactiveMemories = memories.filter((item) => !item.reminderMuted && existedByPeriodEnd(item.confirmedAt ?? item.createdAt)).slice(0, 20);
  const momentums = await Promise.all(activeHabits.map((item) => db.habitMomentum(item.id, period.end)));
  const periodLedger = ledger.filter((item) => !item.reversedAt && item.localDate >= period.start && item.localDate <= period.end);
  const activeHabitIds = new Set(activeHabits.map((item) => item.id));
  const sourceHabitLogs = habitLogs.filter((item) => activeHabitIds.has(item.habitId) && item.localDate <= period.end);
  const activeGoals = goals.filter((item) => item.status === 'active' && existedByPeriodEnd(item.createdAt)).slice(0, 3);
  const activeExperiments = reviews.filter((item) => item.status === 'confirmed' && item.periodEnd <= period.end && item.nextExperiment.endDate >= period.start).slice(0, 4);
  const stateObservationIds = new Set(states.flatMap(({ values }) => Object.values(values).flatMap((value) => value?.observationIds ?? [])));
  const sourceObservations = observations.filter((item) => stateObservationIds.has(item.id));
  const versions = <T extends { id: string; version: number }>(items: T[]): Array<{ id: string; version: number }> => items.map(({ id, version }) => ({ id, version }));
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION, operation: 'weekly_review', requestId: crypto.randomUUID(), locale: 'zh-CN',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai', period, userInput: { note },
    context: {
      events: confirmedEvents.map((item) => ({ eventId: item.id, version: item.version, localDate: item.localDate, title: item.title, description: item.description })),
      sourceVersions: {
        quests: versions(periodQuests),
        questFeedback: versions(periodQuests.map((item) => feedbackByQuest.get(item.id)!)),
        habits: versions(activeHabits), habitLogs: versions(sourceHabitLogs),
        xpLedger: versions(periodLedger),
        goals: versions(activeGoals), reviews: versions(activeExperiments), memories: versions(proactiveMemories),
        stateObservations: versions(sourceObservations),
      },
      stateSnapshots: states.flatMap(({ date, values }) => {
        const mapped = Object.fromEntries(Object.entries(values).map(([dimension, value]) => [toContractDimension(dimension as Dimension), value.value])) as Partial<Record<ContractDimension, number>>;
        return Object.keys(mapped).length ? [{ localDate: date, values: mapped }] : [];
      }),
      taskResults: periodQuests.map((item) => ({
        questId: item.id, localDate: questResultDate(item, feedbackByQuest), title: item.title,
        result: item.status as 'completed' | 'partial' | 'skipped' | 'exempt', actual: feedbackByQuest.get(item.id)?.actual ?? '',
      })),
      habits: activeHabits.map((item, index) => ({ habitId: item.id, name: item.name, minimumAction: item.minimumAction, momentum: momentums[index] ?? 0 })),
      growth: DIMENSIONS.map((dimension) => ({
        dimension: toContractDimension(dimension.key),
        xp: periodLedger.filter((entry) => entry.dimension === dimension.key).reduce((sum, entry) => sum + entry.finalXp, 0),
      })).filter((item) => item.xp > 0),
      goals: activeGoals.map((item) => ({ goalId: item.id, result: item.result })),
      experiments: activeExperiments.map((item) => ({ reviewId: item.id, ...item.nextExperiment })),
      memories: proactiveMemories.map((item) => ({ memoryId: item.id, type: item.type, statement: item.statement })),
    },
    permissions: {
      eventIds: confirmedEvents.map((item) => item.id), includeStateSnapshots: true, includeTaskResults: true,
      includeHabits: true, includeGrowth: true, includeGoals: true, includeExperiments: true, memoryIds: proactiveMemories.map((item) => item.id),
    },
  };
}

function weeklyPreview(content: HTMLElement, request: WeeklyReviewRequest): void {
  const summary = node('section', 'analysis-preview-scope');
  summary.append(
    node('p', 'privacy-boundary', '不会发送本周日记原文。只发送下面勾选的摘要；AI 不会直接修改任何内容。'),
    node('p', '', `周期：${formatDate(request.period.start)}—${formatDate(request.period.end)}`),
    node('p', '', `已确认事件 ${request.context.events.length} 条 · 状态摘要 ${request.context.stateSnapshots.length} 天 · 任务结果 ${request.context.taskResults.length} 条`),
    node('p', '', `习惯 ${request.context.habits.length} 个 · 五维成长 ${request.context.growth.length} 项 · 目标 ${request.context.goals.length} 个 · 已记住规则 ${request.context.memories.length} 条`),
  );
  if (request.context.events.length) summary.append(node('p', 'caption', request.context.events.map((item) => `${formatDate(item.localDate)} · ${item.title}`).join('；')));
  if (request.userInput.note) summary.append(node('blockquote', 'preview-note', request.userInput.note));
  content.append(summary);
}

async function submitWeeklyReviewJob(job: AnalysisJob, resumeInterrupted = false): Promise<void> {
  if (job.operation !== 'weekly_review') throw new Error('这不是周复盘任务。');
  if (!NATIVE_AI_READY) {
    showToast(NATIVE_AI_UNAVAILABLE, 'error');
    await render();
    return;
  }
  if (!settings.aiAllowed || !navigator.onLine) {
    showToast(!settings.aiAllowed ? 'AI 权限已关闭；没有发送任何内容。' : '已保存在本机；联网后由你手动重试。', !settings.aiAllowed ? 'error' : 'normal');
    await render();
    return;
  }
  let processing: AnalysisJob;
  try { processing = await db.markAnalysisJobProcessing(job.id, resumeInterrupted ? {
    expectedVersion: job.version,
    staleBefore: new Date(Date.now() - INTERRUPTED_TAKEOVER_MS).toISOString(),
  } : undefined); } catch (error) {
    showToast(errorMessage(error), 'error'); await render(); return;
  }
  await render();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await requestAnalysis(processing.request, controller.signal);
    const body = await response.json().catch(() => null) as { error?: { code?: AnalysisErrorCode; message?: string } } | null;
    if (!response.ok) {
      const apiError = new Error(body?.error?.message || '周复盘服务暂时不可用。') as Error & { code?: AnalysisErrorCode; nextAttemptAt?: string };
      apiError.code = body?.error?.code ?? 'SERVICE_UNAVAILABLE';
      const retryAfter = Number(response.headers.get('Retry-After') ?? 0);
      if (retryAfter > 0) apiError.nextAttemptAt = new Date(Date.now() + retryAfter * 1_000).toISOString();
      throw apiError;
    }
    if (processing.operation !== 'weekly_review') throw new Error('复盘队列操作发生变化。');
    parseWeeklyReviewResponse(body, processing.request as WeeklyReviewRequest);
    await db.saveWeeklyReview(processing.id, body, processing.version);
    showToast('本周回顾建议已保存；下周重点仍等你确认。');
  } catch (error) {
    const current = (await db.listAnalysisJobs(processing.localDate)).find((item) => item.id === processing.id);
    if (current?.status === 'processing' && current.version === processing.version) {
      const typed = error as Error & { code?: AnalysisErrorCode; nextAttemptAt?: string };
      const code: AnalysisErrorCode = typed.name === 'AbortError' ? 'MODEL_TIMEOUT' : typed.code ?? (navigator.onLine ? 'SERVICE_UNAVAILABLE' : 'OFFLINE');
      await db.failAnalysisJob(processing.id, code, analysisErrorCopy(code, errorMessage(error)), typed.nextAttemptAt, processing.version);
      showToast(analysisErrorCopy(code, errorMessage(error)), 'error');
    } else if (current?.status === 'stale') showToast('本周记录已改变，旧复盘结果没有应用。', 'error');
    else showToast('同一复盘已由新的重试接管，旧结果没有应用。');
  } finally {
    window.clearTimeout(timeout);
    await render();
  }
}

async function openWeeklyReviewPreview(period: { start: string; end: string }, retryJob?: AnalysisJob): Promise<void> {
  if (!NATIVE_AI_READY) { showToast(NATIVE_AI_UNAVAILABLE, 'error'); return; }
  const { dialog, content, actions } = dialogShell(retryJob ? '检查并重试周复盘' : '生成本周复盘');
  if (retryJob) {
    if (retryJob.operation !== 'weekly_review') throw new Error('这不是周复盘任务。');
    weeklyPreview(content, retryJob.request as WeeklyReviewRequest);
    const cancel = actionButton('取消', () => dialog.close());
    const send = actionButton(navigator.onLine ? '使用同一请求重试' : '当前离线', undefined, { variant: 'primary' });
    send.disabled = !navigator.onLine;
    send.addEventListener('click', () => { dialog.close(); void submitWeeklyReviewJob(retryJob, retryJob.status === 'processing'); });
    actions.append(cancel, send); dialog.showModal(); cancel.focus(); return;
  }
  const baseRequest = await weeklyReviewRequest(period, '');
  const note = node('textarea', 'input compact-textarea');
  note.maxLength = 2_000; note.placeholder = '可选：补充这一周只有你知道的现实约束；不会读取其他原文。';
  const preview = node('div');
  const selectedRequest = (): WeeklyReviewRequest => {
    const request = structuredClone(baseRequest);
    const scope = settings.weeklyReviewScope ?? DEFAULT_WEEKLY_REVIEW_SCOPE;
    request.requestId = crypto.randomUUID();
    request.userInput.note = note.value;
    request.context.events = scope.events ? baseRequest.context.events : [];
    request.context.stateSnapshots = scope.stateSnapshots ? baseRequest.context.stateSnapshots : [];
    request.context.taskResults = scope.taskResults ? baseRequest.context.taskResults : [];
    request.context.habits = scope.habits ? baseRequest.context.habits : [];
    request.context.growth = scope.growth ? baseRequest.context.growth : [];
    request.context.goals = scope.goals ? baseRequest.context.goals : [];
    request.context.experiments = scope.experiments ? baseRequest.context.experiments : [];
    request.context.memories = scope.memories ? baseRequest.context.memories : [];
    if (request.context.sourceVersions && baseRequest.context.sourceVersions) {
      request.context.sourceVersions.stateObservations = scope.stateSnapshots ? baseRequest.context.sourceVersions.stateObservations : [];
      request.context.sourceVersions.quests = scope.taskResults ? baseRequest.context.sourceVersions.quests : [];
      request.context.sourceVersions.questFeedback = scope.taskResults ? baseRequest.context.sourceVersions.questFeedback : [];
      request.context.sourceVersions.habits = scope.habits ? baseRequest.context.sourceVersions.habits : [];
      request.context.sourceVersions.habitLogs = scope.habits ? baseRequest.context.sourceVersions.habitLogs : [];
      request.context.sourceVersions.xpLedger = scope.growth ? baseRequest.context.sourceVersions.xpLedger : [];
      request.context.sourceVersions.goals = scope.goals ? baseRequest.context.sourceVersions.goals : [];
      request.context.sourceVersions.reviews = scope.experiments ? baseRequest.context.sourceVersions.reviews : [];
      request.context.sourceVersions.memories = scope.memories ? baseRequest.context.sourceVersions.memories : [];
    }
    request.permissions = {
      eventIds: request.context.events.map((item) => item.eventId), includeStateSnapshots: scope.stateSnapshots,
      includeTaskResults: scope.taskResults, includeHabits: scope.habits, includeGrowth: scope.growth,
      includeGoals: scope.goals, includeExperiments: scope.experiments,
      memoryIds: request.context.memories.map((item) => item.memoryId),
    };
    return request;
  };
  const refresh = () => {
    preview.replaceChildren();
    weeklyPreview(preview, selectedRequest());
  };
  refresh();
  note.addEventListener('input', refresh);
  const scopeNote = node('p', 'caption', '范围已保存');
  const editScope = actionButton('调整每次周复盘默认包含的信息', undefined, { variant: 'quiet' });
  editScope.addEventListener('click', () => { dialog.close(); go({ name: 'system' }); });
  content.append(labelledControl('本周补充说明（可选）', note), scopeNote, editScope, preview);
  const cancel = actionButton('取消', () => dialog.close());
  const send = actionButton(navigator.onLine ? '确认并生成' : '当前离线', undefined, { variant: 'primary' });
  send.disabled = !navigator.onLine;
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      if (!settings.aiAllowed) {
        const allowed = await confirmAction('允许这一次 AI 周复盘？', '只发送预览中列出的已确认事实和摘要，不发送整周日记原文。', '允许并继续');
        if (!allowed) { send.disabled = false; return; }
        settings = await db.saveSettings({ aiAllowed: true, previewBeforeSend: true });
      }
      const job = await db.createWeeklyReviewJob(selectedRequest());
      dialog.close();
      await submitWeeklyReviewJob(job);
    } catch (error) { send.disabled = false; showToast(errorMessage(error), 'error'); }
  });
  actions.append(cancel, send); dialog.showModal(); cancel.focus();
}

async function openReviewConfirmation(review: Review): Promise<void> {
  const { dialog, content, actions } = dialogShell('确认下周重点和小尝试', { back: true, fullScreen: true });
  const theme = node('input', 'input'); theme.maxLength = 120; theme.value = review.nextTheme;
  const hypothesis = node('textarea', 'input compact-textarea'); hypothesis.maxLength = 500; hypothesis.value = review.nextExperiment.hypothesis;
  const minimum = node('textarea', 'input compact-textarea'); minimum.maxLength = 300; minimum.value = review.nextExperiment.minimumAction;
  const metric = node('textarea', 'input compact-textarea'); metric.maxLength = 300; metric.value = review.nextExperiment.metric;
  const earliestEndDate = [shiftDate(review.periodEnd, 1), localDate()].sort().at(-1)!;
  const endDate = node('input', 'input'); endDate.type = 'date'; endDate.min = earliestEndDate; endDate.value = review.nextExperiment.endDate < earliestEndDate ? earliestEndDate : review.nextExperiment.endDate;
  const stop = node('textarea', 'input compact-textarea'); stop.maxLength = 300; stop.value = review.nextExperiment.stopCondition;
  const status = statusMessage();
  content.append(labelledControl('下周重点', theme), labelledControl('一个小尝试', hypothesis), labelledControl('先从哪一步开始', minimum), labelledControl('怎样判断有没有效果', metric), labelledControl('结束日期', endDate), labelledControl('什么时候停止', stop), status);
  const cancel = actionButton('取消', () => dialog.close());
  const confirm = actionButton('由我确认', undefined, { variant: 'primary' });
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      const result = await db.confirmWeeklyReview(review.id, theme.value, { hypothesis: hypothesis.value, minimumAction: minimum.value, metric: metric.value, endDate: endDate.value, stopCondition: stop.value });
      dialog.close(); showToast(result.questScheduled ? '周复盘已确认，周实验行动已排入原定日期。' : '周复盘已确认；周实验行动仅保留为建议，没有覆盖已有安排。'); await render();
    } catch (error) { confirm.disabled = false; status.textContent = errorMessage(error); status.classList.add('is-error'); }
  });
  actions.append(cancel, confirm); dialog.showModal(); theme.focus();
}

async function weeklyReviewPage(anchor: string): Promise<HTMLElement> {
  const period = weekRange(anchor);
  const [reviews, jobs, habits, allQuests, feedbacks, entries, caption] = await Promise.all([
    db.listReviews('weekly'), db.listAnalysisJobs(period.end), db.listHabits(), db.listQuests(), db.listQuestFeedback(), db.listEntries(), db.getDayCaption(period.start),
  ]);
  const feedbackByQuest = activeFeedbackByQuest(feedbacks);
  const periodQuests = allQuests.filter((quest) => {
    const resultDate = questResultDate(quest, feedbackByQuest);
    return feedbackByQuest.has(quest.id) && resultDate >= period.start && resultDate <= period.end && quest.status !== 'pending';
  });
  const review = reviews.find((item) => item.periodStart === period.start && item.periodEnd === period.end);
  const job = jobs.filter((item) => item.operation === 'weekly_review' && (item.request as WeeklyReviewRequest).period.start === period.start)[0];
  const main = node('main', 'page page-review');
  main.append(pageHeader('本周'));
  main.append(trailTabs('review'));
  const nav = periodNavigator(`${formatDate(period.start, { weekday: undefined })} - ${formatDate(period.end, { weekday: undefined })}`, {
    ariaLabel: '周复盘周期',
    className: 'review-period-nav',
    previousLabel: '上一周',
    nextLabel: '下一周',
    onPrevious: () => go({ name: 'review', date: shiftDate(period.start, -7) }),
    onNext: () => go({ name: 'review', date: shiftDate(period.start, 7) }),
    nextDisabled: shiftDate(period.start, 7) > localDate(),
  });
  main.append(nav);
  const weekEntries = entries.filter((entry) => entry.localDate >= period.start && entry.localDate <= period.end);
  const completedTasks = periodQuests.filter((quest) => quest.status === 'completed' || quest.status === 'partial').length;
  const habitChecks = periodQuests.filter((quest) => quest.sourceType === 'habit' && (quest.status === 'completed' || quest.status === 'partial')).length;
  const summary = node('section', 'review-summary-card');
  const summaryStats = metricGroup([
    ['完成任务', String(completedTasks)],
    ['习惯打卡', String(habitChecks)],
    ['记录', String(weekEntries.length)],
  ], { className: 'review-summary-stats', valueFirst: true });
  summary.append(summaryStats);
  main.append(summary);
  main.append(personalReviewSection('我的周复盘', caption?.weeklyReview, WEEKLY_REVIEW_FIELDS, () => {
    openPersonalReviewEditor('周复盘', caption?.weeklyReview, WEEKLY_REVIEW_FIELDS, async (values) => {
      await db.saveReview(period.start, 'weekly', {
        progress: values.progress ?? '', assets: values.assets ?? '', biggestProgress: values.biggestProgress ?? '', biggestWaste: values.biggestWaste ?? '',
        stopOrReduce: values.stopOrReduce ?? '', nextFocus: values.nextFocus ?? '',
      });
    });
  }));
  if (!review) {
    const intro = listSection('生成本周复盘', { className: 'surface review-intro' });
    if (!NATIVE_AI_READY) intro.append(node('p', '', 'AI 未配置'));
    else if (job?.status === 'processing') {
      const state = node('div', 'analysis-job-state is-running');
      state.append(
        node('p', '', '正在生成；可以离开本页。其他 AI 整理任务也可能仍在处理。'),
        interruptedRetryButton(job, () => { void openWeeklyReviewPreview(period, job); }),
      );
      intro.append(state);
    }
    else if (job && ['queued', 'failed'].includes(job.status)) intro.append(primaryButton(job.status === 'failed' ? '检查范围并重试' : '继续这次复盘', () => { void openWeeklyReviewPreview(period, job); }));
    else intro.append(primaryButton('检查范围并生成', () => { void openWeeklyReviewPreview(period); }));
    main.append(intro);
    return main;
  }

  let editNextPlan: HTMLButtonElement | undefined;
  if (review.status === 'candidate') {
    editNextPlan = textAction('修改', () => { void openReviewConfirmation(review); });
    editNextPlan.setAttribute('aria-label', '修改下周建议');
  }
  const planList = listGroup('review-next-plan-list');
  const focus = listRow('div', 'ui-info-row is-multiline review-next-plan-item');
  const focusCopy = node('span', 'ui-navigation-copy');
  focusCopy.append(node('strong', '', '下周重点'), node('span', 'review-next-plan-value', review.nextTheme));
  focus.append(focusCopy);
  const proposedExperiment = listRow('div', 'ui-info-row is-multiline review-next-plan-item');
  const experimentCopy = node('span', 'ui-navigation-copy');
  experimentCopy.append(
    node('strong', '', '小尝试'),
    node('span', 'review-next-plan-value', review.nextExperiment.hypothesis),
    node('span', 'caption', `判断有没有效果：${review.nextExperiment.metric}`),
  );
  proposedExperiment.append(experimentCopy);
  planList.append(focus, proposedExperiment);
  const nextPlan = listSection('下周建议', {
    className: 'review-next-plan',
    headingClassName: 'review-next-plan-header',
    tail: editNextPlan,
  }, planList);
  main.append(nextPlan);

  const adjustments = node('section', 'review-adjustments');
  const adjustmentIcon = node('span', 'review-section-icon is-adjust');
  adjustmentIcon.append(semanticIcon('rules'));
  adjustments.append(adjustmentIcon, sectionHeading('会调整什么'));
  const adjustmentList = node('ul', 'review-adjustment-list');
  const decisions = review.habitDecisions.slice(0, 2).map((item) => {
    const habitName = habits.find((habit) => habit.id === item.habitId)?.name ?? '当前习惯';
    const action = ({ keep: '保留', lower_difficulty: '降低难度', change_trigger: '调整触发方式', pause: '暂停', stop: '停止' } as const)[item.action];
    return `${action}${habitName}`;
  });
  const adjustmentCopy = decisions.length ? decisions : ['保留当前有效习惯', '下周任务减少一个'];
  adjustmentCopy.forEach((item) => adjustmentList.append(node('li', '', item)));
  adjustments.append(adjustmentList);
  main.append(adjustments);

  if (review.status === 'candidate') {
    const decisionActions = node('section', 'review-decision-actions');
    const adopt = primaryButton('采用下周计划', async () => {
      adopt.disabled = true;
      try {
        const result = await db.confirmWeeklyReview(review.id, review.nextTheme, review.nextExperiment);
        showToast(result.questScheduled ? '下周计划已采用，第一步已排入计划。' : '下周计划已采用；没有覆盖现有安排。');
        await render();
      } catch (error) { adopt.disabled = false; showToast(errorMessage(error), 'error'); }
    });
    const quiet = node('div', 'review-quiet-actions');
    const recheck = actionButton('重新检查本周', undefined, { variant: 'quiet' });
    recheck.addEventListener('click', () => { void openWeeklyReviewPreview(period); });
    const reject = actionButton('暂不采用', undefined, { variant: 'quiet' });
    reject.addEventListener('click', async () => {
      if (!await confirmAction('暂不采用这份建议？', '不会扣分，也不会新增任务。之后仍可重新生成。', '暂不采用')) return;
      try { await db.rejectWeeklyReview(review.id); showToast('已暂不采用；没有修改计划。'); await render(); }
      catch (error) { showToast(errorMessage(error), 'error'); }
    });
    quiet.append(recheck, reject);
    decisionActions.append(adopt, quiet);
    main.append(decisionActions);
  } else {
    main.append(node('p', 'review-final-state', review.status === 'confirmed' ? '下周计划已采用' : '这份建议已暂不采用'));
  }
  return main;

}

function entityVersionFingerprint(items: Array<{ id: string; version: number }>): string {
  return items.map((item) => `${item.id}@${item.version}`).sort().join('|');
}

async function requestGoalDecomposition(
  values: { result: string; why: string; evidence: string; targetDate?: string },
  memories: SystemMemory[],
  executionEvidence: GoalDecompositionRequest['context']['executionEvidence'] = [],
  currentGoals: GoalDecompositionRequest['context']['currentGoals'] = [],
): Promise<GoalDecompositionResult | null> {
  if (!NATIVE_AI_READY) { showToast(NATIVE_AI_UNAVAILABLE, 'error'); return null; }
  const { dialog, content, actions } = dialogShell('检查目标拆解发送范围');
  content.append(node('p', 'privacy-boundary', 'AI 只会读取下面勾选的内容，生成后仍由你确认。'));
  const scope = node('div', 'analysis-preview-scope');
  scope.append(
    node('p', '', `目标：${values.result}`),
    ...(values.targetDate ? [node('p', '', `完成日期：${formatDate(values.targetDate)}`)] : []),
  );
  const memoryRows = memories.slice(0, 20).map((memory) => {
    const row = previewContextRow(`${memory.reminderMuted ? '已掌握 · 默认不发送' : '已保存'} · ${MEMORY_TYPE_LABELS[memory.type]}`, memory.statement, !memory.reminderMuted);
    scope.append(row.label);
    return { memory, input: row.input };
  });
  const executionRows = executionEvidence.slice(0, 20).map((evidence) => {
    const row = previewContextRow(`执行记录 · ${evidence.result}`, `${evidence.completedDate} · ${evidence.title}${evidence.actual ? ` · ${evidence.actual}` : ''}`, true);
    scope.append(row.label);
    return { evidence, input: row.input };
  });
  const goalRows = currentGoals.slice(0, 3).map((goal) => {
    const row = previewContextRow('其他进行中目标', goal.result, true);
    scope.append(row.label);
    return { goal, input: row.input };
  });
  if (!memoryRows.length) scope.append(node('p', 'caption', '未选记忆'));
  const status = statusMessage();
  status.setAttribute('role', 'status');
  content.append(scope, status);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: GoalDecompositionResult | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
      dialog.close();
    };
    const cancel = actionButton('返回修改', () => finish(null));
    dialog.addEventListener('cancel', () => finish(null), { once: true });
    const send = actionButton(navigator.onLine ? '确认范围并生成草案' : '当前离线', undefined, { variant: 'primary' });
    send.disabled = !navigator.onLine;
    send.addEventListener('click', async () => {
      send.disabled = true;
      try {
        if (!settings.aiAllowed) {
          const allowed = await confirmAction('允许这一次目标拆解？', '只发送当前预览中的内容；服务端密钥不会进入设备。', '允许并继续');
          if (!allowed) { send.disabled = false; return; }
          settings = await db.saveSettings({ aiAllowed: true, previewBeforeSend: true });
        }
        const selected = memoryRows.filter((item) => item.input.checked).map((item) => item.memory);
        const selectedExecution = executionRows.filter((item) => item.input.checked).map((item) => item.evidence);
        const selectedGoals = goalRows.filter((item) => item.input.checked).map((item) => item.goal);
        const request: GoalDecompositionRequest = {
          contractVersion: ANALYSIS_CONTRACT_VERSION,
          operation: 'goal_decomposition',
          requestId: crypto.randomUUID(),
          locale: 'zh-CN',
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
          userInput: { result: values.result, why: values.why, completionEvidence: values.evidence, targetDate: values.targetDate ?? null },
          context: {
            currentGoals: selectedGoals,
            executionEvidence: selectedExecution,
            memories: selected.map((memory) => ({ memoryId: memory.id, type: memory.type, statement: memory.statement })),
          },
          permissions: {
            memoryIds: selected.map((memory) => memory.id), questIds: selectedExecution.map((item) => item.questId), goalIds: selectedGoals.map((item) => item.goalId),
          },
        };
        status.textContent = '正在生成可编辑草案…';
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 50_000);
        let response: Response;
        try {
          response = await requestAnalysis(request, controller.signal);
        } finally { window.clearTimeout(timeout); }
        const body = await response.json().catch(() => null) as unknown;
        if (!response.ok) throw new Error((body as { error?: { message?: string } } | null)?.error?.message || '目标拆解服务暂时不可用。');
        finish(parseGoalDecompositionResponse(body, request).result);
      } catch (error) {
        send.disabled = !navigator.onLine;
        status.textContent = error instanceof DOMException && error.name === 'AbortError' ? '生成超时；目标草稿没有丢失。' : errorMessage(error);
        status.classList.add('is-error');
      }
    });
    actions.append(cancel, send);
    dialog.showModal();
    cancel.focus();
  });
}

async function openGoalDialog(): Promise<void> {
  const [memories, goals] = await Promise.all([db.listMemories('confirmed'), db.listGoals()]);
  const { dialog, content, actions } = dialogShell('新建目标', { back: true, className: 'ui-rebuilt-page ui-form-page ui-goal-page', fullScreen: true });
  const result = node('input', 'input');
  result.maxLength = 160;
  result.placeholder = '例如：完成毕业论文';
  const targetDate = node('input', 'input');
  targetDate.type = 'date';
  targetDate.min = localDate();
  targetDate.value = shiftDate(localDate(), 30);
  const editorDraftKey = 'qiguang.goal-editor-draft';
  try {
    const draft = JSON.parse(localStorage.getItem(editorDraftKey) ?? 'null') as Record<string, string> | null;
    if (draft) {
      result.value = draft.result ?? '';
      if (draft.targetDate && draft.targetDate >= localDate()) targetDate.value = draft.targetDate;
    }
  } catch { /* The editor remains usable if its local draft is damaged. */ }
  const persistEditorDraft = () => {
    try { localStorage.setItem(editorDraftKey, JSON.stringify({ result: result.value, targetDate: targetDate.value })); }
    catch { /* Local draft failure must not block goal creation. */ }
  };
  [result, targetDate].forEach((control) => {
    control.addEventListener('input', persistEditorDraft);
    control.addEventListener('change', persistEditorDraft);
  });
  const status = statusMessage();
  const assistant = node('section', 'ui-goal-assistant');
  const decompose = actionButton(!NATIVE_AI_READY ? 'AI 未配置' : navigator.onLine ? 'AI 帮我拆成子任务' : '联网后可使用 AI', undefined);
  decompose.disabled = !navigator.onLine || !NATIVE_AI_READY;
  assistant.append(decompose);
  const plan = node('section', 'goal-plan-editor');
  plan.hidden = true;
  let milestoneEditors: Array<{
    enabled: HTMLInputElement;
    title: HTMLInputElement;
    evidence: string;
    date: HTMLInputElement;
    reminder: HTMLInputElement;
    dimension: HTMLSelectElement;
    difficulty: HTMLSelectElement;
  }> = [];
  let decompositionFingerprint: string | null = null;
  const draftFingerprint = (): string => JSON.stringify({ result: result.value.trim(), targetDate: targetDate.value });
  const invalidateDecomposition = () => {
    if (!decompositionFingerprint || draftFingerprint() === decompositionFingerprint) return;
    decompositionFingerprint = null;
    milestoneEditors = [];
    plan.replaceChildren();
    plan.hidden = true;
    status.textContent = '目标或日期已改变，请重新拆分。';
  };
  const showPlan = (draft: GoalDecompositionResult) => {
    decompositionFingerprint = draftFingerprint();
    plan.hidden = false;
    plan.replaceChildren(sectionHeading('子任务', { level: 'h3' }));
    milestoneEditors = draft.milestones.map((milestone, index) => {
      const card = node('article', 'ui-panel goal-plan-step goal-stage-editor');
      const enabled = node('input');
      enabled.type = 'checkbox'; enabled.checked = true;
      const titleInput = node('input', 'input');
      titleInput.maxLength = 160; titleInput.value = milestone.title; titleInput.required = true;
      const stageDate = node('input', 'input');
      stageDate.type = 'date'; stageDate.min = localDate(); stageDate.value = distributedStageDate(index, draft.milestones.length, targetDate.value); stageDate.required = true;
      const reminder = node('input', 'input'); reminder.type = 'time';
      const dimension = taskDimensionSelect(fromContractDimension(milestone.dimension));
      const difficulty = taskDifficultySelect(milestone.difficulty);
      const toggle = node('label', 'goal-stage-toggle');
      toggle.append(enabled, node('span', '', `子任务 ${index + 1}`));
      card.append(
        toggle,
        labelledControl('任务名称', titleInput),
        labelledControl('日期', stageDate),
        labelledControl('提醒时间（应用内，可选）', reminder),
        labelledControl('五维状态', dimension),
        labelledControl('难度', difficulty),
      );
      plan.append(card);
      return { enabled, title: titleInput, evidence: milestone.evidence, date: stageDate, reminder, dimension, difficulty };
    });
  };
  decompose.addEventListener('click', async () => {
    status.classList.remove('is-error');
    if (!result.value.trim() || !isLocalDate(targetDate.value)) {
      status.textContent = '先填写目标名称和完成日期。';
      status.classList.add('is-error');
      (!result.value.trim() ? result : targetDate).focus();
      return;
    }
    const requestFingerprint = draftFingerprint();
    const sourceFingerprint = `${entityVersionFingerprint(goals)}#${entityVersionFingerprint(memories)}`;
    decompose.disabled = true;
    const currentGoals = goals.filter((item) => item.status === 'active')
      .map((item) => ({ goalId: item.id, result: item.result }));
    const draft = await requestGoalDecomposition({ result: result.value, why: '', evidence: '', targetDate: targetDate.value }, memories, [], currentGoals);
    decompose.disabled = !navigator.onLine || !NATIVE_AI_READY;
    const [latestGoals, latestMemories] = draft ? await Promise.all([db.listGoals(), db.listMemories('confirmed')]) : [[], []];
    const sourceStillCurrent = sourceFingerprint === `${entityVersionFingerprint(latestGoals)}#${entityVersionFingerprint(latestMemories)}`;
    if (draft && draftFingerprint() === requestFingerprint && sourceStillCurrent) {
      showPlan(draft); status.textContent = '可以直接修改这些子任务。';
    } else if (draft) {
      status.textContent = sourceStillCurrent ? '目标内容已改变，旧拆解没有应用；请重新生成。' : '目标或已保存的信息已经改变；旧拆解没有应用，请重新生成。';
      status.classList.add('is-error');
    }
  });
  [result, targetDate].forEach((control) => {
    control.addEventListener('input', invalidateDecomposition);
    control.addEventListener('change', invalidateDecomposition);
  });
  const fields = formStack();
  fields.append(
    labelledControl('目标名称', result),
    labelledControl('完成日期', targetDate),
  );
  content.append(fields, assistant, plan, status);
  const saveGoal = async (trigger: HTMLButtonElement): Promise<void> => {
    trigger.disabled = true;
    try {
      if (!result.value.trim() || !isLocalDate(targetDate.value)) throw new Error('请填写目标名称和完成日期。');
      const selectedStages = milestoneEditors.filter((item) => item.enabled.checked);
      await db.addGoalWithStages({
        result: result.value,
        why: '',
        evidence: '',
        nextStep: selectedStages[0]?.title.value.trim() || '添加第一个子任务',
        startDate: localDate(),
        targetDate: targetDate.value,
      }, selectedStages.map((editor) => ({
        title: editor.title.value,
        evidence: editor.evidence,
        localDate: editor.date.value,
        deadlineAt: taskReminderAt(editor.date.value, editor.reminder.value),
        dimension: editor.dimension.value as Dimension,
        difficulty: editor.difficulty.value as Difficulty,
        aiSuggested: true,
      })));
      dialog.close();
      localStorage.removeItem(editorDraftKey);
      showToast(selectedStages.length ? '目标和子任务已保存。' : '目标已保存，可以继续添加子任务。');
      await render();
    } catch (error) {
      trigger.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  };
  const saveOnly = actionButton('保存目标', undefined, { variant: 'primary' });
  saveOnly.addEventListener('click', () => { void saveGoal(saveOnly); });
  actions.append(saveOnly);
  dialog.showModal();
}

async function openGoalSettingsDialog(goal: Goal): Promise<void> {
  const { dialog, content, actions } = dialogShell('编辑目标', { back: true, className: 'goal-editor-dialog', fullScreen: true });
  const result = node('input', 'input');
  result.maxLength = 160;
  result.value = goal.result;
  const targetDate = node('input', 'input');
  targetDate.type = 'date';
  targetDate.min = localDate();
  targetDate.value = goal.targetDate ?? localDate();
  const goalStatus = node('select', 'input');
  goalStatus.append(
    selectOption('idea', '待开始', goal.status === 'idea'),
    selectOption('active', '进行中', goal.status === 'active'),
    selectOption('paused', '已暂停', goal.status === 'paused'),
    selectOption('completed', '已完成', goal.status === 'completed'),
  );
  const status = statusMessage();
  content.append(
    labelledControl('目标名称', result),
    labelledControl('完成日期', targetDate),
    labelledControl('目标状态', goalStatus),
    status,
  );
  const cancel = actionButton('取消', () => dialog.close(), { variant: 'quiet' });
  const save = actionButton('保存目标', undefined, { variant: 'primary' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const nextStatus = goalStatus.value as Goal['status'];
      if (nextStatus === 'completed' && goal.status !== 'completed') {
        const confirmed = await confirmAction('确认目标已完成？', '确认后会保存完成日期，并停止这个目标尚未执行的任务。', '确认完成');
        if (!confirmed) { save.disabled = false; return; }
      }
      const achievementsBefore = await growthBadgeIds();
      await db.saveGoal(goal.id, {
        result: result.value,
        targetDate: targetDate.value,
        status: nextStatus,
      });
      dialog.close();
      await render();
      await announceNewGrowthBadge(achievementsBefore, nextStatus === 'completed' ? '目标已完成。' : '目标已更新。', nextStatus === 'completed');
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, save);
  dialog.showModal();
  result.focus();
}

async function openGoalReplanDialog(goal: Goal): Promise<void> {
  const [memories, goals, quests, feedback] = await Promise.all([
    db.listMemories('confirmed'), db.listGoals(), db.listQuests(), db.listQuestFeedback(),
  ]);
  const sourceFingerprint = (sourceGoals: Goal[], sourceMemories: SystemMemory[], sourceQuests: Quest[], sourceFeedback: QuestFeedback[]): string => {
    const relatedQuests = sourceQuests.filter((item) => item.sourceType === 'goal' && item.sourceId === goal.id);
    const relatedQuestIds = new Set(relatedQuests.map((item) => item.id));
    return [
      entityVersionFingerprint(sourceGoals), entityVersionFingerprint(sourceMemories), entityVersionFingerprint(relatedQuests),
      entityVersionFingerprint(sourceFeedback.filter((item) => relatedQuestIds.has(item.questId))),
    ].join('#');
  };
  const requestedSourceFingerprint = sourceFingerprint(goals, memories, quests, feedback);
  const sourceStillCurrent = async (): Promise<boolean> => {
    const [latestGoals, latestMemories, latestQuests, latestFeedback] = await Promise.all([
      db.listGoals(), db.listMemories('confirmed'), db.listQuests(), db.listQuestFeedback(),
    ]);
    return requestedSourceFingerprint === sourceFingerprint(latestGoals, latestMemories, latestQuests, latestFeedback);
  };
  const questById = new Map(quests.filter((item) => item.sourceType === 'goal' && item.sourceId === goal.id).map((item) => [item.id, item]));
  const executionEvidence: GoalDecompositionRequest['context']['executionEvidence'] = feedback
    .filter((item) => !item.undoneAt && questById.has(item.questId))
    .slice(0, 20)
    .map((item) => {
      const quest = questById.get(item.questId)!;
      return { questId: quest.id, title: quest.title, result: item.result, actual: item.actual || item.note, completedDate: item.completedDate ?? quest.localDate };
    });
  if (!executionEvidence.length) { showToast('先对这个目标的行动留下至少一次反馈，再根据进展重新规划。'); return; }
  const currentGoals = goals.filter((item) => item.id !== goal.id && item.status === 'active')
    .map((item) => ({ goalId: item.id, result: item.result }));
  const draft = await requestGoalDecomposition({ result: goal.result, why: goal.why, evidence: goal.evidence, targetDate: goal.targetDate }, memories, executionEvidence, currentGoals);
  if (!draft) return;
  if (!await sourceStillCurrent()) { showToast('目标、执行记录或已保存的信息已经改变；旧拆解没有应用，请重新生成。', 'error'); return; }

  const { dialog, content, actions } = dialogShell('重新规划子任务');
  const result = node('input', 'input'); result.maxLength = 160; result.value = draft.refinedResult;
  content.append(labelledControl('目标名称', result));
  const editors = draft.milestones.map((milestone, index) => {
    const enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = true;
    const title = node('input', 'input'); title.maxLength = 160; title.value = milestone.title;
    const date = node('input', 'input');
    date.type = 'date'; date.min = localDate(); date.value = distributedStageDate(index, draft.milestones.length, goal.targetDate ?? shiftDate(localDate(), 30));
    const reminder = node('input', 'input'); reminder.type = 'time';
    const dimension = taskDimensionSelect(fromContractDimension(milestone.dimension));
    const difficulty = taskDifficultySelect(milestone.difficulty);
    const card = node('article', 'ui-panel goal-plan-step goal-stage-editor');
    const toggle = node('label', 'goal-stage-toggle'); toggle.append(enabled, node('span', '', `子任务 ${index + 1}`));
    card.append(
      toggle,
      labelledControl('任务名称', title),
      labelledControl('日期', date),
      labelledControl('提醒时间（应用内，可选）', reminder),
      labelledControl('五维状态', dimension),
      labelledControl('难度', difficulty),
    );
    content.append(card);
    return { enabled, title, date, reminder, dimension, difficulty, evidence: milestone.evidence };
  });
  const status = statusMessage(); status.setAttribute('role', 'status'); content.append(status);
  const cancel = actionButton('取消', () => dialog.close());
  const confirm = actionButton('保存新计划', undefined, { variant: 'primary' });
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      if (!await sourceStillCurrent()) throw new Error('目标、执行记录或已保存的信息已经改变，请重新生成拆解草案。');
      const replacements = editors.filter((item) => item.enabled.checked).map((item) => ({
        description: item.title.value,
        evidence: item.evidence,
        localDate: item.date.value,
        deadlineAt: taskReminderAt(item.date.value, item.reminder.value),
        dimension: item.dimension.value as Dimension,
        difficulty: item.difficulty.value as Difficulty,
      }));
      if (!replacements.length) throw new Error('至少保留一个子任务。');
      await db.replaceGoalPlan(goal.id, {
        result: result.value,
        evidence: draft.completionEvidence,
        nextStep: replacements[0]!.description,
      }, replacements, goal.version);
      dialog.close();
      showToast('新计划已保存。');
      await render();
    } catch (error) {
      confirm.disabled = false; status.textContent = errorMessage(error); status.classList.add('is-error');
    }
  });
  actions.append(cancel, confirm); dialog.showModal(); result.focus();
}

async function openMilestoneDialog(goal: Goal): Promise<void> {
  const { dialog, content, actions } = dialogShell('添加子任务', { back: true, className: 'task-editor-dialog', fullScreen: true });
  const title = node('input', 'input');
  title.maxLength = 160;
  const date = node('input', 'input');
  date.type = 'date';
  date.min = localDate();
  date.value = goal.targetDate && goal.targetDate >= localDate() ? goal.targetDate : localDate();
  const reminder = node('input', 'input'); reminder.type = 'time';
  const dimension = taskDimensionSelect();
  const difficulty = taskDifficultySelect();
  const status = statusMessage();
  content.append(
    labelledControl('子任务名称', title),
    labelledControl('完成日期', date),
    labelledControl('提醒时间（应用内，可选）', reminder),
    labelledControl('五维状态', dimension),
    labelledControl('难度', difficulty),
    status,
  );
  const cancel = actionButton('取消', () => dialog.close());
  const save = actionButton('添加', undefined, { variant: 'primary' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await db.addGoalStageTask(goal.id, {
        title: title.value,
        localDate: date.value,
        deadlineAt: taskReminderAt(date.value, reminder.value),
        dimension: dimension.value as Dimension,
        difficulty: difficulty.value as Difficulty,
      });
      dialog.close();
      showToast(`子任务已安排到${date.value === localDate() ? '今天' : formatDate(date.value)}。`);
      await render();
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, save);
  dialog.showModal();
  title.focus();
}

async function openQuestDialog(goal?: Goal, suggestedTitle = ''): Promise<void> {
  const { dialog, content, actions } = dialogShell(goal ? '安排目标下一步' : '安排每日任务', { back: true, className: 'task-editor-dialog', fullScreen: true });
  const title = node('input', 'input');
  title.maxLength = 160;
  title.value = suggestedTitle || goal?.nextStep || '';
  const date = node('input', 'input');
  date.type = 'date';
  date.min = localDate();
  date.value = localDate();
  const reminder = node('input', 'input'); reminder.type = 'time';
  const dimension = taskDimensionSelect();
  const difficulty = taskDifficultySelect();
  const status = statusMessage();
  content.append(
    labelledControl('任务名称', title),
    labelledControl('安排日期', date),
    labelledControl('提醒时间（应用内，可选）', reminder),
    labelledControl('五维状态', dimension),
    labelledControl('难度', difficulty),
    status,
  );
  const cancel = actionButton('取消', () => dialog.close());
  const save = actionButton('安排任务', undefined, { variant: 'primary' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await db.addQuest({
        localDate: date.value,
        sourceType: goal ? 'goal' : 'manual',
        sourceId: goal?.id,
        title: title.value,
        reason: goal ? `来自目标“${goal.result}”。` : '用户安排的任务。',
        difficulty: difficulty.value as Difficulty,
        dimension: dimension.value as Dimension,
        deadlineAt: taskReminderAt(date.value, reminder.value),
      });
      dialog.close();
      showToast(`任务已安排到${date.value === localDate() ? '今天' : formatDate(date.value)}。`);
      await render();
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, save);
  dialog.showModal();
  title.focus();
}

async function openHabitDialog(habit?: Habit): Promise<void> {
  const { dialog, content, actions } = dialogShell(habit ? '编辑习惯' : '新建习惯', { back: true, className: 'habit-editor-dialog', fullScreen: true });
  const name = node('input', 'input');
  name.type = 'search';
  name.maxLength = 60;
  name.value = habit?.name ?? '';
  const minimum = node('input', 'input');
  minimum.type = 'search';
  minimum.maxLength = 160;
  minimum.placeholder = '例如：穿鞋出门走 5 分钟';
  minimum.value = habit?.minimumAction ?? '';
  const completionMode = node('select', 'input');
  completionMode.append(selectOption('once', '完成一次', !habit?.targetCount && !habit?.weeklyTarget), selectOption('count', '每日计数', Boolean(habit?.targetCount)), selectOption('weekly', '每周次数', Boolean(habit?.weeklyTarget)));
  completionMode.hidden = true;
  const completionChoices = choiceGroup('habit-completion-choices');
  const completionChoiceLabels = { once: '一次', count: '每天', weekly: '每周' } as const;
  for (const option of [...completionMode.options]) {
    const button = choiceRow(completionChoiceLabels[option.value as keyof typeof completionChoiceLabels], {
      className: 'habit-completion-choice',
      selected: option.selected,
      value: option.value,
      onSelect: () => { completionMode.value = option.value; completionMode.dispatchEvent(new Event('change')); },
    });
    completionChoices.append(button);
  }
  const targetCount = node('input', 'input');
  targetCount.type = 'number'; targetCount.min = habit?.weeklyTarget ? '1' : '2'; targetCount.max = '1000'; targetCount.value = String(habit?.weeklyTarget ?? habit?.targetCount ?? 8);
  const countUnit = node('input', 'input');
  countUnit.maxLength = 20; countUnit.value = habit?.countUnit ?? '次';
  const countFields = node('div', 'count-task-fields');
  const targetLabel = labelledControl(habit?.weeklyTarget ? '每周打卡次数' : '每日打卡次数', targetCount);
  countFields.append(targetLabel, labelledControl('单位', countUnit));
  const trigger = node('select', 'input');
  const triggerValue = habit?.trigger ?? '';
  const triggerOptions = ['晚饭后', '起床后', '放学后', '完成晚间洗漱后', '睡前'];
  trigger.append(selectOption('', '选择触发方式', !triggerValue));
  if (triggerValue && !triggerOptions.includes(triggerValue)) trigger.append(selectOption(triggerValue, triggerValue, true));
  triggerOptions.forEach((value) => trigger.append(selectOption(value, value, triggerValue === value)));
  const schedule = node('fieldset', 'weekday-picker');
  schedule.append(node('legend', 'field-label', '重复'));
  ['一', '二', '三', '四', '五', '六', '日'].forEach((labelText, index) => {
    const label = node('label', 'weekday-option');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(index + 1);
    checkbox.setAttribute('aria-label', `周${labelText}`);
    checkbox.checked = habit ? habit.scheduleDays.includes(index + 1) : index < 5;
    label.append(checkbox, node('span', '', labelText));
    schedule.append(label);
  });
  const updateCompletionMode = () => {
    const weekly = completionMode.value === 'weekly';
    countFields.hidden = completionMode.value === 'once';
    schedule.hidden = weekly;
    countUnit.disabled = weekly;
    targetCount.min = weekly ? '1' : '2';
    targetLabel.firstChild!.textContent = weekly ? '每周打卡次数' : '每日打卡次数';
    completionChoices.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === completionMode.value)));
  };
  completionMode.addEventListener('change', updateCompletionMode);
  const dimension = taskDimensionSelect(habit?.dimension ?? 'progress');
  const difficulty = taskDifficultySelect(habit?.difficulty ?? 'standard');
  const habitStatus = node('select', 'input');
  habitStatus.append(
    selectOption('active', '进行中', (habit?.status ?? 'active') === 'active'),
    selectOption('paused', '已暂停', habit?.status === 'paused'),
    selectOption('ended', '已结束', habit?.status === 'ended'),
  );
  const bonusLabel = listRow('label', 'ui-control-row');
  const bonus = node('input');
  bonus.type = 'checkbox';
  bonus.checked = habit?.bonusEnabled ?? true;
  const bonusCopy = node('span', 'habit-bonus-copy');
  bonusCopy.append(node('strong', '', '按计划日加入今日任务'), node('span', 'caption', '到计划日会出现在今天，可直接打卡。'));
  bonusLabel.append(bonusCopy, bonus);
  const editorDraftState = node('span', 'editor-draft-state', habit ? '' : '草稿会自动保存');
  const editorDraftKey = 'qiguang.habit-editor-draft';
  if (!habit) {
    try {
      const draft = JSON.parse(localStorage.getItem(editorDraftKey) ?? 'null') as Record<string, string> | null;
      if (draft) {
        name.value = draft.name ?? '';
        minimum.value = draft.minimum ?? '';
        const savedTrigger = draft.trigger ?? '';
        if (savedTrigger && ![...trigger.options].some((item) => item.value === savedTrigger)) trigger.append(selectOption(savedTrigger, savedTrigger));
        trigger.value = savedTrigger;
        const dimensionValue = draft.dimension ?? '';
        const difficultyValue = draft.difficulty ?? '';
        const statusValue = draft.status ?? '';
        if ([...dimension.options].some((item) => item.value === dimensionValue)) dimension.value = dimensionValue;
        if ([...difficulty.options].some((item) => item.value === difficultyValue)) difficulty.value = difficultyValue;
        if ([...habitStatus.options].some((item) => item.value === statusValue)) habitStatus.value = statusValue;
        bonus.checked = draft.bonus !== 'false';
        if (['once', 'count', 'weekly'].includes(draft.completionMode ?? '')) completionMode.value = draft.completionMode!;
        targetCount.value = draft.targetCount ?? targetCount.value;
        countUnit.value = draft.countUnit ?? countUnit.value;
        const savedDays = new Set((draft.scheduleDays ?? '').split(',').filter(Boolean));
        if (savedDays.size) schedule.querySelectorAll<HTMLInputElement>('input').forEach((input) => { input.checked = savedDays.has(input.value); });
        editorDraftState.textContent = '草稿已保存';
      }
    } catch { /* The editor remains usable if its local draft is damaged. */ }
    const persistEditorDraft = () => {
      try {
        const scheduleDays = Array.from(schedule.querySelectorAll<HTMLInputElement>('input:checked')).map((input) => input.value).join(',');
        localStorage.setItem(editorDraftKey, JSON.stringify({ name: name.value, minimum: minimum.value, trigger: trigger.value, scheduleDays, dimension: dimension.value, difficulty: difficulty.value, status: habitStatus.value, bonus: String(bonus.checked), completionMode: completionMode.value, targetCount: targetCount.value, countUnit: countUnit.value }));
        editorDraftState.textContent = '草稿已保存';
      } catch { editorDraftState.textContent = '草稿暂时无法保存'; }
    };
    [name, minimum, trigger, schedule, dimension, difficulty, habitStatus, bonus, completionMode, targetCount, countUnit].forEach((control) => {
      control.addEventListener('input', persistEditorDraft);
      control.addEventListener('change', persistEditorDraft);
    });
  }
  const status = statusMessage();
  const advanced = disclosure('更多设置', 'form-advanced');
  const advancedFields = formStack('form-advanced-fields');
  advancedFields.append(labelledControl('什么时候做', trigger), bonusLabel, labelledControl('状态', habitStatus));
  advanced.append(advancedFields);
  content.append(
    labelledControl('习惯名称', name), labelledControl('完成方式', completionMode), completionChoices, countFields, schedule,
    labelledControl('五维状态', dimension), labelledControl('难度', difficulty), status,
  );
  content.insertBefore(advanced, status);
  updateCompletionMode();
  const cancel = actionButton('取消', () => dialog.close());
  const save = actionButton(habit ? '保存习惯' : '建立习惯', undefined, { variant: 'primary' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    const days = Array.from(schedule.querySelectorAll<HTMLInputElement>('input:checked')).map((item) => Number(item.value));
    try {
      const value = {
        name: name.value, minimumAction: minimum.value.trim() || name.value.trim(), trigger: trigger.value, scheduleDays: completionMode.value === 'weekly' ? [1, 2, 3, 4, 5, 6, 7] : days,
        weeklyTarget: completionMode.value === 'weekly' ? Number(targetCount.value) : undefined,
        targetCount: completionMode.value === 'count' ? Number(targetCount.value) : undefined,
        countUnit: completionMode.value === 'count' ? countUnit.value : undefined,
        dimension: dimension.value as Dimension, difficulty: difficulty.value as Difficulty,
        bonusEnabled: bonus.checked,
      };
      if (habit) await db.saveHabit(habit.id, { ...value, trigger: trigger.value.trim() || undefined, status: habitStatus.value as Habit['status'] });
      else {
        const created = await db.addHabit(value);
        if (habitStatus.value !== 'active') await db.saveHabit(created.id, { status: habitStatus.value as Habit['status'], bonusEnabled: false });
      }
      dialog.close();
      if (!habit) localStorage.removeItem(editorDraftKey);
      showToast(habit ? '习惯设置已保存。' : bonus.checked ? '习惯已建立，会在计划日出现在今天。' : '习惯计划已保存。');
      await render();
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, save);
  dialog.showModal();
}

async function openGoalDetailDialog(goal: Goal): Promise<void> {
  const [milestones, allQuests] = await Promise.all([db.listMilestones(goal.id), db.listQuests()]);
  const { dialog, content, actions, titlebar } = dialogShell('目标详情', { back: true, className: 'goal-detail-dialog', fullScreen: true });
  const currentMilestones = milestones.filter((item) => item.status !== 'superseded');
  const completed = currentMilestones.filter((item) => item.status === 'completed').length;
  const progress = currentMilestones.length ? Math.round(completed / currentMilestones.length * 100) : 0;
  const hero = node('section', 'entity-detail-hero');
  const goalIcon = node('span', 'entity-detail-icon is-goal-icon');
  goalIcon.append(semanticIcon('goal'));
  hero.append(goalIcon, node('h3', '', goal.result), node('p', 'success-copy', goal.status === 'active' ? '● 进行中' : goal.status === 'completed' ? '● 已完成' : '● 已暂停'));
  const meter = node('progress', 'xp-progress');
  meter.max = 100;
  meter.value = progress;
  const progressLine = node('div', 'goal-detail-progress-line');
  progressLine.append(node('span', '', `${completed} / ${currentMilestones.length || '—'} 子任务`), node('span', '', goal.targetDate ? formatDate(goal.targetDate) : '未设日期'));
  hero.append(progressLine);
  const more = titlebarAction('更多目标操作', '⋮', () => { dialog.close(); void openGoalSettingsDialog(goal); }, 'detail-header-more');
  titlebar.append(more);
  content.append(hero);
  const stages = listSection('子任务', { className: 'entity-detail-section' });
  if (!currentMilestones.length) stages.append(emptyState('还没有子任务'));
  const nextMilestoneId = currentMilestones.find((item) => item.status === 'pending')?.id;
  currentMilestones.forEach((milestone, index) => {
    const row = node('article', `ui-panel goal-detail-stage is-${milestone.status}`);
    if (milestone.id === nextMilestoneId) row.classList.add('is-next');
    row.append(node('span', 'stage-number', String(index + 1)), node('div', 'stage-copy'));
    const copy = row.querySelector<HTMLElement>('.stage-copy')!;
    const linkedQuest = allQuests.filter((item) => item.milestoneId === milestone.id)
      .sort((left, right) => Number(Boolean(right.systemRetiredAt)) - Number(Boolean(left.systemRetiredAt)) || right.updatedAt.localeCompare(left.updatedAt))[0];
    const stageMeta = linkedQuest ? [
      formatDate(linkedQuest.localDate),
      linkedQuest.deadlineAt ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(linkedQuest.deadlineAt)) : '',
      linkedQuest.dimension ? dimensionLabel(linkedQuest.dimension) : '',
      DIFFICULTY_LABELS[linkedQuest.difficulty],
    ].filter(Boolean).join(' · ') : milestone.status === 'superseded' ? '已替换' : '未安排日期';
    copy.append(node('strong', '', milestone.description), node('span', 'caption', stageMeta));
    if (milestone.status !== 'superseded' && linkedQuest) {
      const controls = actionGroup('goal-stage-actions');
      const marker = node('span', `stage-toggle ${milestone.status === 'completed' ? 'is-complete' : ''}`, milestone.status === 'completed' ? '✓' : '');
      marker.setAttribute('aria-label', milestone.status === 'completed' ? `已完成：${milestone.description}` : `待完成：${milestone.description}`);
      row.prepend(marker);
      if (linkedQuest?.status === 'pending') {
        const editStage = actionButton('编辑', undefined, { variant: 'quiet', className: 'button-compact' });
        editStage.setAttribute('aria-label', `编辑子任务：${milestone.description}`);
        editStage.addEventListener('click', () => { dialog.close(); void openQuestAdjustmentDialog(linkedQuest); });
        controls.append(editStage);
      }
      row.append(controls);
    }
    stages.append(row);
  });
  content.append(stages);
  const edit = actionButton('编辑目标', undefined, { variant: 'quiet' });
  edit.addEventListener('click', () => { dialog.close(); void openGoalSettingsDialog(goal); });
  const add = actionButton('添加子任务', undefined);
  add.addEventListener('click', () => { dialog.close(); void openMilestoneDialog(goal); });
  const readyToComplete = goal.status === 'active' && currentMilestones.length > 0
    && currentMilestones.every((item) => item.status === 'completed');
  if (readyToComplete) {
    const completeGoal = actionButton('确认目标完成', undefined, { variant: 'primary' });
    completeGoal.addEventListener('click', async () => {
      const confirmed = await confirmAction('确认目标已完成？', '所有子任务已完成。确认后会保存完成日期，并停止这个目标尚未执行的任务。', '确认完成');
      if (!confirmed) return;
      completeGoal.disabled = true;
      try {
        const achievementsBefore = await growthBadgeIds();
        await db.saveGoal(goal.id, { status: 'completed' });
        dialog.close();
        await render();
        await announceNewGrowthBadge(achievementsBefore, '目标已完成。', true);
      } catch (error) {
        completeGoal.disabled = false;
        showToast(errorMessage(error), 'error');
      }
    });
    actions.append(edit, completeGoal);
  } else {
    actions.append(edit);
    if (goal.status === 'active') actions.append(add);
  }
  dialog.showModal();
}

async function openHabitDetailDialog(habit: Habit, showCheckIn = true): Promise<void> {
  const [logs, quests] = await Promise.all([db.listHabitLogs(), db.listQuests()]);
  const habitLogs = logs.filter((item) => item.habitId === habit.id).sort((left, right) => right.localDate.localeCompare(left.localDate));
  const { dialog, content, actions, titlebar } = dialogShell('习惯详情', { back: true, className: 'habit-detail-dialog', fullScreen: true });
  const hero = node('section', 'entity-detail-hero');
  const habitIcon = node('span', 'entity-detail-icon is-habit-icon');
  habitIcon.append(semanticIcon('habit'));
  hero.append(node('h3', '', habit.name), node('p', 'caption', `${habit.weeklyTarget ? `每周 ${habit.weeklyTarget} 次` : `${habitScheduleLabel(habit.scheduleDays)} · 每天 ${habit.targetCount ?? 1}${habit.countUnit || '次'}`} · ${dimensionLabel(habit.dimension)}`));
  const more = titlebarAction('更多习惯操作', '⋮', () => { dialog.close(); void openHabitDialog(habit); }, 'detail-header-more');
  titlebar.append(more);
  content.append(hero);
  const currentWeek = weekRange(localDate());
  const weekCompleted = habitLogs.filter((item) => item.localDate >= currentWeek.start && item.localDate <= currentWeek.end && item.result === 'completed').length;
  const stats = metricGroup([
    ['本周', `${weekCompleted}/${habit.weeklyTarget ?? habit.scheduleDays.length} ${habit.weeklyTarget ? '次' : '天'}`],
    ['累计', `${habitLogs.filter((item) => item.result === 'completed').length} 次`],
  ], { className: 'habit-detail-stats', itemClassName: 'habit-stat' });
  const weekCard = node('section', 'habit-week-card');
  const week = node('section', 'habit-week');
  for (let offset = 0; offset < 7; offset += 1) {
    const date = shiftDate(currentWeek.start, offset);
    const planned = habit.scheduleDays.includes(parseLocalDate(date).getDay() || 7);
    const completed = habitLogs.some((item) => item.localDate === date && item.result === 'completed');
    const cell = node('span', `habit-week-day${completed ? ' is-complete' : date === localDate() && planned ? ' is-today' : ''}`);
    cell.append(node('span', 'habit-week-label', `周${'一二三四五六日'[offset]}`), node('span', 'habit-week-mark', completed ? '✓' : planned ? '○' : '—'));
    week.append(cell);
  }
  weekCard.append(week);
  if (showCheckIn) {
    const todayQuest = todayHabitQuests(quests.filter(quest => quest.localDate === localDate())).find(quest => quest.sourceId === habit.id);
    const checkinActions = actionGroup('habit-detail-checkin-actions');
    if (todayQuest?.status === 'pending') {
      const target = todayQuest.targetCount ?? 1;
      const progress = todayQuest.progressCount ?? 0;
      checkinActions.append(primaryButton(todayQuest.targetCount ? `打卡 ${progress}/${target}` : '完成今天打卡', () => {
        dialog.close();
        recordQuestCheckIn(todayQuest, content);
      }));
    } else if (todayQuest) {
      const completed = actionButton(todayQuest.status === 'partial' ? '今天已有进展' : '今日已完成', undefined, { className: 'habit-checkin-complete' });
      completed.disabled = true;
      checkinActions.append(completed);
    }
    const makeUp = actionButton('补记', undefined, { variant: 'quiet' });
    makeUp.addEventListener('click', () => {
      const pending = quests.filter((quest) => quest.sourceType === 'habit' && quest.sourceId === habit.id && quest.status === 'pending' && quest.localDate <= localDate()).sort((left, right) => right.localDate.localeCompare(left.localDate))[0];
      if (pending) { dialog.close(); void openQuestFeedbackDialog(pending, 'completed'); }
      else showToast('暂无可补记的计划日。');
    });
    checkinActions.append(makeUp);
    content.append(checkinActions);
  }
  const allRecords = textAction('全部记录 ›', () => { dialog.close(); go({ name: 'habit-analysis', entityId: habit.id }); });
  const recent = listSection('最近记录', { className: 'entity-detail-section', tail: allRecords });
  const recentGrid = node('div', 'habit-recent-grid');
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = shiftDate(localDate(), -offset);
    const log = habitLogs.find((item) => item.localDate === date);
    const result = log?.result ?? 'empty';
    const day = node('span', 'habit-recent-day');
    const dayQuest = quests.find((item) => item.sourceType === 'habit' && item.sourceId === habit.id && item.localDate === date);
    const progress = dayQuest?.status === 'completed' ? dayQuest.targetCount ?? 1 : dayQuest?.progressCount ?? 0;
    const cell = node('span', `habit-recent-cell is-${result}`, dayQuest?.targetCount ? `${progress}/${dayQuest.targetCount}` : result === 'completed' ? '✓' : result === 'partial' ? '·' : '–');
    cell.setAttribute('role', 'img');
    cell.setAttribute('aria-label', `${formatDate(date)}：${result === 'completed' ? '完成' : result === 'partial' ? '有进展' : result === 'skipped' || result === 'exempt' ? '跳过' : '无记录'}`);
    cell.title = cell.getAttribute('aria-label') ?? '';
    day.append(cell, node('time', '', `${parseLocalDate(date).getMonth() + 1}/${parseLocalDate(date).getDate()}`));
    recentGrid.append(day);
  }
  recent.append(recentGrid);
  content.append(recent, stats);
  const edit = actionButton('编辑计划', () => { dialog.close(); void openHabitDialog(habit); });
  const analysis = actionButton('查看分析', () => { dialog.close(); go({ name: 'habit-analysis', entityId: habit.id }); });
  actions.append(edit, analysis);
  dialog.showModal();
}

async function tasksPage(): Promise<HTMLElement> {
  const today = localDate();
  await db.ensureTodayBonusQuests(today);
  const [quests, allQuests, overdueQuests, storedGoals, storedHabits, allHabitLogs] = await Promise.all([
    db.listQuests(today), db.listQuests(), db.listPendingBefore(today), db.listGoals(), db.listHabits(), db.listHabitLogs(),
  ]);
  const goals = storedGoals.filter((goal) => goal.status !== 'abandoned');
  const habits = storedHabits.filter((habit) => habit.status !== 'ended');
  const milestonesByGoal = await Promise.all(goals.map((goal) => db.listMilestones(goal.id)));
  const futureQuests = allQuests
    .filter((quest) => quest.status === 'pending' && !quest.systemRetiredAt && quest.localDate > today)
    .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.createdAt.localeCompare(right.createdAt));
  const main = node('main', 'page page-tasks');
  const analysis = textAction('分析', () => go({ name: 'task-analysis' }), 'page-header-text-action');
  const header = pageHeader('任务', { meta: formatDate(today), action: analysis });
  const headerMeta = header.querySelector<HTMLElement>('.page-header-meta');
  const todayPanel = node('div', 'task-view-panel');
  todayPanel.id = 'task-view-today';
  todayPanel.setAttribute('role', 'tabpanel');
  todayPanel.setAttribute('aria-labelledby', 'task-tab-today');
  const planPanel = node('div', 'task-view-panel');
  planPanel.id = 'task-view-plan';
  planPanel.setAttribute('role', 'tabpanel');
  planPanel.setAttribute('aria-labelledby', 'task-tab-plan');
  const tabs = segmentedControl('nav', 'task-view-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '任务视图');
  const todayTab = segmentedItem('button', '今天', { className: 'task-view-tab' });
  todayTab.id = 'task-tab-today';
  todayTab.setAttribute('role', 'tab');
  todayTab.setAttribute('aria-controls', todayPanel.id);
  const planTab = segmentedItem('button', '计划', { className: 'task-view-tab' });
  planTab.id = 'task-tab-plan';
  planTab.setAttribute('role', 'tab');
  planTab.setAttribute('aria-controls', planPanel.id);
  const selectView = (view: 'today' | 'plan', persist = true) => {
    const showingToday = view === 'today';
    todayPanel.hidden = !showingToday;
    planPanel.hidden = showingToday;
    todayTab.setAttribute('aria-selected', String(showingToday));
    planTab.setAttribute('aria-selected', String(!showingToday));
    todayTab.tabIndex = showingToday ? 0 : -1;
    planTab.tabIndex = showingToday ? -1 : 0;
    if (headerMeta) headerMeta.textContent = showingToday ? formatDate(today) : '计划总览';
    if (persist) sessionStorage.setItem('qiguang.task-view', view);
  };
  todayTab.addEventListener('click', () => selectView('today'));
  planTab.addEventListener('click', () => selectView('plan'));
  tabs.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = event.key === 'ArrowLeft' ? todayTab : planTab;
    selectView(next === todayTab ? 'today' : 'plan');
    next.focus();
  });
  tabs.append(todayTab, planTab);
  main.append(header, tabs, todayPanel, planPanel);
  const pendingCount = quests.filter((item) => item.status === 'pending' && item.sourceType !== 'habit').length;
  const completedCount = quests.filter((item) => item.status === 'completed' && item.sourceType !== 'habit').length;
  const habitPendingCount = quests.filter((item) => item.status === 'pending' && item.sourceType === 'habit').length;
  todayPanel.append(node('p', 'task-summary', `${pendingCount} 待完成　·　${completedCount} 已完成`));
  if (overdueQuests.length) todayPanel.append(overdueQuestPanel(overdueQuests, Number.POSITIVE_INFINITY));
  const day = listSection('今日任务', { className: 'task-board' });
  if (!quests.length) {
    day.append(emptyState('暂无任务'));
  } else {
    const pendingQuests = quests.filter((quest) => quest.status === 'pending' && quest.sourceType !== 'habit');
    const habitQuests = todayHabitQuests(quests);
    const settledQuests = quests.filter((quest) => quest.status !== 'pending' && quest.sourceType !== 'habit' && !quest.systemRetiredAt);
    const retiredQuests = quests.filter((quest) => quest.systemRetiredAt && quest.systemRetiredReason !== 'capacity');
    if (pendingQuests.length) {
      const taskGroup = listGroup('task-today-list');
      pendingQuests.forEach((quest) => taskGroup.append(taskListQuest(quest, false, true, true)));
      day.append(taskGroup);
      enableTaskReordering(taskGroup, today);
    } else day.append(emptyState('今天的任务已经完成'));
    if (habitQuests.length) {
      const habitGroup = listSection('习惯打卡', {
        className: 'task-today-habits',
        headingClassName: 'task-subsection-heading',
        tail: node('span', 'caption', `${habitPendingCount} 项待打卡`),
      });
      const habitList = listGroup();
      habitQuests.forEach((quest) => {
        const habit = storedHabits.find((item) => item.id === quest.sourceId);
        if (habit) habitList.append(habitTodayRow(habit, quest));
      });
      habitGroup.append(habitList);
      day.append(habitGroup);
    }
    if (settledQuests.length) {
      const settled = optionalDetails(`已完成 ${settledQuests.length}`, 'task-settled');
      settled.open = true;
      const settledList = listGroup();
      settledQuests.forEach((quest) => settledList.append(taskListQuest(quest)));
      settled.append(settledList);
      day.append(settled);
    }
    if (retiredQuests.length) {
      const retired = optionalDetails(`已暂停 ${retiredQuests.length}`, 'task-retired');
      retiredQuests.forEach((quest) => retired.append(questCard(quest, quest.milestoneId ? milestonesByGoal.flat().find((item) => item.id === quest.milestoneId) : undefined)));
      day.append(retired);
    }
  }
  const future = node('section', 'task-future');
  if (futureQuests.length) {
    future.append(sectionHeading(`之后已安排 · ${futureQuests.length}`));
    futureQuests.forEach((quest) => {
      const card = questCard(quest, quest.milestoneId ? milestonesByGoal.flat().find((item) => item.id === quest.milestoneId) : undefined, true);
      future.append(card);
    });
  }
  const quickAdd = node('button', 'task-fab', '＋');
  quickAdd.type = 'button';
  quickAdd.setAttribute('aria-label', '添加任务');
  quickAdd.addEventListener('click', () => { void openQuestDialog(); });
  day.append(quickAdd);
  todayPanel.append(day);

  const goalSection = listSection('目标', {
    className: 'task-goals',
    tail: actionButton('新建', () => { void openGoalDialog(); }, { variant: 'quiet', className: 'button-compact goal-add-button' }),
  });
  const goalList = listGroup();
  goalSection.append(goalList);
  if (!goals.length) goalSection.append(emptyState('暂无目标'));
  goals.forEach((goal, index) => {
    const card = listRow('article', 'ui-action-row goal-row is-compact-plan');
    const goalMilestones = (milestonesByGoal[index] ?? []).filter((item) => item.status !== 'superseded');
    const completedMilestones = goalMilestones.filter((item) => item.status === 'completed').length;
    const completion = goalMilestones.length ? Math.round(100 * completedMilestones / goalMilestones.length) : 0;
    const viewGoal = node('button', 'ui-row-main goal-main');
    viewGoal.type = 'button';
    viewGoal.setAttribute('aria-label', `查看目标“${goal.result}”的子任务`);
    viewGoal.addEventListener('click', () => { void openGoalDetailDialog(goal); });
    const goalCopy = node('span', 'ui-row-copy');
    goalCopy.append(node('h3', 'ui-row-label goal-title', goal.result));
    if (goal.targetDate) goalCopy.append(node('time', 'ui-row-meta goal-date', formatDate(goal.targetDate, { weekday: undefined })));
    viewGoal.append(goalCopy);
    const goalProgress = node('div', 'ui-row-copy ui-row-meta goal-progress-summary');
    goalProgress.append(node('span', '', `${completedMilestones}/${goalMilestones.length}`));
    const goalMeter = node('progress', 'goal-progress-meter');
    goalMeter.max = 100;
    goalMeter.value = completion;
    goalMeter.setAttribute('aria-label', `${goal.result}已完成 ${completedMilestones}/${goalMilestones.length}`);
    goalProgress.append(goalMeter);
    viewGoal.append(goalProgress);
    card.append(viewGoal);
    const manageButtons: HTMLElement[] = [];
    if (goal.status === 'active') {
      const schedule = actionButton(goalMilestones.length ? '添加子任务' : '添加第一个子任务', () => { void openMilestoneDialog(goal); }, { variant: 'primary', className: 'button-compact' });
      schedule.setAttribute('aria-label', `为“${goal.result}”添加子任务`);
      manageButtons.push(schedule);
    }
    const edit = actionButton('修改目标', () => { void openGoalSettingsDialog(goal); }, { className: 'button-compact' });
    edit.setAttribute('aria-label', `编辑目标“${goal.result}”`);
    manageButtons.push(edit);
    const remove = actionButton('删除目标', undefined, { variant: 'quiet', className: 'danger-button button-compact' });
    remove.setAttribute('aria-label', `删除目标：${goal.result}`);
    remove.addEventListener('click', () => { void confirmRemoveTaskItem(goal.result, () => db.saveGoal(goal.id, { status: 'abandoned' }), remove); });
    manageButtons.push(remove);
    const manage = overflowMenu('•••', manageButtons, { ariaLabel: `管理目标：${goal.result}` });
    card.append(manage);
    goalList.append(card);
  });
  const habitHeadingActions = actionGroup('section-heading-actions');
  const analyseHabits = textAction('分析', () => go({ name: 'habit-analysis' }));
  habitHeadingActions.append(analyseHabits, actionButton('新建', () => { void openHabitDialog(); }, { variant: 'primary', className: 'button-compact' }));
  const habitSection = listSection('习惯', { className: 'task-habits', tail: habitHeadingActions });
  if (!habits.length) habitSection.append(emptyState('暂无习惯'));
  const activeHabits = habits.filter((habit) => habit.status === 'active' && habit.bonusEnabled);
  const pausedHabits = habits.filter((habit) => habit.status !== 'active' || !habit.bonusEnabled);
  const activeHabitList = listGroup();
  activeHabits.forEach((habit) => {
    const period = weekRange(today);
    const weekCompleted = allHabitLogs.filter((item) => item.habitId === habit.id
      && item.localDate >= period.start && item.localDate <= period.end && item.result === 'completed').length;
    const row = listRow('article', 'ui-action-row habit-row habit-list-row');
    const copy = node('div', 'task-list-copy');
    copy.append(node('h3', '', habit.name));
    copy.append(node('p', 'habit-plan-summary', habit.weeklyTarget ? `本周 ${weekCompleted}/${habit.weeklyTarget} 次` : `本周 ${weekCompleted}/${habit.scheduleDays.length} 天 · 每天 ${habit.targetCount ?? 1}${habit.countUnit || '次'}`));
    const edit = actionButton('修改习惯', () => { void openHabitDialog(habit); }, { className: 'button-compact' });
    edit.setAttribute('aria-label', `编辑习惯“${habit.name}”`);
    const remove = actionButton('删除习惯', undefined, { variant: 'quiet', className: 'danger-button button-compact' });
    remove.setAttribute('aria-label', `删除习惯：${habit.name}`);
    remove.addEventListener('click', () => { void confirmRemoveTaskItem(habit.name, () => db.saveHabit(habit.id, { status: 'ended', bonusEnabled: false }), remove); });
    const detail = actionButton('查看详情', undefined, { className: 'button-compact' });
    detail.addEventListener('click', () => { void openHabitDetailDialog(habit, false); });
    const pause = actionButton('暂停打卡', undefined, { variant: 'quiet', className: 'button-compact' });
    pause.setAttribute('aria-label', `暂停“${habit.name}”的计划日打卡`);
    pause.addEventListener('click', async () => {
      pause.disabled = true;
      try {
        await db.saveHabit(habit.id, { bonusEnabled: false, status: 'active' });
        showToast('已暂停计划日打卡；历史记录保留。');
        await render();
      } catch (error) {
        pause.disabled = false;
        showToast(errorMessage(error), 'error');
      }
    });
    const more = overflowMenu('编辑', [detail, edit, pause, remove], { ariaLabel: `管理习惯：${habit.name}` });
    row.append(copy, more);
    activeHabitList.append(row);
  });
  if (activeHabitList.childElementCount) habitSection.append(activeHabitList);
  if (pausedHabits.length) {
    const paused = disclosure(`已暂停 · ${pausedHabits.length}`, 'paused-habit-management');
    const pausedList = listGroup();
    pausedHabits.forEach((habit) => {
      const item = listRow('article', 'ui-action-row habit-row habit-list-row is-paused');
      const edit = actionButton('编辑', undefined, { className: 'button-compact' });
      edit.setAttribute('aria-label', `编辑习惯“${habit.name}”`);
      edit.addEventListener('click', () => { void openHabitDialog(habit); });
      item.append(node('span', '', habit.name), edit);
      pausedList.append(item);
    });
    paused.append(pausedList);
    habitSection.append(paused);
  }
  const planTabs = segmentedControl('nav', 'plan-section-tabs');
  planTabs.setAttribute('aria-label', '计划分类');
  const panels = [goalSection, habitSection, future];
  const sectionNames = ['目标', '习惯', '之后已安排'];
  const selectPlanSection = (index: number) => {
    panels.forEach((panel, i) => { panel.hidden = i !== index; });
    planTabs.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    sessionStorage.setItem('qiguang.plan-section', String(index));
  };
  sectionNames.forEach((label, index) => {
    const button = segmentedItem('button', label, { className: 'plan-section-tab' });
    button.addEventListener('click', () => selectPlanSection(index));
    planTabs.append(button);
  });
  if (!futureQuests.length) future.append(emptyState('暂无之后安排'));
  planPanel.append(planTabs, ...panels);
  selectPlanSection(Math.min(2, Math.max(0, Number(sessionStorage.getItem('qiguang.plan-section')) || 0)));
  const initialView = sessionStorage.getItem('qiguang.task-view') === 'plan' ? 'plan' : 'today';
  selectView(initialView, false);
  return main;
}

const GROWTH_BADGE_ASSETS: Record<GrowthBadge['sourceType'], string> = {
  milestone: badgeMilestoneImage,
  goal: badgeGoalImage,
  habit: badgeHabitImage,
  recovery: badgeRecoveryImage,
  experiment: badgeExperimentImage,
};

function growthBadgeDisplayName(badge: GrowthBadge): string {
  if (badge.sourceType === 'milestone') return '子任务完成';
  if (badge.sourceType === 'goal') return '目标完成';
  if (badge.sourceType === 'habit') return `完成${badge.threshold ?? 1}次`;
  if (badge.sourceType === 'recovery') return '状态回升';
  return '小尝试完成';
}

const DIMENSION_ICON_ASSETS: Record<Dimension, string> = {
  energy: branchHealthImage,
  mind: habitBedtimeImage,
  connection: branchTrustImage,
  progress: habitChecklistImage,
  play: branchAutonomyImage,
};

function habitImage(habit: Habit): string {
  const name = habit.name.toLowerCase();
  if (/散步|走路|步行|跑步|运动|walk|run/.test(name)) return habitWalkingImage;
  if (/睡|晚安|冥想|夜|sleep|bed/.test(name)) return habitBedtimeImage;
  if (/数学|错题|学习|读书|阅读|作业|study|read|math/.test(name)) return habitStudyImage;
  if (/电话|联系|家人|朋友|call|phone/.test(name)) return habitPhoneImage;
  return habitChecklistImage;
}

function openBadgeEvidenceDialog(badge: GrowthBadge): void {
  const { dialog, content, actions } = dialogShell('徽章详情');
  const facts = node('dl', 'badge-evidence-list');
  const addFact = (label: string, value: string) => {
    facts.append(node('dt', '', label), node('dd', '', value));
  };
  addFact('成果', badge.name);
  addFact('获得日期', formatDate(badge.earnedOn));
  addFact('获得说明', badge.evidence);
  content.append(facts);
  const close = primaryButton('关闭', () => dialog.close());
  actions.append(close);
  dialog.showModal();
  close.focus();
}

function growthBadgeButton(badge: GrowthBadge): HTMLButtonElement {
  const button = node('button', 'growth-badge');
  button.type = 'button';
  button.dataset.asset = badge.theme;
  button.dataset.badgeSource = badge.sourceType;
  button.dataset.badgeId = badge.id;
  button.setAttribute('aria-label', `查看徽章详情：${badge.name}`);
  const description = node('span', 'sr-only', `获得说明：${badge.evidence}`);
  description.id = `badge-description-${crypto.randomUUID()}`;
  button.setAttribute('aria-describedby', description.id);
  const mark = node('span', 'badge-mark');
  mark.setAttribute('aria-hidden', 'true');
  const icon = node('img', 'badge-icon-asset');
  icon.src = GROWTH_BADGE_ASSETS[badge.sourceType];
  icon.alt = '';
  mark.append(icon);
  button.append(mark, node('strong', 'badge-name', growthBadgeDisplayName(badge)), node('time', 'caption', formatDate(badge.earnedOn)), description);
  button.addEventListener('click', () => openBadgeEvidenceDialog(badge));
  return button;
}

async function growthPage(): Promise<HTMLElement> {
  const [habits, habitLogs, ledger, quests, milestones, goals, feedbacks, reviews, events] = await Promise.all([
    db.listHabits(), db.listHabitLogs(), db.listXpLedger(), db.listQuests(), db.listMilestones(),
    db.listGoals(), db.listQuestFeedback(), db.listReviews('weekly'), db.listJournalEvents(),
  ]);
  const progress = await Promise.all(DIMENSIONS.map((dimension) => db.dimensionProgress(dimension.key)));
  const main = node('main', 'page page-growth');
  main.append(pageHeader('轨迹'));
  main.append(trailTabs('growth'));

  const activeLedger = ledger.filter((item) => !item.reversedAt);
  const growthToday = localDate();
  const selectedPeriod = sessionStorage.getItem('qiguang.growth-period') ?? '30';
  const periodStart = selectedPeriod === 'all' ? '0000-01-01' : shiftDate(growthToday, selectedPeriod === '7' ? -6 : -29);
  const periods = segmentedControl('nav', 'growth-period-tabs');
  periods.setAttribute('aria-label', '成长周期');
  for (const [value, label] of [['7', '最近7天'], ['30', '最近30天'], ['all', '累计']]) {
    const tab = segmentedItem('button', label, { active: selectedPeriod === value });
    tab.setAttribute('aria-pressed', String(selectedPeriod === value));
    tab.addEventListener('click', () => { sessionStorage.setItem('qiguang.growth-period', value!); void render(); });
    periods.append(tab);
  }
  main.append(periods);

  const badges = selectGrowthBadges({ milestones, goals, ledger, habits, habitLogs, quests, feedbacks, reviews });
  const badgeSection = node('section', 'surface ui-surface-plain growth-badges');
  const badgeHeading = sectionHeading('成就册');
  badgeSection.append(badgeHeading);
  if (!badges.length) badgeSection.append(emptyState('暂无徽章'));
  else {
    const recent = node('div', 'badge-grid');
    badges.slice(0, 3).forEach((badge) => recent.append(growthBadgeButton(badge)));
    badgeSection.append(recent);
    const all = textAction('查看全部 ›', () => {
      const { dialog, content, actions } = dialogShell('成就册', { back: true, fullScreen: true });
      const allGrid = node('div', 'badge-grid');
      badges.forEach((badge) => allGrid.append(growthBadgeButton(badge)));
      content.append(allGrid);
      actions.remove();
      dialog.showModal();
    });
    badgeHeading.append(all);
  }
  const questById = new Map(quests.map((item) => [item.id, item]));
  const milestoneById = new Map(milestones.map((item) => [item.id, item]));
  const eventById = new Map(events.map((item) => [item.id, item]));
  const feedbackByQuest = activeFeedbackByQuest(feedbacks);
  const grid = node('section', 'growth-dimension-grid');
  grid.append(sectionHeading('五维成长', { className: 'growth-dimension-title' }));
  DIMENSIONS.forEach((dimension, index) => {
    const value = progress[index]!;
    const dimensionLedger = activeLedger
      .filter((item) => item.dimension === dimension.key)
      .sort((left, right) => right.localDate.localeCompare(left.localDate) || right.updatedAt.localeCompare(left.updatedAt));
    const card = listRow('button', 'growth-dimension-card');
    card.type = 'button';
    card.dataset.dimension = dimension.key;
    const heading = node('div', 'growth-dimension-heading');
    const icon = node('img', 'growth-dimension-icon') as HTMLImageElement;
    icon.src = DIMENSION_ICON_ASSETS[dimension.key];
    icon.alt = '';
    const headingCopy = node('span', 'growth-dimension-copy');
    headingCopy.append(node('h3', '', dimension.label));
    heading.append(icon, headingCopy);
    const stats = node('div', 'growth-dimension-stats');
    stats.append(node('span', '', `等级 ${value.level}`));
    const meter = node('progress', 'growth-dimension-meter');
    meter.max = value.nextLevelXp;
    meter.value = value.currentXp;
    meter.setAttribute('aria-label', `${dimension.label}等级 ${value.level}，当前成长值 ${value.currentXp}/${value.nextLevelXp}`);
    const periodXp = dimensionLedger.filter((item) => item.localDate >= periodStart && item.localDate <= growthToday).reduce((sum, item) => sum + item.finalXp, 0);
    card.append(heading, node('strong', 'growth-period-value', String(periodXp)));
    card.setAttribute('aria-label', `查看${dimension.label}成长记录，${periodXp}成长值`);

    const evidence = listGroup('growth-evidence-list');
    if (!dimensionLedger.length) evidence.append(emptyState('暂无成长记录'));
    dimensionLedger.forEach((item) => {
      const quest = item.sourceType === 'quest' ? questById.get(item.sourceId) : undefined;
      const milestone = item.sourceType === 'milestone' ? milestoneById.get(item.sourceId) : undefined;
      const journalEvent = item.sourceType === 'journal-event' ? eventById.get(item.sourceId) : undefined;
      const feedback = quest ? feedbackByQuest.get(quest.id) : undefined;
      const title = quest?.title ?? milestone?.description ?? journalEvent?.title ?? '保留的历史记录';
      const proof = feedback?.actual || feedback?.note || journalEvent?.description || milestone?.evidence || title;
      const row = listRow('div', 'ui-info-row is-multiline growth-evidence-row');
      const copy = node('span', 'ui-row-copy');
      copy.append(node('strong', 'ui-row-label', title), node('span', 'ui-row-meta', proof));
      row.append(
        copy,
        node('span', 'ui-row-value', `${formatDate(item.localDate)} · +${item.finalXp}`),
      );
      evidence.append(row);
    });
    card.addEventListener('click', () => {
      const { dialog, content, actions } = dialogShell(`${dimension.label}成长记录`, { back: true, className: 'growth-ledger-dialog', fullScreen: true });
      content.append(stats, meter, evidence);
      actions.remove();
      dialog.showModal();
    });
    grid.append(card);
  });
  main.append(grid, badgeSection);
  return main;
}

function settingsDisclosure(label: string, className = '', status = ''): HTMLDetailsElement {
  const summary = [node('span', '', label)];
  if (status) summary.push(node('span', 'settings-summary-status', status));
  return disclosure(summary, `surface settings-section settings-disclosure${className ? ` ${className}` : ''}`);
}

function openSettingsDetail(title: string, section: HTMLElement): void {
  const { dialog, content, actions } = dialogShell(title, { back: true, className: 'settings-detail-dialog', fullScreen: true });
  if (section.classList.contains('ai-settings')) dialog.classList.add('is-ai-settings');
  const details = section as HTMLDetailsElement;
  details.open = true;
  details.classList.add('settings-detail-content');
  let body = details.querySelector<HTMLElement>(':scope > .ui-settings-stack');
  if (!body) {
    body = node('div', 'ui-settings-stack');
    for (const child of [...details.children]) {
      if (child.tagName !== 'SUMMARY') body.append(child);
    }
    details.append(body);
  }
  content.append(details);
  const primary = body.querySelector<HTMLButtonElement>('.settings-primary-action');
  if (primary) {
    actions.append(primary);
    dialog.addEventListener('close', () => {
      body.append(primary);
      section.dispatchEvent(new Event('settings-detail-closed'));
    }, { once: true });
  } else if (section.classList.contains('ai-settings') || section.classList.contains('profile-settings') || section.classList.contains('assessment-settings')) actions.remove();
  else {
    const close = primaryButton('完成', () => dialog.close());
    actions.append(close);
  }
  dialog.showModal();
  const heading = content.querySelector<HTMLElement>('h2');
  if (heading) { heading.tabIndex = -1; heading.focus(); }
}

function settingsOverviewRow(icon: SemanticIcon, label: string, status: string, section: HTMLElement, avatar?: Profile['avatar']): HTMLButtonElement {
  const iconCell = node('span', 'settings-overview-icon');
  const statusCell = node('span', 'settings-overview-status');
  if (avatar) {
    const portrait = node('img', 'settings-companion-image') as HTMLImageElement;
    portrait.src = avatarAsset(avatar);
    portrait.alt = '';
    const thumbnail = portrait.cloneNode() as HTMLImageElement;
    thumbnail.classList.add('is-thumbnail');
    iconCell.append(portrait);
    statusCell.append(thumbnail, node('span', '', status));
  } else {
    iconCell.append(semanticIcon(icon));
    statusCell.textContent = status;
  }
  const row = infoRow(label, statusCell, { icon: iconCell, onOpen: () => openSettingsDetail(label, section), className: 'settings-overview-row' }) as HTMLButtonElement;
  if (label === '本地存储') row.classList.add('is-storage-status');
  return row;
}

const ASSESSMENT_ANSWER_LABELS = ['从不', '很少', '有时', '经常', '几乎总是'] as const;

function openAssessmentQuestionnaire(length: AssessmentLength, onlyDimension?: Dimension): void {
  const allQuestions = assessmentQuestions(length);
  const questions = onlyDimension ? allQuestions.filter((question) => question.dimension === onlyDimension) : allQuestions;
  const answers: Record<string, number> = {};
  let index = 0;
  const selectedDimension = onlyDimension ? DIMENSIONS.find((item) => item.key === onlyDimension) : undefined;
  const { dialog, content, actions } = dialogShell(selectedDimension ? `${selectedDimension.label}状态自评` : `${length} 题状态评估`, { back: true, className: 'ui-rebuilt-page ui-questionnaire-page', fullScreen: true });
  const progress = node('p', 'caption ui-question-progress');
  const questionArea = node('div', 'ui-question-content');
  questionArea.tabIndex = -1;
  const cancel = actionButton('稍后再测', () => dialog.close());
  const previous = actionButton('上一题', undefined, { variant: 'quiet' });
  previous.addEventListener('click', () => {
    if (index === 0) return;
    index -= 1;
    showQuestion();
  });
  content.append(progress, questionArea);

  const showResult = (): void => {
    const scores: Partial<Record<Dimension, number>> = onlyDimension
      ? { [onlyDimension]: scoreDimensionAssessment(onlyDimension, questions, answers) }
      : scoreAssessment(questions, answers);
    progress.textContent = '评估完成';
    const result = node('div', 'assessment-result');
    const scoreGrid = node('div', 'assessment-score-grid');
    if (selectedDimension) scoreGrid.classList.add('is-single');
    for (const dimension of selectedDimension ? [selectedDimension] : DIMENSIONS) {
      const item = node('div', 'assessment-score');
      item.append(node('span', '', dimension.label), node('strong', '', String(scores[dimension.key])));
      scoreGrid.append(item);
    }
    result.append(scoreGrid);
    questionArea.replaceChildren(result);
    const revise = actionButton('返回修改', undefined);
    revise.addEventListener('click', () => {
      index = questions.length - 1;
      showQuestion();
    });
    const save = actionButton('保存分数', undefined, { variant: 'primary' });
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await db.saveAssessment(scores);
        dialog.close();
        showToast(selectedDimension ? `${selectedDimension.label}状态已更新。` : '当前状态已更新。');
        await render();
      } catch (error) {
        save.disabled = false;
        showToast(errorMessage(error), 'error');
      }
    });
    actions.replaceChildren(revise, save);
    questionArea.focus({ preventScroll: true });
  };

  function showQuestion(): void {
    const question = questions[index];
    if (!question) {
      showResult();
      return;
    }
    const dimension = DIMENSIONS.find((item) => item.key === question.dimension)!;
    progress.textContent = `${dimension.label}，第 ${index + 1}/${questions.length} 题`;
    const title = node('h3', '', question.text);
    const choices = listGroup();
    ASSESSMENT_ANSWER_LABELS.forEach((label, answerIndex) => {
      const value = answerIndex + 1;
      const choice = choiceRow(label, {
        selected: answers[question.id] === value,
        value: String(value),
        onSelect: () => {
          answers[question.id] = value;
          index += 1;
          showQuestion();
        },
      });
      choices.append(choice);
    });
    questionArea.replaceChildren(title, choices);
    previous.hidden = index === 0;
    actions.replaceChildren(cancel, previous);
    questionArea.focus({ preventScroll: true });
  }

  showQuestion();
  dialog.showModal();
  questionArea.focus();
}

function assessmentForm(observations: Partial<Record<Dimension, StateObservation>>): HTMLElement {
  const completed = Object.keys(observations).length === DIMENSIONS.length;
  const section = settingsDisclosure('状态自评', 'assessment-settings', completed ? '已有分数' : '未评估');
  const dimensions = listGroup();
  DIMENSIONS.forEach((dimension) => {
    const button = listRow('button', 'ui-info-row');
    button.type = 'button';
    button.setAttribute('aria-label', dimension.label);
    const observation = observations[dimension.key];
    button.append(
      node('strong', '', dimension.label),
      node('span', 'caption', observation ? formatDate(observation.localDate, { weekday: undefined }) : '未评估'),
      node('span', 'ui-navigation-chevron', '›'),
    );
    button.addEventListener('click', () => openAssessmentQuestionnaire(30, dimension.key));
    dimensions.append(button);
  });
  const modes = listGroup();
  for (const [length, title] of [[30, '快速评估'], [60, '完整评估']] as const) {
    const button = listRow('button', 'ui-info-row');
    button.type = 'button';
    button.setAttribute('aria-label', `${length} 题${title}`);
    const copy = node('span', 'ui-navigation-copy');
    copy.append(node('strong', '', title), node('small', 'caption', `${length}题`));
    button.append(copy, node('span', 'ui-navigation-chevron', '›'));
    button.addEventListener('click', () => openAssessmentQuestionnaire(length));
    modes.append(button);
  }
  section.append(
    listSection('单维自评', {}, dimensions),
    listSection('全部自评', {}, modes),
  );
  return section;
}

function profileForm(profile: Profile): HTMLElement {
  const section = settingsDisclosure('人物', '', profile.chapterTitle || resolvedCompanionName(profile));
  section.classList.add('profile-settings');
  const form = node('form', 'profile-form');
  const userName = node('input', 'input');
  userName.maxLength = 40;
  userName.value = profile.userName;
  userName.placeholder = '你希望被怎样称呼（可留空）';
  const companionName = node('input', 'input');
  companionName.maxLength = 40;
  companionName.value = resolvedCompanionName(profile);
  const chapterTitle = node('input', 'input');
  chapterTitle.maxLength = 80;
  chapterTitle.value = profile.chapterTitle;
  const avatar = node('select', 'input');
  avatar.append(
    selectOption('', '暂不选择', profile.avatar === null),
    selectOption('female', '鱼鱼', profile.avatar === 'female'),
    selectOption('male', '包包', profile.avatar === 'male'),
  );
  const preview = node('img', 'avatar-preview') as HTMLImageElement;
  preview.alt = '生活分身外观预览';
  const updatePreview = () => {
    const selected = (avatar.value || null) as Profile['avatar'];
    preview.hidden = selected === null;
    if (selected) preview.src = selected === 'male' ? maleCompanionImage : femaleCompanionImage;
    choices.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      const active = button.dataset.avatar === selected;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  let currentDefaultName = avatarName(profile.avatar);
  avatar.addEventListener('change', () => {
    const selected = (avatar.value || null) as Profile['avatar'];
    if (!companionName.value.trim() || companionName.value === '小栖' || companionName.value === currentDefaultName) {
      companionName.value = avatarName(selected);
    }
    currentDefaultName = avatarName(selected);
    updatePreview();
  });
  const choices = avatarChoiceGroup();
  for (const [value, name, source] of [['female', '鱼鱼', femaleCompanionImage], ['male', '包包', maleCompanionImage]]) {
    const choice = avatarChoice(name!, source!, () => { avatar.value = value!; avatar.dispatchEvent(new Event('change')); });
    choice.dataset.avatar = value;
    choices.append(choice);
  }
  avatar.hidden = true;
  updatePreview();
  const status = statusMessage();
  const save = actionButton('保存设置', undefined, { variant: 'primary', type: 'submit' });
  form.append(
    preview, sectionHeading('选择伙伴', { className: 'profile-choice-heading', level: 'h3' }), choices,
    labelledControl('昵称', companionName), avatar, status, save,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await db.saveProfile({
        userName: userName.value, companionName: companionName.value, chapterTitle: chapterTitle.value,
        avatar: (avatar.value || null) as Profile['avatar'],
      });
      save.disabled = false;
      status.textContent = '人物设置已保存。';
      showToast('个人系统设置已保存。');
      await render();
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  section.append(form);
  return section;
}

async function importPreview(text: string): Promise<void> {
  const bundle = parseBackup(text);
  const { dialog, content, actions } = dialogShell('检查备份');
  content.append(node('p', '', `记录 ${bundle.data.entries.length} 条 · 整理 ${bundle.data.analyses.length} 份 · 事件 ${bundle.data.events.length} 条 · 目标 ${bundle.data.goals.length} 个 · 任务 ${bundle.data.quests.length} 条 · 记忆 ${bundle.data.memories.length} 条 · 成长值 ${bundle.data.xpLedger.length} 笔`));
  const warning = node('p', 'danger-copy', '导入会把备份加入当前本机数据；ID 冲突时保留两份并标记来源，不会静默覆盖。失败时当前数据不变，未保存草稿继续保留。');
  content.append(warning);
  const confirmLabel = node('label', 'confirm-check');
  const checkbox = node('input');
  checkbox.type = 'checkbox';
  confirmLabel.append(checkbox, node('span', '', '我已先导出当前数据，并确认合并导入'));
  content.append(confirmLabel);
  const cancel = actionButton('取消', () => dialog.close());
  const confirm = actionButton('合并并导入', undefined, { variant: 'primary' });
  confirm.disabled = true;
  checkbox.addEventListener('change', () => { confirm.disabled = !checkbox.checked; });
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await db.importBundle(text);
      settings = await db.getSettings();
      syncNativeAiAvailability();
      applySettings();
      dialog.close();
      showToast('备份已合并到本机；冲突内容已保留两份。');
      go({ name: 'today' });
      await render();
    } catch (error) {
      confirm.disabled = false;
      showToast(errorMessage(error), 'error');
    }
  });
  actions.append(cancel, confirm);
  dialog.showModal();
  cancel.focus();
}

async function readBackupFile(file: File): Promise<string> {
  if (file.type !== 'application/json' && !file.name.toLocaleLowerCase('zh-CN').endsWith('.json')) {
    throw new Error('请选择 JSON 备份文件。');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('备份文件超过 5MB。');
  return file.text();
}

async function deleteAllDialog(): Promise<void> {
  const { dialog, content, actions } = dialogShell('永久删除全部本地数据');
  content.append(node('p', 'danger-copy', '将删除所有记录、草稿、AI 整理、已核对事件、伙伴保存的信息、复盘、目标、任务、习惯、反馈、成长值、五维自评和个人设置，无法恢复。当前没有账户或长期服务端存储；已发送请求的验证结果可能在同源中转内存保留最多 10 分钟用于避免重复处理，本地删除不会远程清除这份短暂缓存。'));
  const input = node('input', 'input');
  input.autocomplete = 'off';
  const label = labelledControl('输入“删除全部数据”以确认', input);
  content.append(label);
  const cancel = actionButton('取消', () => dialog.close());
  const confirm = actionButton('永久删除', undefined, { variant: 'danger' });
  confirm.disabled = true;
  input.addEventListener('input', () => { confirm.disabled = input.value !== '删除全部数据'; });
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await db.deleteDatabase();
      clearDraft();
      for (const storage of [localStorage, sessionStorage]) {
        Object.keys(storage).filter((key) => key.startsWith('qiguang.')).forEach((key) => storage.removeItem(key));
      }
      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.filter((key) => key.startsWith('qiguang-')).map((key) => caches.delete(key)));
        } catch {
          // I1 has no runtime cache; a stale future cache must not misreport the completed data deletion.
        }
      }
      history.replaceState(null, '', '#/today');
      location.reload();
    } catch (error) {
      confirm.disabled = false;
      showToast(errorMessage(error), 'error');
    }
  });
  actions.append(cancel, confirm);
  dialog.showModal();
  input.focus();
}

async function openMemoryDecision(memory: SystemMemory): Promise<void> {
  const sourceEvents = await db.listJournalEvents();
  const hasValidEvidence = memory.userEdited && !memory.analysisId && !memory.reviewId && memory.evidenceIds.length === 0
    || memory.evidenceIds.some((id) => sourceEvents.some((event) => event.id === id && event.active && event.confirmation === 'confirmed'));
  const { dialog, content, actions } = dialogShell(memory.status === 'candidate' ? '核对待确认内容' : '编辑已保存内容');
  content.append(node('p', 'caption', `${MEMORY_TYPE_LABELS[memory.type]} · 确定程度 ${CONFIDENCE_LABELS[memory.confidence]} · 来源 ${memory.evidenceIds.length} 条`));
  const statement = node('textarea', 'input memory-edit');
  statement.maxLength = 500;
  statement.value = memory.statement;
  content.append(labelledControl('确认后用于后续建议', statement));
  if (memory.counterEvidence.length) content.append(node('p', 'caption', `反例：${memory.counterEvidence.join('；')}`));
  if (!hasValidEvidence) content.append(node('p', 'danger-copy', '原始记录或事件已经改变，这条内容目前没有有效依据，不能重新确认。你可以暂不处理或忘记。'));
  else if (!memory.evidenceIds.length) content.append(node('p', 'caption', '这是你直接写下并确认的规则，不是 AI 从记录中推断的。'));
  const status = statusMessage();
  status.setAttribute('role', 'status');
  content.append(status);
  const cancel = actionButton('暂不处理', () => dialog.close());
  const forget = actionButton('忘记', undefined, { variant: 'quiet' });
  forget.addEventListener('click', async () => {
    forget.disabled = true;
    try {
      await db.decideMemory(memory.id, 'forgotten');
      dialog.close();
      showToast('已忘记；之后不会作为 AI 上下文发送。');
      await render();
    } catch (error) {
      forget.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  const confirm = actionButton(statement.value === memory.statement ? '确认这条内容' : '编辑后确认', undefined, { variant: 'primary' });
  confirm.disabled = !hasValidEvidence;
  statement.addEventListener('input', () => { confirm.textContent = statement.value === memory.statement ? '确认这条内容' : '编辑后确认'; });
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await db.decideMemory(memory.id, 'confirmed', statement.value);
      dialog.close();
      showToast('已由你确认；今后仍可编辑或忘记。');
      await render();
    } catch (error) {
      confirm.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, forget, confirm);
  dialog.showModal();
  cancel.focus();
}

async function openSystemCandidateReview(memories: SystemMemory[], events: JournalEvent[]): Promise<void> {
  if (!NATIVE_AI_READY) { showToast(NATIVE_AI_UNAVAILABLE, 'error'); return; }
  const available = memories.filter((item) => item.status !== 'forgotten');
  if (available.length < 2) { showToast('至少需要两条待确认或已确认内容才能检查重复。'); return; }
  const { dialog, content, actions } = dialogShell('检查重复内容');
  content.append(node('p', 'privacy-boundary', '只发送下列内容、依据标题、日期和反例，不发送日记原文。AI 只能建议“分开”或“合并”；不会自动确认或删除。'));
  const preview = node('div', 'memory-review-preview');
  const optionRows = available.map((memory, index) => {
    const evidence = memory.evidenceIds.flatMap((id) => {
      const event = events.find((item) => item.id === id);
      return event ? [`${formatDate(event.localDate)} · ${event.title}`] : [];
    }).join('；') || '暂无来源标题';
    const option = previewContextRow(`${memory.status === 'confirmed' ? '已保存' : '待确认'} · ${MEMORY_TYPE_LABELS[memory.type]}`, `${memory.statement} · ${evidence}`, index < 30);
    preview.append(option.label);
    return { memory, input: option.input };
  });
  const count = statusMessage();
  const selectedMemories = () => optionRows.filter((item) => item.input.checked).map((item) => item.memory);
  const makeRequest = (selected: SystemMemory[]): SystemCandidateReviewRequest => ({
    contractVersion: ANALYSIS_CONTRACT_VERSION, operation: 'system_candidate_review', requestId: crypto.randomUUID(), locale: 'zh-CN',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    userInput: { candidates: selected.map((memory) => ({
      memoryId: memory.id, version: memory.version, type: memory.type, statement: memory.statement,
      evidenceEvents: memory.evidenceIds.flatMap((id) => {
        const event = events.find((item) => item.id === id);
        return event ? [{ eventId: event.id, localDate: event.localDate, title: event.title }] : [];
      }),
      counterEvidence: memory.counterEvidence, confidence: memory.confidence, status: memory.status as 'candidate' | 'confirmed',
    })) }, permissions: { memoryIds: selected.map((item) => item.id) },
  });
  content.append(preview, count);
  const cancel = actionButton('取消', () => dialog.close());
  const send = actionButton(navigator.onLine ? '确认范围并检查' : '当前离线', undefined, { variant: 'primary' }); send.disabled = !navigator.onLine;
  const updateCount = (changed?: HTMLInputElement) => {
    if (selectedMemories().length > 30 && changed) { changed.checked = false; showToast('一次最多检查 30 条，请先取消另一项。'); }
    const total = selectedMemories().length;
    count.textContent = `已选择 ${total}/${available.length} 条；至少 2 条，最多 30 条。`;
    send.disabled = !navigator.onLine || total < 2;
  };
  optionRows.forEach((item) => item.input.addEventListener('change', () => updateCount(item.input)));
  updateCount();
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      const selected = selectedMemories();
      const request = makeRequest(selected);
      if (!settings.aiAllowed) {
        const allowed = await confirmAction('允许这一次重复检查？', '只发送当前预览中的内容和依据摘要。', '允许并继续');
        if (!allowed) { send.disabled = false; return; }
        settings = await db.saveSettings({ aiAllowed: true, previewBeforeSend: true });
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 50_000);
      let response: Response;
      try {
        response = await requestAnalysis(request, controller.signal);
      } finally { window.clearTimeout(timeout); }
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) throw new Error((body as { error?: { message?: string } } | null)?.error?.message || '重复检查服务暂时不可用。');
      const parsed = parseSystemCandidateReviewResponse(body, request);
      content.replaceChildren(sectionHeading('重复内容建议'), node('p', 'privacy-boundary', '以下只是建议。每一组合并都需要你单独点击；合并后仍保持“待确认”。'));
      parsed.result.groups.forEach((group) => {
        const card = node('article', `ui-panel memory-merge-group is-${group.action}`);
        const sources = group.candidateMemoryIds.map((id) => selected.find((item) => item.id === id)?.statement ?? '内容已改变');
        card.append(node('span', 'tag', group.action === 'merge' ? '可考虑合并' : '建议分开'), node('p', '', sources.join('；')), node('p', 'caption', `${group.reason} · 确定程度：${CONFIDENCE_LABELS[group.confidence]}`));
        if (group.action === 'merge' && group.mergedStatement) {
          const statement = node('textarea', 'input compact-textarea'); statement.maxLength = 500; statement.value = group.mergedStatement;
          const merge = actionButton('合并并等待确认', undefined);
          merge.addEventListener('click', async () => {
            merge.disabled = true;
            try {
              const sources = group.candidateMemoryIds.map((id) => selected.find((item) => item.id === id)).filter((item): item is SystemMemory => Boolean(item));
              await db.mergeMemoryCandidates(sources, statement.value);
              dialog.close(); showToast('已合并为一条待确认内容；没有自动确认。'); await render();
            }
            catch (error) { merge.disabled = false; showToast(errorMessage(error), 'error'); }
          });
          card.append(statement, merge);
        }
        content.append(card);
      });
      actions.replaceChildren(cancel);
    } catch (error) { send.disabled = false; showToast(errorMessage(error), 'error'); }
  });
  actions.append(cancel, send); dialog.showModal(); cancel.focus();
}

async function openAddMemoryDialog(): Promise<void> {
  const { dialog, content, actions } = dialogShell('告诉生活分身一条规则', { back: true, fullScreen: true });
  const type = node('select', 'input');
  type.append(
    selectOption('constraint', '限制或不要再建议的事'), selectOption('preference', '稳定偏好'),
    selectOption('pattern', '对我有效的方法'), selectOption('strength', '已经证明的优势'), selectOption('principle', '我认同的原则'),
  );
  const statement = node('textarea', 'input compact-textarea'); statement.maxLength = 500;
  statement.placeholder = '例如：连续会议后不要建议我立刻做高专注任务。';
  const status = statusMessage(); status.setAttribute('role', 'status');
  content.append(
    labelledControl('规则类型', type), labelledControl('具体内容', statement), status,
  );
  const cancel = actionButton('取消', () => dialog.close());
  const save = actionButton('确认并记住', undefined, { variant: 'primary' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try { await db.addConfirmedMemory(type.value as SystemMemory['type'], statement.value); dialog.close(); showToast('生活分身已记住；你随时可以修改。'); await render(); }
    catch (error) { save.disabled = false; status.textContent = errorMessage(error); status.classList.add('is-error'); }
  });
  actions.append(cancel, save); dialog.showModal(); statement.focus();
}

function memorySettings(memories: SystemMemory[], events: JournalEvent[]): HTMLElement {
  const candidates = memories.filter((item) => item.status === 'candidate');
  const confirmed = memories.filter((item) => item.status === 'confirmed');
  const section = listSection('行动说明书', { className: 'surface settings-section memory-settings' }, actionButton('添加规则', () => { void openAddMemoryDialog(); }));
  const appendMemory = (parent: HTMLElement, memory: SystemMemory, label: string): void => {
    const card = node('article', `ui-panel memory-row is-${memory.status}`);
    const evidenceEvents = memory.evidenceIds.flatMap((id) => {
      const event = events.find((item) => item.id === id);
      return event ? [event] : [];
    });
    const evidenceTitles = evidenceEvents.map((event) => event.title);
    const evidenceDateLabels = [...new Set(evidenceEvents.map((event) => event.localDate))].sort().map((date) => formatDate(date, { year: 'numeric' }));
    card.append(node('span', 'tag', `${label}${memory.reminderMuted ? ' · 已减少提醒' : ''}`), node('h3', '', memory.statement), node('p', 'caption', memory.evidenceIds.length ? `来源：${evidenceTitles.join('；') || '原内容已变化'}${evidenceDateLabels.length ? ` · 发生于 ${evidenceDateLabels.join('、')}` : ''}` : '来源：你直接写下并确认'));
    if (memory.counterEvidence.length) card.append(node('p', 'caption', `反例：${memory.counterEvidence.join('；')}`));
    const memoryActions = actionGroup('quest-actions');
    memoryActions.append(actionButton(memory.status === 'candidate' ? '核对内容' : '编辑或忘记', () => { void openMemoryDecision(memory); }));
    if (memory.status === 'confirmed') memoryActions.append(actionButton(memory.reminderMuted ? '恢复主动提醒' : '已掌握，减少提醒', async () => {
      try { await db.setMemoryReminder(memory.id, !memory.reminderMuted); showToast(memory.reminderMuted ? '这条方法会重新参与主动建议。' : '仍会保留这条记忆，但不再主动反复提醒。'); await render(); }
      catch (error) { showToast(errorMessage(error), 'error'); }
    }, { variant: 'quiet' }));
    card.append(memoryActions);
    parent.append(card);
  };
  const groups: Array<[SystemMemory['type'], string]> = [
    ['constraint', '需要尊重的边界'],
    ['preference', '更适合我的方式'],
    ['strength', '已经证明的优势'],
    ['pattern', '反复出现的规律'],
    ['principle', '我认同的原则'],
  ];
  const guide = node('div', 'system-guide-groups');
  for (const [type, title] of groups) {
    const values = confirmed.filter((memory) => memory.type === type);
    if (!values.length) continue;
    const group = listSection(title, { className: `system-guide-group is-${type}` });
    values.forEach((memory) => appendMemory(group, memory, '已确认'));
    guide.append(group);
  }
  if (!confirmed.length) guide.append(emptyState('暂无规则'));
  section.append(guide);
  const pending = disclosure(`待你核对 · ${candidates.length}`, 'memory-candidates');
  pending.append(node('p', 'caption', '确认后生效'));
  candidates.forEach((memory) => appendMemory(pending, memory, '待确认'));
  section.append(pending);
  if (candidates.length + confirmed.length >= 2) {
    if (NATIVE_AI_READY) section.append(actionButton('检查重复内容', () => { void openSystemCandidateReview([...candidates, ...confirmed], events); }));
    else section.append(node('p', 'caption', '检查未连接'));
  }
  return section;
}

function aiPermissionSettings(): HTMLElement {
  const section = settingsDisclosure('AI 设置', 'ai-settings', settings.aiAllowed && NATIVE_AI_READY ? '已开启' : '已关闭');
  const availability = node('span', `ai-availability${NATIVE_AI_READY ? ' is-ready' : ''}`, NATIVE_AI_READY ? '● 可用' : '● 不可用');
  const intro = node('div', 'ai-settings-intro');
  intro.append(node('span', 'ai-intro-icon', 'AI'), node('p', '', 'AI 可以帮你整理记录、拆分目标和生成周回顾。每次发送前都能查看范围，它不会直接修改你的内容。'));
  const savedModel = canonicalAiModel(settings.aiModel);
  const permission = listRow('label', 'ui-control-row ai-permission-row');
  const permissionInput = node('input', 'ui-switch');
  permissionInput.type = 'checkbox';
  permissionInput.checked = NATIVE_AI_READY && settings.aiAllowed;
  permissionInput.disabled = !NATIVE_AI_READY;
  permission.append(node('span', '', '允许 AI 整理'), permissionInput);
  permissionInput.addEventListener('change', async () => {
    permissionInput.disabled = true;
    try {
      settings = await db.saveSettings({ aiAllowed: permissionInput.checked, previewBeforeSend: true });
      showToast(permissionInput.checked ? 'AI 整理权限已开启；发送范围按设置长期生效。' : 'AI 权限已关闭；不会再发送整理请求。');
    } catch (error) {
      permissionInput.checked = !permissionInput.checked;
      showToast(errorMessage(error), 'error');
    } finally {
      permissionInput.disabled = !NATIVE_AI_READY;
    }
  });

  const modelSelect = node('select', 'input');
  AVAILABLE_AI_MODELS.forEach((item) => {
    modelSelect.append(selectOption(item, item, item === savedModel));
  });
  const modelHint = node('span', 'caption ai-model-status');
  const modelRow = listRow('label', 'ui-control-row');
  modelRow.append(node('span', '', '模型'), modelSelect, modelHint);
  modelSelect.addEventListener('change', async () => {
    modelSelect.disabled = true;
    try {
      settings = await db.saveSettings({ aiModel: modelSelect.value as AppSettings['aiModel'] });
      showToast(`已切换模型为 ${modelSelect.value}。`);
      updateAiConfigStatus();
    } catch (error) {
      modelSelect.value = canonicalAiModel(settings.aiModel);
      showToast(errorMessage(error), 'error');
    } finally {
      modelSelect.disabled = false;
    }
  });

  const keyInput = node('input');
  keyInput.type = 'password';
  keyInput.inputMode = 'text';
  keyInput.placeholder = 'MiniMax API Key（可选）';
  keyInput.maxLength = 4_096;
  keyInput.autocomplete = 'new-password';
  const keyStatus = node('p', 'caption');
  const keyRow = listRow('label', 'ui-control-row');
  keyRow.append(node('span', '', '自定义 API Key'), keyInput);
  const keyActions = actionGroup('character-actions');
  const saveApiKey = actionButton('保存', undefined);
  const clearApiKey = actionButton('清除密钥', undefined, { variant: 'quiet' });
  keyActions.append(saveApiKey, clearApiKey);

  const health = node('span', 'ai-info-value');

  function updateAiConfigStatus() {
    const hasCustom = Boolean((settings.aiApiKey ?? '').trim());
    keyStatus.textContent = hasCustom ? '已保存自定义密钥，不会回显。' : '留空使用安装包密钥。';
    keyInput.placeholder = hasCustom ? '已配置自定义密钥（不回显）' : '输入 MiniMax API Key（可选）';
    modelHint.textContent = hasCustom ? '自定义密钥' : NATIVE_DIRECT_AI_READY ? '安装包密钥' : '需要自定义密钥';
    const ready = NATIVE_AI_READY;
    health.classList.toggle('is-ready', ready);
    health.textContent = !NATIVE_PLATFORM
      ? ready ? '可用' : '未配置'
      : ready
        ? '可用'
        : '不可用';
    permissionInput.checked = NATIVE_AI_READY && settings.aiAllowed;
    permissionInput.disabled = !NATIVE_AI_READY;
    check.disabled = !NATIVE_AI_READY;
  }

  saveApiKey.addEventListener('click', async () => {
    saveApiKey.disabled = true;
    try {
      const next = keyInput.value.trim();
      if (!next) {
        showToast('请输入要保存的 API Key。', 'error');
        return;
      }
      settings = await db.saveSettings({ aiApiKey: next });
      syncNativeAiAvailability();
      keyInput.value = '';
      showToast('自定义密钥已保存；下一次请求会优先使用该密钥。');
      updateAiConfigStatus();
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      saveApiKey.disabled = false;
    }
  });
  clearApiKey.addEventListener('click', async () => {
    clearApiKey.disabled = true;
    try {
      settings = await db.saveSettings({ aiApiKey: undefined });
      syncNativeAiAvailability();
      showToast('已清除自定义密钥。');
      updateAiConfigStatus();
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      clearApiKey.disabled = false;
    }
  });

  const check = actionButton('重新检查连接', undefined);
  check.disabled = !NATIVE_AI_READY;
  check.addEventListener('click', async () => {
    check.disabled = true;
    health.textContent = '正在检查连接…';
    try {
      let result = '';
      if (NATIVE_DIRECT_AI_READY) {
        await initializeNativeAi();
        result = '可用';
      } else if (NATIVE_PLATFORM && (settings.aiApiKey ?? '').trim()) {
        result = '可用';
      } else {
        const response = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
        const value = await response.json() as { configured?: boolean; model?: string; contractVersion?: string };
        if (value.configured) {
          result = '可用';
        } else {
          result = '服务可连接，但还没有配置可用密钥。';
        }
      }
      updateAiConfigStatus();
      health.textContent = result;
      health.classList.toggle('is-ready', result === '可用');
    } catch {
      health.textContent = '当前页面没有可用的 AI 配置；本地功能仍可完整使用。';
    } finally {
      check.disabled = false;
    }
  });

  const weeklyScope = optionalDetails('调整发送范围', 'weekly-scope-settings');
  const scopeLabels: Array<[keyof AppSettings['weeklyReviewScope'], string]> = [
    ['events', '已确认事件'],
    ['stateSnapshots', '状态摘要'],
    ['taskResults', '任务结果'],
    ['habits', '习惯坚持'],
    ['growth', '成长记录'],
    ['goals', '当前目标'],
    ['experiments', '既有周实验'],
    ['memories', '已保存的信息'],
  ];
  for (const [key, label] of scopeLabels) {
    const row = listRow('label', 'ui-control-row');
    const input = node('input');
    input.type = 'checkbox';
    input.checked = settings.weeklyReviewScope?.[key] ?? DEFAULT_WEEKLY_REVIEW_SCOPE[key];
    input.addEventListener('change', async () => {
      input.disabled = true;
      try {
        settings = await db.saveSettings({ weeklyReviewScope: { ...settings.weeklyReviewScope, [key]: input.checked } });
        showToast('周复盘默认包含的信息已保存。');
      } catch (error) {
        input.checked = !input.checked;
        showToast(errorMessage(error), 'error');
      } finally {
        input.disabled = false;
      }
    });
    row.append(node('span', '', label), input);
    weeklyScope.append(row);
  }

  const aiInfoRow = (icon: SemanticIcon, label: string, value: string | HTMLElement): HTMLElement => {
    return infoRow(label, value, { icon: semanticIcon(icon), multiline: true });
  };
  const serviceInfo = listGroup('ai-service-info');
  serviceInfo.append(
    aiInfoRow('provider', '服务方', 'MiniMax'),
    aiInfoRow('ai', '模型', savedModel),
    aiInfoRow('cost', '费用', '随应用提供'),
    aiInfoRow('connection', '连接状态', health),
    check,
  );
  const scopeSummary = listGroup('ai-scope-summary');
  scopeSummary.append(
    aiInfoRow('organize', '每日整理', '每次确认'),
    aiInfoRow('goal', '目标拆分', '仅当前目标'),
    aiInfoRow('weekly-review', '周回顾', '摘要，不含日记原文'),
  );
  const advanced = optionalDetails([
    semanticIcon('nav-settings', 'ai-advanced-icon'),
    node('span', '', '使用安装包提供的服务'),
  ], 'ai-advanced-settings');
  if (NATIVE_PLATFORM) advanced.append(modelRow, keyRow, keyActions, keyStatus);
  advanced.append(weeklyScope);
  const group = (title: string, content: HTMLElement): HTMLElement => {
    return listSection(title, {}, content);
  };
  section.append(
    availability, intro, permission, group('服务信息', serviceInfo),
    group('默认发送范围', scopeSummary),
    group('密钥与高级设置', advanced), node('p', 'caption ai-privacy-note', '内容只会按确认范围发送给所选服务方。'),
  );
  updateAiConfigStatus();
  return section;
}

async function installStorageSettings(): Promise<HTMLElement> {
  const section = settingsDisclosure('本地存储', 'install-storage-settings');
  const entries = await db.listEntries();
  const persisted = NATIVE_PLATFORM || (await navigator.storage?.persisted?.().catch(() => false) ?? false);
  const statusCard = node('div', 'ui-panel ui-storage-status');
  const statusIcon = node('span', 'ui-storage-status-icon', persisted ? '✓' : '!');
  statusIcon.setAttribute('aria-hidden', 'true');
  const statusCopy = node('div', 'ui-navigation-copy');
  const storageStatus = node('strong', '', persisted ? '状态正常' : '未开启存储保护');
  const statusDetail = node('span', 'caption', persisted ? '记录保存在此设备。' : '空间不足时，浏览器可能清理记录。');
  statusCopy.append(storageStatus, statusDetail);
  statusCard.append(statusIcon, statusCopy);
  section.append(statusCard);

  const stats = listGroup();
  const backupDate = node('span', 'caption');
  const updateBackupDate = (): void => {
    const value = localStorage.getItem('qiguang.last-backup-at');
    backupDate.textContent = value && Number.isFinite(Date.parse(value))
      ? formatDate(localDate(new Date(value))) : '尚未备份';
  };
  updateBackupDate();
  for (const [label, value] of [['记录', `${entries.length} 条`], ['图片', `${entries.filter((entry) => entry.imageDataUrl).length} 张`], ['最近备份', backupDate]] as const) {
    const row = listRow('div', 'ui-info-row');
    row.append(node('span', '', label), typeof value === 'string' ? node('span', 'caption', value) : value);
    stats.append(row);
  }
  const warning = node('aside', 'ui-panel ui-storage-warning');
  const warningIcon = node('span', '', '△');
  warningIcon.setAttribute('aria-hidden', 'true');
  warning.append(warningIcon, node('p', '', NATIVE_PLATFORM
    ? '卸载应用或清除应用数据会删除本机内容。' : '清除本站数据会删除本机内容。'));
  section.append(stats, warning);

  const installed = matchMedia('(display-mode: standalone)').matches;
  if (installPrompt && !installed) {
    const installStatus = node('p', 'caption');
    installStatus.hidden = true;
    const install = actionButton('安装栖光', async () => {
      if (!installPrompt) return;
      install.disabled = true;
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installPrompt = null;
      installStatus.hidden = false;
      installStatus.textContent = choice.outcome === 'accepted' ? '安装中' : '未安装，可从浏览器菜单重试';
      install.remove();
    });
    section.append(install, installStatus);
  }
  if (!NATIVE_PLATFORM && !persisted && navigator.storage?.persist) {
    const persist = actionButton('请求持久存储', async () => {
      persist.disabled = true;
      const granted = await navigator.storage.persist().catch(() => false);
      storageStatus.textContent = granted ? '状态正常' : '未开启存储保护';
      statusIcon.textContent = granted ? '✓' : '!';
      statusDetail.textContent = granted ? '记录保存在此设备。' : '浏览器未批准，请先导出备份。';
      if (granted) persist.remove(); else persist.disabled = false;
    });
    section.append(persist);
  }
  const backup = actionButton('导出备份', async () => {
    backup.disabled = true;
    try {
      await exportLocalBackup();
      updateBackupDate();
    } catch (error) { showToast(errorMessage(error), 'error'); }
    finally { backup.disabled = false; }
  }, { variant: 'primary', className: 'settings-primary-action' });
  section.append(backup);
  return section;
}

async function exportLocalBackup(): Promise<void> {
  const bundle = await db.exportBundle();
  const contents = JSON.stringify(bundle, null, 2);
  const filename = `qiguang-backup-${localDate()}.json`;
  if (Capacitor.isNativePlatform()) {
    const [{ Directory, Encoding, Filesystem }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'), import('@capacitor/share'),
    ]);
    await Filesystem.writeFile({ path: filename, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: '栖光备份', text: '保存或分享这份栖光本地备份。', files: [uri], dialogTitle: '保存栖光备份' });
    showToast('已交给系统保存或分享。');
  } else {
    const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('备份文件已生成，请妥善保存。');
  }
  localStorage.setItem('qiguang.last-backup-at', new Date().toISOString());
}

async function systemPage(): Promise<HTMLElement> {
  const [observations, profile, memories, events, entries] = await Promise.all([
    db.latestAssessment(), db.getProfile(), db.listMemories(), db.listJournalEvents(), db.listEntries(),
  ]);
  if (!profile) throw new Error('个人系统尚未初始化。');
  const main = node('main', 'page page-system');
  main.append(pageHeader('设置'));
  const profileSettings = profileForm(profile);
  const assessmentSettings = assessmentForm(observations);
  const aiSettings = aiPermissionSettings();
  const featureSettings = listSection('功能与设备', { className: 'settings-group', headingClassName: 'settings-group-title' }, aiSettings);
  const dataSettings = listSection('数据与隐私', { className: 'settings-group', headingClassName: 'settings-group-title' });
  const actionRuleSettings = disclosure('行动规则', 'system-advanced');
  actionRuleSettings.append(memorySettings(memories, events));

  const preferences = settingsDisclosure('显示与语气', 'display-settings');
  const motionLabel = listRow('label', 'ui-control-row');
  const motion = node('input');
  motion.type = 'checkbox';
  motion.className = 'ui-switch';
  motion.setAttribute('role', 'switch');
  motion.checked = settings.reduceMotion;
  motionLabel.append(node('span', '', '减少动态效果'), motion);
  preferences.append(motionLabel);
  let selectedTone = settings.guidanceTone;
  const toneRow = listRow('div', 'ui-control-row');
  const tone = segmentedControl('div', 'ui-tone-options');
  tone.setAttribute('role', 'group');
  tone.setAttribute('aria-label', '指导语气');
  const updateTone = (): void => {
    for (const button of tone.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.value === selectedTone));
    }
  };
  for (const [value, label, path] of [
    ['gentle', '温和', 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z'],
    ['direct', '直接', 'M21 11.5a9 9 0 0 1-9 9 10 10 0 0 1-4-.9L3 21l1.4-4.6A9 9 0 1 1 21 11.5Z'],
  ] as const) {
    const button = segmentedItem('button');
    button.value = value;
    const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    symbol.classList.add('ui-tone-icon');
    symbol.setAttribute('viewBox', '0 0 24 24');
    symbol.setAttribute('aria-hidden', 'true');
    const outline = document.createElementNS(symbol.namespaceURI, 'path');
    outline.setAttribute('d', path);
    symbol.append(outline);
    button.append(symbol, node('span', '', label));
    button.addEventListener('click', () => { selectedTone = value; updateTone(); });
    tone.append(button);
  }
  updateTone();
  toneRow.append(node('span', '', '指导语气'), tone);
  const savePreferences = actionButton('保存设置', async () => {
    savePreferences.disabled = true;
    try {
      settings = await db.saveSettings({ reduceMotion: motion.checked, guidanceTone: selectedTone });
      applySettings();
      savePreferences.closest('dialog')?.close();
      await render();
      showToast('设置已保存');
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally { savePreferences.disabled = false; }
  }, { variant: 'primary', className: 'settings-primary-action' });
  preferences.addEventListener('settings-detail-closed', () => {
    motion.checked = settings.reduceMotion;
    selectedTone = settings.guidanceTone;
    updateTone();
  });
  preferences.append(toneRow, savePreferences);

  const pinState = widgetPinState();
  let widgetSettings: HTMLElement | null = null;
  if (pinState !== 'unavailable') {
    const desktop = settingsDisclosure('今日任务小组件');
    widgetSettings = desktop;
    const desktopStatus = node('p', 'caption', pinState === 'pinned' ? '已添加' : '');
    desktopStatus.hidden = pinState !== 'pinned';
    desktop.append(desktopStatus);
    if (pinState === 'available') {
      const pin = actionButton('添加到桌面', () => {
        if (requestWidgetPin()) {
          sessionStorage.setItem('qiguang.widget-pin-pending', '1');
          pin.disabled = true;
          desktopStatus.hidden = false;
          desktopStatus.textContent = '请在系统窗口中确认添加。';
        } else {
          showToast('系统没有打开添加窗口，请从桌面小组件列表添加栖光。', 'error');
        }
      });
      desktop.append(pin);
    }
    featureSettings.append(desktop);
  }
  const notificationSettings = settingsDisclosure('通知与提醒');
  notificationSettings.append(node('p', 'muted', '栖光目前不会主动发送系统通知。任务和习惯只在应用内提醒。'));
  const notificationStatus = '已关闭';

  const data = settingsDisclosure('本地数据', 'data-actions');
  const exportButton = actionButton('导出全部数据', async () => {
    exportButton.disabled = true;
    try {
      await exportLocalBackup();
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      exportButton.disabled = false;
    }
  });
  const file = node('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      await importPreview(await readBackupFile(selected));
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      file.value = '';
    }
  });
  const importLabel = fileButton('导入备份', file);
  const backupDismissKey = `qiguang.backup-reminder-dismissed.${localDate()}`;
  const lastBackup = localStorage.getItem('qiguang.last-backup-at');
  const backupDue = entries.length > 0 && (!lastBackup || Date.now() - Date.parse(lastBackup) >= 30 * 86_400_000);
  if (backupDue && localStorage.getItem(backupDismissKey) !== '1') {
    data.open = true;
    const reminder = node('aside', 'gentle-reminder');
    reminder.append(node('strong', '', '建议现在导出一份备份'), node('p', 'caption', '下方“导出全部数据”会生成完整备份文件。'));
    const remindActions = node('div', 'gentle-reminder-actions');
    const later = actionButton('今天先不用', () => { localStorage.setItem(backupDismissKey, '1'); reminder.remove(); }, { variant: 'quiet' });
    remindActions.append(later); reminder.append(remindActions); data.append(reminder);
  }
  const transferActions = actionGroup('data-transfer-actions');
  transferActions.append(exportButton, importLabel);
  data.append(transferActions);
  const storageSettings = await installStorageSettings();
  featureSettings.append(storageSettings);
  dataSettings.append(data);
  const overviewGroup = (title: string): HTMLElement => {
    return listSection(title, { className: 'settings-overview-group' });
  };
  const personal = overviewGroup('个人');
  const assessedToday = Object.values(observations).some((item) => item?.localDate === localDate());
  personal.append(
    settingsOverviewRow('provider', '人物与陪伴', resolvedCompanionName(profile), profileSettings, profile.avatar),
    settingsOverviewRow('assessment', '状态自评', assessedToday ? '今天已评估' : '今天未评估', assessmentSettings),
    settingsOverviewRow('display-tone', '显示与语气', settings.guidanceTone === 'gentle' ? '温和' : '直接', preferences),
  );
  const features = overviewGroup('功能');
  features.append(settingsOverviewRow('ai', 'AI 整理', settings.aiAllowed && NATIVE_AI_READY ? '已开启 · MiniMax' : '已关闭', aiSettings));
  if (widgetSettings) features.append(settingsOverviewRow('widget', '今日任务小组件', pinState === 'pinned' ? '已添加' : '未添加', widgetSettings));
  features.append(settingsOverviewRow('notification', '通知与提醒', notificationStatus, notificationSettings));
  const privacy = overviewGroup('数据与隐私');
  privacy.append(
    settingsOverviewRow('storage', '本地存储', NATIVE_PLATFORM ? '正常' : '查看状态', storageSettings),
    settingsOverviewRow('transfer', '导入与导出', lastBackup ? `上次备份 ${formatDate(lastBackup.slice(0, 10))}` : '尚未备份', data),
    settingsOverviewRow('privacy', 'AI 发送范围', settings.previewBeforeSend ? '每次确认' : '按设置发送', aiSettings),
  );
  const advanced = overviewGroup('高级');
  advanced.append(settingsOverviewRow('rules', '行动规则', '', actionRuleSettings));
  const danger = infoRow('删除全部数据', '', { className: 'settings-overview-row is-danger', onOpen: () => { void deleteAllDialog(); } });
  advanced.append(danger);
  for (const group of [personal, features, privacy, advanced]) {
    const rows = listGroup();
    rows.append(...group.querySelectorAll(':scope > .ui-list-row'));
    group.append(rows);
  }
  main.append(personal, features, privacy, advanced);
  return main;
}

type AnalysisWeeks = 12 | 26 | 52;
type AnalysisHeatTone = 'empty' | 'missed' | 'skipped' | 'level-1' | 'level-2' | 'level-3' | 'level-4' | 'level-5';

function analysisRange(weeks: AnalysisWeeks): { start: string; end: string; gridEnd: string; previousStart: string; previousEnd: string } {
  const end = localDate();
  const weekday = parseLocalDate(end).getDay() || 7;
  const start = shiftDate(end, -(weekday - 1) - (weeks - 1) * 7);
  return { start, end, gridEnd: shiftDate(start, weeks * 7 - 1), previousStart: shiftDate(start, -weeks * 7), previousEnd: shiftDate(start, -1) };
}

function analysisRangeTabs(value: AnalysisWeeks, onChange: (value: AnalysisWeeks) => void): HTMLElement {
  const tabs = segmentedControl('div', 'analysis-range-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [weeks, label] of [[12, '12周'], [26, '半年'], [52, '全年']] as const) {
    const button = segmentedItem('button', label, { active: weeks === value });
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(weeks === value));
    button.addEventListener('click', () => onChange(weeks));
    tabs.append(button);
  }
  return tabs;
}

function analysisHeatmap(
  title: string,
  weeks: AnalysisWeeks,
  cellForDate: (date: string) => { tone: AnalysisHeatTone; label: string },
  habitLegend = false,
): HTMLElement {
  const period = analysisRange(weeks);
  const section = node('section', 'analysis-section analysis-heat-section');
  section.append(sectionHeading(title));
  const viewport = node('div', 'analysis-heat-scroll');
  const chart = node('div', 'analysis-heat-chart');
  chart.style.setProperty('--heat-weeks', String(weeks));
  const months = node('div', 'analysis-heat-months');
  let previousMonth = -1;
  for (let week = 0; week < weeks; week += 1) {
    const date = parseLocalDate(shiftDate(period.start, week * 7));
    const month = date.getMonth();
    if (month === previousMonth) continue;
    const label = node('span', '', ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month]);
    label.style.gridColumnStart = String(week + 1);
    months.append(label);
    previousMonth = month;
  }
  const body = node('div', 'analysis-heat-body');
  const weekdayLabels = node('div', 'analysis-weekday-labels');
  ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach((label) => weekdayLabels.append(node('span', '', label)));
  const cells = node('div', 'analysis-heat-cells');
  for (let offset = 0; offset < weeks * 7; offset += 1) {
    const date = shiftDate(period.start, offset);
    const value = date <= period.gridEnd ? cellForDate(date) : { tone: 'empty' as const, label: '' };
    const cell = node('span', `analysis-heat-cell is-${value.tone}${date === localDate() ? ' is-today' : ''}`);
    cell.title = value.label;
    cell.setAttribute('role', 'img');
    cell.setAttribute('aria-label', value.label);
    cells.append(cell);
  }
  body.append(weekdayLabels, cells);
  chart.append(months, body);
  viewport.append(chart);
  section.append(viewport);
  if (habitLegend) {
    const legend = node('div', 'analysis-heat-legend');
    legend.append(node('span', '', '少'));
    for (let level = 1; level <= 5; level += 1) legend.append(node('i', `is-level-${level}`));
    legend.append(node('span', '', '多'), node('i', 'is-missed'), node('span', '', '未完成'), node('i', 'is-empty'), node('span', '', '未计划'));
    section.append(legend);
  }
  return section;
}

function analysisPercent(value: number, total: number): number {
  return total ? Math.round(value / total * 100) : 0;
}

async function taskAnalysisPage(): Promise<HTMLElement> {
  const [allQuests, feedbacks, ledger] = await Promise.all([db.listQuests(), db.listQuestFeedback(), db.listXpLedger()]);
  const main = node('main', 'page page-analysis page-task-analysis');
  let weeks: AnalysisWeeks = 12;
  let category: 'all' | Dimension = 'all';
  const body = node('div', 'analysis-page-body');
  const categoryTabs = node('nav', 'analysis-category-tabs ui-filter-tabs');
  categoryTabs.setAttribute('aria-label', '五维筛选');
  main.append(pageHeader('任务分析', { back: true, fallback: { name: 'tasks' } }), categoryTabs, body);
  const activeFeedback = activeFeedbackByQuest(feedbacks);
  const rows = allQuests.filter((quest) => quest.sourceType !== 'habit' && !quest.systemRetiredAt).flatMap((quest) => {
    const feedback = activeFeedback.get(quest.id);
    const result = feedback?.result ?? (quest.status === 'pending' ? undefined : quest.status);
    return result ? [{ quest, result, date: feedback?.completedDate ?? quest.localDate }] : [];
  });

  const renderBody = (): void => {
    const period = analysisRange(weeks);
    const current = rows.filter(({ quest, date }) => date >= period.start && date <= period.end && (category === 'all' || quest.dimension === category));
    const completed = current.filter(({ result }) => result === 'completed');
    const questIds = new Set(current.map(({ quest }) => quest.id));
    const xp = ledger.filter((item) => !item.reversedAt && item.sourceType === 'quest' && questIds.has(item.sourceId)
      && item.localDate >= period.start && item.localDate <= period.end).reduce((sum, item) => sum + item.finalXp, 0);
    categoryTabs.replaceChildren();
    const dimensions: Array<readonly ['all' | Dimension, string]> = [['all', '全部'], ...DIMENSIONS.map((item) => [item.key, item.label] as const)];
    for (const [key, label] of dimensions) {
      const tab = segmentedItem('button', label, { active: category === key, className: 'ui-filter-item' });
      tab.setAttribute('aria-current', category === key ? 'page' : 'false');
      tab.addEventListener('click', () => { category = key; renderBody(); });
      categoryTabs.append(tab);
    }
    const summary = metricGroup([
      ['完成', `${completed.length} 项`],
      ['成长值', `+${xp}`],
    ], { className: 'analysis-summary-grid' });
    body.replaceChildren(analysisRangeTabs(weeks, (value) => { weeks = value; renderBody(); }), summary);
    const daily = new Map<string, number>();
    completed.forEach(({ date }) => daily.set(date, (daily.get(date) ?? 0) + 1));
    body.append(analysisHeatmap(`最近${weeks}周`, weeks, (date) => {
      const done = daily.get(date) ?? 0;
      return { tone: done ? `level-${Math.min(4, done)}` as AnalysisHeatTone : 'empty', label: `${formatDate(date)}：完成 ${done} 项` };
    }));
    const categories = node('section', 'analysis-category-section');
    categories.setAttribute('aria-label', '五维完成');
    for (const { key, label } of DIMENSIONS) {
      const values = completed.filter(({ quest }) => quest.dimension === key);
      const row = listRow('button', 'ui-info-row analysis-category-row');
      row.type = 'button';
      row.append(node('strong', '', label), node('span', 'analysis-category-value', `完成 ${values.length} 项 ›`));
      row.addEventListener('click', () => {
        const { dialog, content, actions } = dialogShell(`${label}已完成任务`, { back: true, fullScreen: true });
        if (!values.length) content.append(emptyState('暂无已完成任务'));
        const completedList = listGroup();
        content.append(completedList);
        values.forEach(({ quest, date }) => {
          completedList.append(infoRow(quest.title, formatDate(date), { multiline: true }));
        });
        actions.remove();
        dialog.showModal();
      });
      categories.append(row);
    }
    body.append(categories);
  };
  renderBody();
  return main;
}

function habitAnalysisSchedule(habit: Habit, date: string): { scheduleDays: number[]; trackingEnabled: boolean } | undefined {
  if (habit.scheduleHistory?.length) return [...habit.scheduleHistory].sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom)).find((period) => period.effectiveFrom <= date);
  if (date < localDate(new Date(habit.createdAt))) return undefined;
  return { scheduleDays: habit.scheduleDays, trackingEnabled: habit.status === 'active' && habit.bonusEnabled };
}

function habitScheduleLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((left, right) => left - right);
  if (sorted.join(',') === '1,2,3,4,5,6,7') return '每天';
  if (sorted.join(',') === '1,2,3,4,5') return '周一至周五';
  return sorted.map((day) => `周${'一二三四五六日'[day - 1]}`).join('、');
}

function habitPeriodStats(habit: Habit, logs: HabitLog[], start: string, end: string): { planned: number; completed: number; rate: number } {
  let planned = 0;
  let completed = 0;
  for (let date = start; date <= end; date = shiftDate(date, 1)) {
    const schedule = habitAnalysisSchedule(habit, date);
    if (!schedule?.trackingEnabled || !schedule.scheduleDays.includes(parseLocalDate(date).getDay() || 7)) continue;
    planned += 1;
    if (logs.some((log) => log.habitId === habit.id && log.localDate === date && log.result === 'completed')) completed += 1;
  }
  return { planned, completed, rate: analysisPercent(completed, planned) };
}

async function habitAnalysisOverviewPage(habits: Habit[], logs: HabitLog[]): Promise<HTMLElement> {
  const main = node('main', 'page page-analysis page-habit-analysis page-habit-analysis-overview');
  main.append(pageHeader('习惯分析', { back: true, fallback: { name: 'tasks' } }));
  const active = habits.filter((habit) => habit.status !== 'ended');
  const end = localDate();
  const start = shiftDate(end, -27);
  const range = node('div', 'habit-overview-period');
  range.append(node('span', '', '近四周'), node('span', '', `${formatDate(start)} — ${formatDate(end)}`));
  main.append(range);

  const list = node('section', 'habit-comparison-list');
  const heading = node('div', 'habit-comparison-heading');
  const weekLabels = node('span');
  Array.from({ length: 4 }, (_, week) => shiftDate(start, week * 7).slice(5).replace('-', '.'))
    .forEach((label) => weekLabels.append(node('span', '', label)));
  heading.append(node('span', 'habit-comparison-name', '习惯'), weekLabels, node('span', 'habit-comparison-total', '完成率'));
  list.append(heading);
  if (!active.length) list.append(emptyState('暂无习惯'));
  active.forEach((habit) => {
    const row = listRow('button', 'ui-data-row habit-comparison-row');
    row.type = 'button';
    row.setAttribute('aria-label', `查看${habit.name}的习惯分析`);
    const copy = node('span', 'habit-comparison-copy');
    const icon = node('img', 'habit-comparison-icon') as HTMLImageElement;
    icon.src = habitImage(habit);
    icon.alt = '';
    copy.append(node('span', '', habit.name));
    const total = habitPeriodStats(habit, logs, start, end);
    const weeksRow = node('span', 'habit-comparison-weeks');
    for (let week = 0; week < 4; week += 1) {
      const weekStart = shiftDate(start, week * 7);
      const value = habitPeriodStats(habit, logs, weekStart, shiftDate(weekStart, 6));
      weeksRow.append(node('span', '', `${value.completed}/${value.planned}`));
    }
    const score = node('span', 'habit-comparison-score');
    score.append(node('strong', '', `${total.rate}%`));
    row.append(copy, weeksRow, score);
    row.addEventListener('click', () => go({ name: 'habit-analysis', entityId: habit.id }));
    list.append(row);
  });
  main.append(list);
  return main;
}

async function habitAnalysisPage(habitId: string): Promise<HTMLElement> {
  await db.ensureTodayBonusQuests(localDate());
  const [habits, logs] = await Promise.all([db.listHabits(), db.listHabitLogs(habitId || undefined)]);
  if (!habitId) return habitAnalysisOverviewPage(habits, logs);
  const habit = habits.find((item) => item.id === habitId);
  const main = node('main', 'page page-analysis page-habit-analysis');
  const header = pageHeader(habit ? `${habit.name}分析` : '习惯分析', { back: true, fallback: { name: 'tasks' } });
  header.classList.add('ui-titlebar-with-filter');
  main.append(header);
  if (!habit) { main.append(emptyState('习惯不存在')); return main; }
  const logByDate = new Map(logs.map((log) => [log.localDate, log]));
  let weeks: AnalysisWeeks = 12;
  const body = node('div', 'analysis-page-body');
  main.append(body);
  const renderBody = (): void => {
    const period = analysisRange(weeks);
    const plannedDates: string[] = [];
    for (let date = period.start; date <= period.end; date = shiftDate(date, 1)) {
      const schedule = habitAnalysisSchedule(habit, date);
      if (schedule?.trackingEnabled && schedule.scheduleDays.includes(parseLocalDate(date).getDay() || 7)) plannedDates.push(date);
    }
    const completed = plannedDates.filter((date) => logByDate.get(date)?.result === 'completed').length;
    const summary = metricGroup([
      ['完成天数', `${completed} 天`],
      ['完成率', `${analysisPercent(completed, plannedDates.length)}%`],
    ], { className: 'habit-focus-summary', itemClassName: 'habit-focus-rate' });
    header.querySelector('.analysis-range-tabs')?.remove();
    const rangeTabs = analysisRangeTabs(weeks, (value) => { weeks = value; renderBody(); });
    rangeTabs.classList.add('ui-segmented-inline');
    header.append(rangeTabs);
    body.replaceChildren(summary);
    const plannedSet = new Set(plannedDates);
    const heat = analysisHeatmap('完成情况', weeks, (date) => {
      if (!plannedSet.has(date)) return { tone: 'empty', label: `${formatDate(date)}：未计划` };
      const log = logByDate.get(date);
      if (log?.result !== 'completed') return { tone: 'missed', label: `${formatDate(date)}：未完成` };
      return { tone: 'level-5', label: `${formatDate(date)}：已完成` };
    });
    body.append(heat);
    const weekdays = node('section', 'analysis-section habit-weekday-section');
    weekdays.append(sectionHeading('按星期看'));
    const chart = node('div', 'habit-weekday-chart');
    for (let day = 1; day <= 7; day += 1) {
      const dates = plannedDates.filter((date) => (parseLocalDate(date).getDay() || 7) === day);
      const done = dates.filter((date) => logByDate.get(date)?.result === 'completed').length;
      const rate = analysisPercent(done, dates.length);
      const column = node('div', 'habit-weekday-column');
      column.style.setProperty('--weekday-opacity', String(.12 + rate / 150));
      column.append(node('span', '', '一二三四五六日'[day - 1]), node('strong', '', dates.length ? `${rate}%` : '—'));
      chart.append(column);
    }
    weekdays.append(chart);
    body.append(weekdays);
  };
  renderBody();
  return main;
}

function applySettings(): void {
  const systemReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion || systemReduced);
}

async function pageFor(route: Route): Promise<HTMLElement> {
  switch (route.name) {
    case 'today': return todayPage();
    case 'calendar': return calendarPage();
    case 'record': return recordPage(route);
    case 'day': return dayPage(route.date ?? localDate());
    case 'tasks': return tasksPage();
    case 'task-analysis': return taskAnalysisPage();
    case 'habit-analysis': return habitAnalysisPage(route.entityId ?? '');
    case 'growth': return growthPage();
    case 'review': return weeklyReviewPage(route.date ?? localDate());
    case 'system': return systemPage();
    default: throw new Error('未知页面。');
  }
}

async function refreshWidgetSnapshot(): Promise<void> {
  const date = localDate();
  const quests = await db.listQuests(date);
  saveWidgetSnapshot(buildWidgetSnapshot({ quests, localDate: date, generatedAt: new Date().toISOString() }));
}

async function render(): Promise<void> {
  const token = ++renderToken;
  currentRoute = parseRoute();
  try {
    const page = await pageFor(currentRoute);
    if (token !== renderToken) return;
    renderShell(page, currentRoute);
    await refreshWidgetSnapshot();
  } catch (error) {
    if (token !== renderToken) return;
    const main = node('main', 'page');
    main.append(pageHeader('暂时无法打开这一页', { meta: '本地数据' }));
    const card = node('section', 'surface error-state');
    card.append(node('p', '', errorMessage(error)), primaryButton('重试', () => { void render(); }));
    main.append(card);
    renderShell(main, currentRoute);
  }
}

function renderDatabaseFailure(error: unknown): void {
  const main = node('main', 'page database-error');
  main.id = 'main-content';
  main.append(pageHeader('无法安全打开栖光', { meta: '本地数据' }));
  const card = node('section', 'surface error-state');
  card.append(node('p', '', errorMessage(error)), node('p', 'muted', '没有进行写入。请先关闭其他页面后重试；也可以用备份替换本地数据。'));
  const actions = actionGroup('database-recovery-actions');
  actions.append(primaryButton('重新打开', () => { location.reload(); }));
  const file = node('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      const text = await readBackupFile(selected);
      const backup = parseBackup(text);
      const confirmed = await confirmAction(
        '用备份替换本地数据？',
        `备份包含 ${backup.data.entries.length} 条记录。栖光会先验证备份，再替换当前本地数据。`,
        '确认替换',
        true,
      );
      if (!confirmed) return;
      file.disabled = true;
      db?.close();
      db = await QiguangDb.restoreFromBackup(text);
      settings = await db.getSettings();
      syncNativeAiAvailability();
      applySettings();
      history.replaceState(null, '', '#/today');
      await render();
      showToast('本地数据库已从备份恢复。');
    } catch (restoreError) {
      file.disabled = false;
      showToast(errorMessage(restoreError), 'error');
    } finally {
      file.value = '';
    }
  });
  const importLabel = fileButton('从备份恢复', file);
  actions.append(importLabel);
  card.append(actions, node('p', 'danger-copy', '只有在确认当前数据无法恢复时，才使用备份替换。'));
  main.append(card);
  root.replaceChildren(main);
}

interface WidgetActionResult { message: string; achievementsBefore?: Set<string> }

async function applyPendingWidgetAction(): Promise<WidgetActionResult | null> {
  const widgetAction = consumeWidgetAction();
  if (!widgetAction) return null;
  if (widgetAction.type === 'open') {
    history.replaceState(null, '', `#/${widgetAction.route}`);
    if (widgetAction.route === 'tasks' && widgetAction.questId) focusAfterRenderSelector = `[data-quest-id="${CSS.escape(widgetAction.questId)}"]`;
    return { message: '' };
  }
  const quest = (await db.listQuests()).find((item) => item.id === widgetAction.questId);
  let notice = '这项任务已经处理过，没有重复结算成长值。';
  let achievementsBefore: Set<string> | undefined;
  if (quest?.status === 'pending') {
    if (quest.targetCount && (quest.progressCount ?? 0) + 1 < quest.targetCount) {
      const updated = await db.changeQuestProgress(quest.id, 1);
      history.replaceState(null, '', '#/tasks');
      return { message: `已记录 ${updated.progressCount}/${quest.targetCount}${quest.countUnit || '次'}。` };
    }
    achievementsBefore = await growthBadgeIds();
    const before = await questProgress(quest);
    const progression = await db.feedbackAndProgressQuest(quest.id, 'completed', '由今日任务小组件勾选完成', '', quest.difficulty, 0, localDate());
    notice = await feedbackSettlementMessage(quest, 'completed', '', progression, '已从今日任务小组件完成；成长值已结算，可在任务板撤销。', before);
    sessionStorage.setItem('qiguang.character-celebration', quest.id);
  }
  history.replaceState(null, '', '#/tasks');
  return { message: notice, achievementsBefore };
}

async function refreshFromWidgetAction(): Promise<void> {
  try {
    const notice = await applyPendingWidgetAction();
    if (notice === null) return;
    currentRoute = parseRoute();
    previousRouteKey = routeKey(currentRoute);
    await render();
    if (notice.message) {
      if (notice.achievementsBefore) await announceNewGrowthBadge(notice.achievementsBefore, notice.message, true);
      else showToast(notice.message);
    }
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
}

async function start(): Promise<void> {
  try {
    await initializeNativeAi();
    db = await QiguangDb.open();
    await db.ensureI2Defaults();
    settings = await db.getSettings();
    syncNativeAiAvailability();
    applySettings();
    const widgetNotice = await applyPendingWidgetAction();
    currentRoute = parseRoute();
    previousRouteKey = routeKey(currentRoute);
    await render();
    if (widgetNotice?.message) {
      if (widgetNotice.achievementsBefore) await announceNewGrowthBadge(widgetNotice.achievementsBefore, widgetNotice.message, true);
      else showToast(widgetNotice.message);
    }
    if (!settings.onboardingSeen) showOnboarding();
  } catch (error) {
    renderDatabaseFailure(error);
  }
}

window.addEventListener('qiguang-widget-action', () => { void refreshFromWidgetAction(); });

const verifyWidgetPin = () => {
  if (currentRoute.name !== 'system' || sessionStorage.getItem('qiguang.widget-pin-pending') !== '1') return;
  window.setTimeout(() => {
    sessionStorage.removeItem('qiguang.widget-pin-pending');
    const pinned = widgetPinState() === 'pinned';
    document.querySelector<HTMLDialogElement>('.settings-detail-dialog[open]')?.close();
    void render().then(() => showToast(pinned ? '桌面小组件已添加。' : '没有检测到小组件；可以重新添加，或从桌面小组件列表选择栖光。', pinned ? 'normal' : 'error'));
  }, 300);
};
window.addEventListener('qiguang-native-resume', verifyWidgetPin);
window.addEventListener('focus', verifyWidgetPin);

window.addEventListener('hashchange', () => {
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((dialog) => dialog.close());
  sessionStorage.setItem(`qiguang.scroll.${previousRouteKey}`, String(window.scrollY));
  previousRouteKey = routeKey(parseRoute());
  routeNavigationPending = true;
  void render();
});
const focusMainContent = () => {
  skipFocusRequested = true;
  routeNavigationPending = false;
  const focusMain = () => {
    const target = document.querySelector<HTMLElement>('#main-content');
    if (target) target.focus({ preventScroll: false });
    else requestAnimationFrame(focusMain);
  };
  focusMain();
  requestAnimationFrame(() => requestAnimationFrame(focusMain));
};
document.querySelector<HTMLAnchorElement>('.skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  focusMainContent();
});
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (event.key === 'Enter' && target?.closest('.skip-link')) {
    event.preventDefault();
    focusMainContent();
  }
});
window.addEventListener('online', () => {
  document.querySelectorAll<HTMLElement>('[data-network-badge]').forEach((badge) => {
    badge.textContent = '本地可用'; badge.classList.remove('is-offline');
  });
});
window.addEventListener('offline', () => {
  document.querySelectorAll<HTMLElement>('[data-network-badge]').forEach((badge) => {
    badge.textContent = '离线 · 本地可用'; badge.classList.add('is-offline');
  });
});
window.addEventListener('beforeunload', (event) => {
  if (!draftNeedsUnloadWarning) return;
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('unhandledrejection', (event) => showToast(errorMessage(event.reason), 'error'));

window.addEventListener('beforeinstallprompt', ((event: InstallPromptEvent) => {
  event.preventDefault();
  installPrompt = event;
  if (currentRoute.name === 'system') void render();
}) as EventListener);
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  showToast('栖光已经安装；本地数据仍保存在当前浏览器空间。');
});

function showUpdateNotice(registration: ServiceWorkerRegistration): void {
  if (!registration.waiting || document.querySelector('[data-update-notice]')) return;
  const notice = node('aside', 'update-notice');
  notice.dataset.updateNotice = 'true';
  notice.setAttribute('role', 'status');
  const copy = node('div');
  copy.append(node('strong', '', '新版本已准备好'));
  const update = actionButton('更新并重新打开', undefined);
  update.addEventListener('click', () => {
    if (draftNeedsUnloadWarning) { showToast('草稿尚未安全保存，请先复制正文再更新。', 'error'); return; }
    update.disabled = true;
    updateAcceptedInThisTab = true;
    registration.waiting?.postMessage('SKIP_WAITING');
  });
  const later = actionButton('稍后', () => notice.remove(), { variant: 'quiet' });
  notice.append(copy, update, later);
  document.body.append(notice);
}

async function registerPwa(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV || Capacitor.isNativePlatform()) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter((item) => item.scope.startsWith(location.origin)).map((item) => item.unregister()));
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('qiguang-shell-')).map((name) => caches.delete(name)));
    }
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    if (registration.waiting && navigator.serviceWorker.controller) showUpdateNotice(registration);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateNotice(registration);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updateAcceptedInThisTab) return;
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      location.reload();
    });
  } catch {
    // PWA 安装失败不应阻止本地记录；系统页仍保留导出说明。
  }
}

void start().finally(() => { void registerPwa(); });

