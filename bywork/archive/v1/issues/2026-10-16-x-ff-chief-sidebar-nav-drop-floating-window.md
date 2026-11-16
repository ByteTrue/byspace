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

## 后续修复：CI playwright shard 6 失败（PR 前阻塞）

上述改动合入后 CI 的 `playwright (shard 6/8)` 在 `sidebar-nav-settings.spec.ts` 上挂了 3 个用例，两个真实缺陷冒出来：

1. **`chief.title` 这个 i18n 键不存在。** `sidebar-nav/model.ts` 与 `command-center/root-registration.tsx` 都引用它，但 `chief:` 资源块下只有 `switchHost`/`maximize`/`open`/`close`/`retry`/`noHomeWorkspace`/`suggestions.*`。i18next 对缺失键返回键名本身，所以侧栏那一行与 Command Center 动作直接渲染成字面量 `chief.title`。已在全部 9 个 locale 的 `chief` 块补 `title: "Chief"`。
2. **e2e 夹具没纳入 Chief。** `support/helpers/sidebar-nav-settings.ts` 的 `SHELL_ROW_TEST_IDS` / `itemLabel` 缺 `chief`，导致 spec 里的顺序断言、`expectStoredSidebarNav` 期望值都是旧列表；同时 `sidebar-nav-chrome` 的探针项仍是 `sidebar-search`，而 Search 已被 Chief 顶到第二位。已补齐 `chief: "sidebar-chief"` / `"Chief"`，并把 spec 中所有四处顺序期望、`move-up-search` 断言、以及三个「全关」用例的 seed 列表改为含 `chief`。

**附带发现（已修）：**`packages/app/src/i18n/key-contract.test.ts` 的扫描正则写成了 `[w.-]` 而非 `[\w.-]`，既匹配不到任何 `t("…")` 调用，又与资源键收集器共用同一残缺字符类使断言恒真——这条防「键缺失静默渲染」的守卫长期失效，正是 `chief.title` 漏过的原因。已改正则并补负向验证（临时删 `en.ts` 的 `chief.title`，确认测试变红后还原）。

- 改动：`packages/app/src/i18n/resources/{en,ar,es,fr,ja,ko,pt-BR,ru,zh-CN}.ts`（各 +`chief.title`）
- 改动：`packages/app/src/i18n/key-contract.test.ts`（修正扫描正则 + 注释）
- 改动：`packages/app/e2e/support/helpers/sidebar-nav-settings.ts`、`packages/app/e2e/browser/sidebar-nav-settings.spec.ts`
- 验证：`npx playwright test --project=browser e2e/browser/sidebar-nav-settings.spec.ts`（3 passed，本地 macOS；`Ctrl+N` 断言在本地渲染为 `⌘N`，CI 为 Linux，该断言原本即针对 CI 平台）；`npx vitest run src/sidebar-nav/model.test.ts src/i18n/key-contract.test.ts src/i18n/resources.test.ts src/hooks/use-settings/storage.test.ts --bail=1`（4 files, 128 passed）；`npm run typecheck`、`npm run lint`、`npm run format` 全绿。

## 对 `byissue/` 的影响

已同步 `byissue/spec/agent-conversation.md`（移除右下角浮层让位条款，更新为左上角导航直达全屏 Home workspace + 草稿默认预选 `chief` 角色与开场建议）、`byissue/spec/workspace.md`（展开区默认项含 Chief，且 Home workspace 从常规项目列表中过滤）及 `docs/timeline-sync.md`。
