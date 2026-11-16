---
kind: issue
title: "Windows 桌面壳层恢复：L 型半包、顶部栏窗口按钮、拖拽只限顶栏"
type: bug
created: 2026-11-04
---

# Windows 桌面壳层恢复：L 型半包、顶部栏窗口按钮、拖拽只限顶栏

## 预期 / 实际

- **预期**（`byissue/issues/2026-10-30-x-ff-agcopilot-framed-card-window-shell.md` 拍板的形态）：Windows 无边框窗口，右侧主列顶部有 36px 与侧栏同色的标题栏（拖拽区 + 侧栏收起时的导航入口 + 右侧 `— □ ×`），圆角大卡片紧贴其下，形成「飞书式 L 型半包」；mac 保持左包右、原生红绿灯。拖拽只能在顶部栏区域（mac：红绿灯一行）。
- **实际**（2026-11-04 Windows 本机）：Windows 和 mac 一样左包右，三个窗口按钮完全消失；整个页面任何地方按住都能拖动窗口。`internal/gui/app.go:401` 仍是 `Frameless: runtime.GOOS == "windows"`，等于一个没有任何 chrome 的无边框窗。

## 根因

前端重写删 Expo app 时把 `packages/app/src/components/desktop-window-titlebar.tsx` 随之删除，`web/` 没有移植（`web/src` 无对应物；mac 的 framed 卡片在 `web/src/app/app-chrome.tsx:176` 有，Windows 分支没有）。同一批清理还删掉了 Go 侧 `/_byspace/desktop/settings` 对 `windowAction` 的处理（`internal/gui/app.go` 现在的 patch struct 不认识该字段），所以即使前端有按钮也发不出最小化/最大化/关闭。现状靠 `internal/webui/webui.go:295` 注入的两段脚本兜底：38px 内 mousedown 设 `--wails-draggable` 的拖拽启发式（拖拽全页面失效的疑点之一），和标题栏颜色同步的 tint 脚本。

## 要做什么

1. 按旧实现移植 titlebar 组件到 `web/`（React DOM 版）：`git show archive/expo-app:packages/app/src/components/desktop-window-titlebar.tsx`，含 `isWailsDesktopShell` / `isWindowsWailsDesktop` 探测、`— □ ×` 按钮、36px 条与侧栏同色。
2. 恢复 `internal/gui/app.go` 对 `windowAction`（minimize/maximize/close）的处理，对接 Wails 窗口 API。
3. Windows 布局接回 L 型：顶部条 + 卡片紧贴其下，卡片区让开右上角窗口控制位；mac 分支不动。
4. 拖拽范围收窄：只有顶部栏可拖（Wails 的 `--wails-draggable` 语义），页面其余区域不可拖；用 webui.go 注入的拖拽脚本应随之删除或收窄，别留两层机制。
5. tint 同步脚本（titleBarColor）确认在新结构下仍工作或一并清理。

## 影响面

- **必须改**：`web/`（新组件 + app-chrome 的 Windows 分支）、`internal/gui/app.go`、`internal/webui/webui.go`。
- **需要验**：mac 桌面端不回归（原生红绿灯、左包右）；Android 不受影响（`isWailsDesktopShell` 的 UA 探测）；protocol 不动（`windowAction` 是 GUI HTTP 端点，不走 WebSocket 协议）。
- **仍未知**：全页面可拖的确切根因（注入脚本 vs Wails v3 无边框默认行为），实现时先复现确认。

## 剩余

无。2026-11-05 用户已在 macOS 桌面 dev 实测原生红绿灯、布局、拖窗与文字选择无回归。

## 关闭结论

Windows 无边框壳层已恢复 L 型布局、独立标题栏、窗口控制和边缘 resize。窗口控制走独立 `/_byspace/desktop/window` 端点，不依赖设置写盘；最大化图标由原生状态查询与事件同步。多轮 review 的标题栏双击、IME blur 提交与焦点恢复问题已补回归测试。

验证：Windows 真机确认壳层、resize、tint 和 IME；macOS 真机确认无回归；定向前端测试、typecheck/lint/format、Go 测试和字段审计通过。原生 IME 的边界见 `byissue/notes/2026-11-05-webview2-ime-anchor-after-resize.md`，不凭 DOM 单测替代真机验证。

## 验证

Windows 本机构建桌面端：按钮三态可用、拖拽只在顶部条、卡片 L 型、深浅色下标题栏颜色正确；mac 端过一眼不回归。e2e 覆盖不了无边框 chrome，手工验收为主；Go 侧改动跑 `go test ./internal/gui/...`。

## 执行记录

- 2026-11-04：titlebar 移植（`web/src/app/desktop-window-titlebar.tsx`）+ `windowAction` 恢复（`internal/gui/app.go`）+ L 型接入（`WindowsShellFrame`/`WindowsShellMain`，app-chrome）。验证：cua 实测最大化/还原/最小化生效；用户手测拖拽范围正常。
- 2026-11-05：用户反馈两问题——四边不能 resize、顶部 38px 文字选中被拖窗手势吃掉。根因都在旧「假顶栏」时代的补丁：`frameOnlyResizeJS` 把 Wails 页内边缘 resize 整个关了（改为 `inPageResizeJS` 开回 `setResizable(true)`）；`webui.go` 注入的全页顶部 38px mousedown 劫持（preventDefault + 强设 drag）删除，拖窗归顶栏组件所有。
- 2026-11-05：顶栏条仍不可拖。两次误判先排除：给 `controlsArea` 补 `data-wails-drag` 无效；给 `ScreenHeader` 左右子组补字面量后头部行确实能拖了（证明「只看命中元素」的机制判断是对的），但顶栏条照旧不可拖；再猜「inset 透置 margin 吞事件」加 `relative z-10`，症状不变，已回退。
- 2026-11-05 真根因：`WAILS_DRAG_DATA_SET = { wailsDrag: "true" }` 在 React DOM 里渲染成属性 `wailsdrag="true"`，而注入 CSS 的选择器是 `[data-wails-drag="true"]`，从不匹配。该常量是 RN `dataSet`（会映射成 `data-*`）的残留，全仓只有顶栏在用；其他可拖区域（`screen-header.tsx`、`sidebar-header-row.tsx`）都写字面量——这就是「头部行能拖、顶栏条永远不能拖」的全部原因。顶栏三处改字面量，删除死常量。
- 2026-11-05：用户 Windows 真机确认顶栏条全宽可拖，按钮、边缘 resize 均正常。根因定案。
- 2026-11-05：用户确认深色模式 tint 在新结构下正确（顶栏与侧栏同底色、按钮浅色），IME 候选框缩放窗口后跟随光标。
- 验证备注：cua 的合成拖拽对窗口移动/resize 均不可靠（连已知可用的区域也拖不动；resize 一次偶然生效），壳层拖拽验证以用户手测为准；按钮点击/最小化/最大化用 UIA Invoke 验证有效。
