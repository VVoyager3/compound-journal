import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { applyDimensionDecisions, removeOwnedGeometry } from '../scripts/prune-ui-css.mjs';
import { scanCss, checkDimensionMigration, dimensionDecisions } from '../scripts/audit-ui-code.mjs';

test('owned dimensions are deleted only with unconditional higher-layer coverage of every selector', () => {
  const legacy = '@layer legacy{.a,.b{gap:8px}.a{width:44px!important}@media(max-width:360px){.a{gap:4px}}}';
  const partial = '@layer components{.a{gap:var(--gap);width:var(--touch)}@media(max-width:360px){.b{gap:var(--gap)}}}';
  const result = removeOwnedGeometry(legacy, partial);
  assert.match(result.css, /\.a,\.b\{gap:8px\}/, 'one branch without ownership must remain');
  assert.match(result.css, /44px!important/, 'important legacy declarations reverse layer priority');
  assert.doesNotMatch(result.css, /gap:4px/, 'unconditional higher-layer rule also beats legacy media');
  assert.equal(result.removed.length, 1);
  assert.equal(removeOwnedGeometry(legacy, '@layer components{.a,.b{gap:var(--gap)}}').removed.length, 2);
  assert.throws(() => removeOwnedGeometry('.a{gap:8px}', partial), /legacy layer/);
  assert.equal(removeOwnedGeometry('@layer legacy{.a{width:44px}}', '@layer components{.a{& .child{width:var(--touch)}}}').removed.length, 0, 'nested selector is not unconditional ownership');
});

test('dimension ledger detects reintroduction, unrecorded edits and unowned selector branches', () => {
  const before = '@layer legacy{.a,.b{height:44px}.c{gap:12px}}';
  const baseline = scanCss(before, 'fixture').literals;
  const components = '@layer components{.a,.b{height:var(--ui-touch-size)}}';
  const decision = { index: 0, action: 'remove', reason: 'Public component owns both branches', owner: [{ selector: '.a', value: 'var(--ui-touch-size)' }, { selector: '.b', value: 'var(--ui-touch-size)' }] };
  const after = '@layer legacy{.c{gap:12px}}';
  assert.deepEqual(checkDimensionMigration(baseline, [decision], after, components).errors, []);
  assert.equal(checkDimensionMigration(baseline, [decision], after, components).pending, 1);
  assert.ok(checkDimensionMigration(baseline, [decision], before, components).errors.length);
  assert.ok(checkDimensionMigration(baseline, [], after, components).errors.length);
  assert.ok(checkDimensionMigration(baseline, [decision], after + '.new{height:36px}', components).errors.length);
  assert.ok(checkDimensionMigration(baseline, [{ ...decision, owner: decision.owner.slice(0, 1) }], after, components).errors.length);
  assert.ok(checkDimensionMigration(baseline, [decision, decision], after, components).errors.length);
});

test('intrinsic decisions remove arbitrary constraints and reject their return', () => {
  const before = '@layer legacy{.card{min-height:140px}.row{height:44px}}';
  const baseline = scanCss(before, 'fixture').literals;
  const decisions = [
    { index: 0, action: 'intrinsic', reason: 'Content determines card height' },
    { index: 1, action: 'token', value: 'var(--ui-touch-size)', reason: 'Shared control height' },
  ];
  const applied = applyDimensionDecisions(before, baseline, decisions);
  assert.doesNotMatch(applied.css, /min-height/);
  assert.match(applied.css, /height:var\(--ui-touch-size\)/);
  assert.deepEqual(checkDimensionMigration(baseline, decisions, applied.css, '@layer components{:root{--ui-touch-size:44px}}').errors, []);
  assert.ok(checkDimensionMigration(baseline, decisions, before, '@layer components{:root{--ui-touch-size:44px}}').errors.some(error => error.includes('Intrinsic dimension returned')));
  assert.equal(applyDimensionDecisions(applied.css, baseline, decisions).changed, 0, 'applying the ledger twice is idempotent');
});

test('dimension inventory accepts CSS length units case-insensitively but not percentages', () => {
  const result = scanCss('.a{HEIGHT:44PX;margin-top:10vh;width:1cqw;min-width:2cqh;max-width:3cqi;padding:4cqb;gap:5cqmin;border-radius:6cqmax}.b{width:50%}', 'fixture');
  assert.deepEqual(result.literals.map(({ property, value }) => [property, value]), [
    ['HEIGHT', '44PX'], ['margin-top', '10vh'], ['width', '1cqw'], ['min-width', '2cqh'], ['max-width', '3cqi'],
    ['padding', '4cqb'], ['gap', '5cqmin'], ['border-radius', '6cqmax'],
  ]);
});

test('CSS inventory rejects unknown properties that browsers silently ignore', () => {
  const result = scanCss('.a{column-gap:8px;gap-inline:8px}', 'fixture');
  assert.deepEqual(result.invalidProperties.map(({ property }) => property), ['gap-inline']);
});

test('token migration rejects values outside the target property grammar', () => {
  const before = '@layer legacy{.a{height:44px}}';
  const baseline = scanCss(before, 'fixture').literals;
  const components = '@layer components{:root{--ui-touch-size:44px}}';
  const decision = { index: 0, action: 'token', value: 'garbage var(--ui-touch-size)', reason: 'Invalid fixture' };
  assert.ok(checkDimensionMigration(baseline, [decision], '@layer legacy{.a{height:garbage var(--ui-touch-size)}}', components).errors.some(error => error.includes('Invalid token migration')));
});

test('token migration requires valid function negation and stays idempotent', () => {
  const before = '@layer legacy{.a{margin:-4px 0}}';
  const baseline = scanCss(before, 'fixture').literals;
  const valid = [{ index: 0, action: 'token', value: 'calc(-1 * var(--ui-space-2)) 0', reason: 'Shared negative spacing' }];
  const applied = applyDimensionDecisions(before, baseline, valid);
  assert.match(applied.css, /margin:calc\(-1 \* var\(--ui-space-2\)\) 0/);
  assert.equal(applyDimensionDecisions(applied.css, baseline, valid).changed, 0);
  assert.throws(() => applyDimensionDecisions(before, baseline, [{ ...valid[0], value: '-var(--ui-space-2) 0' }]), /Invalid token migration value/);
  assert.ok(checkDimensionMigration(baseline, [{ ...valid[0], value: '-var(--ui-space-2) 0' }], '@layer legacy{.a{margin:-var(--ui-space-2) 0}}', '@layer components{:root{--ui-space-2:4px}}').errors.some(error => error.includes('Invalid token migration')));
});

test('dimension ledger rejects duplicate declaration identities instead of hiding earlier values', () => {
  const before = '@layer legacy{.a{height:44px}}';
  const baseline = scanCss(before, 'fixture').literals;
  for (const after of [
    '@layer legacy{.a{height:900px;height:44px}}',
    '@layer legacy{.a{height:900px}.a{height:44px}}',
    '@layer legacy{.a{height:44px;height:44px}}',
  ]) assert.ok(checkDimensionMigration(baseline, [], after, '').errors.some(error => error.includes('Duplicate current dimension')));
  assert.ok(checkDimensionMigration([...baseline, ...baseline], [], before, '').errors.some(error => error.includes('Duplicate baseline dimension')));
});

test('dimension identities retain nested rule ancestors and conditional contexts', () => {
  const before = '@layer legacy{.a{height:44px}}';
  const baseline = scanCss(before, 'fixture').literals;
  const after = '@layer legacy{.parent{.a{height:900px}}.a{height:44px}}';
  assert.ok(checkDimensionMigration(baseline, [], after, '').errors.some(error => error.includes('New unclassified literal')));
  const nested = '@layer legacy{.one{.a{height:44px}@media(min-width:600px){height:48px}}.two{.a{height:50px}@media(min-width:600px){height:54px}}}';
  const inventory = scanCss(nested, 'fixture');
  assert.equal(inventory.repeatedDifferentValues, 0, 'different parent selectors must not collide');
  assert.deepEqual(checkDimensionMigration(inventory.literals, [], nested, '').errors, []);
  assert.ok(checkDimensionMigration(inventory.literals, [], nested.replace('.one', '.three'), '').errors.length);
});

test('dimension decision indexes must be in-range integers before lookup or classification', () => {
  const source = '@layer legacy{.a{height:44px}}';
  const baseline = scanCss(source, 'fixture').literals;
  const decision = { index: 0, action: 'exception', reason: 'Fixture geometry', category: 'fixture' };
  for (const index of ['0', -1, 0.5, 1, NaN, Infinity, null]) {
    const result = checkDimensionMigration(baseline, [decision, { ...decision, index }], source, '');
    assert.ok(result.errors.length, `invalid index ${index} must be rejected`);
    assert.equal(result.classified, 1);
    assert.equal(result.pending, 0);
  }
  const invalidOnly = checkDimensionMigration(baseline, [{ ...decision, index: '0' }], source, '');
  assert.equal(invalidOnly.classified, 0);
  assert.equal(invalidOnly.pending, 1);
});

test('all current legacy dimension changes have explicit decisions, with no new unclassified literals', async () => {
  const root = new URL('../', import.meta.url);
  const ledger = JSON.parse(await readFile(new URL('design/ui-dimension-decisions.json', root), 'utf8'));
  const baseline = JSON.parse(await readFile(new URL(ledger.baseline, root), 'utf8')).styles.find(style => style.file === 'src/styles.css').literals;
  const result = checkDimensionMigration(baseline, dimensionDecisions(ledger), await readFile(new URL('src/styles.css', root), 'utf8'), await readFile(new URL('src/design-system.css', root), 'utf8'));
  assert.equal(baseline.length, 1276, 'do not refresh the baseline to conceal unresolved dimensions');
  assert.deepEqual(result.errors, []);
});

test('runtime CSS has no geometry still owned by the exact public component selector', async () => {
  const legacy = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const shared = await readFile(new URL('../src/design-system.css', import.meta.url), 'utf8');
  assert.deepEqual(removeOwnedGeometry(legacy, shared).removed, []);
});

test('public components express geometry through the adjustable token system', async () => {
  const shared = await readFile(new URL('../src/design-system.css', import.meta.url), 'utf8');
  assert.deepEqual(scanCss(shared, 'src/design-system.css').literals, []);
});

test('spacing token substitutions preserve shorthand sides and zero insets', async () => {
  const root = new URL('../', import.meta.url);
  const ledger = JSON.parse(await readFile(new URL('design/ui-dimension-decisions.json', root), 'utf8'));
  const baseline = JSON.parse(await readFile(new URL(ledger.baseline, root), 'utf8')).styles.find(style => style.file === 'src/styles.css').literals;
  for (const decision of dimensionDecisions(ledger)) {
    const original = baseline[decision.index];
    if (decision.action !== 'token' || !/^(margin|padding|border-radius)$/.test(original.property)) continue;
    // This migration replaces individual lengths, not entire shorthand templates.
    // A horizontal-only inset must not accidentally become an all-sides inset.
    const before = postcss.list.space(original.value), after = postcss.list.space(decision.value);
    assert.equal(after.length, before.length, `shorthand sides changed at ${decision.index}`);
    before.forEach((value, side) => {
      if (value === '0') assert.equal(after[side], '0', `zero inset changed at ${decision.index}`);
    });
  }
});
