import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractWechatArticle, extractWechatUrls, normaliseAnalysis, validateImages } from './server.mjs';
import { createAppServer } from './server.mjs';

const originalApiKey = process.env.MINIMAX_API_KEY;
delete process.env.MINIMAX_API_KEY;

assert.deepEqual(
  extractWechatUrls('看看 https://mp.weixin.qq.com/s/abc123。普通链接 https://example.com 不读取'),
  ['https://mp.weixin.qq.com/s/abc123'],
);

const article = extractWechatArticle(`
  <html><head><meta property="og:title" content="复利与耐心"></head><body>
  <h1 id="activity-name">旧标题</h1>
  <div id="js_content"><p>第一段内容，需要被读取。</p><p>第二段包含 &amp; 符号，也有足够的文字用于测试正文提取是否可靠。</p><p>第三段继续补足正文长度，避免把空页面当成文章。</p></div>
  <script>window.bad = true</script></body></html>
`, 'https://mp.weixin.qq.com/s/test');
assert.equal(article.title, '复利与耐心');
assert.match(article.text, /第二段包含 & 符号/);
assert.doesNotMatch(article.text, /window\.bad/);

const analysis = normaliseAnalysis({
  type: 'daily',
  title: '今天的积累',
  digest: '完成了阅读和运动。',
  sections: [
    { label: '健康', items: ['跑步三公里'] },
    { label: '学习', items: ['阅读十分钟'] },
    { label: '运动', items: ['拉伸五分钟'] },
  ],
  insights: ['先运动后工作时更专注。'],
  issues: ['明天确认会议时间。'],
  checkIns: [{ name: '跑步', status: 'completed', evidence: '跑步三公里' }],
  scores: [
    { key: 'state', value: 4, reason: '精力不错' },
    { key: 'action', value: 4, reason: '完成重点' },
    { key: 'compound', value: 3, reason: '留下阅读积累' },
  ],
  highlight: '即使忙也完成了运动。',
  pattern: '只有一天，规律仍需观察。',
  nextAction: '明晚饭后读书十分钟。',
  tags: ['运动', '阅读'],
  memory: '用户跑步三公里并阅读。',
  sourceWarnings: [],
});
assert.equal(analysis.scores[0].label, '状态');
assert.equal(analysis.checkIns[0].status, 'completed');
assert.equal(analysis.nextAction, '明晚饭后读书十分钟。');
assert.deepEqual(analysis.sections.map((section) => section.label), ['健康', '成长']);
assert.deepEqual(analysis.sections[0].items, ['跑步三公里', '拉伸五分钟']);
assert.deepEqual(analysis.issues, ['明天确认会议时间。']);

assert.equal(validateImages([{ name: 'a.png', dataUrl: 'data:image/png;base64,AA==' }]).length, 1);
assert.throws(() => validateImages([{ name: 'bad.txt', dataUrl: 'hello' }]), /不是受支持/);

const html = await readFile(new URL('./public/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('./public/app.js', import.meta.url), 'utf8');
const elementsBlock = script.match(/const elements = \{([\s\S]*?)\n\};/)?.[1] || '';
for (const id of [...elementsBlock.matchAll(/querySelector\('#([^']+)'\)/g)].map((match) => match[1])) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `页面缺少前端引用的 #${id}`);
}
assert.doesNotMatch(`${html}\n${script}`, /SpeechRecognition|voiceButton|voiceLive/);
assert.match(html, /id="habitList"/);
assert.match(script, /compound-journal\.habits\.v1/);

const server = createAppServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const [healthResponse, pageResponse, unconfiguredResponse] = await Promise.all([
    fetch(`${origin}/api/health`),
    fetch(`${origin}/`),
    fetch(`${origin}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '今天读了十分钟书。', images: [] }),
    }),
  ]);
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get('cache-control'), 'no-store');
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-type'), /^text\/html/);
  const page = await pageResponse.text();
  assert.match(page, /<h1 id="todayTitle">今天<\/h1>/);
  assert.doesNotMatch(page, /01 输入|02 整理|随便说，不用组织/);
  if (!process.env.MINIMAX_API_KEY) {
    assert.equal(unconfiguredResponse.status, 503);
    assert.match((await unconfiguredResponse.json()).error, /尚未配置 MiniMax API Key/);
  }
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (originalApiKey) process.env.MINIMAX_API_KEY = originalApiKey;
}

console.log('自检通过：链接与正文、AI 结果、图片边界、前端元素和本地服务均正常。');
