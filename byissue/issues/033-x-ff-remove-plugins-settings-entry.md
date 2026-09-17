---
kind: issue
title: "移除设置页遗留的 Plugins 空入口"
type: ff
status: closed
created: 2026-09-15
closed: 2026-09-15
---

# 移除设置页遗留的 Plugins 空入口

## 做了什么

插件系统已在 issue 025 C6 退役，但设置侧栏的「Plugins」host section 条目仍渲染（点进去 `return null`，即用户看到的空白页）。本次移除该入口及设置侧的 plugin 视图类型：`HOST_SECTION_SLUGS` 去掉 `plugins`（旧深链接经 LEGACY 映射回落到 host overview，COMPAT(pluginsSection) remove after 2027-09-15）、`SettingsView` 删除永不再构造的 `{kind:"plugin"}` 成员、settings-screen 的 plugins case 与 4 处 `view.kind === "plugin"` 死分支、零引用的 `src/plugins/settings.ts` shim、i18n 的 `hostSections.plugins` 键、整个 `settings.plugins` 块与 `i18n/resources/plugin-settings.ts` 共享资源（9 语言）。

timeline/tabs/panels/replica-cache 中的 `plugin` 类型是 wire 兼容面（消息仍需解析），一律未动。

## 改了哪些

- `packages/app/src/utils/host-routes.ts`：slugs + legacy 映射；
- `packages/app/src/navigation/settings-navigation.ts`：SettingsView 联合类型 + returnFromSettings 分支；
- `packages/app/src/screens/settings-screen.tsx`：HOST_SECTION_ITEMS 条目、case、死分支、Blocks icon import；
- 删除 `packages/app/src/plugins/settings.ts`、`packages/app/src/i18n/resources/plugin-settings.ts`；
- `packages/app/src/i18n/resources/{en,ar,es,fr,ja,ko,pt-BR,ru,zh-CN}.ts`：plugins 相关键全清；
- `packages/app/e2e/support/helpers/settings.ts`：HostSection 类型同步。

## 怎么验证的

- `npx vitest run src/i18n/resources.test.ts src/utils/host-routes.test.ts --bail=1`：74 通过；
- `npm run typecheck` 全绿；`npm run lint` 0/0；format 一致。

## 对 byissue/ 的影响

- 无影响（纯退役尾巴清理，plugin 退役语义见 issue 025 C6 与 PROJECT_RULES #1782）。

## 顺手发现

- `src/plugins/` 其余文件（client-slash-commands、workspace-panels、icons、registry）仍是 wire 兼容 shim 群且被活代码引用，未动。
