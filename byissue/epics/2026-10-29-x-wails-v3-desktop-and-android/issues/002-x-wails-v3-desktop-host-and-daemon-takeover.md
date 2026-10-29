---
kind: issue
title: "internal/gui Wails v3 桌面客户端：主窗口、托盘驻留与 Daemon 主从自愈接管"
type: feature
created: 2026-10-29
---

# 002: internal/gui Wails v3 桌面客户端：主窗口、托盘驻留与 Daemon 主从自愈接管

## 目标与范围

参照 `~/workspace/refs/magpie/internal/gui` 实现 BySpace 的 Wails v3 桌面宿主（`internal/gui`）：

1. **显式连接提示注入与未压缩资产直出**：
   - 在 `internal/webui` 增加 `WithExplicitConnectionHint(listenAddr, label)` 与 `WithoutPrecompression()`；
   - Wails 进程内自定义 Scheme 拦截器（macOS `WKURLSchemeTask`、Android `WebViewAssetLoader`）不自动解压 HTTP `Content-Encoding: br/gzip`，`WithoutPrecompression()` 确保在 Go 内存内解压 `.gz` 后返回原始字节流；
   - 桌面端将本机真实 daemon 监听地址（如 `127.0.0.1:6777`）注入 `window.__BYSPACE_INITIAL_DAEMON_CONNECTION__`，前端静态资源走 Wails 内存直出，`/ws` WebSocket 直连本机 loopback。
2. **主从自愈后台接管（`internal/gui/backend.go`）**：
   - `DaemonSupervisor.Start()` 探测本机默认 daemon 地址（`127.0.0.1:6777` 或 `BYSPACE_LISTEN`）的 `/health`（兼容 `status: "ok"` 与 `ok: true`）；
   - 若未运行，桌面进程直接在进程内启动 `server.Server` 并写入 PID 锁；
   - 若已在运行，桌面进程直接附着并启动周期巡检协程，外部 daemon 退出后立即在进程内拉起 `server.Server` 无缝接管。
3. **单主窗口 + 系统托盘驻留（`internal/gui/app.go`）**：
   - 主窗口拦截 `WindowClosing` 事件改为 `Hide()` 退驻系统托盘，避免误杀运行中的 Agent；
   - 系统托盘提供图标与菜单（`Open BySpace`、版本与 Daemon 地址展示、`Quit BySpace`），支持点击托盘图标与 macOS Dock 重开唤醒主窗口。

## 执行记录与验证

- **实现落点**：
  - `internal/webui/webui.go` & `internal/webui/webui_test.go`
  - `internal/gui/backend.go`、`internal/gui/backend_test.go`、`internal/gui/app.go`、`internal/gui/nogui.go`
- **验证证据**：
  - `go test -v ./internal/webui/... ./internal/gui/...` 全绿（`TestDaemonSupervisorAttachesAndTakesOverOnExit` 验证了外部 daemon 存活时附着、外部 daemon 关闭后 80ms 内自动在进程内接管 `/health`）。
  - 在隔离 `BYSPACE_HOME` 与临时端口下真实启动 `./bin/byspace-app tray`，实测进程内 daemon 正常拉起并响应 `/health`（`status: "ok"`）。
