import { QiguangDb, parseBackup } from './db.ts';
import {
  DIMENSIONS,
  ROOT_ASSETS,
  type Area,
  type AnalysisJob,
  type AppSettings,
  type DailyAnalysis,
  type Dimension,
  type Goal,
  type GrowthBranch,
  type Habit,
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
import { DIFFICULTY_XP, chooseDailyDirection, monthlyAreaSignal, type Difficulty, type FeedbackResult, type QuestType } from './rules.ts';
import { buildWidgetSnapshot, consumeWidgetAction, requestWidgetPin, saveWidgetSnapshot, widgetPinState } from './widget.ts';
import { analyzeWithNativeAi, nativeAiConfiguration } from './direct-ai.ts';
import type { AnalysisRequest } from './ai-engine.ts';
import { Capacitor } from '@capacitor/core';
import maleAvatarImage from '../design-assets/pre-development/avatar-male-original.jpg';
import femaleAvatarImage from '../design-assets/pre-development/avatar-female-original.jpg';
import maleMotionImage from '../design-assets/pre-development/character-motion-male-transparent.png';
import femaleMotionImage from '../design-assets/pre-development/character-motion-female-transparent.png';
import roomBackgroundImage from '../design-assets/pre-development/room-background.png';

type RouteName = 'today' | 'calendar' | 'record' | 'tasks' | 'growth' | 'system' | 'day' | 'review';
type PixelIcon = 'today' | 'calendar' | 'record' | 'growth' | 'system' | 'desk' | 'board' | 'books' | 'window' | 'character';
interface Route { name: RouteName; date?: string }
interface PlantState { habitId: string; growth: 'empty' | 'started' | 'grown' }
type RoomCue = 'rest' | 'focus' | 'play';
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DRAFT_KEY = 'qiguang.record-drafts.v2';
const INTERRUPTED_TAKEOVER_MS = 2 * 60_000;
const SUCCESS_PROMPT = '今天做成或推进了什么？哪怕很小：';
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');
const NATIVE_AI_UNAVAILABLE = '此安装包尚未配置 MiniMax 密钥；记录、任务和成长数据仍可在本机使用。';
const AVAILABLE_AI_MODELS = ['MiniMax-M3', 'MiniMax-M2.7'] as const;
type AiModelChoice = (typeof AVAILABLE_AI_MODELS)[number];
const DEFAULT_AI_MODEL: AiModelChoice = AVAILABLE_AI_MODELS[0];
const FURNITURE_APPROACH_MS = 760;
const FURNITURE_USE_MS = 660;
const FURNITURE_RETURN_MS = 760;
const NATIVE_PLATFORM = Capacitor.isNativePlatform();
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

function explicitSuccessCredits(entries: JournalEntry[]): string[] {
  const values = entries.flatMap((entry) => {
    const lines = entry.body.split(/\r?\n/);
    return lines.flatMap((line, index) => {
      if (!line.trimStart().startsWith(SUCCESS_PROMPT)) return [];
      const inline = line.slice(line.indexOf(SUCCESS_PROMPT) + SUCCESS_PROMPT.length).trim();
      const value = inline || lines[index + 1]?.trim();
      return value ? [value] : [];
    });
  });
  return [...new Set(values)].slice(0, 5);
}

function successCredits(entries: JournalEntry[], quests: Quest[] = [], aiCredits = ''): string[] {
  const confirmedActions = quests.flatMap((quest) => quest.status === 'completed'
    ? [`完成：${quest.title}`]
    : quest.status === 'partial' ? [`推进：${quest.title}`] : []);
  return [...new Set([
    ...explicitSuccessCredits(entries),
    ...confirmedActions,
    ...aiCredits.split('•').map((item) => item.trim()).filter(Boolean),
  ])].slice(0, 5);
}
const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('页面缺少应用容器。');
const root: HTMLElement = appRoot;

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
let toastTimer = 0;
let draftNeedsUnloadWarning = false;
let draftsLoaded = false;
let memoryDrafts: Record<string, string> = {};
let installPrompt: InstallPromptEvent | null = null;
let reloadingForUpdate = false;
let updateAcceptedInThisTab = false;

function avatarAsset(avatar: Exclude<Profile['avatar'], null>): string {
  return avatar === 'male' ? maleAvatarImage : femaleAvatarImage;
}

function motionAsset(avatar: Exclude<Profile['avatar'], null>): string {
  return avatar === 'male' ? maleMotionImage : femaleMotionImage;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function pixelIcon(icon: PixelIcon): HTMLSpanElement {
  const mark = node('span', `pixel-icon icon-${icon}`);
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function iconButton(label: string, icon: PixelIcon | null, onClick: () => void, className = 'button button-secondary'): HTMLButtonElement {
  const button = node('button', className);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  if (icon) button.append(pixelIcon(icon));
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
  return route.date ? `${route.name}:${route.date}` : route.name;
}

function parseRoute(): Route {
  const value = location.hash.replace(/^#/, '') || '/today';
  const dated = value.match(/^\/(day|record|review)\/(\d{4}-\d{2}-\d{2})$/);
  if (dated?.[1] && dated[2] && isLocalDate(dated[2])) return { name: dated[1] as 'day' | 'record' | 'review', date: dated[2] };
  const legacyRoutes: Record<string, RouteName> = { diary: 'record', quests: 'tasks', history: 'calendar', status: 'system', settings: 'system' };
  const rawName = value.replace(/^\//, '');
  const name = legacyRoutes[rawName] ?? rawName as RouteName;
  if (['today', 'calendar', 'record', 'tasks', 'growth', 'system', 'review'].includes(name)) return { name };
  return { name: 'today' };
}

function go(route: Route): void {
  location.hash = route.date ? `#/${route.name}/${route.date}` : `#/${route.name}`;
}

function showToast(message: string, tone: 'normal' | 'error' = 'normal'): void {
  document.querySelector('.toast')?.remove();
  window.clearTimeout(toastTimer);
  const toast = node('div', `toast${tone === 'error' ? ' is-error' : ''}`, message);
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  document.body.append(toast);
  toastTimer = window.setTimeout(() => toast.remove(), 3600);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生了未知错误。';
}

function toContractDimension(dimension: Dimension): ContractDimension {
  return dimension === 'mind' ? 'mental' : dimension;
}

function fromContractDimension(dimension: ContractDimension): Dimension {
  return dimension === 'mental' ? 'mind' : dimension;
}

function analysisErrorCopy(code: AnalysisErrorCode | undefined, fallback = ''): string {
  return ({
    OFFLINE: '当前离线；任务已保存在本机，联网后由你手动重试。',
    INPUT_TOO_LARGE: '本次发送超过 20000 个字符，请减少记录范围。',
    RATE_LIMITED: '整理请求过快，请稍后手动重试。',
    MODEL_TIMEOUT: '模型响应超时；原文仍在本机，可手动重试。',
    INVALID_MODEL_OUTPUT: '模型连续三次未返回合约格式；结果没有写入正式数据。',
    UNSUPPORTED_CONTRACT: '当前整理合约不受服务端支持，请更新应用。',
    SAFETY_REVIEW: '当下安全最重要；普通任务、经验和游戏化反馈已暂停。',
    SERVICE_UNAVAILABLE: '整理服务暂时不可用；本地记录与任务不受影响。',
  } satisfies Record<AnalysisErrorCode, string>)[code ?? 'SERVICE_UNAVAILABLE'] || fallback;
}

async function analysisContext(date: string): Promise<{
  events: JournalEvent[];
  recentStates: DailyAnalysisRequest['context']['recentStates'];
  goals: DailyAnalysisRequest['context']['goals'];
  habits: DailyAnalysisRequest['context']['bonusHabits'];
  memories: SystemMemory[];
}> {
  const [events, goals, habits, memories, ...states] = await Promise.all([
    db.listJournalEvents(date),
    db.listGoals(),
    db.listHabits(),
    db.listMemories('confirmed'),
    ...Array.from({ length: 7 }, (_, offset) => db.resolvedStateAtOrBefore(shiftDate(date, -offset))),
  ]);
  const recentStates = states.flatMap((resolved, offset) => {
    const values = Object.fromEntries(Object.entries(resolved).map(([dimension, value]) => [
      toContractDimension(dimension as Dimension), value.value,
    ])) as Partial<Record<ContractDimension, number>>;
    return Object.keys(values).length ? [{ localDate: shiftDate(date, -offset), values }] : [];
  });
  return {
    events: events.filter((item) => item.active && item.confirmation === 'confirmed'),
    recentStates,
    goals: goals.filter((item) => item.status === 'active' && ['main', 'secondary'].includes(item.role)).slice(0, 3).map((item) => ({
      goalId: item.id, result: item.result, role: item.role as 'main' | 'secondary',
    })),
    habits: habits.filter((item) => item.status === 'active' && item.bonusEnabled).slice(0, 3).map((item) => ({
      habitId: item.id, name: item.name, minimumAction: item.minimumAction,
    })),
    memories: memories.filter((item) => !item.reminderMuted).slice(0, 20),
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
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as unknown;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [date, body] of Object.entries(saved)) {
        if (isLocalDate(date) && typeof body === 'string' && body.length <= 12_000) memoryDrafts[date] = body;
      }
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
    draftNeedsUnloadWarning = Object.values(memoryDrafts).some(Boolean);
  }
}

function readDraft(date: string): string {
  loadDrafts();
  return memoryDrafts[date] ?? '';
}

function saveDraft(date: string, body: string): void {
  loadDrafts();
  if (body) memoryDrafts[date] = body;
  else delete memoryDrafts[date];
  persistDrafts();
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
  copy.append(node('p', 'eyebrow', kicker));
  const heading = node('h1', '', title);
  heading.tabIndex = -1;
  copy.append(heading);
  header.append(copy);
  if (action) header.append(action);
  return header;
}

function goSystemButton(): HTMLButtonElement {
  const settings = node('button', 'button button-quiet', '设置与数据');
  settings.type = 'button';
  settings.setAttribute('aria-label', '进入设置');
  settings.addEventListener('click', () => go({ name: 'system' }));
  return settings;
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
  const items: Array<[RouteName, string, PixelIcon]> = [
    ['today', '今日', 'today'],
    ['tasks', '任务', 'board'],
    ['record', '记录', 'record'],
    ['growth', '轨迹', 'growth'],
  ];
  for (const [name, label, icon] of items) {
    const active = route.name === name || (name === 'growth' && ['calendar', 'day', 'review'].includes(route.name));
    const link = node('a', `nav-item${active ? ' is-active' : ''}`);
    link.href = `#/${name}`;
    if (active) link.setAttribute('aria-current', 'page');
    link.append(pixelIcon(icon), node('span', '', label));
    nav.append(link);
  }
  return nav;
}

function renderShell(main: HTMLElement, route: Route): void {
  main.id = 'main-content';
  main.tabIndex = -1;
  const shell = node('div', 'app-shell');
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
    const target = focusRecordInputOnNextRender ? main.querySelector<HTMLElement>('.journal-input') : main.querySelector<HTMLElement>('h1');
    focusRecordInputOnNextRender = false;
    target?.focus({ preventScroll: true });
  });
}

function companionMessage(welcoming: boolean, cue: RoomCue | null, hasMainQuest: boolean): string {
  if (settings.guidanceTone === 'direct') {
    if (welcoming) return '先记录最近发生的一件事，再决定下一步。';
    if (cue === 'rest') return '今天先做一个轻量恢复动作。';
    if (cue === 'focus') return '先完成主线的最小动作。';
    if (cue === 'play') return '安排一点不带产出的兴趣时间。';
    return hasMainQuest ? '先处理主线的最小动作。' : '先从一件真实的小事开始。';
  }
  if (welcoming) return '你回来啦。先把最近发生的一件事放下吧。';
  if (cue === 'rest') return '先缓一缓，今天只做一件轻一点的事也可以。';
  if (cue === 'focus') return '主线还在这儿。先选一个最小动作吧。';
  if (cue === 'play') return '给自己留一点有趣的空白，今天才更像生活。';
  return hasMainQuest ? '主线已经在等你了；需要的话，我陪你拆成下一步。' : '我在。今天想从哪里开始？';
}

function roomStage(compact = false, plantStates: PlantState[] = [], avatar: Profile['avatar'] = null, companionName = '小栖', welcoming = false, cue: RoomCue | null = null, snapshotDate: string | null = null, hasMainQuest = false, completedMilestones = 0, guidance: { title: string; reason: string; settled?: boolean } | null = null, companionContext: string[] = []): HTMLElement {
  const stage = node('section', `room-stage${compact ? ' is-compact' : ''}`);
  if (snapshotDate) stage.dataset.snapshotDate = snapshotDate;
  stage.setAttribute('aria-label', '温暖的像素房间：包含日记桌、任务板、日历、书架工作台、窗边床铺和生活分身。所有功能也能通过普通导航进入。');
  const scene = node('div', 'room-scene');
  const hour = new Date().getHours();
  const ambientAction = roomAmbientAction();
  scene.style.setProperty('--room-background', `url("${roomBackgroundImage}")`);
  scene.classList.add(snapshotDate ? 'is-day' : hour < 6 ? 'is-night' : hour < 12 ? 'is-morning' : hour < 18 ? 'is-day' : 'is-evening');
  if (cue) scene.classList.add(`is-cue-${cue}`);
  scene.setAttribute('aria-hidden', 'true');
  scene.append(node('div', 'room-lamp'));
  if (!compact && completedMilestones > 0) {
    const trophy = node('div', `room-achievement${completedMilestones >= 3 ? ' is-golden' : ''}`, '✦');
    trophy.title = `已完成 ${completedMilestones} 个里程碑`;
    trophy.setAttribute('aria-label', `累计完成 ${completedMilestones} 个里程碑`);
    scene.append(trophy);
  }
  if (cue) scene.append(node('div', `room-cue is-${cue}`));
  const celebratingHabit = compact ? null : sessionStorage.getItem('qiguang.plant-celebration');
  const celebratingCharacter = !compact && Boolean(sessionStorage.getItem('qiguang.character-celebration'));
  const characterState = celebratingCharacter ? ['celebrating', '庆祝'] as const
    : welcoming ? ['listening', '倾听'] as const
      : cue === 'rest' ? ['recovering', '恢复'] as const
        : cue === 'focus' ? ['thinking', '思考'] as const
          : cue === 'play' ? ['playing', '放松'] as const
            : hasMainQuest ? ['guiding', '指导'] as const : ['present', '在场'] as const;
  ['one', 'two', 'three'].forEach((position, index) => {
    const plantState = plantStates[index];
    const plant = node('div', `room-plant is-${position}${plantState ? ` is-${plantState.growth}` : ''}${plantState?.habitId === celebratingHabit ? ' is-celebrating' : ''}`);
    scene.append(plant);
  });
  const character = node('div', `room-character is-happy is-${avatar ?? 'neutral'} is-ambient-${ambientAction}${celebratingCharacter ? ' is-celebrating' : ''}${welcoming ? ' is-welcoming' : ''}${cue === 'rest' || ambientAction === 'rest' ? ' is-resting' : ''}`);
  if (avatar) {
    character.classList.add('has-motion');
    character.style.backgroundImage = `url("${motionAsset(avatar)}")`;
  }
  scene.append(character);
  if (!compact && characterState[0] !== 'present') scene.append(node('span', `character-state is-${characterState[0]}`, characterState[1]));
  if (celebratingHabit && plantStates.some((item) => item.habitId === celebratingHabit)) sessionStorage.removeItem('qiguang.plant-celebration');
  if (celebratingCharacter) sessionStorage.removeItem('qiguang.character-celebration');
  stage.append(scene);
  if (!compact) {
    let actionPending = false;
    let actionTimer: number | undefined;
    const roomMotionReduced = settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const characterPanelId = `character-panel-${crypto.randomUUID()}`;
    const feedback = node('p', 'room-interaction-feedback');
    feedback.hidden = true;
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    stage.append(feedback);
    const hotspots: Array<[string, string, Route | null, string]> = [
      ['desk', '记录', { name: 'record' }, '坐到椅子上，写下一件真实发生的事。'],
      ['board', '任务', { name: 'tasks' }, '看一眼今天真正要推进的事。'],
      ['calendar', '日历', { name: 'calendar' }, '翻到想回看的那一天。'],
      ['workbench', '成长', { name: 'growth' }, '在工作台整理已经留下的成长证据。'],
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
      if (position !== 'character') button.addEventListener('click', () => {
        if (actionPending) return;
        if (roomMotionReduced || !avatar) {
          if (target) go(target);
          else showToast(response);
          return;
        }
        actionPending = true;
        button.disabled = true;
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
        button.addEventListener('click', () => {
          const panel = stage.querySelector<HTMLElement>('.character-panel');
          if (panel) {
            panel.hidden = !panel.hidden;
            button.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden) panel.querySelector<HTMLButtonElement>('.button-primary')?.focus();
            return;
          }
          character.classList.add('is-welcoming');
          window.setTimeout(() => character.classList.remove('is-welcoming'), 520);
          const created = node('div', 'character-panel');
          created.id = characterPanelId;
          if (avatar) {
            const portrait = node('img', 'character-portrait') as HTMLImageElement;
            portrait.src = avatarAsset(avatar);
            portrait.alt = '';
            created.append(portrait);
          }
          const companionCopy = guidance?.settled ? '今天已经留下证据，可以回看，也可以停下。' : companionMessage(welcoming, cue, hasMainQuest);
          const recordIsPrimary = guidance?.title === '先讲一件最近发生的事';
          created.append(node('strong', '', companionName || '小栖'), node('p', 'character-response', companionCopy));
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
            created.hidden = true;
          });
          const record = node('button', `button ${recordIsPrimary ? 'button-primary' : 'button-quiet'}`, guidance?.settled ? '再记一件事' : '开始记录');
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

function timestampLocalDate(timestamp: string): string {
  const value = new Date(timestamp);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
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

async function openStateDetail(dimension: (typeof DIMENSIONS)[number], observation?: ResolvedDimensionState, referenceDate = localDate()): Promise<void> {
  const ledger = await db.listStateObservations(dimension.key, referenceDate);
  const sameDayCalibrationOverrides = observation && ledger.some((item) => item.active && item.kind === 'event-impact'
    && item.localDate === observation.localDate && !observation.observationIds.includes(item.id));
  const { dialog, content, actions } = dialogShell(`${dimension.label}状态依据`);
  if (observation) {
    const stale = observationIsStale(observation, referenceDate);
    content.append(
      node('p', '', `${observation.value} · ${stateBand(observation.value)}`),
      node('p', 'muted', `最后证据：${formatDate(observation.localDate, { year: 'numeric' })}`),
      node('p', stale ? 'danger-copy' : 'caption', stale
        ? referenceDate === localDate() ? '这次校准已经超过 7 天，需要更新；旧值仍保留，不自动猜测。' : '到这一天，这次校准已经超过 7 天；仍显示为当时的最后状态。'
        : sameDayCalibrationOverrides ? '你在同一天的直接校准覆盖了事件变化；变化证据仍保留在下方。'
          : observation.clamped ? `这一天的事件变化已按规则截断为 ${observation.dailyDelta > 0 ? '+' : ''}${observation.dailyDelta}。` : '状态只由你的校准和已确认反馈重算。'),
    );
  } else {
    content.append(node('p', 'empty-copy', '还没有明确依据，因此保持“待了解”，不会自动填入中间值。'));
  }
  if (ledger.length) {
    const history = node('section', 'state-ledger-detail');
    history.append(node('h3', '', '变化明细'));
    ledger.slice(0, 20).forEach((item) => {
      const row = node('div', `state-ledger-row${item.active ? '' : ' is-reversed'}`);
      const value = item.kind === 'event-impact'
        ? `${(item.delta ?? 0) > 0 ? '+' : ''}${item.delta ?? 0}`
        : `校准为 ${item.value}`;
      row.append(
        node('strong', '', value),
        node('span', '', item.kind === 'event-impact' ? item.reason ?? '已确认事件影响' : '你的直接自评'),
        node('time', 'caption', `${formatDate(item.localDate)} · ${item.active ? '生效' : '已撤销'}`),
      );
      history.append(row);
    });
    history.append(node('p', 'caption', '规则：同一天、同一维度的事件变化合计最多为 -15..+15；同日直接校准优先，撤销后从明细重算。'));
    content.append(history);
  }
  const close = node('button', 'button button-secondary', '关闭');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  const calibrate = node('button', 'button button-primary', '去校准');
  calibrate.type = 'button';
  calibrate.addEventListener('click', () => { dialog.close(); go({ name: 'system' }); });
  actions.append(close, calibrate);
  dialog.showModal();
  close.focus();
}

function statusSummary(observations: Partial<Record<Dimension, ResolvedDimensionState>>, referenceDate = localDate()): HTMLElement {
  const section = node('section', 'surface status-summary');
  const header = node('div', 'section-heading');
  header.append(node('div', '', referenceDate === localDate() ? '近日状态' : '当日状态'), node('span', 'caption', '你的证据'));
  section.append(header);
  const grid = node('div', 'status-grid');
  for (const dimension of DIMENSIONS) {
    const observation = observations[dimension.key];
    const item = node('button', 'status-item');
    item.type = 'button';
    const stale = observation ? observationIsStale(observation, referenceDate) : false;
    item.setAttribute('aria-label', observation
      ? `${dimension.label} ${observation.value} ${stale ? '需要更新' : stateBand(observation.value)} · 最后证据：${formatDate(observation.localDate, { year: 'numeric' })}`
      : `${dimension.label}待了解，点击校准`);
    item.addEventListener('click', () => { void openStateDetail(dimension, observation, referenceDate); });
    const meter = node('span', 'status-meter');
    meter.style.setProperty('--status-level', observation ? `${observation.value}%` : '0%');
    meter.setAttribute('aria-hidden', 'true');
    item.append(
      node('span', 'status-name', dimension.label),
      node('strong', '', observation ? String(observation.value) : '—'),
      meter,
      node('span', 'caption', observation ? (stale ? '需要更新' : stateBand(observation.value)) : '待了解'),
    );
    grid.append(item);
  }
  section.append(grid);
  return section;
}

const QUEST_LABELS: Record<QuestType, string> = { main: 'MAIN', bonus: 'BONUS', side: '支线' };
const DIFFICULTY_LABELS: Record<Difficulty, string> = { light: '轻量', standard: '标准', hard: '困难', challenge: '挑战' };
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

function questFeedbackFocusSelector(quest: Quest): string {
  const id = CSS.escape(quest.id);
  return `[data-quest-feedback-for="${id}"],[data-habit-checkin-for="${id}"]`;
}

type GoalProgression = Awaited<ReturnType<QiguangDb['createGoalFollowUpQuest']>>;

async function createGoalFollowUp(quest: Quest, result: FeedbackResult): Promise<GoalProgression> {
  return (result === 'completed' || result === 'partial') && quest.sourceType === 'goal'
    ? await db.createGoalFollowUpQuest(quest.id, localDate(), result)
    : { followUp: null, milestoneCompleted: null, goalReady: false };
}

function goalProgressMessage(progression: GoalProgression, result: FeedbackResult, fallback: string): string {
  if (progression.followUp) return `${result === 'partial' ? '已保留进展；缩小后的下一步' : progression.milestoneCompleted ? '里程碑已完成；下一步' : '已完成；下一步'}“${progression.followUp.title}”已加入今天。`;
  if (progression.goalReady) return '最后一个里程碑已完成；请在目标卡核对最终完成证据。';
  if (progression.milestoneCompleted) return '里程碑已完成；今天的任务位置已满，可稍后安排下一步。';
  return fallback;
}

async function saveQuickQuestFeedback(quest: Quest, result: Extract<FeedbackResult, 'completed' | 'partial' | 'skipped'>, controls: HTMLElement): Promise<void> {
  if (result === 'skipped') {
    const history = await db.listQuestFeedback(quest.id);
    if (history.some((item) => !item.undoneAt && item.result === 'skipped')) {
      await openQuestFeedbackDialog(quest);
      return;
    }
  }
  const buttons = [...controls.querySelectorAll<HTMLButtonElement>('button')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await db.feedbackQuest(quest.id, result, '', '', quest.difficulty, 0);
    const progression = await createGoalFollowUp(quest, result);
    if (result === 'completed') sessionStorage.setItem('qiguang.character-celebration', quest.id);
    if (quest.sourceType === 'habit' && result === 'completed') sessionStorage.setItem('qiguang.plant-celebration', quest.sourceId ?? '');
    focusAfterRenderSelector = questFeedbackFocusSelector(quest);
    showToast(goalProgressMessage(progression, result, result === 'skipped' ? '今天不做已记下；没有扣分。' : `已记为${FEEDBACK_LABELS[result]}；可以随时撤销。`));
    await render();
  } catch (error) {
    buttons.forEach((button) => { button.disabled = false; });
    showToast(errorMessage(error), 'error');
  }
}

function quickQuestActions(quest: Quest): HTMLElement {
  const actions = node('div', 'quest-actions quest-quick-actions');
  const completeLabel = node('label', 'quest-check');
  const complete = node('input');
  complete.type = 'checkbox';
  complete.setAttribute('aria-label', `完成：${quest.title}`);
  complete.addEventListener('change', () => { if (complete.checked) void saveQuickQuestFeedback(quest, 'completed', actions); });
  completeLabel.append(complete, node('span', '', '完成'));
  actions.append(completeLabel);
  const choices: Array<[Extract<FeedbackResult, 'partial' | 'skipped'>, string, string]> = [
    ['partial', '做了一部分', 'button-secondary'],
    ['skipped', '今天不做', 'button-quiet'],
  ];
  for (const [result, label, className] of choices) {
    const button = node('button', `button ${className}`, label);
    button.type = 'button';
    button.setAttribute('aria-label', `${label}：${quest.title}`);
    button.addEventListener('click', () => { void saveQuickQuestFeedback(quest, result, actions); });
    actions.append(button);
  }
  const details = node('button', 'button button-quiet', '详细反馈');
  details.type = 'button';
  details.setAttribute('aria-label', `详细反馈任务：${quest.title}`);
  details.addEventListener('click', () => { void openQuestFeedbackDialog(quest); });
  const adjust = node('button', 'button button-quiet', '调整 / 顺延');
  adjust.type = 'button';
  adjust.setAttribute('aria-label', `调整或顺延任务：${quest.title}`);
  adjust.addEventListener('click', () => { void openQuestAdjustmentDialog(quest); });
  const more = node('details', 'quest-more-actions');
  more.append(node('summary', '', '更多'), node('div', 'quest-more-buttons'));
  more.lastElementChild!.append(details, adjust);
  actions.append(more);
  return actions;
}

async function openQuestFeedbackDialog(quest: Quest): Promise<void> {
  const [feedbackHistory, stateHistory] = await Promise.all([
    db.listQuestFeedback(quest.id),
    quest.dimension ? db.listStateObservations(quest.dimension) : Promise.resolve([]),
  ]);
  const previousFeedback = feedbackHistory.find((item) => !item.undoneAt);
  const skippedAttempts = feedbackHistory.filter((item) => !item.undoneAt && item.result === 'skipped').length;
  const previousEffect = previousFeedback ? stateHistory.find((item) => item.evidenceId === previousFeedback.id && item.active) : undefined;
  const { dialog, content, actions } = dialogShell(quest.status === 'pending' ? '反馈这次行动' : '修改任务反馈');
  content.append(node('p', 'quest-dialog-title', quest.title), node('p', 'muted', `最小动作：${quest.minimumAction}`));

  const resultLabel = node('label', 'field-label', '结果');
  const result = node('select', 'input');
  for (const value of ['completed', 'partial', 'skipped', 'exempt'] as FeedbackResult[]) {
    result.append(selectOption(value, FEEDBACK_LABELS[value], quest.status === value));
  }
  resultLabel.append(result);

  const difficultyLabel = node('label', 'field-label', '实际难度');
  const difficulty = node('select', 'input');
  for (const value of Object.keys(DIFFICULTY_XP) as Difficulty[]) {
    difficulty.append(selectOption(value, `${DIFFICULTY_LABELS[value]} · ${DIFFICULTY_XP[value]} XP`, quest.difficulty === value));
  }
  difficultyLabel.append(difficulty);

  const actualLabel = node('label', 'field-label', '实际完成了什么（可选）');
  const actual = node('textarea', 'input compact-textarea');
  actual.maxLength = 2_000;
  actual.placeholder = '填写你实际完成的内容（可选）';
  actual.value = previousFeedback?.actual ?? '';
  actualLabel.append(actual);
  const noteLabel = node('label', 'field-label', '这次行动给你的反馈（可选）');
  const note = node('textarea', 'input compact-textarea');
  note.maxLength = 2_000;
  note.placeholder = '例如：十分钟版本更容易开始。';
  note.value = previousFeedback?.note ?? '';
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
  const skipReasonControl = labelledControl(skippedAttempts ? '第二次没有开始：最主要的阻力' : '今天不做的原因（可选）', skipReason);
  const updateSkipReasonVisibility = () => { skipReasonControl.hidden = result.value !== 'skipped'; };
  result.addEventListener('change', updateSkipReasonVisibility);
  updateSkipReasonVisibility();
  let stateDelta: HTMLSelectElement | undefined;
  let stateControl: HTMLLabelElement | undefined;
  let applyHabitDifficulty: HTMLInputElement | undefined;
  let applyHabitDifficultyControl: HTMLLabelElement | undefined;
  if (quest.dimension) {
    const dimension = DIMENSIONS.find((item) => item.key === quest.dimension);
    stateDelta = node('select', 'input');
    for (const value of [-5, -3, 0, 3, 5]) {
      const label = value === 0 ? '没有明确变化' : `${value > 0 ? '+' : ''}${value} · ${value > 0 ? '有所补足' : '有所消耗'}`;
      stateDelta.append(selectOption(String(value), label, value === (previousEffect?.delta ?? 0)));
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
  const aiPanel = node('section', 'feedback-ai-panel');
  aiPanel.append(
    node('strong', '', NATIVE_AI_READY ? 'AI 理解反馈（可选）' : 'AI 理解反馈未连接'),
    node('p', 'caption', NATIVE_AI_READY ? '发送范围见下方；结果需你确认。' : '可直接手动选择完成情况并保存，不影响反馈和经验。'),
  );
  const understand = node('button', 'button button-secondary', NATIVE_AI_READY ? 'AI 理解这段反馈' : 'MiniMax 未配置');
  understand.type = 'button';
  understand.disabled = !NATIVE_AI_READY;
  understand.addEventListener('click', async () => {
    if (!actual.value.trim()) {
      status.textContent = '请先写下实际完成了什么。';
      status.classList.add('is-error');
      actual.focus();
      return;
    }
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
    status.textContent = '正在理解；结果只会回填为候选。';
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
        minimumAction: quest.minimumAction,
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
      if (parsed.suggestedDifficultyCorrection) difficulty.value = parsed.suggestedDifficultyCorrection;
      status.textContent = parsed.completionCandidate === 'unclear'
        ? `AI 仍不确定：${parsed.followUpQuestion}`
        : `已回填候选“${mapped ? FEEDBACK_LABELS[mapped] : '不明确'}”；证据：“${parsed.evidenceQuote}”。请核对后再确认反馈。`;
    } catch (error) {
      status.textContent = error instanceof DOMException && error.name === 'AbortError' ? '反馈理解超时；原文字仍在，可以直接手动选择。' : errorMessage(error);
      status.classList.add('is-error');
    } finally {
      window.clearTimeout(timeout);
      understand.disabled = false;
    }
  });
  aiPanel.append(understand);
  content.append(resultLabel, difficultyLabel, actualLabel, aiPanel, skipReasonControl, noteLabel, ...(stateControl ? [stateControl] : []), ...(applyHabitDifficultyControl ? [applyHabitDifficultyControl] : []), status);

  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '确认反馈');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = '正在保存反馈和经验账本…';
    try {
      if (result.value === 'skipped' && skippedAttempts > 0 && !skipReason.value) {
        save.disabled = false;
        status.textContent = '请先选一个最主要的阻力；系统不会再次机械安排同一行动。';
        status.classList.add('is-error');
        return;
      }
      const savedNote = result.value === 'skipped' && skipReason.value
        ? `${skipReason.value}${note.value.trim() ? `：${note.value.trim()}` : ''}` : note.value;
      const pathDecisionReason = result.value === 'skipped' && quest.sourceType === 'goal' && quest.sourceId
        && (skipReason.value === '建议不适合我' || skipReason.value === '任务不重要') ? skipReason.value : '';
      await db.feedbackQuest(quest.id, result.value as FeedbackResult, savedNote, actual.value, difficulty.value as Difficulty, Number(stateDelta?.value ?? 0));
      const progression = await createGoalFollowUp(quest, result.value as FeedbackResult);
      if (applyHabitDifficulty?.checked && quest.sourceId) await db.saveHabit(quest.sourceId, { difficulty: difficulty.value as Difficulty });
      if (result.value === 'completed') sessionStorage.setItem('qiguang.character-celebration', quest.id);
      if (quest.sourceType === 'habit' && result.value === 'completed') sessionStorage.setItem('qiguang.plant-celebration', quest.sourceId ?? '');
      dialog.close();
      focusAfterRenderSelector = questFeedbackFocusSelector(quest);
      showToast(goalProgressMessage(progression, result.value as FeedbackResult, '反馈已保存；可以在任务卡上撤销。'));
      await render();
      if (pathDecisionReason) void openGoalPathDecision(quest.sourceId!, pathDecisionReason);
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

async function openGoalPathDecision(goalId: string, reason: string): Promise<void> {
  const goal = (await db.listGoals()).find((item) => item.id === goalId);
  if (!goal || goal.status !== 'active') return;
  const { dialog, content, actions } = dialogShell('这条目标路径还值得继续吗？');
  content.append(
    node('p', 'privacy-boundary', `你刚确认的事实是“${reason}”。这可能是行动不合适，也可能是目标本身已经变化；以下都只是候选。`),
    node('p', '', `关联目标：${goal.result}`),
  );
  const choices = node('div', 'quest-adjust-shortcuts');
  const edit = node('button', 'button button-secondary', '修改目标或下一步'); edit.type = 'button';
  edit.addEventListener('click', () => { dialog.close(); void openGoalSettingsDialog(goal); });
  choices.append(edit);
  if (NATIVE_AI_READY) {
    const replan = node('button', 'button button-secondary', '根据证据重新拆解'); replan.type = 'button';
    replan.addEventListener('click', () => { dialog.close(); void openGoalReplanDialog(goal); });
    choices.append(replan);
  }
  const pause = node('button', 'button button-quiet', '先暂停目标'); pause.type = 'button';
  pause.addEventListener('click', async () => {
    pause.disabled = true;
    try { await db.saveGoal(goal.id, { status: 'paused' }); dialog.close(); showToast('目标已暂停；历史和经验保留。'); await render(); }
    catch (error) { pause.disabled = false; showToast(errorMessage(error), 'error'); }
  });
  const end = node('button', 'button button-quiet danger-button', '结束这个目标'); end.type = 'button';
  end.addEventListener('click', async () => {
    dialog.close();
    if (!await confirmAction('结束这个目标？', '待完成任务会退出行动面；历史、反馈和经验仍会保留，也可以以后重新编辑状态。', '确认结束', true)) return;
    try { await db.saveGoal(goal.id, { status: 'abandoned' }); showToast('目标已结束；没有扣分，历史仍可回看。'); await render(); }
    catch (error) { showToast(errorMessage(error), 'error'); }
  });
  choices.append(pause, end); content.append(choices);
  const later = node('button', 'button button-primary', '暂不改变目标'); later.type = 'button'; later.addEventListener('click', () => dialog.close());
  actions.append(later); dialog.showModal(); later.focus();
}

async function openQuestAdjustmentDialog(quest: Quest): Promise<void> {
  const [goals, milestones, feedback, memories] = await Promise.all([
    db.listGoals(), db.listMilestones(), db.listQuestFeedback(quest.id), db.listMemories('confirmed'),
  ]);
  const goal = quest.sourceType === 'goal' ? goals.find((item) => item.id === quest.sourceId) : undefined;
  const milestone = milestones.find((item) => item.id === quest.milestoneId);
  const usedMemories = memories.filter((item) => item.type === 'constraint' || item.type === 'preference' || item.type === 'pattern').slice(0, 3);
  const { dialog, content, actions } = dialogShell('调整这项行动');
  const title = node('input', 'input'); title.maxLength = 160; title.value = quest.title;
  const reason = node('textarea', 'input compact-textarea'); reason.maxLength = 500; reason.value = quest.reason;
  const minimum = node('input', 'input'); minimum.maxLength = 200; minimum.value = quest.minimumAction;
  const minutes = node('input', 'input'); minutes.type = 'number'; minutes.min = '1'; minutes.max = '1440'; minutes.value = String(quest.estimatedMinutes);
  const deadline = node('input', 'input'); deadline.type = 'datetime-local'; deadline.value = localDateTimeInput(quest.deadlineAt);
  const difficulty = node('select', 'input');
  for (const value of Object.keys(DIFFICULTY_XP) as Difficulty[]) difficulty.append(selectOption(value, `${DIFFICULTY_LABELS[value]} · ${DIFFICULTY_XP[value]} XP`, value === quest.difficulty));
  const date = node('input', 'input'); date.type = 'date'; date.min = localDate(); date.value = quest.localDate;
  const status = node('p', 'save-state');
  const shortcuts = node('div', 'quest-adjust-shortcuts');
  const shrink = node('button', 'button button-secondary', '缩到 5 分钟'); shrink.type = 'button';
  shrink.addEventListener('click', () => { minutes.value = '5'; difficulty.value = 'light'; minimum.focus(); status.textContent = '请把最小动作改成五分钟内真的能开始的版本。'; });
  const replace = node('button', 'button button-secondary', '换一个行动'); replace.type = 'button';
  replace.addEventListener('click', () => { title.select(); status.textContent = '改写行动标题、理由和最小动作，原目标或习惯关联会保留。'; });
  shortcuts.append(shrink, replace);
  if (quest.sourceType !== 'habit') {
    const tomorrow = node('button', 'button button-secondary', '移到明天'); tomorrow.type = 'button';
    tomorrow.addEventListener('click', () => { date.value = shiftDate(localDate(), 1); status.textContent = '将顺延到明天；没有扣分。'; });
    shortcuts.append(tomorrow);
  } else date.disabled = true;
  if (quest.sourceType === 'goal' && quest.sourceId) {
    const editGoal = node('button', 'button button-secondary', '编辑关联目标');
    editGoal.type = 'button';
    editGoal.addEventListener('click', async () => {
      const goal = (await db.listGoals()).find((item) => item.id === quest.sourceId);
      if (!goal) { showToast('关联目标已经不存在。', 'error'); return; }
      dialog.close();
      void openGoalSettingsDialog(goal);
    });
    const pauseGoal = node('button', 'button button-quiet', '暂停关联目标');
    pauseGoal.type = 'button';
    pauseGoal.addEventListener('click', async () => {
      if (!await confirmAction('暂停这个关联目标？', '不会删除历史；暂停后不会继续主动安排它的任务。', '暂停目标')) return;
      try {
        await db.saveGoal(quest.sourceId!, { status: 'paused' });
        dialog.close(); showToast('目标已暂停；历史和经验保留。'); await render();
      } catch (error) { showToast(errorMessage(error), 'error'); }
    });
    shortcuts.append(editGoal, pauseGoal);
  }
  const basis = node('details', 'quest-adjust-basis'); basis.open = true;
  basis.append(node('summary', '', '这次调整依据'));
  const facts = node('ul', 'compact-list');
  facts.append(node('li', '', `事实：原计划 ${formatDate(quest.localDate)} · ${quest.estimatedMinutes} 分钟 · ${DIFFICULTY_LABELS[quest.difficulty]}`));
  if (quest.deadlineAt) facts.append(node('li', '', `事实：可选硬截止 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(quest.deadlineAt))}`));
  if (goal) facts.append(node('li', '', `事实：来自目标“${goal.result}”`));
  if (milestone) facts.append(node('li', '', `事实：当前里程碑“${milestone.description}”，完成证据是“${milestone.evidence}”`));
  if (feedback.length) facts.append(node('li', '', `事实：已有 ${feedback.filter((item) => !item.undoneAt).length} 次有效反馈`));
  usedMemories.forEach((memory) => facts.append(node('li', '', `已确认记忆：${memory.statement}`)));
  if (!usedMemories.length) facts.append(node('li', '', '已确认记忆：本次没有可用的限制、偏好或规律；不会凭空假设。'));
  basis.append(facts, node('p', 'caption', '这些内容只帮助你核对调整；系统不会据此自动暂停、结束或改写目标。'));
  content.append(
    node('p', 'muted', '调整不会扣分；只有完成反馈才会结算经验。'), basis, shortcuts,
    labelledControl('行动标题', title), labelledControl('为什么值得做', reason), labelledControl('最小动作', minimum),
    labelledControl('预计分钟', minutes), labelledControl('难度', difficulty), labelledControl('可选硬截止（不会自动失败）', deadline), labelledControl(quest.sourceType === 'habit' ? '习惯任务日期由计划日决定' : '安排日期', date), status,
  );
  const cancel = node('button', 'button button-secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '保存调整'); save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const updated = await db.savePendingQuest(quest.id, {
        localDate: date.value, title: title.value, reason: reason.value, minimumAction: minimum.value,
        estimatedMinutes: Number(minutes.value), difficulty: difficulty.value as Difficulty, deadlineAt: isoFromDateTimeInput(deadline.value),
      });
      dialog.close();
      showToast(updated.localDate === quest.localDate ? '行动已调整。' : `已顺延到${formatDate(updated.localDate)}；没有扣分。`);
      await render();
    } catch (error) { save.disabled = false; status.textContent = errorMessage(error); status.classList.add('is-error'); }
  });
  actions.append(cancel, save); dialog.showModal(); title.focus();
}

function questCard(quest: Quest, compact = false, milestone?: { description: string }): HTMLElement {
  const deadlinePassed = Boolean(quest.deadlineAt && Date.parse(quest.deadlineAt) < Date.now() && quest.status === 'pending');
  const card = node('article', `${compact ? 'quest-row' : 'surface quest-card'} is-${quest.type} is-${quest.status}${deadlinePassed ? ' is-deadline-passed' : ''}`);
  card.dataset.questId = quest.id;
  card.tabIndex = -1;
  const heading = node('div', 'quest-heading');
  heading.append(
    node('span', `tag${quest.type === 'main' ? ' tag-dark' : ''}`, QUEST_LABELS[quest.type]),
    node('span', 'caption', `${DIFFICULTY_LABELS[quest.difficulty]} · ${DIFFICULTY_XP[quest.difficulty]} XP`),
  );
  card.append(heading, node('h3', '', quest.title), node('p', compact ? 'caption' : '', quest.reason));
  const minimum = node('p', 'quest-minimum', `最小动作：${quest.minimumAction} · 约 ${quest.estimatedMinutes} 分钟`);
  card.append(minimum);
  const completionCriteria = (quest.completionCriteria || quest.minimumAction).trim();
  if (completionCriteria !== quest.minimumAction.trim()) card.append(node('p', 'caption', `完成标准：${completionCriteria}`));
  if (milestone) card.append(node('p', 'caption', `关联里程碑：${milestone.description}`));
  if (quest.deadlineAt) card.append(node('p', deadlinePassed ? 'caption danger-copy' : 'caption', `${deadlinePassed ? '截止已过，仍由你决定' : '可选截止'}：${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(quest.deadlineAt))}`));
  if (quest.status === 'pending') card.append(quickQuestActions(quest));
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
        showToast('反馈与对应经验已撤销。');
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

function homeHabitCheckin(quest: Quest): HTMLElement {
  const row = node('article', `quest-row home-habit-checkin is-${quest.status}`);
  row.dataset.questId = quest.id;
  row.tabIndex = -1;
  const copy = node('div', 'home-habit-copy');
  copy.append(node('strong', '', quest.title));
  const actions = node('div', 'quest-actions');
  if (quest.status === 'pending') {
    const complete = node('button', 'button button-primary', '完成打卡');
    complete.type = 'button';
    complete.setAttribute('aria-label', `完成打卡：${quest.title}`);
    complete.addEventListener('click', () => { void saveQuickQuestFeedback(quest, 'completed', actions); });
    actions.append(complete);
  } else {
    const undo = node('button', 'button button-secondary', `已${FEEDBACK_LABELS[quest.status]} · 撤销`);
    undo.type = 'button';
    undo.dataset.habitCheckinFor = quest.id;
    undo.setAttribute('aria-label', `撤销习惯“${quest.title}”今天的打卡`);
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      try {
        await db.undoQuestFeedback(quest.id);
        focusAfterRenderSelector = `[data-quest-id="${CSS.escape(quest.id)}"]`;
        showToast('习惯打卡已撤销；动量历史会按事实重算。');
        await render();
      } catch (error) {
        undo.disabled = false;
        showToast(errorMessage(error), 'error');
      }
    });
    actions.append(undo);
  }
  row.append(copy, actions);
  return row;
}

function recoveryPanel(state: ResolvedDimensionState, date: string, useMainSlot: boolean): HTMLElement {
  const suggestions = RECOVERY_SUGGESTIONS[state.dimension];
  let suggestionIndex = 0;
  const panel = node('section', 'surface recovery-action');
  panel.append(node('span', 'tag tag-warn', 'RECOVERY · 状态优先'), node('h2', '', `先补足${dimensionLabel(state.dimension)}`));
  panel.append(node('p', '', `${dimensionLabel(state.dimension)} ${state.value}/100`));
  const title = node('strong', 'recovery-title');
  const detail = node('p', 'quest-minimum');
  const renderSuggestion = () => {
    const suggestion = suggestions[suggestionIndex] ?? suggestions[0];
    if (!suggestion) return;
    title.textContent = suggestion.title;
    detail.textContent = `最小动作：${suggestion.minimumAction} · 约 ${suggestion.estimatedMinutes} 分钟 · 轻量`;
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
        type: useMainSlot ? 'main' : 'side',
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
      if (!useMainSlot) sessionStorage.setItem('qiguang.open-side-quest', quest.id);
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

function openDailyCloseout(date: string, entries: JournalEntry[], quests: Quest[], analysis?: DailyAnalysis, nextSmallStep = ''): void {
  const { dialog, content, actions } = dialogShell('收束今天');
  const localSuccesses = successCredits(entries, quests, analysis?.result.reflection.specificCredit);
  const pending = quests.filter((item) => item.status === 'pending');
  const completed = quests.filter((item) => item.status === 'completed' || item.status === 'partial');
  const checklist = node('div', 'closeout-checklist');
  const record = node('section', `closeout-item${entries.length ? ' is-done' : ''}`);
  record.append(node('strong', '', entries.length ? `已经留下 ${entries.length} 条真实记录` : '还没有留下今天的记录'), node('p', 'caption', entries.length ? '还可以补充一个小成功、感受或值得记住的片段。' : '一句话也可以；先保留事实，不急着完整。'));
  const recordButton = node('button', 'button button-secondary', entries.length ? '追加一条' : '记录今天');
  recordButton.type = 'button'; recordButton.addEventListener('click', () => { dialog.close(); go({ name: 'record' }); }); record.append(recordButton);
  const task = node('section', `closeout-item${pending.length ? '' : ' is-done'}`);
  task.append(node('strong', '', pending.length ? `还有 ${pending.length} 项等待反馈` : `行动已反馈 · ${completed.length} 项有推进`), node('p', 'caption', pending.length ? '可以完成、部分完成、今天不做，或先缩小/顺延；都不扣分。' : '完成和部分完成都会留下现实证据。'));
  if (pending.length) {
    const taskButton = node('button', 'button button-secondary', '处理待反馈行动');
    taskButton.type = 'button'; taskButton.addEventListener('click', () => { dialog.close(); go({ name: 'tasks' }); }); task.append(taskButton);
  }
  const review = node('section', `closeout-item${analysis || localSuccesses.length ? ' is-done' : ''}`);
  review.append(
    node('strong', '', analysis ? '今天已经整理成可回看的章节' : localSuccesses.length ? `已留下 ${localSuccesses.length} 条成功证据` : '今天还没有留下成功证据'),
    node('p', 'caption', analysis ? '小成功、关键事件和明天最小一步都可以继续核对。' : localSuccesses.length ? '来自你写下的内容或已经确认的行动反馈，不依赖 AI 推断。' : entries.length && NATIVE_AI_READY ? 'AI 只会生成候选；发送前仍由你检查范围。' : '完成、推进、坚持或照顾好自己，都可以算。'),
  );
  const reviewButton = node('button', 'button button-secondary', analysis || localSuccesses.length ? '查看成功日记' : entries.length && NATIVE_AI_READY ? '检查范围并整理' : '写下一条小成功');
  reviewButton.type = 'button'; reviewButton.addEventListener('click', () => {
    dialog.close();
    go(analysis || localSuccesses.length || (entries.length && NATIVE_AI_READY) ? { name: 'day', date } : { name: 'record', date });
  }); review.append(reviewButton);
  const tomorrow = node('section', `closeout-item${nextSmallStep ? ' is-done' : ''}`);
  tomorrow.append(node('strong', '', nextSmallStep ? '明天准备继续的一步' : '明天还没有预先决定'), node('p', 'caption', nextSmallStep || '不用现在规划完整明天；回来时从一件真实小事开始即可。'));
  if (nextSmallStep) {
    const tomorrowButton = node('button', 'button button-secondary', '打开任务板决定');
    tomorrowButton.type = 'button'; tomorrowButton.addEventListener('click', () => { dialog.close(); go({ name: 'tasks' }); });
    tomorrow.append(tomorrowButton);
  }
  checklist.append(record, task, review, tomorrow);
  content.append(node('p', 'muted', '结束一天不是清空清单，而是把事实、已有推进和未完成的选择都安放好。'), checklist);
  const close = node('button', 'button button-primary', '今天先到这里'); close.type = 'button'; close.addEventListener('click', () => dialog.close());
  actions.append(close); dialog.showModal(); close.focus();
}

function overdueQuestPanel(quests: Quest[]): HTMLElement {
  const panel = node('section', 'surface overdue-quests');
  const visible = quests.slice(0, 3);
  panel.append(
    node('span', 'tag', '等待处理'),
    node('h2', '', `${quests.length} 项之前安排的行动还没有结算`),
    node('p', 'caption', '它们不会自动算失败。先处理最早的几项，今天只保留真正适合继续的行动。'),
  );
  const list = node('div', 'overdue-quest-list');
  for (const quest of visible) {
    const row = node('article', 'overdue-quest-row');
    row.append(node('strong', '', quest.title), node('span', 'caption', `原计划 ${formatDate(quest.localDate)}`));
    const actions = node('div', 'quest-actions');
    const settle = (result: Extract<FeedbackResult, 'completed' | 'partial' | 'skipped' | 'exempt'>, label: string) => {
      const button = node('button', 'button button-quiet', label);
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await db.feedbackQuest(quest.id, result, '', '', undefined, 0, localDate());
          const progression = await createGoalFollowUp(quest, result);
          showToast(goalProgressMessage(progression, result, result === 'completed' ? '已按真实完成日期记录；经验正常结算。' : result === 'partial' ? '已保留真实进展。' : result === 'exempt' ? '已记为外部原因豁免，不产生惩罚。' : '已放下这一步，不会产生负经验。'));
          await render();
        } catch (error) {
          button.disabled = false;
          showToast(errorMessage(error), 'error');
        }
      });
      return button;
    };
    actions.append(
      settle('completed', '已经完成'),
      settle('partial', '做了一部分'),
      settle('skipped', '不再做'),
      settle('exempt', '外部原因'),
    );
    const feedbackButton = node('button', 'button button-quiet', '详细反馈');
    feedbackButton.type = 'button'; feedbackButton.setAttribute('aria-label', `详细反馈任务：${quest.title}`);
    feedbackButton.addEventListener('click', () => { void openQuestFeedbackDialog(quest); });
    const continueButton = node('button', 'button button-secondary', '缩小后继续');
    continueButton.type = 'button';
    continueButton.setAttribute('aria-label', `调整或顺延任务：${quest.title}`);
    continueButton.addEventListener('click', () => { void openQuestAdjustmentDialog(quest); });
    actions.append(feedbackButton, continueButton);
    row.append(actions);
    list.append(row);
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
  const [entries, observations, quests, overdueQuests, allQuests, allFeedback, confirmedMemories, habits, habitLogs, profile, entryHistory, analyses, previousAnalyses, goals, milestones, areas] = await Promise.all([
    db.listEntries(today), db.resolvedStateAtOrBefore(today), db.listQuests(today), db.listPendingBefore(today), db.listQuests(), db.listQuestFeedback(), db.listMemories('confirmed'), db.listHabits(), db.listHabitLogs(), db.getProfile(), db.listEntries(),
    db.listDailyAnalyses(today), db.listDailyAnalyses(shiftDate(today, -1)), db.listGoals(), db.listMilestones(), db.listAreas(),
  ]);
  const bonusQuests = quests.filter((item) => item.type === 'bonus');
  const plantStates: PlantState[] = habits.filter((item) => item.status === 'active' && item.bonusEnabled).slice(0, 3).map((habit) => {
    const results = habitLogs.filter((item) => item.habitId === habit.id).map((item) => item.result);
    return { habitId: habit.id, growth: results.includes('completed') ? 'grown' : results.includes('partial') ? 'started' : 'empty' };
  });
  const main = node('main', 'page page-today');
  main.append(pageHeader(formatDate(today), '今天', goSystemButton()));

  const latestEntry = entryHistory.at(-1);
  const daysSinceActivity = latestEntry ? (Date.now() - Date.parse(latestEntry.createdAt)) / 86_400_000 : 0;
  const returnDismissed = sessionStorage.getItem(`qiguang.return-dismissed.${today}`) === '1';
  const isReturning = Boolean(latestEntry && daysSinceActivity >= 14 && !returnDismissed);
  const known = Object.values(observations);
  const lowest = known.filter((item) => !observationIsStale(item)).sort((a, b) => a.value - b.value)[0];
  const mainQuest = quests.find((item) => item.type === 'main');
  const carriedGoalQuest = overdueQuests.find((item) => item.type === 'main' && item.sourceType === 'goal')
    ?? overdueQuests.find((item) => item.sourceType === 'goal');
  const directionQuest = mainQuest ?? carriedGoalQuest;
  const mainDeadlineRisk = Boolean(directionQuest?.deadlineAt && Date.parse(directionQuest.deadlineAt) - Date.now() <= 24 * 60 * 60 * 1000);
  const blockedGoalIds = new Set(allQuests.filter((item) => item.sourceType === 'goal' && item.status === 'skipped' && item.sourceId).map((item) => item.sourceId as string));
  const goalProgressSince = shiftDate(today, -7);
  const questById = new Map(allQuests.map((item) => [item.id, item]));
  const areaEvidence = (areaId: string): number => allFeedback.filter((item) => {
    const quest = questById.get(item.questId);
    const evidenceDate = item.completedDate ?? quest?.localDate ?? '';
    return !item.undoneAt && (item.result === 'completed' || item.result === 'partial') && evidenceDate >= goalProgressSince
      && quest?.sourceType === 'goal' && goals.find((goal) => goal.id === quest.sourceId)?.areaId === areaId;
  }).length;
  const eligibleGoals = goals.filter((item) => item.status === 'active' && !blockedGoalIds.has(item.id) && areas.find((area) => area.id === item.areaId)?.mode !== 'pause');
  const primaryGoal = eligibleGoals.find((item) => item.role === 'main');
  const secondaryGoals = eligibleGoals.filter((item) => item.role === 'secondary').sort((left, right) => {
    const modeRank = (goal: Goal): number => ({ build: 0, explore: 1, maintain: 2, pause: 3 })[areas.find((area) => area.id === goal.areaId)?.mode ?? 'pause'];
    return modeRank(left) - modeRank(right) || areaEvidence(left.areaId) - areaEvidence(right.areaId) || left.createdAt.localeCompare(right.createdAt);
  });
  const activeGoal = primaryGoal ?? secondaryGoals[0];
  const activeGoalMode = activeGoal ? areas.find((area) => area.id === activeGoal.areaId)?.mode : undefined;
  const milestoneDue = Boolean(activeGoal && milestones.some((item) => item.goalId === activeGoal.id && item.status === 'pending'));
  const stagnantGoal = Boolean(activeGoal && parseLocalDate(today).getTime() - parseLocalDate(activeGoal.startDate ?? today).getTime() >= 7 * 86_400_000
    && !allQuests.some((item) => item.sourceType === 'goal' && item.sourceId === activeGoal.id && item.localDate >= goalProgressSince
      && (item.status === 'completed' || item.status === 'partial')));
  const areaBalanceNeeded = Boolean(!primaryGoal && activeGoal && secondaryGoals.some((item) => areaEvidence(item.areaId) > areaEvidence(activeGoal.areaId)));
  const previousReflection = previousAnalyses.find((item) => item.status === 'ready')?.result.reflection;
  const readyAnalysis = analyses.find((item) => item.status === 'ready');
  const hasDayEvidence = entries.length > 0 || quests.some((item) => item.status !== 'pending');
  const hasCloseout = Boolean(readyAnalysis || (new Date().getHours() >= 18 && (entries.length > 0 || quests.length > 0)));
  const recoveryDismissed = lowest ? sessionStorage.getItem(`qiguang.recovery-dismissed.${today}.${lowest.dimension}`) === '1' : false;
  const hasRecoveryQuest = quests.some((item) => item.sourceType === 'recovery');
  const direction = chooseDailyDirection({
    mainQuest: directionQuest ? { status: directionQuest.status, deadlineRisk: mainDeadlineRisk, carriedFromPreviousDay: directionQuest.localDate < today } : null,
    recoveryAvailable: Boolean(lowest && lowest.value < 45 && !recoveryDismissed && !hasRecoveryQuest),
    activeGoalAvailable: Boolean(activeGoal),
    previousStepAvailable: Boolean(previousReflection?.nextSmallStep),
    milestoneDue,
    stagnantGoal,
    areaBalanceNeeded,
    goalMode: activeGoalMode,
  });
  const guidance = {
    title: direction.kind === 'recovery' ? '先恢复行动力'
      : direction.kind === 'main' ? directionQuest?.title ?? '核对主线'
        : direction.kind === 'goal' ? activeGoal?.nextStep ?? '推进目标'
          : direction.kind === 'reflection' ? previousReflection?.nextSmallStep ?? '核对昨天的一步'
            : hasDayEvidence ? '今天已经留下证据' : '先讲一件最近发生的事',
    reason: direction.kind === 'explore' && hasDayEvidence ? '没有必须补上的任务，可以回看，也可以停下。' : direction.reason,
    settled: direction.kind === 'explore' && hasDayEvidence,
  };
  const companionContext = [
    ...(activeGoal ? [`当前目标：${activeGoal.result}`] : []),
    ...confirmedMemories.filter((item) => !item.reminderMuted).slice(0, 3).map((item) => `你确认的${({ constraint: '边界', preference: '偏好', pattern: '方法', strength: '优势', principle: '原则' } as const)[item.type]}：${item.statement}`),
  ];

  const hero = node('section', 'home-hero');
  hero.append(roomStage(false, plantStates, profile?.avatar ?? null, profile?.companionName || '小栖', isReturning, roomCueFor(lowest), null, Boolean(directionQuest), milestones.filter((item) => item.status === 'completed').length, guidance, companionContext));
  main.append(hero, statusSummary(observations));

  if (overdueQuests.length) main.append(overdueQuestPanel(overdueQuests));

  const rhythm = node('div', 'daily-rhythm');
  const recordPromptDismissed = sessionStorage.getItem(`qiguang.record-reminder-dismissed.${today}`) === '1';
  if (!mainQuest && !hasCloseout && (direction.kind !== 'explore' || hasDayEvidence || !recordPromptDismissed)) {
    const guide = node('article', 'surface daily-guide');
    if (direction.kind === 'recovery') {
      guide.append(node('h2', '', '先恢复行动力'), node('p', '', direction.reason), node('p', 'quest-minimum', '先从一个不超过十分钟的恢复动作开始。'));
      guide.append(primaryButton('查看恢复建议', () => {
        const recovery = document.querySelector<HTMLElement>('.recovery-action');
        recovery?.scrollIntoView({ behavior: settings.reduceMotion ? 'auto' : 'smooth', block: 'center' });
        recovery?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      }));
    } else if (direction.kind === 'main' && directionQuest?.status === 'pending') {
      guide.append(node('h2', '', directionQuest.title), node('p', '', direction.reason), node('p', 'caption', directionQuest.reason), node('p', 'quest-minimum', `先做最小版本：${directionQuest.minimumAction}`));
      guide.append(primaryButton('处理这项后续行动', () => go({ name: 'tasks' })));
    } else if (direction.kind === 'main' && directionQuest) {
      guide.append(node('h2', '', '这项后续行动已经留下结果'), node('p', '', '接下来可以选择一个 BONUS，或者允许自己停下来。'));
    } else if (direction.kind === 'goal' && activeGoal) {
      guide.append(node('h2', '', activeGoal.nextStep), node('p', '', direction.reason), node('p', '', `来自目标：${activeGoal.result}`));
      guide.append(primaryButton('把这一步安排到今天', () => { void openQuestDialog(activeGoal); }));
    } else if (direction.kind === 'reflection' && previousReflection?.nextSmallStep) {
      guide.append(node('h2', '', previousReflection.nextSmallStep), node('p', '', '这是昨天整理中留下的最小一步；先核对它今天是否仍适合。'));
      guide.append(primaryButton('打开任务板决定', () => go({ name: 'tasks' })));
    } else if (hasDayEvidence) {
      guide.append(node('h2', '', '今天已经留下证据'), node('p', '', '没有必须补上的任务。'));
      guide.append(primaryButton('回看今天', () => go({ name: 'day', date: today })));
    } else {
      guide.append(node('h2', '', '先讲一件最近发生的事'));
      guide.append(primaryButton('开始记录', () => go({ name: 'record' })));
      guide.classList.add('record-reminder');
      const dismiss = node('button', 'button button-quiet', '今天先不用');
      dismiss.type = 'button';
      dismiss.addEventListener('click', () => {
        sessionStorage.setItem(`qiguang.record-reminder-dismissed.${today}`, '1');
        guide.remove();
        if (!rhythm.querySelector('article')) rhythm.remove();
      });
      guide.append(dismiss);
    }
    rhythm.append(guide);
  }
  if (hasCloseout) {
    const closeout = node('article', 'surface daily-closeout is-current');
    closeout.append(node('h2', '', hasDayEvidence ? '今天已经留下证据' : '把今天安放好'), node('p', '', `${entries.length} 条记录 · ${quests.filter((item) => item.status !== 'pending').length} 项已反馈 · ${quests.filter((item) => item.status === 'pending').length} 项待选择`));
    closeout.append(iconButton(readyAnalysis ? '回看今天' : '开始收束今天', null, () => openDailyCloseout(today, entries, quests, readyAnalysis, previousReflection?.nextSmallStep ?? ''), 'button button-secondary'));
    rhythm.append(closeout);
  }
  if (rhythm.childElementCount) main.append(rhythm);

  if (!entries.length && direction.kind !== 'explore' && sessionStorage.getItem(`qiguang.record-reminder-dismissed.${today}`) !== '1') {
    const reminder = node('aside', 'gentle-reminder record-reminder');
    reminder.append(node('strong', '', '今天留下一件真实事情'), node('p', '', '一句话就够：做成、推进、休息、求助或守住边界，都算作今天的证据。'));
    const reminderActions = node('div', 'gentle-reminder-actions');
    const recordNow = node('button', 'button button-secondary', '写一句');
    recordNow.type = 'button'; recordNow.addEventListener('click', () => go({ name: 'record' }));
    const dismiss = node('button', 'button button-quiet', '今天先不用');
    dismiss.type = 'button'; dismiss.addEventListener('click', () => { sessionStorage.setItem(`qiguang.record-reminder-dismissed.${today}`, '1'); reminder.remove(); });
    reminderActions.append(recordNow, dismiss); reminder.append(reminderActions); main.append(reminder);
  }

  if (previousReflection?.nextSmallStep && sessionStorage.getItem(`qiguang.previous-step-dismissed.${today}`) !== '1') {
    const reminder = node('aside', 'gentle-reminder previous-step-reminder');
    reminder.append(node('strong', '', '昨天留下了一步'), node('p', '', `“${previousReflection.nextSmallStep}”——今天可以继续、缩小，或者放下，不会自动顺延。`));
    const reminderActions = node('div', 'gentle-reminder-actions');
    const decide = node('button', 'button button-secondary', '去任务板决定');
    decide.type = 'button'; decide.addEventListener('click', () => go({ name: 'tasks' }));
    const later = node('button', 'button button-quiet', '今天先不用');
    later.type = 'button'; later.addEventListener('click', () => { sessionStorage.setItem(`qiguang.previous-step-dismissed.${today}`, '1'); reminder.remove(); });
    reminderActions.append(decide, later); reminder.append(reminderActions); main.append(reminder);
  }

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
      const next = main.querySelector<HTMLElement>('.main-action h2, .main-action button') ?? main;
      next.tabIndex = -1;
      next.focus({ preventScroll: true });
    });
    actions.append(record, history, dismiss);
    returning.append(node('strong', '', '欢迎回来'), node('p', '', '要从最近发生的一件事开始吗？'), actions);
    main.append(returning);
  }

  if (lowest && lowest.value < 45 && !recoveryDismissed && !hasRecoveryQuest) {
    main.append(recoveryPanel(lowest, today, !mainQuest));
  }
  if (mainQuest) {
    const action = node('section', 'surface main-action quest-main-action');
    action.append(node('span', 'tag tag-dark', 'MAIN · 今日主线'), node('h2', '', mainQuest.title));
    action.append(node('p', '', mainQuest.reason), node('p', 'quest-minimum', `最小动作：${mainQuest.minimumAction} · 约 ${mainQuest.estimatedMinutes} 分钟`));
    action.dataset.questId = mainQuest.id;
    action.tabIndex = -1;
    if (mainQuest.status === 'pending') action.append(quickQuestActions(mainQuest));
    else {
      const feedback = node('button', 'button button-secondary', `已${FEEDBACK_LABELS[mainQuest.status]} · 修改反馈`);
      feedback.type = 'button';
      feedback.dataset.questFeedbackFor = mainQuest.id;
      feedback.setAttribute('aria-label', `修改今日主线“${mainQuest.title}”的反馈`);
      feedback.addEventListener('click', () => { void openQuestFeedbackDialog(mainQuest); });
      action.append(feedback);
      const undo = node('button', 'button button-quiet', '撤销这次反馈');
      undo.type = 'button';
      undo.setAttribute('aria-label', `撤销今日主线“${mainQuest.title}”的反馈`);
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        try {
          await db.undoQuestFeedback(mainQuest.id);
          focusAfterRenderSelector = `[data-quest-id="${CSS.escape(mainQuest.id)}"]`;
          showToast('主线反馈与对应经验已撤销。');
          await render();
        } catch (error) {
          undo.disabled = false;
          showToast(errorMessage(error), 'error');
        }
      });
      action.append(undo);
    }
    main.append(action);
  }

  if (bonusQuests.length) {
    const bonus = node('section', 'today-optionals');
    const heading = node('div', 'section-heading');
    const manageHabits = node('button', 'button button-quiet', '管理');
    manageHabits.type = 'button';
    manageHabits.setAttribute('aria-label', '管理习惯与 BONUS');
    manageHabits.addEventListener('click', () => go({ name: 'tasks' }));
    heading.append(node('h2', '', '习惯打卡'), manageHabits);
    bonus.append(heading);
    bonusQuests.forEach((quest) => bonus.append(homeHabitCheckin(quest)));
    main.append(bonus);
  }
  const sideQuests = quests.filter((item) => item.type === 'side');
  if (sideQuests.length) {
    const side = node('details', 'today-optionals optional-details');
    const summary = node('summary', '', `支线 ${sideQuests.length}/2`);
    side.append(summary);
    sideQuests.forEach((quest) => side.append(questCard(quest, true)));
    const openSideQuest = sessionStorage.getItem('qiguang.open-side-quest');
    if (openSideQuest && sideQuests.some((quest) => quest.id === openSideQuest)) {
      side.open = true;
      sessionStorage.removeItem('qiguang.open-side-quest');
    }
    main.append(side);
  }

  if (entries.length) {
    const recent = node('section', 'simple-list');
    const link = node('button', 'list-row');
    link.type = 'button';
    link.setAttribute('aria-label', `回看今天的 ${entries.length} 条记录`);
    link.append(node('strong', '', '今天的记录'), node('span', 'caption', `${entries.length} 条 · 回看`));
    link.addEventListener('click', () => go({ name: 'day', date: today }));
    recent.append(link);
    main.append(recent);
  }
  return main;
}

function recordPage(route: Route): HTMLElement {
  const today = localDate();
  const targetDate = route.date ?? today;
  const main = node('main', 'page page-record');
  main.append(pageHeader('记录', route.date && route.date !== localDate() ? '补记这一天' : '记录今天'));

  const form = node('form', 'record-form');
  const dateLabel = node('label', 'field-label', '日期');
  const dateInput = node('input', 'input');
  dateInput.type = 'date';
  dateInput.max = localDate();
  dateInput.value = targetDate;
  dateLabel.append(dateInput);
  const dateSettings = node('details', 'record-date-settings optional-details');
  dateSettings.open = Boolean(route.date && route.date !== today);
  const dateSummary = node('summary', '', `日期 · ${targetDate === today ? '今天' : formatDate(targetDate, { month: 'numeric', day: 'numeric' })}`);
  dateSettings.append(dateSummary, dateLabel);

  const bodyLabel = node('label', 'field-label', '发生了什么');
  const textarea = node('textarea', 'journal-input');
  textarea.name = 'body';
  textarea.maxLength = 12_000;
  textarea.placeholder = '今天发生了什么？';
  textarea.value = readDraft(targetDate);
  const counter = node('span', 'character-count', `${textarea.value.length}/12000`);
  bodyLabel.append(textarea, counter);

  const prompts = node('section', 'record-prompts');
  prompts.setAttribute('aria-label', '快速开头');
  const promptActions = node('div', 'record-prompt-actions');
  for (const [label, prompt] of [
    ['小小成功', SUCCESS_PROMPT],
    ['发生的事', '今天发生了什么：'],
    ['感受', '当时我的感受是：'],
    ['想记住', '今天值得记住的是：'],
  ] as const) {
    const button = node('button', 'button button-quiet', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      textarea.value += `${textarea.value.trim() ? '\n\n' : ''}${prompt}\n`;
      textarea.dispatchEvent(new Event('input'));
      textarea.focus();
    });
    promptActions.append(button);
  }
  prompts.append(promptActions);

  const saveState = node('p', 'save-state', textarea.value ? '草稿已本地保存' : '尚未保存');
  saveState.setAttribute('role', 'status');
  const submit = node('button', 'button button-primary button-wide', '保存记录');
  submit.type = 'submit';
  const submitBar = node('div', 'record-submit-bar');
  submitBar.append(saveState, submit);
  form.append(dateSettings, bodyLabel, prompts, submitBar);
  main.append(form);

  let activeDraftDate = targetDate;
  const updateDraftState = (): void => {
    counter.textContent = `${textarea.value.length}/12000`;
    saveDraft(activeDraftDate, textarea.value);
    saveState.textContent = draftNeedsUnloadWarning ? '浏览器未能保存草稿，请先不要关闭页面' : '草稿已本地保存';
    saveState.classList.toggle('is-error', draftNeedsUnloadWarning);
  };
  textarea.addEventListener('input', updateDraftState);
  dateInput.addEventListener('change', () => {
    if (!isLocalDate(dateInput.value)) {
      saveState.textContent = '请选择有效日期；当前草稿已保留。';
      saveState.classList.add('is-error');
      return;
    }
    saveDraft(activeDraftDate, textarea.value);
    activeDraftDate = dateInput.value;
    dateSummary.textContent = `日期 · ${activeDraftDate === today ? '今天' : formatDate(activeDraftDate, { month: 'numeric', day: 'numeric' })}`;
    textarea.value = readDraft(activeDraftDate);
    counter.textContent = `${textarea.value.length}/12000`;
    saveState.textContent = textarea.value ? '已恢复这一天的草稿；其他日期草稿仍保留' : '已切换日期；该日期暂无草稿';
    saveState.classList.remove('is-error');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = '正在保存…';
    saveState.textContent = '正在写入本地数据库';
    try {
      const saved = await db.addEntry(textarea.value, dateInput.value);
      clearDraft(saved.localDate);
      textarea.value = '';
      showToast('已安全保存在本机。');
      go({ name: 'day', date: saved.localDate });
    } catch (error) {
      submit.disabled = false;
      submit.textContent = '重试保存';
      saveState.textContent = `尚未保存：${errorMessage(error)}`;
      saveState.classList.add('is-error');
      showToast(errorMessage(error), 'error');
    }
  });
  requestAnimationFrame(() => textarea.focus());
  return main;
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
  const tabs: Array<[string, string]> = [['calendar', '日历'], ['growth', '成长证据'], ['review', '周复盘']];
  tabs.forEach(([route, label]) => {
    const link = node('a', `trail-tab${route === active ? ' is-active' : ''}`, label);
    link.href = route === 'review' ? `#/review/${localDate()}` : `#/${route}`;
    if (route === active) link.setAttribute('aria-current', 'page');
    nav.append(link);
  });
  return nav;
}

async function calendarPage(): Promise<HTMLElement> {
  const [entries, areas, goals, allQuests, allFeedback] = await Promise.all([db.listEntries(), db.listAreas(), db.listGoals(), db.listQuests(), db.listQuestFeedback()]);
  const entryDates = new Set(entries.map((entry) => entry.localDate));
  const main = node('main', 'page page-calendar');
  main.append(pageHeader('时间线', '日历'));
  main.append(trailTabs('calendar'));

  const panel = node('section', 'surface calendar-panel');
  const toolbar = node('div', 'calendar-toolbar');
  const monthTitle = node('h2', '', new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(calendarCursor));
  toolbar.append(
    iconButton('上个月', null, () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); void render(); }, 'icon-only is-previous'),
    monthTitle,
    iconButton('下个月', null, () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); void render(); }, 'icon-only is-next'),
  );
  panel.append(toolbar);
  const weekdays = node('div', 'weekday-row');
  ['一', '二', '三', '四', '五', '六', '日'].forEach((day) => weekdays.append(node('span', '', day)));
  panel.append(weekdays);
  const grid = node('div', 'calendar-grid');
  for (const dateValue of calendarDates(calendarCursor)) {
    const date = parseLocalDate(dateValue);
    const isOutside = date.getMonth() !== calendarCursor.getMonth();
    const button = node('button', `calendar-day${isOutside ? ' is-outside' : ''}${dateValue === localDate() ? ' is-today' : ''}${entryDates.has(dateValue) ? ' has-entry' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-label', `${formatDate(dateValue, { year: 'numeric' })}${entryDates.has(dateValue) ? '，有记录' : '，无记录'}`);
    if (dateValue === localDate()) button.setAttribute('aria-current', 'date');
    button.append(node('span', '', String(date.getDate())));
    if (entryDates.has(dateValue)) button.append(node('span', 'date-dot', '有记录'));
    button.addEventListener('click', () => go({ name: 'day', date: dateValue }));
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

  const monthStart = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1));
  const monthEnd = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 0));
  const previousMonthStart = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1));
  const previousMonthEnd = localDate(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 0));
  const questById = new Map(allQuests.map((quest) => [quest.id, quest]));
  const completedGoalFeedback = allFeedback.filter((feedback) => !feedback.undoneAt && (feedback.result === 'completed' || feedback.result === 'partial'));
  const monthly = node('section', 'surface monthly-snapshot');
  monthly.append(node('h2', '', '本月领域变化'));
  const areaSignals = areas.map((area) => {
    const goalIds = new Set(goals.filter((goal) => goal.areaId === area.id).map((goal) => goal.id));
    const countEvidence = (start: string, end: string) => completedGoalFeedback.filter((feedback) => {
      const quest = questById.get(feedback.questId);
      const date = feedback.completedDate ?? quest?.localDate ?? '';
      return quest?.sourceType === 'goal' && quest.sourceId && goalIds.has(quest.sourceId) && date >= start && date <= end;
    }).length;
    const evidence = countEvidence(monthStart, monthEnd);
    const previousEvidence = countEvidence(previousMonthStart, previousMonthEnd);
    const signal = monthlyAreaSignal(area.mode, evidence, previousEvidence, monthEnd, localDate());
    const status = { progress: '进步', maintain: '维持', decline: '退化', missing: '缺少证据', paused: '暂停观察' }[signal];
    return { area, evidence, signal, status };
  });
  const visibleSignals = areaSignals.filter((item) => item.signal !== 'missing');
  visibleSignals.forEach(({ area, evidence, signal, status }) => monthly.append(node('p', `monthly-area-row is-${signal}`, `${area.name} · ${status}${evidence ? ` · ${evidence} 项推进证据` : ''}`)));
  const missingSignals = areaSignals.filter((item) => item.signal === 'missing');
  if (!visibleSignals.length) monthly.append(node('p', 'empty-copy', '本月还没有领域行动证据。'));
  if (missingSignals.length && visibleSignals.length) {
    const missing = node('details', 'monthly-missing optional-details');
    missing.append(node('summary', '', `${missingSignals.length} 个领域暂无证据`), node('p', 'caption', missingSignals.map((item) => item.area.name).join('、')));
    monthly.append(missing);
  }
  main.append(monthly);

  const search = node('section', 'search-section');
  search.append(node('h2', '', '查找记录'));
  const searchForm = node('form', 'search-form');
  const query = node('input', 'input');
  query.type = 'search';
  query.placeholder = '搜索记录文字';
  query.setAttribute('aria-label', '搜索记录文字');
  const dateFilter = node('input', 'input');
  dateFilter.type = 'date';
  dateFilter.setAttribute('aria-label', '限定记录日期');
  const searchButton = node('button', 'button button-secondary', '查找');
  searchButton.type = 'submit';
  const searchStatus = node('p', 'search-status');
  searchStatus.setAttribute('role', 'status');
  searchStatus.setAttribute('aria-live', 'polite');
  const results = node('div', 'search-results');
  searchForm.append(query, dateFilter, searchButton);
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
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('cancel', () => dialog.close());
  return { dialog, content, actions };
}

function showOnboarding(): void {
  const { dialog, content, actions } = dialogShell('选择生活分身');
  const choices = node('div', 'avatar-choices');
  const selected = node('p', 'save-state', '');
  let avatar: Profile['avatar'] = null;
  const begin = primaryButton('开始记录', () => {
    if (!avatar) return;
    begin.disabled = true;
    void (async () => {
      try {
        await db.saveProfile({ avatar });
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
    const label = choice === 'female' ? '牛纹帽双辫女生' : '鹿角头饰男生';
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
  choices.querySelector<HTMLButtonElement>('button')?.focus();
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
    `BONUS 习惯 ${request.context.bonusHabits.length} 个`,
    `长期记忆 ${request.context.memories.length} 条`,
    `现实约束 ${request.context.constraints.length} 条`,
  ].join(' · ')));
  if (request.context.memories.length) context.append(node('p', 'caption', request.context.memories.map((item) => `「${item.statement}」`).join('；')));
  if (request.context.constraints.length) context.append(node('p', 'caption', request.context.constraints.join('；')));
  scope.append(records, context);
  content.append(scope, node('p', 'privacy-boundary', '这些内容将离开设备并发送到已配置的 AI 服务；原文不会进入栖光服务端普通日志。'));
}

async function openAnalysisPreview(date: string, entries: JournalEntry[], retryJob?: AnalysisJob): Promise<void> {
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
  content.append(node('p', '', '只选择本次真正需要的记录和上下文。取消任何一项不会受惩罚；证据不足时 AI 应明确不知道。'));
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
  const habitOption = previewContextRow('主动启用的 BONUS', choices.habits.map((item) => item.name).join('；') || '无', Boolean(choices.habits.length));
  [eventOption, stateOption, goalOption, habitOption].forEach((option) => contextGroup.append(option.label));
  const memoryOptions = choices.memories.map((memory) => {
    const option = previewContextRow(`长期记忆 · ${memory.type}`, memory.statement, true);
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
  content.append(node('p', 'privacy-boundary', '默认不会发送全部历史日记、未确认或已忘记的长期候选、设备标识，也不会自动在联网后上传。'));
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
        memories: selectedMemories.map((item) => ({ memoryId: item.id, type: item.type, statement: item.statement })),
        constraints: constraintValues,
      },
      permissions: {
        entryIds: selectedEntries.map((entry) => entry.id),
        includeConfirmedEvents: eventOption.input.checked,
        includeRecentStates: stateOption.input.checked,
        includeGoals: goalOption.input.checked,
        includeBonusHabits: habitOption.input.checked,
        memoryIds: selectedMemories.map((item) => item.id),
      },
    };
    try {
      if (!settings.aiAllowed) settings = await db.saveSettings({ aiAllowed: true, previewBeforeSend: true });
      const job = await db.createDailyAnalysisJob(request);
      dialog.close();
      await submitAnalysisJob(job);
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

async function openEditDialog(entry: JournalEntry): Promise<void> {
  const { dialog, content, actions } = dialogShell('修改记录');
  const bodyLabel = node('label', 'field-label', '正文');
  const textarea = node('textarea', 'journal-input compact');
  textarea.maxLength = 12_000;
  textarea.value = entry.body;
  bodyLabel.append(textarea);
  const status = node('p', 'save-state', `当前版本 v${entry.version}`);
  content.append(bodyLabel, status);
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '保存修改');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = '正在保存修改…';
    try {
      await db.editEntry(entry.id, entry.version, textarea.value);
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
  if (!history.length) content.append(node('p', 'empty-copy', '这条记录还没有修改历史。'));
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
        showToast('已恢复到修改前正文。');
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
  const { dialog, content, actions } = dialogShell(item.sourceType === 'explicit' ? '核对明确事实' : '决定是否相信这条推断');
  const type = node('p', `event-kind is-${item.sourceType}`, item.sourceType === 'explicit' ? '明确事实 · 默认已确认，可撤销' : 'AI 推断 · 确认前不产生影响');
  const title = node('input', 'input');
  title.value = item.title;
  title.maxLength = 60;
  const description = node('textarea', 'input event-edit-description');
  description.value = item.description;
  description.maxLength = 500;
  content.append(type, labelledControl('事件标题', title), labelledControl('事件说明', description));
  const evidence = node('section', 'event-evidence');
  evidence.append(node('h3', '', '原文证据'));
  item.evidence.forEach((value) => evidence.append(node('blockquote', '', `“${value.quote}”`)));
  content.append(evidence);
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
      await db.decideEvent(item.id, 'rejected', { title: title.value, description: description.value });
      dialog.close();
      showToast('已否认；相关状态影响已失效并重算。');
      await render();
    } catch (error) {
      reject.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  const confirm = node('button', 'button button-primary', item.confirmation === 'confirmed' ? '保存核对结果' : '确认并应用候选');
  confirm.type = 'button';
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await db.decideEvent(item.id, 'confirmed', { title: title.value, description: description.value });
      dialog.close();
      showToast('事件已确认；状态按本地规则重算。');
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
    node('span', `event-kind is-${item.sourceType}`, item.sourceType === 'explicit' ? '明确事实' : 'AI 推断'),
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
  if (item.growthEvidenceCandidate) card.append(node('p', 'growth-candidate', `成长证据候选：${item.growthEvidenceCandidate.description}（AI 未计算 XP）`));
  card.append(iconButton(item.confirmation === 'pending' ? '核对这条推断' : '修改或撤销', null, () => { void openEventDecision(item); }, 'button button-secondary'));
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
  heading.firstElementChild?.append(node('h2', '', ready ? '整理结果' : '今天的证据'));
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
    const successes = successCredits(entries, quests);
    const successBlock = node('section', 'success-evidence');
    successBlock.append(node('strong', '', '今天的成功证据'));
    if (successes.length) {
      const list = node('ul', 'success-list');
      successes.forEach((item) => list.append(node('li', '', item)));
      successBlock.append(list);
    } else successBlock.append(node('p', 'caption', '还没有留下；一句具体的小推进也算。'));
    successBlock.append(iconButton(successes.length ? '再写一条小成功' : '写下一条小成功', null, () => go({ name: 'record', date }), 'button button-secondary'));
    section.append(successBlock);
    if (!entries.length) section.append(node('p', 'muted', successes.length ? '行动反馈已经进入成功日记；有原始记录后还可以继续做 AI 整理。' : '有原始记录后，才可以主动选择发送并整理。'));
    else if (!NATIVE_AI_READY) section.append(node('p', 'caption', 'MiniMax 尚未配置；本地成功日记、原始记录、任务与成长仍可完整使用。'));
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
  reflection.append(node('h3', '', '今天留下的证据'));
  const successes = successCredits(entries, quests, ready.result.reflection.specificCredit);
  const successBlock = node('section', 'success-evidence');
  successBlock.append(node('strong', '', '小成功'));
  if (successes.length) {
    const list = node('ul', 'success-list');
    successes.forEach((item) => list.append(node('li', '', item)));
    successBlock.append(list);
  } else successBlock.append(node('p', 'caption', '今天没有足够具体的成功证据，不强行凑数。'));
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
    moreReflection.append(node('p', 'pattern-candidate', `待观察模式：${pattern.observation} · 当前 ${pattern.evidenceCount} 次证据；${pattern.neededEvidence}`));
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
      card.append(node('span', 'tag', suggestion.type === 'main' ? '主线草案' : '支线草案'), node('h4', '', suggestion.title), node('p', '', suggestion.why), node('p', 'caption', `最小版本：${suggestion.minimumVersion} · ${suggestion.estimatedMinutes} 分钟 · ${suggestion.difficulty}`));
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
  if (candidateCount) section.append(iconButton(`系统候选 · ${candidateCount}`, null, () => go({ name: 'system' }), 'button button-quiet'));
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
  const [entries, observations, quests, habits, habitLogs, profile] = await Promise.all([
    db.listEntries(date), db.resolvedStateAtOrBefore(date), db.listQuests(date), db.listHabits(), db.listHabitLogs(), db.getProfile(),
  ]);
  const plantStates: PlantState[] = habits.filter((item) => item.bonusEnabled && timestampLocalDate(item.createdAt) <= date).slice(0, 3).map((habit) => {
    const results = habitLogs.filter((item) => item.habitId === habit.id && item.localDate === date).map((item) => item.result);
    return { habitId: habit.id, growth: results.includes('completed') ? 'grown' : results.includes('partial') ? 'started' : 'empty' };
  });
  const known = Object.values(observations);
  const lowest = known.filter((item) => !observationIsStale(item, date)).sort((a, b) => a.value - b.value)[0];
  const main = node('main', 'page page-day');
  const calendarLink = node('a', 'button button-secondary compact-button', '日历');
  calendarLink.href = '#/calendar';
  main.append(pageHeader('某日回顾', formatDate(date, { year: 'numeric' }), calendarLink), roomStage(true, plantStates, profile?.avatar ?? null, profile?.companionName || '小栖', false, roomCueFor(lowest), date));

  if (entries.length || quests.length) main.append(await dailyAnalysisSection(date, entries, quests));
  if (Object.keys(observations).length) main.append(statusSummary(observations, date));
  else {
    const prompt = node('aside', 'notice inline-notice');
    prompt.append(node('strong', '', '状态待校准'));
    prompt.append(primaryButton('校准状态', () => go({ name: 'system' })));
    main.append(prompt);
  }

  if (quests.length) {
    const taskHistory = node('details', 'day-quests optional-details');
    taskHistory.append(node('summary', '', `行动反馈 · ${quests.length}`));
    quests.forEach((quest) => taskHistory.append(questCard(quest, true)));
    main.append(taskHistory);
  }

  const list = node('section', 'entry-timeline');
  list.append(node('h2', '', '原始记录'));
  if (!entries.length) list.append(node('p', 'empty-copy', '没有记录。'));
  for (const entry of entries) {
    const card = node('article', 'surface entry-card');
    const meta = node('header', 'entry-meta');
    meta.append(
      node('time', '', new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
      node('span', 'tag', entry.version > 1 ? `已修改 · v${entry.version}` : '原始记录'),
    );
    card.append(meta, node('p', 'entry-body', entry.body));
    const actions = node('div', 'entry-actions');
    actions.append(
      iconButton('编辑', null, () => { void openEditDialog(entry); }),
      iconButton('查看版本', null, () => { void openHistoryDialog(entry); }),
      iconButton('删除', null, async () => {
        if (!await confirmAction('删除这条记录？', '正文及其修改历史会从本机永久删除，无法撤销。', '删除', true)) return;
        try {
          await db.deleteEntry(entry.id);
          showToast('记录已从本机删除。');
          await render();
        } catch (error) {
          showToast(errorMessage(error), 'error');
        }
      }, 'button button-quiet'),
    );
    card.append(actions);
    list.append(card);
  }
  main.append(list);

  const dayNav = node('nav', 'day-navigation');
  dayNav.setAttribute('aria-label', '日期导航');
  const previous = node('button', 'button button-secondary', '上一天');
  previous.type = 'button';
  previous.addEventListener('click', () => go({ name: 'day', date: shiftDate(date, -1) }));
  const next = node('button', 'button button-secondary', '下一天');
  next.type = 'button';
  next.addEventListener('click', () => go({ name: 'day', date: shiftDate(date, 1) }));
  dayNav.append(previous, primaryButton('补记', () => go({ name: 'record', date })), next);
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
  const [events, quests, feedback, habits, ledger, branches, goals, memories, reviews] = await Promise.all([
    db.listJournalEvents(), db.listQuests(), db.listQuestFeedback(), db.listHabits(), db.listXpLedger(),
    db.listBranches(), db.listGoals(), db.listMemories('confirmed'), db.listReviews('weekly'),
  ]);
  const confirmedEvents = events.filter((item) => item.active && item.confirmation === 'confirmed' && item.localDate >= period.start && item.localDate <= period.end);
  const periodQuests = quests.filter((item) => item.localDate >= period.start && item.localDate <= period.end && item.status !== 'pending');
  const feedbackByQuest = new Map(feedback.filter((item) => !item.undoneAt).map((item) => [item.questId, item]));
  const states = await Promise.all(Array.from({ length: Math.round((Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / 86_400_000) + 1 }, (_, offset) => {
    const date = shiftDate(period.start, offset);
    return db.resolvedStateAtOrBefore(date).then((values) => ({ date, values }));
  }));
  const activeHabits = habits.filter((item) => item.status === 'active');
  const proactiveMemories = memories.filter((item) => !item.reminderMuted).slice(0, 20);
  const momentums = await Promise.all(activeHabits.map((item) => db.habitMomentum(item.id, period.end)));
  const periodLedger = ledger.filter((item) => !item.reversedAt && item.localDate >= period.start && item.localDate <= period.end);
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION, operation: 'weekly_review', requestId: crypto.randomUUID(), locale: 'zh-CN',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai', period, userInput: { note },
    context: {
      events: confirmedEvents.map((item) => ({ eventId: item.id, version: item.version, localDate: item.localDate, title: item.title, description: item.description })),
      stateSnapshots: states.flatMap(({ date, values }) => {
        const mapped = Object.fromEntries(Object.entries(values).map(([dimension, value]) => [toContractDimension(dimension as Dimension), value.value])) as Partial<Record<ContractDimension, number>>;
        return Object.keys(mapped).length ? [{ localDate: date, values: mapped }] : [];
      }),
      taskResults: periodQuests.map((item) => ({
        questId: item.id, localDate: item.localDate, title: item.title,
        result: item.status as 'completed' | 'partial' | 'skipped' | 'exempt', actual: feedbackByQuest.get(item.id)?.actual ?? '',
      })),
      habits: activeHabits.map((item, index) => ({ habitId: item.id, name: item.name, minimumAction: item.minimumAction, momentum: momentums[index] ?? 0 })),
      growth: branches.map((item) => ({
        branchId: item.id, name: item.name,
        xp: periodLedger.filter((entry) => entry.branchId === item.id).reduce((sum, entry) => sum + entry.finalXp, 0),
      })).filter((item) => item.xp > 0),
      goals: goals.filter((item) => item.status === 'active' && ['main', 'secondary'].includes(item.role)).slice(0, 3).map((item) => ({ goalId: item.id, result: item.result, role: item.role as 'main' | 'secondary' })),
      experiments: reviews.filter((item) => item.status === 'confirmed' && item.nextExperiment.endDate >= period.start).slice(0, 4).map((item) => ({ reviewId: item.id, ...item.nextExperiment })),
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
    node('p', 'privacy-boundary', '不会发送这一周的日记原文。只发送下列已确认事实和摘要；AI 不会直接修改任务、习惯、状态、XP 或长期记忆。'),
    node('p', '', `周期：${formatDate(request.period.start)}—${formatDate(request.period.end)}`),
    node('p', '', `已确认事件 ${request.context.events.length} 条 · 状态摘要 ${request.context.stateSnapshots.length} 天 · 任务结果 ${request.context.taskResults.length} 条`),
    node('p', '', `习惯 ${request.context.habits.length} 个 · 成长方向 ${request.context.growth.length} 个 · 目标 ${request.context.goals.length} 个 · 已确认记忆 ${request.context.memories.length} 条`),
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
    showToast('周复盘候选已保存；下周主题仍等你确认。');
  } catch (error) {
    const current = (await db.listAnalysisJobs(processing.localDate)).find((item) => item.id === processing.id);
    if (current?.status === 'processing' && current.version === processing.version) {
      const typed = error as Error & { code?: AnalysisErrorCode; nextAttemptAt?: string };
      const code: AnalysisErrorCode = typed.name === 'AbortError' ? 'MODEL_TIMEOUT' : typed.code ?? (navigator.onLine ? 'SERVICE_UNAVAILABLE' : 'OFFLINE');
      await db.failAnalysisJob(processing.id, code, analysisErrorCopy(code, errorMessage(error)), typed.nextAttemptAt, processing.version);
      showToast(analysisErrorCopy(code, errorMessage(error)), 'error');
    } else if (current?.status === 'stale') showToast('周内证据已改变，旧复盘结果没有应用。', 'error');
    else showToast('同一复盘已由新的重试接管，旧结果没有应用。');
  } finally {
    window.clearTimeout(timeout);
    await render();
  }
}

async function openWeeklyReviewPreview(period: { start: string; end: string }, retryJob?: AnalysisJob): Promise<void> {
  if (!NATIVE_AI_READY) { showToast(NATIVE_AI_UNAVAILABLE, 'error'); return; }
  const { dialog, content, actions } = dialogShell(retryJob ? '检查并重试周复盘' : '检查周复盘发送范围');
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
  const choices = node('section', 'preview-group');
  choices.append(node('h3', '', '可取消的发送上下文'));
  const eventOptions = baseRequest.context.events.map((event) => {
    const option = previewContextRow(`已确认事件 · ${formatDate(event.localDate)}`, `${event.title}：${event.description}`, true);
    choices.append(option.label);
    return { event, input: option.input };
  });
  const stateOption = previewContextRow('状态摘要', `${baseRequest.context.stateSnapshots.length} 天；不含日记原文`, Boolean(baseRequest.context.stateSnapshots.length));
  const taskOption = previewContextRow('任务结果', `${baseRequest.context.taskResults.length} 条`, Boolean(baseRequest.context.taskResults.length));
  const habitOption = previewContextRow('习惯动量', `${baseRequest.context.habits.length} 个`, Boolean(baseRequest.context.habits.length));
  const growthOption = previewContextRow('成长与 XP 摘要', `${baseRequest.context.growth.length} 个分支`, Boolean(baseRequest.context.growth.length));
  const goalOption = previewContextRow('当前目标', `${baseRequest.context.goals.length} 个`, Boolean(baseRequest.context.goals.length));
  const experimentOption = previewContextRow('既有实验', `${baseRequest.context.experiments.length} 个`, Boolean(baseRequest.context.experiments.length));
  choices.append(stateOption.label, taskOption.label, habitOption.label, growthOption.label, goalOption.label, experimentOption.label);
  const memoryOptions = baseRequest.context.memories.map((memory) => {
    const option = previewContextRow(`已确认记忆 · ${memory.type}`, memory.statement, true);
    choices.append(option.label);
    return { memory, input: option.input };
  });
  const preview = node('div');
  const selectedRequest = (): WeeklyReviewRequest => {
    const request = structuredClone(baseRequest);
    request.requestId = crypto.randomUUID();
    request.userInput.note = note.value;
    request.context.events = eventOptions.filter((item) => item.input.checked).map((item) => item.event);
    request.context.stateSnapshots = stateOption.input.checked ? baseRequest.context.stateSnapshots : [];
    request.context.taskResults = taskOption.input.checked ? baseRequest.context.taskResults : [];
    request.context.habits = habitOption.input.checked ? baseRequest.context.habits : [];
    request.context.growth = growthOption.input.checked ? baseRequest.context.growth : [];
    request.context.goals = goalOption.input.checked ? baseRequest.context.goals : [];
    request.context.experiments = experimentOption.input.checked ? baseRequest.context.experiments : [];
    request.context.memories = memoryOptions.filter((item) => item.input.checked).map((item) => item.memory);
    request.permissions = {
      eventIds: request.context.events.map((item) => item.eventId), includeStateSnapshots: stateOption.input.checked,
      includeTaskResults: taskOption.input.checked, includeHabits: habitOption.input.checked, includeGrowth: growthOption.input.checked,
      includeGoals: goalOption.input.checked, includeExperiments: experimentOption.input.checked,
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
  choices.querySelectorAll('input').forEach((input) => input.addEventListener('change', refresh));
  content.append(labelledControl('本周补充说明（可选）', note), choices, preview);
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const send = node('button', 'button button-primary', navigator.onLine ? '确认范围并生成' : '当前离线');
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
  const { dialog, content, actions } = dialogShell('确认下周唯一主题与实验');
  const theme = node('input', 'input'); theme.maxLength = 120; theme.value = review.nextTheme;
  const hypothesis = node('textarea', 'input compact-textarea'); hypothesis.maxLength = 500; hypothesis.value = review.nextExperiment.hypothesis;
  const minimum = node('input', 'input'); minimum.maxLength = 300; minimum.value = review.nextExperiment.minimumAction;
  const metric = node('input', 'input'); metric.maxLength = 300; metric.value = review.nextExperiment.metric;
  const endDate = node('input', 'input'); endDate.type = 'date'; endDate.value = review.nextExperiment.endDate;
  const stop = node('input', 'input'); stop.maxLength = 300; stop.value = review.nextExperiment.stopCondition;
  const status = node('p', 'save-state', '确认后会尝试把实验最小动作加入下一天 MAIN；如果已有 MAIN，只保存复盘，不覆盖现有计划。');
  content.append(labelledControl('下周唯一主题', theme), labelledControl('实验假设', hypothesis), labelledControl('最小动作', minimum), labelledControl('观察指标', metric), labelledControl('结束日期', endDate), labelledControl('停止条件', stop), status);
  const cancel = node('button', 'button button-secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const confirm = node('button', 'button button-primary', '由我确认'); confirm.type = 'button';
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      const result = await db.confirmWeeklyReview(review.id, theme.value, { hypothesis: hypothesis.value, minimumAction: minimum.value, metric: metric.value, endDate: endDate.value, stopCondition: stop.value });
      dialog.close(); showToast(result.questCreated ? '周复盘已确认，最小实验已加入下一天 MAIN。' : '周复盘已确认；已有 MAIN，没有覆盖计划。'); await render();
    } catch (error) { confirm.disabled = false; status.textContent = errorMessage(error); status.classList.add('is-error'); }
  });
  actions.append(cancel, confirm); dialog.showModal(); theme.focus();
}

function evidenceSummary(item: { summary: string; evidenceEventIds: string[]; evidenceDates: string[]; relationship: string }, events: JournalEvent[]): HTMLElement {
  const block = node('article', 'review-evidence-row');
  const relation = ({ correlation: '相关线索', causal: '因果证据', unknown: '关系未知' } as Record<string, string>)[item.relationship] ?? '关系未知';
  block.append(node('p', '', item.summary), node('p', 'caption', `${relation} · ${item.evidenceDates.length ? item.evidenceDates.map((date) => formatDate(date)).join('、') : '暂无跨日证据'}`));
  if (item.evidenceEventIds.length) block.append(node('p', 'caption', item.evidenceEventIds.map((id) => events.find((event) => event.id === id)?.title ?? '证据已变更').join('；')));
  return block;
}

async function weeklyReviewPage(anchor: string): Promise<HTMLElement> {
  const period = weekRange(anchor);
  const [reviews, jobs, events, habits, memories, areas, goals, periodQuests, profile] = await Promise.all([
    db.listReviews('weekly'), db.listAnalysisJobs(period.end), db.listJournalEvents(), db.listHabits(), db.listMemories(), db.listAreas(), db.listGoals(), db.listQuests(), db.getProfile(),
  ]);
  const review = reviews.find((item) => item.periodStart === period.start && item.periodEnd === period.end);
  const job = jobs.filter((item) => item.operation === 'weekly_review' && (item.request as WeeklyReviewRequest).period.start === period.start)[0];
  const main = node('main', 'page page-review');
  main.append(pageHeader('章节报告', '周复盘'));
  main.append(trailTabs('review'));
  const companion = node('section', 'surface review-companion');
  if (profile?.avatar) { const portrait = node('img', 'character-portrait') as HTMLImageElement; portrait.src = avatarAsset(profile.avatar); portrait.alt = ''; companion.append(portrait); }
  companion.append(node('p', '', '一起看本周证据，方向由你决定。'));
  main.append(companion);
  const nav = node('nav', 'review-period-nav'); nav.setAttribute('aria-label', '周复盘周期');
  const previousWeek = iconButton('上一周', null, () => go({ name: 'review', date: shiftDate(period.start, -7) }));
  const nextWeek = iconButton('下一周', null, () => go({ name: 'review', date: shiftDate(period.start, 7) }));
  nextWeek.disabled = shiftDate(period.start, 7) > localDate();
  nav.append(previousWeek, node('span', 'caption review-period', `${formatDate(period.start)}—${formatDate(period.end)}`), nextWeek);
  main.append(nav);
  if (!review) {
    const intro = node('section', 'surface review-intro');
    intro.append(node('h2', '', '用证据决定下一周'));
    if (!NATIVE_AI_READY) intro.append(node('p', '', 'MiniMax 尚未配置；本地记录、任务反馈、成长证据和成功日记仍会保留。'));
    else if (job?.status === 'processing') {
      const state = node('div', 'analysis-job-state is-running');
      state.append(
        node('p', '', '正在生成；可以离开本页。另一标签也可能仍在处理。'),
        interruptedRetryButton(job, () => { void openWeeklyReviewPreview(period, job); }),
      );
      intro.append(state);
    }
    else if (job && ['queued', 'failed'].includes(job.status)) intro.append(primaryButton(job.status === 'failed' ? '检查范围并重试' : '继续这次复盘', () => { void openWeeklyReviewPreview(period, job); }));
    else intro.append(primaryButton('检查范围并生成', () => { void openWeeklyReviewPreview(period); }));
    main.append(intro);
    return main;
  }
  const hero = node('section', 'surface review-hero');
  const statusLabel = review.status === 'confirmed' ? '已由你确认' : review.status === 'rejected' ? '已暂不采用 · 无惩罚' : '候选，尚未应用';
  hero.append(node('span', 'tag', statusLabel), node('h2', '', review.nextTheme), node('p', '', review.nextThemeReason));
  if (review.status === 'candidate') {
    const reviewActions = node('div', 'review-actions');
    const reject = iconButton('暂不采用', null, async () => {
      if (!await confirmAction('暂不采用这份候选？', '不会扣分、不会产生 MAIN，也不会重复催促。之后仍可重新生成新复盘。', '暂不采用')) return;
      try { await db.rejectWeeklyReview(review.id); showToast('已暂不采用；没有惩罚，也没有修改计划。'); await render(); }
      catch (error) { showToast(errorMessage(error), 'error'); }
    }, 'button button-quiet');
    reviewActions.append(primaryButton('修改并确认下周主题', () => { void openReviewConfirmation(review); }), iconButton('重新检查本周证据', null, () => { void openWeeklyReviewPreview(period); }, 'button button-secondary'), reject);
    hero.append(reviewActions);
  } else if (review.status === 'rejected') {
    hero.append(iconButton('重新检查本周证据', null, () => { void openWeeklyReviewPreview(period); }, 'button button-secondary'));
  }
  main.append(hero);
  const trends = node('section', 'review-section'); trends.append(node('h2', '', '五维趋势与证据'));
  if (!review.stateTrends.length) trends.append(node('p', 'empty-copy', '本周没有足够证据形成状态趋势。'));
  review.stateTrends.forEach((item) => {
    const card = evidenceSummary(item, events); card.prepend(node('strong', '', `${dimensionLabel(item.dimension)} · ${{ up: '上升', down: '下降', stable: '平稳', unknown: '未知' }[item.direction]}`)); trends.append(card);
  });
  main.append(trends);
  if (review.recurringBenefits.length || review.recurringCosts.length) {
    const patterns = node('section', 'review-columns');
    if (review.recurringBenefits.length) {
      const benefits = node('div', 'surface review-pattern'); benefits.append(node('h2', '', '反复收益'));
      review.recurringBenefits.forEach((item) => benefits.append(evidenceSummary(item, events)));
      patterns.append(benefits);
    }
    if (review.recurringCosts.length) {
      const costs = node('div', 'surface review-pattern'); costs.append(node('h2', '', '反复消耗'));
      review.recurringCosts.forEach((item) => costs.append(evidenceSummary(item, events)));
      patterns.append(costs);
    }
    main.append(patterns);
  } else {
    const patterns = node('section', 'review-section');
    patterns.append(node('h2', '', '重复模式'), node('p', 'empty-copy', '本周还没有跨日重复模式。'));
    main.append(patterns);
  }
  const areaActivity = areas.map((area) => {
    const goalIds = new Set(goals.filter((goal) => goal.areaId === area.id).map((goal) => goal.id));
    const completed = periodQuests.filter((quest) => quest.sourceType === 'goal' && quest.sourceId && goalIds.has(quest.sourceId)
      && quest.localDate >= period.start && quest.localDate <= period.end && (quest.status === 'completed' || quest.status === 'partial')).length;
    return { area, completed };
  });
  const visibleAreaActivity = areaActivity.filter(({ area, completed }) => completed > 0 || area.mode === 'build' || area.mode === 'maintain');
  const areaCandidate = areaActivity.find(({ area, completed }) => area.mode === 'build' && completed === 0);
  const areaCandidateDismissed = sessionStorage.getItem(`qiguang.review-area-candidate-dismissed.${review.id}`) === '1';
  const areaSection = node('section', 'review-section');
  areaSection.append(node('h2', '', '领域投入'));
  if (visibleAreaActivity.length) visibleAreaActivity.forEach(({ area, completed }) => areaSection.append(node('p', 'review-decision', `${area.name} · ${{ build: '重点建设', maintain: '维持', explore: '探索', pause: '暂停' }[area.mode]} · ${completed ? `${completed} 项有推进证据` : '本周暂无推进证据'}`)));
  else areaSection.append(node('p', 'empty-copy', '本周还没有领域行动证据。'));
  if (areaCandidate && !areaCandidateDismissed) {
    const candidate = node('aside', 'gentle-reminder review-area-candidate');
    candidate.append(node('strong', '', `调整候选：给“${areaCandidate.area.name}”安排一个最小动作`), node('p', '', '这是投入证据的提示，不是扣分；你可以安排、缩小，或先放下。'));
    const candidateActions = node('div', 'gentle-reminder-actions');
    candidateActions.append(iconButton('去任务板安排', null, () => go({ name: 'tasks' }), 'button button-secondary'));
    const dismissCandidate = node('button', 'button button-quiet', '这周先不调整');
    dismissCandidate.type = 'button'; dismissCandidate.addEventListener('click', () => { sessionStorage.setItem(`qiguang.review-area-candidate-dismissed.${review.id}`, '1'); candidate.remove(); });
    candidateActions.append(dismissCandidate); candidate.append(candidateActions); areaSection.append(candidate);
  }
  main.append(areaSection);
  if (review.growthDeposits.length || review.habitDecisions.length) {
    const decisions = node('section', 'review-section'); decisions.append(node('h2', '', '习惯与成长建议'));
    review.growthDeposits.forEach((item) => decisions.append(node('p', 'review-decision', `${item.branchName ?? '成长候选'}：${item.summary}`)));
    review.habitDecisions.forEach((item) => decisions.append(node('p', 'review-decision', `${habits.find((habit) => habit.id === item.habitId)?.name ?? '习惯'} · ${{ keep: '保留', lower_difficulty: '降低难度', change_trigger: '改变触发器', pause: '暂停', stop: '停止' }[item.action]}：${item.reason}`)));
    if (review.habitDecisions.length) decisions.append(iconButton('去任务板编辑习惯', null, () => go({ name: 'tasks' }), 'button button-secondary'));
    main.append(decisions);
  }
  const experiment = node('section', `surface review-experiment${review.status === 'confirmed' ? ' is-confirmed' : ''}`);
  experiment.append(node('span', 'tag', '下周实验'), node('h2', '', review.nextExperiment.hypothesis), node('p', '', `最小动作：${review.nextExperiment.minimumAction}`), node('p', '', `指标：${review.nextExperiment.metric}`), node('p', 'caption', `到 ${formatDate(review.nextExperiment.endDate)} · 停止条件：${review.nextExperiment.stopCondition}`));
  const reviewMemories = memories.filter((item) => item.reviewId === review.id && item.status !== 'forgotten');
  if (reviewMemories.length) {
    const candidates = node('section', 'review-system-candidates');
    candidates.append(node('strong', '', `${reviewMemories.length} 条系统候选等待逐条核对`), node('p', '', '周复盘没有自动把它们变成关于你的结论。'), iconButton('去我的系统核对', null, () => go({ name: 'system' }), 'button button-secondary'));
    main.append(candidates);
  }
  main.append(experiment);
  if (review.warnings.length) main.append(node('p', 'caption', review.warnings.join('；')));
  return main;
}

function labelledControl(labelText: string, control: HTMLElement): HTMLLabelElement {
  const label = node('label', 'field-label', labelText);
  label.append(control);
  return label;
}

function entityVersionFingerprint(items: Array<{ id: string; version: number }>): string {
  return items.map((item) => `${item.id}@${item.version}`).sort().join('|');
}

async function requestGoalDecomposition(
  values: { result: string; why: string; evidence: string },
  area: Area,
  branch: GrowthBranch,
  memories: SystemMemory[],
  executionEvidence: GoalDecompositionRequest['context']['executionEvidence'] = [],
  currentGoals: GoalDecompositionRequest['context']['currentGoals'] = [],
): Promise<GoalDecompositionResult | null> {
  if (!NATIVE_AI_READY) { showToast(NATIVE_AI_UNAVAILABLE, 'error'); return null; }
  const { dialog, content, actions } = dialogShell('检查目标拆解发送范围');
  content.append(node('p', 'privacy-boundary', '只发送下面列出的目标草案、所选人生领域/成长方向、勾选的执行证据和已确认记忆。AI 只返回可编辑草案，不会直接创建目标或任务。'));
  const scope = node('div', 'analysis-preview-scope');
  scope.append(
    node('p', '', `目标：${values.result}`),
    node('p', '', `为什么：${values.why || '未补充，由 AI 作为待确认假设'}`),
    node('p', '', `完成证据：${values.evidence || '未补充，由 AI 提出可编辑草案'}`),
    node('p', '', `人生领域：${area.name}（${area.mode}） · 成长方向：${branch.name}`),
  );
  const memoryRows = memories.slice(0, 20).map((memory) => {
    const row = previewContextRow(`${memory.reminderMuted ? '已掌握 · 默认不发送' : '已确认'}${memory.type}`, memory.statement, !memory.reminderMuted);
    scope.append(row.label);
    return { memory, input: row.input };
  });
  const executionRows = executionEvidence.slice(0, 20).map((evidence) => {
    const row = previewContextRow(`执行证据 · ${evidence.result}`, `${evidence.completedDate} · ${evidence.title}${evidence.actual ? ` · ${evidence.actual}` : ''}`, true);
    scope.append(row.label);
    return { evidence, input: row.input };
  });
  const goalRows = currentGoals.slice(0, 3).map((goal) => {
    const row = previewContextRow(`当前${goal.role === 'main' ? '主目标' : '次要目标'}`, goal.result, true);
    scope.append(row.label);
    return { goal, input: row.input };
  });
  if (!memoryRows.length) scope.append(node('p', 'caption', '没有发送系统记忆。'));
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
          userInput: { result: values.result, why: values.why, completionEvidence: values.evidence },
          context: {
            area: { areaId: area.id, name: area.name, mode: area.mode },
            branch: { branchId: branch.id, name: branch.name },
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

function suggestGoalClassification(text: string, areas: Area[], branches: GrowthBranch[]): { area?: Area; branch?: GrowthBranch } {
  const value = text.trim().toLowerCase();
  const areaKeywords: Array<[RegExp, string]> = [
    [/睡眠|运动|健身|饮食|身体|健康|休息/, '身心健康'],
    [/工作|项目|职业|客户|收入|赚钱|事业/, '工作与责任'],
    [/写作|创作|作品|视频|绘画|音乐/, '创造与作品'],
    [/学习|考试|课程|阅读|技能|能力/, '学习与能力'],
    [/家人|朋友|伴侣|关系|沟通|社交/, '关系与连接'],
    [/情绪|焦虑|压力|内心|冥想|心理/, '内在与情绪'],
    [/兴趣|旅行|游戏|玩|爱好|生活/, '生活与兴趣'],
    [/财务|存钱|投资|自由|副业/, '财富与自主'],
  ];
  const areaName = areaKeywords.find(([pattern]) => pattern.test(value))?.[1];
  const area = areas.find((item) => item.name === areaName);
  const branchKeywords: Array<[RegExp, string]> = [
    [/健康|睡眠|运动/, '健康资本'],
    [/判断|决策|选择/, '判断力'],
    [/学习|知识|阅读|技能/, '特定知识'],
    [/朋友|家人|伴侣|客户|关系/, '信任资本'],
    [/写作|创作|作品|视频|产品/, '创造杠杆'],
    [/自由|独立|财务|副业/, '自主权'],
  ];
  const branchName = branchKeywords.find(([pattern]) => pattern.test(value))?.[1];
  return { area, branch: branches.find((item) => item.name === branchName) };
}

async function openGoalDialog(): Promise<void> {
  const [areas, branches, memories, goals] = await Promise.all([db.listAreas(), db.listBranches(), db.listMemories('confirmed'), db.listGoals()]);
  const { dialog, content, actions } = dialogShell('建立一个真实目标');
  const result = node('input', 'input');
  result.maxLength = 160;
  result.placeholder = '例如：发布一篇能帮助读者的文章';
  const why = node('textarea', 'input compact-textarea');
  why.maxLength = 500;
  why.placeholder = '这件事为什么值得做？';
  const evidence = node('textarea', 'input compact-textarea');
  evidence.maxLength = 500;
  evidence.placeholder = '什么结果能证明它真的发生？';
  const nextStep = node('input', 'input');
  nextStep.maxLength = 160;
  nextStep.placeholder = '今天可以开始的最小一步';
  const area = node('select', 'input');
  area.append(selectOption('', '暂不设置（系统自动建议）', true));
  areas.forEach((item) => area.append(selectOption(item.id, `${item.name} · ${item.mode}`)));
  const branch = node('select', 'input');
  branch.append(selectOption('', '暂不设置（系统自动建议）', true));
  branches.forEach((item) => branch.append(selectOption(item.id, item.name)));
  const role = node('select', 'input');
  const activeGoals = goals.filter((item) => !['completed', 'abandoned'].includes(item.status));
  const suggestedRole: Goal['role'] = !activeGoals.some((item) => item.role === 'main')
    ? 'main' : activeGoals.filter((item) => item.role === 'secondary').length < 2 ? 'secondary' : 'wishlist';
  role.append(
    selectOption('main', '我现在就想推进它（当前重点）', suggestedRole === 'main'),
    selectOption('secondary', '我想同时照顾它（次要方向）', suggestedRole === 'secondary'),
    selectOption('wishlist', '我先存下来，以后再做', suggestedRole === 'wishlist'),
  );
  const classificationHint = node('p', 'caption');
  let areaTouched = false;
  let branchTouched = false;
  const refreshClassification = () => {
    const suggestion = suggestGoalClassification(result.value, areas, branches);
    if (!areaTouched && !area.value && suggestion.area) area.value = suggestion.area.id;
    if (!branchTouched && !branch.value && suggestion.branch) branch.value = suggestion.branch.id;
    const labels = [suggestion.area ? `领域：${suggestion.area.name}` : '', suggestion.branch ? `成长方向：${suggestion.branch.name}` : ''].filter(Boolean);
    classificationHint.hidden = labels.length === 0;
    classificationHint.textContent = labels.length ? `建议：${labels.join(' · ')}` : '';
  };
  area.addEventListener('change', () => { areaTouched = true; });
  branch.addEventListener('change', () => { branchTouched = true; });
  const status = node('p', 'save-state');
  const assistant = node('section', 'goal-decomposition-assistant');
  const decompose = node('button', 'button button-secondary', !NATIVE_AI_READY ? 'MiniMax 未配置' : navigator.onLine ? 'AI 帮我拆成里程碑' : '联网后可用 AI 拆解');
  decompose.type = 'button';
  decompose.disabled = !navigator.onLine || !NATIVE_AI_READY;
  assistant.append(decompose);
  const plan = node('section', 'goal-plan-editor');
  plan.hidden = true;
  let milestoneEditors: Array<{ enabled: HTMLInputElement; title: HTMLInputElement; evidence: HTMLTextAreaElement }> = [];
  let nextStepDraft: GoalDecompositionResult['nextStep'] | null = null;
  let scheduleNext: HTMLInputElement | null = null;
  let decompositionFingerprint: string | null = null;
  const draftFingerprint = (): string => JSON.stringify({
    result: result.value.trim(), why: why.value.trim(), evidence: evidence.value.trim(),
    area: area.value, branch: branch.value,
  });
  const invalidateDecomposition = () => {
    if (!decompositionFingerprint || draftFingerprint() === decompositionFingerprint) return;
    decompositionFingerprint = null;
    nextStepDraft = null;
    plan.hidden = true;
    status.textContent = '目标内容已经改变；请重新生成拆解草案。';
  };
  const showPlan = (draft: GoalDecompositionResult) => {
    result.value = draft.refinedResult;
    evidence.value = draft.completionEvidence;
    nextStep.value = draft.nextStep.title;
    nextStepDraft = draft.nextStep;
    decompositionFingerprint = draftFingerprint();
    plan.hidden = false;
    plan.replaceChildren(
      node('h3', '', '可编辑的拆解草案'),
      node('p', '', draft.rationale),
      node('p', 'goal-plan-fact', `最终完成证据：${draft.completionEvidence}`),
      node('p', 'goal-plan-fact', `当前阶段：${draft.currentStage}`),
      node('p', 'goal-plan-fact', `预计投入：${draft.estimatedInvestment}`),
    );
    milestoneEditors = draft.milestones.map((milestone, index) => {
      const card = node('article', 'goal-plan-step');
      const enabled = node('input');
      enabled.type = 'checkbox'; enabled.checked = true;
      const titleInput = node('input', 'input');
      titleInput.maxLength = 200; titleInput.value = milestone.title;
      const evidenceInput = node('textarea', 'input compact-textarea');
      evidenceInput.maxLength = 500; evidenceInput.value = milestone.evidence;
      const toggle = node('label', 'setting-row');
      toggle.append(node('span', '', `保留里程碑 ${index + 1}`), enabled);
      card.append(toggle, labelledControl('里程碑', titleInput), labelledControl('完成证据', evidenceInput));
      plan.append(card);
      return { enabled, title: titleInput, evidence: evidenceInput };
    });
    scheduleNext = node('input');
    scheduleNext.type = 'checkbox'; scheduleNext.checked = true;
    const schedule = node('label', 'setting-row');
    schedule.append(node('span', '', `同时把“${draft.nextStep.title}”安排到今天`), scheduleNext);
    plan.append(schedule, node('p', 'caption', `最小动作：${draft.nextStep.minimumAction} · 约 ${draft.nextStep.estimatedMinutes} 分钟 · ${DIFFICULTY_LABELS[draft.nextStep.difficulty]}`));
    if (draft.risks.length) plan.append(node('p', 'caption', `关键风险：${draft.risks.join('；')}`));
    if (draft.assumptions.length) plan.append(node('p', 'caption', `请核对这些假设：${draft.assumptions.join('；')}`));
  };
  decompose.addEventListener('click', async () => {
    status.classList.remove('is-error');
    if (!result.value.trim()) {
      status.textContent = '先写下你想让什么事情发生。';
      status.classList.add('is-error');
      result.focus();
      return;
    }
    const selectedArea = areas.find((item) => item.id === area.value) ?? areas[0];
    const selectedBranch = branches.find((item) => item.id === branch.value) ?? branches[0];
    if (!selectedArea || !selectedBranch) return;
    const requestFingerprint = draftFingerprint();
    const sourceFingerprint = `${entityVersionFingerprint(goals)}#${entityVersionFingerprint(memories)}`;
    decompose.disabled = true;
    const currentGoals = goals.filter((item) => item.status === 'active' && item.role !== 'wishlist')
      .map((item) => ({ goalId: item.id, result: item.result, role: item.role as 'main' | 'secondary' }));
    const draft = await requestGoalDecomposition({ result: result.value, why: why.value, evidence: evidence.value }, selectedArea, selectedBranch, memories, [], currentGoals);
    decompose.disabled = !navigator.onLine || !NATIVE_AI_READY;
    const [latestGoals, latestMemories] = draft ? await Promise.all([db.listGoals(), db.listMemories('confirmed')]) : [[], []];
    const sourceStillCurrent = sourceFingerprint === `${entityVersionFingerprint(latestGoals)}#${entityVersionFingerprint(latestMemories)}`;
    if (draft && draftFingerprint() === requestFingerprint && sourceStillCurrent) {
      showPlan(draft); status.textContent = '拆解草案已回填；请修改后再建立目标。';
    } else if (draft) {
      status.textContent = sourceStillCurrent ? '目标内容已改变，旧拆解没有应用；请重新生成。' : '目标或已确认记忆已经改变；旧拆解没有应用，请重新生成。';
      status.classList.add('is-error');
    }
  });
  [result, why, evidence, area, branch].forEach((control) => control.addEventListener('input', invalidateDecomposition));
  [area, branch].forEach((control) => control.addEventListener('change', invalidateDecomposition));
  const optional = node('details', 'goal-optional-settings');
  optional.append(
    node('summary', '', '补充信息与分类（可选，以后也能改）'),
    labelledControl('为什么想做', why), labelledControl('怎样算完成', evidence),
    labelledControl('你已经想到的下一步', nextStep), labelledControl('人生领域', area),
    labelledControl('成长方向', branch), labelledControl('现在怎么放', role),
  );
  content.append(
    labelledControl('你想让什么事情发生？', result),
    optional, classificationHint, assistant, plan, status,
  );
  result.addEventListener('input', refreshClassification);
  refreshClassification();
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '建立目标');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const fallbackNextStep = `花 5 分钟写下“${result.value.trim()}”的第一步`.slice(0, 160);
      const created = await db.addGoal({
        result: result.value, why: why.value, evidence: evidence.value, nextStep: nextStep.value.trim() || fallbackNextStep,
        areaId: area.value || undefined, branchId: branch.value || undefined, role: role.value as Goal['role'], startDate: localDate(),
      });
      const extraErrors: string[] = [];
      const createdMilestones: Milestone[] = [];
      for (const editor of milestoneEditors.filter((item) => item.enabled.checked)) {
        try { createdMilestones.push(await db.addMilestone(created.id, editor.title.value, editor.evidence.value)); }
        catch (error) { extraErrors.push(errorMessage(error)); }
      }
      if (scheduleNext?.checked && nextStepDraft && created.role !== 'wishlist') {
        try {
          await db.addQuest({
            localDate: localDate(), type: created.role === 'main' ? 'main' : 'side', sourceType: 'goal', sourceId: created.id,
            milestoneId: createdMilestones[0]?.id, completionCriteria: createdMilestones[0]?.evidence ?? nextStepDraft.minimumAction,
            title: nextStepDraft.title, reason: nextStepDraft.why, minimumAction: nextStepDraft.minimumAction,
            estimatedMinutes: nextStepDraft.estimatedMinutes, difficulty: nextStepDraft.difficulty, branchId: created.branchId,
          });
        } catch (error) { extraErrors.push(errorMessage(error)); }
      } else if (!nextStepDraft && created.role !== 'wishlist') {
        try {
          await db.addQuest({
            localDate: localDate(), type: created.role === 'main' ? 'main' : 'side', sourceType: 'goal', sourceId: created.id,
            title: created.nextStep, reason: `这是“${created.result}”当下最小的可行一步。`, minimumAction: '先做 5 分钟。',
            estimatedMinutes: 10, difficulty: 'light', branchId: created.branchId,
          });
        } catch (error) { extraErrors.push(errorMessage(error)); }
      }
      dialog.close();
      showToast(extraErrors.length ? `目标已建立；部分拆解未加入：${extraErrors[0]}` : created.role === role.value ? '目标和已确认的拆解已建立。' : '当前名额已满，目标已放入愿望库。');
      await render();
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

async function openGoalSettingsDialog(goal: Goal): Promise<void> {
  const [areas, branches] = await Promise.all([db.listAreas(), db.listBranches()]);
  const { dialog, content, actions } = dialogShell('编辑目标');
  const result = node('input', 'input');
  result.maxLength = 160;
  result.value = goal.result;
  const why = node('textarea', 'input compact-textarea');
  why.maxLength = 500;
  why.value = goal.why;
  const evidence = node('textarea', 'input compact-textarea');
  evidence.maxLength = 500;
  evidence.value = goal.evidence;
  const nextStep = node('input', 'input');
  nextStep.maxLength = 160;
  nextStep.value = goal.nextStep;
  const area = node('select', 'input');
  areas.forEach((item) => area.append(selectOption(item.id, item.name, item.id === goal.areaId)));
  const branch = node('select', 'input');
  branches.forEach((item) => branch.append(selectOption(item.id, item.name, item.id === goal.branchId)));
  const role = node('select', 'input');
  role.append(
    selectOption('main', '主目标', goal.role === 'main'),
    selectOption('secondary', '次要目标', goal.role === 'secondary'),
    selectOption('wishlist', '愿望库', goal.role === 'wishlist'),
  );
  const goalStatus = node('select', 'input');
  for (const [value, label] of [['idea', '想法'], ['active', '进行中'], ['paused', '暂停'], ['completed', '已完成'], ['abandoned', '已放下']] as const) {
    goalStatus.append(selectOption(value, label, goal.status === value));
  }
  const status = node('p', 'save-state');
  content.append(
    labelledControl('目标结果', result), labelledControl('为什么', why), labelledControl('完成证据', evidence),
    labelledControl('下一步', nextStep), labelledControl('人生领域', area), labelledControl('成长方向', branch),
    labelledControl('推进优先级', role), labelledControl('目标状态', goalStatus), status,
  );
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '保存目标');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await db.saveGoal(goal.id, {
        result: result.value, why: why.value, evidence: evidence.value, nextStep: nextStep.value,
        areaId: area.value, branchId: branch.value, role: role.value as Goal['role'], status: goalStatus.value as Goal['status'],
      });
      dialog.close();
      showToast('目标已更新。');
      await render();
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
  const [areas, branches, memories, goals, quests, feedback] = await Promise.all([
    db.listAreas(), db.listBranches(), db.listMemories('confirmed'), db.listGoals(), db.listQuests(), db.listQuestFeedback(),
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
  const area = areas.find((item) => item.id === goal.areaId);
  const branch = branches.find((item) => item.id === goal.branchId);
  if (!area || !branch) { showToast('目标的人生领域或成长方向不存在。', 'error'); return; }
  const questById = new Map(quests.filter((item) => item.sourceType === 'goal' && item.sourceId === goal.id).map((item) => [item.id, item]));
  const executionEvidence: GoalDecompositionRequest['context']['executionEvidence'] = feedback
    .filter((item) => !item.undoneAt && questById.has(item.questId))
    .slice(0, 20)
    .map((item) => {
      const quest = questById.get(item.questId)!;
      return { questId: quest.id, title: quest.title, result: item.result, actual: item.actual || item.note, completedDate: item.completedDate ?? quest.localDate };
    });
  if (!executionEvidence.length) { showToast('先对这个目标的行动留下至少一次反馈，再根据证据重新拆解。'); return; }
  const currentGoals = goals.filter((item) => item.id !== goal.id && item.status === 'active' && item.role !== 'wishlist')
    .map((item) => ({ goalId: item.id, result: item.result, role: item.role as 'main' | 'secondary' }));
  const draft = await requestGoalDecomposition({ result: goal.result, why: goal.why, evidence: goal.evidence }, area, branch, memories, executionEvidence, currentGoals);
  if (!draft) return;
  if (!await sourceStillCurrent()) { showToast('目标、执行证据或已确认记忆已经改变；旧拆解没有应用，请重新生成。', 'error'); return; }

  const { dialog, content, actions } = dialogShell('确认新的目标路径');
  const result = node('input', 'input'); result.maxLength = 160; result.value = draft.refinedResult;
  const evidence = node('textarea', 'input compact-textarea'); evidence.maxLength = 500; evidence.value = draft.completionEvidence;
  const nextStep = node('input', 'input'); nextStep.maxLength = 160; nextStep.value = draft.nextStep.title;
  content.append(
    node('p', 'privacy-boundary', '新计划确认后，旧待办和未完成里程碑会保留为“已被新计划替换”，不扣分、不删除历史。'),
    node('p', '', draft.rationale), node('p', 'goal-plan-fact', `当前阶段：${draft.currentStage}`),
    node('p', 'goal-plan-fact', `预计投入：${draft.estimatedInvestment}`),
    labelledControl('目标结果', result), labelledControl('最终完成证据', evidence), labelledControl('新的下一步', nextStep),
  );
  const editors = draft.milestones.map((milestone, index) => {
    const enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = true;
    const title = node('input', 'input'); title.maxLength = 200; title.value = milestone.title;
    const proof = node('textarea', 'input compact-textarea'); proof.maxLength = 500; proof.value = milestone.evidence;
    const card = node('article', 'goal-plan-step');
    const toggle = node('label', 'setting-row'); toggle.append(node('span', '', `保留里程碑 ${index + 1}`), enabled);
    card.append(toggle, labelledControl('里程碑', title), labelledControl('完成证据', proof)); content.append(card);
    return { enabled, title, proof };
  });
  if (draft.risks.length) content.append(node('p', 'caption', `关键风险：${draft.risks.join('；')}`));
  if (draft.assumptions.length) content.append(node('p', 'caption', `请核对这些假设：${draft.assumptions.join('；')}`));
  const scheduleNext = node('input'); scheduleNext.type = 'checkbox'; scheduleNext.checked = goal.status === 'active' && goal.role !== 'wishlist';
  const schedule = node('label', 'setting-row'); schedule.append(node('span', '', '确认后把新的下一步安排到今天'), scheduleNext); content.append(schedule);
  const status = node('p', 'save-state'); status.setAttribute('role', 'status'); content.append(status);
  const cancel = node('button', 'button button-secondary', '返回，不修改'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
  const confirm = node('button', 'button button-primary', '确认并替换旧路径'); confirm.type = 'button';
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      if (!await sourceStillCurrent()) throw new Error('目标、执行证据或已确认记忆已经改变，请重新生成拆解草案。');
      const replacements = editors.filter((item) => item.enabled.checked).map((item) => ({ description: item.title.value, evidence: item.proof.value }));
      const replaced = await db.replaceGoalPlan(goal.id, { result: result.value, evidence: evidence.value, nextStep: nextStep.value }, replacements, goal.version);
      let scheduleError = '';
      if (scheduleNext.checked && replaced.goal.status === 'active' && replaced.goal.role !== 'wishlist') {
        try {
          await db.addQuest({
            localDate: localDate(), type: replaced.goal.role === 'main' ? 'main' : 'side', sourceType: 'goal', sourceId: replaced.goal.id,
            milestoneId: replaced.milestones[0]?.id, title: draft.nextStep.title, reason: draft.nextStep.why,
            minimumAction: draft.nextStep.minimumAction, completionCriteria: replaced.milestones[0]?.evidence ?? draft.nextStep.minimumAction,
            estimatedMinutes: draft.nextStep.estimatedMinutes, difficulty: draft.nextStep.difficulty, branchId: replaced.goal.branchId,
          });
        } catch (error) { scheduleError = errorMessage(error); }
      }
      dialog.close();
      showToast(scheduleError ? `新路径已确认；下一步未安排：${scheduleError}` : '新路径已确认，旧路径保留为历史。');
      await render();
    } catch (error) {
      confirm.disabled = false; status.textContent = errorMessage(error); status.classList.add('is-error');
    }
  });
  actions.append(cancel, confirm); dialog.showModal(); result.focus();
}

async function openMilestoneDialog(goal: Goal): Promise<void> {
  const { dialog, content, actions } = dialogShell('添加里程碑');
  content.append(node('p', 'muted', goal.result));
  const description = node('input', 'input');
  description.maxLength = 200;
  description.placeholder = '可验证的阶段性结果';
  const evidence = node('textarea', 'input compact-textarea');
  evidence.maxLength = 500;
  evidence.placeholder = '完成时要看到什么证据？';
  const status = node('p', 'save-state');
  content.append(labelledControl('里程碑', description), labelledControl('证据', evidence), status);
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '添加');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await db.addMilestone(goal.id, description.value, evidence.value);
      dialog.close();
      showToast('里程碑已添加。');
      await render();
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, save);
  dialog.showModal();
  description.focus();
}

async function openQuestDialog(goal?: Goal): Promise<void> {
  const [branches, milestones] = await Promise.all([db.listBranches(), goal ? db.listMilestones(goal.id) : Promise.resolve([])]);
  const nextMilestone = milestones.find((item) => item.status === 'pending');
  const { dialog, content, actions } = dialogShell(goal ? '把下一步安排到今天' : '安排今日任务');
  if (goal) content.append(node('p', 'muted', `来自目标：${goal.result}`));
  const title = node('input', 'input');
  title.maxLength = 160;
  title.value = goal?.nextStep ?? '';
  const reason = node('textarea', 'input compact-textarea');
  reason.maxLength = 500;
  reason.value = goal?.why || '这是你今天主动选择的一步。';
  const minimum = node('input', 'input');
  minimum.maxLength = 200;
  minimum.value = goal?.nextStep || '先做 5 分钟。';
  const minutes = node('input', 'input');
  minutes.type = 'number';
  minutes.min = '1';
  minutes.max = '1440';
  minutes.value = '10';
  const type = node('select', 'input');
  const suggestedType: QuestType = goal?.role === 'main' ? 'main' : 'side';
  type.append(selectOption('main', 'MAIN · 每天最多 1', suggestedType === 'main'), selectOption('side', '支线 · 每天最多 2', suggestedType === 'side'));
  const difficulty = node('select', 'input');
  for (const value of Object.keys(DIFFICULTY_XP) as Difficulty[]) difficulty.append(selectOption(value, `${DIFFICULTY_LABELS[value]} · ${DIFFICULTY_XP[value]} XP`, value === 'standard'));
  const branch = node('select', 'input');
  branches.forEach((item, index) => branch.append(selectOption(item.id, item.name, item.id === goal?.branchId || (!goal && index === 0))));
  const dimension = node('select', 'input');
  dimension.append(selectOption('', '不直接关联五维状态'));
  DIMENSIONS.forEach((item) => dimension.append(selectOption(item.key, item.label)));
  const status = node('p', 'save-state');
  const advanced = node('details', 'quest-optional-settings');
  advanced.append(
    node('summary', '', '调整细节（可选）'),
    labelledControl('为什么今天值得做', reason), labelledControl('最小动作', minimum),
    labelledControl('预计分钟', minutes), labelledControl('任务类型', type), labelledControl('难度', difficulty),
    labelledControl('成长方向', branch), labelledControl('可能照顾的近期状态', dimension),
  );
  content.append(
    labelledControl('我现在想做什么？', title),
    advanced, status,
  );
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '安排到今天');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await db.addQuest({
        localDate: localDate(), type: type.value as QuestType, sourceType: goal ? 'goal' : 'manual', sourceId: goal?.id,
        milestoneId: nextMilestone?.id, completionCriteria: nextMilestone?.evidence ?? minimum.value,
        title: title.value, reason: reason.value, minimumAction: minimum.value, estimatedMinutes: Number(minutes.value),
        difficulty: difficulty.value as Difficulty, branchId: branch.value, dimension: (dimension.value || undefined) as Dimension | undefined,
      });
      dialog.close();
      showToast('任务已安排到今天。');
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
  const branches = await db.listBranches();
  const { dialog, content, actions } = dialogShell(habit ? '编辑习惯' : '建立低成本习惯');
  const name = node('input', 'input');
  name.maxLength = 60;
  name.value = habit?.name ?? '';
  const minimum = node('input', 'input');
  minimum.maxLength = 160;
  minimum.placeholder = '例如：穿鞋出门走 5 分钟';
  minimum.value = habit?.minimumAction ?? '';
  const trigger = node('input', 'input');
  trigger.maxLength = 120;
  trigger.placeholder = '例如：晚饭后';
  trigger.value = habit?.trigger ?? '';
  const schedule = node('fieldset', 'weekday-picker');
  schedule.append(node('legend', 'field-label', '计划日'));
  ['一', '二', '三', '四', '五', '六', '日'].forEach((labelText, index) => {
    const label = node('label', 'weekday-option');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(index + 1);
    checkbox.checked = habit ? habit.scheduleDays.includes(index + 1) : true;
    label.append(checkbox, node('span', '', labelText));
    schedule.append(label);
  });
  const dimension = node('select', 'input');
  DIMENSIONS.forEach((item) => dimension.append(selectOption(item.key, item.label, item.key === habit?.dimension)));
  const branch = node('select', 'input');
  branches.forEach((item) => branch.append(selectOption(item.id, item.name, item.id === habit?.branchId)));
  const difficulty = node('select', 'input');
  for (const value of Object.keys(DIFFICULTY_XP) as Difficulty[]) difficulty.append(selectOption(value, `${DIFFICULTY_LABELS[value]} · ${DIFFICULTY_XP[value]} XP`, value === (habit?.difficulty ?? 'light')));
  const habitStatus = node('select', 'input');
  habitStatus.append(
    selectOption('active', '培养中', (habit?.status ?? 'active') === 'active'),
    selectOption('paused', '暂停', habit?.status === 'paused'),
    selectOption('ended', '已结束', habit?.status === 'ended'),
  );
  const bonusLabel = node('label', 'setting-row');
  const bonus = node('input');
  bonus.type = 'checkbox';
  bonus.checked = habit?.bonusEnabled ?? false;
  bonusLabel.append(node('span', '', '由我主动设为 BONUS（最多 3 个）'), bonus);
  const status = node('p', 'save-state');
  const advanced = node('details', 'form-advanced');
  advanced.append(node('summary', '', '调整频率、最小版本和成长归属（可选）'));
  const advancedFields = node('div', 'form-advanced-fields');
  advancedFields.append(
    labelledControl('最小动作', minimum), labelledControl('触发条件（可选）', trigger), schedule,
    labelledControl('主要近期状态', dimension), labelledControl('成长方向', branch), labelledControl('基础难度', difficulty),
    labelledControl('习惯状态', habitStatus), bonusLabel,
  );
  advanced.append(advancedFields);
  content.append(labelledControl(habit ? '习惯名称' : '我想养成什么？', name), advanced, status);
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
        name: name.value, minimumAction: minimum.value.trim() || `先做一个“${name.value.trim()}”的五分钟版本`, trigger: trigger.value, scheduleDays: days,
        dimension: dimension.value as Dimension, branchId: branch.value, difficulty: difficulty.value as Difficulty,
        bonusEnabled: bonus.checked,
      };
      if (habit) await db.saveHabit(habit.id, { ...value, trigger: trigger.value.trim() || undefined, status: habitStatus.value as Habit['status'] });
      else await db.addHabit(value);
      dialog.close();
      showToast(habit ? '习惯设置已保存。' : bonus.checked ? '习惯已建立，并由你启用为 BONUS。' : '习惯已建立，暂不占用 BONUS 名额。');
      await render();
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, save);
  dialog.showModal();
  name.focus();
}

async function tasksPage(): Promise<HTMLElement> {
  const today = localDate();
  await db.ensureTodayBonusQuests(today);
  const [quests, overdueQuests, goals, habits] = await Promise.all([db.listQuests(today), db.listPendingBefore(today), db.listGoals(), db.listHabits()]);
  const [milestonesByGoal, momentums] = await Promise.all([
    Promise.all(goals.map((goal) => db.listMilestones(goal.id))),
    Promise.all(habits.map((habit) => db.habitMomentum(habit.id, today))),
  ]);
  const main = node('main', 'page page-tasks');
  main.append(pageHeader('现实行动', '任务板', primaryButton('安排任务', () => { void openQuestDialog(); })));
  if (overdueQuests.length) main.append(overdueQuestPanel(overdueQuests));

  const day = node('section', 'task-board');
  const dayHeading = node('div', 'section-heading');
  dayHeading.append(node('h2', '', '今天'));
  if (quests.length) {
    const pending = quests.filter((item) => item.status === 'pending').length;
    const settled = quests.length - pending;
    dayHeading.append(node('span', 'caption', [pending ? `${pending} 项待处理` : '', settled ? `${settled} 项已反馈` : ''].filter(Boolean).join(' · ')));
  }
  day.append(dayHeading);
  if (!quests.length) {
    day.append(node('p', 'empty-copy', '今天还没有任务。'));
  } else quests.forEach((quest) => day.append(questCard(quest, false, quest.milestoneId ? milestonesByGoal.flat().find((item) => item.id === quest.milestoneId) : undefined)));
  main.append(day);

  const goalSection = node('section', 'task-goals');
  const goalHeading = node('div', 'section-heading');
  goalHeading.append(node('h2', '', '目标'), iconButton('新建目标', null, () => { void openGoalDialog(); }, 'button button-secondary'));
  goalSection.append(goalHeading);
  if (!goals.length) goalSection.append(node('p', 'empty-copy', '还没有目标。'));
  goals.forEach((goal, index) => {
    const card = node('article', `goal-row${goal.role === 'main' ? ' is-main' : ''}`);
    const roleLabel = goal.role === 'main' ? '主目标' : goal.role === 'secondary' ? '次要目标' : '愿望库';
    const statusLabel = ({ idea: '想法', active: '进行中', paused: '暂停', completed: '已完成', abandoned: '已放下' } as const)[goal.status];
    card.append(node('span', 'tag', `${roleLabel} · ${statusLabel}`), node('h3', '', goal.result));
    if (goal.why.trim()) card.append(node('p', '', goal.why));
    card.append(node('p', 'quest-minimum', `下一步：${goal.nextStep}`));
    const actions = node('div', 'quest-actions');
    if (goal.role !== 'wishlist' && goal.status === 'active') {
      const schedule = iconButton('安排下一步', null, () => { void openQuestDialog(goal); });
      schedule.setAttribute('aria-label', `安排“${goal.result}”的下一步`);
      actions.append(schedule);
    }
    const manage = node('details', 'quest-more-actions');
    const manageButtons = node('div', 'quest-more-buttons');
    const edit = iconButton('编辑', null, () => { void openGoalSettingsDialog(goal); }, 'button button-secondary');
    edit.setAttribute('aria-label', `编辑目标“${goal.result}”`);
    const milestone = iconButton('添加里程碑', null, () => { void openMilestoneDialog(goal); }, 'button button-secondary');
    milestone.setAttribute('aria-label', `为“${goal.result}”添加里程碑`);
    manageButtons.append(edit, milestone);
    if (NATIVE_AI_READY && goal.status === 'active') {
      const replan = iconButton('重新拆解', null, () => { void openGoalReplanDialog(goal); }, 'button button-quiet');
      replan.setAttribute('aria-label', `根据执行证据重新拆解“${goal.result}”`);
      manageButtons.append(replan);
    }
    manage.append(node('summary', '', '管理目标'), manageButtons);
    actions.append(manage);
    card.append(actions);
    for (const milestone of milestonesByGoal[index] ?? []) {
      const row = node('div', `milestone-row is-${milestone.status}`);
      row.append(node('span', '', milestone.description), node('span', 'caption', milestone.status === 'completed' ? '已确认 · +50 XP' : milestone.status === 'superseded' ? '已被新计划替换' : '待确认'));
      if (milestone.status === 'superseded') { card.append(row); continue; }
      const button = node('button', 'button button-quiet', milestone.status === 'completed' ? '撤销完成' : '确认完成');
      button.type = 'button';
      button.setAttribute('aria-label', `${milestone.status === 'completed' ? '撤销' : '确认'}里程碑“${milestone.description}”完成`);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          if (milestone.status === 'completed') await db.undoMilestone(milestone.id);
          else await db.completeMilestone(milestone.id);
          showToast(milestone.status === 'completed' ? '里程碑经验已撤销。' : '里程碑已确认，经验进入成长方向。');
          await render();
        } catch (error) {
          button.disabled = false;
          showToast(errorMessage(error), 'error');
        }
      });
      row.append(button);
      card.append(row);
    }
    goalSection.append(card);
  });
  main.append(goalSection);

  const habitSection = node('section', 'task-habits');
  const habitHeading = node('div', 'section-heading');
  habitHeading.append(node('h2', '', '习惯'), iconButton('新建习惯', null, () => { void openHabitDialog(); }, 'button button-secondary'));
  habitSection.append(habitHeading);
  if (!habits.length) habitSection.append(node('p', 'empty-copy', '还没有习惯。'));
  habits.forEach((habit, index) => {
    const row = node('article', 'habit-row');
    const copy = node('div');
    copy.append(node('h3', '', habit.name), node('p', 'caption', `${habit.minimumAction} · 动量 ${momentums[index]}/5`));
    const habitActions = node('div', 'quest-actions');
    const toggle = node('button', `button ${habit.bonusEnabled && habit.status === 'active' ? 'button-secondary' : 'button-quiet'}`, habit.bonusEnabled && habit.status === 'active' ? '已启用 BONUS' : '设为 BONUS');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', habit.bonusEnabled && habit.status === 'active' ? `将“${habit.name}”移出 BONUS` : `将“${habit.name}”设为 BONUS`);
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        await db.saveHabit(habit.id, { bonusEnabled: !(habit.bonusEnabled && habit.status === 'active'), status: 'active' });
        showToast(habit.bonusEnabled ? '已移出 BONUS；历史动量保留。' : '已由你主动设为 BONUS。');
        await render();
      } catch (error) {
        toggle.disabled = false;
        showToast(errorMessage(error), 'error');
      }
    });
    const edit = iconButton('编辑', null, () => { void openHabitDialog(habit); }, 'button button-secondary');
    edit.setAttribute('aria-label', `编辑习惯“${habit.name}”`);
    habitActions.append(edit, toggle);
    row.append(copy, habitActions);
    habitSection.append(row);
  });
  main.append(habitSection);
  return main;
}

async function openBranchDialog(): Promise<void> {
  const branches = await db.listBranches();
  const { dialog, content, actions } = dialogShell('建立成长方向');
  const name = node('input', 'input');
  name.maxLength = 60;
  const rootAsset = node('select', 'input');
  ROOT_ASSETS.forEach((item) => rootAsset.append(selectOption(item.key, item.name)));
  const parent = node('select', 'input');
  parent.append(selectOption('', '直接放在根资产下'));
  branches.forEach((item) => parent.append(selectOption(item.id, item.name)));
  const status = node('p', 'save-state');
  status.setAttribute('aria-live', 'polite');
  content.append(labelledControl('分支名称', name), labelledControl('根资产', rootAsset), labelledControl('父分支（可选）', parent), status);
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '建立分支');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await db.addBranch(name.value, rootAsset.value as GrowthBranch['rootAsset'], parent.value || undefined);
      dialog.close();
      showToast('成长方向已建立。');
      await render();
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, save);
  dialog.showModal();
  name.focus();
}

async function growthPage(): Promise<HTMLElement> {
  const [branches, habits, ledger, quests, milestones, goals, feedbacks] = await Promise.all([
    db.listBranches(), db.listHabits(), db.listXpLedger(), db.listQuests(), db.listMilestones(), db.listGoals(), db.listQuestFeedback(),
  ]);
  const [progress, momentums] = await Promise.all([
    Promise.all(branches.map((branch) => db.branchProgress(branch.id))),
    Promise.all(habits.map((habit) => db.habitMomentum(habit.id))),
  ]);
  const main = node('main', 'page page-growth');
  main.append(pageHeader('长期证据', '成长'));
  main.append(trailTabs('growth'));

  const reviewEntry = node('section', 'surface review-entry');
  reviewEntry.append(node('p', 'eyebrow', '每周章节'), node('h2', '', '本周复盘'), primaryButton('打开周复盘', () => go({ name: 'review', date: weekRange().start })));
  main.append(reviewEntry);

  const grid = node('section', 'growth-grid');
  const featuredBranchId = goals.find((goal) => goal.role === 'main' && goal.status === 'active')?.branchId;
  const progressByBranch = new Map(branches.map((branch, index) => [branch.id, progress[index]! ]));
  const orderedBranches = featuredBranchId ? [...branches].sort((left, right) => Number(right.id === featuredBranchId) - Number(left.id === featuredBranchId)) : branches;
  const visibleBranchIds = new Set([
    ...orderedBranches.filter((branch) => (progressByBranch.get(branch.id)?.totalXp ?? 0) > 0).map((branch) => branch.id),
    ...goals.filter((goal) => goal.status === 'active').map((goal) => goal.branchId),
    ...habits.filter((habit) => habit.status === 'active').map((habit) => habit.branchId),
  ]);
  const visibleBranches = orderedBranches.filter((branch) => visibleBranchIds.has(branch.id));
  const dormantBranches = orderedBranches.filter((branch) => !visibleBranchIds.has(branch.id));
  visibleBranches.forEach((branch) => {
    const value = progressByBranch.get(branch.id)!;
    const card = node('article', `surface branch-card${branch.id === featuredBranchId ? ' is-featured' : ''}`);
    const rootName = ROOT_ASSETS.find((item) => item.key === branch.rootAsset)?.name ?? branch.rootAsset;
    card.append(node('span', 'caption', rootName), node('h2', '', branch.name), node('strong', 'branch-level', `Lv.${value.level}`));
    const meter = node('progress', 'xp-progress');
    meter.max = value.nextLevelXp;
    meter.value = value.currentXp;
    meter.setAttribute('aria-label', `${branch.name}等级 ${value.level}，${value.currentXp}/${value.nextLevelXp} XP`);
    card.append(meter, node('p', 'caption', `${value.currentXp}/${value.nextLevelXp} XP · 累计有效 ${value.totalXp}`));

    const branchGoals = goals.filter((item) => item.branchId === branch.id);
    const branchHabits = habits.filter((item) => item.branchId === branch.id);
    const recentEvidence = ledger.filter((item) => item.branchId === branch.id && !item.reversedAt).slice(0, 3);
    const details = node('details', 'branch-details');
    details.append(node('summary', '', '查看证据与关联'));
    if (!branchGoals.length && !branchHabits.length && !recentEvidence.length) {
      details.append(node('p', 'empty-copy', '还没有行动、目标或习惯关联到这个分支。'));
    }
    if (recentEvidence.length) {
      const evidence = node('section', 'branch-evidence');
      evidence.append(node('h3', '', '最近证据'));
      for (const item of recentEvidence) {
        const quest = item.sourceType === 'quest' ? quests.find((value) => value.id === item.sourceId) : undefined;
        const milestone = item.sourceType === 'milestone' ? milestones.find((value) => value.id === item.sourceId) : undefined;
        const feedback = quest ? feedbacks.find((value) => value.questId === quest.id && !value.undoneAt) : undefined;
        const sourceLabel = quest ? ({ goal: '目标任务', habit: '习惯任务', recovery: '恢复行动', manual: '手动行动' } as const)[quest.sourceType] : '里程碑';
        const title = quest?.title ?? milestone?.description ?? '已保留的现实证据';
        const proof = feedback?.actual || feedback?.note || milestone?.evidence || title;
        evidence.append(node('p', 'branch-link-row', `${sourceLabel} · ${title} → ${proof} · ${formatDate(item.localDate)} · +${item.finalXp} XP`));
      }
      details.append(evidence);
    }
    if (branchGoals.length) {
      const relatedGoals = node('section', 'branch-related');
      relatedGoals.append(node('h3', '', '相关目标与里程碑'));
      for (const goal of branchGoals) {
        const goalStatus = ({ idea: '想法', active: '进行中', paused: '暂停', completed: '已完成', abandoned: '已放下' } as const)[goal.status];
        const goalRole = ({ main: '主目标', secondary: '次要目标', wishlist: '愿望库' } as const)[goal.role];
        relatedGoals.append(node('p', 'branch-link-row', `${goalRole} · ${goal.result} · ${goalStatus} · 下一步：${goal.nextStep} · 完成证据：${goal.evidence}`));
        for (const milestone of milestones.filter((item) => item.goalId === goal.id)) {
          relatedGoals.append(node('p', 'caption branch-sub-row', `${milestone.status === 'completed' ? '已确认' : '待确认'} · ${milestone.description} · 证据：${milestone.evidence}`));
        }
      }
      details.append(relatedGoals);
    }
    if (branchHabits.length) {
      const relatedHabits = node('section', 'branch-related');
      relatedHabits.append(node('h3', '', '相关习惯'));
      for (const habit of branchHabits) {
        const habitStatus = ({ active: '培养中', paused: '暂停', ended: '已结束' } as const)[habit.status];
        const momentum = momentums[habits.findIndex((item) => item.id === habit.id)] ?? 0;
        relatedHabits.append(node('p', 'branch-link-row', `${habit.name} · ${habitStatus} · 动量 ${momentum}/5 · ${habit.trigger ? `触发：${habit.trigger} · ` : ''}最小动作：${habit.minimumAction}`));
      }
      details.append(relatedHabits);
    }
    card.append(details);
    grid.append(card);
  });
  if (!visibleBranches.length) grid.append(node('p', 'empty-copy', '还没有成长证据。完成一次现实行动后会出现在这里。'));
  main.append(grid);

  if (dormantBranches.length) {
    const dormant = node('details', 'growth-dormant optional-details');
    dormant.append(node('summary', '', `未开始的成长方向 · ${dormantBranches.length}`));
    const list = node('ul', 'growth-dormant-list');
    dormantBranches.forEach((branch) => {
      const rootName = ROOT_ASSETS.find((item) => item.key === branch.rootAsset)?.name ?? branch.rootAsset;
      list.append(node('li', '', rootName === branch.name ? branch.name : `${branch.name} · ${rootName}`));
    });
    dormant.append(list);
    main.append(dormant);
  }

  const maintenance = node('details', 'growth-maintenance');
  maintenance.append(node('summary', '', '高级维护（可选）'));
  maintenance.append(node('p', 'caption', '大多数时候只需要查看证据；只有你想调整成长结构时才打开这里。'));
  maintenance.append(primaryButton('建立成长方向', () => { void openBranchDialog(); }));
  main.append(maintenance);

  if (habits.length) {
    const habitSection = node('section', 'growth-habits');
    habitSection.append(node('h2', '', '习惯动量'));
    habits.forEach((habit, index) => {
      const row = node('div', 'habit-momentum-row');
      const meter = node('progress', 'momentum-progress');
      meter.max = 5;
      meter.value = momentums[index] ?? 0;
      row.append(node('strong', '', habit.name), meter, node('span', 'caption', `${momentums[index]}/5`));
      habitSection.append(row);
    });
    main.append(habitSection);
  }

  if (ledger.length) {
    const ledgerSection = node('details', 'xp-ledger optional-details');
    ledgerSection.append(node('summary', '', `经验账本 · ${ledger.length}`));
    ledger.slice(0, 30).forEach((item) => {
    const branch = branches.find((value) => value.id === item.branchId);
    const source = item.sourceType === 'milestone'
      ? milestones.find((value) => value.id === item.sourceId)?.description
      : quests.find((value) => value.id === item.sourceId)?.title;
    const difficulty = item.difficulty === 'milestone' ? '里程碑' : DIFFICULTY_LABELS[item.difficulty];
    const row = node('div', `ledger-row${item.reversedAt ? ' is-reversed' : ''}`);
    row.append(
      node('span', '', source ?? (item.sourceType === 'milestone' ? '里程碑' : '现实行动')),
      node('span', '', branch?.name ?? '已移除分支'),
      node('strong', '', item.reversedAt ? `已撤销 +${item.finalXp}` : `+${item.finalXp} XP`),
      node('span', 'caption ledger-rule', `规则：${difficulty} ${item.baseXp} × ${item.ratio}，同一现实行动只结算一次`),
      node('time', 'caption', formatDate(item.localDate)),
    );
      ledgerSection.append(row);
    });
    main.append(ledgerSection);
  }
  return main;
}

function settingsDisclosure(label: string, className = ''): HTMLDetailsElement {
  const details = node('details', `surface settings-section settings-disclosure${className ? ` ${className}` : ''}`);
  details.append(node('summary', '', label));
  return details;
}

function assessmentForm(observations: Partial<Record<Dimension, StateObservation>>): HTMLElement {
  const section = settingsDisclosure(`校准近期状态 · ${Object.keys(observations).length}/5`);
  const form = node('form', 'assessment-form');
  for (const dimension of DIMENSIONS) {
    const existing = observations[dimension.key];
    const row = node('fieldset', 'assessment-row');
    row.dataset.dimension = dimension.key;
    const legend = node('legend');
    legend.append(node('strong', '', dimension.label), node('span', 'caption', dimension.description));
    const knownLabel = node('label', 'known-toggle');
    const known = node('input');
    known.type = 'checkbox';
    known.checked = Boolean(existing);
    knownLabel.append(known, node('span', '', '我想校准这一项'));
    const valueLine = node('div', 'range-line');
    const range = node('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '1';
    range.value = String(existing?.value ?? 60);
    range.disabled = !known.checked;
    range.setAttribute('aria-label', `${dimension.label}自评`);
    const output = node('output', '', known.checked ? range.value : '待了解');
    range.addEventListener('input', () => { output.textContent = range.value; });
    known.addEventListener('change', () => {
      range.disabled = !known.checked;
      output.textContent = known.checked ? range.value : '待了解';
    });
    valueLine.append(range, output);
    row.append(legend, knownLabel, valueLine);
    form.append(row);
  }
  const status = node('p', 'save-state', '尚未修改');
  const save = node('button', 'button button-secondary button-wide', '保存这次校准');
  save.type = 'submit';
  form.append(status, save);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values: Partial<Record<Dimension, number>> = {};
    for (const row of form.querySelectorAll<HTMLElement>('[data-dimension]')) {
      const key = row.dataset.dimension as Dimension;
      const known = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const range = row.querySelector<HTMLInputElement>('input[type="range"]');
      if (known?.checked && range) values[key] = Number(range.value);
    }
    save.disabled = true;
    status.textContent = '正在保存五维自评…';
    try {
      await db.saveAssessment(values);
      status.textContent = '已保存；以后可以随时重新校准。';
      showToast('状态自评已保存。');
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

function profileForm(profile: Profile): HTMLElement {
  const section = settingsDisclosure('人物与章节');
  const form = node('form', 'profile-form');
  const userName = node('input', 'input');
  userName.maxLength = 40;
  userName.value = profile.userName;
  userName.placeholder = '你希望被怎样称呼（可留空）';
  const companionName = node('input', 'input');
  companionName.maxLength = 40;
  companionName.value = profile.companionName;
  const chapterTitle = node('input', 'input');
  chapterTitle.maxLength = 80;
  chapterTitle.value = profile.chapterTitle;
  const avatar = node('select', 'input');
  avatar.append(
    selectOption('', '暂不选择', profile.avatar === null),
    selectOption('female', '牛纹帽双辫女生', profile.avatar === 'female'),
    selectOption('male', '鹿角头饰男生', profile.avatar === 'male'),
  );
  const preview = node('img', 'avatar-preview') as HTMLImageElement;
  preview.alt = '生活分身外观预览';
  const updatePreview = () => {
    const selected = (avatar.value || null) as Profile['avatar'];
    preview.hidden = selected === null;
    if (selected) preview.src = avatarAsset(selected);
  };
  avatar.addEventListener('change', updatePreview);
  updatePreview();
  const status = node('p', 'save-state', '');
  const save = node('button', 'button button-secondary', '保存章节设置');
  save.type = 'submit';
  form.append(
    labelledControl('你的称呼', userName), labelledControl('生活分身称呼', companionName),
    labelledControl('当前人生章节', chapterTitle), labelledControl('生活分身外观', avatar), preview, status, save,
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
      status.textContent = '章节设置已保存。';
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

async function openAreaDialog(): Promise<void> {
  const { dialog, content, actions } = dialogShell('添加人生领域');
  const name = node('input', 'input');
  name.maxLength = 40;
  const mode = node('select', 'input');
  mode.append(
    selectOption('explore', '探索 · 暂不要求稳定产出'),
    selectOption('maintain', '维持 · 保持当前水平'),
    selectOption('build', '重点建设 · 最多两个'),
    selectOption('pause', '暂停 · 不安排主动任务'),
  );
  const status = node('p', 'save-state');
  content.append(labelledControl('领域名称', name), labelledControl('阶段模式', mode), status);
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const save = node('button', 'button button-primary', '添加领域');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await db.addArea(name.value, mode.value as Area['mode']);
      dialog.close();
      showToast('人生领域已添加。');
      await render();
    } catch (error) {
      save.disabled = false;
      status.textContent = errorMessage(error);
      status.classList.add('is-error');
    }
  });
  actions.append(cancel, save);
  dialog.showModal();
  name.focus();
}

async function openDeleteAreaDialog(area: Area, allAreas: Area[]): Promise<void> {
  const { dialog, content, actions } = dialogShell(`删除“${area.name}”`);
  content.append(node('p', 'danger-copy', '删除领域不会删除日记；如果它仍有关联目标，需要先把目标合并到另一个领域。'));
  const replacement = node('select', 'input');
  replacement.append(selectOption('', '没有关联目标时直接删除'));
  allAreas.filter((item) => item.id !== area.id).forEach((item) => replacement.append(selectOption(item.id, `合并到：${item.name}`)));
  content.append(labelledControl('目标处理方式', replacement));
  const cancel = node('button', 'button button-secondary', '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  const confirm = node('button', 'button button-danger', '确认删除领域');
  confirm.type = 'button';
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await db.deleteArea(area.id, replacement.value || undefined);
      dialog.close();
      showToast('领域已删除；关联目标按选择完成合并。');
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

function areasSettings(areas: Area[]): HTMLElement {
  const section = node('section', 'surface settings-section');
  const heading = node('div', 'section-heading');
  heading.append(node('h2', '', '人生领域'), iconButton('添加领域', null, () => { void openAreaDialog(); }, 'button button-secondary'));
  section.append(heading);
  const list = node('div', 'area-list');
  for (const area of areas) {
    const row = node('div', 'area-row');
    const name = node('input', 'input');
    name.value = area.name;
    name.maxLength = 40;
    name.setAttribute('aria-label', `${area.name}名称`);
    const mode = node('select', 'input');
    mode.setAttribute('aria-label', `${area.name}阶段模式`);
    for (const [value, label] of [['build', '重点建设'], ['maintain', '维持'], ['explore', '探索'], ['pause', '暂停']] as const) {
      mode.append(selectOption(value, label, area.mode === value));
    }
    const save = node('button', 'button button-secondary', '保存');
    save.type = 'button';
    save.setAttribute('aria-label', `保存“${area.name}”领域设置`);
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await db.saveArea(area.id, { name: name.value, mode: mode.value as Area['mode'] });
        showToast('领域设置已保存。');
        await render();
      } catch (error) {
        save.disabled = false;
        name.value = area.name;
        mode.value = area.mode;
        showToast(errorMessage(error), 'error');
      }
    });
    const remove = node('button', 'button button-quiet', '删除/合并');
    remove.type = 'button';
    remove.setAttribute('aria-label', `删除或合并“${area.name}”领域`);
    remove.addEventListener('click', () => { void openDeleteAreaDialog(area, areas); });
    row.append(name, mode, save, remove);
    list.append(row);
  }
  section.append(list);
  return section;
}

async function importPreview(text: string): Promise<void> {
  const bundle = parseBackup(text);
  const { dialog, content, actions } = dialogShell('检查备份');
  content.append(node('p', '', `记录 ${bundle.data.entries.length} 条 · 整理 ${bundle.data.analyses.length} 份 · 事件 ${bundle.data.events.length} 条 · 目标 ${bundle.data.goals.length} 个 · 任务 ${bundle.data.quests.length} 条 · 记忆 ${bundle.data.memories.length} 条 · 经验 ${bundle.data.xpLedger.length} 笔`));
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
  content.append(node('p', 'danger-copy', '将删除所有记录、草稿、AI 整理、事件确认、队列、系统记忆、复盘、目标、任务、习惯、反馈、经验、五维自评和个人设置，无法恢复。当前没有账户或长期服务端存储；已发送请求的验证结果可能在同源中转内存保留最多 10 分钟用于幂等，本地删除不会远程清除这份短暂缓存。'));
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
  const { dialog, content, actions } = dialogShell(memory.status === 'candidate' ? '核对系统候选' : '编辑已确认记忆');
  content.append(node('p', 'caption', `类型：${memory.type} · 确定程度：${memory.confidence} · 证据 ${memory.evidenceIds.length} 条`));
  const statement = node('textarea', 'input memory-edit');
  statement.maxLength = 500;
  statement.value = memory.statement;
  content.append(labelledControl('只有你确认后才会成为系统记忆', statement));
  if (memory.counterEvidence.length) content.append(node('p', 'caption', `反例：${memory.counterEvidence.join('；')}`));
  if (!hasValidEvidence) content.append(node('p', 'danger-copy', '原始记录或事件已经改变，这条候选目前没有有效证据，不能重新确认。你可以暂不处理或忘记。'));
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
  const confirm = node('button', 'button button-primary', statement.value === memory.statement ? '确认这条记忆' : '编辑后确认');
  confirm.type = 'button';
  confirm.disabled = !hasValidEvidence;
  statement.addEventListener('input', () => { confirm.textContent = statement.value === memory.statement ? '确认这条记忆' : '编辑后确认'; });
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
  if (available.length < 2) { showToast('至少需要两条候选或已确认记忆才能检查重复。'); return; }
  const { dialog, content, actions } = dialogShell('检查重复系统候选');
  content.append(node('p', 'privacy-boundary', '只发送下列候选陈述、证据标题、日期和反例，不发送日记原文。AI 只能建议“分开”或“合并”；不会自动确认或删除。'));
  const preview = node('div', 'memory-review-preview');
  const optionRows = available.map((memory, index) => {
    const evidence = memory.evidenceIds.flatMap((id) => {
      const event = events.find((item) => item.id === id);
      return event ? [`${formatDate(event.localDate)} · ${event.title}`] : [];
    }).join('；') || '暂无证据标题';
    const option = previewContextRow(`${memory.status === 'confirmed' ? '已确认' : '候选'} · ${memory.type}`, `${memory.statement} · ${evidence}`, index < 30);
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
        const allowed = await confirmAction('允许这一次候选检查？', '只发送当前预览中的候选陈述和证据摘要。', '允许并继续');
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
      if (!response.ok) throw new Error((body as { error?: { message?: string } } | null)?.error?.message || '候选检查服务暂时不可用。');
      const parsed = parseSystemCandidateReviewResponse(body, request);
      content.replaceChildren(node('h2', '', '候选去重建议'), node('p', 'privacy-boundary', '以下只是去重建议。每一组合并都需要你单独点击；合并后仍保持“待确认”。'));
      parsed.result.groups.forEach((group) => {
        const card = node('article', `memory-merge-group is-${group.action}`);
        const sources = group.candidateMemoryIds.map((id) => selected.find((item) => item.id === id)?.statement ?? '候选已改变');
        card.append(node('span', 'tag', group.action === 'merge' ? '可考虑合并' : '建议分开'), node('p', '', sources.join('；')), node('p', 'caption', `${group.reason} · 确定程度：${{ high: '高', medium: '中', low: '低' }[group.confidence]}`));
        if (group.action === 'merge' && group.mergedStatement) {
          const statement = node('textarea', 'input compact-textarea'); statement.maxLength = 500; statement.value = group.mergedStatement;
          const merge = node('button', 'button button-secondary', '合并为待确认候选'); merge.type = 'button';
          merge.addEventListener('click', async () => {
            merge.disabled = true;
            try {
              const sources = group.candidateMemoryIds.map((id) => selected.find((item) => item.id === id)).filter((item): item is SystemMemory => Boolean(item));
              await db.mergeMemoryCandidates(sources, statement.value);
              dialog.close(); showToast('已合并为一条待确认候选；没有自动确认。'); await render();
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
  section.append(node('h2', '', '我的行动说明书'));
  section.append(node('p', '', '这里只展示你亲自确认的内容：AI 候选保留生活证据，你直接设定的规则会明确标注来源。它们会帮助目标拆解和日常建议尊重你的真实方式。'));
  section.append(iconButton('主动告诉生活分身一条规则', null, () => { void openAddMemoryDialog(); }, 'button button-secondary'));
  const evidenceDates = new Set(confirmed.flatMap((memory) => memory.evidenceIds.flatMap((id) => {
    const event = events.find((item) => item.id === id);
    return event?.localDate ? [event.localDate] : [];
  })));
  const companionStage = confirmed.length === 0 ? ['初识', '先从一条真实记录开始']
    : confirmed.length >= 5 && evidenceDates.size >= 4 ? ['成长', '新的证据正在持续修正行动说明书']
      : confirmed.length >= 3 && evidenceDates.size >= 2 ? ['默契', '我会优先参考已确认的方法，也会为新证据留出空间']
        : ['熟悉', '我开始了解哪些方式对你更有效，但不会替你下结论'];
  section.append(node('p', 'caption companion-stage', `伙伴阶段：${companionStage[0]} · ${companionStage[1]}（按已确认记忆与证据丰富度计算，不按登录天数升级）`));
  const appendMemory = (parent: HTMLElement, memory: SystemMemory, label: string): void => {
    const card = node('article', `memory-row is-${memory.status}`);
    const evidenceEvents = memory.evidenceIds.flatMap((id) => {
      const event = events.find((item) => item.id === id);
      return event ? [event] : [];
    });
    const evidenceTitles = evidenceEvents.map((event) => event.title);
    const evidenceDateLabels = [...new Set(evidenceEvents.map((event) => event.localDate))].sort().map((date) => formatDate(date, { year: 'numeric' }));
    card.append(node('span', 'tag', `${label}${memory.reminderMuted ? ' · 已减少提醒' : ''}`), node('h3', '', memory.statement), node('p', 'caption', memory.evidenceIds.length ? `证据：${evidenceTitles.join('；') || '原证据已变化'}${evidenceDateLabels.length ? ` · 发生于 ${evidenceDateLabels.join('、')}` : ''}` : '来源：你直接写下并确认'));
    if (memory.counterEvidence.length) card.append(node('p', 'caption', `反例：${memory.counterEvidence.join('；')}`));
    const memoryActions = node('div', 'quest-actions');
    memoryActions.append(iconButton(memory.status === 'candidate' ? '核对候选' : '编辑或忘记', null, () => { void openMemoryDecision(memory); }));
    if (memory.status === 'confirmed') memoryActions.append(iconButton(memory.reminderMuted ? '恢复主动提醒' : '已掌握，减少提醒', null, async () => {
      try { await db.setMemoryReminder(memory.id, !memory.reminderMuted); showToast(memory.reminderMuted ? '这条方法会重新参与主动建议。' : '仍会保留这条记忆，但不再主动反复提醒。'); await render(); }
      catch (error) { showToast(errorMessage(error), 'error'); }
    }, 'button button-quiet'));
    card.append(memoryActions);
    parent.append(card);
  };
  const groups: Array<[SystemMemory['type'], string, string]> = [
    ['constraint', '需要尊重的边界', '安排任务时优先避免这些已知消耗。'],
    ['preference', '更适合我的方式', '帮助选择更容易开始和坚持的做法。'],
    ['strength', '已经证明的优势', '来自真实行动，而不是人格标签。'],
    ['pattern', '反复出现的规律', '仍允许新证据修正旧结论。'],
    ['principle', '我认同的原则', '重要选择时可以回来核对。'],
  ];
  const guide = node('div', 'system-guide-groups');
  for (const [type, title, description] of groups) {
    const values = confirmed.filter((memory) => memory.type === type);
    const group = node('section', `system-guide-group is-${type}`);
    group.append(node('h3', '', title), node('p', 'caption', description));
    if (values.length) values.forEach((memory) => appendMemory(group, memory, '已确认'));
    else group.append(node('p', 'empty-copy', '还没有经过确认的结论。'));
    guide.append(group);
  }
  section.append(guide);
  const pending = node('details', 'memory-candidates');
  pending.append(node('summary', '', `待你核对的候选 · ${candidates.length}`));
  pending.append(node('p', 'caption', '候选不会影响目标拆解或日常建议；这里没有批量确认。'));
  candidates.forEach((memory) => appendMemory(pending, memory, '待确认'));
  if (!candidates.length) pending.append(node('p', 'muted', '暂时没有候选。'));
  section.append(pending);
  if (candidates.length + confirmed.length >= 2) {
    if (NATIVE_AI_READY) section.append(iconButton('检查重复候选', null, () => { void openSystemCandidateReview([...candidates, ...confirmed], events); }, 'button button-secondary'));
    else section.append(node('p', 'caption', '远程候选去重未连接；仍可逐条核对、编辑或忘记。'));
  }
  return section;
}

function aiPermissionSettings(): HTMLElement {
  const section = settingsDisclosure(`AI 权限 · ${settings.aiAllowed && NATIVE_AI_READY ? '已开启' : '已关闭'}`, 'ai-settings');
  const savedModel = canonicalAiModel(settings.aiModel);
  const permission = node('label', 'setting-row');
  const permissionInput = node('input');
  permissionInput.type = 'checkbox';
  permissionInput.checked = NATIVE_AI_READY && settings.aiAllowed;
  permissionInput.disabled = !NATIVE_AI_READY;
  permission.append(node('span', '', '允许主动整理（每次发送前先确认范围）'), permissionInput);
  permissionInput.addEventListener('change', async () => {
    permissionInput.disabled = true;
    try {
      settings = await db.saveSettings({ aiAllowed: permissionInput.checked, previewBeforeSend: true });
      showToast(permissionInput.checked ? 'AI 整理权限已开启；每次仍会显示发送预览。' : 'AI 权限已关闭；不会再发送整理请求。');
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
  const modelHint = node('span', 'caption', '选择 MiniMax 模型。');
  const modelRow = node('label', 'setting-row');
  modelRow.append(node('span', '', '模型'), modelSelect);
  modelRow.append(modelHint);
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
  keyInput.placeholder = '输入 MiniMax API Key（可选）';
  keyInput.maxLength = 4_096;
  keyInput.autocomplete = 'new-password';
  const keyStatus = node('p', 'caption');
  const keyRow = node('label', 'setting-row');
  keyRow.append(node('span', '', '自定义 API Key'), keyInput);
  const keyActions = node('div', 'character-actions');
  const saveApiKey = node('button', 'button button-secondary', '保存');
  const clearApiKey = node('button', 'button button-quiet', '清除自定义密钥');
  saveApiKey.type = 'button';
  clearApiKey.type = 'button';
  keyActions.append(saveApiKey, clearApiKey);

  const health = node('p', 'caption');

  function updateAiConfigStatus() {
    const hasCustom = Boolean((settings.aiApiKey ?? '').trim());
    const model = canonicalAiModel(settings.aiModel);
    keyStatus.textContent = hasCustom ? `已保存自定义密钥（长度 ${(settings.aiApiKey ?? '').length}，不回显）` : '未保存自定义密钥。留空将使用安装包密钥。';
    keyInput.placeholder = hasCustom ? '已配置自定义密钥（不回显）' : '输入 MiniMax API Key（可选）';
    modelHint.textContent = `当前模型：${model}。${hasCustom ? '当前使用自定义密钥。' : NATIVE_DIRECT_AI_READY ? '当前使用安装包密钥。' : '安装包未配置密钥，需自定义。'}`;
    const ready = NATIVE_AI_READY;
    health.textContent = !NATIVE_PLATFORM
      ? ready ? 'AI 通过同源服务连接；模型由服务端配置。' : '当前没有可用的同源 AI 服务。'
      : ready
        ? `AI 可用 · 模型 ${model} ${NATIVE_DIRECT_AI_READY ? '（安装包）' : hasCustom ? '（自定义密钥）' : '（HTTPS 服务）'}`
        : NATIVE_AI_UNAVAILABLE;
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

  const check = node('button', 'button button-secondary', '检查 AI 配置');
  check.type = 'button';
  check.disabled = !NATIVE_AI_READY;
  check.addEventListener('click', async () => {
    check.disabled = true;
    try {
      if (NATIVE_DIRECT_AI_READY) {
        await initializeNativeAi();
        health.textContent = `安装包配置模型 ${NATIVE_AI_MODEL} · 合约 ${ANALYSIS_CONTRACT_VERSION}`;
      } else if (NATIVE_PLATFORM && (settings.aiApiKey ?? '').trim()) {
        health.textContent = `自定义密钥已配置 · 模型 ${canonicalAiModel(settings.aiModel)}`;
      } else {
        const response = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
        const value = await response.json() as { configured?: boolean; model?: string; contractVersion?: string };
        if (value.configured) {
          health.textContent = `同源服务已配置 · ${value.model ?? '模型未标识'} · 合约 ${value.contractVersion ?? '未知'}`;
        } else {
          health.textContent = '同源服务可用，但尚未配置服务端密钥。';
        }
      }
      updateAiConfigStatus();
    } catch {
      health.textContent = '当前页面没有可用的 AI 配置；本地功能仍可完整使用。';
    } finally {
      check.disabled = false;
    }
  });

  section.append(permission);
  if (NATIVE_PLATFORM) section.append(modelRow, keyRow, keyActions, keyStatus);
  section.append(health, check);
  updateAiConfigStatus();
  return section;
}

async function installStorageSettings(): Promise<HTMLElement> {
  const section = settingsDisclosure('安装与存储', 'install-storage-settings');
  const installed = matchMedia('(display-mode: standalone)').matches;
  const installStatus = node('p', '', installed ? '已以独立应用模式打开。' : installPrompt ? '当前浏览器允许安装栖光。' : '可以使用浏览器菜单“添加到主屏幕”；不同浏览器的入口可能不同。');
  section.append(installStatus);
  if (installPrompt && !installed) {
    const install = iconButton('安装栖光', null, async () => {
      if (!installPrompt) return;
      install.disabled = true;
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installPrompt = null;
      installStatus.textContent = choice.outcome === 'accepted' ? '安装请求已交给浏览器处理。' : '这次没有安装；以后仍可从浏览器菜单安装。';
      install.remove();
    }, 'button button-secondary');
    section.append(install);
  }

  const storageStatus = node('p', 'caption');
  const persisted = await navigator.storage?.persisted?.().catch(() => false) ?? false;
  storageStatus.textContent = persisted
    ? '浏览器已同意持久保留本地数据；这仍不是备份，请继续定期导出。'
    : '浏览器可能在存储压力下清理本地数据。可以请求持久存储；即使同意，也请继续定期导出。';
  section.append(storageStatus);
  if (!persisted && navigator.storage?.persist) {
    const persist = iconButton('请求持久存储', null, async () => {
      persist.disabled = true;
      const granted = await navigator.storage.persist().catch(() => false);
      storageStatus.textContent = granted
        ? '浏览器已同意持久保留本地数据；这仍不是备份，请继续定期导出。'
        : '浏览器没有同意持久存储；本地功能不受影响，请更重视定期导出。';
      if (granted) persist.remove(); else persist.disabled = false;
    }, 'button button-secondary');
    section.append(persist);
  }
  section.append(node('p', 'privacy-boundary', '卸载主屏幕图标不等于可靠删除数据；清除这个站点的浏览数据会删除本地记录。更换设备、重装浏览器或清理前，请先导出备份。'));
  return section;
}

async function systemPage(): Promise<HTMLElement> {
  const [observations, profile, areas, memories, events, entries] = await Promise.all([
    db.latestAssessment(), db.getProfile(), db.listAreas(), db.listMemories(), db.listJournalEvents(), db.listEntries(),
  ]);
  if (!profile) throw new Error('个人系统尚未初始化。');
  const main = node('main', 'page page-system');
  main.append(pageHeader('数据与选择权', '我的系统'));
  main.append(profileForm(profile), assessmentForm(observations), aiPermissionSettings());
  const advancedSystem = node('details', 'system-advanced');
  advancedSystem.append(
    node('summary', '', '高级系统（领域与行动说明书）'),
    areasSettings(areas), memorySettings(memories, events),
  );
  main.append(advancedSystem);

  const preferences = settingsDisclosure('显示偏好');
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
  tone.append(selectOption('gentle', '温和：给我余地和陪伴', settings.guidanceTone === 'gentle'), selectOption('direct', '直接：明确告诉我先做什么', settings.guidanceTone === 'direct'));
  const toneLabel = labelledControl('指导方式（只影响措辞）', tone);
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
  main.append(preferences);

  const pinState = widgetPinState();
  if (pinState !== 'unavailable') {
    const desktop = settingsDisclosure('桌面伙伴');
    const desktopStatus = node('p', 'caption', pinState === 'pinned' ? '桌面伙伴已添加。' : '在桌面直接查看今天的任务与经验。');
    desktop.append(desktopStatus);
    if (pinState === 'available') {
      const pin = iconButton('添加到桌面', null, () => {
        if (requestWidgetPin()) {
          pin.disabled = true;
          desktopStatus.textContent = '请在系统窗口中确认添加。';
        } else {
          showToast('系统没有打开添加窗口，请从桌面小组件列表添加栖光。', 'error');
        }
      }, 'button button-secondary');
      desktop.append(pin);
    }
    main.append(desktop);
  }

  const data = settingsDisclosure('备份与本地数据', 'data-actions');
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
  const deleteButton = iconButton('删除全部数据', null, () => { void deleteAllDialog(); }, 'button button-danger');
  const backupDismissKey = `qiguang.backup-reminder-dismissed.${localDate()}`;
  const lastBackup = localStorage.getItem('qiguang.last-backup-at');
  const backupDue = entries.length > 0 && (!lastBackup || Date.now() - Date.parse(lastBackup) >= 30 * 86_400_000);
  if (backupDue && localStorage.getItem(backupDismissKey) !== '1') {
    data.open = true;
    const reminder = node('aside', 'gentle-reminder');
    reminder.append(node('strong', '', '给本地记录留一份备份'), node('p', '', '持久存储不是备份；导出一份文件，哪天换设备或浏览器时会更安心。'));
    const remindActions = node('div', 'gentle-reminder-actions');
    const backupNow = node('button', 'button button-secondary', '现在导出');
    backupNow.type = 'button'; backupNow.addEventListener('click', () => exportButton.click());
    const later = node('button', 'button button-quiet', '今天先不用');
    later.type = 'button'; later.addEventListener('click', () => { localStorage.setItem(backupDismissKey, '1'); reminder.remove(); });
    remindActions.append(backupNow, later); reminder.append(remindActions); data.append(reminder);
  }
  data.append(exportButton, importLabel, deleteButton, node('p', 'caption', '导入仅支持经过校验的备份文件；冲突内容保留两份。建议先导出。'));
  main.append(await installStorageSettings(), data);
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
    case 'growth': return growthPage();
    case 'review': return weeklyReviewPage(route.date ?? localDate());
    case 'system': return systemPage();
  }
}

async function refreshWidgetSnapshot(): Promise<void> {
  const date = localDate();
  const [profile, quests, ledger, state] = await Promise.all([db.getProfile(), db.listQuests(date), db.listXpLedger(), db.resolvedStateAtOrBefore(date)]);
  const lowest = Object.values(state).filter((item) => item && !observationIsStale(item, date)).sort((a, b) => a.value - b.value)[0];
  const hour = new Date().getHours();
  const companionState = lowest && lowest.value < 45 ? '恢复' : quests.some((quest) => quest.type === 'main' && quest.status === 'pending') ? '指导' : hour >= 22 || hour < 6 ? '休息' : '陪伴';
  saveWidgetSnapshot(buildWidgetSnapshot({ profile: profile ?? null, quests, ledger, localDate: date, generatedAt: new Date().toISOString(), companionState, reduceMotion: settings.reduceMotion }));
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
  card.append(node('p', '', errorMessage(error)), node('p', 'muted', '没有进行写入。请先关闭其他页面后重试；如需修复可用备份重建。'));
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
        '用备份重建本地数据库？',
        `备份包含 ${backup.data.entries.length} 条记录。继续后会删除目前无法打开的本地数据库，再从这份备份重建；此操作无法撤销。`,
        '确认重建',
        true,
      );
      if (!confirmed) return;
      file.disabled = true;
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
  card.append(actions, node('p', 'danger-copy', '只有在确认当前数据库无法恢复时，才使用备份重建。'));
  main.append(card);
  root.replaceChildren(main);
}

async function applyPendingWidgetAction(): Promise<string | null> {
  const widgetAction = consumeWidgetAction();
  if (!widgetAction) return null;
  if (widgetAction.type === 'open') {
    history.replaceState(null, '', `#/${widgetAction.route}`);
    if (widgetAction.route === 'tasks' && widgetAction.questId) focusAfterRenderSelector = `[data-quest-id="${CSS.escape(widgetAction.questId)}"]`;
    return '';
  }
  const quest = (await db.listQuests()).find((item) => item.id === widgetAction.questId);
  let notice = '这项任务已经处理过，没有重复结算经验。';
  if (quest?.status === 'pending') {
    await db.feedbackQuest(quest.id, 'completed', '由桌面伙伴勾选完成', '', quest.difficulty, 0, localDate());
    const progression = await createGoalFollowUp(quest, 'completed');
    notice = goalProgressMessage(progression, 'completed', '已从桌面伙伴完成任务；经验已结算，可在任务板撤销。');
    sessionStorage.setItem('qiguang.character-celebration', quest.id);
  }
  history.replaceState(null, '', '#/tasks');
  return notice;
}

async function refreshFromWidgetAction(): Promise<void> {
  try {
    const notice = await applyPendingWidgetAction();
    if (notice === null) return;
    currentRoute = parseRoute();
    previousRouteKey = routeKey(currentRoute);
    await render();
    if (notice) showToast(notice);
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
    if (widgetNotice) showToast(widgetNotice);
    if (!settings.onboardingSeen) showOnboarding();
  } catch (error) {
    renderDatabaseFailure(error);
  }
}

window.addEventListener('qiguang-widget-action', () => { void refreshFromWidgetAction(); });

window.addEventListener('hashchange', () => {
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

