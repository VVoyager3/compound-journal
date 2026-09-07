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

export function sectionHeading(title: string, options: {
  tail?: HTMLElement;
  className?: string;
  level?: 'h2' | 'h3';
} = {}): HTMLElement {
  const heading = element('div', `section-heading ${options.className ?? ''}`.trim());
  heading.append(element(options.level ?? 'h2', 'ui-list-heading', title));
  if (options.tail) heading.append(options.tail);
  return heading;
}

export function emptyState(message: string, className = ''): HTMLParagraphElement {
  return element('p', `empty-copy ${className}`.trim(), message);
}

export function actionGroup(className = '', ...children: HTMLElement[]): HTMLDivElement {
  const group = element('div', `ui-actions ${className}`.trim());
  group.append(...children);
  return group;
}

export function formStack(className = '', ...children: HTMLElement[]): HTMLDivElement {
  const stack = element('div', `ui-form-stack ${className}`.trim());
  stack.append(...children);
  return stack;
}

export function labelledControl(labelText: string, control: HTMLElement, countLimit?: number): HTMLLabelElement {
  const label = element('label', 'field-label', labelText);
  label.append(control);
  if (countLimit && (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
    label.classList.add('field-with-count');
    const count = element('span', 'field-character-count');
    const updateCount = () => { count.textContent = `${control.value.length}/${countLimit}`; };
    control.addEventListener('input', updateCount);
    updateCount();
    label.append(count);
  }
  return label;
}

export function textAction(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const button = element('button', `section-text-action ${className}`.trim(), label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

export function actionButton(label: string, onClick: (() => void) | undefined, options: {
  variant?: 'danger' | 'primary' | 'quiet' | 'secondary';
  className?: string;
  type?: HTMLButtonElement['type'];
} = {}): HTMLButtonElement {
  const button = element('button', ['button', `button-${options.variant ?? 'secondary'}`, options.className].filter(Boolean).join(' '), label);
  button.type = options.type ?? 'button';
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

export function fileButton(label: string, input: HTMLInputElement): HTMLLabelElement {
  const control = element('label', 'button button-secondary file-button');
  control.append(element('span', '', label), input);
  return control;
}

export function primaryButton(label: string, onClick: () => void): HTMLButtonElement {
  return actionButton(label, onClick, { variant: 'primary' });
}

export function statusMessage(message = ''): HTMLParagraphElement {
  return element('p', 'save-state', message);
}

export function backButton(onClick: () => void, className = ''): HTMLButtonElement {
  const button = element('button', `ui-back-button ${className}`.trim());
  button.type = 'button';
  button.setAttribute('aria-label', '返回');
  button.addEventListener('click', onClick);
  return button;
}

export function titleBar(title: string, options: {
  level?: 'h1' | 'h2';
  className?: string;
  back?: { onClick: () => void; className?: string };
  tail?: HTMLElement;
} = {}): { header: HTMLElement; heading: HTMLHeadingElement } {
  const header = element('header', `ui-titlebar ${options.className ?? ''}`.trim());
  const heading = element(options.level ?? 'h1', 'ui-page-title', title);
  if (options.back) header.append(backButton(options.back.onClick, options.back.className), heading);
  else header.append(heading);
  if (options.tail) header.append(options.tail);
  return { header, heading };
}

export function titlebarAction(label: string, content: string | HTMLElement, onClick: () => void, className = ''): HTMLButtonElement {
  const button = element('button', `ui-titlebar-action ${className}`.trim());
  button.type = 'button';
  button.setAttribute('aria-label', label);
  if (typeof content === 'string') button.textContent = content;
  else button.append(content);
  button.addEventListener('click', onClick);
  return button;
}

export function metricItem(label: string, value: string, options: {
  className?: string;
  valueFirst?: boolean;
} = {}): HTMLSpanElement {
  const item = element('span', options.className ?? '');
  const labelNode = element('small', '', label);
  const valueNode = element('strong', '', value);
  item.append(...(options.valueFirst ? [valueNode, labelNode] : [labelNode, valueNode]));
  return item;
}

export function metricGroup(items: Array<[string, string]>, options: {
  className?: string;
  itemClassName?: string;
  valueFirst?: boolean;
} = {}): HTMLDivElement {
  const group = element('div', `ui-metrics${options.className ? ` ${options.className}` : ''}`);
  items.forEach(([label, value]) => group.append(metricItem(label, value, {
    className: options.itemClassName,
    valueFirst: options.valueFirst,
  })));
  return group;
}

export function disclosure(summary: string | readonly HTMLElement[] | HTMLElement, className = ''): HTMLDetailsElement {
  const details = element('details', className);
  const trigger = summary instanceof HTMLElement ? summary : element('summary');
  if (typeof summary === 'string') trigger.textContent = summary;
  else if (!(summary instanceof HTMLElement)) trigger.append(...summary);
  details.append(trigger);
  return details;
}

export function optionalDetails(summary: string | readonly HTMLElement[], className = ''): HTMLDetailsElement {
  return disclosure(summary, `optional-details ${className}`.trim());
}

export function overflowMenu(summary: string, items: readonly HTMLElement[], options: {
  ariaLabel?: string;
  compactTrigger?: boolean;
} = {}): HTMLDetailsElement {
  const trigger = element('summary', options.compactTrigger ? 'quest-more-trigger' : '', summary);
  trigger.setAttribute('aria-label', options.ariaLabel ?? summary);
  const menu = disclosure(trigger, 'quest-more-actions');
  const actions = element('div', 'quest-more-buttons');
  actions.append(...items);
  menu.append(actions);
  return menu;
}

export function segmentedControl<K extends 'div' | 'nav'>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  return element(tag, `ui-segmented ${className}`.trim());
}

export function segmentedItem<K extends 'a' | 'button'>(tag: K, label = '', options: {
  className?: string;
  active?: boolean;
} = {}): HTMLElementTagNameMap[K] {
  const className = ['ui-segmented-item', options.className, options.active && 'is-active'].filter(Boolean).join(' ');
  const item = element(tag, className, label);
  if (item instanceof HTMLButtonElement) item.type = 'button';
  return item;
}

export function periodNavigator(label: string, options: {
  ariaLabel: string;
  className?: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
}): HTMLElement {
  const nav = element('nav', `ui-period-nav ${options.className ?? ''}`.trim());
  nav.setAttribute('aria-label', options.ariaLabel);
  const button = (direction: 'previous' | 'next', text: string, onClick: () => void, disabled = false): HTMLButtonElement => {
    const control = element('button', `icon-only is-${direction}`);
    control.type = 'button';
    control.disabled = disabled;
    control.setAttribute('aria-label', text);
    control.append(element('span', '', text));
    control.addEventListener('click', onClick);
    return control;
  };
  nav.append(
    button('previous', options.previousLabel, options.onPrevious, options.previousDisabled),
    element('span', 'ui-period-label', label),
    button('next', options.nextLabel, options.onNext, options.nextDisabled),
  );
  return nav;
}

export function avatarChoice(label: string, imageSource: string, onClick: () => void): HTMLButtonElement {
  const choice = element('button', 'avatar-choice');
  choice.type = 'button';
  choice.setAttribute('aria-label', `选择${label}`);
  choice.setAttribute('aria-pressed', 'false');
  const image = element('img', 'avatar-choice-image');
  image.src = imageSource;
  image.alt = '';
  choice.append(image, element('span', '', label));
  choice.addEventListener('click', onClick);
  return choice;
}

export function avatarChoiceGroup(...children: HTMLElement[]): HTMLDivElement {
  const group = element('div', 'ui-avatar-choice-group');
  group.append(...children);
  return group;
}

export function choiceGroup(className = '', ...children: HTMLElement[]): HTMLDivElement {
  const group = element('div', `ui-choice-group ${className}`.trim());
  group.append(...children);
  return group;
}

export function choiceRow(label: string, options: {
  selected?: boolean;
  value?: string;
  className?: string;
  onSelect: () => void;
}): HTMLButtonElement {
  const choice = listRow('button', `ui-choice-row ${options.className ?? ''}`.trim());
  choice.textContent = label;
  choice.dataset.value = options.value;
  choice.setAttribute('aria-pressed', String(options.selected ?? false));
  choice.addEventListener('click', options.onSelect);
  return choice;
}

export function listSection(title: string, options: {
  className?: string;
  headingClassName?: string;
  tail?: HTMLElement;
} = {}, ...children: HTMLElement[]): HTMLElement {
  const section = element('section', `ui-list-section ${options.className ?? ''}`.trim());
  section.append(sectionHeading(title, { className: options.headingClassName, tail: options.tail }), ...children);
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

export function recordItem(options: {
  variant: 'preview' | 'bubble' | 'detail';
  body: string;
  time: string;
  kind?: string;
  imageSource?: string;
  leading?: HTMLElement;
  onOpen: () => void;
}): HTMLButtonElement {
  const kind = options.kind ?? 'journal';
  const variantClass = options.variant === 'preview'
    ? 'today-record-row'
    : options.variant === 'bubble'
      ? `life-diary-bubble${options.imageSource ? ' has-image' : ''}`
      : 'day-record-row';
  const item = options.variant === 'preview'
    ? listRow('button', `ui-record-item ${variantClass} is-${kind}`)
    : element('button', `ui-record-item ${variantClass} is-${kind}`);
  item.type = 'button';
  item.setAttribute('aria-label', `查看记录详情：${options.body.slice(0, 30) || '图片'}`);

  if (options.variant === 'preview') {
    if (options.leading) item.append(options.leading);
    item.append(element('span', 'today-record-copy', options.body || '图片记录'), element('time', 'caption', options.time));
  } else if (options.variant === 'bubble') {
    if (options.imageSource) {
      const image = element('img', 'life-diary-image');
      image.src = options.imageSource;
      image.alt = options.body ? '记录图片' : '图片记录';
      item.append(image);
    }
    if (options.body) item.append(element('span', 'life-diary-copy', options.body));
    item.append(element('time', 'life-diary-time', options.time));
  } else {
    const copy = element('div', 'day-record-copy');
    const meta = element('div', 'day-record-meta');
    meta.append(element('time', '', options.time), element('span', 'day-record-kind', '生活日记'));
    copy.append(meta);
    if (options.imageSource) {
      const image = element('img', 'day-record-image');
      image.src = options.imageSource;
      image.alt = options.body ? '记录图片' : '图片记录';
      copy.append(image);
    }
    if (options.body) copy.append(element('p', 'day-record-body', options.body));
    item.append(copy);
  }
  item.addEventListener('click', options.onOpen);
  return item;
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
