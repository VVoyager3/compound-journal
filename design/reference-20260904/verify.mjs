import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url));
const manifest = JSON.parse(read('manifest.json'));
const prompts = JSON.parse(read('prompts.json'));
const html = read('index.html').toString();
assert.equal(manifest.screens.length, 56);
assert.equal(new Set(manifest.screens.map(s => s.id)).size, 56);
assert.deepEqual(manifest.screens.map(s => s.id), prompts.screens.map(s => s.id));
assert.equal(readdirSync(new URL('.', import.meta.url)).filter(s => s.endsWith('.png')).length, 56);
for (const screen of manifest.screens) {
  const png = read(screen.file);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', screen.id);
  assert.equal(png.readUInt32BE(16), screen.width, screen.id);
  assert.equal(png.readUInt32BE(20), screen.height, screen.id);
  assert.equal(png.length, screen.bytes, screen.id);
  assert.ok(html.includes(`src="${screen.file}"`), screen.id);
  assert.ok(html.includes(`href="${screen.file}"`), screen.id);
  assert.ok(Math.abs(screen.width / screen.height - 1280 / 2772) < 0.003, screen.id);
}
assert.equal(manifest.nativePixelsExact, false);
console.log('PASS: 56 PNG files, dimensions, reference proportions, prompts and gallery links.');
