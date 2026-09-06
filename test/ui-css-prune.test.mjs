import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneCss } from '../scripts/prune-ui-css.mjs';

test('CSS pruning preserves selector branches, media, importance and keyframes', () => {
  const { css } = pruneCss('.a,.b{gap:8px;color:red}.a{gap:4px}@media(max-width:360px){.a{gap:2px}}.a{gap:6px!important}@keyframes pulse{0%{opacity:0}100%{opacity:1}}');
  assert.match(css, /\.b\{gap:8px;color:red\}/);
  assert.match(css, /\.a\{color:red\}/);
  assert.match(css, /\.a\{gap:4px\}/);
  assert.match(css, /max-width:360px/);
  assert.match(css, /6px!important/);
  assert.match(css, /0%\{opacity:0\}100%\{opacity:1\}/);
  assert.equal(pruneCss(css).removed, 0);
});
