---
kind: issue
title: "Windows .com 伴侣与 WebView2 检测、Linux Wayland/无 GPU 渲染保护及核心配置自动滚动备份"
type: feature
created: 2026-10-29
---

# 004: Windows .com 伴侣与 WebView2 检测、Linux Wayland/无 GPU 渲染保护及核心配置自动滚动备份

## 目标与范围

参照 `~/workspace/refs/magpie/internal/update/com.go`、`internal/gui/webview2_windows.go`、`internal/gui/webkit_linux.go` 与 `internal/backup`：

1. **Windows 控制台伴侣与 WebView2 Runtime 检查**：
   - 在 Windows 桌面客户端启动前检查 WebView2 Runtime 是否存在，若缺失则弹出原生 `MessageBoxW` 引导打开微软 WebView2 下载页；
   - 提供 Windows 终端调用的控制台附着支持（当在父终端中带 CLI 子命令调用 `byspace.exe` 时通过 `AttachConsole(ATTACH_PARENT_PROCESS)` 绑定控制台标准流，或生成 `byspace.com` 伴侣）。
2. **Linux Wayland / 无 GPU 渲染保护（`webkit_linux.go`）**：
   - 在 Linux 创建第一个 WebView 窗口前调用 `webkitDefaults()`：若处于 Wayland 会话或无法打开 `/dev/dri/renderD*` 硬件渲染节点，自动设置 `WEBKIT_DISABLE_COMPOSITING_MODE=1`，消除 Wayland 闪烁及无 GPU 环境下 `llvmpipe` CPU 暴涨。
3. **核心配置自动滚动备份（`internal/backup`）**：
   - Daemon 启动及每 6 小时自动将 `$BYSPACE_HOME` 下的核心配置文件（`config.json`、`projects.json`、`desktop.json`、`schedules.json`）打包备份至 `$BYSPACE_HOME/backups/byspace-backup-<timestamp>-<hash>.tar.gz`，仅当内容哈希发生变化时写入新备份，并自动修剪保留最近 10 份快照。

## 执行记录与验证

- **实现落点**：
  - `internal/cli/console_windows.go`
  - `internal/gui/webview2_windows.go`、`internal/gui/webview2_other.go`、`internal/gui/webkit_linux.go`、`internal/gui/webkit_other.go`
  - `internal/backup/backup.go`、`internal/backup/backup_test.go`
- **验证证据**：
  - `go test -v ./internal/backup/...`（`TestSnapshotDeduplicatesAndRestores`）通过；
  - `CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o /dev/null .` 验证 Windows 构建通过；
  - 本机 `/Applications/BySpace.app` 启动后已在 `~/.byspace/backups/` 自动生成首份去重备份快照。
