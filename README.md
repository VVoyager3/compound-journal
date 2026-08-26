# 栖光 Qiguang

栖光是一个本地优先的个人成长应用。它根据你的目标、近期状态和真实反馈，给出当前最值得做的一步，并由像素伙伴陪你记录、执行和复盘。

## 核心体验

- 第一次打开只需选择伙伴、写下一件今天发生的事，之后由页面内的短提示带你认识主要功能。
- 用一句话记录今天，回看每天的快照和变化。
- 把一句自然语言目标拆成阶段目标和可以立即开始的下一步，确认后再保存。
- 通过“今日重点、可选任务、其他任务”推进目标和习惯，完成后获得经验。
- 根据完成、部分完成、跳过和现实阻力调整后续建议，不制造欠账或惩罚。
- 用五个简短问题完成状态自评，不要求用户凭空理解分数标准。
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
