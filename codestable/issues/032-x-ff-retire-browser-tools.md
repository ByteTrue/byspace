---
kind: issue
title: "退役 browser tools 功能与设置残留"
type: ff
status: closed
created: 2026-09-15
closed: 2026-09-15
---

# 退役 browser tools 功能与设置残留

## 做了什么

issue 025 架构整理的漏网之鱼：Electron 退役后 app 侧浏览器全部是空 shim（`src/desktop/browser/*`），没有任何客户端会再注册 browser automation host，但 daemon 侧整套 browser-tools 运行时和设置页的「Browser tools」卡片仍在。本次端到端退役该功能：

- app：删除设置页 `BrowserToolsOptInCard`（host-page 引用、card、config 模块）；
- server：删除 `server/browser-tools/` 整个模块（broker/tools/policy/errors）、bootstrap 的 broker/policy 创建与 PaseoDaemon 字段、websocket-server 的 host 注册/注销/响应路由全链路、paseo-tools 的 `registerBrowserTools`、config 的 `browserToolsEnabled` 解析、daemon-config-store 的 patch/RELOADABLE_PATHS/PERSISTED_TO_MUTABLE_PATH 条目；
- client：删除 `sendBrowserAutomationExecuteResponse` 及 browser automation 类型导出；
- docs：`docs/data-model.md` 与 `docs/providers.md` 移除 browser tools 相关表述。

**wire 兼容（COMPAT(browserTools)，remove after 2027-09-15）**：protocol 的 `browser-automation/` schema 模块、session 消息 union、WSHello `browser_host` capability、`MutableDaemonConfig(Patch)` 的 `browserTools` 字段、persisted config 的 `daemon.browserTools` strict 键全部保留——老客户端（≤0.13 desktop）的消息/patch/能力通告仍可解析，daemon 忽略其值；老 daemon 写的 config.json 在 strict schema 下仍可加载。`browserTools` 从 `.default({enabled:false})` 改为 `.optional()`（output 类型不再必填，wire 语义不变）。

## 改了哪些

- 删除：`packages/app/src/screens/settings/browser-tools-{card,config}.tsx/.ts` + test、`packages/server/src/server/browser-tools/`（6 文件）、`websocket-server.browser-tools.test.ts`、`config-browser-tools.test.ts`；
- 接线清理：`bootstrap.ts`、`websocket-server.ts`、`agent/tools/paseo-tools.ts`、`config.ts`、`persisted-config.ts`、`daemon-config-store.ts`；
- client：`daemon-client.ts`；
- protocol：`messages.ts`（COMPAT 标记 + optional 化）；
- 测试更新：protocol `messages.browser-automation.test.ts`（断言改为退役后契约）、server `config/daemon-config-store/persisted-config/mcp-server/mutable-provider-config-owner/selection-store/daemon-session` 测试、client `daemon-client/index` 测试、app `push-router/providers-section` 测试、cli `reload.test.ts`；
- docs：`docs/data-model.md`、`docs/providers.md`。

合计 48 文件，+358/-4888。

## 怎么验证的

- protocol：`messages.browser-automation / rpc-schemas / messages / wire-compat` 103 通过；
- server：`config / persisted-config / daemon-config-store / mcp-server / daemon-session / mutable-provider-config-owner / selection-store` 221 通过；
- client：`daemon-client / index` 136 通过；
- app：`push-router / providers-section / i18n resources` 48 通过；
- `npm run build:client` 重建 protocol 声明后 `npm run typecheck` 全绿；`npm run lint` 0/0；format 一致。

## 对 codestable/ 的影响

- 无影响（纯退役清理；退役 shim 清单见 PROJECT_RULES #1782，可后续把 browser-tools shim 补进该记忆）。

## 顺手发现

- app i18n 存在 Electron 浏览器 UI 的孤儿 key（`browser.unavailable/session/controls.*` 等，9 个语言文件），属于 desktop/browser 退役面的另一层清理，未在本批次处理。
