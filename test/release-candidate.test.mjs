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
  assert.match(html, /class="boot-screen"/);
  assert.match(html, /正在点亮房间/);
  assert.match(html, /name="viewport"/);
});

test('room motion sprites use real PNG alpha instead of a painted grid', async () => {
  for (const gender of ['female', 'male']) {
    const png = await readFile(path.join(root, 'design-assets', 'pre-development', `character-motion-${gender}-runtime.png`));
    assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71], `${gender} motion asset must be a PNG`);
    assert.equal(png.readUInt32BE(16), 1152, `${gender} runtime atlas must have six fixed-width columns`);
    assert.equal(png.readUInt32BE(20), 1152, `${gender} runtime atlas must have six fixed-height rows`);
    assert.equal(png[25], 6, `${gender} motion asset must use RGBA color type`);
  }
});

test('every companion action has its own tightly cropped transparent PNG', async () => {
  for (const gender of ['female', 'male']) {
    const directory = path.join(root, 'design-assets', 'pre-development', 'character-frames', gender);
    const files = (await readdir(directory)).filter((file) => file.endsWith('.png')).sort();
    assert.equal(files.length, 36, `${gender} must provide exactly 36 independent action frames`);
    assert.deepEqual(files.map((file) => Number(file.slice(0, 2))), Array.from({ length: 36 }, (_, index) => index + 1));
    assert.deepEqual(
      files.filter((file) => /walk-(?:left|right)-/.test(file)),
      [
        ...Array.from({ length: 6 }, (_, index) => `${13 + index}-walk-left-${index + 1}.png`),
        ...Array.from({ length: 6 }, (_, index) => `${19 + index}-walk-right-${index + 1}.png`),
      ],
      `${gender} horizontal files must keep the stable horizontal frame naming contract`,
    );
    for (const file of files) {
      const png = await readFile(path.join(directory, file));
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71], `${gender}/${file} must be a PNG`);
      assert.equal(png[25], 6, `${gender}/${file} must keep RGBA transparency`);
      assert(width > 0 && width < 256 && height > 0 && height < 256, `${gender}/${file} must be tightly cropped inside its source cell`);
    }
  }
});

test('room movement uses sprite frames instead of stretching the whole character', async () => {
  const styles = await read('src/styles.css');
  const app = await read('src/app.ts');
  assert.match(styles, /--turn-6:/);
  assert.match(styles, /--return-turn-6:/);
  assert.match(styles, /@keyframes room-walk-cycle/);
  assert.match(styles, /@keyframes room-shadow-step/);
  assert.match(styles, /@keyframes room-return-shadow-step/);
  assert.match(styles, /@keyframes hotspot-sigil/);
  assert.match(styles, /--scene-light:/);
  assert.match(styles, /background-size:\s*504px 504px/);
  assert.match(styles, /background-position:\s*var\(--walk-1\)/);
  assert.match(styles, /--face-left-frame:\s*-84px 0/);
  assert.match(styles, /--face-right-frame:\s*-252px 0/);
  assert.match(styles, /--walk-left-1:\s*0px -168px/);
  assert.match(styles, /--walk-right-1:\s*0px -252px/);
  assert.match(styles, /\.room-character\.has-motion\.is-female\s*\{[^}]*--rest-frame:\s*var\(--face-front-frame\)/s);
  assert.match(styles, /\.room-character\.has-motion\.is-male\s*\{[^}]*--face-left-frame:\s*-252px 0;[^}]*--face-right-frame:\s*-84px 0;[^}]*--walk-left-1:\s*0px -252px;[^}]*--walk-left-6:\s*-420px -252px;[^}]*--walk-right-1:\s*0px -168px;[^}]*--walk-right-6:\s*-420px -168px;/s);
  assert.match(styles, /room-action 960ms steps\(6, jump-none\)/);
  assert.match(styles, /room-ambient-stroll 6200ms steps\(1, end\)/);
  assert.doesNotMatch(styles, /inset\(0 8px 22px 4px\)/);
  assert.doesNotMatch(styles, /room-step-weight|room-footfall|room-ambient-footfall|filter:\s*drop-shadow|scale:\s*1\.27|rotate:\s*-?1deg/);
  assert.doesNotMatch(`${app}\n${styles}`, /room-plant|plant-celebration/, 'the room must not ship unexplained habit color blocks');
  assert.match(app, /character-motion-(?:female|male)-runtime\.png/);
  assert.match(app, /preloadMotionFrames/);
  assert.match(app, /scheduleIdleGesture\(700 \+ Math\.random\(\) \* 800\)/);
  assert.doesNotMatch(app, /avatar && ambientAction !== 'rest'/);
  assert.doesNotMatch(app, /character-motion-(?:female|male)-transparent\.png/);
  assert.match(app, /room-background\.png/);
});

test('record editor uses four equal quick starts and one editor', async () => {
  const app = await read('src/app.ts');
  const styles = await read('src/styles.css');
  assert.match(app, /'记住的事'/);
  assert.match(app, /'成功小记'/);
  assert.match(app, /'有趣的事'/);
  assert.doesNotMatch(app, /'日常记录'|'成功记录'|'趣事记录'|'普通记录'/);
  assert.match(app, /'今日一句'/);
  assert.match(app, /selectedMode === 'summary'/);
  assert.match(app, /saveDayCaption\(dateInput\.value, textarea\.value\.trim\(\)\)/);
  assert.match(app, /snapshotVariantFor/);
  assert.match(styles, /\.room-stage\.is-snapshot-(?:rest|focus|play|connection|bright)/);
  assert.match(styles, /\.page-record \.record-prompt-actions\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s);
  assert.doesNotMatch(styles, /\.record-prompt-actions\s*\{[^}]*overflow-x:\s*auto/s);
});

test('typography and settings density follow the global UI rules', async () => {
  const styles = await read('src/styles.css');
  const checklist = await read('DESIGN-CHECKLIST.md');
  assert.match(styles, /--line:\s*1px/);
  assert.match(styles, /--text-page:\s*clamp\(2rem,\s*7\.5vw,\s*2\.25rem\)/);
  assert.match(styles, /h1,[\s\S]*h3\s*\{[^}]*font-family:\s*inherit/s);
  assert.doesNotMatch(styles, /Noto Serif SC|Source Han Serif SC|Songti SC/);
  assert.match(styles, /\.button\s*\{[^}]*min-height:\s*48px;[^}]*border:\s*1px solid var\(--forest\);[^}]*box-shadow:\s*none/s);
  assert.match(styles, /\.input,[\s\S]*\.journal-input\s*\{[^}]*border:\s*1px solid rgb\(40 50 40 \/ 48%\);[^}]*box-shadow:\s*none/s);
  assert.match(styles, /\.page\s*\{[^}]*padding:\s*18px var\(--page-pad\) var\(--page-bottom-space\)/s);
  assert.match(styles, /--page-bottom-space:\s*calc\(var\(--bottom-nav-height\) \+ 64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(await read('src/app.ts'), /record-number-tools|record-attachment-button/);
  assert.match(styles, /\.trail-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.review-actions > \.button\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.milestone-action\.is-complete[\s\S]*\.milestone-action\.is-undo/);
  assert.match(await read('src/app.ts'), /date-filter-placeholder', '选择日期'/);
  assert.match(styles, /max-height:\s*min\(calc\(var\(--dialog-viewport-height/);
  assert.match(styles, /\.page-system\s*\{[^}]*gap:\s*18px/s);
  assert.match(checklist, /## 二、信息与文案/);
  assert.match(checklist, /非必要说明已经删除/);
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
  assert.match(styles, /statusBarColor[^\n]+#F4ECD8/);
  assert.match(styles, /navigationBarColor[^\n]+#283228/);
  assert.match(styles, /windowSplashScreenAnimatedIcon[^\n]+ic_launcher_foreground/);
  assert.match(styles, /postSplashScreenTheme[^\n]+AppTheme\.NoActionBar/);
  assert.match(styles, /Theme\.AppCompat\.Light\.NoActionBar/);
  assert.match(activity, /SplashScreen\.installSplashScreen\(this\)/);
  assert.match(activity, /OnBackPressedCallback/);
  assert.match(activity, /querySelectorAll\('dialog\[open\]'\)/, 'Android back must close the active form before leaving the app');
  assert.match(activity, /querySelector\('\.secondary-back'\)/, 'Android back must return from secondary pages before leaving the app');
  const capacitorConfig = JSON.parse(await read('capacitor.config.json'));
  assert.equal(capacitorConfig.android?.adjustMarginsForEdgeToEdge, 'force', 'native content must stay outside system bars and display cutouts');
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
  const uiSource = await read('src/app.ts');
  const source = (await Promise.all(['src/app.ts', 'src/db.ts', 'src/rules.ts', 'src/badges.ts', 'src/analysis-contract.ts'].map(read))).join('\n');
  for (const legacy of ['关注领域', '人生领域', '成长方向', '根资产', '父分支', '阶段模式', '目标位置', '小目标', 'MAIN', 'BONUS', '支线', '校准']) {
    assert.equal(source.includes(legacy), false, `replace legacy label: ${legacy}`);
  }
  for (const legacy of ['分类与提升方向', '生活分类', '提升方向', '主要提升', '想提升', '成长分支']) {
    assert.equal(uiSource.includes(legacy), false, `remove retired user-facing classification: ${legacy}`);
  }
  assert.doesNotMatch(uiSource, /labelledControl\(['"]分类['"]/, 'user-facing forms must name the shared field 五维状态');
  for (const current of ['五维状态', '成长值', '阶段目标', '状态自评']) assert(source.includes(current), `missing current label: ${current}`);
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
  for (const [size, rows] of [['small', 1], ['medium', 2], ['large', 4]]) {
    const layout = await read(`android/app/src/main/res/layout/widget_qiguang_${size}.xml`);
    for (const id of ['widget_root', 'widget_header', 'widget_title', 'widget_count', 'widget_private', 'widget_empty', 'widget_privacy_toggle']) assert(layout.includes(`@+id/${id}`), `${size} widget lacks ${id}`);
    for (let row = 1; row <= rows; row += 1) for (const suffix of ['', '_check', '_type', '_title']) assert(layout.includes(`@+id/widget_task_${row}${suffix}`), `${size} widget lacks task row ${row}${suffix}`);
    for (const removed of ['widget_avatar', 'widget_name', 'widget_xp', 'widget_record', 'widget_minimum']) assert(!layout.includes(removed), `${size} widget still exposes ${removed}`);
  }
  const provider = await read('android/app/src/main/java/com/vvoyager3/qiguang/QiguangWidgetProvider.java');
  for (const action of ['COMPLETE_TASK', 'OPEN_ROUTE', 'TOGGLE_PRIVACY']) assert(provider.includes(action), `widget lacks ${action}`);
  for (const removed of ['loadAvatar', 'companionName', 'currentXp', 'widget_record']) assert(!provider.includes(removed), `widget provider still exposes ${removed}`);
  assert.match(provider, /today\.equals\(snapshot\.optString\("localDate"/, 'widget must not show a stale day as today');
  const bridge = await read('android/app/src/main/java/com/vvoyager3/qiguang/QiguangWidgetBridge.java');
  assert.match(bridge, /isRequestPinAppWidgetSupported/);
  assert.match(bridge, /requestPinAppWidget/);
  assert.match(bridge, /hasPinnedWidget\(\)/, 'settings must avoid duplicate widget requests');
  const activity = await read('android/app/src/main/java/com/vvoyager3/qiguang/MainActivity.java');
  assert.match(activity, /qiguang-widget-action/);
  assert.match(activity, /qiguang-native-resume/);
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
  assert.match(script, /\$androidSdk = Split-Path -Parent \(Split-Path -Parent \$adb\)/, 'PATH adb fallback must also supply its SDK root');
  assert.match(script, /install -r \$apk/);
  assert.match(script, /:app:assembleDebugAndroidTest/);
  assert.match(script, /am instrument -w/);
  assert.match(script, /am instrument -w[\s\S]*am force-stop \$packageName[\s\S]*am start -W/, 'instrumentation must leave the app running');
  assert(script.includes('D:\\tmp\\qiguang-device-check'));
  assert.doesNotMatch(script, /\$env:JAVA_HOME\s*=\s*'D:\\dev\\jdk21/, 'the device check must not depend on one machine-specific JDK path');
  assert.match(script, /\$jdkCandidates/);
  assert.match(script, /\$jdkCandidates = @\(@\(/, 'JDK candidates must remain an array when only one default path exists');
  assert.match(script, /java\.exe.*-version/s);
  assert(script.includes('D:\\tmp\\qiguang-emulator-check'));
  assert.match(script, /svc wifi disable/);
  assert.match(script, /svc wifi enable/);
  assert.match(script, /\$defaultAndroidUserHome = Join-Path \$env:USERPROFILE '\.android'/);
  assert.match(script, /\$projectAndroidUserHome = Join-Path \$workspace '\.android-user'/);
  assert.match(script, /Test-Path -LiteralPath \(Join-Path \$defaultAndroidUserHome 'debug\.keystore'\)/, 'reuse an existing debug identity before creating a project-local one');
  assert.match(script, /apksigner\.bat/);
  assert.match(script, /verify --print-certs/);
  assert.match(script, /\$installedSigner -ne \$candidateSigner/);
  assert.match(script, /\$installedSigner -ne \$candidateSigner[\s\S]*install -r \$apk/, 'signature compatibility must be verified before installing');
  assert.match(gitignore, /^\.android-user\/$/m);
  assert.doesNotMatch(script, /connectedDebugAndroidTest/);
  assert.doesNotMatch(script, /adb.*uninstall/i);
});
