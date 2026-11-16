---
kind: issue
title: "智能防休眠 (internal/awake) 与跨平台开机自启 (internal/autostart)"
type: feature
created: 2026-10-29
---

# 001: 智能防休眠 (internal/awake) 与跨平台开机自启 (internal/autostart)

## 目标与范围

参照 `~/workspace/refs/magpie/internal/awake` 与 `internal/autostart`：

1. **`internal/awake`**：
   - 支持三档 `Level`：`off`、`system`（默认）、`display`；
   - 当本机 Daemon 存在活跃 Agent 工作（`Busy`）或距离最近一次工作结束未满 `Grace = 10 * time.Minute` 时持有系统防休眠锁，空闲超过宽限期或关闭开关时自动释放；
   - macOS 使用 `/usr/bin/caffeinate -i [-d] -w <pid>`；Windows 使用 `SetThreadExecutionState`；Linux 使用 `systemd-inhibit --what=idle:sleep`。
2. **`internal/autostart`**：
   - 支持在登录系统时以 `tray` 模式自动启动桌面客户端（Termux 下启动 `serve`）；
   - macOS 写入 `~/Library/LaunchAgents/com.bytetrue.byspace.plist`（含 `AssociatedBundleIdentifiers` 与 `AbandonProcessGroup = true`），启动时支持 `Refresh()` 自动更新旧路径；
   - Windows 读写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`；Linux 读写 `~/.config/autostart/byspace.desktop`；Android Termux 读写 `~/.termux/boot/byspace`。
3. **`Settings → General` 集成**：
   - 在 `DesktopAppSection` 中新增 **开机自启（Open at login）** 开关与 **防止休眠（Keep awake while agents work）** 档位选择（默认 `System`）。

## 执行记录与验证

- **实现落点**：
  - `internal/awake/awake.go`、`hold_darwin.go`、`hold_linux.go`、`hold_windows.go`、`hold_other.go`、`awake_test.go`
  - `internal/autostart/autostart.go`、`autostart_darwin.go`、`autostart_windows.go`、`autostart_other.go`、`autostart_android.go`、`autostart_test.go`
- **验证证据**：
  - `go test -v ./internal/awake/... ./internal/autostart/...` 全部通过（`TestWantAndKeepHoldLifecycle`、`TestAutostartSetAndDisable`）。
