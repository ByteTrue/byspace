---
kind: issue
title: "清理恒假原生分支与原生文案"
type: refactor
status: closed
created: 2026-09-23
closed: 2026-09-23
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
- **文档**：`docs/hover.md` 模式收敛为 `isHovered || isCompact`；`AGENTS.md` gates 表删掉 `isNative` 行与不存在的 `getIsElectron()`。

### 批次 4（已完成，2026-09-23）

- **`utils/desktop-window.tsx` 垫片层整体删除**：清除了全部 10 个消费点（presentation, fullscreen-viewer, attachment-lightbox, explorer-sidebar, workspace-screen, workspace-explorer-toggle, screen-header, split-container, menu-header, left-sidebar, compact-explorer-sidebar），去掉对不存在的 Electron 窗口控制（全屏、红绿灯避让、窗口角落占用）的虚假调用，各容器直连标准 View。
- **已退役能力的孤儿设置与 i18n 清理**：清理了旧版 WebView 终端渲染器残留设置 `useLegacyTerminalRenderer`（storage 字段、默认值、schema、单测、9 国语言 i18n 资源文件）；清理了 `updateRequired` 中已退役的 "BySpace Desktop" 措辞。
- **文档与 README 纠偏**：`packages/app/README.md` 重写为现代 Expo Web/PWA 说明（去掉 Expo 模板残留的移动端模拟器/Expo Go/已删除的 reset-project/语音调试）；同步修正 `SECURITY.md`、`docs/architecture.md`、`docs/expo-router.md`。
- **明确 PWA 主力边界**：PWA（手机与电脑端）能用到的能力均非僵尸代码。`expo-haptics`（Android PWA 下真实触发 W3C Vibration API `navigator.vibrate`）和 `expo-camera` / `pair-scan`（手机端 PWA 扫码配对核心流程）全部完整保留。

## 背景

app 只构建 web（`expo export --platform web`，主打浏览器与安装式 PWA），所以 `isNative = Platform.OS !== "web"` 恒为 false，`Platform.OS` 恒为 `"web"`。但 PWA 自身具备完整的 Web API 能力（如 Vibration、MediaDevices/Camera、Web Push、Web Share 等），不能把移动 PWA 能力误判为原生残留。

## 验证

每批次：`npm run typecheck` / `npm run lint` / `npm run format:check` + 受影响单测 + web 构建（`npx expo export --platform web` 正常导出）。

## 关闭回写

稳定结论合并进 `byissue/spec/`；`docs/hover.md` 的模式已在批次 3 回写。
