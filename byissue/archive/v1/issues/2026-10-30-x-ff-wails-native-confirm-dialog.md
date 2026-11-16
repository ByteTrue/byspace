---
kind: issue
title: "修复桌面客户端点击 Uninstall 等需确认按钮无反应：Wails 容器接入原生 Dialog.Question 确认框"
type: ff
status: closed
created: 2026-10-30
closed: 2026-10-30
---

# 修复桌面客户端点击 Uninstall 等需确认按钮无反应：Wails 容器接入原生 Dialog.Question 确认框

- **做了什么**：
  - **根因定位**：`Orchestration skills` 的 `Uninstall`（及全仓 22 处删除/卸载/归档操作）均调用 `packages/app/src/utils/confirm-dialog.ts` 的 `confirmDialog()`，而该函数此前直接调用 `window.confirm()`；在 macOS Wails `WKWebView` 中，`window.confirm()` 不弹出任何对话框而是直接静默返回 `false`，导致点击 `Uninstall` 后毫无反应。
  - **修复**：
    1. 在 `internal/gui/app.go` 新增 `POST /_byspace/desktop/confirm`，调用 Wails v3 原生 `app.Dialog.Question().AttachToWindow(mainWin)` 弹出系统原生确认框（macOS `NSAlert` sheet / Windows 原生确认框）并返回用户点击结果；
    2. 在 `packages/app/src/utils/confirm-dialog.ts` 中识别 Wails 容器并调用 `/_byspace/desktop/confirm`（普通浏览器仍走 `window.confirm`）。
- **改了哪些**：
  - `internal/gui/app.go`
  - `packages/app/src/utils/confirm-dialog.ts`、`packages/app/src/utils/confirm-dialog.test.ts`
- **怎么验证的**：
  - `npx vitest run packages/app/src/utils/confirm-dialog.test.ts --bail=1` 3/3 通过；
  - `go test ./internal/gui/...`、`npm run lint`、`npm run typecheck` 全绿。
- **对 `byissue/` 的影响**：已同步补充至 [`byissue/notes/019-wails-v3-in-process-assets-and-android-mixed-content.md`](../notes/019-wails-v3-in-process-assets-and-android-mixed-content.md)。
