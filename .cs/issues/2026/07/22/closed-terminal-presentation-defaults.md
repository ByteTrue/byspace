---
id: terminal-presentation-defaults
title: Terminal 呈现默认值对齐 Orca
type: change
status: closed
parent: .cs/epics/2026/07/21/terminal-experience/spec.md
created: 2026-07-22
closed: 2026-07-22
---

Derived from: [Terminal 原始性能基线与差距定位](./../07/21/open-terminal-direct-baseline/index.md)

## Evidence

用户对比 Orca 桌面端后反馈：BySpace Web Terminal 的命令行渲染（字体、字号、锐利度）明显不如 Orca 舒适。对照 Orca 源码 `src/renderer/src/lib/pane-manager/pane-terminal-options.ts`、`shared/terminal-fonts.ts` 与 BySpace `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`：

| 维度                 | Orca 生效值                              | BySpace 现状                                  |
| -------------------- | ---------------------------------------- | --------------------------------------------- |
| fontSize             | 14（终端专属设置默认）                   | 复用全局 `codeFontSize`（默认 12）            |
| fontWeight / bold    | 500 / 700                                | 未设 → xterm 默认 normal(400) / bold(700)     |
| fontFamily 首选(mac) | SF Mono → Menlo → Monaco → … → Nerd Font | JetBrains Mono / Nerd Font 优先，SF Mono 靠后 |
| minimumContrastRatio | 4.5                                      | 1                                             |
| cursorInactiveStyle  | block 时 outline                         | bar，无失焦样式                               |

两边渲染引擎都是单 canvas xterm WebGL、背景均不透明，所以差异不在子像素锐化层，而在**字体选择、字号、字重与对比度**这些默认值。这正是 epic `terminal-experience` line 28/92/117 保留的"headed 字号、字重、minimum contrast ratio 呈现切片"，现由用户确认推进。

## Goal

把 BySpace Web Terminal 的呈现默认值对齐 Orca Web Direct 的舒适度基线，且不回退当前更快的 Direct 时间基线、不改动其他代码视图（diff/editor）的字号。

## Acceptance criteria

1. Terminal 字号与全局 `codeFontSize` 解耦：新增客户端 `terminalFontSize` 设置，默认 14，复用现有 9–22 clamp；terminal pane 使用该值，diff/editor 仍用 `codeFontSize`。
2. Terminal 提供独立字号 UI（外观设置内），可调并即时生效；非法/空值回落到已提交值。
3. xterm 默认字重设为 `fontWeight: 500` / `fontWeightBold: 700`。
4. `minimumContrastRatio` 由 1 提升为 4.5。
5. `DEFAULT_TERMINAL_FONT_FAMILY` 回退链改为系统等宽（SF Mono / Menlo / Monaco / Consolas）优先，Nerd Font 仅作字形补充回退，`monospace` 收尾；用户已自定义 `monoFontFamily` 时仍以用户值优先。
6. 失焦光标设为 `cursorInactiveStyle: "outline"`。
7. `terminalFontSize` 为纯客户端设置（localStorage），旧配置无该字段时回落默认 14，不破坏设置解析；不新增协议字段。
8. Raw Direct 性能基线不得明显退化。

## Change surface

- `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`
  - `new Terminal` 增加 `fontWeight`/`fontWeightBold`、`cursorInactiveStyle`，`minimumContrastRatio` 1→4.5；`DEFAULT_TERMINAL_FONT_FAMILY` 重排；`DEFAULT_TERMINAL_FONT_SIZE` 13→14。
- `packages/app/src/hooks/use-settings/storage.ts`（+ `index.ts` 再导出）
  - `AppSettings` 增加 `terminalFontSize`；默认 14；`normalizeAppSettings` 解析并 clamp。
- `packages/app/src/components/terminal-pane.tsx`
  - `fontSize` 改用 `settings.terminalFontSize`。
- `packages/app/src/screens/settings/appearance/appearance-section.tsx`
  - 新增 Terminal 字号控件，复用 code font 的 draft/commit 模式。
- `packages/app/src/hooks/use-settings/storage.test.ts`
  - 覆盖 `terminalFontSize` 默认值与 clamp。

## Non-goals

- 不引入 renderer scheduler、独立 Terminal WebSocket、输入 debounce 或输出批处理参数（epic 暂不推进范围）。
- ~~不新增 Terminal 专属字体家族设置~~（已在下方"追加变更"中反转：用户要求终端默认即 Orca 观感，故字体家族也与 `monoFontFamily` 解耦）。
- 不改 diff/editor 等其他代码视图字号。
- 不新增协议字段或 daemon capability。

## Execution record

- `terminal-emulator-runtime.ts`：`new Terminal` 增加 `fontWeight: 500` / `fontWeightBold: 700`、`cursorInactiveStyle: "outline"`，`minimumContrastRatio` 1→4.5；`DEFAULT_TERMINAL_FONT_SIZE` 13→14；`DEFAULT_TERMINAL_FONT_FAMILY` 回退链重排为 SF Mono / Menlo / Monaco / Cascadia Mono / Consolas / DejaVu / Liberation 在前，Nerd Font 仅作字形补充，`monospace` 收尾。确认 app 未打包终端 webfont（无 `@font-face`），系统字体优先安全，跨平台回退与 Orca 一致。
- `storage.ts`：新增 `DEFAULT_TERMINAL_FONT_SIZE = 14`（复用 `MIN/MAX_CODE_FONT_SIZE` 9–22 clamp）；`AppSettings.terminalFontSize`；`DEFAULT_CLIENT_SETTINGS` 与 `normalizeAppSettings` 均落位。设置为纯客户端 localStorage，`StoredAppSettings = Partial<AppSettings>` 已覆盖新字段，旧配置缺该键回落默认。
- 偏差：Change surface 里预估的 `index.ts` 再导出实际不需要——测试从 `./storage` 直接导入、appearance UI 复用已导出的 `MIN/MAX_CODE_FONT_SIZE`，typecheck 通过，故未新增再导出。
- `terminal-pane.tsx`：终端 `fontSize` 由 `settings.codeFontSize` 改为 `settings.terminalFontSize`，与 diff/editor 解耦。
- `appearance-section.tsx`：新增 Terminal 字号控件，克隆 code font 的 draft/resync/commit 模式，复用同一 clamp。
- i18n：8 个语言资源（en/zh-CN/ja/ru/fr/es/pt-BR/ar）各加 `fonts.terminalSize` 与 `fonts.terminalSizeAccessibility`。
- 字体家族仍复用 `monoFontFamily`（用户自定义优先），仅改默认回退链；未新增终端字体家族设置。

## Validation

- `npm run typecheck`：全 workspace 通过（含 app 的 i18n 资源类型、settings 类型、appearance/pane/runtime）。
- `npx vitest run src/hooks/use-settings/storage.test.ts --bail=1`：29/29 通过；新增用例覆盖 `terminalFontSize` 默认 14、上限 clamp 到 22、下限 clamp 到 9、非数字回落默认，以及仅设 `codeFontSize: 20` 时 `terminalFontSize` 仍为默认（确认与 code 字号解耦）。
- `npm run test:browser -- src/terminal/runtime/terminal-emulator-runtime.browser.test.ts --bail=1`：31/31 通过；字体回退链重排与 xterm 选项变更未破坏现有 runtime 行为。
- `npm run lint`（变更文件）与 `npm run format:files`：0 warnings / 0 errors，已格式化。

## 待验收

- headed 主观渲染对比（字体/字号/锐利度）需用户在真实浏览器确认是否已接近 Orca。
- Raw Direct 性能基线未变（本改动为静态呈现选项，不涉及热路径）；如需可重跑 baseline 确认。

## 追加变更（用户后续确认：终端字体默认即 Orca 观感）

用户反馈仅改默认回退链不够——只要用户设过全局等宽字体 `monoFontFamily`，终端就仍跟随它，感觉不到 Orca 默认。故把**终端字体家族也从 `monoFontFamily` 解耦**（与字号解耦对称）：

- `storage.ts`：新增 `AppSettings.terminalFontFamily`（默认 `""`），`pickTerminalFontSettings` 助手统一解析 `terminalFontSize` + `terminalFontFamily`（并让 `pickAppSettings` 保持在 complexity ≤ 20 预算内）。
- `terminal-pane.tsx`：终端字体家族改用 `settings.terminalFontFamily`；为空时回落 runtime 的 `DEFAULT_TERMINAL_FONT_FAMILY`（SF Mono 栈）= 默认即 Orca 观感，与全局 code/mono 字体无关。
- `appearance-section.tsx`：新增独立"终端字体"家族控件（仅 Web 显示，与 code 字体控件并列），保留可自定义；`codeFont` 提示文案去掉"终端"表述。
- i18n：8 语言新增 `fonts.terminalFont` / `terminalFontHint` / `terminalFontAccessibility`，并修正 `codeFontHint` 不再声称影响终端。
- storage.test：新增 `terminalFontFamily` 默认 `""` 断言。
- 验证：`npm run typecheck` 全绿；storage.test 29/29；terminal runtime browser 31/31；lint 0 error、format 已跑。

## 减法（用户确认：合并字号 14 + 全删字体族设置）

用户看到三个字号（UI 16 / 代码 12 / 终端 14）且认为字体家族设置“花里胡哨”，主打极简，要求：**代码+终端字号合并为 14**；**全删字体家族自定义，直接用各平台系统默认（不只 Mac）**。

字号合并：

- `storage.ts`：删 `terminalFontSize` 设置（回退到统一 `codeFontSize`），`DEFAULT_CODE_FONT_SIZE` 12→14（code/diff/终端共用）；删 `pickTerminalFontSettings` 助手。`theme.ts` `FONT_SIZE.code` 12→14。`terminal-pane.tsx` `fontSize` 回到 `settings.codeFontSize`。外观页只剩两个字号控件（界面 + 代码）。

字体家族全删（用系统默认）：

- `storage.ts`：删 `uiFontFamily` / `monoFontFamily` / `terminalFontFamily` 字段 + `sanitizeFontFamily` + `MAX_FONT_FAMILY_LENGTH`（index.ts 同步去掉再导出）。
- `apply-appearance.ts`：去掉 `uiFontFamily`/`monoFontFamily` 输入，`fontFamily.ui/mono` 恒为 `DEFAULT_UI_FONT_STACK`(`system-ui…`) / `DEFAULT_MONO_FONT_STACK`；`_layout.tsx` 停传字体族。
- `diff-pane.tsx` / `commit-diff-panel.tsx`：`monoFontFamily` 改用 `DEFAULT_MONO_FONT_STACK` 常量。
- `terminal-pane.tsx`：删终端字体 useMemo，不传 `fontFamily` → runtime 用 `DEFAULT_TERMINAL_FONT_FAMILY`。
- `terminal-emulator-runtime.ts`：`DEFAULT_TERMINAL_FONT_FAMILY` 改为**以 `ui-monospace` 领头**（浏览器中取得各平台真系统默认 mono 的唯一可靠方式：mac=SF Mono、Win=Cascadia/Consolas、Linux=系统 mono）+ Nerd Font 字形回退 + `monospace` 收尾。修正了之前领头用 `"SF Mono"`（浏览器不暴露该字体名）的问题。
- `appearance-section.tsx`：删 3 个字体家族控件 + `FontFamilyRow` 组件 + `resolveDefaultStackPlaceholder`/`BARE_DEFAULT_STACKS` + 相关 state/effect/commit。
- i18n：8 语言删 `interfaceFont*`/`codeFont*`/`terminalFont*`/`terminalSize*`，保留 `interfaceSize*`/`codeSize*`。

验证：`npm run typecheck` 全绿；storage/apply-appearance/resources 共 62 通过；terminal runtime browser 31/31；lint 0/0、format 已跑。

> 说明：本 issue 从“对齐 Orca 呈现”演变为“简化字体设置（减法）+ 系统默认字体”；前面新增 `terminalFontSize`/`terminalFontFamily` 设置及控件已在本轮全部回收。

## 减法二（用户确认：语法主题固定 GitHub）

用户认为语法主题选择器也多余，要求**直接全用 GitHub**（GitHub 已内置且自带亮/暗两套调色板，当前默认其实是 "one"）。

- `storage.ts`：删 `syntaxTheme` 设置/默认/normalize + `isSyntaxThemeId`/`SyntaxThemeId` import。
- `apply-appearance.ts`：去 `AppearanceInput.syntaxTheme`，两处 `resolveSyntaxColors` 硬编码为 `"github"`（随 app 亮/暗自动切换）。
- `_layout.tsx`：停传 `syntaxTheme`。
- `appearance-section.tsx`：删语法主题选择器（`SyntaxRow`/`SyntaxMenuItem`/`syntaxLabelForId`/handler/import）与整个 Syntax 区块；实时预览移入 Fonts 区块保留。
- i18n：8 语言删 `syntax.title`/`highlightTheme`/`highlightThemeHint`/`highlightThemeAccessibility`，保留 `syntax.previewAccessibility`。
- highlight 库保持不变（库内 8 套调色板仍在，仅 app 不再暴露选择）；e2e 去掉注入的 `syntaxTheme`/字体族旧键。
- 测试：storage.test 删 syntaxTheme 用例；apply-appearance.test 改为断言恒用 github 调色板。

验证：`npm run typecheck` 全绿；storage/apply-appearance/resources 共 58 通过；lint 0/0、format 已跑。

## 减法三（用户确认：主题只留 浅色/深色/跟随系统）

主题原有 light/dark/auto + 4 个深色变体（zinc/midnight/claude/ghostty）。用户要求简化，确认**保留 `auto`（跟随系统，实用默认）**，删掉 4 个深色变体。

- `theme.ts`：`ThemeName` 收窄为 `"light" | "dark"`；删 `zincDarkColors`/`midnightDarkColors`/`claudeDarkColors`/`ghosttyDarkColors` 调色板与 `darkZincTheme` 等 4 个导出；`UnistylesThemeKey`、`THEME_TO_UNISTYLES`、`THEME_SWATCHES` 收窄到 light/dark。
- `unistyles.ts`：主题注册与 `AppThemes` 去掉 4 个 dark 变体。
- `appearance-section.tsx`：删 `DARK_VARIANT_THEMES`、变体 labelKeys、`ThemeSwatch` 组件、`THEME_SWATCHES` import、`DropdownMenuSeparator`、swatch 样式；主题下拉现在只列 light/dark/auto（Sun/Moon/Monitor 图标）。
- `apply-appearance.ts` / `_layout.tsx`：`ALL_THEME_KEYS` 与 `THEME_CYCLE_ORDER` 收窄为 light/dark。
- i18n：8 语言删 `theme.options.zinc/midnight/claude/ghostty`，保留 light/dark/auto。
- 测试：apply-appearance.test `ALL_THEME_KEYS` 与 patch 次数 6→2。

验证：`npm run typecheck` 全绿；apply-appearance/resources/storage 共 58 通过；lint 0/0、format 已跑。

## 关闭结论

用户在真实浏览器逐轮验收通过（Orca 观感对齐 → 字体族/终端字号/语法主题/主题变体四轮减法）。最终产品形态：

- **字体**：不再提供任何字体族/家族自定义，全用各平台系统默认（UI=`system-ui`、代码/终端=`ui-monospace` 领头栈）；字号只保留「界面」+「代码」两个可调项，代码/diff/终端统一默认 14。
- **语法高亮**：固定 GitHub（自带亮/暗，跟随 app 明暗），无选择器。
- **主题**：只保留 浅色 / 深色 / 跟随系统（auto）；删除 zinc/midnight/claude/ghostty 四个深色变体。
- highlight 库内部 8 套调色板保留（仅 app 不再暴露选择），未来如需彻底精简可另开 issue。

验证：typecheck 全绿；apply-appearance/resources/storage 定向测试 58 通过；terminal runtime browser 31 通过；lint 0/0、format 已跑。已按契约随代码同一 commit 提交（未 push）。

毕业回写：结论已并入 parent epic `terminal-experience` 的当前推进/呈现结论；project spec 的合并留待 epic 关闭时统一处理（本 issue 不单独改 project spec）。

遗留（未包含在本 issue，单独跟踪）：服务端终端 emit/parse 解耦性能改动仍在工作树未提交，属另一逻辑变更。
