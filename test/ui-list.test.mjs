import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

test('text roles do not depend on tags or page, and action spacing is independent', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}design/list-preview.html`);
    await page.locator('[data-ui-row]').first().waitFor();
    for (const size of [16, 32]) {
      const results = await page.evaluate(size => {
        document.documentElement.style.fontSize = `${size}px`;
        const host = document.createElement('div');
        host.innerHTML = ['page', 'dialog'].map(kind => `<section class="${kind} page-review">
          <h2 data-role="section">相关记录</h2><h2 class="ui-list-heading" data-role="section">服务信息</h2>
          <p class="caption" data-role="meta">9月4日</p><span class="caption" data-role="meta">9月4日</span>
          <span class="caption review-period" data-role="meta">8月31日—9月4日</span>
          <div class="ui-list-row"><span class="ui-row-value" data-role="meta">待完成</span></div>
          <p data-role="body">必要的风险说明不能丢失。</p>
          <div class="ui-actions"><button class="button">保存</button><button class="button">删除</button></div>
        </section>`).join('');
        document.body.append(host);
        const type = [...host.querySelectorAll('[data-role]')].map(el => {
          const style = getComputedStyle(el);
          return { role: el.dataset.role, size: parseFloat(style.fontSize), weight: style.fontWeight, leading: parseFloat(style.lineHeight) };
        });
        const action = host.querySelector('.ui-actions');
        const before = getComputedStyle(action).gap;
        host.style.setProperty('--ui-section-gap', '24px');
        const after = getComputedStyle(action).gap;
        host.style.setProperty('--ui-action-gap', '17px');
        const adjusted = getComputedStyle(action).gap;
        host.remove();
        return { type, before, after, adjusted };
      }, size);
      for (const actual of results.type) {
        const [font, weight, leading] = { section: [14.5, '800', 1.35], meta: [11.5, '400', 1.35], body: [12.5, '400', 1.5] }[actual.role];
        assert.equal(actual.size, font * size / 16, `${actual.role} font size`);
        assert.equal(actual.weight, weight);
        assert.ok(Math.abs(actual.leading - font * size / 16 * leading) < .06, `${actual.role} line height: ${actual.leading}`);
      }
      assert.equal(results.before, results.after, 'changing heading gap must not move actions');
      assert.equal(results.adjusted, '17px', 'actions have their own spacing token');
    }
  } finally { await browser.close(); await server.close(); }
});

test('real list variants share geometry, remain usable and scale with text', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [320, 360, 390, 400, 430]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${server.resolvedUrls.local[0]}design/list-preview.html`);
      await page.locator('[data-ui-row]').first().waitFor();
      const dialogTitle = await page.evaluate(() => {
        const dialog = document.createElement('div');
        dialog.className = 'dialog';
        dialog.innerHTML = '<header class="ui-titlebar ui-dialog-titlebar"><button class="ui-back-button" aria-label="返回"></button><h2 class="ui-page-title">身体</h2></header>';
        document.body.append(dialog);
        const size = getComputedStyle(dialog.querySelector('h2')).fontSize;
        dialog.remove();
        return size;
      });
      assert.equal(dialogTitle, '16px', 'dialog titles use the approved page size');
      const buttons = await page.locator('[data-example="components"] .button').evaluateAll(items => items.map(item => {
        const style = getComputedStyle(item);
        return [item.getBoundingClientRect().height, style.fontSize, style.fontWeight, style.padding, style.borderRadius];
      }));
      assert.equal(buttons.length, 4);
      buttons.forEach(value => assert.deepEqual(value, buttons[0], 'button tones must not introduce new geometry'));
      assert.equal(buttons[0][0], 36);
      const segmented = page.locator('[data-example="components"] .ui-segmented');
      const hits = await segmented.locator('button').evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
      assert.deepEqual(hits, [44,44,44]);
      assert.equal(await segmented.evaluate(item => item.getBoundingClientRect().height), 34, 'keep the compact visible bar with complete hit targets');
      const fields = await page.locator('[data-example="components"] .field-label').evaluateAll(items => items.map(item => getComputedStyle(item).gap));
      assert.deepEqual(fields, ['4px','4px','4px']);
      const metrics = await page.locator('[data-ui-row]').evaluateAll(rows => rows.map(row => {
        const style = getComputedStyle(row);
        const bounds = row.getBoundingClientRect();
        return { height: bounds.height, width: bounds.width, minHeight: style.minHeight, radius: style.borderRadius };
      }));
      assert.equal(new Set(metrics.map(row => row.minHeight)).size, 1);
      const single = await page.locator('[data-example="single"] [data-ui-row]').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
      assert.ok(Math.max(...single) - Math.min(...single) <= 1, `all single-line variants share actual height at ${width}`);
      await page.getByRole('button', { name: '记录一次：喝水' }).click();
      await page.getByText('1/5杯', { exact: true }).waitFor();
      await page.getByRole('button', { name: '完成：背英语演讲开头' }).click();
      await page.locator('.task-list-item.is-completed').first().waitFor();
      assert.equal(await page.locator('[data-example="readonly"] button').count(), 0);
      for (const zoom of [100, 200]) {
        await page.evaluate(value => document.documentElement.style.fontSize = `${16 * value / 100}px`, zoom);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no overflow at ${width}/${zoom}%`);
        const smallTargets = await page.locator('button, label').evaluateAll(elements => elements.filter(el => {
          const r = el.getBoundingClientRect();
          const extension = getComputedStyle(el, '::after');
          const hitHeight = r.height + Math.max(0, -parseFloat(extension.top) || 0) + Math.max(0, -parseFloat(extension.bottom) || 0);
          return r.width > 0 && r.height > 0 && (hitHeight < 44 || r.width < 44);
        }).map(el => el.className));
        assert.deepEqual(smallTargets, []);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
