// Read-only inventory: literal values and repeated declarations are review candidates,
// not proof that a rule is live, invalid, or safe to delete.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import * as csstree from 'css-tree';

const root = fileURLToPath(new URL('../', import.meta.url));
export const dimensionProperty = /^(?:font-size|line-height|padding(?:-.+)?|margin(?:-.+)?|(?:row-|column-)?gap|(?:min-|max-)?(?:width|height)|border(?:-.+)?-radius)$/i;
export const dimensionLiteral = /(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px|cm|mm|q|in|pc|pt|em|ex|cap|ch|ic|lh|rem|rex|rcap|rch|ric|rlh|(?:s|l|d)?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))\b/i;
export const invalidFunctionNegation = /(^|[\s,(])-(?:var|calc)\(/i;
export const dimensionKey = item => JSON.stringify([item.context, item.selector.replace(/\s+/g, ' ').trim(), item.property, item.important]);
export const dimensionDecisions = ledger => [...ledger.decisions, ...(ledger.groups || []).flatMap(({ indexes, ...decision }) => indexes.map(index => ({ index, ...decision })))];

function resolvePublicTokens(value, tokens, resolving = new Set()) {
  return value.replace(/var\((--[\w-]+)\)/g, (reference, token) => {
    if (!tokens.has(token) || resolving.has(token)) return reference;
    return resolvePublicTokens(tokens.get(token), tokens, new Set([...resolving, token]));
  });
}

function validPropertyValue(property, value, tokens) {
  try {
    const resolved = resolvePublicTokens(value, tokens);
    return Boolean(csstree.lexer.matchProperty(property.toLowerCase(), csstree.parse(resolved, { context: 'value' })).matched);
  } catch {
    return false;
  }
}

function declarationItem(decl) {
  const ancestors = [];
  for (let parent = decl.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule') ancestors.unshift(`@${parent.name} ${parent.params}`);
    else if (parent.type === 'rule' && parent !== decl.parent) ancestors.unshift(`rule(${JSON.stringify(parent.selector)})`);
  }
  return { line: decl.source.start.line, selector: decl.parent.selector || '', context: ancestors.join(' > '), property: decl.prop, value: decl.value, important: Boolean(decl.important) };
}

export function scanCss(source, file) {
  const literals = [], repeats = [], tokens = [], invalidProperties = [], seen = new Map();
  let declarations = 0;
  postcss.parse(source, { from: file }).walkDecls(decl => {
    declarations++;
    const item = declarationItem(decl);
    if (decl.prop.startsWith('--')) { tokens.push(item); return; }
    if (!csstree.lexer.getProperty(decl.prop.toLowerCase())) invalidProperties.push(item);
    if (dimensionProperty.test(decl.prop) && dimensionLiteral.test(decl.value)) literals.push(item);
    const key = [item.context, item.selector, item.property, item.important].join('|');
    const previous = seen.get(key);
    if (previous && previous.value !== item.value) repeats.push({ ...item, previousLine: previous.line, previousValue: previous.value });
    seen.set(key, item);
  });
  return { file, declarations, tokenDeclarations: tokens.length, literalDeclarations: literals.length, repeatedDifferentValues: repeats.length, invalidPropertyDeclarations: invalidProperties.length, literals, repeats, invalidProperties };
}

// The baseline is a fixed, pre-migration inventory, not an allowlist that is
// regenerated to make tests pass. Every resolution must have an explicit decision.
export function checkDimensionMigration(baseline, decisions, source, components) {
  const current = new Map(), publicRules = new Map(), publicTokens = new Map(), errors = [], resolved = new Map();
  postcss.parse(source).walkDecls(decl => {
    if (!dimensionProperty.test(decl.prop)) return;
    const item = declarationItem(decl);
    if (invalidFunctionNegation.test(item.value)) errors.push(`Invalid function negation: ${item.selector} ${item.property}: ${item.value}`);
    const key = dimensionKey(item);
    if (current.has(key)) errors.push(`Duplicate current dimension: ${item.context} ${item.selector} ${item.property}`);
    current.set(key, item);
  });
  postcss.parse(components).walkRules(rule => {
    if (rule.parent.type !== 'atrule' || rule.parent.name !== 'layer' || rule.parent.params !== 'components' || rule.parent.parent.type !== 'root') return;
    if (rule.selectors.includes(':root')) for (const decl of rule.nodes.filter(node => node.type === 'decl' && node.prop.startsWith('--'))) publicTokens.set(decl.prop, decl.value);
    for (const selector of rule.selectors) for (const decl of rule.nodes.filter(node => node.type === 'decl' && !node.important)) publicRules.set(`${selector}|${decl.prop}`, decl.value);
  });
  for (const decision of decisions) {
    if (!Number.isInteger(decision.index) || decision.index < 0 || decision.index >= baseline.length) { errors.push(`Invalid decision index: ${decision.index}`); continue; }
    const original = baseline[decision.index];
    if (!original || resolved.has(decision.index) || !decision.reason?.trim()) { errors.push(`Invalid, duplicate or unexplained decision ${decision.index}`); continue; }
    resolved.set(decision.index, decision);
    const actual = current.get(dimensionKey(original));
    if (decision.action === 'remove') {
      if (actual) errors.push(`Removed dimension returned: ${original.selector} ${original.property}`);
      if (!decision.owner?.length || original.important) errors.push(`Missing safe owner: ${decision.index}`);
      for (const owner of decision.owner || []) if (publicRules.get(`${owner.selector}|${original.property}`) !== owner.value) errors.push(`Public owner changed: ${owner.selector} ${original.property}`);
      const selectors = postcss.rule({ selector: original.selector }).selectors;
      if (selectors.some(selector => !decision.owner?.some(owner => owner.selector === selector))) errors.push(`Unowned selector branch: ${decision.index}`);
    } else if (decision.action === 'token') {
      if (actual?.value !== decision.value || !/var\(--ui-[\w-]+\)/.test(decision.value) || dimensionLiteral.test(decision.value) || invalidFunctionNegation.test(decision.value) || !validPropertyValue(original.property, decision.value, publicTokens)) errors.push(`Invalid token migration: ${decision.index}`);
      for (const [, token] of decision.value.matchAll(/var\((--[\w-]+)/g)) if (!publicTokens.has(token)) errors.push(`Missing public token: ${token}`);
    } else if (decision.action === 'intrinsic') {
      if (actual) errors.push(`Intrinsic dimension returned: ${original.selector} ${original.property}`);
    } else if (decision.action === 'exception') {
      if (actual?.value !== original.value || !decision.category) errors.push(`Exception changed or unclassified: ${decision.index}`);
    } else errors.push(`Unknown decision action: ${decision.index}`);
  }
  const pending = [];
  baseline.forEach((original, index) => {
    if (resolved.has(index)) return;
    const actual = current.get(dimensionKey(original));
    if (actual?.value !== original.value) errors.push(`Changed without classification: ${index} ${original.selector} ${original.property}`);
    pending.push({ index, ...original });
  });
  const originalByKey = new Map();
  baseline.forEach((item, index) => {
    const key = dimensionKey(item);
    if (originalByKey.has(key)) errors.push(`Duplicate baseline dimension: ${index} ${item.selector} ${item.property}`);
    originalByKey.set(key, index);
  });
  for (const item of scanCss(source, 'src/styles.css').literals) {
    if (!originalByKey.has(dimensionKey(item))) errors.push(`New unclassified literal: ${item.selector} ${item.property}: ${item.value}`);
  }
  return { baseline: baseline.length, classified: resolved.size, pending: pending.length, errors, pendingItems: pending };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
if (process.argv.includes('--self-test')) {
  const result = scanCss(':root{--size:12px}.row{padding:var(--size);height:45px}.row{height:50px}@media(max-width:360px){.row{height:44PX;min-height:10vh;width:50%}}', 'fixture.css');
  assert.equal(result.literalDeclarations, 4);
  assert.equal(result.tokenDeclarations, 1);
  assert.equal(result.repeatedDifferentValues, 1, 'different media contexts must not be merged');
  assert.equal(result.repeats[0].previousValue, '45px');
  assert.equal(scanCss('.a{gap-inline:8px}', 'invalid.css').invalidPropertyDeclarations, 1);
  console.log('UI code inventory self-test passed');
} else {
  const files = ['src/styles.css', 'src/design-system.css', 'design/preview-layout.css'];
  const styles = await Promise.all(files.map(async file => scanCss(await readFile(resolve(root, file), 'utf8'), file)));
  const app = await readFile(resolve(root, 'src/app.ts'), 'utf8');
  // Deliberately lexical: lists literal call sites, not all dynamic routes/callbacks.
  const callSites = [];
  app.split(/\r?\n/).forEach((line, index) => {
    if (/node\('main'|dialogShell\(|\.style\./.test(line)) callSites.push({ file: 'src/app.ts', line: index + 1, source: line.trim() });
  });
  const report = { generatedAt: new Date().toISOString(), verdict: 'inventory-only-not-a-clean-bill', scope: 'Runtime and preview layout CSS parsed with PostCSS; app.ts call sites are lexical. Computed styles and device behavior require separate tests.', styles, callSites };
  const ledger = JSON.parse(await readFile(resolve(root, 'design/ui-dimension-decisions.json'), 'utf8'));
  const baseline = JSON.parse(await readFile(resolve(root, ledger.baseline), 'utf8')).styles.find(style => style.file === 'src/styles.css').literals;
  report.migration = checkDimensionMigration(baseline, dimensionDecisions(ledger), await readFile(resolve(root, 'src/styles.css'), 'utf8'), await readFile(resolve(root, 'src/design-system.css'), 'utf8'));
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex !== -1) {
    if (!process.argv[outputIndex + 1]) throw new Error('--output needs a path');
    const output = resolve(process.argv[outputIndex + 1]);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(`Inventory saved: ${output}`);
  }
  console.table(styles.map(({ file, declarations, literalDeclarations, repeatedDifferentValues }) => ({ file, declarations, literalDeclarations, repeatedDifferentValues })));
  assert.deepEqual(styles.flatMap(style => style.invalidProperties), [], 'Runtime CSS cannot contain unknown properties that browsers ignore');
  console.log(`Page/dialog/dynamic-style call sites: ${callSites.length}. Inventory completion does not mean UI conformance.`);
  console.log(`Dimensions: ${report.migration.classified}/${report.migration.baseline} classified; ${report.migration.pending} pending; ${report.migration.errors.length} drift errors.`);
  assert.deepEqual(report.migration.errors, [], 'Dimension changes require a verified classification');
  if (process.argv.includes('--strict')) assert.equal(report.migration.pending, 0, 'Every baseline dimension needs an explicit migration or justified exception');
}
}
