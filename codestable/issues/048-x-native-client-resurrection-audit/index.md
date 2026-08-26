---
kind: issue
title: 原生客户端复活与设备能力边界审计
type: explore
status: closed
created: 2026-08-26
closed: 2026-08-26
related_issue: ""
---

# 原生客户端复活与设备能力边界审计

> **读者：** 要决定 BySpace 是否、以及怎样重新支持 iOS、Android 与 Electron，并把它们发展成跨设备能力宿主的人。
>
> **关闭后追加决策（2026-08-26）：** 用户撤销了本审计原 D4 的“首轮排除 Browser Automation”边界，并要求旧 Web-only 裁剪一起移除的受维护 Native/Desktop/Browser/测试/构建/发布源码大体完整恢复。当前约束以 Epic 005 和 Project Spec 为准；本文保留旧判断的历史因果，并在相关位置标明已被取代。

## 要弄清什么、怎样算够

- **支持的决策：** 是否以当前上游维护的完整客户端为基础恢复 iOS、Android 与 Electron；恢复哪些纵向能力；Device Fabric、插件和平台宿主各自负责什么；按什么顺序穿刺与实施。
- **本轮基线：** BySpace `main` 为 `5d4aff03f58190b88681e9741c22835ddddcd3ab`；已集成的上游版本为 Paseo `v0.5.1`（commit `f517493591a7b4072aa30ee48db13c1a51495103`，tree `fc096ff4bc53515c14a8e53d7d7adc6118f94974`）。原始删除提交只作为历史证据，不作为恢复来源。
- **本轮覆盖：** 共享 Expo App 的平台边界、iOS/Android 原生模块与系统能力、Electron 宿主与 daemon 关系、插件在不同客户端中的装载方式、构建/签名/分发链、与现有 Relay/Data Relay 的接缝。
- **本轮不做：** 不撤销旧删除提交；不修改运行时代码；不发布、不签名、不启动生产 daemon；不把尚未确认的产品方向写成当前 Project Spec。
- **停止条件：** 能把客户端启动、配对、插件装载、系统能力调用、跨设备传输和发布约束分别讲成“触发→过程→结果”；每个恢复切片都有 `可直接移植 / 机械适配 / 产品决策 / 不恢复` 判断；上游目标构建证据、主要未知与首轮穿刺顺序明确。

## 一句话：触发怎样变成结果

BySpace 当前只发布同一 Expo 代码库的 Web 形态，而上游仍由 iOS/Android App 与 Electron 壳把这套界面接入设备系统；恢复客户端应移植上游 `v0.5.1` 的当前宿主纵向切片，并让客户端以受控 Capability Provider 身份向 daemon 注册能力，而不是复活 `v0.2` 旧快照或让插件直接持有任意原生权限。

## 先读哪里

1. [移动客户端怎样从启动走到可用设备能力](移动客户端怎样从启动走到可用设备能力.md) — App 启动、配对、连接、原生权限与插件装载的主路径。
2. [桌面客户端怎样从启动走到系统能力](桌面客户端怎样从启动走到系统能力.md) — Electron、daemon、IPC、更新与 native helper 的责任边界。
3. [插件怎样调用跨设备能力](插件怎样调用跨设备能力.md) — 插件、Capability Registry、Event/Blob/Stream 与授权之间的路径。
4. [客户端怎样构建签名并交付](客户端怎样构建签名并交付.md) — Android/iOS/Electron 的构建、商店政策、签名和发布负担。
5. [Vision 与 Epic 决策稿](建议的Vision与Epic草案.md) — 用户已批准的产品定义、五个 Epic 与 D1–D8 决策；正式活规格已进入 Vision 和 Epic 005。

## 审计结论

**建议恢复完整 iOS、Android 与 Electron 客户端，但以当前 BySpace `main` 为产品基线、以 Paseo `v0.5.1` 为平台实现来源，分阶段移植；不恢复 `v0.2` 旧快照，也不另建一套重复配对、认证、权限和更新的 Companion 产品。**

恢复客户端与 Device Fabric 是连续但不同的两个交付面：

- 客户端复活重新获得原生运行时、完整 BySpace UI 和 OS 权限入口；
- Device Fabric 增加设备身份、能力注册、反向寻址、端侧 consent、Blob/Stream 和插件调用边界；
- 虚拟麦克风、ReplayKit、MediaProjection、Share Extension 等再作为 platform adapter 建在这两层之上。

## 已经确认的事实

- 当前 `main` 与 `origin/main` 同步；工作区原有未跟踪 `context.md`，本探索不触碰它。
- `docs/upstream-sync.md` 已把集成基线更新到 `v0.5.1`；`codestable/spec/index.md` 仍声明 Web-only 和旧来源基线，只有用户批准新 Vision/Epic 后才应更新。
- 当年的裁剪同时删除 Electron、iOS/Android、`expo-two-way-audio`、原生测试与发布链；一次 revert 会同时复活旧协议、旧产品和旧品牌，不能使用。
- 当前共享 App 仍有 36 个文件、74 处 `isNative` 引用，但 `platform.ts` 把 Native 固定为 false；上游有 60 个文件、142 处引用，说明工作量包括共享 seam 审计，不只是添加平台文件。
- 冻结上游规模：Desktop 183 files、two-way-audio 59 files，另有平台覆盖、module、Config Plugin、测试和交付文件。
- Paseo `v0.5.1` exact SHA 上，App dependencies build、App typecheck、Expo Android/iOS prebuild、server stack、Electron main build 和 macOS arm64 `--dir` package 均通过；移动 prebuild 使用默认 ID `com.anonymous.paseo`，Desktop 只做 ad-hoc signature 且未 notarize，本机仍无真实 APK/iOS archive 证明。
- 上游移动客户端已有配对、推送、原生 Terminal、文件/图片选择和 PCM 音频，但没有 Device Registry、Share Extension、整机投屏、后台剪贴板或 OS virtual microphone。
- 上游 Electron 已是成熟完整宿主。审计时曾建议把 Browser Automation 后置；关闭后用户明确改为恢复完整受维护桌面纵向切片，因此 Desktop Browser/CDP、Browser tools/protocol、相关测试与发布源码现已进入 Epic 005。
- 现有 file transfer、Relay E2EE、RemoteByteStream backpressure、插件 typed RPC 可复用；各自仍需增加设备语义，不能把媒体塞进 Plugin JSON RPC 或把设备伪装成 RWS loopback port。

## 推荐实施顺序

1. **Client Resurrection Foundation**：先恢复 Electron 与 Android/iOS 的当前 BySpace 主旅程，Web 行为保持不变。
2. **Device Registry + 前台 File Handoff**：优先 Android + Electron，验证设备身份、反向请求、端侧 consent 和 Blob。
3. **Phone Mic Monitor**：独立 E2EE Stream、credit backpressure、前后台和中断语义；先在 Electron 播放。
4. **OS-wide Virtual Microphone**：最后接 macOS/Windows/Linux adapter，完成“所有桌面软件可选择手机麦克风”。
5. **iOS Public Distribution Gate**：动态插件与 Native Capability 边界通过真实 App Review/政策验证后再承诺公开发行。

## 已确认与仍待确认的决策

- **已确认：** 正式恢复 Electron、Android 与 iOS 完整客户端并保留 Web；不另建重复 Companion。
- **已确认：** 首轮交付为 macOS Electron internal + Android sideload APK；iOS 保留共享代码、平台边界、Expo prebuild、可选 simulator 验证，以及机械适配但默认休眠的发布流水线源码。
- **已确认：** 首轮不制作或发布 iOS 包，不购买或配置 Apple 证书，不运行 EAS/Fastlane/iOS 发布 workflow；以后准备实际发行时再启用。
- **已确认：** iOS 不把 daemon 任意下发的动态插件客户端作为首轮运行能力，只保留 first-party 编译边界。
- **关闭后改写：** Electron 恢复 managed daemon、完整 typed OS bridge、Desktop Browser/CDP、Browser tools、updater/rollout 和平台测试/打包源码，同时保留连接其他 Host；公开签名发行仍单独开闸。
- **已确认：** 插件生态首期继续是 trusted-local；Device Capability 从第一天仍由核心托管、按设备/能力授权并取得端侧 consent。
- **已确认：** 第一能力切片是 File Handoff，其后才是 Phone Audio；首期只做单 daemon 设备协作。
- **已确认：** Android 与未来 iOS 使用 `com.bytetrue.byspace`，Android Debug 使用 `.debug`，Electron 使用 `com.bytetrue.byspace.desktop`，跨平台 scheme 为 `byspace`；永久标识锚定 ByteTrue，不随产品域名迁移。iOS 发布账号和 Secrets 仍推迟到决定实际运行流水线前确认。

## 仍然存在的未知

- 当前 BySpace 共享 App 接回全部 Native seam 后，Android/iOS 真实编译和运行会暴露哪些同步后回归。
- Apple 是否接受本地 daemon 插件索引与固定原生能力协作；Guideline 4.7.2 明确禁止未经事先许可向插件暴露 Native API，必须以真实审核验证。
- 虚拟音频 adapter 的签名、安装和长期跨 OS 维护成本。
- 未来是否扩展到多 daemon Device Mesh；首轮建议明确不做。

## 关掉时材料去哪

- 经用户确认的目标产品形态与设备旅程 → [`codestable/vision/index.md`](../../vision/index.md)。
- 获批并已关闭的恢复范围、质量目标和检查点 → [`codestable/epics/005-x-native-client-resurrection/spec.md`](../../epics/005-x-native-client-resurrection/spec.md)。
- 已经实现并长期成立的发行边界与运行机制 → `codestable/spec/` 与 `docs/`。
- 审计证据、排除过的方案和未采纳路径 → 留在本 Explore。

## 关闭结果

用户已批准完整客户端复活、iOS source-only + dormant release source、Android + Electron 首轮交付、File Handoff 优先等审计决策。关闭后又明确撤销 D4，并将 Desktop Browser/CDP、桌面系统集成、原生/桌面测试、打包和休眠发布源码纳入同一客户端基础闭包；只有用 Paseo marketing-site 替换现有 BySpace website、旧 Chat/Loops 等显式产品排除和未开闸的真实签名发布仍不恢复。目标世界已毕业到 Vision，有界实施由已关闭的 Epic 005 完成，稳定事实已进入 Project Spec 与 `docs/`。
