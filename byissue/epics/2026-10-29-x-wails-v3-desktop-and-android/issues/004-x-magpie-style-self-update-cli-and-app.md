---
kind: issue
title: "Magpie 式 CLI (byspace update) 与客户端自更新体系"
type: feature
created: 2026-10-29
---

# 004: Magpie 式 CLI (byspace update) 与客户端自更新体系

## 目标与范围

对照 `~/workspace/refs/magpie/internal/update`、`internal/cli/update_cli.go` 与 `internal/gui/update.go`，实现统一的二进制与客户端自更新机制：

1. **`internal/selfupdate` 升级**：
   - 支持查询最新 Release 与 `SHA256SUMS`（GitHub API + 302 Redirect 双通道，以及 `BYSPACE_UPDATE_FEED` / `BYSPACE_RELEASE_BASE_URL` 测试覆盖）；
   - 实现完整 Semver 比较（`Newer`、`Released`）、`--proxy` 与 `--mirror`（镜像下载仍强制校验原始 `SHA256SUMS` 哈希）；
   - 支持 macOS `BySpace.app` bundle 解压与原子替换（`Bundle()`、`StageApp`、`InstallApp`、`RelaunchApp`）以及跨平台单二进制 staging 与替换（Windows 下自动 `moveAside` 运行中的 `.exe` 为 `.old`，启动时清理旧 `.old`）。
2. **CLI `byspace update` 命令**：
   - `byspace update [check] [--proxy <url>] [--mirror <prefix>]`：检查或安装最新版本，若通过指向 `BySpace.app` 的软链运行则自动更新整个 `.app` bundle，若独立运行则原子替换自身二进制；
   - 保持对 `byspace agent update <id>` 的兼容。
3. **客户端自动更新（`internal/gui/update.go`）**：
   - 桌面端后台自动巡检最新 Release 并静默 stage 下载；就绪后在系统托盘菜单显示 `Restart to update to vX.Y.Z` 一键重启升级，且在应用退出时（`OnShutdown`）自动安装已 stage 的更新；
   - Android 端检测到新版 APK 时弹出更新提示并调用浏览器下载侧载安装。

## 执行记录与验证

- **实现落点**：
  - `internal/selfupdate/release.go`、`internal/selfupdate/replace.go`、`internal/selfupdate/release_test.go`
  - `internal/cli/update_cli.go`、`internal/cli/update_cli_test.go`、`internal/cli/main.go`、`internal/cli/gui_on.go`
  - `internal/gui/update.go`、`internal/gui/app.go`
- **验证证据**：
  - `go test -v ./internal/selfupdate/... ./internal/cli/... ./internal/gui/...` 全部通过（包含 Semver 比较、SHA-256 篡改拒绝、`BySpace.app` 识别、`byspace update check` 与 `byspace update`）。
