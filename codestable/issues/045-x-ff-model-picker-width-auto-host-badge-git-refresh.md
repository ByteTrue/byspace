---
kind: issue
title: "修复模型选择宽度、自动Host徽标逻辑与Git刷新按钮提升"
type: ff
status: closed
created: 2026-08-21
---

# 修复模型选择宽度、自动Host徽标逻辑与Git刷新按钮提升

## 做了什么

1. **模型选择弹窗最小宽度**：为 `CombinedModelSelector` 设置默认 `desktopMinWidth = 360`，避免在设置页及表单中因触发器按钮宽度窄而被锁宽导致模型名称截断。
2. **自动 Host 徽标展示逻辑对齐**：当 Host Badge 处于 `auto` 模式且项目仅在单台主机上有 Workspace 时，完全隐藏 Host 徽标（同时隐藏图标与名称），只有同项目跨主机时才显示。
3. **Git Change 面板工具栏优化**：将高频的刷新操作（`DiffRefreshButton`）提升至主工具栏直接可见；将低频的 Side-by-side / Unified 布局切换收纳至二级选项菜单（`DiffOptionsMenu`）。

## 改了哪些

- `packages/app/src/components/combined-model-selector.tsx` — 设置默认 `desktopMinWidth = 360`。
- `packages/app/src/hosts/appearance.ts` — 导出 `resolveWorkspaceHostBadge`，在 `display === "auto"` 且 `!showAutoLabel` 时返回 `null`。
- `packages/app/src/components/sidebar-workspace-list.tsx` — 复用 `resolveWorkspaceHostBadge`。
- `packages/app/src/hosts/appearance.test.ts` — 补齐 `resolveWorkspaceHostBadge` 对 auto/name/icon/null 的全分支单元测试。
- `packages/app/src/git/diff-pane.tsx` — 提取 `DiffRefreshButton` 放置于主工具栏，将布局切换移入 `DiffOptionsMenu`。
- `packages/app/e2e/diff-row-alignment.spec.ts` — 同步工具栏主刷新按钮与二级菜单布局切换项的选择器验证。

## 怎么验证的

- `npx vitest run packages/app/src/hosts/appearance.test.ts --bail=1`：通过（10 个测试用例）。
- `npx vitest run packages/app/src/components/ui/combobox-frame-style.test.ts --bail=1`：通过（5 个测试用例）。
- `npx vitest run packages/app/src/git/actions-store.test.ts --bail=1`：通过（12 个测试用例）。
- `npm run typecheck`：全 workspace 通过。
- `npm run lint`：0 warning 0 error。
- `npm run format`：通过。

## 对 `codestable/` 的影响

无架构或破坏性协议变更。规范化了既有 `041-x-ff-auto-host-badge-labels.md` 中自动徽标在单机项目下的表现（隐藏孤立图标），并优化了 UI 易用性。
