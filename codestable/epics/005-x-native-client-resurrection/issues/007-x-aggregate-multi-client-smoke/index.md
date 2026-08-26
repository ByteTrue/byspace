---
kind: issue
id: 7
parent: 5
title: 多客户端聚合验证与独立审查
status: closed
created: 2026-08-26
updated: 2026-08-26
closed: 2026-08-26
---

# 多客户端聚合验证与独立审查

> **当前发行状态（2026-08-27）：** 本 Issue 的“不发布、不签名”仅是 Epic 005 聚合验收时的历史边界，已由 [Issue 050](../../../../issues/050-o-full-client-release-gate/index.md) 取代。当前 Stable/Beta 发布签名 Android APK 与 macOS/Linux/Windows Electron 资产；iOS 继续 source/prebuild/test-only，active CD 不发布。

## 初始需求

这是 Epic 005 的聚合收口检查点。它不重复前六个 Issue 的实现，而是要求：

1. 对照 frozen Paseo v0.5.1 与 Epic 原始验收范围重跑 Native/Desktop 源码闭包清单；
2. 查出并补齐分检查点可能遗漏但没有暴露为编译错误的纵向链路；
3. 重跑跨平台、跨包、跨构建顺序验证；
4. 由独立 Reviewer 对最终工作树做分级审查；
5. 只有证据闭合后才关闭本 Issue；Epic 本身仍等待用户验收与单独授权。

## 冻结基线与边界

- 冻结上游：Paseo v0.5.1，commit `f517493591a7b4072aa30ee48db13c1a51495103`，tree `fc096ff4bc53515c14a8e53d7d7adc6118f94974`。
- 上游源码：`/tmp/byspace-native-source-paseo-v0.5.1.kC0Kjr`。
- BySpace 机械适配：`Paseo` → `BySpace`、`paseo` → `byspace`、`@getpaseo/*` → `@bytetrue/byspace-*`、`sh.paseo` → `com.bytetrue.byspace`。
- 保留边界：不发布、不签名、不配置商店/推送凭据、不重启 6777 生产 daemon；Project Spec 的 Web-only 产品边界不在本 Issue 内自动变更。

## 聚合审计结果

### 1. 可复现维护面清单

按 11 类 Native/Desktop 维护面重建 frozen manifest，并应用上面的机械路径映射：

| 类别                                                  | 上游路径数 |
| ----------------------------------------------------- | ---------: |
| `packages/desktop/**`                                 |        183 |
| App platform overrides（`.native.*` / `.electron.*`） |         28 |
| `packages/app/maestro/**`                             |         29 |
| `packages/app/modules/**`                             |          9 |
| `packages/app/plugins/**`                             |          5 |
| `packages/app/src/push-notifications/**`              |          5 |
| `packages/app/.eas/**`                                |          3 |
| App Native 根配置                                     |          3 |
| `packages/app/fastlane/**`                            |          2 |
| Native/Desktop GitHub workflows                       |          2 |
| Desktop Nix                                           |          2 |
| **总计**                                              |    **271** |

结果：机械映射后的 **271/271 路径存在，missing=0**。这只是可复现的路径闭包证据，不把不存在于 frozen baseline 的能力算作已恢复，也不代替纵向调用链审计。

旧 identity 残留扫描覆盖 `packages/desktop`、App Native/Desktop surfaces、release workflows、Fastlane、EAS、Maestro、Nix 与新 Push 链路；`@getpaseo`、`PASEO_*`、`sh.paseo`、`paseo://`、上游 GitHub/home/relay/release artifact 标识均为 0 命中。

### 2. 补回静默遗漏：Native Push Notifications 完整链路

聚合调用链审计发现：Issue 001 的关闭记录误把“通知图标、点击路由和 App 配置存在”当成完整 Push 恢复；当时实际缺少 App token subscription、协议 RPC、daemon token lease/revocation 与 Expo outbound sender。这类遗漏不会由 Desktop/Web 编译自动暴露。

本 Issue 按 frozen v0.5.1 补回完整纵向链路：

- App：Native entrypoint 与 `subscriptions.ts` 注册 project-scoped Expo token、续租、去重与清理；Web entrypoint 明确 no-op；`PushNotifications` 在根布局中挂载；通知点击继续通过已有 router 打开 Agent。
- Protocol：`PushTokenSchema`、`register_push_token`、`push.unregister.request/response`、`server_info.features.pushTokenRevocation`；新字段保持 optional，并加入 dated `COMPAT(pushTokenRevocation)` 清理标记。
- Client/Host runtime：注册、注销、token lease tracking、服务端能力门控与测试。
- Server：token store、Expo sender、lease refresh、client disconnect / explicit unregister 清理；endpoint 固定为 `https://exp.host/--/api/v2/push/send`，失败只记录、不影响 daemon 主流程。
- F-Droid/Web：保持显式无通知 native module / no-op 边界。

对 Issue 001 的历史记录已追加“后续聚合纠偏”，不改写当时真实执行过的证据。

### 3. 补回跨构建顺序遗漏

Desktop build 后紧接 iOS export 的聚合验证首次暴露：根 `build:app-deps:clean` 会 clean `@bytetrue/byspace-expo-two-way-audio` 却不重建它，也漏掉显式 `build:client:clean`。因此 `build:desktop` 本身成功，但后续 iOS export 因 `packages/expo-two-way-audio/build/index.js` 缺失而失败。

修复与基线完全一致：

```text
build:highlight:clean
→ build:client:clean
→ build:plugin:clean
→ build @bytetrue/byspace-expo-two-way-audio
```

同时：

- `scripts/release-workflows.test.mjs` 增加静态回归，禁止把 Audio build 退化成裸 `clean`；
- `docs/development.md` 记录 `build:app-deps:clean` 是 clean build 而不是 cleanup-only target；
- Issue 006 追加历史纠偏，避免用一次 Desktop build pass 误证跨目标顺序闭合；
- 实证 `build:desktop` 后 Audio artifact 仍存在，随后 iOS production export 成功。

## 最终验证证据

### 修复聚焦测试

- Server Push/token lease：4 files，63 tests passed。
- Client daemon client：117 tests passed。
- App Push subscriptions：2 tests passed。
- Protocol messages：22 tests passed。
- WebSocket notifications/browser broker：2 files，19 tests passed。
- Terminal notification flow：14 tests passed。
- Host runtime：2 files，69 tests passed。
- 合计：**12 files，306 tests passed**。
- Root release/build-script regression：`node --test scripts/release-workflows.test.mjs`，5/5 passed。

Epic 005 当时的前六个检查点均有闭环证据：Android internal APK/emulator Direct+Relay smoke、Native source tests、Web-only policy correction、Desktop package/CLI/browser automation tests、真实 macOS packaged smoke，以及 EAS/Fastlane/Maestro/Nix/发布源码闭包。本 Issue 不把后续才由 Issue 050 建立的签名与公开发布证据倒填到该次聚合验收。

### 构建、导出与静态门禁

- `npm run build:client` passed。
- `npm run build:app-deps` passed。
- `npm run build:server` passed：Highlight、Relay、Protocol、Client、Plugin、Server 与 CLI 均完成非增量编译；协议产物、daemon worker、supervisor entrypoint、bundled server skills 与 CLI 产物均存在。
- `npm run build:desktop` passed，并在完成后保留 Audio `build/index.js`。
- App Web production export passed：4817 modules，约 13.1 MB bundle。
- App Android production export passed：5488 modules，约 31.1 MB bundle。
- App iOS production export passed：约 34.7 MB Hermes bundle；这是在最终 Desktop build 之后执行的顺序验证。
- 隔离源码副本的 Android+iOS production prebuild passed；生成的 Android/iOS 标识均为 `com.bytetrue.byspace`。Expo autolinking descriptor 实证包含 Android-only `BySpaceNativeTraceModule` 与 Apple-only `BySpaceHardwareKeyboardModule`/React delegate handler，并确认二者不会跨平台误链接。
- `npm run typecheck` passed（全部 workspaces）。
- `npm run lint` passed，0 warnings / 0 errors。
- `npm run format`、`npm run format:check` 与 `git diff --check` passed。

### 真实 Desktop managed-daemon 生命周期

最终 macOS arm64 packaged smoke 使用隔离 `BYSPACE_HOME=/tmp/byspace-electron-managed-smoke-home`，并在该 home 的持久化 `config.json` 中把 `daemon.listen` 设为 `127.0.0.1:6769`：

- Desktop 生成 `byspace.pid`，其中 `listen=127.0.0.1:6769`、`desktopManaged=true`，managed daemon 进程真实存活；
- 向 Desktop 发送 `SIGTERM` 后，quit lifecycle 返回 exit code 0；managed daemon 被停止，6769 listener 消失；
- 同期 6777 生产 daemon PID `13695` 前后保持不变，未被接管或重启；
- Electron/Web 的 `expo-notifications` 与 `useNativeDriver` 信息仅为非致命 fallback warning，不影响 smoke 结论。

`BYSPACE_LISTEN` 仅作为进程环境变量不足以隔离此 smoke，因为 `daemon status` 按设计忽略继承的 daemon env override 并读取持久化配置；可复现实验必须写入隔离 home 的 `config.json`。

### Packaged Browser 交互复核

后续在当前 `mac-arm64/BySpace.app` 上使用持久化隔离 daemon `127.0.0.1:16790` 与独立 Electron user data 重跑 Browser 实机链路：packaged Helper 启动 daemon、Renderer direct hello、Browser WebView 注册与共享 `Partitions/byspace-browser` profile 均成立；本地 smoke 页的 `Run` 按钮被真实触发并输出唯一 guest-console 标记 `byspace-browser-smoke-clicked`。Desktop/daemon 稳定运行约 502 秒后经 lifecycle RPC 优雅退出，worker code 0，无测试 listener/进程残留，6777 生产 daemon PID 未变化。

### 独立审查

最终工作树由独立 Reviewer 只读审查：

- Push 协议兼容、App subscription、daemon lease/revocation、outbound sender、F-Droid/Web 边界：无 Blocker / High / Medium。
- Native/Desktop 271-path manifest 与关键调用链：无缺失。
- 对审查后发现的跨构建顺序修复又做一次窄复核：`package.json`、静态回归与 `docs/development.md` 均与 frozen v0.5.1 一致；无 Blocker / High / Medium / Low。

Reviewer 当时记录两个配置边界：没有有效 EAS Project ID/平台凭据时 Push subscription 会安全跳过；Expo Push sender 需要访问 `exp.host`。这两项仍是运行环境配置，不是源码闭包缺陷，也不改变 Issue 050 建立的 Android/Desktop 当前发行契约。

## 本检查点当时的边界

> 以下只描述 2026-08-26 Epic 005 聚合验证本身，不是当前发行政策。当前政策见 Issue 050 与 `docs/client-distribution.md`。

- 该次验证未配置或使用 Apple Team、App Store Connect、Google Play、EAS Push、notarization、Windows signing 或 GitHub Electron release credentials。
- 该次验证未执行 signed iOS device archive/TestFlight/App Store、Play/EAS public artifact、signed/notarized Desktop 或 Windows/Linux runner smoke。
- 该次技术验证未发布 npm、Web、Relay、Native 或 Desktop 版本；Android/Desktop 公开发布随后由独立 release gate 建立。
- 未重启或接管 6777 生产 daemon；最终 managed-daemon smoke 只启动并停止隔离 6769 daemon，既有生产 daemon PID 保持不变。
- 用户于 2026-08-26 完成验收并单独授权 Project Spec 更新与 Epic 005 关闭。

## 关闭结论

Epic 005 的七个实现/验证检查点全部完成：Native App、Android artifact、产品边界与 sync policy、Electron core/package、Desktop Browser Automation、平台发布源码，以及最终聚合审计均有可复核证据；聚合阶段发现的 Push 与跨构建顺序遗漏已补齐并独立复核。

**本 Issue 与 Epic 005 均已关闭；稳定结论已毕业到 Project Spec、Vision 与 `docs/`。**
