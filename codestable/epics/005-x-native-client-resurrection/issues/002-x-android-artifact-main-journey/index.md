---
kind: issue
title: "生成 Android 可侧载产物并验证主旅程"
type: feature
status: closed
created: 2026-08-26
closed: 2026-08-26
---

# 生成 Android 可侧载产物并验证主旅程

> **当前发行状态（2026-08-27）：** 本 Issue 的 debug/internal 侧载范围是历史实现检查点，已由 [Issue 050](../../../../issues/050-o-full-client-release-gate/index.md) 取代。Android Stable/Beta 现在从 exact tag 构建并发布使用固定 BySpace v1 更新密钥签名的 APK；iOS 仍不进入 active CD。

## 做成以后是什么样

BySpace 能从干净源码生成使用永久 Application ID 的 Android APK，并安装到 emulator 或真实设备。App 不依赖 Metro 即可启动，能通过 Direct 与 Relay 连接隔离的 BySpace daemon，进入现有 Workspace、Agent、Terminal、文件与设置主旅程。

**包含：** 用户确认的 Android Application ID、原生版本号、Android SDK/JDK 工具链声明、本地 debug/release 构建脚本、生成但不提交的 Android project、可侧载 APK、隔离 daemon 与 emulator/设备 smoke。

**不包含：** Google Play、EAS、GitHub Release workflow、正式 signing key、F-Droid/profile build、iOS artifact、Electron、Device Fabric、File Handoff、Phone Audio、Share Extension 或后台能力。

**来源：** 当前 BySpace Native App source closure 是产品基线；Android 宿主实现取自冻结 Paseo `v0.5.1` commit `f517493591a7b4072aa30ee48db13c1a51495103`、tree `fc096ff4bc53515c14a8e53d7d7adc6118f94974`，只做已批准的 BySpace 机械适配。

## 已确认标识

- Production Application ID：`com.bytetrue.byspace`。
- Development Application ID：`com.bytetrue.byspace.debug`。
- 未来 iOS Bundle ID：production 为 `com.bytetrue.byspace`，development 为 `com.bytetrue.byspace.debug`。
- URL scheme：`byspace`。
- 标识锚定长期发布主体 ByteTrue，不随未来产品域名变化。

## 实施边界与停止条件

1. 恢复上游 Android 本地构建的最小闭包：固定工具链、版本号、root/app scripts 和必要配置；不顺手恢复 EAS、F-Droid、profile build 或发布自动化。
2. `android/` 继续由 Expo prebuild 生成并保持未跟踪；不可把机器生成工程当长期源码维护。
3. 本地 release APK 可以使用生成工程的开发签名用于侧载验证，但不得称为正式签名或公开发行产物。
4. 所有 daemon smoke 使用隔离 `BYSPACE_HOME` 与非生产端口；不得重启或修改 `6777` 上的主 daemon。
5. 若冻结上游在未改版本身无法构建，或适配需要新增产品行为、协议、权限或安全策略，停止该切片并向用户报告，不自行修复上游设计。

## 质量承诺

- **功能适宜性**：干净 prebuild 能生成正确 package/version；release APK 能安装、启动并完成 Direct/Relay 配对与核心导航。
- **兼容性**：Web export、daemon/CLI/协议与当前 Stable/Beta 服务不改变；Android 是新增宿主而不是 Web fallback。
- **可靠性**：构建可从锁定依赖和声明的工具链重复执行；artifact、日志和 smoke daemon 都有明确路径和清理方式。
- **信息安全性**：不迁移 Paseo 标识、Google/Expo credential 或正式 signing material；不触碰生产 daemon。
- **可维护性**：只恢复真实 Android build seam，不引入第二套 App、手写 Gradle fork 或暂时性 wrapper。

## 验证

1. 原生版本号聚焦测试通过；Production/Development Expo config 分别输出确认的 package ID。
2. `npm ci` 后，Android clean prebuild 与串行、daemon-free Gradle release build 通过。
3. 用 `aapt`/`apkanalyzer` 核验 APK package、versionName、versionCode 和所需权限，不含 Paseo 标识。
4. APK 在 arm64 emulator 或真实设备安装并冷启动；记录 `adb logcat` 的首个因果错误，而不是用超时推断。
5. 使用隔离 daemon 验证 Direct 与 Relay 配对，以及 Workspace、Agent、Terminal、文件与设置的最小主旅程。
6. 相关聚焦测试、Web export、根 `npm run typecheck`、`npm run lint`、`npm run format:check` 与 `git diff --check` 通过。
7. 独立只读审查确认构建闭包完整、适配机械、排除的发布/设备能力没有泄漏。

## 关闭时

- 回写 Epic：artifact 路径、package/version 证据、设备/连接 smoke、工具链和剩余 Android 分发阻断。
- 将可重复的 Android 开发命令写入 `docs/`；发布签名、Play/EAS/CI 仍由后续 dormant release Issue 管理。
- 本 Issue 不更新 Project Spec；只有 Epic 全部验收并由用户关闭后，Android 才成为正式产品发行边界。

## 完成结果

### Artifact 与构建闭包

- 从干净 `npm ci`、`build:app-deps` 与 production clean prebuild 生成 `release` APK；`android/` 仍为 ignored 生成目录，没有提交。
- Smoke artifact：`/tmp/byspace-android-smoke/artifacts/byspace-0.6.0-android-release-7286165d.apk`，大小 `224,263,713` bytes，SHA-256 `7286165d2bc05b772afb1dc253ceed7525305b0ce849524bea4ae8f7a54be0c6`；文件设为只读，避免后续构建覆盖证据。
- APK metadata：package `com.bytetrue.byspace`、`versionName=0.6.0`、`versionCode=6000`；production/development Expo config 分别解析为 `com.bytetrue.byspace` 与 `com.bytetrue.byspace.debug`，scheme 为 `byspace`。
- 产物使用生成工程的 Android debug key 完成 v2 签名，仅作为内部 sideload artifact；未迁移 Google、Expo、Play 或正式 signing credential。
- 构建工具链使用 Node 24.19.0、Java 21、Android platform/build-tools 36、minSdk 29 与声明的 NDK/CMake 闭包；可重复命令已写入 `docs/android.md`。

### Emulator、Direct 与 Relay smoke

- 设备：arm64 `byspace-api35-arm64` emulator（Pixel 7 profile / Android API 35）；APK 可安装并在无 Metro 条件下冷启动，系统 package manager 报告 `com.bytetrue.byspace`。
- Daemon：独立 `BYSPACE_HOME=/tmp/byspace-android-smoke/home`、端口 `6769`；主 daemon `6777` 未重启、未改配置。
- Direct：通过 `adb reverse tcp:6777 tcp:6769` 完成配对；daemon 收到 Android/OkHttp WebSocket hello，`clientType=mobile`、`appVersion=0.6.0`。
- Relay：移除 `adb reverse`、清空客户端测试数据后，仅通过 `byspace://` offer 配对；Cloudflare Relay 建立持续会话，随后 force-stop / cold-start 自动重连，daemon 记录 session resume。最终哈希产物重新安装后仍通过纯 Relay 冷启动并加载 Workspace/Agent 数据。
- 主旅程：加载 Project/Workspace；进入 New Agent / workspace 创建界面；创建并恢复 Terminal，软键盘执行 `echo BYSPACE_ANDROID_OK`；浏览并打开 `smoke.js`；进入 Settings 并看到 Host online。
- 关键证据位于 `/tmp/byspace-android-final-*.png` 与 `/tmp/byspace-android-smoke/home/daemon.log`。临时 smoke 目录和 APK 不进入仓库。

### 自动验证与审查

- Android/native/协议相关聚焦测试分 workspace 通过；其中 native release version 3 tests、App runtime 49 tests、client transport 8 tests、protocol terminal restore 5 tests、server hello 目标测试均通过。
- Web export、全仓 `npm run typecheck`、`npm run lint`、`npm run format:check` 与 `git diff --check` 通过。
- 独立只读审查：无 Blocker、High 或 Medium；建议关闭本 Issue。

### 仍未打开的分发闸门

- 没有 production signing key、Google Play/EAS 发布、CI release trigger 或公开下载渠道。
- iOS 仍为 source-only；Electron 仍由下一 Issue 恢复。
- Project Spec 记录 Android 为已验证 internal artifact 和受维护客户端源码，但公开发行 playbook 仍只覆盖 Web/PWA + CLI + daemon/Relay；正式签名 Android 渠道要在后续 release gate 单独启用。
