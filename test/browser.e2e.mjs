import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { startServer } from '../server.mjs';

let browser;
let server;
let baseUrl;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.QIGUANG_TEST_AI = 'fixture';
  browser = await chromium.launch(process.env.QIGUANG_BROWSER_PATH
    ? { executablePath: process.env.QIGUANG_BROWSER_PATH, headless: true }
    : { channel: process.env.QIGUANG_BROWSER_CHANNEL || 'chrome', headless: true });
  server = startServer(0, '127.0.0.1');
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试服务没有取得端口。');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function freshPage() {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const apiRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  return { context, page, apiRequests };
}

async function finishOnboarding(page) {
  await page.goto(`${baseUrl}/#/today`);
  await page.getByRole('dialog', { name: '先从一件真实发生的事开始' }).getByRole('button', { name: '开始第一条记录' }).click();
  await assert.doesNotReject(() => page.getByRole('textbox', { name: '发生了什么' }).waitFor());
}

test('first use explains the boundary, records, edits, and undoes locally', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await page.goto(`${baseUrl}/#/today`);
    const dialog = page.getByRole('dialog', { name: '先从一件真实发生的事开始' });
    await assert.doesNotReject(() => dialog.waitFor());
    await assert.doesNotReject(() => dialog.getByText('系统会先整理，再由你决定是否采用。').waitFor());
    await dialog.getByRole('button', { name: '开始第一条记录' }).click();
    const input = page.getByRole('textbox', { name: '发生了什么' });
    await input.fill('电脑自动回归：记录一件真实发生的事。');
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    await page.getByRole('button', { name: '仅保存本页记录' }).click();
    await assert.doesNotReject(() => page.locator('#main-content').getByText('电脑自动回归：记录一件真实发生的事。', { exact: true }).waitFor());

    await page.getByRole('button', { name: '编辑' }).click();
    await page.getByRole('textbox', { name: '正文' }).fill('电脑自动回归：修改后的正文。');
    await page.getByRole('button', { name: '保存修改' }).click();
    await assert.doesNotReject(() => page.getByText('电脑自动回归：修改后的正文。').waitFor());
    await page.getByRole('button', { name: '查看版本' }).click();
    await page.getByRole('button', { name: '撤销最近修改' }).click();
    await assert.doesNotReject(() => page.locator('#main-content').getByText('电脑自动回归：记录一件真实发生的事。', { exact: true }).waitFor());
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('low state proposes replaceable recovery and one-click no-penalty feedback', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/system`);
    await page.getByRole('checkbox', { name: '我想校准这一项' }).first().check();
    await page.getByRole('slider', { name: '体力自评' }).fill('25');
    await page.getByRole('button', { name: '保存这次校准' }).click();
    await page.goto(`${baseUrl}/#/today`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '先补足体力' }).waitFor());
    await page.getByRole('button', { name: '换一个' }).click();
    await assert.doesNotReject(() => page.getByText('做一次很短的舒展').waitFor());
    await page.getByRole('button', { name: '加入今天' }).click();
    await page.getByRole('button', { name: '做了一部分：做一次很短的舒展' }).click();
    const result = page.getByRole('button', { name: '修改今日主线“做一次很短的舒展”的反馈' });
    await assert.doesNotReject(() => result.waitFor());
    assert.equal(await result.evaluate((element) => element === document.activeElement), true);
    await page.getByRole('button', { name: '撤销今日主线“做一次很短的舒展”的反馈' }).click();
    await page.getByRole('button', { name: '今天不做：做一次很短的舒展' }).click();
    await assert.doesNotReject(() => page.getByText('今天不做已记下；没有扣分。').waitFor());
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('completed action is traceable from its growth branch at 320px', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '安排任务' }).click();
    await page.getByRole('textbox', { name: '行动标题' }).fill('证据测试行动');
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('验证成长分支可以追溯现实证据');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一个可验证步骤');
    await page.getByRole('button', { name: '安排到今天' }).click();
    await page.getByRole('button', { name: '完成：证据测试行动' }).click();
    await page.goto(`${baseUrl}/#/growth`);
    const branch = page.getByRole('article').filter({ hasText: '健康资本' }).first();
    await branch.getByText('查看证据与关联').click();
    await assert.doesNotReject(() => branch.getByText(/手动行动 · 证据测试行动 .* \+10 XP/).waitFor());
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      tooSmall: [...document.querySelectorAll('button,a,summary')].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== 'none' && rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
      }).length,
    }));
    assert.equal(geometry.width, 320);
    assert.ok(geometry.scrollWidth <= geometry.width);
    assert.equal(geometry.tooSmall, 0);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});
