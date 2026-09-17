---
kind: issue
title: "修复 Windows 下思考加载图标定格与终端 OSC 8 链接打开无反应"
type: ff
status: closed
created: 2026-09-03
closed: 2026-09-03
---

# 修复 Windows 下思考加载图标定格与终端 OSC 8 链接打开无反应

## 做了什么

1. **会话思考/加载中指示器（`SyncedLoader`）解除 reduced-motion 阻断**：
   移除 `useReducedMotion()` 对状态指示器时钟调度的拦截，确保在 Windows 默认开启或配置“关闭系统动画”、省电或远程桌面模式下，加载点阵动画依然保持循环转动，避免界面呈现假死在第一帧的竖排三点状态。
2. **Terminal 配置 OSC 8 `linkHandler`**：
   在终端运行时创建 `Terminal` 实例时补全 `linkHandler`，捕获 Pi 及现代命令行工具输出的富文本超链接（OSC 8），消除浏览器原生的危险提示弹窗（`WARNING: This link could potentially be dangerous`），并统一路由至跨平台安全外部链接打开链路（桌面端直接调用系统默认浏览器打开，Web 端走安全新标签页）。

## 改了哪些

- `packages/app/src/components/synced-loader.tsx`：移除 `useReducedMotion`，保留面板激活态监听，确保关键状态指示器无论系统减弱动画设置与否均正常运转；
- `packages/app/src/components/synced-loader.test.tsx`：新增单测，覆盖系统级 reduced-motion 激活下依然调度 UI 动画监听；
- `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`：在 `new Terminal` 配置中挂载 `linkHandler`，点击 OSC 8 链接直接调用 `onOpenExternalUrl`；
- `packages/app/src/terminal/webview/terminal-emulator-webview-html.ts`：同步重新生成 Native WebView 预编译 HTML bundle，确保移动端终端（iOS/Android WebView）同步支持 OSC 8 超链接；
- `packages/app/src/terminal/runtime/terminal-emulator-runtime.test.ts`：新增单测，验证终端正确注册 `linkHandler` 并路由点击事件至 `onOpenExternalUrl` 回调。

## 怎么验证的

- `npm run --workspace packages/app test -- src/components/synced-loader.test.tsx src/terminal/runtime/terminal-emulator-runtime.test.ts`：2/2 files passed, 21/21 tests passed；
- `npm run typecheck`：全 workspace 通过；
- `npm run lint`：0 warnings / 0 errors；
- `npm run format:check`：格式完全一致。

## 对 .codestable/ 的影响

- 维护了终端外部链接交互体验，消除了 xterm 默认警告弹窗在 Electron 中的阻断缺陷；
- 维护了关键运行时加载状态的可用性。
