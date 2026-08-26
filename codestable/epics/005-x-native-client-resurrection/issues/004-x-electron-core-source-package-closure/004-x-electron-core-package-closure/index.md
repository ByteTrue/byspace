---
title: Electron core/package closure
status: closed
created: 2026-08-26
closed: 2026-08-26
---

# Electron core/package closure

## 目标

把 Paseo v0.5.1 的 Electron 主进程、preload、窗口生命周期、managed daemon、local transport、CLI passthrough、更新器与 macOS packaging source 迁回 BySpace，并产出可启动的 BySpace 桌面包。

本 Issue 只关闭 Electron 核心和 package journey。Desktop Browser/CDP、完整 OS integration、窗口 chrome、更新 UI 与跨平台 E2E 由后续 Issue 005/006 关闭。

## 实施

- 恢复 `packages/desktop/` 完整 source surface；仅保留机械适配：
  - `@getpaseo/*` → `@bytetrue/byspace-*`
  - `PASEO_*` → `BYSPACE_*`
  - `sh.paseo.desktop` → `com.bytetrue.byspace.desktop`
  - `paseo://` → `byspace://`
  - 产品名、CLI、路径和 bundle resources 改为 BySpace
- 恢复 workspace、root scripts、Electron 41、electron-builder 26、`ws`、builder dependencies 与 lockfile。
- 恢复 App renderer 的 Electron runtime / managed-daemon bridge，以及 HostRuntime 启动顺序：先加载 host registry，再决定是否启动 built-in daemon。
- `HostRuntimeStore.boot()` 恢复为幂等 `Promise<void>`，避免 managed daemon decision 与 registry hydration 竞态。
- macOS ad-hoc 内部包增加 `com.apple.security.cs.disable-library-validation` entitlement；否则 modern macOS 会因 nested ad-hoc signatures Team ID 不一致而在启动时拒绝 Electron Framework。正式签名/notarization 仍是独立 release gate。

## 验证证据

### 源码与单测

- `packages/desktop/` 与冻结 Paseo v0.5.1 desktop source 文件集合一致；差异只剩 BySpace CLI 文件名与生成产物。
- Desktop focused tests：23 files / 188 tests passed。
- Host runtime / daemon start tests：3 files / 104 tests passed。
- App typecheck passed。
- Desktop main typecheck/build passed。

### 构建与 package

- `npm run build:desktop` passed：
  - Electron Web export passed；
  - server/client/protocol/plugin build stack passed；
  - Electron main build passed；
  - arm64 `.app`、`.zip`、`.dmg`、blockmaps generated。
- 产物：
  - `packages/desktop/release/mac-arm64/BySpace.app`
  - `packages/desktop/release/BySpace-0.6.0-arm64.zip`
  - `packages/desktop/release/BySpace-0.6.0-arm64.dmg`
- `Info.plist`：`CFBundleIdentifier=com.bytetrue.byspace.desktop`、`CFBundleURLSchemes=byspace`。
- app.asar smoke：BySpace package names present；无 `@getpaseo`、`sh.paseo.desktop`、`paseo://` 残留。

### macOS runtime smoke

- packaged `BySpace.app` successfully launched without dev server。
- Renderer displayed BySpace workspace shell and connected to the already-running daemon on `127.0.0.1:6777` through the restored desktop daemon/runtime path。
- Desktop startup log correctly classified that daemon as `desktopManaged: false`。
- Quit smoke passed；main daemon PID stayed unchanged (`13695` before and after), so Desktop did not restart or terminate the existing daemon。
- Screenshot evidence：`/tmp/byspace-electron-smoke-front.png`。

## 边界与后续

- 当前 arm64 app 使用 ad-hoc signature；没有 Apple certificate、notarization 或 auto-publish。
- 没有在占用主 daemon `6777` 时强制测试 embedded daemon process；其 start/stop/keep-running/local-transport lifecycle 由 focused tests 覆盖，真实 app smoke 验证了 external-daemon adoption 和安全退出。
- Desktop Browser/CDP、native dialog/notification/editor/clipboard、完整 custom titlebar、auto-update UX、Windows/Linux package 与跨平台 E2E 继续由 Epic 005 后续 Issue 关闭。
