---
kind: issue
title: "修复 Windows 轻量模式释放窗口后点击托盘无反应与 winMu/InvokeSync 交叉死锁"
type: ff
status: closed
created: 2026-10-30
closed: 2026-10-30
---

# 修复 Windows 轻量模式释放窗口后点击托盘无反应与 winMu/InvokeSync 交叉死锁

- **做了什么**：
  - **SSH 现场日志与根因定位**：
    查看 `10.1.115.59` 的 `daemon.log` 发现：
    ```text
    18:01:38 byspace lightweight: released hidden main window WebView
    18:37:49 [WebView2] Environment created successfully
    ```
    定位到两处连环问题：
    1. **Windows 下重建窗口被强制 `startHidden = true` 且跳过了 `mainWin.Show().Focus()`**：在 `tray.OnClick` 与 `showMainWindow` 中此前写了 `if runtime.GOOS != "windows" { mainWin.Show().Focus() }`，指望 `NewWithOptions` 之后注册的 `OnWindowEvent(WebViewNavigationCompleted)` 去调 `Show()`；但在运行期调用 `NewWithOptions` 时，Wails v3 会在 `NewWithOptions` 内部同步执行 `w.Run()`，且由于未调用 `w.Show()`（`showRequested == false`），重建出来的窗口永远停留在隐藏状态。
    2. **`tray.OnClick` 在主线程持 `winMu` 调 `InvokeSync` 的 AB-BA 死锁隐患**：Windows 的 `tray.OnClick` 在 `wndProc` 主线程同步触发，而轻量模式后台协程持 `winMu.Lock()` 调 `InvokeSync` 等待主线程，违反了 Magpie `lightweight.go` 的不变量（`mainWin` 仅在主线程读写，绝不在主线程持锁）。
  - **修复**：
    1. 移除跨线程 `winMu`，所有 `mainWin` 读写统一通过 `application.InvokeAsync` / `InvokeSync` 在主线程串行执行；
    2. 在 `makeMainWindow` 中直接按 `Hidden: hidden` 传给 Wails v3（Wails v3 `windowsWebviewWindow.show()` 已内置 `webviewNavigationCompleted` 与 3s 兜底），并在 `showMainWindow` / `tray.OnClick` 重建窗口后统一调用 `mainWin.Show().Focus()`。
- **改了哪些**：
  - `internal/gui/app.go`
- **怎么验证的**：
  - `go test ./internal/gui/...` 与 `CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build` 全绿。
- **对 `byissue/` 的影响**：已同步补充至 [`byissue/notes/019-wails-v3-in-process-assets-and-android-mixed-content.md`](../notes/019-wails-v3-in-process-assets-and-android-mixed-content.md)。
