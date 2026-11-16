---
kind: issue
title: "设置页分区与控件对齐 Magpie：更新/目录/CLI 归口至 About，General 采用 SegmentedControl"
type: ff
status: closed
created: 2026-10-30
closed: 2026-10-30
---

# 设置页分区与控件对齐 Magpie：更新/目录/CLI 归口至 About，General 采用 SegmentedControl

- **做了什么**：
  1. **`Settings → General` 精简并采用横向 `SegmentedControl`（对齐 Magpie `General`）**：
     - 直接嵌入 `General` 卡片底部，仅保留 4 项桌面日常行为设置：`Open at login`、`Show in Dock`（`Hide | With window | Show` 三档 `SegmentedControl`）、`Lightweight mode`、`Prevent sleep`（`Off | On | Screen on too` 三档 `SegmentedControl`），文案与 Magpie 对齐。
  2. **`Settings → About` 统一承载版本、更新策略、检查频率与系统入口（对齐 Magpie `About`）**：
     - 将 `Version`（含检查/下载进度/重启更新，合并掉原先重复的静态 `App version` 行）、`Automatic updates`、`Check every`（`30 min | 1 h | 6 h | 24 h` 四档 `SegmentedControl`，默认 `30 min`）、`Download updates automatically`、`Restart automatically`、`Config folder`、`Command line`（所有 Shell 已就绪时显示 `runs this app` 并隐藏多余的 `Refresh PATH` 按钮）、`Daemon URL` 统一归口到 `Settings → About` 卡片内。
- **改了哪些**：
  - `internal/gui/settings.go`、`internal/gui/dock.go`、`internal/gui/update.go`、`internal/gui/app.go`
  - `packages/app/src/screens/settings/desktop-app-section.tsx`、`packages/app/src/screens/settings-screen.tsx`
- **怎么验证的**：
  - `go test ./internal/gui/...` 通过；
  - `npm run lint`、`npm run typecheck`、`npm run format:check` 全绿。
- **对 `byissue/` 的影响**：无架构边界变更。
