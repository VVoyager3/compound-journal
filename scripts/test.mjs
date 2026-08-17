import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tests = (await readdir(join(root, 'test'))).filter((file) => file.endsWith('.test.mjs')).sort();

for (const file of tests) {
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--test', '--test-isolation=none', join(root, 'test', file)], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code === 0 && !signal));
  });
  if (!status) throw new Error(`测试失败：${file}`);
}
