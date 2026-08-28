import type { Quest } from './model.ts';

export interface WidgetTask {
  id: string;
  title: string;
  type: Quest['type'];
  targetCount?: number;
  progressCount?: number;
  countUnit?: string;
}

export interface WidgetSnapshot {
  version: 1;
  generatedAt: string;
  localDate: string;
  tasks: WidgetTask[];
}

export type WidgetAction = { type: 'complete'; questId: string } | { type: 'open'; route: 'today' | 'tasks'; questId?: string };

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

export function buildWidgetSnapshot(input: { quests: Quest[]; localDate: string; generatedAt: string }): WidgetSnapshot {
  const priority: Record<Quest['type'], number> = { main: 0, bonus: 1, side: 2 };
  return {
    version: 1,
    generatedAt: input.generatedAt,
    localDate: input.localDate,
    tasks: input.quests
      .filter((quest) => quest.status === 'pending' && !quest.systemRetiredAt)
      .sort((left, right) => priority[left.type] - priority[right.type])
      .slice(0, 6)
      .map((quest) => ({
        id: quest.id, title: quest.title.slice(0, 80), type: quest.type,
        ...(quest.targetCount ? { targetCount: quest.targetCount, progressCount: quest.progressCount ?? 0, countUnit: quest.countUnit || '次' } : {}),
      })),
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
    if (value.type === 'open' && (value.route === 'today' || value.route === 'tasks')) {
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
