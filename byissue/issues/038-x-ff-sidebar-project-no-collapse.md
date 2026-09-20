---
kind: issue
title: "左侧边栏项目行不再折叠，恒展开"
type: ff
status: closed
created: 2026-09-16
closed: 2026-09-20
---

# 左侧边栏项目行不再折叠，恒展开

移除侧栏 project 模式下项目行的折叠/展开能力：项目行不再显示 hover chevron、点击不再切换折叠，workspace 行恒渲染。这是产品决定（Owner 2026-09-16 确认），不是重构。Pinned 区折叠（`collapsedPinned`）与 status 分组折叠（`collapsedWorkspaceGroupKeys`）保留不变。

## 为什么有第二次提交

2026-09-16 同一个会话里已经做完并验证过这件事，收尾写明「默认未 commit」，随后会话结束，改动没有落盘——仓库里从未出现过 `038-x-ff-sidebar-project-no-collapse.md`，`chevron`、`collapsedProjectKeys`、快捷键跳过折叠分区的逻辑全都还在。本次是在当前 `main` 上按原意图重做；原始会话的编辑记录已归档在会话 `01a0a9a2-6075-7688-a790-b7b37d7276e9`。

## 改了哪些

- `sidebar-project-row-model.ts`：模型删掉 `chevron` 字段与 `projectChevron()`，`buildSidebarProjectRowModel` 不再收 `collapsed`；
- `sidebar-workspace-list.tsx`：`ProjectBlock` 删掉 `collapsed`/`onToggleCollapsed`、聚合状态 hook 调用与 `if (!collapsed)` 门；`ProjectHeaderRow` 删掉 `statusBucket`/`chevron`/`onPress`（项目行不再可按，`handlePress` 与 `didLongPressRef` 的消费一并移除）；memo 比较器与 `SidebarWorkspaceListProps` 同步收窄；
- `project-leading-visual.tsx`：删掉 chevron 渲染分支、`ProjectInlineChevron` 与随之无用的 `ChevronDown`/`ChevronRight` 导入；
- `use-sidebar-workspaces-list.ts`：删除只为折叠行服务的 `useSidebarProjectStatusBucket`——项目行恒展开后，状态信号由各自的子行承担；
- `sidebar-shortcuts.ts` / `sidebar-projection.ts` / `sidebar-model.tsx` / `left-sidebar.tsx`：project 分组不再传 `collapsedProjectKeys`，快捷键编号不再跳过折叠分区；
- `stores/sidebar-collapsed-sections-store`：删除 `collapsedProjectKeys` / `toggleProjectCollapsed` / `setProjectCollapsed`。

**与首次尝试的唯一差异**：持久化 schema 不再保留 `collapsedProjectKeys` 可选字段。首次尝试保留它是为了让旧 localStorage blob 仍能通过 `strictObject` 解析；但 042 身份迁移已把存储键命名空间整体换掉，旧 key 下的数据不会被读到，该字段保护不了任何东西，按项目「不留兼容层」的前提下直接删净。

## 怎么验证的

- 6 个相关测试文件（row-model / shortcuts / store state / projection / shortcut-model / shortcut-targets-subscriber）：35 通过；
- `npm run typecheck`、`npm run lint`、`npm run format` 全过；
- 真实 UI 验证见提交时的说明。

## 对 byissue/ 的影响

- 无 spec/notes 影响：未记载项目折叠语义。
- 030-x-ff「空项目行不再显示展开/折叠 chevron」的约定被整体取代——现在所有项目行都无 chevron，`projectChevron()` 已不存在。
- `epics/001` 的 `decision-matrix.md` W10 与 `requirements-catalog.md` W10 记的是「不做」（不恢复 CodeStable 曾有的移除），本次是 Owner 推翻该决定后的实现，两处记录保持原样作为历史。

## 遗留

- `useSidebarShortcutModel` 与 `buildSidebarShortcutModel` 在本次改动前后都只有测试在消费（真实链路走 `buildSidebarProjection`）。本次只做随动收窄，未删除；确认无用可单独清退。
