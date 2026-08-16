---
kind: issue
title: "自动显示跨主机 Workspace 的设备名"
type: ff
status: closed
created: 2026-08-11
---

# 自动显示跨主机 Workspace 的设备名

## 做了什么

为 Host 的侧边栏 Badge 增加默认的“自动”模式：仅当同一项目存在位于至少两台主机的 Workspace 时，自动模式才显示设备名称。不同项目各自只在一台主机上打开时不显示名称。

## 改了哪些

- `packages/app/src/hosts/appearance.ts` — 新增 `auto` Badge 选项，并将新建和旧版缺失/空的设置规范化为该默认值；保留显式“名称”“仅图标”“隐藏”选择。
- `packages/app/src/components/sidebar-workspace-list.tsx` 与 `packages/app/src/hooks/sidebar-workspaces-view-model.ts` — 按项目中的实际 Workspace 主机集合决定自动模式是否展开名称。
- `packages/app/src/screens/settings/host-page.tsx` 与全部语言资源 — 在 Host Appearance 菜单中暴露“自动”选项。
- `packages/app/src/hosts/appearance.test.ts` 与 `sidebar-workspaces-view-model.test.ts` — 覆盖默认值、旧值规范化、显式覆盖，以及单主机/跨项目/同项目多主机判定。

## 怎么验证的

- `npx vitest run packages/app/src/hosts/appearance.test.ts packages/app/src/hooks/sidebar-workspaces-view-model.test.ts --bail=1`：2 个文件、32 个断言通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run format -- --write ...`：通过，且 `git diff --check` 无输出。

## 对 `codestable/` 的影响

无规格或架构真相变更。这是对既有 Host Appearance 侧边栏 Badge 默认语义的局部调整。
