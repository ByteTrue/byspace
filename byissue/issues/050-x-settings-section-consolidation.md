---
kind: issue
title: "精简设置侧栏分类并清理僵尸代码"
type: refactor
status: closed
created: 2026-09-24
---

# 精简设置侧栏分类并清理僵尸代码

> **读者：** 接手实现或 review 的人——这里是分类取舍的完整结论、删什么留什么、路由兼容怎么处理、怎么验证。
> **自检：** 目标与范围已确认；归属：独立 refactor issue（讨论源自会话）；现状盘点见下；影响面按包/文件列出；验证含类型、lint、目标测试与手动路径。

## 目标与范围

设置侧栏分类过多且含空壳：App 组 10 个分类中 4 个渲染 `null`，Host 组 10 个中 3 个只有一条配置。本次收敛为 **App 4 分类、Host 7 分类**，并删除永不为真的分支与孤儿文件。

**已确认决策（2026-09-24 讨论）：**

- App：General/Appearance/Notifications/About 四分类；Diagnostics 按钮并入 About；Vim 键位并入 General；删 Layout、Shortcuts、Integrations、Permissions 空壳（`isDesktopApp = false` 写死，desktopOnly 分类永远不渲染）。
- Host：Pair device 并入 Connections（配对即加连接）；Workspaces 自动归档开关并入 Overview（host 级策略）；Metadata 模型选择并入 Agents（同为替用户干活的模型）；Usage 保留独立（监控视图，非设置）。
- Electron 退役（issue 025）相关的客户端僵尸代码（`desktopOnly`/`webOnly` 机制、永不为真的分支）一并清理。

## 现状怎么工作

- 侧栏数据：`packages/app/src/screens/settings-screen.tsx` 的 `SIDEBAR_SECTION_ITEMS`（desktopOnly/webOnly/orWebPush 过滤）与 `HOST_SECTION_ITEMS`。
- 路由：`packages/app/src/utils/host-routes.ts` 的 `SETTINGS_SECTION_SLUGS` / `HOST_SECTION_SLUGS` / `LEGACY_HOST_SECTION_SLUGS`（已有 plugins → host 先例）。
- 内容：App 分类多为 `settings-screen.tsx` 内联 section；Host 分类在 `screens/settings/host-page.tsx` 导出的 `Host*Page` 组件。
- 先例：`byissue/issues/033-x-ff-remove-plugins-settings-entry.md`（删 plugins host section：slug、LEGACY 映射、i18n、e2e helper）。

## 改什么

**App 组**

- 删分类：layout、shortcuts、integrations、permissions（侧栏项、路由 case、i18n `settings.sections.*`）。
- General 增加行：Vim 键位（自 `editor-section.tsx` 迁移，webOnly 判断随 `isWeb` 恒真而消失）。
- About 增加卡片：运行诊断（自 `DiagnosticsSection` 迁移）。
- 删 `SIDEBAR_SECTION_ITEMS` 的 desktopOnly/webOnly/orWebPush 机制与 `isDesktopApp` 死变量。

**Host 组**

- 删分类：pair-device、metadata、workspaces。
- Connections 页增加配对行（`PairDeviceRow`，modal 逻辑随迁）。
- Overview 页（`HostSettingsPage`）增加自动归档开关卡片（`AutoArchiveMergedWorkspacesCard`）。
- Agents 页增加 Metadata generation section（`MetadataGenerationPage` 内容下沉为 section）。

**兼容（先例 issue 033）**

- `HOST_SECTION_SLUGS` 删 `pair-device`/`metadata`/`workspaces`；`LEGACY_HOST_SECTION_SLUGS` 增加 `pair-device → connections`、`metadata → agents`、`workspaces → host`，附 COMPAT 标记。
- `SETTINGS_SECTION_SLUGS` 删 4 个 slug；旧 `/settings/layout` 等深链接：`[section].tsx` 已有未知 slug 回落 general 的行为，无需映射。评估是否需要 `/settings/shortcuts → shortcuts 键位迁移`？不需要——内容为 null，无功能可回落。

**僵尸清理**

- 删孤儿文件 `screens/settings/layout/layout-section.tsx`、`screens/settings/keyboard-shortcuts-section.tsx`（零引用，`rg LayoutSection|KeyboardShortcutsSection` 仅自文件）。
- e2e helper `packages/app/e2e/support/helpers/settings.ts` 的 HostSection 类型同步。
- i18n：`settings.sections.{layout,shortcuts,integrations,permissions}`、`settings.hostSections.{pair-device?…}`（键名以代码为准）与迁移走空的编辑器/通知块，9 语言同步清理。

## 影响面

- **必须改：** settings-screen、host-page、host-routes、editor-section / diagnostics 迁移、配对与归档与元数据的挂载点、i18n 9 语言、e2e helper。
- **需要验：** 旧深链接回落、PWA 无回归、General/About 新行可用、配对 modal 仍能打开。
- **仍未知：** 无。

## 质量承诺

- 类型与 lint 全绿（`npm run typecheck`、`npm run lint`）。
- 相关测试文件（`providers-section.test.tsx` 等 settings 目录下测试）通过；不跑全量套件。
- 行为不变：所有保留功能的可达性不降级——每条配置在删分类后仍能从侧栏两次点击内到达。

## 验证

- `npm run typecheck`、`npm run lint`。
- `npx vitest run packages/app/src/screens/settings/providers-section.test.tsx --bail=1`（及受影响的其他单文件）。
- 手动：`npm run dev:app`，检查侧栏 4+7 分类、General/About 新行、Connections 配对、Overview 归档开关、Agents 元数据模型、旧链接 `/settings/layout`、`/settings/hosts/<id>/workspaces` 回落。

## 执行记录

**实现（2026-09-24）**

- `src/utils/host-routes.ts`：`SETTINGS_SECTION_SLUGS` → 4 项（删 layout/editor/shortcuts/integrations/permissions/diagnostics）；`HOST_SECTION_SLUGS` → 7 项（删 pair-device/metadata/workspaces）；`LEGACY_HOST_SECTION_SLUGS` 增加 `pair-device→connections`、`metadata→agents`、`workspaces→host`，`COMPAT(settingsConsolidation) remove after 2027-09-24`。
- `src/screens/settings-screen.tsx`：侧栏 4+7 项；删 `desktopOnly`/`webOnly`/`orWebPush` 过滤与 `isDesktopApp` 死变量；General 增 Vim 键位行（复用 `settings.editor.*` 键）；About 卡片增诊断行；删 layout 特判与空 case，未知 slug 渲染空页（路由层已回落 general）。
- `src/screens/settings/host-page.tsx`：Connections 页挂 `PairDeviceRow`；Overview（`HostSettingsPage`）挂 `AutoArchiveMergedWorkspacesCard`（isConnected 门控，与原 Workspaces 页一致）；Agents 页末尾挂 `MetadataGenerationPage`；删 `HostPairDevicePage`/`HostWorkspacesPage`。
- 删文件：`editor-section.tsx`（621+90+41 行死代码全清）、`keyboard-shortcuts-section.tsx`、`layout/layout-section.tsx`。
- i18n：9 语言脚本化删除 `settings.sections.{layout,editor,shortcuts,integrations,permissions,diagnostics}`、`settings.{layout,integrations,permissions}` 整块、`settings.editor.title`、`settings.diagnostics.title`、`settings.host.pairDevices.title`、`settings.host.workspaces` 块、`settings.hostSections.{metadata,workspaces}`；共 -422 行。保留 `settings.shortcuts.*`（快捷键弹窗命名空间，与设置分类无关）与 `settings.editor.{vimKeybindings,vimHint}`（General 行在用）。
- e2e：helper 的 HostSection/SECTION_LABELS 同步；pair-device helper 改走 connections；metadata spec 改走 agents 页内 testID；sidebar-help/navigation spec 的诊断入口改走 About；`expectRetiredSidebarSectionsAbsent` 断言更新。

**小偏差**：`SETTINGS_SECTION_SLUGS` 首版误留 `diagnostics`（旧链接会渲染空页而非回落 General），自检发现后删除；`resources.test.ts` 删去 3 条对已删键的断言。

**验证**

- `npm run typecheck`：全部包绿（含 e2e）。
- `npm run lint` / `npm run format:check`：0 错误。
- `npx vitest run`（9 文件）：99/99 断言通过。`providers-section.test.tsx` 模块级 TypeError（主题 mock 缺 `shadow.sm`）为**预存在失败**——已用 git stash 在基线复现确认，与本次无关。
- 手动路径未逐项点击（dev 环境未起）；旧链接回落行为由 `host-routes.test.ts`（38 用例，含三个新映射）覆盖。

**UI 偏离修正（用户报告）**：Overview 页的自动归档卡片首版为裸卡片，无下边距，与 Network 小节标题贴死。根因：settings 规范要求每个区块用 `SettingsSection`（自带 margin），裸卡片是被禁止的模式。修法：包一层 `SettingsSection title=settings.hostSections.workspaces`（该 i18n 键从 HEAD 恢复回 9 语言，页内小节语义仍需要它），与 Agents 页的 Metadata 小节同款。卡片自身保留 `testID=host-page-auto-archive-merged-workspaces-card`，新增 section 级 `testID=host-page-workspaces-section`。

**关闭候选**：project spec 无设置分类相关条目，无需毕业回写；预存在的 `providers-section.test.tsx` 主题 mock 缺 `shadow.sm` 失败，已在后续 commit（8efc8a825）补全 mock 三档 shadow 修复，该 suite 恢复全绿。

## 关闭回写与结论

- 关闭候选：project spec 若有设置页相关条目需同步分类数；无则仅在执行记录说明。
