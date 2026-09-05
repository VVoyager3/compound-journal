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
  const paths = {
    energy: '<path d="M7 4h10l-1 16H8L7 4Zm1 5h8"/><path d="M8 9h8l-.6 10H8.6Z" fill="#b3d7da" stroke="none"/>',
    mind: '<path d="M9 18h6m-5 3h4M8 13a6 6 0 1 1 8 0l-1 3H9l-1-3Z"/>',
    connection: '<path d="M3 4h13v10H8l-5 4V4Zm13 5h5v12l-5-4h-5v-3"/>',
    progress: '<path d="M14 21H4V3h13v9M7 7h7M7 11h5m1 6 3 3 6-7"/>',
    play: '<path d="m12 2 8 8-8 8-8-8 8-8Zm0 0v16M4 10h16m-8 8-3 4"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    book: '<path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1m0-15c4-3 8-2 10-1v15c-4-2-7-1-10 1V5Z"/>',
    trophy: '<path d="M7 3h10v6a5 5 0 0 1-10 0V3Zm5 11v7m-4 0h8M7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4"/>',
    check: '<path d="m5 12 4 4L19 6"/><rect x="2" y="2" width="20" height="20" rx="4"/>',
  };
  const icon = name => '<svg class="sample-icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.progress) + '</svg>';
  function row(title, { meta='', done=false, count=false, symbol='', readOnly=false, danger=false } = {}) {
    const lead = symbol ? icon(symbol) : readOnly ? '' : '<button class="sample-check" aria-label="' + (done ? '撤销样例完成' : '完成样例任务') + '"><span>' + (done ? '✓' : '') + '</span></button>';
    const tail = count ? '<span class="sample-tail"><span class="sample-meta sample-count">' + escape(meta || '0/5杯') + '</span><button class="sample-action" data-action="count" aria-label="样例打卡加一次"><span>+1</span></button></span>' :
      '<span class="sample-tail">' + (meta ? '<span class="sample-meta">' + escape(meta) + '</span>' : '') + '<button class="sample-action" data-action="detail" aria-label="查看样例详情">' + (readOnly ? '›' : '⋯') + '</button></span>';
    return '<div class="ui-list-row' + (done ? ' is-completed' : '') + (danger ? ' is-danger' : '') + '">' + lead + '<span class="sample-copy" title="' + escape(title) + '">' + escape(title) + '</span>' + tail + '</div>';
  }
  const group = (title, body, right='') => '<section class="ui-settings-group"><div class="sample-section-head"><h2 class="ui-settings-group-title">' + title + '</h2>' + right + '</div>' + body + '</section>';
  const titlebar = (title, { modal=false, back=false }={}) => '<header class="ui-titlebar review-titlebar">' + (back ? '<span class="ui-back-button" aria-hidden="true"></span>' : '') + '<' + (modal?'h2':'h1') + ' class="ui-page-title">' + escape(title) + '</' + (modal?'h2':'h1') + '>' + (modal ? '<button class="sample-link" data-action="close-modal">关闭</button>' : '') + '</header>';
  const list = (...rows) => '<div class="ui-navigation-list">' + rows.join('') + '</div>';
  const tasks = (...rows) => '<div class="sample-task-list">' + rows.join('') + '</div>';
  const field = (title, input) => '<label class="sample-field"><span>' + title + '</span>' + input + '</label>';
  const button = (label, action, primary=false) => '<button type="button" class="button ' + (primary ? 'button-primary' : 'button-secondary') + '" data-action="' + action + '">' + label + '</button>';
  const templateDefaults = {
    daily: ['今天推进了什么', '今天留下了什么', '最大问题', '明天最重要的一件事'],
    weekly: ['本周进展 · 事业', '本周进展 · 财富', '本周进展 · 身体', '本周形成的资产 · 能力', '本周形成的资产 · 方法', '本周形成的资产 · 作品', '本周形成的资产 · 资产', '本周形成的资产 · 关系', '最大进步', '最大浪费', '停止或减少', '下周最重要的一件事'],
  };
  function templateField(title) {
    return '<div class="sample-field sample-template-field"><span class="sample-field-label">' + escape(title) + '</span><div class="sample-field-head" hidden><input maxlength="60" aria-label="小标题" value="' + escape(title) + '"><button data-action="remove-field" aria-label="删除此小标题">删除</button></div><textarea aria-label="' + escape(title) + '" placeholder="写下你的复盘"></textarea></div>';
  }
  const goalStage = () => '<div class="sample-goal-editor">' + field('子任务名称', '<input class="input" placeholder="要完成哪一步" aria-label="子任务名称">') + field('计划日期', '<input class="input" type="date" value="2026-09-10" aria-label="子任务日期">') + button('删除子任务', 'remove-stage') + '</div>';
  function analysisSample() {
    const levels = [0,1,0,2,0,1,0, 1,0,2,3,1,0,1, 0,1,0,2,1,1,0, 1,2,3,3,0,1,2, 0,1,2,3,2,0,1, 1,2,3,3,2,1,0, 0,1,2,2,3,1,0, 1,3,4,4,2,0,1, 2,3,4,3,1,2,0, 0,1,2,1,0,1,0, 1,2,1,3,1,2,0, 0,1,0,2,1,0,0];
    const heatCells = levels.map((level, index) => '<span class="is-level-' + level + '" role="img" aria-label="第 ' + (index + 1) + ' 天，完成 ' + level + ' 项"></span>').join('');
    const categoryTabs = ['全部','身体','心理','关系','工作','玩乐'].map((label, index) => '<button type="button" data-action="select-one" aria-pressed="' + (index === 0) + '">' + label + '</button>').join('');
    const rangeTabs = ['12周','半年','全年'].map((label, index) => '<button type="button" data-action="select-one" aria-pressed="' + (index === 0) + '">' + label + '</button>').join('');
    const detailRows = list(
      row('身体',{meta:'完成 12 项',readOnly:true}),
      row('心理',{meta:'完成 10 项',readOnly:true}),
      row('关系',{meta:'完成 9 项',readOnly:true}),
      row('工作',{meta:'完成 11 项',readOnly:true}),
      row('玩乐',{meta:'完成 6 项',readOnly:true}),
    );
    return '<nav class="sample-analysis-categories" aria-label="五维筛选">' + categoryTabs + '</nav>'
      + '<nav class="sample-analysis-ranges" aria-label="时间范围">' + rangeTabs + '</nav>'
      + '<section class="sample-analysis-summary" aria-label="任务统计"><span><small>完成</small><strong>48 <em>项</em></strong></span><span><small>成长值</small><strong>+126</strong></span></section>'
      + group('最近12周','<div class="sample-heat"><div class="sample-heat-layout"><div class="sample-heat-corner"></div><div class="sample-heat-months"><span style="grid-column:1">6月</span><span style="grid-column:4">7月</span><span style="grid-column:7">8月</span><span style="grid-column:10">9月</span></div><div class="sample-heat-weekdays"><span>周一</span><span></span><span>周三</span><span></span><span>周五</span><span></span><span></span></div><div class="sample-heat-grid">' + heatCells + '</div></div></div>')
      + group('五维完成','<div class="sample-analysis-list">' + detailRows + '</div>');
  }
  function sample(view) {
    switch (view) {
      case 'components': return sample('lists');
      case 'lists': return ['今日', group('今日任务', tasks(row('背诵英语演讲开头'), row('整理数学错题')))+group('习惯打卡', tasks(row('喝水', {count:true,readOnly:true}), row('晚饭后散步', {meta:'0/1次',count:true,readOnly:true})))+group('已完成', tasks(row('读完一章', {done:true}), row('准备明天的物品', {done:true})))+group('身体 · 相关任务', tasks(row('晚饭后散步', {meta:'9月4日 · 待完成',readOnly:true}), row('早点休息', {meta:'9月3日 · 已完成',readOnly:true})))];
      case 'settings': return ['设置', group('个人',list(row('人物与陪伴',{meta:'鱼鱼',readOnly:true}),row('状态自评',{meta:'今天已评估',readOnly:true}),row('显示与语气',{meta:'温和',readOnly:true})))+group('功能',list(row('AI 整理',{meta:'已开启',readOnly:true}),row('通知与提醒',{meta:'已关闭',readOnly:true})))+group('数据与隐私',list(row('本地存储',{meta:'正常',readOnly:true}),row('导入与导出',{meta:'尚未备份',readOnly:true}),row('AI 发送范围',{meta:'每次确认',readOnly:true})))+group('高级',list(row('行动规则',{readOnly:true}),row('删除全部数据',{readOnly:true,danger:true})))];
      case 'goals': return ['目标',group('目标',list(row('完成数学知识点复盘',{meta:'9月30日',readOnly:true}),row('整理英语演讲',{meta:'9月12日',readOnly:true})))+group('新建目标', '<div class="sample-form">' + field('目标名称','<input class="input" value="完成毕业论文">')+field('完成日期','<input class="input" type="date" value="2026-10-01">')+'</div>')+group('子任务','<div class="ui-navigation-list" id="stages">'+goalStage()+'</div>'+button('＋ 添加子任务','add-stage'))+button('保存目标（样例）','demo-save',true)];
      case 'edit': return ['今日',group('今日任务',tasks(row('整理数学错题'),row('背诵英语演讲开头')))+'<section class="sample-modal"><div class="sample-modal-card review-screen">'+titlebar('编辑任务',{modal:true})+'<div class="sample-form">'+field('名称','<input class="input" value="整理数学错题">')+field('日期','<input class="input" type="date" value="2026-09-05">')+field('维度','<select class="input"><option>工作</option><option>身体</option></select>')+field('难度','<select class="input"><option>普通</option><option>简单</option></select>')+'<div class="ui-actions-pair"><button type="button" class="button button-quiet danger-button" data-action="delete-task">删除任务</button>'+button('保存修改','demo-save',true)+'</div></div></div></section>'];
      case 'repeat': return ['新建习惯',group('习惯名称','<input class="input" value="喝水" aria-label="习惯名称">')+group('完成方式',list(row('计数打卡',{meta:'每天 5 杯',readOnly:true})))+'<section><h2 class="ui-settings-group-title">重复</h2><div class="sample-weekdays">'+['一','二','三','四','五','六','日'].map(day=>'<button aria-pressed="true" data-action="weekday">'+day+'</button>').join('')+'</div></section>'+button('保存习惯（样例）','demo-save',true)];
      case 'daily':
      case 'weekly': {
        const weekly = view === 'weekly';
        const form = group(weekly?'8月31日—9月6日':'9月5日', '<div class="sample-form" id="template-fields">'+templateDefaults[view].map(templateField).join('')+'</div>', '<button class="sample-link" data-action="edit-template">编辑模板</button>')+'<button class="button button-secondary" id="add-field" data-action="add-field" hidden>＋ 添加小标题</button>'+button('保存复盘（样例）','demo-save',true);
        return [weekly ? '周复盘' : '每日复盘', (weekly ? group('我的周复盘','<p class="sample-summary">完成实验设计，整理了复习步骤。</p>')+button('生成本周复盘','demo') : '')+form];
      }
      case 'calendar': return ['轨迹',group('2026年9月','<div class="sample-calendar">'+Array.from({length:28},(_,i)=>'<button data-action="date" data-date="'+(i+1)+'" aria-pressed="'+(i===4)+'">'+(i+1)+'<span class="sample-dots">'+(i%2===0?'<i class="sample-dot entry"></i>':'')+(i%3===0?'<i class="sample-dot task"></i>':'')+(i%4===0?'<i class="sample-dot habit"></i>':'')+'</span></button>').join('')+'</div><div class="sample-legend"><span><i class="sample-dot entry"></i>记录</span><span><i class="sample-dot task"></i>任务</span><span><i class="sample-dot habit"></i>习惯</span></div>')+'<form class="sample-search"><input type="search" aria-label="搜索样例记录" placeholder="搜索记录"><button aria-label="搜索">'+icon('search')+'</button></form>'+group('当日记录','<div id="date-records">'+list(row('9月5日 · 完成实验设计',{readOnly:true}))+'</div>')];
      case 'growth': return ['成长',group('五维成长',list(...[['身体','energy',48],['心理','mind',22],['关系','connection',16],['工作','progress',64],['玩乐','play',20]].map(([title,symbol,n])=>row(title,{symbol,meta:String(n),readOnly:true}))))+group('成就册','<div class="sample-badges">'+[['book','阅读七次'],['trophy','跑完两公里'],['check','一周实践']].map(([symbol,label])=>'<div class="sample-badge"><span>'+icon(symbol)+'</span>'+label+'</div>').join('')+'</div>')];
      case 'analysis': return ['任务分析',analysisSample()];
      default: throw Error('未知预览');
    }
  }
  function baseline() {
    const row = (title,value,image) => '<div class="setting-row-text ai-info-row"><img src="'+new URL('../design-assets/generated/ui-icons/'+image+'.png',location.href).href+'" alt=""><strong>'+title+'</strong><span class="ai-info-value">'+value+'</span><span>›</span></div>';
    return group('服务信息','<div class="ai-service-info">'+row('服务方','MiniMax','provider')+row('模型','MiniMax-M3','ai')+row('费用','随应用提供','cost')+row('连接状态','可用','connection')+'<button class="button button-secondary">重新检查连接</button></div>')+group('默认发送范围','<div class="ai-scope-summary">'+row('每日整理','每次确认','assessment')+row('目标拆分','仅当前目标','goal')+row('周回顾','摘要，不含日记原文','weekly-review')+'</div>');
  }
  function doc(title, body, candidate) {
    const links = ['../src/styles.css','../src/design-system.css','./ui-tuner-preview.css','./preview-layout.css'].map(path=>'<link rel="stylesheet" href="'+new URL(path,location.href).href+'">').join('');
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+links+'</head><body><main class="sample-page'+(candidate?' candidate':'')+'"><div class="review-screen">'+titlebar(title,{back:title==='任务分析'})+'<div class="ui-settings-stack">'+body+'</div></div><p class="sample-note" id="demo-status" role="status"></p></main></body></html>';
  }
  function measure(frame, target) {
    const d = frame.contentDocument;
    if (!d?.querySelector('.sample-page')) return;
    const first = d.querySelector('.ui-list-row,.ai-info-row');
    const title = d.querySelector('.ui-list-heading,.ui-settings-group-title');
    const g = first?.getBoundingClientRect();
    const screen = d.querySelector('.sample-modal-card.review-screen') || d.querySelector('.review-screen');
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
  function wirePreview() {
    const d=$('#candidate').contentDocument;
    d.addEventListener('click',event=>{
      const target=event.target.closest('button'); if(!target)return;
      const action=target.dataset.action;
      const note=d.querySelector('#demo-status');
      if(target.classList.contains('sample-check')) {
        const row=target.closest('.ui-list-row'); row.classList.toggle('is-completed'); target.querySelector('span').textContent=row.classList.contains('is-completed')?'✓':'';
      } else if(action==='count') {
        const count=target.previousElementSibling; const [current,total,unit]=count.textContent.match(/(\d+)\/(\d+)(.*)/).slice(1);
        const next=Math.min(Number(current)+1,Number(total)); count.textContent=next+'/'+total+unit;
        if(next===Number(total)){target.disabled=true;target.querySelector('span').textContent='✓';target.closest('.ui-list-row').classList.add('is-completed');}
      } else if(action==='weekday') target.setAttribute('aria-pressed',String(target.getAttribute('aria-pressed')!=='true'));
      else if(action==='add-stage') d.querySelector('#stages').insertAdjacentHTML('beforeend',goalStage());
      else if(action==='remove-stage') target.closest('.sample-goal-editor').remove();
      else if(action==='edit-template') {
        const editing=target.textContent==='编辑模板'; target.textContent=editing?'完成模板编辑':'编辑模板';
        for(const field of d.querySelectorAll('.sample-template-field')){field.querySelector('.sample-field-head').hidden=!editing;field.querySelector('.sample-field-label').hidden=editing;}
        d.querySelector('#add-field').hidden=!editing;
      } else if(action==='add-field') {
        d.querySelector('#template-fields').insertAdjacentHTML('beforeend',templateField('新的小标题'));
        const field=d.querySelector('#template-fields').lastElementChild;field.querySelector('.sample-field-head').hidden=false;field.querySelector('.sample-field-label').hidden=true;field.querySelector('input').focus();
      } else if(action==='remove-field') target.closest('.sample-template-field').remove();
      else if(action==='date') {
        d.querySelectorAll('[data-action="date"]').forEach(button=>button.setAttribute('aria-pressed',String(button===target)));
        d.querySelector('#date-records').innerHTML=list(row('9月'+target.dataset.date+'日 · 这一天的样例记录',{readOnly:true}));
      } else if(action==='select-one') {
        target.parentElement.querySelectorAll('[data-action="select-one"]').forEach(button=>button.setAttribute('aria-pressed',String(button===target)));
      } else if(action==='close-modal') target.closest('.sample-modal').remove();
      else if(action==='delete-task') {
        if (window.confirm('删除这个样例任务？不会影响真实任务。')) { target.closest('.sample-modal').remove(); note.textContent='样例删除已确认；真实任务未改变。'; }
      }
      else if(action==='demo-save'||action==='demo'||action==='detail') note.textContent='这是布局样例；未写入真实记录，也未请求 AI。';
      requestAnimationFrame(()=>measure($('#candidate'),$('#metrics')));
    });
    d.addEventListener('input',event=>{
      if(event.target.matches('.sample-field-head input')){
        const field=event.target.closest('.sample-template-field');field.querySelector('.sample-field-label').textContent=event.target.value;field.querySelector('textarea').setAttribute('aria-label',event.target.value);
      }
    });
    d.querySelector('.sample-search')?.addEventListener('submit',event=>{event.preventDefault();d.querySelector('#date-records').innerHTML=list(row('样例搜索结果：'+d.querySelector('input[type="search"]').value,{readOnly:true}));});
  }
  $('#candidate').addEventListener('load',()=>{apply();if(!$('#candidate').src.includes('list-preview'))wirePreview();});
  $('#baseline').addEventListener('load',()=>measure($('#baseline'),$('#baseline-metrics')));
  function render() {
    if (['edit','goals','daily','weekly'].includes($('#view').value)) $('#controls details[data-group="表单间距"]').open = true;
    if ($('#view').value === 'analysis') $('#controls details[data-group="表单与图表"]').open = true;
    const realList = ['components','lists','settings'].includes($('#view').value) && location.protocol !== 'file:';
    const prototypeOnly = new Set(['--ui-list-gap','--review-repeat-gap','--review-input-height','--review-heat-cell','--review-heat-gap','--review-analysis-width']);
    for (const control of document.querySelectorAll('.control')) control.hidden = realList && prototypeOnly.has(control.querySelector('[data-key]').dataset.key);
    for (const group of document.querySelectorAll('#controls details')) group.hidden = ![...group.querySelectorAll('.control')].some(control => !control.hidden);
    if (realList) {
      $('#candidate').removeAttribute('srcdoc');
      $('#candidate').src='./list-preview.html?view='+encodeURIComponent($('#view').value);
      $('#baseline').removeAttribute('srcdoc');
      $('#baseline').src='./list-preview.html?view='+encodeURIComponent($('#view').value);
    } else { const [title,body]=sample($('#view').value);$('#candidate').removeAttribute('src');$('#candidate').srcdoc=doc(title,body,true); }
    $('#preview-kind').textContent = realList
      ? '真实组件样板：使用 App 渲染器与样式；右侧为同一模板、同一视口的当前尺寸。'
      : '交互原型：不是正式页面。只能讨论布局，不能用它证明 App 已统一；右侧仍是公共组件样板。';
    if (!realList && location.protocol !== 'file:') { $('#baseline').removeAttribute('srcdoc'); $('#baseline').src='./list-preview.html'; }
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
  const audit=[
    ['01 / 02','任务行间距收窄；02沿用01列表','候选共用行高、行内距、任务行gap；02只读，不增加打卡行为。'],
    ['04','喝水计数到+1距离；已完成统一','候选次数与按钮共用右侧操作组；完成只变勾选/颜色，不换组件。'],
    ['05 / 08','目标卡过高；新建目标支持手动子任务','目标列表候选收紧；提供可增删的手动子任务布局。正式业务目前入口仍被AI拆分挡住，待实现。'],
    ['07','按参考稿做居中弹窗','候选保留背景上下文、横排字段、主保存按钮；正式应用暂未切换。'],
    ['10','重复到日期按钮间隔增大','提供独立可调间距，星期按钮仍可逐项选择。'],
    ['11','保留意见；保留日记+AI聊天框','不改此页。现有编号11对应习惯详情，后续确认具体保留区域。'],
    ['13','输入框更高；小标题可增删改','可调整高度、编辑小标题、添加和删除；仅样例，正式模板持久化及历史兼容待实现。'],
    ['20','点颜色区分、内嵌搜索、点击日期看记录','候选蓝绿/橙/紫标记与文字图例；内嵌放大镜，无关闭查找按钮。正式日历现有弹窗只摘要一条，完整列表待调整。'],
    ['21','简线五维图标、徽章外形','提供同描边宽度的简线图标与圆形徽章候选；不改变人物素材或成就判定。'],
    ['22','我的周复盘压缩；单一生成按钮','候选只有内容摘要和一个生成入口；真实AI授权仍需保留。'],
    ['23','参考稿重新组织，可编辑模板','按参考中的进展/资产细项展示并可编辑；这些是写作小标题，不引入第二套任务分类。'],
    ['24','删除底部分隔，方格与统计缩小','候选无底部分隔线，方格边长和列表宽度独立可调，保持正方形。'],
    ['27 / 32','统一列表、标题和间距','32作为基准；27所有分组含高级统一外框、内部细分隔线。候选尺寸待你确认。'],
  ];
  $('#audit').innerHTML=audit.map(cells=>'<tr>'+cells.map(cell=>'<td>'+escape(cell)+'</td>').join('')+'</tr>').join('');
  if (location.protocol !== 'file:') $('#baseline').src='./list-preview.html';
  else { $('#baseline').srcdoc=doc('AI 发送范围',baseline(),false); status('本地文件模式是旧原型；请通过开发服务打开，才能查看真实组件。'); }
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
