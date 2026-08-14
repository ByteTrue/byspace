---
kind: issue
title: "侧栏顶级页面统一入口"
type: feature
status: closed
created: 2026-08-12
---

# 侧栏顶级页面统一入口

## 做成以后是什么样

侧栏顶部的 `History` / `Schedules` 两行合并为**单行入口菜单** `⊞ BySpace ⌄`。之后新增的顶级功能页面只在菜单里加一项，**不增加侧栏的固定高度**。footer 不动。

```text
┌─────────────────────────────┐
│  ⊞ BySpace            ⌄     │  ①
├─────────────────────────────┤
│ Workspaces    [⚠][+][🔍][⚙] │  ②
│  byspace              +     │
│      jumpy-alpacka          │
│      main                   │
│  ByteTrue/CFG         +     │
│      main                   │
│                             │
├─────────────────────────────┤
│ Add project   [H][🏠][?][⚙] │  ③ 保持现状
└─────────────────────────────┘
```

展开态（浮层，不推挤列表）：

```text
│  ⊞ BySpace            ⌄     │
├──────────────────┐
│ ⏱ History        │  ④
│ ⏰ Schedules      │
│                  │  ⑤ 未来页面追加在此，零布局成本
└──────────────────┘
```

- **图示状态：** 目标。
- **角色与入口：** 管理多个 Project 的用户在侧栏定位 workspace；偶尔需要离开 workspace 上下文，去某个顶级功能页面。
- ① 固定单行，永不滚走。trigger = grid 图标 + 产品名 + chevron，三个元素各有分工：`⊞` 给出 app-switcher 的先验，`BySpace` 说明作用域，`⌄` 声明"里面还有内容"。hover tooltip 预告菜单内容，使不点击也能发现。
- ② `Workspaces` 标题栏保持现状（`listHeaderComponent`，随列表滚动）。本次不碰。
- ③ footer 保持现状，包括 `Home`。
- ④ 菜单项与 trigger **预留状态徽标位**，本次不接任何数据源。
- ⑤ 稳定约束：新增顶级功能页面只允许追加菜单项，不允许在侧栏新增固定行。
- **仅作示意：** 图标造型、菜单项顺序、tooltip 具体文案、菜单宽度与浮层动效。

**范围：**

- 包含：
  - 顶部两行 `SidebarHeaderRow`（Desktop + Mobile 两处）替换为单个入口菜单组件。
  - 菜单首发装 `History` / `Schedules`。
  - trigger 的 hover tooltip 列出菜单内容。
  - 菜单项与 trigger 预留状态徽标位（结构预留，无数据源）。
  - 9 个 locale 补齐新文案。
  - 修复依赖 `sidebar-sessions` testID 作为"侧栏可见"探针的既有 e2e。
  - spec 回写：顶部入口契约与固定高度约束。
- 不包含：
  - footer 的任何改动（`Home` 留在 footer，见下方取舍记录）。
  - Toolbox、Supervisor 页面本身。
  - 状态徽标的数据源与汇总规则。
  - `Workspaces` 标题栏的图标区（`+` / 搜索 / `⚠` / 显示偏好）。
  - workspace 行高与列表密度。
  - Command Center 的命令项（`home` / `history` / `schedules` 已注册，保持不变）。
  - 快捷键新增或改动。

**归属：** 独立 issue。相关 spec：`codestable/spec/index.md` 的「侧栏 Workspace 导航」。前序：`issues/020-x-sidebar-workspace-information-efficiency.md`（建立了 Project-only 信息架构与"不用整行承载全局入口"的先例）。

## 为什么现在做

侧栏的定位是"workspace 越多越要把空间让给列表"，但顶部的顶级页面入口目前是**每页一行**的成本模型：

```text
paddingTop 8 + row 32 + gap 2 + row 32 + paddingBottom 6 + border 1 = 81px
```

固定、不可回收，Desktop 与紧凑浏览器同样承担。已规划的顶级页面至少还有 **Toolbox**（工具管理与启动）和 **Supervisor**（在单页与统筹 agent 对话，由它通过 CLI 去各 workspace 创建和跟进 agent），且明确"不止这两个"。按现模型再加 3 个页面就是 `81 + 3×34 = 183px`。

底部 footer 的图标行已有 4 项（Host / Home / Help / Settings），也没有余量。所以只能从顶部入手，且必须换成**恒定成本**的容器。

## 现状怎么工作

`left-sidebar.tsx` 在 Desktop（`DesktopSidebar`）和 Mobile（`MobileSidebar`）两处各渲染一个 `sidebarHeaderGroup`，内含两个 `variant="compact"` 的 `SidebarHeaderRow`（`History` → `/sessions`，`Schedules` → `/schedules`），各自用 `pathname.includes(...)` 派生 active 高亮。`Home` 是 `SidebarFooter` 里的 `FooterIconButton`，指向 `src/app/open-project.tsx`。三者在 `command-center/root-registration.tsx` 中都另有命令项。

## 动哪些、验哪些

- 必须改：
  - `src/components/left-sidebar.tsx` — 两处 `sidebarHeaderGroup` 渲染、相关 props 与 labels、`sidebarHeaderGroup` 样式。
  - 新增侧栏入口菜单组件（照 `sidebar/sidebar-help-menu.tsx`、`sidebar/sidebar-display-preferences-menu.tsx` 的既有模式，不引入新架构）。
  - `src/i18n/resources/*.ts` — 9 个 locale。
  - e2e：`e2e/helpers/sidebar.ts`、`e2e/helpers/archive-tab.ts`、`e2e/sidebar-workspace.spec.ts`、`e2e/composer-autocomplete.spec.ts`、`e2e/project-grouping-multi-host.spec.ts`、`e2e/sidebar-model-b.spec.ts`。
- 需要验：
  - **`sidebar-sessions` 被当作"侧栏是否可见"的探针**，而非功能断言：`sidebar.ts:75,79` 的 `toBeInViewport`、`sidebar-workspace.spec.ts` 的多处 `not.toBeVisible`、`composer-autocomplete.spec.ts:552,592`、`sidebar-model-b.spec.ts:202`。移除该 testID 会连带破坏这些与本功能无关的断言，必须改为指向新 trigger 或其他稳定探针。（`sidebar-home` 探针不受影响 —— footer 不动。）
  - Mobile 侧栏走 `MobilePanelOverlay`，浮层菜单必须叠在它之上 —— 见 `docs/floating-panels.md`。这是最容易翻车的点。
  - 菜单展开不推挤 workspace 列表、不造成布局跳动、不被裁切（`ui-spec` 的动态状态空间契约）。
  - 顶部固定高度实测下降（81px → 单行）。
  - active 状态：trigger **不再**表达"我在哪一页"（该信息由页面自身承担）；菜单内当前页标记为可选，不作为本次承诺。
- 仍未知：
  - trigger 被读成不可点 logo 的实际概率。缓解已定（`⊞` + `⌄` + hover 高亮 + tooltip 预告），但只能在真实界面上判断是否足够。

## 方案与实现安排

**这次的产出是成本约束，不是归属判据。**

```text
新增顶级功能页面 → 只追加菜单项，侧栏固定高度不变
```

这条约束与"该放顶部还是 footer"无关，无论怎么归属都成立，因此它是唯一要写进 spec 的硬约束。

归属本身是**低频人工决策**（一年几次，挪错代价极小），不需要机械规则。语义分区已经足够清楚：

```text
顶部菜单 = 用 BySpace 干活的地方
   History · Schedules · Toolbox · Supervisor · 之后新增的功能页

footer  = 装配 BySpace 本身的地方
   Add project · Home(open-project) · Host · Help · Settings
```

一句话判断：**"这是在用 BySpace 干活，还是在配置 BySpace？"**

**取舍记录（讨论中被证伪并撤回的路径，防止重走）：**

- **撤回"按频率/停留时长分三层"**（工作面 / 视图 / 设施）。Toolbox 是高频却是管理面板，Supervisor 是工作面却仍是普通路由页；这两个维度都无法给出正确归属。
- **撤回"是否有独立路由"判据。** 经核实，`Home`、`Settings`、`Host settings` 全部是 `router.push` 到独立路由（`src/app/open-project.tsx`、`src/app/settings/*`），footer 里唯一的非路由项是 `Add project` 的 picker。这个 app 里几乎所有目的地都是路由，该判据区分不了任何东西。
- **撤回"Home 迁入顶部菜单"。** `src/app/open-project.tsx` 的文件名给了答案：Home 就是"打开/接入项目"页，与 `Add project` 是同一件事的两个入口，属于装配家族，本来就该留在 footer。撤回后 footer 完全不动，风险面和改动面都变小。
- **trigger 不显示当前所在页。** 一个 label 无法同时表达"我在哪"和"能去哪"；显示 `History ⌄` 会被读成"History 的选项"。位置信息由页面自身承担，侧栏不重复。
- **trigger 不用语义上位词。** `Browse` / `Views` / `Activity` 都失败于同一原因：菜单成员是异质的（History 是去看、Toolbox 是去干活、Supervisor 是去对话），任何硬找的上位词都别扭。产品名把语义变成"BySpace 里的地方"，天然容纳任何未来页面。注意：首发只有 History + Schedules 时它们恰好同类，但命名必须为**终态**服务，不能因首发阵容回退到 `Browse`。
- **可发现性明确降级并认账。** 从"两个标签常驻"变为"一次点击 / hover"。理由：可发现性是一次性学习成本，81px 是持续成本；且 Command Center 已有兜底命令项。
- **不做 accordion 原地展开。** 展开态会推挤列表，若展开状态持久化则退回原成本。

**本次收益主要是斜率**（诚实记录）：

```text
现在                          = 81px
改完（首发 2 项）              = 单行，约 40px
再加 Toolbox + Supervisor + N  = 仍是单行，恒定
旧模型加同样这些              = 81 + N×34，无上限
```

**不碰的边界：** footer、workspace 列表投影与排序、Project-first 信息架构、Command Center 注册、daemon 与协议、快捷键映射、`Workspaces` 标题栏图标区。

**质量承诺：**

- 交互能力 / 适当性可识别：用户无需点击即可知道该入口通往哪些页面（`⊞` 先验 + `⌄` 信号 + hover tooltip 列出内容）。来源：讨论中用户提出的"用户不知道下拉里有什么"。证据：真实 Web 界面手动检查 + tooltip 内容断言。
- 交互能力 / 易操作与包容性：菜单在紧凑浏览器与键盘操作下均可达，浮层不被 `MobilePanelOverlay` 遮挡、不裁切、不引起布局跳动。来源：`docs/floating-panels.md` 与 `ui-spec` 的动态状态空间契约。证据：Desktop 与 390px 紧凑布局手动检查 + 键盘 focus 检查。
- 可维护性 / 可修改性：新增顶级页面只需在菜单项数组追加一项，不触碰布局与两处渲染点。来源：本次的核心诉求。证据：代码结构检查 —— 菜单项定义集中在单一数据源，Desktop 与 Mobile 共用同一组件。

**步骤：**

1. 抽出菜单项数据源（id、图标、label key、route、预留 badge 字段）。
2. 新增入口菜单组件，套 `sidebar-help-menu.tsx` 的浮层模式，带 tooltip。
3. 替换 Desktop 与 Mobile 两处 `sidebarHeaderGroup`。
4. 补 9 个 locale。
5. 修 e2e 探针，再补 trigger / 菜单 / 导航的新断言。
6. 紧凑布局与键盘可达性检查。

## 执行记录

### 实际改了什么

- 新增 `packages/app/src/components/sidebar/sidebar-pages-menu.tsx`：`SIDEBAR_PAGES` 常量是菜单的唯一数据源，`SidebarPagesMenu` 只接受可选的 `onNavigate`（Mobile 用它关侧栏，Desktop 不传）。trigger 为 `⊞ BySpace ⌄`，`testID="sidebar-pages"`。
- `left-sidebar.tsx`：Desktop 与 Mobile 两处 `sidebarHeaderGroup` 内的两个 `SidebarHeaderRow` 换成单个 `SidebarPagesMenu`；连带删除 `usePathname`、`isSessionsActive` / `isSchedulesActive`、`handleViewMore*` / `handleViewSchedules*`、`SidebarLabels.sessions` / `.schedules`、两个 props 声明与传参，以及 `History` / `CalendarClock` / `buildSessionsRoute` / `buildSchedulesRoute` 的 import；`sidebarHeaderGroup` 去掉单行后无用的 `gap`。footer 未改动。
- `sidebar-header-row.tsx`：删除因此变成孤儿的 `variant="compact"` 分支（`SidebarHeaderRowVariant`、`containerCompact`、`buttonCompact` 及相关 `useMemo`）。`settings-screen.tsx` 仍在用默认的 `header` 形态。
- 9 个 locale 新增 `sidebar.pages.trigger` 与 `sidebar.pages.triggerAccessibilityLabel`。
- e2e：`helpers/sidebar.ts` 的侧栏可见探针从 `sidebar-sessions` 改为 `sidebar-pages`，并新增 `openSidebarPage(page, testID)`；`helpers/archive-tab.ts` 的 `openSessions`、`project-grouping-multi-host.spec.ts` 的 schedules 入口改走该 helper；`composer-autocomplete.spec.ts`、`sidebar-workspace.spec.ts` 的可见性探针同步替换。
- 新增 `packages/app/e2e/sidebar-pages-menu.spec.ts`（7 项）。

### 与方案的偏差

1. **不加 badge 预留字段。** 原计划在数据源里预留 badge 槽位，实现时发现 `DropdownMenuItem` 已有 `trailing?: ReactElement`。再加一个恒为空的字段就是为想象中的扩展造接缝，改为在 `SIDEBAR_PAGES` 的注释里记录徽标落点。结构上的可扩展性不变。
2. **顺带修复一个既有的 `pointerEvents` 缺陷（必要，非顺手）。** Mobile 侧栏的 `mobileCloseButtonRow` 是 `position: absolute` 的全宽层，靠 style 里的 `pointerEvents: "box-none"` 放行点击 —— 但 RNW 的 StyleSheet compiler 明确不支持 style 中的 `pointerEvents`（`node_modules/react-native-web/dist/cjs/exports/StyleSheet/compiler/index.js:218,247`："No support for ... 'pointerEvents'"），该值被编译成非法 CSS 后丢弃，图层实际以默认 `auto` 拦截了它覆盖范围内的一切点击。原来两行时只有 `History` 行的下半部被吃掉，没有测试点过它；合并成一行后 trigger 被完全遮住，紧凑布局下无法打开菜单（e2e 首轮即以 "intercepts pointer events" 失败）。改为传 `pointerEvents="box-none"` prop（RNW 对 prop 路径有 polyfill），并删掉 style 里那条无效声明。这直接阻碍本次目标，属于必须先做的修复。
3. **修正 `sidebar-model-b.spec.ts` 的一个无效断言。** 它把 `sidebar-sessions`（一个按钮）当作侧栏容器，在其内部查 `workspace-tab-*` / `sidebar-agent-row-*`，结果恒为 0，断言从未真正生效。改为指向真正的容器 `sidebar-project-list`，断言这才开始有意义。
4. **键盘路径不是方向键。** 菜单引擎（`components/ui/menu`）没有方向键导航，只有 `combobox` 有。因此可达性验证走的是「focus trigger → Enter 打开 → focus 菜单项 → Enter 选择」，这是该引擎的既有键盘契约，本次不改引擎。
5. **新增 `sidebar-pages-header` testID 与固定高度断言（加法）。** 把「新增顶级页面不增加侧栏固定高度」从文字约束变成可执行的回归护栏：断言该容器高度 ≤ 56px。任何人再往顶部加一行常驻行，这条会失败。这是本 issue 核心产出的直接证据，故超出原步骤清单加入。
6. **菜单宽度改为测量 trigger，不用固定值（用户验收反馈后修正）。** 首版给 `DropdownMenuContent` 传了 `width={220}`，但侧栏宽度用户可拖拽（`usePanelStore.sidebarWidth`），固定值让浮层比打开它的那一行明显窄一截，衔接像悬空。改为在 trigger 上 `onLayout` 测量实际宽度，同时传给 `width` 与 `minWidth`（否则引擎默认 `minWidth = 180` 会在窄侧栏下反向撑大）。实测 trigger 与 surface 均为 `x=8, width=303`。

### 实测的高度变化

```text
改前：paddingTop 8 + row 32 + gap 2 + row 32 + paddingBottom 6 + border 1 = 81px
改后：paddingTop 8 + row 32 +                    paddingBottom 6 + border 1 = 47px
```

e2e 以 `sidebar-pages-header` 的实测 boundingBox 高度 ≤ 56 固定该上界。

## 验证

- `npx vitest run src/i18n/resources.test.ts --bail=1`：31 项通过（9 个 locale 的 key 与 en 同步）。
- `npx playwright test sidebar-pages-menu.spec.ts --project='Desktop Chrome'`：8 项通过 —— 只剩一行常驻（`sidebar-sessions` / `sidebar-schedules` 在菜单关闭时 `toHaveCount(0)`）、固定高度 ≤ 56px、菜单与 trigger 同宽同左边缘、hover tooltip 显示 `History · Schedules`、两个页面均可导航、键盘可打开并选择、菜单展开不推挤 workspace 列表（列表 `boundingBox.y` 不变）、390px 紧凑布局下 `elementFromPoint` 命中菜单项本身（证明浮层在 `MobilePanelOverlay` 之上，未被遮挡或裁切）。对齐断言必须 `expect.poll` 等过入场 scale 动画 —— 动画中途的 boundingBox 会报 295.4px 而非 303px。
- `npx playwright test sidebar-pages-menu.spec.ts sidebar-workspace.spec.ts sidebar-model-b.spec.ts --project='Desktop Chrome'`：23 项通过。
- `npx playwright test 00-sessions-empty.spec.ts composer-autocomplete.spec.ts --project='Desktop Chrome'`：8 项通过（覆盖 `openSessions` 改动与可见性探针替换）。
- `npx playwright test project-grouping-multi-host.spec.ts --project='Desktop Chrome'`：1 项通过（覆盖 schedules 走菜单的入口）。
- 真实界面截图确认：折叠态为单行 `⊞ BySpace ⌄`，展开态菜单实心、位于 trigger 下方、不推挤列表；idle 时 trigger 背景实测为 `rgba(0, 0, 0, 0)`，只有 hover / open 才高亮。
- `npm run typecheck`：通过。`npm run lint`：0 warning / 0 error。`npm run format:check`：通过。
- `npm run build:web --workspace=@bytetrue/byspace-app`：Web export 通过。

质量目标对应：适当性可识别 ← tooltip 内容断言 + 截图；易操作与包容性 ← 紧凑布局层级断言、键盘路径断言、无布局跳动断言；可修改性 ← 菜单项集中在 `SIDEBAR_PAGES` 单一数据源，Desktop 与 Mobile 共用同一组件，固定高度断言防回归。

## 关闭时

- 回写到 spec 的候选：`codestable/spec/index.md`「侧栏 Workspace 导航」新增顶部入口契约 —— 顶部单行入口菜单承载顶级功能页面；**新增顶级页面不增加侧栏固定高度**；trigger 不表达当前位置；footer 承载装配 BySpace 本身的入口。
- 关闭判断与验证摘要：实现与验证已完成，待用户界面验收与关闭授权。
- 遗留（不扩入本次）：状态徽标数据源；Supervisor 是独立常驻行还是 Workspaces 列表的固定置顶项（后者更能表达"与 workspace 平级"，但会破坏「Project 是定位 Workspace 的唯一信息结构」这条 spec 约束，留到真做 Supervisor 时再决）。
