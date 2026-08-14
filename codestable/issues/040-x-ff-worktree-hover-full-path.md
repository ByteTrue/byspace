---
kind: issue
title: "Workspace Hover 显示完整 worktree 路径"
type: ff
status: closed
created: 2026-08-13
---

# Workspace Hover 显示完整 worktree 路径

侧栏 Workspace Hover 卡片不再用 worktree slug 代替目录，也不再把目录限制为单行；完整绝对路径会在卡片内换行显示，复制路径行为保持不变。

- 改动：`packages/app/src/hooks/sidebar-workspaces-view-model.ts`、`packages/app/src/components/workspace-hover-card.tsx` — 保留完整目录并让路径行换行。
- 改动：`packages/app/src/hooks/sidebar-workspaces-view-model.test.ts`、`packages/app/e2e/sidebar-workspace.spec.ts` — 覆盖 worktree slug 存在时仍保留完整路径，以及真实 Hover 卡片展示路径。
- 验证：定向 Vitest 30/30、定向 Playwright 1/1、全仓 typecheck、lint、format check，以及 App Web export 均通过。
- codestable：无影响；现有侧栏 Hover 详情契约不变，只修复路径信息被缩写和截断的问题。
