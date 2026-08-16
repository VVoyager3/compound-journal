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
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      apiRequests.push({ url: request.url(), method: request.method(), body: request.postData() });
    }
  });
  return { context, page, apiRequests };
}

async function finishOnboarding(page) {
  await page.goto(`${baseUrl}/#/today`);
  const dialog = page.getByRole('dialog', { name: '选择生活分身' });
  await dialog.getByRole('button', { name: '选择牛纹帽双辫女生' }).click();
  await dialog.getByRole('button', { name: '开始记录' }).click();
  await assert.doesNotReject(() => page.getByRole('textbox', { name: '发生了什么' }).waitFor());
}

async function xpLedgerCount(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('qiguang');
    open.addEventListener('error', () => reject(open.error));
    open.addEventListener('success', () => {
      const database = open.result;
      const request = database.transaction('xpLedger', 'readonly').objectStore('xpLedger').count();
      request.addEventListener('success', () => { database.close(); resolve(request.result); });
      request.addEventListener('error', () => { database.close(); reject(request.error); });
    });
  }));
}

test('first use selects a companion, records, edits, and undoes locally', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await page.goto(`${baseUrl}/#/today`);
    const dialog = page.getByRole('dialog', { name: '选择生活分身' });
    await assert.doesNotReject(() => dialog.waitFor());
    await dialog.getByRole('button', { name: '选择牛纹帽双辫女生' }).click();
    await assert.doesNotReject(() => dialog.getByText('已选择牛纹帽双辫女生').waitFor());
    await dialog.getByRole('button', { name: '开始记录' }).click();
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
    await page.goto(`${baseUrl}/#/today`);
    const roomSprite = await page.locator('.room-character').getAttribute('style');
    assert.match(roomSprite ?? '', /character-motion-female/);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('room furniture gives a short companion action before direct navigation', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '打开记录' }).click();
    await assert.doesNotReject(() => page.locator('.room-character.is-action-desk').waitFor());
    await page.getByRole('button', { name: '打开任务', exact: true }).click();
    await page.waitForURL(/#\/tasks$/);
    await page.waitForTimeout(350);
    assert.match(page.url(), /#\/tasks$/);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('system reduced motion skips room furniture action', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '打开记录' }).click();
    assert.equal(await page.locator('.room-character.is-action-desk').count(), 0);
    await page.waitForURL(/#\/record$/);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('reduced motion keeps room furniture navigation immediate', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/system`);
    await page.getByRole('checkbox', { name: '减少动态效果' }).check();
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '打开记录' }).click();
    assert.equal(await page.locator('.room-character.is-action-desk').count(), 0);
    await page.waitForURL(/#\/record$/);
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

test('selected companion uses the supplied portrait and matching room sprite', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/system`);
    await page.getByLabel('生活分身外观').selectOption('female');
    const preview = page.locator('.avatar-preview');
    await assert.doesNotReject(() => preview.waitFor({ state: 'visible' }));
    assert.match(await preview.getAttribute('src') ?? '', /avatar-female-original/);
    await page.getByRole('button', { name: '保存章节设置' }).click();
    await page.goto(`${baseUrl}/#/today`);
    const roomSprite = page.locator('.room-character.has-motion');
    await assert.doesNotReject(() => roomSprite.waitFor({ state: 'visible' }));
    assert.match(await roomSprite.evaluate((element) => getComputedStyle(element).backgroundImage), /character-motion-female/);
    const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(geometry.scrollWidth <= geometry.width);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('daily analysis sends only after range confirmation and keeps inference user-confirmed', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.getByRole('textbox', { name: '发生了什么' }).fill('下午连续开会，晚上散步以后平静了一些。');
    await page.getByRole('button', { name: '仅保存本页记录' }).click();
    await page.getByRole('button', { name: '检查范围并整理' }).click();
    const dialog = page.getByRole('dialog', { name: '检查本次发送范围' });
    await assert.doesNotReject(() => dialog.waitFor());
    const send = dialog.getByRole('button', { name: '确认并整理' });
    assert.equal(await send.isEnabled(), false);
    assert.deepEqual(apiRequests, []);
    await dialog.getByRole('checkbox', { name: /我允许将本次选中的内容发送/ }).check();
    assert.equal(await send.isEnabled(), true);
    assert.deepEqual(apiRequests, []);
    await send.click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '测试整理结果' }).waitFor());
    const inference = page.locator('.analysis-event').filter({ hasText: '等待用户决定的推断' });
    await assert.doesNotReject(() => inference.getByText('待确认', { exact: true }).waitFor());
    assert.equal(await inference.getByText('已确认', { exact: true }).count(), 0);
    await inference.getByRole('button', { name: '核对这条推断' }).click();
    const decision = page.getByRole('dialog', { name: '决定是否相信这条推断' });
    await assert.doesNotReject(() => decision.getByText('AI 推断 · 确认前不产生影响').waitFor());
    await decision.getByRole('button', { name: '确认并应用候选' }).click();
    await assert.doesNotReject(() => inference.getByText('已确认', { exact: true }).waitFor());
    assert.equal(await inference.getByText('待确认', { exact: true }).count(), 0);
    assert.equal(apiRequests.length, 1);
    assert.deepEqual({ path: new URL(apiRequests[0].url).pathname, method: apiRequests[0].method }, { path: '/api/analyze', method: 'POST' });
    const request = JSON.parse(apiRequests[0].body);
    assert.equal(request.operation, 'daily_analysis');
    assert.equal(request.userInput.entries.length, 1);
    assert.equal(request.userInput.entries[0].text, '下午连续开会，晚上散步以后平静了一些。');
    assert.deepEqual(request.permissions.entryIds, request.userInput.entries.map((entry) => entry.entryId));
    assert.deepEqual(request.context, { confirmedEvents: [], recentStates: [], goals: [], bonusHabits: [], memories: [], constraints: [] });
    assert.deepEqual(request.permissions, {
      entryIds: request.permissions.entryIds,
      includeConfirmedEvents: false,
      includeRecentStates: false,
      includeGoals: false,
      includeBonusHabits: false,
      memoryIds: [],
    });
  } finally {
    await context.close();
  }
});

test('task feedback lets the user review an AI candidate before XP is settled', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '安排任务' }).click();
    await page.getByRole('textbox', { name: '行动标题' }).fill('反馈闭环行动');
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('验证实际结果始终由用户确认');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一个可核对步骤');
    await page.getByRole('button', { name: '安排到今天' }).click();
    await page.getByRole('button', { name: '详细反馈任务：反馈闭环行动' }).click();
    const dialog = page.getByRole('dialog', { name: '反馈这次行动' });
    await dialog.getByRole('textbox', { name: '实际完成了什么（可选）' }).fill('完成了一部分可核对步骤。');
    assert.deepEqual(apiRequests, []);
    await dialog.getByRole('button', { name: 'AI 理解这段反馈' }).click();
    const consent = page.getByRole('dialog', { name: '允许这一次 AI 理解？' });
    await assert.doesNotReject(() => consent.getByText('将通过同源中转发送本页明确列出的任务信息和反馈文字。API 密钥不在设备中；发送前仍由你主动点击。').waitFor());
    assert.deepEqual(apiRequests, []);
    await consent.getByRole('button', { name: '允许并继续' }).click();
    await assert.doesNotReject(() => dialog.getByText(/已回填候选“部分完成”/).waitFor());
    assert.equal(await xpLedgerCount(page), 0);
    assert.equal(await page.getByRole('button', { name: '详细反馈任务：反馈闭环行动' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '修改任务“反馈闭环行动”的反馈' }).count(), 0);
    await dialog.getByRole('button', { name: '确认反馈' }).click();
    await assert.doesNotReject(() => page.getByRole('button', { name: '修改任务“反馈闭环行动”的反馈' }).waitFor());
    assert.equal(await xpLedgerCount(page), 1);
    assert.equal(apiRequests.length, 1);
    assert.deepEqual({ path: new URL(apiRequests[0].url).pathname, method: apiRequests[0].method }, { path: '/api/analyze', method: 'POST' });
    const request = JSON.parse(apiRequests[0].body);
    assert.equal(request.operation, 'task_feedback');
    assert.deepEqual(Object.keys(request.userInput).sort(), ['currentDifficulty', 'feedbackText', 'minimumAction', 'questId', 'questTitle']);
    assert.equal(request.userInput.feedbackText, '完成了一部分可核对步骤。');
  } finally {
    await context.close();
  }
});

test('weekly review sends summaries instead of journals and requires theme confirmation', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.getByRole('textbox', { name: '发生了什么' }).fill('整周原文不应出现在周复盘请求里。');
    await page.getByRole('button', { name: '仅保存本页记录' }).click();
    const today = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/review/${today}`);
    await page.getByRole('button', { name: '检查范围并生成' }).click();
    const preview = page.getByRole('dialog', { name: '检查周复盘发送范围' });
    await assert.doesNotReject(() => preview.getByText('不会发送这一周的日记原文。只发送下列已确认事实和摘要；AI 不会直接修改任务、习惯、状态、XP 或长期记忆。').waitFor());
    assert.deepEqual(apiRequests, []);
    await preview.getByRole('button', { name: '确认范围并生成' }).click();
    const consent = page.getByRole('dialog', { name: '允许这一次 AI 周复盘？' });
    await assert.doesNotReject(() => consent.getByText('只发送预览中列出的已确认事实和摘要，不发送整周日记原文。').waitFor());
    assert.deepEqual(apiRequests, []);
    await consent.getByRole('button', { name: '允许并继续' }).click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '保留可持续节奏' }).waitFor());
    await assert.doesNotReject(() => page.getByText('候选，尚未应用', { exact: true }).waitFor());
    assert.equal(apiRequests.length, 1);
    const request = JSON.parse(apiRequests[0].body);
    assert.equal(request.operation, 'weekly_review');
    assert.equal(JSON.stringify(request).includes('整周原文不应出现在周复盘请求里。'), false);
    await page.getByRole('button', { name: '修改并确认下周主题' }).click();
    const confirm = page.getByRole('dialog', { name: '确认下周唯一主题与实验' });
    await confirm.getByRole('button', { name: '由我确认' }).click();
    await assert.doesNotReject(() => page.getByText('已由你确认', { exact: true }).waitFor());
  } finally {
    await context.close();
  }
});
