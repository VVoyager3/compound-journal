import { infoRow, listGroup, listRow, listSection, taskRow } from '../src/ui-list.ts';

const root = document.querySelector<HTMLElement>('#examples')!;
const report = (message: string) => { document.querySelector('#demo-status')!.textContent = message; };
let progress = 0;
let completed = false;
function render() {
  root.replaceChildren();
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'settings') {
    document.querySelector('h1')!.textContent = '设置';
    const groups = [
      ['个人', [['人物与陪伴', '鱼鱼'], ['状态自评', '今天已评估'], ['显示与语气', '温和']]],
      ['功能', [['AI 整理', '已开启'], ['通知与提醒', '已关闭']]],
      ['数据与隐私', [['本地存储', '正常'], ['导入与导出', '尚未备份'], ['AI 发送范围', '每次确认']]],
      ['高级', [['行动规则', ''], ['删除全部数据', '']]],
    ] as const;
    for (const [title, items] of groups) {
      const rows = listGroup();
      rows.append(...items.map(([label, value]) => infoRow(label, value, {
        onOpen: () => report('样例设置入口，不修改真实数据'),
      })));
      root.append(listSection(title, rows));
    }
    return;
  }
  const rows = listGroup();
  rows.append(
    taskRow({ title: '背英语演讲开头', status: completed ? 'completed' : 'pending', primaryLabel: '完成：背英语演讲开头', detailsLabel: '查看任务：背英语演讲开头', onPrimary: () => { completed = !completed; render(); }, onDetails: () => report('任务详情入口') }),
    taskRow({ title: '喝水', status: progress === 5 ? 'completed' : 'pending', targetCount: 5, progressCount: progress, countUnit: '杯', actionLabel: '+1', primaryLabel: '记录一次：喝水', detailsLabel: '查看习惯：喝水', onPrimary: () => { progress = progress === 5 ? 0 : progress + 1; render(); }, onDetails: () => report('习惯详情入口') }),
    taskRow({ title: '晚饭后散步', status: 'completed', primaryLabel: '修改反馈：晚饭后散步', detailsLabel: '查看任务：晚饭后散步', onPrimary: () => report('修改反馈入口'), onDetails: () => report('任务详情入口') }),
    infoRow('身体', '9月4日 · 待完成'),
    infoRow('通知与提醒', '已开启', { onOpen: () => report('设置详情入口') }),
  );
  if (view === 'lists') {
    document.querySelector('h1')!.textContent = '今日';
    const [task, habit, done] = [...rows.children] as HTMLElement[];
    for (const [title, row] of [['今日任务', task], ['习惯打卡', habit], ['已完成', done]] as const) {
      const group = listGroup(); group.append(row); root.append(listSection(title, group));
    }
    const related = listGroup();
    related.append(infoRow('喝水', '9月4日 · 待完成'), infoRow('晚饭后散步', '9月3日 · 完成'));
    root.append(listSection('身体 · 相关任务', related));
    return;
  }
  const setting = listRow('label', 'ui-control-row');
  const label = document.createElement('span'); label.textContent = '减少动态效果';
  const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'ui-switch'; input.setAttribute('role', 'switch');
  setting.append(label, input); rows.append(setting);
  const choice = listRow('button', 'ui-choice-row'); choice.textContent = '经常'; choice.setAttribute('aria-pressed', 'false');
  choice.onclick = () => { const selected = choice.classList.toggle('is-selected'); choice.setAttribute('aria-pressed', String(selected)); };
  rows.append(choice);
  const section = listSection('同一套列表', rows); section.dataset.example = 'single'; root.append(section);
  const readOnly = listGroup(); readOnly.append(infoRow('喝水', '9月4日 · 待完成'), infoRow('晚饭后散步', '9月3日 · 完成'));
  const related = listSection('相关任务', readOnly); related.dataset.example = 'readonly'; root.append(related);
  const service = listGroup(); service.append(infoRow('服务方', 'MiniMax'), infoRow('模型', 'MiniMax-M3'), infoRow('每日整理', '每次确认'));
  root.append(listSection('服务信息', service));
  const long = listGroup();
  long.append(infoRow('整理这一周的数学错题并标记仍然不理解的地方', '9月4日 · 待完成', { onOpen: () => report('完整任务标题保留在详情入口') }),
    infoRow('周回顾', '摘要，不含日记原文', { multiline: true }),
    infoRow('写作笔记', 'A-long-title-without-spaces-that-must-not-overflow-the-screen', { multiline: true }));
  root.append(listSection('长文字', long));
  const screen = document.createElement('section'); screen.className = 'review-screen'; screen.dataset.example = 'components';
  const common = document.createElement('div'); common.className = 'ui-settings-stack';
  const bar = document.createElement('header'); bar.className = 'ui-titlebar review-titlebar';
  const back = document.createElement('button'); back.className = 'ui-back-button'; back.type = 'button'; back.setAttribute('aria-label', '样例返回');
  const title = document.createElement('h2'); title.className = 'ui-page-title'; title.textContent = '页面标题';
  bar.append(back, title); screen.append(bar, common);
  const tabs = document.createElement('nav'); tabs.className = 'ui-segmented'; tabs.setAttribute('aria-label', '样例分段');
  for (const text of ['日历','本周','成长']) {
    const tab = document.createElement('button'); tab.className = 'ui-segmented-item'; tab.textContent = text;
    tab.setAttribute('aria-pressed', String(text === '本周'));
    tab.onclick = () => tabs.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === tab)));
    tabs.append(tab);
  }
  common.append(tabs);
  const actions = document.createElement('div'); actions.className = 'ui-actions';
  for (const [tone, text] of [['primary','保存'],['secondary','取消'],['quiet','修改'],['danger','删除']]) {
    const button = document.createElement('button'); button.className = 'button button-' + tone; button.textContent = text;
    button.onclick = () => report('样例操作，不修改真实数据'); actions.append(button);
  }
  common.append(listSection('按钮', actions));
  const form = document.createElement('div'); form.className = 'ui-form-stack';
  for (const [text, tag] of [['名称','input'],['日期','input'],['备注','textarea']]) {
    const field = document.createElement('label'); field.className = 'field-label'; field.append(text);
    const control = document.createElement(tag); control.className = 'input';
    if (control instanceof HTMLInputElement) control.type = text === '日期' ? 'date' : 'text';
    field.append(control); form.append(field);
  }
  common.append(listSection('表单', form));
  const diaryLabel = document.createElement('label'); diaryLabel.className = 'ui-list-section';
  const diaryHeading = document.createElement('span'); diaryHeading.className = 'ui-list-heading'; diaryHeading.textContent = '正文';
  const diary = document.createElement('textarea'); diary.className = 'journal-input compact-textarea'; diary.value = '今天整理了数学错题，也留了一点时间散步。';
  diaryLabel.append(diaryHeading, diary); common.append(diaryLabel);
  const typography = document.createElement('div'); typography.className = 'ui-stack'; typography.dataset.example = 'typography';
  const text = document.createElement('p'); text.textContent = '正文：任务名称、记录和输入内容';
  const meta = document.createElement('span'); meta.className = 'caption'; meta.textContent = '辅助信息：9月4日 · 0/5杯';
  typography.append(text, meta); common.append(listSection('文字样板', typography));
  const panel = document.createElement('section'); panel.className = 'ui-panel';
  const heading = document.createElement('h3'); heading.textContent = '内容容器';
  const body = document.createElement('p'); body.textContent = '较长的内容自然换行，使用同一套内边距。';
  panel.append(heading,body); common.append(panel);
  const notice = document.createElement('p'); notice.className = 'privacy-boundary'; notice.textContent = '重要提示保留完整，不截断。'; common.append(notice);
  root.append(screen);
}
render();
document.documentElement.dataset.previewReady = 'true';
