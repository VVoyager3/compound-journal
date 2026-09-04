import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';

const base = process.env.QIGUANG_CAPTURE_URL || 'http://127.0.0.1:4183';
const output = process.env.QIGUANG_CAPTURE_OUTPUT || fileURLToPath(new URL('../design/screenshots/20260904', import.meta.url));
const today = '2026-09-04';
await mkdir(output, { recursive: true });
if (process.argv.includes('--gallery-only')) {
  await writeGallery(JSON.parse(await readFile(`${output}/captures.json`, 'utf8')));
  process.exit(0);
}
process.env.NODE_ENV = 'test';
process.env.QIGUANG_TEST_AI = 'fixture';
const fixture = startServer(0, '127.0.0.1');
if (!fixture.listening) await new Promise(resolve => fixture.once('listening', resolve));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 400, height: 866 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await context.addInitScript(({ now }) => {
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  window.Date = FixedDate;
}, { now: new Date(2026, 8, 4, 18, 20, 0).getTime() });
const page = await context.newPage();
// AI screenshots use the same local contract fixtures as the end-to-end tests.
// No demo diary data is sent to an external AI provider.
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const response = await route.fetch({ url: `${fixtureUrl}${url.pathname}${url.search}`, headers: { ...route.request().headers(), origin: fixtureUrl, host: new URL(fixtureUrl).host } });
  if (!response.ok()) throw new Error(`Local fixture returned ${response.status()}: ${await response.text()}`);
  await route.fulfill({ response });
});
page.setDefaultTimeout(8000);
try {
await page.goto(`${base}/#/today`);

const seeded = await page.evaluate(async ({ today }) => {
  const { QiguangDb } = await import('/src/db.ts');
  const db = await QiguangDb.open();
  // Only the new isolated browser context is seeded; no user profile is accessed.
  await db.ensureI2Defaults();
  await db.saveSettings({ onboardingSeen: true, reduceMotion: true, guidanceTone: 'gentle' });
  await db.saveProfile({ userName: '小栖', companionName: '鱼鱼', avatar: 'female' });
  await db.saveAssessment({ energy: 72, mind: 64, connection: 58, progress: 76, play: 61 }, today);

  const entries = [
    ['2026-09-04', '整理完数学错题后，终于弄懂了二次函数里最容易混淆的地方。', 'success'],
    ['2026-09-04', '放学路上风很舒服，和朋友聊了周末想看的电影。', 'fun'],
    ['2026-09-04', '今天上课有一点累，晚上把任务缩小后反而顺利开始了。', 'journal'],
    ['2026-09-02', '完成了英语演讲的第一版提纲。', 'success'],
    ['2026-09-01', '晚饭后散步二十分钟，回来更容易专心。', 'journal'],
    ['2026-08-30', '第一次连续一周在睡前收好书包。', 'success'],
    ['2026-08-28', '和同学一起解决了小组作业的分工问题。', 'journal'],
  ];
  for (const [date, body, kind] of entries) await db.addEntry(body, date, 'text', kind);
  await db.saveDayCaption(today, '把任务缩小以后，今天重新找回了节奏。');
  await db.saveReview(today, 'daily', {
    progress: '完成医学 AI 项目的实验设计。',
    takeaway: '确认数据划分泄漏风险，补充 AR 框架检查清单。',
    problem: '下午浏览了太多 AI 新闻。',
    tomorrowFocus: '完成基线实验。',
  });
  await db.saveReview('2026-08-31', 'weekly', {
    progress: '实验设计和数学复盘持续推进。',
    assets: '实验检查清单、复习步骤和结果记录。',
    biggestProgress: '遇到卡点时先缩小任务。',
    biggestWaste: '无目的浏览信息流。',
    stopOrReduce: '减少睡前刷手机。',
    nextFocus: '完成基线实验并写出结论。',
  });

  const goal = await db.addGoalWithStages({
    result: '完成本学期数学知识点复盘',
    why: '减少重复出错',
    targetDate: '2026-10-15',
  }, [
    { title: '整理最近两周错题', evidence: '错题完成分类并写出原因', localDate: '2026-09-04', dimension: 'progress', difficulty: 'standard' },
    { title: '完成函数专题练习', evidence: '专题练习正确率达到八成', localDate: '2026-09-08', dimension: 'progress', difficulty: 'hard' },
    { title: '制作期中复习清单', evidence: '清单覆盖所有待复习知识点', localDate: '2026-09-18', dimension: 'mind', difficulty: 'standard' },
  ]);
  await db.feedbackAndProgressQuest(goal.quests[0].id, 'completed', '', '已整理 18 道错题并标记原因', undefined, 0, today);

  const manual = await db.addQuest({ localDate: today, sourceType: 'manual', title: '背诵英语演讲开头', reason: '为周五展示做准备', minimumAction: '读两遍开头', completionCriteria: '脱稿说出前三句', estimatedMinutes: 15, difficulty: 'light', dimension: 'progress' });
  const done = await db.addQuest({ localDate: today, sourceType: 'manual', title: '和奶奶打电话', reason: '保持联系', completionCriteria: '聊十分钟', estimatedMinutes: 10, difficulty: 'light', dimension: 'connection' });
  await db.feedbackQuest(done.id, 'completed', '', '聊了十五分钟', undefined, 0, today);
  await db.addQuest({ localDate: '2026-09-06', sourceType: 'manual', title: '准备周一需要的实验材料', reason: '提前准备', difficulty: 'standard', dimension: 'progress' });

  const habits = [
    await db.addHabit({ name: '晚饭后散步', minimumAction: '下楼走十分钟', trigger: '晚饭后', scheduleDays: [1, 2, 3, 4, 5, 6, 7], dimension: 'energy', difficulty: 'light', bonusEnabled: true }, '2026-07-13'),
    await db.addHabit({ name: '整理数学错题', minimumAction: '整理一道错题', trigger: '写完作业后', scheduleDays: [1, 3, 5], dimension: 'progress', difficulty: 'standard', bonusEnabled: true }, '2026-07-13'),
    await db.addHabit({ name: '睡前收好书包', minimumAction: '检查明天课表', trigger: '睡前', scheduleDays: [1, 2, 3, 4, 5], dimension: 'mind', difficulty: 'light', bonusEnabled: true }, '2026-07-13'),
    await db.addHabit({ name: '喝水', minimumAction: '喝一杯水', trigger: '每节课课间', scheduleDays: [1, 2, 3, 4, 5, 6, 7], dimension: 'energy', difficulty: 'light', bonusEnabled: true, targetCount: 5, countUnit: '杯' }, '2026-07-13'),
  ];
  const start = new Date('2026-07-13T12:00:00');
  for (let offset = 0; offset <= 52; offset += 1) {
    const value = new Date(start); value.setDate(start.getDate() + offset);
    const date = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    await db.ensureTodayBonusQuests(date);
    const quests = (await db.listQuests(date)).filter((quest) => quest.sourceType === 'habit' && quest.status === 'pending');
    for (let index = 0; index < quests.length; index += 1) {
      const quest = quests[index];
      const complete = (offset + index * 2) % 7 !== 0 && date !== today;
      if (!complete) continue;
      if (quest.targetCount) {
        for (let count = 1; count < quest.targetCount; count += 1) await db.changeQuestProgress(quest.id, 1);
        await db.feedbackQuest(quest.id, 'completed', '', '', undefined, 0, date);
      } else await db.feedbackQuest(quest.id, 'completed', '', '', undefined, 0, date);
    }
  }
  await db.ensureTodayBonusQuests(today);
  db.close();
  return { goalId: goal.goal.id, habitId: habits[1].id, manualId: manual.id };
}, { today });

await page.reload();
await page.waitForLoadState('networkidle');
await page.evaluate(() => localStorage.setItem('qiguang.room-guide-seen.v1', '1'));

let shotIndex = 0;
const captures = [];
const geometry = [];
async function shot(name, options = {}) {
  shotIndex += 1;
  await page.waitForTimeout(180);
  if (!options.keepScroll) await page.evaluate(() => window.scrollTo(0, 0));
  const path = `${output}/${String(shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path, fullPage: options.fullPage ?? false, animations: 'disabled' });
  geometry.push({ name, ...await page.evaluate(() => {
    const selectors = '.calendar-day,.analysis-heat-cell,.habit-recent-cell,.habit-weekday-column,.habit-comparison-weeks > span,.goal-detail-stage > .stage-toggle';
    const tiles = [...document.querySelectorAll(selectors)].map(element => {
      const rect = element.getBoundingClientRect();
      return { component: element.className, width: rect.width, height: rect.height };
    }).filter(tile => tile.width > 0 && tile.height > 0);
    const navigation = [...document.querySelectorAll('.bottom-nav')].at(-1);
    const previewOverflow = [...document.querySelectorAll('.preview-option')].filter(element => {
      const rect = element.getBoundingClientRect();
      const copy = element.querySelector(':scope > span')?.getBoundingClientRect();
      return copy && (copy.bottom > rect.bottom + 1 || copy.right > rect.right + 1);
    }).length;
    return { tiles, previewOverflow, navigation: navigation?.getBoundingClientRect().toJSON(), pagePadding: getComputedStyle(document.querySelector('main')).paddingBottom };
  }) });
  captures.push({ name, file: path.split('/').at(-1) });
  console.log(path);
}
async function go(route) {
  await page.goto(`${base}/#/${route}`);
  await page.waitForLoadState('networkidle');
}

await go('today');
await shot('today');
await page.locator('.status-item').first().click();
await shot('state-detail', { fullPage: false });
await page.getByRole('button', { name: '评估这一项' }).click();
await shot('state-self-assessment', { fullPage: false });
await page.keyboard.press('Escape');

await go('tasks');
await shot('tasks-today');
await page.getByRole('tab', { name: '计划', exact: true }).click();
await shot('tasks-plan');
await page.getByRole('tab', { name: '今天', exact: true }).click();
await page.getByRole('button', { name: '添加任务' }).click();
await shot('task-create', { fullPage: false });
await page.keyboard.press('Escape');
await page.locator('.task-item-details').first().click();
await shot('task-edit', { fullPage: false });
await page.keyboard.press('Escape');

await page.getByRole('tab', { name: '计划', exact: true }).click();
await page.locator('.task-goals .section-heading').getByRole('button', { name: '新建', exact: true }).click();
await shot('goal-create', { fullPage: false });
await page.keyboard.press('Escape');
await page.getByRole('button', { name: /查看目标.*的子任务/ }).click();
await shot('goal-detail', { fullPage: false });
await page.keyboard.press('Escape');

await page.locator('.task-habits .section-heading').getByRole('button', { name: '新建', exact: true }).click();
await shot('habit-create', { fullPage: false });
await page.keyboard.press('Escape');
await page.locator('.task-habits .habit-row').first().locator('summary').click();
await page.locator('.task-habits .habit-row').first().getByRole('button', { name: '查看详情' }).click();
await shot('habit-detail', { fullPage: false });
await page.keyboard.press('Escape');

await go('record');
await page.getByRole('textbox', { name: '现在的想法' }).fill('今天最想记住的是：把困难的任务缩小以后，我还是向前走了一步。');
await shot('record-compose');
await page.getByRole('button', { name: '每日复盘', exact: true }).click();
await shot('record-daily-review');

await go(`day/${today}`);
await shot('day-overview');
await page.getByRole('button', { name: '记录', exact: true }).click();
await shot('day-records');
await page.locator('.day-record-row').first().click();
await shot('record-detail', { fullPage: false });
await page.keyboard.press('Escape');
await page.getByRole('button', { name: '行动', exact: true }).click();
await shot('day-actions');
await page.getByRole('button', { name: '复盘', exact: true }).click();
await shot('day-review');
await page.locator('.personal-review-card').getByRole('button', { name: '修改' }).click();
await shot('day-review-editor', { fullPage: false });
await page.keyboard.press('Escape');

await go('calendar');
await shot('calendar');
await go('growth');
await shot('growth');
await go(`review/${today}`);
await shot('weekly-review');
await page.locator('.personal-review-card').getByRole('button', { name: '修改' }).click();
await shot('weekly-review-editor', { fullPage: false });
await page.keyboard.press('Escape');
await go('task-analysis');
await shot('task-analysis');
await go('habit-analysis');
await shot('habit-analysis-overview');
await go(`habit-analysis/${seeded.habitId}`);
await shot('habit-analysis-detail');

await go('system');
await shot('settings');
for (const [label, file] of [['人物与陪伴', 'settings-companion'], ['状态自评', 'settings-assessment'], ['AI 整理', 'settings-ai'], ['导入与导出', 'settings-data']]) {
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  await shot(file, { fullPage: false });
  await page.keyboard.press('Escape');
}

for (const [label, file] of [['AI 发送范围', 'settings-privacy'], ['本地存储', 'settings-storage'], ['显示与语气', 'settings-display'], ['行动规则', 'settings-rules'], ['通知与提醒', 'settings-notifications']]) {
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  await shot(file);
  if (label === '行动规则') {
    await page.getByRole('button', { name: '添加规则' }).click();
    await shot('rule-create');
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');
}
await go('calendar');
await page.locator('.calendar-day.is-today').click();
await shot('date-preview');
await page.keyboard.press('Escape');
await go('growth');
await page.locator('.growth-dimension-card').first().click();
await shot('growth-ledger');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: '查看全部 ›' }).click();
await shot('badges');
await page.getByRole('dialog', { name: '成就册' }).locator('.growth-badge').first().click();
await shot('badge-detail');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await go(`day/${today}`);
await page.getByRole('button', { name: '记录', exact: true }).click();
await page.locator('.day-record-row').first().click();
await page.locator('.record-detail-more > summary').click();
await page.getByRole('button', { name: '修改历史' }).click();
await shot('record-history');
await page.keyboard.press('Escape');
await go('tasks');
await page.getByRole('tab', { name: '计划', exact: true }).click();
await page.locator('.task-habits').scrollIntoViewIfNeeded();
await shot('plan-habits', { keepScroll: true });
await page.locator('.task-habits .habit-row').first().locator('summary').click();
await page.locator('.task-habits .habit-row').first().getByRole('button', { name: /^编辑习惯/ }).click();
await shot('habit-edit');
await page.keyboard.press('Escape');
await page.getByRole('tab', { name: '今天', exact: true }).click();
await page.getByRole('button', { name: '完成：背诵英语演讲开头', exact: true }).click();
await page.locator('.toast.is-completion').waitFor();
await shot('completion-feedback');
await page.locator('.task-settled').getByRole('button', { name: '查看任务：背诵英语演讲开头' }).click();
await shot('task-result');
await page.keyboard.press('Escape');
await go('record');
await page.getByRole('button', { name: '生活日记', exact: true }).click();
await page.getByRole('button', { name: 'AI整理' }).click();
let scope = page.getByRole('dialog', { name: '发送内容' });
await scope.waitFor();
await shot('ai-send');
await scope.getByRole('checkbox', { name: /我允许将本次选中的内容发送/ }).check();
await scope.getByRole('button', { name: '确认并整理' }).click();
await page.waitForFunction(async date => {
  const { QiguangDb } = await import('/src/db.ts');
  const db = await QiguangDb.open();
  const ready = (await db.listDailyAnalyses(date)).some(item => item.status === 'ready');
  db.close();
  return ready;
}, today);
await go(`day/${today}`);
await page.locator('.day-evidence-details > summary').click();
await page.getByRole('heading', { name: '测试整理结果' }).waitFor();
await page.getByRole('heading', { name: '测试整理结果' }).scrollIntoViewIfNeeded();
await shot('ai-candidates', { keepScroll: true });
await go(`review/${today}`);
await page.getByRole('button', { name: '检查范围并生成' }).click();
await page.getByRole('dialog', { name: '生成本周复盘' }).getByRole('button', { name: '确认并生成' }).click();
const consent = page.getByRole('dialog', { name: '允许这一次 AI 周复盘？' });
if (await consent.count()) await consent.getByRole('button', { name: '允许并继续' }).click();
await page.locator('.review-focus-card').getByText('保留可持续节奏', { exact: true }).waitFor();
await page.locator('.review-focus-card').scrollIntoViewIfNeeded();
await page.locator('.toast').waitFor({ state: 'hidden' }).catch(() => {});
await shot('weekly-ai', { keepScroll: true });
await page.getByRole('button', { name: '编辑后采用' }).click();
await shot('weekly-ai-edit');
await page.keyboard.press('Escape');
await page.locator('.personal-review-card').getByRole('button', { name: '修改' }).click();
await page.getByRole('textbox', { name: '下周最重要的一件事' }).scrollIntoViewIfNeeded();
await shot('weekly-review-editor-end', { keepScroll: true });
await page.keyboard.press('Escape');
await go('tasks');
await page.getByRole('tab', { name: '计划', exact: true }).click();
await page.locator('.task-future').scrollIntoViewIfNeeded();
await shot('plan-future', { keepScroll: true });
await page.locator('.task-goals .section-heading').getByRole('button', { name: '新建', exact: true }).click();
const goalEditor = page.getByRole('dialog', { name: '新建目标' });
await goalEditor.getByRole('textbox', { name: '目标名称' }).fill('整理一份数学复习提纲');
await goalEditor.getByRole('button', { name: 'AI 帮我拆成子任务' }).click();
await page.getByRole('dialog', { name: '检查目标拆解发送范围' }).getByRole('button', { name: '确认范围并生成草案' }).click();
const goalConsent = page.getByRole('dialog', { name: '允许这一次目标拆解？' });
if (await goalConsent.count()) await goalConsent.getByRole('button', { name: '允许并继续' }).click();
await goalEditor.locator('.goal-stage-editor').first().waitFor();
await shot('goal-ai');
await page.keyboard.press('Escape');
await go('system');
await page.getByRole('button', { name: /删除全部数据/ }).click();
await shot('delete-confirmation');
await page.keyboard.press('Escape');
const firstUse = await browser.newContext({ viewport: { width: 400, height: 866 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
try {
  const onboarding = await firstUse.newPage();
  await onboarding.goto(base);
  await onboarding.getByRole('dialog', { name: '选一个陪伴角色' }).waitFor();
  const file = `${String(++shotIndex).padStart(2, '0')}-onboarding.png`;
  await onboarding.screenshot({ path: `${output}/${file}`, animations: 'disabled' });
  captures.push({ name: 'onboarding', file });
} finally { await firstUse.close(); }

await writeFile(`${output}/captures.json`, JSON.stringify(captures, null, 2));
await writeGallery(captures);
await writeFile(`${output}/geometry.json`, JSON.stringify(geometry, null, 2));
for (const screen of geometry) assert.equal(screen.previewOverflow, 0, `${screen.name}: preview content must stay inside its card`);
for (const screen of geometry) for (const tile of screen.tiles) {
  assert.ok(Math.abs(tile.width - tile.height) < .1, `${screen.name}: ${tile.component} must be square (${tile.width}×${tile.height})`);
}
} finally {
  await browser.close();
  await new Promise(resolve => fixture.close(resolve));
}

async function writeGallery(captures) {
  const manifest = JSON.parse(await readFile(new URL('../design/reference-20260904/manifest.json', import.meta.url), 'utf8'));
  const referenceIds = {
    today: 1, 'state-detail': 2, 'state-self-assessment': 3, 'tasks-today': 4, 'tasks-plan': 5,
    'plan-habits': 6, 'plan-future': 7, 'task-create': 8, 'task-edit': 9, 'task-result': 10,
    'goal-create': 11, 'goal-ai': 12, 'goal-detail': 13, 'habit-create': 14, 'habit-detail': 15, 'habit-edit': 16,
    'record-compose': 17, 'record-daily-review': 18, 'ai-send': 19, 'ai-candidates': 20,
    calendar: 21, 'date-preview': 22, 'day-overview': 23, 'day-records': 24, 'record-detail': 25, 'record-history': 26,
    'day-actions': 27, 'weekly-review': 28, 'weekly-review-editor': 29, 'weekly-review-editor-end': 30, 'weekly-ai': 31, 'weekly-ai-edit': 32,
    growth: 33, 'growth-ledger': 34, badges: 35, 'badge-detail': 36, 'task-analysis': 37, 'habit-analysis-overview': 38, 'habit-analysis-detail': 39,
    settings: 40, 'settings-companion': 41, 'settings-assessment': 42, 'settings-ai': 43, 'settings-privacy': 44,
    'settings-data': 45, 'settings-storage': 46, 'delete-confirmation': 47, 'settings-display': 48, 'settings-rules': 49,
    'rule-create': 50, widget: 51, 'settings-notifications': 52, onboarding: 53, 'image-view': 54, 'completion-feedback': 55, 'ai-error': 56,
  };
  const used = new Set(captures.map(item => referenceIds[item.name]));
  const missing = manifest.screens.filter(screen => !used.has(Number(screen.id.slice(0, 2))));
  const picture = (src, label) => `<figure><figcaption>${label}</figcaption><a href="${src}"><img src="${src}" loading="lazy" alt="${label}"></a></figure>`;
  const sections = captures.map(item => {
    const reference = manifest.screens.find(screen => Number(screen.id.slice(0, 2)) === referenceIds[item.name]);
    return `<section><h2>${reference?.title ?? item.name}</h2><div class="pair">${reference ? picture(`../../reference-20260904/${reference.file}`, '参考稿') : ''}${picture(item.file, '实际运行 · ' + item.file)}</div></section>`;
  }).join('');
  await writeFile(`${output}/index.html`, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>栖光 · 逐页对照审计</title><style>body{margin:32px;background:#f7f3e8;color:#214d3c;font:16px/1.5 sans-serif}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,640px),1fr));gap:40px}section{min-width:0}h1{font-size:26px}h2{font-size:18px;font-weight:500}.pair{display:flex;gap:16px;align-items:start}figure{flex:1;min-width:0;margin:0}figcaption{font-size:12px;margin-bottom:12px;overflow-wrap:anywhere}img{width:100%;border:1px solid #d9d2c1}a{color:inherit}details{margin:24px 0}</style><h1>栖光 · 逐页对照审计</h1><p>${captures.length} 张实际运行截图 · 400×866 CSS 视口 · 独立仿真数据 · AI 使用本地合约测试响应</p><details><summary>尚未实拍的参考状态：${missing.length}</summary>${missing.map(screen=>`<p><a href="../../reference-20260904/${screen.file}">${screen.id} ${screen.title}</a></p>`).join('')}</details><main>${sections}</main></html>`);
}
