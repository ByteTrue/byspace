---
kind: issue
title: "恢复 Native App 源码闭包"
type: feature
status: closed
created: 2026-08-26
closed: 2026-08-26
---

# 恢复 Native App 源码闭包

> **当前发行状态（2026-08-27）：** 本 Issue 记录 Epic 005 的源码恢复检查点；其中“不承诺安装包/发布”的范围限制已由 [Issue 050](../../../../issues/050-o-full-client-release-gate/index.md) 取代。Android 现随 Stable/Beta 发布签名 APK，Electron Desktop 发布三平台资产；iOS 仍只维护源码、prebuild 与测试，active CD 不构建、不提交、不上传。

## 做成以后是什么样

当前 BySpace Expo App 重新拥有 Android/iOS 所需的共享平台判定、原生入口、platform override、Expo module/config plugin 与双向音频源码。Web 仍从同一包导出并保持现有行为；Android/iOS 可以从源码生成原生工程，但本 Issue 不承诺真实安装包或设备运行。

**包含：** `packages/app` 的 Native source/config/dependency closure、`packages/expo-two-way-audio`、必要 workspace/lockfile/patch、与该切片耦合的上游测试。

**不包含：** Electron、永久 App ID、真实 APK/IPA、签名与发布流水线、Device Fabric、Share Extension、整机投屏、后台剪贴板、虚拟麦克风、Browser Automation。

**来源：** Paseo `v0.5.1` commit `f517493591a7b4072aa30ee48db13c1a51495103`、tree `fc096ff4bc53515c14a8e53d7d7adc6118f94974`。当前 BySpace `main` 是产品基线；旧 `v0.2` 删除提交只作历史证据。

## 现状怎样阻断 Native

App 仍保留部分 `isNative` 分支，但平台模块把 Native 固定为 false，原生文件覆盖、Expo modules 和相关依赖已被删除。这种状态只够 Web 构建，不能作为“稍后打开一个开关”恢复：完整 source closure 必须与当前共享 App、当前插件系统和当前依赖一起重新对齐。

## 方案与停止条件

1. 在隔离的 Paseo checkout 冻结目标对象并建立平台纵向切片清单，不把 commit/file 清单当成逐项移植队列。
2. 先恢复 Native 基础模块与 dependency closure，再接回 platform override 和 App 配置；每个小步用最小编译或聚焦测试引导。
3. 只做确定的 BySpace 品牌、npm scope、环境变量、路径和当前产品 seam 适配；不复制 Paseo 正式标识、凭据或发布资源。
4. Web 专用实现与 Native 实现应通过现有 `.web` / `.native` 或平台模块边界共存，不把平台分支散进无关业务组件。
5. 上游切片若依赖 BySpace 已明确删除的产品行为，先确认能否机械省略；若会改变当前产品、插件安全边界或协议，停止并请用户决定。

`app.config.js` 是动态配置，Expo 不能自动回写匿名标识；源码验证时必须用临时 `BYSPACE_APP_ID` 注入未发布标识，生成目录不提交。任何真实 artifact 之前仍必须由用户确认永久标识。

## 质量承诺

- **功能适宜性**：Android 与 iOS `expo prebuild --no-install` 能从干净源码完成；相关平台 helper/module 测试通过。
- **兼容性**：Web export 继续成功，现有 Web 路由、Hosted/daemon-bundled Web 与协议行为不改变。
- **可维护性**：恢复完整平台切片，不留下 false/null stub 或平行第二套 App；测试与调用方穿过正式平台边界。
- **信息安全性**：不引入上游 signing material、正式 app identifier、Apple/Google credential，也不启用 iOS 动态插件执行。

## 验证

按依赖顺序执行，生成输出的命令不并行：

1. 改动文件对应的聚焦 Vitest。
2. `npm run build:app-deps`。
3. `npm run typecheck --workspace=@bytetrue/byspace-app`。
4. `npm run build:web --workspace=@bytetrue/byspace-app`。
5. 在临时生成目录或可清理工作区执行 Android/iOS `expo prebuild --no-install`，证明 Config Plugin 与 native module 闭合。
6. 根 `npm run typecheck`、`npm run lint`、`npm run format:check`。
7. 残留扫描：没有 `Paseo`、`@getpaseo`、`PASEO_*`、`sh.paseo`、签名材料或不在范围内的 Electron/Browser Automation wiring。

## 实施记录（2026-08-26）

### 已恢复的源码闭包

- `isNative` / `isWeb` 恢复真实平台判断，App config 恢复 Android/iOS、Deep Link、权限和 Expo Config Plugin 边界。
- 接回扫码配对、Native WebSocket factory、push notification 注册与打开路径、前后台 Timeline 恢复。
- 接回 Native 附件文件存储、图片/文件选择、粘贴图片与 `file_uri` 持久化；Web IndexedDB 明确拒绝 Native-only source。
- 接回 Native Terminal 的 WebView/Grid renderer、选择/滚动/输入策略、Diff/Markdown/File pane/keyboard 平台实现。
- 恢复本地 `byspace-hardware-keyboard` Expo module、`@bytetrue/byspace-expo-two-way-audio` workspace、Paste Input Config Plugin 与三份确定性 dependency patch。
- Client WebSocket transport 接受 React Native 事件形态，同时保持浏览器 factory 与错误语义。
- App 依赖与 lockfile 对齐 Expo SDK 54 / React Native 0.81 平台切片；`react-native-webview` 固定为已验证的 `13.16.0`。
- iOS 明确禁止同步和执行 daemon 下发的动态插件 Bundle；Web/Android 保持 trusted-local Plugin 行为，直到未来有单独政策决策。

### BySpace 适配与机械省略

- 所有 npm scope、产品名、模块名和环境变量使用 BySpace 身份；没有复制 Paseo App identifier、证书、凭据或发布资源。
- 新 Native Surface 遵守当前 `useUnistyles()` 禁令；主题 props 通过 style factory 或 `withUnistyles` 下沉。
- 未移植无调用方的 `use-audio-recorder.native.ts` 与 `expo-audio`：它属于已删除的旧 Voice recorder，不是当前 Dictation source closure。
- Agent Device `.ad` 脚本仍依赖永久 App ID，推迟到 Android artifact Issue；不暂填伪造的 BySpace identifier。
- Electron、EAS/Fastlane 与 dormant release workflow 保持在后续独立 Issue。

### 当前验证证据

- 最终父流程在冻结 lockfile 的干净 `npm ci` 后复核 24 个受影响测试文件，共 207 tests 通过；覆盖 Native Terminal、附件/Composer、WebSocket transport、Paste Input 与 iOS 动态插件策略。
- 复核发现并修正一处机械品牌替换导致的 Terminal word-selection 期望列偏移；修正后完整聚焦集通过。
- `npm run build:app-deps`、App typecheck、根 `npm run typecheck` 通过；新增 workspace 与依赖闭包均来自冻结 Paseo lock graph，没有浮动到审计后发布的新版本。
- Web `expo export --platform web` 通过，证明恢复 Native seam 后 Web bundle 仍闭合。
- 使用仅限验证的 `BYSPACE_APP_ID=com.example.byspaceprebuild`，Android 与 iOS `expo prebuild --no-install` 均通过；生成目录已删除。
- `npm ci` postinstall 成功应用全部五份当前 dependency patch；本切片新增/扩展的三份上游 patch delta 也已验证。
- 根 `npm run lint`、`npm run format:check` 与 `git diff --check` 通过。
- Android/iOS 原生编译、simulator/真机和永久标识不在本 Issue 验证范围。
- `npm ci` 当前报告 51 个 workspace dependency advisories（6 low / 20 moderate / 25 high）；本 Issue 不主张它们由本切片新增，也不以 `npm audit fix` 漂移冻结目标，生产 artifact 前需另行归因和处置。

独立只读审查结论为无 Blocker。审查提醒的临时 App ID 行为已按实际 prebuild 结果更正，Android notification icon 也已确认存在（96×96 RGBA）；其余结论不要求改变当前切片。

## 后续聚合复核

以上“临时 App ID”“不移植 `expo-audio`”和 `react-native-webview@13.16.0` 是本检查点关闭时的边界，不是 Epic 最终状态：Issue 002 已设置永久 BySpace ID，Issue 006 已恢复 profile/F-Droid/`expo-audio` 配置，最终 lockfile 使用已验证的 `react-native-webview@13.16.1`。

Issue 007 聚合复核同时纠正了本 Issue 第 60 行过早宣称的 Push closure：当时 notification icon、打开路径和 Expo 配置已存在，但 Native token subscription、daemon lease/revoke/persistence、协议兼容门与 Host 删除撤销链路实际没有恢复。聚合检查点已按冻结 Paseo v0.5.1 补齐该纵向切片，并以 App/Client/Protocol/Server 聚焦测试及 Android bundle export 重新验证；因此完整 Push closure 的最终证据属于 Issue 007，而不是本 Issue 的原始关闭证据。

`@bytetrue/byspace-expo-two-way-audio` 只移植产品运行时/构建所需的 library source，不复制上游独立仓库的示例 App、嵌套 CI、贡献文档与独立 package lock。聚合复核移除了指向未移植 examples 的失效 `open:ios`/`open:android` scripts，补回 `.npmignore`；`npm pack --dry-run` 验证 tarball 为 20 个必要文件、无 examples、`android/build` 或 `node_modules`。

## 关闭结论

本 Issue 已完成并回写 Epic：Native App source closure、Web 保持、iOS 动态插件禁用与冻结依赖证据均闭合。Android/iOS 原生编译、simulator/真机、永久标识、Electron 和 dormant release source 留给后续 Issues。

本 Issue 不更新 Project Spec；只有 Epic 全部验收并由用户关闭后，原生客户端才成为当前产品事实。
