---
kind: issue
title: "砍掉 Chief 右下角 FAB 与浮窗，改为左上角侧栏导航项直达全屏工作区"
type: ff
created: 2026-10-16
---

# 砍掉 Chief 右下角 FAB 与浮窗，改为左上角侧栏导航项直达全屏工作区

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

---

右下角 Chief FAB 与 420×560 悬浮小窗在实际使用中体验局促、且天然与右下角消息框发送键争夺空间。本次按讨论结论做一次性收敛：

1. **彻底移除右下角 FAB 与浮窗体系**：删除 `ChiefPanelHost`、`ChiefFloatingWindow`、`ChiefFab`、`chief-store`、`chief-route`、`use-chief-agent` 以及整套 `chief-fab-clearance` / `use-publish-chief-fab-clearance` 测量避让机制，并清理 `_layout.tsx`、`agent-panel.tsx`、`new-workspace-screen.tsx`、`workspace-setup-dialog.tsx` 的挂载与测量调用。
2. **入口收归左上角 `BySpace` 展开区（与 Search / Schedules / Tunnels 同级）**：在 `BUILTIN_SIDEBAR_NAV_IDS` 新增 `"chief"`（带 `hasHostChiefRole` 能力门控，并同步注册 Command Center 动作）。桌面端与移动端统一点击直接通过 `navigateToWorkspace` 进入目标 Host 的 Home workspace（`byspace.home-workspace`）全屏会话页。
3. **下方列表不重复露出 Home workspace**：在 `buildWorkspaceStructureProjects` 唯一聚合边界过滤掉 `byspace.home-workspace` 及其独占的自动项目壳（`BySpace-WorkSpace`），使下方 `Workspaces` 列表与项目选择器只呈现用户自己的代码项目。
4. **无已存会话时走预选 `Chief` 角色的正常 New Agent 草稿流**：进入 Home workspace 时，`WorkspaceDraftAgentTab` 默认预选 `role: "chief"`，并在草稿空态展示三条开场建议按钮，点击即通过标准草稿提交流创建会话并发送。

- 改动：`packages/app/src/chief/home-workspace.ts`（新）、`packages/app/src/chief/home-workspace.test.ts`（新）
- 删除：`packages/app/src/chief/` 下全部 FAB、浮窗、避让与自动后台建空会话模块及测试（14 个文件）
- 改动：`packages/app/src/projects/workspace-structure.ts`、`workspace-structure.test.ts`
- 改动：`packages/app/src/sidebar-nav/model.ts`、`model.test.ts`、`use-sidebar-nav-items.ts`、`use-sidebar-nav-entries.ts`、`packages/app/src/screens/settings/appearance/sidebar-nav-section.tsx`、`packages/app/src/command-center/root-registration.tsx`
- 改动：`packages/app/src/composer/draft/workspace-tab-core.ts`、`workspace-tab.tsx`、`workspace-tab.test.ts`
- 改动：`packages/app/src/app/_layout.tsx`、`packages/app/src/panels/agent-panel.tsx`、`packages/app/src/screens/new-workspace-screen.tsx`、`packages/app/src/components/workspace-setup-dialog.tsx`
- 验证：`npx vitest run src/chief/home-workspace.test.ts src/projects/workspace-structure.test.ts src/sidebar-nav/model.test.ts src/composer/draft/workspace-tab.test.ts --bail=1`（4 files, 34 passed）；`npm run typecheck`、`npm run lint`、`npm run format:check` 全绿。

## 对 `byissue/` 的影响

已同步 `byissue/spec/agent-conversation.md`（移除右下角浮层让位条款，更新为左上角导航直达全屏 Home workspace + 草稿默认预选 `chief` 角色与开场建议）、`byissue/spec/workspace.md`（展开区默认项含 Chief，且 Home workspace 从常规项目列表中过滤）及 `docs/timeline-sync.md`。
