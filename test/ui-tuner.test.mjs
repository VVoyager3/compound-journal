import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

test('UI tuner shares geometry, persists parameters and safely exports/imports without app data', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}design/ui-tuner.html`);
    const candidate = page.frameLocator('#candidate');
    const measureTitleGaps = () => candidate.locator('.review-screen').evaluateAll(screens => screens.map(screen => ({
      gap: screen.children[1].getBoundingClientRect().top - screen.children[0].getBoundingClientRect().bottom,
      height: screen.children[0].getBoundingClientRect().height,
      font: getComputedStyle(screen.querySelector('.ui-page-title')).fontSize,
      weight: getComputedStyle(screen.querySelector('.ui-page-title')).fontWeight,
    })));
    const baseline = page.frameLocator('#baseline');
    await baseline.locator('[data-ui-row]').first().waitFor();
    assert.equal(await baseline.locator('[data-ui-row]').first().evaluate(row => row.getBoundingClientRect().height), 45);
    assert.equal(await baseline.locator('.ui-list-heading').first().evaluate(row => getComputedStyle(row).fontSize), '14.5px');
    assert.equal(await page.locator('#parameter-catalog tr').count(), 31);
    await candidate.locator('.task-list-item.has-count').waitFor();
    const countGap = page.getByRole('spinbutton', { name: '0/5杯 到 +1数值' });
    await countGap.fill('10');
    assert.equal(await candidate.locator('.has-count .task-row-action').evaluate(el => getComputedStyle(el).paddingRight), '10px', 'count gap changes the real task renderer');
    await countGap.fill('2');
    const contentGap = page.getByRole('spinbutton', { name: '图标到名称 / 正文到状态数值' });
    await contentGap.fill('18');
    assert.equal(await candidate.locator('.ui-info-row').first().evaluate(el => getComputedStyle(el).columnGap), '18px', 'row gap changes real information rows');
    await contentGap.fill('11');
    const buttonSelector = '[data-example="components"] .button';
    await candidate.locator(buttonSelector).first().waitFor();
    assert.equal(await baseline.locator(buttonSelector).first().evaluate(el => el.getBoundingClientRect().height), 36);
    assert.deepEqual(await candidate.locator(buttonSelector).evaluateAll(items => items.map(el => el.getBoundingClientRect().height)), [36,36,36,36]);
    await candidate.locator(buttonSelector).first().scrollIntoViewIfNeeded();
    assert.equal(await candidate.locator(buttonSelector).first().evaluate(el => {
      const box = el.getBoundingClientRect();
      return [box.top - 3, box.bottom + 3].every(y => el.contains(document.elementFromPoint(box.x + box.width / 2, y)));
    }), true, 'invisible top and bottom edges remain clickable');
    await page.getByRole('button', { name: '紧凑候选', exact: true }).click();
    const rows = await candidate.locator('[data-example="single"] .ui-list-row').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
    assert.equal(new Set(rows).size, 1, 'pending, habit, completed and read-only rows share geometry');
    await page.getByRole('spinbutton', { name: '正文 / 列表名称数值' }).fill('14');
    await page.locator('.controls details[data-group="间隔"] > summary').click();
    await page.getByRole('spinbutton', { name: '分组标题到列表数值' }).fill('8');
    await page.getByRole('spinbutton', { name: '页面标题到正文数值' }).fill('12');
    assert.ok((await measureTitleGaps()).every(({gap}) => gap === 12), 'actual gap has one owner, not margin plus grid gap');
    await page.reload();
    assert.equal(await page.getByRole('spinbutton', { name: '正文 / 列表名称数值' }).inputValue(), '14');
    assert.equal(await page.locator('input[type="number"][data-key="--review-page-title-gap"]').inputValue(), '12');
    await candidate.locator('.ui-row-label').first().waitFor();
    assert.equal(await page.locator('[data-key="--ui-list-gap"]').first().isVisible(), false, 'hide prototype-only controls for real lists');
    assert.equal(await candidate.locator('.ui-row-label').first().evaluate(row => getComputedStyle(row).fontSize), '14px');
    await page.getByRole('combobox', { name: '预览组件' }).selectOption('edit');
    await candidate.locator('.sample-modal .sample-field').first().waitFor();
    const formGap = page.locator('input[type="number"][data-key="--ui-form-gap"]');
    const fieldGap = page.locator('input[type="number"][data-key="--ui-field-gap"]');
    assert.equal(await formGap.isVisible(), true, 'editing a task reveals its spacing controls');
    await formGap.fill('12');
    await fieldGap.fill('14');
    const measureFields = () => candidate.locator('.sample-modal .sample-field').evaluateAll(fields => ({
      vertical: fields[1].getBoundingClientRect().top - fields[0].getBoundingClientRect().bottom,
      horizontal: fields[0].lastElementChild.getBoundingClientRect().left - fields[0].firstElementChild.getBoundingClientRect().right,
    }));
    assert.deepEqual(await measureFields(), { vertical: 12, horizontal: 14 });
    await page.reload();
    await page.getByRole('combobox', { name: '预览组件' }).selectOption('edit');
    await candidate.locator('.sample-modal .sample-field').first().waitFor();
    assert.deepEqual(await measureFields(), { vertical: 12, horizontal: 14 }, 'field spacing survives reload');
    await page.locator('.controls details[data-group="间隔"] > summary').click();
    await page.locator('.controls details[data-group="页面"] > summary').click();
    for (const width of [320, 400, 480]) {
      await page.getByRole('spinbutton', { name: '手机视口宽度数值' }).fill(String(width));
      for (const view of ['components','lists','settings','goals','edit','repeat','daily','weekly','calendar','growth','analysis']) {
        await page.getByRole('combobox', { name: '预览组件' }).selectOption(view);
        await candidate.locator('h1').waitFor();
        const overflowing = await candidate.locator('body').evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflowing, false, view + ' must not overflow at ' + width);
        const titleGaps = await measureTitleGaps();
        assert.ok(titleGaps.length > 0);
        assert.ok(titleGaps.every(({gap, height, font, weight}) => gap === 12 && height === 44 && font === '16px' && weight === '800'), view + ' shares title geometry at ' + width + ': ' + JSON.stringify(titleGaps));
        const groupGaps = await candidate.locator('.ui-list-section,.ui-settings-group').evaluateAll(groups => groups.map(group => group.children[1].getBoundingClientRect().top - group.children[0].getBoundingClientRect().bottom));
        assert.ok(groupGaps.every(gap => gap === 8), view + ' uses the same section heading gap');
        await page.getByRole('spinbutton', { name: '页面标题到正文数值' }).fill('24');
        assert.ok((await measureTitleGaps()).every(({gap}) => gap === 24), view + ' responds to the title gap control');
        await page.getByRole('spinbutton', { name: '分组标题到列表数值' }).fill('16');
        assert.ok((await candidate.locator('.ui-list-section,.ui-settings-group').evaluateAll(groups => groups.map(group => group.children[1].getBoundingClientRect().top - group.children[0].getBoundingClientRect().bottom))).every(gap => gap === 16), view + ' responds to the group heading gap control');
        await page.getByRole('spinbutton', { name: '页面标题到正文数值' }).fill('12');
        await page.getByRole('spinbutton', { name: '分组标题到列表数值' }).fill('8');
        await candidate.locator('html').evaluate(el => el.style.setProperty('--ui-font-page', '32px'));
        assert.ok((await measureTitleGaps()).every(({gap}) => gap === 12), view + ' preserves spacing with 200% title text');
        assert.equal(await candidate.locator('body').evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await candidate.locator('html').evaluate(el => el.style.setProperty('--ui-font-page', '16px'));
        if (view === 'settings') {
          await baseline.locator('h1').filter({ hasText: '设置' }).waitFor();
          assert.equal(await baseline.locator('.ui-list-heading').count(), 4, 'baseline shows the same template');
          assert.equal(await candidate.locator('h1').textContent(), '设置');
          assert.deepEqual(await candidate.locator('.ui-list-heading').allTextContents(), ['个人','功能','数据与隐私','高级']);
        }
        if (view === 'edit') {
          const actions = candidate.locator('.sample-modal .ui-actions-pair button');
          assert.deepEqual(await actions.allTextContents(), ['删除任务', '保存修改']);
          for (const fontSize of ['13px', '26px']) {
            await candidate.locator('html').evaluate((el, size) => el.style.setProperty('--ui-font-control', size), fontSize);
            const boxes = await actions.evaluateAll(items => items.map(el => ({...el.getBoundingClientRect().toJSON(), overflow: el.scrollWidth > el.clientWidth})));
            assert.equal(boxes[0].top, boxes[1].top, 'paired actions stay on one row');
            assert.ok(Math.abs(boxes[0].width - boxes[1].width) < 1);
            assert.ok(boxes.every(box => !box.overflow), 'large text stays within each button');
          }
        }
      }
    }
    await page.getByRole('combobox', { name: '预览组件' }).selectOption('analysis');
    await candidate.getByRole('heading', { name: '任务分析' }).waitFor();
    assert.equal(await candidate.locator('.sample-heat-grid > span').count(), 84);
    assert.equal(await candidate.locator('.sample-analysis-list .ui-list-row').count(), 5);
    await candidate.getByRole('button', { name: '心理' }).click();
    assert.equal(await candidate.getByRole('button', { name: '心理' }).getAttribute('aria-pressed'), 'true');
    assert.equal(new URL(page.url()).searchParams.get('view'), 'analysis');
    await page.getByRole('combobox', { name: '预览组件' }).selectOption('daily');
    await candidate.getByRole('button', { name: '编辑模板' }).click();
    await candidate.getByRole('textbox', { name: '小标题', exact: true }).first().fill('今天的收获');
    await candidate.getByRole('button', { name: '＋ 添加小标题' }).click();
    assert.equal(await candidate.locator('.sample-template-field').count(), 5);
    await candidate.getByRole('button', { name: '删除此小标题' }).last().click();
    await candidate.getByRole('button', { name: '完成模板编辑' }).click();
    assert.equal(await candidate.locator('.sample-field-label').first().innerText(), '今天的收获');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出参数', exact: true }).click();
    const data = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
    assert.equal(data.format, 'qiguang-ui-review');
    assert.equal(data.values['--ui-font-body'], 14);
    assert.equal(data.values['--ui-form-gap'], 12);
    assert.equal(data.values['--ui-field-gap'], 14);
    await page.getByRole('button', { name: '恢复 32 基准' }).click();
    await page.locator('#file').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.getByRole('status').getByText('参数已导入。').waitFor();
    assert.equal(await formGap.inputValue(), '12');
    assert.equal(await fieldGap.inputValue(), '14');
    assert.equal(await page.getByRole('spinbutton', { name: '正文 / 列表名称数值' }).inputValue(), '14');
    await page.locator('#file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...data, values: { '--ui-font-body': 900 } })) });
    await page.getByRole('status').getByText(/导入失败/).waitFor();
    assert.equal(await page.getByRole('spinbutton', { name: '正文 / 列表名称数值' }).inputValue(), '14');
    const legacyParameters = structuredClone(data);
    delete legacyParameters.values['--ui-action-gap'];
    await page.locator('#file').setInputFiles({ name: 'original-30.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyParameters)) });
    await page.getByRole('status').getByText('参数已导入。').waitFor();
    assert.equal(await page.locator('input[type="number"][data-key="--ui-action-gap"]').inputValue(), '8', 'original parameters gain only the independent action gap default');
    assert.equal(await page.getByRole('spinbutton', { name: '正文 / 列表名称数值' }).inputValue(), '14');
    assert.deepEqual(errors, []);
    await page.getByRole('button', { name: '恢复 32 基准' }).click();
    await page.getByRole('combobox', { name: '预览组件' }).selectOption('lists');
    await candidate.locator('.ui-row-label').first().waitFor();
    await page.screenshot({ path: new URL('../design/ui-tuner-preview.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: false });
  } finally { await browser.close(); await server.close(); }
});
