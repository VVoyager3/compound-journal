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

async function finishOnboarding(page, companion = '鱼鱼') {
  await page.goto(`${baseUrl}/#/today`);
  const dialog = page.getByRole('dialog', { name: '选一个陪伴角色' });
  await dialog.getByRole('button', { name: `选择${companion}` }).click();
  await dialog.getByRole('button', { name: '写下第一件事' }).click();
  await assert.doesNotReject(() => page.getByRole('textbox', { name: '发生了什么' }).waitFor());
  await page.evaluate(() => localStorage.setItem('qiguang.room-guide-seen.v1', '1'));
}

async function openTaskView(page, name) {
  const tab = page.getByRole('tab', { name, exact: true });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  await assert.doesNotReject(() => tab.waitFor());
}

async function openNewGoalEditor(page) {
  await page.locator('.task-goals > .section-heading').getByRole('button', { name: '新建', exact: true }).click();
  return page.getByRole('dialog', { name: '新建目标' });
}

async function scheduleSavedGoalToday(page, goalDialog, goalName) {
  await goalDialog.getByRole('button', { name: '保存目标' }).click();
  await assert.doesNotReject(() => page.getByText('目标计划已保存，没有安排今日任务。', { exact: true }).waitFor());
  const card = page.locator('.goal-row').filter({ hasText: goalName });
  await card.getByRole('button', { name: `查看目标“${goalName}”的阶段` }).click();
  const goalDetail = page.getByRole('dialog', { name: '目标详情' });
  await goalDetail.getByRole('button', { name: `安排“${goalName}”的下一步` }).click();
  const taskDialog = page.getByRole('dialog', { name: '安排目标下一步' });
  await taskDialog.getByRole('button', { name: '安排任务' }).click();
}

async function openNewHabitEditor(page) {
  await page.locator('.task-habits > .section-heading').getByRole('button', { name: '新建', exact: true }).click();
  return page.getByRole('dialog', { name: '新建习惯' });
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
    const dialog = page.getByRole('dialog', { name: '选一个陪伴角色' });
    await assert.doesNotReject(() => dialog.waitFor());
    assert.equal(await page.locator('#main-content').getByRole('button', { name: '开始记录' }).count(), 0, 'today must not duplicate the record destination');
    assert.equal(await page.locator('#main-content').getByRole('button', { name: '开始收束今天' }).count(), 0, 'empty first use must not show an end-of-day action');
    assert.equal(await page.locator('#main-content').getByText('今天留下一件真实事情', { exact: true }).count(), 0, 'the primary record action must not be repeated as a reminder');
    const avatarChoices = dialog.locator('.avatar-choice');
    assert.deepEqual(await avatarChoices.evaluateAll((choices) => choices.map((choice) => ({
      pressed: choice.getAttribute('aria-pressed'),
      selected: choice.classList.contains('is-selected'),
    }))), [
      { pressed: 'false', selected: false },
      { pressed: 'false', selected: false },
    ], 'first-use characters must look unselected until the user chooses one');
    assert.equal(await dialog.evaluate((element) => element.querySelector('h2') === document.activeElement), true, 'initial focus should announce the dialog title without implying a character choice');
    await dialog.getByRole('button', { name: '选择鱼鱼' }).click();
    await assert.doesNotReject(() => dialog.getByText('已选择鱼鱼').waitFor());
    assert.deepEqual(await avatarChoices.evaluateAll((choices) => choices.map((choice) => ({
      pressed: choice.getAttribute('aria-pressed'),
      selected: choice.classList.contains('is-selected'),
    }))), [
      { pressed: 'true', selected: true },
      { pressed: 'false', selected: false },
    ], 'only the chosen character should use the selected state');
    await dialog.getByRole('button', { name: '写下第一件事' }).click();
    await page.waitForURL(/#\/record$/);
    assert.equal(await page.locator('.bottom-nav').count(), 1, 'recording should retain the primary page navigation');
    assert.deepEqual(await page.locator('.record-submit-bar .button').allTextContents(), ['保存记录']);
    assert.equal(await page.getByText('模板', { exact: true }).count(), 0, 'recording should not expose template selection');
    await assert.doesNotReject(() => page.getByText('日常记录：写下你想留住的细节', { exact: true }).waitFor());
    const dateControl = page.locator('.record-date-control');
    await assert.doesNotReject(() => dateControl.waitFor());
    assert.ok((await dateControl.boundingBox())?.height >= 44, 'the direct date control must remain touch-safe');
    const input = page.getByRole('textbox', { name: '发生了什么' });
    const editorLayout = await input.evaluate((element) => ({ height: element.getBoundingClientRect().height, overflowY: getComputedStyle(element).overflowY }));
    assert.ok(editorLayout.height <= 280 && editorLayout.overflowY === 'auto', 'the record body should scroll inside a shorter editor');
    const recordDate = await dateControl.locator('input[type="date"]').inputValue();
    await input.fill('电脑自动回归：记录一件真实发生的事。');
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.waitForURL(new RegExp(`#\\/day\\/${recordDate}$`));
    await assert.doesNotReject(() => page.locator('.journal-sheet').waitFor());
    await assert.doesNotReject(() => page.locator('.day-record-body').getByText('电脑自动回归：记录一件真实发生的事。', { exact: true }).waitFor());

    await page.locator('.day-record-more > summary').click();
    await page.getByRole('button', { name: '编辑' }).click();
    await page.getByRole('textbox', { name: '正文' }).fill('电脑自动回归：修改后的正文。');
    await page.getByRole('button', { name: '保存修改' }).click();
    await assert.doesNotReject(() => page.locator('.day-record-body').getByText('电脑自动回归：修改后的正文。', { exact: true }).waitFor());
    await page.locator('.day-record-more > summary').click();
    await page.getByRole('button', { name: '查看版本' }).click();
    await page.getByRole('button', { name: '撤销最近修改' }).click();
    await assert.doesNotReject(() => page.locator('.day-record-body').getByText('电脑自动回归：记录一件真实发生的事。', { exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/today`);
    const roomSprite = await page.locator('.room-character').getAttribute('style');
    assert.match(roomSprite ?? '', /--motion-atlas:\s*url\([^)]*character-motion-female-runtime/);
    const status = page.locator('.status-summary');
    await assert.doesNotReject(() => status.waitFor());
    assert.equal(await status.locator('.status-item').count(), 5, 'the five current state scores should be visible directly below the room');
    assert.equal(await status.locator('.status-meter, .caption').count(), 0, 'the today state bar should show scores without meters or explanatory labels');
    assert.ok((await page.locator('.home-hero').evaluate((element) => element.getBoundingClientRect().bottom)) <= (await status.evaluate((element) => element.getBoundingClientRect().top)), 'current state scores should follow the room before daily actions');
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
    assert.equal(roomChrome.border, '1px', 'the room should keep the approved thin paper-frame edge');
    assert.equal(roomChrome.overlay, '""');
    assert.match(roomChrome.light, /gradient/, 'the room should share the warm wilderness lighting language without a permanent UI frame');
    const recordHotspot = page.getByRole('button', { name: '打开记录' });
    await recordHotspot.focus();
    const hotspotFocus = await recordHotspot.evaluate((element) => ({
      outlineStyle: getComputedStyle(element).outlineStyle,
      boxShadow: getComputedStyle(element).boxShadow,
    }));
    assert.deepEqual(hotspotFocus, { outlineStyle: 'none', boxShadow: 'none' }, 'scene hotspots should not gain a thick browser frame when focused or tapped');
    assert.equal(await recordHotspot.evaluate((element) => getComputedStyle(element, '::before').opacity), '1', 'focused furniture should receive an in-world interaction ring');
    assert.equal(await page.locator('.character-state.is-present').count(), 0, 'the neutral companion pose should not need a floating text label');
    assert.deepEqual(await page.locator('.bottom-nav .nav-item').allTextContents(), ['今日', '任务', '记录', '成长', '设置']);
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
      'five-item navigation must fill the viewport without an empty column',
    );
    await recordHotspot.click();
    const roomGuide = page.getByRole('dialog', { name: '这个房间可以互动' });
    await assert.doesNotReject(() => roomGuide.waitFor());
    await assert.doesNotReject(() => roomGuide.getByText('点小人看建议；点家具去页面。', { exact: true }).waitFor());
    await roomGuide.getByRole('button', { name: '知道了，继续' }).click();
    await page.waitForURL(/#\/record$/);
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
    await page.goto(`${baseUrl}/#/tasks`);
    const headerActionLines = await page.locator('.page-header-text-action').evaluate((button) => {
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
    assert(promptSizes.length === 3 && promptSizes.every((box) => box.width >= 44 && box.height >= 44), 'record types must remain touch-safe');
    const numberWidths = await page.locator('.record-number-button').evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().width)));
    assert.equal(new Set(numberWidths).size, 1, 'all record numbering controls must share one width');
    await page.goto(`${baseUrl}/#/calendar`);
    await page.getByRole('button', { name: '查找记录' }).click();
    await assert.doesNotReject(() => page.getByText('选择日期', { exact: true }).waitFor());
    const trailWidths = await page.locator('.trail-tab').evaluateAll((tabs) => tabs.map((tab) => Math.round(tab.getBoundingClientRect().width)));
    assert.equal(new Set(trailWidths).size, 1, 'calendar, growth, and weekly review tabs must divide the row equally');
    const safeBottom = await page.locator('#main-content').evaluate((main) => ({
      pagePadding: Number.parseFloat(getComputedStyle(main).paddingBottom),
      navigationHeight: document.querySelector('.bottom-nav')?.getBoundingClientRect().height ?? 0,
    }));
    assert.ok(safeBottom.pagePadding >= safeBottom.navigationHeight + 24, 'scrolling pages must reserve the navigation height plus a 24px breathing zone');
    await page.goto(`${baseUrl}/#/system`);
    const advanced = page.getByText('行动规则', { exact: true });
    assert.ok((await advanced.boundingBox())?.height >= 44);
    await advanced.click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '行动说明书' }).waitFor());
  } finally {
    await context.close();
  }
});

test('all top-level page titles align to the same left edge as Today', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    let todayLeft = -1;
    for (const [route, pageClass] of [
      ['today', 'page-today'], ['calendar', 'page-calendar'], ['growth', 'page-growth'],
      ['system', 'page-system'], ['tasks', 'page-tasks'], ['review', 'page-review'],
    ]) {
      await page.goto(`${baseUrl}/#/${route}`);
      await page.locator(`.${pageClass} > :is(.page-header, .secondary-page-header) h1`).waitFor();
      const actual = await page.locator('#main-content').evaluate((main) => {
        const heading = main.querySelector(':is(.page-header, .secondary-page-header) h1');
        const headingBox = heading?.getBoundingClientRect();
        return headingBox ? Math.round(headingBox.left) : -1;
      });
      if (route === 'today') todayLeft = actual;
      assert.ok(Math.abs(actual - todayLeft) <= 1, `${route} title must share Today's left edge: ${actual}/${todayLeft}`);
    }
  } finally {
    await context.close();
  }
});

test('expanded settings avoid permanent explanatory paragraphs', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/system`);
    const settingsGroups = await page.locator('.settings-overview-group').evaluateAll((groups) => groups.map((group) => ({
      title: group.querySelector(':scope > h2')?.textContent,
      sections: [...group.querySelectorAll(':scope > .settings-overview-row > strong')].map((label) => label.textContent),
    })));
    assert.deepEqual(settingsGroups, [
      { title: '个人', sections: ['人物与陪伴', '状态自评', '显示与语气'] },
      { title: '功能', sections: ['AI 整理', '通知与提醒'] },
      { title: '数据与隐私', sections: ['本地存储', '导入与导出', 'AI 发送范围'] },
      { title: '高级', sections: ['分类与提升方向', '行动规则'] },
    ]);
    await page.getByText('状态自评', { exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '状态自评' });
    assert.equal(await dialog.getByText('不知道怎么打分时，用问卷判断过去 7 天的身体、心理、关系、工作和玩乐状态。', { exact: true }).count(), 0);
    await dialog.getByRole('button', { name: '返回' }).click();
    await page.getByText('AI 整理', { exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'AI 整理' });
    await dialog.getByText('使用安装包提供的服务', { exact: true }).click();
    await dialog.getByText('调整发送范围', { exact: true }).click();
    assert.equal(await dialog.getByText('选择周复盘可以使用的数据。日记原文不在其中。', { exact: true }).count(), 0);
    await dialog.getByRole('button', { name: '返回' }).click();
    await page.getByText('行动规则', { exact: true }).click();
    dialog = page.getByRole('dialog', { name: '行动规则' });
    assert.equal(await dialog.getByText('还没有经过确认的结论。', { exact: true }).count(), 0);
    assert.equal(await dialog.getByText('确认前不会参与建议。', { exact: true }).count(), 0);
    assert.equal(await dialog.getByText('暂时没有待确认内容。', { exact: true }).count(), 0);
    await dialog.getByText('待你核对 · 0', { exact: true }).click();
    await assert.doesNotReject(() => dialog.getByText('确认后生效', { exact: true }).waitFor());
    await dialog.getByRole('button', { name: '返回' }).click();
    await page.getByText('本地存储', { exact: true }).click();
    dialog = page.getByRole('dialog', { name: '本地存储' });
    assert.equal(await dialog.getByText('可从浏览器菜单添加到主屏幕', { exact: true }).count(), 0);
    await dialog.getByRole('button', { name: '返回' }).click();
    await page.getByText('导入与导出', { exact: true }).click();
    dialog = page.getByRole('dialog', { name: '导入与导出' });
    assert.equal(await dialog.getByText('导入不会覆盖现有内容。', { exact: true }).count(), 0);
    await assert.doesNotReject(() => dialog.getByRole('button', { name: '导出全部数据' }).waitFor());
    assert.equal(await dialog.getByRole('button', { name: '删除全部数据' }).count(), 0, 'permanent deletion stays in its own danger row');
    await dialog.getByRole('button', { name: '返回' }).click();
    assert.equal(await page.locator('.settings-overview-row.is-danger').getByText('删除全部数据', { exact: true }).count(), 1);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const expandedLayout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      shortSummaries: [...document.querySelectorAll('.settings-overview-row')]
        .filter((row) => row.getBoundingClientRect().height < 44)
        .map((row) => row.textContent),
    }));
    assert.deepEqual(expandedLayout, { viewport: 320, content: 320, shortSummaries: [] });
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
    await assert.doesNotReject(() => page.waitForURL(/#\/day\//));
    await assert.doesNotReject(() => page.locator('.journal-sheet').waitFor());
    await page.evaluate(() => localStorage.removeItem('qiguang.last-backup-at'));
    await page.goto(`${baseUrl}/#/system`);
    await page.getByText('导入与导出', { exact: true }).click();
    const reminder = page.getByRole('dialog', { name: '导入与导出' }).locator('.gentle-reminder');
    await assert.doesNotReject(() => reminder.waitFor());
    await reminder.getByRole('button', { name: '今天先不用' }).click();
    assert.equal(await page.locator('.gentle-reminder').count(), 0);
  } finally {
    await context.close();
  }
});

test('empty today keeps recording in the bottom navigation', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    assert.equal(await page.locator('.record-reminder').count(), 0);
    assert.equal(await page.getByRole('link', { name: '记录', exact: true }).getAttribute('href'), '#/record');
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
    await assert.doesNotReject(() => page.waitForURL(/#\/day\//));
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    assert.equal(await page.locator('.plan-section-count').count(), 0, 'plan headings should not repeat total counts');
    assert.equal(await page.getByText('管理习惯', { exact: true }).count(), 0, 'habit creation should live in the section heading');
    const habitDialog = await openNewHabitEditor(page);
    await habitDialog.getByRole('searchbox', { name: '习惯名称' }).fill('晚饭后散步');
    await habitDialog.getByRole('button', { name: '建立习惯' }).click();
    const createdHabit = page.locator('.habit-row').filter({ hasText: '晚饭后散步' });
    await createdHabit.getByText('编辑', { exact: true }).click();
    await assert.doesNotReject(() => createdHabit.getByRole('button', { name: '暂停“晚饭后散步”的计划日打卡' }).waitFor());
    await page.goto(`${baseUrl}/#/today`);

    await assert.doesNotReject(() => page.locator('.today-record-preview').getByText(privateBody, { exact: true }).waitFor());
    await assert.doesNotReject(() => page.locator('.today-record-preview').getByRole('button', { name: '查看今天 ›' }).waitFor());
    await assert.doesNotReject(() => page.getByRole('heading', { name: '今天要做的' }).waitFor());
    await assert.doesNotReject(() => page.getByRole('button', { name: '完成：晚饭后散步' }).waitFor());
    assert.equal(await page.getByText(/最小动作：先做一个“晚饭后散步”/).count(), 0);
    assert.equal(await page.getByRole('button', { name: /进入任务板详细管理“晚饭后散步”/ }).count(), 0);
    await page.getByRole('link', { name: '任务', exact: true }).click();
    await page.waitForURL(/#\/tasks$/);
    const habitRow = page.locator('.habit-row').filter({ hasText: '晚饭后散步' });
    await habitRow.getByText('编辑', { exact: true }).click();
    const editHabit = habitRow.getByRole('button', { name: '编辑习惯“晚饭后散步”' });
    await assert.doesNotReject(() => editHabit.waitFor());
    await editHabit.click();
    const editDialog = page.getByRole('dialog', { name: '编辑习惯' });
    await editDialog.getByRole('searchbox', { name: '习惯名称' }).fill('晚饭后散步十五分钟');
    await editDialog.getByRole('searchbox', { name: '最小动作' }).fill('先走三分钟');
    await editDialog.getByRole('combobox', { name: '状态' }).selectOption('paused');
    await editDialog.getByRole('button', { name: '保存习惯' }).click();
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const pausedHabits = page.locator('.paused-habit-management');
    await pausedHabits.locator(':scope > summary').click();
    await assert.doesNotReject(() => pausedHabits.getByText('晚饭后散步十五分钟', { exact: true }).waitFor());
    assert.equal(await page.getByText('晚饭后散步', { exact: true }).count(), 0, 'the plan must not keep the old habit snapshot');
    await pausedHabits.getByRole('button', { name: '编辑习惯“晚饭后散步十五分钟”' }).click();
    const resumeDialog = page.getByRole('dialog', { name: '编辑习惯' });
    await resumeDialog.getByRole('combobox', { name: '状态' }).selectOption('active');
    await resumeDialog.getByRole('checkbox', { name: '按计划日加入今日任务' }).check();
    await resumeDialog.getByRole('button', { name: '保存习惯' }).click();
    await page.goto(`${baseUrl}/#/today`);
    await assert.doesNotReject(() => page.getByRole('button', { name: '完成：晚饭后散步十五分钟' }).waitFor());
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('long task dialogs stay inside a short mobile viewport', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.setViewportSize({ width: 320, height: 480 });
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '安排每日任务' });
    await dialog.getByRole('textbox', { name: '我想做什么？' }).focus();
    const layout = await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        viewportHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
        cssViewportHeight: getComputedStyle(element).getPropertyValue('--dialog-viewport-height').trim(),
        scrollable: element.scrollHeight > element.clientHeight,
      };
    });
    assert.ok(layout.top >= 0 && layout.bottom <= layout.viewportHeight, 'the dialog must remain inside the visible viewport');
    assert.equal(layout.cssViewportHeight, `${layout.viewportHeight}px`, 'the dialog should follow visualViewport height changes');
    assert.equal(layout.scrollable, true, 'long dialog content must scroll instead of hiding under its action bar');
  } finally {
    await context.close();
  }
});

test('Android storage copy describes app data instead of an unsupported browser persistence request', async () => {
  const { context, page } = await freshPage({ native: true });
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/system`);
    await page.getByText('本地存储', { exact: true }).click();
    await assert.doesNotReject(() => page.getByText('记录保存在本机 App 中；请定期导出备份。', { exact: true }).waitFor());
    assert.equal(await page.getByRole('button', { name: '请求持久存储' }).count(), 0);
    assert.equal(await page.getByText(/清除浏览器数据/).count(), 0);
  } finally {
    await context.close();
  }
});

test('a scheduled count task behaves like a TODO with one tap per unit', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    const todayTab = page.getByRole('tab', { name: '今天', exact: true });
    const planTab = page.getByRole('tab', { name: '计划', exact: true });
    assert.equal(await todayTab.getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('heading', { name: '目标', exact: true }).count(), 0, 'planning content stays out of the execution view');
    await openTaskView(page, '计划');
    await assert.doesNotReject(() => page.getByRole('heading', { name: '目标', exact: true }).waitFor());
    assert.equal(await planTab.getAttribute('aria-selected'), 'true');
    for (const tab of [todayTab, planTab]) assert.ok((await tab.boundingBox()).height >= 44, 'task tabs need a comfortable touch target');
    await openTaskView(page, '今天');
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '安排每日任务' });
    const futureDate = await page.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    await dialog.getByRole('textbox', { name: '我想做什么？' }).fill('喝三杯水');
    await dialog.getByRole('textbox', { name: '计划日期' }).fill(futureDate);
    await dialog.getByRole('combobox', { name: '完成方式' }).selectOption('count');
    await dialog.getByRole('spinbutton', { name: '目标次数' }).fill('3');
    await dialog.getByRole('textbox', { name: '计数单位' }).fill('杯');
    await dialog.getByRole('button', { name: '安排任务' }).click();

    const openFuture = async () => {
      await openTaskView(page, '计划');
      await page.getByText('之后已安排 · 1', { exact: true }).waitFor();
      await assert.doesNotReject(() => page.getByRole('heading', { name: '喝三杯水' }).waitFor());
    };
    await openFuture();
    await assert.doesNotReject(() => page.getByText('0/3 杯', { exact: true }).waitFor());
    assert.equal(await page.locator('.page-header').getByRole('button', { name: '管理', exact: true }).count(), 0);
    await page.getByRole('button', { name: '查看任务：喝三杯水' }).click();
    const taskDetails = page.getByRole('dialog', { name: '记录任务结果' });
    await taskDetails.getByText('编辑或删除任务', { exact: true }).click();
    await assert.doesNotReject(() => taskDetails.getByRole('button', { name: '删除任务：喝三杯水' }).waitFor());
    await taskDetails.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '记录一次：喝三杯水' }).click();
    await openFuture();
    await assert.doesNotReject(() => page.getByText('1/3 杯', { exact: true }).waitFor());
    await page.getByRole('button', { name: '记录一次：喝三杯水' }).click();
    await openFuture();
    await assert.doesNotReject(() => page.getByText('2/3 杯', { exact: true }).waitFor());
    await page.getByRole('button', { name: '记录一次：喝三杯水' }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText(/完成记录：喝三杯水。经验 \+10/).waitFor());
    assert.equal(await xpLedgerCount(page), 1);
  } finally {
    await context.close();
  }
});

test('the bottom quick-add keeps task creation in context', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '安排每日任务' });
    await dialog.getByRole('textbox', { name: '我想做什么？' }).fill('已有任务');
    await dialog.getByRole('button', { name: '安排任务' }).click();
    await page.getByRole('heading', { name: '已有任务' }).waitFor();

    assert.equal(await page.getByRole('textbox', { name: '添加今日任务' }).count(), 0, '任务页不再叠加第二条固定输入栏');
    const add = page.getByRole('button', { name: '添加任务', exact: true });
    const addBox = await add.boundingBox();
    assert.ok(addBox && addBox.width >= 44 && addBox.height >= 44, '添加任务入口应保持完整触控区域');
    await add.click();
    const directDialog = page.getByRole('dialog', { name: '安排每日任务' });
    await directDialog.getByRole('textbox', { name: '我想做什么？' }).fill('直接添加');
    await directDialog.getByRole('button', { name: '安排任务' }).click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '直接添加' }).waitFor());
    const directRow = page.locator('.task-list-item').filter({ hasText: '直接添加' });
    const actionBox = await page.getByRole('button', { name: '完成：直接添加' }).boundingBox();
    const circleBox = await directRow.locator('.task-check').boundingBox();
    assert.ok(actionBox && actionBox.width >= 44 && actionBox.height >= 44, 'the whole task row needs a safe touch target');
    assert.ok(circleBox && circleBox.width <= 20 && circleBox.height <= 20, 'the visible incomplete circle should stay compact');
    assert.doesNotMatch(await directRow.innerText(), /临时任务|5 分钟|最低动作/, 'quick tasks must not invent or repeat planning metadata');
    await page.getByRole('button', { name: '完成：直接添加' }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.locator('.task-summary').getByText(/1 已完成/).waitFor());
    const completedRow = page.locator('.task-list-item.is-completed').filter({ hasText: '直接添加' });
    assert.equal(await completedRow.locator('.task-check').textContent(), '✓');
    assert.equal(await completedRow.getByRole('heading', { name: '直接添加' }).evaluate((element) => getComputedStyle(element).textDecorationLine), 'line-through');
    assert.equal(await page.getByRole('dialog').count(), 0, 'quick add should not open another layer');

    await add.click();
    const todayDialog = page.getByRole('dialog', { name: '安排每日任务' });
    await todayDialog.getByRole('textbox', { name: '我想做什么？' }).fill('今日整行完成');
    await todayDialog.getByRole('button', { name: '安排任务' }).click();
    await page.goto(`${baseUrl}/#/today`);
    const todayRow = page.locator('.today-focus-list .task-list-item').filter({ hasText: '今日整行完成' });
    assert.equal(await todayRow.locator('.caption').count(), 0, 'today rows should show the task itself without a task description');
    await todayRow.getByRole('button', { name: '编辑任务：今日整行完成' }).click();
    await assert.doesNotReject(() => page.getByRole('dialog', { name: '修改任务' }).waitFor());
    await page.getByRole('dialog', { name: '修改任务' }).getByRole('button', { name: '取消' }).click();
    await todayRow.getByRole('button', { name: '完成：今日整行完成' }).click();
    await assert.doesNotReject(() => todayRow.waitFor({ state: 'detached' }));
    assert.equal(await page.getByRole('dialog').count(), 0, 'today task rows should complete without opening a result form');
  } finally {
    await context.close();
  }
});

test('a count task keeps its title readable in the flat list', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '安排每日任务' });
    await dialog.getByRole('textbox', { name: '我想做什么？' }).fill('读三页书');
    await dialog.getByRole('combobox', { name: '完成方式' }).selectOption('count');
    await dialog.getByRole('spinbutton', { name: '目标次数' }).fill('3');
    await dialog.getByRole('textbox', { name: '计数单位' }).fill('页');
    await dialog.getByRole('button', { name: '安排任务' }).click();
    const row = page.locator('.task-list-item.has-count').filter({ hasText: '读三页书' });
    const titleBox = await row.getByRole('heading', { name: '读三页书' }).boundingBox();
    assert.ok(titleBox && titleBox.width > 100, 'count-task titles must not collapse into the completion-control column');
    await assert.doesNotReject(() => row.getByText('0/3 页', { exact: true }).waitFor());
    assert.equal(await row.getByRole('button', { name: /记录一次：读三页书/ }).count(), 1, 'the task row itself is the check-in action');
    assert.equal(await row.getByRole('button', { name: '+1' }).count(), 0);
    await row.getByRole('button', { name: /记录一次：读三页书/ }).click();
    const progressed = page.locator('.task-list-item.has-count').filter({ hasText: '读三页书' });
    await progressed.getByText('1/3 页', { exact: true }).waitFor();
    assert.equal(await progressed.evaluate((element) => element.style.getPropertyValue('--task-progress')), '33%');
  } finally {
    await context.close();
  }
});

test('a user can edit and delete a pending task from the task board', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    const create = page.getByRole('dialog', { name: '安排每日任务' });
    await create.getByRole('textbox', { name: '我想做什么？' }).fill('整理桌面十分钟');
    await create.getByRole('button', { name: '安排任务' }).click();

    let card = page.locator('.task-list-item').filter({ hasText: '整理桌面十分钟' });
    assert.equal(await card.getByRole('button', { name: '有进展：整理桌面十分钟' }).count(), 0, 'secondary results belong in task details');
    assert.equal(await card.getByRole('button', { name: '跳过今天：整理桌面十分钟' }).count(), 0, 'skip should not crowd the list row');
    await card.getByRole('button', { name: '查看任务：整理桌面十分钟' }).click();
    const taskDetails = page.getByRole('dialog', { name: '记录任务结果' });
    await taskDetails.getByText('编辑或删除任务', { exact: true }).click();
    await taskDetails.getByRole('button', { name: '编辑任务：整理桌面十分钟' }).click();
    const edit = page.getByRole('dialog', { name: '修改任务' });
    await edit.getByRole('textbox', { name: '任务名称' }).fill('整理书桌五分钟');
    await edit.getByRole('button', { name: '保存调整' }).click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '整理书桌五分钟' }).waitFor());

    card = page.locator('.task-list-item').filter({ hasText: '整理书桌五分钟' });
    await card.getByRole('button', { name: '查看任务：整理书桌五分钟' }).click();
    const details = page.getByRole('dialog', { name: '记录任务结果' });
    await details.getByText('编辑或删除任务', { exact: true }).click();
    await details.getByRole('button', { name: '删除任务：整理书桌五分钟' }).click();
    await page.getByRole('dialog', { name: '删除这一项？' }).getByRole('button', { name: '删除', exact: true }).click();
    await assert.doesNotReject(() => page.getByText('已删除；历史记录保留。', { exact: true }).waitFor());
    assert.equal(await page.getByRole('heading', { name: '整理书桌五分钟' }).count(), 0);
  } finally {
    await context.close();
  }
});

test('task cards and settings sections do not retain a thick blue focus frame', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '安排每日任务' });
    await dialog.getByRole('textbox', { name: '我想做什么？' }).fill('检查点击焦点');
    await dialog.getByRole('button', { name: '安排任务' }).click();
    const taskCard = page.locator('.task-list-item').filter({ hasText: '检查点击焦点' });
    await taskCard.focus();
    const taskFocus = await taskCard.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
    });

    await page.goto(`${baseUrl}/#/system`);
    const settingsSummary = page.locator('.settings-overview-row').filter({ hasText: '状态自评' });
    await settingsSummary.focus();
    const settingsFocus = await settingsSummary.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
        textDecorationLine: style.textDecorationLine,
        tapHighlightColor: style.webkitTapHighlightColor,
      };
    });

    assert.equal(taskFocus.outlineStyle, 'none', 'a task card must not use the browser blue frame');
    assert.match(taskFocus.boxShadow, /inset/, 'a task row still needs a restrained non-blue focus marker');
    assert.deepEqual(settingsFocus, {
      outlineStyle: 'none',
      boxShadow: 'none',
      textDecorationLine: 'none',
      tapHighlightColor: 'rgba(0, 0, 0, 0)',
    }, 'settings rows should avoid the browser blue focus shadow and touch highlight');
  } finally {
    await context.close();
  }
});

test('task, goal, and habit deletion lives on each specific item', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);

    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    const taskDialog = page.getByRole('dialog', { name: '安排每日任务' });
    await taskDialog.getByRole('textbox', { name: '我想做什么？' }).fill('整理今日清单');
    await taskDialog.getByRole('button', { name: '安排任务' }).click();

    await openTaskView(page, '计划');
    const goalDialog = await openNewGoalEditor(page);
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('完成数学错题复习计划');
    await assert.doesNotReject(() => goalDialog.getByText('建议：生活分类：学习 · 想提升：学习能力', { exact: true }).waitFor());
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('完成阅读计划');
    await goalDialog.getByRole('button', { name: '保存目标' }).click();

    const habitDialog = await openNewHabitEditor(page);
    await habitDialog.getByRole('searchbox', { name: '习惯名称' }).fill('每天伸展');
    await habitDialog.getByRole('button', { name: '建立习惯' }).click();

    assert.equal(await page.locator('.page-header').getByRole('button', { name: '管理', exact: true }).count(), 0);
    let item = page.locator('.goal-row').filter({ hasText: '完成阅读计划' });
    await item.getByText('编辑', { exact: true }).click();
    await item.getByRole('button', { name: '删除目标：完成阅读计划' }).click();
    await page.getByRole('dialog', { name: '删除这一项？' }).getByRole('button', { name: '删除', exact: true }).click();
    await item.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.goal-row').filter({ hasText: '完成阅读计划' }).count(), 0);

    item = page.locator('.habit-row').filter({ hasText: '每天伸展' });
    await item.getByText('编辑', { exact: true }).click();
    await item.getByRole('button', { name: '删除习惯：每天伸展' }).click();
    await page.getByRole('dialog', { name: '删除这一项？' }).getByRole('button', { name: '删除', exact: true }).click();
    await item.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.habit-row').filter({ hasText: '每天伸展' }).count(), 0);

    await openTaskView(page, '今天');
    item = page.locator('.task-list-item').filter({ hasText: '整理今日清单' });
    await item.getByRole('button', { name: '查看任务：整理今日清单' }).click();
    const taskDetails = page.getByRole('dialog', { name: '记录任务结果' });
    await taskDetails.getByText('编辑或删除任务', { exact: true }).click();
    await taskDetails.getByRole('button', { name: '删除任务：整理今日清单' }).click();
    await page.getByRole('dialog', { name: '删除这一项？' }).getByRole('button', { name: '删除', exact: true }).click();
    await item.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.task-list-item').filter({ hasText: '整理今日清单' }).count(), 0);
  } finally {
    await context.close();
  }
});

test('capacity-retired tasks support deletion on each specific card', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    const titles = ['单独删除的保留行动', '批量删除的保留行动一', '批量删除的保留行动二'];
    await page.evaluate(async (candidateTitles) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('qiguang');
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      const transaction = database.transaction('quests', 'readwrite');
      const store = transaction.objectStore('quests');
      const timestamp = new Date().toISOString();
      for (const title of candidateTitles) {
        const id = crypto.randomUUID();
        store.add({
          id, localDate: '2026-08-20', type: 'side', sourceType: 'manual', actionId: `manual:${id}`, settlementVersion: 0,
          title, reason: '原定日期的位置已满', minimumAction: '先做五分钟', estimatedMinutes: 5, difficulty: 'light',
          status: 'exempt', systemRetiredAt: timestamp, systemRetiredReason: 'capacity', aiSuggested: false, userModified: false,
          createdAt: timestamp, updatedAt: timestamp, version: 1,
        });
      }
      await new Promise((resolve, reject) => {
        transaction.addEventListener('complete', resolve, { once: true });
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
      });
      database.close();
    }, titles);

    await page.goto(`${baseUrl}/#/tasks`);
    assert.equal(await page.locator('.page-header').getByRole('button', { name: '管理', exact: true }).count(), 0);
    for (const title of titles) {
      const card = page.locator('.quest-card').filter({ hasText: title });
      await card.getByRole('button', { name: `删除任务：${title}` }).click();
      await page.getByRole('dialog', { name: '删除这一项？' }).getByRole('button', { name: '删除', exact: true }).click();
      await card.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.quest-card').filter({ hasText: title }).count(), 0);
    }

    await page.reload();
    for (const title of titles) assert.equal(await page.getByText(title, { exact: true }).count(), 0);
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
    const arrangeTask = page.getByRole('button', { name: '添加任务', exact: true });
    await assert.doesNotReject(() => arrangeTask.waitFor());
    assert.equal(await arrangeTask.count(), 1);
    assert.equal(await page.getByRole('button', { name: '安排一个最小行动' }).count(), 0);

    await page.goto(`${baseUrl}/#/growth`);
    assert.equal(await page.getByText('打开周复盘', { exact: true }).count(), 0, 'growth must not repeat the weekly-review tab as an in-page action');
    assert.equal(await page.locator('.branch-card').count(), 0);
    await assert.doesNotReject(() => page.locator('.growth-maintenance > summary').waitFor());
    assert.equal(await page.getByText('暂未开始的方向 · 6', { exact: true }).isVisible(), false, 'unused directions should stay behind the management disclosure');
    const growthLayout = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth }));
    assert.ok(growthLayout.height <= 1200, `empty growth page is too long: ${growthLayout.height}px`);
    assert.ok(growthLayout.width <= 390, `empty growth page overflows: ${growthLayout.width}px`);

    await page.goto(`${baseUrl}/#/review`);
    assert.equal(await page.locator('.review-companion').count(), 0, 'weekly review should start with evidence instead of an explanatory companion card');
    assert.equal(await page.getByText('WEEKLY REVIEW', { exact: true }).count(), 0);

    await page.goto(`${baseUrl}/#/calendar`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '本月变化' }).waitFor());
    assert.equal(await page.getByText('记录不足', { exact: true }).isVisible(), false, 'empty category details should stay collapsed');
    assert.equal(await page.locator('.monthly-area-row').count(), 0);

    await page.goto(`${baseUrl}/#/system`);
    assert.equal(await page.getByText('本地优先', { exact: true }).count(), 0);
    assert.equal(await page.locator('.system-overview').count(), 0, 'settings must start with direct choices instead of an internal-model dashboard');
    assert.equal(await page.locator('.system-advanced[open]').count(), 0, 'internal area controls must stay collapsed by default');
    assert.equal(await page.locator('.assessment-start-actions:visible').count(), 0);
    await assert.doesNotReject(() => page.getByText('状态自评', { exact: true }).waitFor());
    const systemHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(systemHeight <= 1800, `collapsed system page is too long: ${systemHeight}px`);
    await page.getByText('状态自评', { exact: true }).click();
    await assert.doesNotReject(() => page.getByRole('button', { name: '30 题快速评估' }).waitFor());
    await assert.doesNotReject(() => page.getByRole('button', { name: '60 题完整评估' }).waitFor());
    await page.getByRole('dialog', { name: '状态自评' }).getByRole('button', { name: '返回' }).click();

    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/day/${today}`);
    await assert.doesNotReject(() => page.locator('.status-summary').waitFor());
    assert.equal(await page.locator('.status-summary .status-item').count(), 5);
    assert.equal(await page.getByRole('heading', { name: '今天的成功证据' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '再写一篇', exact: true }).count(), 1);
    const dayHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(dayHeight <= 1200, `empty day page is too long: ${dayHeight}px`);
  } finally {
    await context.close();
  }
});

test('weekly review scope defaults to all and persists one settings change', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/system`);
    await page.locator('.settings-overview-row').filter({ hasText: 'AI 发送范围' }).click();
    const ai = page.getByRole('dialog', { name: 'AI 发送范围' }).locator('.ai-settings');
    await ai.getByText('使用安装包提供的服务', { exact: true }).click();
    const scope = ai.locator('.weekly-scope-settings');
    await scope.locator(':scope > summary').click();
    assert.equal(await scope.locator('input[type="checkbox"]:checked').count(), 8, 'weekly review should send all supported summaries by default');
    await scope.getByRole('checkbox', { name: '习惯坚持' }).uncheck();
    await assert.doesNotReject(() => page.getByText('周复盘默认包含的信息已保存。', { exact: true }).waitFor());

    await page.reload();
    await page.locator('.settings-overview-row').filter({ hasText: 'AI 发送范围' }).click();
    const reloadedAi = page.getByRole('dialog', { name: 'AI 发送范围' }).locator('.ai-settings');
    await reloadedAi.getByText('使用安装包提供的服务', { exact: true }).click();
    const reloadedScope = reloadedAi.locator('.weekly-scope-settings');
    await reloadedScope.locator(':scope > summary').click();
    assert.equal(await reloadedScope.getByRole('checkbox', { name: '习惯坚持' }).isChecked(), false);
    assert.equal(await reloadedScope.locator('input[type="checkbox"]:checked').count(), 7);
  } finally {
    await context.close();
  }
});

test('success diary prompts stay optional and AI goal decomposition requires confirmation', async () => {
  const { context, page, apiRequests } = await freshPage({ now: new Date().setHours(20, 0, 0, 0) });
  try {
    await finishOnboarding(page);
    const input = page.getByRole('textbox', { name: '发生了什么' });
    const today = await page.locator('.record-date-control input[type="date"]').inputValue();
    await page.getByRole('button', { name: '成功记录' }).click();
    assert.equal(await input.inputValue(), '', 'a success prompt must not become journal body');
    assert.match(await input.getAttribute('placeholder') ?? '', /今天做成、推进、坚持或照顾好了什么/);
    assert.equal(await page.getByRole('checkbox', { name: '记为成功记录' }).count(), 0);
    await assert.doesNotReject(() => page.getByRole('button', { name: '成功记录', pressed: true }).waitFor());
    await input.fill('完成并核对了一次本地回归');
    await page.getByRole('button', { name: '保存记录' }).click();
    await assert.doesNotReject(() => page.waitForURL(new RegExp(`#\\/day\\/${today}$`)));
    await page.locator('.day-evidence-details > summary').click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '今天的整理' }).waitFor());
    await assert.doesNotReject(() => page.locator('.success-evidence').getByText('完成并核对了一次本地回归', { exact: true }).waitFor());
    assert.deepEqual(apiRequests, []);

    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const goalDialog = await openNewGoalEditor(page);
    assert.equal(await goalDialog.getByText('先写一句话就够了。系统会先给出下一步，所有内容都可以再修改。', { exact: true }).count(), 0);
    assert.equal(await goalDialog.getByText('需要帮你把目标变小吗？', { exact: true }).count(), 0);
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('发布一篇文章');
    await goalDialog.getByRole('button', { name: '生成可编辑草案' }).click();
    const preview = page.getByRole('dialog', { name: '检查目标拆解发送范围' });
    await assert.doesNotReject(() => preview.getByText(/AI 只返回建议/).waitFor());
    assert.deepEqual(apiRequests, []);
    await preview.getByRole('button', { name: '确认范围并生成草案' }).click();
    const consent = page.getByRole('dialog', { name: '允许这一次目标拆解？' });
    await consent.getByRole('button', { name: '允许并继续' }).click();
    await assert.doesNotReject(() => goalDialog.getByRole('heading', { name: '可编辑的拆解草案' }).waitFor());
    await assert.doesNotReject(() => goalDialog.getByText('当前阶段：目标已经明确，尚未形成第一份可检查成果。', { exact: true }).waitFor());
    await assert.doesNotReject(() => goalDialog.getByText(/关键风险：一次把范围铺得过大/).waitFor());
    await assert.doesNotReject(() => goalDialog.getByText('当前下一步：写下第一版结构', { exact: true }).waitFor());
    assert.equal(await goalDialog.getByRole('textbox', { name: '目标名称' }).inputValue(), '发布一篇文章', 'AI 拆解不能改写用户原话');
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('发布一本文章');
    assert.equal(await goalDialog.getByRole('heading', { name: '可编辑的拆解草案' }).isVisible(), false);
    await assert.doesNotReject(() => goalDialog.getByText('目标内容已经改变；请重新生成拆解草案。').waitFor());
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('发布一篇文章');
    await goalDialog.getByRole('button', { name: '生成可编辑草案' }).click();
    const secondPreview = page.getByRole('dialog', { name: '检查目标拆解发送范围' });
    await secondPreview.getByRole('button', { name: '确认范围并生成草案' }).click();
    await assert.doesNotReject(() => goalDialog.getByRole('heading', { name: '可编辑的拆解草案' }).waitFor());
    await scheduleSavedGoalToday(page, goalDialog, '发布一篇文章');
    await assert.doesNotReject(() => page.getByRole('heading', { name: '发布一篇文章' }).waitFor());
    const savedGoal = page.locator('.goal-row').filter({ hasText: '发布一篇文章' });
    await savedGoal.getByRole('button', { name: '查看目标“发布一篇文章”的阶段' }).click();
    const savedGoalDetail = page.getByRole('dialog', { name: '目标详情' });
    await assert.doesNotReject(() => savedGoalDetail.getByText('完成第一段可检查成果', { exact: true }).waitFor());
    const nextStepLayout = await savedGoalDetail.locator('.goal-detail-next').evaluate((row) => {
      const items = [...row.children].map((item) => item.getBoundingClientRect());
      return {
        oneRow: items.every((item) => item.bottom > items[0].top && item.top < items[0].bottom),
        hiddenDecoration: getComputedStyle(row.parentElement.querySelector('.entity-detail-icon')).display === 'none',
      };
    });
    assert.deepEqual(nextStepLayout, { oneRow: true, hiddenDecoration: true });
    await savedGoalDetail.getByRole('button', { name: '返回' }).click();
    await assert.doesNotReject(() => savedGoal.getByText('编辑', { exact: true }).waitFor());
    await openTaskView(page, '今天');
    await assert.doesNotReject(() => page.getByRole('heading', { name: '写下第一版结构' }).waitFor());
    await assert.doesNotReject(() => page.locator('.task-summary').getByText(/1 待完成/).waitFor());
    assert.equal(await page.getByText(/\d\/1 MAIN/).count(), 0);
    await openTaskView(page, '计划');
    assert.equal(await page.getByRole('button', { name: '安排“发布一篇文章”的下一步' }).count(), 0);
    assert.equal(apiRequests.length, 2);
    const request = JSON.parse(apiRequests.at(-1).body);
    assert.equal(request.operation, 'goal_decomposition');
    assert.deepEqual(Object.keys(request.userInput).sort(), ['completionEvidence', 'result', 'why']);
    assert.equal('entries' in request.context, false);

    await openTaskView(page, '今天');
    await page.getByRole('button', { name: '完成：写下第一版结构' }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText(/已完成；下一步“推进：完成第一段可检查成果”已加入今天。/).waitFor());
    assert.equal(await page.getByText('已完成 · +50 经验', { exact: true }).count(), 0);
    assert.equal(await page.getByText('待完成', { exact: true }).count(), 2);
    assert.equal(await xpLedgerCount(page), 1, 'the initial action settles only its own light-task XP');
    await openTaskView(page, '计划');
    await page.locator('.goal-row').filter({ hasText: '发布一篇文章' }).getByText('编辑', { exact: true }).click();
    await page.getByRole('button', { name: '根据进展重新规划“发布一篇文章”' }).click();
    const replanPreview = page.getByRole('dialog', { name: '检查目标拆解发送范围' });
    await assert.doesNotReject(() => replanPreview.getByRole('checkbox', { name: /执行记录 · completed/ }).waitFor());
    await replanPreview.getByRole('button', { name: '确认范围并生成草案' }).click();
    const replan = page.getByRole('dialog', { name: '确认新的目标路径' });
    await assert.doesNotReject(() => replan.getByRole('textbox', { name: '新的下一步' }).waitFor());
    assert.equal(await replan.getByRole('textbox', { name: '新的下一步' }).inputValue(), '把原行动缩小一半');
    await replan.getByRole('button', { name: '确认并替换旧路径' }).click();
    await assert.doesNotReject(() => page.getByText('新路径已确认，旧路径保留为历史。', { exact: true }).waitFor());
    await openTaskView(page, '计划');
    assert.equal(await page.getByText('已被新计划替换', { exact: true }).count(), 2);
    assert.equal(await page.getByText('待完成', { exact: true }).count(), 2);
    const replanRequest = JSON.parse(apiRequests.at(-1).body);
    assert.equal(replanRequest.context.executionEvidence.length, 1);
    assert.deepEqual(replanRequest.permissions.questIds, [replanRequest.context.executionEvidence[0].questId]);
    await openTaskView(page, '今天');
    await page.getByRole('button', { name: '完成：把原行动缩小一半' }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText(/已完成；下一步“推进：完成缩小后的可检查成果”已加入今天。/).waitFor());
    assert.equal(await page.getByText('已完成 · +50 经验', { exact: true }).count(), 0);
    await openTaskView(page, '计划');
    assert.equal(await page.getByText('待完成', { exact: true }).count(), 2, 'replanned next step must not settle its first milestone');
    assert.equal(await xpLedgerCount(page), 2);
    await page.goto(`${baseUrl}/#/calendar`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '本月变化' }).waitFor());
    const monthlyDetails = page.locator('.monthly-area-details');
    assert.equal(await monthlyDetails.getByText(/· 变好 · 完成 2 项/).isVisible(), false, 'monthly category changes stay collapsed until requested');
    await monthlyDetails.locator(':scope > summary').click();
    await assert.doesNotReject(() => monthlyDetails.getByText(/· 变好 · 完成 2 项/).waitFor());

    await page.goto(`${baseUrl}/#/today`);
    assert.equal(await page.getByRole('button', { name: '开始收束今天' }).count(), 0, 'today no longer exposes a separate daily-closeout entry');
  } finally {
    await context.close();
  }
});

test('calendar opens an in-place day snapshot before the full review', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    const date = await page.locator('.record-date-control input[type="date"]').inputValue();
    await page.getByRole('textbox', { name: '今日一句' }).fill('今天留下了一条可以回看的证据。');
    await page.getByRole('textbox', { name: '发生了什么' }).fill('日历快照里的真实记录');
    await page.getByRole('button', { name: '保存记录' }).click();
    await assert.doesNotReject(() => page.waitForURL(new RegExp(`#\\/day\\/${date}$`)));
    await page.goto(`${baseUrl}/#/calendar`);
    const calendarUrl = page.url();
    const todayCell = page.locator('.calendar-day[aria-current="date"]');
    const calendarLayout = await todayCell.evaluate((cell) => {
      const style = getComputedStyle(cell);
      const gridStyle = getComputedStyle(cell.parentElement);
      return { borderRadius: style.borderRadius, borderWidth: style.borderTopWidth, rowGap: gridStyle.rowGap, marginBottom: gridStyle.marginBottom };
    });
    assert.deepEqual(calendarLayout, { borderRadius: '2px', borderWidth: '2px', rowGap: '6px', marginBottom: '12px' });
    await todayCell.click();
    const preview = page.locator('.calendar-day-preview');
    await assert.doesNotReject(() => preview.getByText('日历快照里的真实记录', { exact: true }).waitFor());
    assert.equal(page.url(), calendarUrl, 'opening a date must keep the calendar route and scroll context');
    await preview.getByRole('button', { name: '打开回顾 ›' }).click();
    await page.waitForURL(new RegExp(`#\\/day\\/${date}$`));
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('five-year diary history links the same date across years and supports numbered writing', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    const today = await page.locator('.record-date-control input[type="date"]').inputValue();
    const previous = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

    await page.goto(`${baseUrl}/#/record/${previous}`);
    await page.getByRole('textbox', { name: '今日一句' }).fill('去年今天开始认真记录。');
    await page.getByRole('textbox', { name: '发生了什么' }).fill('给未来留下一页。');
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.waitForURL(new RegExp(`#\\/day\\/${previous}$`));

    await page.goto(`${baseUrl}/#/record/${today}`);
    await page.getByRole('textbox', { name: '今日一句' }).fill('今年今天仍在继续。');
    await page.getByRole('button', { name: '插入圆圈序号' }).click();
    const body = page.getByRole('textbox', { name: '发生了什么' });
    assert.equal(await body.inputValue(), '① ');
    await body.fill('① 完成了记录页的整理。');
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.waitForURL(new RegExp(`#\\/day\\/${today}$`));

    await assert.doesNotReject(() => page.locator('.day-record-row').getByText('① 完成了记录页的整理。', { exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/record/${today}`);
    await page.getByRole('button', { name: '历年今天' }).click();
    const history = page.getByRole('dialog', { name: new RegExp(`${Number(today.slice(5, 7))} 月 ${Number(today.slice(8))} 日`) });
    await assert.doesNotReject(() => history.getByText('去年今天开始认真记录。', { exact: true }).waitFor());
    await history.getByRole('button', { name: new RegExp(`^${previous.slice(0, 4)} 年`) }).click();
    await page.waitForURL(new RegExp(`#\\/day\\/${previous}$`));
  } finally {
    await context.close();
  }
});

test('AI can draft the day caption while the user keeps final edit control', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.getByRole('textbox', { name: '发生了什么' }).fill('今天完成了一个需要耐心的小步骤。');
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.waitForURL(/#\/day\//);
    await page.goto(`${baseUrl}/#/calendar`);
    await page.locator('.calendar-day[aria-current="date"]').click();
    await page.locator('.calendar-day-preview').getByRole('button', { name: '编辑当日一句' }).click();
    const captionDialog = page.getByRole('dialog', { name: '编辑当日一句' });
    await captionDialog.getByRole('button', { name: '让 AI 概括' }).click();
    const preview = page.getByRole('dialog', { name: '检查本次发送范围' });
    await preview.getByRole('checkbox', { name: /我允许将本次选中的内容发送/ }).check();
    await preview.getByRole('button', { name: '确认并整理' }).click();

    const caption = captionDialog.getByRole('textbox', { name: '当日一句话' });
    await assert.doesNotReject(() => captionDialog.getByText('已填入 AI 概括，修改后再保存。', { exact: true }).waitFor());
    assert.equal(await caption.inputValue(), '今天完成了一个需要耐心的小步骤。');
    await caption.fill('今天耐心完成了一个小步骤。');
    await captionDialog.getByRole('button', { name: '保存一句话' }).click();
    await assert.doesNotReject(() => captionDialog.getByText('当日一句话已保存。', { exact: true }).waitFor());
    assert.equal(apiRequests.length, 1);
  } finally {
    await context.close();
  }
});

test('record category buttons create multiple entries and remain editable', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    const date = await page.locator('.record-date-control input[type="date"]').inputValue();
    assert.equal(await page.getByRole('checkbox', { name: '记为成功记录' }).count(), 0);
    await assert.doesNotReject(() => page.getByRole('button', { name: '日常记录', pressed: true }).waitFor());

    const addEntry = async (kind, body) => {
      await page.getByRole('button', { name: kind }).click();
      await page.getByRole('textbox', { name: '发生了什么' }).fill(body);
      await page.getByRole('button', { name: '保存记录' }).click();
      await page.waitForURL(new RegExp(`#\\/day\\/${date}$`));
    };
    await addEntry('日常记录', '先保存一条普通记录');
    await page.goto(`${baseUrl}/#/record/${date}`);
    await addEntry('成功记录', '我把失败的构建修复了');

    const quotedPrompt = '普通日记偶然引用：今天做成或推进了什么？哪怕很小：';
    await page.goto(`${baseUrl}/#/record/${date}`);
    await addEntry('日常记录', quotedPrompt);

    const entries = page.locator('.day-record-row');
    await assert.doesNotReject(() => entries.filter({ hasText: '先保存一条普通记录' }).waitFor());
    assert.equal(await entries.count(), 3, 'one day must accept more than one record');
    const successes = page.locator('.success-evidence');
    assert.equal(await successes.getByText('先保存一条普通记录', { exact: true }).count(), 0);
    await assert.doesNotReject(() => successes.getByText('我把失败的构建修复了', { exact: true }).waitFor({ state: 'attached' }));
    assert.equal(await successes.getByText(quotedPrompt, { exact: true }).count(), 0, 'wording alone must not promote a journal into success evidence');

    let successEntry = entries.filter({ hasText: '我把失败的构建修复了' });
    await successEntry.locator('.day-record-more > summary').click();
    await successEntry.getByRole('button', { name: '编辑' }).click();
    const edit = page.getByRole('dialog', { name: '修改记录' });
    assert.equal(await edit.getByRole('checkbox', { name: '记为成功记录' }).count(), 0);
    await edit.getByRole('button', { name: '日常记录' }).click();
    await edit.getByRole('button', { name: '保存修改' }).click();
    await assert.doesNotReject(() => page.getByText('修改已保存，可撤销一次。', { exact: true }).waitFor());
    const formerSuccess = page.locator('.success-evidence').getByText('我把失败的构建修复了', { exact: true });
    await formerSuccess.waitFor({ state: 'detached' });
    assert.equal(await formerSuccess.count(), 0);

    successEntry = page.locator('.day-record-row').filter({ hasText: '我把失败的构建修复了' });
    await successEntry.locator('.day-record-more > summary').click();
    await successEntry.getByRole('button', { name: '查看版本' }).click();
    await page.getByRole('button', { name: '撤销最近修改' }).click();
    await assert.doesNotReject(() => page.locator('.success-evidence').getByText('我把失败的构建修复了', { exact: true }).waitFor({ state: 'attached' }));
  } finally {
    await context.close();
  }
});

test('manual milestone badges explain their source, stay reversible, and survive goal status changes', async () => {
  const { context, page } = await offlineShellPage();
  const goalName = '整理一次可核对成果';
  const badgeName = '发布一份可核对小成果';
  const evidence = '一份可以打开检查的成品';
  const milestones = [
    ['整理第一份成果', '一份已经归档的初版成果'],
    ['完成一次真实校对', '一份带有修订痕迹的成果'],
    ['邀请一次外部检查', '一条可以核对的外部反馈'],
    [badgeName, evidence],
  ];
  const badgeButton = () => page.getByRole('button', { name: `查看徽章详情：${badgeName}` });
  const editGoalStatus = async (status) => {
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const card = page.locator('.goal-row').filter({ hasText: goalName });
    await card.getByText('编辑', { exact: true }).click();
    await card.getByRole('button', { name: `编辑目标“${goalName}”` }).click();
    const dialog = page.getByRole('dialog', { name: '编辑目标' });
    await dialog.getByRole('combobox', { name: '目标状态' }).selectOption(status);
    await dialog.getByRole('button', { name: '保存目标' }).click();
    await assert.doesNotReject(() => page.getByText('目标已更新。', { exact: true }).waitFor());
  };
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const goalDialog = await openNewGoalEditor(page);
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill(goalName);
    await scheduleSavedGoalToday(page, goalDialog, goalName);

    await openTaskView(page, '今天');
    await page.getByRole('button', { name: '完成：确定一个可以开始的下一步' }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByRole('button', { name: '完成：确定一个可以开始的下一步' }).waitFor({ state: 'detached' }));

    await openTaskView(page, '计划');
    let goalCard = page.locator('.goal-row').filter({ hasText: goalName });
    await goalCard.getByText('编辑', { exact: true }).click();
    await goalCard.getByRole('button', { name: `编辑目标“${goalName}”` }).click();
    const goalSettings = page.getByRole('dialog', { name: '编辑目标' });
    assert.equal(await goalSettings.getByRole('textbox', { name: '目标名称' }).inputValue(), goalName);
    await goalSettings.getByRole('combobox', { name: '想提升什么' }).selectOption({ label: '学习能力' });
    await goalSettings.getByRole('button', { name: '保存目标' }).click();

    for (const [name, proof] of milestones) {
      goalCard = page.locator('.goal-row').filter({ hasText: goalName });
      await goalCard.getByText('编辑', { exact: true }).click();
      await goalCard.getByRole('button', { name: `为“${goalName}”添加阶段目标` }).click();
      const milestoneDialog = page.getByRole('dialog', { name: '添加阶段目标' });
      await milestoneDialog.getByRole('textbox', { name: '阶段目标', exact: true }).fill(name);
      await milestoneDialog.getByRole('textbox', { name: '怎样算完成', exact: true }).fill(proof);
      await milestoneDialog.getByRole('button', { name: '添加', exact: true }).click();
    }

    await page.goto(`${baseUrl}/#/growth`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '成果徽章' }).waitFor());
    assert.equal(await badgeButton().count(), 0, 'a pending milestone must not appear as an earned badge');

    await page.goto(`${baseUrl}/#/tasks`);
    for (const [index, [name]] of milestones.entries()) {
      goalCard = page.locator('.goal-row').filter({ hasText: goalName });
      await goalCard.getByRole('button', { name: `查看目标“${goalName}”的阶段` }).click();
      const goalDetail = page.getByRole('dialog', { name: '目标详情' });
      await assert.doesNotReject(() => goalDetail.getByText(`${index} / ${milestones.length} 阶段`, { exact: true }).waitFor());
      await goalDetail.getByRole('button', { name: `标为完成：${name}` }).click();
      await assert.doesNotReject(() => page.locator('.toast-layer').waitFor());
      if (index < milestones.length - 1) await page.locator('.toast-layer').click({ position: { x: 4, y: 4 } });
    }
    const unlock = `已解锁“${badgeName}”徽章。阶段目标已完成，获得 50 经验。`;
    await assert.doesNotReject(() => page.locator('.toast-copy').getByText(unlock, { exact: true }).waitFor());
    const viewEvidence = page.locator('.toast').getByRole('button', { name: '查看' });
    await assert.doesNotReject(() => viewEvidence.waitFor());
    await viewEvidence.click();
    await page.waitForURL(/#\/growth$/);
    const badgeSection = page.locator('.growth-badges');
    const recentBadges = badgeSection.locator('.badge-grid').first().locator('.growth-badge');
    const allBadges = badgeSection.locator('.badge-all .growth-badge');
    await assert.doesNotReject(() => badgeSection.getByText('全部 4 ›', { exact: true }).waitFor());
    assert.deepEqual(await recentBadges.locator('.badge-name').allTextContents(), milestones.slice(-4).reverse().map(([name]) => name));
    assert.equal(await badgeSection.locator('.badge-all').getAttribute('open'), null, 'the full badge history starts collapsed');
    await badgeSection.getByText('全部 4 ›', { exact: true }).click();
    assert.equal(await allBadges.count(), 4, 'expanding the history exposes every earned badge');

    const semantics = await badgeSection.locator('.growth-badge').evaluateAll((buttons) => {
      const described = buttons.map((button) => {
        const id = button.getAttribute('aria-describedby') ?? '';
        const target = document.getElementById(id);
        return { id, description: target?.textContent?.trim() ?? '', owned: Boolean(target && button.contains(target)) };
      });
      return { described, ids: [...document.querySelectorAll('.growth-badges [id]')].map((element) => element.id) };
    });
    assert.equal(new Set(semantics.ids).size, semantics.ids.length, 'badge description ids must be unique');
    assert.equal(semantics.described.every((item) => item.id && item.owned && item.description.startsWith('获得说明：')), true, 'every badge must describe how it was earned');

    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const compactLayout = await badgeSection.evaluate((section) => ({
      viewport: innerWidth,
      content: document.documentElement.scrollWidth,
      tooSmall: [...section.querySelectorAll('button, summary')].filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
      }).map((element) => element.textContent?.trim()),
    }));
    assert.deepEqual(compactLayout, { viewport: 320, content: 320, tooSmall: [] }, 'badges must remain touch-safe without horizontal overflow at 200% text');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const movingBadges = await badgeSection.locator('.growth-badge, .badge-mark').evaluateAll((elements) => elements.filter((element) => {
      const style = getComputedStyle(element);
      return style.animationName !== 'none' || element.getAnimations().some((animation) => animation.playState === 'running');
    }).map((element) => element.className));
    assert.deepEqual(movingBadges, [], 'earned badges must stay static when reduced motion is requested');
    await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });

    const expectedDate = await page.evaluate(() => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date()));
    const recentBadge = badgeSection.locator('.badge-grid').first().getByRole('button', { name: `查看徽章详情：${badgeName}`, exact: true });
    await recentBadge.focus();
    assert.equal(await recentBadge.evaluate((element) => element === document.activeElement), true);
    await recentBadge.press('Enter');
    const badgeDialog = page.getByRole('dialog', { name: '徽章详情' });
    const facts = await badgeDialog.locator('.badge-evidence-list').evaluate((list) => Object.fromEntries([...list.querySelectorAll('dt')]
      .map((term) => [term.textContent?.trim(), term.nextElementSibling?.textContent?.trim()])));
    assert.deepEqual(facts, {
      '成果': badgeName,
      '获得日期': expectedDate,
      '获得说明': evidence,
    });
    await badgeDialog.getByRole('button', { name: '关闭' }).click();

    await page.goto(`${baseUrl}/#/tasks`);
    goalCard = page.locator('.goal-row').filter({ hasText: goalName });
    await goalCard.getByRole('button', { name: `查看目标“${goalName}”的阶段` }).click();
    await page.getByRole('dialog', { name: '目标详情' }).getByRole('button', { name: `撤销完成：${badgeName}` }).click();
    await assert.doesNotReject(() => page.getByText('阶段目标经验已撤销。', { exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/growth`);
    assert.equal(await badgeButton().count(), 0, 'undoing the milestone must remove its badge');

    await page.goto(`${baseUrl}/#/tasks`);
    goalCard = page.locator('.goal-row').filter({ hasText: goalName });
    await goalCard.getByRole('button', { name: `查看目标“${goalName}”的阶段` }).click();
    await page.getByRole('dialog', { name: '目标详情' }).getByRole('button', { name: `标为完成：${badgeName}` }).click();
    await assert.doesNotReject(() => page.getByText('阶段目标已完成，获得 50 经验。', { exact: true }).waitFor());

    await goalCard.getByText('编辑', { exact: true }).click();
    await goalCard.getByRole('button', { name: `根据进展重新规划“${goalName}”` }).click();
    const replanPreview = page.getByRole('dialog', { name: '检查目标拆解发送范围' });
    await replanPreview.getByRole('button', { name: '确认范围并生成草案' }).click();
    const consent = page.getByRole('dialog', { name: '允许这一次目标拆解？' });
    if (await consent.count()) await consent.getByRole('button', { name: '允许并继续' }).click();
    const replan = page.getByRole('dialog', { name: '确认新的目标路径' });
    await assert.doesNotReject(() => replan.waitFor());
    await replan.getByRole('checkbox', { name: '确认后把新的下一步安排到今天' }).uncheck();
    await replan.getByRole('button', { name: '确认并替换旧路径' }).click();
    await page.goto(`${baseUrl}/#/growth`);
    await assert.doesNotReject(() => badgeButton().first().waitFor());
    await assert.doesNotReject(() => page.locator('.growth-badges').getByText('全部 4 ›', { exact: true }).waitFor());

    await editGoalStatus('paused');
    await page.goto(`${baseUrl}/#/growth`);
    await assert.doesNotReject(() => badgeButton().first().waitFor());
    await editGoalStatus('abandoned');
    await page.goto(`${baseUrl}/#/growth`);
    await assert.doesNotReject(() => badgeButton().first().waitFor());

    await context.setOffline(true);
    await page.reload();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '成果徽章' }).waitFor());
    await assert.doesNotReject(() => page.locator('.growth-badges').getByText('全部 4 ›', { exact: true }).waitFor());
    await assert.doesNotReject(() => badgeButton().first().waitFor());
  } finally {
    await context.close();
  }
});

test('growth page connects milestone, goal, habit, recovery, and experiment achievements to source evidence', async () => {
  const now = new Date(2026, 7, 26, 10, 0, 0).getTime();
  const { context, page } = await freshPage({ now });
  try {
    await finishOnboarding(page);
    const seeded = await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('qiguang');
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      const transaction = database.transaction(['branches', 'goals', 'milestones', 'xpLedger', 'habits', 'habitLogs', 'quests', 'questFeedback', 'reviews'], 'readwrite');
      const branches = await new Promise((resolve, reject) => {
        const request = transaction.objectStore('branches').getAll();
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      const branch = branches[0];
      const dateAt = (offset) => {
        const value = new Date();
        value.setDate(value.getDate() + offset);
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
      };
      const timestamp = new Date().toISOString();
      const common = { createdAt: timestamp, updatedAt: timestamp, version: 1 };
      const goalId = crypto.randomUUID();
      const milestoneId = crypto.randomUUID();
      const goalDate = dateAt(-7);
      transaction.objectStore('goals').add({
        id: goalId, result: '五类成就目标', why: '验证成果来自现实事实', evidence: '一份五类成就验收记录', nextStep: '已经完成',
        areaId: crypto.randomUUID(), branchId: branch.id, role: 'main', status: 'completed', startDate: dateAt(-14), completedDate: goalDate, completedAt: `${goalDate}T08:00:00.000Z`, ...common,
      });
      transaction.objectStore('milestones').add({
        id: milestoneId, goalId, order: 0, description: '完成第一章', evidence: '第一章验收记录', status: 'completed',
        completedAt: `${goalDate}T08:00:00.000Z`, xpSettled: true, ...common,
      });
      transaction.objectStore('xpLedger').add({
        id: crypto.randomUUID(), settlementKey: `${milestoneId}:1`, sourceType: 'milestone', sourceId: milestoneId, branchId: branch.id,
        baseXp: 50, ratio: 1, finalXp: 50, difficulty: 'milestone', localDate: goalDate, ...common,
      });

      const habitId = crypto.randomUUID();
      transaction.objectStore('habits').add({
        id: habitId, name: '晨间伸展', minimumAction: '伸展一分钟', scheduleDays: [1, 2, 3, 4, 5, 6, 7],
        dimension: 'energy', branchId: branch.id, difficulty: 'light', status: 'active', bonusEnabled: false, ...common,
      });
      for (let index = 0; index < 7; index += 1) {
        const localDate = dateAt(index - 13);
        const questId = crypto.randomUUID();
        transaction.objectStore('quests').add({
          id: questId, localDate, type: 'bonus', sourceType: 'habit', sourceId: habitId, actionId: `habit:${habitId}:${localDate}`, settlementVersion: 1,
          title: `晨间伸展第${index + 1}次`, reason: '主动培养的习惯', minimumAction: '伸展一分钟', estimatedMinutes: 1, difficulty: 'light', dimension: 'energy', branchId: branch.id,
          status: 'completed', aiSuggested: false, userModified: false, ...common,
        });
        transaction.objectStore('questFeedback').add({
          id: crypto.randomUUID(), questId, result: 'completed', note: '', actual: `完成第${index + 1}次晨间伸展`, settlementVersion: 1, completedDate: localDate, ...common,
        });
        transaction.objectStore('habitLogs').add({
          id: crypto.randomUUID(), habitId, localDate, result: 'completed', questId, settlementKey: `habit:${habitId}:${localDate}:1`, ...common,
        });
      }

      const recoveryQuestIds = [];
      for (let index = 0; index < 3; index += 1) {
        const questId = crypto.randomUUID();
        const completed = index < 2;
        const localDate = completed ? dateAt(index - 2) : dateAt(0);
        recoveryQuestIds.push(questId);
        transaction.objectStore('quests').add({
          id: questId, localDate, type: 'side', sourceType: 'recovery', actionId: `recovery:${questId}`, settlementVersion: completed ? 1 : 0,
          title: `恢复行动第${index + 1}次`, reason: '根据当前状态主动恢复', minimumAction: '安静休息五分钟', estimatedMinutes: 5, difficulty: 'light', dimension: 'energy', branchId: branch.id,
          status: completed ? 'completed' : 'pending', aiSuggested: false, userModified: false, ...common,
        });
        if (completed) transaction.objectStore('questFeedback').add({
          id: crypto.randomUUID(), questId, result: 'completed', note: '', actual: `完成恢复行动第${index + 1}次`, settlementVersion: 1, completedDate: localDate, ...common,
        });
      }

      const reviewId = crypto.randomUUID();
      const experimentQuestId = crypto.randomUUID();
      const experimentDate = dateAt(-3);
      transaction.objectStore('reviews').add({
        id: reviewId, requestId: crypto.randomUUID(), type: 'weekly', periodStart: dateAt(-14), periodEnd: dateAt(-8), contractVersion: '1.0', status: 'confirmed',
        request: { context: { events: [] } }, stateTrends: [], recurringBenefits: [], recurringCosts: [], growthDeposits: [], habitDecisions: [],
        nextTheme: '小步试验', nextThemeReason: '用一次行动验证想法',
        nextExperiment: { hypothesis: '小步开始更容易持续', minimumAction: '做一次五分钟试验', metric: '是否完成', endDate: dateAt(7), stopCondition: '明显不适就停止' },
        warnings: [], rawResponse: '{}', ...common,
      });
      transaction.objectStore('quests').add({
        id: experimentQuestId, localDate: experimentDate, type: 'main', sourceType: 'manual', actionId: `review:${reviewId}:experiment`, settlementVersion: 1,
        title: '执行一轮小步试验', reason: '落实已确认的周实验', minimumAction: '做一次五分钟试验', estimatedMinutes: 5, difficulty: 'light', branchId: branch.id,
        status: 'completed', aiSuggested: true, userModified: true, ...common,
      });
      transaction.objectStore('questFeedback').add({
        id: crypto.randomUUID(), questId: experimentQuestId, result: 'completed', note: '', actual: '完成一轮可核对的小步试验', settlementVersion: 1, completedDate: experimentDate, ...common,
      });
      await new Promise((resolve, reject) => {
        transaction.addEventListener('complete', resolve, { once: true });
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
      });
      database.close();
      return { recoveryQuestId: recoveryQuestIds[2] };
    });

    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '完成：恢复行动第3次' }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText(/已解锁“恢复行动 · 懂得停靠”徽章。/).waitFor(), 'a first unlock uses the generic achievement announcement');

    await page.goto(`${baseUrl}/#/growth`);
    const badges = page.locator('.growth-badges');
    await assert.doesNotReject(() => badges.getByText('全部 8 ›', { exact: true }).waitFor());
    assert.equal(await badges.locator('.badge-category-summary').count(), 0, 'badge category descriptions stay hidden');

    await badges.getByText('全部 8 ›', { exact: true }).click();
    const all = badges.locator('.badge-all');
    const expectedBadges = ['完成第一章', '完成目标：五类成就目标', '晨间伸展 · 留下节奏', '恢复行动 · 懂得停靠', '实践：小步试验'];
    for (const name of expectedBadges) {
      await all.getByRole('button', { name: `查看徽章详情：${name}`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '徽章详情' });
      const facts = await dialog.locator('.badge-evidence-list').evaluate((list) => Object.fromEntries([...list.querySelectorAll('dt')]
        .map((term) => [term.textContent?.trim(), term.nextElementSibling?.textContent?.trim()])));
      assert.deepEqual(Object.keys(facts), ['成果', '获得日期', '获得说明'], `${name} must keep its explanation concise`);
      assert.equal(facts['成果'], name);
      assert.ok(facts['获得日期'], `${name} must expose an earned date`);
      assert.ok(facts['获得说明'], `${name} must explain how it was earned`);
      await dialog.getByRole('button', { name: '关闭' }).click();
    }

    const storedRecovery = await page.evaluate(async (id) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('qiguang');
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      const quest = await new Promise((resolve, reject) => {
        const request = database.transaction('quests', 'readonly').objectStore('quests').get(id);
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      database.close();
      return quest;
    }, seeded.recoveryQuestId);
    assert.equal(storedRecovery.status, 'completed', 'the recovery badge must be derived from confirmed task state');

    await page.goto(`${baseUrl}/#/today`);
    assert.equal(await page.locator('.room-achievement').count(), 0, 'the approved room keeps achievement chrome out of the scene');
    assert.equal(await page.locator('.room-stage .growth-badge').count(), 0, 'earned badges are not tiled across the room');
  } finally {
    await context.close();
  }
});

test('a goal-card next step remains an action until its milestone is explicitly confirmed', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const goalDialog = await openNewGoalEditor(page);
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('手动安排目标');
    await scheduleSavedGoalToday(page, goalDialog, '手动安排目标');
    const firstStep = '确定一个可以开始的下一步';
    await openTaskView(page, '今天');
    await page.getByRole('button', { name: `完成：${firstStep}` }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText('已完成 1', { exact: true }).waitFor());

    await openTaskView(page, '计划');
    let goalCard = page.locator('.goal-row').filter({ hasText: '手动安排目标' });
    await goalCard.getByText('编辑', { exact: true }).click();
    await goalCard.getByRole('button', { name: '为“手动安排目标”添加阶段目标' }).click();
    const milestoneDialog = page.getByRole('dialog', { name: '添加阶段目标' });
    await milestoneDialog.getByRole('textbox', { name: '阶段目标', exact: true }).fill('留下手动里程碑证据');
    await milestoneDialog.getByRole('textbox', { name: '怎样算完成', exact: true }).fill('保存一份可以检查的成果');
    await milestoneDialog.getByRole('button', { name: '添加', exact: true }).click();

    goalCard = page.locator('.goal-row').filter({ hasText: '手动安排目标' });
    await goalCard.getByRole('button', { name: '查看目标“手动安排目标”的阶段' }).click();
    await page.getByRole('dialog', { name: '目标详情' }).getByRole('button', { name: '安排“手动安排目标”的下一步' }).click();
    const questDialog = page.getByRole('dialog', { name: '安排目标下一步' });
    await questDialog.getByRole('textbox', { name: '我想做什么？' }).fill('手动安排普通下一步');
    await questDialog.getByText('调整细节（可选）', { exact: true }).click();
    await questDialog.getByRole('textbox', { name: '最小动作' }).fill('只写下一行可检查内容');
    await questDialog.getByRole('button', { name: '安排任务' }).click();
    await openTaskView(page, '今天');
    await page.getByRole('button', { name: '完成：手动安排普通下一步' }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText(/已完成；下一步“推进：留下手动里程碑证据”已加入今天。/).waitFor());
    await openTaskView(page, '计划');
    goalCard = page.locator('.goal-row').filter({ hasText: '手动安排目标' });
    await goalCard.getByRole('button', { name: '查看目标“手动安排目标”的阶段' }).click();
    const goalDetail = page.getByRole('dialog', { name: '目标详情' });
    await assert.doesNotReject(() => goalDetail.getByText('0 / 1 阶段', { exact: true }).waitFor());
    await assert.doesNotReject(() => goalDetail.getByRole('button', { name: '标为完成：留下手动里程碑证据' }).waitFor());
    assert.equal(await xpLedgerCount(page), 2);
  } finally {
    await context.close();
  }
});

test('system-retired BONUS and capacity candidates stay read-only until the same milestone action is scheduled', async () => {
  const now = new Date(2026, 7, 26, 10, 0, 0).getTime();
  const { context, page } = await freshPage({ now });
  try {
    await finishOnboarding(page);
    const seeded = await page.evaluate(async () => {
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
      const transaction = database.transaction(['areas', 'branches', 'goals', 'milestones', 'quests', 'habits', 'reviews'], 'readwrite');
      const [areas, branches] = await Promise.all([readAll(transaction.objectStore('areas')), readAll(transaction.objectStore('branches'))]);
      const timestamp = new Date().toISOString();
      const date = '2026-08-26';
      const common = { createdAt: timestamp, updatedAt: timestamp, version: 1 };
      const goalId = crypto.randomUUID();
      const milestoneId = crypto.randomUUID();
      const capacityQuestId = crypto.randomUUID();
      const capacityActionId = `goal:${goalId}:capacity-candidate`;
      const habitId = crypto.randomUUID();
      const trackedHabitId = crypto.randomUUID();
      const bonusQuestId = crypto.randomUUID();
      const blockerId = crypto.randomUUID();
      const reviewId = crypto.randomUUID();
      const candidateTitle = '推进：容量释放后的里程碑';
      transaction.objectStore('goals').add({
        id: goalId, result: '完成容量候选目标', why: '验证保留动作不会冒充今日安排', evidence: '留下可核对成果', nextStep: candidateTitle,
        areaId: areas[0].id, branchId: branches[0].id, role: 'main', status: 'active', startDate: date, ...common,
      });
      transaction.objectStore('milestones').add({
        id: milestoneId, goalId, order: 0, description: '容量释放后的里程碑', evidence: '一份可检查的里程碑证据', status: 'pending', xpSettled: false, ...common,
      });
      transaction.objectStore('habits').add({
        id: habitId, name: '已暂停的 BONUS', minimumAction: '做一分钟', scheduleDays: [3], scheduleHistory: [{ effectiveFrom: date, scheduleDays: [3], trackingEnabled: false }],
        dimension: 'energy', branchId: branches[0].id, difficulty: 'light', status: 'paused', bonusEnabled: false, ...common,
      });
      transaction.objectStore('habits').add({
        id: trackedHabitId, name: '容量中的习惯', minimumAction: '做一分钟', scheduleDays: [3], scheduleHistory: [{ effectiveFrom: date, scheduleDays: [3], trackingEnabled: true }],
        dimension: 'energy', branchId: branches[0].id, difficulty: 'light', status: 'active', bonusEnabled: true, ...common,
      });
      transaction.objectStore('quests').add({
        id: blockerId, localDate: date, type: 'main', sourceType: 'manual', actionId: `manual:${blockerId}`, settlementVersion: 0,
        title: '占满今日 MAIN', reason: '临时容量占位', minimumAction: '处理一次', estimatedMinutes: 5, difficulty: 'light', branchId: branches[0].id,
        status: 'pending', aiSuggested: false, userModified: false, ...common,
      });
      transaction.objectStore('quests').add({
        id: capacityQuestId, localDate: date, type: 'main', sourceType: 'goal', sourceId: goalId, milestoneId, actionId: capacityActionId, settlementVersion: 0,
        title: candidateTitle, reason: '上一里程碑完成后保留的下一步', minimumAction: '先推进五分钟', completionCriteria: '一份可检查的里程碑证据', estimatedMinutes: 5,
        difficulty: 'light', branchId: branches[0].id, status: 'exempt', systemRetiredAt: timestamp, systemRetiredReason: 'capacity', aiSuggested: false, userModified: false, ...common,
      });
      const otherCapacityCandidates = [
        { id: crypto.randomUUID(), type: 'side', sourceType: 'manual', actionId: `manual:${crypto.randomUUID()}`, title: '保留的自主行动' },
        { id: crypto.randomUUID(), type: 'side', sourceType: 'recovery', actionId: `recovery:${crypto.randomUUID()}`, title: '保留的恢复行动', dimension: 'mind' },
        { id: crypto.randomUUID(), type: 'bonus', sourceType: 'habit', sourceId: trackedHabitId, actionId: `habit:${trackedHabitId}:${date}`, title: '容量中的习惯', dimension: 'energy' },
        { id: crypto.randomUUID(), type: 'main', sourceType: 'manual', actionId: 'review:held-experiment:experiment', title: '保留的周实验行动' },
      ];
      for (const candidate of otherCapacityCandidates) transaction.objectStore('quests').add({
        ...candidate, localDate: date, settlementVersion: 0, reason: '原定日期的位置已满', minimumAction: '先做五分钟', estimatedMinutes: 5,
        difficulty: 'light', branchId: branches[0].id, status: 'exempt', systemRetiredAt: timestamp, systemRetiredReason: 'capacity', aiSuggested: false, userModified: false, ...common,
      });
      transaction.objectStore('quests').add({
        id: bonusQuestId, localDate: date, type: 'bonus', sourceType: 'habit', sourceId: habitId, actionId: `habit:${habitId}:${date}`, settlementVersion: 0,
        title: '已暂停的 BONUS', reason: '旧计划已经结束', minimumAction: '做一分钟', estimatedMinutes: 5, difficulty: 'light', dimension: 'energy', branchId: branches[0].id,
        status: 'exempt', systemRetiredAt: timestamp, systemRetiredReason: 'tracking-disabled', aiSuggested: false, userModified: false, ...common,
      });
      transaction.objectStore('quests').add({
        id: crypto.randomUUID(), localDate: '2026-08-27', type: 'main', sourceType: 'manual', actionId: `manual:${crypto.randomUUID()}`, settlementVersion: 0,
        title: '占满周实验原定位置', reason: '验证周复盘只保留候选', minimumAction: '完成已有安排', estimatedMinutes: 10, difficulty: 'light', branchId: branches[0].id,
        status: 'pending', aiSuggested: false, userModified: false, ...common,
      });
      transaction.objectStore('reviews').add({
        id: reviewId, requestId: crypto.randomUUID(), type: 'weekly', periodStart: '2026-08-24', periodEnd: date, contractVersion: '1.0', status: 'candidate',
        request: {
          contractVersion: '1.0', operation: 'weekly_review', requestId: crypto.randomUUID(), locale: 'zh-CN', timeZone: 'Asia/Shanghai',
          period: { start: '2026-08-24', end: date }, userInput: { note: '' },
          context: {
            events: [], sourceVersions: { quests: [], questFeedback: [], habits: [], habitLogs: [], branches: [], xpLedger: [], goals: [], reviews: [], memories: [], stateObservations: [] },
            stateSnapshots: [], taskResults: [], habits: [], growth: [], goals: [], experiments: [], memories: [],
          },
          permissions: { eventIds: [], includeStateSnapshots: false, includeTaskResults: false, includeHabits: false, includeGrowth: false, includeGoals: false, includeExperiments: false, memoryIds: [] },
        }, stateTrends: [], recurringBenefits: [], recurringCosts: [], growthDeposits: [], habitDecisions: [],
        nextTheme: '容量中的周实验', nextThemeReason: '验证已有安排不会被覆盖',
        nextExperiment: { hypothesis: '保留候选更诚实', minimumAction: '做一次容量实验', metric: '候选是否保留', endDate: '2026-08-25', stopCondition: '已有安排受影响就停止' },
        warnings: [], rawResponse: '{}', ...common,
      });
      await new Promise((resolve, reject) => {
        transaction.addEventListener('complete', resolve, { once: true });
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
      });
      database.close();
      return {
        goalId, milestoneId, capacityQuestId, capacityActionId, bonusQuestId, blockerId, candidateTitle, reviewId,
        capacityCandidates: [
          [capacityQuestId, '阶段目标行动', '今日重点'],
          [otherCapacityCandidates[0].id, '自主行动', '其他任务'],
          [otherCapacityCandidates[1].id, '恢复行动', '其他任务'],
          [otherCapacityCandidates[2].id, '习惯行动', '可选任务'],
          [otherCapacityCandidates[3].id, '周实验行动', '今日重点'],
        ],
      };
    });

    await page.goto(`${baseUrl}/#/tasks`);
    const held = page.locator('.task-held');
    await assert.doesNotReject(() => held.getByRole('heading', { name: '待安排' }).waitFor());
    const retired = page.locator('.task-retired');
    await retired.getByText('已暂停 1', { exact: true }).click();
    const bonusCard = retired.locator(`[data-quest-id="${seeded.bonusQuestId}"]`);
    await assert.doesNotReject(() => bonusCard.getByText('已暂停', { exact: true }).waitFor());
    for (const [id, source, slot] of seeded.capacityCandidates) {
      const card = held.locator(`[data-quest-id="${id}"]`);
      await assert.doesNotReject(() => card.getByText(source, { exact: true }).waitFor());
      await assert.doesNotReject(() => card.getByText(new RegExp(slot)).waitFor());
      await assert.doesNotReject(() => card.getByText('待安排', { exact: true }).waitFor());
      await assert.doesNotReject(() => card.getByRole('button', { name: `安排${source}`, exact: true }).waitFor());
      assert.equal(await card.getByRole('button', { name: /修改任务/ }).count(), 0, 'system retirement is not editable user feedback');
      assert.equal(await card.getByRole('button', { name: /撤销任务/ }).count(), 0, 'system retirement has no fake undo feedback action');
    }
    assert.equal(await bonusCard.getByRole('button', { name: /修改任务|撤销任务/ }).count(), 0, 'a retired BONUS remains read-only');
    await page.getByRole('button', { name: '完成：占满今日 MAIN' }).click();
    const blockingFeedback = page.getByRole('dialog', { name: '记录任务结果' });
    await blockingFeedback.getByRole('button', { name: '今天跳过', exact: true }).click();
    await blockingFeedback.getByRole('button', { name: '保存结果' }).click();
    await openTaskView(page, '计划');
    const goalCard = page.locator('.goal-row').filter({ hasText: '完成容量候选目标' });
    assert.doesNotMatch(await goalCard.innerText(), /已加入今天/, 'a capacity candidate must be described as retained, not scheduled');
    await goalCard.getByRole('button', { name: '查看目标“完成容量候选目标”的阶段' }).click();
    const goalDetail = page.getByRole('dialog', { name: '目标详情' });
    await goalDetail.getByText('放入今天', { exact: true }).click();
    await assert.doesNotReject(() => page.getByText('已把保留的阶段目标行动安排到今天。', { exact: true }).waitFor());
    await openTaskView(page, '今天');
    await assert.doesNotReject(() => page.getByRole('heading', { name: seeded.candidateTitle, exact: true }).waitFor());

    const restored = await page.evaluate(async (id) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('qiguang');
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      const quest = await new Promise((resolve, reject) => {
        const request = database.transaction('quests', 'readonly').objectStore('quests').get(id);
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      database.close();
      return quest;
    }, seeded.capacityQuestId);
    assert.deepEqual({
      id: restored.id, actionId: restored.actionId, sourceId: restored.sourceId, milestoneId: restored.milestoneId,
      status: restored.status, systemRetiredAt: restored.systemRetiredAt, systemRetiredReason: restored.systemRetiredReason,
    }, {
      id: seeded.capacityQuestId, actionId: seeded.capacityActionId, sourceId: seeded.goalId, milestoneId: seeded.milestoneId,
      status: 'pending', systemRetiredAt: undefined, systemRetiredReason: undefined,
    }, 'one click must restore the same milestone action instead of creating a duplicate');

    await page.goto(`${baseUrl}/#/review/2026-08-26`);
    await page.getByRole('button', { name: '编辑后采用' }).click();
    const reviewConfirmation = page.getByRole('dialog', { name: '确认下周重点和小尝试' });
    const experimentEndDate = reviewConfirmation.getByRole('textbox', { name: '结束日期' });
    assert.equal(await experimentEndDate.getAttribute('min'), '2026-08-27');
    assert.equal(await experimentEndDate.inputValue(), '2026-08-27', 'an expired candidate is raised to the first valid experiment date');
    await reviewConfirmation.getByRole('button', { name: '由我确认' }).click();
    await assert.doesNotReject(() => page.getByText('周复盘已确认；周实验行动仅保留为建议，没有覆盖已有安排。', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.locator('.review-final-state').getByText('下周计划已采用', { exact: true }).waitFor());
    const heldExperiment = await page.evaluate(async (reviewId) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('qiguang');
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      const quests = await new Promise((resolve, reject) => {
        const request = database.transaction('quests', 'readonly').objectStore('quests').getAll();
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      database.close();
      return quests.find((quest) => quest.actionId === `review:${reviewId}:experiment`);
    }, seeded.reviewId);
    assert.deepEqual({ status: heldExperiment.status, reason: heldExperiment.systemRetiredReason }, { status: 'exempt', reason: 'capacity' });
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
    await page.getByRole('button', { name: '完成：完成第一阶段' }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText(/阶段目标已完成；下一步“推进：第二阶段”/).waitFor());
    await page.evaluate((nextDay) => localStorage.setItem('qiguang.e2e-now', String(nextDay)), firstDay + 86_400_000);
    await page.goto(`${baseUrl}/#/today`);
    const guide = page.locator('.daily-guide');
    await assert.doesNotReject(() => guide.getByRole('heading', { name: '推进：第二阶段' }).waitFor());
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '查看任务：推进：第二阶段' }).click();
    const taskDetails = page.getByRole('dialog', { name: '记录任务结果' });
    await taskDetails.getByText('编辑或删除任务', { exact: true }).click();
    await taskDetails.getByRole('button', { name: '编辑任务：推进：第二阶段' }).click();
    const adjustment = page.getByRole('dialog', { name: '修改任务' });
    const basis = adjustment.getByText('为什么这样建议', { exact: true });
    await assert.doesNotReject(() => basis.waitFor());
    assert.equal(await adjustment.getByText('这个任务来自目标“完成跨日作品”。', { exact: true }).isVisible(), false);
    await basis.click();
    await assert.doesNotReject(() => adjustment.getByText('这个任务来自目标“完成跨日作品”。', { exact: true }).waitFor());
    await assert.doesNotReject(() => adjustment.getByText(/当前要完成“第二阶段”/).waitFor());
    await adjustment.getByRole('button', { name: '取消' }).click();
    await page.getByRole('button', { name: '查看任务：推进：第二阶段' }).click();
    const feedback = page.getByRole('dialog', { name: '记录任务结果' });
    await feedback.getByRole('button', { name: '今天跳过', exact: true }).click();
    await feedback.getByRole('combobox', { name: '为什么跳过（可选）' }).selectOption('建议不适合我');
    await feedback.getByRole('button', { name: '保存结果' }).click();
    const decision = page.getByRole('dialog', { name: '这条目标路径还值得继续吗？' });
    await assert.doesNotReject(() => decision.getByRole('button', { name: '修改目标或下一步' }).waitFor());
    await assert.doesNotReject(() => decision.getByRole('button', { name: '根据进展重新规划' }).waitFor());
    await decision.getByRole('button', { name: '暂不改变目标' }).click();
    await page.goto(`${baseUrl}/#/today`);
    assert.equal(await page.getByRole('button', { name: '确认或调整这一步' }).count(), 0, '今天不做后，同一天不应再次催促同一目标');
    await page.evaluate((nextDay) => localStorage.setItem('qiguang.e2e-now', String(nextDay)), firstDay + 2 * 86_400_000);
    await page.reload();
    const retryGuide = page.locator('.daily-guide');
    await assert.doesNotReject(() => retryGuide.waitFor(), `次日必须恢复目标处理入口：${await page.locator('#main-content').innerText()}`);
    assert.match(await retryGuide.innerText(), /重新决定：推进：第二阶段/);
    await retryGuide.getByRole('button', { name: '确认或调整这一步' }).click();
    const retryDialog = page.getByRole('dialog', { name: '安排目标下一步' });
    const retryTitle = retryDialog.getByRole('textbox', { name: '我想做什么？' });
    assert.equal(await retryTitle.inputValue(), '推进：第二阶段');
    await retryTitle.fill('缩小后继续第二阶段');
    await retryDialog.getByRole('button', { name: '安排任务' }).click();
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
    const today = await page.locator('.record-date-control input[type="date"]').inputValue();
    await page.getByRole('button', { name: '成功记录' }).click();
    await input.fill(`${await input.inputValue()}完成了今天最小的一步`);
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.goto(`${baseUrl}/#/day/${today}`);
    await page.locator('.day-evidence-details > summary').click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '今天的整理' }).waitFor());
    await assert.doesNotReject(() => page.locator('.success-evidence').getByText('完成了今天最小的一步', { exact: true }).waitFor());
    assert.equal(await page.getByRole('button', { name: '检查范围并整理' }).count(), 0);

    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const goalDialog = await openNewGoalEditor(page);
    assert.equal(await goalDialog.getByRole('button', { name: 'AI 未配置' }).isDisabled(), true);
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('完成一个本地目标');
    await scheduleSavedGoalToday(page, goalDialog, '完成一个本地目标');
    assert.equal(await page.getByText(/已确认的拆解/).count(), 0);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '完成一个本地目标', exact: true }).waitFor());
    await openTaskView(page, '今天');
    await assert.doesNotReject(() => page.getByRole('heading', { name: '确定一个可以开始的下一步' }).waitFor());

    await page.goto(`${baseUrl}/#/review`);
    await assert.doesNotReject(() => page.getByText('AI 未配置', { exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/system`);
    await page.getByText('AI 整理', { exact: true }).click();
    const aiSettings = page.getByRole('dialog', { name: 'AI 整理' }).locator('.ai-settings');
    await aiSettings.getByText('使用安装包提供的服务', { exact: true }).click();
    const permission = aiSettings.getByRole('checkbox', { name: /允许 AI 整理/ });
    const check = aiSettings.getByRole('button', { name: '重新检查连接' });
    assert.equal(await check.isDisabled(), true);
    assert.equal(await permission.isDisabled(), true);
    await assert.doesNotReject(() => aiSettings.getByText('不可用', { exact: true }).waitFor());
    await aiSettings.getByRole('textbox', { name: '自定义 API Key' }).fill('test-minimax-key');
    await aiSettings.getByRole('button', { name: '保存', exact: true }).click();
    await assert.doesNotReject(() => aiSettings.getByText('已保存自定义密钥，不会回显。', { exact: true }).waitFor());
    assert.equal(await permission.isDisabled(), false);
    assert.equal(await check.isDisabled(), false);
    await aiSettings.getByRole('button', { name: '清除密钥' }).click();
    await assert.doesNotReject(() => aiSettings.getByText('留空使用安装包密钥。', { exact: true }).waitFor());
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
    const observation = await page.locator('.room-character.is-action-desk.is-walking').evaluate((element) => new Promise((resolve) => {
      const style = getComputedStyle(element);
      const shadow = getComputedStyle(element, '::after');
      const hotspot = document.querySelector('.room-hotspot.is-desk');
      const values = [];
      const startedAt = performance.now();
      const sample = () => {
        values.push({ atlas: getComputedStyle(element).backgroundImage, frame: getComputedStyle(element).backgroundPosition, x: Math.round(element.getBoundingClientRect().x * 10) / 10 });
        if (performance.now() - startedAt >= 420) resolve({
          values,
          animationName: style.animationName,
          animationTimingFunction: style.animationTimingFunction,
          shadowAnimationName: shadow.animationName,
          hotspotAnimationName: hotspot ? getComputedStyle(hotspot, '::before').animationName : '',
        });
        else requestAnimationFrame(sample);
      };
      sample();
    }));
    const actionAnimations = observation.animationName;
    const actionTiming = observation.animationTimingFunction;
    assert.match(actionAnimations, /room-action/);
    assert.match(actionAnimations, /room-walk-cycle/);
    assert.doesNotMatch(actionAnimations, /room-footfall/);
    assert.match(actionTiming, /steps\(6, jump-none\)/, 'the route should move on the same discrete beat as its six walking frames');
    assert.doesNotMatch(actionAnimations, /step-weight/);
    assert.match(observation.shadowAnimationName, /room-shadow-step/, 'the ground shadow should respond to each footfall');
    assert.match(observation.hotspotAnimationName, /hotspot-sigil/, 'the active furniture should use a short in-world focus cue');
    const samples = observation.values;
    const sampledAtlases = new Set(samples.map((item) => item.atlas));
    const sampledFrames = new Set(samples.map((item) => item.frame));
    const sampledPositions = new Set(samples.map((item) => item.x));
    assert.equal(sampledAtlases.size, 1, 'walking must keep one decoded texture instead of swapping PNGs');
    assert.ok(sampledFrames.size >= 3 && samples.every((item) => item.atlas !== 'none'), 'atlas positions must advance without flashing blank');
    assert.ok(sampledPositions.size >= 3 && sampledPositions.size < samples.length / 2, 'movement must land on repeated discrete positions instead of drifting every render frame');
    assert.ok(samples.at(-1).x < samples[0].x - 5, 'companion should visibly walk toward the desk');
    assert.equal(await character.evaluate((element) => getComputedStyle(element).clipPath), 'none', 'independent frames should not be clipped again while walking');
    const interaction = page.locator('.room-character.is-action-desk.is-interacting');
    await assert.doesNotReject(() => page.getByText('坐到椅子上，写下一件真实发生的事。', { exact: true }).waitFor());
    await assert.doesNotReject(() => interaction.waitFor());
    assert.equal(await interaction.evaluate((element) => getComputedStyle(element).backgroundPosition), '-84px 0px');
    await page.waitForURL(/#\/record$/);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('ambient rightward steps face right, keep one atlas, and settle into an idle gesture', async () => {
  const { context, page, apiRequests } = await freshPage({ now: new Date(2026, 7, 26, 15, 0, 0).getTime() });
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    const character = page.locator('.room-character.is-ambient-walk.is-motion-ready');
    await assert.doesNotReject(() => character.waitFor());
    const rightward = await character.evaluate((element) => {
      const animation = element.getAnimations().find((item) => item.animationName === 'room-ambient-stroll');
      if (!animation) return null;
      animation.pause();
      const sample = (time) => {
        animation.currentTime = time;
        const style = getComputedStyle(element);
        return { x: element.getBoundingClientRect().x, frame: style.backgroundPosition, atlas: style.backgroundImage };
      };
      const start = sample(2_600);
      const end = sample(3_760);
      const style = getComputedStyle(element);
      return { start, end, expectedStart: style.getPropertyValue('--walk-right-1').trim(), expectedEnd: style.getPropertyValue('--walk-right-6').trim() };
    });
    assert.ok(rightward);
    assert.ok(rightward.end.x > rightward.start.x + 20, 'the sampled segment must move right');
    assert.equal(rightward.start.frame, rightward.expectedStart, 'the first rightward step must use the right-facing row');
    assert.equal(rightward.end.frame, rightward.expectedEnd, 'the last rightward step must still face right');
    assert.equal(rightward.start.atlas, rightward.end.atlas, 'walking must not swap textures between frames');
    await character.evaluate((element) => new Promise((resolve) => {
      const check = () => element.dataset.idleGesture ? resolve() : setTimeout(check, 80);
      check();
    }));
    const gesture = await page.locator('.room-character.is-idle-gesture').evaluate((element) => new Promise((resolve) => {
      const check = () => {
        const style = getComputedStyle(element);
        const frame = style.backgroundPosition;
        const expected = style.getPropertyValue('--idle-gesture-frame').trim();
        if (frame === expected) resolve({ name: element.dataset.idleGesture, frame, expected });
        else requestAnimationFrame(check);
      };
      check();
    }));
    assert.match(gesture.name ?? '', /^(wave|calm|think|read)$/);
    assert.equal(gesture.frame, gesture.expected);
    await page.locator('.room-character').evaluate((element) => new Promise((resolve) => {
      const check = () => !element.dataset.idleGesture ? resolve() : requestAnimationFrame(check);
      check();
    }));
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('the male companion maps horizontal movement to the direction shown in his atlas', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page, '包包');
    await page.goto(`${baseUrl}/#/today`);
    const character = page.locator('.room-character.is-male.is-motion-ready');
    await assert.doesNotReject(() => character.waitFor());
    const frames = await character.evaluate((element) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(['face-left-frame', 'face-right-frame', 'walk-left-1', 'walk-left-6', 'walk-right-1', 'walk-right-6']
        .map((name) => [name, style.getPropertyValue(`--${name}`).trim()]));
    });
    assert.deepEqual(frames, {
      'face-left-frame': '-252px 0',
      'face-right-frame': '-84px 0',
      'walk-left-1': '0px -252px',
      'walk-left-6': '-420px -252px',
      'walk-right-1': '0px -168px',
      'walk-right-6': '-420px -168px',
    });
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
      const motion = await character.evaluate((element, directions) => {
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
          return { x: box.left + box.width / 2, y: box.bottom, frame: getComputedStyle(element).backgroundPosition };
        };
        const style = getComputedStyle(element);
        return {
          start: sample(0),
          firstFrame: sample(300),
          waypoint: sample(480),
          secondFrame: sample(700),
          end: sample(900),
          expectedFirstFrame: style.getPropertyValue(`--walk-${directions.first}-4`).trim(),
          expectedSecondFrame: style.getPropertyValue(`--walk-${directions.second}-4`).trim(),
        };
      }, { first: firstDirection, second: secondDirection });
      assert.ok(motion, `${action} must expose route and sprite animations`);
      assert.equal(directionBetween(motion.start, motion.waypoint), firstDirection, `${action} first segment must move ${firstDirection}`);
      assert.equal(directionBetween(motion.waypoint, motion.end), secondDirection, `${action} second segment must move ${secondDirection}`);
      assert.equal(motion.firstFrame.frame, motion.expectedFirstFrame, `${action} must face ${firstDirection} during its first segment`);
      assert.equal(motion.secondFrame.frame, motion.expectedSecondFrame, `${action} must turn toward ${secondDirection} only for its second segment`);
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
    const settings = page.getByRole('link', { name: '设置', exact: true });
    await assert.doesNotReject(() => settings.waitFor());
    const settingsBox = await settings.boundingBox();
    assert.ok(settingsBox && settingsBox.width >= 44 && settingsBox.height >= 44, 'the page settings action should remain touch-safe');
    const companionButton = page.getByRole('button', { name: '生活分身' });
    await companionButton.click();
    const panel = page.locator('.character-panel');
    await assert.doesNotReject(() => panel.waitFor());
    assert.equal(await panel.getByRole('button', { name: '关闭生活分身' }).count(), 1, 'the companion panel needs an explicit close action');
    await assert.doesNotReject(() => panel.getByText('我在。今天想从哪里开始？', { exact: true }).waitFor());
    await panel.getByText('我在。今天想从哪里开始？', { exact: true }).click();
    assert.equal(await panel.isVisible(), true, 'clicking inside the companion panel must keep it open');
    await page.getByRole('heading', { name: '今天', exact: true }).click();
    await assert.doesNotReject(() => panel.waitFor({ state: 'hidden' }));
    assert.equal(await companionButton.getAttribute('aria-expanded'), 'false');
    await companionButton.click();
    await assert.doesNotReject(() => panel.waitFor());
    await assert.doesNotReject(() => panel.getByRole('button', { name: '记录一件事' }).waitFor());
    assert.equal(await panel.getByRole('button', { name: '查看今天的行动' }).count(), 1);
    assert.equal(await panel.getByRole('button', { name: '设置与数据' }).count(), 0);
    assert.equal(await panel.locator('.button-primary').getAttribute('aria-label') ?? await panel.locator('.button-primary').textContent(), '查看今天的行动');
    const panelBox = await panel.boundingBox();
    const actionBoxes = await panel.locator('.character-actions button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()));
    assert.ok(panelBox && actionBoxes.every((box) => box.left >= panelBox.x && box.right <= panelBox.x + panelBox.width), 'all companion actions should stay inside the panel');
    assert.ok(actionBoxes.every((box) => box.width >= panelBox.width * .25), 'all companion actions should remain visibly usable');
    assert.equal(await panel.getByRole('button', { name: '为什么给我这个主线？' }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: '更换外观' }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: '看本周' }).count(), 0);
    await panel.getByRole('button', { name: '记录一件事' }).click();
    await page.waitForURL(/#\/record$/);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '添加任务' }).click();
    await page.getByText('调整细节（可选）', { exact: true }).click();
    await page.getByRole('textbox', { name: '我想做什么？' }).fill('验证主线依据');
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('这是主线的可追溯理由。');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一个最小步骤');
    await page.getByRole('combobox', { name: '任务类型' }).selectOption('main');
    await page.getByRole('dialog', { name: '安排每日任务' }).getByRole('button', { name: '安排任务' }).click();
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '生活分身' }).click();
    await assert.doesNotReject(() => panel.getByText('今日重点已经在等你了；需要的话，我陪你拆成下一步。', { exact: true }).waitFor());
    assert.equal(await panel.getByText('验证主线依据', { exact: true }).count(), 0, '轻量面板不重复铺开任务卡内容');
    assert.equal(await panel.getByText(/依据：今天已经有一条确认过的主线/).count(), 0);
    assert.equal(await panel.locator('.button-primary').textContent(), '查看今天的行动');
    await panel.getByRole('button', { name: '查看今天的行动' }).click();
    assert.equal(await companionButton.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.today-focus-list').getByText('这是主线的可追溯理由。', { exact: true }).count(), 0);
    await assert.doesNotReject(() => page.locator('.today-focus-list').getByRole('heading', { name: '验证主线依据' }).waitFor());
  } finally {
    await context.close();
  }
});

test('keyboard users can skip the room and open a direct route', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    assert.equal(await page.getByRole('button', { name: '开始记录' }).count(), 0);
    await page.getByRole('link', { name: '跳到主要内容' }).press('Enter');
    await page.locator('#main-content:focus').waitFor();
    const recordLink = page.getByRole('link', { name: '记录', exact: true });
    assert.equal(await recordLink.getAttribute('href'), '#/record', 'keyboard users need a native direct-route link');
    await Promise.all([page.waitForURL(/#\/record$/), recordLink.click()]);
    await assert.doesNotReject(() => page.getByRole('textbox', { name: '发生了什么' }).waitFor());
    await page.goto(`${baseUrl}/#/status`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '设置', exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/history`);
    await assert.doesNotReject(() => page.getByRole('link', { name: '日历', exact: true }).waitFor());
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
    assert.equal(await page.getByText('要从最近发生的一件事开始吗？', { exact: true }).count(), 0);
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

test('installed shell keeps both companion atlases available offline', async () => {
  const { context, page } = await offlineShellPage();
  try {
    const assets = await page.evaluate(async () => {
      const bundles = [...document.scripts].map((script) => script.src).filter(Boolean);
      const source = await Promise.all(bundles.map((bundle) => fetch(bundle).then((response) => response.text())));
      return [...new Set(source.flatMap((text) => [...text.matchAll(/["'`](\/assets\/[^"'`]+\.(?:png|jpe?g))["'`]/g)].map((match) => match[1])))].sort();
    });
    assert.equal(assets.length, 5, 'two portraits, two motion atlases, and the room background must be built into the shell');
    await context.setOffline(true);
    const dialog = page.getByRole('dialog', { name: '选一个陪伴角色' });
    await dialog.getByRole('button', { name: '选择鱼鱼' }).click();
    await dialog.getByRole('button', { name: '写下第一件事' }).click();
    await page.waitForURL(/#\/record$/);
    await page.goto(`${baseUrl}/#/today`);
    const imageUrl = await page.locator('.room-character').evaluate((element) => getComputedStyle(element).backgroundImage.match(/url\("?([^"\)]+)"?\)/)?.[1]);
    const motionAtlases = assets.filter((asset) => /\/assets\/character-motion-(?:female|male)-runtime-[^/]+\.png$/.test(asset));
    assert.equal(motionAtlases.length, 2, 'both companion atlases must be built into the shell');
    assert.equal(motionAtlases.some((asset) => imageUrl?.endsWith(asset)), true, 'the current pose must use its decoded companion atlas');
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
    await page.getByText('显示与语气', { exact: true }).click();
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
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '去自评 ›' }).click();
    const directQuestionnaire = page.getByRole('dialog', { name: '30 题状态评估' });
    await assert.doesNotReject(() => directQuestionnaire.waitFor());
    await directQuestionnaire.getByRole('button', { name: '稍后再测' }).click();
    await page.goto(`${baseUrl}/#/system`);
    await page.getByText('状态自评', { exact: true }).click();
    await page.getByRole('button', { name: '30 题快速评估' }).click();
    const questionnaire = page.getByRole('dialog', { name: '30 题状态评估' });
    for (let index = 0; index < 30; index += 1) {
      await questionnaire.getByRole('button', { name: index < 6 ? '从不' : '经常', exact: true }).click();
    }
    await questionnaire.getByRole('button', { name: '保存分数' }).click();
    await page.getByRole('status').filter({ hasText: '当前状态已更新。' }).waitFor();
    await page.getByText('今天已评估', { exact: true }).waitFor();
    await page.goto(`${baseUrl}/#/today`);
    await page.locator('.status-summary').waitFor();
    const stateLabels = await page.locator('.status-item').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
    assert.match(stateLabels[0] ?? '', /身体当前分数 33/);
    await assert.doesNotReject(() => page.getByText('状态照顾', { exact: true }).waitFor());
    assert.equal(await page.getByText(/RECOVERY/).count(), 0, 'recovery guidance must not expose an internal category label');
    await assert.doesNotReject(() => page.getByRole('heading', { name: '先补足身体' }).waitFor());
    assert.equal(await page.locator('.room-scene.is-cue-rest').count(), 1);
    assert.equal(await page.locator('.room-character.is-resting').count(), 1);
    assert.equal(await page.locator('.room-character.is-resting').evaluate((element) => getComputedStyle(element).backgroundPosition), '0px 0px');
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
    await page.goto(`${baseUrl}/#/tasks`);
    const recoveryCard = page.locator('.task-list-item').filter({ hasText: '做一次很短的舒展' });
    await assert.doesNotReject(() => recoveryCard.waitFor());
    assert.equal(await recoveryCard.getByText(/经验/).count(), 0, 'an unbound recovery action must not advertise fake experience');
    assert.equal(await recoveryCard.getByText(/轻量/).count(), 0, 'the execution list should omit difficulty terminology');
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '查看任务：做一次很短的舒展' }).click();
    const progressDialog = page.getByRole('dialog', { name: '记录任务结果' });
    await progressDialog.getByRole('button', { name: '有进展', exact: true }).click();
    await assert.doesNotReject(() => progressDialog.getByText('确认保存前不会修改任务', { exact: false }).waitFor());
    assert.equal(await page.getByText('已记为部分完成；可以随时撤销。', { exact: false }).count(), 0);
    await progressDialog.getByRole('button', { name: '保存结果' }).click();
    await page.waitForTimeout(200);
    assert.equal(await progressDialog.count(), 0, 'result dialog should close after the confirmed save');
    await page.waitForTimeout(1000);
    const feedbackNotice = await page.locator('body').innerText();
    assert.match(feedbackNotice, /反馈已保存|已保留进展|已记为部分完成/, feedbackNotice);
    await page.goto(`${baseUrl}/#/tasks`);
    const settledRecovery = page.locator('.task-settled');
    await assert.doesNotReject(() => settledRecovery.getByText('已完成 1', { exact: true }).waitFor());
    await assert.doesNotReject(() => settledRecovery.getByRole('button', { name: '修改任务“做一次很短的舒展”的反馈' }).waitFor());
    await settledRecovery.getByRole('button', { name: '修改任务“做一次很短的舒展”的反馈' }).click();
    await page.getByRole('dialog', { name: '修改任务结果' }).getByRole('button', { name: '撤销任务“做一次很短的舒展”的反馈' }).click();
    await page.getByRole('button', { name: '查看任务：做一次很短的舒展' }).click();
    const skipDialog = page.getByRole('dialog', { name: '记录任务结果' });
    await skipDialog.getByRole('button', { name: '今天跳过', exact: true }).click();
    await skipDialog.getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText(/反馈已保存/).waitFor());
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
    await assert.doesNotReject(() => page.locator('.status-summary').waitFor());
    const energyStatus = page.getByRole('button', { name: /身体当前分数 25/ });
    assert.equal(await energyStatus.count(), 1);
    assert.equal(await energyStatus.locator('.status-meter, .caption').count(), 0);
    assert.equal(await page.getByText('需要更新', { exact: true }).count(), 0);
    assert.equal(await page.locator('.room-stage[data-snapshot-date]').getAttribute('data-snapshot-date'), past);
    assert.equal(await page.locator('.room-plant').count(), 0, 'habits created after this date must not leave empty decorative blocks in the room');
    await energyStatus.click();
    const detail = page.getByRole('dialog', { name: '身体当前状态' });
    await assert.doesNotReject(() => detail.waitFor());
    await assert.doesNotReject(() => detail.getByText('当前分数 25', { exact: true }).waitFor());
    assert.equal(await detail.getByText('需要更新', { exact: true }).count(), 0);
  } finally {
    await context.close();
  }
});

test('late completion evidence belongs to the real feedback day, not the planned day', async () => {
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
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    const questDialog = page.getByRole('dialog', { name: '安排每日任务' });
    await questDialog.getByRole('textbox', { name: '我想做什么？' }).fill('跨日完成证据');
    await questDialog.getByRole('button', { name: '安排任务' }).click();

    await page.evaluate((nextDay) => localStorage.setItem('qiguang.e2e-now', String(nextDay)), firstDay + 86_400_000);
    await page.goto(`${baseUrl}/#/tasks`);
    const overdue = page.locator('.task-list-item.is-overdue').filter({ hasText: '跨日完成证据' });
    await overdue.getByRole('button', { name: '记录“跨日完成证据”的实际结果' }).click();
    const firstFeedback = page.getByRole('dialog', { name: '记录任务结果' });
    const actualDate = firstFeedback.locator('.feedback-date-control input[type="date"]');
    await assert.doesNotReject(() => firstFeedback.waitFor());
    assert.equal(await actualDate.inputValue(), '2026-08-21', 'an overdue completion defaults to the real feedback day');
    await actualDate.fill('2026-08-21');
    await firstFeedback.getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText(/反馈已保存；可以在任务卡上撤销。 完成记录：跨日完成证据。经验 \+10/).waitFor());

    await page.goto(`${baseUrl}/#/day/2026-08-20`);
    assert.equal(await page.locator('.success-evidence').count(), 0, 'planned day must not claim a later success');
    assert.equal(await page.locator('.day-action-results .day-action-row').count(), 0, 'planned day must not claim later action feedback');

    await page.goto(`${baseUrl}/#/day/2026-08-21`);
    const successes = page.locator('.success-evidence');
    await assert.doesNotReject(() => successes.getByText('完成：跨日完成证据', { exact: true }).waitFor({ state: 'attached' }));
    const feedback = page.locator('.day-action-results');
    const feedbackAction = feedback.getByRole('button', { name: '查看并修改“跨日完成证据”的任务结果' });
    await assert.doesNotReject(() => feedbackAction.waitFor());
    assert.equal(await feedbackAction.locator('.day-action-icon, .day-action-chevron').count(), 0);
    const feedbackLayout = await feedbackAction.evaluate((row) => {
      const title = row.querySelector('.day-action-copy').getBoundingClientRect();
      const result = row.querySelector('.day-action-result').getBoundingClientRect();
      return { resultAtRight: result.left >= title.right, columns: getComputedStyle(row).gridTemplateColumns.split(' ').length };
    });
    assert.deepEqual(feedbackLayout, { resultAtRight: true, columns: 2 });

    await feedbackAction.click();
    const noteEdit = page.getByRole('dialog', { name: '修改任务结果' });
    assert.equal(await noteEdit.locator('.feedback-date-control input[type="date"]').inputValue(), '2026-08-21');
    await noteEdit.getByText('更多记录', { exact: true }).click();
    await noteEdit.getByRole('textbox', { name: '下次怎么调整（可选）' }).fill('补充备注，但不改变真实完成日期。');
    await noteEdit.getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.locator('.success-evidence').getByText('完成：跨日完成证据', { exact: true }).waitFor({ state: 'attached' }));

    await page.evaluate((later) => localStorage.setItem('qiguang.e2e-now', String(later)), firstDay + 5 * 86_400_000);
    await feedbackAction.click();
    const dateEdit = page.getByRole('dialog', { name: '修改任务结果' });
    const movedDate = dateEdit.locator('.feedback-date-control input[type="date"]');
    assert.equal(await movedDate.inputValue(), '2026-08-21', 'editing later must preserve the existing date by default');
    await movedDate.fill('2026-08-24');
    await dateEdit.getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.locator('.success-evidence').waitFor({ state: 'detached' }));
    assert.equal(await page.locator('.success-evidence').count(), 0, 'explicitly moving the completion removes it from the former day');
    assert.equal(await feedback.locator('.day-action-row').count(), 0, 'the former day no longer owns the action feedback');

    await page.goto(`${baseUrl}/#/day/2026-08-24`);
    await assert.doesNotReject(() => page.locator('.success-evidence').getByText('完成：跨日完成证据', { exact: true }).waitFor({ state: 'attached' }));
    await assert.doesNotReject(() => feedbackAction.waitFor());

    await page.goto(`${baseUrl}/#/review/2026-08-17`);
    await page.getByRole('button', { name: '检查范围并生成' }).click();
    let reviewPreview = page.getByRole('dialog', { name: '生成本周复盘' });
    await assert.doesNotReject(() => reviewPreview.locator('.analysis-preview-scope').getByText(/任务结果 0 条/).waitFor());
    await reviewPreview.getByRole('button', { name: '取消' }).click();

    await page.goto(`${baseUrl}/#/review/2026-08-24`);
    await page.getByRole('button', { name: '检查范围并生成' }).click();
    reviewPreview = page.getByRole('dialog', { name: '生成本周复盘' });
    await assert.doesNotReject(() => reviewPreview.locator('.analysis-preview-scope').getByText(/任务结果 1 条/).waitFor());
    await reviewPreview.getByRole('button', { name: '取消' }).click();
  } finally {
    await context.close();
  }
});

test('completed action is traceable from its growth branch at 320px', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '添加任务' }).click();
    await page.getByText('调整细节（可选）', { exact: true }).click();
    await page.getByRole('textbox', { name: '我想做什么？' }).fill('证据测试行动');
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('验证成长分支可以追溯现实证据');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一个可验证步骤');
    await page.getByRole('dialog', { name: '安排每日任务' }).getByRole('button', { name: '安排任务' }).click();
    await page.getByRole('button', { name: '完成：证据测试行动' }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText(/反馈已保存；可以在任务卡上撤销。.*经验 \+10/).waitFor());
    await assert.doesNotReject(() => page.locator('.task-summary').getByText(/1 已完成/).waitFor());
    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/day/${today}`);
    await page.locator('.day-evidence-details > summary').click();
    const successDiary = page.locator('.success-evidence');
    await assert.doesNotReject(() => successDiary.getByText('完成：证据测试行动', { exact: true }).waitFor());
    assert.equal(await page.getByText('来自你的“小小成功”记录和已确认行动反馈，不做额外推断。').count(), 0);
    await page.goto(`${baseUrl}/#/growth`);
    const branch = page.locator('.branch-card').filter({ hasText: '身体状态' }).first();
    await branch.locator('.branch-details > summary').click();
    await assert.doesNotReject(() => branch.getByText(/手动行动 · 证据测试行动 .* \+10 经验/).waitFor());
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
    await page.getByRole('button', { name: /人物与陪伴/ }).click();
    const avatarSelect = page.getByLabel('人物形象');
    const preview = page.locator('.avatar-preview');
    await avatarSelect.selectOption('male');
    assert.match(await preview.getAttribute('src') ?? '', /avatar-male-cartoon/);
    await avatarSelect.selectOption('female');
    await assert.doesNotReject(() => preview.waitFor({ state: 'visible' }));
    assert.match(await preview.getAttribute('src') ?? '', /avatar-female-cartoon/);
    await page.getByRole('button', { name: '保存人物设置' }).click();
    await page.goto(`${baseUrl}/#/today`);
    const roomSprite = page.locator('.room-character.has-motion');
    await assert.doesNotReject(() => roomSprite.waitFor({ state: 'visible' }));
    assert.match(await roomSprite.evaluate((element) => getComputedStyle(element).backgroundImage), /character-motion-female-runtime/);
    assert.equal(await roomSprite.evaluate((element) => element.classList.contains('is-happy')), true);
    const spriteLayout = await roomSprite.evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundPosition: style.backgroundPosition, backgroundSize: style.backgroundSize, idleFrame: style.getPropertyValue('--idle-frame').trim(), walkFrame: style.getPropertyValue('--walk-front-1').trim(), mixBlendMode: style.mixBlendMode };
    });
    assert.equal(spriteLayout.backgroundSize, '504px 504px');
    assert.equal(spriteLayout.idleFrame, '0px 0px');
    assert.equal(spriteLayout.walkFrame, '0px -336px');
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
    ['打开记录', 'desk', /#\/record$/, [0.28, 0.44, 0.68, 0.84], '--face-left-frame'],
    ['打开任务', 'board', /#\/tasks$/, [0.42, 0.58, 0.68, 0.84], '--face-back-frame'],
    ['打开日历', 'calendar', /#\/calendar$/, [0.58, 0.75, 0.68, 0.84], '--face-back-frame'],
    ['打开成长', 'workbench', /#\/growth$/, [0.60, 0.73, 0.68, 0.84], '--face-right-frame'],
    ['打开状态', 'window', /#\/system$/, [0.31, 0.44, 0.68, 0.84], '--face-back-frame'],
  ];
  try {
    await finishOnboarding(page);
    for (const [buttonName, action, route, [minX, maxX, minY, maxY], interactionVariable] of destinations) {
      await page.goto(`${baseUrl}/#/today`);
      await page.getByRole('button', { name: buttonName }).click();
      const interacting = page.locator(`.room-character.is-action-${action}.is-interacting`);
      await interacting.waitFor();
      const interaction = await interacting.evaluate((element, variable) => {
        const room = element.closest('.room-scene').getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return {
          x: (box.left + box.width / 2 - room.left) / room.width,
          y: (box.bottom - room.top) / room.height,
          backgroundPosition: getComputedStyle(element).backgroundPosition,
          expectedPosition: getComputedStyle(element).getPropertyValue(variable).trim().replace(/(^|\s)0(?=\s|$)/g, (_, lead) => `${lead}0px`),
        };
      }, interactionVariable);
      assert.ok(interaction.x >= minX && interaction.x <= maxX && interaction.y >= minY && interaction.y <= maxY,
        `${action} must align with its furniture, got ${JSON.stringify(interaction)}`);
      assert.equal(interaction.backgroundPosition, interaction.expectedPosition, `${action} must use the matching interaction pose`);
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
    assert.equal(await character.evaluate((element) => getComputedStyle(element).backgroundPosition), '0px 0px');
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
    assert.ok(after.x >= .44 && after.x <= .54 && after.y >= .78 && after.y <= .9, `rest should return the companion to the room center, got ${JSON.stringify(after)}`);
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
    await page.getByRole('button', { name: '添加任务' }).click();
    await page.getByText('调整细节（可选）', { exact: true }).click();
    await page.getByRole('textbox', { name: '我想做什么？' }).fill(title);
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('验证桌面伙伴动作不重载当前页面');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一次原生动作回归');
    await page.getByRole('combobox', { name: '任务类型' }).selectOption('main');
    await page.getByRole('dialog', { name: '安排每日任务' }).getByRole('button', { name: '安排任务' }).click();
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

    await assert.doesNotReject(() => page.getByText(`已从今日任务小组件完成；经验已结算，可在任务板撤销。 完成记录：${title}。经验 +10 · 提升方向总经验 10 · 等级 0。`, { exact: true }).waitFor());
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
      globalThis.__qiguangPinned = false;
      window.qiguangWidgetBridge = {
        updateSnapshot() {},
        consumeAction() { return ''; },
        canRequestPinWidget() { return true; },
        hasPinnedWidget() { return globalThis.__qiguangPinned; },
        requestPinWidget() { globalThis.__qiguangPinRequested += 1; return true; },
      };
      location.hash = '/system';
    });
    await assert.doesNotReject(() => page.getByRole('heading', { name: '设置', exact: true }).waitFor());
    await page.getByRole('button', { name: /今日任务小组件/ }).click();
    const add = page.getByRole('button', { name: '添加到桌面' });
    await add.click();
    assert.equal(await page.evaluate(() => globalThis.__qiguangPinRequested), 1);
    await assert.doesNotReject(() => page.getByText('请在系统窗口中确认添加。', { exact: true }).waitFor());
    assert.equal(await add.isDisabled(), true, 'a pin request must not be submitted repeatedly');
    await page.evaluate(() => window.dispatchEvent(new Event('qiguang-native-resume')));
    await assert.doesNotReject(() => page.getByText('没有检测到小组件；可以重新添加，或从桌面小组件列表选择栖光。', { exact: true }).waitFor());
    await page.getByRole('button', { name: /今日任务小组件/ }).click();
    await assert.doesNotReject(() => page.getByRole('button', { name: '添加到桌面' }).waitFor());
    await page.getByRole('button', { name: '添加到桌面' }).click();
    await page.evaluate(() => {
      globalThis.__qiguangPinned = true;
      window.dispatchEvent(new Event('qiguang-native-resume'));
    });
    await assert.doesNotReject(() => page.getByText('桌面小组件已添加。', { exact: true }).waitFor());
    await page.getByRole('button', { name: /今日任务小组件/ }).click();
    await assert.doesNotReject(() => page.getByRole('dialog', { name: '今日任务小组件' }).getByText('已添加', { exact: true }).waitFor());
    assert.equal(await page.evaluate(() => globalThis.__qiguangPinRequested), 2);
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
    const recordDate = await page.locator('.record-date-control input[type="date"]').inputValue();
    await page.getByRole('textbox', { name: '发生了什么' }).fill(marker);
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.goto(`${baseUrl}/#/day/${recordDate}`);
    await assert.doesNotReject(() => page.locator('.day-record-body').getByText(marker, { exact: true }).waitFor());
    await page.goto(`${baseUrl}/?backup-test=${Date.now()}#/system`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '设置', exact: true }).waitFor());
    await page.getByText('显示与语气', { exact: true }).click();
    const displayDialog = page.getByRole('dialog', { name: '显示与语气' });
    await displayDialog.getByRole('combobox', { name: '指导语气' }).selectOption('direct');
    await displayDialog.getByRole('button', { name: '返回' }).click();

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
    await page.getByText('导入与导出', { exact: true }).click();
    const transferDialog = page.getByRole('dialog', { name: '导入与导出' });
    await transferDialog.getByRole('button', { name: '导出全部数据' }).click();
    await assert.doesNotReject(() => page.getByText('备份文件已生成，请妥善保存。', { exact: true }).waitFor());
    await page.waitForFunction(() => Boolean(globalThis.__qiguangBackupText && globalThis.__qiguangBackupMetadata));
    const backup = await page.evaluate(async () => ({ ...globalThis.__qiguangBackupMetadata, text: await globalThis.__qiguangBackupText }));
    assert.equal(backup.connected, true, 'the browser download link should be attached before activation');
    assert.match(backup.filename, /^qiguang-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(JSON.parse(backup.text).format, 'qiguang-backup');

    await page.evaluate(() => {
      localStorage.setItem('qiguang.e2e-delete-local', 'remove');
      sessionStorage.setItem('qiguang.e2e-delete-session', 'remove');
      localStorage.setItem('e2e-delete-local', 'keep');
      sessionStorage.setItem('e2e-delete-session', 'keep');
    });
    await transferDialog.getByRole('button', { name: '返回' }).click();
    await page.getByRole('button', { name: '删除全部数据' }).click();
    const deleteDialog = page.getByRole('dialog', { name: '永久删除全部本地数据' });
    await deleteDialog.getByRole('textbox', { name: '输入“删除全部数据”以确认' }).fill('删除全部数据');
    await deleteDialog.getByRole('button', { name: '永久删除' }).click();
    await assert.doesNotReject(() => page.getByRole('dialog', { name: '选一个陪伴角色' }).waitFor());
    assert.deepEqual(await page.evaluate(() => ({
      localApp: localStorage.getItem('qiguang.e2e-delete-local'),
      sessionApp: sessionStorage.getItem('qiguang.e2e-delete-session'),
      localOther: localStorage.getItem('e2e-delete-local'),
      sessionOther: sessionStorage.getItem('e2e-delete-session'),
    })), {
      localApp: null,
      sessionApp: null,
      localOther: 'keep',
      sessionOther: 'keep',
    }, 'deleting local data clears every qiguang.* key from both browser stores without touching unrelated keys');

    await finishOnboarding(page);
    await page.goto(`${baseUrl}/?restore-test=${Date.now()}#/system`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '设置', exact: true }).waitFor());
    await page.getByText('导入与导出', { exact: true }).click();
    await page.getByRole('dialog', { name: '导入与导出' }).locator('input[type="file"]').setInputFiles({ name: backup.filename, mimeType: 'application/json', buffer: Buffer.from(backup.text) });
    const importDialog = page.getByRole('dialog', { name: '检查备份' });
    await importDialog.getByRole('checkbox', { name: '我已先导出当前数据，并确认合并导入' }).check();
    await importDialog.getByRole('button', { name: '合并并导入' }).click();
    await page.waitForURL(/#\/today$/);
    await page.goto(`${baseUrl}/#/system`);
    await page.getByText('显示与语气', { exact: true }).click();
    const restoredDisplayDialog = page.getByRole('dialog', { name: '显示与语气' });
    assert.equal(await restoredDisplayDialog.getByRole('combobox', { name: '指导语气' }).inputValue(), 'gentle');
    await restoredDisplayDialog.getByRole('button', { name: '返回' }).click();
    await page.goto(`${baseUrl}/#/calendar`);
    await page.getByRole('button', { name: '查找记录' }).click();
    await page.getByRole('searchbox', { name: '搜索记录文字' }).fill(marker);
    await page.getByRole('button', { name: '查找', exact: true }).click();
    await assert.doesNotReject(() => page.locator('.search-results').getByText(marker, { exact: true }).waitFor());
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
    const today = await page.locator('.record-date-control input[type="date"]').inputValue();
    await page.getByRole('textbox', { name: '发生了什么' }).fill('下午连续开会，晚上散步以后平静了一些。');
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.goto(`${baseUrl}/#/day/${today}`);
    await page.locator('.day-evidence-details > summary').click();
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
    await page.locator('.day-evidence-details > summary').click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '测试整理结果' }).waitFor());
    await assert.doesNotReject(() => page.getByText('已核对事件 · 1', { exact: true }).waitFor());
    const successes = page.locator('.success-evidence');
    assert.equal(await successes.getByText('留下了可核对的原始记录。', { exact: true }).count(), 0, 'unlocated AI specificCredit must not become a success fact');
    await assert.doesNotReject(() => successes.getByText('记录中的明确事件', { exact: true }).waitFor());
    assert.equal(await successes.getByText('等待用户决定的推断', { exact: true }).count(), 0);
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
    await decision.getByRole('button', { name: '确认并应用建议' }).click();
    await page.locator('.day-evidence-details > summary').click();
    await assert.doesNotReject(() => page.locator('.success-evidence').getByText('等待用户决定的推断', { exact: true }).waitFor());
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
    const questDialog = page.getByRole('dialog', { name: '安排每日任务' });
    assert.equal(await questDialog.getByRole('textbox', { name: '我想做什么？' }).inputValue(), '明天安排十分钟低压力过渡。');
    await questDialog.getByRole('button', { name: '安排任务' }).click();
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
    await page.getByRole('button', { name: '添加任务' }).click();
    await page.getByText('调整细节（可选）', { exact: true }).click();
    await page.getByRole('textbox', { name: '我想做什么？' }).fill('反馈闭环行动');
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('验证实际结果始终由用户确认');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一个可核对步骤');
    await page.getByRole('dialog', { name: '安排每日任务' }).getByRole('button', { name: '安排任务' }).click();
    await page.getByRole('button', { name: '查看任务：反馈闭环行动' }).click();
    const taskDetails = page.getByRole('dialog', { name: '记录任务结果' });
    await taskDetails.getByText('编辑或删除任务', { exact: true }).click();
    await taskDetails.getByRole('button', { name: '编辑任务：反馈闭环行动' }).click();
    const adjustment = page.getByRole('dialog', { name: '修改任务' });
    await adjustment.getByRole('button', { name: '做个更小版本' }).click();
    await adjustment.getByRole('textbox', { name: '最容易开始的一步（可选）' }).fill('只完成一个五分钟版本');
    await adjustment.getByRole('button', { name: '保存调整' }).click();
    const compactRow = page.locator('.task-list-item').filter({ hasText: '反馈闭环行动' });
    await assert.doesNotReject(() => compactRow.getByText('只完成一个五分钟版本', { exact: true }).waitFor());
    assert.match(await compactRow.innerText(), /5 分钟 · 其他任务[\s\S]*只完成一个五分钟版本/, 'the task row keeps the approved two-line planning summary');
    await page.getByRole('button', { name: '查看任务：反馈闭环行动' }).click();
    const dialog = page.getByRole('dialog', { name: '记录任务结果' });
    await assert.doesNotReject(() => dialog.getByText('完成标准：只完成一个五分钟版本', { exact: true }).waitFor());
    const dialogBox = await dialog.boundingBox();
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    assert.ok(dialogBox && Math.abs(dialogBox.y + dialogBox.height - viewportHeight) <= 2, 'task results should open as the approved bottom sheet');
    await dialog.getByText('更多记录', { exact: true }).click();
    assert.equal(await dialog.getByRole('button', { name: 'AI 帮我判断结果' }).isDisabled(), true, 'AI cannot invent a result before the user writes what happened');
    await dialog.getByRole('textbox', { name: '备注（可选）' }).fill('完成了一部分可核对步骤。');
    assert.equal(await dialog.getByRole('button', { name: 'AI 帮我判断结果' }).isEnabled(), true);
    await page.keyboard.press('Escape');
    await assert.doesNotReject(() => dialog.waitFor({ state: 'detached' }));
    await page.getByRole('button', { name: '查看任务：反馈闭环行动' }).click();
    await assert.doesNotReject(() => dialog.getByRole('textbox', { name: '备注（可选）' }).waitFor());
    assert.equal(await dialog.getByRole('textbox', { name: '备注（可选）' }).inputValue(), '完成了一部分可核对步骤。');
    assert.deepEqual(apiRequests, []);
    await dialog.getByText('更多记录', { exact: true }).click();
    await dialog.getByRole('button', { name: 'AI 帮我判断结果' }).click();
    const consent = page.getByRole('dialog', { name: '允许这一次 AI 理解？' });
    await assert.doesNotReject(() => consent.getByText('将通过同源中转发送本页明确列出的任务信息和反馈文字。API 密钥不在设备中；发送前仍由你主动点击。').waitFor());
    assert.deepEqual(apiRequests, []);
    await consent.getByRole('button', { name: '允许并继续' }).click();
    await assert.doesNotReject(() => dialog.getByText(/AI 建议“部分完成”/).waitFor());
    assert.equal(await xpLedgerCount(page), 0);
    assert.equal(await page.getByRole('button', { name: '查看任务：反馈闭环行动' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '修改任务“反馈闭环行动”的反馈' }).count(), 0);
    await dialog.getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.getByText('反馈已保存；可以在任务卡上撤销。 完成记录：完成了一部分可核对步骤。经验 +3 · 提升方向总经验 3 · 等级 0。', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.locator('.task-settled').getByRole('button', { name: '修改任务“反馈闭环行动”的反馈' }).waitFor());
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

test('weekly review sends summaries instead of journals and adopts its candidate in one click', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    const today = await page.locator('.record-date-control input[type="date"]').inputValue();
    await page.getByRole('textbox', { name: '发生了什么' }).fill('整周原文不应出现在周复盘请求里。');
    await page.getByRole('button', { name: '保存记录' }).click();
    await page.waitForURL(/#\/day\//);
    await page.goto(`${baseUrl}/#/review/${today}`);
    assert.equal(await page.locator('.review-companion').count(), 0);
    await page.getByRole('button', { name: '检查范围并生成' }).click();
    const preview = page.getByRole('dialog', { name: '生成本周复盘' });
    await assert.doesNotReject(() => preview.getByText('不会发送本周日记原文。只发送下面勾选的摘要；AI 不会直接修改任何内容。').waitFor());
    assert.deepEqual(apiRequests, []);
    await preview.getByRole('button', { name: '确认并生成' }).click();
    const consent = page.getByRole('dialog', { name: '允许这一次 AI 周复盘？' });
    await assert.doesNotReject(() => consent.getByText('只发送预览中列出的已确认事实和摘要，不发送整周日记原文。').waitFor());
    assert.deepEqual(apiRequests, []);
    await consent.getByRole('button', { name: '允许并继续' }).click();
    await assert.doesNotReject(() => page.locator('.review-focus-card').getByText('保留可持续节奏', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByRole('heading', { name: '下周重点', exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByRole('heading', { name: '一个小尝试', exact: true }).waitFor());
    assert.equal(await page.getByText('ONE EXPERIMENT', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: '习惯与成长建议' }).count(), 0);
    const reviewHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(reviewHeight <= 2000, `empty weekly evidence should stay compact: ${reviewHeight}px`);
    assert.equal(apiRequests.length, 1);
    const request = JSON.parse(apiRequests[0].body);
    assert.equal(request.operation, 'weekly_review');
    assert.equal(JSON.stringify(request).includes('整周原文不应出现在周复盘请求里。'), false);
    assert.equal(await page.getByRole('dialog', { name: '确认下周重点和小尝试' }).count(), 0);
    await assert.doesNotReject(() => page.getByRole('button', { name: '采用下周计划' }).waitFor());
    await page.getByRole('button', { name: '编辑后采用' }).click();
    const confirm = page.getByRole('dialog', { name: '确认下周重点和小尝试' });
    for (const label of ['下周重点', '一个小尝试', '最小动作', '怎样判断有没有效果', '结束日期', '什么时候停止']) {
      assert.equal(await confirm.getByLabel(label, { exact: true }).count(), 1, `${label} should appear only in the explicit edit dialog`);
    }
    await confirm.getByRole('button', { name: '取消' }).click();
    await assert.doesNotReject(() => confirm.waitFor({ state: 'hidden' }));
    assert.equal(await page.getByRole('button', { name: '采用下周计划' }).count(), 1);
    await page.getByRole('button', { name: '采用下周计划' }).click();
    await assert.doesNotReject(() => page.getByText('下周计划已采用，第一步已排入计划。', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.locator('.review-final-state').getByText('下周计划已采用', { exact: true }).waitFor());
  } finally {
    await context.close();
  }
});

test('today, companion, day review, and task board prefer the real pending MAIN', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    const arrange = async (title) => {
      await page.goto(`${baseUrl}/#/tasks`);
      await page.getByRole('button', { name: '添加任务', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '安排每日任务' });
      await dialog.getByRole('textbox', { name: '我想做什么？' }).fill(title);
      await dialog.getByText('调整细节（可选）', { exact: true }).click();
      await dialog.getByRole('combobox', { name: '任务类型' }).selectOption('main');
      await dialog.getByRole('button', { name: '安排任务' }).click();
      await assert.doesNotReject(() => page.getByRole('heading', { name: title }).waitFor());
    };
    await arrange('已经部分完成的旧 MAIN');
    await page.getByRole('button', { name: '查看任务：已经部分完成的旧 MAIN' }).click();
    const partialDialog = page.getByRole('dialog', { name: '记录任务结果' });
    await partialDialog.getByRole('button', { name: '有进展', exact: true }).click();
    await partialDialog.getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.locator('.task-summary').getByText(/0 待完成/).waitFor());
    await arrange('现在真正待做的新 MAIN');
    const board = page.locator('.task-board');
    assert.deepEqual(await board.locator(':scope > .task-list-item h3').allTextContents(), ['现在真正待做的新 MAIN']);
    const settled = board.locator('.task-settled');
    assert.equal(await settled.getAttribute('open'), '', 'settled tasks should stay visible below pending work');
    assert.equal(await settled.getByRole('heading', { name: '已经部分完成的旧 MAIN' }).isVisible(), true);

    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/day/${today}`);
    const feedback = page.locator('.day-action-results');
    await assert.doesNotReject(() => feedback.getByRole('button', { name: '查看并修改“已经部分完成的旧 MAIN”的任务结果' }).waitFor());
    assert.equal(await feedback.getByRole('button', { name: '查看并修改“现在真正待做的新 MAIN”的任务结果' }).count(), 0, 'pending work is not action feedback');

    await page.goto(`${baseUrl}/#/today`);
    const guide = page.locator('.today-focus-list');
    assert.match(await guide.innerText(), /现在真正待做的新 MAIN/);
    assert.doesNotMatch(await guide.innerText(), /已经部分完成的旧 MAIN/);
    await page.getByRole('button', { name: '生活分身' }).click();
    const companion = page.locator('.character-panel');
    await assert.doesNotReject(() => companion.getByText('今日重点已经在等你了；需要的话，我陪你拆成下一步。', { exact: true }).waitFor());
    assert.doesNotMatch(await companion.innerText(), /现在真正待做的新 MAIN/);
    assert.doesNotMatch(await companion.innerText(), /已经部分完成的旧 MAIN/);
  } finally {
    await context.close();
  }
});

test('a newly created BONUS has no historic debt and remains usable in weekly review', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const habitDialog = await openNewHabitEditor(page);
    await habitDialog.getByRole('searchbox', { name: '习惯名称' }).fill('晚饭后散步');
    await habitDialog.getByRole('button', { name: '建立习惯' }).click();
    const createdHabit = page.locator('.habit-row').filter({ hasText: '晚饭后散步' });
    await createdHabit.getByText('编辑', { exact: true }).click();
    await assert.doesNotReject(() => createdHabit.getByRole('button', { name: '暂停“晚饭后散步”的计划日打卡' }).waitFor());
    await openTaskView(page, '今天');
    await page.getByRole('button', { name: '完成：晚饭后散步' }).click();
    await page.getByRole('dialog', { name: '记录任务结果' }).getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.locator('.task-summary').getByText(/1 已完成/).waitFor());
    await openTaskView(page, '计划');
    const habitStats = page.locator('.habit-row').filter({ hasText: '晚饭后散步' }).locator('.habit-plan-stats');
    await assert.doesNotReject(() => habitStats.getByText('5/5', { exact: true }).waitFor());
    await assert.doesNotReject(() => habitStats.getByText('已完成', { exact: true }).waitFor());

    await page.goto(`${baseUrl}/#/review`);
    await page.getByRole('button', { name: '检查范围并生成' }).click();
    const preview = page.getByRole('dialog', { name: '生成本周复盘' });
    await preview.getByRole('button', { name: '确认并生成' }).click();
    const consent = page.getByRole('dialog', { name: '允许这一次 AI 周复盘？' });
    if (await consent.count()) await consent.getByRole('button', { name: '允许并继续' }).click();
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('alert').filter({ hasText: '习惯动量无效' }).count(), 0);
    await assert.doesNotReject(() => page.getByText('保留可持续节奏', { exact: true }).waitFor());
  } finally {
    await context.close();
  }
});
