# Scope & Checklists — retire-wails-local-web

## 1. Go 后端与系统托盘（`internal/`）

- [x] `internal/webui/webui.go` & `webui_test.go`：
  - 移除 `/wails/runtime.js`、`--wails-draggable`、Windows 标题栏颜色采样脚本注入及 `WithExplicitConnectionHint`/`WithoutPrecompression`
  - 当且仅当直连回环请求（`RemoteAddr` 为 loopback、无转发头、`Host` 为 loopback）时注入 `localCredential` 到 `window.__BYSPACE_INITIAL_DAEMON_CONNECTION__.password`
  - 排除 `/_byspace` 及 `/_byspace/` 静态回退并导出 `IsDirectLoopbackRequest` / `IsLoopbackOrigin`
- [x] `internal/server/server.go` & `cli_credential_test.go`：
  - `server.New` 自动加载 `EnsureCLICredential(opts.HomeDir)` 并传给 `webui.WithLocalCredential`
  - 挂载 `/_byspace/desktop/settings`（直连回环 + 回环 `Origin` 校验）
  - 移除 `isWailsNativeOrigin`
- [x] `internal/gui/pwa.go` & `pwa_test.go`：
  - 实现 macOS / Windows / Linux 三端已安装 PWA 探测与启动（`OpenLocalWebApp`），未安装或携带一次性 `#offer=` 配对深链时回退系统默认浏览器打开 `http://127.0.0.1:<port>/...`
- [x] `internal/gui/tray_darwin.go`、`tray_windows.go`、`tray_other.go`：
  - macOS：基于 Cocoa `NSStatusBar` + `NSMenu` 实现菜单栏托盘（`NSApplicationActivationPolicyAccessory`，不占 Dock 图标）及 `byspace://` Apple Event URL 处理
  - Windows：基于 `golang.org/x/sys/windows`（`Shell_NotifyIconW` + Win32 菜单）实现零 CGO 纯 Go 系统托盘
  - Linux / 其他：无头驻留守护进程并在启动时打开 Local Web / PWA
- [x] `internal/gui/app.go`、`settings.go`、`backend.go`、`update.go`：
  - 移除 Wails `application.App`、`WebviewWindow`、`/_byspace/desktop/{open-url,notify,window}`
  - 清理 `DesktopSettings` 中的 `DockMode`、`HideFromDock`、`Lightweight`、`WindowWidth`、`WindowHeight`、`TitleBarColor`、`TitleBarDark`
  - 删除 `titlebar_*`、`titletint_*`、`lightweight_*`、`webkit_*`、`webview2_*`、`notify*`、`dock*`、`nogui.go`、`autostart_android.go`、`internal/cli/gui_android.go`
- [x] `internal/cli/main.go` & `internal/selfupdate/release.go`：
  - `byspace serve` 挂载 `gui.NewStandaloneSettingsHandler`
  - `byspace web` 复用 `gui.OpenLocalWebApp`
  - 移除 `APKAsset()` 与 Android 分支

## 2. Web 前端（`web/`）

- [x] `web/public/manifest.json`：加入 `launch_handler: { client_mode: ["navigate-existing", "auto"] }`
- [x] 删除 Wails 专属文件：
  - `web/src/platform/wails.ts`
  - `web/src/platform/desktop-window-events.ts`
  - `web/src/platform/external-links.ts` & `.test.ts`
  - `web/src/platform/ime-anchor.ts` & `.test.ts`
  - `web/src/app/desktop-window-titlebar.tsx` & `.test.tsx`
- [x] 更新调用方：
  - `web/src/main.tsx`、`web/src/app/app-chrome.tsx`、`web/src/app/sidebar-toggle.tsx`、`web/src/components/sidebar/sidebar-header-row.tsx`、`web/src/components/headers/screen-header.tsx`、`web/src/constants/layout.ts`
  - `web/src/platform/open-external-url.ts`、`web/src/push-notifications/os-notifications.ts`、`web/src/push-notifications/internal/web-subscription.ts`
  - `web/src/utils/test-daemon-connection.ts` & `.test.ts`、`web/src/utils/confirm-dialog.test.ts`
  - `web/src/screens/settings/daemon-service-section.tsx`
  - `web/src/screens/settings/desktop-app-section.tsx` & `desktop-app-section.test.tsx`（改为回环地址启用，移除 `Show in Dock` 与 `Lightweight mode`）

## 3. 构建、CI 与文档

- [x] 删除 `build/android/` 整个目录
- [x] `go.mod` / `go.sum`：`go mod tidy` 彻底移除 `github.com/wailsapp/wails/v3`
- [x] `Makefile`、`.github/workflows/release.yml`、`.github/ISSUE_TEMPLATE/bug-report.yml`：移除 `build-android` 及 Linux GTK/WebKitGTK 依赖
- [x] `scripts/dev-desktop.mjs`、`scripts/release-version-utils.mjs`：更新说明与标签正则
- [x] `AGENTS.md`、`docs/`、`bywork/memory/`：同步更新架构说明
