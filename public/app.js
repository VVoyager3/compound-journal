const MAX_IMAGES = 12;
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
const STORAGE_KEY = 'compound-journal.entries.v1';
const REVIEW_KEY = 'compound-journal.review.v1';
const HABITS_KEY = 'compound-journal.habits.v1';

const elements = {
  todayDate: document.querySelector('#todayDate'),
  entryText: document.querySelector('#entryText'),
  imageInput: document.querySelector('#imageInput'),
  imageList: document.querySelector('#imageList'),
  uploadStatus: document.querySelector('#uploadStatus'),
  dropZone: document.querySelector('#dropZone'),
  linkNotice: document.querySelector('#linkNotice'),
  analyzeButton: document.querySelector('#analyzeButton'),
  resultPanel: document.querySelector('#resultPanel'),
  historyList: document.querySelector('#historyList'),
  weekContent: document.querySelector('#weekContent'),
  apiState: document.querySelector('#apiState'),
  toast: document.querySelector('#toast'),
  habitForm: document.querySelector('#habitForm'),
  habitName: document.querySelector('#habitName'),
  habitList: document.querySelector('#habitList'),
};

const state = {
  images: [],
  entries: loadJson(STORAGE_KEY, []),
  review: loadJson(REVIEW_KEY, null),
  habits: loadJson(HABITS_KEY, []),
  currentEntry: null,
  busy: false,
  toastTimer: null,
};

function localDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function saveHabits() {
  localStorage.setItem(HABITS_KEY, JSON.stringify(state.habits));
}

function habitStreak(habit) {
  const dates = new Set(habit.dates || []);
  const cursor = new Date();
  if (!dates.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (dates.has(localDate(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function renderHabits() {
  const today = localDate();
  elements.habitList.innerHTML = state.habits.length ? state.habits.map((habit) => {
    const done = habit.dates?.includes(today);
    const streak = habitStreak(habit);
    return `<div class="habit-row">
      <button class="habit-check${done ? ' is-done' : ''}" type="button" data-toggle-habit="${escapeHtml(habit.id)}" aria-pressed="${done}">${done ? '✓' : ''}</button>
      <span class="habit-name">${escapeHtml(habit.name)}</span>
      <span class="habit-streak">${streak ? `${streak} 天` : ''}</span>
      <button class="habit-delete" type="button" data-delete-habit="${escapeHtml(habit.id)}" aria-label="删除 ${escapeHtml(habit.name)}">删除</button>
    </div>`;
  }).join('') : '<p class="habit-empty">添加一个每天想坚持的习惯</p>';
}

function addHabit(event) {
  event.preventDefault();
  const name = elements.habitName.value.trim();
  if (!name || state.habits.some((habit) => habit.name === name)) return;
  state.habits.push({ id: crypto.randomUUID(), name, dates: [] });
  elements.habitName.value = '';
  saveHabits();
  renderHabits();
}

function applyAutomaticHabitCheckIns(entry) {
  const completed = (entry.checkIns || []).filter((item) => item.status === 'completed');
  if (!completed.length) return;
  const today = localDate();
  let changed = false;
  for (const habit of state.habits) {
    const matched = completed.some((item) => item.name === habit.name);
    if (matched && !habit.dates.includes(today)) {
      habit.dates.push(today);
      changed = true;
    }
  }
  if (changed) {
    saveHabits();
    renderHabits();
  }
}

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveEntries() {
  state.entries = state.entries.slice(0, 60);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
  } catch {
    state.entries = state.entries.slice(0, 20);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
    showToast('浏览器空间不足，只保留了最近 20 条记录。');
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function formatDate(value, includeTime = false) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat('zh-CN', includeTime
    ? { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(date);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  state.toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3200);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('服务器返回了无法读取的内容。');
  }
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。');
  return data;
}

function setView(name) {
  document.querySelectorAll('.view').forEach((view) => {
    const active = view.id === `${name}View`;
    view.hidden = !active;
    view.classList.toggle('is-active', active);
  });
  document.querySelectorAll('.tab-button').forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (name === 'history') renderHistory();
  if (name === 'week') renderWeek();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateInputState() {
  elements.analyzeButton.disabled = state.busy || (!elements.entryText.value.trim() && !state.images.length);
  const urls = elements.entryText.value.match(/https?:\/\/[^\s<>"'，。！？、；：（）【】《》“”‘’]+/giu) || [];
  const wechatCount = urls.filter((value) => {
    try {
      return ['mp.weixin.qq.com', 'weixin.qq.com'].includes(new URL(value).hostname.toLowerCase());
    } catch {
      return false;
    }
  }).length;
  const otherCount = Math.max(0, urls.length - wechatCount);
  if (!urls.length) {
    elements.linkNotice.hidden = true;
    return;
  }
  elements.linkNotice.hidden = false;
  elements.linkNotice.textContent = [
    wechatCount ? `已识别 ${wechatCount} 个微信文章链接，将尝试读取正文。` : '',
    otherCount ? `另有 ${otherCount} 个普通链接，首版只会保留链接文字。` : '',
  ].filter(Boolean).join(' ');
}

function renderImages() {
  elements.imageList.innerHTML = state.images.map((image, index) => `
    <div class="image-item">
      <img src="${image.dataUrl}" alt="${escapeHtml(image.name)}">
      <span class="image-index">${index + 1}</span>
      <button type="button" data-remove-image="${index}" aria-label="移除第 ${index + 1} 张截图">×</button>
    </div>
  `).join('');
  elements.uploadStatus.textContent = state.images.length ? `已选 ${state.images.length}/${MAX_IMAGES} 张` : '';
  updateInputState();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('图片压缩失败。')),
    'image/jpeg',
    quality,
  ));
}

async function loadImage(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} 不是图片。`);
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error(`${file.name} 超过 20MB。`);

  const image = await loadImage(file);
  const width = image.width;
  const height = image.height;
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (typeof image.close === 'function') image.close();

  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > 1_450_000 && quality > 0.55) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, quality);
  }
  if (blob.size > 1_600_000) throw new Error(`${file.name} 压缩后仍然过大。`);
  return { name: file.name.slice(0, 120), dataUrl: await blobToDataUrl(blob) };
}

async function addImages(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith('image/'));
  if (!files.length) return;
  const capacity = MAX_IMAGES - state.images.length;
  if (capacity <= 0) {
    showToast(`每次最多添加 ${MAX_IMAGES} 张截图。`);
    return;
  }
  const selected = files.slice(0, capacity);
  if (selected.length < files.length) showToast(`只添加了前 ${capacity} 张，单次上限为 ${MAX_IMAGES} 张。`);

  for (let index = 0; index < selected.length; index += 1) {
    elements.uploadStatus.textContent = `处理图片 ${index + 1}/${selected.length}`;
    try {
      state.images.push(await compressImage(selected[index]));
      renderImages();
    } catch (error) {
      showToast(error.message);
    }
  }
  elements.imageInput.value = '';
  renderImages();
}

function entryTypeLabel(type) {
  return ({ daily: '生活记录', material: '资料感悟', mixed: '混合整理' })[type] || '智能整理';
}

function scoreHtml(score) {
  const dots = Array.from({ length: 5 }, (_, index) => `<span class="score-dot${index < score.value ? ' is-filled' : ''}" aria-hidden="true"></span>`).join('');
  return `<div class="score-row">
    <span class="score-label">${escapeHtml(score.label)}</span>
    <span class="score-dots" aria-label="${score.value} 分，共 5 分">${dots}</span>
    <span class="score-reason">${escapeHtml(score.reason)}</span>
  </div>`;
}

function renderResult(entry) {
  state.currentEntry = entry;
  const scores = Array.isArray(entry.scores) && entry.scores.length
    ? `<div class="scoreboard">${entry.scores.map(scoreHtml).join('')}</div><p class="score-note">评分只基于本次记录。</p>`
    : '';
  const sections = entry.sections?.length ? `<section class="dimension-section">
    <h3>维度总结</h3>
    <div class="dimension-grid">${entry.sections.map((section) => `
      <section class="dimension-card">
        <h4>${escapeHtml(section.label)}</h4>
        <ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </section>`).join('')}</div>
  </section>` : '';
  const statusLabel = { completed: '完成', partial: '部分完成', missed: '未完成' };
  const checkIns = entry.checkIns?.length ? `
    <section class="content-section">
      <h3>自动打卡</h3>
      <div class="check-in-list">${entry.checkIns.map((item) => `
        <div class="check-in-item" data-status="${escapeHtml(item.status)}">
          <span class="check-in-status">${escapeHtml(statusLabel[item.status] || '记录')}</span>
          <div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.evidence)}</p></div>
        </div>`).join('')}</div>
    </section>` : '';
  const insights = entry.insights?.length ? `
    <section class="content-section">
      <h3>感悟</h3>
      <div class="insight-list">${entry.insights.map((item) => `<div class="insight-item">${escapeHtml(item)}</div>`).join('')}</div>
    </section>` : '';
  const issues = entry.issues?.length ? `
    <section class="content-section">
      <h3>问题与待办</h3>
      <ul>${entry.issues.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </section>` : '';
  const tags = entry.tags?.length ? `<div class="tag-list">${entry.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : '';
  const warnings = entry.sourceWarnings?.length ? `<div class="warning-list">${entry.sourceWarnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join('')}</div>` : '';
  const sourceParts = [];
  if (entry.source?.imageCount) sourceParts.push(`${entry.source.imageCount} 张截图`);
  if (entry.source?.articleCount) sourceParts.push(`${entry.source.articleCount} 篇微信文章`);
  if (entry.inputText) sourceParts.push('文字或口述');
  const source = sourceParts.length ? `<p class="source-line">整理来源：${escapeHtml(sourceParts.join('、'))}</p>` : '';
  const chat = (entry.chat || []).map((message) => `<div class="chat-bubble${message.role === 'user' ? ' is-user' : ''}">${nl2br(message.content)}</div>`).join('');

  elements.resultPanel.innerHTML = `
    <article class="surface result-card">
      <div class="result-main">
        <header class="result-header">
          <div>
            <h2>${escapeHtml(entry.title)}</h2>
            <p class="result-date">${escapeHtml(formatDate(entry.createdAt, true))}</p>
          </div>
          <span class="type-chip">${entryTypeLabel(entry.type)}</span>
        </header>
        <p class="digest">${escapeHtml(entry.digest)}</p>
        ${scores}
        ${sections}${checkIns}${issues}
        ${insights}
        <div class="reflection-block"><strong>${entry.type === 'material' ? '记住' : '肯定'}</strong><p>${escapeHtml(entry.highlight)}</p></div>
        <div class="reflection-block"><strong>发现</strong><p>${escapeHtml(entry.pattern)}</p></div>
        <div class="reflection-block is-action"><strong>下一步</strong><p>${escapeHtml(entry.nextAction)}</p></div>
        ${tags}${warnings}${source}
      </div>
      <section class="chat-section">
        <h3>追问</h3>
        <div class="chat-messages">${chat}</div>
        <form class="chat-form" id="chatForm">
          <input id="chatInput" name="message" maxlength="2000" autocomplete="off" placeholder="追问这条记录" aria-label="向这份整理提问">
          <button class="button button-primary" type="submit">发送</button>
        </form>
      </section>
    </article>`;
}

function renderLoading() {
  elements.resultPanel.innerHTML = `
    <div class="surface loading-card">
      <h2 class="loading-title">正在整理…</h2>
    </div>`;
}

function upsertEntry(entry) {
  const index = state.entries.findIndex((item) => item.id === entry.id);
  if (index >= 0) state.entries[index] = entry;
  else state.entries.unshift(entry);
  saveEntries();
  state.review = null;
  localStorage.removeItem(REVIEW_KEY);
}

async function analyze() {
  if (state.busy) return;
  state.busy = true;
  updateInputState();
  elements.analyzeButton.textContent = '正在整理';
  renderLoading();
  try {
    const data = await api('/api/analyze', {
      text: elements.entryText.value.trim(),
      images: state.images.map(({ name, dataUrl }) => ({ name, dataUrl })),
      habits: state.habits.map((habit) => habit.name),
    });
    upsertEntry(data.entry);
    applyAutomaticHabitCheckIns(data.entry);
    renderResult(data.entry);
    state.images = [];
    renderImages();
    showToast('已保存');
  } catch (error) {
    elements.resultPanel.innerHTML = `
      <div class="surface empty-result">
        <h2>整理失败</h2>
        <p>${escapeHtml(error.message)}</p>
      </div>`;
    showToast(error.message);
  } finally {
    state.busy = false;
    elements.analyzeButton.textContent = '整理';
    updateInputState();
  }
}

function renderHistory() {
  if (!state.entries.length) {
    elements.historyList.innerHTML = `<div class="surface empty-history"><h2>暂无记录</h2></div>`;
    return;
  }
  elements.historyList.innerHTML = state.entries.map((entry) => {
    const compound = entry.scores?.find((score) => score.key === 'compound');
    const completed = entry.checkIns?.filter((item) => item.status === 'completed').length || 0;
    return `<article class="surface history-card">
      <button type="button" class="history-open" data-open-entry="${escapeHtml(entry.id)}">
        <div class="history-meta"><span>${escapeHtml(formatDate(entry.createdAt, true))}</span><span>${entryTypeLabel(entry.type)}</span>${completed ? `<span>完成 ${completed} 项</span>` : ''}${compound ? `<span>复利 ${compound.value}/5</span>` : ''}</div>
        <h2>${escapeHtml(entry.title)}</h2>
        <p>${escapeHtml(entry.digest)}</p>
      </button>
      <button type="button" class="delete-entry" data-delete-entry="${escapeHtml(entry.id)}" aria-label="删除这条记录">删除</button>
    </article>`;
  }).join('');
}

function recentEntries() {
  const threshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return state.entries.filter((entry) => new Date(entry.createdAt).getTime() >= threshold);
}

function averageScore(entries, key) {
  const values = entries.flatMap((entry) => entry.scores || []).filter((score) => score.key === key).map((score) => score.value);
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '暂无';
}

function renderWeek() {
  const entries = recentEntries();
  if (!entries.length && !state.habits.length) {
    elements.weekContent.innerHTML = `<div class="surface empty-history"><h2>本周暂无记录</h2></div>`;
    return;
  }
  const habitRows = state.habits.map((habit) => {
    const weekCount = (habit.dates || []).filter((date) => Date.now() - new Date(`${date}T00:00:00`).getTime() < 7 * 24 * 60 * 60 * 1000).length;
    return `<div class="metric-row"><span>${escapeHtml(habit.name)}</span><strong>${weekCount}/7</strong></div>`;
  }).join('');
  const ids = entries.map((entry) => entry.id).join('|');
  const review = state.review?.ids === ids ? state.review.value : null;
  elements.weekContent.innerHTML = `<div class="week-layout">
    <section class="surface week-stats">
      <h2>七天概况</h2>
      <div class="metric-list">
        <div class="metric-row"><span>记录次数</span><strong>${entries.length}</strong></div>
        ${habitRows}
        <div class="metric-row"><span>状态均分</span><strong>${averageScore(entries, 'state')}</strong></div>
        <div class="metric-row"><span>行动均分</span><strong>${averageScore(entries, 'action')}</strong></div>
        <div class="metric-row"><span>复利均分</span><strong>${averageScore(entries, 'compound')}</strong></div>
      </div>
      ${entries.length ? `<button class="button button-primary" type="button" id="reviewButton">${review ? '重新生成复盘' : '生成 AI 周复盘'}</button>` : ''}
    </section>
    ${review ? reviewHtml(review) : ''}
  </div>`;
}

function reviewHtml(review) {
  return `<article class="surface review-card">
    <h2>本周总结</h2>
    <p class="review-summary">${escapeHtml(review.summary)}</p>
    <section class="review-group"><h3>有效积累</h3><ul class="review-list">${review.wins.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
    <section class="review-group"><h3>可验证的规律</h3><ul class="review-list">${review.patterns.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
    <div class="review-focus"><strong>下周唯一重点</strong><p>${escapeHtml(review.focus)}</p></div>
    <div class="review-focus"><strong>七天小实验</strong><p>${escapeHtml(review.experiment)}</p></div>
  </article>`;
}

async function generateReview() {
  const button = document.querySelector('#reviewButton');
  if (!button || button.disabled) return;
  button.disabled = true;
  button.textContent = '正在复盘';
  const entries = recentEntries();
  try {
    const data = await api('/api/review', { entries });
    state.review = { ids: entries.map((entry) => entry.id).join('|'), value: data.review };
    localStorage.setItem(REVIEW_KEY, JSON.stringify(state.review));
    renderWeek();
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
    button.textContent = '生成 AI 周复盘';
  }
}

async function askEntry(event) {
  event.preventDefault();
  if (!state.currentEntry) return;
  const input = document.querySelector('#chatInput');
  const button = event.currentTarget.querySelector('button');
  const message = input.value.trim();
  if (!message) return;
  const history = [...(state.currentEntry.chat || [])];
  state.currentEntry.chat = [...history, { role: 'user', content: message }];
  renderResult(state.currentEntry);
  const newInput = document.querySelector('#chatInput');
  newInput.disabled = true;
  document.querySelector('#chatForm button').disabled = true;
  try {
    const data = await api('/api/chat', { entry: state.currentEntry, history, message });
    state.currentEntry.chat.push({ role: 'assistant', content: data.answer });
    state.currentEntry.chat = state.currentEntry.chat.slice(-20);
    upsertEntry(state.currentEntry);
    renderResult(state.currentEntry);
  } catch (error) {
    state.currentEntry.chat = history;
    renderResult(state.currentEntry);
    showToast(error.message);
  }
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    elements.apiState.textContent = data.configured ? '已连接' : '未配置';
    elements.apiState.classList.toggle('is-ready', data.configured);
    elements.apiState.title = data.configured ? `当前模型：${data.model}` : '请在服务端 .env 中填写 MINIMAX_API_KEY';
  } catch {
    elements.apiState.textContent = '离线';
  }
}

document.querySelector('.tabbar').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) setView(button.dataset.view);
});

elements.entryText.addEventListener('input', updateInputState);
elements.imageInput.addEventListener('change', () => addImages(elements.imageInput.files));
elements.analyzeButton.addEventListener('click', analyze);
elements.dropZone.addEventListener('click', () => elements.imageInput.click());
elements.dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    elements.imageInput.click();
  }
});
elements.dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  elements.dropZone.classList.add('is-over');
});
elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('is-over'));
elements.dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove('is-over');
  addImages(event.dataTransfer.files);
});
document.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.items || [])].filter((item) => item.type.startsWith('image/')).map((item) => item.getAsFile()).filter(Boolean);
  if (files.length) addImages(files);
});
elements.imageList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-image]');
  if (!button) return;
  state.images.splice(Number(button.dataset.removeImage), 1);
  renderImages();
});
elements.historyList.addEventListener('click', (event) => {
  const openButton = event.target.closest('[data-open-entry]');
  if (openButton) {
    const entry = state.entries.find((item) => item.id === openButton.dataset.openEntry);
    if (entry) {
      renderResult(entry);
      setView('today');
    }
    return;
  }
  const deleteButton = event.target.closest('[data-delete-entry]');
  if (deleteButton && confirm('删除这条记录？这个操作无法撤销。')) {
    state.entries = state.entries.filter((item) => item.id !== deleteButton.dataset.deleteEntry);
    saveEntries();
    state.review = null;
    localStorage.removeItem(REVIEW_KEY);
    renderHistory();
  }
});
elements.resultPanel.addEventListener('submit', (event) => {
  if (event.target.id === 'chatForm') askEntry(event);
});
elements.weekContent.addEventListener('click', (event) => {
  if (event.target.closest('#reviewButton')) generateReview();
});
elements.habitForm.addEventListener('submit', addHabit);
elements.habitList.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle-habit]');
  const remove = event.target.closest('[data-delete-habit]');
  if (toggle) {
    const habit = state.habits.find((item) => item.id === toggle.dataset.toggleHabit);
    if (!habit) return;
    const today = localDate();
    habit.dates = habit.dates.includes(today) ? habit.dates.filter((date) => date !== today) : [...habit.dates, today];
    saveHabits();
    renderHabits();
  } else if (remove) {
    if (!confirm('删除这个习惯及其打卡记录？')) return;
    state.habits = state.habits.filter((item) => item.id !== remove.dataset.deleteHabit);
    saveHabits();
    renderHabits();
  }
});

elements.todayDate.textContent = formatDate();
renderHabits();
updateInputState();
checkHealth();
