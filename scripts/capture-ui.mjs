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
  const saved = JSON.parse(await readFile(`${output}/captures.json`, 'utf8'));
  await writeGallery(saved);
  try { await writeTextAudit(JSON.parse(await readFile(`${output}/text-audit.json`, 'utf8')), saved); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
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
  const target = options.target || page;
  shotIndex += 1;
  await target.waitForTimeout(180);
  if (!options.keepScroll) await target.evaluate(() => window.scrollTo(0, 0));
  const path = `${output}/${String(shotIndex).padStart(2, '0')}-${name}.png`;
  await target.screenshot({ path, fullPage: options.fullPage ?? false, animations: 'disabled' });
  // A real rendered DOM snapshot, not a separately maintained imitation page.
  // This context contains only the fixture above. No app bootstrap or storage code
  // is copied, so the tuner can change CSS without opening a user's database.
  const snapshot = await target.evaluate(() => {
    const copy = document.documentElement.cloneNode(true);
    copy.querySelectorAll('script,link[rel="modulepreload"]').forEach(el => el.remove());
    for (const container of copy.querySelectorAll('head,body')) {
      for (const child of [...container.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) child.remove();
      }
    }
    const originalFields = [...document.querySelectorAll('input,textarea,select')];
    copy.querySelectorAll('input,textarea,select').forEach((el, index) => {
      const original = originalFields[index];
      if (el.tagName === 'TEXTAREA') el.textContent = original.value;
      else if (el.tagName === 'INPUT') {
        el.setAttribute('value', el.type === 'password' ? '' : original.value);
        el.toggleAttribute('checked', original.checked);
      } else [...el.options].forEach((option, i) => option.toggleAttribute('selected', original.options[i].selected));
    });
    [copy, ...copy.querySelectorAll('*')].forEach(el => {
      // Keep runtime CSS inert while HTML parses under the unchanged production CSP.
      if (el.hasAttribute('style')) {
        el.dataset.snapshotStyle = JSON.stringify([...el.style].map(name => [name, el.style.getPropertyValue(name), el.style.getPropertyPriority(name)]));
        el.removeAttribute('style');
      }
      for (const attribute of [...el.attributes]) if (attribute.name.startsWith('on')) el.removeAttribute(attribute.name);
      for (const name of ['src', 'href']) if (el.hasAttribute(name)) {
        const url = new URL(el.getAttribute(name), location.href);
        if (url.origin === location.origin) el.setAttribute(name, url.pathname + url.search + url.hash);
      }
    });
    const script = document.createElement('script'); script.src = '/design/snapshot-preview.js';
    copy.querySelector('body').append(script);
    copy.dataset.uiSnapshot = 'fixture-only';
    return '<!doctype html>\n' + copy.outerHTML;
  });
  await writeFile(path.replace(/\.png$/, '.html'), snapshot);
  geometry.push({ name, ...await target.evaluate(() => {
    // Audit the active dialog rather than counting the obscured page as visible.
    const scope = [...document.querySelectorAll('dialog[open]')].at(-1) || document.querySelector('main');
    const rendered = el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
    const metaSelectors = '.caption,.muted,.empty-copy,.save-state,.status-name,.settings-overview-status,.page-header-meta,.character-count,.field-character-count,.state-score-date,.ui-row-value,.ui-row-meta,.habit-plan-summary';
    const textMetrics = [...scope.querySelectorAll(`.ui-page-title,.ui-list-heading,h2,h3,p,${metaSelectors},.ui-row-label,.field-label,.input,textarea`)]
      .filter(rendered).map(el => {
        const role = el.matches('.ui-page-title') ? 'page'
          : el.closest('[data-ui-row]') && el.matches('h2,h3,.ui-row-label') ? 'body'
          : el.matches('.ui-list-heading,h2,h3') ? 'section'
          : el.matches(metaSelectors) ? 'meta'
          : el.matches('.field-label') ? 'label' : 'body';
        const style = getComputedStyle(el);
        return { role, tag: el.tagName, classes: el.className, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 90), size: style.fontSize, weight: style.fontWeight, leading: style.lineHeight };
      });
    const sectionGaps = [...scope.querySelectorAll('.ui-list-section,.ui-settings-group')].filter(rendered).map(el => {
      const children = [...el.children].filter(rendered);
      return { title: children[0]?.textContent?.slice(0, 40), gap: children.length > 1 ? children[1].getBoundingClientRect().top - children[0].getBoundingClientRect().bottom : null };
    });
    const selectors = '.calendar-day,.analysis-heat-cell,.habit-recent-cell,.habit-weekday-column,.habit-comparison-weeks > span,.goal-detail-stage > .stage-toggle';
    const tiles = [...scope.querySelectorAll(selectors)].map(element => {
      const rect = element.getBoundingClientRect();
      return { component: element.className, width: rect.width, height: rect.height };
    }).filter(tile => tile.width > 0 && tile.height > 0);
    const navigation = [...document.querySelectorAll('.bottom-nav')].at(-1);
    const previewOverflow = [...scope.querySelectorAll('.preview-option')].filter(element => {
      const rect = element.getBoundingClientRect();
      const copy = element.querySelector(':scope > span')?.getBoundingClientRect();
      return copy && (copy.bottom > rect.bottom + 1 || copy.right > rect.right + 1);
    }).length;
    const listRows = [...scope.querySelectorAll('[data-ui-row]')].filter(rendered).map(element => {
      const style = getComputedStyle(element);
      return {
        component: element.className,
        height: element.getBoundingClientRect().height,
        width: element.getBoundingClientRect().width,
        grouped: element.parentElement.classList.contains('ui-list-group'),
        minHeight: style.minHeight,
        paddingInline: `${style.paddingLeft} ${style.paddingRight}`,
        paddingBlock: `${style.paddingTop} ${style.paddingBottom}`,
        radius: style.borderRadius,
      };
    });
    const metricCenters = [...scope.querySelectorAll('.ui-metrics > :is(span, div)')].map(element => {
      const rect = element.getBoundingClientRect();
      const number = element.querySelector('strong')?.getBoundingClientRect();
      return number ? Math.abs((number.left + number.right - rect.left - rect.right) / 2) : 0;
    });
    const filterHeader = scope.querySelector('.ui-titlebar-with-filter');
    const filter = filterHeader?.querySelector('.analysis-range-tabs')?.getBoundingClientRect();
    const header = filterHeader?.getBoundingClientRect();
    const typography = [...scope.querySelectorAll('.ui-page-title, .ui-list-heading, h2, h3')]
      .filter(el => el.getBoundingClientRect().width)
      .map(el => ({
        text: el.textContent,
        role: el.classList.contains('ui-page-title') ? 'page'
          : el.closest('[data-ui-row]') ? 'row'
            : 'section',
        size: getComputedStyle(el).fontSize,
        weight: getComputedStyle(el).fontWeight,
      }));
    const titlebars = [...scope.querySelectorAll('.page > .ui-titlebar, dialog[open] .dialog-content > .ui-titlebar')].filter(rendered);
    const titlebar = titlebars.at(-1);
    const shell = titlebar?.parentElement;
    const next = titlebar?.nextElementSibling;
    const shellStyle = shell ? getComputedStyle(shell) : null;
    const titleStyle = titlebar?.querySelector('.ui-page-title') ? getComputedStyle(titlebar.querySelector('.ui-page-title')) : null;
    const pageShell = shell && titlebar && next ? {
      paddingLeft: shellStyle.paddingLeft,
      paddingRight: shellStyle.paddingRight,
      titleHeight: titlebar.getBoundingClientRect().height,
      titleGap: next.getBoundingClientRect().top - titlebar.getBoundingClientRect().bottom,
      titleSize: titleStyle.fontSize,
      titleWeight: titleStyle.fontWeight,
    } : null;
    const shellCoverage = { scope: scope.tagName === 'DIALOG' ? 'dialog' : 'page', measured: Boolean(pageShell), reason: pageShell ? 'active titlebar' : 'no measurable shared titlebar in active scope; not validated' };
    return { tiles, listRows, metricCenters, typography, textMetrics, sectionGaps, pageShell, shellCoverage, filterRightGap: filter && header ? header.right - filter.right : null, previewOverflow, navigation: navigation?.getBoundingClientRect().toJSON(), pagePadding: getComputedStyle(document.querySelector('main')).paddingBottom };
  }) });
  captures.push({ name, file: path.split('/').at(-1) });
  await writeFile(`${output}/captures.json`, JSON.stringify(captures, null, 2));
  await writeGallery(captures);
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
await page.getByRole('button', { name: '重新评估' }).click();
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
await page.getByRole('dialog').locator('.task-item-management > summary').click();
await page.getByRole('button', { name: /^编辑任务：/ }).click();
await page.getByRole('dialog', { name: '修改任务', exact: true }).waitFor();
await shot('task-edit', { fullPage: false });
await page.keyboard.press('Escape');

await page.getByRole('tab', { name: '计划', exact: true }).click();
await page.getByRole('button', { name: '目标', exact: true }).click();
await page.locator('.task-goals .section-heading').getByRole('button', { name: '新建', exact: true }).click();
await shot('goal-create', { fullPage: false });
await page.keyboard.press('Escape');
await page.getByRole('button', { name: /查看目标.*的子任务/ }).click();
await shot('goal-detail', { fullPage: false });
await page.keyboard.press('Escape');

await page.getByRole('button', { name: '习惯', exact: true }).click();
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
await page.getByRole('button', { name: '整记', exact: true }).click();
await page.getByRole('textbox', { name: '完整记录' }).fill('今天把困难的任务缩小以后，仍然完成了关键的一步，也找到了更适合自己的推进节奏。');
await shot('record-full');

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
await page.getByRole('button', { name: '习惯', exact: true }).click();
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
await page.getByRole('button', { name: '随记', exact: true }).click();
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
// Wait for the async result render before expanding; an earlier render can
// replace the details element and silently close the just-clicked section.
await page.getByRole('heading', { name: '测试整理结果', includeHidden: true }).waitFor({ state: 'attached' });
await page.locator('.day-evidence-details > summary').click();
await page.getByRole('heading', { name: '测试整理结果' }).waitFor();
await page.getByRole('heading', { name: '测试整理结果' }).scrollIntoViewIfNeeded();
await shot('ai-candidates', { keepScroll: true });
await go(`review/${today}`);
await page.getByRole('button', { name: '检查范围并生成' }).click();
await page.getByRole('dialog', { name: '生成本周复盘' }).getByRole('button', { name: '确认并生成' }).click();
const consent = page.getByRole('dialog', { name: '允许这一次 AI 周复盘？' });
if (await consent.count()) await consent.getByRole('button', { name: '允许并继续' }).click();
await page.locator('.review-next-plan').getByText('保留可持续节奏', { exact: true }).waitFor();
await page.locator('.review-next-plan').scrollIntoViewIfNeeded();
await page.locator('.toast').waitFor({ state: 'hidden' }).catch(() => {});
await shot('weekly-ai', { keepScroll: true });
await page.getByRole('button', { name: '修改下周建议' }).click();
await shot('weekly-ai-edit');
await page.keyboard.press('Escape');
await page.locator('.personal-review-card').getByRole('button', { name: '修改' }).click();
await page.getByRole('textbox', { name: '下周最重要的一件事' }).scrollIntoViewIfNeeded();
await shot('weekly-review-editor-end', { keepScroll: true });
await page.keyboard.press('Escape');
await go('tasks');
await page.getByRole('tab', { name: '计划', exact: true }).click();
await page.getByRole('button', { name: '之后已安排', exact: true }).click();
await page.locator('.task-future').scrollIntoViewIfNeeded();
await shot('plan-future', { keepScroll: true });
await page.getByRole('button', { name: '目标', exact: true }).click();
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
  await shot('onboarding', { target: onboarding });
} finally { await firstUse.close(); }

await writeFile(`${output}/captures.json`, JSON.stringify(captures, null, 2));
await writeGallery(captures);
await writeFile(`${output}/geometry.json`, JSON.stringify(geometry, null, 2));
// Findings are an audit, not a claim that every leaf has a known semantic role.
const expectedText = { page: [16, 800, 19.2], section: [14.5, 800, 19.575], body: [12.5, 400, 18.75], meta: [11.5, 400, 15.525], label: [12.5, 500, 18.75] };
const findings = geometry.flatMap(screen => screen.textMetrics.flatMap(item => {
  const expected = expectedText[item.role];
  return [item.size, item.weight, item.leading].some((value, i) => Math.abs(parseFloat(value) - expected[i]) > .06)
    ? [{ screen: screen.name, ...item, expected }] : [];
}));
const textAudit = { screenshots: captures.length, measuredTextNodes: geometry.reduce((n, screen) => n + screen.textMetrics.length, 0), scope: 'Visible DOM in active dialog or page; known roles only. Includes line-height; semantic exceptions require review.', findings };
await writeFile(`${output}/text-audit.json`, JSON.stringify(textAudit, null, 2));
await writeTextAudit(textAudit, captures);
console.log(`Text audit: ${findings.length} candidates for semantic/style review; see text-audit.json`);
assert.equal(findings.length, 0, 'Known text roles must match size, weight and line-height; inspect text-audit.json for failures');
for (const screen of geometry) assert.equal(screen.previewOverflow, 0, `${screen.name}: preview content must stay inside its card`);
for (const screen of geometry) {
  assert.ok(screen.pageShell, `${screen.name}: every active page/dialog must use a measurable titlebar`);
  assert.equal(screen.pageShell.paddingLeft, '20px', `${screen.name}: page uses shared left padding`);
  assert.equal(screen.pageShell.paddingRight, '20px', `${screen.name}: page uses shared right padding`);
  assert.equal(screen.pageShell.titleHeight, 44, `${screen.name}: page uses shared titlebar height`);
  assert.ok(Math.abs(screen.pageShell.titleGap - 4) < .1, `${screen.name}: page uses shared title-to-content gap (${screen.pageShell.titleGap}px)`);
  assert.equal(screen.pageShell.titleSize, '16px', `${screen.name}: page uses approved title size`);
  assert.equal(screen.pageShell.titleWeight, '800', `${screen.name}: page uses approved title weight`);
}
for (const screen of geometry) for (const type of screen.typography) {
  const expected = type.role === 'page'
    ? { size: '16px', weight: '800' }
    : type.role === 'section'
      ? { size: '14.5px', weight: '800' }
      : { size: '12.5px', weight: '400' };
  assert.equal(type.size, expected.size, `${screen.name}: ${type.role} “${type.text}” uses the shared font size`);
  assert.equal(type.weight, expected.weight, `${screen.name}: ${type.role} “${type.text}” uses the shared font weight`);
}
for (const screen of geometry) for (const tile of screen.tiles) {
  assert.ok(Math.abs(tile.width - tile.height) < .1, `${screen.name}: ${tile.component} must be square (${tile.width}×${tile.height})`);
}
for (const screen of geometry) {
  for (const offset of screen.metricCenters) assert.ok(offset < 1, `${screen.name}: metric must be centered`);
  if (screen.filterRightGap !== null) assert.ok(Math.abs(screen.filterRightGap) < 5, `${screen.name}: range filter must align right`);
}
for (const screen of geometry) for (const row of screen.listRows) {
  assert.equal(row.minHeight, '45px', `${screen.name}: ${row.component} must use the shared row height`);
  if (!row.grouped) assert.equal(row.radius, '8px', `${screen.name}: standalone row uses shared radius`);
  const isAction = row.component.includes('ui-action-row');
  assert.equal(row.paddingInline, isAction ? '0px 0px' : '20px 20px', `${screen.name}: ${row.component} must use shared horizontal padding`);
  assert.equal(row.paddingBlock, '0px 0px', `${screen.name}: ${row.component} must use shared vertical padding`);
}
} finally {
  await browser.close();
  await new Promise(resolve => fixture.close(resolve));
}

async function writeGallery(captures) {
  const sections = captures.map(item => `<section><h2>${item.file.replace('.png', '')}</h2><a href="${item.file}"><img src="${item.file}" loading="lazy" alt="${item.file}"></a></section>`).join('');
  await writeFile(`${output}/index.html`, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>栖光 · 最新页面截图审计</title><style>body{margin:32px;background:#f7f3e8;color:#214d3c;font:16px/1.5 sans-serif}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:32px 24px}section{min-width:0}h1{font-size:26px}h2{margin:0 0 10px;font-size:15px}img{display:block;width:100%;border:1px solid #d9d2c1;background:#fcfaf4}a{color:inherit}</style><h1>栖光 · 最新页面截图审计</h1><p>${captures.length} 张实际运行截图 · 400×866 CSS 视口 · 点击图片查看原图</p><main>${sections}</main></html>`);
}

async function writeTextAudit(audit, captures) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const groups = new Map();
  for (const item of audit.findings) {
    const key = [item.role, item.tag, item.classes, item.size, item.weight, item.leading].join(' / ');
    const group = groups.get(key) || { item, count: 0, screens: new Set() };
    group.count++; group.screens.add(item.screen); groups.set(key, group);
  }
  const rows = [...groups.values()].map(({ item, count, screens }) => `<tr><td>${escape(item.role)}<br><code>${escape(item.tag + '.' + item.classes)}</code></td><td>${escape(item.text)}</td><td>${escape([item.size, item.weight, item.leading].join(' / '))}<br>基准：${item.expected.join(' / ')}</td><td>${count}</td><td>${[...screens].map(name => `<a href="${escape(captures.find(capture => capture.name === name).file)}">${escape(name)}</a>`).join('<br>')}</td></tr>`).join('');
  await writeFile(`${output}/text-audit.html`, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>栖光 · 组件审计结果</title><style>body{margin:24px;color:#214d3c;background:#fcfaf4;font:14px/1.5 system-ui}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #d9d2c1;padding:12px;vertical-align:top}code{overflow-wrap:anywhere}a{color:inherit}main{overflow:auto}</style><h1>还不能判定全部统一</h1><p>${audit.screenshots} 张页面/状态截图，${audit.measuredTextNodes} 个已识别角色的文字节点。${audit.findings.length} 次偏差合并为 ${groups.size} 组选择器/规格组合，不等于 ${audit.findings.length} 个独立缺陷。</p><p>只检查已识别文字角色；重复页面状态会重复计数。统计、日期和说明的语义例外需要人工判断，未覆盖所有交互状态、设备字体和断点。</p><p><a href="../../ui-tuner.html?view=components&revision=template-audit">打开可调整模板</a> · <a href="index.html">全部截图</a> · <a href="text-audit.json">原始检测结果</a></p><main><table><thead><tr><th>角色 / 选择器</th><th>示例</th><th>字号 / 字重 / 行高</th><th>次数</th><th>截图</th></tr></thead><tbody>${rows}</tbody></table></main></html>`);
}
