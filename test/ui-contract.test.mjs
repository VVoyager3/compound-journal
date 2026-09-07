import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

const root = new URL('../', import.meta.url);
const [html, app, css, legacyCss, rows, preview] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/design-system.css', root), 'utf8'),
  readFile(new URL('src/styles.css', root), 'utf8'),
  readFile(new URL('src/ui-list.ts', root), 'utf8'),
  readFile(new URL('design/list-preview.ts', root), 'utf8'),
]);

test('the UI contract loads after legacy page styles', () => {
  assert.ok(html.indexOf('styles.css') < html.indexOf('design-system.css'));
  assert.match(legacyCss, /^@layer legacy \{/);
  assert.match(css, /@layer components \{/);
});

test('shared component classes and adjustable tokens stay available', () => {
  for (const token of ['--ui-font-page', '--ui-space-3', '--ui-radius-control', '--ui-touch-size', '--ui-row-height']) {
    assert.match(css, new RegExp(token));
  }
  for (const component of ['ui-titlebar', 'ui-page-title', 'ui-back-button', 'ui-segmented', 'ui-segmented-item', 'ui-filter-item', 'ui-list-row', 'ui-action-row', 'ui-data-row']) {
    assert.ok((app + rows).includes(component), component);
  }
});

test('the four text roles have one authoritative scale', () => {
  assert.match(css, /--ui-font-page: 1rem;/);
  assert.match(css, /--ui-font-title: 0\.90625rem;/);
  assert.match(css, /--ui-font-body: 0\.78125rem;/);
  assert.match(css, /--ui-font-meta: 0\.71875rem;/);
  assert.match(css, /\.page :is\(h2, h3\):not\(\.ui-page-title\)/);
  assert.match(css, /\.page \.ui-list-row :is\(h2, h3\)/);
  assert.match(app, /node\('label', 'ui-list-section'\)[\s\S]*node\('span', 'ui-list-heading', '正文'\)/);
});

test('equivalent rows opt into one shared geometry component', () => {
  for (const featureClass of ['habit-list-row', 'growth-dimension-card', 'analysis-category-row']) {
    assert.ok(app.split('\n').some(line => line.includes('listRow(') && line.includes(featureClass)), featureClass);
  }
  assert.match(rows, /export function recordItem/);
  assert.equal((app.match(/recordItem\(\{/g) ?? []).length, 3, 'all record summaries share one constructor');
  assert.equal(app.includes("node('button', `life-diary-bubble"), false);
  assert.equal(app.includes("node('button', `day-record-row"), false);
  assert.equal(app.includes("listRow('button', 'today-record-row')"), false);
  assert.ok(app.includes('const item = taskRow('));
  assert.ok(app.includes('const row = infoRow(label, statusCell'));
  assert.ok(rows.includes("listRow('article', `ui-action-row task-list-item"));
  for (const old of ['ui-navigation-row', 'ui-state-row', 'setting-row-text', 'ai-info-row']) {
    assert.equal(app.includes(old), false, `${old} must not remain a parallel app row`);
  }
  assert.equal(/\.(?:task-list-item|task-row-action|habit-list-row|settings-overview-row|setting-row|list-row|ai-info-row)(?![\w-])/.test(legacyCss), false, 'migrated row skins must be removed, not overridden');
});

test('habit check-in customises the shared task row through its API', () => {
  assert.match(app, /interface TaskRowPresentation/);
  assert.doesNotMatch(app, /row\.querySelector\('h3'\)/);
});

test('settled tasks enter the shared task row without a card detour', () => {
  assert.match(app, /settledQuests\.forEach\(\(quest\) => settledList\.append\(taskListQuest\(quest\)\)\)/);
  assert.doesNotMatch(app, /function questCard\([^)]*taskList/);
});

test('obsolete parallel presentation skins cannot return', () => {
  for (const className of [
    'quest-row', 'overdue-quest-row', 'habit-momentum-row', 'ledger-row', 'milestone-row', 'habit-log-row', 'analysis-result-row',
    'record-summary-block', 'record-summary-input', 'day-summary', 'entry-card', 'day-record-icon', 'day-action-icon',
    'day-action-chevron', 'day-evidence-card', 'analysis-bottom-actions',
    'record-form', 'record-body-heading', 'record-body-section', 'record-number-tools', 'record-number-button',
    'record-prompts', 'record-prompt-actions', 'record-type-option', 'record-kind-heading', 'journal-editor',
    'record-template-control', 'record-template-select', 'record-submit-bar', 'record-attachment-button',
    'day-record-more', 'day-record-actions',
    'main-action', 'simple-list', 'entry-timeline', 'entry-meta', 'entry-actions', 'journal-sheet-actions',
    'journal-entry', 'journal-entry-heading', 'journal-entry-actions', 'journal-entry-more',
    'journal-entry-more-buttons', 'review-card-icon', 'review-focus-card', 'review-hero', 'review-actions',
    'review-experiment', 'review-experiment-facts', 'review-proposed-experiment',
    'assessment-start-actions', 'assessment-dimension-actions', 'badge-category-summary', 'goal-status',
    'growth-habits', 'growth-overview', 'growth-overview-stat', 'growth-overview-value', 'growth-progress-stat',
    'growth-month-xp', 'growth-overall-level', 'growth-level-progress', 'growth-overall-progress', 'growth-seed',
    'habit-actions', 'habit-heat-summary', 'state-related-heading', 'task-goal-list', 'task-habit-list', 'task-subheading',
  ]) {
    assert.doesNotMatch(app + legacyCss, new RegExp(`(^|[^\\w-])${className}([^\\w-]|$)`), `${className} must stay deleted`);
  }
});

test('every dialog gets the shared titlebar before optional back navigation', () => {
  const shell = app.slice(app.indexOf('function dialogShell('), app.indexOf('function showOnboarding('));
  assert.match(shell, /titleBar\(title/);
  assert.doesNotMatch(shell, /node\('header'/);
  assert.doesNotMatch(shell, /content\.append\(heading\)/);
  assert.match(shell, /options\.fullScreen/);
  assert.match(shell, /options\.back/);
  assert.equal(app.includes('function addDialogBack('), false);
  assert.doesNotMatch(app, /classList\.add\('full-screen-editor/);
});

test('migrated content uses shared primitives without a second goal menu skin', () => {
  for (const component of ['ui-panel', 'ui-actions', 'ui-form-stack', 'ui-row-main']) {
    assert.ok((app + rows).includes(component), component);
    assert.ok(css.includes(`.${component}`), component);
  }
  assert.doesNotMatch(legacyCss, /\.goal-row\s+\.quest-more-actions/);
  assert.equal(app.includes('ui-setting-card'), false);
});

test('section headings and empty states have one DOM constructor', () => {
  assert.match(rows, /export function sectionHeading/);
  assert.match(rows, /export function emptyState/);
  assert.equal(app.includes("node('div', 'section-heading"), false);
  assert.equal(app.includes("node('p', 'empty-copy'"), false);
  assert.equal((app + css).includes('ui-settings-group'), false, 'settings must use the same list-section skeleton');
});

test('numeric summaries share one metric group, item, and geometry', () => {
  assert.match(rows, /export function metricItem/);
  assert.match(rows, /export function metricGroup/);
  for (const summaryClass of ['review-summary-stats', 'habit-detail-stats', 'analysis-summary-grid', 'habit-focus-summary']) {
    assert.ok(app.includes(summaryClass), summaryClass);
  }
  assert.equal(app.includes("node('section', 'habit-detail-stats ui-metrics')"), false);
  assert.equal(app.includes("node('section', 'analysis-summary-grid ui-metrics')"), false);
  assert.equal(app.includes("node('section', 'habit-focus-summary ui-metrics')"), false);
  assert.equal(app.includes("node('div', 'review-summary-stats ui-metrics')"), false);
  assert.equal(app.includes("const stat = node('span')"), false);
  assert.equal(legacyCss.includes('habit-stats-note'), false);
  assert.doesNotMatch(legacyCss, /\.habit-detail-stats\s*>\s*\.habit-stat/);
  assert.equal((app + css + legacyCss).includes('habit-overview-summary'), false, 'never-mounted habit summary must stay deleted');
});

test('primary and secondary pages share one header constructor', () => {
  assert.match(app, /function pageHeader\(title: string, options:/);
  assert.match(app, /options\.back \? ' secondary-page-header'/);
  assert.equal(app.includes('function secondaryPageHeader('), false);
});

test('action groups and segmented controls have one DOM constructor', () => {
  assert.match(rows, /export function actionGroup/);
  assert.match(rows, /export function segmentedControl/);
  assert.match(rows, /export function segmentedItem/);
  assert.equal(/node\('(div|nav)', '[^']*ui-segmented/.test(app), false);
  assert.equal(/node\('(button|a)', [^\n]*ui-segmented-item/.test(app), false);
  assert.equal(app.includes("node('div', 'ui-actions"), false);
});

test('calendar and review periods share one navigator', () => {
  assert.match(rows, /export function periodNavigator/);
  assert.equal(app.includes('function calendarMonthButton'), false);
  assert.equal(app.includes("node('div', 'calendar-toolbar')"), false);
  assert.equal(app.includes("node('nav', 'review-period-nav')"), false);
  assert.match(css, /\.ui-period-nav\s*\{/);
  assert.doesNotMatch(legacyCss, /\.review-period-nav\s*\.button\s*\{/);
  assert.doesNotMatch(legacyCss, /\.page-calendar \.calendar-toolbar \.icon-only\s*\{/);
});

test('onboarding and settings share one avatar choice', () => {
  assert.match(rows, /export function avatarChoice/);
  assert.match(rows, /export function avatarChoiceGroup/);
  assert.equal(app.includes("node('button', 'avatar-choice')"), false);
  assert.equal(app.includes("node('img', 'avatar-choice-image')"), false);
  assert.equal(app.includes("node('div', 'avatar-choices"), false);
  assert.equal((app.match(/avatarChoice\(/g) ?? []).length, 2);
  assert.equal((app.match(/avatarChoiceGroup\(/g) ?? []).length, 2);
  assert.equal((app.match(/avatarChoiceGroup\(\)/g) ?? []).length, 2);
  assert.equal((app + rows + legacyCss + css).includes('profile-avatar-choices'), false);
  assert.equal(rows.includes('avatar-choices'), false);
  assert.equal(app.includes('avatar-female-cartoon.png'), false, 'onboarding must reuse the lightweight companion sprite');
  assert.equal(app.includes('avatar-male-cartoon.png'), false, 'onboarding must reuse the lightweight companion sprite');
});

test('single-select list choices share one constructor and selected state', () => {
  assert.match(rows, /export function choiceGroup/);
  assert.match(rows, /export function choiceRow/);
  assert.equal((app.match(/choiceGroup\(/g) ?? []).length, 2);
  assert.equal((app.match(/choiceRow\(/g) ?? []).length, 3);
  assert.equal(app.includes("listRow('button', 'ui-choice-row"), false);
  assert.equal(app.includes("node('button', 'feedback-result-choice'"), false);
  assert.equal(app.includes("node('div', 'feedback-result-choices')"), false);
  assert.equal(app.includes("node('div', 'habit-completion-choices')"), false);
  assert.match(css, /\.ui-choice-group\s*\{/);
  assert.match(css, /\.ui-choice-row:is\(\.is-selected, \[aria-pressed="true"\], :hover\)/);
  assert.doesNotMatch(legacyCss, /\.feedback-result-choice(?:\[aria-pressed="true"\])?\s*\{/);
});

test('page and dialog chrome share back and titlebar action constructors', () => {
  assert.match(rows, /export function backButton/);
  assert.match(rows, /export function titleBar/);
  assert.match(rows, /export function titlebarAction/);
  assert.equal((app.match(/titleBar\(/g) ?? []).length, 2);
  assert.equal(app.includes("node('header', `page-header ui-titlebar"), false);
  assert.equal(app.includes("node('h1', 'ui-page-title'"), false);
  assert.equal(app.includes("node('h2', 'ui-page-title'"), false);
  assert.equal((app.match(/titlebarAction\(/g) ?? []).length, 4);
  assert.equal(app.includes("node('button', 'header-icon-button')"), false);
  assert.equal((app + legacyCss).includes('header-icon-button'), false);
  assert.equal(app.includes("node('button', 'secondary-back ui-back-button')"), false);
  assert.equal(app.includes("node('button', 'dialog-back ui-back-button')"), false);
  assert.equal(app.includes("node('button', 'detail-header-more'"), false);
  assert.equal((app + legacyCss).includes('detail-header-analysis'), false, 'never-mounted habit analysis action must stay deleted');
  for (const deadComponent of ['goal-detail-meta-grid', 'habit-detail-meta', 'habit-detail-meta-row', 'habit-detail-meta-icon']) {
    assert.equal((app + legacyCss).includes(deadComponent), false, `${deadComponent} must stay deleted because it was never mounted`);
  }
  for (const deadComponent of ['closeout-checklist', 'first-use-guide', 'first-use-next', 'assessment-mode-grid', 'assessment-mode', 'analysis-range-select', 'review-evidence-row', 'same-day-row']) {
    assert.equal((app + legacyCss).includes(deadComponent), false, `${deadComponent} must stay deleted because it has no runtime entry point`);
  }
});

test('common form and text-action structures have one DOM constructor', () => {
  assert.match(rows, /export function formStack/);
  assert.match(rows, /export function labelledControl/);
  assert.match(rows, /export function textAction/);
  assert.match(rows, /export function actionButton/);
  assert.match(rows, /export function fileButton/);
  assert.match(rows, /export function primaryButton/);
  assert.match(rows, /export function statusMessage/);
  assert.match(rows, /export function disclosure/);
  assert.match(rows, /export function optionalDetails/);
  assert.match(rows, /export function overflowMenu/);
  assert.equal(app.includes('function labelledControl('), false);
  assert.equal(app.includes('function primaryButton('), false);
  assert.equal(app.includes('function iconButton('), false);
  assert.equal(app.includes('iconButton('), false);
  assert.equal(app.includes("node('div', 'ui-form-stack"), false);
  assert.equal((app + css).includes('ui-editor-fields'), false, 'editors must reuse ui-form-stack');
  assert.equal(app.includes("node('div', 'quest-adjust-shortcuts"), false);
  assert.equal(app.includes("node('button', 'section-text-action"), false);
  assert.equal(app.includes("node('button', 'page-header-text-action"), false);
  assert.equal(app.includes("node('p', 'save-state"), false);
  assert.equal(app.includes("node('p', 'journal-empty"), false);
  assert.equal(app.includes("node('header', 'personal-review-header"), false);
  assert.equal(app.includes("node('section', 'preview-group"), false);
  assert.equal(app.includes("node('section', 'event-evidence"), false);
  assert.equal(app.includes("node('section', 'settings-group"), false);
  assert.equal(app.includes("node('section', 'entity-detail-section"), false);
  assert.equal(app.includes("node('section', 'event-growth-decision"), false);
  assert.equal(app.includes("node('section', 'daily-reflection"), false);
  assert.equal(app.includes("node('section', 'quest-suggestions"), false);
  assert.equal(app.includes("node('section', 'surface review-intro"), false);
  assert.equal(app.includes("node('section', 'surface overdue-quests"), false);
  assert.equal(app.includes("node('section', 'search-section calendar-search-panel"), false);
  assert.equal(app.includes("node('section', 'surface settings-section memory-settings"), false);
  assert.equal(app.includes("node('h2', 'growth-dimension-title'"), false);
  for (const title of ['第一步完成', '先补足', '之后已安排']) {
    assert.equal(app.includes(`node('h2', '', \`${title}`) || app.includes(`node('h2', '', '${title}')`), false, `${title} must use sectionHeading`);
  }
  assert.equal(app.includes("node('h2', 'settings-group-title"), false);
  assert.equal(app.includes("node('details'"), false, 'all disclosure skeletons must share one constructor');
  assert.equal(app.includes("node('section', 'journal-sheet')"), false, 'day records must use the shared section constructor');
  assert.equal(app.includes("node('section', 'day-action-results')"), false, 'day results must use the shared section constructor');
  assert.equal(app.includes("node('section', 'surface monthly-snapshot')"), false, 'month summaries must use the shared section constructor');
  assert.equal(app.includes("selectedPreview.append(node('h2'"), false, 'calendar previews must use the shared heading constructor');
  assert.equal(app.includes("adjustments.append(adjustmentIcon, node('h2'"), false, 'review adjustments must use the shared heading constructor');
  assert.doesNotMatch(app, /const (?:cancel|close|later) = node\('button', 'button button-/);
  assert.doesNotMatch(app, /node\('button',[^\n]*\bbutton-(?:primary|secondary|quiet|danger)\b/);
  assert.doesNotMatch(app, /node\('button',\s*'button(?:\s|')/);
  assert.doesNotMatch(app, /node\('details',[^\n]*\boptional-details\b/);
  assert.doesNotMatch(app, /node\('details',[^\n]*\bquest-more-actions\b/);
  assert.doesNotMatch(app, /node\('section',[^\n]*\bui-list-section\b/);
  assert.doesNotMatch(app, /node\('label',[^\n]*\bbutton-secondary file-button\b/);
  assert.doesNotMatch(preview, /className = '(?:ui-segmented|ui-actions|ui-form-stack|field-label)'/);
  assert.doesNotMatch(preview, /className = 'button button-/);
});

test('search and save feedback share one status message', () => {
  assert.equal(app.includes("node('p', 'search-status')"), false);
  assert.equal((app + legacyCss).includes('search-status'), false);
  assert.match(app, /const searchStatus = statusMessage\(\)/);
});

test('migrated text roles cannot regain legacy typography or discrete shared pixel sizes', () => {
  const roles = ['.caption', '.muted', '.empty-copy', '.save-state', '.status-name', '.settings-overview-status', '.page-header-meta', '.character-count', '.state-score-date'];
  const typography = new Set(['font', 'font-size', 'font-weight', 'line-height', 'letter-spacing']);
  const violations = [];
  postcss.parse(legacyCss).walkRules(rule => {
    if (!rule.selectors.some(selector => roles.some(role => selector.includes(role)))) return;
    rule.walkDecls(decl => {
      if (typography.has(decl.prop)) violations.push(`${rule.selector}: ${decl.prop}`);
    });
  });
  assert.deepEqual(violations, [], 'legacy CSS must not own migrated text roles');
  postcss.parse(css).walkDecls(decl => {
    if (decl.prop.startsWith('--')) return;
    if (/^(?:font-size|padding(?:-.+)?|margin(?:-.+)?|(?:row-|column-)?gap|(?:min-|max-)?(?:width|height))$/.test(decl.prop)) {
      assert.doesNotMatch(decl.value, /\d+(?:\.\d+)?px\b/, `${decl.parent.selector}: shared sizes belong to tokens`);
    }
  });
});

test('business layout CSS cannot define a parallel typography system', () => {
  const violations = [];
  postcss.parse(legacyCss).walkDecls(decl => {
    if (/^(font|font-size|font-weight|line-height|letter-spacing)$/.test(decl.prop)
      || (decl.prop === 'font-family' && decl.value !== 'inherit')) violations.push(`${decl.parent.selector}: ${decl.prop}`);
  });
  assert.deepEqual(violations, []);
});
