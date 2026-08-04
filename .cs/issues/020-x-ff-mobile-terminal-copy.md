---
kind: issue
title: "移动端 Terminal 长按复制"
type: ff
status: closed
created: 2026-08-04
epic: ".cs/epics/2026/07/21/terminal-experience/spec.md"
---

# 移动端 Terminal 长按复制

## 做了什么

让紧凑 Web 布局下的 Terminal 支持长按选词、拖动扩展选区，并通过选区旁的复制按钮写入浏览器剪贴板；原有点击输入、纵向滚动和横向切换手势保持不变。

## 改了哪些

- `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts` — 在既有 touch 手势层加入长按选择与拖动扩选，兼容 xterm mouse tracking 和双宽字符 cell。
- `packages/app/src/components/terminal-emulator.tsx`、`packages/app/src/components/terminal-pane.tsx` — 向 pane 暴露选区状态，在 compact 布局显示复制入口。
- `packages/app/src/terminal/runtime/terminal-emulator-runtime.browser.test.ts` — 覆盖长按选词、拖动扩选、mouse tracking 与 CJK 双宽字符。
- `packages/app/e2e/terminal-clipboard.spec.ts` — 在 `390×844` 视口以可信 CDP touch 验证拖选、手势仲裁、复制按钮和系统剪贴板结果。

## 怎么验证的

- Browser Vitest：`terminal-emulator-runtime.browser.test.ts` 37/37 通过；定向 Playwright 移动视口复制用例 1/1 通过。
- `npm run typecheck`、`npm run lint`、`npm --workspace @bytetrue/byspace-app run build:web`、`git diff --check`：通过。

## 对 .cs/ 的影响

无已记录真相受影响：这是 Terminal experience epic 内 compact Web 交互缺口的修复，不改变 Terminal 协议、stream 所有权或 clipboard 上传语义。
