import { levelFromXp, totalXp } from './rules.ts';
import type { Profile, Quest, XpLedger } from './model.ts';

export interface WidgetSnapshot {
  version: 1;
  generatedAt: string;
  localDate: string;
  avatar: Profile['avatar'];
  companionName: string;
  companionState: '陪伴' | '指导' | '恢复' | '休息';
  main: { id: string; title: string; minimumAction: string } | null;
  bonus: Array<{ id: string; title: string; status: Quest['status'] }>;
  xp: ReturnType<typeof levelFromXp> & { totalXp: number };
  reduceMotion: boolean;
}

export type WidgetAction = { type: 'complete'; questId: string } | { type: 'open'; route: 'today' | 'tasks' | 'record'; questId?: string };

declare global {
  interface Window {
    qiguangWidgetBridge?: {
      updateSnapshot(value: string): void;
      consumeAction(): string;
      canRequestPinWidget?(): boolean;
      hasPinnedWidget?(): boolean;
      requestPinWidget?(): boolean;
    };
  }
}

export function buildWidgetSnapshot(input: { profile: Profile | null; quests: Quest[]; ledger: XpLedger[]; localDate: string; generatedAt: string; companionState?: WidgetSnapshot['companionState']; reduceMotion?: boolean }): WidgetSnapshot {
  const xpTotal = totalXp(input.ledger);
  const main = input.quests.find((quest) => quest.type === 'main' && quest.status === 'pending') ?? null;
  return {
    version: 1,
    generatedAt: input.generatedAt,
    localDate: input.localDate,
    avatar: input.profile?.avatar ?? null,
    companionName: input.profile?.companionName || '小栖',
    companionState: input.companionState ?? (main ? '指导' : '陪伴'),
    main: main ? { id: main.id, title: main.title.slice(0, 80), minimumAction: main.minimumAction.slice(0, 120) } : null,
    bonus: input.quests.filter((quest) => quest.type === 'bonus').slice(0, 3).map((quest) => ({ id: quest.id, title: quest.title.slice(0, 80), status: quest.status })),
    xp: { totalXp: xpTotal, ...levelFromXp(xpTotal) },
    reduceMotion: input.reduceMotion ?? false,
  };
}

export function saveWidgetSnapshot(snapshot: WidgetSnapshot): void {
  const value = JSON.stringify(snapshot);
  try { localStorage.setItem('qiguang.widget-snapshot.v1', value); } catch { /* private mode may deny storage */ }
  try { window.qiguangWidgetBridge?.updateSnapshot(value); } catch { /* native bridge is optional */ }
}

export function consumeWidgetAction(): WidgetAction | null {
  try {
    const raw = window.qiguangWidgetBridge?.consumeAction();
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<WidgetAction>;
    if (value.type === 'complete' && typeof value.questId === 'string' && value.questId) return { type: 'complete', questId: value.questId };
    if (value.type === 'open' && (value.route === 'today' || value.route === 'tasks' || value.route === 'record')) {
      return { type: 'open', route: value.route, questId: typeof value.questId === 'string' && value.questId ? value.questId : undefined };
    }
  } catch { /* malformed native action is discarded */ }
  return null;
}

export function widgetPinState(): 'unavailable' | 'available' | 'pinned' {
  try {
    if (window.qiguangWidgetBridge?.hasPinnedWidget?.()) return 'pinned';
    return window.qiguangWidgetBridge?.canRequestPinWidget?.() ? 'available' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function requestWidgetPin(): boolean {
  try {
    return window.qiguangWidgetBridge?.requestPinWidget?.() ?? false;
  } catch {
    return false;
  }
}
