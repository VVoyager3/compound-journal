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

async function offlineShellPage() {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/#/today`);
  await page.evaluate(() => navigator.serviceWorker.ready);
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

test('the companion can wander and walks to furniture before direct navigation', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    const character = page.locator('.room-character');
    const before = await character.boundingBox();
    await page.getByRole('button', { name: '让小栖在房间里走走' }).click();
    await assert.doesNotReject(() => page.locator('.room-character.is-wandering').waitFor());
    assert.match(await character.evaluate((element) => getComputedStyle(element).animationName), /room-step-weight/);
    await page.waitForTimeout(850);
    const wandering = await character.boundingBox();
    assert.ok(before && wandering && Math.abs(wandering.x - before.x) > 20, 'companion should visibly wander around the room');
    await page.waitForTimeout(1850);
    assert.equal(await page.locator('.room-character.is-wandering').count(), 0);
    await page.getByRole('button', { name: '打开记录' }).click();
    await assert.doesNotReject(() => page.locator('.room-character.is-action-desk').waitFor());
    await page.waitForTimeout(400);
    const during = await character.boundingBox();
    assert.ok(before && during && during.x < before.x - 20, 'companion should visibly walk toward the desk');
    await page.waitForURL(/#\/record$/);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('the companion offers record, main-line context, and weekly review', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '生活分身' }).click();
    const bubble = page.locator('.character-bubble');
    await assert.doesNotReject(() => bubble.getByText('我在。今天想从哪里开始？', { exact: true }).waitFor());
    assert.equal(await bubble.evaluate((element) => getComputedStyle(element).pointerEvents), 'none');
    await page.getByRole('button', { name: '生活分身' }).click();
    const panel = page.locator('.character-panel');
    await assert.doesNotReject(() => panel.waitFor());
    await assert.doesNotReject(() => panel.getByRole('button', { name: '讲讲今天' }).waitFor());
    await assert.doesNotReject(() => panel.getByRole('button', { name: '安排今天的主线' }).waitFor());
    await assert.doesNotReject(() => panel.getByRole('button', { name: '看本周' }).waitFor());
    const panelBox = await panel.boundingBox();
    const actionBoxes = await panel.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()));
    assert.ok(panelBox && actionBoxes.every((box) => box.left >= panelBox.x && box.right <= panelBox.x + panelBox.width), 'all three companion actions should stay inside the panel');
    assert.ok(actionBoxes.at(-1)?.width > panelBox.width * .8, 'the third companion action should have a full visible row');
    assert.equal(await panel.getByRole('button', { name: '为什么给我这个主线？' }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: '更换外观' }).count(), 0);
    await panel.getByRole('button', { name: '安排今天的主线' }).click();
    await page.waitForURL(/#\/tasks$/);
    await page.getByRole('button', { name: '安排任务' }).click();
    await page.getByRole('textbox', { name: '行动标题' }).fill('验证主线依据');
    await page.getByRole('textbox', { name: '为什么今天值得做' }).fill('这是主线的可追溯理由。');
    await page.getByRole('textbox', { name: '最小动作' }).fill('完成一个最小步骤');
    await page.getByRole('combobox', { name: '任务类型' }).selectOption('main');
    await page.getByRole('button', { name: '安排到今天' }).click();
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: '生活分身' }).click();
    await page.getByRole('button', { name: '生活分身' }).click();
    await panel.getByRole('button', { name: '为什么给我这个主线？' }).click();
    await page.waitForURL(/#\/tasks$/);
    await assert.doesNotReject(() => page.getByText('这是主线的可追溯理由。').waitFor());
  } finally {
    await context.close();
  }
});

test('keyboard users can skip the room and open a direct route', async () => {
  const { context, page } = await freshPage();
  try {
    await finishOnboarding(page);
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('link', { name: '跳到主要内容' }).press('Enter');
    assert.equal(await page.locator('#main-content').evaluate((element) => element === document.activeElement), true);
    await page.getByRole('link', { name: '记录', exact: true }).press('Enter');
    await page.waitForURL(/#\/record$/);
    await assert.doesNotReject(() => page.getByRole('textbox', { name: '发生了什么' }).waitFor());
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
    assert.match(await page.locator('.room-scene').evaluate((element) => getComputedStyle(element).backgroundImage), /linear-gradient/);
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
    await page.getByRole('button', { name: '打开记录' }).click();
    assert.equal(await page.locator('.room-character.is-action-desk').count(), 0);
    await page.waitForURL(/#\/record$/);
    assert.deepEqual(apiRequests, []);
  } finally {
    await context.close();
  }
});

test('installed shell keeps the companion motion sprite available offline', async () => {
  const { context, page } = await offlineShellPage();
  try {
    const assets = await page.evaluate(async () => {
      const bundles = [...document.scripts].map((script) => script.src).filter(Boolean);
      const source = await Promise.all(bundles.map((bundle) => fetch(bundle).then((response) => response.text())));
      return [...new Set(source.flatMap((text) => [...text.matchAll(/["'`](\/assets\/(?:avatar|character-motion)-[^"'`]+\.(?:png|jpe?g))["'`]/g)].map((match) => match[1])))].sort();
    });
    assert.equal(assets.length, 4, 'both portraits and both motion sprites must be built into the shell');
    await context.setOffline(true);
    const dialog = page.getByRole('dialog', { name: '选择生活分身' });
    await dialog.getByRole('button', { name: '选择牛纹帽双辫女生' }).click();
    await dialog.getByRole('button', { name: '开始记录' }).click();
    await page.waitForURL(/#\/record$/);
    await page.goto(`${baseUrl}/#/today`);
    const imageUrl = await page.locator('.room-character').evaluate((element) => getComputedStyle(element).backgroundImage.match(/url\("?([^"\)]+)"?\)/)?.[1]);
    assert.ok(imageUrl, 'selected companion must use the motion sprite');
    const cached = await page.evaluate((urls) => Promise.all(urls.map((url) => fetch(url).then((response) => response.ok).catch(() => false))), assets);
    assert.deepEqual(cached, [true, true, true, true]);
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
    assert.equal(await page.locator('.room-scene.is-cue-rest').count(), 1);
    assert.equal(await page.locator('.room-character.is-resting').count(), 1);
    assert.equal(await page.locator('.room-character.is-resting').evaluate((element) => getComputedStyle(element).backgroundPosition), '-432px -3px');
    assert.equal(await page.locator('.room-cue').count(), 1);
    await page.getByRole('button', { name: '打开任务', exact: true }).click();
    assert.equal(await page.locator('.room-character.is-action-board').count(), 1);
    await page.waitForURL(/#\/tasks$/);
    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await page.goto(`${baseUrl}/#/day/${today}`);
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
    assert.equal(await page.getByRole('button', { name: /体力 25 需要关注 .*最后证据：/ }).count(), 1);
    assert.equal(await page.getByText('需要更新', { exact: true }).count(), 0);
    assert.equal(await page.locator('.room-stage[data-snapshot-date]').getAttribute('data-snapshot-date'), past);
    assert.equal(await page.locator('.room-plant.is-empty').count(), 0);
    await page.getByRole('button', { name: /体力 25 需要关注 .*最后证据：/ }).click();
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
    assert.deepEqual(await roomSprite.evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundPosition: style.backgroundPosition, mixBlendMode: style.mixBlendMode };
    }), { backgroundPosition: '-35px -3px', mixBlendMode: 'normal' });
    const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(geometry.scrollWidth <= geometry.width);
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
    await page.getByRole('button', { name: '仅保存本页记录' }).click();
    await page.waitForURL(/#\/day\/\d{4}-\d{2}-\d{2}$/);
    await assert.doesNotReject(() => page.locator('#main-content').getByText(marker, { exact: true }).waitFor());
    await page.goto(`${baseUrl}/?backup-test=${Date.now()}#/system`);
    await assert.doesNotReject(() => page.getByRole('heading', { name: '我的系统' }).waitFor());

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
    await page.waitForURL(/#\/day\/\d{4}-\d{2}-\d{2}$/);
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
