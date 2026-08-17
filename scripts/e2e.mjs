import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testFile = join(root, 'test', 'browser.e2e.mjs');
const source = await readFile(testFile, 'utf8');
const names = [...source.matchAll(/^test\('([^']+)'/gm)].map((match) => match[1]);

for (const name of names) {
  const pattern = `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--test', '--test-isolation=none', `--test-name-pattern=${pattern}`, testFile], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code === 0 && !signal));
  });
  if (!status) throw new Error(`浏览器回归失败：${name}`);
}
