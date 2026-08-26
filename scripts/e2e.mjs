import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const file of ['browser.e2e.mjs', 'browser-30-day.e2e.mjs']) {
  const testFile = join(root, 'test', file);
  const source = await readFile(testFile, 'utf8');
  const names = [...source.matchAll(/^test\('([^']+)'/gm)].map((match) => match[1]);

  for (const name of names) {
    const pattern = `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    const status = await new Promise((resolve, reject) => {
      const args = ['--experimental-strip-types', '--test'];
      if (process.allowedNodeEnvironmentFlags.has('--test-isolation')) args.push('--test-isolation=none');
      args.push(`--test-name-pattern=${pattern}`, testFile);
      const child = spawn(process.execPath, args, { stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code === 0 && !signal));
    });
    if (!status) throw new Error(`浏览器回归失败：${name}`);
  }
}
