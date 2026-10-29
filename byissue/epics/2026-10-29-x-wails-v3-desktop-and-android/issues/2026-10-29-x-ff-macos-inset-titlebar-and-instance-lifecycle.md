---
kind: issue
title: "桌面客户端收口：macOS 隐藏标题栏交通灯内嵌、本地免密直连、Dock 图标网格与单实例生命周期"
type: ff
status: closed
created: 2026-10-29
closed: 2026-10-29
---

# 桌面客户端收口：macOS 隐藏标题栏交通灯内嵌、本地免密直连、Dock 图标网格与单实例生命周期

- **做了什么**：
  1. **本机密码开启时客户端免密自动直连**：桌面端启动时读取 `server.EnsureCLICredential(homeDir)` 并随 `window.__BYSPACE_INITIAL_DAEMON_CONNECTION__` 注入 `password` 令牌，解决 `config.json` 配置了访问密码时客户端窗口首次连接 `127.0.0.1:6777` 报 401 退回 `Welcome to BySpace` 的问题；服务端 CORS 默认放行 `wails://localhost` 原生容器 Origin。
  2. **macOS `MacTitleBarHiddenInset` 交通灯内嵌与顶栏拖拽**：移植 Magpie 的 `BySpaceLights`（`internal/gui/titlebar_darwin.go`），隐藏独立系统标题栏，将左上角红黄绿按钮垂直居中内嵌在侧栏顶行（`0..72px`），在 `left-sidebar.tsx`、`sidebar-header-row.tsx`、`menu-header.tsx` 增加 `useMacTrafficLightInset()` 避让；在 `internal/webui/webui.go` 引入 `/wails/runtime.js` 并在顶栏 `0..38px` 捕获 `mousedown` 设置 `--wails-draggable: drag`、`-webkit-user-select: none` 与 `e.preventDefault()`，解决无法拖拽及拖拽时触发 WebKit 文本选择变成 I 型光标的问题。
  3. **macOS Dock 图标网格比例**：在 `scripts/generate-icons.mjs` 中按 Apple macOS Big Sur+ HIG 规范（1024×1024 画布内居中 824×824 主体、四周 100px 透明边距）生成 `internal/gui/icon.png`，解决 Dock 图标比系统标准图标大 24% 的问题。
  4. **单实例唤醒与 CLI/客户端共生边界**：新增 `internal/gui/instance_unix.go`（`~/.byspace/gui.lock` `flock` 排他锁，二次启动自动唤醒已有 `BySpace.app` 窗口）与 Wails `SingleInstanceOptions`；为 `DaemonSupervisor` 补齐 30 秒周期 `daemon.TouchPIDLock` 心跳；`byspace serve` 在 `bind` 端口前先检查 `byspace.pid` 报告运行中 PID。
- **改了哪些**：
  - `internal/gui/titlebar_darwin.go`、`internal/gui/titlebar_other.go`、`internal/gui/instance_unix.go`、`internal/gui/instance_windows.go`、`internal/gui/app.go`、`internal/gui/backend.go`
  - `internal/webui/webui.go`、`internal/server/server.go`、`internal/cli/main.go`
  - `packages/app/src/constants/layout.ts`、`packages/app/src/runtime/host-runtime.ts`、`packages/app/src/components/left-sidebar.tsx`、`packages/app/src/components/sidebar/sidebar-header-row.tsx`、`packages/app/src/components/headers/menu-header.tsx`、`packages/app/src/components/headers/screen-header.tsx`
  - `scripts/generate-icons.mjs`、`install.ps1`
- **怎么验证的**：
  - `go test -v ./internal/gui/... ./internal/webui/... ./internal/cli/...` 全绿，`npm run typecheck`、`npm run lint`、`npm run format:check` 全绿；
  - 在本机 `/Applications/BySpace.app` 实测：Dock 图标尺寸与相邻应用一致，启动直接免密连上本机 `127.0.0.1:6777`（`lsof -iTCP:6777` 确认 `ESTABLISHED`），红黄绿内嵌在侧栏顶行，顶部空白处拖拽顺畅且光标保持标准箭头。
- **对 `byissue/` 的影响**：已同步沉淀至 [`byissue/notes/019-wails-v3-in-process-assets-and-android-mixed-content.md`](../../../notes/019-wails-v3-in-process-assets-and-android-mixed-content.md) 第 3 节与本 Epic [`spec.md`](../spec.md)。
