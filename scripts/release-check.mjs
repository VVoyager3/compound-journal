import { spawnSync } from 'node:child_process';

const native = process.argv.includes('--native');
if (native) {
  if (process.env.MINIMAX_API_KEY?.trim()) {
    let endpoint;
    try { endpoint = new URL(process.env.MINIMAX_API_URL || 'https://api.minimaxi.com/v1/chat/completions'); } catch { /* checked below */ }
    if (endpoint?.protocol !== 'https:' || !endpoint.host) {
      console.error('Android 个人版需要有效的 MiniMax HTTPS 接口。');
      process.exit(1);
    }
  } else {
    let origin;
    try { origin = new URL(process.env.VITE_API_ORIGIN ?? ''); } catch { /* checked below */ }
    if (origin?.protocol !== 'https:' || !origin.host || origin.pathname !== '/' || origin.search || origin.hash) {
      console.error('Android 发布检查需要 .env 中的 MINIMAX_API_KEY；旧代理模式则需要根路径 HTTPS VITE_API_ORIGIN。');
      process.exit(1);
    }
  }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npm, ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) {
  if (build.error) console.error(build.error.message);
  process.exit(build.status ?? 1);
}

const tests = spawnSync(process.execPath, [
  '--experimental-strip-types', 'test/release-candidate.test.mjs',
], { stdio: 'inherit', env: { ...process.env, QIGUANG_RELEASE_BUILD: '1', QIGUANG_NATIVE_RELEASE: native ? '1' : '0' } });
if (tests.status !== 0 || !native) process.exit(tests.status ?? 1);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const sync = spawnSync(npx, ['cap', 'sync', 'android'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (sync.status !== 0) process.exit(sync.status ?? 1);
const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const android = spawnSync(gradle, ['assembleDebug'], { cwd: 'android', stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(android.status ?? 1);
