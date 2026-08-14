import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npm, ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) {
  if (build.error) console.error(build.error.message);
  process.exit(build.status ?? 1);
}

const tests = spawnSync(process.execPath, [
  '--experimental-strip-types', '--test', 'test/release-candidate.test.mjs',
], { stdio: 'inherit', env: { ...process.env, QIGUANG_RELEASE_BUILD: '1' } });
process.exit(tests.status ?? 1);
