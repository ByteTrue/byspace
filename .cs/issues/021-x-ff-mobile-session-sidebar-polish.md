---
kind: issue
title: "移动端会话与侧栏交互修正"
type: ff
status: closed
created: 2026-08-04
---

# 移动端会话与侧栏交互修正

## 做了什么

修正三处 compact Web 交互：移动端不再显示桌面输入框聚焦快捷键；会话的“折叠工具调用”和“回到底部”进入 Workspace pane header，脱离消息区与输入框；Status 分组的工作区卡片常驻三点菜单，与 Project 分组保持一致。

## 改了哪些

- `packages/app/src/composer/input/input.tsx` — compact 布局不渲染桌面 focus shortcut。
- `packages/app/src/composer/index.tsx`、`packages/app/src/panels/agent-panel.tsx`、`packages/app/src/panels/pane-header-actions-portal.ts` — 删除 composer 浮层/侧轨接口，并通过现有 Portal 基础设施把 28px ghost actions 投送到当前 agent tab 的 pane header。
- `packages/app/src/screens/workspace/workspace-screen.tsx`、`packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx` — compact 与 desktop pane header 提供当前 agent tab 的 action host；compact Tab 切换器点击区收紧到内容宽度，中间空白不响应点击。
- `packages/app/src/components/sidebar/sidebar-status-list.tsx` — compact Web 常驻工作区菜单并让菜单优先于遗留快捷键 badge。
- `packages/app/e2e/new-workspace-entry.spec.ts`、`packages/app/e2e/agent-stream-ui.spec.ts`、`packages/app/e2e/sidebar-workspace.spec.ts` — 覆盖 compact 快捷键隐藏、header actions 不遮挡内容且 composer 恢复完整宽度、Tab 切换器与 actions 之间保留非点击缓冲区、非焦点可见 split pane 仍有 actions，以及 Project/Status 菜单可见可打开。

## 怎么验证的

- 四个定向 Playwright 用例通过：新建工作区 focus shortcut 1/1、pane header actions 1/1、非焦点 split pane actions 1/1、Project/Status 移动菜单 1/1。
- `npm run typecheck`、定向 `npm run lint`、App Web export、`git diff --check`：通过。

## 对 .cs/ 的影响

无长期规格变化；这是 compact Web 的既有交互缺口与布局回归修复。
