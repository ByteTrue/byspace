---
kind: issue
title: "Tunnel 支持单端口按需启停与一键全部开启/全部暂停 (批量启停)"
type: ff
status: closed
created: 2026-10-30
closed: 2026-10-30
---

# Tunnel 支持单端口按需启停与一键全部开启/全部暂停 (批量启停)

- **做了什么**：
  1. **数据模型与协议支持 `disabled`**：在 `ForwardConfig`、`ForwardState`、`TunnelEntrySchema` 与 `TunnelCreateRequestSchema` 中新增可选 `disabled: boolean` 字段。
  2. **按需释放本地端口与连接**：当某条端口转发处于 `disabled: true`（已暂停）时，`Registry.startPeer` 不绑定其本地 `127.0.0.1:<localPort>` 端口（若同一 Peer 下所有端口均暂停则连 `runReconnector` 也不启动），但 `Registry.List()` 仍保留该条目及其已锁定的 `localPort`；再次开启时立即恢复绑定同一固定本地端口。
  3. **单条 `<Switch>` 启停 + 顶栏批量 `全部开启 / 全部暂停`**：每条出站转发右侧增加 `<Switch>` 开关（暂停时徽章显示 `已暂停 / Paused`），顶栏操作区增加 `全部开启 / Start all` 与 `全部暂停 / Pause all` 批量按钮。
- **改了哪些**：
  - `packages/protocol/src/messages.ts`、`packages/client/src/daemon-client.ts`
  - `internal/tunnel/manager.go`、`internal/tunnel/registry.go`、`internal/tunnel/registry_test.go`、`internal/server/tunnels.go`
  - `packages/app/src/screens/tunnels-screen.tsx`
- **怎么验证的**：
  - `go test -v ./internal/tunnel/...` 通过（含新增的暂停释放与恢复重绑单测）；
  - `npm run build:client`、`npm run lint`、`npm run typecheck`、`npm run format:check` 全绿。
- **对 `byissue/` 的影响**：无架构边界变更。
