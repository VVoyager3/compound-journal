// Compare CSS on identical fixture DOM, avoiding random IDs/order in fresh app seeds.
// Usage: node scripts/compare-ui-css.mjs [git-ref]
// Omit ref to compare the index with the working tree. Run before staging a migration.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

async function stableScreenshot(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let previous;
  for (let capture = 0; capture < 5; capture++) {
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, 'Screenshot stabilization timed out');
    const current = await page.screenshot({ animations: 'disabled', caret: 'hide', timeout: remaining });
    assert.ok(Date.now() <= deadline, 'Screenshot stabilization timed out');
    if (previous?.equals(current)) return current;
    previous = current;
  }
  throw new Error('Screenshot did not stabilize within 5 captures');
}

if (process.argv[2] === '--self-test') {
  let captures = 0;
  const stable = await stableScreenshot({ screenshot: async () => Buffer.from(++captures === 1 ? 'first' : 'stable') });
  assert.equal(stable.toString(), 'stable');
  assert.equal(captures, 3);
  captures = 0;
  await assert.rejects(stableScreenshot({ screenshot: async () => Buffer.from(String(++captures)) }), /within 5 captures/);
  assert.equal(captures, 5);
  await assert.rejects(stableScreenshot({ screenshot: async ({ timeout }) => {
    assert.ok(timeout > 0 && timeout <= 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    return Buffer.from('late');
  } }, 1), /timed out/);
  console.log('Screenshot stabilization self-test passed');
  process.exit(0);
}

// Do not expose credentials, query parameters, fragments, or page/console payloads.
const safeUrl = value => {
  const url = new URL(value);
  return /^https?:$/.test(url.protocol) ? `${url.origin}${url.pathname}` : `${url.protocol}[redacted]`;
};
const root = fileURLToPath(new URL('../', import.meta.url));
const ref = process.argv[2] || '';
const fixtures = 'design/screenshots/20260906-complete-unification';
const output = new URL('../design/screenshots/20260906-dimension-migration/', import.meta.url);
const files = (await readdir(new URL(`../${fixtures}/`, import.meta.url))).filter(file => /^\d\d-.+\.html$/.test(file)).sort();
assert.equal(files.length, 55, 'all captured scenarios must be compared');
const styles = ['styles', 'design-system'];
const before = Object.fromEntries(styles.map(name => [name, execFileSync('git', ['show', `${ref}:src/${name}.css`], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })]));
const after = Object.fromEntries(await Promise.all(styles.map(async name => [name, await readFile(new URL(`../src/${name}.css`, import.meta.url), 'utf8')])));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
await mkdir(output, { recursive: true });
try {
  for (const file of files) {
    const hashes = [], screenshots = [];
    for (const [side, css] of [['before', before], ['after', after]]) {
      const page = await browser.newPage({ viewport: { width: 400, height: 866 }, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const errors = [], failedRequests = [], loaded = new Set();
      page.on('pageerror', error => errors.push({ type: 'pageerror', name: error.name }));
      page.on('console', message => {
        if (message.type() === 'error') {
          const location = message.location();
          errors.push({ type: 'console', url: location.url ? safeUrl(location.url) : '', line: location.lineNumber });
        }
      });
      page.on('requestfailed', request => failedRequests.push({ url: safeUrl(request.url()), failure: request.failure()?.errorText }));
      await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
      await page.route(/\/src\/(styles|design-system)\.css(?:\?|$)/, route => {
        const name = /\/([^/]+)\.css/.exec(new URL(route.request().url()).pathname)[1];
        loaded.add(name);
        return route.fulfill({ contentType: 'text/css', body: css[name] });
      });
      const url = `${process.env.QIGUANG_CAPTURE_URL || 'http://127.0.0.1:4196'}/${fixtures}/${file}`;
      try {
        await page.goto(url);
        await page.locator('html[data-preview-ready="true"]').waitFor({ timeout: 30000 });
      } catch (error) {
        throw new Error(`Fixture readiness failed: ${JSON.stringify({ file, side, url: safeUrl(url), error: error.name, errors, failedRequests, loaded: [...loaded] })}`);
      }
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(loaded.size, 2, `${file}: both CSS sources must be controlled`);
      assert.deepEqual(errors, [], `${file}: snapshot must render without errors`);
      const screenshot = await stableScreenshot(page).catch(error => { throw new Error(`${file} (${side}): ${error.message}`); });
      screenshots.push(screenshot);
      hashes.push(createHash('sha256').update(screenshot).digest('hex'));
      await page.close();
    }
    results.push({ file, identical: hashes[0] === hashes[1], before: hashes[0], after: hashes[1] });
    if (hashes[0] !== hashes[1]) for (const [index, screenshot] of screenshots.entries()) await writeFile(new URL(file.replace('.html', `-css-${index ? 'after' : 'before'}.png`), output), screenshot);
  }
} finally { await browser.close(); }
await mkdir(output, { recursive: true });
await writeFile(new URL('css-parity.json', output), JSON.stringify({ baselineRef: ref || 'index', viewport: [400, 866], scope: 'Identical isolated fixture DOM with before/after CSS; not business, responsive or device validation.', results }, null, 2) + '\n');
const changed = results.filter(item => !item.identical).map(item => item.file);
console.log({ compared: results.length, identical: results.length - changed.length, changed });
assert.deepEqual(changed, [], 'CSS migration changed rendered pixels; inspect these scenarios before accepting');
