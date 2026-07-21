---
id: terminal-windows-bracketed-paste-fallback
title: Windows Terminal 强制保留 paste block 语义
type: bug
status: closed
parent: .cs/epics/2026/07/21/terminal-experience/spec.md
created: 2026-07-21
closed: 2026-07-21
---

# Windows Terminal 强制保留 paste block 语义

## 证据

snapshot mode-2004 恢复修复了已观测状态丢失，但 Orca 源码揭示了第二个 Windows 边界：ConPTY 可能根本不把应用发出的 DECSET 2004 交给 renderer。此时 xterm mode 为 false，多行 clipboard 文本仍会被解释成逐行 Enter。Orca 因而在 Windows user agent 下对所有含换行 clipboard 文本强制 bracketed framing，并对生成的图片路径始终强制 framing。

## 目标

- Windows 多行浏览器 clipboard 文本不依赖 renderer 是否观测到 DECSET 2004，始终作为一个安全的 bracketed block 进入 PTY。
- daemon 返回的 clipboard 图片路径在所有平台都作为一个 bracketed block 进入 PTY。
- 单行文本和非 Windows 多行文本继续遵循 xterm live mode，不全局改变 shell paste 语义。

## 实现

`terminal-emulator-runtime.ts` 增加一个与 xterm paste 行为对齐的强制入口：换行规范化为 CR、ESC 替换为可见字符 `U+241B`，再通过 `Terminal.input()` 一次发送 `CSI 200 ~ + payload + CSI 201 ~`。Windows 多行文本与图片路径使用该入口，其余文本仍调用 `Terminal.paste()`。

## 验证

- Browser runtime：31/31；覆盖 mode 2004 未启用时快捷键与 context-menu paste event 的 Windows 多行 framing、ESC 净化、图片路径强制 framing、Alt+V fallback。
- 隔离 daemon Browser E2E：4/4；capture PTY 明确保持 mode 2004 off，仍收到单个多行 block 与真实上传图片路径 block；snapshot restore 用例继续通过。
- 真实 Windows ConPTY + headed Chrome + Pi CLI 仍需用户最终手感验收；当前自动化使用 Windows user agent/platform，但 PTY host 是 macOS。
