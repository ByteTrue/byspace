---
kind: issue
title: "Host 设置收敛：终端集成落 provider 弹层，Terminals 与 Providers 页取消"
type: refactor
status: closed
created: 2026-09-24
---

# Host 设置收敛：终端集成落 provider 弹层，Terminals 与 Providers 页取消

> **读者：** 跨会话接手实现或 review 的人——分类怎么并、每块内容落到哪个文件、必须保持的外部行为、怎么验。
> **来源：** `../talks/003-host-settings-consolidation.md`；层级规则与不联动约束见 `../decisions/001-settings-taxonomy-and-integration-layers.md`。

## 目标与范围

Host 一级分类从 7 个收敛到 5 个：**Overview / Projects / Connections / Agents / Usage**。`terminals` 与 `providers` 两个 slug 消失。

包含：

- provider 详情弹层顶部加 `Agent` / `Terminal` 两个 tab：Agent = 现有模型浏览，Terminal = 该 provider 的 activity hook 开关 + 该 provider 的启动命令。
- 逐 provider hooks 配置从 Terminals 页迁入弹层 Terminal tab。
- Terminal profiles 列表与 Default shell 迁入 Overview。
- Providers 页平面折叠进 Agents 页（同页多小节，不做页面级 tab）。

不包含：Usage 的位置调整；Agent profiles 迁入弹层；hooks 与 `providers[x].enabled` 的任何联动；页面级大 tab。

## 必须保持的外部行为

- **不联动：** 弹层 Terminal tab 里的 hook 开关与 provider 的 enabled 开关各自独立生效。既不能因为关掉 provider 而关掉 hook，也不能反过来。daemon 侧 `resolveTerminalAgentHookSettings()`（`packages/server/src/terminal/agent-hooks/terminal-agent-hook-setting.ts`）不读 provider enabled，这条现状不能改。
- **profile 列表仍然只有一份所有权。** 弹层是编辑入口，不是第二个列表——它必须复用 `TerminalProfilesSection` 保存的同一个 `config.terminalProfiles` 数组，保存走同一条 `patchConfig({ terminalProfiles })` 全列表回写路径。
- **无归属的 profile 必须仍可见可排序：** 空白终端（`BLANK_TERMINAL_PROFILE_ID`）与用户自建条目只出现在 Overview 列表里，不投影到任何弹层。
- **启动菜单顺序语义不变：** ↑↓ 调整的就是启动菜单的排列。这条只有在 Overview 的单一列表里才成立，是 profile 列表不拆进弹层的直接原因。
- **Terminal tab 只给有 hook provider 的 agent 显示。** `TERMINAL_AGENT_HOOK_PROVIDERS`（`packages/app/src/screens/settings/terminal-agent-hooks-config.ts`）与 daemon 的 `AGENT_HOOK_PROVIDERS` 都硬编码 claude/codex/opencode/pi；ACP 与自定义 provider 没有 hook 实现，Terminal tab 对它们不出现。

## 现状怎么工作

- 侧栏数据：`packages/app/src/screens/settings-screen.tsx` 的 `HOST_SECTION_ITEMS`；内容分发在 `renderHostSettingsContent`。
- 路由：`packages/app/src/utils/host-routes.ts` 的 `HOST_SECTION_SLUGS` / `LEGACY_HOST_SECTION_SLUGS`。
- Terminals 页：`host-page.tsx` 的 `HostTerminalsPage` = `EnableTerminalAgentHooksCard` + `DefaultShellSection` + `TerminalProfilesSection`。
- Providers 页：`HostProvidersPage` → `ProvidersSection`（`providers-section.tsx`，561 行）；行点击 `openProviderSettings({ serverId, provider })` → `provider-settings-store` → `ProviderSettingsHost` → `ProviderDiagnosticSheet`（`packages/app/src/components/provider-diagnostic-sheet.tsx`，871 行）。
- 弹层主体：`ProviderModalBody` 是模型列表 + 搜索 + footer（Add model / Diagnostic / Refresh）。tab 加在这一层，footer 只属于 Agent tab。
- Agents 页：`HostAgentsPage` = Inject tools + Append system prompt + `AgentSkillsSection` + `AgentProfilesSection` + `MetadataGenerationPage`。
- Overview：`HostSettingsPage` = 状态徽章 + `HostAppearanceSection` + Workspaces 自动归档 + `NetworkSection` + （本地）`DaemonServiceSection` / （远端）`UpdateDaemonCard` + 危险区。
- profile 语义全在 `packages/protocol/src/terminal-profiles.ts`：`PROMPT_SENTINEL`、`getCommandBaseName`（**私有**）、`getTerminalProfileIcon`、`resolveTerminalProfiles`。

## 改什么

**弹层 Terminal tab**

- `ProviderDiagnosticSheet` 引入 `SegmentedControl`（`@/components/ui/segmented-control`，同页先例 `metadata-generation-page.tsx:130`）在 `Agent` / `Terminal` 间切换；`query` 搜索槽与 Add model/Diagnostic/Refresh footer 属于 Agent tab，切走时收起。tab 状态是弹层局部 state，不进 URL、不进 store。
- 新组件承载 Terminal tab 内容：一个 hook 开关行（复用 `createTerminalAgentHookPatch` / `isTerminalAgentHookProviderEnabled`）+ 该 provider 的启动命令行，命令行的编辑按钮打开现有 `TerminalProfileEditModal`。
- 需要按 command base name 找该 provider 的 profile：把 `terminal-profiles.ts` 的 `getCommandBaseName` 导出（或加一个 `findProfileForProvider(profiles, providerId)`），不要在 app 侧复制匹配逻辑。
- provider 没有对应 profile（用户删了）时，Terminal tab 显示启动命令为空并提供添加，写入同一列表。

**Overview**

- 挂 `DefaultShellSection`（组件本身不改，只换挂载点）与 `TerminalProfilesSection`（同理）。新增一个小节标题键。

**Agents 页折叠 Providers**

- `HostAgentsPage` 顶部或末尾挂 `ProvidersSection`；provider 列表与 agent 配置小节同页共存，按 `SettingsSection` 分节。
- `settings-screen.tsx`：`HOST_SECTION_ITEMS` 删 `providers`、`terminals`；`renderHostSettingsContent` 删两个 case。

**入口改指**

- 三处「Manage terminal profiles」`buildSettingsHostSectionRoute(serverId, "terminals")` → `"host"`：`workspace-tabs/launcher/index.tsx:111`、`new-workspace-launch/launch-control.tsx:147`、`screens/workspace/workspace-header-menu.tsx:222`。
- `screens/open-project-screen.tsx:53` 的 `"providers"` → `"agents"`。
- `composer/agent-controls/index.tsx:283` 已是 `"agents"`，不动。
- `packages/app/e2e/support/helpers/settings.ts` 的 `HostSection` 联合类型同步；`e2e/browser/settings-host-page.spec.ts:54`、`e2e/browser/new-workspace-entry.spec.ts:135` 改目标 section。

**路由与兼容**

- `HOST_SECTION_SLUGS` 直接删两项。**按 #1807 零向后兼容，不写 `LEGACY_HOST_SECTION_SLUGS` 映射、不加 COMPAT 标记**——issue 050 里加映射的做法不是当前规范，不要照抄。

**i18n（9 语言：en/zh-CN/ja/ko/fr/es/pt-BR/ar 加 resources 索引）**

- 删 `settings.hostSections.{terminals,providers}`；`settings.hostSections.agents` 沿用。
- 新增弹层 tab 两个标签键、Overview 终端小节标题键。
- 现有 `settings.host.terminalProfiles.*`、`settings.host.terminalAgentHooks.*`（若有）、`settings.providers.*` 键位随组件搬迁复用，不重复新建。

## 影响面

- **必须改：** `settings-screen.tsx`、`host-page.tsx`、`host-routes.ts`、`provider-diagnostic-sheet.tsx`、`providers-section.tsx`、`terminal-profile-edit-modal.tsx`（如复用需传 provider 上下文）、`packages/protocol/src/terminal-profiles.ts`（导出 base name 匹配）、四处入口深链、e2e helper 与两个 spec、9 语言 i18n。
- **需要验：** 从启动菜单点「Manage」落到 Overview 且列表可 ↑↓；弹层 Terminal tab 保存后 Overview 列表同步；hook 开关关掉 provider 后仍生效；ACP/自定义 provider 不出现 Terminal tab；旧 `/settings/hosts/<id>/terminals` 与 `/providers` 回落未知 slug 行为。
- **仍未知：** 弹层加 tab 后 compact（窄屏）形态的 snapPoints 与搜索槽是否要一起收进 Agent tab——实现时看实际高度定，不是阻塞项。

## 质量承诺

- 可达性不降级：每条配置合并后仍在两次点击内到达；三处「Manage」入口落到唯一正确的列表。
- `npm run typecheck`、`npm run lint`、`npm run format` 全绿。
- 只跑改到的单文件测试，不跑全套（仓库规则）：`npx vitest run <file> --bail=1`。相关既有套件：`providers-section.test.tsx`、`terminal-agent-hooks-config.test.ts`、`terminal-profile-edit-modal.test.tsx`、`host-routes.test.ts`、`packages/protocol/src/terminal-profiles.test.ts`。

## 回写

关闭时同步 `byissue/spec/terminal.md`：「Manage Terminal Profiles 精确打开所选 Host 的 Terminals 设置页」这条改掉；逐 provider hooks 那条 bullet 补上归属变化。`docs/glossary.md` 的 **Terminal profile** 条目补 UI 位置。

## 执行记录

**实现（2026-09-24）**

- `packages/protocol/src/terminal-profiles.ts`：新增 `findTerminalProfileForProvider(profiles, providerId)`，按 command base name 匹配（复用私有 `getCommandBaseName`，不导出它、不在 app 侧重写匹配）。+4 条单测。
- 新文件 `packages/app/src/components/provider-terminal-profile-save.ts`：弹层保存抽成纯函数 `applyProviderProfileDraft` / `draftFromProfile` / `parseProfileArgs` —— 整列表回写、命中行原位替换保住用户排序、新增追加末尾、保留 icon、空 args 不落空数组。5 条单测。
- 新文件 `packages/app/src/components/provider-terminal-integration.tsx`：Terminal tab 内容（hook 开关 + 该 provider 启动命令与编辑入口，复用 `TerminalProfileEditModal`）。
- `provider-diagnostic-sheet.tsx`：`SegmentedControl` 加 `Agent`/`Terminal`；tab 是弹层局部 state，不进 URL 也不进 store；非 hook provider 不渲染 tab 条；切到 Terminal 收起搜索槽与 Add model/Diagnostic/Refresh footer；关闭时重置回 Agent。
- `host-page.tsx`：删 `HostTerminalsPage`、`HostProvidersPage`、`EnableTerminalAgentHooksCard`、`TerminalAgentHookProviderRow`；`DefaultShellSection` + `TerminalProfilesSection` 挂进 `HostSettingsPage`；`ProvidersSection` 挂进 `HostAgentsPage` 顶部。
- `settings-screen.tsx` / `host-routes.ts`：侧栏与 slug 各删两项，**无 LEGACY 映射、无 COMPAT 标记**。
- 入口改指：`launcher/index.tsx`、`launch-control.tsx`、`workspace-header-menu.tsx` → `host`；`open-project-screen.tsx` → `agents`。
- i18n 9 语言：删 `hostSections.{providers,terminals}`；新增 `settings.host.terminalAgentHooks.*`、`settings.host.terminalProfiles.provider*`、`settings.providers.tabs.{agent,terminal}`。
- e2e：helper 的 `HostSection` 收敛为 5 项；`expectHostProvidersCard` 改走 agents 页；`expectRetiredSidebarSectionsAbsent` 增两条 `toHaveCount(0)`；原「terminals 页四个开关」用例**改写**为逐个打开 provider 弹层、切 Terminal tab、断言该 provider 开关（未删除）；`acp-provider-catalog`、`provider-removal`、`new-workspace-entry` 目标 section 同步。
- 回写：`docs/terminal-activity.md`、`docs/glossary.md`、`byissue/spec/terminal.md` 两条 bullet。

**验证**

- `npm run typecheck` 全包绿；`npm run lint` 0 error（首轮 8 个：未用 import、`draft` 遮蔽、两处 inline 函数 prop，已修）；`npm run format` 已跑。
- `npx vitest run`（8 文件：settings 目录、host-routes、protocol terminal-profiles、新增 save 单测）：129 passed。
- 真实浏览器（`npm run dev:app` + dev daemon 6778，agent-browser）：侧栏 Host 组 5 项、无 Terminals/Providers；Agents 页顶部是 Providers 小节（8 行）；Pi 弹层有 `Agent`/`Terminal`，Terminal tab 渲染 hooks 小节 + `pi {{{prompt}}}` + Edit profile + Overview 提示，搜索框与 footer 计数 0；开关 on↔off 两次均写入 daemon；Edit modal 正确回填 Name/Command/Arguments；Overview 含 Default shell 与 Terminal profiles（↑↓ 可用，首行 Move up disabled）。截图 `/tmp/shot-terminal-tab.png`。
- **未验**：compact（窄屏）下弹层加 tab 后的高度与 snapPoints；e2e 套件未在本地跑（重，交 CI）。

## 第二轮回修（2026-09-24，Owner review）

首版整体方向被接受，但三处实现被判为不合格，已按评审意见重做：

**1. 弹层切换位置。** 首版把 `Agent` / `Terminal` 做成一条居中 tab bar 放在 sheet body 顶部，被否（“太丑了”）。改为放进 `AdaptiveModalSheet` 的 `header.actions`，即标题 `Pi` 右侧、关闭按钮左侧，`SegmentedControl size="xs"`。

**2. Terminal profiles 的归属。** 首版放 Overview 是错的——它是 launch 配置，和 Agent profiles 同类，都描述“怎么起一个 agent/终端”。现已从 Overview 移到 Agents 页，紧跟 `AgentProfilesSection`。Default shell 仍在 Overview：它是 shell 属性，与 agent 无关。`providerOrderNote` 提示语（“在概览里管理”）随之删除；三处「Manage terminal profiles」深链从 `host` 改指 `agents`。

**3. Agents 页信息层级。** 首版把完整的 provider 列表铺在页首，导致下方的 agent 配置沉到首屏之外；Add provider 也直接展开在列表下方。现在：

- `SettingsSection` 新增 `collapsible` / `defaultCollapsed` / `collapsedSummary`，默认行为不变（展开）。
- Providers 列表折叠，header 带摘要 “7 of 8 enabled”，一眼可读状态。
- Add provider 从 `ProvidersSection` 拆成独立的 `AddProviderSection`，渲染在 Agents 页**最后**，默认折叠。
- 折叠规则写进 `docs/design.md` §7：折叠是为长度而非整洁；有状态值得一眼看到的 section 不折叠；`defaultCollapsed` 默认 false。

**验证（第二轮）**

- `npm run typecheck` 绿；`npm run lint` 0 error；`npm run format` 已跑。
- `npx vitest run`（13 文件 184 tests）：全绿。`providers-section.test.tsx` 的 RN stub 补齐 `Platform.select` / `withUnistyles` / `accessibilityState`，并**新增**一条折叠行为用例（初始 collapsed、`aria-expanded=false`、摘要可见、展开后行可见）。
- 真实浏览器（8082，dev daemon 6778）：Agents 页首为折叠的 Providers + “7 of 8 enabled”，其下 Agents / Orchestration skills / Agent profiles / Terminal profiles / Metadata generation 依次可见，Add provider 在页尾且折叠；Pi 弹层标题右侧为 `Agent` / `Terminal` 切换，Terminal tab 渲染 hooks 与启动命令。截图 `/tmp/sheet-tabs.png`、`/tmp/sheet-terminal.png`、`/tmp/agents-collapsed.png`。

**未验**：compact 窄屏；e2e 本地未跑（交 CI）。

## 第三轮回修（2026-09-24，Owner review 2）

**1. Terminal profiles 再上移。** 放在 `AgentProfilesSection` 之后仍不对；现移到它**之前**，两者相邻同类。

**2. Providers 默认展开。** Owner 指出“这是比较重要的设置项，默认展开会比较好”。同意：折叠是为长度，不是为让重要状态藏起来。`ProvidersSection` 去掉 `defaultCollapsed`，保留 `collapsible` 与 `collapsedSummary`——默认展开、可手动折起，折起后仍能读到 “N of M enabled”。`AddProviderSection` 仍默认折叠（一次性安装动作）。

**3. 折叠箭头的对齐。** 首版把箭头放在标题左侧并负 margin 外拉，导致 section 标题左端比其他 section 多出一个箭头宽度，视觉上不齐。现箭头移到标题**之后**（trailing 侧），`toggle` 改为 `flex: 1` 让整行可点，所有 section 标题共用同一条左导轨。

**验证（第三轮）**

- `npm run typecheck` 绿、`npm run lint` 0 error、13 文件 184 tests 全绿。
- `providers-section.test.tsx` 折叠用例改为断言**默认展开**、折起后 `aria-expanded=false` 且摘要可见。
- 浏览器（8082）：Agents 页顺序为 Providers（展开）→ Agents → Orchestration skills → Terminal profiles → Agent profiles → Metadata generation → Add provider（折叠）；四个 section 标题左端对齐；Providers 折起后 header 为 “Providers 7 of 8 enabled”。截图 `/tmp/agents-v2.png`、`/tmp/agents-v2-collapsed.png`、`/tmp/agents-v2-bottom.png`。

## 第四轮：切 tab 高度跳变（2026-09-24）

Owner 反馈：从 Agent 切到 Terminal 时弹层高度突然缩小、卡片重新居中，交互不好。

根因不在 tab 本身，而在桌面路径的卡片是**内容撑高**的（`styles.desktopCard` 只有 `maxHeight: 85%`）。Agent 面是 20 条模型的长列表，Terminal 面只有两行，切 tab 时卡片同时改变高度与位置。

修法用现成能力，不新增机制：`AdaptiveModalSheet` 已有 `desktopHeight`（`changelog-sheet.tsx:82` 在用，`desktopScrollContainer` 的 `flexGrow` 注释就是为它写的）。给 provider 弹层传 `desktopHeight={DESKTOP_SHEET_HEIGHT}`，取 `"65%"` 与 `MAIN_SNAP_POINTS` 首个 detent 一致——桌面与 compact 对“provider 有多高”给同一个答案。compact 走 snapPoints 本来就不跳，未改。

实测两个 tab 的 `provider-settings-sheet` 高度均为 577px、位置一致。截图 `/tmp/tab-terminal-fixed.png`。

## 关闭结论（2026-09-24，Owner 验收通过）

**判断：达成。** Host 一级分类 7 → 5，Terminals 与 Providers 两个 slug 连同页面一起取消，无兼容映射；逐 provider 终端集成落在 provider 详情弹层的 Terminal tab；Terminal profiles 与 Agent profiles 同类并列于 Agents 页；Default shell 留 Overview。四轮评审（tab 位置、profiles 归属、Agents 页层级与折叠、切 tab 高度跳变）均已改完复验。

**验证摘要**

- `npm run typecheck` 全包绿、`npm run lint` 0 error、`npm run format` 已跑。
- 目标套件 13 文件 184 tests 全绿；新增测试而非删除：`findTerminalProfileForProvider` 4 条、`applyProviderProfileDraft` 5 条、`SettingsSection` 折叠行为 1 条。既有用例（providers-section 的行渲染/排序/开关）先展开折叠区再断言，覆盖的行为未减。
- 可达性（本 issue 的质量承诺）：浏览器实测「Manage profiles」从 New Workspace 启动菜单落到 `/settings/hosts/<id>/agents`，Terminal profiles 列表在同页可见；provider 弹层两个 tab 高度均为 577px、切 tab 不再跳动。
- 截图：`/tmp/sheet-tabs.png`、`/tmp/agents-v2.png`、`/tmp/agents-v2-collapsed.png`、`/tmp/agents-v2-bottom.png`、`/tmp/tab-terminal-fixed.png`。
- **未验（交 CI）**：e2e 套件本地未跑；compact 窄屏形态未实测。

**回写位置**

- `byissue/spec/terminal.md`：hooks 开关入口、Manage Terminal Profiles 落点、Default shell 落点三条 bullet；历史证据追加本 issue。
- `byissue/decisions/001-settings-taxonomy-and-integration-layers.md`：三层规则、Providers 折叠、Usage 独立、hooks 与 enabled 永不联动。
- `docs/design.md` §7：section 折叠的适用条件（为长度而非整洁、默认展开、折叠时给摘要）。
- `docs/glossary.md`：Terminal profile 的 UI 位置。
- `docs/terminal-activity.md`：hook 开关的入口位置与不联动约束。

**遗留（不在本 issue 范围）**

- Usage 的位置调整；Agent profiles 是否也进 provider 弹层；弹层内 metadata/其他长列表是否也折叠。
- 仓库既有失败：`packages/app/src/components/markdown/fence/mermaid/runtime/runtime.browser.test.ts`（本次未触碰该文件）。
