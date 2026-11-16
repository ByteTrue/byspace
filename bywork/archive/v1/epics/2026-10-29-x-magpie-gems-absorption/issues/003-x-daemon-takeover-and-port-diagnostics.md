---
kind: issue
title: "外部/旧版 Daemon 一键接管与端口占用精确诊断 (internal/proc)"
type: feature
created: 2026-10-29
---

# 003: 外部/旧版 Daemon 一键接管与端口占用精确诊断 (internal/proc)

## 目标与范围

参照 `~/workspace/refs/magpie/internal/gui/gateway_takeover.go` 与 `internal/proc`：

1. **`internal/proc` 端口监听者探测**：
   - 实现跨平台 `ListeningOn(ctx, port)` 与 `Executable(pid)`、`IsBySpace(path)`、`IsContainerForwarder(path)`，识别占用指定 TCP 端口的进程 PID、可执行文件路径，以及是否属于 `byspace` 自身或 Docker/OrbStack 容器转发。
2. **`DaemonSupervisor` 状态诊断与一键接管（`TakeOver()`）**：
   - 在 `/_byspace/desktop/settings` 中返回当前本机 Daemon 的归属状态（`inProcess: bool`, `addr: string`, `runningVersion: string`, `externalPID: int`, `externalPath: string`, `conflictReason: string`）；
   - 当桌面客户端附着在外部（或旧版本）`byspace` daemon 上时，支持通过 `/_byspace/desktop/settings` 的 `takeOverDaemon: true`（及 `Settings → General` 中的「接管 / Take over」按钮）优雅停止外部 `byspace` 进程并立即在当前桌面客户端进程内拉起 `server.Server` 接管。

## 执行记录与验证

- **实现落点**：
  - `internal/proc/listener.go`、`listener_darwin.go`、`listener_linux.go`、`listener_windows.go`、`listener_others.go`、`listener_unix.go`、`listener_test.go`
  - `internal/gui/backend.go`（`DaemonSupervisor.Status()` 与 `TakeOver()`）
- **验证证据**：
  - `go test -v ./internal/proc/... ./internal/gui/...` 全部通过（`TestListeningOnAndIsBySpace` 验证真实端口监听 PID 查询、可执行路径解析、`byspace` 与容器转发识别）。
