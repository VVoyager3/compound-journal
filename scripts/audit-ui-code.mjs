// Read-only inventory: literal values and repeated declarations are review candidates,
// not proof that a rule is live, invalid, or safe to delete.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import postcss from 'postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
function scanCss(source, file) {
  const literals = [], repeats = [], tokens = [], seen = new Map();
  let declarations = 0;
  postcss.parse(source, { from: file }).walkDecls(decl => {
    declarations++;
    const ancestors = [];
    for (let parent = decl.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule') ancestors.unshift(`@${parent.name} ${parent.params}`);
    }
    const item = { line: decl.source.start.line, selector: decl.parent.selector || '', context: ancestors.join(' > '), property: decl.prop, value: decl.value, important: Boolean(decl.important) };
    if (decl.prop.startsWith('--')) { tokens.push(item); return; }
    if (/^(?:font-size|line-height|padding(?:-.+)?|margin(?:-.+)?|(?:row-|column-)?gap|(?:min-|max-)?(?:width|height)|border(?:-.+)?-radius)$/.test(decl.prop)
      && /(?:\d*\.)?\d+(?:px|rem|em)\b/.test(decl.value)) literals.push(item);
    const key = [item.context, item.selector, item.property, item.important].join('|');
    const previous = seen.get(key);
    if (previous && previous.value !== item.value) repeats.push({ ...item, previousLine: previous.line, previousValue: previous.value });
    seen.set(key, item);
  });
  return { file, declarations, tokenDeclarations: tokens.length, literalDeclarations: literals.length, repeatedDifferentValues: repeats.length, literals, repeats };
}

if (process.argv.includes('--self-test')) {
  const result = scanCss(':root{--size:12px}.row{padding:var(--size);height:45px}.row{height:50px}@media(max-width:360px){.row{height:44px}}', 'fixture.css');
  assert.equal(result.literalDeclarations, 3);
  assert.equal(result.tokenDeclarations, 1);
  assert.equal(result.repeatedDifferentValues, 1, 'different media contexts must not be merged');
  assert.equal(result.repeats[0].previousValue, '45px');
  console.log('UI code inventory self-test passed');
} else {
  const files = ['src/styles.css', 'src/design-system.css', 'design/ui-tuner-preview.css', 'design/preview-layout.css'];
  const styles = await Promise.all(files.map(async file => scanCss(await readFile(resolve(root, file), 'utf8'), file)));
  const app = await readFile(resolve(root, 'src/app.ts'), 'utf8');
  // Deliberately lexical: lists literal call sites, not all dynamic routes/callbacks.
  const callSites = [];
  app.split(/\r?\n/).forEach((line, index) => {
    if (/node\('main'|dialogShell\(|\.style\./.test(line)) callSites.push({ file: 'src/app.ts', line: index + 1, source: line.trim() });
  });
  const report = { generatedAt: new Date().toISOString(), verdict: 'inventory-only-not-a-clean-bill', scope: 'Four CSS files parsed with PostCSS; app.ts page/dialog/style call sites are lexical. No computed-style, dead-code, business, or device correctness claim.', styles, callSites };
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex !== -1) {
    if (!process.argv[outputIndex + 1]) throw new Error('--output needs a path');
    const output = resolve(process.argv[outputIndex + 1]);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(`Inventory saved: ${output}`);
  }
  console.table(styles.map(({ file, declarations, literalDeclarations, repeatedDifferentValues }) => ({ file, declarations, literalDeclarations, repeatedDifferentValues })));
  console.log(`Page/dialog/dynamic-style call sites: ${callSites.length}. Inventory completion does not mean UI conformance.`);
}
