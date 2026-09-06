// Mechanical migration: remove only declarations superseded by the same selector,
// property, importance and at-rule context. Do not infer dead selectors from screenshots.
import postcss from 'postcss';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { dimensionProperty, dimensionLiteral, dimensionKey, dimensionDecisions, invalidFunctionNegation } from './audit-ui-code.mjs';

// Only exact selectors in the later, unconditional component layer establish
// ownership. Do not guess equivalence of :is(), nested rules or CSS shorthands.
export function removeOwnedGeometry(source, componentSource) {
  const owned = new Map();
  postcss.parse(componentSource).walkRules(rule => {
    const parents = [];
    for (let parent = rule.parent; parent; parent = parent.parent) if (parent.type !== 'root') parents.push(parent);
    if (parents.length !== 1 || parents[0].type !== 'atrule' || parents[0].name !== 'layer' || parents[0].params !== 'components') return;
    for (const selector of rule.selectors) for (const decl of rule.nodes.filter(node => node.type === 'decl' && !node.important)) {
      if (dimensionProperty.test(decl.prop)) owned.set(`${selector}|${decl.prop}`, decl.value);
    }
  });
  const root = postcss.parse(source), removed = [];
  if (root.nodes.some(node => node.type !== 'comment' && !(node.type === 'atrule' && node.name === 'layer' && node.params === 'legacy'))) throw Error('Expected only the legacy layer');
  root.walkDecls(decl => {
    if (decl.important || !dimensionProperty.test(decl.prop) || !decl.parent.selectors) return;
    const context = [];
    for (let parent = decl.parent.parent; parent; parent = parent.parent) {
      if (parent.type === 'rule' || (parent.type === 'atrule' && /keyframes/.test(parent.name))) return;
      if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params}`);
    }
    if (!decl.parent.selectors.every(selector => owned.has(`${selector}|${decl.prop}`))) return;
    removed.push({ line: decl.source.start.line, selector: decl.parent.selector, context: context.join(' > '), property: decl.prop, value: decl.value, important: false,
      owner: decl.parent.selectors.map(selector => ({ selector, value: owned.get(`${selector}|${decl.prop}`) })) });
    decl.remove();
  });
  root.walkRules(rule => { if (!rule.nodes.length) rule.remove(); });
  root.walkAtRules(rule => { if (rule.nodes?.length === 0 && rule.name !== 'layer') rule.remove(); });
  return { css: root.toString(), removed };
}

export function pruneCss(source) {
  const root = postcss.parse(source);
  const last = new Map();
  const rules = [];
  root.walkRules(rule => {
    let context = '';
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule') context = `@${parent.name} ${parent.params}|${context}`;
    }
    // Keyframe offsets are animation steps, not ordinary selector rules.
    if (context.includes('keyframes')) return;
    rules.push({ rule, context });
    for (const selector of rule.selectors) {
      for (const decl of rule.nodes.filter(node => node.type === 'decl')) {
        last.set(`${context}|${selector}|${decl.prop}|${Boolean(decl.important)}`, decl);
      }
    }
  });
  let removed = 0;
  for (const { rule, context } of rules) {
    const groups = new Map();
    for (const selector of rule.selectors) {
      const declarations = rule.nodes.filter(node => node.type !== 'decl' || last.get(`${context}|${selector}|${node.prop}|${Boolean(node.important)}`) === node);
      const key = declarations.map(node => rule.nodes.indexOf(node)).join(',');
      const group = groups.get(key) || { selectors: [], declarations };
      group.selectors.push(selector); groups.set(key, group);
    }
    if (groups.size === 1 && [...groups.values()][0].declarations.length === rule.nodes.length) continue;
    for (const { selectors, declarations } of groups.values()) {
      removed += rule.nodes.filter(node => node.type === 'decl' && !declarations.includes(node)).length;
      if (!declarations.some(node => node.type === 'decl')) continue;
      const replacement = rule.clone({ selector: selectors.join(',\n'), nodes: [] });
      for (const decl of declarations) replacement.append(decl.clone());
      rule.before(replacement);
    }
    rule.remove();
  }
  root.walkAtRules(rule => { if (rule.nodes?.length === 0) rule.remove(); });
  return { css: root.toString(), removed };
}

export function applyDimensionDecisions(source, baseline, decisions) {
  const root = postcss.parse(source);
  let changed = 0;
  for (const decision of decisions.filter(item => item.action === 'token' || item.action === 'intrinsic')) {
    if (decision.action === 'token' && invalidFunctionNegation.test(decision.value)) throw Error(`Invalid token migration value: ${decision.index}`);
    const original = baseline[decision.index];
    if (!original) throw Error(`Missing baseline dimension for decision ${decision.index}`);
    const matches = [];
    root.walkDecls(decl => {
      const context = [];
      for (let parent = decl.parent; parent; parent = parent.parent) if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params}`);
      const item = { selector: decl.parent.selector || '', property: decl.prop, context: context.join(' > '), important: Boolean(decl.important) };
      if (dimensionKey(item) === dimensionKey(original)) matches.push(decl);
    });
    if (decision.action === 'intrinsic') {
      if (matches.length > 1) throw Error(`Expected at most one intrinsic dimension for decision ${decision.index}, found ${matches.length}`);
      if (matches[0]) {
        if (matches[0].value !== original.value) throw Error(`Unexpected intrinsic dimension value: ${decision.index}`);
        matches[0].remove();
        changed++;
      }
      continue;
    }
    if (matches.length !== 1) throw Error(`Expected one dimension for decision ${decision.index}, found ${matches.length}`);
    if (matches[0].value !== original.value && matches[0].value !== decision.value) throw Error(`Unexpected dimension value: ${decision.index}`);
    if (matches[0].value !== decision.value) { matches[0].value = decision.value; changed++; }
  }
  root.walkRules(rule => { if (!rule.nodes.length) rule.remove(); });
  return { css: root.toString(), changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = new URL('../src/styles.css', import.meta.url);
  if (process.argv.includes('--apply-decisions')) {
    const ledger = JSON.parse(await readFile(new URL('../design/ui-dimension-decisions.json', import.meta.url), 'utf8'));
    const baseline = JSON.parse(await readFile(new URL(`../${ledger.baseline}`, import.meta.url), 'utf8')).styles.find(style => style.file === 'src/styles.css').literals;
    const result = applyDimensionDecisions(await readFile(file, 'utf8'), baseline, dimensionDecisions(ledger));
    if (process.argv.includes('--write')) await writeFile(file, result.css);
    console.log(`Explicit dimension decisions: ${result.changed}${process.argv.includes('--write') ? ' applied' : ' (dry run)'}`);
    process.exit(0);
  }
  if (process.argv.includes('--owned-geometry')) {
    const result = removeOwnedGeometry(await readFile(file, 'utf8'), await readFile(new URL('../src/design-system.css', import.meta.url), 'utf8'));
    if (process.argv.includes('--write')) {
      const ledgerFile = new URL('../design/ui-dimension-decisions.json', import.meta.url);
      let ledger;
      try { ledger = JSON.parse(await readFile(ledgerFile, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        ledger = { format: 'qiguang-ui-dimension-decisions', baseline: 'design/screenshots/20260906-complete-unification/code-audit.json', decisions: [] };
      }
      const baseline = JSON.parse(await readFile(new URL(`../${ledger.baseline}`, import.meta.url), 'utf8')).styles.find(style => style.file === 'src/styles.css').literals;
      for (const item of result.removed.filter(item => dimensionLiteral.test(item.value))) {
        const index = baseline.findIndex(previous => dimensionKey(previous) === dimensionKey(item) && previous.value === item.value);
        if (index < 0 || dimensionDecisions(ledger).some(decision => decision.index === index)) throw Error(`Missing or repeated baseline decision: ${item.selector} ${item.property}`);
        ledger.decisions.push({ index, action: 'remove', reason: 'Exact selector and property are always owned by the later unconditional components layer; deleting the lower-priority declaration preserves the cascade.', owner: item.owner });
      }
      ledger.decisions.sort((a, b) => a.index - b.index);
      await writeFile(ledgerFile, JSON.stringify(ledger, null, 2) + '\n');
      await writeFile(file, result.css);
    }
    console.log(`Owned geometry: ${result.removed.length} declarations (${result.removed.filter(item => dimensionLiteral.test(item.value)).length} literal dimensions)${process.argv.includes('--write') ? ' removed' : ' (dry run)'}`);
    process.exit(0);
  }
  const result = pruneCss(await readFile(file, 'utf8'));
  if (process.argv.includes('--typography')) {
    const css = postcss.parse(result.css);
    css.walkDecls(decl => {
      if (/^(font|font-size|font-weight|line-height|letter-spacing)$/.test(decl.prop)) decl.remove();
    });
    css.walkRules(rule => { if (!rule.nodes.length) rule.remove(); });
    result.css = css.toString();
  }
  if (process.argv.includes('--write')) await writeFile(file, result.css);
  console.log(`Superseded selector declarations: ${result.removed}${process.argv.includes('--write') ? ' removed' : ' (dry run)'}`);
}
