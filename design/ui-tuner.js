(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const storageKey = 'qiguang.ui-review.32.v1';
  // Review settings are intentionally isolated from the app's database.
  const specs = [
    ['页面', 'width', '手机视口宽度', 320, 480, 1, 400, 'px'],
    ['页面', '--ui-page-padding', '页面左右边距', 12, 28, 1, 20, 'px'],
    ['字体', '--ui-font-page', '页面标题', 16, 26, .5, 16, 'px'],
    ['字体', '--ui-font-title', '分组标题（32基准）', 12, 20, .5, 14.5, 'px'],
    ['字体', '--ui-font-body', '正文 / 列表名称', 11, 18, .5, 12.5, 'px'],
    ['字体', '--ui-font-meta', '日期 / 次数 / 完成数', 10, 16, .5, 11.5, 'px'],
    ['字体', '--ui-weight-heading', '标题粗细', 500, 800, 100, 800, ''],
    ['字体', '--ui-weight-regular', '正文粗细', 400, 600, 100, 400, ''],
    ['列表', '--ui-row-height', '列表最低高度', 44, 72, 1, 45, 'px'],
    ['列表', '--review-row-padding-x', '列表左右内边距', 8, 24, 1, 20, 'px'],
    ['列表', '--review-row-padding-y', '列表上下内边距', 0, 12, 1, 0, 'px'],
    ['列表', '--ui-list-gap', '独立任务行之间', 0, 16, 1, 4, 'px'],
    ['列表', '--review-content-gap', '图标到名称 / 正文到状态', 4, 20, 1, 11, 'px'],
    ['列表', '--ui-radius-surface', '分组 / 列表圆角', 0, 16, 1, 8, 'px'],
    ['列表', '--review-action-gap', '0/5杯 到 +1', 0, 20, 1, 2, 'px'],
    ['列表', '--ui-row-action-width', '右侧操作列宽度', 44, 68, 1, 55, 'px'],
    ['基础控件', '--ui-touch-size', '按钮点击高度', 44, 56, 1, 44, 'px'],
    ['基础控件', '--ui-button-height', '按钮可见高度', 36, 48, 1, 36, 'px'],
    ['基础控件', '--ui-action-gap', '按钮之间', 8, 24, 1, 8, 'px'],
    ['基础控件', '--ui-tab-height', '分段可见高度', 28, 44, 1, 28, 'px'],
    ['基础控件', '--ui-textarea-height', '多行输入最低高度', 72, 220, 4, 104, 'px'],
    ['表单间距', '--ui-field-gap', '标签到输入框', 4, 24, 1, 4, 'px'],
    ['表单间距', '--ui-form-gap', '输入项之间（上下）', 4, 32, 1, 11, 'px'],
    ['间隔', '--review-page-title-gap', '页面标题到正文', 4, 40, 1, 4, 'px'],
    ['间隔', '--review-section-gap', '分组之间', 8, 32, 1, 16, 'px'],
    ['间隔', '--review-heading-gap', '分组标题到列表', 4, 24, 1, 13, 'px'],
    ['间隔', '--review-repeat-gap', '重复到星期按钮', 8, 28, 1, 16, 'px'],
    ['表单与图表', '--review-input-height', '复盘输入框最低高度', 72, 220, 4, 116, 'px'],
    ['表单与图表', '--review-heat-cell', '热力图方块边长', 8, 22, 1, 16, 'px'],
    ['表单与图表', '--review-heat-gap', '热力图方块间距', 2, 8, 1, 5, 'px'],
    ['表单与图表', '--review-analysis-width', '分析列表占内容区宽度', 70, 100, 1, 100, '%'],
  ];
  const defaults = Object.fromEntries(specs.map(([, key, , , , , value]) => [key, value]));
  $('#parameter-catalog').innerHTML = specs.map(([group,key,label,,,,value,unit]) =>
    '<tr><td>'+group+'</td><td>'+label+'</td><td>'+value+unit+'</td><td><code>'+key+'</code></td></tr>').join('');
  let values = { ...defaults, '--ui-button-height': 36 };
  let saveAvailable = true;
  const status = (text) => { $('#status').textContent = text; };
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('参数必须是对象');
    const output = { ...defaults };
    for (const [key, value] of Object.entries(input)) {
      const spec = specs.find(item => item[1] === key);
      if (!spec || typeof value !== 'number' || !Number.isFinite(value) || value < spec[3] || value > spec[4]) throw Error('无效参数：' + key);
      output[key] = value;
    }
    return output;
  }
  function bundle() {
    return { format: 'qiguang-ui-review', version: 1, basis: '32-settings-privacy', status: 'candidate-not-applied', updatedAt: new Date().toISOString(), values };
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(bundle())); }
    catch { saveAvailable = false; status('浏览器禁止本地保存，请用“导出参数”保留调整。'); }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved?.format === 'qiguang-ui-review' && saved.version === 1) {
      values = validate(saved.values);
      if (!Object.hasOwn(saved.values, '--ui-button-height')) values['--ui-button-height'] = 36;
    }
  } catch { status('未读取到有效的旧参数，已使用基准；可导入之前导出的 JSON。'); }
  let currentGroup;
  for (const [group, key, label, min, max, step] of specs) {
    if (currentGroup?.dataset.group !== group) {
      currentGroup = document.createElement('details'); currentGroup.dataset.group = group; currentGroup.open = group === '字体' || group === '列表';
      const summary = document.createElement('summary'); summary.textContent = group; currentGroup.append(summary); $('#controls').append(currentGroup);
    }
    const row = document.createElement('div'); row.className = 'control';
    const title = document.createElement('label'); const number = document.createElement('input'); const range = document.createElement('input');
    number.id = 'number-' + key; title.htmlFor = number.id; title.textContent = label; number.type = 'number'; range.type = 'range';
    for (const input of [number, range]) {
      input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(values[key]); input.dataset.key = key;
      input.setAttribute('aria-label', label + (input === range ? '滑块' : '数值'));
      input.addEventListener('input', () => {
        if (!input.value || !input.validity.valid || !Number.isFinite(input.valueAsNumber)) return;
        values[key] = input.valueAsNumber; number.value = range.value = input.value; apply(); persist();
      });
      input.addEventListener('change', () => { if (!input.validity.valid || !input.value) input.value = String(values[key]); });
    }
    row.append(title, number, range); currentGroup.append(row);
  }
  const escape = (text) => String(text).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  function measure(frame, target) {
    const d = frame.contentDocument;
    if (!d?.querySelector('main')) return;
    const first = d.querySelector('.ui-list-row,.ai-info-row');
    const title = d.querySelector('.ui-list-heading,.ui-settings-group-title');
    const g = first?.getBoundingClientRect();
    const screen = d.querySelector('dialog[open] .dialog-content') || d.querySelector('.review-screen') || d.querySelector('main');
    const gap = screen?.children[1].getBoundingClientRect().top - screen?.children[0].getBoundingClientRect().bottom;
    target.textContent = (Number.isFinite(gap) ? '标题栏→正文 '+gap.toFixed(1)+'px · ' : '')+(g ? '列表 '+g.width.toFixed(1)+' × '+g.height.toFixed(1)+'px · ' : '')+(title?'组标题 '+frame.contentWindow.getComputedStyle(title).fontSize:'')+' · '+(d.documentElement.scrollWidth>frame.clientWidth?'存在横向滚动':'无整页横向滚动');
  }
  function apply() {
    $('#candidate-pane').style.setProperty('--frame-width',values.width+'px');
    const root = $('#candidate').contentDocument?.documentElement;
    if (root) {
      for (const [,key,,,,,,unit] of specs) if (key !== 'width') root.style.setProperty(key,String(values[key])+unit);
      root.style.setProperty('--ui-font-control',values['--ui-font-body']+'px');
      root.style.setProperty('--ui-font-section',values['--ui-font-title']+'px');
      root.style.setProperty('--ui-row-pad-x',values['--review-row-padding-x']+'px');
      root.style.setProperty('--ui-row-pad-y',values['--review-row-padding-y']+'px');
      root.style.setProperty('--ui-group-gap',values['--review-section-gap']+'px');
      root.style.setProperty('--ui-section-gap',values['--review-heading-gap']+'px');
      const aliases = {
        '--ui-row-content-gap': '--review-content-gap',
        '--ui-count-action-gap': '--review-action-gap',
        '--ui-title-gap': '--review-page-title-gap',
        '--ui-repeat-gap': '--review-repeat-gap',
        '--ui-review-input-height': '--review-input-height',
        '--ui-heat-cell': '--review-heat-cell',
        '--ui-heat-gap': '--review-heat-gap',
        '--ui-analysis-width': '--review-analysis-width',
      };
      for (const [token, key] of Object.entries(aliases)) root.style.setProperty(token, values[key] + (key === '--review-analysis-width' ? '%' : 'px'));
    }
    $('#baseline-pane').style.setProperty('--frame-width',values.width+'px');
    for (const input of document.querySelectorAll('[data-key]')) input.value=String(values[input.dataset.key]);
    $('#transfer').value=JSON.stringify(bundle(),null,2);
    requestAnimationFrame(()=>measure($('#candidate'),$('#metrics')));
  }
  $('#candidate').addEventListener('load',()=>{apply();});
  $('#baseline').addEventListener('load',()=>measure($('#baseline'),$('#baseline-metrics')));
  const snapshots = {
    goals: '08-goal-create', edit: '07-task-edit', repeat: '10-habit-create',
    daily: '13-record-daily-review', weekly: '23-weekly-review-editor',
    calendar: '20-calendar', growth: '21-growth', analysis: '24-task-analysis',
  };
  function render() {
    const view = $('#view').value;
    if (['edit','goals','daily','weekly'].includes(view)) $('#controls details[data-group="表单间距"]').open = true;
    if (view === 'analysis') $('#controls details[data-group="表单与图表"]').open = true;
    const realList = !snapshots[view];
    const special = new Set(['--ui-list-gap','--review-repeat-gap','--review-input-height','--review-heat-cell','--review-heat-gap','--review-analysis-width']);
    for (const control of document.querySelectorAll('.control')) control.hidden = realList && special.has(control.querySelector('[data-key]').dataset.key);
    for (const group of document.querySelectorAll('#controls details')) group.hidden = ![...group.querySelectorAll('.control')].some(control => !control.hidden);
    const source = realList ? './list-preview.html?view=' + encodeURIComponent(view)
      : './screenshots/20260906-complete-unification/' + snapshots[view] + '.html';
    for (const frame of [$('#candidate'),$('#baseline')]) { frame.removeAttribute('srcdoc'); frame.src = source; }
    $('#preview-kind').textContent = realList
      ? '真实公共组件：左右使用同一渲染器，仅候选应用你的参数。'
      : '真实页面结构：由隔离测试数据生成，使用 App 的公共 CSS；仅预览尺寸，不保存内容或调用 AI。';
  }
  $('#view').addEventListener('change',()=>{const url=new URL(location.href);url.searchParams.set('view',$('#view').value);history.replaceState(null,'',url);render();});
  $('#compare').addEventListener('change',()=>{$('#baseline-pane').hidden=!$('#compare').checked;});
  $('#base').addEventListener('click',()=>{values={...defaults};apply();persist();status('已恢复基准参数；功能候选尚未应用到 App。');});
  $('#compact').addEventListener('click',()=>{values={...defaults,'--ui-row-height':46,'--review-row-padding-y':0,'--ui-list-gap':4,'--review-action-gap':2};apply();persist();status('已切换紧凑候选，触控区域仍至少 44px。');});
  $('#save').addEventListener('click',()=>{persist();if(saveAvailable)status('参数已保存在此浏览器。请导出 JSON 发给我，才能准确迁入 App。');});
  $('#export').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(bundle(),null,2)],{type:'application/json'}));const a=document.createElement('a');
    a.href=url;a.download='qiguang-ui-review.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('参数文件已生成。这里导出的是尺寸，不包含日记或 API Key。');
  });
  $('#import').addEventListener('click',()=>$('#file').click());
  $('#file').addEventListener('change',async()=>{
    try {const file=$('#file').files[0];if(!file)return;if(file.size>16000)throw Error('文件过大');const data=JSON.parse(await file.text());if(data.format!=='qiguang-ui-review'||data.version!==1)throw Error('不是本工具导出的参数');values=validate(data.values);apply();persist();status('参数已导入。');}
    catch(error){status('导入失败：'+error.message);}finally{$('#file').value='';}
  });
  $('#copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#transfer').value);status('已复制参数。');}catch{$('#transfer').focus();$('#transfer').select();status('已选中参数，请按 Ctrl+C 复制。');}});
  if (location.protocol === 'file:') status('请通过本地开发服务打开本页，确保使用 App 的真实样式。');
  const query = new URLSearchParams(location.search);
  const requestedView = query.get('view');
  if (requestedView && [...$('#view').options].some(option => option.value === requestedView)) $('#view').value = requestedView;
  if (query.get('preset') === 'reference-heatmap') {
    values['--review-heat-cell'] = 16;
    values['--review-heat-gap'] = 5;
    values['--review-analysis-width'] = 100;
  }
  render();apply();
})();
