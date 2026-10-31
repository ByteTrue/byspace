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
