---
kind: issue
title: "远端会话恢复时显示最新进度同步状态"
type: ff
status: closed
created: 2026-08-03
epic: ""
---

# 远端会话恢复时显示最新进度同步状态

## 做了什么

已有历史的 Agent 在切换工作区、从通知打开或重新连接时，保留旧时间线并后台追赶权威历史；追赶期间在面板顶部显示“正在同步最新进度...”，同步完成后自动消失。首次打开尚无历史的 Agent 仍使用原有全屏加载状态，失败继续显示现有同步错误提示。

## 改了哪些

- `packages/app/src/hooks/use-agent-screen-state-machine.ts` — 将已有历史 catch-up 的 UI 状态从 `silent` 区分为 `indicator`。
- `packages/app/src/panels/agent-panel.tsx` — 使用现有加载 spinner 增加非阻塞顶部同步条，并保留旧内容、输入和错误提示。
- `packages/app/src/hooks/use-agent-screen-state-machine.test.ts` — 覆盖已有历史在重连、可见性 catch-up 和恢复时使用 inline indicator。
- `packages/app/src/i18n/resources/` — 为全部语言资源补充同步进度文案。

## 怎么验证的

- `npx vitest run packages/app/src/hooks/use-agent-screen-state-machine.test.ts --bail=1` → 25/25 通过。
- `npm run typecheck` → 全 workspace 通过。
- `npm run lint` → 0 warnings / 0 errors。
- `npm run format:check` → 通过。
- `git diff --check` → 通过。

## 对 .cs/ 的影响

- 无已记录真相受影响；这是现有时间线 catch-up 状态的可见性修正，不改变协议、daemon 同步逻辑或 Agent 生命周期语义。
