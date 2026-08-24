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

test('room motion sprites use real PNG alpha instead of a painted grid', async () => {
  for (const gender of ['female', 'male']) {
    const png = await readFile(path.join(root, 'design-assets', 'pre-development', `character-motion-${gender}-transparent.png`));
    assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71], `${gender} motion asset must be a PNG`);
    assert.equal(png[25], 6, `${gender} motion asset must use RGBA color type`);
  }
});

test('Android launcher and splash use the Qiguang identity instead of Capacitor defaults', async () => {
  const foreground = await read('android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml');
  const background = await read('android/app/src/main/res/values/ic_launcher_background.xml');
  const adaptive = await read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
  const styles = await read('android/app/src/main/res/values/styles.xml');
  const activity = await read('android/app/src/main/java/com/vvoyager3/qiguang/MainActivity.java');
  assert.match(foreground, /#FF6B4A/i);
  assert.match(foreground, /#F7C844/i);
  assert.match(background, /#FFF7E6/i);
  assert.match(adaptive, /@drawable\/ic_launcher_foreground/);
  assert(!/#26A69A|com\.getcapacitor/i.test(`${foreground}\n${background}`), 'Capacitor starter identity must not ship');
  assert.match(styles, /windowSplashScreenBackground[^\n]+ic_launcher_background/);
  assert.match(styles, /windowSplashScreenAnimatedIcon[^\n]+ic_launcher_foreground/);
  assert.match(styles, /postSplashScreenTheme[^\n]+AppTheme\.NoActionBar/);
  assert.match(styles, /Theme\.AppCompat\.Light\.NoActionBar/);
  assert.match(activity, /SplashScreen\.installSplashScreen\(this\)/);
  assert(existsSync(path.join(root, 'android/app/src/main/res/drawable-port-xxhdpi/splash.png')));
});

test('service worker is versioned, keeps AI network-only, and waits for an explicit update action', async () => {
  const source = await read('public/sw.js');
  const packageVersion = JSON.parse(await read('package.json')).version;
  const dbSource = await read('src/db.ts');
  const androidBuild = await read('android/app/build.gradle');
  const appVersion = dbSource.match(/APP_VERSION\s*=\s*['"]([^'"]+)/)?.[1];
  const cacheVersion = source.match(/CACHE_NAME\s*=\s*['"]qiguang-shell-v([^'"]+)/)?.[1];
  const androidVersion = androidBuild.match(/versionName\s+["']([^"']+)/)?.[1];
  const androidVersionCode = Number(androidBuild.match(/versionCode\s+(\d+)/)?.[1]);
  const [major, minor, patch] = packageVersion.split('.').map(Number);
  assert.equal(appVersion, packageVersion, 'backup and package versions must match');
  assert.equal(cacheVersion, packageVersion, 'every release must install a new immutable shell cache');
  assert.equal(androidVersion, packageVersion, 'Android and package versions must match');
  assert.equal(androidVersionCode, major * 10_000 + minor * 100 + patch, 'Android versionCode must follow the package version');
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
  assert.match(app, /import\.meta\.env\.DEV \|\| Capacitor\.isNativePlatform\(\)[\s\S]*serviceWorker\.getRegistrations\(\)[\s\S]*qiguang-shell-/, 'development and the embedded Android shell must remove stale PWA caches');
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
  assert.equal(literalFetches.length, 0, 'client fetches must use the typed API allowlist');
  assert.equal(fetchCalls.length, 2, 'only the audited proxy fallback and health requests may use browser fetch');
  assert.match(clientSource, /function apiUrl\(path: '\/api\/analyze' \| '\/api\/health'\)/, 'API helper must restrict paths to the audited allowlist');
  assert.equal((clientSource.match(/fetch\(apiUrl\(/g) ?? []).length, fetchCalls.length, 'every client fetch must use the audited API helper');
  assert.match(clientSource, /registerPlugin<NativeAiBridge>\('QiguangAi'\)/, 'personal Android AI must use the audited native bridge');
  assert(!clientSource.includes('Authorization'), 'the web bundle must never add the model authorization header');

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

test('user-facing product vocabulary has one name per concept', async () => {
  const source = await read('src/app.ts');
  for (const legacy of ['关注领域', '唯一成长分支', '目标位置', '小目标']) {
    assert.equal(source.includes(legacy), false, `replace legacy label: ${legacy}`);
  }
  for (const current of ['人生领域', '成长方向', '推进优先级', '里程碑']) assert(source.includes(current), `missing current label: ${current}`);
});

test('production backend container is minimal, non-root, and never copies local secrets', async () => {
  const dockerfile = await read('Dockerfile');
  const dockerignore = await read('.dockerignore');
  const packageJson = JSON.parse(await read('package.json'));
  assert.match(dockerfile, /^FROM node:22\.18-alpine AS build/m);
  assert.equal((dockerfile.match(/^FROM /gm) ?? []).length, 2, 'container must discard build dependencies');
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^HEALTHCHECK /m);
  assert.match(dockerfile, /^COPY src\/ai-engine\.ts \.\/src\/ai-engine\.ts$/m);
  assert.match(dockerfile, /COPY --from=build \/app\/dist \.\/dist/);
  assert(!/COPY\s+\.\s/m.test(dockerfile), 'container must copy only audited files');
  assert.match(dockerignore, /^\.env\*$/m);
  assert.equal(packageJson.scripts['check:deployment'], 'node scripts/deployment-check.mjs');
});

test('manual release workflow verifies the app, publishes the server image, and keeps the APK', async () => {
  const workflow = await read('.github/workflows/release-candidate.yml');
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.match(workflow, /^\s*- codex\/latest-ui\s*$/m);
  assert.match(workflow, /^\s*packages:\s*write\s*$/m);
  for (const command of ['npm ci', 'npm run check', 'npm run check:release', 'npm run eval:ai', 'npm run test:e2e']) {
    assert(workflow.includes(command), `release workflow must run ${command}`);
  }
  assert.match(workflow, /docker build[\s\S]*docker push/);
  assert.match(workflow, /docker run[\s\S]*\.State\.Health\.Status/);
  assert.match(workflow, /\.\/gradlew testDebugUnitTest lintDebug assembleDebug/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert(!workflow.includes('MINIMAX_API_KEY'), 'release builds must not require or expose the model key');
});

test('native production output supports personal direct AI without exposing its key to web assets', { skip: process.env.QIGUANG_NATIVE_RELEASE !== '1' }, async () => {
  const sources = await Promise.all((await filesBelow(path.join(root, 'dist')))
    .filter((file) => file.endsWith('.js')).map((file) => readFile(file, 'utf8')));
  const key = process.env.MINIMAX_API_KEY?.trim();
  if (key) {
    assert(sources.every((source) => !source.includes(key)), 'native web bundle exposes the personal model key');
    const gradle = await read('android/app/build.gradle');
    const plugin = await read('android/app/src/main/java/com/vvoyager3/qiguang/QiguangAiPlugin.java');
    assert.match(gradle, /buildConfigField "String", "QIGUANG_MINIMAX_API_KEY"/);
    assert.match(plugin, /BuildConfig\.QIGUANG_MINIMAX_API_KEY/);
    assert.match(plugin, /payload\.remove\("apiKey"\)/);
    assert.match(plugin, /"Authorization", "Bearer " \+ apiKey/);
  } else {
    const origin = new URL(process.env.VITE_API_ORIGIN);
    assert.equal(origin.protocol, 'https:');
    assert(sources.some((source) => source.includes(origin.href.replace(/\/$/, ''))), 'native bundle is missing VITE_API_ORIGIN');
  }
});

test('Android widget ships three responsive layouts without overlay or notification permissions', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  for (const forbidden of ['SYSTEM_ALERT_WINDOW', 'POST_NOTIFICATIONS']) assert(!manifest.includes(forbidden), `unexpected Android permission: ${forbidden}`);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:fullBackupContent="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/backup_rules"/);
  const backupRules = await read('android/app/src/main/res/xml/backup_rules.xml');
  for (const section of ['cloud-backup', 'device-transfer']) {
    const rules = backupRules.match(new RegExp(`<${section}>([\\s\\S]*?)<\\/${section}>`))?.[1] ?? '';
    for (const domain of ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref']) {
      assert(rules.includes(`domain="${domain}" path="."`), `${section} still exposes ${domain}`);
    }
  }
  assert.match(manifest, /QiguangWidgetProvider/);
  assert.match(manifest, /qiguang_widget_info/);
  for (const size of ['small', 'medium', 'large']) {
    const layout = await read(`android/app/src/main/res/layout/widget_qiguang_${size}.xml`);
    for (const id of ['widget_root', 'widget_name', 'widget_main', 'widget_minimum', 'widget_xp', 'widget_complete']) assert(layout.includes(`@+id/${id}`), `${size} widget lacks ${id}`);
  }
  const provider = await read('android/app/src/main/java/com/vvoyager3/qiguang/QiguangWidgetProvider.java');
  for (const action of ['COMPLETE_MAIN', 'OPEN_ROUTE', 'TOGGLE_PRIVACY']) assert(provider.includes(action), `widget lacks ${action}`);
  assert.match(provider, /avatar-.*-original-/s, 'widget must reuse the selected companion portrait from the packaged assets');
  const activity = await read('android/app/src/main/java/com/vvoyager3/qiguang/MainActivity.java');
  assert.match(activity, /qiguang-widget-action/);
  assert.doesNotMatch(activity, /getWebView\(\)\.reload\(\)/, 'widget actions must not reload and blank the active WebView');
});

test('native release check validates, syncs, and builds the Android package in one command', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const script = await read('scripts/release-check.mjs');
  assert.equal(packageJson.scripts['check:android-release'], 'node --env-file-if-exists=.env scripts/release-check.mjs --native');
  assert.match(script, /\['cap', 'sync', 'android'\]/);
  assert.match(script, /\[':app:assembleDebug'\]/);
  assert.match(packageJson.scripts['android:debug'], /gradlew\.bat :app:assembleDebug/);
});

test('Android device checks preserve installed data and separate emulator mode', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const script = await read('scripts/android-device-check.ps1');
  const gitignore = await read('.gitignore');
  assert.match(packageJson.scripts['test:android-device'], /android-device-check\.ps1/);
  assert.match(packageJson.scripts['test:android-emulator'], /android-device-check\.ps1 -Emulator/);
  assert.match(script, /\[switch\]\$Emulator/);
  assert.match(script, /\$candidates\.Count -ne 1/);
  assert.match(script, /ro\.kernel\.qemu/);
  assert.match(script, /install -r \$apk/);
  assert.match(script, /:app:assembleDebugAndroidTest/);
  assert.match(script, /am instrument -w/);
  assert(script.includes('D:\\tmp\\qiguang-device-check'));
  assert(script.includes('D:\\tmp\\qiguang-emulator-check'));
  assert.match(script, /svc wifi disable/);
  assert.match(script, /svc wifi enable/);
  assert.match(script, /ANDROID_USER_HOME.*\.android-user/);
  assert.match(gitignore, /^\.android-user\/$/m);
  assert.doesNotMatch(script, /connectedDebugAndroidTest/);
  assert.doesNotMatch(script, /adb.*uninstall/i);
});
