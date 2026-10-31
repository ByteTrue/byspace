---
kind: issue
title: "打通：web/ 连上 daemon，看工作区列表、看 agent 对话、发消息"
type: feature
created: 2026-10-31
---

# 打通：web/ 连上 daemon，看工作区列表、看 agent 对话、发消息

## 目标与范围

搭起 `web/`，用最短的路径证明三件事：共享 `packages/app` 逻辑代码的方式可行；新前端能连上 daemon、拿到实时数据；agent 对话的流式输出在新栈上跑得顺。

包含：

- 脚手架：Vite、React、TypeScript、Tailwind v4、shadcn/ui 的样式变量（浅色深色）、Geist 字体；`npm run dev:web` 在 8082 起开发服务；`typecheck`、`lint`、`format` 覆盖 `web/`。
- 共享机制：`@/` 指向 `packages/app/src` 并支持 `web/src/overrides/` 覆盖；`react-native`、`expo-router`、`lucide-react-native` 的网页实现。
- 连接：沿用现版的主机注册、连接和会话同步（`runtime/host-runtime.ts`、`contexts/session-context.tsx`、`stores/session-store.ts`）。
- 界面：左包右框架；侧栏按项目列出工作区；点开工作区显示 agent 对话，包括实时流式输出、用户消息、Markdown、工具调用行；底部输入框能发消息。

不包含：标签页、分屏、终端、文件树、设置等其余页面和功能，按 Epic 推进视图放到后面几步。

## 验证

- 8082 和现版 8081 连同一个开发版 daemon，侧栏列出的工作区一致。
- 用 Mock 模型（见 [notes](../../../notes/2026-10-31-mock-provider-for-ui-checks.md)）发一条消息，新前端能看到完整的流式回复，滚动和渲染不卡。
- 浅色深色各截一张图，对照样板页。
- `npm run typecheck`、`npm run lint` 通过，`web/` 能构建出静态产物。

## 执行记录

### 2026-10-31 打通完成，待用户验收

- `web/` 的组件全部用 `npx shadcn@4.23.0 add` 加进来，style 是 `radix-nova`（就是样板页用的 nova），没有手抄。`index.css` 是 `shadcn init --preset nova` 的原样输出，BySpace 的改动只有字体回退、两处对比度和选中文字颜色，都标了 `BySpace:`。组件代码当成上游代码，不进 lint 和格式化，升级时 `--overwrite` 重新加。
- 对话直接用 shadcn 新出的聊天组件：`MessageScroller` 管滚动和跟随，`Message` + `Bubble` 画用户消息，`Trace` 画思考和工具调用（运行中自带闪光），输入框是 `InputGroup`。工具调用的标题、摘要、图标沿用 `packages/app` 的 `buildToolCallPresentation`。
- 共享方式验证可行：连接、会话同步、侧栏数据、时间线订阅、发送和停止都直接用 `packages/app` 的模块，`web/` 里只覆盖了 4 个文件（`constants/layout`、`attachments/store`、`components/retained-panel`、`components/toast-host`），另有 6 个第三方包的网页替身（`react-native`、`expo-router`、`expo-constants`、`expo-localization`、`expo-asset`、`lucide-react-native`）。
- 验证（真实浏览器，开发版 daemon 6778）：
  - 8082 和 8081 侧栏列出同样 5 个工作区，名称、运行中状态一致。
  - 在 Chief check 工作区用 Mock 模型从 8082 发消息：用户气泡立刻出现，回复实时流式输出（标题、列表、行内代码、思考、Read/Search/Shell 工具行），运行中出现停止按钮，结束后发送按钮恢复。浅色深色都截图看过，控制台没有报错。
  - `npm run typecheck`、`npm run lint`、`npm run format:check` 通过，`vite build` 成功。
- 没做的（按 epic 推进视图放在后面几步）：标签页持久化、Markdown 里的文件链接和代码高亮、工具调用的分类型详情、附件、模型和模式选择、权限卡片，以及其余所有页面。外观设置暂时只跟随系统深浅色。
- 发现的问题：产物 JS 有 6 MB（gzip 1.3 MB），还没做代码分割，放到切换前处理。
