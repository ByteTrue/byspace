---
kind: epic
title: "吸收 Magpie 八项桌面与系统级工程精华"
type: feature
created: 2026-10-29
---

# 吸收 Magpie 八项桌面与系统级工程精华

状态：**已交付关闭**（2026-10-29，已毕业合并至 [spec/index.md](../../spec/index.md) 与 [notes/019](../../notes/019-wails-v3-in-process-assets-and-android-mixed-content.md)）

> **读者：** 维护 BySpace 桌面客户端、跨平台系统集成与守护进程韧性的人。
>
> **依据：** [Talk 010](../../talks/010-magpie-deep-dive-absorption.md) · 参考实现 `~/workspace/refs/magpie` (`v0.1.2030`)

## 目标与架构全景

将 Magpie 在 macOS / Windows / Linux / Android Termux 上千锤百炼的 8 项系统级能力完整移植并适配到 BySpace：

1. **智能防休眠（`internal/awake`）**：在 Agent 运行期间及结束后 10 分钟宽限期内阻止系统休眠（默认 `system`，可选 `off` / `system` / `display`）。
2. **跨平台开机自启（`internal/autostart`）**：支持 macOS `LaunchAgents`（含 `AssociatedBundleIdentifiers` 与 `AbandonProcessGroup`）、Windows 注册表 `Run`、Linux XDG `autostart` 与 Android Termux `~/.termux/boot`。
3. **macOS Dock 显隐控制与菜单栏 Template 图标（`internal/gui`）**：支持在设置中控制 `Show in Dock`（切换 `Regular` / `Accessory` 并修复 `Cmd+Tab` 激活顺序），菜单栏使用 `setTemplate:YES` 透明单色矢量图标。
4. **旧版/外部 Daemon 一键接管与端口占用诊断（`internal/proc` + `internal/gui`）**：当桌面客户端附着在外部/旧版 daemon 上时支持一键停止旧进程并由当前客户端在进程内接管；当端口被非 `byspace` 进程或容器占用时精确诊断 PID、可执行路径与原因。
5. **跨平台健壮性与配置自动滚动备份（`internal/backup` + Windows/Linux 适配）**：Windows `byspace.com` 终端伴侣与 WebView2 缺失弹窗引导、Linux Wayland/无 GPU 环境自动设置 `WEBKIT_DISABLE_COMPOSITING_MODE=1`、以及 `$BYSPACE_HOME/backups/` 核心配置文件自动滚动备份。

## 纵向切片（Issues）

1. [001-x-keep-awake-and-open-at-login.md](issues/001-x-keep-awake-and-open-at-login.md) — 智能防休眠（`internal/awake`）与跨平台开机自启（`internal/autostart`）
2. [002-x-macos-dock-policy-and-template-tray-icon.md](issues/002-x-macos-dock-policy-and-template-tray-icon.md) — macOS Dock 显隐控制（`Show in Dock`）与菜单栏 Template 透明单色图标
3. [003-x-daemon-takeover-and-port-diagnostics.md](issues/003-x-daemon-takeover-and-port-diagnostics.md) — 外部/旧版 Daemon 一键接管与端口占用精确诊断（`internal/proc`）
4. [004-x-cross-platform-hardening-and-config-backup.md](issues/004-x-cross-platform-hardening-and-config-backup.md) — Windows `.com` 伴侣与 WebView2 检测、Linux Wayland/无 GPU 渲染保护及核心配置自动滚动备份（`internal/backup`）
