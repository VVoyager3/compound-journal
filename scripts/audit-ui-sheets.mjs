import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const folder = resolve(process.argv[2] || 'design/screenshots/20260905-settings-spacing');
await mkdir(`${folder}/audit`, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1680 } });
  await page.goto(pathToFileURL(`${folder}/index.html`).href);
  const sections = await page.locator('main > section').evaluateAll(items => items.map(item => item.outerHTML));
  for (let offset = 0; offset < sections.length; offset += 6) {
    await page.setContent(`<style>body{margin:12px;background:#eee;font:14px sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}section{min-width:0}h2{font-size:14px;margin:0 0 4px}.pair{display:flex;gap:4px}figure{margin:0;flex:1;min-width:0}figcaption{font-size:10px;height:26px}img{width:100%;height:730px;object-fit:contain;object-position:top;background:white}</style><main>${sections.slice(offset,offset+6).join('')}</main>`);
    await page.locator('img').evaluateAll((items, base) => items.forEach(img => { img.loading = 'eager'; img.src = new URL(img.getAttribute('src'), base).href; }), pathToFileURL(`${folder}/index.html`).href);
    await page.locator('img').evaluateAll(items => Promise.all(items.map(img => img.decode().catch(() => {}))));
    await page.screenshot({ path: `${folder}/audit/sheet-${String(offset+1).padStart(2,'0')}.png`, fullPage: true });
  }
} finally { await browser.close(); }
