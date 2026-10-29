---
kind: issue
title: "Windows 标题栏同色浸染 (titletint_windows) 与桌面设置页标准 DropdownMenu/Button 组件修正"
type: ff
status: closed
created: 2026-10-29
closed: 2026-10-29
---

# Windows 标题栏同色浸染 (titletint_windows) 与桌面设置页标准 DropdownMenu/Button 组件修正

- **做了什么**：
  1. **Windows 标题栏同色浸染（对齐 Magpie `titletint_windows.go`）**：新增 `internal/gui/titletint_windows.go` 与 `titletint_other.go`，在窗口首帧通过 `initialWindowsChrome` 配置 `CustomTheme` 的 `TitleBarColour`，并在页面加载与主题切换时采样表面背景色调用 `w32.SetTheme(hwnd, dark)` 与 `w32.SetTitleBarColour(hwnd, ...)`，消除 Windows 11 默认冷灰蓝标题栏与页面背景的色差割裂；同时注入 `frameOnlyResizeJS` 关闭 Wails 在有边框窗口顶部边缘误加的页面内缩放热区。
  2. **设置页标准组件替换**：在 `packages/app/src/screens/settings/desktop-app-section.tsx` 中，将「防止休眠（Keep awake while agents work）」从裸文本点击替换为与上方设置行完全一致的 `<DropdownMenu>` + `<DropdownTrigger>` + `<DropdownMenuContent>` + `<DropdownMenuItem>`；将「立即备份（Back up now）」与「接管（Take over）」替换为项目标准的 `<Button variant="secondary" size="sm">` 组件。
- **改了哪些**：
  - `internal/gui/titletint_windows.go`、`internal/gui/titletint_other.go`、`internal/gui/settings.go`、`internal/gui/app.go`
  - `internal/webui/webui.go`
  - `packages/app/src/screens/settings/desktop-app-section.tsx`
- **怎么验证的**：
  - `go test ./internal/gui/... ./internal/webui/...` 与 `CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build` 编译通过；
  - `npm run lint`、`npm run typecheck`、`npm run format:check` 全绿。
- **对 `byissue/` 的影响**：已补充记录至 [`byissue/notes/019-wails-v3-in-process-assets-and-android-mixed-content.md`](../notes/019-wails-v3-in-process-assets-and-android-mixed-content.md) 第 5 节。
