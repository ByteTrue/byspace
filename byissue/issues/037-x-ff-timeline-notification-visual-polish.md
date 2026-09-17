---
kind: issue
title: "时间线 Notification 卡片做工精细化与 Markdown 标题解析"
type: ff
status: closed
created: 2026-09-16
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 时间线 Notification 卡片做工精细化与 Markdown 标题解析

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

用户反馈时间线系统通知（如 Magic Context 会话恢复重试时发出的 `## Historian recovery`）样式突兀，原因为：Issue 029 只统一了 `custom_message`（Pi `sendMessage` 注入的工具延伸流水，改用 `ExpandableBadge` 折叠徽标），而通过 Pi `ctx.ui.notify` 触发的 `notification` 时间线项仍走上游遗留下来的原始 `<Notification>` 组件——无边框半透明色块且直接纯文本渲染，导致 Markdown 的 `##` 裸露且缺少标题/正文层级。讨论确认：通知是低频、面向人的系统状态介入信号，保留独立 Callout 卡片形态是正确的，但做工必须精致化。

- 做了什么：
  1. 新增 `parseNotificationMessage` 解析器：自动提取 Markdown 标题（如 `## Historian recovery` 或 `**Title**`）或首段作为标题，剔除裸露的 `## ` 等符号；余下内容提取为次级正文；单行或普通多行场景平滑兜底。
  2. 卡片视觉对齐 `docs/design.md` 规范：增加对应语义色的细微边框（`rgba(..., 0.25)`）、柔和半透明背景、更大圆角（`borderRadius.lg`）、左侧图标对齐首行文字中轴；标题采用 `foreground` + `fontWeight.medium`，正文采用 `foregroundMuted` + `fontSize.sm` + `lineHeight: 18`，建立清晰的视觉层级。
  3. 在 `MockLoadTestAgentClient`（Mock Load Test provider）新增场景：提示词匹配 `/emit (?:a )?synthetic notification/i` 时，发出一条同构通知项（`type: "notification"`, `level: "info"`, `message: "## Historian recovery..."`），便于在 Mock 环境下秒级重现与验证卡片渲染。

- 改了哪些文件：
  - `packages/app/src/components/message-notification-parser.ts` — 纯函数：通知消息标题与正文提取。
  - `packages/app/src/components/message-notification-parser.test.ts` — 7 个单元测试，覆盖各种标题形式及边界分支。
  - `packages/app/src/components/message.tsx` — 重构 `Notification` 组件排版与样式，引入标题/正文结构与语义边框。
  - `packages/server/src/server/agent/providers/mock-load-test-agent.ts` — 新增 `shouldEmitSyntheticNotification`、`scheduleSyntheticNotificationTurn`、`emitSyntheticNotificationTurn`。
  - `packages/server/src/server/agent/providers/mock-load-test-agent.test.ts` — 新增合成通知单测。

- 怎么验证：
  - `npx vitest run packages/app/src/components/message-notification-parser.test.ts packages/server/src/server/agent/providers/mock-load-test-agent.test.ts --bail=1` 全部通过（25/25）。
  - `npm run build:server` 顺利构建。
  - `npm run typecheck`（7 workspaces）全部通过。
  - `npm run lint`（3439 files）0 errors, 0 warnings。
  - `npm run format:check`（3643 files）全部通过。

- 对 `byissue/` 有无影响：无。
