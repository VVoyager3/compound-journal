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

async function freshPage({ native = false, now } = {}) {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
  if (native) await context.addInitScript(() => { window.androidBridge = { postMessage() {} }; });
  if (now !== undefined) await context.addInitScript(({ current }) => {
    const NativeDate = Date;
    class TestDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [current])); }
      static now() { return current; }
    }
    window.Date = TestDate;
  }, { current: now });
  const page = await context.newPage();
  const apiRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      apiRequests.push({ url: request.url(), method: request.method(), body: request.postData() });
    }
  });
  return { context, page, apiRequests };
}

async function offlineShellPage() {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/#/today`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  assert.equal(await page.getByText('新版本已经激活；完成当前编辑后可手动刷新。', { exact: true }).count(), 0, 'first install must not show an update explanation');
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  return { context, page };
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
    assert.equal(await page.locator('#main-content').getByRole('button', { name: '开始记录' }).count(), 1, 'first use must expose one primary record action');
    assert.equal(await page.locator('#main-content').getByRole('button', { name: '开始收束今天' }).count(), 0, 'empty first use must not show an end-of-day action');
    assert.equal(await page.locator('#main-content').getByText('今天留下一件真实事情', { exact: true }).count(), 0, 'the primary record action must not be repeated as a reminder');
    await dialog.getByRole('button', { name: '选择牛纹帽双辫女生' }).click();
    await assert.doesNotReject(() => dialog.getByText('已选择牛纹帽双辫女生').waitFor());
    await dialog.getByRole('button', { name: '开始记录' }).click();
    await page.waitForURL(/#\/record$/);
    assert.deepEqual(await page.locator('.bottom-nav .nav-item').allTextContents(), ['今日', '任务', '记录', '轨迹']);
    assert.equal(await page.locator('.bottom-nav .nav-item[aria-current="page"]').textContent(), '记录', 'record should behave like the other primary pages');
    const dateSettings = page.getByText('日期 · 今天', { exact: true });
    await assert.doesNotReject(() => dateSettings.waitFor());
    assert.equal(await page.getByRole('textbox', { name: '日期' }).isVisible(), false);
    await dateSettings.click();
    assert.equal(await page.getByRole('textbox', { name: '日期' }).isVisible(), true);
    const input = page.getByRole('textbox', { name: '发生了什么' });
    await input.fill('电脑自动回归：记录一件真实发生的事。');
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    await page.getByRole('button', { name: '保存记录' }).click();
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
    assert.match(roomSprite ?? '', /--face-front-frame:\s*url\([^)]*01-idle-front/);
    const status = page.locator('.status-summary');
    await assert.doesNotReject(() => status.waitFor());
    assert.equal(await status.locator('.status-meter').count(), 5, 'the five life-state meters should be visible directly below the room');
    assert.ok((await page.locator('.home-hero').evaluate((element) => element.getBoundingClientRect().bottom)) <= (await status.evaluate((element) => element.getBoundingClientRect().top)), 'state meters should follow the room before daily actions');
    assert.equal(await status.locator('details').count(), 0, 'the primary life-state view should not hide behind explanatory disclosure');
    const visibleRoomLabels = await page.locator('.room-hotspot .hotspot-label').evaluateAll((labels) => labels
      .filter((label) => getComputedStyle(label).clip === 'auto')
      .map((label) => label.textContent));
    assert.deepEqual(visibleRoomLabels, [], 'room hotspots should stay invisible until hover or keyboard focus');
    const roomChrome = await page.locator('.room-stage').evaluate((element) => ({
      border: getComputedStyle(element).borderTopWidth,
      overlay: getComputedStyle(element.querySelector('.room-scene'), '::before').content,
      light: getComputedStyle(element.querySelector('.room-scene'), '::before').backgroundImage,
    }));
    assert.equal(roomChrome.border, '0px');
    assert.equal(roomChrome.overlay, '""');
    assert.match(roomChrome.light, /gradient/, 'the room should share the warm wilderness lighting language without a permanent UI frame');
    const recordHotspot = page.getByRole('button', { name: '打开记录' });
    await recordHotspot.focus();
    assert.notEqual(await recordHotspot.evaluate((element) => getComputedStyle(element).outlineStyle), 'none', 'borderless hotspots still need a visible keyboard focus ring');
    assert.equal(await recordHotspot.evaluate((element) => getComputedStyle(element, '::before').opacity), '1', 'focused furniture should receive an in-world interaction ring');
    assert.equal(await page.locator('.character-state.is-present').count(), 0, 'the neutral companion pose should not need a floating text label');
    assert.deepEqual(await page.locator('.bottom-nav .nav-item').allTextContents(), ['今日', '任务', '记录', '轨迹']);
    const navigationBounds = await page.locator('.bottom-nav').evaluate((navigation) => {
      const lastItem = navigation.lastElementChild;
      return {
        viewportWidth: window.innerWidth,
        left: Math.round(navigation.getBoundingClientRect().left),
        right: Math.round(navigation.getBoundingClientRect().right),
        lastRight: lastItem instanceof HTMLElement ? Math.round(lastItem.getBoundingClientRect().right) : -1,
      };
    });
    assert.deepEqual(
      navigationBounds,
      { viewportWidth: navigationBounds.viewportWidth, left: 0, right: navigationBounds.viewportWidth, lastRight: navigationBounds.viewportWidth },
      'four-item navigation must fill the viewport without an empty column',
    );
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('all core pages survive 200 percent text at 320px with touch-safe actions', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    for (const route of ['today', 'calendar', 'record', 'growth', 'system', 'tasks', 'review', 'day/2026-08-24']) {
      await page.goto(`${baseUrl}/#/${route}`);
      await assert.doesNotReject(() => page.locator('#main-content').waitFor());
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        content: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll('body *')].filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1);
        }).slice(0, 6).map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
      }));
      assert.ok(layout.content <= layout.viewport, `${route} overflows at 200% text: ${layout.content}/${layout.viewport} ${layout.offenders.join(', ')}`);
      const accessibility = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, summary')].filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && !element.closest('[hidden]');
        });
        const missingNames = controls.filter((element) => {
          const labelled = element.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') ?? '';
          const labels = 'labels' in element && element.labels ? [...element.labels].map((label) => label.textContent ?? '').join(' ') : '';
          return !(element.getAttribute('aria-label') || labelled || labels || element.textContent || element.getAttribute('title'))?.trim();
        }).map((element) => element.outerHTML.slice(0, 120));
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        return { missingNames, imagesWithoutAlt: document.querySelectorAll('img:not([alt])').length, duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index) };
      });
      assert.deepEqual(accessibility, { missingNames: [], imagesWithoutAlt: 0, duplicateIds: [] }, `${route} must expose stable screen-reader semantics`);
    }
    const headerActionLines = await page.locator('.page-header > .button').evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return range.getClientRects().length;
    });
    assert.equal(headerActionLines, 1, 'short page-header actions must not wrap one Chinese character per line');
    await page.goto(`${baseUrl}/#/record`);
    const promptSizes = await page.locator('.record-prompt-actions button').evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }));
    assert(promptSizes.length === 4 && promptSizes.every((box) => box.width >= 44 && box.height >= 44), 'record prompts must remain touch-safe');
    await page.goto(`${baseUrl}/#/system`);
    const advanced = page.getByText('高级系统（领域与行动说明书）', { exact: true });
    assert.ok((await advanced.boundingBox())?.height >= 44);
    await advanced.click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '我的行动说明书' }).waitFor());
  } finally {
    await context.close();
  }
});

test('backup reminder is gentle and dismissible', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.getByRole('textbox', { name: '发生了什么' }).fill('备份提醒回归使用的一条真实记录。');
    await page.getByRole('button', { name: '保存记录' }).click();
    await assert.doesNotReject(() => page.getByText('备份提醒回归使用的一条真实记录。', { exact: true }).waitFor());
    await page.evaluate(() => localStorage.removeItem('qiguang.last-backup-at'));
    await page.goto(`${baseUrl}/#/system`);
    const reminder = page.locator('.gentle-reminder');
    await assert.doesNotReject(() => reminder.waitFor());
    await reminder.getByRole('button', { name: '今天先不用' }).click();
    assert.equal(await page.locator('.gentle-reminder').count(), 0);
  } finally {
    await context.close();
  }
});

test('empty today offers one dismissible real-life record prompt', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    const reminder = page.locator('.record-reminder');
    await assert.doesNotReject(() => reminder.waitFor());
    await reminder.getByRole('button', { name: '今天先不用' }).click();
    assert.equal(await page.locator('.record-reminder').count(), 0);
  } finally {
    await context.close();
  }
});

test('today keeps records and habit editing behind compact entry points', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    const privateBody = '这段只应在记录与回顾页展开，不应直接铺在首页。';
    await page.getByRole('textbox', { name: '发生了什么' }).fill(privateBody);
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.waitForURL(/#\/day\/\d{4}-\d{2}-\d{2}$/);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '新建习惯' }).click();
    const habitDialog = page.getByRole('dialog', { name: '建立低成本习惯' });
    await habitDialog.getByRole('textbox', { name: '我想养成什么？' }).fill('晚饭后散步');
    await habitDialog.getByRole('button', { name: '建立习惯' }).click();
    await page.getByRole('button', { name: '将“晚饭后散步”设为 BONUS' }).click();
    await page.goto(`${baseUrl}/#/today`);

    assert.equal(await page.getByText(privateBody, { exact: true }).count(), 0);
    await assert.doesNotReject(() => page.getByRole('button', { name: '回看今天的 1 条记录' }).waitFor());
    await assert.doesNotReject(() => page.getByRole('heading', { name: '习惯打卡' }).waitFor());
    await assert.doesNotReject(() => page.getByRole('button', { name: '完成打卡：晚饭后散步' }).waitFor());
    assert.equal(await page.getByText(/最小动作：先做一个“晚饭后散步”/).count(), 0);
    assert.equal(await page.getByRole('button', { name: /进入任务板详细管理“晚饭后散步”/ }).count(), 0);
    await page.getByRole('button', { name: '管理习惯与 BONUS' }).click();
    await page.waitForURL(/#\/tasks$/);
    await assert.doesNotReject(() => page.getByRole('button', { name: '编辑习惯“晚饭后散步”' }).waitFor());
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('secondary pages stay concise before the user has evidence', async () => {
  const { context, page } = await freshPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await finishOnboarding(page);

    await page.goto(`${baseUrl}/#/tasks`);
    const arrangeTask = page.getByRole('button', { name: '安排任务', exact: true });
    await assert.doesNotReject(() => arrangeTask.waitFor());
    assert.equal(await arrangeTask.count(), 1);
    assert.equal(await page.getByRole('button', { name: '安排一个最小行动' }).count(), 0);

    await page.goto(`${baseUrl}/#/growth`);
    assert.equal(await page.locator('.branch-card').count(), 0);
    await assert.doesNotReject(() => page.getByText('未开始的成长方向 · 6', { exact: true }).waitFor());
    const growthLayout = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth }));
    assert.ok(growthLayout.height <= 1200, `empty growth page is too long: ${growthLayout.height}px`);
    assert.ok(growthLayout.width <= 390, `empty growth page overflows: ${growthLayout.width}px`);

    await page.goto(`${baseUrl}/#/review`);
    await assert.doesNotReject(() => page.locator('.review-companion').getByText('一起看本周证据，方向由你决定。', { exact: true }).waitFor());
    assert.equal(await page.locator('.review-companion .character-state').count(), 0);
    assert.equal(await page.getByText('WEEKLY REVIEW', { exact: true }).count(), 0);

    await page.goto(`${baseUrl}/#/calendar`);
    await assert.doesNotReject(() => page.getByText('本月还没有领域行动证据。', { exact: true }).waitFor());
    assert.equal(await page.locator('.monthly-area-row').count(), 0);

    await page.goto(`${baseUrl}/#/system`);
    assert.equal(await page.getByText('本地优先', { exact: true }).count(), 0);
    assert.equal(await page.locator('.system-overview').count(), 0, 'settings must start with direct choices instead of an internal-model dashboard');
    assert.equal(await page.locator('.system-advanced[open]').count(), 0, 'internal area controls must stay collapsed by default');
    assert.equal(await page.locator('.assessment-row:visible').count(), 0);
    await assert.doesNotReject(() => page.getByText('校准近期状态 · 0/5', { exact: true }).waitFor());
    const systemHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(systemHeight <= 1800, `collapsed system page is too long: ${systemHeight}px`);

    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/day/${today}`);
    await assert.doesNotReject(() => page.getByText('状态待校准', { exact: true }).waitFor());
    assert.equal(await page.getByRole('heading', { name: '今天的成功证据' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '补记', exact: true }).count(), 1);
    const dayHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(dayHeight <= 1200, `empty day page is too long: ${dayHeight}px`);
  } finally {
    await context.close();
  }
});

test('success diary prompts stay optional and AI goal decomposition requires confirmation', async () => {
  const { context, page, apiRequests } = await freshPage({ now: new Date().setHours(20, 0, 0, 0) });
  try {
    await finishOnboarding(page);
    const input = page.getByRole('textbox', { name: '发生了什么' });
    await page.getByRole('button', { name: '小小成功' }).click();
    assert.match(await input.inputValue(), /今天做成或推进了什么？哪怕很小/);
    await input.fill(`${await input.inputValue()}完成并核对了一次本地回归`);
    await page.getByRole('button', { name: '保存记录' }).click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '今天的证据' }).waitFor());
    await assert.doesNotReject(() => page.getByText('完成并核对了一次本地回归', { exact: true }).waitFor());
    assert.deepEqual(apiRequests, []);

    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '新建目标' }).click();
    const goalDialog = page.getByRole('dialog', { name: '建立一个真实目标' });
    assert.equal(await goalDialog.getByText('先写一句话就够了。系统会先给出下一步，所有内容都可以再修改。', { exact: true }).count(), 0);
    assert.equal(await goalDialog.getByText('需要帮你把目标变小吗？', { exact: true }).count(), 0);
    await goalDialog.getByRole('textbox', { name: '你想让什么事情发生？' }).fill('发布一篇文章');
    await goalDialog.getByRole('button', { name: 'AI 帮我拆成里程碑' }).click();
    const preview = page.getByRole('dialog', { name: '检查目标拆解发送范围' });
    await assert.doesNotReject(() => preview.getByText(/AI 只返回可编辑草案/).waitFor());
    assert.deepEqual(apiRequests, []);
    await preview.getByRole('button', { name: '确认范围并生成草案' }).click();
    const consent = page.getByRole('dialog', { name: '允许这一次目标拆解？' });
    await consent.getByRole('button', { name: '允许并继续' }).click();
    await assert.doesNotReject(() => goalDialog.getByRole('heading', { name: '可编辑的拆解草案' }).waitFor());
    await assert.doesNotReject(() => goalDialog.getByText('当前阶段：目标已经明确，尚未形成第一份可检查成果。', { exact: true }).waitFor());
    await assert.doesNotReject(() => goalDialog.getByText(/关键风险：一次把范围铺得过大/).waitFor());
    assert.equal(await goalDialog.getByRole('checkbox', { name: /同时把“写下第一版结构”安排到今天/ }).isChecked(), true);
    await goalDialog.getByRole('textbox', { name: '你想让什么事情发生？' }).fill('发布一本文章');
    assert.equal(await goalDialog.getByRole('heading', { name: '可编辑的拆解草案' }).isVisible(), false);
    await assert.doesNotReject(() => goalDialog.getByText('目标内容已经改变；请重新生成拆解草案。').waitFor());
    await goalDialog.getByRole('textbox', { name: '你想让什么事情发生？' }).fill('发布一篇文章');
    await goalDialog.getByRole('button', { name: 'AI 帮我拆成里程碑' }).click();
    const secondPreview = page.getByRole('dialog', { name: '检查目标拆解发送范围' });
    await secondPreview.getByRole('button', { name: '确认范围并生成草案' }).click();
    await assert.doesNotReject(() => goalDialog.getByRole('heading', { name: '可编辑的拆解草案' }).waitFor());
    await goalDialog.getByRole('button', { name: '建立目标' }).click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '发布一篇文章' }).waitFor());
    await assert.doesNotReject(() => page.getByText('完成第一段可检查成果', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByRole('heading', { name: '写下第一版结构' }).waitFor());
    await assert.doesNotReject(() => page.getByText('1 项待处理', { exact: true }).waitFor());
    assert.equal(await page.getByText(/\d\/1 MAIN/).count(), 0);
    await assert.doesNotReject(() => page.getByText('管理目标', { exact: true }).waitFor());
    assert.equal(apiRequests.length, 2);
    const request = JSON.parse(apiRequests.at(-1).body);
    assert.equal(request.operation, 'goal_decomposition');
    assert.deepEqual(Object.keys(request.userInput).sort(), ['completionEvidence', 'result', 'why']);
    assert.equal('entries' in request.context, false);

    await page.getByRole('checkbox', { name: '完成：写下第一版结构' }).check();
    await assert.doesNotReject(() => page.getByText(/里程碑已完成；下一步/).waitFor());
    await page.getByText('管理目标', { exact: true }).click();
    await page.getByRole('button', { name: '根据执行证据重新拆解“发布一篇文章”' }).click();
    const replanPreview = page.getByRole('dialog', { name: '检查目标拆解发送范围' });
    await assert.doesNotReject(() => replanPreview.getByRole('checkbox', { name: /执行证据 · completed/ }).waitFor());
    await replanPreview.getByRole('button', { name: '确认范围并生成草案' }).click();
    const replan = page.getByRole('dialog', { name: '确认新的目标路径' });
    await assert.doesNotReject(() => replan.getByRole('textbox', { name: '新的下一步' }).waitFor());
    assert.equal(await replan.getByRole('textbox', { name: '新的下一步' }).inputValue(), '把原行动缩小一半');
    await replan.getByRole('button', { name: '确认并替换旧路径' }).click();
    await assert.doesNotReject(() => page.getByText('新路径已确认，旧路径保留为历史。', { exact: true }).waitFor());
    assert.equal(await page.getByText('已被新计划替换', { exact: true }).count(), 1);
    const replanRequest = JSON.parse(apiRequests.at(-1).body);
    assert.equal(replanRequest.context.executionEvidence.length, 1);
    assert.deepEqual(replanRequest.permissions.questIds, [replanRequest.context.executionEvidence[0].questId]);
    await page.goto(`${baseUrl}/#/calendar`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '本月领域变化' }).waitFor());
    await assert.doesNotReject(() => page.getByText(/· 进步 · 1 项推进证据/).waitFor());

    await page.goto(`${baseUrl}/#/today`);
    await assert.doesNotReject(() => page.getByRole('button', { name: '开始收束今天' }).waitFor());
    await page.getByRole('button', { name: '开始收束今天' }).click();
    await assert.doesNotReject(() => page.getByRole('dialog', { name: '收束今天' }).waitFor());
    await assert.doesNotReject(() => page.getByRole('dialog', { name: '收束今天' }).getByText(/明天准备继续的一步|明天还没有预先决定/).waitFor());
  } finally {
    await context.close();
  }
});

test('confirmed feedback changes the next day recommendation', async () => {
  const { context, page } = await freshPage();
  const firstDay = new Date(2026, 7, 20, 10, 0, 0).getTime();
  await context.addInitScript(({ initial }) => {
    const NativeDate = Date;
    const current = () => Number(localStorage.getItem('qiguang.e2e-now')) || initial;
    class TestDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [current()])); }
      static now() { return current(); }
    }
    window.Date = TestDate;
  }, { initial: firstDay });
  try {
    await finishOnboarding(page);
    await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('qiguang');
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      const readAll = (store) => new Promise((resolve, reject) => {
        const request = store.getAll();
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      const transaction = database.transaction(['areas', 'branches', 'goals', 'milestones', 'quests'], 'readwrite');
      const [areas, branches] = await Promise.all([readAll(transaction.objectStore('areas')), readAll(transaction.objectStore('branches'))]);
      const [area] = areas;
      const [branch] = branches;
      const timestamp = new Date().toISOString();
      const date = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
      const goalId = crypto.randomUUID();
      const firstMilestoneId = crypto.randomUUID();
      const secondMilestoneId = crypto.randomUUID();
      const common = { createdAt: timestamp, updatedAt: timestamp, version: 1 };
      transaction.objectStore('goals').add({ id: goalId, result: '完成跨日作品', why: '验证反馈会改变方向', evidence: '一份可见作品', nextStep: '完成第一阶段', areaId: area.id, branchId: branch.id, role: 'main', status: 'active', startDate: date, ...common });
      transaction.objectStore('milestones').add({ id: firstMilestoneId, goalId, order: 0, description: '第一阶段', evidence: '第一阶段证据', status: 'pending', xpSettled: false, ...common });
      transaction.objectStore('milestones').add({ id: secondMilestoneId, goalId, order: 1, description: '第二阶段', evidence: '第二阶段证据', status: 'pending', xpSettled: false, ...common });
      transaction.objectStore('quests').add({ id: crypto.randomUUID(), localDate: date, type: 'main', sourceType: 'goal', sourceId: goalId, milestoneId: firstMilestoneId, actionId: crypto.randomUUID(), settlementVersion: 0, title: '完成第一阶段', reason: '来自目标的第一步', minimumAction: '先做五分钟', completionCriteria: '第一阶段证据', estimatedMinutes: 5, difficulty: 'light', branchId: branch.id, status: 'pending', aiSuggested: false, userModified: false, ...common });
      await new Promise((resolve, reject) => {
        transaction.addEventListener('complete', resolve, { once: true });
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
      });
      database.close();
    });
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('checkbox', { name: '完成：完成第一阶段' }).check();
    await assert.doesNotReject(() => page.getByText(/里程碑已完成；下一步“推进：第二阶段”/).waitFor());
    await page.evaluate((nextDay) => localStorage.setItem('qiguang.e2e-now', String(nextDay)), firstDay + 86_400_000);
    await page.goto(`${baseUrl}/#/today`);
    const guide = page.locator('.daily-guide');
    await assert.doesNotReject(() => guide.getByRole('heading', { name: '推进：第二阶段' }).waitFor());
    await assert.doesNotReject(() => guide.getByText('这是昨天反馈后生成的下一步；先核对它今天是否仍适合。', { exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '调整或顺延任务：推进：第二阶段' }).click();
    const adjustment = page.getByRole('dialog', { name: '调整这项行动' });
    await assert.doesNotReject(() => adjustment.getByText('这次调整依据', { exact: true }).waitFor());
    await assert.doesNotReject(() => adjustment.getByText('事实：来自目标“完成跨日作品”', { exact: true }).waitFor());
    await assert.doesNotReject(() => adjustment.getByText(/事实：当前里程碑“第二阶段”/).waitFor());
    await adjustment.getByRole('button', { name: '取消' }).click();
    await page.getByRole('button', { name: '详细反馈任务：推进：第二阶段' }).click();
    const feedback = page.getByRole('dialog', { name: '反馈这次行动' });
    await feedback.getByRole('combobox', { name: '结果' }).selectOption('skipped');
    await feedback.getByRole('combobox', { name: '今天不做的原因（可选）' }).selectOption('建议不适合我');
    await feedback.getByRole('button', { name: '确认反馈' }).click();
    const decision = page.getByRole('dialog', { name: '这条目标路径还值得继续吗？' });
    await assert.doesNotReject(() => decision.getByRole('button', { name: '修改目标或下一步' }).waitFor());
    await assert.doesNotReject(() => decision.getByRole('button', { name: '根据证据重新拆解' }).waitFor());
    await decision.getByRole('button', { name: '暂不改变目标' }).click();
    await page.goto(`${baseUrl}/#/today`);
    assert.equal(await page.getByRole('button', { name: '确认或调整这一步' }).count(), 0, '今天不做后，同一天不应再次催促同一目标');
    await page.evaluate((nextDay) => localStorage.setItem('qiguang.e2e-now', String(nextDay)), firstDay + 2 * 86_400_000);
    await page.reload();
    const retryGuide = page.locator('.daily-guide');
    assert.equal(await retryGuide.count(), 1, `次日必须恢复目标处理入口：${await page.locator('#main-content').innerText()}`);
    assert.match(await retryGuide.innerText(), /重新决定：推进：第二阶段/);
    await retryGuide.getByRole('button', { name: '确认或调整这一步' }).click();
    const retryDialog = page.getByRole('dialog', { name: '把下一步安排到今天' });
    const retryTitle = retryDialog.getByRole('textbox', { name: '我现在想做什么？' });
    assert.equal(await retryTitle.inputValue(), '推进：第二阶段');
    await retryTitle.fill('缩小后继续第二阶段');
    await retryDialog.getByRole('button', { name: '安排到今天' }).click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '缩小后继续第二阶段' }).waitFor());
  } finally {
    await context.close();
  }
});

test('Android without a MiniMax key keeps the local success and action loop usable', async () => {
  const { context, page, apiRequests } = await freshPage({ native: true });
  try {
    await finishOnboarding(page);
    const input = page.getByRole('textbox', { name: '发生了什么' });
    await page.getByRole('button', { name: '小小成功' }).click();
    await input.fill(`${await input.inputValue()}完成了今天最小的一步`);
    await page.getByRole('button', { name: '保存记录' }).click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '今天的证据' }).waitFor());
    await assert.doesNotReject(() => page.getByText('完成了今天最小的一步', { exact: true }).waitFor());
    assert.equal(await page.getByRole('button', { name: '检查范围并整理' }).count(), 0);

    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '新建目标' }).click();
    const goalDialog = page.getByRole('dialog', { name: '建立一个真实目标' });
    assert.equal(await goalDialog.getByRole('button', { name: 'MiniMax 未配置' }).isDisabled(), true);
    await goalDialog.getByRole('textbox', { name: '你想让什么事情发生？' }).fill('完成一个本地目标');
    await goalDialog.getByRole('button', { name: '建立目标' }).click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '完成一个本地目标', exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByRole('heading', { name: /花 5 分钟写下“完成一个本地目标”的第一步/ }).waitFor());

    await page.goto(`${baseUrl}/#/review`);
    await assert.doesNotReject(() => page.getByText(/MiniMax 尚未配置/).waitFor());
    await page.goto(`${baseUrl}/#/system`);
    await page.getByText('AI 权限 · 已关闭', { exact: true }).click();
    const aiSettings = page.locator('.ai-settings');
    const permission = aiSettings.getByRole('checkbox', { name: /允许主动整理/ });
    const check = aiSettings.getByRole('button', { name: '检查 AI 配置' });
    assert.equal(await check.isDisabled(), true);
    assert.equal(await permission.isDisabled(), true);
    await assert.doesNotReject(() => page.getByText(/此安装包尚未配置 MiniMax 密钥/).waitFor());
    await aiSettings.getByRole('textbox', { name: '自定义 API Key' }).fill('test-minimax-key');
    await aiSettings.getByRole('button', { name: '保存', exact: true }).click();
    await assert.doesNotReject(() => aiSettings.getByText(/已保存自定义密钥（长度 16/).waitFor());
    assert.equal(await permission.isDisabled(), false);
    assert.equal(await check.isDisabled(), false);
    await aiSettings.getByRole('button', { name: '清除自定义密钥' }).click();
    await assert.doesNotReject(() => aiSettings.getByText('未保存自定义密钥。留空将使用安装包密钥。', { exact: true }).waitFor());
    assert.equal(await permission.isDisabled(), true);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('the companion wanders naturally and walks to furniture before direct navigation', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    const character = page.locator('.room-character');
    await assert.doesNotReject(() => page.locator('.room-character.is-motion-ready').waitFor());
    assert.equal(await page.locator('.room-plant').count(), 0, 'the room should not render unexplained habit color blocks');
    const before = await character.boundingBox();
    await assert.doesNotReject(() => page.locator('.room-character[class*="is-ambient-"]').waitFor());
    const ambientAction = await character.evaluate((element) => [...element.classList].find((name) => name.startsWith('is-ambient-')) ?? '');
    assert.match(ambientAction, /^is-ambient-(walk|read|focus|rest)$/);
    assert.equal(await page.locator('.character-state.is-present').count(), 0);
    assert.notEqual(await character.evaluate((element) => getComputedStyle(element).animationName), 'none');
    assert.doesNotMatch(await character.evaluate((element) => getComputedStyle(element).animationIterationCount), /infinite/);
    await page.waitForTimeout(850);
    const wandering = await character.boundingBox();
    if (ambientAction === 'is-ambient-walk') assert.ok(before && wandering && Math.abs(wandering.x - before.x) > 2, 'companion should visibly wander around the room');
    await page.getByRole('button', { name: '打开记录' }).click();
    await assert.doesNotReject(() => page.locator('.room-character.is-action-desk.is-walking').waitFor());
    const actionStart = await character.boundingBox();
    const actionAnimations = await character.evaluate((element) => getComputedStyle(element).animationName);
    const actionTiming = await character.evaluate((element) => getComputedStyle(element).animationTimingFunction);
    assert.match(actionAnimations, /room-action/);
    assert.match(actionAnimations, /room-walk-cycle/);
    assert.doesNotMatch(actionAnimations, /room-footfall/);
    assert.match(actionTiming, /steps\(6, jump-none\)/, 'the route should move on the same discrete beat as its six walking frames');
    assert.doesNotMatch(actionAnimations, /step-weight/);
    assert.match(await character.evaluate((element) => getComputedStyle(element, '::after').animationName), /room-shadow-step/, 'the ground shadow should respond to each footfall');
    assert.match(await page.getByRole('button', { name: '打开记录' }).evaluate((element) => getComputedStyle(element, '::before').animationName), /hotspot-sigil/, 'the active furniture should use a short in-world focus cue');
    const samples = await character.evaluate((element) => new Promise((resolve) => {
      const values = [];
      const startedAt = performance.now();
      const sample = () => {
        values.push({ image: getComputedStyle(element).backgroundImage, x: Math.round(element.getBoundingClientRect().x * 10) / 10 });
        if (performance.now() - startedAt >= 420) resolve(values);
        else requestAnimationFrame(sample);
      };
      sample();
    }));
    const sampledFrames = new Set(samples.map((item) => item.image));
    const sampledPositions = new Set(samples.map((item) => item.x));
    assert.ok(sampledFrames.size >= 3 && samples.every((item) => item.image !== 'none'), 'preloaded walking frames must advance without flashing blank');
    assert.ok(sampledPositions.size >= 3 && sampledPositions.size < samples.length / 2, 'movement must land on repeated discrete positions instead of drifting every render frame');
    const during = await character.boundingBox();
    assert.ok(actionStart && during && during.x < actionStart.x - 5, 'companion should visibly walk toward the desk');
    assert.equal(await character.evaluate((element) => getComputedStyle(element).clipPath), 'none', 'independent frames should not be clipped again while walking');
    await assert.doesNotReject(() => page.locator('.room-character.is-action-desk.is-interacting').waitFor());
    await assert.doesNotReject(() => page.getByText('坐到椅子上，写下一件真实发生的事。', { exact: true }).waitFor());
    await page.waitForTimeout(120);
    assert.match(await character.evaluate((element) => getComputedStyle(element).backgroundImage), /02-idle-left/);
    await page.waitForURL(/#\/record$/);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('each clicked furniture route faces the direction of both grid segments', async () => {
  const { context, page, apiRequests } = await freshPage();
  const routes = [
    ['打开记录', 'desk', 'left', 'back'],
    ['打开任务', 'board', 'back', 'back'],
    ['打开日历', 'calendar', 'back', 'right'],
    ['打开成长', 'workbench', 'right', 'back'],
    ['打开状态', 'window', 'back', 'left'],
    ['在床边休息', 'bed', 'front', 'left'],
  ];
  const directionBetween = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'front' : 'back');
  };
  try {
    await finishOnboarding(page);
    for (const [buttonName, action, firstDirection, secondDirection] of routes) {
      await page.goto(`${baseUrl}/#/today`);
      await page.reload();
      await assert.doesNotReject(() => page.locator('.room-character.is-motion-ready').waitFor());
      await page.getByRole('button', { name: buttonName, exact: true }).click();
      const character = page.locator(`.room-character.is-action-${action}.is-walking`);
      await assert.doesNotReject(() => character.waitFor());
      const motion = await character.evaluate((element) => {
        const animations = element.getAnimations();
        const route = animations.find((animation) => animation.animationName === 'room-action');
        const sprite = animations.find((animation) => animation.animationName === 'room-walk-cycle');
        if (!route || !sprite) return null;
        route.pause();
        sprite.pause();
        const sample = (time) => {
          route.currentTime = time;
          sprite.currentTime = time;
          const box = element.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.bottom, image: getComputedStyle(element).backgroundImage };
        };
        return {
          start: sample(0),
          firstFrame: sample(300),
          waypoint: sample(480),
          secondFrame: sample(700),
          end: sample(900),
        };
      });
      assert.ok(motion, `${action} must expose route and sprite animations`);
      assert.equal(directionBetween(motion.start, motion.waypoint), firstDirection, `${action} first segment must move ${firstDirection}`);
      assert.equal(directionBetween(motion.waypoint, motion.end), secondDirection, `${action} second segment must move ${secondDirection}`);
      assert.match(motion.firstFrame.image, new RegExp(`walk-${firstDirection}-`), `${action} must face ${firstDirection} during its first segment`);
      assert.match(motion.secondFrame.image, new RegExp(`walk-${secondDirection}-`), `${action} must turn toward ${secondDirection} only for its second segment`);
    }
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('the companion explains the current direction before offering adjustments', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    const settings = page.getByRole('button', { name: '进入设置' });
    await assert.doesNotReject(() => settings.waitFor());
    const settingsBox = await settings.boundingBox();
    assert.ok(settingsBox && settingsBox.width >= 44 && settingsBox.height >= 44, 'the page settings action should remain touch-safe');
    const companionButton = page.getByRole('button', { name: '生活分身' });
    await companionButton.click();
    const panel = page.locator('.character-panel');
    await assert.doesNotReject(() => panel.waitFor());
    await assert.doesNotReject(() => panel.getByText('我在。今天想从哪里开始？', { exact: true }).waitFor());
    await panel.getByText('我在。今天想从哪里开始？', { exact: true }).click();
    assert.equal(await panel.isVisible(), true, 'clicking inside the companion panel must keep it open');
    await page.locator('.daily-guide').click({ position: { x: 8, y: 8 } });
    await assert.doesNotReject(() => panel.waitFor({ state: 'hidden' }));
    assert.equal(await companionButton.getAttribute('aria-expanded'), 'false');
    await companionButton.click();
    await assert.doesNotReject(() => panel.waitFor());
    await assert.doesNotReject(() => panel.getByRole('button', { name: '开始记录' }).waitFor());
    assert.equal(await panel.getByRole('button', { name: '查看今天的行动' }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: '设置与数据' }).count(), 0);
    assert.equal(await panel.locator('.button-primary').getAttribute('aria-label') ?? await panel.locator('.button-primary').textContent(), '开始记录');
    const panelBox = await panel.boundingBox();
    const actionBoxes = await panel.locator('.character-actions button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()));
    assert.ok(panelBox && actionBoxes.every((box) => box.left >= panelBox.x && box.right <= panelBox.x + panelBox.width), 'all companion actions should stay inside the panel');
    assert.ok(actionBoxes.every((box) => box.width >= panelBox.width * .25), 'all companion actions should remain visibly usable');
    assert.equal(await panel.getByRole('button', { name: '为什么给我这个主线？' }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: '更换外观' }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: '看本周' }).count(), 0);
    await panel.getByRole('button', { name: '开始记录' }).click();
    await page.waitForURL(/#\/record$/);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '安排任务' }).click();
    await page.getByText('调整细节（可选）', { exact: true }).click();
    await page.getByRole('textbox', { name: '我现在想做什么？' }).fill('验证主线依据');
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('这是主线的可追溯理由。');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一个最小步骤');
    await page.getByRole('combobox', { name: '任务类型' }).selectOption('main');
    await page.getByRole('button', { name: '安排到今天' }).click();
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '生活分身' }).click();
    await assert.doesNotReject(() => panel.getByText('验证主线依据', { exact: true }).waitFor());
    assert.equal(await panel.getByText(/依据：今天已经有一条确认过的主线/).count(), 0);
    assert.equal(await panel.locator('.button-primary').textContent(), '查看今天的行动');
    await panel.getByRole('button', { name: '查看今天的行动' }).click();
    assert.equal(await companionButton.getAttribute('aria-expanded'), 'false');
    await assert.doesNotReject(() => page.locator('.main-action').getByText('这是主线的可追溯理由。', { exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/system`);
    await page.getByText('高级系统（领域与行动说明书）', { exact: true }).click();
    await page.getByRole('button', { name: '主动告诉生活分身一条规则' }).click();
    const memoryDialog = page.getByRole('dialog', { name: '告诉生活分身一条规则' });
    await memoryDialog.getByRole('combobox', { name: '规则类型' }).selectOption('constraint');
    await memoryDialog.getByRole('textbox', { name: '具体内容' }).fill('连续会议后先恢复十分钟');
    await memoryDialog.getByRole('button', { name: '确认并记住' }).click();
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '生活分身' }).click();
    await panel.getByText(/我记得的背景/).click();
    await assert.doesNotReject(() => panel.getByText('你确认的边界：连续会议后先恢复十分钟', { exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/system`);
    await page.getByText('高级系统（领域与行动说明书）', { exact: true }).click();
    await page.getByRole('button', { name: '已掌握，减少提醒' }).click();
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '生活分身' }).click();
    assert.equal(await panel.getByText('你确认的边界：连续会议后先恢复十分钟', { exact: true }).count(), 0);
  } finally {
    await context.close();
  }
});

test('keyboard users can skip the room and open a direct route', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    await assert.doesNotReject(() => page.getByRole('button', { name: '开始记录' }).waitFor());
    await page.getByRole('link', { name: '跳到主要内容' }).press('Enter');
    await page.locator('#main-content:focus').waitFor();
    const recordLink = page.getByRole('link', { name: '记录', exact: true });
    assert.equal(await recordLink.getAttribute('href'), '#/record', 'keyboard users need a native direct-route link');
    await Promise.all([page.waitForURL(/#\/record$/), recordLink.click()]);
    await assert.doesNotReject(() => page.getByRole('textbox', { name: '发生了什么' }).waitFor());
    await page.goto(`${baseUrl}/#/status`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '我的系统' }).waitFor());
    await page.goto(`${baseUrl}/#/history`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '日历' }).waitFor());
  } finally {
    await context.close();
  }
});

test('room uses one of the documented time palettes', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    const phase = await page.locator('.room-scene').getAttribute('class');
    assert.match(phase ?? '', /is-(night|morning|day|evening)/);
    const background = await page.locator('.room-scene').evaluate((element) => getComputedStyle(element).backgroundImage);
    assert.match(background, /linear-gradient/);
    assert.match(background, /room-background/);
    const lampOpacity = Number(await page.locator('.room-lamp').evaluate((element) => getComputedStyle(element).opacity));
    assert.equal(lampOpacity > 0, /is-(night|evening)/.test(phase ?? ''));
  } finally {
    await context.close();
  }
});

test('returning after a long recording gap can record, revisit, or dismiss', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('qiguang');
      request.addEventListener('error', () => reject(request.error));
      request.addEventListener('success', () => {
        const database = request.result;
        const date = new Date(); date.setDate(date.getDate() - 15);
        const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const timestamp = date.toISOString();
        const transaction = database.transaction('entries', 'readwrite');
        transaction.objectStore('entries').add({ id: crypto.randomUUID(), localDate, body: '之前留下的记录。', inputMethod: 'text', analysisStatus: 'not-submitted', createdAt: timestamp, updatedAt: timestamp, version: 1 });
        transaction.addEventListener('complete', () => { database.close(); resolve(undefined); });
        transaction.addEventListener('abort', () => { database.close(); reject(transaction.error); });
      });
    }));
    await page.goto(`${baseUrl}/#/today`);
    await assert.doesNotReject(() => page.getByText('欢迎回来', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByText('要从最近发生的一件事开始吗？', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.locator('.room-character.is-welcoming').waitFor());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.getByRole('button', { name: '先看看以前' }).click();
    await page.waitForURL(/#\/calendar$/);
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '记录近况' }).click();
    await page.waitForURL(/#\/record$/);
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '暂时不用' }).click();
    assert.equal(await page.getByText('欢迎回来', { exact: true }).count(), 0);
    await page.reload();
    assert.equal(await page.getByText('欢迎回来', { exact: true }).count(), 0);
  } finally {
    await context.close();
  }
});

test('a backdated record created today does not trigger the return prompt', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('qiguang');
      request.addEventListener('error', () => reject(request.error));
      request.addEventListener('success', () => {
        const database = request.result;
        const date = new Date(); date.setDate(date.getDate() - 15);
        const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const timestamp = new Date().toISOString();
        const transaction = database.transaction('entries', 'readwrite');
        transaction.objectStore('entries').add({ id: crypto.randomUUID(), localDate, body: '今天补记旧事。', inputMethod: 'text', analysisStatus: 'not-submitted', createdAt: timestamp, updatedAt: timestamp, version: 1 });
        transaction.addEventListener('complete', () => { database.close(); resolve(undefined); });
        transaction.addEventListener('abort', () => { database.close(); reject(transaction.error); });
      });
    }));
    await page.goto(`${baseUrl}/#/today`);
    assert.equal(await page.getByText('欢迎回来', { exact: true }).count(), 0);
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
    await page.getByRole('button', { name: '在床边休息' }).click();
    assert.equal(await page.locator('.room-character.is-action-bed').count(), 0);
    await assert.doesNotReject(() => page.getByText('歇一会儿。准备好再继续，也算照顾今天。', { exact: true }).waitFor());
    await page.getByRole('button', { name: '打开记录' }).click();
    assert.equal(await page.locator('.room-character.is-action-desk').count(), 0);
    await page.waitForURL(/#\/record$/);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('installed shell keeps every independent companion frame available offline', async () => {
  const { context, page } = await offlineShellPage();
  try {
    const assets = await page.evaluate(async () => {
      const bundles = [...document.scripts].map((script) => script.src).filter(Boolean);
      const source = await Promise.all(bundles.map((bundle) => fetch(bundle).then((response) => response.text())));
      return [...new Set(source.flatMap((text) => [...text.matchAll(/["'`](\/assets\/[^"'`]+\.(?:png|jpe?g))["'`]/g)].map((match) => match[1])))].sort();
    });
    assert.equal(assets.length, 75, 'portraits, 72 independent frames, and the room background must be built into the shell');
    await context.setOffline(true);
    const dialog = page.getByRole('dialog', { name: '选择生活分身' });
    await dialog.getByRole('button', { name: '选择牛纹帽双辫女生' }).click();
    await dialog.getByRole('button', { name: '开始记录' }).click();
    await page.waitForURL(/#\/record$/);
    await page.goto(`${baseUrl}/#/today`);
    const imageUrl = await page.locator('.room-character').evaluate((element) => getComputedStyle(element).backgroundImage.match(/url\("?([^"\)]+)"?\)/)?.[1]);
    assert.match(imageUrl ?? '', /01-idle-front/, 'selected companion must use an independent motion frame');
    const cached = await page.evaluate((urls) => Promise.all(urls.map((url) => fetch(url).then((response) => response.ok).catch(() => false))), assets);
    assert.equal(cached.every(Boolean), true);
  } finally {
    await context.close();
  }
});

test('reduced motion keeps room furniture navigation immediate', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/system`);
    await page.getByText('显示偏好', { exact: true }).click();
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
    await page.getByText('校准近期状态 · 0/5', { exact: true }).click();
    await page.getByRole('checkbox', { name: '我想校准这一项' }).first().check();
    await page.getByRole('slider', { name: '体力自评' }).fill('25');
    await page.getByRole('button', { name: '保存这次校准' }).click();
    await page.goto(`${baseUrl}/#/today`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '先补足体力' }).waitFor());
    assert.equal(await page.locator('.room-scene.is-cue-rest').count(), 1);
    assert.equal(await page.locator('.room-character.is-resting').count(), 1);
    assert.match(await page.locator('.room-character.is-resting').evaluate((element) => getComputedStyle(element).backgroundImage), /12-rest/);
    assert.equal(await page.locator('.room-cue').count(), 1);
    await page.getByRole('button', { name: '打开任务', exact: true }).click();
    assert.equal(await page.locator('.room-character.is-action-board').count(), 1);
    await page.waitForURL(/#\/tasks$/);
    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/day/${today}`);
    await page.locator(`.room-stage[data-snapshot-date="${today}"]`).waitFor();
    assert.equal(await page.locator(`.room-stage[data-snapshot-date="${today}"]`).count(), 1);
    assert.equal(await page.locator('.room-scene.is-day.is-cue-rest').count(), 1);
    assert.equal(await page.locator('.room-character.is-resting').count(), 1);
    await page.goto(`${baseUrl}/#/today`);
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

test('a day review keeps its own state freshness and excludes future habits', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    const past = await page.evaluate(() => {
      const value = new Date();
      value.setDate(value.getDate() - 10);
      const localDate = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
      const pastTimestamp = value.toISOString();
      const currentTimestamp = new Date().toISOString();
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('qiguang');
        request.addEventListener('error', () => reject(request.error));
        request.addEventListener('success', () => {
          const database = request.result;
          const transaction = database.transaction(['observations', 'habits'], 'readwrite');
          transaction.objectStore('observations').add({
            id: crypto.randomUUID(), assessmentId: crypto.randomUUID(), localDate, dimension: 'energy', kind: 'user-self-assessment', value: 25,
            active: true, observedAt: pastTimestamp, createdAt: pastTimestamp, updatedAt: pastTimestamp, version: 1,
          });
          transaction.objectStore('habits').add({
            id: crypto.randomUUID(), name: '后来才建立的习惯', minimumAction: '不会出现在过去', scheduleDays: [1], dimension: 'energy', branchId: crypto.randomUUID(), difficulty: 'light',
            status: 'active', bonusEnabled: true, createdAt: currentTimestamp, updatedAt: currentTimestamp, version: 1,
          });
          transaction.addEventListener('complete', () => { database.close(); resolve(localDate); });
          transaction.addEventListener('abort', () => { database.close(); reject(transaction.error); });
        });
      });
    });
    await page.goto(`${baseUrl}/#/day/${past}`);
    await assert.doesNotReject(() => page.getByText('当日状态', { exact: true }).waitFor());
    const energyStatus = page.getByRole('button', { name: /体力 25 需要关注 .*最后证据：/ });
    assert.equal(await energyStatus.count(), 1);
    assert.equal(await energyStatus.locator('.status-meter').evaluate((meter) => getComputedStyle(meter).getPropertyValue('--status-level').trim()), '25%');
    assert.equal(await page.getByText('需要更新', { exact: true }).count(), 0);
    assert.equal(await page.locator('.room-stage[data-snapshot-date]').getAttribute('data-snapshot-date'), past);
    assert.equal(await page.locator('.room-plant').count(), 0, 'habits created after this date must not leave empty decorative blocks in the room');
    await energyStatus.click();
    const detail = page.getByRole('dialog', { name: '体力状态依据' });
    await assert.doesNotReject(() => detail.waitFor());
    assert.equal(await detail.getByText('需要更新', { exact: true }).count(), 0);
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
    await page.getByText('调整细节（可选）', { exact: true }).click();
    await page.getByRole('textbox', { name: '我现在想做什么？' }).fill('证据测试行动');
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('验证成长分支可以追溯现实证据');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一个可验证步骤');
    await page.getByRole('button', { name: '安排到今天' }).click();
    await page.getByRole('checkbox', { name: '完成：证据测试行动' }).check();
    await assert.doesNotReject(() => page.getByRole('button', { name: '修改任务“证据测试行动”的反馈' }).waitFor());
    await page.goto(`${baseUrl}/#/today`);
    const celebration = page.locator('.room-character.is-celebrating');
    await assert.doesNotReject(() => celebration.waitFor());
    assert.doesNotMatch(await celebration.evaluate((element) => getComputedStyle(element).animationIterationCount), /infinite/);
    await assert.doesNotReject(() => page.locator('.character-state.is-celebrating').getByText('庆祝', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByRole('heading', { name: '今天已经留下证据' }).waitFor());
    assert.equal(await page.getByRole('heading', { name: '先讲一件最近发生的事' }).count(), 0);
    assert.equal(await page.locator('.avatar-line').count(), 0);
    await page.getByRole('button', { name: '生活分身' }).click();
    const settledPanel = page.locator('.character-panel');
    await assert.doesNotReject(() => settledPanel.getByText('今天已经留下证据，可以回看，也可以停下。', { exact: true }).waitFor());
    await assert.doesNotReject(() => settledPanel.getByRole('button', { name: '回看今天' }).waitFor());
    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/day/${today}`);
    const successDiary = page.locator('.success-evidence');
    await assert.doesNotReject(() => successDiary.getByText('完成：证据测试行动', { exact: true }).waitFor());
    assert.equal(await page.getByText('来自你的“小小成功”记录和已确认行动反馈，不做额外推断。').count(), 0);
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
      }).map((element) => ({ text: element.textContent?.trim(), className: element.className, rect: element.getBoundingClientRect().toJSON() })),
    }));
    assert.equal(geometry.width, 320);
    assert.ok(geometry.scrollWidth <= geometry.width);
    assert.deepEqual(geometry.tooSmall, []);
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
    await page.getByText('人物与章节', { exact: true }).click();
    const avatarSelect = page.getByLabel('生活分身外观');
    const preview = page.locator('.avatar-preview');
    await avatarSelect.selectOption('male');
    assert.match(await preview.getAttribute('src') ?? '', /avatar-male-cartoon/);
    await avatarSelect.selectOption('female');
    await assert.doesNotReject(() => preview.waitFor({ state: 'visible' }));
    assert.match(await preview.getAttribute('src') ?? '', /avatar-female-cartoon/);
    await page.getByRole('button', { name: '保存章节设置' }).click();
    await page.goto(`${baseUrl}/#/today`);
    const roomSprite = page.locator('.room-character.has-motion');
    await assert.doesNotReject(() => roomSprite.waitFor({ state: 'visible' }));
    assert.match(await roomSprite.evaluate((element) => getComputedStyle(element).backgroundImage), /01-idle-front/);
    assert.equal(await roomSprite.evaluate((element) => element.classList.contains('is-happy')), true);
    const spriteLayout = await roomSprite.evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundPosition: style.backgroundPosition, backgroundSize: style.backgroundSize, idleFrame: style.getPropertyValue('--idle-frame').trim(), walkFrame: style.getPropertyValue('--walk-front-1').trim(), mixBlendMode: style.mixBlendMode };
    });
    assert.equal(spriteLayout.backgroundPosition, '50% 100%');
    assert.equal(spriteLayout.backgroundSize, 'contain');
    assert.match(spriteLayout.idleFrame, /01-idle-front/);
    assert.match(spriteLayout.walkFrame, /25-walk-front-1/);
    assert.equal(spriteLayout.mixBlendMode, 'normal');
    const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    const spriteBounds = await roomSprite.boundingBox();
    assert.ok(spriteBounds && spriteBounds.width >= 68, 'selected companion should remain recognizable at phone width');
    assert.ok(geometry.scrollWidth <= geometry.width);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('room furniture walks end at the matching interaction anchors', async () => {
  const { context, page, apiRequests } = await freshPage();
  const destinations = [
    ['打开记录', 'desk', /#\/record$/, [0.31, 0.44, 0.68, 0.84], /02-idle-left/],
    ['打开任务', 'board', /#\/tasks$/, [0.42, 0.58, 0.68, 0.84], /03-idle-back/],
    ['打开日历', 'calendar', /#\/calendar$/, [0.58, 0.75, 0.68, 0.84], /03-idle-back/],
    ['打开成长', 'workbench', /#\/growth$/, [0.60, 0.73, 0.68, 0.84], /04-idle-right/],
    ['打开状态', 'window', /#\/system$/, [0.31, 0.44, 0.68, 0.84], /03-idle-back/],
  ];
  try {
    await finishOnboarding(page);
    for (const [buttonName, action, route, [minX, maxX, minY, maxY], interactionFrame] of destinations) {
      await page.goto(`${baseUrl}/#/today`);
      await page.getByRole('button', { name: buttonName }).click();
      const character = page.locator(`.room-character.is-action-${action}`);
      await assert.doesNotReject(() => character.waitFor());
      await assert.doesNotReject(() => page.locator(`.room-character.is-action-${action}.is-interacting`).waitFor());
      await page.waitForTimeout(120);
      const position = await character.evaluate((element) => {
        const room = element.closest('.room-scene').getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return {
          x: (box.left + box.width / 2 - room.left) / room.width,
          y: (box.bottom - room.top) / room.height,
        };
      });
      assert.ok(position.x >= minX && position.x <= maxX && position.y >= minY && position.y <= maxY,
        `${action} must align with its furniture, got ${JSON.stringify(position)}`);
      assert.match(await character.evaluate((element) => getComputedStyle(element).backgroundImage), interactionFrame, `${action} must use a clean character-only interaction pose`);
      await page.waitForURL(route);
    }
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('the bed gives a short recovery interaction and returns the companion to the room', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    const character = page.locator('.room-character');
    await page.getByRole('button', { name: '在床边休息' }).click();
    await assert.doesNotReject(() => page.locator('.room-character.is-action-bed.is-walking').waitFor());
    await assert.doesNotReject(() => page.locator('.room-character.is-action-bed.is-interacting').waitFor());
    await assert.doesNotReject(() => page.getByText('歇一会儿。准备好再继续，也算照顾今天。', { exact: true }).waitFor());
    await page.waitForTimeout(120);
    assert.match(await character.evaluate((element) => getComputedStyle(element).backgroundImage), /12-rest/);
    const resting = await character.evaluate((element) => {
      const room = element.closest('.room-scene').getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return { x: (box.left + box.width / 2 - room.left) / room.width, y: (box.bottom - room.top) / room.height };
    });
    assert.ok(resting.x >= .40 && resting.x <= .55 && resting.y >= .78 && resting.y <= .94,
      `rest must stay beside the bed instead of crossing it, got ${JSON.stringify(resting)}`);
    assert.match(page.url(), /#\/today$/);
    await assert.doesNotReject(() => page.locator('.room-character.is-action-bed.is-returning').waitFor());
    await assert.doesNotReject(() => page.locator('.room-character.is-action-bed').waitFor({ state: 'detached' }));
    const after = await character.evaluate((element) => {
      const room = element.closest('.room-scene').getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return { x: (box.left + box.width / 2 - room.left) / room.width, y: (box.bottom - room.top) / room.height };
    });
    assert.ok(after.x >= .46 && after.x <= .54 && after.y >= .78 && after.y <= .9, `rest should return the companion to the room center, got ${JSON.stringify(after)}`);
    assert.match(page.url(), /#\/today$/);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('an active Android WebView handles widget completion without reloading the page', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    const title = `桌面伙伴完成-${Date.now()}`;
    await page.getByRole('button', { name: '安排任务' }).click();
    await page.getByText('调整细节（可选）', { exact: true }).click();
    await page.getByRole('textbox', { name: '我现在想做什么？' }).fill(title);
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('验证桌面伙伴动作不重载当前页面');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一次原生动作回归');
    await page.getByRole('combobox', { name: '任务类型' }).selectOption('main');
    await page.getByRole('button', { name: '安排到今天' }).click();
    const questId = await page.locator('[data-quest-id]').filter({ hasText: title }).getAttribute('data-quest-id');
    assert.ok(questId);

    const marker = `alive-${Date.now()}`;
    await page.evaluate(({ id, value }) => {
      let action = JSON.stringify({ type: 'complete', questId: id });
      window.qiguangWidgetBridge = {
        updateSnapshot() {},
        consumeAction() { const current = action; action = ''; return current; },
      };
      window.__qiguangWidgetPageMarker = value;
      window.dispatchEvent(new Event('qiguang-widget-action'));
    }, { id: questId, value: marker });

    await assert.doesNotReject(() => page.getByText('已从桌面伙伴完成任务；经验已结算，可在任务板撤销。', { exact: true }).waitFor());
    assert.equal(await page.evaluate(() => window.__qiguangWidgetPageMarker), marker, 'widget action reloaded the active page');
    assert.equal(await xpLedgerCount(page), 1);
    assert.match(page.url(), /#\/tasks$/);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('Android users can request the desktop companion from settings once', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.evaluate(() => {
      globalThis.__qiguangPinRequested = 0;
      window.qiguangWidgetBridge = {
        updateSnapshot() {},
        consumeAction() { return ''; },
        canRequestPinWidget() { return true; },
        hasPinnedWidget() { return false; },
        requestPinWidget() { globalThis.__qiguangPinRequested += 1; return true; },
      };
      location.hash = '/system';
    });
    await assert.doesNotReject(() => page.getByRole('heading', { name: '我的系统' }).waitFor());
    await page.getByText('桌面伙伴', { exact: true }).click();
    const add = page.getByRole('button', { name: '添加到桌面' });
    await add.click();
    assert.equal(await page.evaluate(() => globalThis.__qiguangPinRequested), 1);
    await assert.doesNotReject(() => page.getByText('请在系统窗口中确认添加。', { exact: true }).waitFor());
    assert.equal(await add.isDisabled(), true, 'a pin request must not be submitted repeatedly');
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('an exported backup restores records after deleting all local data', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    const marker = `完整恢复验证-${Date.now()}`;
    await page.getByRole('textbox', { name: '发生了什么' }).fill(marker);
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.waitForURL(/#\/day\/\d{4}-\d{2}-\d{2}$/);
    await assert.doesNotReject(() => page.locator('#main-content').getByText(marker, { exact: true }).waitFor());
    await page.goto(`${baseUrl}/?backup-test=${Date.now()}#/system`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '我的系统' }).waitFor());
    await page.getByText('显示偏好', { exact: true }).click();
    await page.getByRole('combobox', { name: '指导方式（只影响措辞）' }).selectOption('direct');

    await page.evaluate(() => {
      const createObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        globalThis.__qiguangBackupText = blob.text();
        return createObjectURL(blob);
      };
      HTMLAnchorElement.prototype.click = function captureBackup() {
        if (this.download && this.href.startsWith('blob:')) {
          globalThis.__qiguangBackupMetadata = {
            connected: this.isConnected,
            filename: this.download,
          };
        }
      };
    });
    await page.getByRole('button', { name: '导出全部数据' }).click();
    await assert.doesNotReject(() => page.getByText('备份文件已生成，请妥善保存。', { exact: true }).waitFor());
    await page.waitForFunction(() => Boolean(globalThis.__qiguangBackupText && globalThis.__qiguangBackupMetadata));
    const backup = await page.evaluate(async () => ({ ...globalThis.__qiguangBackupMetadata, text: await globalThis.__qiguangBackupText }));
    assert.equal(backup.connected, true, 'the browser download link should be attached before activation');
    assert.match(backup.filename, /^qiguang-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(JSON.parse(backup.text).format, 'qiguang-backup');

    await page.getByRole('button', { name: '删除全部数据' }).click();
    const deleteDialog = page.getByRole('dialog', { name: '永久删除全部本地数据' });
    await deleteDialog.getByRole('textbox', { name: '输入“删除全部数据”以确认' }).fill('删除全部数据');
    await deleteDialog.getByRole('button', { name: '永久删除' }).click();
    await assert.doesNotReject(() => page.getByRole('dialog', { name: '选择生活分身' }).waitFor());

    await finishOnboarding(page);
    await page.goto(`${baseUrl}/?restore-test=${Date.now()}#/system`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '我的系统' }).waitFor());
    await page.locator('input[type="file"]').setInputFiles({ name: backup.filename, mimeType: 'application/json', buffer: Buffer.from(backup.text) });
    const importDialog = page.getByRole('dialog', { name: '检查备份' });
    await importDialog.getByRole('checkbox', { name: '我已先导出当前数据，并确认合并导入' }).check();
    await importDialog.getByRole('button', { name: '合并并导入' }).click();
    await page.waitForURL(/#\/today$/);
    await page.goto(`${baseUrl}/#/system`);
    await page.getByText('显示偏好', { exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: '指导方式（只影响措辞）' }).inputValue(), 'gentle');
    await page.goto(`${baseUrl}/#/calendar`);
    await page.getByRole('searchbox', { name: '搜索记录文字' }).fill(marker);
    await page.getByRole('button', { name: '查找' }).click();
    await assert.doesNotReject(() => page.getByText(marker, { exact: true }).waitFor());
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('daily analysis sends only after range confirmation and keeps inference user-confirmed', async () => {
  const { context, page, apiRequests } = await freshPage();
  const firstDay = new Date(2026, 7, 20, 10, 0, 0).getTime();
  await context.addInitScript(({ initial }) => {
    const NativeDate = Date;
    const current = () => Number(localStorage.getItem('qiguang.e2e-now')) || initial;
    class TestDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [current()])); }
      static now() { return current(); }
    }
    window.Date = TestDate;
  }, { initial: firstDay });
  try {
    await finishOnboarding(page);
    await page.getByRole('textbox', { name: '发生了什么' }).fill('下午连续开会，晚上散步以后平静了一些。');
    await page.getByRole('button', { name: '保存记录' }).click();
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
    await assert.doesNotReject(() => page.getByText('已核对事件 · 1', { exact: true }).waitFor());
    assert.equal(await page.getByText('没有明确心情标签', { exact: true }).count(), 0);
    assert.equal(await page.locator('.analysis-event.is-confirmed').isVisible(), false, 'confirmed facts should stay available without dominating the result');
    assert.equal(await page.locator('.daily-reflection-more[open], .analysis-maintenance[open]').count(), 0);
    const compactHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(compactHeight <= 3000, `daily result should keep detail on demand: ${compactHeight}px`);
    const inference = page.locator('.analysis-event').filter({ hasText: '等待用户决定的推断' });
    await assert.doesNotReject(() => inference.getByText('待确认', { exact: true }).waitFor());
    assert.equal(await inference.getByText('已确认', { exact: true }).count(), 0);
    await inference.getByRole('button', { name: '核对这条推断' }).click();
    const decision = page.getByRole('dialog', { name: '决定是否相信这条推断' });
    await assert.doesNotReject(() => decision.getByText('AI 推断 · 确认前不产生影响').waitFor());
    await decision.getByRole('button', { name: '确认并应用候选' }).click();
    await page.getByText('已核对事件 · 2', { exact: true }).click();
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
    await page.evaluate((nextDay) => localStorage.setItem('qiguang.e2e-now', String(nextDay)), firstDay + 86_400_000);
    await page.goto(`${baseUrl}/#/today`);
    const guide = page.locator('.daily-guide');
    await assert.doesNotReject(() => guide.getByRole('heading', { name: '明天安排十分钟低压力过渡。' }).waitFor());
    assert.equal(await page.getByRole('button', { name: '确认或调整这一步' }).count(), 1, '昨日下一步只保留一个可执行入口');
    await guide.getByRole('button', { name: '确认或调整这一步' }).click();
    const questDialog = page.getByRole('dialog', { name: '安排今日任务' });
    assert.equal(await questDialog.getByRole('textbox', { name: '我现在想做什么？' }).inputValue(), '明天安排十分钟低压力过渡。');
    await questDialog.getByRole('button', { name: '安排到今天' }).click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '明天安排十分钟低压力过渡。' }).waitFor());
    assert.equal(apiRequests.length, 1, '确认昨日下一步不应再次调用模型');
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
    await page.getByText('调整细节（可选）', { exact: true }).click();
    await page.getByRole('textbox', { name: '我现在想做什么？' }).fill('反馈闭环行动');
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('验证实际结果始终由用户确认');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一个可核对步骤');
    await page.getByRole('button', { name: '安排到今天' }).click();
    await page.getByText('更多', { exact: true }).click();
    await page.getByRole('button', { name: '调整或顺延任务：反馈闭环行动' }).click();
    const adjustment = page.getByRole('dialog', { name: '调整这项行动' });
    await adjustment.getByRole('button', { name: '缩到 5 分钟' }).click();
    await adjustment.getByRole('textbox', { name: '最小动作' }).fill('只完成一个五分钟版本');
    await adjustment.getByRole('button', { name: '保存调整' }).click();
    await assert.doesNotReject(() => page.getByText(/只完成一个五分钟版本 · 约 5 分钟/).waitFor());
    await page.getByText('更多', { exact: true }).click();
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
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.waitForURL(/#\/day\/\d{4}-\d{2}-\d{2}$/);
    const today = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/review/${today}`);
    await assert.doesNotReject(() => page.locator('.review-companion').getByText('一起看本周证据，方向由你决定。', { exact: true }).waitFor());
    assert.equal(await page.locator('.review-companion .character-state').count(), 0);
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
    await assert.doesNotReject(() => page.getByText('本周还没有跨日重复模式。', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByText('本周还没有领域行动证据。', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByText('下周实验', { exact: true }).waitFor());
    assert.equal(await page.getByText('ONE EXPERIMENT', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: '习惯与成长建议' }).count(), 0);
    const reviewHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(reviewHeight <= 2000, `empty weekly evidence should stay compact: ${reviewHeight}px`);
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
