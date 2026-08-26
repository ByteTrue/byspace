---
kind: issue
id: 6
parent: 5
title: Native/Desktop 测试与历史发布源码闭环
status: closed
closed: 2026-08-26
---

# Native/Desktop 测试与历史发布源码闭环

## 历史检查点与当前状态

本 Issue 在 Epic 005 阶段恢复 Paseo v0.5.1 中仍受维护的 Native/Desktop 测试、构建与发布源码，并完成 BySpace 身份适配。它关闭时只证明 source closure 和内部构建，不再定义当前发行边界。

2026-08-27 的 [Issue 050](../../../../issues/050-o-full-client-release-gate/index.md) 已取代原来的 dormant/internal 结论：

- Android 与 Electron Desktop 是 Stable/Beta 必需公开发布面；
- Android 从 exact tag 生成使用固定 BySpace v1 更新密钥签名的 APK；
- Electron 从同一 exact tag 生成 macOS arm64/x64、Linux x64、Windows x64/arm64 资产和 updater metadata；
- iOS 只维护源码、prebuild、测试、Fastlane/EAS 参考源；active CD 不构建、不提交、不上传 iOS；
- 当前工作流、凭据与发布验证事实以 `docs/client-distribution.md`、`docs/release.md` 和 `.github/workflows/client-release.yml` 为准。

## 已交付源码闭包

### Native runtime、配置与测试入口

- iOS hardware-keyboard Expo module、共享 JS submit controller 及其聚焦测试；Android 使用共享键盘控制器，不虚构不存在的 Android hardware-keyboard native module。
- Android-only native trace Expo module、`nativePerformanceTrace` daemon-client 接线和 Android profileable Config Plugin。
- F-Droid autolinking Config Plugin：F-Droid 变体从 Gradle autolinking 排除 camera、notifications 和 dev-client modules，并保留单 ABI version-code 规则。
- 29 个上游 Maestro flow/helper 文件，覆盖 Direct/Relay 配对、Workspace 创建、侧栏手势、图片选择与命令补全等既有旅程。
- `eas.json`、Fastlane source、动态 `app.config.js` 和 native release version helper/test。
- `app.config.js` 的 `profileBuild`/`fdroidBuild` runtime flags、`expo-audio` Config Plugin、F-Droid plugin 分支及回归测试。

### Desktop 构建与发布源码

- Electron Builder 的 macOS/Windows/Linux targets、Nix derivation、macOS entitlements、icons、launch/afterPack validation、CDP/titlebar/sim-preview 校验以及 updater/rollout 脚本。
- `packages/desktop/build` 与 `packages/desktop/scripts` 的冻结上游路径闭包，平台标识机械适配为 BySpace。
- 当前 active publisher 已统一为 `.github/workflows/client-release.yml`；旧 Desktop/manual rollout workflow 已删除，避免 `--clobber` 或 tag/source 分离。

### Mobile 发布源码

- Production Application ID 固定为 `com.bytetrue.byspace`，development 为 `com.bytetrue.byspace.debug`，scheme 为 `byspace`。
- Android release signing 由 `with-android-release-signing.js` 注入；CD 缺少必需签名凭据时 fail closed。
- 旧 EAS/iOS workflow 保存在 `packages/app/release-source/eas-workflows/` 非执行参考目录，不能被 GitHub/EAS active CD 自动发现。
- Fastlane 仍作为受维护的 iOS 手工参考源码；仓库没有 Apple Team、certificate、provisioning profile 或 App Store Connect secret。

## 冻结上游路径复核

恢复来源为冻结 Paseo `v0.5.1` commit `f517493591a7b4072aa30ee48db13c1a51495103`、tree `fc096ff4bc53515c14a8e53d7d7adc6118f94974`，不是旧删除提交：

- `packages/app/maestro`：29/29 上游文件存在；
- hardware-keyboard module：4/4 路径存在，仅做 Paseo→BySpace 文件名、类名与 Pod 名机械替换；
- native-trace module：5/5 路径存在，仅做 package/class/module identity 机械替换；
- `packages/desktop/build`：2/2；`packages/desktop/scripts`：13/13；Desktop 顶层 packaging/Nix 配置存在；
- 运行时、发布参考源码、Maestro 与 Desktop build/scripts 的 identity scan 未发现 `@getpaseo`、`sh.paseo`、`paseo://`、`PASEO_*` 或上游 release artifact 名称。

## 验证证据

- `packages/app/app.config.test.ts` 覆盖永久 ID、profile runtime flag、default plugins 与 F-Droid 分支；Android release-signing plugin 另有聚焦测试。
- `packages/app/native-release-version.test.ts`：3/3 passed。
- hardware-keyboard submit controller 聚焦测试通过。
- Android production/profile/F-Droid prebuild、Android/iOS production prebuild与平台 autolinking 检查均在 Epic 005 聚合验证中通过；隔离复制使用 root-anchored `/android`、`/ios` 排除，保留 `modules/*/android` 与 `modules/*/ios` 源码。
- `expo-modules-autolinking resolve` 确认 Android 解析 native trace、Apple 解析 hardware keyboard，两个平台不会交叉链接对方的 platform-only module。
- Issue 007 修正 `build:app-deps:clean` 后，Desktop→Native 跨构建顺序通过，Two-way Audio 产物不会被 Desktop clean-build 留空。
- 当前 active client publisher、签名 gate、公开资产矩阵、updater 引用、checksum、manifest 与 no-iOS policy 由 Issue 050 的静态/产物测试和发布后验证负责。
