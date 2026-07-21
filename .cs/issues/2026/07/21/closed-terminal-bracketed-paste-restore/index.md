---
id: terminal-bracketed-paste-restore
title: 恢复 snapshot 后的 bracketed paste 语义
type: bug
status: closed
parent: .cs/epics/2026/07/21/terminal-experience/spec.md
created: 2026-07-21
closed: 2026-07-21
---

# 恢复 snapshot 后的 bracketed paste 语义

## 目标

当终端应用启用 DEC private mode 2004 后，无论浏览器是从 live output 还是 snapshot attach/restore 建立画面，多行文本 paste 都必须作为一个 bracketed paste block 进入 PTY，而不是把每一行解释为 Enter。

## 用户反馈

- 场景：Windows 浏览器中的 BySpace Terminal 运行 Pi CLI。
- 预期：粘贴多行文本时，Pi 编辑器一次收到整块文本。
- 实际：每个换行触发一次提交/Enter。
- 影响：即使 Direct 输入延迟很低，也不具备原生 Terminal 的基本输入语义。

## 反馈回路

- 最小红测：`packages/app/src/terminal/runtime/terminal-emulator-runtime.browser.test.ts`。
- 当前失败：xterm 直接收到 `CSI ? 2004 h` 后 paste 正确；执行 `renderSnapshot()` 后 paste 只输出裸文本。
- 快速命令：
  - `npm --prefix packages/app run test:browser -- src/terminal/runtime/terminal-emulator-runtime.browser.test.ts`
  - `npx vitest run packages/protocol/src/terminal-input-mode.test.ts --bail=1`
- 通过信号：snapshot 前后都输出 `CSI 200 ~ + text + CSI 201 ~`；显式关闭 2004 或从未启用时仍输出普通 paste。

## 现状如何工作

```text
PTY output
  → worker TerminalInputModeTracker.feed()
  → getReplayPreamble()
  → daemon snapshot restore frame
  → browser renderSnapshot() prepends ESC c
  → daemon replays preamble
  → buffered live output
```

`TerminalInputModeTracker` 已经是 authoritative worker state，并负责 Kitty keyboard 与 ConPTY Win32 input mode 的 snapshot preamble。浏览器 runtime 也复用同一个 tracker 给 modified Enter 编码提供状态。

## 根因定位

- xterm 的 `Terminal.paste()` 正确遵守 DECSET 2004。
- `renderSnapshot()` 为重建权威画面发送 `ESC c`，按规范清空 private modes。
- server 的 replay preamble 只包含 Kitty keyboard 和 Win32 input mode，没有记录或恢复 private mode 2004。
- 状态第一次变坏的位置是 `TerminalInputModeTracker` 对 2004 的遗漏；在浏览器强制包装多行文本只能遮住根因，并会破坏未启用 bracketed paste 的普通应用。

## 影响分析

### 必须修改

- `TerminalInputModeState` 增加 bracketed paste 启用状态。
- `TerminalInputModeTracker` 跟踪 `CSI ? 2004 h/l`，在 reset、state equality 与 replay preamble 中保持一致。
- 更新所有显式构造 `TerminalInputModeState` 的调用方与测试。

### 需要验证

- snapshot 前后 bracketed paste 都保持一个 paste block。
- 2004 disable 和默认状态不被强制包装。
- Kitty keyboard、Win32 input mode、modified Enter、Alt+V 透传不退化。
- 只扩展现有 regex/feed/preamble，不增加 output pipeline 的额外扫描或协议帧。

### 不在范围

- 浏览器图片 clipboard 上传；由独立 Issue 处理。
- 强制所有 multiline paste 使用 bracket markers。
- renderer scheduler、独立 Terminal WebSocket、主题或字体调整。

## 质量目标

- 功能适宜性：多行 paste 在 Pi CLI 等启用 mode 2004 的应用中保持文本块语义。
- 可靠性：snapshot、恢复和首次 attach 不改变输入协议状态。
- 兼容性：未启用 mode 2004 的应用行为不变；不改 WebSocket schema 或 binary frame。
- 性能效率：复用现有 output tracker 和 replay preamble，不新增 output pass。
- 可维护性：扩展唯一 authoritative input-mode 模块，不在 app/server 各自加特例。

## 实现设计

1. 在现有 `TerminalInputModeState` 和 tracker 中加入 `bracketedPasteMode`。
2. 复用 private mode parser，在同一 `CSI ? ... h/l` 中分别更新 2004 与 9001。
3. active 时把 `CSI ? 2004 h` 放入现有 replay preamble。
4. 先让协议 tracker 单测覆盖 enable/disable/split/mixed mode，再让真实 Chromium 红测转绿。
5. 保留 Alt+V runtime 测试，证明修复没有改写普通应用快捷键。

## 执行记录

- `TerminalInputModeState` 增加 `bracketedPasteMode`，authoritative tracker 在现有 DEC private mode parser 中处理 `CSI ? 2004 h/l`。
- `getPreamble()` 在 mode 2004 active 时追加 `CSI ? 2004 h`；snapshot reset 后由现有 replay preamble 恢复，不修改 WebSocket schema 或 output pipeline。
- `terminal-pane.tsx` 的显式初始/重置 state 同步新字段。
- Protocol 单测覆盖 enable、disable、split sequence 与 mixed mode；真实 Chromium runtime 测试覆盖 snapshot reset + authoritative preamble 后的多行 paste block。

## 验证

- `npx vitest run packages/protocol/src/terminal-input-mode.test.ts packages/protocol/src/messages.terminal-restore.test.ts --bail=1`：14/14 通过，其中 input-mode 12/12。
- `npm --prefix packages/app run test:browser -- src/terminal/runtime/terminal-emulator-runtime.browser.test.ts --bail=1`：26/26 通过；包含 snapshot 前后 bracketed paste、文本优先、超限图片和 Alt+V 透传。
- `npm --prefix packages/app run test:e2e -- e2e/terminal-clipboard.spec.ts --workers=1`：2/2 通过；Windows platform 的页面 reload/snapshot 后，PTY 收到且只收到 `CSI 200 ~ + first line CR second line + CSI 201 ~`。
- `BYSPACE_TERMINAL_PERF_E2E=1 npm --prefix packages/app run test:e2e -- e2e/terminal-direct-baseline.spec.ts --workers=1`：1/1 通过；idle p95 8.7ms、loaded p95 10.3ms、TUI p95 9.6ms、50k parse 95.0ms、resize p95 20.6ms，无明显退化。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、App Web export 与 `git diff --check`：通过。

## 关闭回写

关闭时把以下稳定结论毕业到 Epic / Project Spec：snapshot 重建会重置终端私有模式，所有影响输入编码的权威模式必须由 worker tracker 捕获并通过 replay preamble 恢复。
