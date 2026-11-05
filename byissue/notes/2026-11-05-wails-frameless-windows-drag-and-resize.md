# Wails v3 无边框 Windows 窗口的拖拽、resize 与命中层

> **读者：** 半年后搜到这条的人——先看结论，再看何时适用与细节。

---

**结论：** Wails 判定「这一笔能不能拖窗」只看 **mousedown 直接命中的那一个元素**的计算样式 `--wails-draggable`，不向上找祖先；该变量靠 `[data-wails-drag="true"]` 声明，CSS 自定义属性会继承，但**每个会被直接点到的容器都要自己带这个属性**。另外这个属性名必须写 DOM 字面量：React 会把展开的 `{wailsDrag:"true"}` 渲染成 `wailsdrag="true"`，静默失效。

**何时用：** 改桌面壳层（`web/src/app/desktop-window-titlebar.tsx`、`web/src/core/components/headers/screen-header.tsx`、`internal/webui/webui.go` 注入的 CSS、`internal/gui/titletint_windows.go`）时。

**细节：**

- 判定式：`style.getPropertyValue("--wails-draggable") === "drag"` 且 `offsetX/offsetY` 落在该元素 padding box 内（`internal/runtime/desktop/@wailsio/runtime/src/drag.ts` 的 `isDraggableEvent`，Wails v3.0.0）。
- 边缘 resize 由 `window._wails.setResizable(true)` 打开（默认页内边缘带 5px、角 10px）。历史上 `internal/gui` 用 `frameOnlyResizeJS` 把它整个关掉（旧「假顶栏」时代防止页面上沿变成竖向 resize 把手）；真顶栏回来后必须开回 `inPageResizeJS`，否则四边不能拉伸。
- 同理，`webui.go` 里曾注入「全页面顶部 38px 的 mousedown 一律 preventDefault + 强设 drag」的兜底脚本。它会吃掉顶部文字的选中手势，且和真顶栏重复——已删。别再往回加。
- 层叠不是原因（2026-11-05 误判过一次：以为 `SidebarInset` 的透明 margin 吞掉顶栏右段，加 `relative z-10` 后症状不变，已回退）。真原因是属性名：`{...{wailsDrag:"true"}}` 渲染成 `wailsdrag="true"`，匹配不上 `[data-wails-drag="true"]`。**全仓统一写字面量 `data-wails-drag="true"`**，不要用 RN 时代残留的 `WAILS_DRAG_DATA_SET`（已删）。
- **验证方法**：cua-driver 的合成拖拽（`drag` + `delivery_mode:"foreground"`）不能用来验窗口移动/resize——连已知可用的区域也拖不动，偶尔一次生效不可复现。窗口按钮的点击可以用 UIA Invoke 验（最小化/最大化/还原都可靠）。壳层拖拽只能真人手测。

**相关：** `byissue/issues/2026-11-04-x-windows-l-shell-titlebar.md`（壳层恢复与跨平台验证）、`byissue/issues/2026-10-30-x-ff-agcopilot-framed-card-window-shell.md`（壳层形态的原始拍板）、`byissue/notes/2026-11-04-windows-url-pathname-is-not-a-disk-path.md`（同批 Windows 侧坑）。
