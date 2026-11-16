---
kind: issue
title: "吸收最新 Magpie (v0.1.2030) 自更新加固：Setsid 独立进程组、open -n 重试与锁屏 exec 兜底及 .app 自动链接 CLI"
type: ff
status: closed
created: 2026-10-29
closed: 2026-10-29
---

# 吸收最新 Magpie (v0.1.2030) 自更新加固：Setsid 独立进程组、open -n 重试与锁屏 exec 兜底及 .app 自动链接 CLI

- **做了什么**：
  1. **`RelaunchApp` 独立进程组（`Setsid: true`）**：macOS 从 Dock/Finder 启动的 `.app` 退出时，`launchd` 会终止同一进程组内的所有子进程；为重启 shell 设置 `SysProcAttr{Setsid: true}` 使其脱离原进程组，避免旧进程退出时把重启脚本一并杀死。
  2. **`open -n` 重试 + 锁屏 `exec` 兜底 + `~/.byspace/relaunch.log`**：使用 `open -n` 避免 `LaunchServices` 向刚退出的旧进程发送 reopen 事件报 `-600 procNotFound`；按 `0.5..4s` 退避重试，若用户处于锁屏状态导致 `LaunchServices` 持续拒绝 `open`，自动兜底直接 `exec` 启动 `BySpace.app/Contents/MacOS/byspace`，并将过程写入 `~/.byspace/relaunch.log`。
  3. **`.app` 启动自动软链 `~/.local/bin/byspace`**：当用户从 `.dmg` 拖拽安装并打开 `BySpace.app` 时，若 `~/.local/bin/byspace` 不存在或已是软链，自动将其指向 `BySpace.app/Contents/MacOS/byspace`（同时在 `/_byspace/desktop/settings` 支持 `linkCLI: true` 强制覆盖独立旧拷贝）。
- **改了哪些**：
  - `internal/selfupdate/detach_unix.go`、`internal/selfupdate/detach_windows.go`、`internal/selfupdate/release.go`、`internal/selfupdate/release_test.go`
  - `internal/gui/app.go`
- **怎么验证的**：
  - `go test -v ./internal/selfupdate/... ./internal/gui/...` 全部通过（含新增的 `TestBuildRelaunchScriptUsesOpenMinusNRetriesAndExecFallback` 与 `TestEnsureBundleCLISymlinkLinksAndRespectsStandaloneCopyUnlessForced`）。
- **对 `byissue/` 的影响**：已同步沉淀至 [`byissue/notes/019-wails-v3-in-process-assets-and-android-mixed-content.md`](../notes/019-wails-v3-in-process-assets-and-android-mixed-content.md) 第 4 节。
