---
kind: issue
title: "Daemon 默认启用自带 Web UI"
type: ff
status: closed
created: 2026-07-22
epic: ""
---

# Daemon 默认启用自带 Web UI

## 做了什么

`byspace daemon start` 默认启用 bundled Web UI，并在后台启动提示中同时给出本地地址和配置中的 Hosted Web 地址；保留 `--no-web-ui`、环境变量和持久化配置作为关闭方式，默认监听地址不变。

## 改了哪些

- `packages/server/src/server/config.ts` — Web UI 默认值改为启用。
- `packages/cli/src/commands/daemon/` — 启动结果解析本地及配置中的 Hosted 地址，并输出清晰的访问选择。
- `docs/development.md`、`public-docs/` — 同步默认行为和关闭方式。

## 怎么验证的

定向 Vitest 17/17、`build:server`、全仓 typecheck、lint、format check 和 App Web export 均通过。

## 对 .cs/ 的影响

- 无已记录 Project Spec 真相受影响；这是现有 bundled Web UI 的默认启用策略调整。
