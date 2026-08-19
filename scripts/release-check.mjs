import { spawnSync } from 'node:child_process';

const native = process.argv.includes('--native');
if (native) {
  let origin;
  try { origin = new URL(process.env.VITE_API_ORIGIN ?? ''); } catch { /* checked below */ }
  if (origin?.protocol !== 'https:' || !origin.host) {
    console.error('Android 发布检查需要 VITE_API_ORIGIN 指向有效的 HTTPS 整理服务。');
    process.exit(1);
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
process.exit(tests.status ?? 1);
