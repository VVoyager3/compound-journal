import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { startServer } from '../server.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(target));
    else result.push(target);
  }
  return result;
}

test('manifest provides an installable local-first application identity', async () => {
  const manifest = JSON.parse(await read('public/manifest.webmanifest'));
  assert.equal(manifest.lang, 'zh-CN');
  assert.equal(typeof manifest.name, 'string');
  assert.equal(typeof manifest.short_name, 'string');
  assert.match(manifest.start_url, /^\/#\//);
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  assert(manifest.icons.some((icon) => String(icon.purpose).split(/\s+/).includes('maskable')), 'manifest needs a maskable icon');
  for (const icon of manifest.icons) {
    assert(icon.src.startsWith('/'));
    assert(existsSync(path.join(root, 'public', icon.src.slice(1))), `missing manifest icon ${icon.src}`);
  }

  const html = await read('index.html');
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /name="theme-color"/);
  assert.match(html, /name="viewport"/);
});

test('service worker is versioned, keeps AI network-only, and waits for an explicit update action', async () => {
  const source = await read('public/sw.js');
  const packageVersion = JSON.parse(await read('package.json')).version;
  const dbSource = await read('src/db.ts');
  const appVersion = dbSource.match(/APP_VERSION\s*=\s*['"]([^'"]+)/)?.[1];
  const cacheVersion = source.match(/CACHE_NAME\s*=\s*['"]qiguang-shell-v([^'"]+)/)?.[1];
  assert.equal(appVersion, packageVersion, 'backup and package versions must match');
  assert.equal(cacheVersion, packageVersion, 'every release must install a new immutable shell cache');
  new vm.Script(source, { filename: 'public/sw.js' });
  assert.match(source, /qiguang-[\w-]*v\d+/i, 'cache name must carry a version');
  assert.match(source, /addEventListener\(['"]install['"]/);
  assert.match(source, /addEventListener\(['"]activate['"]/);
  assert.match(source, /addEventListener\(['"]fetch['"]/);
  assert.match(source, /caches\.open\(/);
  assert.match(source, /(?:caches|cache)\.match\(/);
  assert.match(source, /(?:mode\s*===\s*['"]navigate['"]|request\.mode)/, 'navigation fallback is required');
  assert.match(source, /(?:index\.html|cache\.match\(\s*['"]\/['"])/, 'offline navigation must fall back to the app shell');
  assert.match(source, /\/api\//, 'AI API needs an explicit network-only branch');
  assert.match(source, /request\.method[^\n]*(?:GET|['"]GET['"])/, 'only GET requests may enter Cache API');
  assert.match(source, /bundleText[\s\S]*matchAll/, 'shell install must discover imported image assets from the built bundle');
  assert.match(source, /png\|jpe\?g/, 'avatar and motion images must enter the install cache');
  assert(!/skipWaiting\(\)\s*;?[\s\S]{0,80}addEventListener\(['"]activate['"]/.test(source), 'install must not unconditionally force activation');
  if (source.includes('skipWaiting')) {
    assert.match(source, /addEventListener\(['"]message['"]/);
    assert.match(source, /SKIP_WAITING/);
  }

  const app = await read('src/app.ts');
  assert.match(app, /serviceWorker\.register\(['"]\/sw\.js['"]/);
  assert.match(app, /updatefound/);
  assert.match(app, /SKIP_WAITING/);
  assert.match(app, /新版本/);
});

test('client has no microphone capability, unsafe HTML sink, or third-party tracking hook', async () => {
  const clientFiles = [path.join(root, 'index.html'), ...await filesBelow(path.join(root, 'src'))]
    .filter((file) => /\.(?:html|ts|js)$/i.test(file));
  const clientSource = (await Promise.all(clientFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  assert(!/\b(?:getUserMedia|MediaRecorder|webkitSpeechRecognition|SpeechRecognition)\b/.test(clientSource), 'client must rely on the system input method');
  assert(!/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(/.test(clientSource), 'user text must not reach an HTML sink');
  assert(!/google-analytics|googletagmanager|segment\.com|mixpanel|fullstory|hotjar/i.test(clientSource), 'tracking code is not allowed');
  assert(!/\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/.test(clientSource), 'client network access must use the audited fetch allowlist');

  const fetchCalls = [...clientSource.matchAll(/\bfetch\s*\(/g)];
  const literalFetches = [...clientSource.matchAll(/\bfetch\s*\(\s*(['"])([^'"]+)\1/g)];
  assert.equal(fetchCalls.length, literalFetches.length, 'dynamic client fetch targets are not allowed');
  const fetchTargets = literalFetches.map((match) => match[2]);
  assert.deepEqual([...new Set(fetchTargets)].sort(), ['/api/analyze', '/api/health'], 'only AI and its manual health check may use the network');

  const manifest = await read('public/manifest.webmanifest');
  assert(!/microphone|audio-capture|getUserMedia/i.test(manifest));
});

test('static server sends strict security and update-safe cache headers', async (t) => {
  const server = startServer(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.match(page.headers.get('cache-control') ?? '', /no-cache/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('permissions-policy') ?? '', /microphone=\(\)/);
  const csp = page.headers.get('content-security-policy') ?? '';
  for (const directive of [
    "default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'",
    "frame-ancestors 'none'", "form-action 'self'",
  ]) assert(csp.includes(directive), `CSP lacks ${directive}`);
  assert(!/unsafe-inline|unsafe-eval|https?:\/\//.test(csp), 'CSP contains an unnecessary escape hatch');

  for (const asset of ['/sw.js', '/manifest.webmanifest']) {
    const response = await fetch(`${base}${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-cache/, `${asset} must revalidate for updates`);
  }
  const missingAsset = await fetch(`${base}/assets/definitely-missing.js`);
  assert.equal(missingAsset.status, 404, 'missing static assets must not be disguised as the HTML app shell');
  const health = await fetch(`${base}/api/health`);
  assert.match(health.headers.get('cache-control') ?? '', /no-store/);
});

test('fresh production output contains no secret, source map, or oversized initial asset', { skip: process.env.QIGUANG_RELEASE_BUILD !== '1' }, async () => {
  const dist = path.join(root, 'dist');
  assert(existsSync(path.join(dist, 'index.html')), 'run a production build before the release check');
  const files = await filesBelow(dist);
  assert(!files.some((file) => file.endsWith('.map')), 'production source maps are not allowed');
  for (const file of files) {
    const info = await stat(file);
    assert(info.size <= 2 * 1024 * 1024, `${path.relative(dist, file)} exceeds the 2 MiB asset budget`);
    if (/\.(?:html|js|css|json|svg|webmanifest)$/i.test(file)) {
      const source = await readFile(file, 'utf8');
      assert(!/\bsk-[A-Za-z0-9_-]{20,}\b/.test(source), `${path.relative(dist, file)} contains a secret-like token`);
      assert(!/MINIMAX_API_KEY/.test(source), `${path.relative(dist, file)} exposes the server key name`);
      assert(!/\.innerHTML\s*=|insertAdjacentHTML\s*\(/.test(source), `${path.relative(dist, file)} contains an unsafe HTML sink`);
    }
  }
});
