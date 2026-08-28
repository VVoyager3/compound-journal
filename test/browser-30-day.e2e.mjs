import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { startServer } from '../server.mjs';

const DAY_MS = 86_400_000;
const FIRST_DAY = new Date(2026, 7, 3, 10, 0, 0).getTime();
const CLOCK_KEY = 'qiguang.e2e-30-day-now';
const HABIT = '每天散步十分钟';
const GOAL = '发布一篇三十天回顾';
const INITIAL_STEP = '写下第一版结构';
const FIRST_MILESTONE = '推进：完成第一段可检查成果';
const SECOND_MILESTONE = '推进：根据一次真实反馈完成修订';

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

function dayTime(day) {
  return FIRST_DAY + (day - 1) * DAY_MS;
}

function dayDate(day) {
  const value = new Date(dayTime(day));
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

async function freshPage() {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
  await context.addInitScript(({ initial, key }) => {
    const NativeDate = Date;
    const current = () => Number(localStorage.getItem(key)) || initial;
    class TestDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [current()])); }
      static now() { return current(); }
    }
    window.Date = TestDate;
  }, { initial: FIRST_DAY, key: CLOCK_KEY });
  const page = await context.newPage();
  const apiRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(JSON.parse(request.postData() || '{}'));
  });
  return { context, page, apiRequests };
}

async function setDay(page, day, openApp = true) {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, String(value)), { key: CLOCK_KEY, value: dayTime(day) });
  if (!openApp) return;
  await page.goto(`${baseUrl}/#/today`);
  await page.reload();
  await page.locator('#main-content').waitFor();
  await assert.doesNotReject(() => page.getByRole('heading', { name: '今天', exact: true }).waitFor());
}

async function finishOnboarding(page) {
  await page.goto(`${baseUrl}/#/today`);
  const dialog = page.getByRole('dialog', { name: '选一个陪伴角色' });
  await dialog.getByRole('button', { name: '选择鱼鱼' }).click();
  await dialog.getByRole('button', { name: '写下第一件事' }).click();
  await page.getByRole('textbox', { name: '发生了什么' }).waitFor();
  await page.evaluate(() => localStorage.setItem('qiguang.room-guide-seen.v1', '1'));
}

async function openTaskPlan(page) {
  const tab = page.getByRole('tab', { name: '计划', exact: true });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
}

async function directionTitle(page, allowRecordOnly = false) {
  await page.goto(`${baseUrl}/#/today`);
  await page.getByRole('heading', { name: '今天', exact: true }).waitFor();
  const title = page.locator('.daily-guide h2, .main-action h2').first();
  if (!allowRecordOnly) {
    await title.waitFor();
    return (await title.textContent())?.trim() ?? '';
  }
  assert.equal(await title.count(), 0, 'record-only days must not render a duplicate direction card');
  const record = page.locator('.bottom-nav').getByRole('link', { name: '记录', exact: true });
  await record.waitFor();
  return (await record.textContent())?.trim() ?? '';
}

async function recordDay(page, day, success = false) {
  const body = `第 ${String(day).padStart(2, '0')} 天：留下当天真实进展。`;
  await page.goto(`${baseUrl}/#/record`);
  if (success) await page.getByRole('button', { name: '成功小记' }).click();
  else await page.getByRole('button', { name: '珍藏小记' }).click();
  assert.equal(await page.getByRole('checkbox', { name: '记为成功记录' }).count(), 0);
  await page.getByRole('textbox', { name: '发生了什么' }).fill(body);
  await page.getByRole('button', { name: '保存记录' }).click();
  await page.waitForURL(new RegExp(`#\\/day\\/${dayDate(day)}$`));
  await assert.doesNotReject(() => page.locator('.journal-entry-body').getByText(body, { exact: true }).waitFor());
}

async function readStores(page, names) {
  return page.evaluate((storeNames) => new Promise((resolve, reject) => {
    const open = indexedDB.open('qiguang');
    open.addEventListener('error', () => reject(open.error), { once: true });
    open.addEventListener('success', () => {
      const database = open.result;
      const transaction = database.transaction(storeNames, 'readonly');
      const result = {};
      Promise.all(storeNames.map((name) => new Promise((done, fail) => {
        const request = transaction.objectStore(name).getAll();
        request.addEventListener('success', () => { result[name] = request.result; done(); }, { once: true });
        request.addEventListener('error', () => fail(request.error), { once: true });
      }))).then(() => { database.close(); resolve(result); }, (error) => { database.close(); reject(error); });
    }, { once: true });
  }), names);
}

async function completeHabit(page) {
  await page.goto(`${baseUrl}/#/today`);
  const complete = page.getByRole('button', { name: `完成打卡：${HABIT}` });
  await complete.waitFor();
  await complete.click();
  await page.getByRole('button', { name: `撤销习惯“${HABIT}”今天的打卡` }).waitFor();
}

async function completeQuest(page, title) {
  await page.goto(`${baseUrl}/#/today`);
  const complete = page.getByRole('button', { name: `完成：${title}` });
  await complete.waitFor();
  await complete.click();
  await complete.waitFor({ state: 'detached' });
}

async function moveQuestToTomorrow(page, title) {
  await page.goto(`${baseUrl}/#/tasks`);
  const todayTab = page.getByRole('tab', { name: '今天', exact: true });
  if (await todayTab.getAttribute('aria-selected') !== 'true') await todayTab.click();
  const card = page.locator('.task-list-item').filter({ hasText: title });
  await card.getByRole('button', { name: `查看任务：${title}` }).click();
  const details = page.getByRole('dialog', { name: '记录任务结果' });
  await details.getByText('编辑或删除任务', { exact: true }).click();
  await details.getByRole('button', { name: `编辑任务：${title}` }).click();
  const dialog = page.getByRole('dialog', { name: '修改任务' });
  await dialog.getByRole('button', { name: '改到明天' }).click();
  await dialog.getByRole('button', { name: '保存调整' }).click();
  await page.getByRole('status').filter({ hasText: '已顺延到' }).waitFor();
}

async function calibrateEnergy(page, value) {
  await page.goto(`${baseUrl}/#/today`);
  await page.evaluate((score) => new Promise((resolve, reject) => {
    const date = new Date();
    const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const timestamp = new Date().toISOString();
    const request = indexedDB.open('qiguang');
    request.addEventListener('error', () => reject(request.error));
    request.addEventListener('success', () => {
      const database = request.result;
      const transaction = database.transaction('observations', 'readwrite');
      transaction.objectStore('observations').add({
        id: crypto.randomUUID(), assessmentId: crypto.randomUUID(), localDate, dimension: 'energy', kind: 'user-self-assessment', value: score,
        active: true, observedAt: timestamp, createdAt: timestamp, updatedAt: timestamp, version: 1,
      });
      transaction.addEventListener('complete', () => { database.close(); resolve(); });
      transaction.addEventListener('abort', () => { database.close(); reject(transaction.error); });
    });
  }), value);
  await page.reload();
  await page.locator('#main-content').waitFor();
}

async function saveHabitStatus(page, status) {
  await page.goto(`${baseUrl}/#/tasks`);
  await openTaskPlan(page);
  const row = page.locator('.habit-row').filter({ hasText: HABIT });
  await row.getByText('更多', { exact: true }).click();
  await row.getByRole('button', { name: `编辑习惯“${HABIT}”` }).click();
  const dialog = page.getByRole('dialog', { name: '编辑习惯' });
  await dialog.getByText('更多设置（可选）', { exact: true }).click();
  await dialog.getByRole('combobox', { name: '习惯状态' }).selectOption(status);
  await dialog.getByRole('button', { name: '保存习惯' }).click();
  await page.getByRole('status').filter({ hasText: '习惯设置已保存。' }).waitFor();
}

async function createGoalAndHabit(page) {
  await page.goto(`${baseUrl}/#/tasks`);
  await openTaskPlan(page);
  await page.getByRole('button', { name: '新建目标' }).click();
  const goalDialog = page.getByRole('dialog', { name: '建立一个真实目标' });
  await goalDialog.getByRole('textbox', { name: '你想让什么事情发生？' }).fill(GOAL);
  await goalDialog.getByRole('button', { name: 'AI 帮我拆成阶段目标' }).click();
  await page.getByRole('dialog', { name: '检查目标拆解发送范围' }).getByRole('button', { name: '确认范围并生成草案' }).click();
  const consent = page.getByRole('dialog', { name: '允许这一次目标拆解？' });
  await consent.getByRole('button', { name: '允许并继续' }).click();
  await goalDialog.getByRole('heading', { name: '可编辑的拆解草案' }).waitFor();
  await goalDialog.getByText('当前下一步：写下第一版结构', { exact: true }).waitFor();
  await goalDialog.getByRole('button', { name: '建立并开始' }).click();
  await page.getByRole('tab', { name: '今天', exact: true }).click();
  await page.getByRole('button', { name: `完成：${INITIAL_STEP}` }).click();
  await page.getByRole('heading', { name: FIRST_MILESTONE }).waitFor();

  const initial = await readStores(page, ['milestones', 'xpLedger']);
  assert.equal(initial.milestones.filter((item) => item.status === 'completed').length, 0, 'initial small step must not complete a milestone');
  assert.equal(initial.xpLedger.filter((item) => item.sourceType === 'milestone' && !item.reversedAt).length, 0, 'initial small step must not settle milestone XP');
  await moveQuestToTomorrow(page, FIRST_MILESTONE);

  await openTaskPlan(page);
  await page.getByRole('button', { name: '新建习惯' }).click();
  const habitDialog = page.getByRole('dialog', { name: '建立低成本习惯' });
  await habitDialog.getByRole('textbox', { name: '我想养成什么？' }).fill(HABIT);
  await habitDialog.getByRole('button', { name: '建立习惯' }).click();
  await page.getByRole('button', { name: `暂停“${HABIT}”的计划日打卡` }).waitFor();
}

async function finishGoal(page) {
  await page.goto(`${baseUrl}/#/tasks`);
  await openTaskPlan(page);
  const goal = page.locator('.goal-row').filter({ hasText: GOAL });
  await goal.getByText('更多', { exact: true }).click();
  await goal.getByRole('button', { name: `编辑目标“${GOAL}”` }).click();
  const dialog = page.getByRole('dialog', { name: '编辑目标' });
  await dialog.getByRole('combobox', { name: '目标状态' }).selectOption('completed');
  await dialog.getByRole('button', { name: '保存目标' }).click();
  await goal.getByText('主目标 · 已完成', { exact: true }).waitFor();
}

async function adoptWeeklyReview(page) {
  await page.goto(`${baseUrl}/#/review/${dayDate(7)}`);
  await page.getByRole('button', { name: '检查范围并生成' }).click();
  await page.getByRole('dialog', { name: '生成本周复盘' }).getByRole('button', { name: '确认并生成' }).click();
  const consent = page.getByRole('dialog', { name: '允许这一次 AI 周复盘？' });
  if (await consent.count()) await consent.getByRole('button', { name: '允许并继续' }).click();
  await page.getByRole('heading', { name: '保留可持续节奏' }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: '确认下周唯一主题与实验' }).count(), 0);
  await page.getByRole('button', { name: '采用下周建议' }).click();
  await page.locator('.review-hero .tag').getByText('已确认', { exact: true }).waitFor();
}

test('formal pages sustain a 30 day loop without historic debt', async () => {
  const { context, page, apiRequests } = await freshPage();
  try {
    await finishOnboarding(page);
    assert.equal(await directionTitle(page, true), '记录');
    await recordDay(page, 1, true);
    await createGoalAndHabit(page);
    await completeHabit(page);

    await setDay(page, 2);
    assert.equal(await directionTitle(page), FIRST_MILESTONE);
    await recordDay(page, 2);
    await completeQuest(page, FIRST_MILESTONE);
    await moveQuestToTomorrow(page, SECOND_MILESTONE);
    await completeHabit(page);

    await setDay(page, 3);
    assert.equal(await directionTitle(page), SECOND_MILESTONE);
    await recordDay(page, 3);
    await completeQuest(page, SECOND_MILESTONE);
    await finishGoal(page);
    await completeHabit(page);

    await setDay(page, 4);
    assert.equal(await directionTitle(page, true), '记录');
    await recordDay(page, 4);
    await completeHabit(page);

    await setDay(page, 5);
    await calibrateEnergy(page, 25);
    assert.equal(await directionTitle(page), '先恢复');
    await page.getByRole('button', { name: '换一个' }).click();
    await page.getByRole('button', { name: '加入今天' }).click();
    await completeQuest(page, '做一次很短的舒展');
    await recordDay(page, 5, true);
    await completeHabit(page);

    await setDay(page, 6);
    assert.equal(await directionTitle(page), '先恢复');
    await calibrateEnergy(page, 80);
    assert.equal(await directionTitle(page, true), '记录');
    await recordDay(page, 6);
    await completeHabit(page);

    await setDay(page, 7);
    assert.equal(await directionTitle(page, true), '记录');
    await recordDay(page, 7);
    await completeHabit(page);
    await adoptWeeklyReview(page);

    await setDay(page, 8);
    assert.equal(await directionTitle(page), '保留可持续节奏');
    await recordDay(page, 8);
    await completeQuest(page, '保留可持续节奏');
    await completeHabit(page);

    await setDay(page, 9);
    assert.equal(await directionTitle(page, true), '记录');
    await recordDay(page, 9);
    await page.goto(`${baseUrl}/#/today`);
    await page.getByRole('button', { name: `完成打卡：${HABIT}` }).waitFor();
    await saveHabitStatus(page, 'paused');
    assert.equal((await readStores(page, ['quests'])).quests.filter((item) => item.localDate === dayDate(9) && item.status === 'pending').length, 0, 'pausing must settle today\'s generated BONUS without debt');

    await setDay(page, 10);
    assert.equal(await directionTitle(page, true), '记录');
    await recordDay(page, 10, true);
    await saveHabitStatus(page, 'active');
    await completeHabit(page);

    for (const day of [11, 12, 13]) await setDay(page, day, false);

    await setDay(page, 14);
    assert.equal(await page.locator('.overdue-quests').count(), 0, 'returning after three days must not show catch-up work');
    const interruption = await readStores(page, ['quests']);
    assert.equal(interruption.quests.filter((item) => [dayDate(11), dayDate(12), dayDate(13)].includes(item.localDate)).length, 0, 'closed days must not create BONUS or make-up quests');
    assert.equal(await directionTitle(page, true), '记录');
    await recordDay(page, 14);
    await completeHabit(page);

    for (let day = 15; day <= 30; day += 1) {
      await setDay(page, day);
      assert.equal(await page.locator('.overdue-quests').count(), 0, `day ${day} must start without historic debt`);
      assert.equal(await directionTitle(page, true), '记录');
      await recordDay(page, day, day % 5 === 0);
      await completeHabit(page);
    }

    await page.goto(`${baseUrl}/#/tasks`);
    assert.equal(await page.locator('.overdue-quests, .quest-card.is-pending').count(), 0, 'final task board must contain no pending historic debt');
    const final = await readStores(page, ['entries', 'goals', 'milestones', 'habits', 'quests', 'habitLogs', 'xpLedger', 'reviews']);
    assert.equal(final.entries.length, 27);
    assert.equal(final.entries.filter((item) => item.kind === 'success').length, 7);
    assert.deepEqual(final.goals.map((item) => item.status), ['completed']);
    assert.equal(final.milestones.length, 2);
    assert(final.milestones.every((item) => item.status === 'completed' && item.xpSettled));
    assert.equal(final.quests.filter((item) => item.status === 'pending').length, 0);
    assert.equal(final.quests.filter((item) => [dayDate(11), dayDate(12), dayDate(13)].includes(item.localDate)).length, 0);
    assert.equal(final.habits[0]?.status, 'active');
    assert.equal(final.habits[0]?.bonusEnabled, true);
    assert.equal(final.habitLogs.filter((item) => item.result === 'completed').length, 26);
    assert.equal(final.xpLedger.filter((item) => item.sourceType === 'milestone' && !item.reversedAt).length, 2);
    assert.equal(final.reviews.filter((item) => item.status === 'confirmed').length, 1);

    await page.goto(`${baseUrl}/#/growth`);
    await assert.doesNotReject(() => page.locator('.branch-card').first().waitFor());
    await assert.doesNotReject(() => page.getByRole('heading', { name: '成果徽章' }).waitFor());
    await page.locator('.badge-all').getByText(/查看全部徽章/).click();
    await page.getByRole('button', { name: '查看徽章证据：完成第一段可检查成果' }).click();
    const badgeEvidence = page.getByRole('dialog', { name: '徽章证据' });
    assert.equal(await badgeEvidence.getByText(GOAL, { exact: true }).count(), 0, 'badge details should not repeat the whole goal title');
    await assert.doesNotReject(() => badgeEvidence.getByText('留下一份可以查看或使用的初版成果。').first().waitFor());
    assert.deepEqual(apiRequests.map((item) => item.operation), ['goal_decomposition', 'weekly_review']);
  } finally {
    await context.close();
  }
});
