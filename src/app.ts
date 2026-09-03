import { QiguangDb, migrateLegacyJournalContent, parseBackup } from './db.ts';
import {
  DEFAULT_WEEKLY_REVIEW_SCOPE,
  DIMENSIONS,
  type AnalysisJob,
  type AppSettings,
  type DailyAnalysis,
  type Dimension,
  type Goal,
  type Habit,
  type HabitLog,
  type JournalEvent,
  type JournalEntry,
  type Milestone,
  type Profile,
  type Quest,
  type QuestFeedback,
  type Review,
  type ResolvedDimensionState,
  type StateObservation,
  type SystemMemory,
  dimensionLabel,
  formatDate,
  isLocalDate,
  localDate,
  parseLocalDate,
  shiftDate,
  stateBand,
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
import maleAvatarImage from '../design-assets/pre-development/avatar-male-cartoon.png';
import femaleAvatarImage from '../design-assets/pre-development/avatar-female-cartoon.png';
import roomBackgroundImage from '../design-assets/pre-development/room-background.png';
import maleMotionAtlas from '../design-assets/pre-development/character-motion-male-runtime.png';
import femaleMotionAtlas from '../design-assets/pre-development/character-motion-female-runtime.png';
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

const motionAtlases = { male: maleMotionAtlas, female: femaleMotionAtlas } as const;
const motionFramePreloads = new Map<Exclude<Profile['avatar'], null>, Promise<void>>();

type RouteName = 'today' | 'calendar' | 'record' | 'tasks' | 'growth' | 'system' | 'day' | 'review' | 'task-analysis' | 'habit-analysis';
type SemanticIcon = 'nav-today' | 'nav-tasks' | 'nav-record' | 'nav-growth' | 'nav-settings' | 'calendar'
  | 'success-record' | 'habit' | 'weekly-review' | 'goal' | 'rules' | 'ai' | 'cost' | 'connection'
  | 'notification' | 'storage' | 'transfer' | 'privacy' | 'delete' | 'assessment'
  | 'display-tone' | 'widget' | 'search' | 'task-focus' | 'experience' | 'provider' | 'organize';
interface Route { name: RouteName; date?: string; entityId?: string }
type RoomCue = 'rest' | 'focus' | 'play';
type SnapshotVariant = 'steady' | 'rest' | 'focus' | 'play' | 'connection' | 'bright';
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface RecordDraft {
  body: string;
  kind: NonNullable<JournalEntry['kind']>;
  summary: string;
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
const ROOM_GUIDE_KEY = 'qiguang.room-guide-seen.v1';
const INTERRUPTED_TAKEOVER_MS = 2 * 60_000;
const SUCCESS_PROMPT = '今天做成、推进、坚持或照顾好了什么？';
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
const FURNITURE_APPROACH_MS = 960;
const FURNITURE_USE_MS = 720;
const FURNITURE_RETURN_MS = 920;
const AMBIENT_SETTLE_MS = 6_300;
const IDLE_GESTURE_MS = 1_200;
const NATIVE_PLATFORM = Capacitor.isNativePlatform();
const NATIVE_AI_UNAVAILABLE = 'AI 未配置';
const BASE_AI_READY = !NATIVE_PLATFORM || (() => {
  try { return new URL(API_ORIGIN).protocol === 'https:'; } catch { return false; }
})();
let NATIVE_DIRECT_AI_READY = false;
let NATIVE_AI_MODEL = 'MiniMax-M3';
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
  NATIVE_AI_MODEL = configuration.model;
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
  if (target instanceof Element && target.closest('.room-hotspot.is-character')) return;
  const trigger = root.querySelector<HTMLButtonElement>('.room-hotspot.is-character');
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
  return avatar === 'male' ? maleAvatarImage : femaleAvatarImage;
}

function avatarName(avatar: Profile['avatar']): string {
  return avatar === 'male' ? '包包' : '鱼鱼';
}

function resolvedCompanionName(profile: Profile | undefined): string {
  const saved = profile?.companionName.trim();
  return saved && saved !== '小栖' ? saved : avatarName(profile?.avatar ?? null);
}

function preloadMotionFrames(avatar: Exclude<Profile['avatar'], null>, url: string): Promise<void> {
  const cached = motionFramePreloads.get(avatar);
  if (cached) return cached;
  const preload = new Promise<void>((resolve) => {
    const image = new Image();
    image.addEventListener('load', () => { void image.decode().catch(() => undefined).finally(resolve); }, { once: true });
    image.addEventListener('error', () => resolve(), { once: true });
    image.src = url;
  });
  motionFramePreloads.set(avatar, preload);
  return preload;
}

function applyMotionFrames(character: HTMLElement, avatar: Exclude<Profile['avatar'], null>): Promise<void> {
  const atlas = motionAtlases[avatar];
  character.style.setProperty('--motion-atlas', `url("${atlas}")`);
  const ready = preloadMotionFrames(avatar, atlas);
  void ready.then(() => character.classList.add('is-motion-ready'));
  return ready;
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

function iconButton(label: string, icon: SemanticIcon | null, onClick: () => void, className = 'button button-secondary'): HTMLButtonElement {
  const button = node('button', className);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  if (icon) button.append(semanticIcon(icon));
  button.append(node('span', '', label));
  button.addEventListener('click', onClick);
  return button;
}

function primaryButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = node('button', 'button button-primary', label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
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
  tone: 'normal' | 'error' = 'normal',
  action?: { label: string; run: () => void },
): void {
  document.querySelector('.toast-layer, .toast')?.remove();
  window.clearTimeout(toastTimer);
  const toast = node('div', `toast${tone === 'error' ? ' is-error' : ''}`);
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
  if (action) {
    const layer = node('div', 'toast-layer');
    layer.addEventListener('click', (event) => { if (event.target === layer) removeToast(); });
    layer.append(toast);
    document.body.append(layer);
  } else document.body.append(toast);
  toastTimer = window.setTimeout(removeToast, action ? 8_000 : 3_600);
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
          memoryDrafts[date] = { ...migrateLegacyJournalContent(value), summary: '' };
          migratedLegacyDraft = true;
        }
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
          const draft = value as Partial<RecordDraft>;
          if (typeof draft.body === 'string' && draft.body.length <= 12_000) {
            const summary = typeof draft.summary === 'string' && draft.summary.length <= 120 ? draft.summary : '';
            if (draft.kind === 'journal' || draft.kind === 'success' || draft.kind === 'fun') memoryDrafts[date] = { body: draft.body, kind: draft.kind, summary };
            else { memoryDrafts[date] = { ...migrateLegacyJournalContent(draft.body), summary }; migratedLegacyDraft = true; }
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
    draftNeedsUnloadWarning = Object.values(memoryDrafts).some((draft) => Boolean(draft.body || draft.summary));
  }
}

function readDraft(date: string): RecordDraft {
  loadDrafts();
  return memoryDrafts[date] ?? { body: '', kind: 'journal', summary: '' };
}

function saveDraft(date: string, body: string, kind: RecordDraft['kind'], summary?: string): void {
  loadDrafts();
  const savedSummary = summary ?? memoryDrafts[date]?.summary ?? '';
  if (body || savedSummary || kind === 'success') memoryDrafts[date] = { body, kind, summary: savedSummary };
  else delete memoryDrafts[date];
  persistDrafts();
}

function openSuccessRecord(date: string): void {
  const draft = readDraft(date);
  if (draft.kind === 'journal' && draft.body.trim()) {
    go({ name: 'record', date });
    showToast('当前记录草稿仍在；请先保存或清空，再写一条成功小记。');
    return;
  }
  saveDraft(date, draft.body, 'success', draft.summary);
  go({ name: 'record', date });
}

function clearDraft(date?: string): void {
  loadDrafts();
  if (date) delete memoryDrafts[date];
  else memoryDrafts = {};
  persistDrafts();
}

function pageHeader(kicker: string, title: string, action?: HTMLElement): HTMLElement {
  const header = node('header', 'page-header');
  const copy = node('div');
  const heading = node('h1', '', title);
  heading.tabIndex = -1;
  copy.append(heading);
  header.append(copy);
  if (action) header.append(action);
  else if (kicker && kicker !== title) header.append(node('span', 'page-header-meta', kicker));
  return header;
}

function secondaryPageHeader(title: string, action?: HTMLElement, fallback: Route = { name: 'today' }): HTMLElement {
  const header = node('header', 'page-header secondary-page-header');
  const back = node('button', 'secondary-back', '←');
  back.type = 'button';
  back.setAttribute('aria-label', '返回');
  back.addEventListener('click', () => history.length > 1 ? history.back() : go(fallback));
  const heading = node('h1', '', title);
  heading.tabIndex = -1;
  header.append(back, heading);
  if (action) header.append(action);
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
  const items: Array<[RouteName, string, SemanticIcon]> = [
    ['today', '今日', 'nav-today'],
    ['tasks', '任务', 'nav-tasks'],
    ['record', '记录', 'nav-record'],
    ['growth', '轨迹', 'nav-growth'],
    ['system', '设置', 'nav-settings'],
  ];
  for (const [name, label, icon] of items) {
    const active = route.name === name || (name === 'growth' && ['calendar', 'day', 'review'].includes(route.name));
    const link = node('a', `nav-item${active ? ' is-active' : ''}`);
    link.href = `#/${name}`;
    if (active) link.setAttribute('aria-current', 'page');
    link.append(semanticIcon(icon), node('span', '', label));
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
  if (!secondary) shell.append(bottomNavigation(route));
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
    const target = focusRecordInputOnNextRender ? main.querySelector<HTMLElement>('.journal-input') : main.querySelector<HTMLElement>('h1');
    focusRecordInputOnNextRender = false;
    target?.focus({ preventScroll: true });
  });
}

function companionMessage(welcoming: boolean, cue: RoomCue | null, hasMainQuest: boolean): string {
  if (settings.guidanceTone === 'direct') {
    if (welcoming) return '先记录最近发生的一件事，再决定下一步。';
    if (cue === 'rest') return '今天先做一个轻量恢复动作。';
    if (cue === 'focus') return '先完成今天这一步的最小版本。';
    if (cue === 'play') return '安排一点不带产出的兴趣时间。';
    return hasMainQuest ? '先处理今天最值得做的一步。' : '先从一件真实的小事开始。';
  }
  if (welcoming) return '你回来啦。先把最近发生的一件事放下吧。';
  if (cue === 'rest') return '先缓一缓，今天只做一件轻一点的事也可以。';
  if (cue === 'focus') return '今天这一步还在这儿。先做最小版本吧。';
  if (cue === 'play') return '给自己留一点有趣的空白，今天才更像生活。';
  return hasMainQuest ? '今天最值得做的一步已经在等你了。' : '我在。今天想从哪里开始？';
}

function confirmFirstRoomInteraction(): Promise<boolean> {
  if (localStorage.getItem(ROOM_GUIDE_KEY) === '1') return Promise.resolve(true);
  return new Promise((resolve) => {
    const { dialog, content, actions } = dialogShell('这个房间可以互动');
    content.append(node('p', '', '点小人看建议；点家具去页面。'));
    let settled = false;
    const finish = (continueAction: boolean): void => {
      if (settled) return;
      settled = true;
      if (continueAction) localStorage.setItem(ROOM_GUIDE_KEY, '1');
      dialog.close();
      resolve(continueAction);
    };
    const later = node('button', 'button button-secondary', '先不操作');
    later.type = 'button';
    later.addEventListener('click', () => finish(false));
    const continueButton = node('button', 'button button-primary', '知道了，继续');
    continueButton.type = 'button';
    continueButton.addEventListener('click', () => finish(true));
    dialog.addEventListener('close', () => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, { once: true });
    actions.append(later, continueButton);
    dialog.showModal();
    continueButton.focus();
  });
}

function roomStage(compact = false, avatar: Profile['avatar'] = null, companionName = '鱼鱼', welcoming = false, cue: RoomCue | null = null, snapshotDate: string | null = null, hasMainQuest = false, achievementCount = 0, guidance: { title: string; reason: string; settled?: boolean } | null = null, companionContext: string[] = []): HTMLElement {
  const stage = node('section', `room-stage${compact ? ' is-compact' : ''}`);
  if (snapshotDate) stage.dataset.snapshotDate = snapshotDate;
  stage.setAttribute('aria-label', '温暖的像素房间：包含日记桌、任务板、日历、书架工作台、窗边床铺和生活分身。所有功能也能通过普通导航进入。');
  const scene = node('div', 'room-scene');
  const hour = new Date().getHours();
  const ambientAction = snapshotDate ? null : roomAmbientAction();
  scene.style.setProperty('--room-background', `url("${roomBackgroundImage}")`);
  scene.classList.add(snapshotDate ? 'is-day' : hour < 6 ? 'is-night' : hour < 12 ? 'is-morning' : hour < 18 ? 'is-day' : 'is-evening');
  if (cue) scene.classList.add(`is-cue-${cue}`);
  scene.setAttribute('aria-hidden', 'true');
  scene.append(node('div', 'room-lamp'));
  if (!compact && achievementCount > 0) {
    const displayStage = achievementCount >= 20 ? 4 : achievementCount >= 8 ? 3 : achievementCount >= 3 ? 2 : 1;
    const trophy = node('div', `room-achievement is-stage-${displayStage}`, '✦');
    trophy.dataset.stage = String(displayStage);
    trophy.title = `已留下 ${achievementCount} 项现实成就 · 陈列阶段 ${displayStage}/4`;
    trophy.setAttribute('aria-label', `累计留下 ${achievementCount} 项现实成就`);
    scene.append(trophy);
  }
  if (cue) scene.append(node('div', `room-cue is-${cue}`));
  const celebratingCharacter = !compact && Boolean(sessionStorage.getItem('qiguang.character-celebration'));
  const characterState = celebratingCharacter ? ['celebrating', '庆祝'] as const
    : welcoming ? ['listening', '倾听'] as const
      : cue === 'rest' ? ['recovering', '恢复'] as const
        : cue === 'focus' ? ['thinking', '思考'] as const
          : cue === 'play' ? ['playing', '放松'] as const
            : hasMainQuest ? ['guiding', '指导'] as const : ['present', '在场'] as const;
  const character = node('div', `room-character is-happy is-${avatar ?? 'neutral'}${ambientAction ? ` is-ambient-${ambientAction}` : ''}${celebratingCharacter ? ' is-celebrating' : ''}${welcoming ? ' is-welcoming' : ''}${cue === 'rest' || ambientAction === 'rest' ? ' is-resting' : ''}`);
  let motionReady = Promise.resolve();
  if (avatar) {
    character.classList.add('has-motion');
    motionReady = applyMotionFrames(character, avatar);
  }
  scene.append(character);
  if (!compact && characterState[0] !== 'present') scene.append(node('span', `character-state is-${characterState[0]}`, characterState[1]));
  if (celebratingCharacter) sessionStorage.removeItem('qiguang.character-celebration');
  stage.append(scene);
  if (!compact) {
    let actionPending = false;
    let actionTimer: number | undefined;
    let idleTimer: number | undefined;
    const roomMotionReduced = settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const characterPanelId = `character-panel-${crypto.randomUUID()}`;
    const feedback = node('p', 'room-interaction-feedback');
    feedback.hidden = true;
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    stage.append(feedback);
    const scheduleIdleGesture = (delay = 5_000 + Math.random() * 4_000): void => {
      idleTimer = window.setTimeout(() => {
        if (!character.isConnected) return;
        if (actionPending) {
          scheduleIdleGesture();
          return;
        }
        const gestures = ['wave', 'calm', 'think', 'read'] as const;
        const gesture = gestures[Math.floor(Math.random() * gestures.length)] ?? 'wave';
        character.style.setProperty('--idle-gesture-frame', `var(--${gesture}-frame)`);
        character.dataset.idleGesture = gesture;
        character.classList.add('is-idle-gesture');
        idleTimer = window.setTimeout(() => {
          character.classList.remove('is-idle-gesture');
          delete character.dataset.idleGesture;
          scheduleIdleGesture();
        }, IDLE_GESTURE_MS);
      }, delay);
    };
    if (avatar && !roomMotionReduced) void motionReady.then(() => {
      idleTimer = window.setTimeout(() => {
        if (!character.isConnected) return;
        if (ambientAction) character.classList.remove(`is-ambient-${ambientAction}`);
        scheduleIdleGesture(700 + Math.random() * 800);
      }, AMBIENT_SETTLE_MS);
    });
    const hotspots: Array<[string, string, Route | null, string]> = [
      ['desk', '记录', { name: 'record' }, '坐到椅子上，写下一件真实发生的事。'],
      ['board', '任务', { name: 'tasks' }, '看一眼今天真正要推进的事。'],
      ['calendar', '日历', { name: 'calendar' }, '翻到想回看的那一天。'],
      ['workbench', '成长', { name: 'growth' }, '查看已经完成的事情和成长进度。'],
      ['window', '状态', { name: 'system' }, '停一下，看看最近的状态。'],
      ['bed', '休息', null, '歇一会儿。准备好再继续，也算照顾今天。'],
      ['character', '生活分身', null, ''],
    ];
    for (const [position, label, destination, response] of hotspots) {
      const button = node('button', `room-hotspot is-${position}`);
      button.type = 'button';
      button.setAttribute('aria-label', position === 'bed' ? '在床边休息' : destination ? `打开${label}` : label);
      button.append(node('span', 'hotspot-label', label));
      const target = destination;
      if (position !== 'character') button.addEventListener('click', async () => {
        if (actionPending) return;
        if (!await confirmFirstRoomInteraction()) return;
        if (actionPending) return;
        if (roomMotionReduced || !avatar) {
          if (target) go(target);
          else showToast(response);
          return;
        }
        actionPending = true;
        character.classList.remove('is-idle-gesture');
        delete character.dataset.idleGesture;
        button.disabled = true;
        await motionReady;
        if (!button.isConnected || !character.isConnected) {
          actionPending = false;
          button.disabled = false;
          return;
        }
        const actionClass = `is-action-${position}`;
        stage.classList.add('is-character-moving');
        stage.setAttribute('aria-busy', 'true');
        button.classList.add('is-active');
        character.classList.add(actionClass, 'is-walking');
        actionTimer = window.setTimeout(() => {
          character.classList.remove('is-walking');
          character.classList.add('is-interacting');
          feedback.textContent = response;
          feedback.hidden = false;
          actionTimer = window.setTimeout(() => {
            feedback.hidden = true;
            character.classList.remove('is-interacting');
            if (target) {
              actionPending = false;
              button.disabled = false;
              button.classList.remove('is-active');
              stage.classList.remove('is-character-moving');
              stage.removeAttribute('aria-busy');
              character.classList.remove(actionClass);
              go(target);
              actionTimer = undefined;
              return;
            }
            character.classList.add('is-returning');
            actionTimer = window.setTimeout(() => {
              actionPending = false;
              button.disabled = false;
              button.classList.remove('is-active');
              stage.classList.remove('is-character-moving');
              stage.removeAttribute('aria-busy');
              character.classList.remove(actionClass, 'is-returning');
              actionTimer = undefined;
            }, FURNITURE_RETURN_MS);
          }, FURNITURE_USE_MS);
        }, FURNITURE_APPROACH_MS);
      });
      else {
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', async () => {
          if (!await confirmFirstRoomInteraction()) return;
          const panel = stage.querySelector<HTMLElement>('.character-panel');
          if (panel) {
            panel.hidden = !panel.hidden;
            button.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden) panel.querySelector<HTMLButtonElement>('.button-primary')?.focus();
            return;
          }
          character.classList.remove('is-idle-gesture');
          delete character.dataset.idleGesture;
          character.classList.add('is-welcoming');
          window.setTimeout(() => character.classList.remove('is-welcoming'), 520);
          const created = node('div', 'character-panel');
          created.id = characterPanelId;
          const closePanel = (restoreFocus = true): void => {
            created.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            if (restoreFocus) button.focus({ preventScroll: true });
          };
          const close = node('button', 'character-panel-close', '×');
          close.type = 'button';
          close.setAttribute('aria-label', '关闭生活分身');
          close.addEventListener('click', () => closePanel());
          created.append(close);
          if (avatar) {
            const portrait = node('img', 'character-portrait') as HTMLImageElement;
            portrait.src = avatarAsset(avatar);
            portrait.alt = '';
            created.append(portrait);
          }
          const companionCopy = guidance?.settled ? '今天已经记下来了，可以回看，也可以停下。' : companionMessage(welcoming, cue, hasMainQuest);
          const recordIsPrimary = guidance?.title === '先讲一件最近发生的事';
          created.append(node('strong', '', companionName || avatarName(avatar)), node('p', 'character-response', companionCopy));
          if (guidance && !guidance.settled && !recordIsPrimary) created.append(node('p', 'quest-minimum', guidance.title));
          if (companionContext.length) {
            const remembered = node('details', 'companion-memory');
            remembered.append(node('summary', '', `我记得的背景 · ${companionContext.length}`));
            const list = node('ul', 'compact-list'); companionContext.forEach((item) => list.append(node('li', '', item))); remembered.append(list);
            created.append(remembered);
          }
          const actions = node('div', 'character-actions');
          if (recordIsPrimary) actions.classList.add('is-single');
          const why = node('button', `button ${recordIsPrimary ? 'button-secondary' : 'button-primary'}`, guidance?.settled ? '回看今天' : '查看今天的行动');
          why.type = 'button';
          why.addEventListener('click', () => {
            const guide = document.querySelector<HTMLElement>(guidance?.settled ? '.daily-closeout, .daily-guide' : '.daily-guide, .main-action');
            guide?.scrollIntoView({ behavior: settings.reduceMotion ? 'auto' : 'smooth', block: 'center' });
            (guide?.querySelector<HTMLButtonElement>('button') ?? guide)?.focus({ preventScroll: true });
            closePanel(false);
          });
          const record = node('button', `button ${recordIsPrimary ? 'button-primary' : 'button-quiet'}`, guidance?.settled ? '再记一件事' : '记录一件事');
          record.type = 'button';
          record.addEventListener('click', () => go({ name: 'record' }));
          if (!recordIsPrimary) actions.append(why);
          actions.append(record);
          created.append(actions);
          stage.append(created);
          button.setAttribute('aria-controls', characterPanelId);
          button.setAttribute('aria-expanded', 'true');
          (recordIsPrimary ? record : why).focus();
        });
      }
      stage.append(button);
    }
  }
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

function isoFromDateTimeInput(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function roomCueFor(state?: ResolvedDimensionState): RoomCue | null {
  if (!state || state.value >= 45) return null;
  return ({ energy: 'rest', mind: 'rest', connection: null, progress: 'focus', play: 'play' } as const)[state.dimension];
}

function roomAmbientAction(now = new Date()): 'rest' | 'walk' | 'focus' | 'read' {
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour < 6 || hour >= 22) return 'rest';
  if (hour < 9 || (hour >= 14 && hour < 17)) return 'walk';
  if (hour < 12 || (hour >= 17 && hour < 20)) return 'read';
  return 'focus';
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
  const known = Object.values(observations);
  const lowest = known.filter((item) => !observationIsStale(item, date)).sort((left, right) => left.value - right.value)[0];
  const stage = roomStage(true, profile?.avatar ?? null, resolvedCompanionName(profile), false, roomCueFor(lowest), date);
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
  const { dialog, content, actions } = dialogShell(`${dimension.label}当前状态`);
  if (observation) {
    const stale = observationIsStale(observation, referenceDate);
    content.append(
      node('p', 'state-current-score', `当前分数 ${observation.value}`),
      node('p', '', dimension.description),
      node('p', 'muted', `最近更新于 ${formatDate(observation.localDate, { year: 'numeric' })}`),
      node('p', stale ? 'danger-copy' : 'caption', stale
        ? referenceDate === localDate() ? '这个分数已经超过 7 天，建议重新评估。' : '这是当天能够找到的最近一次分数。'
        : sameDayCalibrationOverrides ? '当天填写的问卷分数优先。'
          : observation.clamped ? `当天记录使分数变化了 ${observation.dailyDelta > 0 ? '+' : ''}${observation.dailyDelta}。` : '这是你目前的状态，不是需要达到的目标。'),
    );
  } else {
    content.append(
      node('p', '', dimension.description),
      node('p', 'empty-copy', '暂无分数'),
    );
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
    const section = node('section', 'state-related-section');
    section.append(node('h3', '', title));
    if (!rows.length) section.append(node('p', 'empty-copy', emptyText));
    rows.forEach((item) => {
      const row = node('div', 'state-related-row');
      const heading = node('div', 'state-related-heading');
      heading.append(node('strong', '', item.title));
      if (item.delta !== undefined) heading.append(node('span', `state-related-delta${item.delta < 0 ? ' is-negative' : ''}`, `${item.delta > 0 ? '+' : ''}${item.delta}`));
      row.append(heading, node('span', 'caption', item.meta));
      section.append(row);
    });
    content.append(section);
  };

  appendRelatedSection('相关任务', '暂无相关任务', relatedQuests.map((quest) => {
    const feedback = feedbackByQuest.get(quest.id);
    const impact = feedback ? impactByEvidence.get(feedback.id) : undefined;
    return {
      title: quest.title,
      meta: `${formatDate(questResultDate(quest, feedbackByQuest))} · ${feedback ? FEEDBACK_LABELS[feedback.result] : quest.status === 'pending' ? '待完成' : FEEDBACK_LABELS[quest.status]}`,
      delta: impact?.delta,
    };
  }));
  appendRelatedSection('相关记录', '暂无相关记录', relatedEntries.map(({ event, entry }) => ({
    title: entry.body,
    meta: formatDate(entry.localDate),
    delta: impactByEvidence.get(event.id)?.delta,
  })));

  if (ledger.length) {
    const history = node('section', 'state-ledger-detail');
    history.append(node('h3', '', '分数变化'));
    ledger.slice(0, 20).forEach((item) => {
      const row = node('div', `state-ledger-row${item.active ? '' : ' is-reversed'}`);
      const value = item.kind === 'event-impact'
        ? `${(item.delta ?? 0) > 0 ? '+' : ''}${item.delta ?? 0}`
        : `问卷分数 ${item.value}`;
      row.append(
        node('strong', '', value),
        node('span', '', item.kind === 'event-impact' ? item.reason ?? '你确认过的日记影响' : '状态问卷'),
        node('time', 'caption', `${formatDate(item.localDate)} · ${item.active ? '已计入' : '已撤销'}`),
      );
      history.append(row);
    });
    content.append(history);
  }
  const close = node('button', 'button button-secondary', '关闭');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  actions.append(close);
  if (referenceDate === localDate()) {
    const assess = node('button', 'button button-primary', '评估这一项');
    assess.type = 'button';
    assess.addEventListener('click', () => { dialog.close(); openAssessmentQuestionnaire(30, dimension.key); });
    actions.append(assess);
  }
  dialog.showModal();
  close.focus();
}

function statusSummary(observations: Partial<Record<Dimension, ResolvedDimensionState>>, referenceDate = localDate()): HTMLElement {
  const section = node('section', 'surface status-summary');
  const header = node('div', 'section-heading');
  header.append(node('h2', '', '五维状态'));
  section.append(header);
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

async function announceNewGrowthBadge(before: Set<string>, fallback: string): Promise<void> {
  const badges = await loadGrowthBadges();
  const seen = seenGrowthBadgeIds();
  const unlocked = badges.filter((badge) => !before.has(badge.id) && !seen.has(badge.id));
  if (!unlocked.length) { showToast(fallback); return; }
  unlocked.forEach((badge) => seen.add(badge.id));
  saveSeenGrowthBadgeIds(seen);
  const badge = unlocked[0]!;
  sessionStorage.setItem('qiguang.character-celebration', badge.id);
  showToast(
    `已解锁“${badge.name}”徽章。${unlocked.length > 1 ? `另有 ${unlocked.length - 1} 枚。` : ''}${fallback}`,
    'normal',
    { label: '查看', run: () => go({ name: 'growth' }) },
  );
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
    await announceNewGrowthBadge(achievementsBefore, message);
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
  const actions = node('div', 'quest-actions quest-count-actions');
  const progress = quest.progressCount ?? 0;
  const target = quest.targetCount ?? 1;
  const minus = node('button', 'button button-quiet', '−1');
  minus.type = 'button';
  minus.disabled = progress === 0;
  minus.setAttribute('aria-label', `减少一次：${quest.title}`);
  minus.addEventListener('click', () => { void changeCountQuestProgress(quest, -1, actions); });
  const count = node('output', 'quest-count-progress', `${progress}/${target} ${quest.countUnit || '次'}`);
  count.setAttribute('aria-live', 'polite');
  const plus = node('button', 'button button-primary', '+1');
  plus.type = 'button';
  plus.setAttribute('aria-label', `记录一次：${quest.title}`);
  plus.addEventListener('click', () => { void changeCountQuestProgress(quest, 1, actions); });
  const skip = node('button', 'button button-quiet', '跳过今天');
  skip.type = 'button';
  skip.setAttribute('aria-label', `跳过今天：${quest.title}`);
  skip.addEventListener('click', () => { void openQuestFeedbackDialog(quest, 'skipped'); });
  const details = node('button', 'button button-quiet', '补充记录');
  details.type = 'button';
  details.setAttribute('aria-label', `补充任务记录：${quest.title}`);
  details.addEventListener('click', () => { void openQuestFeedbackDialog(quest); });
  const adjust = node('button', 'button button-quiet', '编辑任务');
  adjust.type = 'button';
  adjust.setAttribute('aria-label', `编辑任务：${quest.title}`);
  adjust.addEventListener('click', () => { void openQuestAdjustmentDialog(quest); });
  const more = node('details', 'quest-more-actions');
  const moreButtons = node('div', 'quest-more-buttons');
  moreButtons.append(skip, details, adjust);
  const moreTrigger = node('summary', 'quest-more-trigger', '•••');
  moreTrigger.setAttribute('aria-label', '更多操作');
  more.append(moreTrigger, moreButtons);
  actions.append(minus, count, plus, more);
  return actions;
}

function quickQuestActions(quest: Quest): HTMLElement {
  const actions = node('div', 'quest-actions quest-quick-actions quest-result-actions');
  const choices: Array<[Extract<FeedbackResult, 'completed' | 'partial' | 'skipped'>, string, string]> = [
    ['completed', '完成', 'button-primary'],
    ['partial', '有进展', 'button-secondary'],
    ['skipped', '跳过今天', 'button-quiet'],
  ];
  for (const [result, label, className] of choices) {
    const button = node('button', `button ${className}`, label);
    button.type = 'button';
    button.setAttribute('aria-label', `${label}：${quest.title}`);
    button.addEventListener('click', () => { void openQuestFeedbackDialog(quest, result); });
    actions.append(button);
  }
  const details = node('button', 'button button-quiet', '补充记录');
  details.type = 'button';
  details.setAttribute('aria-label', `补充任务记录：${quest.title}`);
  details.addEventListener('click', () => { void openQuestFeedbackDialog(quest); });
  const adjust = node('button', 'button button-quiet', '编辑任务');
  adjust.type = 'button';
  adjust.setAttribute('aria-label', `编辑任务：${quest.title}`);
  adjust.addEventListener('click', () => { void openQuestAdjustmentDialog(quest); });
  const more = node('details', 'quest-more-actions');
  const moreTrigger = node('summary', 'quest-more-trigger', '•••');
  moreTrigger.setAttribute('aria-label', '更多操作');
  more.append(moreTrigger, node('div', 'quest-more-buttons'));
  more.lastElementChild!.append(details, adjust);
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
  const { dialog, content, actions } = dialogShell(quest.status === 'pending' ? '记录任务结果' : '修改任务结果');
  dialog.classList.add('task-feedback-dialog');
  const closeDialog = node('button', 'feedback-dialog-close', '×');
  closeDialog.type = 'button';
  closeDialog.setAttribute('aria-label', '关闭任务结果');
  closeDialog.addEventListener('click', () => dialog.close());
  const taskContext = node('div', 'feedback-task-context');
  const taskContextCopy = node('div', 'feedback-task-copy');
  const taskContextHeading = node('div', 'feedback-task-heading');
  taskContextHeading.append(node('strong', '', quest.title));
  if (quest.estimatedMinutes) taskContextHeading.append(node('span', 'caption', `· ${quest.estimatedMinutes} 分钟`));
  taskContextCopy.append(taskContextHeading);
  if (quest.minimumAction && quest.minimumAction !== quest.title) taskContextCopy.append(node('span', 'caption', `完成标准：${quest.minimumAction}`));
  taskContext.append(semanticIcon('task-focus', 'feedback-task-icon'), taskContextCopy);
  content.append(closeDialog, taskContext);

  const resultLabel = node('label', 'field-label', '结果');
  resultLabel.classList.add('feedback-result-select');
  const result = node('select', 'input');
  const selectedResult = draft?.result ?? previousFeedback?.result ?? initialResult ?? (quest.status === 'pending' ? 'completed' : quest.status);
  const resultOptions: Array<[FeedbackResult, string]> = [
    ['completed', '已完成'], ['partial', '有进展'], ['skipped', '今天跳过'], ['exempt', '不再需要'],
  ];
  for (const [value, label] of resultOptions) {
    result.append(selectOption(value, label, selectedResult === value));
  }
  resultLabel.append(result);
  const resultChoices = node('div', 'feedback-result-choices');
  const resultChoiceButtons = resultOptions.slice(0, 3).map(([value, label]) => {
    const button = node('button', 'feedback-result-choice', label);
    button.type = 'button';
    button.dataset.value = value;
    button.setAttribute('aria-pressed', String(result.value === value));
    button.addEventListener('click', () => {
      result.value = value;
      result.dispatchEvent(new Event('change'));
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

  const difficultyLabel = node('label', 'field-label', '实际难度');
  const difficulty = node('select', 'input');
  for (const value of Object.keys(DIFFICULTY_XP) as Difficulty[]) {
    difficulty.append(selectOption(value, questDifficultyLabel(quest, value), (draft?.difficulty ?? quest.difficulty) === value));
  }
  difficultyLabel.append(difficulty);

  const actualLabel = node('label', 'field-label feedback-note-label', '备注（可选）');
  const actual = node('textarea', 'input compact-textarea');
  actual.maxLength = 150;
  actual.placeholder = '简单写下这次做到哪里';
  actual.value = draft?.actual ?? previousFeedback?.actual ?? '';
  const actualCount = node('span', 'feedback-character-count');
  const updateActualCount = () => { actualCount.textContent = `${actual.value.length}/150`; };
  actual.addEventListener('input', updateActualCount);
  updateActualCount();
  actualLabel.append(actual, actualCount);
  const noteLabel = node('label', 'field-label', '下次怎么调整（可选）');
  const note = node('textarea', 'input compact-textarea');
  note.maxLength = 2_000;
  note.placeholder = '例如：十分钟版本更容易开始。';
  note.value = draft?.note ?? previousFeedback?.note ?? '';
  noteLabel.append(note);
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
    applyHabitDifficultyControl = node('label', 'setting-row');
    applyHabitDifficultyControl.append(node('span', '', '以后这个习惯也使用本次实际难度'), applyHabitDifficulty);
  }
  const status = node('p', 'save-state');
  const partialPreview = node('p', 'privacy-boundary');
  const updatePartialPreview = () => {
    partialPreview.hidden = result.value !== 'partial';
    partialPreview.textContent = quest.sourceType === 'goal'
      ? '保存后会保留这次进展，并为目标建立一个更小的下一步；确认保存前不会修改任务或增加成长值。'
      : '保存后会记录这次进展并结算对应成长值；确认保存前不会修改任务。';
  };
  const aiPanel = node('div', 'feedback-ai-panel');
  const understand = node('button', 'button button-quiet', NATIVE_AI_READY ? 'AI 帮我判断结果' : 'AI 未配置');
  understand.type = 'button';
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
      updateActualCount();
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
  const extra = node('details', 'feedback-extra');
  const extraFields = node('div', 'feedback-extra-fields');
  extraFields.append(resultLabel, difficultyLabel, noteLabel, aiPanel, ...(stateControl ? [stateControl] : []), ...(applyHabitDifficultyControl ? [applyHabitDifficultyControl] : []));
  extra.append(node('summary', '', '更多记录'), extraFields);
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

  const cancel = node('button', 'button button-quiet', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const secondaryAction = node('button', 'button button-quiet feedback-undo-action', '撤销结果');
  secondaryAction.type = 'button';
  if (quest.status === 'pending') {
    const taskSettings = node('details', 'feedback-extra task-item-management');
    const taskSettingsActions = node('div', 'quest-adjust-shortcuts');
    const edit = node('button', 'button button-secondary', '编辑任务');
    edit.type = 'button';
    edit.setAttribute('aria-label', `编辑任务：${quest.title}`);
    edit.addEventListener('click', () => {
      dialog.close();
      void openQuestAdjustmentDialog(quest);
    });
    const remove = node('button', 'button button-quiet danger-button', '删除任务');
    remove.type = 'button';
    remove.setAttribute('aria-label', `删除任务：${quest.title}`);
    remove.addEventListener('click', () => { void confirmRemoveTaskItem(quest.title, () => db.removePendingQuest(quest.id), remove, dialog); });
    taskSettingsActions.append(edit, remove);
    taskSettings.append(node('summary', '', '编辑或删除任务'), taskSettingsActions);
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
  const save = node('button', 'button button-primary', '保存结果');
  save.type = 'button';
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
      await announceNewGrowthBadge(achievementsBefore, message);
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
  const choices = node('div', 'quest-adjust-shortcuts');
  const edit = node('button', 'button button-secondary', '修改目标或下一步'); edit.type = 'button';
  edit.addEventListener('click', () => { dialog.close(); void openGoalSettingsDialog(goal); });
  choices.append(edit);
  if (NATIVE_AI_READY) {
    const replan = node('button', 'button button-secondary', '根据进展重新规划'); replan.type = 'button';
    replan.addEventListener('click', () => { dialog.close(); void openGoalReplanDialog(goal); });
    choices.append(replan);
  }
  const pause = node('button', 'button button-quiet', '先暂停目标'); pause.type = 'button';
  pause.addEventListener('click', async () => {
    pause.disabled = true;
    try { await db.saveGoal(goal.id, { status: 'paused' }); dialog.close(); showToast('目标已暂停；历史和成长值保留。'); await render(); }
    catch (error) { pause.disabled = false; showToast(errorMessage(error), 'error'); }
  });
  const end = node('button', 'button button-quiet danger-button', '结束这个目标'); end.type = 'button';
  end.addEventListener('click', async () => {
    dialog.close();
    if (!await confirmAction('结束这个目标？', '待完成任务会退出行动面；历史、反馈和成长值仍会保留，也可以以后重新编辑状态。', '确认结束', true)) return;
    try { await db.saveGoal(goal.id, { status: 'abandoned' }); showToast('目标已结束；没有扣分，历史仍可回看。'); await render(); }
    catch (error) { showToast(errorMessage(error), 'error'); }
  });
  choices.append(pause, end); content.append(choices);
  const later = node('button', 'button button-primary', '暂不改变目标'); later.type = 'button'; later.addEventListener('click', () => dialog.close());
  actions.append(later); dialog.showModal(); later.focus();
}

async function openQuestAdjustmentDialog(quest: Quest): Promise<void> {
  const { dialog, content, actions } = dialogShell('修改任务');
  const title = node('input', 'input'); title.maxLength = 160; title.value = quest.title;
  const date = node('input', 'input'); date.type = 'date'; date.min = localDate(); date.value = quest.localDate;
  if (quest.sourceType === 'habit') date.disabled = true;
  const reminder = node('input', 'input'); reminder.type = 'time'; reminder.value = localDateTimeInput(quest.deadlineAt).slice(11, 16);
  const dimension = taskDimensionSelect(quest.dimension ?? 'progress');
  const difficulty = taskDifficultySelect(quest.difficulty);
  const status = node('p', 'save-state');
  content.append(
    labelledControl('任务名称', title),
    labelledControl(quest.sourceType === 'habit' ? '日期由习惯计划决定' : '安排日期', date),
    labelledControl('提醒时间（应用内，可选）', reminder),
    labelledControl('五维状态', dimension),
    labelledControl('难度', difficulty),
    status,
  );
  const cancel = node('button', 'button button-secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '保存调整'); save.type = 'button';
  save.addEventListener('click', async () => {
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
  });
  actions.append(cancel, save); dialog.showModal(); title.focus();
}

function taskListQuest(quest: Quest, overdue = false, directComplete = false, reorderable = false): HTMLElement {
  const deadlinePassed = Boolean(quest.deadlineAt && Date.parse(quest.deadlineAt) < Date.now() && quest.status === 'pending');
  const item = node('article', `task-list-item is-${quest.status} is-source-${quest.sourceType} is-dimension-${quest.dimension ?? 'progress'}${quest.targetCount ? ' has-count' : ''}${overdue ? ' is-overdue' : ''}${deadlinePassed ? ' is-deadline-passed' : ''}`);
  item.dataset.questId = quest.id;
  item.tabIndex = -1;
  const progress = quest.progressCount ?? 0;
  const target = quest.targetCount ?? 1;
  if (quest.targetCount) item.style.setProperty('--task-progress', `${Math.round((progress / target) * 100)}%`);
  const action = node('button', 'task-row-action');
  action.type = 'button';
  const copy = node('span', 'task-list-copy');
  copy.append(node('h3', '', quest.title));
  if (!quest.targetCount) action.append(node('span', `task-check is-${quest.status}`, quest.status === 'completed' ? '✓' : quest.status === 'partial' ? '–' : ''));
  action.append(copy);
  if (quest.targetCount) {
    const count = node('span', 'task-count-progress');
    count.append(
      node('span', 'task-count-value', `${progress}/${target} ${quest.countUnit || '次'}`),
      node('span', 'task-count-meter', ''),
    );
    action.append(count);
  }
  action.setAttribute('aria-label', quest.status !== 'pending' ? `修改任务“${quest.title}”的反馈` : overdue
    ? `记录“${quest.title}”的实际结果` : quest.targetCount ? `记录一次：${quest.title}，当前 ${progress}/${target}${quest.countUnit || '次'}` : `完成：${quest.title}`);
  action.addEventListener('click', () => {
    if (quest.status !== 'pending' || overdue) { void openQuestFeedbackDialog(quest, overdue ? 'completed' : undefined); return; }
    if (quest.targetCount && directComplete) recordQuestCheckIn(quest, item);
    else if (quest.targetCount) void changeCountQuestProgress(quest, 1, item);
    else if (directComplete) void completeQuestFromRow(quest, item);
    else void openQuestFeedbackDialog(quest, 'completed');
  });
  const details = node('button', 'task-item-details', '⋯');
  details.type = 'button';
  details.dataset.questFeedbackFor = quest.id;
  details.setAttribute('aria-label', `${directComplete && !reorderable ? '编辑' : '查看'}任务：${quest.title}`);
  details.addEventListener('click', () => {
    if (directComplete && !reorderable && quest.status === 'pending' && !overdue) void openQuestAdjustmentDialog(quest);
    else void openQuestFeedbackDialog(quest);
  });
  item.append(action);
  if (reorderable) {
    item.dataset.reorderable = 'true';
    const drag = node('button', 'task-drag-handle', '≡');
    drag.type = 'button';
    drag.setAttribute('aria-label', `拖动调整“${quest.title}”的位置`);
    item.append(drag);
  }
  item.append(details);
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

function habitTodayRow(habit: Habit, quest: Quest): HTMLElement {
  const row = node('article', `today-habit-row is-${quest.status}`);
  row.dataset.questId = quest.id;
  const target = quest.targetCount ?? 1;
  const progress = quest.status === 'completed' ? target : quest.progressCount ?? 0;
  const copy = node('span', 'today-habit-copy');
  copy.append(node('h3', '', habit.name), node('span', 'caption', `今天 ${progress}/${target} ${quest.countUnit || '次'}`));
  row.append(copy);
  if (quest.status === 'pending') {
    const checkIn = node('button', 'button button-secondary habit-today-checkin', quest.targetCount ? '+1' : '打卡');
    checkIn.type = 'button';
    checkIn.setAttribute('aria-label', `记录今天的习惯“${habit.name}”，当前 ${progress}/${target}${quest.countUnit || '次'}`);
    checkIn.addEventListener('click', () => recordQuestCheckIn(quest, row));
    row.append(checkIn);
  } else {
    const completed = node('span', 'habit-today-completed', '已完成');
    completed.setAttribute('aria-label', `${habit.name}今天已完成`);
    row.append(completed);
  }
  const details = node('button', 'task-item-details', '⋯');
  details.type = 'button';
  details.setAttribute('aria-label', `查看习惯：${habit.name}`);
  details.addEventListener('click', () => { void openHabitDetailDialog(habit); });
  row.append(details);
  return row;
}

function questCard(quest: Quest, compact = false, milestone?: { description: string }, taskList = false, managementOnly = false): HTMLElement {
  const deadlinePassed = Boolean(quest.deadlineAt && Date.parse(quest.deadlineAt) < Date.now() && quest.status === 'pending');
  if (taskList && !quest.systemRetiredAt) return taskListQuest(quest);
  const card = node('article', `${compact ? 'quest-row' : 'surface quest-card'} is-${quest.status} is-source-${quest.sourceType} is-dimension-${quest.dimension ?? 'progress'}${deadlinePassed ? ' is-deadline-passed' : ''}`);
  card.dataset.questId = quest.id;
  card.tabIndex = -1;
  const heading = node('div', 'quest-heading');
  const sourceLabel = ({ goal: '目标', habit: '习惯', recovery: '恢复', manual: '手动' } as const)[quest.sourceType];
  heading.append(
    node('span', `quest-source-label is-${quest.sourceType}`, sourceLabel),
    node('span', 'caption', questDifficultyLabel(quest)),
  );
  card.append(heading, node('h3', '', quest.title));
  if (quest.localDate !== localDate()) card.append(node('p', 'caption', `计划日期：${formatDate(quest.localDate)}`));
  const planning = [quest.minimumAction && quest.minimumAction !== quest.title ? `先做这一步：${quest.minimumAction}` : '', quest.estimatedMinutes ? `约 ${quest.estimatedMinutes} 分钟` : ''].filter(Boolean);
  if (planning.length) card.append(node('p', 'quest-minimum', planning.join(' · ')));
  const completionCriteria = quest.completionCriteria?.trim();
  if (completionCriteria && completionCriteria !== questMinimumAction(quest)) card.append(node('p', 'caption', `完成标准：${completionCriteria}`));
  if (milestone) card.append(node('p', 'caption', `关联子任务：${milestone.description}`));
  if (quest.deadlineAt) card.append(node('p', deadlinePassed ? 'caption danger-copy' : 'caption', `${deadlinePassed ? '截止已过，仍由你决定' : '可选截止'}：${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(quest.deadlineAt))}`));
  if (quest.status === 'pending' && managementOnly) {
    const actions = node('div', 'quest-actions');
    const edit = node('button', 'button button-secondary button-compact', '编辑计划');
    edit.type = 'button';
    edit.setAttribute('aria-label', `编辑计划：${quest.title}`);
    edit.addEventListener('click', () => { void openQuestAdjustmentDialog(quest); });
    const remove = node('button', 'button button-quiet danger-button button-compact', '删除');
    remove.type = 'button';
    remove.setAttribute('aria-label', `删除任务：${quest.title}`);
    remove.addEventListener('click', () => { void confirmRemoveTaskItem(quest.title, () => db.removePendingQuest(quest.id), remove); });
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
    const retired = node('div', 'quest-actions quest-system-retired');
    retired.append(node('span', 'caption', retiredLabels[quest.systemRetiredReason!]));
    card.append(retired);
  }
  else {
    const actions = node('div', 'quest-actions');
    const feedback = node('button', 'button button-secondary', `结果：${FEEDBACK_LABELS[quest.status]}`);
    feedback.type = 'button';
    feedback.dataset.questFeedbackFor = quest.id;
    feedback.setAttribute('aria-label', `修改任务“${quest.title}”的反馈`);
    feedback.addEventListener('click', () => { void openQuestFeedbackDialog(quest); });
    actions.append(feedback);
    const undo = node('button', 'button button-quiet', '撤销反馈');
    undo.type = 'button';
    undo.setAttribute('aria-label', `撤销任务“${quest.title}”的反馈`);
    undo.addEventListener('click', async () => {
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
    });
    actions.append(undo);
    if (quest.sourceType === 'goal' && quest.sourceId) {
      const next = node('button', 'button button-quiet', '更新目标下一步');
      next.type = 'button';
      next.addEventListener('click', async () => {
        const goal = (await db.listGoals()).find((item) => item.id === quest.sourceId);
        if (goal) void openGoalSettingsDialog(goal); else showToast('关联目标已经不存在。', 'error');
      });
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
  panel.append(node('span', 'tag tag-warn', '状态照顾'), node('h2', '', `先补足${dimensionLabel(state.dimension)}`));
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
  const actions = node('div', 'quest-actions');
  const accept = node('button', 'button button-primary', '加入今天');
  accept.type = 'button';
  accept.addEventListener('click', async () => {
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
  });
  const another = node('button', 'button button-secondary', '换一个');
  another.type = 'button';
  another.addEventListener('click', () => {
    suggestionIndex = (suggestionIndex + 1) % suggestions.length;
    renderSuggestion();
    title.focus({ preventScroll: true });
  });
  title.tabIndex = -1;
  const dismiss = node('button', 'button button-quiet', '暂时不用');
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => {
    sessionStorage.setItem(`qiguang.recovery-dismissed.${date}.${state.dimension}`, '1');
    const next = panel.nextElementSibling as HTMLElement | null;
    panel.remove();
    if (next) {
      next.tabIndex = -1;
      next.focus({ preventScroll: true });
    }
    showToast('已收起；没有扣分，也不会改变状态。');
  });
  actions.append(accept, another, dismiss);
  panel.append(actions);
  return panel;
}

function openDailyCloseout(date: string, entries: JournalEntry[], quests: Quest[], events: JournalEvent[], analysis?: DailyAnalysis, nextSmallStep = ''): void {
  const { dialog, content, actions } = dialogShell('收束今天');
  const localSuccesses = successCredits(entries, quests, events);
  const pending = quests.filter((item) => item.status === 'pending');
  const completed = quests.filter((item) => item.status === 'completed' || item.status === 'partial');
  const checklist = node('div', 'closeout-checklist');
  const record = node('section', `closeout-item${entries.length ? ' is-done' : ''}`);
  record.append(node('strong', '', entries.length ? `记录 ${entries.length} 条` : '暂无记录'));
  const recordButton = node('button', 'button button-secondary', entries.length ? '追加一条' : '记录今天');
  recordButton.type = 'button'; recordButton.addEventListener('click', () => { dialog.close(); go({ name: 'record' }); }); record.append(recordButton);
  const task = node('section', `closeout-item${pending.length ? '' : ' is-done'}`);
  task.append(node('strong', '', pending.length ? `待办 ${pending.length} 项` : `推进 ${completed.length} 项`));
  if (pending.length) {
    const taskButton = node('button', 'button button-secondary', '处理待反馈行动');
    taskButton.type = 'button'; taskButton.addEventListener('click', () => { dialog.close(); go({ name: 'tasks' }); }); task.append(taskButton);
  }
  const review = node('section', `closeout-item${analysis || localSuccesses.length ? ' is-done' : ''}`);
  review.append(node('strong', '', analysis ? '今日已整理' : localSuccesses.length ? `成功 ${localSuccesses.length} 条` : '暂无成功'));
  const reviewButton = node('button', 'button button-secondary', analysis || localSuccesses.length ? '查看成功小记' : entries.length && NATIVE_AI_READY ? '检查范围并整理' : '写一条成功小记');
  reviewButton.type = 'button'; reviewButton.addEventListener('click', () => {
    dialog.close();
    if (analysis || localSuccesses.length || (entries.length && NATIVE_AI_READY)) go({ name: 'day', date });
    else openSuccessRecord(date);
  }); review.append(reviewButton);
  const tomorrow = node('section', `closeout-item${nextSmallStep ? ' is-done' : ''}`);
  tomorrow.append(node('strong', '', nextSmallStep ? '明日一步' : '明日待定'));
  if (nextSmallStep) tomorrow.append(node('p', 'caption', nextSmallStep));
  checklist.append(record, task, review, tomorrow);
  content.append(checklist);
  const close = node('button', 'button button-primary', '今天先到这里'); close.type = 'button'; close.addEventListener('click', () => dialog.close());
  actions.append(close); dialog.showModal(); close.focus();
}

function overdueQuestPanel(quests: Quest[], limit = 3): HTMLElement {
  const panel = node('section', 'surface overdue-quests');
  const visible = quests.slice(0, limit);
  panel.append(node('h2', '', `待决定 · ${quests.length}`));
  const list = node('div', 'overdue-quest-list');
  for (const quest of visible) {
    list.append(taskListQuest(quest, true));
  }
  if (quests.length > visible.length) {
    const more = node('button', 'button button-secondary', `打开任务板继续处理另外 ${quests.length - visible.length} 项`);
    more.type = 'button';
    more.addEventListener('click', () => go({ name: 'tasks' }));
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
  main.append(pageHeader(formatDate(today), '今天'));

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
  hero.append(roomStage(false, profile?.avatar ?? null, resolvedCompanionName(profile), isReturning, roomCueFor(lowest), null, Boolean(pendingToday)));
  main.append(hero, statusSummary(observations));

  if (isReturning) {
    const returning = node('section', 'home-return');
    const actions = node('div', 'home-return-actions');
    const record = node('button', 'button button-secondary', '记录近况');
    record.type = 'button';
    record.addEventListener('click', () => go({ name: 'record' }));
    const history = node('button', 'button button-quiet', '先看看以前');
    history.type = 'button';
    history.addEventListener('click', () => go({ name: 'calendar' }));
    const dismiss = node('button', 'button button-quiet', '暂时不用');
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => {
      sessionStorage.setItem(`qiguang.return-dismissed.${today}`, '1');
      returning.remove();
      main.querySelector<HTMLElement>('.today-focus-list h2, .today-focus-list button')?.focus({ preventScroll: true });
    });
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

  const todayTasks = node('section', 'today-focus-list');
  const todayTasksHeading = node('div', 'section-heading');
  const pendingTodayQuests = quests.filter((quest) => quest.status === 'pending' && quest.sourceType !== 'habit' && !quest.systemRetiredAt);
  todayTasksHeading.append(node('h2', '', '今天要做的'), node('span', 'caption', `${pendingTodayQuests.length} 项待完成`));
  todayTasks.append(todayTasksHeading);
  if (!pendingTodayQuests.length) todayTasks.append(node('p', 'empty-copy', '今天已经安排好了'));
  pendingTodayQuests.slice(0, 3).forEach((quest) => todayTasks.append(taskListQuest(quest, false, true)));
  const todayHabitQuests = quests.filter((quest) => quest.sourceType === 'habit' && !quest.systemRetiredAt);
  if (todayHabitQuests.length) {
    todayTasks.append(node('h3', 'today-habit-heading', '习惯打卡'));
    todayHabitQuests.forEach((quest) => {
      const habit = habits.find((item) => item.id === quest.sourceId);
      if (habit) todayTasks.append(habitTodayRow(habit, quest));
    });
  }
  main.append(todayTasks);

  const todayRecord = node('section', 'today-record-preview');
  const recordHeading = node('div', 'section-heading');
  const openDay = node('button', 'section-text-action', '查看今天 ›');
  openDay.type = 'button';
  openDay.addEventListener('click', () => go({ name: 'day', date: today }));
  recordHeading.append(node('h2', '', '今天留下的'), openDay);
  todayRecord.append(recordHeading);
  const recentTodayEntries = entries.slice(-3).reverse();
  if (recentTodayEntries.length) {
    recentTodayEntries.forEach((entry) => {
    const preview = node('button', 'today-record-row');
    preview.type = 'button';
    const previewIcon = node('span', `today-record-icon is-${entry.kind}`);
    previewIcon.append(semanticIcon(entry.kind === 'success' ? 'success-record' : 'nav-record'));
    preview.append(
      previewIcon,
      node('span', 'today-record-copy', entry.body),
      node('time', 'caption', new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
    );
    preview.addEventListener('click', () => { void openEntryDetailDialog(entry); });
    todayRecord.append(preview);
    });
  } else todayRecord.append(node('p', 'empty-copy', '今天还没有记录'));
  main.append(todayRecord);

  return main;

}

async function recordPage(route: Route): Promise<HTMLElement> {
  const today = localDate();
  const targetDate = route.date ?? today;
  const main = node('main', 'page page-record');

  const form = node('form', 'record-form journal-editor');
  const dateInput = node('input', 'input');
  dateInput.type = 'date';
  dateInput.max = localDate();
  dateInput.value = targetDate;
  const dateControl = node('label', 'record-date-control');
  const dateText = node('span', '', formatDate(targetDate, { weekday: undefined }));
  dateControl.append(semanticIcon('calendar'), dateText, dateInput);
  main.append(route.date && route.date !== today
    ? secondaryPageHeader('补记', dateControl)
    : pageHeader('', '记录', dateControl));

  const textarea = node('textarea', 'journal-input');
  textarea.name = 'body';
  textarea.setAttribute('aria-label', '发生了什么');
  textarea.maxLength = 12_000;
  const initialDraft = readDraft(targetDate);
  const savedCaption = await db.getDayCaption(targetDate);
  let draftBody = initialDraft.body;
  let draftSummary = initialDraft.summary || savedCaption?.text || '';
  type RecordMode = 'summary' | NonNullable<JournalEntry['kind']>;
  let selectedMode: RecordMode = draftBody ? initialDraft.kind : draftSummary ? 'summary' : 'journal';
  textarea.placeholder = '写点什么…';
  textarea.value = selectedMode === 'summary' ? draftSummary : draftBody;
  const counter = node('span', 'character-count', `${textarea.value.length}/12000`);

  let selectedKind: NonNullable<JournalEntry['kind']> = initialDraft.kind;
  const bodyTitle = node('strong', '', selectedMode === 'summary' ? '今日一句' : selectedKind === 'success' ? '成功小记' : selectedKind === 'fun' ? '有趣的事' : '记住的事');

  const prompts = node('section', 'record-prompts');
  prompts.setAttribute('aria-label', '快速开头');
  const promptActions = node('div', 'record-prompt-actions');
  const kindButtons: HTMLButtonElement[] = [];
  const selectMode = (mode: RecordMode, label: string, prompt: string): void => {
    if (selectedMode === 'summary') draftSummary = textarea.value;
    else draftBody = textarea.value;
    selectedMode = mode;
    if (mode !== 'summary') selectedKind = mode;
    bodyTitle.textContent = label;
    textarea.placeholder = prompt;
    textarea.maxLength = mode === 'summary' ? 120 : 12_000;
    textarea.value = mode === 'summary' ? draftSummary : draftBody;
    kindButtons.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.mode === mode)));
    updateDraftState();
  };
  for (const [label, prompt, mode] of [
    ['今日一句', '写点什么…', 'summary'],
    ['记住的事', '写点什么…', 'journal'],
    ['成功小记', '写点什么…', 'success'],
    ['有趣的事', '写点什么…', 'fun'],
  ] as const) {
    const button = node('button', 'record-type-option', label);
    button.type = 'button';
    button.dataset.mode = mode;
    button.setAttribute('aria-pressed', String(mode === selectedMode));
    button.addEventListener('click', () => {
      selectMode(mode, label, prompt);
      textarea.focus();
    });
    kindButtons.push(button);
    promptActions.append(button);
  }
  prompts.append(promptActions);

  const bodySection = node('section', 'record-body-section');
  const bodyHeading = node('div', 'record-body-heading');
  bodyHeading.append(bodyTitle);
  bodySection.append(bodyHeading, textarea, counter);

  const saveState = node('p', 'save-state');
  saveState.setAttribute('role', 'status');
  const submit = node('button', 'button button-primary button-wide', '保存记录');
  submit.type = 'submit';
  const submitBar = node('div', 'record-submit-bar');
  submitBar.append(submit);
  const savedEntries = await db.listEntries(targetDate);
  const todaySummary = node('div', 'record-day-summary');
  const todayCount = node('span', '', `今天已保存 ${savedEntries.length} 条记录`);
  const viewToday = node('button', 'section-text-action', '查看今天');
  viewToday.type = 'button';
  viewToday.addEventListener('click', () => { sessionStorage.setItem('qiguang.day-view', 'records'); go({ name: 'day', date: activeDraftDate }); });
  todaySummary.append(todayCount, viewToday);
  form.append(prompts, bodySection, saveState, todaySummary, submitBar);
  main.append(form);

  let activeDraftDate = targetDate;
  const updateDraftState = (): void => {
    if (selectedMode === 'summary') draftSummary = textarea.value;
    else draftBody = textarea.value;
    counter.textContent = `${textarea.value.length}/${selectedMode === 'summary' ? 120 : 12000}`;
    saveDraft(activeDraftDate, draftBody, selectedKind, draftSummary);
    submit.disabled = !textarea.value.trim();
    saveState.textContent = draftNeedsUnloadWarning ? '应用未能保存草稿，请先不要关闭页面' : textarea.value ? '草稿已保存' : '';
    saveState.hidden = !saveState.textContent;
    saveState.classList.toggle('is-error', draftNeedsUnloadWarning);
  };
  textarea.addEventListener('input', updateDraftState);
  dateInput.addEventListener('change', async () => {
    if (!isLocalDate(dateInput.value)) {
      saveState.textContent = '请选择有效日期；当前草稿已保留。';
      saveState.hidden = false;
      saveState.classList.add('is-error');
      return;
    }
    updateDraftState();
    activeDraftDate = dateInput.value;
    dateText.textContent = formatDate(activeDraftDate, { weekday: undefined });
    const draft = readDraft(activeDraftDate);
    const caption = await db.getDayCaption(activeDraftDate);
    draftBody = draft.body;
    draftSummary = draft.summary || caption?.text || '';
    const nextMode: RecordMode = draftBody ? draft.kind : draftSummary ? 'summary' : 'journal';
    selectedMode = nextMode;
    selectedKind = draft.kind;
    bodyTitle.textContent = nextMode === 'summary' ? '今日一句' : nextMode === 'success' ? '成功小记' : nextMode === 'fun' ? '有趣的事' : '记住的事';
    textarea.placeholder = '写点什么…';
    textarea.maxLength = nextMode === 'summary' ? 120 : 12_000;
    textarea.value = nextMode === 'summary' ? draftSummary : draftBody;
    kindButtons.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.mode === nextMode)));
    updateDraftState();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = '正在保存…';
    saveState.hidden = true;
    try {
      if (selectedMode === 'summary') await db.saveDayCaption(dateInput.value, textarea.value.trim());
      else await db.addEntry(textarea.value, dateInput.value, 'text', selectedKind);
      clearDraft(dateInput.value);
      showToast('记录已保存。');
      sessionStorage.setItem('qiguang.day-view', 'records');
      go({ name: 'day', date: dateInput.value });
    } catch (error) {
      submit.disabled = false;
      submit.textContent = '重试保存';
      saveState.textContent = `尚未保存：${errorMessage(error)}`;
      saveState.hidden = false;
      saveState.classList.add('is-error');
      showToast(errorMessage(error), 'error');
    }
  });
  updateDraftState();
  return main;
}

async function openSameDayHistory(date: string): Promise<void> {
  const entries = await db.listEntries();
  const suffix = date.slice(5);
  const dates = [...new Set(entries.filter((entry) => entry.localDate.slice(5) === suffix).map((entry) => entry.localDate))]
    .sort((left, right) => right.localeCompare(left));
  const captions = new Map(await Promise.all(dates.map(async (item) => [item, await db.getDayCaption(item)] as const)));
  const { dialog, content, actions } = dialogShell(`${Number(suffix.slice(0, 2))} 月 ${Number(suffix.slice(3))} 日`);
  dialog.classList.add('same-day-dialog');
  const list = node('div', 'same-day-list');
  if (!dates.length) list.append(node('p', 'empty-copy', '暂无往年'));
  for (const item of dates) {
    const dayEntries = entries.filter((entry) => entry.localDate === item);
    const preview = captions.get(item)?.text || dayEntries[0]?.body.replace(/\s+/g, ' ').slice(0, 50) || '打开这一天';
    const row = node('button', 'same-day-row');
    row.type = 'button';
    row.append(node('strong', '', `${item.slice(0, 4)} 年`), node('span', '', preview));
    row.addEventListener('click', () => { dialog.close(); go({ name: 'day', date: item }); });
    list.append(row);
  }
  content.append(list);
  const close = node('button', 'button button-secondary', '关闭');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  actions.append(close);
  dialog.showModal();
  close.focus();
}

function showFirstRecordGuide(): void {
  if (sessionStorage.getItem('qiguang.first-guide-shown') === '1') return;
  sessionStorage.setItem('qiguang.first-guide-shown', '1');
  const main = document.querySelector<HTMLElement>('#main-content');
  if (!main) return;
  const panel = node('aside', 'surface first-use-next');
  panel.append(node('h2', '', '第一步完成'));
  const guide = node('dl', 'first-use-guide');
  guide.append(
    node('dt', '', '今日'), node('dd', '', '看今天最需要照顾什么'),
    node('dt', '', '任务'), node('dd', '', '完成、编辑或删除行动'),
  );
  const next = primaryButton('去今日', () => go({ name: 'today' }));
  panel.append(guide, next);
  main.prepend(panel);
  panel.scrollIntoView({ behavior: settings.reduceMotion ? 'auto' : 'smooth', block: 'start' });
  next.focus({ preventScroll: true });
}

function calendarDates(cursor: Date): string[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return localDate(date);
  });
}

function trailTabs(active: 'calendar' | 'growth' | 'review'): HTMLElement {
  const nav = node('nav', 'trail-tabs');
  nav.setAttribute('aria-label', '轨迹分段');
  const tabs: Array<[string, string]> = [['calendar', '日历'], ['review', '本周'], ['growth', '成长']];
  tabs.forEach(([route, label]) => {
    const link = node('a', `trail-tab${route === active ? ' is-active' : ''}`, label);
    link.href = route === 'review' ? `#/review/${localDate()}` : `#/${route}`;
    if (route === active) link.setAttribute('aria-current', 'page');
    nav.append(link);
  });
  return nav;
}

async function openDayCaptionDialog(date: string, entries: JournalEntry[], suggestedCaption?: string): Promise<void> {
  const [caption, analyses] = await Promise.all([db.getDayCaption(date), db.listDailyAnalyses(date)]);
  const readyAnalysis = analyses.find((item) => item.status === 'ready');
  const { dialog, content, actions } = dialogShell('编辑当日一句');
  dialog.classList.add('day-caption-dialog');

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
  const captionActions = node('div', 'day-caption-actions');
  const useAi = node('button', 'button button-quiet', readyAnalysis ? '采用 AI 概括' : NATIVE_AI_READY ? '让 AI 概括' : 'AI 未配置');
  useAi.type = 'button';
  useAi.disabled = !readyAnalysis && (!NATIVE_AI_READY || !entries.length);
  useAi.addEventListener('click', () => {
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
  });
  const saveCaption = node('button', 'button button-secondary', '保存一句话');
  saveCaption.type = 'button';
  saveCaption.addEventListener('click', async () => {
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

  const close = node('button', 'button button-secondary', '关闭');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
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
  const searchAction = node('button', 'header-icon-button');
  searchAction.type = 'button';
  searchAction.setAttribute('aria-label', '查找记录');
  searchAction.append(semanticIcon('search'));
  searchAction.addEventListener('click', () => {
    searchPanel.hidden = false;
    searchPanel.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    searchPanel.scrollIntoView({ behavior: settings.reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });
  main.append(pageHeader('', '轨迹', searchAction));
  main.append(trailTabs('calendar'));

  const panel = node('section', 'surface calendar-panel');
  const toolbar = node('div', 'calendar-toolbar');
  const monthTitle = node('h2', '', new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(calendarCursor));
  const moveMonth = (offset: number): void => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + offset, 1);
    const today = new Date();
    calendarSelectedDate = today.getFullYear() === calendarCursor.getFullYear() && today.getMonth() === calendarCursor.getMonth()
      ? localDate(today) : localDate(calendarCursor);
    void render();
  };
  toolbar.append(
    iconButton('上个月', null, () => moveMonth(-1), 'icon-only is-previous'),
    monthTitle,
    iconButton('下个月', null, () => moveMonth(1), 'icon-only is-next'),
  );
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
    button.addEventListener('click', () => { calendarSelectedDate = dateValue; void render(); });
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

  const selectedQuests = allQuests.filter((quest) => quest.sourceType !== 'habit' && feedbackByQuest.get(quest.id)?.result === 'completed' && questResultDate(quest, feedbackByQuest) === calendarSelectedDate);
  const selectedHabitLogs = completedHabitLogs.filter((item) => item.localDate === calendarSelectedDate);
  const selectedEntries = entriesByDate.get(calendarSelectedDate) ?? [];
  const selectedPreview = node('section', 'calendar-day-preview');
  selectedPreview.append(node('h2', '', formatDate(calendarSelectedDate).replace('日周', '日 周')));
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
    node('p', selectedEntry ? 'line-clamp' : 'empty-copy', selectedEntry?.body ?? selectedQuests[0]?.title ?? selectedHabit?.name ?? '这一天还没有记录或完成事项'),
  );
  selectedPreview.append(previewLead);
  const previewActions = node('div', 'calendar-preview-actions');
  const editCaption = node('button', 'section-text-action', '编辑当日一句');
  editCaption.type = 'button';
  editCaption.addEventListener('click', () => { void openDayCaptionDialog(calendarSelectedDate, selectedEntries); });
  const openReview = node('button', 'section-text-action', '打开回顾 ›');
  openReview.type = 'button';
  openReview.addEventListener('click', () => go({ name: 'day', date: calendarSelectedDate }));
  previewActions.append(editCaption, openReview);
  selectedPreview.append(previewActions);
  main.append(selectedPreview);

  const monthStart = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1));
  const monthEnd = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 0));
  const previousMonthStart = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1));
  const previousMonthEnd = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 0));
  const monthly = node('section', 'surface monthly-snapshot');
  monthly.append(node('h2', '', '本月变化'));
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
  const growthDetails = node('details', 'monthly-growth-details optional-details');
  growthDetails.append(node('summary', '', '查看五维成长'));
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
  main.append(monthly);

  const search = node('section', 'search-section calendar-search-panel');
  search.hidden = true;
  searchPanel = search;
  search.append(node('h2', '', '查找记录'));
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
  const searchButton = node('button', 'button button-secondary', '查找');
  searchButton.type = 'submit';
  const searchStatus = node('p', 'search-status');
  searchStatus.setAttribute('role', 'status');
  searchStatus.setAttribute('aria-live', 'polite');
  const results = node('div', 'search-results');
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
      const item = node('button', 'list-row');
      item.type = 'button';
      item.append(node('span', 'caption', formatDate(entry.localDate)), node('span', 'line-clamp', entry.body));
      item.addEventListener('click', () => go({ name: 'day', date: entry.localDate }));
      results.append(item);
    }
  });
  const closeSearch = node('button', 'button button-quiet calendar-search-close', '关闭查找');
  closeSearch.type = 'button';
  closeSearch.addEventListener('click', () => { search.hidden = true; searchAction.focus(); });
  search.append(closeSearch);
  main.append(search);
  return main;
}

function dialogShell(title: string): { dialog: HTMLDialogElement; content: HTMLElement; actions: HTMLElement } {
  const dialog = node('dialog', 'dialog');
  const content = node('div', 'dialog-content');
  const heading = node('h2', '', title);
  heading.id = `dialog-title-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  content.append(heading);
  const actions = node('div', 'dialog-actions');
  dialog.append(content, actions);
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
  return { dialog, content, actions };
}

function addDialogBack(dialog: HTMLDialogElement, content: HTMLElement): void {
  const back = node('button', 'dialog-back', '←');
  back.type = 'button';
  back.setAttribute('aria-label', '返回');
  back.addEventListener('click', () => dialog.close());
  content.prepend(back);
}

function showOnboarding(): void {
  const { dialog, content, actions } = dialogShell('选一个陪伴角色');
  const choices = node('div', 'avatar-choices');
  const selected = node('p', 'save-state', '');
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
    const button = node('button', 'avatar-choice');
    button.type = 'button';
    button.setAttribute('aria-label', `选择${label}`);
    button.setAttribute('aria-pressed', 'false');
    const image = node('img', 'avatar-choice-image') as HTMLImageElement;
    image.src = avatarAsset(choice);
    image.alt = '';
    button.append(image, node('span', '', label));
    button.addEventListener('click', () => {
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
    const cancel = node('button', 'button button-secondary', '取消');
    cancel.type = 'button';
    const confirm = node('button', `button ${dangerous ? 'button-danger' : 'button-primary'}`, confirmLabel);
    confirm.type = 'button';
    cancel.addEventListener('click', () => { resolve(false); dialog.close(); });
    confirm.addEventListener('click', () => { resolve(true); dialog.close(); });
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
  const records = node('section', 'preview-group');
  records.append(node('h3', '', `记录正文 · ${request.userInput.entries.length} 条`));
  request.userInput.entries.forEach((entry) => {
    const item = node('article', 'preview-record');
    item.append(node('p', 'caption', `记录 ${entry.entryId.slice(0, 8)} · v${entry.revision}`), node('p', 'entry-body', entry.text));
    records.append(item);
  });
  const context = node('section', 'preview-group');
  context.append(node('h3', '', '上下文摘要'));
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
  const { dialog, content, actions } = dialogShell(retryJob ? '检查并重试整理' : '检查本次发送范围');
  if (retryJob) {
    if (retryJob.operation !== 'daily_analysis') throw new Error('这不是每日整理任务。');
    appendStoredRequestPreview(content, retryJob.request as DailyAnalysisRequest);
    const cancel = node('button', 'button button-secondary', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', () => dialog.close());
    const send = node('button', 'button button-primary', navigator.onLine ? '使用同一请求重试' : '当前离线');
    send.type = 'button';
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
  const recordOptions = entries.map((entry, index) => {
    const option = previewContextRow(`记录 ${index + 1} · v${entry.version}`, entry.body, true);
    option.label.classList.add('is-record');
    content.append(option.label);
    return { entry, input: option.input };
  });
  const contextGroup = node('section', 'preview-group');
  contextGroup.append(node('h3', '', '可选上下文'));
  const eventOption = previewContextRow('当天已确认事件', `${choices.events.length} 条；用于避免重复提取`, Boolean(choices.events.length));
  const stateOption = previewContextRow('最近七天五维摘要', `${choices.recentStates.length} 天；不包含历史原文`, Boolean(choices.recentStates.length));
  const goalOption = previewContextRow('当前目标', choices.goals.map((item) => item.result).join('；') || '无', Boolean(choices.goals.length));
  const habitOption = previewContextRow('习惯打卡', choices.habits.map((item) => item.name).join('；') || '无', Boolean(choices.habits.length));
  const taskResultOption = previewContextRow('当天已记录的任务', `${choices.recentTaskResults.length} 条；用于避免重复计算成长值`, Boolean(choices.recentTaskResults.length));
  [eventOption, stateOption, goalOption, habitOption, taskResultOption].forEach((option) => contextGroup.append(option.label));
  const memoryOptions = choices.memories.map((memory) => {
    const option = previewContextRow(`已保存的信息 · ${MEMORY_TYPE_LABELS[memory.type]}`, memory.statement, true);
    contextGroup.append(option.label);
    return { memory, input: option.input };
  });
  const constraintLabel = node('label', 'field-label', '这次需要考虑的现实约束（可选）');
  const constraints = node('textarea', 'input preview-constraints');
  constraints.maxLength = 600;
  constraints.placeholder = '例如：明天下午只有 20 分钟，今晚需要优先休息。';
  constraintLabel.append(constraints);
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
  const status = node('p', 'save-state');
  status.setAttribute('role', 'status');
  content.append(status);

  const cancel = node('button', 'button button-secondary', '取消发送');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const send = node('button', 'button button-primary', navigator.onLine ? '确认并整理' : '保存为待整理');
  send.type = 'button';
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
  const { dialog, content, actions } = dialogShell('记录详情');
  const kind = entry.kind === 'success' ? '成功小记' : entry.kind === 'fun' ? '有趣的事' : '记住的事';
  content.append(
    node('p', 'caption', `${formatDate(entry.localDate)} · ${new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · ${kind}`),
    node('p', 'entry-detail-body', entry.body),
  );
  const remove = node('button', 'button button-quiet danger-button', '删除');
  remove.type = 'button';
  remove.addEventListener('click', () => { void deleteEntry(entry, dialog); });
  const history = node('button', 'button button-secondary', '修改历史');
  history.type = 'button';
  history.addEventListener('click', () => { dialog.close(); void openHistoryDialog(entry); });
  const edit = node('button', 'button button-primary', '编辑');
  edit.type = 'button';
  edit.addEventListener('click', () => { dialog.close(); void openEditDialog(entry); });
  actions.append(remove, history, edit);
  dialog.showModal();
  edit.focus();
}

async function openEditDialog(entry: JournalEntry): Promise<void> {
  const { dialog, content, actions } = dialogShell('修改记录');
  const bodyLabel = node('label', 'field-label', '正文');
  const textarea = node('textarea', 'journal-input compact');
  textarea.maxLength = 12_000;
  textarea.value = entry.body;
  bodyLabel.append(textarea);
  let kind: NonNullable<JournalEntry['kind']> = entry.kind ?? 'journal';
  const typeControl = node('div', 'record-prompt-actions');
  typeControl.setAttribute('aria-label', '记录类型');
  for (const [value, label] of [['journal', '记住的事'], ['success', '成功小记'], ['fun', '有趣的事']] as const) {
    const button = node('button', 'button button-quiet', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(kind === value));
    button.addEventListener('click', () => {
      kind = value;
      typeControl.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    });
    typeControl.append(button);
  }
  const status = node('p', 'save-state', `当前版本 v${entry.version}`);
  content.append(bodyLabel, typeControl, status);
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '保存修改');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = '正在保存修改…';
    try {
      await db.editEntry(entry.id, entry.version, textarea.value, kind);
      dialog.close();
      showToast('修改已保存，可撤销一次。');
      await render();
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, save);
  dialog.showModal();
  textarea.focus();
}

async function openHistoryDialog(entry: JournalEntry): Promise<void> {
  const history = await db.listRevisions(entry.id);
  const { dialog, content, actions } = dialogShell('修改历史');
  if (!history.length) content.append(node('p', 'empty-copy', '暂无修改'));
  for (const revision of history) {
    const item = node('article', 'revision-item');
    item.append(
      node('strong', '', `v${revision.fromVersion} · ${revision.reason === 'user-edit' ? '修改前版本' : '撤销前版本'}`),
      node('time', 'caption', new Date(revision.createdAt).toLocaleString('zh-CN')),
      node('p', '', revision.previousBody),
    );
    content.append(item);
  }
  const close = node('button', 'button button-secondary', '关闭');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  actions.append(close);
  const latest = history[0];
  if (latest?.reason === 'user-edit' && !latest.undoneAt && latest.fromVersion + 1 === entry.version) {
    const undo = node('button', 'button button-primary', '撤销最近修改');
    undo.type = 'button';
    undo.addEventListener('click', async () => {
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
    });
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
  const close = node('button', 'button button-primary', '我知道了');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
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
  const evidence = node('section', 'event-evidence');
  evidence.append(node('h3', '', '对应原文'));
  item.evidence.forEach((value) => evidence.append(node('blockquote', '', `“${value.quote}”`)));
  content.append(evidence);
  if (item.stateImpactCandidates.length) {
    const impacts = node('section', 'event-evidence');
    impacts.append(node('h3', '', '状态建议'));
    item.stateImpactCandidates.forEach((impact) => impacts.append(node('p', '', `${dimensionLabel(fromContractDimension(impact.dimension))} ${impact.suggestedDelta > 0 ? '+' : ''}${impact.suggestedDelta}`)));
    content.append(impacts);
  }
  let growthDimension: HTMLSelectElement | undefined;
  let growthXp: HTMLSelectElement | undefined;
  if (item.growthEvidenceCandidate) {
    const growth = node('section', 'event-growth-decision');
    growth.append(node('h3', '', '成长建议'));
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
  const status = node('p', 'save-state');
  status.setAttribute('role', 'status');
  content.append(status);
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const reject = node('button', 'button button-quiet', item.confirmation === 'rejected' ? '保持否认' : '否认并撤销影响');
  reject.type = 'button';
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
  const confirm = node('button', 'button button-primary', item.confirmation === 'confirmed' ? '保存核对结果' : '确认并应用建议');
  confirm.type = 'button';
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
  card.append(iconButton(decisionLabel, null, () => { void openEventDecision(item); }, 'button button-secondary'));
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
  const heading = node('div', 'section-heading');
  heading.append(node('div', '', undefined));
  heading.firstElementChild?.append(node('h2', '', ready ? '整理结果' : '今天的整理'));
  section.append(heading);

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
    const retry = node('button', 'button button-primary', !NATIVE_AI_READY ? 'MiniMax 未配置' : navigator.onLine ? '检查范围并重试' : '当前离线');
    retry.type = 'button';
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
    successBlock.append(iconButton(successes.length ? '再写一条成功小记' : '写一条成功小记', null, () => openSuccessRecord(date), 'button button-secondary'));
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
    eventList.append(node('h3', '', `待你核对 · ${pendingEvents.length}`));
    pendingEvents.forEach((item) => eventList.append(eventCard(item)));
  }
  if (reviewedEvents.length) {
    const history = node('details', 'analysis-event-history optional-details');
    history.append(node('summary', '', `已核对事件 · ${reviewedEvents.length}`));
    reviewedEvents.forEach((item) => history.append(eventCard(item)));
    eventList.append(history);
  }
  if (eventList.childElementCount) section.append(eventList);

  const reflection = node('section', 'daily-reflection');
  reflection.append(node('h3', '', '今天留下的'));
  const successes = successCredits(entries, quests, events);
  const successBlock = node('section', 'success-evidence');
  successBlock.append(node('strong', '', '成功小记'));
  if (successes.length) {
    const list = node('ul', 'success-list');
    successes.forEach((item) => list.append(node('li', '', item)));
    successBlock.append(list);
  }
  reflection.append(successBlock);
  const nextStep = node('div', 'reflection-row');
  nextStep.append(node('strong', '', '明天最小一步'), node('p', '', ready.result.reflection.nextSmallStep));
  reflection.append(nextStep);
  const moreReflection = node('details', 'daily-reflection-more optional-details');
  moreReflection.append(node('summary', '', '更多复盘'));
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
    const suggestions = node('section', 'quest-suggestions');
    suggestions.append(node('h3', '', '明日任务草案'));
    ready.result.questSuggestions.forEach((suggestion, index) => {
      const actionId = `analysis:${ready.id}:suggestion:${index}`;
      const accepted = tomorrowQuests.some((quest) => quest.actionId === actionId);
      const card = node('article', 'quest-suggestion');
      card.append(node('span', 'tag', '任务建议'), node('h4', '', suggestion.title), node('p', '', suggestion.why), node('p', 'caption', `最小一步：${suggestion.minimumVersion} · ${suggestion.estimatedMinutes} 分钟`));
      const accept = node('button', 'button button-secondary', accepted ? '已加入任务板' : '由我确认并加入');
      accept.type = 'button';
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
  if (candidateCount) section.append(iconButton(`待确认建议 · ${candidateCount}`, null, () => go({ name: 'system' }), 'button button-quiet'));
  const sourceVersions = new Map(ready.sourceEntries.map((item) => [item.entryId, item.revision]));
  const uncovered = entries.filter((entry) => sourceVersions.get(entry.id) !== entry.version).length;
  const refresh = iconButton(uncovered ? `有 ${uncovered} 条新增记录，重新整理` : '重新检查范围并整理', null, () => { void openAnalysisPreview(date, entries); }, 'button button-secondary');
  if (uncovered) section.append(refresh);
  else {
    const maintenance = node('details', 'analysis-maintenance optional-details');
    maintenance.append(node('summary', '', '整理范围与更新'));
    if (ready.contextSummary) maintenance.append(node('p', 'caption', ready.contextSummary));
    maintenance.append(refresh);
    section.append(maintenance);
  }
  return section;
}

async function dayPage(date: string): Promise<HTMLElement> {
  const [entries, observations, allQuests, allFeedback, profile, analyses] = await Promise.all([
    db.listEntries(date), db.resolvedStateAtOrBefore(date), db.listQuests(), db.listQuestFeedback(), db.getProfile(), db.listDailyAnalyses(date),
  ]);
  const activeFeedback = activeFeedbackByQuest(allFeedback);
  const quests = allQuests.filter((quest) => {
    const feedback = activeFeedback.get(quest.id);
    return feedback && questResultDate(quest, activeFeedback) === date;
  });
  const main = node('main', 'page page-day');
  const addRecord = node('button', 'page-header-text-action', '新增');
  addRecord.type = 'button';
  addRecord.addEventListener('click', () => go({ name: 'record', date }));
  main.append(secondaryPageHeader(formatDate(date).replace('日周', '日 周'), addRecord));

  const journal = node('section', 'journal-sheet');
  journal.append(node('h2', '', '今天留下的'));
  if (!entries.length) journal.append(node('p', 'journal-empty', '暂无记录'));
  for (const entry of entries) {
    const item = node('button', `day-record-row is-${entry.kind ?? 'journal'}`);
    item.type = 'button';
    item.setAttribute('aria-label', `查看记录详情：${entry.body.slice(0, 30)}`);
    const copy = node('div', 'day-record-copy');
    const meta = node('div', 'day-record-meta');
    meta.append(
      node('time', '', new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
      node('span', 'day-record-kind', entry.kind === 'success' ? '成功小记' : entry.kind === 'fun' ? '有趣的事' : '记住的事'),
    );
    copy.append(meta, node('p', 'day-record-body', entry.body));
    const recordIcon = node('span', 'day-record-icon');
    recordIcon.append(semanticIcon(entry.kind === 'success' ? 'success-record' : 'nav-record'));
    item.append(recordIcon, copy);
    item.addEventListener('click', () => { void openEntryDetailDialog(entry); });
    journal.append(item);
  }

  const actionResults = node('section', 'day-action-results');
  actionResults.append(node('h2', '', '行动结果'));
  if (!quests.length) actionResults.append(node('p', 'empty-copy', '这一天还没有行动结果'));
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
  const dayTabs = node('nav', 'day-section-tabs');
  dayTabs.setAttribute('aria-label', '日期回顾分段');
  const requestedView = sessionStorage.getItem('qiguang.day-view');
  const initialView = requestedView === 'records' ? 'records' : requestedView === 'actions' ? 'actions' : 'overview';
  const sectionTargets: Array<[string, string, HTMLElement]> = [['总览', 'overview', overview], ['记录', 'records', journal], ['行动', 'actions', actionResults]];
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
    const button = node('button', `day-section-tab${view === initialView ? ' is-active' : ''}`, label);
    button.type = 'button';
    button.dataset.view = view;
    button.setAttribute('aria-pressed', String(view === initialView));
    button.addEventListener('click', () => { sessionStorage.setItem('qiguang.day-view', view); selectDayView(view); });
    dayTabs.append(button);
  });
  main.append(dayTabs, overview, journal, actionResults);
  selectDayView(initialView);

  if (entries.length || quests.length) {
    const analysis = node('details', 'day-evidence-details day-analysis-details optional-details');
    analysis.append(node('summary', '', '查看当天整理'), await dailyAnalysisSection(date, entries, quests));
    main.append(analysis);
  }

  const dayNav = node('nav', 'day-navigation');
  dayNav.setAttribute('aria-label', '日期导航');
  const calendar = node('button', 'button button-secondary', '返回日历');
  calendar.type = 'button';
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
    const cancel = node('button', 'button button-secondary', '取消');
    cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
    const send = node('button', 'button button-primary', navigator.onLine ? '使用同一请求重试' : '当前离线');
    send.type = 'button'; send.disabled = !navigator.onLine;
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
  const editScope = node('button', 'button button-quiet', '调整每次周复盘默认包含的信息');
  editScope.type = 'button';
  editScope.addEventListener('click', () => { dialog.close(); go({ name: 'system' }); });
  content.append(labelledControl('本周补充说明（可选）', note), scopeNote, editScope, preview);
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const send = node('button', 'button button-primary', navigator.onLine ? '确认并生成' : '当前离线');
  send.type = 'button'; send.disabled = !navigator.onLine;
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
  const { dialog, content, actions } = dialogShell('确认下周重点和小尝试');
  const theme = node('input', 'input'); theme.maxLength = 120; theme.value = review.nextTheme;
  const hypothesis = node('textarea', 'input compact-textarea'); hypothesis.maxLength = 500; hypothesis.value = review.nextExperiment.hypothesis;
  const minimum = node('textarea', 'input compact-textarea'); minimum.maxLength = 300; minimum.value = review.nextExperiment.minimumAction;
  const metric = node('textarea', 'input compact-textarea'); metric.maxLength = 300; metric.value = review.nextExperiment.metric;
  const earliestEndDate = [shiftDate(review.periodEnd, 1), localDate()].sort().at(-1)!;
  const endDate = node('input', 'input'); endDate.type = 'date'; endDate.min = earliestEndDate; endDate.value = review.nextExperiment.endDate < earliestEndDate ? earliestEndDate : review.nextExperiment.endDate;
  const stop = node('textarea', 'input compact-textarea'); stop.maxLength = 300; stop.value = review.nextExperiment.stopCondition;
  const status = node('p', 'save-state');
  content.append(labelledControl('下周重点', theme), labelledControl('一个小尝试', hypothesis), labelledControl('先从哪一步开始', minimum), labelledControl('怎样判断有没有效果', metric), labelledControl('结束日期', endDate), labelledControl('什么时候停止', stop), status);
  const cancel = node('button', 'button button-secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const confirm = node('button', 'button button-primary', '由我确认'); confirm.type = 'button';
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      const result = await db.confirmWeeklyReview(review.id, theme.value, { hypothesis: hypothesis.value, minimumAction: minimum.value, metric: metric.value, endDate: endDate.value, stopCondition: stop.value });
      dialog.close(); showToast(result.questScheduled ? '周复盘已确认，周实验行动已排入原定日期。' : '周复盘已确认；周实验行动仅保留为建议，没有覆盖已有安排。'); await render();
    } catch (error) { confirm.disabled = false; status.textContent = errorMessage(error); status.classList.add('is-error'); }
  });
  actions.append(cancel, confirm); dialog.showModal(); theme.focus();
}

function evidenceSummary(item: { summary: string; evidenceEventIds: string[]; evidenceDates: string[]; relationship: string }, events: JournalEvent[]): HTMLElement {
  const block = node('article', 'review-evidence-row');
  const relation = ({ correlation: '相关线索', causal: '可能的因果联系', unknown: '关系未知' } as Record<string, string>)[item.relationship] ?? '关系未知';
  block.append(node('p', '', item.summary));
  const evidence = node('details', 'review-evidence-details optional-details');
  evidence.append(node('summary', '', '查看依据'));
  evidence.append(node('p', 'caption', `${relation} · ${item.evidenceDates.length ? item.evidenceDates.map((date) => formatDate(date)).join('、') : '暂无跨日记录'}`));
  if (item.evidenceEventIds.length) evidence.append(node('p', 'caption', item.evidenceEventIds.map((id) => events.find((event) => event.id === id)?.title ?? '相关内容已变更').join('；')));
  block.append(evidence);
  return block;
}

async function weeklyReviewPage(anchor: string): Promise<HTMLElement> {
  const period = weekRange(anchor);
  const [reviews, jobs, events, habits, memories, goals, allQuests, feedbacks, entries] = await Promise.all([
    db.listReviews('weekly'), db.listAnalysisJobs(period.end), db.listJournalEvents(), db.listHabits(), db.listMemories(), db.listGoals(), db.listQuests(), db.listQuestFeedback(), db.listEntries(),
  ]);
  const feedbackByQuest = activeFeedbackByQuest(feedbacks);
  const periodQuests = allQuests.filter((quest) => {
    const resultDate = questResultDate(quest, feedbackByQuest);
    return feedbackByQuest.has(quest.id) && resultDate >= period.start && resultDate <= period.end && quest.status !== 'pending';
  });
  const review = reviews.find((item) => item.periodStart === period.start && item.periodEnd === period.end);
  const job = jobs.filter((item) => item.operation === 'weekly_review' && (item.request as WeeklyReviewRequest).period.start === period.start)[0];
  const main = node('main', 'page page-review');
  main.append(pageHeader('', '本周'));
  main.append(trailTabs('review'));
  const nav = node('nav', 'review-period-nav'); nav.setAttribute('aria-label', '周复盘周期');
  const previousWeek = iconButton('上一周', null, () => go({ name: 'review', date: shiftDate(period.start, -7) }));
  const nextWeek = iconButton('下一周', null, () => go({ name: 'review', date: shiftDate(period.start, 7) }));
  nextWeek.disabled = shiftDate(period.start, 7) > localDate();
  nav.append(previousWeek, node('span', 'caption review-period', `${formatDate(period.start, { weekday: undefined })} - ${formatDate(period.end, { weekday: undefined })}`), nextWeek);
  main.append(nav);
  const weekEntries = entries.filter((entry) => entry.localDate >= period.start && entry.localDate <= period.end);
  const completedTasks = periodQuests.filter((quest) => quest.status === 'completed' || quest.status === 'partial').length;
  const habitChecks = periodQuests.filter((quest) => quest.sourceType === 'habit' && (quest.status === 'completed' || quest.status === 'partial')).length;
  const summary = node('section', 'review-summary-card');
  summary.append(node('h2', '', completedTasks || habitChecks || weekEntries.length ? '这周做得不错' : '这一周还在开始'));
  const summaryStats = node('div', 'review-summary-stats');
  summaryStats.append(
    node('span', '', `完成\n${completedTasks} 项任务`),
    node('span', '', `习惯\n${habitChecks} 次`),
    node('span', '', `留下\n${weekEntries.length} 篇记录`),
  );
  summary.append(summaryStats);
  main.append(summary);
  if (!review) {
    const intro = node('section', 'surface review-intro');
    intro.append(node('h2', '', '生成本周复盘'));
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

  const focus = node('section', 'review-focus-card');
  const focusIcon = node('span', 'review-section-icon is-target');
  focusIcon.append(semanticIcon('goal'));
  focus.append(
    focusIcon,
    node('h2', '', '下周重点'),
    node('strong', '', review.nextTheme),
  );
  main.append(focus);

  const proposedExperiment = node('section', 'review-proposed-experiment');
  const experimentIcon = node('span', 'review-section-icon is-idea');
  experimentIcon.append(semanticIcon('weekly-review'));
  proposedExperiment.append(
    experimentIcon,
    node('h2', '', '一个小尝试'),
    node('strong', '', review.nextExperiment.hypothesis),
    node('p', 'muted', `判断有没有效果：${review.nextExperiment.metric}`),
  );
  main.append(proposedExperiment);

  const adjustments = node('section', 'review-adjustments');
  const adjustmentIcon = node('span', 'review-section-icon is-adjust');
  adjustmentIcon.append(semanticIcon('rules'));
  adjustments.append(adjustmentIcon, node('h2', '', '会调整什么'));
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
    const edit = node('button', 'button button-secondary', '编辑后采用');
    edit.type = 'button';
    edit.addEventListener('click', () => { void openReviewConfirmation(review); });
    const quiet = node('div', 'review-quiet-actions');
    const recheck = node('button', 'button button-quiet', '重新检查本周');
    recheck.type = 'button'; recheck.addEventListener('click', () => { void openWeeklyReviewPreview(period); });
    const reject = node('button', 'button button-quiet', '暂不采用');
    reject.type = 'button';
    reject.addEventListener('click', async () => {
      if (!await confirmAction('暂不采用这份建议？', '不会扣分，也不会新增任务。之后仍可重新生成。', '暂不采用')) return;
      try { await db.rejectWeeklyReview(review.id); showToast('已暂不采用；没有修改计划。'); await render(); }
      catch (error) { showToast(errorMessage(error), 'error'); }
    });
    quiet.append(recheck, reject);
    decisionActions.append(adopt, edit, quiet);
    main.append(decisionActions);
  } else {
    main.append(node('p', 'review-final-state', review.status === 'confirmed' ? '下周计划已采用' : '这份建议已暂不采用'));
  }
  return main;

}

function labelledControl(labelText: string, control: HTMLElement, countLimit?: number): HTMLLabelElement {
  const label = node('label', 'field-label', labelText);
  label.append(control);
  if (countLimit && (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
    label.classList.add('field-with-count');
    const count = node('span', 'field-character-count');
    const updateCount = () => { count.textContent = `${control.value.length}/${countLimit}`; };
    control.addEventListener('input', updateCount);
    updateCount();
    label.append(count);
  }
  return label;
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
  const status = node('p', 'save-state');
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
    const cancel = node('button', 'button button-secondary', '返回修改');
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', () => finish(null), { once: true });
    const send = node('button', 'button button-primary', navigator.onLine ? '确认范围并生成草案' : '当前离线');
    send.type = 'button';
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
  const { dialog, content, actions } = dialogShell('新建目标');
  dialog.classList.add('full-screen-editor', 'goal-editor-dialog');
  addDialogBack(dialog, content);
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
  const status = node('p', 'save-state');
  const assistant = node('section', 'goal-decomposition-assistant');
  const decompose = node('button', 'button button-secondary', !NATIVE_AI_READY ? 'AI 未配置' : navigator.onLine ? 'AI 帮我拆成子任务' : '联网后可使用 AI');
  decompose.type = 'button';
  decompose.disabled = !navigator.onLine || !NATIVE_AI_READY;
  assistant.append(semanticIcon('ai', 'goal-assistant-icon'), decompose);
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
    plan.replaceChildren(node('h3', '', '子任务'));
    milestoneEditors = draft.milestones.map((milestone, index) => {
      const card = node('article', 'goal-plan-step goal-stage-editor');
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
  content.append(
    labelledControl('目标名称', result),
    labelledControl('完成日期', targetDate),
    assistant,
    plan,
    status,
  );
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
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
  const saveOnly = node('button', 'button button-primary', '保存目标');
  saveOnly.type = 'button';
  saveOnly.addEventListener('click', () => { void saveGoal(saveOnly); });
  actions.append(cancel, saveOnly);
  dialog.showModal();
}

async function openGoalSettingsDialog(goal: Goal): Promise<void> {
  const { dialog, content, actions } = dialogShell('编辑目标');
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
  const status = node('p', 'save-state');
  content.append(
    labelledControl('目标名称', result),
    labelledControl('完成日期', targetDate),
    labelledControl('目标状态', goalStatus),
    status,
  );
  const cancel = node('button', 'button button-quiet', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '保存目标');
  save.type = 'button';
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
      await announceNewGrowthBadge(achievementsBefore, '目标已更新。');
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
    const card = node('article', 'goal-plan-step goal-stage-editor');
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
  const status = node('p', 'save-state'); status.setAttribute('role', 'status'); content.append(status);
  const cancel = node('button', 'button button-secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const confirm = node('button', 'button button-primary', '保存新计划'); confirm.type = 'button';
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
  const { dialog, content, actions } = dialogShell('添加子任务');
  const title = node('input', 'input');
  title.maxLength = 160;
  const date = node('input', 'input');
  date.type = 'date';
  date.min = localDate();
  date.value = goal.targetDate && goal.targetDate >= localDate() ? goal.targetDate : localDate();
  const reminder = node('input', 'input'); reminder.type = 'time';
  const dimension = taskDimensionSelect();
  const difficulty = taskDifficultySelect();
  const status = node('p', 'save-state');
  content.append(
    labelledControl('子任务名称', title),
    labelledControl('完成日期', date),
    labelledControl('提醒时间（应用内，可选）', reminder),
    labelledControl('五维状态', dimension),
    labelledControl('难度', difficulty),
    status,
  );
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '添加');
  save.type = 'button';
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
  const { dialog, content, actions } = dialogShell(goal ? '安排目标下一步' : '安排每日任务');
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
  const status = node('p', 'save-state');
  content.append(
    labelledControl('任务名称', title),
    labelledControl('安排日期', date),
    labelledControl('提醒时间（应用内，可选）', reminder),
    labelledControl('五维状态', dimension),
    labelledControl('难度', difficulty),
    status,
  );
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '安排任务');
  save.type = 'button';
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
  const { dialog, content, actions } = dialogShell(habit ? '编辑习惯' : '新建习惯');
  dialog.classList.add('full-screen-editor', 'habit-editor-dialog');
  addDialogBack(dialog, content);
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
  completionMode.append(selectOption('once', '每天完成一次', !habit?.targetCount), selectOption('count', '每天计数打卡', Boolean(habit?.targetCount)));
  const targetCount = node('input', 'input');
  targetCount.type = 'number'; targetCount.min = '2'; targetCount.max = '1000'; targetCount.value = String(habit?.targetCount ?? 8);
  const countUnit = node('input', 'input');
  countUnit.maxLength = 20; countUnit.value = habit?.countUnit ?? '次';
  const countFields = node('div', 'count-task-fields');
  countFields.hidden = !habit?.targetCount;
  countFields.append(labelledControl('每日目标次数', targetCount), labelledControl('计数单位', countUnit));
  completionMode.addEventListener('change', () => { countFields.hidden = completionMode.value !== 'count'; });
  const trigger = node('select', 'input');
  const triggerValue = habit?.trigger ?? '';
  const triggerOptions = ['晚饭后', '起床后', '放学后', '完成晚间洗漱后', '睡前'];
  trigger.append(selectOption('', '选择触发方式', !triggerValue));
  if (triggerValue && !triggerOptions.includes(triggerValue)) trigger.append(selectOption(triggerValue, triggerValue, true));
  triggerOptions.forEach((value) => trigger.append(selectOption(value, value, triggerValue === value)));
  const schedule = node('fieldset', 'weekday-picker');
  schedule.append(node('legend', 'field-label', '计划日'));
  ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].forEach((labelText, index) => {
    const label = node('label', 'weekday-option');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(index + 1);
    checkbox.checked = habit ? habit.scheduleDays.includes(index + 1) : index < 5;
    label.append(checkbox, node('span', '', labelText));
    schedule.append(label);
  });
  const dimension = taskDimensionSelect(habit?.dimension ?? 'progress');
  const difficulty = taskDifficultySelect(habit?.difficulty ?? 'standard');
  const habitStatus = node('select', 'input');
  habitStatus.append(
    selectOption('active', '进行中', (habit?.status ?? 'active') === 'active'),
    selectOption('paused', '已暂停', habit?.status === 'paused'),
    selectOption('ended', '已结束', habit?.status === 'ended'),
  );
  const bonusLabel = node('label', 'setting-row');
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
        const savedDays = new Set((draft.scheduleDays ?? '').split(',').filter(Boolean));
        if (savedDays.size) schedule.querySelectorAll<HTMLInputElement>('input').forEach((input) => { input.checked = savedDays.has(input.value); });
        editorDraftState.textContent = '草稿已保存';
      }
    } catch { /* The editor remains usable if its local draft is damaged. */ }
    completionMode.value = 'once';
    countFields.hidden = true;
    const persistEditorDraft = () => {
      try {
        const scheduleDays = Array.from(schedule.querySelectorAll<HTMLInputElement>('input:checked')).map((input) => input.value).join(',');
        localStorage.setItem(editorDraftKey, JSON.stringify({ name: name.value, minimum: minimum.value, trigger: trigger.value, scheduleDays, dimension: dimension.value, difficulty: difficulty.value, status: habitStatus.value, bonus: String(bonus.checked) }));
        editorDraftState.textContent = '草稿已保存';
      } catch { editorDraftState.textContent = '草稿暂时无法保存'; }
    };
    [name, minimum, trigger, schedule, dimension, difficulty, habitStatus, bonus].forEach((control) => {
      control.addEventListener('input', persistEditorDraft);
      control.addEventListener('change', persistEditorDraft);
    });
  }
  const status = node('p', 'save-state');
  const advanced = node('details', 'form-advanced');
  advanced.open = Boolean(habit?.targetCount);
  advanced.append(node('summary', '', '计数设置（可选）'));
  const advancedFields = node('div', 'form-advanced-fields');
  advancedFields.append(labelledControl('完成方式', completionMode), countFields);
  advanced.append(advancedFields);
  content.append(
    editorDraftState, labelledControl('习惯名称', name), labelledControl('最简单做法', minimum), labelledControl('什么时候做', trigger), schedule,
    labelledControl('五维状态', dimension), labelledControl('难度', difficulty), bonusLabel,
    labelledControl('状态', habitStatus), status,
  );
  content.insertBefore(advanced, status);
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', habit ? '保存习惯' : '建立习惯');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    const days = Array.from(schedule.querySelectorAll<HTMLInputElement>('input:checked')).map((item) => Number(item.value));
    try {
      const value = {
        name: name.value, minimumAction: minimum.value.trim() || name.value.trim(), trigger: trigger.value, scheduleDays: days,
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
  const { dialog, content, actions } = dialogShell('目标详情');
  dialog.classList.add('full-screen-editor', 'goal-detail-dialog');
  addDialogBack(dialog, content);
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
  progressLine.append(node('strong', '', `${completed} / ${currentMilestones.length || '—'} 子任务`), node('strong', '', `${progress}%`));
  hero.append(progressLine, meter);
  const goalMeta = node('section', 'goal-detail-meta-grid');
  goalMeta.append(node('span', '', goal.targetDate ? `完成日期 ${formatDate(goal.targetDate)}` : '未设完成日期'));
  hero.append(goalMeta);
  const more = node('button', 'detail-header-more', '⋮');
  more.type = 'button';
  more.setAttribute('aria-label', '更多目标操作');
  more.addEventListener('click', () => { dialog.close(); void openGoalSettingsDialog(goal); });
  content.append(more, hero);
  const stages = node('section', 'entity-detail-section');
  stages.append(node('h3', '', '子任务'));
  if (!currentMilestones.length) stages.append(node('p', 'empty-copy', '还没有子任务'));
  const nextMilestoneId = currentMilestones.find((item) => item.status === 'pending')?.id;
  currentMilestones.forEach((milestone, index) => {
    const row = node('article', `goal-detail-stage is-${milestone.status}`);
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
      const controls = node('div', 'goal-stage-actions');
      const marker = node('span', `stage-toggle ${milestone.status === 'completed' ? 'is-complete' : ''}`, milestone.status === 'completed' ? '✓' : '');
      marker.setAttribute('aria-label', milestone.status === 'completed' ? `已完成：${milestone.description}` : `待完成：${milestone.description}`);
      controls.append(marker);
      if (linkedQuest?.status === 'pending') {
        const editStage = node('button', 'button button-quiet button-compact', '编辑');
        editStage.type = 'button';
        editStage.setAttribute('aria-label', `编辑子任务：${milestone.description}`);
        editStage.addEventListener('click', () => { dialog.close(); void openQuestAdjustmentDialog(linkedQuest); });
        controls.append(editStage);
      }
      row.append(controls);
    }
    stages.append(row);
  });
  content.append(stages);
  const edit = node('button', 'button button-quiet', '编辑目标');
  edit.type = 'button';
  edit.addEventListener('click', () => { dialog.close(); void openGoalSettingsDialog(goal); });
  const add = node('button', 'button button-secondary', '添加子任务');
  add.type = 'button';
  add.addEventListener('click', () => { dialog.close(); void openMilestoneDialog(goal); });
  const readyToComplete = goal.status === 'active' && currentMilestones.length > 0
    && currentMilestones.every((item) => item.status === 'completed');
  if (readyToComplete) {
    const completeGoal = node('button', 'button button-primary', '确认目标完成');
    completeGoal.type = 'button';
    completeGoal.addEventListener('click', async () => {
      const confirmed = await confirmAction('确认目标已完成？', '所有子任务已完成。确认后会保存完成日期，并停止这个目标尚未执行的任务。', '确认完成');
      if (!confirmed) return;
      completeGoal.disabled = true;
      try {
        const achievementsBefore = await growthBadgeIds();
        await db.saveGoal(goal.id, { status: 'completed' });
        dialog.close();
        await render();
        await announceNewGrowthBadge(achievementsBefore, '目标已完成。');
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
  const [logs, quests, momentum] = await Promise.all([db.listHabitLogs(), db.listQuests(), db.habitMomentum(habit.id)]);
  const habitLogs = logs.filter((item) => item.habitId === habit.id).sort((left, right) => right.localDate.localeCompare(left.localDate));
  const { dialog, content, actions } = dialogShell('习惯详情');
  dialog.classList.add('full-screen-editor', 'habit-detail-dialog');
  addDialogBack(dialog, content);
  const hero = node('section', 'entity-detail-hero');
  const habitIcon = node('span', 'entity-detail-icon is-habit-icon');
  habitIcon.append(semanticIcon('habit'));
  hero.append(habitIcon, node('h3', '', habit.name), node('p', 'success-copy', habit.status === 'active' && habit.bonusEnabled ? '● 进行中' : '● 已暂停'));
  const habitMeta = node('section', 'habit-detail-meta');
  const metaRow = (label: string, value: string): HTMLElement => {
    const row = node('p', 'habit-detail-meta-row');
    row.append(node('span', 'muted', label), node('strong', '', value));
    return row;
  };
  habitMeta.append(
    metaRow('最简单做法', habit.minimumAction),
    metaRow('触发方式', `${habit.trigger || '未设置'} · ${habitScheduleLabel(habit.scheduleDays)}`),
  );
  habitMeta.append(metaRow('五维状态', dimensionLabel(habit.dimension)));
  hero.append(habitMeta);
  const more = node('button', 'detail-header-more', '⋮');
  more.type = 'button';
  more.setAttribute('aria-label', '更多习惯操作');
  more.addEventListener('click', () => { dialog.close(); void openHabitDialog(habit); });
  const analysis = node('button', 'detail-header-analysis', '分析');
  analysis.type = 'button';
  analysis.addEventListener('click', () => { dialog.close(); go({ name: 'habit-analysis', entityId: habit.id }); });
  content.append(analysis, more, hero);
  const currentWeek = weekRange(localDate());
  const weekCompleted = new Set(habitLogs.filter((item) => item.localDate >= currentWeek.start && item.localDate <= currentWeek.end && ['completed', 'partial'].includes(item.result)).map((item) => item.localDate)).size;
  const stats = node('section', 'habit-detail-stats');
  const stat = (label: string, value: string, caption: string): HTMLElement => {
    const item = node('span', 'habit-stat');
    item.append(node('span', '', label), node('strong', '', value), node('small', '', caption));
    return item;
  };
  stats.append(stat(`本周（计划${habit.scheduleDays.length}天）`, `${weekCompleted}/${habit.scheduleDays.length}`, '已完成 / 计划天数'), stat('近7计划日', `${momentum}/5`, '完成节奏'), stat('累计', `${habitLogs.length} 次`, '总打卡次数'));
  content.append(stats);
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
  content.append(weekCard);
  if (showCheckIn) {
    const todayQuest = quests.find((quest) => quest.localDate === localDate() && quest.sourceType === 'habit' && quest.sourceId === habit.id);
    const checkinActions = node('div', 'habit-detail-checkin-actions');
    if (todayQuest?.status === 'pending') {
      const target = todayQuest.targetCount ?? 1;
      const progress = todayQuest.progressCount ?? 0;
      checkinActions.append(primaryButton(todayQuest.targetCount ? `打卡 ${progress}/${target}` : '完成今天打卡', () => {
        dialog.close();
        recordQuestCheckIn(todayQuest, content);
      }));
    } else if (todayQuest) {
      const completed = node('button', 'button habit-checkin-complete', todayQuest.status === 'partial' ? '今天已有进展' : '今日已完成');
      completed.type = 'button';
      completed.disabled = true;
      checkinActions.append(completed);
    }
    const makeUp = node('button', 'button button-quiet', '补记');
    makeUp.type = 'button';
    makeUp.addEventListener('click', () => {
      const pending = quests.filter((quest) => quest.sourceType === 'habit' && quest.sourceId === habit.id && quest.status === 'pending' && quest.localDate <= localDate()).sort((left, right) => right.localDate.localeCompare(left.localDate))[0];
      if (pending) { dialog.close(); void openQuestFeedbackDialog(pending, 'completed'); }
      else showToast('暂无可补记的计划日。');
    });
    checkinActions.append(makeUp);
    content.append(checkinActions);
  }
  const recent = node('section', 'entity-detail-section');
  const recentHeading = node('div', 'section-heading');
  const allRecords = node('button', 'section-text-action', '全部记录 ›');
  allRecords.type = 'button'; allRecords.addEventListener('click', () => { dialog.close(); go({ name: 'habit-analysis', entityId: habit.id }); });
  recentHeading.append(node('h3', '', '最近记录'), allRecords); recent.append(recentHeading);
  const recentGrid = node('div', 'habit-recent-grid');
  for (let offset = 27; offset >= 0; offset -= 1) {
    const date = shiftDate(localDate(), -offset);
    const log = habitLogs.find((item) => item.localDate === date);
    const result = log?.result ?? 'empty';
    const cell = node('span', `habit-recent-cell is-${result}`);
    cell.setAttribute('role', 'img');
    cell.setAttribute('aria-label', `${formatDate(date)}：${result === 'completed' ? '完成' : result === 'partial' ? '有进展' : result === 'skipped' || result === 'exempt' ? '跳过' : '无记录'}`);
    cell.title = cell.getAttribute('aria-label') ?? '';
    recentGrid.append(cell);
  }
  if (habitLogs.length) recent.append(recentGrid);
  if (!habitLogs.length) recent.append(node('p', 'empty-copy', '暂无打卡记录'));
  content.append(recent);
  const edit = node('button', 'button button-secondary', '编辑计划');
  edit.type = 'button';
  edit.addEventListener('click', () => { dialog.close(); void openHabitDialog(habit); });
  const pause = node('button', 'button button-quiet', habit.status === 'active' && habit.bonusEnabled ? '暂停打卡' : '开始打卡');
  pause.type = 'button';
  pause.addEventListener('click', async () => {
    pause.disabled = true;
    try { await db.saveHabit(habit.id, { status: 'active', bonusEnabled: !(habit.status === 'active' && habit.bonusEnabled) }); dialog.close(); await render(); }
    catch (error) { pause.disabled = false; showToast(errorMessage(error), 'error'); }
  });
  actions.append(edit, pause);
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
  const [milestonesByGoal, momentums] = await Promise.all([
    Promise.all(goals.map((goal) => db.listMilestones(goal.id))),
    Promise.all(habits.map((habit) => db.habitMomentum(habit.id, today))),
  ]);
  const futureQuests = allQuests
    .filter((quest) => quest.status === 'pending' && !quest.systemRetiredAt && quest.localDate > today)
    .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.createdAt.localeCompare(right.createdAt));
  const main = node('main', 'page page-tasks');
  const analysis = node('button', 'page-header-text-action', '分析');
  analysis.type = 'button';
  analysis.addEventListener('click', () => go({ name: 'task-analysis' }));
  const header = pageHeader(formatDate(today), '任务', analysis);
  const headerMeta = header.querySelector<HTMLElement>('.page-header-meta');
  const todayPanel = node('div', 'task-view-panel');
  todayPanel.id = 'task-view-today';
  todayPanel.setAttribute('role', 'tabpanel');
  todayPanel.setAttribute('aria-labelledby', 'task-tab-today');
  const planPanel = node('div', 'task-view-panel');
  planPanel.id = 'task-view-plan';
  planPanel.setAttribute('role', 'tabpanel');
  planPanel.setAttribute('aria-labelledby', 'task-tab-plan');
  const tabs = node('nav', 'task-view-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '任务视图');
  const todayTab = node('button', 'task-view-tab', '今天');
  todayTab.id = 'task-tab-today';
  todayTab.type = 'button';
  todayTab.setAttribute('role', 'tab');
  todayTab.setAttribute('aria-controls', todayPanel.id);
  const planTab = node('button', 'task-view-tab', '计划');
  planTab.id = 'task-tab-plan';
  planTab.type = 'button';
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
  const day = node('section', 'task-board');
  const dayHeading = node('div', 'section-heading');
  dayHeading.append(node('h2', '', '今天要做'));
  day.append(dayHeading);
  if (!quests.length) {
    day.append(node('p', 'empty-copy', '暂无任务'));
  } else {
    const pendingQuests = quests.filter((quest) => quest.status === 'pending' && quest.sourceType !== 'habit');
    const habitQuests = quests.filter((quest) => quest.sourceType === 'habit' && !quest.systemRetiredAt);
    const settledQuests = quests.filter((quest) => quest.status !== 'pending' && quest.sourceType !== 'habit' && !quest.systemRetiredAt);
    const retiredQuests = quests.filter((quest) => quest.systemRetiredAt && quest.systemRetiredReason !== 'capacity');
    if (pendingQuests.length) {
      const taskGroup = node('div', 'task-today-list');
      pendingQuests.forEach((quest) => taskGroup.append(taskListQuest(quest, false, true, true)));
      day.append(taskGroup);
      enableTaskReordering(taskGroup, today);
    } else day.append(node('p', 'empty-copy', '今天的任务已经完成'));
    if (habitQuests.length) {
      const habitGroup = node('section', 'task-today-habits');
      habitGroup.append(node('h3', '', `习惯打卡 · ${habitPendingCount} 项待打卡`));
      habitQuests.forEach((quest) => {
        const habit = storedHabits.find((item) => item.id === quest.sourceId);
        if (habit) habitGroup.append(habitTodayRow(habit, quest));
      });
      day.append(habitGroup);
    }
    if (settledQuests.length) {
      const settled = node('details', 'task-settled optional-details');
      settled.open = true;
      settled.append(node('summary', '', `已完成 ${settledQuests.length}`));
      settledQuests.forEach((quest) => settled.append(questCard(quest, false, quest.milestoneId ? milestonesByGoal.flat().find((item) => item.id === quest.milestoneId) : undefined, true)));
      day.append(settled);
    }
    if (retiredQuests.length) {
      const retired = node('details', 'task-retired optional-details');
      retired.append(node('summary', '', `已暂停 ${retiredQuests.length}`));
      retiredQuests.forEach((quest) => retired.append(questCard(quest, false, quest.milestoneId ? milestonesByGoal.flat().find((item) => item.id === quest.milestoneId) : undefined)));
      day.append(retired);
    }
  }
  const future = node('section', 'task-future');
  if (futureQuests.length) {
    future.append(node('h2', '', `之后已安排 · ${futureQuests.length}`));
    futureQuests.forEach((quest) => {
      const card = questCard(quest, false, quest.milestoneId ? milestonesByGoal.flat().find((item) => item.id === quest.milestoneId) : undefined, false, true);
      future.append(card);
    });
  }
  const quickAdd = node('button', 'task-fab', '＋');
  quickAdd.type = 'button';
  quickAdd.setAttribute('aria-label', '添加任务');
  quickAdd.addEventListener('click', () => { void openQuestDialog(); });
  day.append(quickAdd);
  todayPanel.append(day);

  const planIntro = node('div', 'plan-overview-heading');
  planIntro.append(node('h2', '', '计划总览'));
  planPanel.append(planIntro);
  const goalSection = node('section', 'task-goals');
  const goalHeading = node('div', 'section-heading');
  goalHeading.append(
    node('h2', '', '目标'),
    iconButton('新建', null, () => { void openGoalDialog(); }, 'button button-primary button-compact'),
  );
  goalSection.append(goalHeading);
  if (!goals.length) goalSection.append(node('p', 'empty-copy', '暂无目标'));
  goals.forEach((goal, index) => {
    const card = node('article', 'goal-row is-compact-plan');
    const statusLabel = ({ idea: '想法', active: '进行中', paused: '暂停', completed: '已完成', abandoned: '已放下' } as const)[goal.status];
    const goalMilestones = (milestonesByGoal[index] ?? []).filter((item) => item.status !== 'superseded');
    const completedMilestones = goalMilestones.filter((item) => item.status === 'completed').length;
    const goalWeek = weekRange(today);
    const weekQuests = allQuests.filter((quest) => quest.sourceType === 'goal' && quest.sourceId === goal.id
      && !quest.systemRetiredAt && quest.localDate >= goalWeek.start && quest.localDate <= goalWeek.end);
    const completedWeekQuests = weekQuests.filter((quest) => quest.status === 'completed').length;
    const weekCompletion = weekQuests.length
      ? Math.round(100 * completedWeekQuests / weekQuests.length)
      : goalMilestones.length ? Math.round(100 * completedMilestones / goalMilestones.length) : 0;
    card.append(
      node('h3', 'goal-title', goal.result),
      node('p', `goal-status is-${goal.status}`, statusLabel),
    );
    const goalProgress = node('div', 'goal-progress-summary');
    goalProgress.append(
      node('span', '', `${completedMilestones}/${goalMilestones.length} 子任务`),
      node('span', '', `本周完成度 ${weekCompletion}%`),
    );
    const goalMeter = node('progress', 'goal-progress-meter');
    goalMeter.max = 100;
    goalMeter.value = weekCompletion;
    goalMeter.setAttribute('aria-label', `${goal.result}本周完成度 ${weekCompletion}%`);
    card.append(goalProgress, goalMeter);
    const nextMilestone = goalMilestones.find((item) => item.status === 'pending');
    if (nextMilestone) card.append(node('p', 'quest-minimum', `下一步：${nextMilestone.description}`));
    const viewGoal = node('button', 'goal-detail-link', '查看子任务 ›');
    viewGoal.type = 'button';
    viewGoal.setAttribute('aria-label', `查看目标“${goal.result}”的子任务`);
    viewGoal.addEventListener('click', () => { void openGoalDetailDialog(goal); });
    card.append(viewGoal);
    const actions = node('div', 'quest-actions');
    if (goal.status === 'active') {
      const schedule = iconButton(goalMilestones.length ? '添加子任务' : '添加第一个子任务', null, () => { void openMilestoneDialog(goal); }, 'button button-primary button-compact');
      schedule.setAttribute('aria-label', `为“${goal.result}”添加子任务`);
      actions.append(schedule);
    }
    const manage = node('details', 'quest-more-actions');
    const manageButtons = node('div', 'quest-more-buttons');
    const edit = iconButton('修改目标', null, () => { void openGoalSettingsDialog(goal); }, 'button button-secondary button-compact');
    edit.setAttribute('aria-label', `编辑目标“${goal.result}”`);
    manageButtons.append(edit);
    const remove = node('button', 'button button-quiet danger-button button-compact', '删除目标');
    remove.type = 'button';
    remove.setAttribute('aria-label', `删除目标：${goal.result}`);
    remove.addEventListener('click', () => { void confirmRemoveTaskItem(goal.result, () => db.saveGoal(goal.id, { status: 'abandoned' }), remove); });
    manageButtons.append(remove);
    manage.append(node('summary', '', '编辑'), manageButtons);
    actions.append(manage);
    card.append(actions);
    goalSection.append(card);
  });
  const habitSection = node('section', 'task-habits');
  const habitHeading = node('div', 'section-heading');
  const habitHeadingActions = node('div', 'section-heading-actions');
  const analyseHabits = node('button', 'section-text-action', '分析');
  analyseHabits.type = 'button';
  analyseHabits.addEventListener('click', () => go({ name: 'habit-analysis' }));
  habitHeadingActions.append(analyseHabits, iconButton('新建', null, () => { void openHabitDialog(); }, 'button button-primary button-compact'));
  habitHeading.append(
    node('h2', '', '习惯'),
    habitHeadingActions,
  );
  habitSection.append(habitHeading);
  if (!habits.length) habitSection.append(node('p', 'empty-copy', '暂无习惯'));
  const activeHabits = habits.filter((habit) => habit.status === 'active' && habit.bonusEnabled);
  const pausedHabits = habits.filter((habit) => habit.status !== 'active' || !habit.bonusEnabled);
  activeHabits.forEach((habit) => {
    const habitIndex = habits.findIndex((item) => item.id === habit.id);
    const period = weekRange(today);
    const weekCompleted = allHabitLogs.filter((item) => item.habitId === habit.id
      && item.localDate >= period.start && item.localDate <= period.end && item.result === 'completed').length;
    const row = node('article', 'habit-row');
    const copy = node('div');
    copy.append(node('h3', '', habit.name));
    const stats = node('div', 'habit-plan-stats');
    for (const [label, value, className = ''] of [
      ['本周', `${weekCompleted}/${habit.scheduleDays.length} 次`],
      ['近7计划日', `${momentums[habitIndex] ?? 0}/5`],
      ['每周', `${habit.scheduleDays.length} 天`],
    ]) {
      const stat = node('span', className);
      stat.append(node('small', '', label), node('strong', '', value));
      stats.append(stat);
    }
    copy.append(stats);
    const more = node('details', 'quest-more-actions');
    const moreButtons = node('div', 'quest-more-buttons');
    const edit = iconButton('修改习惯', null, () => { void openHabitDialog(habit); }, 'button button-secondary button-compact');
    edit.setAttribute('aria-label', `编辑习惯“${habit.name}”`);
    const remove = node('button', 'button button-quiet danger-button button-compact', '删除习惯');
    remove.type = 'button';
    remove.setAttribute('aria-label', `删除习惯：${habit.name}`);
    remove.addEventListener('click', () => { void confirmRemoveTaskItem(habit.name, () => db.saveHabit(habit.id, { status: 'ended', bonusEnabled: false }), remove); });
    const detail = node('button', 'button button-secondary button-compact', '查看详情');
    detail.type = 'button';
    detail.addEventListener('click', () => { void openHabitDetailDialog(habit, false); });
    const pause = node('button', 'button button-quiet button-compact', '暂停打卡');
    pause.type = 'button';
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
    moreButtons.append(detail, edit, pause, remove);
    more.append(node('summary', '', '编辑'), moreButtons);
    row.append(copy, more);
    habitSection.append(row);
  });
  if (pausedHabits.length) {
    const paused = node('details', 'paused-habit-management');
    paused.append(node('summary', '', `已暂停 · ${pausedHabits.length}`));
    pausedHabits.forEach((habit) => {
      const item = node('div', 'paused-habit-row');
      const edit = node('button', 'button button-secondary button-compact', '编辑');
      edit.type = 'button';
      edit.setAttribute('aria-label', `编辑习惯“${habit.name}”`);
      edit.addEventListener('click', () => { void openHabitDialog(habit); });
      item.append(node('span', '', habit.name), edit);
      paused.append(item);
    });
    habitSection.append(paused);
  }
  planPanel.append(...(futureQuests.length ? [future] : []), goalSection, habitSection);
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
  const close = node('button', 'button button-primary', '关闭');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
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
  main.append(pageHeader('', '轨迹'));
  main.append(trailTabs('growth'));

  const activeLedger = ledger.filter((item) => !item.reversedAt);
  const totalXp = activeLedger.reduce((sum, item) => sum + item.finalXp, 0);
  const growthToday = localDate();
  const recentThirtyStart = shiftDate(growthToday, -29);
  const recentThirtyXp = activeLedger
    .filter((item) => item.localDate >= recentThirtyStart && item.localDate <= growthToday)
    .reduce((sum, item) => sum + item.finalXp, 0);
  const overallLevel = Math.floor(totalXp / 100) + 1;
  const levelXp = totalXp % 100;
  const overview = node('section', 'growth-overview');
  const monthStat = node('div', 'growth-overview-stat growth-month-stat');
  const monthValue = node('span', 'growth-overview-value');
  monthValue.append(node('strong', 'growth-month-xp', String(recentThirtyXp)), node('span', '', '成长值'));
  monthStat.append(node('span', 'caption', '近30天获得'), monthValue);
  const levelStat = node('div', 'growth-overview-stat growth-level-stat');
  levelStat.append(node('span', 'caption', '等级'), node('strong', 'growth-overall-level', String(overallLevel)));
  const overallProgress = node('progress', 'xp-progress growth-overall-progress');
  overallProgress.max = 100;
  overallProgress.value = levelXp;
  overallProgress.setAttribute('aria-label', `等级 ${overallLevel}，本级成长值 ${levelXp}/100`);
  const progressStat = node('div', 'growth-overview-stat growth-progress-stat');
  progressStat.append(node('span', 'growth-level-progress', `${levelXp} / 100`), overallProgress);
  overview.append(monthStat, levelStat, progressStat);
  main.append(overview);

  const badges = selectGrowthBadges({ milestones, goals, ledger, habits, habitLogs, quests, feedbacks, reviews });
  const badgeSection = node('section', 'surface growth-badges');
  const badgeHeading = node('div', 'section-heading');
  badgeHeading.append(node('h2', '', '成果徽章'));
  badgeSection.append(badgeHeading);
  if (!badges.length) badgeSection.append(node('p', 'empty-copy', '暂无徽章'));
  else {
    const recent = node('div', 'badge-grid');
    badges.slice(0, 4).forEach((badge) => recent.append(growthBadgeButton(badge)));
    badgeSection.append(recent);
    if (badges.length > 4) {
      const all = node('details', 'badge-all');
      all.append(node('summary', '', `全部 ${badges.length} ›`));
      const allGrid = node('div', 'badge-grid');
      badges.forEach((badge) => allGrid.append(growthBadgeButton(badge)));
      all.append(allGrid);
      badgeSection.append(all);
    }
  }
  const questById = new Map(quests.map((item) => [item.id, item]));
  const milestoneById = new Map(milestones.map((item) => [item.id, item]));
  const eventById = new Map(events.map((item) => [item.id, item]));
  const feedbackByQuest = activeFeedbackByQuest(feedbacks);
  const grid = node('section', 'growth-dimension-grid');
  grid.append(node('h2', 'growth-dimension-title', '五维成长'));
  DIMENSIONS.forEach((dimension, index) => {
    const value = progress[index]!;
    const dimensionLedger = activeLedger
      .filter((item) => item.dimension === dimension.key)
      .sort((left, right) => right.localDate.localeCompare(left.localDate) || right.updatedAt.localeCompare(left.updatedAt));
    const dimensionThirtyXp = dimensionLedger
      .filter((item) => item.localDate >= recentThirtyStart && item.localDate <= growthToday)
      .reduce((sum, item) => sum + item.finalXp, 0);

    const card = node('article', 'growth-dimension-card');
    card.dataset.dimension = dimension.key;
    const heading = node('div', 'growth-dimension-heading');
    const icon = node('img', 'growth-dimension-icon') as HTMLImageElement;
    icon.src = DIMENSION_ICON_ASSETS[dimension.key];
    icon.alt = '';
    const headingCopy = node('span', 'growth-dimension-copy');
    headingCopy.append(node('h3', '', dimension.label), node('span', 'caption', `累计 ${value.totalXp} · 近30天 +${dimensionThirtyXp}`));
    heading.append(icon, headingCopy);
    const stats = node('div', 'growth-dimension-stats');
    stats.append(node('span', '', `等级 ${value.level}`));
    const meter = node('progress', 'growth-dimension-meter');
    meter.max = value.nextLevelXp;
    meter.value = value.currentXp;
    meter.setAttribute('aria-label', `${dimension.label}等级 ${value.level}，当前成长值 ${value.currentXp}/${value.nextLevelXp}`);
    card.append(heading, stats, meter);

    const evidence = node('details', 'growth-evidence-list');
    evidence.append(node('summary', '', dimensionLedger.length ? `全部记录 · ${dimensionLedger.length}` : '暂无成长记录'));
    dimensionLedger.forEach((item) => {
      const quest = item.sourceType === 'quest' ? questById.get(item.sourceId) : undefined;
      const milestone = item.sourceType === 'milestone' ? milestoneById.get(item.sourceId) : undefined;
      const journalEvent = item.sourceType === 'journal-event' ? eventById.get(item.sourceId) : undefined;
      const feedback = quest ? feedbackByQuest.get(quest.id) : undefined;
      const title = quest?.title ?? milestone?.description ?? journalEvent?.title ?? '保留的历史记录';
      const proof = feedback?.actual || feedback?.note || journalEvent?.description || milestone?.evidence || title;
      const row = node('div', 'growth-evidence-row');
      row.append(
        node('strong', '', title),
        node('span', 'caption', `${formatDate(item.localDate)} · +${item.finalXp}`),
        node('span', 'line-clamp', proof),
      );
      evidence.append(row);
    });
    if (dimensionLedger.length) card.append(evidence);
    grid.append(card);
  });
  main.append(grid, badgeSection);
  return main;
}

function settingsDisclosure(label: string, className = '', status = ''): HTMLDetailsElement {
  const details = node('details', `surface settings-section settings-disclosure${className ? ` ${className}` : ''}`);
  const summary = node('summary');
  summary.append(node('span', '', label));
  if (status) summary.append(node('span', 'settings-summary-status', status));
  details.append(summary);
  return details;
}

function openSettingsDetail(title: string, section: HTMLElement): void {
  const { dialog, content, actions } = dialogShell(title);
  dialog.classList.add('full-screen-editor', 'settings-detail-dialog');
  if (section.classList.contains('ai-settings')) dialog.classList.add('is-ai-settings');
  addDialogBack(dialog, content);
  const details = section as HTMLDetailsElement;
  details.open = true;
  details.classList.add('settings-detail-content');
  content.append(details);
  if (section.classList.contains('ai-settings')) actions.remove();
  else {
    const close = node('button', 'button button-primary', '完成');
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    actions.append(close);
  }
  dialog.showModal();
  const heading = content.querySelector<HTMLElement>('h2');
  if (heading) { heading.tabIndex = -1; heading.focus(); }
}

function settingsOverviewRow(icon: SemanticIcon, label: string, status: string, section: HTMLElement, avatar?: Profile['avatar']): HTMLButtonElement {
  const row = node('button', 'settings-overview-row');
  row.type = 'button';
  if (label === '本地存储') row.classList.add('is-storage-status');
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
  row.append(iconCell, node('strong', '', label), statusCell, node('span', 'settings-overview-chevron', '›'));
  row.addEventListener('click', () => openSettingsDetail(label, section));
  return row;
}

const ASSESSMENT_ANSWER_LABELS = ['从不', '很少', '有时', '经常', '几乎总是'] as const;

function openAssessmentModeDialog(): void {
  const { dialog, content, actions } = dialogShell('选择状态问卷');
  const modes = node('div', 'assessment-mode-grid');
  const addMode = (length: AssessmentLength, title: string, description: string): void => {
    const button = node('button', 'assessment-mode');
    button.type = 'button';
    button.append(node('strong', '', title), node('span', '', description));
    button.addEventListener('click', () => {
      dialog.close();
      openAssessmentQuestionnaire(length);
    });
    modes.append(button);
  };
  addMode(30, '30 题快速评估', '约 3 分钟，适合定期更新');
  addMode(60, '60 题完整评估', '约 6 分钟，判断更细');
  content.append(modes);
  const cancel = node('button', 'button button-secondary', '稍后再测');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  actions.append(cancel);
  dialog.showModal();
  modes.querySelector<HTMLButtonElement>('button')?.focus();
}

function openAssessmentQuestionnaire(length: AssessmentLength, onlyDimension?: Dimension): void {
  const allQuestions = assessmentQuestions(length);
  const questions = onlyDimension ? allQuestions.filter((question) => question.dimension === onlyDimension) : allQuestions;
  const answers: Record<string, number> = {};
  let index = 0;
  const selectedDimension = onlyDimension ? DIMENSIONS.find((item) => item.key === onlyDimension) : undefined;
  const { dialog, content, actions } = dialogShell(selectedDimension ? `${selectedDimension.label}状态自评` : `${length} 题状态评估`);
  dialog.classList.add('assessment-dialog');
  const progress = node('p', 'assessment-progress');
  const questionArea = node('div', 'assessment-question');
  questionArea.tabIndex = -1;
  const cancel = node('button', 'button button-secondary', '稍后再测');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const previous = node('button', 'button button-quiet', '上一题');
  previous.type = 'button';
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
    const revise = node('button', 'button button-secondary', '返回修改');
    revise.type = 'button';
    revise.addEventListener('click', () => {
      index = questions.length - 1;
      showQuestion();
    });
    const save = node('button', 'button button-primary', '保存分数');
    save.type = 'button';
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
    const choices = node('div', 'assessment-answer-grid');
    ASSESSMENT_ANSWER_LABELS.forEach((label, answerIndex) => {
      const value = answerIndex + 1;
      const choice = node('button', `assessment-answer${answers[question.id] === value ? ' is-selected' : ''}`, label);
      choice.type = 'button';
      choice.setAttribute('aria-pressed', String(answers[question.id] === value));
      choice.addEventListener('click', () => {
        answers[question.id] = value;
        index += 1;
        showQuestion();
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
  const section = settingsDisclosure('状态自评', '', completed ? '已有分数' : '未评估');
  const actions = node('div', 'assessment-start-actions');
  const quick = node('button', 'button button-primary', '30 题快速评估');
  quick.type = 'button';
  quick.addEventListener('click', () => openAssessmentQuestionnaire(30));
  const full = node('button', 'button button-secondary', '60 题完整评估');
  full.type = 'button';
  full.addEventListener('click', () => openAssessmentQuestionnaire(60));
  actions.append(quick, full);
  const dimensions = node('div', 'assessment-dimension-actions');
  DIMENSIONS.forEach((dimension) => {
    const button = node('button', 'button button-quiet button-compact', dimension.label);
    button.type = 'button';
    button.addEventListener('click', () => openAssessmentQuestionnaire(30, dimension.key));
    dimensions.append(button);
  });
  section.append(node('h3', 'assessment-subheading', '全部评估'), actions, node('h3', 'assessment-subheading', '单项评估'), dimensions);
  return section;
}

function profileForm(profile: Profile): HTMLElement {
  const section = settingsDisclosure('人物', '', profile.chapterTitle || resolvedCompanionName(profile));
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
    if (selected) preview.src = avatarAsset(selected);
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
  updatePreview();
  const status = node('p', 'save-state', '');
  const save = node('button', 'button button-secondary', '保存人物设置');
  save.type = 'submit';
  form.append(
    labelledControl('你的称呼', userName), labelledControl('生活分身称呼', companionName),
    labelledControl('当前阶段', chapterTitle), labelledControl('人物形象', avatar), preview, status, save,
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
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const confirm = node('button', 'button button-primary', '合并并导入');
  confirm.type = 'button';
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
  const label = node('label', 'field-label', '输入“删除全部数据”以确认');
  const input = node('input', 'input');
  input.autocomplete = 'off';
  label.append(input);
  content.append(label);
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const confirm = node('button', 'button button-danger', '永久删除');
  confirm.type = 'button';
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
  const status = node('p', 'save-state');
  status.setAttribute('role', 'status');
  content.append(status);
  const cancel = node('button', 'button button-secondary', '暂不处理');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const forget = node('button', 'button button-quiet', '忘记');
  forget.type = 'button';
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
  const confirm = node('button', 'button button-primary', statement.value === memory.statement ? '确认这条内容' : '编辑后确认');
  confirm.type = 'button';
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
  const count = node('p', 'save-state');
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
  const cancel = node('button', 'button button-secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const send = node('button', 'button button-primary', navigator.onLine ? '确认范围并检查' : '当前离线'); send.type = 'button'; send.disabled = !navigator.onLine;
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
      content.replaceChildren(node('h2', '', '重复内容建议'), node('p', 'privacy-boundary', '以下只是建议。每一组合并都需要你单独点击；合并后仍保持“待确认”。'));
      parsed.result.groups.forEach((group) => {
        const card = node('article', `memory-merge-group is-${group.action}`);
        const sources = group.candidateMemoryIds.map((id) => selected.find((item) => item.id === id)?.statement ?? '内容已改变');
        card.append(node('span', 'tag', group.action === 'merge' ? '可考虑合并' : '建议分开'), node('p', '', sources.join('；')), node('p', 'caption', `${group.reason} · 确定程度：${CONFIDENCE_LABELS[group.confidence]}`));
        if (group.action === 'merge' && group.mergedStatement) {
          const statement = node('textarea', 'input compact-textarea'); statement.maxLength = 500; statement.value = group.mergedStatement;
          const merge = node('button', 'button button-secondary', '合并并等待确认'); merge.type = 'button';
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
  const { dialog, content, actions } = dialogShell('告诉生活分身一条规则');
  const type = node('select', 'input');
  type.append(
    selectOption('constraint', '限制或不要再建议的事'), selectOption('preference', '稳定偏好'),
    selectOption('pattern', '对我有效的方法'), selectOption('strength', '已经证明的优势'), selectOption('principle', '我认同的原则'),
  );
  const statement = node('textarea', 'input compact-textarea'); statement.maxLength = 500;
  statement.placeholder = '例如：连续会议后不要建议我立刻做高专注任务。';
  const status = node('p', 'save-state'); status.setAttribute('role', 'status');
  content.append(
    node('p', 'privacy-boundary', '这条内容由你直接设定，不是 AI 推断。保存后会进入伙伴记忆；仍可编辑、减少提醒或忘记。'),
    labelledControl('规则类型', type), labelledControl('具体内容', statement), status,
  );
  const cancel = node('button', 'button button-secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '确认并记住'); save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try { await db.addConfirmedMemory(type.value as SystemMemory['type'], statement.value); dialog.close(); showToast('生活分身已记住；你随时可以修改。'); await render(); }
    catch (error) { save.disabled = false; status.textContent = errorMessage(error); status.classList.add('is-error'); }
  });
  actions.append(cancel, save); dialog.showModal(); statement.focus();
}

function memorySettings(memories: SystemMemory[], events: JournalEvent[]): HTMLElement {
  const section = node('section', 'surface settings-section memory-settings');
  const candidates = memories.filter((item) => item.status === 'candidate');
  const confirmed = memories.filter((item) => item.status === 'confirmed');
  section.append(node('h2', '', '行动说明书'));
  section.append(iconButton('添加规则', null, () => { void openAddMemoryDialog(); }, 'button button-secondary'));
  const appendMemory = (parent: HTMLElement, memory: SystemMemory, label: string): void => {
    const card = node('article', `memory-row is-${memory.status}`);
    const evidenceEvents = memory.evidenceIds.flatMap((id) => {
      const event = events.find((item) => item.id === id);
      return event ? [event] : [];
    });
    const evidenceTitles = evidenceEvents.map((event) => event.title);
    const evidenceDateLabels = [...new Set(evidenceEvents.map((event) => event.localDate))].sort().map((date) => formatDate(date, { year: 'numeric' }));
    card.append(node('span', 'tag', `${label}${memory.reminderMuted ? ' · 已减少提醒' : ''}`), node('h3', '', memory.statement), node('p', 'caption', memory.evidenceIds.length ? `来源：${evidenceTitles.join('；') || '原内容已变化'}${evidenceDateLabels.length ? ` · 发生于 ${evidenceDateLabels.join('、')}` : ''}` : '来源：你直接写下并确认'));
    if (memory.counterEvidence.length) card.append(node('p', 'caption', `反例：${memory.counterEvidence.join('；')}`));
    const memoryActions = node('div', 'quest-actions');
    memoryActions.append(iconButton(memory.status === 'candidate' ? '核对内容' : '编辑或忘记', null, () => { void openMemoryDecision(memory); }));
    if (memory.status === 'confirmed') memoryActions.append(iconButton(memory.reminderMuted ? '恢复主动提醒' : '已掌握，减少提醒', null, async () => {
      try { await db.setMemoryReminder(memory.id, !memory.reminderMuted); showToast(memory.reminderMuted ? '这条方法会重新参与主动建议。' : '仍会保留这条记忆，但不再主动反复提醒。'); await render(); }
      catch (error) { showToast(errorMessage(error), 'error'); }
    }, 'button button-quiet'));
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
    const group = node('section', `system-guide-group is-${type}`);
    group.append(node('h3', '', title));
    values.forEach((memory) => appendMemory(group, memory, '已确认'));
    guide.append(group);
  }
  if (!confirmed.length) guide.append(node('p', 'empty-copy', '暂无规则'));
  section.append(guide);
  const pending = node('details', 'memory-candidates');
  pending.append(node('summary', '', `待你核对 · ${candidates.length}`));
  pending.append(node('p', 'caption', '确认后生效'));
  candidates.forEach((memory) => appendMemory(pending, memory, '待确认'));
  section.append(pending);
  if (candidates.length + confirmed.length >= 2) {
    if (NATIVE_AI_READY) section.append(iconButton('检查重复内容', null, () => { void openSystemCandidateReview([...candidates, ...confirmed], events); }, 'button button-secondary'));
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
  const permission = node('label', 'setting-row ai-permission-row');
  const permissionInput = node('input');
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
  const modelRow = node('label', 'setting-row');
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
  const keyRow = node('label', 'setting-row');
  keyRow.append(node('span', '', '自定义 API Key'), keyInput);
  const keyActions = node('div', 'character-actions');
  const saveApiKey = node('button', 'button button-secondary', '保存');
  const clearApiKey = node('button', 'button button-quiet', '清除密钥');
  saveApiKey.type = 'button';
  clearApiKey.type = 'button';
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

  const check = node('button', 'button button-secondary', '重新检查连接');
  check.type = 'button';
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

  const weeklyScope = node('details', 'optional-details weekly-scope-settings');
  weeklyScope.append(node('summary', '', '调整发送范围'));
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
    const row = node('label', 'setting-row');
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
    const row = node('div', 'setting-row-text ai-info-row');
    const iconCell = node('span', 'ai-info-icon');
    iconCell.append(semanticIcon(icon));
    row.append(iconCell, node('strong', '', label), typeof value === 'string' ? node('span', 'ai-info-value', value) : value, node('span', 'settings-overview-chevron', '›'));
    return row;
  };
  const serviceInfo = node('div', 'ai-service-info');
  serviceInfo.append(
    aiInfoRow('provider', '服务方', 'MiniMax'),
    aiInfoRow('ai', '模型', savedModel),
    aiInfoRow('cost', '费用', '随应用提供'),
    aiInfoRow('connection', '连接状态', health),
    check,
  );
  const scopeSummary = node('div', 'ai-scope-summary');
  scopeSummary.append(
    aiInfoRow('organize', '每日整理', '每次确认'),
    aiInfoRow('goal', '目标拆分', '仅当前目标'),
    aiInfoRow('weekly-review', '周回顾', '摘要，不含日记原文'),
  );
  const advanced = node('details', 'optional-details ai-advanced-settings');
  const advancedSummary = node('summary');
  advancedSummary.append(semanticIcon('nav-settings', 'ai-advanced-icon'), node('span', '', '使用安装包提供的服务'));
  advanced.append(advancedSummary);
  if (NATIVE_PLATFORM) advanced.append(modelRow, keyRow, keyActions, keyStatus);
  advanced.append(weeklyScope);
  section.append(
    availability, intro, permission, node('h3', 'ai-group-title', '服务信息'), serviceInfo,
    node('h3', 'ai-group-title', '默认发送范围'), scopeSummary,
    node('h3', 'ai-group-title', '密钥与高级设置'), advanced, node('p', 'caption ai-privacy-note', '内容只会按确认范围发送给所选服务方。'),
  );
  updateAiConfigStatus();
  return section;
}

async function installStorageSettings(): Promise<HTMLElement> {
  const section = settingsDisclosure('安装与存储', 'install-storage-settings');
  const installed = matchMedia('(display-mode: standalone)').matches;
  const installStatus = node('p', 'caption', installed ? '已安装' : '');
  installStatus.hidden = Boolean(installPrompt && !installed);
  section.append(installStatus);
  if (installPrompt && !installed) {
    const install = iconButton('安装栖光', null, async () => {
      if (!installPrompt) return;
      install.disabled = true;
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installPrompt = null;
      installStatus.hidden = false;
      installStatus.textContent = choice.outcome === 'accepted' ? '安装中' : '未安装，可从浏览器菜单重试';
      install.remove();
    }, 'button button-secondary');
    section.append(install);
  }

  const storageStatus = node('p', 'caption');
  if (NATIVE_PLATFORM) {
    storageStatus.textContent = '记录保存在本机 App 中；请定期导出备份。';
    section.append(storageStatus, node('p', 'privacy-boundary', '卸载栖光或在系统设置中清除应用数据会删除本地记录；换设备或重装前请先导出备份。'));
    return section;
  }
  const persisted = await navigator.storage?.persisted?.().catch(() => false) ?? false;
  storageStatus.textContent = persisted
    ? '持久存储已开启'
    : '本地数据可能被系统清理';
  section.append(storageStatus);
  if (!persisted && navigator.storage?.persist) {
    const persist = iconButton('请求持久存储', null, async () => {
      persist.disabled = true;
      const granted = await navigator.storage.persist().catch(() => false);
      storageStatus.textContent = granted
        ? '持久存储已开启'
        : '浏览器没有批准持久存储；记录仍在本机，但可能在空间不足时被清理。请先导出备份，并在系统设置中允许本站存储数据。';
      if (granted) persist.remove(); else persist.disabled = false;
    }, 'button button-secondary');
    section.append(persist);
  }
  section.append(node('p', 'privacy-boundary', '清除本站数据会删除本地记录；换设备或重装前请导出备份。'));
  return section;
}

async function systemPage(): Promise<HTMLElement> {
  const [observations, profile, memories, events, entries] = await Promise.all([
    db.latestAssessment(), db.getProfile(), db.listMemories(), db.listJournalEvents(), db.listEntries(),
  ]);
  if (!profile) throw new Error('个人系统尚未初始化。');
  const main = node('main', 'page page-system');
  main.append(pageHeader('', '设置'));
  const profileSettings = profileForm(profile);
  const assessmentSettings = assessmentForm(observations);
  const aiSettings = aiPermissionSettings();
  const featureSettings = node('section', 'settings-group');
  featureSettings.append(node('h2', 'settings-group-title', '功能与设备'), aiSettings);
  const dataSettings = node('section', 'settings-group');
  dataSettings.append(node('h2', 'settings-group-title', '数据与隐私'));
  const actionRuleSettings = node('details', 'system-advanced');
  actionRuleSettings.append(node('summary', '', '行动规则'), memorySettings(memories, events));

  const preferences = settingsDisclosure('显示与语气');
  const motionLabel = node('label', 'setting-row');
  const motion = node('input');
  motion.type = 'checkbox';
  motion.checked = settings.reduceMotion;
  motionLabel.append(node('span', '', '减少动态效果'), motion);
  motion.addEventListener('change', async () => {
    try {
      settings = await db.saveSettings({ reduceMotion: motion.checked });
      applySettings();
      showToast('显示偏好已保存。');
    } catch (error) {
      motion.checked = !motion.checked;
      showToast(errorMessage(error), 'error');
    }
  });
  preferences.append(motionLabel);
  const tone = node('select', 'input');
  tone.append(selectOption('gentle', '温和', settings.guidanceTone === 'gentle'), selectOption('direct', '直接', settings.guidanceTone === 'direct'));
  const toneLabel = labelledControl('指导语气', tone);
  tone.addEventListener('change', async () => {
    try {
      settings = await db.saveSettings({ guidanceTone: tone.value as AppSettings['guidanceTone'] });
      showToast('指导方式已保存；事实、规则和安全边界不变。');
    } catch (error) {
      tone.value = settings.guidanceTone;
      showToast(errorMessage(error), 'error');
    }
  });
  preferences.append(toneLabel);

  const pinState = widgetPinState();
  let widgetSettings: HTMLElement | null = null;
  if (pinState !== 'unavailable') {
    const desktop = settingsDisclosure('今日任务小组件');
    widgetSettings = desktop;
    const desktopStatus = node('p', 'caption', pinState === 'pinned' ? '已添加' : '');
    desktopStatus.hidden = pinState !== 'pinned';
    desktop.append(desktopStatus);
    if (pinState === 'available') {
      const pin = iconButton('添加到桌面', null, () => {
        if (requestWidgetPin()) {
          sessionStorage.setItem('qiguang.widget-pin-pending', '1');
          pin.disabled = true;
          desktopStatus.hidden = false;
          desktopStatus.textContent = '请在系统窗口中确认添加。';
        } else {
          showToast('系统没有打开添加窗口，请从桌面小组件列表添加栖光。', 'error');
        }
      }, 'button button-secondary');
      desktop.append(pin);
    }
    featureSettings.append(desktop);
  }
  const notificationSettings = settingsDisclosure('通知与提醒');
  notificationSettings.append(node('p', 'muted', '栖光目前不会主动发送系统通知。任务和习惯只在应用内提醒。'));
  const notificationStatus = '已关闭';

  const data = settingsDisclosure('本地数据', 'data-actions');
  const exportButton = iconButton('导出全部数据', null, async () => {
    exportButton.disabled = true;
    try {
      const bundle = await db.exportBundle();
      localStorage.setItem('qiguang.last-backup-at', new Date().toISOString());
      const contents = JSON.stringify(bundle, null, 2);
      const filename = `qiguang-backup-${localDate()}.json`;
      if (Capacitor.isNativePlatform()) {
        const [{ Directory, Encoding, Filesystem }, { Share }] = await Promise.all([
          import('@capacitor/filesystem'),
          import('@capacitor/share'),
        ]);
        await Filesystem.writeFile({ path: filename, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 });
        const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
        await Share.share({ title: '栖光备份', text: '保存或分享这份栖光本地备份。', files: [uri], dialogTitle: '保存栖光备份' });
        showToast('已交给系统保存或分享。');
        return;
      }
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
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      exportButton.disabled = false;
    }
  });
  const importLabel = node('label', 'button button-secondary file-button');
  importLabel.append(node('span', '', '导入备份'));
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
  importLabel.append(file);
  const backupDismissKey = `qiguang.backup-reminder-dismissed.${localDate()}`;
  const lastBackup = localStorage.getItem('qiguang.last-backup-at');
  const backupDue = entries.length > 0 && (!lastBackup || Date.now() - Date.parse(lastBackup) >= 30 * 86_400_000);
  if (backupDue && localStorage.getItem(backupDismissKey) !== '1') {
    data.open = true;
    const reminder = node('aside', 'gentle-reminder');
    reminder.append(node('strong', '', '建议现在导出一份备份'), node('p', 'caption', '下方“导出全部数据”会生成完整备份文件。'));
    const remindActions = node('div', 'gentle-reminder-actions');
    const later = node('button', 'button button-quiet', '今天先不用');
    later.type = 'button'; later.addEventListener('click', () => { localStorage.setItem(backupDismissKey, '1'); reminder.remove(); });
    remindActions.append(later); reminder.append(remindActions); data.append(reminder);
  }
  const transferActions = node('div', 'data-transfer-actions');
  transferActions.append(exportButton, importLabel);
  data.append(transferActions);
  const storageSettings = await installStorageSettings();
  featureSettings.append(storageSettings);
  dataSettings.append(data);
  const overviewGroup = (title: string): HTMLElement => {
    const group = node('section', 'settings-overview-group');
    group.append(node('h2', '', title));
    return group;
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
  const danger = node('button', 'settings-overview-row is-danger');
  danger.type = 'button';
  const dangerIcon = node('span', 'settings-overview-icon');
  dangerIcon.append(semanticIcon('delete'));
  danger.append(dangerIcon, node('strong', '', '删除全部数据'), node('span', 'settings-overview-chevron', '›'));
  danger.addEventListener('click', () => { void deleteAllDialog(); });
  main.append(personal, features, privacy, advanced, danger);
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

function analysisRangeSelect(value: AnalysisWeeks, onChange: (value: AnalysisWeeks) => void): HTMLSelectElement {
  const select = node('select', 'analysis-range-select');
  select.setAttribute('aria-label', '分析范围');
  ([12, 26, 52] as const).forEach((weeks) => select.append(selectOption(String(weeks), weeks === 12 ? '近12周' : weeks === 26 ? '近半年' : '近全年', weeks === value)));
  select.addEventListener('change', () => onChange(Number(select.value) as AnalysisWeeks));
  return select;
}

function analysisRangeTabs(value: AnalysisWeeks, onChange: (value: AnalysisWeeks) => void): HTMLElement {
  const tabs = node('div', 'analysis-range-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [weeks, label] of [[12, '12周'], [26, '半年'], [52, '全年']] as const) {
    const button = node('button', weeks === value ? 'is-active' : '', label);
    button.type = 'button';
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
  section.append(node('h2', '', title));
  const viewport = node('div', 'analysis-heat-scroll');
  const chart = node('div', 'analysis-heat-chart');
  chart.style.setProperty('--heat-weeks', String(weeks));
  const months = node('div', 'analysis-heat-months');
  let previousMonth = -1;
  for (let week = 0; week < weeks; week += 1) {
    const date = parseLocalDate(shiftDate(period.start, week * 7));
    const month = date.getMonth();
    if (month === previousMonth) continue;
    const label = node('span', '', `${month + 1}月`);
    label.style.gridColumnStart = String(week + 1);
    months.append(label);
    previousMonth = month;
  }
  const body = node('div', 'analysis-heat-body');
  const weekdayLabels = node('div', 'analysis-weekday-labels');
  ['周一', '', '周三', '', '周五', '', ''].forEach((label) => weekdayLabels.append(node('span', '', label)));
  const cells = node('div', 'analysis-heat-cells');
  for (let offset = 0; offset < weeks * 7; offset += 1) {
    const date = shiftDate(period.start, offset);
    const value = date <= period.gridEnd ? cellForDate(date) : { tone: 'empty' as const, label: '' };
    const cell = node('span', `analysis-heat-cell is-${value.tone}`);
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
  const [allQuests, feedbacks] = await Promise.all([db.listQuests(), db.listQuestFeedback()]);
  const main = node('main', 'page page-analysis page-task-analysis');
  let weeks: AnalysisWeeks = 12;
  let category: 'all' | Dimension = 'all';
  const body = node('div', 'analysis-page-body');
  main.append(secondaryPageHeader('任务分析', undefined, { name: 'tasks' }));

  const categoryTabs = node('nav', 'analysis-category-tabs');
  categoryTabs.setAttribute('aria-label', '五维筛选');
  main.append(categoryTabs, body);
  const renderBody = (): void => {
    const activeFeedback = activeFeedbackByQuest(feedbacks);
    const rows = allQuests.filter((quest) => quest.sourceType !== 'habit' && !quest.systemRetiredAt).flatMap((quest) => {
      const feedback = activeFeedback.get(quest.id);
      const result = feedback?.result ?? (quest.status === 'pending' ? undefined : quest.status);
      return result ? [{ quest, result, date: feedback?.completedDate ?? quest.localDate }] : [];
    });
    const categoryRows = rows.filter(({ quest }) => category === 'all' || quest.dimension === category);
    const period = analysisRange(weeks);
    const current = categoryRows.filter(({ date }) => date >= period.start && date <= period.end);
    const completed = current.filter(({ result }) => result === 'completed').length;
    const partial = current.filter(({ result }) => result === 'partial').length;
    const skipped = current.filter(({ result }) => result === 'skipped' || result === 'exempt').length;
    const focusMinutes = current.reduce((sum, { quest, result }) => sum + (result === 'completed' ? quest.estimatedMinutes ?? 0 : result === 'partial' ? (quest.estimatedMinutes ?? 0) / 2 : 0), 0);

    categoryTabs.replaceChildren();
    const dimensionTabs: Array<readonly ['all' | Dimension, string]> = [['all', '全部'], ...DIMENSIONS.map((item) => [item.key, item.label] as const)];
    for (const [key, label] of dimensionTabs) {
      const tab = node('button', category === key ? 'is-active' : '', label);
      tab.type = 'button';
      tab.setAttribute('aria-current', category === key ? 'page' : 'false');
      tab.addEventListener('click', () => { category = key; renderBody(); });
      categoryTabs.append(tab);
    }

    body.replaceChildren();
    const summary = node('section', 'analysis-summary-grid');
    for (const [label, value, tone = ''] of [
      ['完成', String(completed)], ['有进展', String(partial)], ['跳过', String(skipped), 'is-warning'], ['专注', `${Math.round(focusMinutes / 6) / 10} 小时`],
    ]) {
      const stat = node('span', tone);
      stat.append(node('small', '', label), node('strong', '', value));
      summary.append(stat);
    }
    body.append(summary);

    const daily = new Map<string, { done: number; skipped: number }>();
    current.forEach(({ date, result }) => {
      const value = daily.get(date) ?? { done: 0, skipped: 0 };
      if (result === 'completed' || result === 'partial') value.done += 1;
      else value.skipped += 1;
      daily.set(date, value);
    });
    const heat = analysisHeatmap('任务热力图', weeks, (date) => {
      const value = daily.get(date);
      if (!value) return { tone: 'empty', label: `${formatDate(date)}：没有任务结果` };
      if (!value.done) return { tone: 'skipped', label: `${formatDate(date)}：跳过 ${value.skipped} 项` };
      const tone = `level-${Math.min(4, value.done)}` as AnalysisHeatTone;
      return { tone, label: `${formatDate(date)}：推进 ${value.done} 项${value.skipped ? `，跳过 ${value.skipped} 项` : ''}` };
    });
    heat.querySelector('h2')?.after(analysisRangeTabs(weeks, (value) => { weeks = value; renderBody(); }));
    body.append(heat);

    const distribution = node('section', 'analysis-section analysis-result-section');
    distribution.append(node('h2', '', '结果分布'));
    const total = completed + partial + skipped;
    const resultList = node('div', 'analysis-result-list');
    for (const [label, value] of [['已完成', completed], ['有进展', partial], ['跳过', skipped]] as const) {
      const percent = analysisPercent(value, total);
      const row = node('div', 'analysis-result-row');
      const meter = node('span', 'analysis-meter');
      meter.style.setProperty('--value', `${percent}%`);
      row.append(node('strong', '', label), meter, node('span', '', `${percent}%`));
      resultList.append(row);
    }
    distribution.append(resultList);
    body.append(distribution);

    const categorySection = node('section', 'analysis-section analysis-category-section');
    categorySection.append(node('h2', '', '五维完成'));
    for (const { key, label } of DIMENSIONS) {
      const values = current.filter(({ quest }) => quest.dimension === key);
      const done = values.filter(({ result }) => result === 'completed').length;
      const percent = analysisPercent(done, values.length);
      const row = node('div', 'analysis-category-row');
      row.append(node('strong', '', label));
      const meter = node('span', 'analysis-meter');
      meter.style.setProperty('--value', `${percent}%`);
      row.append(meter, node('span', 'analysis-category-value', `${done}项 · ${percent}%`));
      categorySection.append(row);
    }
    body.append(categorySection);
    const actions = node('footer', 'analysis-bottom-actions');
    const back = node('button', 'button button-primary', '返回任务');
    back.type = 'button';
    back.addEventListener('click', () => { sessionStorage.setItem('qiguang.task-view', 'today'); go({ name: 'tasks' }); });
    actions.append(back);
    body.append(actions);
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
  main.append(secondaryPageHeader('习惯分析', undefined, { name: 'tasks' }));
  const active = habits.filter((habit) => habit.status !== 'ended');
  const end = localDate();
  const start = shiftDate(end, -27);
  const previousStart = shiftDate(start, -28);
  const previousEnd = shiftDate(start, -1);
  const totals = active.map((habit) => habitPeriodStats(habit, logs, start, end));
  const totalPlanned = totals.reduce((sum, item) => sum + item.planned, 0);
  const totalCompleted = totals.reduce((sum, item) => sum + item.completed, 0);
  const previous = active.map((habit) => habitPeriodStats(habit, logs, previousStart, previousEnd));
  const previousRate = analysisPercent(previous.reduce((sum, item) => sum + item.completed, 0), previous.reduce((sum, item) => sum + item.planned, 0));
  const totalRate = analysisPercent(totalCompleted, totalPlanned);
  const delta = totalRate - previousRate;

  const summary = node('section', 'habit-overview-summary');
  summary.append(
    node('span', '', `${active.length} 个习惯`),
    node('strong', '', `${totalCompleted}/${totalPlanned}`),
    node('span', '', `总体完成率 ${totalRate}%`),
    node('small', delta === 0 ? '' : delta > 0 ? 'is-positive' : 'is-negative', delta === 0 ? '与上个周期持平' : `比上个周期${delta > 0 ? '提高' : '下降'} ${Math.abs(delta)}%`),
  );
  main.append(summary);

  const list = node('section', 'habit-comparison-list');
  const heading = node('div', 'habit-comparison-heading');
  heading.append(node('h2', '', '近四周'), node('span', '', '第1周　 第2周　 第3周　 本周'));
  list.append(heading);
  if (!active.length) list.append(node('p', 'empty-copy', '暂无习惯'));
  active.forEach((habit) => {
    const row = node('button', 'habit-comparison-row');
    row.type = 'button';
    row.setAttribute('aria-label', `查看${habit.name}的习惯分析`);
    const copy = node('span', 'habit-comparison-copy');
    const icon = node('img', 'habit-comparison-icon') as HTMLImageElement;
    icon.src = habitImage(habit);
    icon.alt = '';
    copy.append(icon, node('span', '', habit.name), node('small', '', habitScheduleLabel(habit.scheduleDays)));
    const total = habitPeriodStats(habit, logs, start, end);
    const weeksRow = node('span', 'habit-comparison-weeks');
    for (let week = 0; week < 4; week += 1) {
      const weekStart = shiftDate(start, week * 7);
      const value = habitPeriodStats(habit, logs, weekStart, shiftDate(weekStart, 6));
      weeksRow.append(node('span', '', `${value.completed}/${value.planned}`));
    }
    const score = node('span', 'habit-comparison-score');
    score.append(node('strong', '', `${total.rate}%`), node('small', '', `${total.completed}/${total.planned}`));
    row.append(copy, score, weeksRow);
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
  if (!habit) {
    main.append(secondaryPageHeader('习惯分析', undefined, { name: 'tasks' }), node('p', 'empty-copy', '习惯不存在'));
    return main;
  }
  const momentum = await db.habitMomentum(habit.id);
  const logByDate = new Map(logs.map((log) => [log.localDate, log]));
  let weeks: AnalysisWeeks = 12;
  const body = node('div', 'analysis-page-body');
  const select = analysisRangeSelect(weeks, (value) => { weeks = value; select.value = String(value); renderBody(); });
  main.append(secondaryPageHeader('习惯分析', select, { name: 'tasks' }));
  const hero = node('section', 'habit-analysis-hero');
  const heroIcon = node('img', 'habit-specific-icon') as HTMLImageElement;
  heroIcon.src = habitImage(habit);
  heroIcon.alt = '';
  hero.append(heroIcon);
  const heroCopy = node('div');
  heroCopy.append(node('h2', '', habit.name), node('p', '', habitScheduleLabel(habit.scheduleDays)));
  hero.append(heroCopy);
  main.append(hero, body);

  const renderBody = (): void => {
    const period = analysisRange(weeks);
    const plannedDates: string[] = [];
    for (let date = period.start; date <= period.end; date = shiftDate(date, 1)) {
      const schedule = habitAnalysisSchedule(habit, date);
      if (schedule?.trackingEnabled && schedule.scheduleDays.includes(parseLocalDate(date).getDay() || 7)) plannedDates.push(date);
    }
    const completed = plannedDates.filter((date) => logByDate.get(date)?.result === 'completed').length;
    const rate = analysisPercent(completed, plannedDates.length);
    const previousDates: string[] = [];
    for (let date = period.previousStart; date <= period.previousEnd; date = shiftDate(date, 1)) {
      const schedule = habitAnalysisSchedule(habit, date);
      if (schedule?.trackingEnabled && schedule.scheduleDays.includes(parseLocalDate(date).getDay() || 7)) previousDates.push(date);
    }
    const previousRate = analysisPercent(previousDates.filter((date) => logByDate.get(date)?.result === 'completed').length, previousDates.length);
    const delta = rate - previousRate;
    body.replaceChildren();
    const summary = node('section', 'habit-focus-summary');
    const rateBlock = node('div', 'habit-focus-rate');
    rateBlock.append(node('small', '', '近周期完成率'), node('strong', '', `${rate}%`), node('span', '', `${completed}/${plannedDates.length} 个计划日`));
    const momentumBlock = node('div', 'habit-focus-momentum');
    const momentumMeter = node('span', 'habit-momentum-meter');
    momentumMeter.style.setProperty('--value', `${momentum * 20}%`);
    momentumBlock.append(node('small', '', '近 7 个计划日动量'), node('strong', '', `${momentum}/5`), momentumMeter, node('span', delta === 0 ? '' : delta > 0 ? 'is-positive' : 'is-negative', delta === 0 ? '与上一周期持平' : `比上一周期${delta > 0 ? '提高' : '下降'} ${Math.abs(delta)}%`));
    summary.append(rateBlock, momentumBlock);
    body.append(summary);
    const heat = analysisHeatmap('完成热力图', weeks, (date) => {
      const schedule = habitAnalysisSchedule(habit, date);
      const planned = date <= period.end && schedule?.trackingEnabled && schedule.scheduleDays.includes(parseLocalDate(date).getDay() || 7);
      if (!planned) return { tone: 'empty', label: `${formatDate(date)}：未计划` };
      const log = logByDate.get(date);
      if (!log || log.result === 'skipped' || log.result === 'exempt') return { tone: 'missed', label: `${formatDate(date)}：未完成` };
      return { tone: 'level-5', label: `${formatDate(date)}：已完成` };
    });
    heat.querySelector('h2')?.after(analysisRangeTabs(weeks, (value) => { weeks = value; select.value = String(value); renderBody(); }));
    heat.append(node('p', 'habit-heat-summary', `${completed} 个计划日已完成 · ${plannedDates.length - completed} 个未完成`));
    body.append(heat);

    const weekdayStats = habit.scheduleDays.slice().sort((left, right) => left - right).map((day) => {
      const dates = plannedDates.filter((date) => (parseLocalDate(date).getDay() || 7) === day);
      const done = dates.filter((date) => logByDate.get(date)?.result === 'completed').length;
      return { day, rate: analysisPercent(done, dates.length) };
    });
    const names = '一二三四五六日';
    const weekdaySection = node('section', 'analysis-section habit-weekday-section');
    weekdaySection.append(node('h2', '', '按星期看'));
    const weekdayChart = node('div', 'habit-weekday-chart');
    weekdayStats.forEach(({ day, rate: weekdayRate }) => {
      const column = node('div', `habit-weekday-column is-day-${day}`);
      column.append(node('span', '', `周${names[day - 1]}`), node('strong', '', `${weekdayRate}%`));
      weekdayChart.append(column);
    });
    weekdaySection.append(weekdayChart);
    body.append(weekdaySection);
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
    main.append(pageHeader('本地数据', '暂时无法打开这一页'));
    const card = node('section', 'surface error-state');
    card.append(node('p', '', errorMessage(error)), primaryButton('重试', () => { void render(); }));
    main.append(card);
    renderShell(main, currentRoute);
  }
}

function renderDatabaseFailure(error: unknown): void {
  const main = node('main', 'page database-error');
  main.id = 'main-content';
  main.append(pageHeader('本地数据', '无法安全打开栖光'));
  const card = node('section', 'surface error-state');
  card.append(node('p', '', errorMessage(error)), node('p', 'muted', '没有进行写入。请先关闭其他页面后重试；也可以用备份替换本地数据。'));
  const actions = node('div', 'database-recovery-actions');
  actions.append(primaryButton('重新打开', () => { location.reload(); }));
  const importLabel = node('label', 'button button-secondary file-button');
  importLabel.append(node('span', '', '从备份恢复'));
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
  importLabel.append(file);
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
      if (notice.achievementsBefore) await announceNewGrowthBadge(notice.achievementsBefore, notice.message);
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
      if (widgetNotice.achievementsBefore) await announceNewGrowthBadge(widgetNotice.achievementsBefore, widgetNotice.message);
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
  const update = node('button', 'button button-secondary', '更新并重新打开');
  update.type = 'button';
  update.addEventListener('click', () => {
    if (draftNeedsUnloadWarning) { showToast('草稿尚未安全保存，请先复制正文再更新。', 'error'); return; }
    update.disabled = true;
    updateAcceptedInThisTab = true;
    registration.waiting?.postMessage('SKIP_WAITING');
  });
  const later = node('button', 'button button-quiet', '稍后');
  later.type = 'button';
  later.addEventListener('click', () => notice.remove());
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

