---
kind: issue
title: "终端深浅色可独立于应用主题配置"
type: ff
status: closed
created: 2026-09-15
closed: 2026-09-15
---

# 终端深浅色可独立于应用主题配置

## 做了什么

新增 `terminalAppearance` 应用设置（`match` / `dark` / `light`，默认 `match` 沿用现状）。设为 `dark` 时应用可以是浅色主题而终端保持深色；反之亦然。解析语义：强制档只在活动主题处于另一侧时才替换——应用本身已是某深色变体（midnight/zinc/claude 等）时选 `dark` 仍保持该变体自己的终端配色，不强行切回 paseo dark。

终端面板内的全部表面跟随解析后的终端主题：xterm 调色板、容器/输出区背景、错误行、移动端虚拟键盘（按钮背景/边框/文字）、加载 spinner、断连文案。webview 与 legacy 渲染器无需改动（ITheme 经 TerminalEmulator `setTheme` 传播）。

## 改了哪些

- `packages/app/src/hooks/use-settings/storage.ts`：`TerminalAppearance` 类型 + `AppSettings.terminalAppearance` + schema（`catch("match")`，旧存量免迁移）+ 默认值；
- `packages/app/src/hooks/use-settings/index.ts`：re-export `TerminalAppearance`；
- `packages/app/src/appearance/terminal-theme.ts`（新）：`resolveTerminalTheme(active, preference)`；
- `packages/app/src/appearance/terminal-theme.test.ts`（新）：5 个用例；
- `packages/app/src/components/terminal-pane.tsx`：`terminalTheme` memo 取代直接用 app theme 的 xterm 调色板；容器/错误行/键盘条 inline 色值覆盖；虚拟键盘三组件改收 `TerminalKeyPalette` prop；样式表仅保留布局；
- `packages/app/src/screens/settings/appearance/appearance-section.tsx`：主题卡片下新增 `TerminalAppearanceRow` 下拉（跟随应用/深色/浅色，带图标）；
- `packages/app/src/i18n/resources/{en,zh-CN,ja,ko,es,fr,pt-BR,ru,ar}.ts`：`settings.appearance.terminal.*` 9 键全语言补齐。

## 怎么验证的

- `npx vitest run src/appearance/terminal-theme.test.ts src/i18n/resources.test.ts src/hooks/use-settings --bail=1`：全过（5 + 123）；
- `npm run typecheck`：全 workspace 通过；
- `npm run lint`：0 warnings / 0 errors；
- `npm run format:check`：通过。

## 对 codestable/ 的影响

- 无影响（新增独立设置，不改既定模型）。

## 后续修正（commit fcfc28ff4）

浏览器 QA 发现 i18n 插入点错误：`terminal` 块被插进了 `appearance.theme` 内部（代码读 `appearance.terminal`），设置行渲染原始 key。9 语言同样错位所以 key-parity 测试查不出来——嵌套位置是 parity 的盲区。已移位，并在 `resources.test.ts` 加 `settings.appearance.terminal` 断言、在 `terminal-theme.test.ts` 加「浅色应用 + 强制深色终端」的实际调色板断言。

## 顺手发现

- `terminal-pane.tsx` 使用 `useUnistyles()`（docs/unistyles.md 禁用清单中的遗留调用点），本次未新增调用，仅复用该既有订阅派生 `terminalTheme`。
