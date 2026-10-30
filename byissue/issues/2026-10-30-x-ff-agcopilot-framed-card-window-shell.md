---
kind: issue
title: "借鉴 AGCopilot 实现桌面端内嵌圆角大卡片容器布局 (macOS 左包右 + Windows L 型半包)"
type: ff
status: closed
created: 2026-10-30
closed: 2026-10-30
---

# 借鉴 AGCopilot 实现桌面端内嵌圆角大卡片容器布局 (macOS 左包右 + Windows L 型半包)

- **做了什么**：
  参照 `/Users/zijie/workspace/projects/work/AGCopilot/src/renderer/src/config/windowShell.ts` 与 `TabContainer.tsx`：
  1. **连续底座与无分割线侧边栏**：外层 `surfaceFill` 与 `LeftSidebar` 统一采用 `theme.colors.surfaceSidebar` 底座色，去除 `LeftSidebar` 的右侧硬分割线与顶/底横线。
  2. **内嵌 12px 圆角大卡片容器（`framedCard`）**：在非 Compact 桌面布局下，右侧主内容区包裹在 `borderRadius: 12`、`borderWidth: 1`、`backgroundColor: theme.colors.background`、`overflow: "hidden"` 的圆角大卡片容器内，四周留出 `6px` 外边距。
  3. **macOS「左包右」与 Windows「飞书式 L 型半包」双姿态适配**：
     - **macOS**：红黄绿交通灯位于左侧底座顶栏，右侧大卡片在 `top/right/bottom` 各留 `6px` 边距（侧栏收起时 `left` 也留 `6px`）；
     - **Windows**：窗口启用 `Frameless: true`，在右侧主列顶部渲染与侧栏同色的 `36px` `DesktopWindowTitleBar`（含拖拽区、侧栏收起时的导航入口与右侧 `— □ ×` 窗口控制按钮），大卡片紧贴在该 L 型顶栏正下方展开，彻底让开右上角窗口控制区。
- **改了哪些**：
  - `internal/gui/app.go`
  - `packages/app/src/components/desktop-window-titlebar.tsx`
  - `packages/app/src/app/_layout.tsx`、`packages/app/src/components/left-sidebar.tsx`、`packages/app/src/components/headers/menu-header.tsx`
- **怎么验证的**：
  - `go test ./internal/gui/...` 通过；
  - `npm run lint`、`npm run typecheck`、`npm run format:check` 全绿。
- **对 `byissue/` 的影响**：已沉淀记录。
