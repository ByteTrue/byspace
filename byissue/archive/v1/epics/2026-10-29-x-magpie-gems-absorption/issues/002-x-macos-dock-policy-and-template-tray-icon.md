---
kind: issue
title: "macOS Dock 显隐控制 (Show in Dock) 与菜单栏 Template 透明单色图标"
type: feature
created: 2026-10-29
---

# 002: macOS Dock 显隐控制 (Show in Dock) 与菜单栏 Template 透明单色图标

## 目标与范围

参照 `~/workspace/refs/magpie/internal/gui/dock.go`、`dockflap_darwin.go` 与 `trayimage_darwin.go`：

1. **macOS Dock 显隐控制（`Show in Dock`）**：
   - 在 `DesktopSettings` 增加 `HideFromDock bool`（默认 `false` 即默认显示在 Dock；在 `Settings → General` 提供 **在 Dock 中显示 / Show in Dock** 开关）；
   - 当用户关闭 `Show in Dock` 时：主窗口打开期间临时显示在 Dock（或保持菜单栏应用态），主窗口关闭隐藏到托盘时自动切换为 `NSApplicationActivationPolicyAccessory` 从 Dock 收起；重新打开主窗口时切回 `Regular` 并通过 `activateAgain` 确保 `Cmd+Tab` 焦点位于首位。
2. **macOS 菜单栏 Template 透明单色图标**：
   - 在 `scripts/generate-icons.mjs` 中生成透明背景、纯黑色前景轮廓的 `internal/gui/tray-template.png`（44×44 @2x）；
   - 在 macOS 上使用 `tray.SetTemplateIcon(trayTemplateIcon)`，使菜单栏图标随浅色/深色壁纸及菜单栏高亮态自动切换黑白。

## 执行记录与验证

- **实现落点**：
  - `internal/gui/dock.go`、`internal/gui/dock_darwin.go`、`internal/gui/dock_other.go`
  - `scripts/generate-icons.mjs`、`internal/gui/tray-template.png`、`internal/gui/app.go`
- **验证证据**：
  - `go test -v ./internal/gui/... -run TestDockStepAndShouldShowInDock` 通过；本机 `/Applications/BySpace.app` 实测菜单栏 Template 透明单色图标与 Dock 显隐切换生效。
