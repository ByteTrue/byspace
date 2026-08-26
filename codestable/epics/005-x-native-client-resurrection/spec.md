---
kind: epic
title: "恢复原生客户端基础"
status: closed
created: 2026-08-26
closed: 2026-08-26
---

# 恢复原生客户端基础

## 这条线要改变什么

本 Epic 从旧 Web-only 裁剪中恢复 Electron、Android 与 iOS 的完整客户端入口，以及 Desktop Browser/CDP、桌面 OS 集成、原生/桌面测试、打包和平台发布源码。Epic 关闭时只完成内部产物；其后 Issue 050 已将 Android 与 Electron Desktop 纳入 Stable/Beta 公开发行，同时把 iOS 固定为 maintained-but-not-published。

这不是复活旧产品快照，也不是另做 Companion：当前 BySpace `main` 始终是产品事实来源，Paseo `v0.5.1` 只提供仍受维护的平台实现。Device Registry、跨设备调用和媒体数据面不在本 Epic 内。

- 来源 Vision：[`codestable/vision/index.md`](../../vision/index.md) — 摘取“同一完整产品跨 Web/Desktop/Mobile 运行”的第一阶段。
- 当前事实：[`codestable/spec/index.md`](../../spec/index.md) — Web/PWA、CLI/daemon、Relay、signed Android APK 与 macOS/Linux/Windows Electron Desktop 是同一 Stable/Beta 公开发行 tuple；iOS 只保留 source/prebuild/test，active CD 不发布。
- 决策证据：[`原生客户端复活与设备能力边界审计`](../../issues/048-x-native-client-resurrection-audit/index.md) — 上游坐标、能力盘点、平台政策、D1–D9 与审计关闭后的完整客户端表面追加决策。

## 当前怎么理解

### 从当前产品移植平台实现

冻结的平台来源是 Paseo `v0.5.1` commit `f517493591a7b4072aa30ee48db13c1a51495103`、tree `fc096ff4bc53515c14a8e53d7d7adc6118f94974`。移植遵守以下边界：

1. 从当前 BySpace `main` 前进，不 revert `v0.2` 删除提交，不 merge/rebase/cherry-pick 上游历史。
2. 复制完整平台纵向切片，并只做 BySpace 品牌、scope、环境变量、路径、永久 app ID、release 边界和当前产品 seam 所要求的机械适配。
3. 若上游实现与当前 BySpace 产品决定冲突、暴露上游缺陷或存在多种合理适配，停止该切片并交还用户决定。
4. 当前协议与状态保持向后可解析；本 Epic 不为 Device Fabric 新增协议，但恢复 Paseo `v0.5.1` Desktop Browser 所需的既有 Browser tools/protocol 纵向切片属于明确范围。

### 一个完整 App，多个真实宿主

- **Web/PWA** 继续是一等完整客户端，现有导出、Hosted Web、daemon-bundled Web 和浏览器旅程不得退化。
- **Android/iOS** 运行同一 Expo Router 应用，恢复配对、Direct/Relay、Workspace/Agent、附件、Terminal、Dictation 和 first-party 插件 Surface 所需的平台边界。
- **Electron** 加载同一 Web renderer，恢复 managed daemon、local transport、typed preload/OS bridge、Desktop Browser workbench/CDP、自动更新运行时和跨平台打包源码，同时保留连接其他 Host 的能力。
- **Desktop Window Chrome** 采用 BySpace 自己的单入口策略：macOS 红绿灯占据独立顶部安全区，左侧栏首个产品入口从安全区下方开始；窗口级不再重复渲染折叠按钮，折叠/展开只由页面内容区 Header 的按钮负责。该决定有意偏离 Paseo `v0.5.1` 的窗口级 + 内容区双入口。
- 平台差异放回 `.native` / `.web`、Expo module/config plugin、Electron main/preload 等真实边界；不在共享业务代码中扩散无归属的平台判断。

### 当前发行边界（由 Issue 050 接续）

上游 EAS/Fastlane/mobile CI、Electron Builder/Nix、auto-updater 与平台发布源码已恢复。当前 Stable/Beta tag 会发布 signed Android APK 与 macOS/Linux/Windows Desktop 资产；iOS 的 EAS workflow definitions 已移出 executable `.eas/workflows/`，只作为参考源码保留，不制作 archive、IPA、TestFlight 或 App Store 提交。

### 本 Epic 不提前建设设备协议

客户端复活只恢复“可以运行原生代码的完整宿主”。未来客户端会成为 Device Capability Provider，但本 Epic 不新增 Device Registry、Capability API、Event/Blob/Stream 路由、端侧跨设备 consent、Share Extension、整机投屏、后台剪贴板或虚拟麦克风。

## 质量约束与取舍

- **功能适宜性**：Web、Android 与 Electron 必须完成现有 BySpace 核心主旅程；Desktop Browser 必须完成打开页面、可信输入、快照/截图/日志和工具调用主旅程；iOS 承诺共享源码、prebuild、可选 simulator 与参考发行源码闭合。
- **兼容性**：Web 行为、daemon/CLI/SDK、协议解析和 Stable/Beta 渠道不得因平台发行改变；Native/Desktop 是真实宿主，不是 Web fallback。
- **可靠性**：Android/Desktop 公开产物必须来自 exact-tag workflow、具有完整 manifest/checksum 和运行 smoke；iOS 不得伪装成已发布。
- **信息安全性**：Android 私钥只进入 GitHub Secrets 和受保护恢复存储；iOS 不执行 daemon 任意下发的动态插件 bundle；Electron Renderer/插件不得获得任意 IPC/CDP。
- **可维护性**：以平台纵向切片和真实宿主边界维护，未来上游同步覆盖所有客户端，并保持 Android/Desktop active publication 与 iOS no-publish 边界。
- **灵活性**：源码不把某一 OS 偶然写成唯一平台；macOS/Linux/Windows/Android 产物结构和 iOS source/prebuild 边界都必须持续验证。

## 现在推什么、先搁什么

### Issues

- [x] [`issues/001-x-native-app-source-closure/index.md`](issues/001-x-native-app-source-closure/index.md) — 已恢复共享 Expo App 的 Native seam、平台覆盖与必要原生模块；冻结依赖下 207 个聚焦测试、Web export、Android/iOS prebuild 与全仓静态检查通过。
- [x] [`issues/002-x-android-artifact-main-journey/index.md`](issues/002-x-android-artifact-main-journey/index.md) — 已生成 `com.bytetrue.byspace` v0.6.0（versionCode 6000）内部侧载 APK，并在隔离 daemon + arm64 Android emulator 上完成 Direct、Relay、冷启动/重连、Workspace、Agent 创建界面、Terminal、文件与设置主旅程；独立审查无 Blocker/High/Medium。
- [x] [`issues/003-x-full-client-surface-policy-reset/index.md`](issues/003-x-full-client-surface-policy-reset/index.md) — 已盘点旧删除面，撤销 D4/仓库 Web-only/同步省略规则，并为每类删除面建立恢复或明确排除的 disposition。
- [x] [`issues/004-x-electron-core-source-package-closure/index.md`](issues/004-x-electron-core-source-package-closure/index.md) — 已恢复 Desktop package、managed daemon、local transport、typed preload 与基础 OS bridge；focused tests、arm64 app/ZIP/DMG package 和真实 macOS 启动/退出 smoke 通过，主 daemon 未被重启。Browser 完整行为由下一检查点验收。
- [x] [`issues/005-x-desktop-browser-system-integration-closure/index.md`](issues/005-x-desktop-browser-system-integration-closure/index.md) — Desktop Browser workbench、CDP automation、daemon broker/tools 与 typed system bridge 已闭合；真实 macOS Electron Browser tab 完成 list/snapshot/screenshot/navigate/wait/evaluate smoke。
- [x] [`issues/006-x-native-desktop-test-dormant-release-closure/index.md`](issues/006-x-native-desktop-test-dormant-release-closure/index.md) — 历史 source-closure 检查点；其“公开渠道休眠”结论已由 Issue 050 的 Android/Desktop 正式发行取代。
- [x] [`issues/007-x-aggregate-multi-client-smoke/index.md`](issues/007-x-aggregate-multi-client-smoke/index.md) — 聚合复核以 271-path 可复现 manifest、跨包调用链和跨构建顺序重验 Web、Android、iOS source/export、Electron 与 Desktop Browser；补齐 Native Push 和 clean-build 两个静默遗漏，独立审查无 Blocker/High/Medium。

### 当前仍不推进

- iOS archive、IPA、TestFlight、App Store 与任何 executable iOS CD。
- Android Google Play/EAS 提交；当前公开渠道是 GitHub Release signed APK。
- 公开插件市场、第三方插件沙箱和 iOS 动态插件政策承诺。
- Device Fabric、File Handoff、Phone Audio、ReplayKit/MediaProjection 与 OS virtual microphone.
- P2P、TURN 或多 daemon Device Mesh。

### 已确认的永久标识

- Android Application ID：`com.bytetrue.byspace`；development variant 使用 `com.bytetrue.byspace.debug`。
- Electron appId：`com.bytetrue.byspace.desktop`；跨平台 URL scheme 为 `byspace`。
- iOS 未来 Bundle ID：production 为 `com.bytetrue.byspace`，development 为 `com.bytetrue.byspace.debug`；Apple Team、账号和 Secrets 只在实际启用 iOS 流水线前需要。
- 这些标识锚定长期发布主体 ByteTrue，不随未来产品域名迁移而改变。

## 关闭时要满足

1. Web export、现有聚焦测试、typecheck、lint、format 全绿，Web 当前行为和协议兼容性不变。
2. macOS Electron package 能运行 managed daemon、使用 local transport 并完成核心主旅程；macOS/Linux/Windows 产物现由同一 exact-tag workflow 公开发布。
3. Desktop Browser workbench 与 Browser tools 完成打开页面、可信输入、快照、截图、日志和 daemon/tool 调用的聚焦测试与运行 smoke，Renderer/插件没有任意 IPC/CDP 权限。
4. Android signed APK 在 emulator 或真实设备通过 Direct 与 Relay 配对并完成核心主旅程，并进入 GitHub Release。
5. iOS 共享源码与 Expo prebuild 闭合；有完整 Xcode 时完成 simulator smoke，但 active CD 不制作或发布签名包。
6. 原生/桌面 E2E、构建、Nix/Electron Builder、auto-updater 与平台发布源码无 Paseo 标识/凭据；Android/Desktop 公开发行与 iOS no-publish 边界由 Issue 050 接续锁定。
7. 旧删除提交和 Paseo `v0.5.1` 当前平台面中的每类受维护切片都有实现证据或明确当前产品 disposition，未来 upstream sync 不再依赖 Web-only 省略规则。
8. 独立只读复核确认平台切片完整、适配有据、没有静默遗漏受维护客户端，也没有用 Paseo marketing-site 替换当前 BySpace website，也没有意外复活旧 Chat/Loops 等明确排除面。
9. 用户验收当前完整客户端边界，并单独授权关闭。

**合并回 Project Spec 的候选：** 正式客户端与发行边界、共享 UI/平台宿主关系、各平台已验证的主旅程。

**Vision 同步检查：** 关闭时只更新实现程度；若实际平台约束迫使目标世界变化，先征得用户确认。

## 关闭结果

用户于 2026-08-26 验收本 Epic 并授权关闭。七个检查点完成了 Android internal journey、Electron/Desktop Browser、iOS source/prebuild、Native Push、平台测试与 271-path 聚合闭包。

2026-08-27 的 Issue 050 接续改变发行边界：Android APK 与 Electron Desktop 进入同一 Stable/Beta exact-tag 公开发布 tuple；iOS 继续保持 source/prebuild/test-only，active CD 不发布。当前事实以 Project Spec、`docs/client-distribution.md`、`docs/release.md` 和 Issue 050 为准，原 Issue 中的 internal/dormant 字样仅记录当时验收阶段。

## 相关材料

- [`原生客户端复活审计`](../../issues/048-x-native-client-resurrection-audit/index.md) — 需要理解为何恢复完整客户端、上游有什么以及哪些能力仍缺失时阅读。
- [`docs/expo-router.md`](../../../docs/expo-router.md) — 修改 App route tree、startup restore 或平台入口前阅读。
- [`docs/client-distribution.md`](../../../docs/client-distribution.md) 与 [`docs/release-engineering.md`](../../../docs/release-engineering.md) — 修改 Android/Desktop public artifacts、iOS no-publish 边界或 release trigger 前阅读。
- [`docs/upstream-sync.md`](../../../docs/upstream-sync.md) — 只取其冻结来源、机械适配、停止条件与验证纪律；本 Epic 是获批产品变化，不推进 upstream baseline。
