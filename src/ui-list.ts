// Shared presentation only: no database, routing or task settlement here.
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

export function listRow<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const row = element(tag, `ui-list-row ${className}`.trim());
  row.dataset.uiRow = 'list';
  if (row instanceof HTMLButtonElement) row.type = 'button';
  return row;
}

export function listGroup(className = ''): HTMLDivElement {
  return element('div', `ui-list-group ${className}`.trim());
}

export function listSection(title: string, ...children: HTMLElement[]): HTMLElement {
  const section = element('section', 'ui-list-section');
  section.append(element('h2', 'ui-list-heading', title), ...children);
  return section;
}

export function infoRow(title: string, value: string | HTMLElement = '', options: {
  icon?: HTMLElement;
  onOpen?: () => void;
  multiline?: boolean;
  className?: string;
} = {}): HTMLElement {
  const row = listRow(options.onOpen ? 'button' : 'div', `ui-info-row ${options.className ?? ''}${options.multiline ? ' is-multiline' : ''}`);
  const copy = element('span', 'ui-row-label', title);
  copy.title = title;
  const tail = element('span', 'ui-row-value');
  tail.append(value);
  if (options.icon) { options.icon.classList.add('ui-row-icon'); row.append(options.icon); }
  row.append(copy, tail);
  if (options.onOpen) {
    const arrow = element('span', 'ui-row-chevron', '›');
    arrow.setAttribute('aria-hidden', 'true');
    row.append(arrow);
    row.addEventListener('click', options.onOpen);
  }
  return row;
}

export function taskRow(options: {
  title: string;
  status: string;
  className?: string;
  targetCount?: number;
  progressCount?: number;
  countUnit?: string;
  actionLabel?: string;
  reorderable?: boolean;
  primaryLabel: string;
  detailsLabel: string;
  onPrimary: () => void;
  onDetails: () => void;
}): HTMLElement {
  const { title, status } = options;
  const item = listRow('article', `ui-action-row task-list-item is-${status}${options.targetCount ? ' has-count' : ''}${options.actionLabel ? ' is-habit-checkin' : ''} ${options.className ?? ''}`);
  item.tabIndex = -1;
  const action = element('button', 'task-row-action');
  action.type = 'button';
  const copy = element('span', 'task-list-copy');
  copy.append(element('h3', 'ui-row-label', title));
  copy.title = title;
  if (!options.targetCount && !options.actionLabel) {
    const check = element('span', `task-check is-${status}`, status === 'completed' ? '✓' : status === 'partial' ? '–' : '');
    check.setAttribute('aria-hidden', 'true');
    action.append(check);
  }
  action.append(copy);
  if (options.targetCount) {
    const count = element('span', 'task-count-progress');
    count.append(element('span', 'task-count-value', `${options.progressCount ?? 0}/${options.targetCount}${options.countUnit || '次'}`));
    action.append(count);
  }
  if (options.actionLabel) {
    action.classList.add('task-row-details');
    action.setAttribute('aria-label', options.detailsLabel);
    action.addEventListener('click', options.onDetails);
    const checkIn = element('button', 'task-checkin-action');
    checkIn.type = 'button';
    const settled = status !== 'pending';
    checkIn.append(element('span', settled ? `task-check is-${status}` : '', settled ? (status === 'completed' ? '✓' : '–') : options.actionLabel));
    checkIn.setAttribute('aria-label', options.primaryLabel);
    checkIn.addEventListener('click', options.onPrimary);
    item.append(action, checkIn);
    return item;
  }
  action.setAttribute('aria-label', options.primaryLabel);
  action.addEventListener('click', options.onPrimary);
  item.append(action);
  if (options.reorderable) {
    item.dataset.reorderable = 'true';
    const drag = element('button', 'task-drag-handle', '≡');
    drag.type = 'button';
    drag.setAttribute('aria-label', `拖动调整“${title}”的位置`);
    item.append(drag);
  }
  const details = element('button', 'task-item-details', '⋯');
  details.type = 'button';
  details.setAttribute('aria-label', options.detailsLabel);
  details.addEventListener('click', options.onDetails);
  item.append(details);
  return item;
}
