---
kind: issue
title: "清理恒假原生分支与原生文案"
type: refactor
status: open
created: 2026-09-23
---

# 清理恒假原生分支与原生文案

## 进度

### 批次 1（已完成，`44e91ae4b` + `c0e58f742` + `9c0b8a486`，2026-09-23）

F-Droid overlay 整链、Android-only 原生模块 `byspace-native-trace`、10 个零引用原生依赖、退役构建脚本与配置。前置校验拦下两个误删（`react-native-nitro-modules` 是 unistyles 硬 import、`expo-keep-awake` 是 expo 自身依赖）。web bundle 体积基本不变（−1.2 KiB）——收益在磁盘（−5.3 GB）与维护面。

### 批次 2（已完成，`f620c3694`，2026-09-23）

`isNative` 恒假分支（52 个文件）：纯函数签名去掉 `isNative` 参数（`keyboardShortcutsAvailable`、`resolveWorkspaceDeckRetentionLimit`、`resolveModelBrowserScrolling`、app-visibility 谓词）；顺带修复终端虚拟键盘 paste 槽（`isNative` 门控导致 web 上永远空着）与 command center 底部 sheet（`isCompact && isNative` 恒假导致 compact web 永远走桌面 overlay）。

### 批次 3（已完成，`64d162bd1`，2026-09-23）

- **`src/desktop/` 目录整体删除**：desktop-daemon 恒 unavailable shim、desktop-settings 桥（`SettingsDeps.desktop` 声明了但零调用，连守卫测试一起删）、pickDirectory（恒 null，`canBrowse` 又硬编码 false —— Browse 方法双重不可达）、TitlebarDragRegion（8 个调用点渲染 null）、browser panel 注册、DesktopHostBridge 在终端拖放路径的分支（web 只有 legacy `File.path`；win32 引号分支随之删除）。活的 pair-device 两件套迁到 `src/settings/`，`isVersionMismatch`/`formatVersionWithPrefix` 迁到 `src/utils/version-display.ts`。
- **死启动链**：`DaemonStartService` + `shouldStartBuiltInDaemon()`（恒 false）+ daemon-start-service 测试；`startHostRuntimeBootstrap` 收敛为只 boot 注册表；splash 的 retry 改为重置 give-up 门（旧 retry 是 no-op）。
- **`Platform.OS` 恒假分支**（18 处）：Android 状态栏偏移、ToastAndroid、iOS menu teardown grace、model-browser Android 手势包装、iOS 键盘 accessory-bar 补偿（`resolveKeyboardShift` 去 `isIos`；零消费的 `resolveStreamKeyboardInset` 一并删）、两个 sidebar 列表的 `NestableScrollContainer` 包装。
- **`useIsLocalDaemon` 重写**：「本地 daemon」= 服务当前 web UI 的 daemon（注入的 listen 地址匹配浏览器 origin）。此前该 hook 走恒 false 的 desktop 链，把 issue 043 的 daemon-service 区块（Start at login 开关）整体藏死，且让 UpdateDaemonCard 在本地 daemon 上恒显示。
- **文档**：`docs/hover.md` 模式收敛为 `isHovered || isCompact`；`AGENTS.md` gates 表删掉 `isNative` 行与不存在的 `getIsElectron()`（原「需要 Owner 自己改」项已由本批次完成）。

### 留在 047 的

- `utils/desktop-window.tsx`：恒真/恒假 shim 但有 10 个消费方且参与布局（`useOwnsWindowChromeCorner()` 等），需要单独一批逐点改造。
- draggable-list 的手势协调接口（`parentGestureRef`/`waitFor`/`simultaneousGestureRef`/`nestable`）：web 实现忽略它们，但接口是 Metro 双端分派边界，删除需要连同 drag hooks 一起过。
- 恒走 native 的路径：`push-notifications/index.ts` base、`use-file-picker.ts`、`use-image-attachment-picker.ts`、`download-store.ts` Sharing 分支、`pair-scan.tsx` CameraView 分支、`constants/shortcut-platform.ts`（已删一半，`isNative` 分支在批次 2 处理）。
- `push-notifications/internal/subscriptions.ts` 的 Expo push token 链（web 用 Web Push，Expo 链是否可删需先确认通知矩阵）。
- README.md / SECURITY.md / docs/expo-router.md / docs/architecture.md 文案漂移；i18n 的 `pairing.connectionMethods.remoteSsh` 孤儿键（welcome-screen 的 Electron-only 入口已删，settings 入口仍活）。

## 背景

app 只构建 web（`expo export --platform web`），所以 `isNative = Platform.OS !== "web"` 恒为 false，`Platform.OS` 恒为 `"web"`。这些分支不可达，但让「哪些代码路径真的会跑」变得难读，新代码也会照抄。

025 的执行批次清掉了客户端形态本身，034/036 清掉了 browser/voice/hub/plugin 与 Electron 的 UI 面。本事项收尾剩下的活文件分支与文案。

## 验证

每批次：`npm run typecheck` / `npm run lint` / `npm run format:check` + 受影响单测 + web 构建（`npx expo export --platform web`，批次 3 产物 20.2 MB 正常导出）。

## 关闭回写

稳定结论合并进 `byissue/spec/`；`docs/hover.md` 的模式已在批次 3 回写。
