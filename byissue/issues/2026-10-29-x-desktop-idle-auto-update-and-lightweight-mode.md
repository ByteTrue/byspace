---
kind: issue
title: "桌面客户端对齐 Magpie：自动下载/空闲自动安装更新与轻量模式（Lightweight Mode）"
type: feature
created: 2026-10-29
---

# 桌面客户端对齐 Magpie：自动下载/空闲自动安装更新与轻量模式（Lightweight Mode）

状态：**已交付关闭**（2026-10-29，已毕业合并至 [spec/index.md](../spec/index.md) 与 [notes/019](../notes/019-wails-v3-in-process-assets-and-android-mixed-content.md)）

> **参考实现：** `~/workspace/refs/magpie/internal/gui/update.go` · `update_wait.go` · `lightweight.go` · `lightweight_rule.go` · `lightweight_darwin.go`

## 背景与目标

在 Wails v3 桌面客户端基座之上，对齐 Magpie 的两项桌面长驻能力：

1. **可控的自动下载与空闲自动安装更新（Auto-download & Idle Auto-install）**：
   - 在 `Settings → General`（桌面客户端专属 `Desktop App` 卡片）中提供独立开关：
     - **自动检查更新（Automatic updates）**：默认开启（`noAutoUpdate: false`）
     - **自动下载更新（Download updates automatically）**：默认开启（`noAutoDownload: false`）；关闭时发现新版本仅在系统托盘提示 `Download update vX.Y.Z`，点击后才下载
     - **空闲时自动安装更新（Restart automatically when idle）**：默认关闭（`autoRestart: false`，在设置里开启）；开启后，当新版本已下载就绪，且同时满足**无正在运行的 Agent（无 `running` turn、无未决权限请求）、距离上次 Agent 活动已静置满 10 秒（`IdleSettle`）、且主窗口未在前台聚焦操作中**时，自动完成替换并重启（若重启前窗口已关闭隐藏在托盘，新版启动后继续静默驻留托盘）。
2. **轻量模式（Lightweight Mode）**：
   - 在 `Settings → General` 中提供 **轻量模式（Lightweight mode）** 开关（默认关闭 `lightweight: false`，在设置里开启）；
   - 开启后，当主窗口关闭退驻系统托盘持续满 2 个 30 秒周期（30–60 秒）时，在主线程调用 `dropWebView`（macOS 卸载 `WKWebView` 终止 `com.apple.WebKit.WebContent` 子进程）并销毁隐藏窗口（`mainWin = nil`），将常驻内存降至纯 Go 守护态；
   - 下次通过点击托盘图标、托盘菜单 `Open BySpace`、macOS Dock 图标、二次启动或 `byspace://` 深链打开时，按需重建 `WebviewWindow` 并恢复上次保存的窗口尺寸。

## 执行记录与验证

- **实现落点**：
  - `internal/gui/settings.go`：`DesktopSettings`（持久化于 `$BYSPACE_HOME/desktop.json`）、`LightStep` 与 `IdleAt` 纯函数。
  - `internal/gui/lightweight_darwin.go` & `internal/gui/lightweight_other.go`：macOS `dropWebView` 与 `isWindowFocusedOnMain`。
  - `internal/gui/update.go` & `internal/gui/app.go`：支持 `NoAutoDownload`（`OnFound` 托盘手动下载）与 `AutoRestart`（5 秒周期 `AutoTick` 空闲检测自动重启），以及 `/_byspace/desktop/settings` 进程内设置读写接口与 30 秒周期轻量模式释放/重建循环。
  - `internal/server/workspace_status.go` & `internal/server/lock_hygiene_test.go`：新增 `HasActiveAgentWork()` 并登记进 `selfLockingMethods`。
  - `packages/app/src/screens/settings/desktop-app-section.tsx` & `packages/app/src/screens/settings-screen.tsx`：在 `Settings → General` 渲染桌面端专属设置卡片。
- **验证证据**：
  - `go test -v ./internal/gui/...`：`TestLightStepMatchesMagpieRule`、`TestIdleAtRequiresNoActiveAgentsUnfocusedWindowAndSettleElapsed`、`TestDesktopSettingsDefaultsAndPersistence`、`TestDaemonSupervisorAttachesAndTakesOverOnExit` 全部通过；
  - `go test -v ./internal/server -run TestNoReentrantServerLocks` 通过；
  - `npm run typecheck`、`npm run lint`、`npm run format:check` 全绿；
  - 已重新构建 `make build-web && make app VERSION=0.22.0` 替换并重启本机 `/Applications/BySpace.app`。
