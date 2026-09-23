---
kind: issue
title: "清理恒假原生分支与原生文案"
type: refactor
status: open
created: 2026-09-23
---

# 清理恒假原生分支与原生文案

## 范围

**包含：**

- `isNative`（50 个非测试文件）与 `Platform.OS === "ios" | "android"`（16 处）的恒假分支
- `src/desktop/` 剩余孤儿 shim：`browser/{new-tab-requests,resident-webviews,shortcuts,store,panel}.ts`、`hooks/use-daemon-status.ts`、`pick-directory.ts`
- 恒走 native 的路径：`push-notifications/index.ts`（base 是 native no-op，实现在 `.web.ts`）、`use-file-picker.ts`、`use-image-attachment-picker.ts`、`download-store.ts` 的 `Sharing` 分支、`pair-scan.tsx` 的 `CameraView` 分支、`constants/shortcut-platform.ts` 的 `isNative` 分支
- 死环境变量链：`e2e/support/global-setup.ts` 的 `E2E_DESKTOP_RUNTIME` → `BYSPACE_WEB_PLATFORM=electron` → `metro.config.cjs` 的 `customWebPlatform` overlay
- 文档与文案漂移：README、SECURITY.md、docs/expo-router.md、docs/architecture.md、i18n

**不包含：**

- protocol wire schema、COMPAT 标记与存储字段（`releaseChannel`、`serviceUrlBehavior`）
- daemon 侧的 `desktopManaged` / `BYSPACE_DESKTOP_MANAGED`
- react-native-\* 运行时依赖（web 构建依赖其中多数）

## 背景

app 只构建 web（`expo export --platform web`），所以 `isNative = Platform.OS !== "web"` 恒为 false，`Platform.OS` 恒为 `"web"`。这些分支不可达，但让「哪些代码路径真的会跑」变得难读，新代码也会照抄。

025 的执行批次清掉了客户端形态本身，034/036 清掉了 browser/voice/hub/plugin 与 Electron 的 UI 面。本事项收尾剩下的活文件分支与文案。

## 需要 Owner 自己改的一项

`AGENTS.md:153` 把 `getIsElectron()` 列为 `@/constants/platform` 的 gate，但该函数已不存在——`platform.ts` 现在只导出 `isWeb`、`isNative`、`isDev`。AGENTS.md 每次启动都注入，这行会持续诱导后续会话写出对不存在 API 的引用。

ByIssue 不写 `AGENTS.md` / `CLAUDE.md`，需要 Owner 动手。

## 已知边界

`isHovered || isNative || isCompact` 出现在 8 个文件，`docs/hover.md:119` 把它写成了规定模式。删掉 `isNative` 在行为上无变化，但改动必须同时更新文档，否则留下文档与代码互相矛盾。先决定这类写法是「保留为意图表达」还是「统一收敛」，再动手。

## 本次审计新发现，未处理

以下三项属同一类，不在上面已执行的低风险批次里：

- `packages/app` 的 devDependency `eas-cli`（EAS 是原生构建/提交流程，全仓零调用）。
- `knip.json` 的 `ignoreDependencies` / `ignoreBinaries` 里的 `eas-cli`、`expo-module-scripts`、`expo-module`、`xed`、`eas`。
- `packages/app/README.md` 是 `create-expo-app` 模板原文：指导打开 Android emulator / iOS simulator / Expo Go，指向已删除的 `reset-project`，末尾还留有语音时代的 “Dictation debugging”。

## 验证

- `npm run typecheck` / `npm run lint` / `npm run format:check`
- app 单测；web 构建 `npm run build:daemon-web-ui`
- 产物扫描：native-only 库（`expo-camera`、`expo-haptics`、`MaskedView`、`react-native-webview`、`expo-notifications`）若从 bundle 消失，说明对应分支确实不可达；否则说明还有活调用

## 关闭回写

稳定结论合并进 `byissue/spec/`；`docs/hover.md` 若改了模式，回写该文档本身。
