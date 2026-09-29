---
kind: issue
title: "侧栏折叠按钮固定在窗口角，左上四个导航项并入 BySpace 按钮内就地展开"
type: ff
status: closed
created: 2026-09-29
closed: 2026-09-29
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 侧栏折叠按钮固定在窗口角，左上四个导航项并入 BySpace 按钮内就地展开

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

原本两个折叠按钮都长在内容标题栏里，于是侧栏展开时左侧按钮被推到 x=324，Explorer 打开时右侧按钮被推到 dock 左缘——「按钮跟内容跑」。现在左按钮固定窗口左上、右按钮固定窗口右上，展开/收起都在同一像素；左上原先四行导航（New workspace / History / Search / Schedules）收进 `BySpace` 按钮，点开时就地展开成同样的行、把 Workspace 列表往下推（不是悬浮二级菜单）。

`BySpace` 按钮要求是**独立按钮**（用户明确：「这个按钮单独的，BySpace 这个字符串居中，然后按钮右侧的展开箭头向右靠齐」）：占满折叠按钮右侧的剩余宽度，标签在其中点居中，箭头绝对定位贴右缘（内缩 `spacing[2]`）。实现上不再复用 `SidebarHeaderRow`，因为「标签居中 + 箭头靠右」与导航行的「图标领头 + 标签左对齐」是两种形状，硬套会多出一堆变体；也顺势删掉了上一步为复用加的 `horizontalInset` 与 `accessibilityState` 口子（已无调用方）。

走过三轮：①同行 + 外框对齐（图标仍偏左 3px）②拆两行、五个图标同在 x=16 ③回到同行 + 对图标（折叠按钮图标落 x=16）+ BySpace 改成居中标题栏型按钮。

- 改动：`packages/app/src/components/sidebar/sidebar-toggle-host.ts`（新）+ `contexts/desktop-sidebar-visibility-context.tsx`（新）— 左按钮 host 判定抽成纯函数（sidebar ↔ content 互为补集，不会两个都渲染或都不渲染），可见性由 AppContainer 已算好的 `desktopSidebarVisible` 一处喂入。
- 改动：`packages/app/src/components/sidebar/sidebar-nav-menu.tsx`（新，按钮与展开区）、`sidebar-nav-rows.tsx`、`packages/app/src/sidebar-nav/use-sidebar-nav-entries.ts`（新）— 顶层导航一个来源（label/icon/shortcut/active/onSelect + 顺序显隐），桌面渲染成按钮 + 就地展开的行、compact 直接渲染成行，二者不会漂移。
- 改动：`sidebar-header-row.tsx` — 新增 `accessibilityState`（并显式补 `aria-expanded`，RN Web 不会从 `accessibilityState` 推导）供展开按钮使用。
- 改动：`left-sidebar.tsx` — 桌面顶栏一行：折叠按钮 + `BySpace` + dev 徽标；行高取 `HEADER_INNER_HEIGHT - borderWidth`，与 `ScreenHeader` 对齐（行 + 发丝线 = 36px，内容盒同为 35px）；`sidebarTopRow` 用 `spacing[3]` 内缩，与内容标题栏同宽，靠共用的 `leadingToggle` 把按钮拉回侧栏按钮轨。
- 改动：`menu-header.tsx` — `leadingToggle` 负边距改为按常量算出的值（桌面 `-1`），把折叠按钮的**图标**拉到与行图标同一条 `x=16` 基准线；两个 host 共用同一值，折叠/展开两态位置不变。
- 改动：`sidebar-nav-menu.tsx` — `SidebarNavMenuTrigger` 改为独立按钮（不再复用 `SidebarHeaderRow`）：`flex: 1` 占满剩余宽度，标签 `flex: 1 + textAlign: center` 居中（两侧对称 `spacing[4]` 内缩防长标签压到箭头），箭头 `position: absolute; right: spacing[2]` 靠右。
- 改动：`left-sidebar.tsx` — **compact 侧栏也折叠**：头部改为 `[BySpace][关闭]` 一行 + 就地展开的四行（默认收起），删掉旧的绝对定位关闭行与只服务于它的 `mobileCloseButtonRow`/`sidebarHeaderGroup` 样式；两个 shell 共用新 hook。
- 改动：`sidebar-nav/use-sidebar-nav-disclosure.ts`（新）— 两个 shell 共用开关/收起回调，避免各写一份而漂移。
- 改动：`e2e/support/helpers/sidebar.ts`、`composer-autocomplete.spec.ts` — 「compact 面板已开」的探针从 `sidebar-sessions`（现默认隐藏）改为 `sidebar-close`。
- 改动：`sidebar-header-row.tsx` — 删掉上一步为复用加的 `horizontalInset` 与 `accessibilityState`（含手写的 `aria-expanded`）：新方案不再需要，且已无调用方。折叠按钮自己的 `aria-expanded` 在 `menu-header.tsx` / `SidebarNavMenuTrigger` 各自维护。
- 改动：`menu-header.tsx` — `SidebarMenuToggle` 增 `host: "content" | "sidebar"`，两个 host 读同一个纯函数。
- 改动：`workspace-explorer-toggle.tsx`、`workspace-screen.tsx`、`explorer-sidebar-tab-rail.tsx` — owner 由两态改三态 `mobile | content | dock`；dock 打开时按钮由 dock 标签栏承载、右侧内缩与内容标题栏一致（dock 侧另加 `spacing[2]` 回拉）。
- 改动：9 个 locale 各加 `sidebar.appMenu.label`（品牌名，各语言同值）。
- 验证：`npm run typecheck --workspace=@bytetrue/app`、`npm run lint`、`npm run format:check` 全过；既有 i18n/keys 测试与新增 host/owner 纯函数单测共 42 例全绿。本地 dev daemon(6778) + Metro(8081) 用 Playwright 实测：折叠按钮与 `BySpace` 同行（`y=4.5` vs `1.5`，纵向重叠）；折叠按钮图标 `x=16` === 四个导航行图标 `x=16`（同一基准线），四个行仍在 `x=8`；`BySpace` 标签中心 === 按钮中心（实测 174 vs 174，无 badge 时 105.6 vs 105.6），箭头右内缩 8px；按钮开/关两态均 `x=11, y=4.5` 且 `data-testid` 计数为 1；右按钮 dock 关/开均 `x=1436`（1466 视口）；compact 719px（非 mobile UA）与 390px 均只有一个各按钮、无 `BySpace` 按钮；⌘K 在展开区关闭时仍能打开 command center。
- e2e：`sidebar-workspace` 断言：折叠按钮与 `BySpace` 同一行（纵向区间重叠）、折叠按钮**图标**左缘 === 导航行图标左缘、`BySpace` 标签中心 === 按钮中心、箭头右内缩 < 12px；并新增 compact 用例如「compact Web › folds the top-level nav into the BySpace button」（默认收起、展开后行与按钮同一 `x`、标签居中、选完关闭面板）。19/19 绿。
- 跨 spec 回归：`sidebar-workspace` + `composer-autocomplete` + `sidebar-model-b` + `empty-project-persists` + `new-workspace-entry` + `explorer-surface-upgrade` 共 46 例，45 绿 + 1 个已证伪的预存在失败（Ctrl+P，见下）。
- e2e：`sidebar-workspace`(20) / `sidebar-nav-settings`(2) / `sidebar-model-b`(3) / `empty-project-persists` / `new-workspace-entry` / `composer-autocomplete`(10) / `explorer-surface-upgrade`(2) 共 6 个 spec 跑过，除两个已证伪的预存在失败（见下）外全绿。
- byissue：已同步 `spec/workspace.md` 新增「侧栏顶栏与面板折叠」；`docs/design.md` 里 Electron 时代的角落遮挡段、`docs/explorer-sidebar.md` 的 toggle 归属、`docs/menus.md` 新增「何时不该做成菜单」（就地展开 vs 悬浮菜单的判据）同步改写。
- 毕业：`spec/workspace.md` 已收「折叠按钮图标与行图标同轨」「BySpace 是标题栏型按钮不是导航行」「compact 也折叠」三条稳定契约；`docs/menus.md` 收展开器轨道的通用判据（含「对齐图标不是外框」的坑）。代码可重建的部分（组件与样式细节）刻意留给代码。

顺手发现（不在本次范围）：

- 四个导航项收进按钮后，展开前看不到当前页高亮（行本身带 active 指示条，但默认不展开）。已作为取舍写进 spec。
- 两个预存在的 e2e 失败，与本次无关，已用 `git stash push -u` 在干净树上逐个复现同样是红：`sidebar-nav-settings` 断言字号 "Ctrl+N"（macOS 渲染为 ⌘N）；`new-workspace-entry` 按 Control+P 而 app 绑的是 Mod+P。两者都是宿主平台的陈旧期望。
- 右侧两个 host 的按钮纵向差 0.5px：内容标题栏的行是 36px 含 1px 下边框（内容盒 35px），dock 标签栏 36px 无边框（内容盒 36px），居中的结果天然差半像素。这是两条栏历史上就有的差异，不是本次引入，未为它加透明边框 hack。（左侧两 host 已按盒模型对齐：行高取 `HEADER_INNER_HEIGHT - borderWidth`，与 `ScreenHeader` 同为 35px 内容盒。）
- `docs/design.md` 里 `DESKTOP_TRAFFIC_LIGHT_WIDTH/HEIGHT` 常量仍零引用（025 退役遗留），未在本次清理。
- `packages/app/src/components/desktop-sidebar-layout.ts` 的 `resolveDesktopAppChromeLayout`（返回 `sidebarToggleOwner: "window" | "content"`）只剩单测引用，生产侧零调用——它正是本次手写 owner 的 Electron 时代前身。建议随 025/047 残遗一并删除。

## Review 轮（开 PR 后）

**CI 抓到两处我自己的回归**，都是「用 accessible name 点导航行」，而我本地只 grep 了 testID：

- `e2e/browser/schedules-project-target.spec.ts` — `getByRole("button", { name: "Schedules" })`（shard 6 红）
- `e2e/support/helpers/workspace-setup.ts` — `leaveWorkspaceViaHistory` 里的 `{ name: "History", exact: true }`（shard 8 红）

两处都改走 `clickTopLevelNavItem`。教训：把默认可见的行折叠起来时，要同时 grep **可访问名**，光找 testID 会漏。

**CR 抓到一个真实功能缺陷**（已在浏览器复现）：compact 面板是 retained（`RetainedPanelActivity` + `RetainedPanel` 以 `display:none` 保活），所以 `useSidebarNavDisclosure` 的状态活过面板关闭；展开一次后，下次打开面板四行仍是展开的，直接推翻本需求的目的。修法：在 `MobileSidebar` 里用面板自身的 `active` 标志（`active = visible && isMobileActive`）在关闭时调 `collapse()`，覆盖 ✕ / backdrop / 手势 / 导航全部关闭路径（比只在 `onBeforeNavigate` 里收更全）。已加回归测试。CR 同时给出「helper 断言用了一个从无组件设置过的 testID，恒真」——已改为断言行位于 `left-sidebar` 内部。

**同轮修掉的自身遗留**（Ponytail review + CR，均先核实零引用）：`sidebarHostRendersToggle` 死导出、`SIDEBAR_NAV_MENU_TRIGGER_TEST_ID` 无用导出、`SidebarNavEntry.key` 与 `id` 重复、`useSidebarNavDisclosure` 的 `initialExpanded` 无人传、BySpace 触发器为取 `length===0` 把四个快捷键订阅都拉起来、`handleToggle` 空包、`hostState` memo + 冗余三元、三行 early return；文档与注释同步：`docs/menus.md` 把 `SidebarNavMenuTrigger` 误写为 `SidebarHeaderRow`、`sidebar-nav-rows.tsx` 的「Compact only」、`sidebar-chrome.ts` helper 里「compact 直接渲染」的陈述。另补 compact 关闭按钮在「四个导航项全隐藏」时补 `marginLeft: auto`（否则会漂到左侧）。

**未修、留作后续**（都不是本 PR 引入）：`desktop-sidebar-layout.ts` 的 `resolveDesktopAppChromeLayout` 仅剩单测引用、`docs/design.md` 的 `DESKTOP_TRAFFIC_LIGHT_*` 零引用（025/047 残遗）；右侧两 host 的按钮纵向 0.5px 历史差异；dock 谓词在 `SplitContainer` 与新 resolver 各写一遍（当前一致，是漂移风险）；`command-center-scroll.ts` 里 import 写在函数之后（风格）。

**追加**：修 compact 泄漏时发现**桌面侧同样中招**——`DesktopSidebar` 也是 retained（`desktopSidebarMounted` 由 `useLatchedBoolean` 锁存，收起时只是 `display:none`），所以收起再展开侧栏，BySpace 仍是展开的。与其在两个 shell 各写一份重置，把这条不变式收进 hook 本身：`useSidebarNavDisclosure(panelActive)`，面板不在时自动收起。这样「揭示区只活在面板可见期间」只写一遍，两个 shell 首次印象一致（收起）。

桌面侧已加回归测试「starts folded again after the pinned sidebar is collapsed and reopened」。**该测试做过变异验证**：临时删掉 hook 里的重置后它确实失败（`aria-expanded` 停在 `true`），恢复后通过——不是恒真断言。
