# Vision 与 Epic 决策稿

> 本文记录 2026-08-26 的审计阶段决策；Browser Automation 后置决定已被撤销，完整客户端源码已由 [`Epic 005`](../../epics/005-x-native-client-resurrection/spec.md) 恢复。2026-08-27 的 [Issue 050](../050-o-full-client-release-gate/index.md) 又取代了 dormant/internal 发行边界：Stable/Beta 必须发布签名 Android APK 与 Electron Desktop 三平台资产；iOS 保持 source/prebuild/test-only，active CD 不构建、不提交、不上传。当前事实以 Project Spec、Vision 和 `docs/client-distribution.md` 为准。

## Vision 草案

BySpace 从“本地 AI Coding Agent 的远程控制平台”演进为一个自托管的个人计算控制平面：它连接用户拥有的 daemon、桌面和移动设备，统一呈现 Agent、文件、终端、系统能力与自动化，并允许可信插件把这些能力组合成个人效率工具。

### 产品形态

- **Web/PWA**：零安装、远程访问和最快更新的完整客户端。
- **Electron Desktop**：同一完整 BySpace UI，加桌面登录会话中的系统能力、daemon 生命周期和 native helper 宿主。
- **iOS/Android**：同一完整 BySpace UI，加移动权限、传感器、Share/Screen/Audio 等系统能力宿主。
- **Daemon**：身份、状态、插件、设备注册、授权、路由和自动化的控制平面。
- **Plugin**：贡献 UI 和组合逻辑；不安装移动 native code，不直接持有设备密钥、Relay credential 或任意 OS bridge。

### 长期原则

1. 一套共享产品 UI，不维护“完整 Web App + 重复 Companion”两套身份与配置体验。
2. 完整客户端提供能力，daemon 协调能力，插件组合能力。
3. Native Capability 是固定、版本化、由受信任 binary 提供的 allowlist；安装插件不会增加新的 OS 权限类型。
4. 高风险能力必须在设备端可见、可停止，并按平台要求取得当次 consent。
5. 控制面、Blob 和持续 Stream 分离；插件 JSON RPC 不承载媒体。
6. Web 功能不因原生恢复而退化；原生是新增正式宿主，不重新把全仓库变成任意平台条件分支集合。
7. 公开插件市场不是首期承诺；从 trusted-local 起步，但 Device Capability 核心从第一天不把长期凭据交给插件。

## 建议拆成五个 Epic，而不是一个巨型恢复项目

### Epic A — Native Client Resurrection Foundation

**目标：** 在当前 BySpace `main` 上恢复完整客户端入口和原生构建闭包，不新增 Device Fabric 协议。

**包含：**

- 当前上游 `v0.5.1` 的 Electron package、Expo platform/module/override 源码和必要测试；
- BySpace scope/env/scheme/path/daemon lifecycle 的机械适配；
- 共享 `isNative` seam 的逐文件审计，Web 行为回归；
- Electron managed daemon + local transport + 基础 preload bridge；
- Android/iOS 配对、Direct/Relay、Workspace/Agent、附件、Terminal、Dictation 和插件 Surface 的基本旅程；
- internal/unsigned 构建说明与最小 CI，不包含公开商店发布；
- Electron Browser/CDP、Browser tools/protocol、typed OS bridge、auto-updater/rollout、原生/桌面 E2E、Electron Builder/Nix 与平台发布源码；
- 上游 iOS/EAS/Fastlane/CI 发布配置经 BySpace 机械适配后保留，但默认休眠、不绑定证书/Secrets、不被 push/tag 自动触发，也不作为首轮绿色门禁。

**仍然排除：**

- Device Registry/Capability API；
- iOS App Store、Android Play/EAS 和签名 Desktop 的真实发布执行；
- 虚拟麦克风、投屏、Share Extension、后台剪贴板；
- 用 Paseo marketing-site 替换现有 BySpace `packages/website`，以及旧 Chat/Loops 等当前 Project Spec 明确排除的产品路径。

**验收：**

1. Web export、现有 targeted tests、typecheck、lint、format 全绿；Web 当前行为和 protocol 兼容性不变。
2. Electron macOS dev 运行与 unsigned packaged smoke：能托管当前 BySpace daemon、使用 local transport、完成核心主旅程。
3. Android APK 在 emulator/真实设备配对 Direct 与 Relay，完成核心主旅程。
4. iOS 保持共享源码与 Expo prebuild 闭合；具备完整 Xcode 时验证 simulator，不要求签名设备包、archive、TestFlight 或 App Store。
5. 源码从第一天不写死 macOS/Android 行为；Windows/Linux/iOS public artifacts 可以作为后续交付 gate，但平台代码保持可编译边界。
6. 休眠的 iOS 发布流水线可静态检查且无 Paseo 标识/凭据；缺少显式启用、永久 Bundle ID、Apple team 和 Secrets 时不会发布或阻塞常规 CI。

### Epic B — Device Fabric Foundation + File Handoff

**目标：** Android 与 Electron 在同一 daemon 下成为可寻址 Device Provider，完成前台文件接力。

**包含：** 设备密钥/enrollment、registry、heartbeat/lifecycle、固定 capability descriptor、addressed invocation、端侧 consent、基于现有 file transfer 扩展的 Blob route、插件 server API、审计与撤销。

**验收：** Electron/可信插件请求指定 Android 选文件，Android 显示来源/目标并由用户确认，文件校验后交给 Electron；拒绝、超时、离线、取消、断线和旧客户端都表现确定。

### Epic C — Phone Audio Stream

**目标：** 手机前台麦克风经独立 E2EE data stream 到 Electron monitor。

**包含：** stream ticket、credit backpressure、音频 format negotiation、中断/锁屏/来电/慢网、活动指示和停止。

**排除：** 系统虚拟输入设备。

### Epic D — OS-wide Virtual Microphone Adapters

**目标：** 把已验证的 Phone Audio Stream 接入桌面 OS 可选择的输入设备。

按 macOS、Windows、Linux 拆 checkpoint；driver/helper 有独立安装、签名、更新、卸载和故障回滚。

### Epic E — Public Native Distribution and iOS Plugin Policy

**目标：** 建立 signed Beta/public artifacts、Stable/Beta channel isolation，并以真实审核验证 iOS 插件边界。

不把这一 Epic 的商店不确定性反向阻塞 A–D 的内部能力验证。

## 建议批准的默认决策

| 决策                          | 推荐默认值                                                                                       | 原因                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| D1 产品边界                   | 正式恢复 Electron、iOS、Android 完整客户端；保留 Web                                             | 与个人效率平台目标一致，避免独立 Companion 重复产品层              |
| D2 首轮交付                   | macOS Electron internal + Android sideload APK；iOS 保留源码/prebuild/simulator 和休眠发布流水线 | 用户已确认迁移流水线源码，但首轮不制作 iOS 包、不采购证书          |
| D3 iOS 插件                   | 不作为首轮运行能力；只保留 first-party 编译边界                                                  | 没有 iOS 分发闭包，且 Apple 4.7.2/4.7.3/4.7.4 尚未验证             |
| D4 Desktop Browser Automation | **关闭后改写：纳入 Epic A/005 的完整 Desktop 纵向恢复**                                          | 用户明确要求原裁剪面大体完整恢复；公开分发成熟度不再是源码排除理由 |
| D5 Desktop daemon             | 恢复 managed daemon，同时保留连接其他 Host                                                       | 完整桌面入口应开箱即用，又不破坏 BySpace 多 Host 模型              |
| D6 插件信任                   | 首期 trusted-local；Device Capability 仍由核心授权和端侧 consent                                 | 避免同时建设 marketplace/sandbox，同时不欠敏感权限债               |
| D7 第一能力切片               | File Handoff 后 Phone Audio                                                                      | 先验证身份/寻址/consent/Blob，再独立验证实时流                     |
| D8 首期拓扑                   | 单 daemon 内设备协作                                                                             | 不把 P2P、跨 daemon federation、TURN 和同步一致性混入基础协议      |
| D9 永久应用标识               | Android/Electron 在真实打包检查点前确认；iOS 在流水线首次启用前确认                              | 休眠配置不应迫使当前购买证书，也不能保留上游正式标识               |

D1–D8 最初按推荐批准；D4 随后由用户改写为完整恢复，D9 永久标识已确认为 `com.bytetrue.byspace` / `com.bytetrue.byspace.desktop` / `byspace`。实施继续进入 Epic 005，每个 writer 只推进一个可验证 checkpoint；Epic 005 通过后再开启 Device Fabric，而不是在客户端尚不能稳定运行时先设计完整设备协议。
