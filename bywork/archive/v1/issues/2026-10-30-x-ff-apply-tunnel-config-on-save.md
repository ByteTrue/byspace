---
kind: issue
title: "修复在 UI 开启 Tunnel 后添加转发无反应：set_daemon_config_request 同步触发 ApplyTunnelConfig"
type: ff
status: closed
created: 2026-10-30
closed: 2026-10-30
---

# 修复在 UI 开启 Tunnel 后添加转发无反应：set_daemon_config_request 同步触发 ApplyTunnelConfig

- **做了什么**：
  - **根因定位**：SSH 登录 Windows 排查 `~/.byspace/config.json` 与 `tunnels.json` 发现：用户在 UI 点击 `Enable tunnels` 触发 `set_daemon_config_request` 将 `daemon.tunnel.enabled: true` 写入了磁盘 `config.json`，但 `set_daemon_config_request` 未调用 `s.ApplyTunnelConfig()`（仅 `daemon.config.reload.request` 调用了它），导致内存中 `s.tunnelsEnabled` 与 `registry.enabled` 仍为 `false`；随后用户点击 `Add tunnel` 添加 `3425 -> 34125` 时，`Registry.AddOrUpdate` 仅写入了 `tunnels.json` 而未启动 `startPeer`，且 `Registry.List()` 在 `manager == nil` 时返回空 `Forwards`，导致界面无任何反应。
  - **修复**：
    1. 在 `internal/server/ws_git_system.go` 的 `set_daemon_config_request` 保存配置后立即调用 `s.ApplyRelayConfig(ctx)` 与 `s.ApplyTunnelConfig()`；
    2. 在 `internal/server/tunnels.go` 的 `handleTunnelCreate` 中先调用 `s.ApplyTunnelConfig()` 确保 gate 与配置同步；
    3. 在 `internal/tunnel/registry.go` 的 `List()` 中，当 `item.manager == nil` 时仍返回已配置的 `item.peer.Forwards`（状态为 `StateDisconnected`），避免已保存条目在列表中隐形。
- **改了哪些**：
  - `internal/server/ws_git_system.go`、`internal/server/tunnels.go`、`internal/tunnel/registry.go`
- **怎么验证的**：
  - 在 Windows 实机执行 `byspace daemon reload` 触发 `ApplyTunnelConfig()` 后，`127.0.0.1:34125` 立即启动监听并出现在列表；
  - `go test ./internal/tunnel/... ./internal/server -run 'TestTunnel|TestNoReentrantServerLocks'` 全绿。
- **对 `byissue/` 的影响**：无规格变更，修复配置热应用遗漏。
