---
kind: issue
title: "左侧栏顶部移除 Electron 退役后残留的空 chrome 行"
type: ff
status: closed
created: 2026-09-14
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 左侧栏顶部移除 Electron 退役后残留的空 chrome 行

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `codestable/` 有无影响。

---

桌面宽度布局下，左侧栏顶部（"New workspace" 上方）总是多出一段空白，是之前给 macOS Electron 客户端预留的 drag region / traffic-light 行残留。根因：`left-sidebar.tsx` 的 `DesktopSidebar` 用 `useOwnsWindowChromeCorner("top-left")` 门控这段空行，Electron 退役时该 hook 被固定为恒 `true`（`60ed17a2e`，为修复 `menu-header.tsx` 的侧栏切换按钮消失问题），副作用是让 `left-sidebar.tsx` 里同名但语义不同的旧判断也变成恒真，行本身从"仅 Electron 需要"退化成"web 上也总渲染"。`menu-header.tsx` 的用法与本次改动无关，未触碰。

- 改动：`packages/app/src/components/left-sidebar.tsx` — 移除 `ownsTopLeft`/`TitlebarDragRegion` 及其 import；chrome 行改为只在 `DEV_BUILD_LABEL`（`npm run dev:app` 注入的当前分支徽标）存在时渲染；`sidebarHeaderGroupStyle` 的顶部留白条件同步从 `ownsTopLeft` 改为 `Boolean(DEV_BUILD_LABEL)`。
- 验证：`npm run typecheck --workspace=@getpaseo/app`、`npm run lint -- packages/app/src/components/left-sidebar.tsx`、`npm run format:files` 全过；起本地 dev daemon(6778) + Metro(8081，`EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL` 分别置空/置 `main`)，Playwright 截图确认：无 label 时侧栏与右侧 header 顶部对齐、空白消失；有 label 时徽标行照常显示。
- codestable：无需要同步的 spec 段落（该空行本身未被任何 spec 文档描述为约定行为）。

顺手发现（未处理，供后续判断是否值得续做）：

- `menu-header.tsx` 的 `hasTopLeftWindowControls`（来自 `useHasWindowChromeObstruction`，恒 `false`）分支已不可达。
- `split-container.tsx` 里 `useWindowChromeCorners`/`removeWindowChromeCorner` 计算出的 corners 值只流入纯透传的 `WindowChromeRegion`，对渲染已无实际影响。
- `constants/layout.ts` 的 `DESKTOP_TRAFFIC_LIGHT_WIDTH`/`DESKTOP_TRAFFIC_LIGHT_HEIGHT` 已零引用。
- `codestable/spec/index.md:27` 仍写"默认实现跨 iOS、Android、浏览器和 Electron"，与 issue 025 之后 web-only 的现状不符（#1762）。

以上四项都是 025 号 Electron/原生退役遗留的同类死代码/漂移，非本次空白 bug 的成因，本次未动。
