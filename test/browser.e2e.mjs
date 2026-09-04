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
  await page.goto(`${baseUrl}/#/today`).catch(async (error) => {
    if (!String(error).includes('ERR_ABORTED')) throw error;
    await page.goto(`${baseUrl}/#/today`);
  });
  const dialog = page.getByRole('dialog', { name: '选一个陪伴角色' });
  await dialog.getByRole('button', { name: `选择${companion}` }).click();
  await dialog.getByRole('button', { name: '写下第一件事' }).click();
  await assert.doesNotReject(() => page.getByRole('textbox', { name: '现在的想法' }).waitFor());
  await page.evaluate(() => localStorage.setItem('qiguang.room-guide-seen.v1', '1'));
}

async function openTaskView(page, name) {
  const tab = page.getByRole('tab', { name, exact: true });
  const panel = page.locator(name === '计划' ? '#task-view-plan' : '#task-view-today');
  if (await tab.getAttribute('aria-selected') !== 'true' || !await panel.isVisible()) await tab.click();
  await assert.doesNotReject(() => panel.waitFor({ state: 'visible' }));
}

async function openNewGoalEditor(page) {
  await page.locator('.task-goals > .section-heading').getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建目标' });
  await dialog.waitFor();
  return dialog;
}

async function scheduleSavedGoalToday(page, goalDialog, goalName) {
  const plannedStage = goalDialog.locator('.goal-stage-editor').first();
  if (await plannedStage.count()) {
    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await plannedStage.locator('input[type="date"]').fill(today);
    await goalDialog.getByRole('button', { name: '保存目标' }).click();
    await assert.doesNotReject(() => page.getByText('目标和子任务已保存。', { exact: true }).waitFor());
    return;
  }
  await goalDialog.getByRole('button', { name: '保存目标' }).click();
  await assert.doesNotReject(() => page.getByText('目标已保存，可以继续添加子任务。', { exact: true }).waitFor());
  await openTaskView(page, '计划');
  const card = page.locator('.goal-row').filter({ hasText: goalName });
  await card.locator(`button[aria-label="为“${goalName}”添加子任务"]`).click();
  const taskDialog = page.getByRole('dialog', { name: '添加子任务' });
  await taskDialog.getByRole('textbox', { name: '子任务名称' }).fill('确定一个可以开始的下一步');
  const today = await page.evaluate(() => {
    const value = new Date();
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  });
  await taskDialog.getByRole('textbox', { name: '完成日期' }).fill(today);
  await taskDialog.getByRole('button', { name: '添加', exact: true }).click();
}

async function openNewHabitEditor(page) {
  await page.locator('.task-habits > .section-heading').getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建习惯' });
  await dialog.waitFor();
  return dialog;
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

test('both complete companion figures and equal navigation remain available offline', async () => {
  for (const companion of ['鱼鱼', '包包']) {
    const { context, page } = await offlineShellPage();
    try {
      await finishOnboarding(page, companion);
      await page.goto(`${baseUrl}/#/today`);
      await page.waitForFunction(() => {
        const image = document.querySelector('.companion-figure');
        return image?.complete && image.naturalWidth > 0;
      });
      await context.setOffline(true);
      await page.reload();
      await page.locator('.companion-figure').waitFor();
      const figure = await page.locator('.companion-figure').evaluate(image => ({
        loaded: image.complete && image.naturalWidth > 0, fit: getComputedStyle(image).objectFit,
        alt: image.alt, source: image.src,
      }));
      assert.equal(figure.loaded, true);
      assert.equal(figure.fit, 'contain');
      assert.equal(figure.alt, companion);
      assert.equal(await page.locator('.room-scene,.room-hotspot').count(), 0);
      await page.getByRole('button', { name: '生活分身', exact: true }).click();
      assert.equal(await page.locator('.character-panel').isVisible(), true);
      await page.locator('.page-header h1').click();
      assert.equal(await page.locator('.character-panel').isVisible(), false);
      for (const name of ['任务', '记录', '轨迹', '设置', '今日']) {
        await page.locator('.bottom-nav').getByRole('link', { name, exact: true }).click();
        await page.locator('.bottom-nav .is-active').filter({ hasText: name }).waitFor();
        const boxes = await page.locator('.bottom-nav .nav-item').evaluateAll(items => items.map(item => {
          const box = item.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }));
        assert.equal(boxes.length, 5);
        assert.ok(boxes.every(box => box.width >= 44 && box.height >= 44));
        boxes.forEach(box => assert.deepEqual(box, boxes[0]));
      }
    } finally { await context.close(); }
  }
});

test('analysis heatmaps keep square cells and contain horizontal overflow', async () => {
  const { context, page } = await freshPage({ now: new Date(2026, 9, 5, 10, 0, 0).getTime() });
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/task-analysis`);

    assert.equal(await page.locator('.analysis-range-select').count(), 0, 'task analysis must not repeat the time-range control in the header');
    assert.equal(await page.locator('.analysis-heat-legend').count(), 0, 'task analysis must not show the redundant heatmap legend');
    const categoryLabels = await page.locator('.analysis-category-tabs > button').allTextContents();
    assert.deepEqual(categoryLabels, ['全部', '身体', '心理', '关系', '工作/学习', '玩乐'], 'task analysis must use the same five dimensions as the rest of the app');
    assert.equal(await page.locator('.analysis-category-tabs > button').filter({ hasText: /^(学习|生活)$/ }).count(), 0, 'task analysis must not restore the retired study/life split');

    for (const width of [320, 393, 430]) {
      await page.setViewportSize({ width, height: 800 });
      const titleOffset = await page.getByRole('heading', { name: '任务分析', exact: true }).evaluate((heading) => {
        const box = heading.getBoundingClientRect();
        const back = heading.parentElement.querySelector('button').getBoundingClientRect();
        return box.left - back.right;
      });
      assert.ok(titleOffset >= 0 && titleOffset <= 20, `task analysis title must align after its back action at ${width}px`);
      for (const [tabName, weeks] of [['12周', 12], ['半年', 26], ['全年', 52]]) {
        await page.getByRole('tab', { name: tabName, exact: true }).click();
        const geometry = await page.locator('.analysis-heat-scroll').evaluate((viewport) => {
          const cells = [...viewport.querySelectorAll('.analysis-heat-cell')];
          const lastMonth = viewport.querySelector('.analysis-heat-months span:last-child');
          return {
            pageClientWidth: document.documentElement.clientWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
            clientWidth: viewport.clientWidth,
            scrollWidth: viewport.scrollWidth,
            overflowX: getComputedStyle(viewport).overflowX,
            cells: cells.map((cell) => {
              const box = cell.getBoundingClientRect();
              return { width: box.width, height: box.height };
            }),
            lastMonth: lastMonth ? { text: lastMonth.textContent, column: getComputedStyle(lastMonth).gridColumnStart } : null,
          };
        });

        assert.equal(geometry.cells.length, weeks * 7);
        assert.equal(geometry.cells.every((cell) => Math.abs(cell.width - cell.height) < 0.01), true, `${weeks} weeks must stay square at ${width}px`);
        assert.ok(geometry.pageScrollWidth <= geometry.pageClientWidth, `${weeks} weeks must not overflow the page at ${width}px`);
        if (weeks === 12) {
          assert.deepEqual(geometry.lastMonth, { text: '10月', column: '12' }, 'the widest month label should occupy the final column');
          assert.ok(geometry.scrollWidth <= geometry.clientWidth, `12 weeks must fit without chart overflow at ${width}px`);
        } else {
          assert.equal(geometry.overflowX, 'auto');
          assert.ok(geometry.scrollWidth > geometry.clientWidth, `${weeks} weeks must scroll inside the chart at ${width}px`);
        }
      }
    }
  } finally {
    await context.close();
  }
});

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
    await page.locator('.life-diary-composer').waitFor();
    assert.equal(await page.locator('.bottom-nav').count(), 1, 'recording should retain the primary page navigation');
    assert.deepEqual(await page.locator('.record-subtab').allTextContents(), ['生活日记', '每日复盘']);
    assert.equal(await page.getByRole('button', { name: '生活日记', pressed: true }).count(), 1);
    assert.equal(await page.getByText('模板', { exact: true }).count(), 0, 'recording should not expose template selection');
    assert.equal(await page.locator('.record-kind-hint').count(), 0, 'record types must not repeat their prompt below the selector');
    assert.equal(await page.getByRole('textbox', { name: '今日一句' }).count(), 0, 'recording should not ask for a day title before writing');
    assert.equal(await page.locator('.record-type-option').count(), 0, 'recording should not ask for a category before writing');
    assert.equal(await page.getByRole('button', { name: '图片' }).count(), 1, 'life diary should support one local image attachment');
    assert.equal(await page.getByRole('button', { name: 'AI整理' }).count(), 1, 'life diary should expose post-writing AI filing');
    const dateControl = page.locator('.record-date-control');
    await assert.doesNotReject(() => dateControl.waitFor());
    assert.ok((await dateControl.boundingBox())?.height >= 44, 'the direct date control must remain touch-safe');
    const input = page.getByRole('textbox', { name: '现在的想法' });
    assert.equal(await input.getAttribute('placeholder'), '现在的想法');
    const editorLayout = await input.evaluate((element) => ({ height: element.getBoundingClientRect().height, radius: getComputedStyle(element).borderRadius }));
    assert.ok(editorLayout.height >= 60 && editorLayout.height <= 150 && editorLayout.radius === '0px', 'life diary uses a multiline writing area inside one shared composer frame');
    const recordDate = await dateControl.locator('input[type="date"]').inputValue();
    await input.fill('电脑自动回归：记录一件真实发生的事。');
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    await page.getByRole('button', { name: '发送' }).click();
    await page.waitForURL(new RegExp(`#\\/day\\/${recordDate}$`));
    await assert.doesNotReject(() => page.locator('.journal-sheet').waitFor());
    await assert.doesNotReject(() => page.locator('.day-record-body').getByText('电脑自动回归：记录一件真实发生的事。', { exact: true }).waitFor());

    await page.locator('.day-record-row').click();
    let detail = page.getByRole('dialog', { name: '记录详情' });
    await detail.getByRole('textbox', { name: '正文' }).fill('电脑自动回归：修改后的正文。');
    await detail.getByRole('button', { name: '保存修改' }).click();
    await assert.doesNotReject(() => page.locator('.day-record-body').getByText('电脑自动回归：修改后的正文。', { exact: true }).waitFor());
    await page.locator('.day-record-row').click();
    detail = page.getByRole('dialog', { name: '记录详情' });
    await detail.locator('.record-detail-more > summary').click();
    await detail.getByRole('button', { name: '修改历史' }).click();
    await page.getByRole('button', { name: '撤销最近修改' }).click();
    await assert.doesNotReject(() => page.locator('.day-record-body').getByText('电脑自动回归：记录一件真实发生的事。', { exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/today`);
    const portrait = page.locator('.companion-figure');
    await portrait.waitFor();
    assert.equal(await portrait.evaluate((image) => image.complete && image.naturalWidth > 0), true);
    assert.equal(await page.locator('.room-scene, .room-hotspot').count(), 0);
    assert.equal(await page.locator('.status-item').count(), 5);
    const navSizes = await page.locator('.bottom-nav .nav-item').evaluateAll((items) => items.map((item) => {
      const bounds = item.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }));
    assert.equal(navSizes.length, 5);
    for (const size of navSizes) assert.deepEqual(size, navSizes[0], 'every selected navigation area has the same geometry');
    await page.getByRole('button', { name: '生活分身', exact: true }).click();
    const panel = page.locator('.character-panel');
    assert.equal(await panel.isVisible(), true);
    await panel.getByRole('button', { name: '再记一件事' }).click();
    await page.waitForURL(/#[/]record$/);
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
    await page.locator('.page-tasks .page-header-text-action').waitFor();
    const headerActionLines = await page.locator('.page-header-text-action').evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      return range.getClientRects().length;
    });
    assert.equal(headerActionLines, 1, 'short page-header actions must not wrap one Chinese character per line');
    await page.goto(`${baseUrl}/#/record`);
    const promptSizes = await page.locator('.record-subtab, .life-diary-send, .life-diary-image-button').evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }));
    assert(promptSizes.length === 4 && promptSizes.every((box) => box.width >= 44 && box.height >= 44), 'record tabs and composer actions must remain touch-safe');
    assert.equal(await page.locator('.record-number-button, .record-attachment-button').count(), 0, 'recording keeps only the writing controls in use');
    await page.goto(`${baseUrl}/#/calendar`);
    await page.getByRole('button', { name: '查找记录' }).click();
    await assert.doesNotReject(() => page.getByText('选择日期', { exact: true }).waitFor());
    const trailWidths = await page.locator('.trail-tab').evaluateAll((tabs) => tabs.map((tab) => Math.round(tab.getBoundingClientRect().width)));
    assert.equal(new Set(trailWidths).size, 1, 'calendar, growth, and weekly review tabs must divide the row equally');
    const safeBottom = await page.locator('#main-content').evaluate((main) => ({
      pagePadding: Number.parseFloat(getComputedStyle(main).paddingBottom),
      navigationHeight: document.querySelector('.bottom-nav')?.getBoundingClientRect().height ?? 0,
    }));
    assert.ok(safeBottom.pagePadding >= safeBottom.navigationHeight + 24, `scrolling pages must reserve navigation plus 24px: ${JSON.stringify(safeBottom)}`);
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
      { title: '高级', sections: ['行动规则'] },
    ]);
    assert.doesNotMatch(await page.locator('.page-system').textContent(), /分类与提升方向|生活分类|提升方向/, 'settings must not expose the retired classification systems');
    await page.getByText('状态自评', { exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '状态自评' });
    assert.equal(await dialog.getByText('不知道怎么打分时，用问卷判断过去 7 天的身体、心理、关系、工作和玩乐状态。', { exact: true }).count(), 0);
    await dialog.getByRole('button', { name: '返回' }).click();
    await page.getByRole('button', { name: /AI 整理/ }).click();
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

test('goal, habit, and growth surfaces use only the shared five dimensions', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');

    const goalDialog = await openNewGoalEditor(page);
    assert.equal(await goalDialog.getByRole('textbox', { name: '目标名称' }).count(), 1);
    assert.equal(await goalDialog.getByLabel('完成日期').count(), 1);
    assert.doesNotMatch(await goalDialog.textContent(), /分类与提升方向|生活分类|提升方向|想提升/, 'new goals must derive their dimension from child tasks instead of asking for an old classification');
    await goalDialog.getByRole('button', { name: '取消', exact: true }).click();

    const habitDialog = await openNewHabitEditor(page);
    assert.equal(await habitDialog.getByRole('combobox', { name: '五维状态' }).count(), 1, 'new habits need one five-dimension selector');
    assert.doesNotMatch(await habitDialog.textContent(), /分类与提升方向|生活分类|提升方向/, 'new habits must not ask for a second classification system');
    assert.equal(await habitDialog.locator('label.field-label').filter({ hasText: /^分类/ }).count(), 0, 'the five-dimension field must not retain the generic old label');
    await habitDialog.getByRole('button', { name: '取消', exact: true }).click();

    await page.goto(`${baseUrl}/#/growth`);
    const dimensionCards = page.locator('.growth-dimension-grid > .growth-dimension-card');
    await dimensionCards.first().waitFor();
    assert.equal(await dimensionCards.count(), 5, 'growth must render one card for each dimension');
    assert.deepEqual(await dimensionCards.locator('h3').allTextContents(), ['身体', '心理', '关系', '工作/学习', '玩乐']);
    assert.doesNotMatch(await page.locator('.page-growth').textContent(), /生活分类|提升方向|成长分支|管理提升方向|添加提升方向/, 'growth must not expose old branch maintenance');
  } finally {
    await context.close();
  }
});

test('backup reminder is gentle and dismissible', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.getByRole('textbox', { name: '现在的想法' }).fill('备份提醒回归使用的一条真实记录。');
    await page.getByRole('button', { name: '发送' }).click();
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
    await page.getByRole('textbox', { name: '现在的想法' }).fill(privateBody);
    await page.getByRole('button', { name: '发送' }).click();
    await assert.doesNotReject(() => page.waitForURL(/#\/day\//));
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    assert.equal(await page.locator('.plan-section-count').count(), 0, 'plan headings should not repeat total counts');
    assert.equal(await page.getByText('管理习惯', { exact: true }).count(), 0, 'habit creation should live in the section heading');
    const habitDialog = await openNewHabitEditor(page);
    await habitDialog.getByRole('searchbox', { name: '习惯名称' }).fill('晚饭后散步');
    await habitDialog.getByText('计数设置（可选）', { exact: true }).click();
    await habitDialog.getByRole('combobox', { name: '完成方式' }).selectOption('count');
    await habitDialog.getByRole('spinbutton', { name: '每日目标次数' }).fill('3');
    await habitDialog.getByRole('button', { name: '建立习惯' }).click();
    const createdHabit = page.locator('.habit-row').filter({ hasText: '晚饭后散步' });
    await createdHabit.getByText('编辑', { exact: true }).click();
    await assert.doesNotReject(() => createdHabit.getByRole('button', { name: '暂停“晚饭后散步”的计划日打卡' }).waitFor());
    await page.goto(`${baseUrl}/#/today`);

    await assert.doesNotReject(() => page.locator('.today-record-preview').getByText(privateBody, { exact: true }).waitFor());
    await assert.doesNotReject(() => page.locator('.today-record-preview').getByRole('button', { name: '查看今天 ›' }).waitFor());
    assert.equal(await page.locator('.record-fab').count(), 0);
    await page.locator('.today-record-row').click();
    await assert.doesNotReject(() => page.getByRole('dialog', { name: '记录详情' }).waitFor());
    await page.keyboard.press('Escape');
    await assert.doesNotReject(() => page.getByRole('heading', { name: '今天要做的' }).waitFor());
    await assert.doesNotReject(() => page.getByText('今天 0/3 次', { exact: true }).waitFor());
    await page.getByRole('button', { name: /记录今天的习惯“晚饭后散步”，当前 0\/3次/ }).click();
    await page.getByRole('button', { name: /记录今天的习惯“晚饭后散步”，当前 1\/3次/ }).click();
    await assert.doesNotReject(() => page.getByText('今天 2/3 次', { exact: true }).waitFor());
    await page.getByRole('button', { name: '查看习惯：晚饭后散步' }).click();
    const habitDetail = page.getByRole('dialog', { name: '习惯详情' });
    assert.equal(await habitDetail.locator('.habit-week-legend').count(), 0);
    await habitDetail.getByRole('button', { name: '返回' }).click();
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
    await editDialog.getByRole('searchbox', { name: '最简单做法' }).fill('先走三分钟');
    await editDialog.getByRole('combobox', { name: '状态', exact: true }).selectOption('paused');
    await editDialog.getByRole('button', { name: '保存习惯' }).click();
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const pausedHabits = page.locator('.paused-habit-management');
    await pausedHabits.locator(':scope > summary').click();
    await assert.doesNotReject(() => pausedHabits.getByText('晚饭后散步十五分钟', { exact: true }).waitFor());
    assert.equal(await page.getByText('晚饭后散步', { exact: true }).count(), 0, 'the plan must not keep the old habit snapshot');
    await pausedHabits.getByRole('button', { name: '编辑习惯“晚饭后散步十五分钟”' }).click();
    const resumeDialog = page.getByRole('dialog', { name: '编辑习惯' });
    await resumeDialog.getByRole('combobox', { name: '状态', exact: true }).selectOption('active');
    await resumeDialog.getByRole('checkbox', { name: '按计划日加入今日任务' }).check();
    await resumeDialog.getByRole('button', { name: '保存习惯' }).click();
    await page.goto(`${baseUrl}/#/today`);
    await assert.doesNotReject(() => page.getByRole('button', { name: /记录今天的习惯“晚饭后散步十五分钟”/ }).waitFor());
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
    await dialog.getByRole('textbox', { name: '任务名称' }).focus();
    const layout = await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        viewportHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
        cssViewportHeight: getComputedStyle(element).getPropertyValue('--dialog-viewport-height').trim(),
        scrollable: element.querySelector('.dialog-content').scrollHeight > element.querySelector('.dialog-content').clientHeight,
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

test('a future task can only be managed from Plan', async () => {
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
    await dialog.getByRole('textbox', { name: '任务名称' }).fill('喝三杯水');
    await dialog.getByRole('textbox', { name: '安排日期' }).fill(futureDate);
    await dialog.getByRole('button', { name: '安排任务' }).click();

    await openTaskView(page, '计划');
    await page.getByText('之后已安排 · 1', { exact: true }).waitFor();
    const plannedTask = page.locator('article').filter({ has: page.getByRole('heading', { name: '喝三杯水' }) });
    await assert.doesNotReject(() => plannedTask.waitFor());
    assert.equal(await page.locator('.page-header').getByRole('button', { name: '管理', exact: true }).count(), 0);
    assert.equal(await plannedTask.getByRole('button', { name: '编辑计划：喝三杯水' }).count(), 1);
    assert.equal(await plannedTask.getByRole('button', { name: '删除任务：喝三杯水' }).count(), 1);
    assert.equal(await plannedTask.getByRole('button', { name: /完成|记录一次|查看任务/ }).count(), 0, '计划页只允许管理，不能打卡');
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
    await dialog.getByRole('textbox', { name: '任务名称' }).fill('已有任务');
    await dialog.getByRole('button', { name: '安排任务' }).click();
    await page.getByRole('heading', { name: '已有任务' }).waitFor();

    assert.equal(await page.getByRole('textbox', { name: '添加今日任务' }).count(), 0, '任务页不再叠加第二条固定输入栏');
    const add = page.getByRole('button', { name: '添加任务', exact: true });
    const addBox = await add.boundingBox();
    assert.ok(addBox && addBox.width >= 44 && addBox.height >= 44, '添加任务入口应保持完整触控区域');
    await add.click();
    const directDialog = page.getByRole('dialog', { name: '安排每日任务' });
    await directDialog.getByRole('textbox', { name: '任务名称' }).fill('直接添加');
    await directDialog.getByRole('button', { name: '安排任务' }).click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '直接添加' }).waitFor());
    const directRow = page.locator('.task-list-item').filter({ hasText: '直接添加' });
    const actionBox = await page.getByRole('button', { name: '完成：直接添加' }).boundingBox();
    const circleBox = await directRow.locator('.task-check').boundingBox();
    assert.ok(actionBox && actionBox.width >= 44 && actionBox.height >= 44, 'the whole task row needs a safe touch target');
    assert.ok(circleBox && circleBox.width <= 20 && circleBox.height <= 20, 'the visible incomplete circle should stay compact');
    assert.doesNotMatch(await directRow.innerText(), /临时任务|5 分钟|最低动作/, 'quick tasks must not invent or repeat planning metadata');
    assert.equal(await page.getByText('今日重点', { exact: true }).count(), 0);
    assert.equal(await page.getByText('其他任务', { exact: true }).count(), 0);
    await directRow.getByRole('button', { name: '拖动调整“直接添加”的位置' }).press('ArrowUp');
    await assert.doesNotReject(() => page.getByText('任务顺序已保存。', { exact: true }).waitFor());
    assert.deepEqual(await page.locator('.task-today-list h3').allTextContents(), ['直接添加', '已有任务']);
    await page.reload();
    await page.getByRole('heading', { name: '直接添加' }).waitFor();
    assert.deepEqual(await page.locator('.task-today-list h3').allTextContents(), ['直接添加', '已有任务']);
    await page.getByRole('button', { name: '完成：直接添加' }).click();
    const completionToast = page.locator('.toast.is-completion');
    await completionToast.waitFor({ state: 'visible' });
    assert.match(await completionToast.innerText(), /^任务已完成\n工作\/学习 \+4 成长值$/);
    const completedRow = page.locator('.task-list-item.is-completed').filter({ hasText: '直接添加' });
    assert.equal(await completedRow.locator('.task-check').textContent(), '✓');
    assert.equal(await completedRow.getByRole('heading', { name: '直接添加' }).evaluate((element) => getComputedStyle(element).textDecorationLine), 'line-through');
    assert.equal(await page.getByRole('dialog').count(), 0, 'quick add should not open another layer');

    await add.click();
    const todayDialog = page.getByRole('dialog', { name: '安排每日任务' });
    await todayDialog.getByRole('textbox', { name: '任务名称' }).fill('今日整行完成');
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

test('a task keeps its title readable in the flat list', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '添加任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '安排每日任务' });
    await dialog.getByRole('textbox', { name: '任务名称' }).fill('读三页书');
    await dialog.getByRole('button', { name: '安排任务' }).click();
    const row = page.locator('.task-list-item').filter({ hasText: '读三页书' });
    const titleBox = await row.getByRole('heading', { name: '读三页书' }).boundingBox();
    assert.ok(titleBox && titleBox.width > 100, 'task titles must not collapse into the completion-control column');
    assert.equal(await row.getByRole('button', { name: '完成：读三页书' }).count(), 1);
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
    await create.getByRole('textbox', { name: '任务名称' }).fill('整理桌面十分钟');
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
    await dialog.getByRole('textbox', { name: '任务名称' }).fill('检查点击焦点');
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
    await taskDialog.getByRole('textbox', { name: '任务名称' }).fill('整理今日清单');
    await taskDialog.getByRole('button', { name: '安排任务' }).click();

    await openTaskView(page, '计划');
    const goalDialog = await openNewGoalEditor(page);
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('完成数学错题复习计划');
    assert.doesNotMatch(await goalDialog.textContent(), /生活分类|提升方向|想提升/, 'goal creation must not suggest either retired classification');
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

test('legacy capacity tasks stay hidden from current Today and Plan surfaces', async () => {
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
    assert.equal(await page.locator('#task-view-today').getByText(titles[0], { exact: true }).count(), 0, '旧任务不得回到今天的执行面');
    await openTaskView(page, '计划');
    for (const title of titles) assert.equal(await page.getByText(title, { exact: true }).count(), 0);
    assert.equal(await page.getByText(/旧版未安排任务|旧版任务/).count(), 0, 'retired capacity language must not leak into the current product');
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
    await assert.doesNotReject(() => page.locator('.growth-dimension-card').first().waitFor());
    assert.equal(await page.locator('.growth-dimension-card').count(), 5, 'growth keeps one concise card for each shared dimension');
    const growthLayout = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth }));
    assert.ok(growthLayout.height <= 1800, `empty five-dimension growth page is too long: ${growthLayout.height}px`);
    assert.ok(growthLayout.width <= 390, `empty growth page overflows: ${growthLayout.width}px`);

    await page.goto(`${baseUrl}/#/review`);
    assert.equal(await page.locator('.review-companion').count(), 0, 'weekly review should start with evidence instead of an explanatory companion card');
    assert.equal(await page.getByText('WEEKLY REVIEW', { exact: true }).count(), 0);

    await page.goto(`${baseUrl}/#/calendar`);
    await page.locator('.calendar-monthly-details > summary').click();
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

test('one state dimension shows its related tasks and records and can be assessed alone', async () => {
  const { context, page } = await freshPage({ now: new Date(2026, 8, 2, 10, 0, 0).getTime() });
  try {
    await finishOnboarding(page);
    await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('qiguang');
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
      });
      const transaction = database.transaction(['entries', 'events', 'observations', 'quests', 'questFeedback'], 'readwrite');
      const timestamp = '2026-09-02T02:00:00.000Z';
      const common = { createdAt: timestamp, updatedAt: timestamp, version: 1 };
      const entryId = crypto.randomUUID();
      const growthOnlyEntryId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const growthOnlyEventId = crypto.randomUUID();
      const questId = crypto.randomUUID();
      const feedbackId = crypto.randomUUID();
      transaction.objectStore('entries').add({
        id: entryId, localDate: '2026-09-02', body: '午后散步二十分钟，回来以后精神好多了。', inputMethod: 'text',
        kind: 'journal', analysisStatus: 'succeeded', ...common,
      });
      transaction.objectStore('entries').add({
        id: growthOnlyEntryId, localDate: '2026-09-02', body: '整理了凌乱很久的书桌。', inputMethod: 'text',
        kind: 'success', analysisStatus: 'succeeded', ...common,
      });
      transaction.objectStore('events').add({
        id: eventId, analysisId: crypto.randomUUID(), candidateId: 'walk', localDate: '2026-09-02', sourceEntryIds: [entryId],
        title: '午后散步', description: '散步后精力恢复', sourceType: 'explicit', confirmation: 'confirmed', confidence: 'high',
        evidence: [{ entryId, quote: '散步二十分钟', start: 2, end: 9 }],
        stateImpactCandidates: [{ dimension: 'energy', direction: 'positive', strength: 'small', suggestedDelta: 5, reason: '散步后更有精神' }],
        growthEvidenceCandidate: null, active: true, userEdited: false, ...common,
      });
      transaction.objectStore('events').add({
        id: growthOnlyEventId, analysisId: crypto.randomUUID(), candidateId: 'tidy-desk', localDate: '2026-09-02', sourceEntryIds: [growthOnlyEntryId],
        title: '整理书桌', description: '完成了一次照顾身体环境的行动', sourceType: 'explicit', confirmation: 'confirmed', confidence: 'high',
        evidence: [{ entryId: growthOnlyEntryId, quote: '整理了凌乱很久的书桌', start: 0, end: 13 }],
        stateImpactCandidates: [],
        growthEvidenceCandidate: {
          dimension: 'energy', suggestedXp: 1, matchedQuestId: null, evidenceType: 'practice',
          description: '整理了书桌', isMilestoneCandidate: false, reason: '记录了一次真实行动',
        },
        active: true, userEdited: false, ...common,
      });
      transaction.objectStore('quests').add({
        id: questId, localDate: '2026-09-02', type: 'side', sourceType: 'manual', actionId: `manual:${questId}`, settlementVersion: 1,
        title: '晚饭后拉伸十分钟', reason: '照顾身体', minimumAction: '拉伸一分钟', difficulty: 'light', dimension: 'energy',
        status: 'completed', aiSuggested: false, userModified: false, ...common,
      });
      const mindQuestId = crypto.randomUUID();
      transaction.objectStore('quests').add({
        id: mindQuestId, localDate: '2026-09-02', type: 'side', sourceType: 'manual', actionId: `manual:${mindQuestId}`, settlementVersion: 0,
        title: '安静呼吸三分钟', reason: '照顾情绪', minimumAction: '呼吸一次', difficulty: 'light', dimension: 'mind',
        status: 'pending', aiSuggested: false, userModified: false, ...common,
      });
      transaction.objectStore('questFeedback').add({
        id: feedbackId, questId, result: 'completed', note: '', actual: '完成拉伸', settlementVersion: 1, completedDate: '2026-09-02', ...common,
      });
      const observations = transaction.objectStore('observations');
      observations.add({
        id: crypto.randomUUID(), assessmentId: crypto.randomUUID(), localDate: '2026-09-01', dimension: 'energy',
        kind: 'user-self-assessment', value: 60, active: true, observedAt: '2026-09-01T02:00:00.000Z', ...common,
      });
      observations.add({
        id: crypto.randomUUID(), assessmentId: crypto.randomUUID(), localDate: '2026-09-02', dimension: 'energy',
        kind: 'event-impact', delta: 5, evidenceId: eventId, reason: '散步后更有精神', active: true, observedAt: timestamp, ...common,
      });
      observations.add({
        id: crypto.randomUUID(), assessmentId: crypto.randomUUID(), localDate: '2026-09-02', dimension: 'energy',
        kind: 'event-impact', delta: 4, evidenceId: feedbackId, reason: '完成拉伸', active: true, observedAt: timestamp, ...common,
      });
      await new Promise((resolve, reject) => {
        transaction.addEventListener('complete', resolve, { once: true });
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
      });
      database.close();
    });

    await page.goto(`${baseUrl}/#/today`);
    await page.locator('.status-item').filter({ hasText: '身体' }).click();
    const detail = page.getByRole('dialog', { name: '身体当前状态' });
    await assert.doesNotReject(() => detail.waitFor());
    const relatedTasks = detail.locator('.state-related-section').filter({ hasText: '相关任务' });
    await assert.doesNotReject(() => relatedTasks.getByText('晚饭后拉伸十分钟', { exact: true }).waitFor());
    await assert.doesNotReject(() => relatedTasks.getByText('+4', { exact: true }).waitFor());
    assert.equal(await relatedTasks.getByText('安静呼吸三分钟', { exact: true }).count(), 0, 'other dimensions must stay out of the task list');
    const relatedRecords = detail.locator('.state-related-section').filter({ hasText: '相关记录' });
    await assert.doesNotReject(() => relatedRecords.getByText('午后散步二十分钟，回来以后精神好多了。', { exact: true }).waitFor());
    await assert.doesNotReject(() => relatedRecords.getByText('+5', { exact: true }).waitFor());
    const growthOnlyRecord = relatedRecords.locator('.state-related-row').filter({ hasText: '整理了凌乱很久的书桌。' });
    await assert.doesNotReject(() => growthOnlyRecord.waitFor());
    assert.equal(await growthOnlyRecord.locator('.state-related-delta').count(), 0, '仅有成长记录时不应伪造状态加减分');
    for (const width of [320, 393, 430]) {
      await page.setViewportSize({ width, height: 800 });
      const geometry = await detail.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.ok(geometry.scrollWidth <= geometry.clientWidth, `state detail must not overflow at ${width}px`);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const largeTextGeometry = await detail.evaluate((element) => ({
      dialogWidth: element.clientWidth,
      dialogScrollWidth: element.scrollWidth,
      pageWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(largeTextGeometry.dialogScrollWidth <= largeTextGeometry.dialogWidth, 'state detail must not overflow at 200% text');
    assert.ok(largeTextGeometry.pageScrollWidth <= largeTextGeometry.pageWidth, 'state detail must keep the page contained at 200% text');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

    await detail.getByRole('button', { name: '评估这一项' }).click();
    const questionnaire = page.getByRole('dialog', { name: '身体状态自评' });
    await assert.doesNotReject(() => questionnaire.getByText('身体，第 1/6 题', { exact: true }).waitFor());
    for (let index = 0; index < 6; index += 1) {
      await questionnaire.getByRole('button', { name: index === 5 ? '从不' : '几乎总是', exact: true }).click();
    }
    await assert.doesNotReject(() => questionnaire.getByText('100', { exact: true }).waitFor());
    await questionnaire.getByRole('button', { name: '保存分数' }).click();
    await page.getByRole('status').filter({ hasText: '身体状态已更新。' }).waitFor();
    const assessedDimensions = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('qiguang');
      request.addEventListener('error', () => reject(request.error));
      request.addEventListener('success', () => {
        const database = request.result;
        const values = database.transaction('observations', 'readonly').objectStore('observations').getAll();
        values.addEventListener('success', () => {
          database.close();
          resolve([...new Set(values.result.filter((item) => item.kind === 'user-self-assessment' && item.localDate === '2026-09-02').map((item) => item.dimension))]);
        });
        values.addEventListener('error', () => { database.close(); reject(values.error); });
      });
    }));
    assert.deepEqual(assessedDimensions, ['energy'], 'single-dimension assessment must not overwrite the other four dimensions');
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
    const input = page.getByRole('textbox', { name: '现在的想法' });
    const today = await page.locator('.record-date-control input[type="date"]').inputValue();
    assert.equal(await page.locator('.record-type-option').count(), 0, 'life diary must not ask users to classify before writing');
    assert.equal(await input.getAttribute('placeholder'), '现在的想法', 'the composer stays as a plain thought input');
    assert.equal(await page.getByRole('checkbox', { name: '记为成功记录' }).count(), 0);
    await input.fill('完成并核对了一次本地回归');
    await page.getByRole('button', { name: '发送' }).click();
    await assert.doesNotReject(() => page.waitForURL(new RegExp(`#\\/day\\/${today}$`)));
    await page.locator('.day-evidence-details > summary').click();
    await assert.doesNotReject(() => page.getByRole('heading', { name: '今天的整理' }).waitFor());
    assert.equal(await page.locator('.success-evidence').getByText('完成并核对了一次本地回归', { exact: true }).count(), 0, 'wording alone must not promote a life diary entry');
    assert.deepEqual(apiRequests, []);

    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const goalDialog = await openNewGoalEditor(page);
    assert.equal(await goalDialog.getByText('先写一句话就够了。系统会先给出下一步，所有内容都可以再修改。', { exact: true }).count(), 0);
    assert.equal(await goalDialog.getByText('需要帮你把目标变小吗？', { exact: true }).count(), 0);
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('发布一篇文章');
    await goalDialog.getByRole('button', { name: 'AI 帮我拆成子任务' }).click();
    const preview = page.getByRole('dialog', { name: '检查目标拆解发送范围' });
    await assert.doesNotReject(() => preview.getByText(/AI 只会读取下面勾选的内容/).waitFor());
    assert.deepEqual(apiRequests, []);
    await preview.getByRole('button', { name: '确认范围并生成草案' }).click();
    const consent = page.getByRole('dialog', { name: '允许这一次目标拆解？' });
    await consent.getByRole('button', { name: '允许并继续' }).click();
    await assert.doesNotReject(() => goalDialog.getByRole('heading', { name: '子任务' }).waitFor());
    await assert.doesNotReject(() => goalDialog.getByRole('textbox', { name: '任务名称' }).first().waitFor());
    assert.equal(await goalDialog.getByRole('textbox', { name: '目标名称' }).inputValue(), '发布一篇文章', 'AI 拆解不能改写用户原话');
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('发布一本文章');
    assert.equal(await goalDialog.locator('.goal-plan-editor').isVisible(), false);
    await assert.doesNotReject(() => goalDialog.getByText('目标或日期已改变，请重新拆分。').waitFor());
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill('发布一篇文章');
    await goalDialog.getByRole('button', { name: 'AI 帮我拆成子任务' }).click();
    const secondPreview = page.getByRole('dialog', { name: '检查目标拆解发送范围' });
    await secondPreview.getByRole('button', { name: '确认范围并生成草案' }).click();
    await assert.doesNotReject(() => goalDialog.getByRole('heading', { name: '子任务' }).waitFor());
    await scheduleSavedGoalToday(page, goalDialog, '发布一篇文章');
    await assert.doesNotReject(() => page.getByRole('heading', { name: '发布一篇文章' }).waitFor());
    const savedGoal = page.locator('.goal-row').filter({ hasText: '发布一篇文章' });
    await savedGoal.getByRole('button', { name: '查看目标“发布一篇文章”的子任务' }).click();
    const savedGoalDetail = page.getByRole('dialog', { name: '目标详情' });
    await assert.doesNotReject(() => savedGoalDetail.getByText('完成第一段可检查成果', { exact: true }).waitFor());
    assert.equal(await savedGoalDetail.getByRole('button', { name: /标为完成|撤销完成/ }).count(), 0, '目标详情只能管理，不能打卡子任务');
    assert.equal(await savedGoalDetail.getByRole('button', { name: '编辑子任务：完成第一段可检查成果' }).count(), 1);
    await savedGoalDetail.getByRole('button', { name: '返回' }).click();
    await assert.doesNotReject(() => savedGoal.getByText('编辑', { exact: true }).waitFor());
    await openTaskView(page, '今天');
    await assert.doesNotReject(() => page.getByRole('heading', { name: '完成第一段可检查成果' }).waitFor());
    await assert.doesNotReject(() => page.locator('.task-summary').getByText(/1 待完成/).waitFor());
    assert.equal(await page.getByText(/\d\/1 MAIN/).count(), 0);
    assert.equal(apiRequests.length, 2);
    const request = JSON.parse(apiRequests.at(-1).body);
    assert.equal(request.operation, 'goal_decomposition');
    assert.deepEqual(Object.keys(request.userInput).sort(), ['completionEvidence', 'result', 'targetDate', 'why']);
    assert.equal('entries' in request.context, false);

    await page.getByRole('button', { name: '完成：完成第一段可检查成果' }).click();
    await assert.doesNotReject(() => page.getByRole('button', { name: '完成：完成第一段可检查成果' }).waitFor({ state: 'detached' }));
    assert.equal(await xpLedgerCount(page), 2, '完成子任务会分别结算任务和子任务成长值');
    await openTaskView(page, '计划');
    await page.locator('.goal-row').filter({ hasText: '发布一篇文章' }).getByRole('button', { name: '查看目标“发布一篇文章”的子任务' }).click();
    const completedGoalDetail = page.getByRole('dialog', { name: '目标详情' });
    await assert.doesNotReject(() => completedGoalDetail.getByText('1 / 2 子任务', { exact: true }).waitFor());
    assert.equal(await completedGoalDetail.getByRole('button', { name: /标为完成|撤销完成/ }).count(), 0);
  } finally {
    await context.close();
  }
});

test('editing a goal invalidates hidden AI child tasks before saving', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const goalDialog = await openNewGoalEditor(page);
    const goalName = goalDialog.getByRole('textbox', { name: '目标名称' });
    await goalName.fill('发布一篇文章');
    await goalDialog.getByRole('button', { name: 'AI 帮我拆成子任务' }).click();
    await page.getByRole('dialog', { name: '检查目标拆解发送范围' }).getByRole('button', { name: '确认范围并生成草案' }).click();
    await page.getByRole('dialog', { name: '允许这一次目标拆解？' }).getByRole('button', { name: '允许并继续' }).click();
    await goalDialog.getByRole('heading', { name: '子任务' }).waitFor();

    const firstStageTitle = goalDialog.getByRole('textbox', { name: '任务名称' }).first();
    const originalStageTitle = await firstStageTitle.inputValue();
    await firstStageTitle.fill('');
    await goalDialog.getByRole('button', { name: '保存目标' }).click();
    await goalDialog.getByText('子任务名称 无效。', { exact: true }).waitFor();
    const invalidCounts = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('qiguang');
      request.addEventListener('error', () => reject(request.error));
      request.addEventListener('success', () => {
        const database = request.result;
        const transaction = database.transaction(['goals', 'milestones', 'quests'], 'readonly');
        Promise.all(['goals', 'milestones', 'quests'].map((name) => new Promise((done, fail) => {
          const count = transaction.objectStore(name).count();
          count.addEventListener('success', () => done([name, count.result]));
          count.addEventListener('error', () => fail(count.error));
        }))).then((values) => { database.close(); resolve(Object.fromEntries(values)); }, reject);
      });
    }));
    assert.deepEqual(invalidCounts, { goals: 0, milestones: 0, quests: 0 }, '无效子任务不得造成部分保存');
    await firstStageTitle.fill(originalStageTitle);

    await goalName.fill('发布一本文章');
    await assert.doesNotReject(() => goalDialog.getByText('目标或日期已改变，请重新拆分。').waitFor());
    assert.equal(await goalDialog.locator('.goal-stage-editor').count(), 0, '失效草案不得保留隐藏的子任务控件');
    await goalDialog.getByRole('button', { name: '保存目标' }).click();
    await page.getByText('目标已保存，可以继续添加子任务。', { exact: true }).waitFor();

    const stored = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('qiguang');
      request.addEventListener('error', () => reject(request.error));
      request.addEventListener('success', () => {
        const database = request.result;
        const transaction = database.transaction(['goals', 'milestones', 'quests'], 'readonly');
        const reads = ['goals', 'milestones', 'quests'].map((name) => new Promise((done, fail) => {
          const rows = transaction.objectStore(name).getAll();
          rows.addEventListener('success', () => done([name, rows.result]));
          rows.addEventListener('error', () => fail(rows.error));
        }));
        Promise.all(reads).then((values) => { database.close(); resolve(Object.fromEntries(values)); }, reject);
      });
    }));
    assert.deepEqual(stored.goals.map((goal) => goal.result), ['发布一本文章']);
    assert.equal(stored.milestones.length, 0);
    assert.equal(stored.quests.length, 0);
    assert.equal(apiRequests.length, 1);
  } finally {
    await context.close();
  }
});

test('calendar opens an in-place day snapshot before the full review', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    const date = await page.locator('.record-date-control input[type="date"]').inputValue();
    await page.getByRole('textbox', { name: '现在的想法' }).fill('日历快照里的真实记录');
    await page.getByRole('button', { name: '发送' }).click();
    await assert.doesNotReject(() => page.waitForURL(new RegExp(`#\\/day\\/${date}$`)));
    await page.goto(`${baseUrl}/#/calendar`);
    const calendarUrl = page.url();
    const todayCell = page.locator('.calendar-day[aria-current="date"]');
    const calendarLayout = await todayCell.evaluate((cell) => {
      const style = getComputedStyle(cell);
      const gridStyle = getComputedStyle(cell.parentElement);
      return { borderRadius: style.borderRadius, borderWidth: style.borderTopWidth, rowGap: gridStyle.rowGap, marginBottom: gridStyle.marginBottom };
    });
    assert.equal(calendarLayout.borderRadius, '2px');
    assert.equal(calendarLayout.borderWidth, '1px');
    assert.equal(calendarLayout.rowGap, '12px');
    const square = await todayCell.boundingBox();
    assert.ok(Math.abs(square.width - square.height) < 1, 'today marker must be a square');
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

test('dated records save across years and restore a page-switch draft', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    const today = await page.locator('.record-date-control input[type="date"]').inputValue();
    const previous = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

    await page.goto(`${baseUrl}/#/record/${previous}`);
    await page.getByRole('textbox', { name: '现在的想法' }).fill('给未来留下一页。');
    await page.getByRole('button', { name: '发送' }).click();
    await page.waitForURL(new RegExp(`#\\/day\\/${previous}$`));

    await page.goto(`${baseUrl}/#/record/${today}`);
    await page.getByRole('textbox', { name: '现在的想法' }).fill('完成了记录页的整理。');
    await page.getByRole('link', { name: '任务', exact: true }).click();
    await page.getByRole('link', { name: '记录', exact: true }).click();
    const body = page.getByRole('textbox', { name: '现在的想法' });
    assert.equal(await body.inputValue(), '完成了记录页的整理。');
    await page.getByRole('button', { name: '发送' }).click();
    await page.waitForURL(new RegExp(`#\\/day\\/${today}$`));

    await assert.doesNotReject(() => page.locator('.day-record-row').getByText('完成了记录页的整理。', { exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/day/${previous}`);
    await assert.doesNotReject(() => page.locator('.day-record-row').getByText('给未来留下一页。', { exact: true }).waitFor());
  } finally {
    await context.close();
  }
});

test('AI can draft the day caption while the user keeps final edit control', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.getByRole('textbox', { name: '现在的想法' }).fill('今天完成了一个需要耐心的小步骤。');
    await page.getByRole('button', { name: '发送' }).click();
    await page.waitForURL(/#\/day\//);
    await page.goto(`${baseUrl}/#/calendar`);
    await page.locator('.calendar-day[aria-current="date"]').click();
    await page.locator('.calendar-day-preview').getByRole('button', { name: '编辑当日一句' }).click();
    const captionDialog = page.getByRole('dialog', { name: '编辑当日一句' });
    await captionDialog.getByRole('button', { name: '让 AI 概括' }).click();
    const preview = page.getByRole('dialog', { name: '发送内容' });
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

test('daily and weekly personal reviews stay editable and local', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    const date = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/day/${date}`);
    await page.getByRole('button', { name: '复盘', exact: true }).click();
    await page.locator('.personal-review-card').getByRole('button', { name: '填写' }).click();
    let dialog = page.getByRole('dialog', { name: '每日复盘' });
    await dialog.getByRole('textbox', { name: '今天推进了什么' }).fill('完成基线实验');
    await dialog.getByRole('textbox', { name: '今天留下了什么' }).fill('新增检查清单');
    await dialog.getByRole('textbox', { name: '最大问题' }).fill('信息流浏览过多');
    await dialog.getByRole('textbox', { name: '明天最重要的一件事' }).fill('完成对照实验');
    await dialog.getByRole('button', { name: '保存复盘' }).click();
    await assert.doesNotReject(() => page.locator('.personal-review-card').getByText('完成对照实验', { exact: true }).waitFor());

    await page.goto(`${baseUrl}/#/review/${date}`);
    await page.locator('.personal-review-card').getByRole('button', { name: '填写' }).click();
    dialog = page.getByRole('dialog', { name: '周复盘' });
    await dialog.getByRole('textbox', { name: '本周进展' }).fill('实验设计向前推进');
    await dialog.getByRole('textbox', { name: '本周形成的资产' }).fill('形成实验检查清单');
    await dialog.getByRole('textbox', { name: '最大进步' }).fill('识别关键风险');
    await dialog.getByRole('textbox', { name: '最大浪费' }).fill('无目的浏览');
    await dialog.getByRole('textbox', { name: '停止或减少' }).fill('减少信息流');
    await dialog.getByRole('textbox', { name: '下周最重要的一件事' }).fill('完成基线实验');
    await dialog.getByRole('button', { name: '保存复盘' }).click();
    await page.reload();
    await assert.doesNotReject(() => page.locator('.personal-review-card').getByText('形成实验检查清单', { exact: true }).waitFor());
    await page.locator('.personal-review-card').getByRole('button', { name: '修改' }).click();
    dialog = page.getByRole('dialog', { name: '周复盘' });
    const lastReviewValue = dialog.getByRole('textbox', { name: '下周最重要的一件事' });
    assert.equal(await lastReviewValue.inputValue(), '完成基线实验');
    await lastReviewValue.scrollIntoViewIfNeeded();
    const [lastBox, navBox] = await Promise.all([lastReviewValue.boundingBox(), dialog.locator('.dialog-actions').boundingBox()]);
    assert.ok(lastBox && navBox && lastBox.y + lastBox.height <= navBox.y, 'the final review field must scroll above the fixed navigation');
  } finally {
    await context.close();
  }
});

test('life diary creates stream entries with image attachments and local review', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    const date = await page.locator('.record-date-control input[type="date"]').inputValue();
    assert.equal(await page.getByRole('checkbox', { name: '记为成功记录' }).count(), 0);
    await assert.doesNotReject(() => page.getByRole('button', { name: '生活日记', pressed: true }).waitFor());
    assert.equal(await page.locator('.record-type-option').count(), 0);

    const addEntry = async (body) => {
      await page.getByRole('textbox', { name: '现在的想法' }).fill(body);
      await page.getByRole('button', { name: '发送' }).click();
      await page.waitForURL(new RegExp(`#\\/day\\/${date}$`));
    };
    await addEntry('先保存一条普通记录');
    await page.goto(`${baseUrl}/#/record/${date}`);
    await addEntry('我把失败的构建修复了');

    const quotedPrompt = '普通日记偶然引用：今天做成或推进了什么？哪怕很小：';
    await page.goto(`${baseUrl}/#/record/${date}`);
    await addEntry(quotedPrompt);

    await page.goto(`${baseUrl}/#/record/${date}`);
    const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
    await page.locator('.life-diary-file').setInputFiles({ name: 'note.png', mimeType: 'image/png', buffer: tinyPng });
    await assert.doesNotReject(() => page.locator('.life-diary-image-preview img').waitFor());
    await page.getByRole('button', { name: '发送' }).click();
    await page.waitForURL(new RegExp(`#\\/day\\/${date}$`));

    const entries = page.locator('.day-record-row');
    await assert.doesNotReject(() => entries.filter({ hasText: '先保存一条普通记录' }).waitFor());
    assert.equal(await entries.count(), 4, 'one day must accept more than one stream entry');
    assert.equal(await page.locator('.day-record-image').count(), 1, 'image attachments should render in the day record stream');
    const successes = page.locator('.success-evidence');
    assert.equal(await successes.getByText('先保存一条普通记录', { exact: true }).count(), 0);
    assert.equal(await successes.getByText('我把失败的构建修复了', { exact: true }).count(), 0);
    assert.equal(await successes.getByText(quotedPrompt, { exact: true }).count(), 0, 'wording alone must not promote a journal into success evidence');

    let successEntry = entries.filter({ hasText: '我把失败的构建修复了' });
    await successEntry.click();
    const edit = page.getByRole('dialog', { name: '记录详情' });
    assert.equal(await edit.getByRole('checkbox', { name: '记为成功记录' }).count(), 0);
    await edit.getByRole('button', { name: '成功小记' }).click();
    await edit.getByRole('button', { name: '保存修改' }).click();
    await assert.doesNotReject(() => page.getByText('修改已保存，可撤销一次。', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.locator('.success-evidence').getByText('我把失败的构建修复了', { exact: true }).waitFor({ state: 'attached' }));

    successEntry = page.locator('.day-record-row').filter({ hasText: '我把失败的构建修复了' });
    await successEntry.click();
    const detail = page.getByRole('dialog', { name: '记录详情' });
    await detail.locator('.record-detail-more > summary').click();
    await detail.getByRole('button', { name: '修改历史' }).click();
    await page.getByRole('button', { name: '撤销最近修改' }).click();
    await page.locator('.success-evidence').getByText('我把失败的构建修复了', { exact: true }).waitFor({ state: 'detached' });

    await page.goto(`${baseUrl}/#/record/${date}`);
    await page.getByRole('button', { name: '每日复盘' }).click();
    await page.getByRole('textbox', { name: '今天推进了什么' }).fill('完成记录页重构');
    await page.getByRole('textbox', { name: '今天留下了什么' }).fill('生活日记流');
    await page.getByRole('textbox', { name: '最大问题' }).fill('旧分类太重');
    await page.getByRole('textbox', { name: '明天最重要的一件事' }).fill('审计真实页面');
    await page.getByRole('button', { name: '保存复盘' }).click();
    await page.waitForURL(new RegExp(`#\\/day\\/${date}$`));
    await assert.doesNotReject(() => page.locator('.personal-review-card').getByText('审计真实页面', { exact: true }).waitFor());
  } finally {
    await context.close();
  }
});

test('a goal child task completes from Today before the goal can be confirmed', async () => {
  const { context, page } = await freshPage();
  const goalName = '整理一次可核对成果';
  const childTask = '提交一份可核对成果';
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await openTaskView(page, '计划');
    const goalDialog = await openNewGoalEditor(page);
    await goalDialog.getByRole('textbox', { name: '目标名称' }).fill(goalName);
    await goalDialog.getByRole('button', { name: '保存目标' }).click();
    await page.getByText('目标已保存，可以继续添加子任务。', { exact: true }).waitFor();
    await openTaskView(page, '计划');

    const goalCard = page.locator('.goal-row').filter({ hasText: goalName });
    await goalCard.locator(`button[aria-label="为“${goalName}”添加子任务"]`).click();
    const childDialog = page.getByRole('dialog', { name: '添加子任务' });
    await childDialog.getByRole('textbox', { name: '子任务名称' }).fill(childTask);
    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await childDialog.getByRole('textbox', { name: '完成日期' }).fill(today);
    await childDialog.getByRole('button', { name: '添加', exact: true }).click();

    await goalCard.getByRole('button', { name: `查看目标“${goalName}”的子任务` }).click();
    let details = page.getByRole('dialog', { name: '目标详情' });
    await details.getByText('0 / 1 子任务', { exact: true }).waitFor();
    assert.equal(await details.getByRole('button', { name: /标为完成|撤销完成|确认目标完成/ }).count(), 0, '目标详情不能代替今日任务打卡');
    await details.getByRole('button', { name: '返回' }).click();

    await openTaskView(page, '今天');
    await page.getByRole('button', { name: `完成：${childTask}` }).click();
    await page.getByRole('button', { name: `完成：${childTask}` }).waitFor({ state: 'detached' });

    await openTaskView(page, '计划');
    await goalCard.getByRole('button', { name: `查看目标“${goalName}”的子任务` }).click();
    details = page.getByRole('dialog', { name: '目标详情' });
    await details.getByText('1 / 1 子任务', { exact: true }).waitFor();
    assert.equal(await details.getByRole('button', { name: /标为完成|撤销完成/ }).count(), 0);
    await details.getByRole('button', { name: '确认目标完成' }).click();
    await page.getByRole('dialog', { name: '确认目标已完成？' }).getByRole('button', { name: '确认完成' }).click();
    await assert.doesNotReject(() => goalCard.getByText('已完成', { exact: true }).waitFor());

    await page.goto(`${baseUrl}/#/growth`);
    const badgeLabels = await page.locator('.growth-badge').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
    assert.equal(await page.getByRole('button', { name: `查看徽章详情：${childTask}` }).count(), 1, badgeLabels.join(' | '));
    assert.equal(await page.getByRole('button', { name: `查看徽章详情：完成目标：${goalName}` }).count(), 1);
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
      const transaction = database.transaction(['goals', 'milestones', 'xpLedger', 'habits', 'habitLogs', 'quests', 'questFeedback', 'reviews'], 'readwrite');
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
        role: 'main', status: 'completed', startDate: dateAt(-14), completedDate: goalDate, completedAt: `${goalDate}T08:00:00.000Z`, ...common,
      });
      transaction.objectStore('milestones').add({
        id: milestoneId, goalId, order: 0, description: '完成第一章', evidence: '第一章验收记录', status: 'completed',
        completedAt: `${goalDate}T08:00:00.000Z`, xpSettled: true, ...common,
      });
      transaction.objectStore('xpLedger').add({
        id: crypto.randomUUID(), settlementKey: `${milestoneId}:1`, sourceType: 'milestone', sourceId: milestoneId, dimension: 'progress', ruleVersion: 2,
        baseXp: 5, ratio: 1, finalXp: 5, difficulty: 'milestone', localDate: goalDate, ...common,
      });

      const habitId = crypto.randomUUID();
      transaction.objectStore('habits').add({
        id: habitId, name: '晨间伸展', minimumAction: '伸展一分钟', scheduleDays: [1, 2, 3, 4, 5, 6, 7],
        dimension: 'energy', difficulty: 'light', status: 'active', bonusEnabled: false, ...common,
      });
      for (let index = 0; index < 7; index += 1) {
        const localDate = dateAt(index - 13);
        const questId = crypto.randomUUID();
        transaction.objectStore('quests').add({
          id: questId, localDate, type: 'bonus', sourceType: 'habit', sourceId: habitId, actionId: `habit:${habitId}:${localDate}`, settlementVersion: 1,
          title: `晨间伸展第${index + 1}次`, reason: '主动培养的习惯', minimumAction: '伸展一分钟', estimatedMinutes: 1, difficulty: 'light', dimension: 'energy',
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
          title: `恢复行动第${index + 1}次`, reason: '根据当前状态主动恢复', minimumAction: '安静休息五分钟', estimatedMinutes: 5, difficulty: 'light', dimension: 'energy',
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
        title: '执行一轮小步试验', reason: '落实已确认的周实验', minimumAction: '做一次五分钟试验', estimatedMinutes: 5, difficulty: 'light', dimension: 'progress',
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
    await assert.doesNotReject(() => page.locator('.toast.is-completion').getByText(/新徽章 · 恢复行动 · 懂得停靠/).waitFor(), 'a first unlock uses the concise achievement announcement');

    await page.goto(`${baseUrl}/#/growth`);
    const badges = page.locator('.growth-badges');
    await assert.doesNotReject(() => badges.getByText('查看全部 ›', { exact: true }).waitFor());
    assert.equal(await badges.locator('.badge-category-summary').count(), 0, 'badge category descriptions stay hidden');

    await badges.getByText('查看全部 ›', { exact: true }).click();
    const all = page.getByRole('dialog', { name: '成就册' });
    assert.equal(await all.locator('.growth-badge').count(), 8);
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
    const visualTypes = await all.locator('.growth-badge').evaluateAll((buttons) => buttons.map((button) => ({
      label: button.querySelector('.badge-name')?.textContent?.trim(),
      icon: button.querySelector('img')?.getAttribute('src'),
    })));
    assert.ok(visualTypes.some((badge) => badge.label === '子任务完成' && badge.icon?.includes('badge-milestone')));
    assert.ok(visualTypes.some((badge) => badge.label === '目标完成' && badge.icon?.includes('badge-goal')));
    assert.ok(visualTypes.some((badge) => badge.label === '完成7次' && badge.icon?.includes('badge-habit')));
    assert.ok(visualTypes.some((badge) => badge.label === '状态回升' && badge.icon?.includes('badge-recovery')));
    assert.ok(visualTypes.some((badge) => badge.label === '小尝试完成' && badge.icon?.includes('badge-experiment')));

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

test('Android without a MiniMax key keeps the local success and action loop usable', async () => {
  const { context, page, apiRequests } = await freshPage({ native: true });
  try {
    await finishOnboarding(page);
    const input = page.getByRole('textbox', { name: '现在的想法' });
    const today = await page.locator('.record-date-control input[type="date"]').inputValue();
    await input.fill('完成了今天最小的一步');
    await page.getByRole('button', { name: '发送' }).click();
    await page.goto(`${baseUrl}/#/day/${today}`);
    await page.locator('.day-record-row').click();
    const detail = page.getByRole('dialog', { name: '记录详情' });
    await detail.getByRole('button', { name: '成功小记' }).click();
    await detail.getByRole('button', { name: '保存修改' }).click();
    await assert.doesNotReject(() => page.getByText('修改已保存，可撤销一次。', { exact: true }).waitFor());
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
    await assert.doesNotReject(() => page.getByRole('textbox', { name: '现在的想法' }).waitFor());
    await page.goto(`${baseUrl}/#/status`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '设置', exact: true }).waitFor());
    await page.goto(`${baseUrl}/#/history`);
    await assert.doesNotReject(() => page.getByRole('link', { name: '日历', exact: true }).waitFor());
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
    await assert.doesNotReject(() => page.locator('.companion-figure').waitFor());
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




test('low state proposes replaceable recovery and one-click no-penalty feedback', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    assert.equal(await page.getByRole('button', { name: '去自评 ›' }).count(), 0, 'today only shows the five current scores');
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
    assert.equal(await page.locator('.companion-figure').count(), 1);
    assert.equal(await page.locator('.room-scene, .room-cue').count(), 0);
    await page.getByRole('link', { name: '任务', exact: true }).click();
    await page.waitForURL(/#\/tasks$/);
    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/day/${today}`);
    await page.locator(`.room-stage[data-snapshot-date="${today}"]`).waitFor();
    assert.equal(await page.locator(`.room-stage[data-snapshot-date="${today}"]`).count(), 1);
    assert.equal(await page.locator('.companion-figure').count(), 1);
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '换一个' }).click();
    await assert.doesNotReject(() => page.getByText('做一次很短的舒展').waitFor());
    await page.getByRole('button', { name: '加入今天' }).click();
    await page.goto(`${baseUrl}/#/tasks`);
    const recoveryCard = page.locator('.task-list-item').filter({ hasText: '做一次很短的舒展' });
    await assert.doesNotReject(() => recoveryCard.waitFor());
    assert.equal(await recoveryCard.getByText(/成长值|成长 \+/).count(), 0, 'an unbound recovery action must not advertise fake growth');
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
    await assert.doesNotReject(() => detail.locator('.state-current-score[aria-label="当前分数 25"]').waitFor());
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
    await questDialog.getByRole('textbox', { name: '任务名称' }).fill('跨日完成证据');
    await questDialog.getByRole('button', { name: '安排任务' }).click();

    await page.evaluate((nextDay) => localStorage.setItem('qiguang.e2e-now', String(nextDay)), firstDay + 86_400_000);
    await page.reload();
    const overdue = page.locator('.task-list-item.is-overdue').filter({ hasText: '跨日完成证据' });
    await overdue.getByRole('button', { name: '记录“跨日完成证据”的实际结果' }).click();
    const firstFeedback = page.getByRole('dialog', { name: '记录任务结果' });
    const actualDate = firstFeedback.locator('.feedback-date-control input[type="date"]');
    await assert.doesNotReject(() => firstFeedback.waitFor());
    assert.equal(await actualDate.inputValue(), '2026-08-21', 'an overdue completion defaults to the real feedback day');
    await actualDate.fill('2026-08-21');
    await firstFeedback.getByRole('button', { name: '保存结果' }).click();
    await assert.doesNotReject(() => page.locator('.toast.is-completion').getByText(/工作\/学习 \+4 成长值/).waitFor());

    await page.goto(`${baseUrl}/#/day/2026-08-20`);
    assert.equal(await page.locator('.success-evidence').count(), 0, 'planned day must not claim a later success');
    assert.equal(await page.locator('.day-action-results .day-action-row').count(), 0, 'planned day must not claim later action feedback');

    await page.goto(`${baseUrl}/#/day/2026-08-21`);
    const successes = page.locator('.success-evidence');
    await assert.doesNotReject(() => successes.getByText('完成：跨日完成证据', { exact: true }).waitFor({ state: 'attached' }));
    await page.getByRole('button', { name: '行动', exact: true }).click();
    const feedback = page.locator('.day-action-results');
    const feedbackAction = feedback.getByRole('article', { name: '“跨日完成证据”的任务结果：已完成' });
    await assert.doesNotReject(() => feedbackAction.waitFor());
    assert.equal(await feedbackAction.getByRole('button').count(), 0, 'history is read-only; check-ins stay on Today and Tasks → Today');
    assert.equal(await feedbackAction.locator('.day-action-icon, .day-action-chevron').count(), 0);
    const feedbackLayout = await feedbackAction.evaluate((row) => {
      const title = row.querySelector('.day-action-copy').getBoundingClientRect();
      const result = row.querySelector('.day-action-result').getBoundingClientRect();
      return { resultAtRight: result.left >= title.right, columns: getComputedStyle(row).gridTemplateColumns.split(' ').length };
    });
    assert.deepEqual(feedbackLayout, { resultAtRight: true, columns: 2 });

    await page.goto(`${baseUrl}/#/review/2026-08-17`);
    await page.getByRole('button', { name: '检查范围并生成' }).click();
    let reviewPreview = page.getByRole('dialog', { name: '生成本周复盘' });
    await assert.doesNotReject(() => reviewPreview.locator('.analysis-preview-scope').getByText(/任务结果 1 条/).waitFor());
    await reviewPreview.getByRole('button', { name: '取消' }).click();

    await page.evaluate((later) => localStorage.setItem('qiguang.e2e-now', String(later)), firstDay + 5 * 86_400_000);
    await page.goto(`${baseUrl}/#/review/2026-08-24`);
    await page.getByRole('button', { name: '检查范围并生成' }).click();
    reviewPreview = page.getByRole('dialog', { name: '生成本周复盘' });
    await assert.doesNotReject(() => reviewPreview.locator('.analysis-preview-scope').getByText(/任务结果 0 条/).waitFor());
    await reviewPreview.getByRole('button', { name: '取消' }).click();
  } finally {
    await context.close();
  }
});

test('completed action is traceable from its five-dimensional growth ledger at 320px', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/tasks`);
    await page.getByRole('button', { name: '添加任务' }).click();
    await page.getByRole('textbox', { name: '任务名称' }).fill('证据测试行动');
    await page.getByRole('dialog', { name: '安排每日任务' }).getByRole('button', { name: '安排任务' }).click();
    await page.getByRole('button', { name: '完成：证据测试行动' }).click();
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
    const dimensionCard = page.locator('.growth-dimension-card[data-dimension="progress"]');
    await dimensionCard.click();
    const ledger = page.getByRole('dialog', { name: '工作/学习成长记录' });
    await assert.doesNotReject(() => ledger.locator('.growth-evidence-row strong').filter({ hasText: '证据测试行动' }).waitFor());
    await assert.doesNotReject(() => ledger.locator('.growth-evidence-row .caption').filter({ hasText: '+4' }).waitFor());
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
    await page.getByRole('dialog', { name: '工作/学习成长记录' }).getByRole('button', { name: '返回' }).click();
    await page.goto(`${baseUrl}/#/task-analysis`);
    await page.locator('.analysis-summary-grid').waitFor();
    assert.deepEqual(await page.locator('.analysis-summary-grid strong').allTextContents(), ['1 项', '+4']);
    await page.locator('.analysis-category-tabs').getByRole('button', { name: '玩乐', exact: true }).click();
    assert.deepEqual(await page.locator('.analysis-summary-grid strong').allTextContents(), ['0 项', '+0']);
    assert.deepEqual(apiRequests, [], 'local analysis must not send diary or task data');
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
    await page.getByRole('textbox', { name: '任务名称' }).fill(title);
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

    await assert.doesNotReject(() => page.locator('.toast.is-completion').getByText(/任务已完成\s+工作\/学习 \+4 成长值/).waitFor());
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
    await page.getByRole('textbox', { name: '现在的想法' }).fill(marker);
    await page.getByRole('button', { name: '发送' }).click();
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
    await page.getByRole('textbox', { name: '现在的想法' }).fill('下午连续开会，晚上散步以后平静了一些。');
    await page.getByRole('button', { name: '发送' }).click();
    await page.goto(`${baseUrl}/#/day/${today}`);
    await page.locator('.day-evidence-details > summary').click();
    await page.getByRole('button', { name: '检查范围并整理' }).click();
    const dialog = page.getByRole('dialog', { name: '发送内容' });
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
    await assert.doesNotReject(() => page.getByRole('heading', { name: '待你核对 · 2' }).waitFor());
    const successes = page.locator('.success-evidence');
    assert.equal(await successes.getByText('留下了可核对的原始记录。', { exact: true }).count(), 0, 'unlocated AI specificCredit must not become a success fact');
    assert.equal(await successes.getByText('记录中的明确事件', { exact: true }).count(), 0, 'even explicit candidates wait for user confirmation');
    assert.equal(await successes.getByText('等待用户决定的推断', { exact: true }).count(), 0);
    assert.equal(await page.getByText('没有明确心情标签', { exact: true }).count(), 0);
    assert.equal(await page.locator('.analysis-event.is-confirmed').count(), 0);
    assert.equal(await page.locator('.daily-reflection-more[open], .analysis-maintenance[open]').count(), 0);
    const compactHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(compactHeight <= 3000, `daily result should keep detail on demand: ${compactHeight}px`);
    let explicit = page.locator('.analysis-event').filter({ hasText: '记录中的明确事件' });
    await explicit.getByRole('button', { name: '确认这条记录' }).click();
    let decision = page.getByRole('dialog', { name: '核对 AI 整理' });
    await assert.doesNotReject(() => decision.getByText('记录中的事实', { exact: true }).waitFor());
    await decision.getByRole('button', { name: '确认并应用建议' }).click();
    await page.locator('.day-evidence-details > summary').click();
    await assert.doesNotReject(() => page.locator('.success-evidence').getByText('记录中的明确事件', { exact: true }).waitFor());

    const inference = page.locator('.analysis-event').filter({ hasText: '等待用户决定的推断' });
    await assert.doesNotReject(() => inference.getByText('待确认', { exact: true }).waitFor());
    assert.equal(await inference.getByText('已确认', { exact: true }).count(), 0);
    await inference.getByRole('button', { name: '核对 AI 推断' }).click();
    decision = page.getByRole('dialog', { name: '核对 AI 整理' });
    await assert.doesNotReject(() => decision.getByText('AI 的推断', { exact: true }).waitFor());
    await decision.getByRole('button', { name: '确认并应用建议' }).click();
    await page.locator('.day-evidence-details > summary').click();
    await assert.doesNotReject(() => page.locator('.success-evidence').getByText('等待用户决定的推断', { exact: true }).waitFor());
    await page.getByText('已核对事件 · 2', { exact: true }).click();
    explicit = page.locator('.analysis-event').filter({ hasText: '记录中的明确事件' });
    await assert.doesNotReject(() => explicit.getByText('已确认', { exact: true }).waitFor());
    await assert.doesNotReject(() => page.locator('.analysis-event').filter({ hasText: '等待用户决定的推断' }).getByText('已确认', { exact: true }).waitFor());
    assert.equal(apiRequests.length, 1);
    assert.deepEqual({ path: new URL(apiRequests[0].url).pathname, method: apiRequests[0].method }, { path: '/api/analyze', method: 'POST' });
    const request = JSON.parse(apiRequests[0].body);
    assert.equal(request.operation, 'daily_analysis');
    assert.equal(request.userInput.entries.length, 1);
    assert.equal(request.userInput.entries[0].text, '下午连续开会，晚上散步以后平静了一些。');
    assert.deepEqual(request.permissions.entryIds, request.userInput.entries.map((entry) => entry.entryId));
    assert.deepEqual(request.context, { confirmedEvents: [], recentStates: [], goals: [], bonusHabits: [], memories: [], constraints: [], recentTaskResults: [] });
    assert.deepEqual(request.permissions, {
      entryIds: request.permissions.entryIds,
      includeConfirmedEvents: false,
      includeRecentStates: false,
      includeGoals: false,
      includeBonusHabits: false,
      taskResultQuestIds: [],
      memoryIds: [],
    });
    await page.evaluate((nextDay) => localStorage.setItem('qiguang.e2e-now', String(nextDay)), firstDay + 86_400_000);
    await page.goto(`${baseUrl}/#/today`);
    const guide = page.locator('.daily-guide');
    await assert.doesNotReject(() => guide.getByRole('heading', { name: '明天安排十分钟低压力过渡。' }).waitFor());
    assert.equal(await page.getByRole('button', { name: '确认或调整这一步' }).count(), 1, '昨日下一步只保留一个可执行入口');
    await guide.getByRole('button', { name: '确认或调整这一步' }).click();
    const questDialog = page.getByRole('dialog', { name: '安排每日任务' });
    assert.equal(await questDialog.getByRole('textbox', { name: '任务名称' }).inputValue(), '明天安排十分钟低压力过渡。');
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
    await page.getByRole('textbox', { name: '任务名称' }).fill('反馈闭环行动');
    await page.getByRole('dialog', { name: '安排每日任务' }).getByRole('button', { name: '安排任务' }).click();
    await page.getByRole('button', { name: '查看任务：反馈闭环行动' }).click();
    const dialog = page.getByRole('dialog', { name: '记录任务结果' });
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
    await assert.doesNotReject(() => page.getByText('反馈已保存；可以在任务卡上撤销。 完成记录：完成了一部分可核对步骤。工作/学习成长 +1 · 累计 1 · 等级 0。', { exact: true }).waitFor());
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
    await page.getByRole('textbox', { name: '现在的想法' }).fill('整周原文不应出现在周复盘请求里。');
    await page.getByRole('button', { name: '发送' }).click();
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
    for (const label of ['下周重点', '一个小尝试', '先从哪一步开始', '怎样判断有没有效果', '结束日期', '什么时候停止']) {
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

test('a newly created habit has no historic debt and remains usable in weekly review', async () => {
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
    await page.getByRole('button', { name: /记录今天的习惯“晚饭后散步”/ }).click();
    await assert.doesNotReject(() => page.locator('.today-habit-row').filter({ hasText: '晚饭后散步' }).getByText('已完成', { exact: true }).waitFor());
    await openTaskView(page, '计划');
    const planHabit = page.locator('.habit-row').filter({ hasText: '晚饭后散步' });
    await assert.doesNotReject(() => planHabit.getByText(/本周完成 \d+\/5 次 · 每周 5 天/, { exact: true }).waitFor());
    assert.equal(await planHabit.getByRole('button', { name: /记录今天的习惯/ }).count(), 0, 'plan must not expose habit check-in');
    await planHabit.getByText('编辑', { exact: true }).click();
    await planHabit.getByRole('button', { name: '查看详情' }).click();
    const managementDetail = page.getByRole('dialog', { name: '习惯详情' });
    assert.equal(await managementDetail.locator('.habit-detail-checkin-actions').count(), 0, 'habit detail opened from plan must stay management-only');
    assert.equal(await managementDetail.getByRole('button', { name: '补记', exact: true }).count(), 0);
    await managementDetail.getByRole('button', { name: '返回' }).click();

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
