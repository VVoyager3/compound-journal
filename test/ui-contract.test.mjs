import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

const root = new URL('../', import.meta.url);
const [html, app, css, legacyCss, rows] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/design-system.css', root), 'utf8'),
  readFile(new URL('src/styles.css', root), 'utf8'),
  readFile(new URL('src/ui-list.ts', root), 'utf8'),
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
  for (const featureClass of ['habit-list-row', 'today-record-row', 'growth-dimension-card', 'analysis-category-row']) {
    assert.ok(app.split('\n').some(line => line.includes('listRow(') && line.includes(featureClass)), featureClass);
  }
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

test('migrated content uses shared primitives without a second goal menu skin', () => {
  for (const component of ['ui-panel', 'ui-actions', 'ui-form-stack', 'ui-row-main']) {
    assert.ok(app.includes(component), component);
    assert.ok(css.includes(`.${component}`), component);
  }
  assert.doesNotMatch(legacyCss, /\.goal-row\s+\.quest-more-actions/);
  assert.equal(app.includes('ui-setting-card'), false);
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
