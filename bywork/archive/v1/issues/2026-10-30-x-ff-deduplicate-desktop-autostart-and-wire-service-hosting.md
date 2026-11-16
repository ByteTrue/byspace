---
kind: issue
title: "平衡客户端 Open at login 与 Host Service hosting：桌面本机隐藏重复项并接通无头服务状态"
type: ff
status: closed
created: 2026-10-30
closed: 2026-10-30
---

# 平衡客户端 Open at login 与 Host Service hosting：桌面本机隐藏重复项并接通无头服务状态

- **做了什么**：
  1. **桌面客户端本机 Host 隐藏重复的 `Service hosting`**：在 `packages/app/src/screens/settings/daemon-service-section.tsx` 中，当运行于 Wails 桌面客户端且当前查看的是本机 Daemon（`isLocalDaemon === true`）时，隐藏 `Host → Overview` 下的 `Service hosting`（本机开机自启统一由 `App → General → Open at login` 负责，启动托盘的同时自带进程内 Daemon）；仅在查看远程服务器 Host 或在纯 Web 浏览器管理无头 Daemon 时展示。
  2. **接通 Go 端 `service` 状态查询与安装/卸载（消除 `Service state unknown`）**：
     - 在 `internal/daemon/service.go` 新增 `BuildServiceView()`，在 `get_daemon_config_request` 与 `set_daemon_config_request` 中返回实时探测的 `not-installed` / `installed-stopped` / `managed-by-service` 状态；
     - 在 `set_daemon_config_request` 中接入 `InstallLoginService` 与 `UninstallLoginService`，并对齐 Magpie 增加互斥检查（若本机已开启桌面客户端 `Open at login`，拒绝同时注册冲突的无头 `serve` 服务）；
     - 仅在支持用户级系统服务的平台（macOS / Linux）下发 `daemonServiceInstall: true`。
- **改了哪些**：
  - `packages/app/src/screens/settings/daemon-service-section.tsx`
  - `internal/daemon/service.go`、`internal/server/server.go`、`internal/server/ws_git_system.go`
- **怎么验证的**：
  - `go test ./internal/daemon/... ./internal/server -run TestNoReentrantServerLocks` 通过；
  - `npm run lint -- packages/app/src/screens/settings/daemon-service-section.tsx`、`npm run typecheck`、`npm run format:check` 全绿。
- **对 `byissue/` 的影响**：无规格变更。
