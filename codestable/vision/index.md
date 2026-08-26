# Vision

BySpace 要成为一个自托管的个人计算控制平面：它连接用户拥有的 daemon、桌面、移动设备与 Agent，让用户从任意设备进入同一套工作空间，并通过插件把本地软件能力、设备能力和自动化组合成个人效率工具。

AI Coding Agent 仍是核心能力，但不再是产品边界本身；BySpace 的长期价值是让用户拥有、连接和编排自己的计算环境。

## 用户怎样获得结果

### 在任意设备继续同一项工作

用户可以从 Web/PWA、桌面或移动客户端连接自己的 Host，继续 Agent、Workspace、Terminal、文件和自动化工作。客户端共享一套产品模型与主要 UI，不要求用户维护“完整 Web App + 另一套 Companion”的重复身份、配对和设置。

### 把手边设备变成可调用的工具

用户可以让手机或桌面在明确授权下提供文件、麦克风、摄像头、屏幕、剪贴板、通知等系统能力，并把能力交给另一台设备、Workspace、Agent 或插件使用。高风险能力在提供设备上可见、可停止，并遵守平台的当次授权要求。

### 安装并组合个人效率能力

用户可以安装可信插件获得新的界面、命令和编排逻辑。插件组合 BySpace 核心公开的固定能力，而不是下载新的移动原生代码，也不直接持有设备私钥、Relay 凭据或任意 OS bridge。首期以 trusted-local 插件为边界，公开 Marketplace、签名生态和第三方沙箱仍是后续方向。

## 能力怎样支撑旅程

```text
完整 Web / Desktop / Mobile 客户端
              │ 提供界面与本机能力
              ▼
       BySpace daemon 控制平面
  身份 · 状态 · 插件 · 授权 · 路由 · 自动化
              │
      ┌───────┼────────┐
      ▼       ▼        ▼
   Control   Blob    Stream
              │
              ▼
      插件发现、请求与组合
```

- **完整客户端**：Web 保持零安装的一等入口；Electron 与 iOS/Android 使用同一套完整 BySpace 产品，同时承载各平台独有能力。
- **Desktop Browser Workbench**：Electron 内嵌 webview/CDP、可信输入、快照、截图和日志是受维护的一等桌面能力，不是因公开分发尚未开启就可以删除的可选残留。
- **Daemon 控制平面**：拥有设备身份、能力目录、授权、生命周期和路由；插件不能绕过它接触长期凭据。
- **Native Capability**：由受信任 binary 内置、固定且版本化的能力 allowlist。安装插件不会凭空增加新的 OS 权限类型。
- **Plugin**：贡献 UI 和组合逻辑。普通插件升级不要求重新发布移动 App。
- **数据通道**：控制消息、文件/对象与持续媒体流分离；Plugin JSON RPC 不承担音视频数据面。

## 跨区域边界与现实差距

- BySpace 保持 local-first、self-hosted、BYOK、无强制账号与无遥测；代码、凭据和长期设备身份仍由用户拥有。
- Web 功能不能因原生客户端恢复而退化；平台差异应收敛在真实平台边界，不重新扩散成全仓库条件分支。
- 客户端提供能力，daemon 协调能力，插件组合能力。
- 上游同步覆盖所有受维护客户端及其测试、构建、打包和休眠发布源码；公开分发成熟度不构成省略 Android/iOS/Electron/Browser 的理由。
- 首轮设备协作只承诺同一 daemon 下的设备；P2P、TURN 与多 daemon Device Mesh 尚未成为目标实现。
- iOS 的公开分发与动态插件政策必须由真实签名构建和 App Review 验证；当前只保留共享源码、平台边界与休眠发布流水线。
- 当前公开发行仍是 Web/PWA + CLI + daemon；Android internal artifact、macOS Electron package 与 Desktop Browser 已完成真实主旅程，iOS source/prebuild 和其余 Native/Desktop 维护面已由 [`Epic 005`](../epics/005-x-native-client-resurrection/spec.md) 闭合。现行事实见 [`codestable/spec/index.md`](../spec/index.md)。
- 原生恢复的范围与证据来源见已关闭的 [`原生客户端复活审计`](../issues/048-x-native-client-resurrection-audit/index.md)。
- Device Registry、File Handoff、实时音频和 OS 虚拟麦克风将在完整客户端基础闭合后分别摘取，不提前塞进当前 Epic。

## 用语与下一步读哪

- **Host**：运行 BySpace daemon、拥有工作状态与插件运行时的计算环境。
- **Client**：完整呈现 BySpace 产品并连接 Host 的 Web、Desktop 或 Mobile 应用。
- **Device Capability**：某台客户端设备由受信任 binary 提供、需要核心授权的系统能力。
- **Device Fabric**：让设备被识别、声明能力、接受授权并跨设备传递 Event/Blob/Stream 的基础层。
- 想理解今天已经能做什么 → [`codestable/spec/index.md`](../spec/index.md)
- 想理解为何恢复完整客户端 → [`codestable/issues/048-x-native-client-resurrection-audit/index.md`](../issues/048-x-native-client-resurrection-audit/index.md)
- 想查看完整客户端基础的已关闭范围与证据 → [`codestable/epics/005-x-native-client-resurrection/spec.md`](../epics/005-x-native-client-resurrection/spec.md)
