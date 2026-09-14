---
kind: issue
title: "移除无 workspace 项目下的占位新建按钮行"
type: ff
status: closed
created: 2026-09-14
closed: 2026-09-14
---

# 移除无 workspace 项目下的占位新建按钮行

## 做了什么

当项目（Project）下没有 Workspace 时，侧栏原先会在项目展开态下渲染一行带缩进的 "+ New workspace" 幽灵行（`NewWorkspaceGhostRow`）。由于项目行右侧本身已有新建 Workspace 的加号动作按钮，该占位行属于冗余占位。已将其移除，无 Workspace 时仅保留项目标题行本身。

## 改了哪些

- `packages/app/src/components/sidebar-workspace-list.tsx`：移除 `NewWorkspaceGhostRow` 组件函数、`ProjectBlock` 中无 Workspace 时的兜底分支，并清理无用样式；
- `packages/app/e2e/browser/empty-project-persists.spec.ts`：更新对空项目的断言，确保空项目在保留项目行和右上角新建动作的同时不再渲染幽灵占位行。

## 怎么验证的

- `npx vitest run packages/app/src/utils/sidebar-project-row-model.test.ts --bail=1`：通过；
- `npm run typecheck`：全 workspace 通过；
- `npm run lint`：通过（0 warnings / 0 errors）；
- `npm run format:check`：格式完全一致。

## 顺手修复

- 在 `packages/app/package.json` 的 `devDependencies` 中补齐了 `@types/react-dom: ~19.2.0`（Issue 025 移除 website 后全仓缺失该声明，补齐后修复了本地类型检查）。

## 对 codestable/ 的影响

- 无影响（仅精简侧栏无 Workspace 时的多余幽灵行，不影响底层 Project / Workspace 模型与路由）。
