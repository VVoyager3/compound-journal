import {
  DEFAULT_AREA_NAMES,
  DEFAULT_WEEKLY_REVIEW_SCOPE,
  DIMENSIONS,
  ROOT_ASSETS,
  type Area,
  type AreaMode,
  type AnalysisJob,
  type AppSettings,
  type BackupBundle,
  type BackupData,
  type DailyAnalysis,
  type DayCaption,
  type Dimension,
  type Goal,
  type GoalRole,
  type GrowthBranch,
  type Habit,
  type HabitLog,
  type JournalEvent,
  type JournalEntry,
  type JournalRevision,
  type Milestone,
  type Profile,
  type Quest,
  type QuestFeedback,
  type QuestSystemRetiredReason,
  type Review,
  type ResolvedDimensionState,
  type StateSnapshot,
  type StateObservation,
  type SystemMemory,
  type XpLedger,
  isLocalDate,
  localDate,
  nowIso,
  parseLocalDate,
  shiftDate,
  validateBody,
} from './model.ts';
import {
  ANALYSIS_CONTRACT_VERSION,
  parseDailyAnalysisRequest,
  parseDailyAnalysisResponse,
  parseWeeklyReviewRequest,
  parseWeeklyReviewResponse,
  type AnalysisErrorCode,
  type DailyAnalysisRequest,
  type DailyAnalysisResponse,
  type QuestSuggestion,
  type WeeklyReviewRequest,
  type WeeklyReviewResponse,
} from './analysis-contract.ts';
import { DIFFICULTY_XP, canAddQuest, habitMomentum, levelFromXp, questXp, resolveStateTimeline, totalXp, type Difficulty, type FeedbackResult, type QuestType } from './rules.ts';

export const DB_NAME = 'qiguang';
export const DB_VERSION = 6;
export const BACKUP_FORMAT_VERSION = 5;
export const APP_VERSION = '0.6.18';
export const LEGACY_SUCCESS_PROMPT = '今天做成或推进了什么？哪怕很小：';
const MAX_ACTION_ID_LENGTH = 180;

interface LegacyJournalMigrationPlan {
  body: string;
  kind: NonNullable<JournalEntry['kind']>;
  /** Present only when one old mixed entry must be split without losing either intent. */
  derivedSuccessBody?: string;
  legacyPromptDetected: boolean;
}

function trimBlankEdges(lines: string[]): string[] {
  const retained = [...lines];
  while (retained[0]?.trim() === '') retained.shift();
  while (retained.at(-1)?.trim() === '') retained.pop();
  return retained;
}

function legacyJournalMigrationPlan(body: string, kind?: JournalEntry['kind']): LegacyJournalMigrationPlan {
  if (kind !== undefined) return { body, kind, legacyPromptDetected: false };
  const lines = body.split(/\r?\n/);
  const journalLines: string[] = [];
  const cleanedLines: string[] = [];
  const successAnswers: string[] = [];
  let found = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const candidate = line.trimStart();
    if (!candidate.startsWith(LEGACY_SUCCESS_PROMPT)) {
      journalLines.push(line);
      cleanedLines.push(line);
      continue;
    }
    found = true;
    while (journalLines.at(-1)?.trim() === '') journalLines.pop();
    while (cleanedLines.at(-1)?.trim() === '') cleanedLines.pop();
    const inlineAnswer = candidate.slice(LEGACY_SUCCESS_PROMPT.length).trim();
    if (inlineAnswer) {
      successAnswers.push(inlineAnswer);
      cleanedLines.push(inlineAnswer);
    } else {
      const nextLine = lines[index + 1];
      if (nextLine !== undefined && nextLine.trim()) {
        const answer = nextLine.trim();
        successAnswers.push(answer);
        cleanedLines.push(answer);
        index += 1;
      }
    }
    while (lines[index + 1]?.trim() === '') index += 1;
  }
  if (!found) return { body, kind: 'journal', legacyPromptDetected: false };
  const journalBody = trimBlankEdges(journalLines).join('\n');
  const cleanedBody = trimBlankEdges(cleanedLines).join('\n');
  const successBody = successAnswers.join('\n').trim();
  if (!successBody) return { body: journalBody, kind: 'journal', legacyPromptDetected: true };
  if (!journalBody) return { body: successBody, kind: 'success', legacyPromptDetected: true };
  return { body: journalBody, kind: 'journal', derivedSuccessBody: successBody, legacyPromptDetected: true };
}

/**
 * Shared by IndexedDB, backup and local-draft migrations. Explicit kinds are never inferred again.
 * A draft cannot hold two entries, so mixed legacy text stays one lossless journal draft; persisted
 * records use the richer migration plan above and split the success answer into its own entry.
 */
export function migrateLegacyJournalContent(
  body: string,
  kind?: JournalEntry['kind'],
): { body: string; kind: NonNullable<JournalEntry['kind']> } {
  const plan = legacyJournalMigrationPlan(body, kind);
  if (!plan.derivedSuccessBody) return { body: plan.body, kind: plan.kind };
  const lines = body.split(/\r?\n/);
  const cleaned: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const candidate = (lines[index] as string).trimStart();
    if (!candidate.startsWith(LEGACY_SUCCESS_PROMPT)) {
      cleaned.push(lines[index] as string);
      continue;
    }
    while (cleaned.at(-1)?.trim() === '') cleaned.pop();
    const inlineAnswer = candidate.slice(LEGACY_SUCCESS_PROMPT.length).trim();
    if (inlineAnswer) cleaned.push(inlineAnswer);
    else if (lines[index + 1]?.trim()) {
      cleaned.push((lines[index + 1] as string).trim());
      index += 1;
    }
    while (lines[index + 1]?.trim() === '') index += 1;
  }
  return { body: trimBlankEdges(cleaned).join('\n'), kind: 'journal' };
}

const STORE_NAMES = [
  'profile',
  'areas',
  'entries',
  'dayCaptions',
  'revisions',
  'analyses',
  'events',
  'observations',
  'snapshots',
  'goals',
  'milestones',
  'quests',
  'questFeedback',
  'habits',
  'habitLogs',
  'branches',
  'xpLedger',
  'reviews',
  'memories',
  'analysisJobs',
  'settings',
] as const;
type StoreName = (typeof STORE_NAMES)[number];

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('数据库请求失败。')), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('数据库事务已取消。')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('数据库事务失败。')), { once: true });
  });
}

function openRawDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(name, DB_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      const database = request.result;
      const migrationTimestamp = nowIso();
      if (!database.objectStoreNames.contains('entries')) {
        const store = database.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('byLocalDateCreatedAt', ['localDate', 'createdAt']);
        store.createIndex('byUpdatedAt', 'updatedAt');
      } else if ((event as IDBVersionChangeEvent).oldVersion < 5) {
        const store = request.transaction?.objectStore('entries');
        store?.openCursor().addEventListener('success', (cursorEvent) => {
          const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          const original = cursor.value as JournalEntry;
          let value = original;
          if ((event as IDBVersionChangeEvent).oldVersion < 4 && value.analysisStatus === undefined) value = { ...value, analysisStatus: 'not-submitted' };
          const migration = legacyJournalMigrationPlan(value.body, value.kind);
          void (async () => {
            if (!migration.legacyPromptDetected) {
              if (original.analysisStatus !== value.analysisStatus || value.kind === undefined) {
                await requestResult(cursor.update({ ...value, kind: migration.kind }));
              }
              cursor.continue();
              return;
            }

            let originalBody = migration.body;
            if (migration.derivedSuccessBody) {
              const derivedId = `${value.id}:legacy-success`;
              const existing = await requestResult(store.get(derivedId)) as JournalEntry | undefined;
              if (!existing) {
                const derived: JournalEntry = {
                  ...value,
                  id: derivedId,
                  body: migration.derivedSuccessBody,
                  kind: 'success',
                  analysisStatus: 'not-submitted',
                  createdAt: value.createdAt,
                  updatedAt: migrationTimestamp,
                  version: 1,
                };
                await requestResult(store.add(derived));
              } else if (existing.kind !== 'success' || existing.localDate !== value.localDate || existing.body !== migration.derivedSuccessBody) {
                originalBody = [originalBody, migration.derivedSuccessBody].filter(Boolean).join('\n');
              }
            }
            if (!originalBody.trim()) {
              await requestResult(cursor.delete());
              const revisionStore = request.transaction!.objectStore('revisions');
              const revisionKeys = await requestResult(revisionStore.index('byEntryId').getAllKeys(value.id));
              await Promise.all(revisionKeys.map((key) => requestResult(revisionStore.delete(key))));
            } else {
              await requestResult(cursor.update({
                ...value,
                body: originalBody,
                kind: migration.kind,
                analysisStatus: 'not-submitted',
                updatedAt: migrationTimestamp,
                version: value.version + 1,
              }));
            }
            await invalidateAnalysisForEntry(request.transaction!, value.id, migrationTimestamp);
            cursor.continue();
          })().catch(() => request.transaction?.abort());
        });
      }
      if (!database.objectStoreNames.contains('dayCaptions')) {
        database.createObjectStore('dayCaptions', { keyPath: 'id' }).createIndex('byLocalDate', 'localDate', { unique: true });
      }
      if (!database.objectStoreNames.contains('revisions')) {
        const store = database.createObjectStore('revisions', { keyPath: 'id' });
        store.createIndex('byEntryId', 'entryId');
        store.createIndex('byEntryVersion', ['entryId', 'fromVersion'], { unique: true });
      } else if ((event as IDBVersionChangeEvent).oldVersion < 5) {
        const store = request.transaction?.objectStore('revisions');
        store?.openCursor().addEventListener('success', (cursorEvent) => {
          const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          const value = cursor.value as JournalRevision;
          const plan = legacyJournalMigrationPlan(value.previousBody, value.previousKind);
          const migrated = migrateLegacyJournalContent(value.previousBody, value.previousKind);
          if (plan.legacyPromptDetected) {
            cursor.update({
              ...value,
              previousBody: migrated.body,
              previousKind: migrated.kind,
              updatedAt: migrationTimestamp,
              version: value.version + 1,
            });
          } else if (value.previousKind === undefined) {
            cursor.update({ ...value, previousKind: 'journal' });
          }
          cursor.continue();
        });
      }
      if (!database.objectStoreNames.contains('observations')) {
        const store = database.createObjectStore('observations', { keyPath: 'id' });
        store.createIndex('byDateDimension', ['localDate', 'dimension']);
        store.createIndex('byAssessmentDimension', ['assessmentId', 'dimension'], { unique: true });
        store.createIndex('byEvidenceId', 'evidenceId');
      } else {
        const store = request.transaction?.objectStore('observations');
        if (store && !store.indexNames.contains('byEvidenceId')) store.createIndex('byEvidenceId', 'evidenceId');
        if (store && (event as IDBVersionChangeEvent).oldVersion < 3) {
          store.openCursor().addEventListener('success', (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cursor) return;
            if (cursor.value.active === undefined) cursor.update({ ...cursor.value, active: true });
            cursor.continue();
          });
        }
      }
      if (!database.objectStoreNames.contains('analyses')) {
        const store = database.createObjectStore('analyses', { keyPath: 'id' });
        store.createIndex('byLocalDate', 'localDate');
        store.createIndex('byStatus', 'status');
        store.createIndex('byRequestId', 'requestId', { unique: true });
      }
      if (!database.objectStoreNames.contains('events')) {
        const store = database.createObjectStore('events', { keyPath: 'id' });
        store.createIndex('byLocalDate', 'localDate');
        store.createIndex('byEntryId', 'sourceEntryIds', { multiEntry: true });
        store.createIndex('byAnalysisId', 'analysisId');
        store.createIndex('byConfirmation', 'confirmation');
      }
      if (!database.objectStoreNames.contains('snapshots')) {
        database.createObjectStore('snapshots', { keyPath: 'id' }).createIndex('byLocalDate', 'localDate', { unique: true });
      }
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'id' });
      } else if ((event as IDBVersionChangeEvent).oldVersion < 4) {
        const store = request.transaction?.objectStore('settings');
        store?.openCursor().addEventListener('success', (cursorEvent) => {
          const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          cursor.update({ ...cursor.value, aiAllowed: cursor.value.aiAllowed === true, previewBeforeSend: cursor.value.previewBeforeSend !== false });
          cursor.continue();
        });
      }
      if (!database.objectStoreNames.contains('profile')) {
        database.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('areas')) {
        const store = database.createObjectStore('areas', { keyPath: 'id' });
        store.createIndex('byMode', 'mode');
        store.createIndex('byOrder', 'order');
      }
      if (!database.objectStoreNames.contains('goals')) {
        const store = database.createObjectStore('goals', { keyPath: 'id' });
        store.createIndex('byStatus', 'status');
        store.createIndex('byRole', 'role');
      } else if ((event as IDBVersionChangeEvent).oldVersion < 5) {
        const store = request.transaction?.objectStore('goals');
        store?.openCursor().addEventListener('success', (cursorEvent) => {
          const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          if (cursor.value.status === 'completed' && (cursor.value.completedAt === undefined || cursor.value.completedDate === undefined)) {
            const completedAt = cursor.value.completedAt ?? cursor.value.updatedAt;
            cursor.update({ ...cursor.value, completedAt, completedDate: cursor.value.completedDate ?? localDateInTimeZone(completedAt) });
          }
          cursor.continue();
        });
      }
      if (!database.objectStoreNames.contains('milestones')) {
        const store = database.createObjectStore('milestones', { keyPath: 'id' });
        store.createIndex('byGoalId', 'goalId');
        store.createIndex('byStatus', 'status');
      }
      if (!database.objectStoreNames.contains('quests')) {
        const store = database.createObjectStore('quests', { keyPath: 'id' });
        store.createIndex('byLocalDate', 'localDate');
        store.createIndex('byStatus', 'status');
        store.createIndex('bySourceId', 'sourceId');
      }
      if (!database.objectStoreNames.contains('questFeedback')) {
        database.createObjectStore('questFeedback', { keyPath: 'id' }).createIndex('byQuestId', 'questId');
      }
      if (!database.objectStoreNames.contains('habits')) {
        database.createObjectStore('habits', { keyPath: 'id' }).createIndex('byStatus', 'status');
      }
      if (!database.objectStoreNames.contains('habitLogs')) {
        database.createObjectStore('habitLogs', { keyPath: 'id' }).createIndex('byHabitDate', ['habitId', 'localDate'], { unique: true });
      }
      if (!database.objectStoreNames.contains('branches')) {
        database.createObjectStore('branches', { keyPath: 'id' }).createIndex('byParentId', 'parentId');
      }
      if (!database.objectStoreNames.contains('xpLedger')) {
        const store = database.createObjectStore('xpLedger', { keyPath: 'id' });
        store.createIndex('bySettlementKey', 'settlementKey', { unique: true });
        store.createIndex('byBranchId', 'branchId');
        store.createIndex('byLocalDate', 'localDate');
      }
      if (!database.objectStoreNames.contains('reviews')) {
        const store = database.createObjectStore('reviews', { keyPath: 'id' });
        store.createIndex('byPeriodStart', 'periodStart');
        store.createIndex('byType', 'type');
      }
      if (!database.objectStoreNames.contains('memories')) {
        const store = database.createObjectStore('memories', { keyPath: 'id' });
        store.createIndex('byStatus', 'status');
        store.createIndex('byType', 'type');
      }
      if (!database.objectStoreNames.contains('analysisJobs')) {
        const store = database.createObjectStore('analysisJobs', { keyPath: 'id' });
        store.createIndex('byStatus', 'status');
        store.createIndex('byNextAttemptAt', 'nextAttemptAt');
        store.createIndex('byRequestId', 'requestId', { unique: true });
        store.createIndex('byLocalDate', 'localDate');
      }
    });
    request.addEventListener('blocked', () => {
      if (settled) return;
      settled = true;
      reject(new Error('数据库被其他页面占用，请关闭其他栖光页面后重试。'));
    }, { once: true });
    request.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error('无法打开本地数据库。'));
    }, { once: true });
    request.addEventListener('success', () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.addEventListener('versionchange', () => database.close());
      resolve(database);
    }, { once: true });
  });
}

function deleteRawDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', () => resolve(), { once: true });
    // `blocked` is a waiting state: rejecting would lie while the same request can still delete later.
    request.addEventListener('error', () => reject(request.error ?? new Error('无法删除本地数据库。')), { once: true });
  });
}

function cursorDelete(request: IDBRequest<IDBCursorWithValue | null>): Promise<void> {
  return new Promise((resolve, reject) => {
    request.addEventListener('error', () => reject(request.error ?? new Error('删除关联记录失败。')), { once: true });
    request.addEventListener('success', () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    });
  });
}

function assertInteger(value: unknown, min: number, max: number, field: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${field} 无效。`);
  }
}

function assertText(value: unknown, field: string, max = 12_000, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`${field} 无效。`);
}

function assertOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${field} 无效。`);
}

const WEEKLY_REVIEW_SOURCE_STORES = [
  'events', 'quests', 'questFeedback', 'habits', 'habitLogs', 'branches', 'xpLedger',
  'goals', 'reviews', 'memories', 'observations',
] as const satisfies readonly StoreName[];

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameVersionSet(
  records: Array<{ id: string; version: number }>,
  expected: Array<{ id: string; version: number }>,
): boolean {
  const current = new Map(records.map((item) => [item.id, item.version]));
  return current.size === expected.length && expected.every((item) => current.get(item.id) === item.version);
}

function sameStateValues(
  left: Record<string, number | undefined>,
  right: Record<string, number | undefined>,
): boolean {
  return ['energy', 'mental', 'connection', 'progress', 'play'].every((key) => left[key] === right[key]);
}

function localDateInTimeZone(timestamp: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function habitMomentumAt(habit: Habit, logs: HabitLog[], throughDate: string): number {
  const byDate = new Map(logs.filter((item) => item.habitId === habit.id).map((item) => [item.localDate, item.result]));
  const values: Array<{ localDate: string; result: FeedbackResult | 'pending' }> = [];
  const history = habitScheduleHistory(habit);
  let cursor = throughDate;
  for (let index = history.length - 1; index >= 0 && values.length < 7; index -= 1) {
    const period = history[index];
    if (!period || cursor < period.effectiveFrom) continue;
    const next = history[index + 1];
    const periodEnd = next ? shiftDate(next.effectiveFrom, -1) : throughDate;
    let date = cursor < periodEnd ? cursor : periodEnd;
    if (period.trackingEnabled) {
      while (date >= period.effectiveFrom && values.length < 7) {
        const weekday = parseLocalDate(date).getDay() || 7;
        if (period.scheduleDays.includes(weekday)) {
          const result = byDate.get(date) ?? 'pending';
          if (result !== 'exempt') values.push({ localDate: date, result });
        }
        date = shiftDate(date, -1);
      }
    }
    cursor = shiftDate(period.effectiveFrom, -1);
  }
  return habitMomentum(values);
}

async function weeklyReviewSourcesCurrent(transaction: IDBTransaction, request: WeeklyReviewRequest): Promise<boolean> {
  const currentEvents = await Promise.all(request.context.events.map((source) => requestResult(
    transaction.objectStore('events').get(source.eventId),
  ) as Promise<JournalEvent | undefined>));
  if (currentEvents.some((event, index) => !event || !event.active || event.confirmation !== 'confirmed'
    || event.version !== request.context.events[index]?.version)) return false;
  const versions = request.context.sourceVersions;
  if (!versions) return false;

  const stores = {
    quests: 'quests', questFeedback: 'questFeedback', habits: 'habits', habitLogs: 'habitLogs', branches: 'branches',
    xpLedger: 'xpLedger', goals: 'goals', reviews: 'reviews', memories: 'memories', stateObservations: 'observations',
  } as const;
  const current = {} as Record<keyof typeof stores, Array<{ id: string; version: number }>>;
  for (const key of Object.keys(stores) as Array<keyof typeof stores>) {
    const sourceVersions = versions[key];
    const values = await Promise.all(sourceVersions.map((source) => requestResult(
      transaction.objectStore(stores[key]).get(source.id),
    ) as Promise<{ id: string; version: number } | undefined>));
    if (values.some((value, index) => !value || value.version !== sourceVersions[index]?.version)) return false;
    current[key] = values as Array<{ id: string; version: number }>;
  }

  const [allQuests, allFeedback, allHabits, allHabitLogs, allBranches, allLedger, allGoals, allReviews, allMemories, allObservations] = await Promise.all([
    requestResult(transaction.objectStore('quests').getAll()) as Promise<Quest[]>,
    requestResult(transaction.objectStore('questFeedback').getAll()) as Promise<QuestFeedback[]>,
    requestResult(transaction.objectStore('habits').getAll()) as Promise<Habit[]>,
    requestResult(transaction.objectStore('habitLogs').getAll()) as Promise<HabitLog[]>,
    requestResult(transaction.objectStore('branches').getAll()) as Promise<GrowthBranch[]>,
    requestResult(transaction.objectStore('xpLedger').getAll()) as Promise<XpLedger[]>,
    requestResult(transaction.objectStore('goals').getAll()) as Promise<Goal[]>,
    requestResult(transaction.objectStore('reviews').getAll()) as Promise<Review[]>,
    requestResult(transaction.objectStore('memories').getAll()) as Promise<SystemMemory[]>,
    requestResult(transaction.objectStore('observations').getAll()) as Promise<StateObservation[]>,
  ]);
  const periodEndExclusive = Date.parse(`${shiftDate(request.period.end, 1)}T00:00:00Z`);
  const existedByPeriodEnd = (timestamp: string): boolean => Date.parse(timestamp) < periodEndExclusive;

  if (request.permissions.includeTaskResults) {
    const activeFeedback = [...allFeedback].filter((item) => !item.undoneAt)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const activeByQuest = new Map<string, QuestFeedback>();
    activeFeedback.forEach((item) => { if (!activeByQuest.has(item.questId)) activeByQuest.set(item.questId, item); });
    const eligibleQuests = allQuests.filter((quest) => {
      const item = activeByQuest.get(quest.id);
      const resultDate = item?.completedDate ?? quest.localDate;
      return Boolean(item) && quest.status !== 'pending' && resultDate >= request.period.start && resultDate <= request.period.end;
    });
    const eligibleFeedback = eligibleQuests.map((quest) => activeByQuest.get(quest.id) as QuestFeedback);
    if (!sameVersionSet(eligibleQuests, versions.quests) || !sameVersionSet(eligibleFeedback, versions.questFeedback)) return false;
  }
  if (request.permissions.includeHabits) {
    const eligibleHabits = allHabits.filter((item) => item.status === 'active' && existedByPeriodEnd(item.createdAt))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const eligibleHabitIds = new Set(eligibleHabits.map((item) => item.id));
    const eligibleLogs = allHabitLogs.filter((item) => eligibleHabitIds.has(item.habitId) && item.localDate <= request.period.end);
    if (!sameVersionSet(eligibleHabits, versions.habits) || !sameVersionSet(eligibleLogs, versions.habitLogs)) return false;
  }
  if (request.permissions.includeGrowth) {
    const eligibleLedger = allLedger.filter((item) => !item.reversedAt && item.localDate >= request.period.start && item.localDate <= request.period.end);
    const branchIds = new Set(eligibleLedger.map((item) => item.branchId));
    const eligibleBranches = allBranches.filter((item) => branchIds.has(item.id));
    if (!sameVersionSet(eligibleBranches, versions.branches) || !sameVersionSet(eligibleLedger, versions.xpLedger)) return false;
  }
  if (request.permissions.includeGoals) {
    const roleOrder: Record<GoalRole, number> = { main: 0, secondary: 1, wishlist: 2 };
    const eligibleGoals = allGoals.filter((item) => item.status === 'active' && ['main', 'secondary'].includes(item.role) && existedByPeriodEnd(item.createdAt))
      .sort((left, right) => roleOrder[left.role] - roleOrder[right.role] || right.updatedAt.localeCompare(left.updatedAt)).slice(0, 3);
    if (!sameVersionSet(eligibleGoals, versions.goals)) return false;
  }
  if (request.permissions.includeExperiments) {
    const eligibleReviews = allReviews.filter((item) => item.type === 'weekly' && item.status === 'confirmed'
      && item.periodEnd <= request.period.end && item.nextExperiment.endDate >= request.period.start)
      .sort((left, right) => right.periodEnd.localeCompare(left.periodEnd) || right.createdAt.localeCompare(left.createdAt)).slice(0, 4);
    if (!sameVersionSet(eligibleReviews, versions.reviews)) return false;
  }
  const selectedMemoryIds = new Set(request.permissions.memoryIds);
  const eligibleMemories = allMemories.filter((item) => selectedMemoryIds.has(item.id) && item.status === 'confirmed' && !item.reminderMuted
    && existedByPeriodEnd(item.confirmedAt ?? item.createdAt));
  if (!sameVersionSet(eligibleMemories, versions.memories)) return false;

  const quests = current.quests as Quest[];
  const feedback = current.questFeedback as QuestFeedback[];
  const feedbackByQuest = new Map(feedback.filter((item) => !item.undoneAt).map((item) => [item.questId, item]));
  if (feedbackByQuest.size !== request.context.taskResults.length || feedback.some((item) => item.undoneAt)) return false;
  if (request.context.taskResults.some((result) => {
    const quest = quests.find((item) => item.id === result.questId);
    const item = feedbackByQuest.get(result.questId);
    return !quest || !item || quest.status !== result.result || item.result !== result.result
      || quest.title !== result.title || item.actual !== result.actual
      || (item.completedDate ?? quest.localDate) !== result.localDate;
  })) return false;

  const habits = current.habits as Habit[];
  if (request.context.habits.some((summary) => {
    const habit = habits.find((item) => item.id === summary.habitId);
    return !habit || habit.name !== summary.name || habit.minimumAction !== summary.minimumAction
      || habitMomentumAt(habit, allHabitLogs, request.period.end) !== summary.momentum;
  })) return false;
  if ((current.habitLogs as HabitLog[]).some((log) => !habits.some((habit) => habit.id === log.habitId))) return false;

  const branches = current.branches as GrowthBranch[];
  if (request.context.growth.some((summary) => {
    const branch = branches.find((item) => item.id === summary.branchId);
    const xp = allLedger.filter((item) => item.branchId === summary.branchId && !item.reversedAt
      && item.localDate >= request.period.start && item.localDate <= request.period.end)
      .reduce((sum, item) => sum + item.finalXp, 0);
    return !branch || branch.name !== summary.name || xp !== summary.xp;
  })) return false;
  if ((current.xpLedger as XpLedger[]).some((item) => item.reversedAt || item.localDate < request.period.start
    || item.localDate > request.period.end || !branches.some((branch) => branch.id === item.branchId))) return false;

  const goals = current.goals as Goal[];
  if (request.context.goals.some((summary) => {
    const goal = goals.find((item) => item.id === summary.goalId);
    return !goal || goal.status !== 'active' || goal.result !== summary.result || goal.role !== summary.role;
  })) return false;
  const reviews = current.reviews as Review[];
  if (request.context.experiments.some((summary) => {
    const review = reviews.find((item) => item.id === summary.reviewId);
    const { reviewId: _reviewId, ...experiment } = summary;
    return !review || review.status !== 'confirmed' || !sameJson(review.nextExperiment, experiment);
  })) return false;
  const memories = current.memories as SystemMemory[];
  if (request.context.memories.some((summary) => {
    const memory = memories.find((item) => item.id === summary.memoryId);
    return !memory || memory.status !== 'confirmed' || memory.reminderMuted === true
      || memory.type !== summary.type || memory.statement !== summary.statement;
  })) return false;

  for (const snapshot of request.context.stateSnapshots) {
    const resolved = resolveStateTimeline(allObservations, snapshot.localDate);
    const values = Object.fromEntries(resolved.map((item) => [item.dimension === 'mind' ? 'mental' : item.dimension, item.value]));
    if (!sameStateValues(values, snapshot.values)) return false;
  }
  const usedObservationIds = new Set(request.context.stateSnapshots.flatMap((snapshot) => resolveStateTimeline(allObservations, snapshot.localDate)
    .flatMap((item) => item.observationIds)));
  const eligibleObservations = allObservations.filter((item) => usedObservationIds.has(item.id));
  if (!sameVersionSet(eligibleObservations, versions.stateObservations)) return false;
  return true;
}

function abortTransaction(transaction: IDBTransaction): void {
  try { transaction.abort(); } catch { /* already completed or aborted */ }
}

function validateActionId(value: string): string {
  assertText(value, '现实行动 ID', MAX_ACTION_ID_LENGTH);
  return value;
}

function systemRetireQuest(quest: Quest, reason: QuestSystemRetiredReason, timestamp: string): Quest {
  return {
    ...quest,
    status: 'exempt',
    systemRetiredAt: timestamp,
    systemRetiredReason: reason,
    updatedAt: timestamp,
    version: quest.version + 1,
  };
}

function restoreSystemRetiredQuest(quest: Quest, patch: Partial<Quest>): Quest {
  const { systemRetiredAt: _retiredAt, systemRetiredReason: _retiredReason, ...active } = quest;
  return { ...active, ...patch } as Quest;
}

export interface GoalProgressionResult {
  followUp: Quest | null;
  milestoneCompleted: Milestone | null;
  goalReady: boolean;
}

export interface QuestFeedbackProgressionResult extends GoalProgressionResult {
  feedback: QuestFeedback;
}

type HabitScheduleHistory = NonNullable<Habit['scheduleHistory']>;

function habitScheduleHistory(habit: Habit): HabitScheduleHistory {
  if (habit.scheduleHistory?.length) return habit.scheduleHistory;
  return [{
    effectiveFrom: localDate(new Date(habit.createdAt)),
    scheduleDays: [...habit.scheduleDays],
    // Legacy records cannot reveal old pause dates, so never manufacture pending periods while inactive.
    trackingEnabled: habit.status === 'active' && habit.bonusEnabled,
  }];
}

function habitScheduleOn(habit: Habit, date: string): HabitScheduleHistory[number] | undefined {
  const history = habitScheduleHistory(habit);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const period = history[index];
    if (period && period.effectiveFrom <= date) return period;
  }
  return undefined;
}

function goalIsActionable(goal: Goal): boolean {
  return goal.status === 'active' && goal.role !== 'wishlist';
}

async function settleMilestoneXp(
  ledger: IDBObjectStore,
  milestoneId: string,
  branchId: string,
  date: string,
  timestamp: string,
): Promise<{ ledger: XpLedger; changed: boolean }> {
  const settlementKey = `${milestoneId}:1`;
  const existing = await requestResult(ledger.index('bySettlementKey').get(settlementKey)) as XpLedger | undefined;
  if (!existing) {
    const created = {
      id: crypto.randomUUID(), settlementKey, sourceType: 'milestone', sourceId: milestoneId,
      branchId, baseXp: 50, ratio: 1, finalXp: 50, difficulty: 'milestone', localDate: date,
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    } satisfies XpLedger;
    ledger.add(created);
    return { ledger: created, changed: true };
  }
  if (!existing.reversedAt && existing.branchId === branchId && existing.localDate === date) return { ledger: existing, changed: false };
  const { reversedAt: _reversedAt, ...active } = existing;
  const updated = { ...active, branchId, localDate: date, updatedAt: timestamp, version: existing.version + 1 };
  ledger.put(updated);
  return { ledger: updated, changed: true };
}

function resolveGoalNextStep(goal: Goal, quests: Quest[], milestones: Milestone[]): string {
  const milestoneById = new Map(milestones.map((item) => [item.id, item]));
  const pendingQuest = quests
    .filter((item) => item.sourceType === 'goal' && item.sourceId === goal.id
      && (item.status === 'pending' || item.systemRetiredReason === 'capacity')
      && (!item.milestoneId || milestoneById.get(item.milestoneId)?.status === 'pending'))
    .sort((left, right) => right.localDate.localeCompare(left.localDate)
      || right.createdAt.localeCompare(left.createdAt)
      || (milestoneById.get(right.milestoneId ?? '')?.order ?? -1) - (milestoneById.get(left.milestoneId ?? '')?.order ?? -1)
      || right.id.localeCompare(left.id))[0];
  const pendingMilestone = milestones
    .filter((item) => item.status === 'pending')
    .sort((left, right) => (left.order ?? -1) - (right.order ?? -1) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
  return pendingQuest?.title ?? pendingMilestone?.description.slice(0, 160) ?? goal.nextStep;
}

/** Remove only unconfirmed descendants; later confirmed actions remain facts and keep their current frontier. */
async function rollbackGoalQuestProgression(
  quest: Quest,
  nextStatus: Quest['status'],
  transaction: IDBTransaction,
  timestamp: string,
): Promise<XpLedger[]> {
  const quests = transaction.objectStore('quests');
  const milestones = transaction.objectStore('milestones');
  const ledger = transaction.objectStore('xpLedger');
  const allLedger = await requestResult(ledger.getAll()) as XpLedger[];
  if (quest.sourceType !== 'goal' || !quest.sourceId) return allLedger;
  const [goal, allQuests, goalMilestones] = await Promise.all([
    requestResult(transaction.objectStore('goals').get(quest.sourceId)) as Promise<Goal | undefined>,
    requestResult(quests.getAll()) as Promise<Quest[]>,
    requestResult(milestones.index('byGoalId').getAll(quest.sourceId)) as Promise<Milestone[]>,
  ]);
  if (!goal) return allLedger;

  const completedMilestone = goalMilestones.find((item) => item.status === 'completed' && item.completionSourceQuestId === quest.id);
  const projectedMilestones = goalMilestones.map((item) => {
    if (item.id !== completedMilestone?.id) return item;
    const updated = { ...item, status: 'pending' as const, completedAt: undefined, completionSourceQuestId: undefined, xpSettled: false, updatedAt: timestamp, version: item.version + 1 };
    milestones.put(updated);
    return updated;
  });
  if (completedMilestone) {
    allLedger.filter((item) => item.sourceType === 'milestone' && item.sourceId === completedMilestone.id && !item.reversedAt)
      .forEach((item) => ledger.put({ ...item, reversedAt: timestamp, updatedAt: timestamp, version: item.version + 1 }));
  }

  const projectedQuests = allQuests.map((item) => {
    if (item.id === quest.id) return { ...item, status: nextStatus };
    if ((item.status !== 'pending' && item.systemRetiredReason !== 'capacity') || item.predecessorQuestId !== quest.id) return item;
    const updated = systemRetireQuest(item, 'source-invalidated', timestamp);
    quests.put(updated);
    return updated;
  });
  const nextStep = resolveGoalNextStep(goal, projectedQuests, projectedMilestones);
  if (goal.nextStep !== nextStep) transaction.objectStore('goals').put({ ...goal, nextStep, updatedAt: timestamp, version: goal.version + 1 });
  return allLedger;
}

function assertTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${field} 无效。`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`${field} 无效。`);
}

function assertCommonRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 格式无效。`);
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) throw new Error(`${label} 缺少 ID。`);
  assertTimestamp(record.createdAt, `${label}创建时间`);
  assertTimestamp(record.updatedAt, `${label}更新时间`);
  assertInteger(record.version, 1, Number.MAX_SAFE_INTEGER, `${label}版本`);
  if (record.importedFromId !== undefined && (typeof record.importedFromId !== 'string' || !record.importedFromId)) {
    throw new Error(`${label}导入来源无效。`);
  }
}

function uniqueIds(items: Array<{ id: string }>, label: string): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error(`${label} 存在重复 ID。`);
}

function assertStringArray(value: unknown, label: string, maxItems = 100, maxLength = 500): asserts value is string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} 无效。`);
  value.forEach((item, index) => assertText(item, `${label}第${index + 1}项`, maxLength));
  if (new Set(value).size !== value.length) throw new Error(`${label} 存在重复项。`);
}

function reserveImportedId(originalId: string, usedIds: Set<string>): string {
  if (!usedIds.has(originalId)) {
    usedIds.add(originalId);
    return originalId;
  }
  let id = crypto.randomUUID();
  while (usedIds.has(id)) id = crypto.randomUUID();
  usedIds.add(id);
  return id;
}

async function invalidateAnalysisForEntry(transaction: IDBTransaction, entryId: string, timestamp: string): Promise<void> {
  const jobs = transaction.objectStore('analysisJobs');
  const analyses = transaction.objectStore('analyses');
  const events = transaction.objectStore('events');
  const observations = transaction.objectStore('observations');
  const memories = transaction.objectStore('memories');
  const [allJobs, allAnalyses, relatedEvents, allEvents] = await Promise.all([
    requestResult(jobs.getAll()) as Promise<AnalysisJob[]>,
    requestResult(analyses.getAll()) as Promise<DailyAnalysis[]>,
    requestResult(events.index('byEntryId').getAll(entryId)) as Promise<JournalEvent[]>,
    requestResult(events.getAll()) as Promise<JournalEvent[]>,
  ]);
  for (const job of allJobs) {
    if (job.operation !== 'daily_analysis' || !parseDailyAnalysisRequest(job.request).userInput.entries.some((entry) => entry.entryId === entryId) || job.status === 'stale') continue;
    const { errorCode: _errorCode, nextAttemptAt: _nextAttemptAt, ...withoutRetry } = job;
    jobs.put({ ...withoutRetry, status: 'stale', errorMessage: '记录版本已经改变，请重新整理。', updatedAt: timestamp, version: job.version + 1 });
  }
  for (const analysis of allAnalyses) {
    if (!analysis.sourceEntries.some((entry) => entry.entryId === entryId) || analysis.status === 'stale') continue;
    analyses.put({ ...analysis, status: 'stale', updatedAt: timestamp, version: analysis.version + 1 });
  }
  const eventIds = new Set(relatedEvents.map((item) => item.id));
  for (const item of relatedEvents) {
    if (!item.active) continue;
    events.put({ ...item, active: false, updatedAt: timestamp, version: item.version + 1 });
  }
  const allObservations = await requestResult(observations.getAll()) as StateObservation[];
  for (const observation of allObservations) {
    if (observation.active && observation.evidenceId && eventIds.has(observation.evidenceId)) {
      observations.put({ ...observation, active: false, updatedAt: timestamp, version: observation.version + 1 });
    }
  }
  const allMemories = await requestResult(memories.getAll()) as SystemMemory[];
  const eventById = new Map(allEvents.map((item) => [item.id, item]));
  relatedEvents.forEach((item) => eventById.set(item.id, { ...item, active: false }));
  for (const memory of allMemories) {
    const evidenceIds = memory.evidenceIds.filter((id) => !eventIds.has(id));
    if (evidenceIds.length === memory.evidenceIds.length) continue;
    const needsReview = memory.status === 'confirmed' && !evidenceIds.some((eventId) => {
      const event = eventById.get(eventId);
      return event?.active && event.confirmation === 'confirmed';
    });
    const { confirmedAt: _confirmedAt, ...withoutConfirmation } = memory;
    memories.put({
      ...(needsReview ? withoutConfirmation : memory),
      evidenceIds,
      status: needsReview ? 'candidate' : memory.status,
      updatedAt: timestamp,
      version: memory.version + 1,
    });
  }
  transaction.objectStore('snapshots').clear();
}

function migrateLegacyBackupJournals(data: Partial<BackupData>, timestamp: string): void {
  const migratedEntryIds = new Set<string>();
  const droppedEntryIds = new Set<string>();
  const existingEntries = data.entries as JournalEntry[];
  const existingById = new Map(existingEntries.map((entry) => [entry.id, entry]));
  const derivedEntries: JournalEntry[] = [];
  data.entries = existingEntries.flatMap((entry) => {
    if (typeof entry?.body !== 'string') return entry;
    const migration = legacyJournalMigrationPlan(entry.body, entry.kind);
    if (!migration.legacyPromptDetected) return entry.kind === undefined ? { ...entry, kind: 'journal' as const } : entry;
    migratedEntryIds.add(entry.id);
    let body = migration.body;
    if (migration.derivedSuccessBody) {
      const derivedId = `${entry.id}:legacy-success`;
      const existing = existingById.get(derivedId);
      if (!existing) {
        const derived: JournalEntry = {
          ...entry,
          id: derivedId,
          body: migration.derivedSuccessBody,
          kind: 'success',
          analysisStatus: 'not-submitted',
          createdAt: entry.createdAt,
          updatedAt: timestamp,
          version: 1,
        };
        existingById.set(derivedId, derived);
        derivedEntries.push(derived);
      } else if (existing.kind !== 'success' || existing.localDate !== entry.localDate || existing.body !== migration.derivedSuccessBody) {
        body = [body, migration.derivedSuccessBody].filter(Boolean).join('\n');
      }
    }
    if (!body.trim()) {
      droppedEntryIds.add(entry.id);
      return [];
    }
    return {
      ...entry,
      body,
      kind: migration.kind,
      analysisStatus: 'not-submitted',
      updatedAt: timestamp,
      version: typeof entry.version === 'number' ? entry.version + 1 : entry.version,
    };
  });
  (data.entries as JournalEntry[]).push(...derivedEntries);
  data.revisions = (data.revisions as JournalRevision[]).flatMap((revision) => {
    if (droppedEntryIds.has(revision.entryId)) return [];
    if (typeof revision?.previousBody !== 'string') return revision;
    const plan = legacyJournalMigrationPlan(revision.previousBody, revision.previousKind);
    const migrated = migrateLegacyJournalContent(revision.previousBody, revision.previousKind);
    if (!plan.legacyPromptDetected) return revision.previousKind === undefined ? { ...revision, previousKind: 'journal' as const } : revision;
    if (!migrated.body.trim()) return [];
    return {
      ...revision,
      previousBody: migrated.body,
      previousKind: migrated.kind,
      updatedAt: timestamp,
      version: typeof revision.version === 'number' ? revision.version + 1 : revision.version,
    };
  });
  if (!migratedEntryIds.size) return;

  data.analyses = (data.analyses as DailyAnalysis[]).map((analysis) => {
    if (analysis.status === 'stale' || !Array.isArray(analysis.sourceEntries)
      || !analysis.sourceEntries.some((source) => migratedEntryIds.has(source.entryId))) return analysis;
    return { ...analysis, status: 'stale', updatedAt: timestamp, version: analysis.version + 1 };
  });
  data.analysisJobs = (data.analysisJobs as AnalysisJob[]).map((job) => {
    if (job.operation !== 'daily_analysis' || job.status === 'stale') return job;
    let referencesMigratedEntry = false;
    try {
      referencesMigratedEntry = parseDailyAnalysisRequest(job.request).userInput.entries.some((entry) => migratedEntryIds.has(entry.entryId));
    } catch {
      return job;
    }
    if (!referencesMigratedEntry) return job;
    const { errorCode: _errorCode, nextAttemptAt: _nextAttemptAt, ...withoutRetry } = job;
    return { ...withoutRetry, status: 'stale', errorMessage: '旧版成功日记已迁移，请重新整理。', updatedAt: timestamp, version: job.version + 1 };
  });

  const invalidEventIds = new Set<string>();
  data.events = (data.events as JournalEvent[]).map((event) => {
    if (!Array.isArray(event.sourceEntryIds) || !event.sourceEntryIds.some((id) => migratedEntryIds.has(id))) return event;
    invalidEventIds.add(event.id);
    return event.active ? { ...event, active: false, updatedAt: timestamp, version: event.version + 1 } : event;
  });
  data.observations = (data.observations as StateObservation[]).map((observation) => observation.active
    && observation.evidenceId && invalidEventIds.has(observation.evidenceId)
    ? { ...observation, active: false, updatedAt: timestamp, version: observation.version + 1 }
    : observation);
  const eventById = new Map((data.events as JournalEvent[]).map((event) => [event.id, event]));
  data.memories = (data.memories as SystemMemory[]).map((memory) => {
    if (!Array.isArray(memory.evidenceIds) || !memory.evidenceIds.some((id) => invalidEventIds.has(id))) return memory;
    const evidenceIds = memory.evidenceIds.filter((id) => !invalidEventIds.has(id));
    const needsReview = memory.status === 'confirmed' && !evidenceIds.some((id) => {
      const event = eventById.get(id);
      return event?.active && event.confirmation === 'confirmed';
    });
    const { confirmedAt: _confirmedAt, ...withoutConfirmation } = memory;
    return {
      ...(needsReview ? withoutConfirmation : memory),
      evidenceIds,
      status: needsReview ? 'candidate' : memory.status,
      updatedAt: timestamp,
      version: memory.version + 1,
    };
  });
  data.snapshots = [];
}

export function parseBackup(text: string): BackupBundle {
  if (new Blob([text]).size > 5 * 1024 * 1024) throw new Error('备份文件超过 5MB。');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('备份文件不是有效 JSON。');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('备份文件结构无效。');
  const bundle = raw as Partial<BackupBundle>;
  if (bundle.format !== 'qiguang-backup') throw new Error('这不是栖光备份文件。');
  const formatVersion = (bundle as { formatVersion?: number }).formatVersion;
  if (![3, 4, BACKUP_FORMAT_VERSION].includes(formatVersion ?? -1)) throw new Error('备份版本不受支持。');
  assertTimestamp(bundle.exportedAt, '备份导出时间');
  if (typeof bundle.appVersion !== 'string' || !bundle.appVersion) throw new Error('备份应用版本无效。');
  if (!bundle.data || typeof bundle.data !== 'object') throw new Error('备份缺少数据。');

  const data = bundle.data as Partial<BackupData>;
  if (formatVersion === 3 || formatVersion === 4) data.dayCaptions = [];
  for (const key of STORE_NAMES) {
    if (!Array.isArray(data[key])) throw new Error(`备份缺少 ${key} 数据。`);
  }
  if (formatVersion === 3 && (data.reviews as Review[]).length) throw new Error('旧版复盘备份无法安全迁移。');
  migrateLegacyBackupJournals(data, nowIso());
  const backupTimeZone = (data.profile as Profile[])[0]?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  data.goals = (data.goals as Goal[]).map((goal) => {
    if (goal?.status !== 'completed') return goal;
    const completedAt = goal.completedAt ?? goal.updatedAt;
    return {
      ...goal,
      completedAt,
      completedDate: goal.completedDate ?? localDateInTimeZone(completedAt, backupTimeZone),
    };
  });

  const profile = data.profile as Profile[];
  if (profile.length > 1) throw new Error('个人资料数据无效。');
  profile.forEach((item) => {
    assertCommonRecord(item, '个人资料');
    assertText(item.userName, '用户称呼', 40, true);
    assertText(item.companionName, '生活分身称呼', 40);
    if (item.avatar !== null) assertOneOf(item.avatar, ['male', 'female'], '头像');
    assertText(item.chapterTitle, '人生章节', 80);
    if (!isLocalDate(item.chapterStartedOn)) throw new Error('章节开始日期无效。');
    assertText(item.timezone, '时区', 100);
    if (item.weekStartsOn !== 1) throw new Error('每周起始日无效。');
  });

  const areas = data.areas as Area[];
  areas.forEach((item) => {
    assertCommonRecord(item, '生活分类');
    assertText(item.name, '领域名称', 40);
    assertOneOf(item.mode, ['build', 'maintain', 'explore', 'pause'], '领域模式');
    assertInteger(item.order, 0, 10_000, '领域排序');
    if (typeof item.isDefault !== 'boolean') throw new Error('领域默认标记无效。');
  });
  uniqueIds(areas, '生活分类');
  if (areas.filter((item) => item.mode === 'build').length > 2) throw new Error('重点建设领域超过两个。');
  const areaIds = new Set(areas.map((item) => item.id));

  const branches = data.branches as GrowthBranch[];
  const assetKeys = ROOT_ASSETS.map((item) => item.key);
  branches.forEach((item) => {
    assertCommonRecord(item, '成长分支');
    assertOneOf(item.rootAsset, assetKeys, '主要提升');
    assertText(item.name, '成长分支名称', 60);
    assertInteger(item.order, 0, 10_000, '成长分支排序');
    assertOneOf(item.status, ['active', 'paused'], '成长分支状态');
    if (item.parentId !== undefined && typeof item.parentId !== 'string') throw new Error('父成长分支无效。');
  });
  uniqueIds(branches, '成长分支');
  const branchIds = new Set(branches.map((item) => item.id));
  if (branches.some((item) => item.parentId && !branchIds.has(item.parentId))) throw new Error('备份存在孤立的成长分支。');

  const entries = data.entries as JournalEntry[];
  entries.forEach((entry) => {
    assertCommonRecord(entry, '记录');
    if (!isLocalDate(entry.localDate)) throw new Error('记录日期无效。');
    validateBody(entry.body);
    if (!['text', 'import'].includes(entry.inputMethod)) throw new Error('记录输入方式无效。');
    if (entry.kind !== undefined) assertOneOf(entry.kind, ['journal', 'success'], '记录类型');
    assertOneOf(entry.analysisStatus, ['not-submitted', 'queued', 'processing', 'succeeded', 'failed'], '记录整理状态');
  });
  uniqueIds(entries, '记录');
  const entryIds = new Set(entries.map((entry) => entry.id));
  const entryVersions = new Map(entries.map((entry) => [entry.id, entry.version]));

  const dayCaptions = data.dayCaptions as DayCaption[];
  dayCaptions.forEach((item) => {
    assertCommonRecord(item, '当日一句话');
    if (!isLocalDate(item.localDate) || item.id !== `day-caption:${item.localDate}`) throw new Error('当日一句话日期无效。');
    assertText(item.text, '当日一句话', 120);
  });
  uniqueIds(dayCaptions, '当日一句话');
  if (new Set(dayCaptions.map((item) => item.localDate)).size !== dayCaptions.length) throw new Error('同一日期存在重复的当日一句话。');

  const revisions = data.revisions as JournalRevision[];
  revisions.forEach((revision) => {
    assertCommonRecord(revision, '修改版本');
    if (typeof revision.entryId !== 'string' || !entryIds.has(revision.entryId)) throw new Error('备份存在孤立的修改版本。');
    assertInteger(revision.fromVersion, 1, Number.MAX_SAFE_INTEGER, '修改版本号');
    if (revision.fromVersion >= (entryVersions.get(revision.entryId) ?? 0)) throw new Error('修改版本号超出记录版本。');
    validateBody(revision.previousBody);
    if (revision.previousKind !== undefined) assertOneOf(revision.previousKind, ['journal', 'success'], '修改前记录类型');
    if (!['user-edit', 'undo', 'import'].includes(revision.reason)) throw new Error('修改原因无效。');
    if (revision.undoneAt !== undefined) {
      assertTimestamp(revision.undoneAt, '撤销时间');
      if (revision.reason !== 'user-edit') throw new Error('撤销标记无效。');
    }
  });
  uniqueIds(revisions, '修改版本');
  if (new Set(revisions.map((item) => `${item.entryId}:${item.fromVersion}`)).size !== revisions.length) {
    throw new Error('同一记录版本出现重复修改历史。');
  }

  const analyses = data.analyses as DailyAnalysis[];
  analyses.forEach((item) => {
    assertCommonRecord(item, '每日整理');
    if (!isLocalDate(item.localDate) || item.contractVersion !== ANALYSIS_CONTRACT_VERSION || item.modelOutputVersion !== ANALYSIS_CONTRACT_VERSION) throw new Error('每日整理版本或日期无效。');
    assertText(item.requestId, '整理请求 ID', 200);
    assertOneOf(item.status, ['ready', 'stale'], '每日整理状态');
    if (!Array.isArray(item.sourceEntries) || !item.sourceEntries.length || item.sourceEntries.length > 30) throw new Error('每日整理来源无效。');
    item.sourceEntries.forEach((source) => {
      if (!source || typeof source.entryId !== 'string') throw new Error('每日整理来源无效。');
      if (!entryIds.has(source.entryId) && item.status !== 'stale') throw new Error('生效中的每日整理引用了不存在的记录。');
      assertInteger(source.revision, 1, Number.MAX_SAFE_INTEGER, '每日整理记录版本');
    });
    assertText(item.contextSummary, '整理上下文摘要', 2_000, true);
    assertStringArray(item.warnings, '整理警告', 10, 200);
    assertText(item.rawResponse, '整理原始响应', 200_000);
    if (!item.result || typeof item.result !== 'object') throw new Error('每日整理结果无效。');
  });
  uniqueIds(analyses, '每日整理');
  if (new Set(analyses.map((item) => item.requestId)).size !== analyses.length) throw new Error('整理请求 ID 重复。');
  const analysisIds = new Set(analyses.map((item) => item.id));

  const events = data.events as JournalEvent[];
  events.forEach((item) => {
    assertCommonRecord(item, '整理事件');
    if (!analysisIds.has(item.analysisId) || !isLocalDate(item.localDate)) throw new Error('整理事件来源或日期无效。');
    assertText(item.candidateId, '事件候选 ID', 200);
    assertText(item.title, '事件标题', 60);
    assertText(item.description, '事件说明', 500);
    assertOneOf(item.sourceType, ['explicit', 'inferred'], '事件来源类型');
    assertOneOf(item.confirmation, ['confirmed', 'pending', 'rejected'], '事件确认状态');
    assertOneOf(item.confidence, ['high', 'medium', 'low'], '事件确定程度');
    assertStringArray(item.sourceEntryIds, '事件来源记录', 30, 200);
    if (!item.sourceEntryIds.length) throw new Error('整理事件缺少来源记录。');
    if (item.sourceEntryIds.some((id) => !entryIds.has(id)) && item.active) throw new Error('生效中的整理事件引用了不存在的记录。');
    if (!Array.isArray(item.evidence) || !item.evidence.length || !Array.isArray(item.stateImpactCandidates)) throw new Error('整理事件证据或状态候选无效。');
    if (typeof item.active !== 'boolean' || typeof item.userEdited !== 'boolean') throw new Error('整理事件状态无效。');
  });
  uniqueIds(events, '整理事件');
  if (new Set(events.map((item) => `${item.analysisId}:${item.candidateId}`)).size !== events.length) throw new Error('同一整理存在重复事件。');
  const eventIds = new Set(events.map((item) => item.id));

  const dimensionKeys = new Set(DIMENSIONS.map((item) => item.key));
  const observations = data.observations as StateObservation[];
  observations.forEach((observation) => {
    assertCommonRecord(observation, '状态自评');
    if (!isLocalDate(observation.localDate)) throw new Error('状态自评日期无效。');
    if (typeof observation.assessmentId !== 'string' || !observation.assessmentId) throw new Error('状态自评批次无效。');
    if (!dimensionKeys.has(observation.dimension)) throw new Error('状态维度无效。');
    assertOneOf(observation.kind, ['user-self-assessment', 'user-calibration', 'event-impact'], '状态来源');
    if (observation.kind === 'event-impact') {
      assertInteger(observation.delta, -15, 15, '状态变化');
      assertText(observation.evidenceId, '状态证据 ID', 200);
      assertText(observation.reason, '状态变化理由', 500);
      if (observation.value !== undefined) throw new Error('状态事件不能直接写最终值。');
    } else {
      assertInteger(observation.value, 0, 100, '状态值');
      if (observation.delta !== undefined) throw new Error('状态自评不能同时写变化量。');
    }
    if (typeof observation.active !== 'boolean') throw new Error('状态明细生效标记无效。');
    assertTimestamp(observation.observedAt, '状态自评时间');
  });
  uniqueIds(observations, '状态自评');
  if (new Set(observations.map((item) => `${item.assessmentId}:${item.dimension}`)).size !== observations.length) {
    throw new Error('同一次自评存在重复维度。');
  }

  const snapshots = data.snapshots as StateSnapshot[];
  snapshots.forEach((item) => {
    assertCommonRecord(item, '状态快照');
    if (!isLocalDate(item.localDate) || !item.values || typeof item.values !== 'object' || !item.lastEvidenceAt || typeof item.lastEvidenceAt !== 'object') throw new Error('状态快照无效。');
    for (const [dimension, value] of Object.entries(item.values)) {
      if (!dimensionKeys.has(dimension as Dimension)) throw new Error('状态快照维度无效。');
      assertInteger(value, 0, 100, '状态快照值');
    }
    for (const [dimension, timestamp] of Object.entries(item.lastEvidenceAt)) {
      if (!dimensionKeys.has(dimension as Dimension)) throw new Error('状态快照证据维度无效。');
      assertTimestamp(timestamp, '状态快照证据时间');
    }
    assertStringArray(item.observationIds, '状态快照明细 ID', 1_000, 200);
    if (item.observationIds.some((id) => !observations.some((observation) => observation.id === id))) throw new Error('状态快照引用了不存在的明细。');
  });
  uniqueIds(snapshots, '状态快照');
  if (new Set(snapshots.map((item) => item.localDate)).size !== snapshots.length) throw new Error('同一日期存在重复状态快照。');

  const goals = data.goals as Goal[];
  goals.forEach((item) => {
    assertCommonRecord(item, '目标');
    assertText(item.result, '目标结果', 160);
    assertText(item.why, '目标意义', 500, true);
    assertText(item.evidence, '目标证据', 500, true);
    assertText(item.nextStep, '目标下一步', 160);
    if (!areaIds.has(item.areaId) || !branchIds.has(item.branchId)) throw new Error('目标领域或成长分支无效。');
    assertOneOf(item.role, ['main', 'secondary', 'wishlist'], '目标角色');
    assertOneOf(item.status, ['idea', 'active', 'paused', 'completed', 'abandoned'], '目标状态');
    if (item.startDate !== undefined && !isLocalDate(item.startDate)) throw new Error('目标开始日期无效。');
    if (item.targetDate !== undefined && !isLocalDate(item.targetDate)) throw new Error('目标时间范围无效。');
    if (item.completedAt !== undefined) {
      assertTimestamp(item.completedAt, '目标完成时间');
      if (item.status !== 'completed') throw new Error('目标完成时间与状态不一致。');
    }
    if (item.completedDate !== undefined) {
      if (!isLocalDate(item.completedDate) || item.status !== 'completed') throw new Error('目标完成日期与状态不一致。');
    }
    if (item.status === 'completed' && (!item.completedAt || !item.completedDate)) throw new Error('目标完成时间不完整。');
  });
  uniqueIds(goals, '目标');
  const activeGoals = goals.filter((item) => !['completed', 'abandoned'].includes(item.status));
  if (activeGoals.filter((item) => item.role === 'main').length > 1 || activeGoals.filter((item) => item.role === 'secondary').length > 2) {
    throw new Error('当前目标角色超过上限。');
  }
  const goalIds = new Set(goals.map((item) => item.id));

  const milestones = data.milestones as Milestone[];
  milestones.forEach((item) => {
    assertCommonRecord(item, '阶段目标');
    if (!goalIds.has(item.goalId)) throw new Error('备份存在没有所属目标的阶段目标。');
    assertText(item.description, '阶段目标描述', 200);
    assertText(item.evidence, '阶段目标完成标准', 500);
    if (item.order !== undefined) assertInteger(item.order, 0, 10_000, '阶段目标顺序');
    assertOneOf(item.status, ['pending', 'completed', 'superseded'], '阶段目标状态');
    if (item.completedAt !== undefined) assertTimestamp(item.completedAt, '阶段目标完成时间');
    if (item.completionSourceQuestId !== undefined) assertText(item.completionSourceQuestId, '阶段目标完成来源', 200);
    if (typeof item.xpSettled !== 'boolean') throw new Error('阶段目标结算状态无效。');
  });
  uniqueIds(milestones, '阶段目标');
  const milestoneIds = new Set(milestones.map((item) => item.id));

  const habits = data.habits as Habit[];
  habits.forEach((item) => {
    assertCommonRecord(item, '习惯');
    assertText(item.name, '习惯名称', 60);
    assertText(item.minimumAction, '习惯最小动作', 160);
    if (item.targetCount !== undefined) {
      assertInteger(item.targetCount, 2, 1_000, '习惯目标次数');
      assertText(item.countUnit, '习惯计数单位', 20);
    } else if (item.countUnit !== undefined) throw new Error('习惯计数设置无效。');
    if (!Array.isArray(item.scheduleDays) || !item.scheduleDays.length || new Set(item.scheduleDays).size !== item.scheduleDays.length) throw new Error('习惯计划日无效。');
    item.scheduleDays.forEach((day) => assertInteger(day, 1, 7, '习惯计划日'));
    if (item.scheduleHistory !== undefined) {
      if (!Array.isArray(item.scheduleHistory) || !item.scheduleHistory.length) throw new Error('习惯计划历史无效。');
      let previousDate = '';
      item.scheduleHistory.forEach((period) => {
        if (!period || typeof period !== 'object' || !isLocalDate(period.effectiveFrom) || period.effectiveFrom <= previousDate) throw new Error('习惯计划历史无效。');
        if (!Array.isArray(period.scheduleDays) || !period.scheduleDays.length || new Set(period.scheduleDays).size !== period.scheduleDays.length) throw new Error('习惯计划历史无效。');
        period.scheduleDays.forEach((day) => assertInteger(day, 1, 7, '习惯计划历史'));
        if (typeof period.trackingEnabled !== 'boolean') throw new Error('习惯计划历史无效。');
        previousDate = period.effectiveFrom;
      });
    }
    if (item.trigger !== undefined) assertText(item.trigger, '习惯触发条件', 120);
    if (!dimensionKeys.has(item.dimension) || !branchIds.has(item.branchId)) throw new Error('习惯状态或成长分支无效。');
    assertOneOf(item.difficulty, Object.keys(DIFFICULTY_XP), '习惯难度');
    assertOneOf(item.status, ['active', 'paused', 'ended'], '习惯状态');
    if (typeof item.bonusEnabled !== 'boolean') throw new Error('每日可选任务设置无效。');
  });
  uniqueIds(habits, '习惯');
  if (habits.filter((item) => item.status === 'active' && item.bonusEnabled).length > 3) throw new Error('启用的每日可选习惯超过三个。');
  const habitIds = new Set(habits.map((item) => item.id));

  const quests = data.quests as Quest[];
  quests.forEach((item) => {
    assertCommonRecord(item, '任务');
    if (!isLocalDate(item.localDate)) throw new Error('任务日期无效。');
    assertOneOf(item.type, ['main', 'bonus', 'side'], '任务类型');
    assertOneOf(item.sourceType, ['goal', 'habit', 'recovery', 'manual'], '任务来源');
    if (item.sourceType === 'goal' && (!item.sourceId || !goalIds.has(item.sourceId))) throw new Error('目标任务来源无效。');
    if (item.sourceType === 'habit' && (!item.sourceId || !habitIds.has(item.sourceId))) throw new Error('习惯任务来源无效。');
    if (item.milestoneId !== undefined && !milestoneIds.has(item.milestoneId)) throw new Error('任务关联的阶段目标不存在。');
    if (item.milestoneId !== undefined && item.sourceType !== 'goal') throw new Error('阶段目标只能关联目标任务。');
    validateActionId(item.actionId);
    assertInteger(item.settlementVersion, 0, Number.MAX_SAFE_INTEGER, '任务结算版本');
    assertText(item.title, '任务标题', 160);
    assertText(item.reason, '任务理由', 500);
    assertText(item.minimumAction, '任务最小动作', 200);
    if (item.completionCriteria !== undefined) assertText(item.completionCriteria, '任务完成标准', 500);
    assertInteger(item.estimatedMinutes, 1, 24 * 60, '任务预计时间');
    if (item.deadlineAt !== undefined) assertTimestamp(item.deadlineAt, '任务截止时间');
    if (item.targetCount !== undefined) {
      assertInteger(item.targetCount, 2, 1_000, '任务目标次数');
      assertInteger(item.progressCount, 0, item.targetCount, '任务已打卡次数');
      assertText(item.countUnit, '任务计数单位', 20);
      if (item.status === 'pending' && item.progressCount === item.targetCount) throw new Error('待完成计数任务不能已经达到目标。');
      if (item.status === 'completed' && item.progressCount !== item.targetCount) throw new Error('已完成计数任务没有达到目标。');
    } else if (item.progressCount !== undefined || item.countUnit !== undefined) throw new Error('任务计数设置无效。');
    assertOneOf(item.difficulty, Object.keys(DIFFICULTY_XP), '任务难度');
    if (item.dimension !== undefined && !dimensionKeys.has(item.dimension)) throw new Error('任务状态维度无效。');
    if (item.branchId !== undefined && !branchIds.has(item.branchId)) throw new Error('任务成长分支无效。');
    assertOneOf(item.status, ['pending', 'completed', 'partial', 'skipped', 'exempt'], '任务状态');
    if ((item.systemRetiredAt === undefined) !== (item.systemRetiredReason === undefined)) throw new Error('任务系统收束信息不完整。');
    if (item.systemRetiredAt !== undefined) {
      assertTimestamp(item.systemRetiredAt, '任务系统收束时间');
      assertOneOf(item.systemRetiredReason, ['elapsed', 'schedule-changed', 'tracking-disabled', 'capacity', 'source-invalidated'], '任务系统收束原因');
      if (item.status !== 'exempt') throw new Error('任务系统收束状态无效。');
    }
    if (item.userRemovedAt !== undefined) {
      assertTimestamp(item.userRemovedAt, '任务删除时间');
      if (item.status !== 'exempt') throw new Error('已删除任务状态无效。');
    }
    if (typeof item.aiSuggested !== 'boolean' || typeof item.userModified !== 'boolean') throw new Error('任务权限标记无效。');
  });
  uniqueIds(quests, '任务');
  const questIds = new Set(quests.map((item) => item.id));
  quests.forEach((item) => {
    if (item.predecessorQuestId !== undefined && (!questIds.has(item.predecessorQuestId) || item.predecessorQuestId === item.id)) throw new Error('任务前序来源无效。');
  });
  const questById = new Map(quests.map((item) => [item.id, item]));
  milestones.forEach((item) => {
    if (item.completionSourceQuestId !== undefined && (item.status !== 'completed' || questById.get(item.completionSourceQuestId)?.milestoneId !== item.id)) throw new Error('阶段目标完成来源无效。');
  });
  for (const date of new Set(quests.map((item) => item.localDate))) {
    const types = quests.filter((item) => item.localDate === date && item.status === 'pending').map((item) => item.type);
    if (types.filter((item) => item === 'main').length > 1 || types.filter((item) => item === 'bonus').length > 3 || types.filter((item) => item === 'side').length > 2) throw new Error('每日任务数量超过上限。');
  }

  const feedback = data.questFeedback as QuestFeedback[];
  feedback.forEach((item) => {
    assertCommonRecord(item, '任务反馈');
    if (!questIds.has(item.questId)) throw new Error('备份存在孤立的任务反馈。');
    assertOneOf(item.result, ['completed', 'partial', 'skipped', 'exempt'], '任务反馈结果');
    assertText(item.note, '任务反馈', 2_000, true);
    assertText(item.actual, '实际完成内容', 2_000, true);
    assertInteger(item.settlementVersion, 1, Number.MAX_SAFE_INTEGER, '任务反馈结算版本');
    if (item.completedDate !== undefined && !isLocalDate(item.completedDate)) throw new Error('任务实际完成日期无效。');
    if (item.undoneAt !== undefined) assertTimestamp(item.undoneAt, '任务反馈撤销时间');
  });
  uniqueIds(feedback, '任务反馈');
  if (feedback.some((item) => !item.undoneAt && questById.get(item.questId)?.systemRetiredAt)) throw new Error('系统收束任务不能带有生效中的用户反馈。');

  const habitLogs = data.habitLogs as HabitLog[];
  habitLogs.forEach((item) => {
    assertCommonRecord(item, '习惯记录');
    if (!habitIds.has(item.habitId) || !questIds.has(item.questId) || !isLocalDate(item.localDate)) throw new Error('习惯记录引用无效。');
    assertOneOf(item.result, ['completed', 'partial', 'skipped', 'exempt'], '习惯记录结果');
    if (item.settlementKey !== undefined) assertText(item.settlementKey, '习惯结算键', 200);
  });
  uniqueIds(habitLogs, '习惯记录');
  if (new Set(habitLogs.map((item) => `${item.habitId}:${item.localDate}`)).size !== habitLogs.length) throw new Error('同一习惯日期重复。');

  const ledger = data.xpLedger as XpLedger[];
  const settlementSources = new Set([...quests.map((item) => item.actionId), ...milestoneIds]);
  ledger.forEach((item) => {
    assertCommonRecord(item, '经验账本');
    assertText(item.settlementKey, '经验结算键', 200);
    assertOneOf(item.sourceType, ['quest', 'habit', 'milestone'], '经验来源');
    if (item.sourceType === 'quest' && !questIds.has(item.sourceId)) throw new Error('任务经验来源无效。');
    if (item.sourceType === 'habit' && !habitIds.has(item.sourceId)) throw new Error('习惯经验来源无效。');
    if (item.sourceType === 'milestone' && !milestoneIds.has(item.sourceId)) throw new Error('阶段目标经验来源无效。');
    if (!branchIds.has(item.branchId) || !isLocalDate(item.localDate)) throw new Error('经验成长分支或日期无效。');
    assertInteger(item.baseXp, 1, 50, '基础经验');
    if (item.ratio !== 0.5 && item.ratio !== 1) throw new Error('经验结算比例无效。');
    assertInteger(item.finalXp, 1, 50, '最终经验');
    if (item.difficulty !== 'milestone') assertOneOf(item.difficulty, Object.keys(DIFFICULTY_XP), '经验难度');
    if (item.finalXp !== Math.ceil(item.baseXp * item.ratio)) throw new Error('经验结算结果无效。');
    const keyMatch = item.settlementKey.match(/^(.+):([1-9]\d*)$/);
    if (!keyMatch || !settlementSources.has(keyMatch[1] ?? '')) throw new Error('经验结算键与现实行动不一致。');
    if (item.reversedAt !== undefined) assertTimestamp(item.reversedAt, '经验撤销时间');
  });
  uniqueIds(ledger, '经验账本');
  if (new Set(ledger.map((item) => item.settlementKey)).size !== ledger.length) throw new Error('经验结算键重复。');

  const reviews = data.reviews as Review[];
  reviews.forEach((item) => {
    assertCommonRecord(item, '周期复盘');
    assertText(item.requestId, '周期复盘请求 ID', 200);
    assertOneOf(item.type, ['weekly', 'monthly'], '复盘类型');
    if (!isLocalDate(item.periodStart) || !isLocalDate(item.periodEnd) || item.periodStart > item.periodEnd || item.contractVersion !== ANALYSIS_CONTRACT_VERSION) throw new Error('复盘周期无效。');
    assertOneOf(item.status, ['candidate', 'confirmed', 'rejected'], '复盘确认状态');
    if (item.rejectedAt !== undefined) assertTimestamp(item.rejectedAt, '复盘拒绝时间');
    if (item.type !== 'weekly') throw new Error('当前备份版本只支持周复盘。');
    const request = parseWeeklyReviewRequest(item.request);
    if (request.requestId !== item.requestId || request.period.start !== item.periodStart || request.period.end !== item.periodEnd) throw new Error('周期复盘请求信封不一致。');
    if (!Array.isArray(item.stateTrends) || !Array.isArray(item.recurringBenefits) || !Array.isArray(item.recurringCosts) || !Array.isArray(item.growthDeposits) || !Array.isArray(item.habitDecisions)) throw new Error('复盘内容无效。');
    assertText(item.nextTheme, '下周期主题', 200);
    assertText(item.nextThemeReason, '下周期主题理由', 500);
    if (!item.nextExperiment || typeof item.nextExperiment !== 'object') throw new Error('最小实验无效。');
    assertText(item.nextExperiment.hypothesis, '实验假设', 500);
    assertText(item.nextExperiment.minimumAction, '实验最小动作', 300);
    assertText(item.nextExperiment.metric, '实验指标', 300);
    if (!isLocalDate(item.nextExperiment.endDate)) throw new Error('实验结束日期无效。');
    assertText(item.nextExperiment.stopCondition, '实验停止条件', 300);
    assertStringArray(item.warnings, '复盘警告', 10, 200);
    assertText(item.rawResponse, '复盘原始响应', 200_000);
    let raw: unknown;
    try { raw = JSON.parse(item.rawResponse); } catch { throw new Error('周期复盘原始响应不是有效 JSON。'); }
    const parsed = parseWeeklyReviewResponse(raw, request);
    const expectedStateTrends = parsed.result.stateTrends.map((trend) => ({ ...trend, dimension: trend.dimension === 'mental' ? 'mind' : trend.dimension }));
    const immutableMatches = JSON.stringify(item.stateTrends) === JSON.stringify(expectedStateTrends)
      && JSON.stringify(item.recurringBenefits) === JSON.stringify(parsed.result.recurringBenefits)
      && JSON.stringify(item.recurringCosts) === JSON.stringify(parsed.result.recurringCosts)
      && JSON.stringify(item.growthDeposits) === JSON.stringify(parsed.result.growthDeposits)
      && JSON.stringify(item.habitDecisions) === JSON.stringify(parsed.result.habitDecisions)
      && item.nextThemeReason === parsed.result.nextWeekTheme.reason
      && JSON.stringify(item.warnings) === JSON.stringify(parsed.warnings);
    const editableMatches = item.status === 'confirmed' || (
      item.nextTheme === parsed.result.nextWeekTheme.title
      && JSON.stringify(item.nextExperiment) === JSON.stringify(parsed.result.nextExperiment)
    );
    if (!immutableMatches || !editableMatches) throw new Error('周期复盘结果与原始响应不一致。');
  });
  uniqueIds(reviews, '周期复盘');
  if (new Set(reviews.map((item) => item.requestId)).size !== reviews.length) throw new Error('周期复盘请求 ID 重复。');
  const reviewIds = new Set(reviews.map((item) => item.id));

  const memories = data.memories as SystemMemory[];
  memories.forEach((item) => {
    assertCommonRecord(item, '系统记忆');
    if (item.analysisId !== undefined && !analysisIds.has(item.analysisId)) throw new Error('系统记忆整理来源无效。');
    if (item.reviewId !== undefined && !reviewIds.has(item.reviewId)) throw new Error('系统记忆复盘来源无效。');
    assertOneOf(item.type, ['preference', 'pattern', 'principle', 'strength', 'constraint'], '系统记忆类型');
    assertText(item.statement, '系统记忆内容', 500);
    assertStringArray(item.evidenceIds, '系统记忆证据', 30, 200);
    if (item.evidenceIds.some((id) => !eventIds.has(id))) throw new Error('系统记忆引用了不存在的事件。');
    assertStringArray(item.counterEvidence, '系统记忆反例', 30, 500);
    assertOneOf(item.confidence, ['high', 'medium', 'low'], '系统记忆确定程度');
    assertOneOf(item.recommendedAction, ['observe', 'review'], '系统记忆建议');
    assertOneOf(item.status, ['candidate', 'confirmed', 'forgotten'], '系统记忆状态');
    if (item.reminderMuted !== undefined && typeof item.reminderMuted !== 'boolean') throw new Error('系统记忆提醒状态无效。');
    const userAuthored = item.userEdited && !item.analysisId && !item.reviewId && item.evidenceIds.length === 0;
    if (item.status === 'confirmed' && !userAuthored && !item.evidenceIds.some((id) => events.some((event) => event.id === id && event.active && event.confirmation === 'confirmed'))) {
      throw new Error('已确认系统记忆缺少有效证据。');
    }
    if (item.confirmedAt !== undefined) assertTimestamp(item.confirmedAt, '系统记忆确认时间');
    if (item.forgottenAt !== undefined) assertTimestamp(item.forgottenAt, '系统记忆遗忘时间');
    if (typeof item.userEdited !== 'boolean') throw new Error('系统记忆编辑标记无效。');
  });
  uniqueIds(memories, '系统记忆');

  const jobs = data.analysisJobs as AnalysisJob[];
  jobs.forEach((item) => {
    assertCommonRecord(item, '整理队列');
    assertText(item.requestId, '整理队列请求 ID', 200);
    if (!['daily_analysis', 'weekly_review'].includes(item.operation) || !isLocalDate(item.localDate) || item.contractVersion !== ANALYSIS_CONTRACT_VERSION) throw new Error('整理队列操作无效。');
    assertText(item.idempotencyKey, '整理幂等键', 500);
    const request = item.operation === 'daily_analysis' ? parseDailyAnalysisRequest(item.request) : parseWeeklyReviewRequest(item.request);
    if (request.requestId !== item.requestId || (request.operation === 'daily_analysis' ? request.localDate : request.period.end) !== item.localDate) throw new Error('整理队列请求信封不一致。');
    assertOneOf(item.status, ['queued', 'processing', 'succeeded', 'failed', 'stale', 'safety-review'], '整理队列状态');
    assertInteger(item.attemptCount, 0, 100, '整理尝试次数');
    if (item.nextAttemptAt !== undefined) assertTimestamp(item.nextAttemptAt, '整理下次尝试时间');
    if (item.errorCode !== undefined) assertOneOf(item.errorCode, ['OFFLINE', 'INPUT_TOO_LARGE', 'RATE_LIMITED', 'MODEL_TIMEOUT', 'INVALID_MODEL_OUTPUT', 'UNSUPPORTED_CONTRACT', 'SAFETY_REVIEW', 'SERVICE_UNAVAILABLE'], '整理错误码');
    if (item.errorMessage !== undefined) assertText(item.errorMessage, '整理错误信息', 500, true);
    if (item.analysisId !== undefined && !analysisIds.has(item.analysisId)) throw new Error('整理队列结果引用无效。');
    if (item.reviewId !== undefined && !reviewIds.has(item.reviewId)) throw new Error('复盘队列结果引用无效。');
  });
  uniqueIds(jobs, '整理队列');
  if (new Set(jobs.map((item) => item.requestId)).size !== jobs.length) throw new Error('整理队列请求 ID 重复。');
  for (const analysis of analyses) {
    const job = jobs.find((item) => item.requestId === analysis.requestId);
    if (!job) throw new Error('每日整理缺少对应队列记录。');
    let raw: unknown;
    try { raw = JSON.parse(analysis.rawResponse); } catch { throw new Error('每日整理原始响应不是有效 JSON。'); }
    if (job.operation !== 'daily_analysis') throw new Error('每日整理对应了错误的队列操作。');
    const parsed = parseDailyAnalysisResponse(raw, parseDailyAnalysisRequest(job.request));
    if (JSON.stringify(parsed.result) !== JSON.stringify(analysis.result)) throw new Error('每日整理结果与原始响应不一致。');
  }

  const settings = data.settings as AppSettings[];
  if (settings.length > 1) throw new Error('设置数据无效。');
  settings.forEach((item) => {
    assertCommonRecord(item, '设置');
    if (item.id !== 'app' || typeof item.reduceMotion !== 'boolean' || typeof item.onboardingSeen !== 'boolean' || typeof item.aiAllowed !== 'boolean' || typeof item.previewBeforeSend !== 'boolean') {
      throw new Error('设置数据无效。');
    }
    if (item.guidanceTone === undefined) item.guidanceTone = 'gentle';
    assertOneOf(item.guidanceTone, ['gentle', 'direct'], '指导语气');
    if (item.weeklyReviewScope === undefined) item.weeklyReviewScope = { ...DEFAULT_WEEKLY_REVIEW_SCOPE };
    if (!item.weeklyReviewScope || typeof item.weeklyReviewScope !== 'object'
      || Object.keys(DEFAULT_WEEKLY_REVIEW_SCOPE).some((key) => typeof item.weeklyReviewScope[key as keyof typeof DEFAULT_WEEKLY_REVIEW_SCOPE] !== 'boolean')) {
      throw new Error('周复盘发送范围无效。');
    }
    if (item.aiModel === undefined) item.aiModel = 'MiniMax-M3';
    if (item.aiModel !== 'MiniMax-M3' && item.aiModel !== 'MiniMax-M2.7') throw new Error('设置数据无效。');
    if (item.aiApiKey !== undefined && typeof item.aiApiKey !== 'string') throw new Error('设置数据无效。');
    if (typeof item.aiApiKey === 'string' && item.aiApiKey.length > 4_096) {
      throw new Error('设置数据无效。');
    }
    delete item.aiApiKey;
  });

  return { ...bundle, formatVersion: BACKUP_FORMAT_VERSION } as BackupBundle;
}

export class QiguangDb {
  private readonly database: IDBDatabase;
  readonly name: string;

  private constructor(database: IDBDatabase, name: string) {
    this.database = database;
    this.name = name;
  }

  static async open(name = DB_NAME): Promise<QiguangDb> {
    return new QiguangDb(await openRawDatabase(name), name);
  }

  static async restoreFromBackup(text: string, name = DB_NAME): Promise<QiguangDb> {
    parseBackup(text);
    await deleteRawDatabase(name);
    const restored = await QiguangDb.open(name);
    try {
      await restored.importBundle(text);
      return restored;
    } catch (error) {
      restored.close();
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  async addEntry(
    bodyValue: string,
    date = localDate(),
    inputMethod: JournalEntry['inputMethod'] = 'text',
    kind: NonNullable<JournalEntry['kind']> = 'journal',
  ): Promise<JournalEntry> {
    if (!isLocalDate(date)) throw new Error('记录日期无效。');
    assertOneOf(inputMethod, ['text', 'import'], '记录输入方式');
    assertOneOf(kind, ['journal', 'success'], '记录类型');
    const timestamp = nowIso();
    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      localDate: date,
      body: validateBody(bodyValue),
      inputMethod,
      kind,
      analysisStatus: 'not-submitted',
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const transaction = this.database.transaction('entries', 'readwrite');
    transaction.objectStore('entries').add(entry);
    await transactionDone(transaction);
    return entry;
  }

  async listEntries(date?: string): Promise<JournalEntry[]> {
    const transaction = this.database.transaction('entries', 'readonly');
    const store = transaction.objectStore('entries');
    const request = date
      ? store.index('byLocalDateCreatedAt').getAll(IDBKeyRange.bound([date, ''], [date, '\uffff']))
      : store.getAll();
    const entries = await requestResult(request) as JournalEntry[];
    await transactionDone(transaction);
    return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getDayCaption(date: string): Promise<DayCaption | undefined> {
    if (!isLocalDate(date)) throw new Error('当日一句话日期无效。');
    const transaction = this.database.transaction('dayCaptions', 'readonly');
    const caption = await requestResult(transaction.objectStore('dayCaptions').index('byLocalDate').get(date)) as DayCaption | undefined;
    await transactionDone(transaction);
    return caption;
  }

  async saveDayCaption(date: string, value: string): Promise<DayCaption | undefined> {
    if (!isLocalDate(date)) throw new Error('当日一句话日期无效。');
    const text = value.trim();
    if (text.length > 120) throw new Error('当日一句话不能超过 120 个字。');
    const transaction = this.database.transaction('dayCaptions', 'readwrite');
    const store = transaction.objectStore('dayCaptions');
    const current = await requestResult(store.index('byLocalDate').get(date)) as DayCaption | undefined;
    if (!text) {
      if (current) store.delete(current.id);
      await transactionDone(transaction);
      return undefined;
    }
    const timestamp = nowIso();
    const caption: DayCaption = current ? {
      ...current,
      text,
      updatedAt: timestamp,
      version: current.version + 1,
    } : {
      id: `day-caption:${date}`,
      localDate: date,
      text,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    store.put(caption);
    await transactionDone(transaction);
    return caption;
  }

  async getEntry(id: string): Promise<JournalEntry | undefined> {
    const transaction = this.database.transaction('entries', 'readonly');
    const entry = await requestResult(transaction.objectStore('entries').get(id)) as JournalEntry | undefined;
    await transactionDone(transaction);
    return entry;
  }

  async searchEntries(query: string, date?: string): Promise<JournalEntry[]> {
    const normalised = query.trim().toLocaleLowerCase('zh-CN');
    const entries = await this.listEntries(date);
    return entries.filter((entry) => !normalised || entry.body.toLocaleLowerCase('zh-CN').includes(normalised));
  }

  async editEntry(
    id: string,
    expectedVersion: number,
    bodyValue: string,
    kind?: NonNullable<JournalEntry['kind']>,
  ): Promise<JournalEntry> {
    const transaction = this.database.transaction(['entries', 'revisions', 'analyses', 'events', 'observations', 'snapshots', 'memories', 'analysisJobs'], 'readwrite');
    const entries = transaction.objectStore('entries');
    const current = await requestResult(entries.get(id)) as JournalEntry | undefined;
    if (!current) {
      transaction.abort();
      throw new Error('这条记录已不存在。');
    }
    if (current.version !== expectedVersion) {
      transaction.abort();
      throw new Error('记录已在其他页面修改，请刷新后重试。');
    }
    const body = validateBody(bodyValue);
    if (kind !== undefined) assertOneOf(kind, ['journal', 'success'], '记录类型');
    const currentKind = current.kind ?? 'journal';
    const updatedKind = kind ?? currentKind;
    if (body === current.body && updatedKind === currentKind) {
      transaction.abort();
      throw new Error('记录没有变化。');
    }
    const timestamp = nowIso();
    const revision: JournalRevision = {
      id: crypto.randomUUID(),
      entryId: id,
      fromVersion: current.version,
      previousBody: current.body,
      previousKind: currentKind,
      reason: 'user-edit',
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const updated = { ...current, body, kind: updatedKind, analysisStatus: 'not-submitted' as const, version: current.version + 1, updatedAt: timestamp };
    transaction.objectStore('revisions').add(revision);
    entries.put(updated);
    const done = transactionDone(transaction);
    await invalidateAnalysisForEntry(transaction, id, timestamp);
    await done;
    return updated;
  }

  async listRevisions(entryId: string): Promise<JournalRevision[]> {
    const transaction = this.database.transaction('revisions', 'readonly');
    const revisions = await requestResult(transaction.objectStore('revisions').index('byEntryId').getAll(entryId)) as JournalRevision[];
    await transactionDone(transaction);
    return revisions.sort((a, b) => b.fromVersion - a.fromVersion);
  }

  async undoLastEdit(id: string): Promise<JournalEntry> {
    const transaction = this.database.transaction(['entries', 'revisions', 'analyses', 'events', 'observations', 'snapshots', 'memories', 'analysisJobs'], 'readwrite');
    const entries = transaction.objectStore('entries');
    const revisions = transaction.objectStore('revisions');
    const current = await requestResult(entries.get(id)) as JournalEntry | undefined;
    if (!current) {
      transaction.abort();
      throw new Error('这条记录已不存在。');
    }
    const history = await requestResult(revisions.index('byEntryId').getAll(id)) as JournalRevision[];
    const latest = history.sort((a, b) => b.fromVersion - a.fromVersion)[0];
    if (!latest || latest.reason !== 'user-edit' || latest.undoneAt || latest.fromVersion + 1 !== current.version) {
      transaction.abort();
      throw new Error('没有可以撤销的最近修改。');
    }
    const timestamp = nowIso();
    const undoRevision: JournalRevision = {
      id: crypto.randomUUID(),
      entryId: id,
      fromVersion: current.version,
      previousBody: current.body,
      previousKind: current.kind ?? 'journal',
      reason: 'undo',
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const updated = {
      ...current,
      body: latest.previousBody,
      kind: latest.previousKind ?? 'journal',
      analysisStatus: 'not-submitted' as const,
      version: current.version + 1,
      updatedAt: timestamp,
    };
    revisions.put({ ...latest, undoneAt: timestamp, updatedAt: timestamp, version: latest.version + 1 });
    revisions.add(undoRevision);
    entries.put(updated);
    const done = transactionDone(transaction);
    await invalidateAnalysisForEntry(transaction, id, timestamp);
    await done;
    return updated;
  }

  async deleteEntry(id: string): Promise<void> {
    const transaction = this.database.transaction(['entries', 'revisions', 'analyses', 'events', 'observations', 'snapshots', 'memories', 'analysisJobs'], 'readwrite');
    transaction.objectStore('entries').delete(id);
    const cursorPromise = cursorDelete(transaction.objectStore('revisions').index('byEntryId').openCursor(id));
    const done = transactionDone(transaction);
    await Promise.all([cursorPromise, invalidateAnalysisForEntry(transaction, id, nowIso())]);
    await done;
  }

  async saveAssessment(values: Partial<Record<Dimension, number>>, date = localDate()): Promise<StateObservation[]> {
    if (!isLocalDate(date)) throw new Error('自评日期无效。');
    const selected = DIMENSIONS.flatMap(({ key }) => values[key] === undefined ? [] : [[key, values[key]] as const]);
    if (!selected.length) throw new Error('至少回答一个状态问题。');
    const timestamp = nowIso();
    const assessmentId = crypto.randomUUID();
    const observations = selected.map(([dimension, value]) => {
      assertInteger(value, 0, 100, '状态值');
      return {
        id: crypto.randomUUID(),
        assessmentId,
        localDate: date,
        dimension,
        kind: 'user-self-assessment' as const,
        value,
        active: true,
        observedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1 as const,
      };
    });
    const transaction = this.database.transaction('observations', 'readwrite');
    const store = transaction.objectStore('observations');
    observations.forEach((observation) => store.add(observation));
    await transactionDone(transaction);
    return observations;
  }

  async latestAssessment(): Promise<Partial<Record<Dimension, StateObservation>>> {
    return this.assessmentAtOrBefore();
  }

  async assessmentAtOrBefore(date?: string): Promise<Partial<Record<Dimension, StateObservation>>> {
    const transaction = this.database.transaction('observations', 'readonly');
    const all = await requestResult(transaction.objectStore('observations').getAll()) as StateObservation[];
    await transactionDone(transaction);
    const latest: Partial<Record<Dimension, StateObservation>> = {};
    const eligible = all.filter((observation) => observation.active !== false && observation.kind !== 'event-impact' && (!date || observation.localDate <= date));
    for (const observation of eligible.sort((a, b) => a.observedAt.localeCompare(b.observedAt))) {
      latest[observation.dimension] = observation;
    }
    return latest;
  }

  async listStateObservations(dimension?: Dimension, throughDate?: string): Promise<StateObservation[]> {
    const transaction = this.database.transaction('observations', 'readonly');
    const all = await requestResult(transaction.objectStore('observations').getAll()) as StateObservation[];
    await transactionDone(transaction);
    return all.filter((item) => (!dimension || item.dimension === dimension) && (!throughDate || item.localDate <= throughDate))
      .sort((left, right) => right.localDate.localeCompare(left.localDate) || right.observedAt.localeCompare(left.observedAt));
  }

  async resolvedStateAtOrBefore(date?: string): Promise<Partial<Record<Dimension, ResolvedDimensionState>>> {
    const observations = await this.listStateObservations(undefined, date);
    const resolved: Partial<Record<Dimension, ResolvedDimensionState>> = {};
    for (const item of resolveStateTimeline(observations, date)) resolved[item.dimension as Dimension] = item as ResolvedDimensionState;
    return resolved;
  }

  async createDailyAnalysisJob(value: DailyAnalysisRequest): Promise<AnalysisJob> {
    const request = parseDailyAnalysisRequest(value);
    const transaction = this.database.transaction(['entries', 'analyses', 'analysisJobs'], 'readwrite');
    const jobs = transaction.objectStore('analysisJobs');
    const existing = await requestResult(jobs.index('byRequestId').get(request.requestId)) as AnalysisJob | undefined;
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }
    const entries = transaction.objectStore('entries');
    const currentEntries = await Promise.all(request.userInput.entries.map((item) => requestResult(entries.get(item.entryId)) as Promise<JournalEntry | undefined>));
    if (currentEntries.some((entry, index) => !entry || entry.localDate !== request.localDate || entry.version !== request.userInput.entries[index]?.revision || entry.body !== request.userInput.entries[index]?.text)) {
      transaction.abort();
      throw new Error('记录已改变，请重新检查发送内容。');
    }
    const timestamp = nowIso();
    const sameDayJobs = await requestResult(jobs.index('byLocalDate').getAll(request.localDate)) as AnalysisJob[];
    for (const prior of sameDayJobs) {
      if (prior.operation !== 'daily_analysis' || !['queued', 'processing', 'failed', 'safety-review'].includes(prior.status)) continue;
      const { errorCode: _errorCode, nextAttemptAt: _nextAttemptAt, ...withoutRetry } = prior;
      jobs.put({ ...withoutRetry, status: 'stale', errorMessage: '同一天已发起更新的整理，请使用较新的结果。', updatedAt: timestamp, version: prior.version + 1 });
    }
    const selectedIds = new Set(request.userInput.entries.map((item) => item.entryId));
    const supersededSources = new Set(sameDayJobs.filter((prior) => prior.operation === 'daily_analysis' && ['queued', 'processing', 'failed', 'safety-review'].includes(prior.status)).flatMap((prior) => parseDailyAnalysisRequest(prior.request).userInput.entries.map((item) => item.entryId)).filter((id) => !selectedIds.has(id)));
    if (supersededSources.size) {
      const readyAnalyses = (await requestResult(transaction.objectStore('analyses').index('byLocalDate').getAll(request.localDate)) as DailyAnalysis[]).filter((item) => item.status === 'ready');
      for (const entryId of supersededSources) {
        const entry = await requestResult(entries.get(entryId)) as JournalEntry | undefined;
        if (!entry) continue;
        const covered = readyAnalyses.some((analysis) => analysis.sourceEntries.some((source) => source.entryId === entry.id && source.revision === entry.version));
        entries.put({ ...entry, analysisStatus: covered ? 'succeeded' : 'not-submitted', updatedAt: timestamp });
      }
    }
    const job: AnalysisJob = {
      id: request.requestId,
      requestId: request.requestId,
      operation: 'daily_analysis',
      localDate: request.localDate,
      contractVersion: ANALYSIS_CONTRACT_VERSION,
      idempotencyKey: `daily:${request.localDate}:${request.userInput.entries.map((entry) => `${entry.entryId}@${entry.revision}`).sort().join(',')}`,
      request,
      status: 'queued',
      attemptCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    jobs.add(job);
    currentEntries.forEach((entry) => entries.put({ ...entry, analysisStatus: 'queued', updatedAt: timestamp }));
    await transactionDone(transaction);
    return job;
  }

  async createWeeklyReviewJob(value: WeeklyReviewRequest): Promise<AnalysisJob> {
    const request = parseWeeklyReviewRequest(value);
    const transaction = this.database.transaction([...new Set<StoreName>([...WEEKLY_REVIEW_SOURCE_STORES, 'analysisJobs'])], 'readwrite');
    const jobs = transaction.objectStore('analysisJobs');
    const existing = await requestResult(jobs.index('byRequestId').get(request.requestId)) as AnalysisJob | undefined;
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }
    if (!await weeklyReviewSourcesCurrent(transaction, request)) {
      transaction.abort();
      throw new Error('周复盘来源已改变，请重新检查发送内容。');
    }
    const timestamp = nowIso();
    const samePeriodJobs = (await requestResult(jobs.getAll()) as AnalysisJob[]).filter((prior) => {
      if (prior.operation !== 'weekly_review' || !['queued', 'processing', 'failed'].includes(prior.status)) return false;
      const priorRequest = parseWeeklyReviewRequest(prior.request);
      return priorRequest.period.start === request.period.start && priorRequest.period.end === request.period.end;
    });
    for (const prior of samePeriodJobs) {
      const { errorCode: _errorCode, nextAttemptAt: _nextAttemptAt, ...withoutRetry } = prior;
      jobs.put({ ...withoutRetry, status: 'stale', errorMessage: '同一周期已发起更新的复盘，请使用较新的结果。', updatedAt: timestamp, version: prior.version + 1 });
    }
    const job: AnalysisJob = {
      id: request.requestId, requestId: request.requestId, operation: 'weekly_review', localDate: request.period.end,
      contractVersion: ANALYSIS_CONTRACT_VERSION,
      idempotencyKey: `weekly:${request.period.start}:${request.period.end}:${request.context.events.map((item) => `${item.eventId}@${item.version}`).sort().join(',')}`,
      request, status: 'queued', attemptCount: 0, createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    jobs.add(job);
    await transactionDone(transaction);
    return job;
  }

  async listAnalysisJobs(date?: string): Promise<AnalysisJob[]> {
    const transaction = this.database.transaction('analysisJobs', 'readonly');
    const jobs = await requestResult(date
      ? transaction.objectStore('analysisJobs').index('byLocalDate').getAll(date)
      : transaction.objectStore('analysisJobs').getAll()) as AnalysisJob[];
    await transactionDone(transaction);
    return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async markAnalysisJobProcessing(id: string, interrupted?: { expectedVersion: number; staleBefore: string }): Promise<AnalysisJob> {
    const transaction = this.database.transaction([...new Set<StoreName>(['entries', 'analysisJobs', ...WEEKLY_REVIEW_SOURCE_STORES])], 'readwrite');
    const jobs = transaction.objectStore('analysisJobs');
    const job = await requestResult(jobs.get(id)) as AnalysisJob | undefined;
    if (!job) {
      transaction.abort();
      throw new Error('整理任务不存在。');
    }
    const resumesInterrupted = interrupted !== undefined
      && job.status === 'processing'
      && job.version === interrupted.expectedVersion
      && job.updatedAt <= interrupted.staleBefore;
    if (interrupted && !resumesInterrupted) {
      transaction.abort();
      throw new Error('整理任务状态已经改变，请重新检查。');
    }
    if (!['queued', 'failed'].includes(job.status) && !resumesInterrupted) {
      transaction.abort();
      throw new Error(job.status === 'stale' ? '记录已改变，请重新整理。' : '这次整理不需要重复提交。');
    }
    const entries = transaction.objectStore('entries');
    const dailyRequest = job.operation === 'daily_analysis' ? parseDailyAnalysisRequest(job.request) : undefined;
    const weeklyRequest = job.operation === 'weekly_review' ? parseWeeklyReviewRequest(job.request) : undefined;
    const currentEntries = dailyRequest
      ? await Promise.all(dailyRequest.userInput.entries.map((item) => requestResult(entries.get(item.entryId)) as Promise<JournalEntry | undefined>))
      : [];
    const sourcesChanged = dailyRequest
      ? currentEntries.some((entry, index) => !entry || entry.version !== dailyRequest.userInput.entries[index]?.revision || entry.body !== dailyRequest.userInput.entries[index]?.text)
      : weeklyRequest ? !await weeklyReviewSourcesCurrent(transaction, weeklyRequest) : true;
    if (sourcesChanged) {
      const { errorCode: _errorCode, nextAttemptAt: _nextAttemptAt, ...withoutRetry } = job;
      const stale = { ...withoutRetry, status: 'stale' as const, errorMessage: '记录版本已经改变，请重新整理。', updatedAt: nowIso(), version: job.version + 1 };
      jobs.put(stale);
      await transactionDone(transaction);
      throw new Error(stale.errorMessage);
    }
    const timestamp = nowIso();
    const { errorCode: _errorCode, errorMessage: _errorMessage, nextAttemptAt: _nextAttemptAt, ...withoutError } = job;
    const updated = { ...withoutError, status: 'processing' as const, attemptCount: job.attemptCount + 1, updatedAt: timestamp, version: job.version + 1 };
    jobs.put(updated);
    if (dailyRequest) currentEntries.forEach((entry) => entries.put({ ...entry, analysisStatus: 'processing', updatedAt: timestamp }));
    await transactionDone(transaction);
    return updated;
  }

  async failAnalysisJob(id: string, errorCode: AnalysisErrorCode, message: string, nextAttemptAt?: string, expectedProcessingVersion?: number): Promise<AnalysisJob> {
    assertText(message, '整理错误', 500, true);
    if (nextAttemptAt !== undefined) assertTimestamp(nextAttemptAt, '下次整理时间');
    const transaction = this.database.transaction(['entries', 'analysisJobs'], 'readwrite');
    const jobs = transaction.objectStore('analysisJobs');
    const job = await requestResult(jobs.get(id)) as AnalysisJob | undefined;
    if (!job) {
      transaction.abort();
      throw new Error('整理任务不存在。');
    }
    if (job.status !== 'processing') {
      transaction.abort();
      throw new Error(job.status === 'stale' ? '这次整理已被同一天的更新请求取代。' : '整理任务尚未进入处理状态。');
    }
    if (expectedProcessingVersion !== undefined && job.version !== expectedProcessingVersion) {
      transaction.abort();
      throw new Error('这次整理已被新的重试接管。');
    }
    const timestamp = nowIso();
    const status = errorCode === 'SAFETY_REVIEW' ? 'safety-review' as const : 'failed' as const;
    const { nextAttemptAt: _nextAttemptAt, ...withoutRetry } = job;
    const updated = { ...withoutRetry, status, errorCode, errorMessage: message, ...(nextAttemptAt ? { nextAttemptAt } : {}), updatedAt: timestamp, version: job.version + 1 };
    jobs.put(updated);
    const entries = transaction.objectStore('entries');
    if (job.operation === 'daily_analysis') for (const source of parseDailyAnalysisRequest(job.request).userInput.entries) {
      const entry = await requestResult(entries.get(source.entryId)) as JournalEntry | undefined;
      if (entry && entry.version === source.revision) entries.put({ ...entry, analysisStatus: 'failed', updatedAt: timestamp });
    }
    await transactionDone(transaction);
    return updated;
  }

  async saveDailyAnalysis(id: string, value: unknown, expectedProcessingVersion?: number): Promise<DailyAnalysis> {
    const transaction = this.database.transaction(['entries', 'analyses', 'events', 'observations', 'snapshots', 'memories', 'analysisJobs'], 'readwrite');
    const jobs = transaction.objectStore('analysisJobs');
    const job = await requestResult(jobs.get(id)) as AnalysisJob | undefined;
    if (!job) {
      transaction.abort();
      throw new Error('整理任务不存在。');
    }
    if (job.operation !== 'daily_analysis') {
      transaction.abort();
      throw new Error('这不是每日整理任务。');
    }
    const request = parseDailyAnalysisRequest(job.request);
    const response = parseDailyAnalysisResponse(value, request);
    const analyses = transaction.objectStore('analyses');
    const existing = await requestResult(analyses.index('byRequestId').get(job.requestId)) as DailyAnalysis | undefined;
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }
    if (job.status !== 'processing') {
      transaction.abort();
      throw new Error(job.status === 'stale' ? '这次整理已被同一天的更新请求取代。' : '整理任务尚未进入处理状态。');
    }
    if (expectedProcessingVersion !== undefined && job.version !== expectedProcessingVersion) {
      transaction.abort();
      throw new Error('这次整理已被新的重试接管。');
    }
    const entries = transaction.objectStore('entries');
    const currentEntries = await Promise.all(request.userInput.entries.map((item) => requestResult(entries.get(item.entryId)) as Promise<JournalEntry | undefined>));
    if (currentEntries.some((entry, index) => !entry || entry.version !== request.userInput.entries[index]?.revision || entry.body !== request.userInput.entries[index]?.text)) {
      const { errorCode: _errorCode, nextAttemptAt: _nextAttemptAt, ...withoutRetry } = job;
      jobs.put({ ...withoutRetry, status: 'stale', errorMessage: '记录版本已经改变，请重新整理。', updatedAt: nowIso(), version: job.version + 1 });
      await transactionDone(transaction);
      throw new Error('记录已在整理期间改变，旧结果没有应用。');
    }
    const timestamp = nowIso();
    const eventStore = transaction.objectStore('events');
    const observationStore = transaction.objectStore('observations');
    const memories = transaction.objectStore('memories');
    const previousAnalyses = (await requestResult(analyses.index('byLocalDate').getAll(job.localDate)) as DailyAnalysis[]).filter((item) => item.status === 'ready');
    if (previousAnalyses.length) {
      const previousIds = new Set(previousAnalyses.map((item) => item.id));
      previousAnalyses.forEach((item) => analyses.put({ ...item, status: 'stale', updatedAt: timestamp, version: item.version + 1 }));
      const previousEvents = (await requestResult(eventStore.index('byLocalDate').getAll(job.localDate)) as JournalEvent[]).filter((item) => previousIds.has(item.analysisId));
      const previousEventIds = new Set(previousEvents.map((item) => item.id));
      previousEvents.forEach((item) => eventStore.put({ ...item, active: false, updatedAt: timestamp, version: item.version + 1 }));
      const [allObservations, allMemories, allEvents] = await Promise.all([
        requestResult(observationStore.getAll()) as Promise<StateObservation[]>,
        requestResult(memories.getAll()) as Promise<SystemMemory[]>,
        requestResult(eventStore.getAll()) as Promise<JournalEvent[]>,
      ]);
      const eventById = new Map(allEvents.map((item) => [item.id, item]));
      previousEvents.forEach((item) => eventById.set(item.id, { ...item, active: false }));
      allObservations.filter((item) => item.active && item.evidenceId && previousEventIds.has(item.evidenceId)).forEach((item) => {
        observationStore.put({ ...item, active: false, updatedAt: timestamp, version: item.version + 1 });
      });
      allMemories.forEach((memory) => {
        const evidenceIds = memory.evidenceIds.filter((eventId) => !previousEventIds.has(eventId));
        if (evidenceIds.length === memory.evidenceIds.length) return;
        const needsReview = memory.status === 'confirmed' && !evidenceIds.some((eventId) => {
          const event = eventById.get(eventId);
          return event?.active && event.confirmation === 'confirmed';
        });
        const { confirmedAt: _confirmedAt, ...withoutConfirmation } = memory;
        memories.put({
          ...(needsReview ? withoutConfirmation : memory), evidenceIds,
          status: needsReview ? 'candidate' : memory.status, updatedAt: timestamp, version: memory.version + 1,
        });
      });
    }
    const analysis: DailyAnalysis = {
      id: job.requestId,
      requestId: job.requestId,
      localDate: job.localDate,
      contractVersion: ANALYSIS_CONTRACT_VERSION,
      modelOutputVersion: ANALYSIS_CONTRACT_VERSION,
      status: 'ready',
      sourceEntries: request.userInput.entries.map((entry) => ({ entryId: entry.entryId, revision: entry.revision })),
      contextSummary: `记录 ${request.userInput.entries.length} 条 · 状态 ${request.context.recentStates.length} 天 · 目标 ${request.context.goals.length} 个 · 习惯 ${request.context.bonusHabits.length} 个 · 记忆 ${request.context.memories.length} 条`,
      result: response.result,
      warnings: response.warnings,
      rawResponse: JSON.stringify(response),
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    analyses.add(analysis);
    const candidateToEvent = new Map<string, string>();
    for (const candidate of response.result.events) {
      const eventId = `${analysis.id}:event:${candidate.candidateId}`;
      candidateToEvent.set(candidate.candidateId, eventId);
      const confirmed = candidate.sourceType === 'explicit';
      const event: JournalEvent = {
        id: eventId,
        analysisId: analysis.id,
        candidateId: candidate.candidateId,
        localDate: analysis.localDate,
        sourceEntryIds: [...new Set(candidate.evidence.map((evidence) => evidence.entryId))],
        title: candidate.title,
        description: candidate.description,
        sourceType: candidate.sourceType,
        confirmation: confirmed ? 'confirmed' : 'pending',
        confidence: candidate.confidence,
        evidence: candidate.evidence,
        stateImpactCandidates: candidate.stateImpactCandidates,
        growthEvidenceCandidate: candidate.growthEvidenceCandidate,
        active: true,
        userEdited: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      eventStore.add(event);
      if (!confirmed) continue;
      for (const impact of candidate.stateImpactCandidates) {
        const dimension = impact.dimension === 'mental' ? 'mind' : impact.dimension;
        const observation: StateObservation = {
          id: `${eventId}:state:${dimension}`,
          assessmentId: `event:${eventId}`,
          localDate: analysis.localDate,
          dimension,
          kind: 'event-impact',
          delta: impact.suggestedDelta,
          evidenceId: eventId,
          reason: impact.reason,
          active: true,
          observedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
        };
        observationStore.add(observation);
      }
    }
    response.result.memoryCandidates.forEach((candidate, index) => {
      const memory: SystemMemory = {
        id: `${analysis.id}:memory:${index + 1}`,
        analysisId: analysis.id,
        type: candidate.type,
        statement: candidate.statement,
        evidenceIds: candidate.supportingEventIds.map((candidateId) => candidateToEvent.get(candidateId) ?? candidateId),
        counterEvidence: candidate.counterEvidence,
        confidence: candidate.confidence,
        recommendedAction: candidate.recommendedAction,
        status: 'candidate',
        userEdited: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      memories.add(memory);
    });
    const { errorCode: _errorCode, errorMessage: _errorMessage, nextAttemptAt: _nextAttemptAt, ...withoutError } = job;
    jobs.put({ ...withoutError, status: 'succeeded', analysisId: analysis.id, updatedAt: timestamp, version: job.version + 1 });
    currentEntries.forEach((entry) => entries.put({ ...entry, analysisStatus: 'succeeded', updatedAt: timestamp }));
    transaction.objectStore('snapshots').clear();
    await transactionDone(transaction);
    return analysis;
  }

  async acceptAnalysisQuestSuggestion(analysisId: string, suggestionIndex: number): Promise<{ quest: Quest; created: boolean }> {
    assertInteger(suggestionIndex, 0, 2, '任务建议序号');
    const transaction = this.database.transaction(['analyses', 'entries', 'goals', 'branches', 'quests'], 'readwrite');
    const analysis = await requestResult(transaction.objectStore('analyses').get(analysisId)) as DailyAnalysis | undefined;
    if (!analysis || analysis.status !== 'ready') {
      transaction.abort();
      throw new Error('这份整理已经过期，请重新整理。');
    }
    const suggestion: QuestSuggestion | undefined = analysis.result.questSuggestions[suggestionIndex];
    if (!suggestion) {
      transaction.abort();
      throw new Error('任务建议不存在。');
    }
    const entries = transaction.objectStore('entries');
    const currentEntries = await Promise.all(analysis.sourceEntries.map((source) => requestResult(entries.get(source.entryId)) as Promise<JournalEntry | undefined>));
    if (currentEntries.some((entry, index) => !entry || entry.version !== analysis.sourceEntries[index]?.revision)) {
      transaction.abort();
      throw new Error('源记录已经改变，旧任务建议没有应用。');
    }
    const targetDate = shiftDate(analysis.localDate, 1);
    const quests = transaction.objectStore('quests');
    const currentQuests = await requestResult(quests.index('byLocalDate').getAll(targetDate)) as Quest[];
    const actionId = validateActionId(`analysis:${analysis.id}:suggestion:${suggestionIndex}`);
    const existing = currentQuests.find((quest) => quest.actionId === actionId);
    if (existing) {
      await transactionDone(transaction);
      return { quest: existing, created: false };
    }
    if (!canAddQuest(suggestion.type, currentQuests.filter((item) => item.status === 'pending').map((item) => item.type))) {
      transaction.abort();
      throw new Error('下一天的任务位置已满；没有覆盖现有计划。');
    }
    const goal = suggestion.sourceGoalId ? await requestResult(transaction.objectStore('goals').get(suggestion.sourceGoalId)) as Goal | undefined : undefined;
    const branch = suggestion.growthBranchId ? await requestResult(transaction.objectStore('branches').get(suggestion.growthBranchId)) as GrowthBranch | undefined : undefined;
    const timestamp = nowIso();
    const quest: Quest = {
      id: crypto.randomUUID(), localDate: targetDate, type: suggestion.type,
      sourceType: goal?.status === 'active' ? 'goal' : suggestion.isRecovery ? 'recovery' : 'manual',
      sourceId: goal?.status === 'active' ? goal.id : undefined,
      actionId, settlementVersion: 0, title: suggestion.title, reason: suggestion.why,
      minimumAction: suggestion.minimumVersion, estimatedMinutes: suggestion.estimatedMinutes, difficulty: suggestion.difficulty,
      dimension: suggestion.primaryState === 'mental' ? 'mind' : suggestion.primaryState,
      branchId: branch?.status === 'active' ? branch.id : undefined,
      status: 'pending', aiSuggested: true, userModified: false,
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    quests.add(quest);
    await transactionDone(transaction);
    return { quest, created: true };
  }

  async saveWeeklyReview(id: string, value: unknown, expectedProcessingVersion?: number): Promise<Review> {
    const transaction = this.database.transaction([...new Set<StoreName>([...WEEKLY_REVIEW_SOURCE_STORES, 'analysisJobs'])], 'readwrite');
    const jobs = transaction.objectStore('analysisJobs');
    const job = await requestResult(jobs.get(id)) as AnalysisJob | undefined;
    if (!job || job.operation !== 'weekly_review') {
      transaction.abort();
      throw new Error('周复盘任务不存在。');
    }
    const request = parseWeeklyReviewRequest(job.request);
    const response = parseWeeklyReviewResponse(value, request);
    const reviews = transaction.objectStore('reviews');
    const existing = await requestResult(reviews.get(job.requestId)) as Review | undefined;
    if (existing) {
      await transactionDone(transaction);
      return existing;
    }
    if (job.status !== 'processing') {
      transaction.abort();
      throw new Error(job.status === 'stale' ? '这次周复盘已被同周期的更新请求取代。' : '周复盘任务尚未进入处理状态。');
    }
    if (expectedProcessingVersion !== undefined && job.version !== expectedProcessingVersion) {
      transaction.abort();
      throw new Error('这次周复盘已被新的重试接管。');
    }
    if (!await weeklyReviewSourcesCurrent(transaction, request)) {
      jobs.put({ ...job, status: 'stale', errorMessage: '周内事件已经改变，请重新生成复盘。', updatedAt: nowIso(), version: job.version + 1 });
      await transactionDone(transaction);
      throw new Error('周复盘来源已在处理期间改变，旧结果没有应用。');
    }
    const timestamp = nowIso();
    const review: Review = {
      id: job.requestId, requestId: job.requestId, type: 'weekly', periodStart: request.period.start, periodEnd: request.period.end,
      contractVersion: ANALYSIS_CONTRACT_VERSION, status: 'candidate', request,
      stateTrends: response.result.stateTrends.map((item) => ({ ...item, dimension: item.dimension === 'mental' ? 'mind' : item.dimension })),
      recurringBenefits: response.result.recurringBenefits,
      recurringCosts: response.result.recurringCosts,
      growthDeposits: response.result.growthDeposits,
      habitDecisions: response.result.habitDecisions,
      nextTheme: response.result.nextWeekTheme.title,
      nextThemeReason: response.result.nextWeekTheme.reason,
      nextExperiment: response.result.nextExperiment,
      warnings: response.warnings,
      rawResponse: JSON.stringify(response),
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    reviews.add(review);
    const memories = transaction.objectStore('memories');
    response.result.systemCandidates.forEach((candidate, index) => {
      const memory: SystemMemory = {
        id: `${review.id}:memory:${index + 1}`, reviewId: review.id, type: candidate.type, statement: candidate.statement,
        evidenceIds: candidate.supportingEventIds, counterEvidence: candidate.counterEvidence, confidence: candidate.confidence,
        recommendedAction: candidate.recommendedAction, status: 'candidate', userEdited: false,
        createdAt: timestamp, updatedAt: timestamp, version: 1,
      };
      memories.add(memory);
    });
    const { errorCode: _errorCode, errorMessage: _errorMessage, nextAttemptAt: _nextAttemptAt, ...withoutError } = job;
    jobs.put({ ...withoutError, status: 'succeeded', reviewId: review.id, updatedAt: timestamp, version: job.version + 1 });
    await transactionDone(transaction);
    return review;
  }

  async listReviews(type?: Review['type']): Promise<Review[]> {
    const transaction = this.database.transaction('reviews', 'readonly');
    const values = await requestResult(type
      ? transaction.objectStore('reviews').index('byType').getAll(type)
      : transaction.objectStore('reviews').getAll()) as Review[];
    await transactionDone(transaction);
    return values.sort((left, right) => right.periodEnd.localeCompare(left.periodEnd) || right.createdAt.localeCompare(left.createdAt));
  }

  async confirmWeeklyReview(
    id: string,
    nextTheme: string,
    nextExperiment: Review['nextExperiment'],
    confirmationDate = localDate(),
  ): Promise<{ review: Review; questCreated: boolean; questScheduled: boolean }> {
    assertText(nextTheme, '下周主题', 120);
    assertText(nextExperiment.hypothesis, '实验假设', 500);
    assertText(nextExperiment.minimumAction, '实验最小动作', 300);
    assertText(nextExperiment.metric, '实验指标', 300);
    if (!isLocalDate(nextExperiment.endDate)) throw new Error('实验结束日期无效。');
    if (!isLocalDate(confirmationDate)) throw new Error('复盘确认日期无效。');
    assertText(nextExperiment.stopCondition, '实验停止条件', 300);
    const transaction = this.database.transaction([...new Set<StoreName>([...WEEKLY_REVIEW_SOURCE_STORES, 'analysisJobs'])], 'readwrite');
    const reviews = transaction.objectStore('reviews');
    const current = await requestResult(reviews.get(id)) as Review | undefined;
    if (!current || current.type !== 'weekly') {
      transaction.abort();
      throw new Error('周复盘不存在。');
    }
    if (current.status !== 'candidate') {
      transaction.abort();
      throw new Error('这份周复盘已经处理过。');
    }
    if (!await weeklyReviewSourcesCurrent(transaction, current.request)) {
      transaction.abort();
      throw new Error('周复盘来源已改变，请重新生成复盘后再确认。');
    }
    const targetDate = [shiftDate(current.periodEnd, 1), confirmationDate].sort().at(-1) as string;
    if (nextExperiment.endDate < targetDate) {
      transaction.abort();
      throw new Error('实验结束日期早于可安排日期，请改到今天或未来。');
    }
    const timestamp = nowIso();
    const review: Review = {
      ...current, status: 'confirmed', nextTheme: nextTheme.trim(), nextExperiment,
      updatedAt: timestamp, version: current.version + 1,
    };
    reviews.put(review);
    const quests = transaction.objectStore('quests');
    const currentQuests = await requestResult(quests.index('byLocalDate').getAll(targetDate)) as Quest[];
    const actionId = validateActionId(`review:${id}:experiment`);
    let questCreated = false;
    let questScheduled = false;
    if (!currentQuests.some((item) => item.actionId === actionId)) {
      const hasCapacity = canAddQuest('main', currentQuests.filter((item) => item.status === 'pending').map((item) => item.type));
      const quest: Quest = {
        id: crypto.randomUUID(), localDate: targetDate, type: 'main', sourceType: 'manual', actionId, settlementVersion: 0,
        title: review.nextTheme, reason: review.nextThemeReason, minimumAction: nextExperiment.minimumAction,
        estimatedMinutes: 10, difficulty: 'light', status: hasCapacity ? 'pending' : 'exempt',
        ...(hasCapacity ? {} : { systemRetiredAt: timestamp, systemRetiredReason: 'capacity' as const }),
        aiSuggested: true, userModified: true,
        createdAt: timestamp, updatedAt: timestamp, version: 1,
      };
      quests.add(quest);
      questCreated = true;
      questScheduled = hasCapacity;
    } else {
      questScheduled = currentQuests.some((item) => item.actionId === actionId && item.status === 'pending');
    }
    await transactionDone(transaction);
    return { review, questCreated, questScheduled };
  }

  async rejectWeeklyReview(id: string): Promise<Review> {
    const transaction = this.database.transaction('reviews', 'readwrite');
    const store = transaction.objectStore('reviews');
    const current = await requestResult(store.get(id)) as Review | undefined;
    if (!current || current.type !== 'weekly' || current.status !== 'candidate') {
      transaction.abort();
      throw new Error('这份周复盘已经处理过。');
    }
    const timestamp = nowIso();
    const updated: Review = { ...current, status: 'rejected', rejectedAt: timestamp, updatedAt: timestamp, version: current.version + 1 };
    store.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async listDailyAnalyses(date?: string): Promise<DailyAnalysis[]> {
    const transaction = this.database.transaction('analyses', 'readonly');
    const values = await requestResult(date
      ? transaction.objectStore('analyses').index('byLocalDate').getAll(date)
      : transaction.objectStore('analyses').getAll()) as DailyAnalysis[];
    await transactionDone(transaction);
    return values.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listJournalEvents(date?: string): Promise<JournalEvent[]> {
    const transaction = this.database.transaction('events', 'readonly');
    const values = await requestResult(date
      ? transaction.objectStore('events').index('byLocalDate').getAll(date)
      : transaction.objectStore('events').getAll()) as JournalEvent[];
    await transactionDone(transaction);
    return values.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async decideEvent(id: string, confirmation: JournalEvent['confirmation'], patch: Partial<Pick<JournalEvent, 'title' | 'description'>> = {}): Promise<JournalEvent> {
    if (patch.title !== undefined) assertText(patch.title, '事件标题', 60);
    if (patch.description !== undefined) assertText(patch.description, '事件说明', 500);
    const transaction = this.database.transaction(['analyses', 'events', 'observations', 'snapshots', 'memories'], 'readwrite');
    const events = transaction.objectStore('events');
    const current = await requestResult(events.get(id)) as JournalEvent | undefined;
    if (!current) {
      transaction.abort();
      throw new Error('事件不存在。');
    }
    const analysis = await requestResult(transaction.objectStore('analyses').get(current.analysisId)) as DailyAnalysis | undefined;
    if (!analysis || analysis.status !== 'ready') {
      transaction.abort();
      throw new Error('这份整理已经过期，请重新整理后再确认。');
    }
    const timestamp = nowIso();
    const updated: JournalEvent = {
      ...current,
      ...patch,
      title: patch.title?.trim() ?? current.title,
      description: patch.description?.trim() ?? current.description,
      confirmation,
      active: true,
      userEdited: current.userEdited || patch.title !== undefined || patch.description !== undefined,
      updatedAt: timestamp,
      version: current.version + 1,
    };
    events.put(updated);
    const observations = transaction.objectStore('observations');
    const existing = await requestResult(observations.index('byEvidenceId').getAll(id)) as StateObservation[];
    const existingByDimension = new Map(existing.map((item) => [item.dimension, item]));
    for (const impact of current.stateImpactCandidates) {
      const dimension = impact.dimension === 'mental' ? 'mind' : impact.dimension;
      const previous = existingByDimension.get(dimension);
      const observation: StateObservation = previous ? {
        ...previous,
        delta: impact.suggestedDelta,
        reason: impact.reason,
        active: confirmation === 'confirmed',
        updatedAt: timestamp,
        version: previous.version + 1,
      } : {
        id: `${id}:state:${dimension}`,
        assessmentId: `event:${id}`,
        localDate: current.localDate,
        dimension,
        kind: 'event-impact',
        delta: impact.suggestedDelta,
        evidenceId: id,
        reason: impact.reason,
        active: confirmation === 'confirmed',
        observedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      observations.put(observation);
    }
    if (confirmation !== 'confirmed') {
      const memoryStore = transaction.objectStore('memories');
      const allMemories = await requestResult(memoryStore.getAll()) as SystemMemory[];
      const allEvents = await requestResult(events.getAll()) as JournalEvent[];
      const byId = new Map(allEvents.map((event) => [event.id, event]));
      byId.set(updated.id, updated);
      for (const memory of allMemories) {
        if (memory.status !== 'confirmed' || !memory.evidenceIds.includes(id)) continue;
        const stillSupported = memory.evidenceIds.some((eventId) => {
          const event = byId.get(eventId);
          return event?.active && event.confirmation === 'confirmed';
        });
        if (stillSupported) continue;
        const { confirmedAt: _confirmedAt, ...withoutConfirmation } = memory;
        memoryStore.put({ ...withoutConfirmation, status: 'candidate', updatedAt: timestamp, version: memory.version + 1 });
      }
    }
    transaction.objectStore('snapshots').clear();
    await transactionDone(transaction);
    return updated;
  }

  async listMemories(status?: SystemMemory['status']): Promise<SystemMemory[]> {
    const transaction = this.database.transaction('memories', 'readonly');
    const values = await requestResult(status
      ? transaction.objectStore('memories').index('byStatus').getAll(status)
      : transaction.objectStore('memories').getAll()) as SystemMemory[];
    await transactionDone(transaction);
    return values.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async addConfirmedMemory(type: SystemMemory['type'], statement: string): Promise<SystemMemory> {
    assertOneOf(type, ['preference', 'pattern', 'principle', 'strength', 'constraint'], '系统记忆类型');
    assertText(statement, '系统记忆内容', 500);
    const timestamp = nowIso();
    const memory: SystemMemory = {
      id: crypto.randomUUID(), type, statement: statement.trim(), evidenceIds: [], counterEvidence: [], confidence: 'high',
      recommendedAction: 'observe', status: 'confirmed', confirmedAt: timestamp, reminderMuted: false, userEdited: true,
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    const transaction = this.database.transaction('memories', 'readwrite');
    transaction.objectStore('memories').add(memory);
    await transactionDone(transaction);
    return memory;
  }

  async setMemoryReminder(id: string, reminderMuted: boolean): Promise<SystemMemory> {
    const transaction = this.database.transaction('memories', 'readwrite');
    const store = transaction.objectStore('memories');
    const current = await requestResult(store.get(id)) as SystemMemory | undefined;
    if (!current || current.status !== 'confirmed') {
      transaction.abort();
      throw new Error('只有已确认记忆可以调整提醒。');
    }
    const updated = { ...current, reminderMuted, updatedAt: nowIso(), version: current.version + 1 };
    store.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async decideMemory(id: string, status: SystemMemory['status'], statement?: string): Promise<SystemMemory> {
    if (statement !== undefined) assertText(statement, '系统记忆内容', 500);
    const transaction = this.database.transaction(['memories', 'events'], 'readwrite');
    const store = transaction.objectStore('memories');
    const current = await requestResult(store.get(id)) as SystemMemory | undefined;
    if (!current) {
      transaction.abort();
      throw new Error('系统候选不存在。');
    }
    if (status === 'confirmed' && !(current.userEdited && !current.analysisId && !current.reviewId && current.evidenceIds.length === 0)) {
      const evidence = await Promise.all(current.evidenceIds.map((eventId) => requestResult(transaction.objectStore('events').get(eventId)) as Promise<JournalEvent | undefined>));
      if (!evidence.some((event) => event?.active && event.confirmation === 'confirmed')) {
        transaction.abort();
        throw new Error('这条候选已没有有效证据，不能确认；可以暂不处理或忘记。');
      }
    }
    const timestamp = nowIso();
    const updated: SystemMemory = {
      ...current,
      statement: statement?.trim() ?? current.statement,
      status,
      confirmedAt: status === 'confirmed' ? timestamp : current.confirmedAt,
      forgottenAt: status === 'forgotten' ? timestamp : undefined,
      userEdited: current.userEdited || statement !== undefined,
      updatedAt: timestamp,
      version: current.version + 1,
    };
    store.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async mergeMemoryCandidates(expected: Array<Pick<SystemMemory, 'id' | 'version' | 'type' | 'statement' | 'status'>>, statement: string): Promise<SystemMemory> {
    const ids = expected.map((item) => item.id);
    if (new Set(ids).size !== ids.length || ids.length < 2) throw new Error('至少选择两条不同的系统候选。');
    assertText(statement, '合并候选内容', 500);
    const transaction = this.database.transaction('memories', 'readwrite');
    const store = transaction.objectStore('memories');
    const values = await Promise.all(ids.map((id) => requestResult(store.get(id)) as Promise<SystemMemory | undefined>));
    if (values.some((item, index) => !item || item.status === 'forgotten' || item.version !== expected[index]?.version || item.type !== expected[index]?.type || item.statement !== expected[index]?.statement || item.status !== expected[index]?.status)) {
      transaction.abort();
      throw new Error('系统候选已经改变，请重新检查。');
    }
    const candidates = values as SystemMemory[];
    if (new Set(candidates.map((item) => item.type)).size !== 1) {
      transaction.abort();
      throw new Error('不同类型的系统候选不能合并。');
    }
    const timestamp = nowIso();
    const first = candidates[0]!;
    const rest = candidates.slice(1);
    const confidence = candidates.map((item) => item.confidence).sort((left, right) => ({ low: 0, medium: 1, high: 2 }[left] - { low: 0, medium: 1, high: 2 }[right]))[0]!;
    const { confirmedAt: _confirmedAt, forgottenAt: _forgottenAt, ...base } = first;
    const merged: SystemMemory = {
      ...base,
      statement: statement.trim(),
      evidenceIds: [...new Set(candidates.flatMap((item) => item.evidenceIds))],
      counterEvidence: [...new Set(candidates.flatMap((item) => item.counterEvidence))],
      confidence,
      status: 'candidate',
      userEdited: true,
      updatedAt: timestamp,
      version: first.version + 1,
    };
    store.put(merged);
    for (const item of rest) {
      const { confirmedAt: _confirmed, ...withoutConfirmation } = item;
      store.put({ ...withoutConfirmation, status: 'forgotten', forgottenAt: timestamp, updatedAt: timestamp, version: item.version + 1 });
    }
    await transactionDone(transaction);
    return merged;
  }

  async getSettings(): Promise<AppSettings> {
    const transaction = this.database.transaction('settings', 'readonly');
    const saved = await requestResult(transaction.objectStore('settings').get('app')) as AppSettings | undefined;
    await transactionDone(transaction);
    if (saved) return {
      ...saved,
      guidanceTone: saved.guidanceTone ?? 'gentle',
      weeklyReviewScope: { ...DEFAULT_WEEKLY_REVIEW_SCOPE, ...saved.weeklyReviewScope },
      aiModel: saved.aiModel ?? 'MiniMax-M3',
    };
    const timestamp = nowIso();
    return {
      id: 'app', reduceMotion: false, onboardingSeen: false, aiAllowed: false, previewBeforeSend: true, guidanceTone: 'gentle',
      weeklyReviewScope: { ...DEFAULT_WEEKLY_REVIEW_SCOPE },
      aiModel: 'MiniMax-M3',
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
  }

  async saveSettings(patch: Partial<Pick<AppSettings, 'reduceMotion' | 'onboardingSeen' | 'aiAllowed' | 'previewBeforeSend' | 'guidanceTone' | 'weeklyReviewScope' | 'aiModel' | 'aiApiKey'>>): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated = { ...current, ...patch, updatedAt: nowIso() };
    const transaction = this.database.transaction('settings', 'readwrite');
    transaction.objectStore('settings').put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async ensureI2Defaults(): Promise<void> {
    const transaction = this.database.transaction(['profile', 'areas', 'branches'], 'readwrite');
    const profileStore = transaction.objectStore('profile');
    const areaStore = transaction.objectStore('areas');
    const branchStore = transaction.objectStore('branches');
    const [profiles, areas, branches] = await Promise.all([
      requestResult(profileStore.getAll()) as Promise<Profile[]>,
      requestResult(areaStore.getAll()) as Promise<Area[]>,
      requestResult(branchStore.getAll()) as Promise<GrowthBranch[]>,
    ]);
    const timestamp = nowIso();
    if (!profiles.length) {
      profileStore.add({
        id: 'profile', userName: '', companionName: '小栖', avatar: null,
        chapterTitle: '全面观察', chapterStartedOn: localDate(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai', weekStartsOn: 1,
        createdAt: timestamp, updatedAt: timestamp, version: 1,
      } satisfies Profile);
    }
    if (!areas.length) {
      DEFAULT_AREA_NAMES.forEach((name, order) => areaStore.add({
        id: `default-area-${order + 1}`, name, mode: 'explore', order, isDefault: true,
        createdAt: timestamp, updatedAt: timestamp, version: 1,
      } satisfies Area));
    }
    if (!branches.length) {
      ROOT_ASSETS.forEach(({ key, name }, order) => branchStore.add({
        id: `root-${key}`, rootAsset: key, name, order, status: 'active',
        createdAt: timestamp, updatedAt: timestamp, version: 1,
      } satisfies GrowthBranch));
    }
    await transactionDone(transaction);
  }

  async getProfile(): Promise<Profile | undefined> {
    const transaction = this.database.transaction('profile', 'readonly');
    const profiles = await requestResult(transaction.objectStore('profile').getAll()) as Profile[];
    await transactionDone(transaction);
    return profiles[0];
  }

  async saveProfile(patch: Partial<Pick<Profile, 'userName' | 'companionName' | 'avatar' | 'chapterTitle' | 'chapterStartedOn'>>): Promise<Profile> {
    const current = await this.getProfile();
    if (!current) throw new Error('个人资料尚未初始化。');
    const timestamp = nowIso();
    const updated = { ...current, ...patch, updatedAt: timestamp, version: current.version + 1 };
    assertText(updated.userName, '用户称呼', 40, true);
    assertText(updated.companionName, '生活分身称呼', 40);
    assertText(updated.chapterTitle, '人生章节', 80);
    if (!isLocalDate(updated.chapterStartedOn)) throw new Error('章节开始日期无效。');
    const transaction = this.database.transaction('profile', 'readwrite');
    transaction.objectStore('profile').put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async listAreas(): Promise<Area[]> {
    const transaction = this.database.transaction('areas', 'readonly');
    const areas = await requestResult(transaction.objectStore('areas').getAll()) as Area[];
    await transactionDone(transaction);
    return areas.sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
  }

  async addArea(name: string, mode: AreaMode = 'explore'): Promise<Area> {
    assertText(name, '领域名称', 40);
    assertOneOf(mode, ['build', 'maintain', 'explore', 'pause'], '领域模式');
    const transaction = this.database.transaction('areas', 'readwrite');
    const store = transaction.objectStore('areas');
    const areas = await requestResult(store.getAll()) as Area[];
    if (areas.some((item) => item.name.trim() === name.trim())) {
      transaction.abort();
      throw new Error('已经有同名领域。');
    }
    if (mode === 'build' && areas.filter((item) => item.mode === 'build').length >= 2) {
      transaction.abort();
      throw new Error('重点建设领域最多两个。');
    }
    const timestamp = nowIso();
    const area: Area = {
      id: crypto.randomUUID(), name: name.trim(), mode, order: Math.max(-1, ...areas.map((item) => item.order)) + 1,
      isDefault: false, createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    store.add(area);
    await transactionDone(transaction);
    return area;
  }

  async saveArea(id: string, patch: Partial<Pick<Area, 'name' | 'mode' | 'order'>>): Promise<Area> {
    const transaction = this.database.transaction('areas', 'readwrite');
    const store = transaction.objectStore('areas');
    const [current, areas] = await Promise.all([
      requestResult(store.get(id)) as Promise<Area | undefined>,
      requestResult(store.getAll()) as Promise<Area[]>,
    ]);
    if (!current) {
      transaction.abort();
      throw new Error('领域不存在。');
    }
    const updated = { ...current, ...patch, updatedAt: nowIso(), version: current.version + 1 };
    assertText(updated.name, '领域名称', 40);
    assertOneOf(updated.mode, ['build', 'maintain', 'explore', 'pause'], '领域模式');
    assertInteger(updated.order, 0, 10_000, '领域排序');
    if (areas.some((item) => item.id !== id && item.name.trim() === updated.name.trim())) {
      transaction.abort();
      throw new Error('已经有同名领域。');
    }
    if (updated.mode === 'build' && areas.filter((item) => item.id !== id && item.mode === 'build').length >= 2) {
      transaction.abort();
      throw new Error('重点建设领域最多两个。');
    }
    store.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async deleteArea(id: string, replacementId?: string): Promise<void> {
    if (replacementId === id) throw new Error('合并目标不能是当前领域。');
    const transaction = this.database.transaction(['areas', 'goals'], 'readwrite');
    const areas = transaction.objectStore('areas');
    const goals = transaction.objectStore('goals');
    const [current, replacement, allGoals] = await Promise.all([
      requestResult(areas.get(id)) as Promise<Area | undefined>,
      replacementId ? requestResult(areas.get(replacementId)) as Promise<Area | undefined> : Promise.resolve(undefined),
      requestResult(goals.getAll()) as Promise<Goal[]>,
    ]);
    if (!current || (replacementId && !replacement)) {
      transaction.abort();
      throw new Error('领域不存在。');
    }
    const linked = allGoals.filter((goal) => goal.areaId === id);
    if (linked.length && !replacementId) {
      transaction.abort();
      throw new Error('这个领域仍有目标，请先选择合并到哪个领域。');
    }
    linked.forEach((goal) => goals.put({ ...goal, areaId: replacementId, updatedAt: nowIso(), version: goal.version + 1 }));
    areas.delete(id);
    await transactionDone(transaction);
  }

  async listBranches(): Promise<GrowthBranch[]> {
    const transaction = this.database.transaction('branches', 'readonly');
    const branches = await requestResult(transaction.objectStore('branches').getAll()) as GrowthBranch[];
    await transactionDone(transaction);
    return branches.sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
  }

  async addBranch(name: string, rootAsset: GrowthBranch['rootAsset'], parentId?: string): Promise<GrowthBranch> {
    assertText(name, '成长分支名称', 60);
    assertOneOf(rootAsset, ROOT_ASSETS.map((item) => item.key), '主要提升');
    const transaction = this.database.transaction('branches', 'readwrite');
    const store = transaction.objectStore('branches');
    const branches = await requestResult(store.getAll()) as GrowthBranch[];
    if (parentId && !branches.some((item) => item.id === parentId)) {
      transaction.abort();
      throw new Error('父成长分支不存在。');
    }
    const timestamp = nowIso();
    const branch: GrowthBranch = {
      id: crypto.randomUUID(), rootAsset, parentId, name: name.trim(),
      order: Math.max(-1, ...branches.map((item) => item.order)) + 1, status: 'active',
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    store.add(branch);
    await transactionDone(transaction);
    return branch;
  }

  async listGoals(): Promise<Goal[]> {
    const transaction = this.database.transaction('goals', 'readonly');
    const goals = await requestResult(transaction.objectStore('goals').getAll()) as Goal[];
    await transactionDone(transaction);
    const roleOrder: Record<GoalRole, number> = { main: 0, secondary: 1, wishlist: 2 };
    return goals.sort((left, right) => roleOrder[left.role] - roleOrder[right.role] || right.updatedAt.localeCompare(left.updatedAt));
  }

  async addGoal(input: Pick<Goal, 'result' | 'why' | 'evidence' | 'nextStep'> & Partial<Pick<Goal, 'areaId' | 'branchId' | 'startDate' | 'targetDate' | 'role'>>): Promise<Goal> {
    assertText(input.result, '目标结果', 160);
    assertText(input.why, '目标意义', 500, true);
    assertText(input.evidence, '目标证据', 500, true);
    assertText(input.nextStep, '目标下一步', 160);
    if (input.startDate !== undefined && !isLocalDate(input.startDate)) throw new Error('目标开始日期无效。');
    if (input.targetDate !== undefined && !isLocalDate(input.targetDate)) throw new Error('目标日期无效。');
    assertOneOf(input.role ?? 'wishlist', ['main', 'secondary', 'wishlist'], '目标角色');
    const transaction = this.database.transaction(['goals', 'areas', 'branches'], 'readwrite');
    const goals = transaction.objectStore('goals');
    const [allGoals, allAreas, allBranches] = await Promise.all([
      requestResult(goals.getAll()) as Promise<Goal[]>,
      requestResult(transaction.objectStore('areas').getAll()) as Promise<Area[]>,
      requestResult(transaction.objectStore('branches').getAll()) as Promise<GrowthBranch[]>,
    ]);
    if (!allAreas.length || !allBranches.length) {
      transaction.abort();
      throw new Error('目标的领域或成长分支不存在。');
    }
    const chosenArea = input.areaId ? allAreas.find((item) => item.id === input.areaId) : undefined;
    const chosenBranch = input.branchId ? allBranches.find((item) => item.id === input.branchId) : undefined;
    if (input.areaId && !chosenArea) {
      transaction.abort();
      throw new Error('目标的领域或成长分支不存在。');
    }
    if (input.branchId && !chosenBranch) {
      transaction.abort();
      throw new Error('目标的领域或成长分支不存在。');
    }
    const fallbackArea = allAreas.find((item) => item.isDefault) ?? [...allAreas].sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt))[0];
    const fallbackBranch = [...allBranches].sort((left, right) => {
      if (left.status === right.status) return left.order - right.order || left.createdAt.localeCompare(right.createdAt);
      return left.status === 'active' ? -1 : 1;
    })[0];
    if (!fallbackArea || !fallbackBranch) {
      transaction.abort();
      throw new Error('目标的领域或成长分支不存在。');
    }
    const requestedRole = input.role ?? 'wishlist';
    const active = allGoals.filter((item) => !['completed', 'abandoned'].includes(item.status));
    const role = requestedRole === 'main' && active.some((item) => item.role === 'main')
      ? 'wishlist'
      : requestedRole === 'secondary' && active.filter((item) => item.role === 'secondary').length >= 2 ? 'wishlist' : requestedRole;
    const timestamp = nowIso();
    const goal: Goal = {
      id: crypto.randomUUID(), result: input.result.trim(), why: input.why.trim(), evidence: input.evidence.trim(),
      nextStep: input.nextStep.trim(), areaId: chosenArea?.id ?? fallbackArea.id, branchId: chosenBranch?.id ?? fallbackBranch.id,
      startDate: input.startDate, targetDate: input.targetDate, role, status: role === 'wishlist' ? 'idea' : 'active',
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    goals.add(goal);
    await transactionDone(transaction);
    return goal;
  }

  async saveGoal(id: string, patch: Partial<Pick<Goal, 'result' | 'why' | 'evidence' | 'nextStep' | 'areaId' | 'branchId' | 'startDate' | 'targetDate' | 'role' | 'status'>>): Promise<Goal> {
    const transaction = this.database.transaction(['goals', 'areas', 'branches', 'quests'], 'readwrite');
    const goals = transaction.objectStore('goals');
    const quests = transaction.objectStore('quests');
    const [current, allGoals] = await Promise.all([
      requestResult(goals.get(id)) as Promise<Goal | undefined>,
      requestResult(goals.getAll()) as Promise<Goal[]>,
    ]);
    if (!current) {
      transaction.abort();
      throw new Error('目标不存在。');
    }
    const timestamp = nowIso();
    const merged = { ...current, ...patch, updatedAt: timestamp, version: current.version + 1 };
    const updated: Goal = merged.status === 'completed'
      ? {
          ...merged,
          completedAt: current.status === 'completed' ? current.completedAt ?? timestamp : timestamp,
          completedDate: current.status === 'completed'
            ? current.completedDate ?? localDateInTimeZone(current.completedAt ?? timestamp)
            : localDate(),
        }
      : (({ completedAt: _completedAt, completedDate: _completedDate, ...openGoal }) => openGoal)(merged);
    assertText(updated.result, '目标结果', 160);
    assertText(updated.why, '目标意义', 500, true);
    assertText(updated.evidence, '目标证据', 500, true);
    assertText(updated.nextStep, '目标下一步', 160);
    assertOneOf(updated.role, ['main', 'secondary', 'wishlist'], '目标角色');
    assertOneOf(updated.status, ['idea', 'active', 'paused', 'completed', 'abandoned'], '目标状态');
    if (!await requestResult(transaction.objectStore('areas').get(updated.areaId)) || !await requestResult(transaction.objectStore('branches').get(updated.branchId))) {
      transaction.abort();
      throw new Error('目标的领域或成长分支不存在。');
    }
    if (updated.startDate !== undefined && !isLocalDate(updated.startDate)) throw new Error('目标开始日期无效。');
    if (updated.targetDate !== undefined && !isLocalDate(updated.targetDate)) throw new Error('目标日期无效。');
    const shouldCloseQuestFlow = !goalIsActionable(updated);
    if (shouldCloseQuestFlow) {
      const allQuests = await requestResult(quests.getAll()) as Quest[];
      for (const quest of allQuests.filter((item) => item.sourceType === 'goal' && item.sourceId === id
        && (item.status === 'pending' || item.systemRetiredReason === 'capacity'))) {
        quests.put(systemRetireQuest(quest, 'source-invalidated', timestamp));
      }
    }
    if (!['completed', 'abandoned'].includes(updated.status)) {
      const otherActive = allGoals.filter((item) => item.id !== id && !['completed', 'abandoned'].includes(item.status));
      if (updated.role === 'main' && otherActive.some((item) => item.role === 'main')) {
        transaction.abort();
        throw new Error('当前已经有一个主目标。');
      }
      if (updated.role === 'secondary' && otherActive.filter((item) => item.role === 'secondary').length >= 2) {
        transaction.abort();
        throw new Error('当前已经有两个次要目标。');
      }
    }
    goals.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async listMilestones(goalId?: string): Promise<Milestone[]> {
    const transaction = this.database.transaction('milestones', 'readonly');
    const store = transaction.objectStore('milestones');
    const values = await requestResult(goalId ? store.index('byGoalId').getAll(goalId) : store.getAll()) as Milestone[];
    await transactionDone(transaction);
    return values.sort((left, right) => (left.order ?? -1) - (right.order ?? -1) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  async replaceGoalPlan(
    goalId: string,
    patch: Pick<Goal, 'result' | 'evidence' | 'nextStep'>,
    replacements: Array<{ description: string; evidence: string }>,
    expectedGoalVersion?: number,
  ): Promise<{ goal: Goal; milestones: Milestone[] }> {
    assertText(patch.result, '目标结果', 160);
    assertText(patch.evidence, '目标证据', 500);
    assertText(patch.nextStep, '目标下一步', 160);
    if (replacements.length < 2 || replacements.length > 5) throw new Error('新计划需要保留 2—5 个阶段目标。');
    replacements.forEach((item) => { assertText(item.description, '阶段目标描述', 200); assertText(item.evidence, '阶段目标完成标准', 500); });
    if (new Set(replacements.map((item) => item.description.trim())).size !== replacements.length) throw new Error('阶段目标不能重复。');
    const transaction = this.database.transaction(['goals', 'milestones', 'quests'], 'readwrite');
    const goals = transaction.objectStore('goals');
    const milestones = transaction.objectStore('milestones');
    const quests = transaction.objectStore('quests');
    const current = await requestResult(goals.get(goalId)) as Goal | undefined;
    if (!current) {
      transaction.abort();
      throw new Error('目标不存在。');
    }
    if (expectedGoalVersion !== undefined && current.version !== expectedGoalVersion) {
      transaction.abort();
      throw new Error('目标已经改变，请重新生成拆解草案。');
    }
    const timestamp = nowIso();
    const goal: Goal = {
      ...current, result: patch.result.trim(), evidence: patch.evidence.trim(), nextStep: patch.nextStep.trim(),
      updatedAt: timestamp, version: current.version + 1,
    };
    const priorMilestones = await requestResult(milestones.index('byGoalId').getAll(goalId)) as Milestone[];
    priorMilestones.filter((item) => item.status === 'pending').forEach((item) => milestones.put({
      ...item, status: 'superseded', updatedAt: timestamp, version: item.version + 1,
    }));
    const created = replacements.map((item, order): Milestone => ({
      id: crypto.randomUUID(), goalId, order, description: item.description.trim(), evidence: item.evidence.trim(), status: 'pending', xpSettled: false,
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    }));
    created.forEach((item) => milestones.add(item));
    const allQuests = await requestResult(quests.getAll()) as Quest[];
    allQuests.filter((item) => item.sourceType === 'goal' && item.sourceId === goalId
      && (item.status === 'pending' || item.systemRetiredReason === 'capacity'))
      .forEach((item) => quests.put(systemRetireQuest(item, 'source-invalidated', timestamp)));
    goals.put(goal);
    await transactionDone(transaction);
    return { goal, milestones: created };
  }

  async addMilestone(goalId: string, description: string, evidence: string): Promise<Milestone> {
    assertText(description, '阶段目标描述', 200);
    assertText(evidence, '阶段目标完成标准', 500);
    const transaction = this.database.transaction(['goals', 'milestones'], 'readwrite');
    const milestoneStore = transaction.objectStore('milestones');
    if (!await requestResult(transaction.objectStore('goals').get(goalId))) {
      transaction.abort();
      throw new Error('目标不存在。');
    }
    const existing = await requestResult(milestoneStore.index('byGoalId').getAll(goalId)) as Milestone[];
    const timestamp = nowIso();
    const milestone: Milestone = {
      id: crypto.randomUUID(), goalId, order: Math.max(-1, ...existing.map((item, index) => item.order ?? index)) + 1, description: description.trim(), evidence: evidence.trim(),
      status: 'pending', xpSettled: false, createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    milestoneStore.add(milestone);
    await transactionDone(transaction);
    return milestone;
  }

  async completeMilestone(id: string, date = localDate()): Promise<Milestone> {
    if (!isLocalDate(date)) throw new Error('阶段目标日期无效。');
    const transaction = this.database.transaction(['milestones', 'goals', 'xpLedger'], 'readwrite');
    const milestones = transaction.objectStore('milestones');
    const current = await requestResult(milestones.get(id)) as Milestone | undefined;
    if (!current) {
      transaction.abort();
      throw new Error('阶段目标不存在。');
    }
    if (current.status === 'superseded') {
      transaction.abort();
      throw new Error('这个阶段目标已被新计划替换。');
    }
    const goal = await requestResult(transaction.objectStore('goals').get(current.goalId)) as Goal | undefined;
    if (!goal) {
      transaction.abort();
      throw new Error('阶段目标所属的目标不存在。');
    }
    const timestamp = nowIso();
    const ledger = transaction.objectStore('xpLedger');
    await settleMilestoneXp(ledger, current.id, goal.branchId, date, timestamp);
    if (current.status === 'completed' && current.xpSettled) {
      await transactionDone(transaction);
      return current;
    }
    const updated = { ...current, status: 'completed' as const, completedAt: timestamp, completionSourceQuestId: undefined, xpSettled: true, updatedAt: timestamp, version: current.version + 1 };
    milestones.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async undoMilestone(id: string): Promise<Milestone> {
    const transaction = this.database.transaction(['milestones', 'xpLedger'], 'readwrite');
    const milestones = transaction.objectStore('milestones');
    const current = await requestResult(milestones.get(id)) as Milestone | undefined;
    if (!current || current.status !== 'completed') {
      transaction.abort();
      throw new Error('没有可撤销的阶段目标完成记录。');
    }
    const timestamp = nowIso();
    const ledger = transaction.objectStore('xpLedger');
    const settlement = await requestResult(ledger.index('bySettlementKey').get(`${id}:1`)) as XpLedger | undefined;
    if (settlement && !settlement.reversedAt) ledger.put({ ...settlement, reversedAt: timestamp, updatedAt: timestamp, version: settlement.version + 1 });
    const updated = { ...current, status: 'pending' as const, completedAt: undefined, completionSourceQuestId: undefined, xpSettled: false, updatedAt: timestamp, version: current.version + 1 };
    milestones.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async listHabits(): Promise<Habit[]> {
    const transaction = this.database.transaction('habits', 'readonly');
    const habits = await requestResult(transaction.objectStore('habits').getAll()) as Habit[];
    await transactionDone(transaction);
    return habits.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listHabitLogs(habitId?: string): Promise<HabitLog[]> {
    const transaction = this.database.transaction('habitLogs', 'readonly');
    const store = transaction.objectStore('habitLogs');
    const values = await requestResult(habitId
      ? store.index('byHabitDate').getAll(IDBKeyRange.bound([habitId, ''], [habitId, '\uffff']))
      : store.getAll()) as HabitLog[];
    await transactionDone(transaction);
    return values.sort((left, right) => left.localDate.localeCompare(right.localDate));
  }

  async addHabit(
    input: Pick<Habit, 'name' | 'minimumAction' | 'scheduleDays' | 'dimension' | 'branchId' | 'difficulty'> & Partial<Pick<Habit, 'trigger' | 'bonusEnabled' | 'targetCount' | 'countUnit'>>,
    effectiveDate = localDate(),
  ): Promise<Habit> {
    if (!isLocalDate(effectiveDate)) throw new Error('习惯生效日期无效。');
    assertText(input.name, '习惯名称', 60);
    assertText(input.minimumAction, '习惯最小动作', 160);
    if (input.targetCount !== undefined) {
      assertInteger(input.targetCount, 2, 1_000, '习惯目标次数');
      assertText(input.countUnit, '习惯计数单位', 20);
    } else if (input.countUnit !== undefined) throw new Error('习惯计数设置无效。');
    if (!input.scheduleDays.length || new Set(input.scheduleDays).size !== input.scheduleDays.length) throw new Error('至少选择一个计划日。');
    input.scheduleDays.forEach((day) => assertInteger(day, 1, 7, '习惯计划日'));
    assertOneOf(input.dimension, DIMENSIONS.map((item) => item.key), '习惯状态维度');
    assertOneOf(input.difficulty, Object.keys(DIFFICULTY_XP), '习惯难度');
    const transaction = this.database.transaction(['habits', 'branches'], 'readwrite');
    const habits = transaction.objectStore('habits');
    const [allHabits, branch] = await Promise.all([
      requestResult(habits.getAll()) as Promise<Habit[]>,
      requestResult(transaction.objectStore('branches').get(input.branchId)) as Promise<GrowthBranch | undefined>,
    ]);
    if (!branch) {
      transaction.abort();
      throw new Error('成长分支不存在。');
    }
    if (input.bonusEnabled && allHabits.filter((item) => item.status === 'active' && item.bonusEnabled).length >= 3) {
      transaction.abort();
      throw new Error('每日可选习惯最多三个，请先暂停或替换一个。');
    }
    const timestamp = nowIso();
    const habit: Habit = {
      id: crypto.randomUUID(), name: input.name.trim(), minimumAction: input.minimumAction.trim(),
      targetCount: input.targetCount, countUnit: input.countUnit?.trim(),
      scheduleDays: [...input.scheduleDays].sort(), trigger: input.trigger?.trim() || undefined,
      scheduleHistory: [{
        effectiveFrom: effectiveDate,
        scheduleDays: [...input.scheduleDays].sort(),
        trackingEnabled: Boolean(input.bonusEnabled),
      }],
      dimension: input.dimension, branchId: input.branchId, difficulty: input.difficulty,
      status: 'active', bonusEnabled: Boolean(input.bonusEnabled),
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    habits.add(habit);
    await transactionDone(transaction);
    return habit;
  }

  async saveHabit(
    id: string,
    patch: Partial<Pick<Habit, 'name' | 'minimumAction' | 'scheduleDays' | 'trigger' | 'dimension' | 'branchId' | 'difficulty' | 'status' | 'bonusEnabled' | 'targetCount' | 'countUnit'>>,
    effectiveDate = localDate(),
  ): Promise<Habit> {
    if (!isLocalDate(effectiveDate)) throw new Error('习惯生效日期无效。');
    const transaction = this.database.transaction(['habits', 'branches', 'quests'], 'readwrite');
    const habits = transaction.objectStore('habits');
    const [current, allHabits] = await Promise.all([
      requestResult(habits.get(id)) as Promise<Habit | undefined>,
      requestResult(habits.getAll()) as Promise<Habit[]>,
    ]);
    if (!current) {
      transaction.abort();
      throw new Error('习惯不存在。');
    }
    const updated = { ...current, ...patch, scheduleDays: [...(patch.scheduleDays ?? current.scheduleDays)].sort(), updatedAt: nowIso(), version: current.version + 1 };
    assertText(updated.name, '习惯名称', 60);
    assertText(updated.minimumAction, '习惯最小动作', 160);
    if (updated.targetCount !== undefined) {
      assertInteger(updated.targetCount, 2, 1_000, '习惯目标次数');
      assertText(updated.countUnit, '习惯计数单位', 20);
    } else if (updated.countUnit !== undefined) throw new Error('习惯计数设置无效。');
    if (!updated.scheduleDays.length || new Set(updated.scheduleDays).size !== updated.scheduleDays.length) {
      transaction.abort();
      throw new Error('至少选择一个计划日。');
    }
    updated.scheduleDays.forEach((day) => assertInteger(day, 1, 7, '习惯计划日'));
    assertOneOf(updated.dimension, DIMENSIONS.map((item) => item.key), '习惯状态维度');
    assertOneOf(updated.difficulty, Object.keys(DIFFICULTY_XP), '习惯难度');
    assertOneOf(updated.status, ['active', 'paused', 'ended'], '习惯状态');
    const branch = await requestResult(transaction.objectStore('branches').get(updated.branchId)) as GrowthBranch | undefined;
    if (!branch) {
      transaction.abort();
      throw new Error('成长分支不存在。');
    }
    if (updated.status === 'active' && updated.bonusEnabled && allHabits.filter((item) => item.id !== id && item.status === 'active' && item.bonusEnabled).length >= 3) {
      transaction.abort();
      throw new Error('每日可选习惯最多三个，请先暂停或替换一个。');
    }
    const trackingEnabled = updated.status === 'active' && updated.bonusEnabled;
    const currentTrackingEnabled = current.status === 'active' && current.bonusEnabled;
    const scheduleChanged = updated.scheduleDays.join(',') !== [...current.scheduleDays].sort().join(',');
    if (scheduleChanged || trackingEnabled !== currentTrackingEnabled) {
      const period = { effectiveFrom: effectiveDate, scheduleDays: [...updated.scheduleDays], trackingEnabled };
      updated.scheduleHistory = [...habitScheduleHistory(current).filter((item) => item.effectiveFrom !== effectiveDate), period]
        .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
    }
    const quests = transaction.objectStore('quests');
    const openBonuses = (await requestResult(quests.index('bySourceId').getAll(id)) as Quest[])
      .filter((quest) => quest.type === 'bonus' && quest.sourceType === 'habit'
        && (quest.status === 'pending' || quest.systemRetiredReason === 'capacity'));
    for (const quest of openBonuses) {
      const weekday = parseLocalDate(quest.localDate).getDay() || 7;
      const isCapacityCandidate = quest.systemRetiredReason === 'capacity';
      const withinChangedSchedule = quest.localDate >= effectiveDate || isCapacityCandidate;
      const retireReason: QuestSystemRetiredReason | null = withinChangedSchedule && !trackingEnabled
        ? 'tracking-disabled'
        : withinChangedSchedule && scheduleChanged && !updated.scheduleDays.includes(weekday) ? 'schedule-changed' : null;
      if (retireReason) quests.put(systemRetireQuest(quest, retireReason, updated.updatedAt));
    }
    habits.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async listQuests(date?: string): Promise<Quest[]> {
    const transaction = this.database.transaction('quests', 'readonly');
    const store = transaction.objectStore('quests');
    const quests = await requestResult(date ? store.index('byLocalDate').getAll(date) : store.getAll()) as Quest[];
    await transactionDone(transaction);
    const typeOrder: Record<QuestType, number> = { main: 0, bonus: 1, side: 2 };
    return quests.filter((quest) => !quest.userRemovedAt)
      .sort((left, right) => typeOrder[left.type] - typeOrder[right.type] || left.createdAt.localeCompare(right.createdAt));
  }

  /** Every overdue action remains user-decided so a real late completion can still be recorded. */
  async listPendingBefore(date = localDate()): Promise<Quest[]> {
    if (!isLocalDate(date)) throw new Error('任务日期无效。');
    const quests = await this.listQuests();
    return quests
      .filter((quest) => quest.status === 'pending' && quest.localDate < date)
      .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.createdAt.localeCompare(right.createdAt));
  }

  async addQuest(input: Pick<Quest, 'localDate' | 'type' | 'sourceType' | 'title' | 'reason' | 'minimumAction' | 'estimatedMinutes' | 'difficulty'> & Partial<Pick<Quest, 'sourceId' | 'actionId' | 'dimension' | 'branchId' | 'milestoneId' | 'completionCriteria' | 'aiSuggested' | 'userModified' | 'deadlineAt' | 'targetCount' | 'countUnit'>>): Promise<Quest> {
    if (!isLocalDate(input.localDate)) throw new Error('任务日期无效。');
    assertOneOf(input.type, ['main', 'bonus', 'side'], '任务类型');
    assertOneOf(input.sourceType, ['goal', 'habit', 'recovery', 'manual'], '任务来源');
    assertOneOf(input.difficulty, Object.keys(DIFFICULTY_XP), '任务难度');
    if (input.dimension !== undefined) assertOneOf(input.dimension, DIMENSIONS.map((item) => item.key), '任务状态维度');
    assertText(input.title, '任务标题', 160);
    assertText(input.reason, '任务理由', 500);
    assertText(input.minimumAction, '任务最小动作', 200);
    if (input.completionCriteria !== undefined) assertText(input.completionCriteria, '任务完成标准', 500);
    assertInteger(input.estimatedMinutes, 1, 24 * 60, '任务预计时间');
    if (input.deadlineAt !== undefined) assertTimestamp(input.deadlineAt, '任务截止时间');
    if (input.targetCount !== undefined) {
      assertInteger(input.targetCount, 2, 1_000, '任务目标次数');
      assertText(input.countUnit, '任务计数单位', 20);
    } else if (input.countUnit !== undefined) throw new Error('任务计数设置无效。');
    const validatedActionId = validateActionId(input.actionId ?? crypto.randomUUID());
    const transaction = this.database.transaction(['quests', 'goals', 'habits', 'branches', 'milestones'], 'readwrite');
    const quests = transaction.objectStore('quests');
    const existing = await requestResult(quests.index('byLocalDate').getAll(input.localDate)) as Quest[];
    if (!canAddQuest(input.type, existing.filter((item) => item.status === 'pending').map((item) => item.type))) {
      transaction.abort();
      throw new Error('今天这类任务已经达到上限。');
    }
    if (input.sourceType === 'goal' && (!input.sourceId || !await requestResult(transaction.objectStore('goals').get(input.sourceId)))) {
      transaction.abort();
      throw new Error('任务所属目标不存在。');
    }
    if (input.sourceType === 'habit' && (!input.sourceId || !await requestResult(transaction.objectStore('habits').get(input.sourceId)))) {
      transaction.abort();
      throw new Error('任务所属习惯不存在。');
    }
    if (input.milestoneId) {
      const milestone = await requestResult(transaction.objectStore('milestones').get(input.milestoneId)) as Milestone | undefined;
      if (!milestone || input.sourceType !== 'goal' || milestone.goalId !== input.sourceId) {
        transaction.abort();
        throw new Error('任务关联的阶段目标与目标不一致。');
      }
    }
    if (input.branchId && !await requestResult(transaction.objectStore('branches').get(input.branchId))) {
      transaction.abort();
      throw new Error('任务成长分支不存在。');
    }
    const timestamp = nowIso();
    const quest: Quest = {
      id: crypto.randomUUID(), localDate: input.localDate, type: input.type, sourceType: input.sourceType,
      sourceId: input.sourceId, milestoneId: input.milestoneId, actionId: validatedActionId, settlementVersion: 0,
      title: input.title.trim(), reason: input.reason.trim(), minimumAction: input.minimumAction.trim(), completionCriteria: input.completionCriteria?.trim() || input.minimumAction.trim(),
      estimatedMinutes: input.estimatedMinutes, difficulty: input.difficulty, dimension: input.dimension,
      deadlineAt: input.deadlineAt, targetCount: input.targetCount, progressCount: input.targetCount ? 0 : undefined, countUnit: input.countUnit?.trim(),
      branchId: input.branchId, status: 'pending', aiSuggested: input.aiSuggested ?? false, userModified: input.userModified ?? true,
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    quests.add(quest);
    await transactionDone(transaction);
    return quest;
  }

  async savePendingQuest(id: string, patch: Partial<Pick<Quest, 'localDate' | 'title' | 'reason' | 'minimumAction' | 'completionCriteria' | 'estimatedMinutes' | 'difficulty' | 'deadlineAt' | 'targetCount' | 'countUnit'>>): Promise<Quest> {
    const transaction = this.database.transaction(['quests', 'goals', 'milestones'], 'readwrite');
    const quests = transaction.objectStore('quests');
    const current = await requestResult(quests.get(id)) as Quest | undefined;
    if (!current || current.status !== 'pending') {
      transaction.abort();
      throw new Error('只有待完成任务可以调整。');
    }
    const updated = {
      ...current,
      ...patch,
      progressCount: 'targetCount' in patch ? (patch.targetCount ? current.progressCount ?? 0 : undefined) : current.progressCount,
      userModified: true,
      updatedAt: nowIso(),
      version: current.version + 1,
    };
    if (!isLocalDate(updated.localDate)) {
      transaction.abort();
      throw new Error('任务日期无效。');
    }
    assertText(updated.title, '任务标题', 160);
    assertText(updated.reason, '任务理由', 500);
    assertText(updated.minimumAction, '任务最小动作', 200);
    if (updated.completionCriteria !== undefined) assertText(updated.completionCriteria, '任务完成标准', 500);
    assertInteger(updated.estimatedMinutes, 1, 24 * 60, '任务预计时间');
    assertOneOf(updated.difficulty, Object.keys(DIFFICULTY_XP), '任务难度');
    if (updated.deadlineAt !== undefined) assertTimestamp(updated.deadlineAt, '任务截止时间');
    if (updated.targetCount !== undefined) {
      assertInteger(updated.targetCount, Math.max(2, (updated.progressCount ?? 0) + 1), 1_000, '任务目标次数');
      assertText(updated.countUnit, '任务计数单位', 20);
    } else if (updated.countUnit !== undefined || updated.progressCount !== undefined) throw new Error('任务计数设置无效。');
    const destination = await requestResult(quests.index('byLocalDate').getAll(updated.localDate)) as Quest[];
    if (!canAddQuest(updated.type, destination.filter((item) => item.id !== id && item.status === 'pending').map((item) => item.type))) {
      transaction.abort();
      throw new Error('目标日期的这类任务已经达到上限。');
    }
    quests.put(updated);
    if (updated.sourceType === 'goal' && updated.sourceId) {
      const [goal, allQuests, milestones] = await Promise.all([
        requestResult(transaction.objectStore('goals').get(updated.sourceId)) as Promise<Goal | undefined>,
        requestResult(quests.getAll()) as Promise<Quest[]>,
        requestResult(transaction.objectStore('milestones').index('byGoalId').getAll(updated.sourceId)) as Promise<Milestone[]>,
      ]);
      if (goal) {
        const projected = allQuests.map((item) => item.id === updated.id ? updated : item);
        const nextStep = resolveGoalNextStep(goal, projected, milestones);
        if (goal.nextStep !== nextStep) transaction.objectStore('goals').put({ ...goal, nextStep, updatedAt: updated.updatedAt, version: goal.version + 1 });
      }
    }
    await transactionDone(transaction);
    return updated;
  }

  async removePendingQuest(id: string): Promise<void> {
    const transaction = this.database.transaction(['quests', 'goals', 'milestones'], 'readwrite');
    const quests = transaction.objectStore('quests');
    const current = await requestResult(quests.get(id)) as Quest | undefined;
    if (!current || (current.status !== 'pending' && current.systemRetiredReason !== 'capacity') || current.userRemovedAt) {
      transaction.abort();
      throw new Error('只有待完成任务可以删除。');
    }
    const timestamp = nowIso();
    const removed = restoreSystemRetiredQuest(current, {
      status: 'exempt', userRemovedAt: timestamp, updatedAt: timestamp, version: current.version + 1,
    });
    quests.put(removed);
    if (removed.sourceType === 'goal' && removed.sourceId) {
      const [goal, allQuests, milestones] = await Promise.all([
        requestResult(transaction.objectStore('goals').get(removed.sourceId)) as Promise<Goal | undefined>,
        requestResult(quests.getAll()) as Promise<Quest[]>,
        requestResult(transaction.objectStore('milestones').index('byGoalId').getAll(removed.sourceId)) as Promise<Milestone[]>,
      ]);
      if (goal) {
        const projected = allQuests.map((item) => item.id === removed.id ? removed : item);
        const nextStep = resolveGoalNextStep(goal, projected, milestones);
        if (goal.nextStep !== nextStep) transaction.objectStore('goals').put({ ...goal, nextStep, updatedAt: timestamp, version: goal.version + 1 });
      }
    }
    await transactionDone(transaction);
  }

  async changeQuestProgress(id: string, delta: -1 | 1): Promise<Quest> {
    const transaction = this.database.transaction('quests', 'readwrite');
    const store = transaction.objectStore('quests');
    const quest = await requestResult(store.get(id)) as Quest | undefined;
    if (!quest || quest.status !== 'pending' || !quest.targetCount) {
      transaction.abort();
      throw new Error('这不是可计数的待完成任务。');
    }
    const progressCount = (quest.progressCount ?? 0) + delta;
    if (progressCount < 0 || progressCount >= quest.targetCount) {
      transaction.abort();
      throw new Error(progressCount >= quest.targetCount ? '最后一次打卡会直接完成任务。' : '打卡次数不能小于零。');
    }
    const updated = { ...quest, progressCount, updatedAt: nowIso(), version: quest.version + 1 };
    store.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async ensureTodayBonusQuests(date = localDate()): Promise<Quest[]> {
    if (!isLocalDate(date)) throw new Error('任务日期无效。');
    const transaction = this.database.transaction(['habits', 'quests'], 'readwrite');
    const quests = transaction.objectStore('quests');
    const [habits, allQuests] = await Promise.all([
      requestResult(transaction.objectStore('habits').getAll()) as Promise<Habit[]>,
      requestResult(quests.getAll()) as Promise<Quest[]>,
    ]);
    const timestamp = nowIso();
    const current = allQuests.filter((item) => item.localDate === date);
    const weekday = parseLocalDate(date).getDay() || 7;
    const created: Quest[] = [];
    for (const habit of habits.filter((item) => {
      const schedule = habitScheduleOn(item, date);
      return item.status === 'active' && item.bonusEnabled && schedule?.trackingEnabled && schedule.scheduleDays.includes(weekday);
    })) {
      if (current.some((item) => item.sourceType === 'habit' && item.sourceId === habit.id)) continue;
      if (!canAddQuest('bonus', current.filter((item) => item.status === 'pending').map((item) => item.type))) break;
      const quest: Quest = {
        id: crypto.randomUUID(), localDate: date, type: 'bonus', sourceType: 'habit', sourceId: habit.id,
        actionId: validateActionId(`habit:${habit.id}:${date}`), settlementVersion: 0, title: habit.name,
        reason: '这是你主动放入每日可选任务的习惯。', minimumAction: habit.minimumAction,
        targetCount: habit.targetCount, progressCount: habit.targetCount ? 0 : undefined, countUnit: habit.countUnit,
        estimatedMinutes: 10, difficulty: habit.difficulty, dimension: habit.dimension, branchId: habit.branchId,
        status: 'pending', aiSuggested: false, userModified: false,
        createdAt: timestamp, updatedAt: timestamp, version: 1,
      };
      quests.add(quest);
      current.push(quest);
      created.push(quest);
    }
    await transactionDone(transaction);
    return created;
  }

  async feedbackQuest(id: string, result: FeedbackResult, note = '', actual = '', difficulty?: Difficulty, stateDelta = 0, completedDate?: string): Promise<QuestFeedback> {
    assertOneOf(result, ['completed', 'partial', 'skipped', 'exempt'], '任务反馈结果');
    assertText(note, '任务反馈', 2_000, true);
    assertText(actual, '实际完成内容', 2_000, true);
    assertInteger(stateDelta, -15, 15, '状态变化');
    if (completedDate !== undefined && !isLocalDate(completedDate)) throw new Error('任务实际完成日期无效。');
    if (result === 'skipped' || result === 'exempt') stateDelta = 0;
    const transaction = this.database.transaction(['quests', 'questFeedback', 'habitLogs', 'xpLedger', 'observations', 'milestones', 'goals'], 'readwrite');
    const feedback = await this.writeQuestFeedback(transaction, id, result, note, actual, difficulty, stateDelta, completedDate);
    await transactionDone(transaction);
    return feedback;
  }

  /** Feedback, XP, milestone settlement and the next goal action commit or abort together. */
  async feedbackAndProgressQuest(id: string, result: FeedbackResult, note = '', actual = '', difficulty?: Difficulty, stateDelta = 0, completedDate?: string): Promise<QuestFeedbackProgressionResult> {
    assertOneOf(result, ['completed', 'partial', 'skipped', 'exempt'], '任务反馈结果');
    assertText(note, '任务反馈', 2_000, true);
    assertText(actual, '实际完成内容', 2_000, true);
    assertInteger(stateDelta, -15, 15, '状态变化');
    if (completedDate !== undefined && !isLocalDate(completedDate)) throw new Error('任务实际完成日期无效。');
    if (result === 'skipped' || result === 'exempt') stateDelta = 0;
    const transaction = this.database.transaction(['quests', 'questFeedback', 'habitLogs', 'xpLedger', 'observations', 'milestones', 'goals'], 'readwrite');
    try {
      const feedback = await this.writeQuestFeedback(transaction, id, result, note, actual, difficulty, stateDelta, completedDate);
      const progression = result === 'completed' || result === 'partial'
        ? await this.progressGoalQuest(transaction, id, feedback.completedDate ?? localDate(), result)
        : { followUp: null, milestoneCompleted: null, goalReady: false };
      await transactionDone(transaction);
      return { feedback, ...progression };
    } catch (error) {
      abortTransaction(transaction);
      throw error;
    }
  }

  private async writeQuestFeedback(
    transaction: IDBTransaction,
    id: string,
    result: FeedbackResult,
    note: string,
    actual: string,
    difficulty: Difficulty | undefined,
    stateDelta: number,
    completedDate: string | undefined,
  ): Promise<QuestFeedback> {
    const quests = transaction.objectStore('quests');
    const feedbackStore = transaction.objectStore('questFeedback');
    const ledgerStore = transaction.objectStore('xpLedger');
    const quest = await requestResult(quests.get(id)) as Quest | undefined;
    if (!quest) {
      transaction.abort();
      throw new Error('任务不存在。');
    }
    if (quest.systemRetiredAt) {
      transaction.abort();
      throw new Error('系统已收束该任务，不能写入用户反馈。');
    }
    const timestamp = nowIso();
    const priorFeedback = await requestResult(feedbackStore.index('byQuestId').getAll(id)) as QuestFeedback[];
    const activePrior = priorFeedback.filter((item) => !item.undoneAt)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
    const actualCompletedDate = completedDate ?? activePrior?.completedDate ?? (activePrior ? quest.localDate : localDate());
    if (!isLocalDate(actualCompletedDate)) {
      transaction.abort();
      throw new Error('任务实际完成日期无效。');
    }
    priorFeedback.filter((item) => !item.undoneAt).forEach((item) => feedbackStore.put({ ...item, undoneAt: timestamp, updatedAt: timestamp, version: item.version + 1 }));
    const observations = transaction.objectStore('observations');
    const priorEvidenceIds = new Set(priorFeedback.filter((item) => !item.undoneAt).map((item) => item.id));
    const priorObservations = await requestResult(observations.getAll()) as StateObservation[];
    priorObservations.filter((item) => item.evidenceId && priorEvidenceIds.has(item.evidenceId) && item.active)
      .forEach((item) => observations.put({ ...item, active: false, updatedAt: timestamp, version: item.version + 1 }));
    const priorLedger = quest.status !== 'pending' && quest.status !== result
      ? await rollbackGoalQuestProgression(quest, result, transaction, timestamp)
      : await requestResult(ledgerStore.getAll()) as XpLedger[];
    const finalDifficulty = difficulty ?? quest.difficulty;
    const reuseSettlement = Boolean(activePrior && activePrior.result === result && finalDifficulty === quest.difficulty && quest.settlementVersion > 0);
    if (!reuseSettlement) {
      priorLedger.filter((item) => item.sourceType === 'quest' && item.sourceId === id && !item.reversedAt)
        .forEach((item) => ledgerStore.put({ ...item, reversedAt: timestamp, updatedAt: timestamp, version: item.version + 1 }));
    }
    const settlementVersion = reuseSettlement ? quest.settlementVersion : quest.settlementVersion + 1;
    const settlementKey = `${quest.actionId}:${settlementVersion}`;
    const xp = questXp(finalDifficulty, result);
    const activeSameAction = priorLedger.some((item) => !item.reversedAt && item.sourceId !== id && item.settlementKey.startsWith(`${quest.actionId}:`));
    if (xp > 0 && quest.branchId && !activeSameAction) {
      const existingSettlement = await requestResult(ledgerStore.index('bySettlementKey').get(settlementKey)) as XpLedger | undefined;
      const value: XpLedger = {
        id: existingSettlement?.id ?? crypto.randomUUID(), settlementKey, sourceType: 'quest', sourceId: id,
        branchId: quest.branchId, baseXp: DIFFICULTY_XP[finalDifficulty], ratio: result === 'partial' ? 0.5 : 1,
        finalXp: xp, difficulty: finalDifficulty, localDate: actualCompletedDate,
        createdAt: existingSettlement?.createdAt ?? timestamp, updatedAt: timestamp, version: (existingSettlement?.version ?? 0) + 1,
      };
      existingSettlement ? ledgerStore.put(value) : ledgerStore.add(value);
    }
    const previousCompletedDate = activePrior?.completedDate ?? quest.localDate;
    if (quest.sourceType === 'goal' && quest.sourceId && quest.milestoneId && quest.status === 'completed'
      && result === 'completed' && activePrior?.result === 'completed' && previousCompletedDate !== actualCompletedDate) {
      const [goal, milestone] = await Promise.all([
        requestResult(transaction.objectStore('goals').get(quest.sourceId)) as Promise<Goal | undefined>,
        requestResult(transaction.objectStore('milestones').get(quest.milestoneId)) as Promise<Milestone | undefined>,
      ]);
      if (goal && milestone?.status === 'completed' && milestone.completionSourceQuestId === quest.id) {
        const settlement = await settleMilestoneXp(ledgerStore, milestone.id, goal.branchId, actualCompletedDate, timestamp);
        if (settlement.changed) transaction.objectStore('milestones').put({
          ...milestone, completedAt: timestamp, xpSettled: true, updatedAt: timestamp, version: milestone.version + 1,
        });
      }
    }

    const feedback: QuestFeedback = {
      id: crypto.randomUUID(), questId: id, result, note, actual, settlementVersion, completedDate: actualCompletedDate,
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    feedbackStore.add(feedback);
    if (quest.dimension && stateDelta !== 0) {
      observations.add({
        id: crypto.randomUUID(), assessmentId: feedback.id, localDate: actualCompletedDate, dimension: quest.dimension,
        kind: 'event-impact', delta: stateDelta, evidenceId: feedback.id,
        reason: `由你确认的任务反馈：${quest.title}`, active: true, observedAt: timestamp,
        createdAt: timestamp, updatedAt: timestamp, version: 1,
      } satisfies StateObservation);
    }
    quests.put({
      ...quest,
      difficulty: finalDifficulty,
      status: result,
      progressCount: quest.targetCount
        ? result === 'completed' ? quest.targetCount : Math.min(quest.progressCount ?? 0, quest.targetCount - 1)
        : quest.progressCount,
      settlementVersion,
      updatedAt: timestamp,
      version: quest.version + 1,
    });
    if (quest.sourceType === 'habit' && quest.sourceId) {
      const logs = transaction.objectStore('habitLogs');
      const existingLog = await requestResult(logs.index('byHabitDate').get([quest.sourceId, quest.localDate])) as HabitLog | undefined;
      const log: HabitLog = {
        id: existingLog?.id ?? crypto.randomUUID(), habitId: quest.sourceId, localDate: quest.localDate,
        result, questId: id, settlementKey: xp > 0 && !activeSameAction ? settlementKey : undefined,
        createdAt: existingLog?.createdAt ?? timestamp, updatedAt: timestamp, version: (existingLog?.version ?? 0) + 1,
      };
      existingLog ? logs.put(log) : logs.add(log);
    }
    return feedback;
  }

  /** Settle a confirmed milestone action and create at most one editable next action. */
  async createGoalFollowUpQuest(id: string, date = localDate(), mode: 'completed' | 'partial' = 'completed'): Promise<GoalProgressionResult> {
    if (!isLocalDate(date)) throw new Error('任务日期无效。');
    const transaction = this.database.transaction(['quests', 'questFeedback', 'goals', 'milestones', 'xpLedger'], 'readwrite');
    try {
      const progression = await this.progressGoalQuest(transaction, id, date, mode);
      await transactionDone(transaction);
      return progression;
    } catch (error) {
      abortTransaction(transaction);
      throw error;
    }
  }

  private async progressGoalQuest(transaction: IDBTransaction, id: string, date: string, mode: 'completed' | 'partial'): Promise<GoalProgressionResult> {
    const empty = { followUp: null, milestoneCompleted: null, goalReady: false };
    const quests = transaction.objectStore('quests');
    const quest = await requestResult(quests.get(id)) as Quest | undefined;
    if (!quest || (quest.status !== 'completed' && !(mode === 'partial' && quest.status === 'partial')) || quest.sourceType !== 'goal' || !quest.sourceId) {
      return empty;
    }
    const goal = await requestResult(transaction.objectStore('goals').get(quest.sourceId)) as Goal | undefined;
    if (!goal || !goalIsActionable(goal)) {
      return empty;
    }
    const milestoneStore = transaction.objectStore('milestones');
    const milestones = (await requestResult(milestoneStore.index('byGoalId').getAll(goal.id)) as Milestone[])
      .sort((left, right) => (left.order ?? -1) - (right.order ?? -1) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    let milestoneCompleted: Milestone | null = null;
    const linked = quest.milestoneId ? milestones.find((item) => item.id === quest.milestoneId) : undefined;
    if (mode === 'completed' && linked?.status === 'pending') {
      const timestamp = nowIso();
      const ledger = transaction.objectStore('xpLedger');
      await settleMilestoneXp(ledger, linked.id, goal.branchId, date, timestamp);
      milestoneCompleted = { ...linked, status: 'completed', completedAt: timestamp, completionSourceQuestId: quest.id, xpSettled: true, updatedAt: timestamp, version: linked.version + 1 };
      milestoneStore.put(milestoneCompleted);
      milestones.splice(milestones.findIndex((item) => item.id === linked.id), 1, milestoneCompleted);
    } else if (mode === 'completed' && linked?.status === 'completed' && linked.completionSourceQuestId === quest.id) {
      const timestamp = nowIso();
      const settlement = await settleMilestoneXp(transaction.objectStore('xpLedger'), linked.id, goal.branchId, date, timestamp);
      if (settlement.changed) {
        milestoneCompleted = { ...linked, completedAt: timestamp, xpSettled: true, updatedAt: timestamp, version: linked.version + 1 };
        milestoneStore.put(milestoneCompleted);
        milestones.splice(milestones.findIndex((item) => item.id === linked.id), 1, milestoneCompleted);
      }
    }
    const next = milestones.find((item) => item.status === 'pending' && item.id !== milestoneCompleted?.id);
    if (!next) {
      return { followUp: null, milestoneCompleted, goalReady: milestones.length > 0 && !milestones.some((item) => item.status === 'pending' && item.id !== milestoneCompleted?.id) };
    }
    const actionId = validateActionId(`goal:${goal.id}:after:${quest.id}:milestone:${next.id}${mode === 'partial' ? ':partial' : ''}`);
    const allQuests = await requestResult(quests.getAll()) as Quest[];
    const existingFollowUp = allQuests.find((item) => item.actionId === actionId);
    if (existingFollowUp) {
      if (existingFollowUp.status === 'exempt' && existingFollowUp.predecessorQuestId === quest.id) {
        const feedback = await requestResult(transaction.objectStore('questFeedback').index('byQuestId').getAll(existingFollowUp.id)) as QuestFeedback[];
        const current = await requestResult(quests.index('byLocalDate').getAll(date)) as Quest[];
        const pendingTypes = current.filter((item) => item.id !== existingFollowUp.id && item.status === 'pending').map((item) => item.type);
        const type: QuestType | null = goal.role === 'main' && canAddQuest('main', pendingTypes)
          ? 'main' : canAddQuest('side', pendingTypes) ? 'side' : null;
        if (!feedback.some((item) => !item.undoneAt) && type) {
          const timestamp = nowIso();
          const generated = {
            title: `${mode === 'partial' ? '缩小继续' : '推进'}：${next.description}`.slice(0, 160),
            reason: mode === 'partial' ? `上一行动已有部分进展；先缩小推进目标“${goal.result}”。` : `上一行动已完成；这是目标“${goal.result}”的下一个可验证阶段。`,
            minimumAction: `先用 5 分钟推进“${next.description}”。`.slice(0, 200), completionCriteria: next.evidence,
          };
          const restored = restoreSystemRetiredQuest(existingFollowUp, {
            localDate: date, type, milestoneId: next.id, status: 'pending',
            ...(existingFollowUp.userModified ? {} : generated),
            updatedAt: timestamp, version: existingFollowUp.version + 1,
          });
          quests.put(restored);
          transaction.objectStore('goals').put({ ...goal, nextStep: restored.title, updatedAt: timestamp, version: goal.version + 1 });
          return { followUp: restored, milestoneCompleted, goalReady: false };
        }
        if (!feedback.some((item) => !item.undoneAt) && !type) {
          const timestamp = nowIso();
          const candidate = existingFollowUp.systemRetiredReason === 'capacity'
            ? existingFollowUp : systemRetireQuest(existingFollowUp, 'capacity', timestamp);
          if (candidate !== existingFollowUp) quests.put(candidate);
          if (goal.nextStep !== candidate.title) transaction.objectStore('goals').put({ ...goal, nextStep: candidate.title, updatedAt: timestamp, version: goal.version + 1 });
          return { followUp: candidate, milestoneCompleted, goalReady: false };
        }
      }
      const nextStep = resolveGoalNextStep(goal, allQuests, milestones);
      if (goal.nextStep !== nextStep) {
        transaction.objectStore('goals').put({ ...goal, nextStep, updatedAt: nowIso(), version: goal.version + 1 });
      }
      return { followUp: null, milestoneCompleted, goalReady: false };
    }
    const current = await requestResult(quests.index('byLocalDate').getAll(date)) as Quest[];
    const pendingTypes = current.filter((item) => item.status === 'pending').map((item) => item.type);
    const type: QuestType | null = goal.role === 'main' && canAddQuest('main', pendingTypes)
      ? 'main' : canAddQuest('side', pendingTypes) ? 'side' : null;
    const timestamp = nowIso();
    const title = `${mode === 'partial' ? '缩小继续' : '推进'}：${next.description}`.slice(0, 160);
    const followUp: Quest = {
      id: crypto.randomUUID(), localDate: date, type: type ?? (goal.role === 'main' ? 'main' : 'side'), sourceType: 'goal', sourceId: goal.id,
      milestoneId: next.id, predecessorQuestId: quest.id, actionId, settlementVersion: 0, title, reason: mode === 'partial' ? `上一行动已有部分进展；先缩小推进目标“${goal.result}”。` : `上一行动已完成；这是目标“${goal.result}”的下一个可验证阶段。`,
      minimumAction: `先用 5 分钟推进“${next.description}”。`.slice(0, 200), completionCriteria: next.evidence, estimatedMinutes: 10,
      difficulty: 'light', branchId: goal.branchId, status: type ? 'pending' : 'exempt',
      ...(type ? {} : { systemRetiredAt: timestamp, systemRetiredReason: 'capacity' as const }),
      aiSuggested: false, userModified: false,
      createdAt: timestamp, updatedAt: timestamp, version: 1,
    };
    quests.add(followUp);
    transaction.objectStore('goals').put({ ...goal, nextStep: followUp.title, updatedAt: timestamp, version: goal.version + 1 });
    return { followUp, milestoneCompleted, goalReady: false };
  }

  /** Arrange any capacity-blocked action without changing its identity or user edits. */
  async scheduleCapacityQuest(id: string, date = localDate()): Promise<Quest | null> {
    if (!isLocalDate(date)) throw new Error('任务日期无效。');
    const transaction = this.database.transaction(['quests', 'questFeedback', 'goals', 'milestones', 'habits'], 'readwrite');
    const quests = transaction.objectStore('quests');
    const candidate = await requestResult(quests.get(id)) as Quest | undefined;
    if (!candidate || candidate.status !== 'exempt' || candidate.systemRetiredReason !== 'capacity') {
      await transactionDone(transaction);
      return null;
    }
    const [feedback, current] = await Promise.all([
      requestResult(transaction.objectStore('questFeedback').index('byQuestId').getAll(candidate.id)) as Promise<QuestFeedback[]>,
      requestResult(quests.index('byLocalDate').getAll(date)) as Promise<Quest[]>,
    ]);
    const invalidateCandidate = async (reason: QuestSystemRetiredReason): Promise<null> => {
      quests.put(systemRetireQuest(candidate, reason, nowIso()));
      await transactionDone(transaction);
      return null;
    };
    if (feedback.some((item) => !item.undoneAt)) {
      await transactionDone(transaction);
      return null;
    }
    const pendingTypes = current.filter((item) => item.id !== id && item.status === 'pending').map((item) => item.type);
    let goal: Goal | undefined;
    let type: QuestType | null = canAddQuest(candidate.type, pendingTypes) ? candidate.type : null;
    if (candidate.sourceType === 'goal') {
      if (!candidate.sourceId) {
        return invalidateCandidate('source-invalidated');
      }
      goal = await requestResult(transaction.objectStore('goals').get(candidate.sourceId)) as Goal | undefined;
      if (!goal || !goalIsActionable(goal)) {
        return invalidateCandidate('source-invalidated');
      }
      if (candidate.milestoneId) {
        const milestone = await requestResult(transaction.objectStore('milestones').get(candidate.milestoneId)) as Milestone | undefined;
        if (!milestone || milestone.goalId !== goal.id || milestone.status !== 'pending') {
          return invalidateCandidate('source-invalidated');
        }
        type = goal.role === 'main' && canAddQuest('main', pendingTypes)
          ? 'main' : canAddQuest('side', pendingTypes) ? 'side' : null;
      }
    } else if (candidate.sourceType === 'habit') {
      if (!candidate.sourceId || candidate.type !== 'bonus') {
        return invalidateCandidate('source-invalidated');
      }
      const habit = await requestResult(transaction.objectStore('habits').get(candidate.sourceId)) as Habit | undefined;
      const schedule = habit ? habitScheduleOn(habit, date) : undefined;
      const weekday = parseLocalDate(date).getDay() || 7;
      if (!habit || habit.status !== 'active' || !habit.bonusEnabled || !schedule?.trackingEnabled || !schedule.scheduleDays.includes(weekday)) {
        return invalidateCandidate(!habit || habit.status !== 'active' || !habit.bonusEnabled || !schedule?.trackingEnabled
          ? 'tracking-disabled' : 'schedule-changed');
      }
    }
    if (!type) {
      await transactionDone(transaction);
      return null;
    }
    const timestamp = nowIso();
    const restored = restoreSystemRetiredQuest(candidate, {
      localDate: date, type, status: 'pending', updatedAt: timestamp, version: candidate.version + 1,
    });
    quests.put(restored);
    if (goal) transaction.objectStore('goals').put({ ...goal, nextStep: restored.title, updatedAt: timestamp, version: goal.version + 1 });
    await transactionDone(transaction);
    return restored;
  }

  async scheduleGoalFollowUpQuest(id: string, date = localDate()): Promise<Quest | null> {
    return this.scheduleCapacityQuest(id, date);
  }

  async undoQuestFeedback(id: string): Promise<void> {
    const transaction = this.database.transaction(['quests', 'questFeedback', 'habitLogs', 'xpLedger', 'observations', 'milestones', 'goals'], 'readwrite');
    const quests = transaction.objectStore('quests');
    const quest = await requestResult(quests.get(id)) as Quest | undefined;
    if (!quest || quest.status === 'pending') {
      transaction.abort();
      throw new Error('没有可撤销的任务反馈。');
    }
    const timestamp = nowIso();
    const feedbackStore = transaction.objectStore('questFeedback');
    const feedback = await requestResult(feedbackStore.index('byQuestId').getAll(id)) as QuestFeedback[];
    const active = feedback.filter((item) => !item.undoneAt).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!active) {
      transaction.abort();
      throw new Error('没有可撤销的任务反馈。');
    }
    feedbackStore.put({ ...active, undoneAt: timestamp, updatedAt: timestamp, version: active.version + 1 });
    const observations = transaction.objectStore('observations');
    const stateEffects = await requestResult(observations.index('byEvidenceId').getAll(active.id)) as StateObservation[];
    stateEffects.filter((item) => item.active).forEach((item) => observations.put({ ...item, active: false, updatedAt: timestamp, version: item.version + 1 }));
    const ledgerStore = transaction.objectStore('xpLedger');
    const ledger = quest.sourceType === 'goal'
      ? await rollbackGoalQuestProgression(quest, 'pending', transaction, timestamp)
      : await requestResult(ledgerStore.getAll()) as XpLedger[];
    ledger.filter((item) => item.sourceType === 'quest' && item.sourceId === id && !item.reversedAt)
      .forEach((item) => ledgerStore.put({ ...item, reversedAt: timestamp, updatedAt: timestamp, version: item.version + 1 }));
    if (quest.sourceType === 'habit' && quest.sourceId) {
      transaction.objectStore('habitLogs').index('byHabitDate').getKey([quest.sourceId, quest.localDate]).addEventListener('success', (event) => {
        const key = (event.target as IDBRequest<IDBValidKey | undefined>).result;
        if (key !== undefined) transaction.objectStore('habitLogs').delete(key);
      }, { once: true });
    }
    quests.put({
      ...quest,
      status: 'pending',
      progressCount: quest.targetCount ? Math.min(quest.progressCount ?? 0, quest.targetCount - 1) : quest.progressCount,
      updatedAt: timestamp,
      version: quest.version + 1,
    });
    await transactionDone(transaction);
  }

  async listQuestFeedback(questId?: string): Promise<QuestFeedback[]> {
    const transaction = this.database.transaction('questFeedback', 'readonly');
    const store = transaction.objectStore('questFeedback');
    const values = await requestResult(questId ? store.index('byQuestId').getAll(questId) : store.getAll()) as QuestFeedback[];
    await transactionDone(transaction);
    return values.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listXpLedger(branchId?: string): Promise<XpLedger[]> {
    const transaction = this.database.transaction('xpLedger', 'readonly');
    const store = transaction.objectStore('xpLedger');
    const values = await requestResult(branchId ? store.index('byBranchId').getAll(branchId) : store.getAll()) as XpLedger[];
    await transactionDone(transaction);
    return values.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async branchProgress(branchId: string): Promise<ReturnType<typeof levelFromXp> & { totalXp: number }> {
    const values = await this.listXpLedger(branchId);
    const xp = totalXp(values);
    return { totalXp: xp, ...levelFromXp(xp) };
  }

  async habitMomentum(habitId: string, throughDate = localDate()): Promise<number> {
    if (!isLocalDate(throughDate)) throw new Error('最近坚持的日期无效。');
    const transaction = this.database.transaction(['habits', 'habitLogs'], 'readonly');
    const habit = await requestResult(transaction.objectStore('habits').get(habitId)) as Habit | undefined;
    if (!habit) {
      transaction.abort();
      throw new Error('习惯不存在。');
    }
    const logs = await requestResult(transaction.objectStore('habitLogs').index('byHabitDate').getAll(IDBKeyRange.bound([habitId, ''], [habitId, '\uffff']))) as HabitLog[];
    await transactionDone(transaction);
    return habitMomentumAt(habit, logs, throughDate);
  }

  async exportBundle(): Promise<BackupBundle> {
    const transaction = this.database.transaction(STORE_NAMES, 'readonly');
    const values = await Promise.all(STORE_NAMES.map((name) => requestResult(transaction.objectStore(name).getAll())));
    await transactionDone(transaction);
    const data = Object.fromEntries(STORE_NAMES.map((name, index) => [name, values[index]])) as unknown as BackupData;
    data.settings = data.settings.map(({ aiApiKey: _localOnly, ...item }) => item);
    return {
      format: 'qiguang-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: nowIso(),
      appVersion: APP_VERSION,
      data,
    };
  }

  async importBundle(text: string, importDate = localDate()): Promise<BackupBundle> {
    if (!isLocalDate(importDate)) throw new Error('导入日期无效。');
    const bundle = parseBackup(text);
    const importTimestamp = nowIso();
    const transaction = this.database.transaction(STORE_NAMES, 'readwrite');
    const stores = Object.fromEntries(STORE_NAMES.map((name) => [name, transaction.objectStore(name)])) as Record<StoreName, IDBObjectStore>;
    const values = await Promise.all(STORE_NAMES.map((name) => requestResult(stores[name].getAll())));
    const existing = Object.fromEntries(STORE_NAMES.map((name, index) => [name, values[index]])) as Record<StoreName, Array<{ id: string; importedFromId?: string }>>;
    const activityStores: StoreName[] = [
      'entries', 'dayCaptions', 'revisions', 'analyses', 'events', 'observations', 'snapshots', 'goals', 'milestones',
      'quests', 'questFeedback', 'habits', 'habitLogs', 'xpLedger', 'reviews', 'memories', 'analysisJobs',
    ];
    const profiles = existing.profile as Profile[];
    const settings = existing.settings as AppSettings[];
    const areas = existing.areas as Area[];
    const branches = existing.branches as GrowthBranch[];
    const profile = profiles[0];
    const appSettings = settings[0];
    const hasOnlyBootstrapData = activityStores.every((name) => existing[name].length === 0)
      && (!profile || (profiles.length === 1
        && profile.version === 1 && profile.userName === '' && profile.companionName === '小栖'
        && profile.avatar === null && profile.chapterTitle === '全面观察'))
      && (!appSettings || (settings.length === 1
        && !appSettings.reduceMotion && !appSettings.aiAllowed && appSettings.previewBeforeSend))
      && (areas.length === 0 || (areas.length === DEFAULT_AREA_NAMES.length && areas.every((area) =>
        area.version === 1 && area.id === `default-area-${area.order + 1}` && area.name === DEFAULT_AREA_NAMES[area.order]
        && area.mode === 'explore' && area.order >= 0 && area.order < DEFAULT_AREA_NAMES.length && area.isDefault)))
      && (branches.length === 0 || (branches.length === ROOT_ASSETS.length && branches.every((branch) => {
        const expected = ROOT_ASSETS[branch.order];
        if (!expected) return false;
        return branch.version === 1 && branch.id === `root-${expected.key}` && branch.rootAsset === expected.key
          && branch.name === expected.name && branch.order >= 0 && branch.order < ROOT_ASSETS.length && branch.status === 'active' && !branch.parentId;
      })));
    if (hasOnlyBootstrapData) {
      for (const name of STORE_NAMES) {
        stores[name].clear();
        (bundle.data[name] as Array<{ id: string }>).forEach((item) => stores[name].add(item));
      }
      await transactionDone(transaction);
      return bundle;
    }

    const mergeStores = [
      'areas', 'branches', 'entries', 'revisions', 'analyses', 'events', 'observations', 'snapshots',
      'goals', 'milestones', 'habits', 'quests', 'questFeedback', 'habitLogs', 'xpLedger',
      'reviews', 'memories', 'analysisJobs',
    ] as const;
    const idMaps = Object.fromEntries(mergeStores.map((name) => {
      const usedIds = new Set(existing[name].map((item) => item.id));
      return [name, new Map((bundle.data[name] as Array<{ id: string }>).map((item) => [item.id, reserveImportedId(item.id, usedIds)]))];
    })) as Record<(typeof mergeStores)[number], Map<string, string>>;
    const imported = <T extends { id: string; importedFromId?: string }>(item: T, map: Map<string, string>, patch: Partial<T> = {}): T => {
      const id = map.get(item.id) ?? item.id;
      return {
        ...item,
        ...patch,
        id,
        ...(id === item.id ? {} : { importedFromId: item.importedFromId ?? item.id }),
      };
    };

    let buildSlots = Math.max(0, 2 - (existing.areas as Area[]).filter((item) => item.mode === 'build').length);
    for (const area of bundle.data.areas) {
      const mode = area.mode === 'build' && buildSlots === 0 ? 'explore' : area.mode;
      if (mode === 'build') buildSlots -= 1;
      stores.areas.add(imported(area, idMaps.areas, { mode }));
    }
    for (const branch of bundle.data.branches) {
      stores.branches.add(imported(branch, idMaps.branches, {
        parentId: branch.parentId ? idMaps.branches.get(branch.parentId) : undefined,
      }));
    }
    for (const entry of bundle.data.entries) stores.entries.add(imported(entry, idMaps.entries));
    const captionDates = new Set((existing.dayCaptions as DayCaption[]).map((item) => item.localDate));
    for (const caption of bundle.data.dayCaptions) {
      if (captionDates.has(caption.localDate)) continue;
      stores.dayCaptions.add(caption);
      captionDates.add(caption.localDate);
    }
    for (const revision of bundle.data.revisions) {
      stores.revisions.add(imported(revision, idMaps.revisions, { entryId: idMaps.entries.get(revision.entryId) ?? revision.entryId }));
    }

    const usedRequestIds = new Set((existing.analysisJobs as AnalysisJob[]).map((item) => item.requestId));
    const requestIdMap = new Map(bundle.data.analysisJobs.map((item) => [item.requestId, reserveImportedId(item.requestId, usedRequestIds)]));
    const remapDailyRequest = (request: DailyAnalysisRequest): DailyAnalysisRequest => {
      const entries = request.userInput.entries.map((entry) => ({ ...entry, entryId: idMaps.entries.get(entry.entryId) ?? entry.entryId }));
      const memories = request.context.memories.map((memory) => ({ ...memory, memoryId: idMaps.memories.get(memory.memoryId) ?? memory.memoryId }));
      return {
        ...request,
        requestId: requestIdMap.get(request.requestId) ?? request.requestId,
        userInput: { entries },
        context: {
          ...request.context,
          confirmedEvents: request.context.confirmedEvents.map((event) => ({ ...event, eventId: idMaps.events.get(event.eventId) ?? event.eventId })),
          goals: request.context.goals.map((goal) => ({ ...goal, goalId: idMaps.goals.get(goal.goalId) ?? goal.goalId })),
          bonusHabits: request.context.bonusHabits.map((habit) => ({ ...habit, habitId: idMaps.habits.get(habit.habitId) ?? habit.habitId })),
          memories,
        },
        permissions: {
          ...request.permissions,
          entryIds: entries.map((entry) => entry.entryId),
          memoryIds: memories.map((memory) => memory.memoryId),
        },
      };
    };
    const remapWeeklyRequest = (request: WeeklyReviewRequest): WeeklyReviewRequest => {
      const events = request.context.events.map((event) => ({ ...event, eventId: idMaps.events.get(event.eventId) ?? event.eventId }));
      const memories = request.context.memories.map((memory) => ({ ...memory, memoryId: idMaps.memories.get(memory.memoryId) ?? memory.memoryId }));
      const remapVersions = <K extends keyof typeof idMaps>(values: Array<{ id: string; version: number }>, key: K) => values.map((item) => ({
        ...item, id: idMaps[key].get(item.id) ?? item.id,
      }));
      const sourceVersions = request.context.sourceVersions ? {
        quests: remapVersions(request.context.sourceVersions.quests, 'quests'),
        questFeedback: remapVersions(request.context.sourceVersions.questFeedback, 'questFeedback'),
        habits: remapVersions(request.context.sourceVersions.habits, 'habits'),
        habitLogs: remapVersions(request.context.sourceVersions.habitLogs, 'habitLogs'),
        branches: remapVersions(request.context.sourceVersions.branches, 'branches'),
        xpLedger: remapVersions(request.context.sourceVersions.xpLedger, 'xpLedger'),
        goals: remapVersions(request.context.sourceVersions.goals, 'goals'),
        reviews: remapVersions(request.context.sourceVersions.reviews, 'reviews'),
        memories: remapVersions(request.context.sourceVersions.memories, 'memories'),
        stateObservations: remapVersions(request.context.sourceVersions.stateObservations, 'observations'),
      } : undefined;
      return {
        ...request,
        requestId: requestIdMap.get(request.requestId) ?? request.requestId,
        context: {
          ...request.context,
          events,
          ...(sourceVersions ? { sourceVersions } : {}),
          taskResults: request.context.taskResults.map((item) => ({ ...item, questId: idMaps.quests.get(item.questId) ?? item.questId })),
          habits: request.context.habits.map((item) => ({ ...item, habitId: idMaps.habits.get(item.habitId) ?? item.habitId })),
          growth: request.context.growth.map((item) => ({ ...item, branchId: idMaps.branches.get(item.branchId) ?? item.branchId })),
          goals: request.context.goals.map((item) => ({ ...item, goalId: idMaps.goals.get(item.goalId) ?? item.goalId })),
          experiments: request.context.experiments.map((item) => ({ ...item, reviewId: idMaps.reviews.get(item.reviewId) ?? item.reviewId })),
          memories,
        },
        permissions: { ...request.permissions, eventIds: events.map((item) => item.eventId), memoryIds: memories.map((item) => item.memoryId) },
      };
    };
    for (const analysis of bundle.data.analyses) {
      const requestId = requestIdMap.get(analysis.requestId) ?? analysis.requestId;
      const result = {
        ...analysis.result,
        events: analysis.result.events.map((event) => ({
          ...event,
          evidence: event.evidence.map((evidence) => ({ ...evidence, entryId: idMaps.entries.get(evidence.entryId) ?? evidence.entryId })),
        })),
      };
      const raw = JSON.parse(analysis.rawResponse) as DailyAnalysisResponse;
      stores.analyses.add(imported(analysis, idMaps.analyses, {
        requestId,
        sourceEntries: analysis.sourceEntries.map((entry) => ({ ...entry, entryId: idMaps.entries.get(entry.entryId) ?? entry.entryId })),
        result,
        rawResponse: JSON.stringify({ ...raw, requestId, result }),
      }));
    }
    for (const item of bundle.data.events) {
      stores.events.add(imported(item, idMaps.events, {
        analysisId: idMaps.analyses.get(item.analysisId) ?? item.analysisId,
        sourceEntryIds: item.sourceEntryIds.map((entryId) => idMaps.entries.get(entryId) ?? entryId),
        evidence: item.evidence.map((evidence) => ({ ...evidence, entryId: idMaps.entries.get(evidence.entryId) ?? evidence.entryId })),
      }));
    }

    const usedAssessmentIds = new Set((existing.observations as StateObservation[]).map((item) => item.assessmentId));
    const assessmentIdMap = new Map<string, string>();
    for (const observation of bundle.data.observations) {
      if (!assessmentIdMap.has(observation.assessmentId)) {
        assessmentIdMap.set(observation.assessmentId, reserveImportedId(observation.assessmentId, usedAssessmentIds));
      }
      stores.observations.add(imported(observation, idMaps.observations, {
        assessmentId: assessmentIdMap.get(observation.assessmentId),
        evidenceId: observation.evidenceId ? idMaps.events.get(observation.evidenceId) ?? idMaps.questFeedback.get(observation.evidenceId) ?? observation.evidenceId : undefined,
      }));
    }
    stores.snapshots.clear();

    const actionableImportedGoalIds = new Set<string>();
    let mainSlots = Math.max(0, 1 - (existing.goals as Goal[]).filter((item) => item.role === 'main' && !['completed', 'abandoned'].includes(item.status)).length);
    let secondarySlots = Math.max(0, 2 - (existing.goals as Goal[]).filter((item) => item.role === 'secondary' && !['completed', 'abandoned'].includes(item.status)).length);
    for (const goal of bundle.data.goals) {
      let role = goal.role;
      if (!['completed', 'abandoned'].includes(goal.status)) {
        if (role === 'main' && mainSlots === 0) role = 'wishlist';
        else if (role === 'main') mainSlots -= 1;
        if (role === 'secondary' && secondarySlots === 0) role = 'wishlist';
        else if (role === 'secondary') secondarySlots -= 1;
      }
      const value = imported(goal, idMaps.goals, {
        areaId: idMaps.areas.get(goal.areaId) ?? goal.areaId,
        branchId: idMaps.branches.get(goal.branchId) ?? goal.branchId,
        role,
      });
      if (value.status === 'active' && value.role !== 'wishlist') actionableImportedGoalIds.add(value.id);
      stores.goals.add(value);
    }
    for (const milestone of bundle.data.milestones) {
      stores.milestones.add(imported(milestone, idMaps.milestones, {
        goalId: idMaps.goals.get(milestone.goalId) ?? milestone.goalId,
        completionSourceQuestId: milestone.completionSourceQuestId ? idMaps.quests.get(milestone.completionSourceQuestId) ?? milestone.completionSourceQuestId : undefined,
      }));
    }

    const actionableImportedHabitIds = new Set<string>();
    let bonusSlots = Math.max(0, 3 - (existing.habits as Habit[]).filter((item) => item.status === 'active' && item.bonusEnabled).length);
    for (const habit of bundle.data.habits) {
      const bonusEnabled = habit.status === 'active' && habit.bonusEnabled && bonusSlots > 0;
      if (bonusEnabled) bonusSlots -= 1;
      const scheduleHistory = habit.status === 'active' && habit.bonusEnabled && !bonusEnabled
        ? [...habitScheduleHistory(habit).filter((item) => item.effectiveFrom < importDate), {
          effectiveFrom: importDate, scheduleDays: [...habit.scheduleDays], trackingEnabled: false,
        }]
        : habit.scheduleHistory;
      const value = imported(habit, idMaps.habits, {
        branchId: idMaps.branches.get(habit.branchId) ?? habit.branchId,
        bonusEnabled,
        scheduleHistory,
      });
      if (value.status === 'active' && value.bonusEnabled) actionableImportedHabitIds.add(value.id);
      stores.habits.add(value);
    }

    const usedActionIds = new Set((existing.quests as Quest[]).map((item) => item.actionId));
    const actionIdMap = new Map<string, string>();
    const reviewExperimentActions = new Map(bundle.data.reviews.map((review) => [
      `review:${review.id}:experiment`,
      `review:${idMaps.reviews.get(review.id) ?? review.id}:experiment`,
    ]));
    for (const quest of bundle.data.quests) {
      if (!actionIdMap.has(quest.actionId)) {
        actionIdMap.set(quest.actionId, reserveImportedId(reviewExperimentActions.get(quest.actionId) ?? quest.actionId, usedActionIds));
      }
    }
    const pendingCounts = new Map<string, number>();
    for (const quest of existing.quests as Quest[]) {
      if (quest.status === 'pending') pendingCounts.set(`${quest.localDate}:${quest.type}`, (pendingCounts.get(`${quest.localDate}:${quest.type}`) ?? 0) + 1);
    }
    for (const quest of bundle.data.quests) {
      const sourceId = quest.sourceType === 'goal' && quest.sourceId
        ? idMaps.goals.get(quest.sourceId)
        : quest.sourceType === 'habit' && quest.sourceId ? idMaps.habits.get(quest.sourceId) : quest.sourceId;
      const countKey = `${quest.localDate}:${quest.type}`;
      const current = pendingCounts.get(countKey) ?? 0;
      const openCandidate = quest.status === 'pending' || quest.systemRetiredReason === 'capacity';
      const lostSourceEligibility = openCandidate
        && ((quest.sourceType === 'goal' && (!sourceId || !actionableImportedGoalIds.has(sourceId)))
          || (quest.sourceType === 'habit' && (!sourceId || !actionableImportedHabitIds.has(sourceId))));
      const overCapacity = quest.status === 'pending' && current >= ({ main: 1, bonus: 3, side: 2 } as const)[quest.type];
      const systemRetiredReason: QuestSystemRetiredReason | undefined = lostSourceEligibility
        ? quest.sourceType === 'habit' ? 'tracking-disabled' : 'source-invalidated'
          : overCapacity ? 'capacity' : quest.systemRetiredReason;
      const status = systemRetiredReason ? 'exempt' : quest.status;
      const retirementChanged = Boolean(systemRetiredReason
        && (quest.systemRetiredReason !== systemRetiredReason || !quest.systemRetiredAt));
      if (status === 'pending') pendingCounts.set(countKey, current + 1);
      stores.quests.add(imported(quest, idMaps.quests, {
        sourceId,
        milestoneId: quest.milestoneId ? idMaps.milestones.get(quest.milestoneId) : undefined,
        predecessorQuestId: quest.predecessorQuestId ? idMaps.quests.get(quest.predecessorQuestId) : undefined,
        actionId: actionIdMap.get(quest.actionId) ?? quest.actionId,
        branchId: quest.branchId ? idMaps.branches.get(quest.branchId) : undefined,
        status,
        ...(systemRetiredReason ? {
          systemRetiredAt: retirementChanged ? importTimestamp : quest.systemRetiredAt,
          systemRetiredReason,
          updatedAt: retirementChanged ? importTimestamp : quest.updatedAt,
          version: retirementChanged ? quest.version + 1 : quest.version,
        } : {}),
      }));
    }
    for (const item of bundle.data.questFeedback) {
      stores.questFeedback.add(imported(item, idMaps.questFeedback, { questId: idMaps.quests.get(item.questId) ?? item.questId }));
    }

    const remapSettlementKey = (key: string | undefined): string | undefined => {
      if (!key) return undefined;
      const separator = key.lastIndexOf(':');
      if (separator < 1) return key;
      const source = key.slice(0, separator);
      return `${actionIdMap.get(source) ?? idMaps.milestones.get(source) ?? source}${key.slice(separator)}`;
    };
    for (const item of bundle.data.habitLogs) {
      stores.habitLogs.add(imported(item, idMaps.habitLogs, {
        habitId: idMaps.habits.get(item.habitId) ?? item.habitId,
        questId: idMaps.quests.get(item.questId) ?? item.questId,
        settlementKey: remapSettlementKey(item.settlementKey),
      }));
    }
    for (const item of bundle.data.xpLedger) {
      const sourceId = item.sourceType === 'quest' ? idMaps.quests.get(item.sourceId)
        : item.sourceType === 'habit' ? idMaps.habits.get(item.sourceId) : idMaps.milestones.get(item.sourceId);
      stores.xpLedger.add(imported(item, idMaps.xpLedger, {
        sourceId: sourceId ?? item.sourceId,
        branchId: idMaps.branches.get(item.branchId) ?? item.branchId,
        settlementKey: remapSettlementKey(item.settlementKey) ?? item.settlementKey,
      }));
    }
    for (const item of bundle.data.reviews) {
      const remapEvidence = (ids: string[]): string[] => ids.map((id) => idMaps.events.get(id) ?? id);
      const request = remapWeeklyRequest(item.request);
      const raw = JSON.parse(item.rawResponse) as WeeklyReviewResponse;
      const rawResult = {
        ...raw.result,
        stateTrends: raw.result.stateTrends.map((trend) => ({ ...trend, evidenceEventIds: remapEvidence(trend.evidenceEventIds) })),
        recurringBenefits: raw.result.recurringBenefits.map((value) => ({ ...value, evidenceEventIds: remapEvidence(value.evidenceEventIds) })),
        recurringCosts: raw.result.recurringCosts.map((value) => ({ ...value, evidenceEventIds: remapEvidence(value.evidenceEventIds) })),
        growthDeposits: raw.result.growthDeposits.map((value) => ({
          ...value,
          branchId: value.branchId ? idMaps.branches.get(value.branchId) ?? value.branchId : null,
          evidenceEventIds: remapEvidence(value.evidenceEventIds),
        })),
        habitDecisions: raw.result.habitDecisions.map((value) => ({ ...value, habitId: idMaps.habits.get(value.habitId) ?? value.habitId })),
        systemCandidates: raw.result.systemCandidates.map((value) => ({ ...value, supportingEventIds: remapEvidence(value.supportingEventIds) })),
      };
      stores.reviews.add(imported(item, idMaps.reviews, {
        requestId: request.requestId,
        request,
        stateTrends: item.stateTrends.map((trend) => ({ ...trend, evidenceEventIds: remapEvidence(trend.evidenceEventIds) })),
        recurringBenefits: item.recurringBenefits.map((value) => ({ ...value, evidenceEventIds: remapEvidence(value.evidenceEventIds) })),
        recurringCosts: item.recurringCosts.map((value) => ({ ...value, evidenceEventIds: remapEvidence(value.evidenceEventIds) })),
        growthDeposits: item.growthDeposits.map((value) => ({
          ...value,
          branchId: value.branchId ? idMaps.branches.get(value.branchId) ?? value.branchId : null,
          evidenceEventIds: remapEvidence(value.evidenceEventIds),
        })),
        habitDecisions: item.habitDecisions.map((value) => ({ ...value, habitId: idMaps.habits.get(value.habitId) ?? value.habitId })),
        rawResponse: JSON.stringify({ ...raw, requestId: request.requestId, result: rawResult }),
      }));
    }
    for (const item of bundle.data.memories) {
      stores.memories.add(imported(item, idMaps.memories, {
        analysisId: item.analysisId ? idMaps.analyses.get(item.analysisId) ?? item.analysisId : undefined,
        reviewId: item.reviewId ? idMaps.reviews.get(item.reviewId) ?? item.reviewId : undefined,
        evidenceIds: item.evidenceIds.map((id) => idMaps.events.get(id) ?? id),
      }));
    }
    for (const item of bundle.data.analysisJobs) {
      const request = item.operation === 'daily_analysis'
        ? remapDailyRequest(parseDailyAnalysisRequest(item.request))
        : remapWeeklyRequest(parseWeeklyReviewRequest(item.request));
      const requestId = request.requestId;
      stores.analysisJobs.add(imported(item, idMaps.analysisJobs, {
        requestId,
        request,
        idempotencyKey: request.operation === 'daily_analysis'
          ? `daily:${request.localDate}:${request.userInput.entries.map((entry) => `${entry.entryId}@${entry.revision}`).sort().join(',')}`
          : `weekly:${request.period.start}:${request.period.end}:${request.context.events.map((event) => `${event.eventId}@${event.version}`).sort().join(',')}`,
        analysisId: item.analysisId ? idMaps.analyses.get(item.analysisId) ?? item.analysisId : undefined,
        reviewId: item.reviewId ? idMaps.reviews.get(item.reviewId) ?? item.reviewId : undefined,
      }));
    }
    await transactionDone(transaction);
    return bundle;
  }

  async clearAll(): Promise<void> {
    const transaction = this.database.transaction(STORE_NAMES, 'readwrite');
    STORE_NAMES.forEach((name) => transaction.objectStore(name).clear());
    await transactionDone(transaction);
  }

  async deleteDatabase(): Promise<void> {
    this.close();
    await deleteRawDatabase(this.name);
  }
}
