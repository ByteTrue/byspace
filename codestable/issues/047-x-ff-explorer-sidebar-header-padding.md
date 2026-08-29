---
kind: issue
title: "重构文件/变更面板顶部导航：动效滑动下划线与分支选择器合并"
type: ff
status: closed
created: 2026-08-24
---

# 重构文件/变更面板顶部导航：动效滑动下划线与分支选择器合并

## 做了什么

1. **丝滑滑动下划线指示器**：将右侧面板（`ExplorerSidebar`）顶部的独立灰色胶囊 Tab 升级为连贯网格 + Reanimated 动态平滑滑块（`withTiming`），自适应 Tab 宽度与位移，指示线紧贴底部分割线，彻底消除断裂感。
2. **分支选择器上移合并 & 消除多余层级**：将分支选择器从独立的 40px 行上移合并至顶栏右侧，同时在侧边栏模式下去除冗余的分支行与关闭 X 按钮，使侧边栏 Header 从 124px 精简至 84px（节省 33% 垂直空间），并完全保留 1-Click 直达 Tab。

## 改了哪些

- `packages/app/src/components/explorer-sidebar.tsx` — 采用 Reanimated 平滑动效指示线（`useAnimatedStyle` + `withTiming`），在顶栏右侧集成 `BranchSwitcher`，移除冗余关闭按钮。
- `packages/app/src/git/diff-pane.tsx` — 当作为侧边栏面板（`!asWorkspaceTab && !isMobile`）时避免重复渲染独立分支行。
- `packages/app/e2e/sidebar-workspace.spec.ts` — 移除对已弃用 `explorer-close` 按钮的选择器依赖。

## 怎么验证的

- `npm run typecheck`：通过。
- `npm run lint`：0 错误 0 警告。
- `npm run format:check`：通过。

## 对 `codestable/` 的影响

纯 UI 视觉间距微调，无协议或架构真相受影响。
