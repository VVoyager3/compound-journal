# 栖光 Qiguang

栖光是一个本地优先的个人成长应用。它根据你的目标、近期状态和真实反馈，给出当前最值得做的一步，并由像素伙伴陪你记录、执行和复盘。

## 核心体验

- 第一次打开只需选择伙伴、写下一件今天发生的事，之后由页面内的短提示带你认识主要功能。
- 用“今日一句”加一篇正文记录今天，并在“记住的事、成功小记、有趣的事”之间快速切换；历年同日和每日快照从轨迹回看。
- 身体、心理、关系、工作/学习、玩乐是全应用唯一五维；状态表示近期感受，成长值表示长期真实积累。
- 把一句自然语言目标拆成带日期、五维和难度的子任务；AI 只生成可编辑草案，确认后再保存。
- 任务页分为“今天”和“计划”：今天快速添加、完成任务和打卡，计划只管理目标、子任务、未来任务与习惯。
- 根据完成、部分完成、跳过和现实阻力调整后续建议，不制造欠账或惩罚。
- 简单、普通、挑战任务分别获得 2、4、7 点成长值，里程碑增加 5 点；日记中的行动只产生 1—3 点待确认候选，并避免和任务重复结算。
- 点击某一维可查看相关任务、记录和真实分数变化，并用 6 道题只评这一维；设置另提供 30/60 题完整自评。
- 底部固定提供“今日、任务、记录、轨迹、设置”五个入口；任务可随时编辑或删除。

完整产品规则见 [PRODUCT.md](./PRODUCT.md)，当前进度与待办见 [TODO.md](./TODO.md)。

## 技术栈

- TypeScript、Vite、IndexedDB
- Capacitor Android 与原生桌面组件
- MiniMax 中国区接口；个人 Android 版由原生层持有密钥，WebView 不读取密钥

## 本地运行

需要 Node.js 22.18 或更高版本。

```powershell
npm ci
npm run dev
```

浏览器开发模式可离线使用本地闭环；需要 AI 时请先配置下方环境变量。

## MiniMax 配置

复制示例文件并填写自己的中国区 API 密钥：

```powershell
Copy-Item .env.example .env
```

```dotenv
MINIMAX_API_KEY=你的密钥
MINIMAX_MODEL=MiniMax-M3
MINIMAX_API_URL=https://api.minimaxi.com/v1/chat/completions
```

`.env` 已被 Git 忽略，不要提交或分享其中的密钥。

## Android

Android 构建需要 Android Studio、Android SDK 与 JDK 21。

```powershell
npm run android:debug
```

连接 Android Studio 模拟器后，可执行完整的本机设备门禁：

```powershell
npm run test:android-emulator
```

## 验证

```powershell
npm run check
npm run test:e2e
npm run check:release
```

用户记录默认保存在本机 IndexedDB。应用支持主动导出和导入；Android 系统云备份不会复制应用私有数据。
