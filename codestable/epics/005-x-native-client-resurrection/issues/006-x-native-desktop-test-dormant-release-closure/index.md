---
kind: issue
id: 6
parent: 5
title: Native/Desktop 测试与休眠发布闭环
status: closed
closed: 2026-08-26
---

# Native/Desktop 测试与休眠发布闭环

## 目标

恢复 Paseo v0.5.1 中仍受维护、且属于 Native/Desktop 客户端闭包的测试、构建与发布源码，并做 BySpace 的机械标识适配；没有凭据和显式人工操作时，公开发布路径必须保持休眠，不能阻塞普通 CI，也不能携带上游账号或签名材料。

## 已交付范围

### Native runtime、配置与测试入口

- 恢复 iOS hardware-keyboard Expo module、共享 JS submit controller 及其聚焦测试；Android 使用共享键盘控制器，不虚构不存在的 Android hardware-keyboard native module。
- 恢复 Android-only native trace Expo module、`nativePerformanceTrace` daemon-client 接线和 Android profileable Config Plugin。
- 恢复 F-Droid autolinking Config Plugin：F-Droid 变体从 Gradle autolinking 排除 camera、notifications 和 dev-client modules，并保留单 ABI version-code 规则。
- 恢复 29 个上游 Maestro flow/helper 文件，覆盖 Direct/Relay 配对、Workspace 创建、侧栏手势、图片选择与命令补全等既有旅程。
- 恢复 `eas.json`、3 个手动 EAS workflow、2 个 Fastlane source 文件、动态 `app.config.js` 和 native release version helper/test。
- 聚合复核时发现 `app.config.js` 没有把 profile/F-Droid 变体写入 `expo.extra`，会令运行时 `isProfileBuild` 永远为 false；现已补齐 `profileBuild`/`fdroidBuild`、恢复 `expo-audio` Config Plugin 与 F-Droid plugin 分支，并新增 4 个回归测试。

### Desktop 构建与发布源码

- 恢复 Electron Builder 的 macOS/Windows/Linux targets、Nix derivation、macOS entitlements、icons、launch/afterPack validation、CDP/titlebar/sim-preview 校验以及 updater/rollout 测试。
- `packages/desktop/build` 的 2 个文件和 `packages/desktop/scripts` 的 13 个文件与冻结上游路径闭合；平台标识已机械改为 BySpace。
- Desktop release workflow 只提供手动 `workflow_dispatch`；`publish` 默认 false，只有操作者显式选择 publish 才写 GitHub Release。普通 push、PR 和 tag 不会触发它。
- Desktop rollout workflow 也只提供手动入口，并要求操作者提供 release tag；常规 CI 不触发。

### Mobile 构建与休眠发布源码

- `packages/app/.eas/workflows` 的 3 个 EAS workflow 全部只提供 `workflow_dispatch`：iOS beta、Android+iOS production build/submit，以及 iOS review resubmit。
- Fastlane 只从运行时环境读取 App Store Connect 凭据；源码没有 Apple Team、key、issuer、证书或 provisioning profile。
- 仓库自有 Android APK workflow 只提供手动入口，要求一个已存在 release tag 和 `EAS_TOKEN`，仅上传 workflow artifact，不自动发布到商店。
- `app.config.js` 固定永久标识：production `com.bytetrue.byspace`、development `com.bytetrue.byspace.debug`、scheme `byspace`。iOS 动态 plugin client bundle 的默认禁用由运行时平台策略负责，不伪装成 App config 能力。

## 冻结上游路径复核

以 `/tmp/byspace-native-source-paseo-v0.5.1.kC0Kjr` 为冻结源逐目录比对，而不是用旧删除提交恢复：

- `packages/app/maestro`：29/29 上游文件存在。
- `packages/app/.eas/workflows`：3/3 上游文件存在。
- `packages/app/fastlane`：2/2 上游文件存在。
- hardware-keyboard module：4/4 路径存在，仅做 Paseo→BySpace 文件名/类名/Pod 名机械替换。
- native-trace module：5/5 路径存在，仅做 package/class/module identity 机械替换。
- `packages/desktop/build`：2/2；`packages/desktop/scripts`：13/13；Desktop 顶层 packaging/Nix 配置存在。
- 运行时、workflow、EAS、Fastlane、Maestro、Desktop build/scripts 的 identity scan 未发现 `@getpaseo`、`sh.paseo`、`paseo://`、`PASEO_*`、getpaseo GitHub/home/relay 域名或上游 release artifact 名称。

这里不再保留先前不可复现的“247/247、213 identical、34 adapted”汇总数字，也不宣称冻结上游没有的 iOS MetricKit、privacy manifest、NativeSuiteTest、自动 EAS update 或 profile heap-capture 能力。

## 验证证据

- `packages/app/app.config.test.ts`：4/4 passed，覆盖永久 ID、profile runtime flag、default plugins 与 F-Droid 分支。
- `packages/app/native-release-version.test.ts`：3/3 passed。
- 一次后续命令同时传入了不存在的 `packages/app/e2e/mobile/native-session-safety.test.tsx` 与 `mobile-main-journey.test.tsx`；Vitest 忽略这两个路径后仍 exit 0，所以它只证明前述 1 file / 3 tests。当前仓库与冻结 Paseo v0.5.1 均没有这两个文件，不把它们计入 source closure。
- `packages/app/src/hooks/hardware-keyboard-submit-controller.test.ts`：聚焦测试通过。
- Android profile prebuild 在保留嵌套 Native module 源码的隔离副本中通过；生成 manifest 包含插件设计要求的 `<profileable android:shell="true"/>`，Android autolinking descriptor 同时解析到 `byspace-native-trace` / `BySpaceNativeTraceModule`。此前一次命令错误断言不存在的 `android:profileable="true"` 属性而 exit 1，不计为产品失败。
- Android F-Droid prebuild passed，并生成排除 camera/notifications/dev-client modules 的 `fdroid-autolinking/package.json`、Gradle project-root override、dependency-metadata 禁用和单 ABI version-code block。
- Android+iOS production prebuild 在隔离源码副本中通过，并生成 `com.bytetrue.byspace` Android namespace/application ID、Xcode target 与 BySpace URL scheme。隔离复制仅排除顶层 `/android`、`/ios`，保留 `modules/*/android` 与 `modules/*/ios` 原生源码。
- `expo-modules-autolinking resolve` 进一步确认 Android 正确解析 `byspace-native-trace` / `BySpaceNativeTraceModule`，Apple 正确解析 `byspace-hardware-keyboard` / `BySpaceHardwareKeyboardModule` / React delegate handler，且两个平台不会交叉链接对方的 platform-only module。
- App Web export、App/Client/Protocol/Server/Desktop typecheck/build、`npm run lint`、`npm run format:check` 与 `git diff --check` 在聚合验证中通过。
- GitHub/EAS workflow YAML 可解析；manual-only trigger、default-no-publish 和 BySpace identity 由静态检查确认。

### 后续聚合纠偏

Issue 007 的跨构建顺序验证发现：本 Issue 关闭时的根 `build:app-deps:clean` 会 clean `@bytetrue/byspace-expo-two-way-audio` 却不重建它，也漏掉显式 `build:client:clean`；所以 `build:desktop` 自身虽然成功，随后直接执行 iOS Native export 会因 `build/index.js` 被删除而失败。聚合检查点已按冻结 Paseo v0.5.1 恢复为 clean-build Client、Plugin、Highlight 并重建 Two-way Audio，增加根脚本回归测试，并验证 Desktop build 后 Audio artifact 仍存在且 iOS export 通过。原关闭记录中的单次 build pass 仍真实，但不能单独证明跨目标构建顺序闭合。

## 明确保留的休眠边界

本检查点恢复的是可运行、可审计的 source closure，不伪装为公开发行：

- 未配置 Apple Team、App Store Connect、Google Play、EAS、Apple certificate/notarization、GitHub Electron release 或 Cloud signing credentials。
- 未执行 signed iOS device archive/TestFlight/App Store、Android Play/EAS public artifact、签名/公证 Desktop 或 Windows/Linux runner smoke。
- 这些渠道只有在用户单独授权、补齐凭据并按 release playbook 执行后才会开启；当前普通 CI 不触发它们。
