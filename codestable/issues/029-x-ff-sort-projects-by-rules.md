---
kind: issue
title: "侧栏支持一键按规则整理 Project 顺序"
type: ff
status: closed
created: 2026-09-14
closed: 2026-09-14
---

# 侧栏支持一键按规则整理 Project 顺序

## 做了什么

在侧栏 "Workspaces" 分节标题栏右侧（Display preferences 按钮左侧）新增一个“整理项目顺序”动作按钮（`ArrowDownAZ` 图标，带 Tooltip）。点击后，将所有项目按三大梯队自动重排并持久化：

1. **顶部（Tier 1）**：拥有活跃 Workspace（状态处于 running、attention、needs_input、failed 等非 done 状态）的项目；
2. **中间（Tier 2）**：拥有 Workspace，但全部处于空闲/已查看状态（全为 done）的项目；
3. **底部（Tier 3）**：无任何 Workspace 的项目；
4. **组内排序**：三大类别内部，均按项目名称首字母（A–Z）升序自然排列（不区分大小写，支持数字自然序）。

## 改了哪些

- `packages/app/src/utils/sidebar-sort-projects.ts`：实现判断项目分层（`getProjectSortTier`）和多层级排序（`sortProjectsByRules`）的纯函数逻辑；
- `packages/app/src/utils/sidebar-sort-projects.test.ts`：增加覆盖各种状态、空项目与字母序组合排序的单元测试；
- `packages/app/src/components/left-sidebar.tsx`：在 `WorkspacesSectionHeader` 中集成 `SortProjectsButton`，点击后读取全局 projects 与 live entries，按规则生成新顺序并通过 `useSidebarOrderStore.setProjectOrder` 持久化；
- `packages/app/src/i18n/resources/*.ts`：在所有语言资源中补齐 `sidebar.sortProjects.label`。

## 怎么验证的

- `npx vitest run packages/app/src/utils/sidebar-sort-projects.test.ts packages/app/src/i18n/resources.test.ts --bail=1`：通过（38/38 tests passed）；
- `npm run typecheck`：全 workspace 通过，零类型错误；
- `npm run lint` 与 `npm run format:check`：0 warnings / 0 errors，格式完全一致。

## 对 codestable/ 的影响

- 扩展了 `codestable/spec/workspace.md` 中关于侧栏 Project 组织和排序能力的规则。
