---
kind: issue
title: "建立 Web-only fork 基线"
type: feature
status: open
created: 2026-07-14
epic: ".cs/epics/2026/07/14/web-only-paseo-fork/spec.md"
---

# 建立 Web-only fork 基线

## 目标

从干净 checkout 可以安装依赖并构建浏览器 Web、daemon 和 CLI；仓库不再包含或发布 Electron、iOS、Android 和内置 Browser，同时现有 hosted Web → relay/direct → local daemon → Agent 主路径及完整 Provider 接入能力保持可用。

## 范围

- 包含：
  - 把 Paseo 主线 git 历史接入当前工作区，并保留可追踪的 upstream。
  - 删除 Electron package、构建脚本、发布工作流和共享 App 中的 Electron 专用集成。
  - 删除 iOS/Android 构建发布面、原生入口与只服务原生客户端的依赖和实现，使 App 成为 Web-only 构建。
  - 删除内置 Browser 的 UI、协议、daemon broker、Agent 工具和测试切片。
  - 保留全部直接 Provider、ACP、自定义 Provider 和 Catalog。
  - 调整 workspace、根脚本、开发命令、文档和 CI 到剩余产品面。
  - 运行 Web、server/CLI 和相关协议测试与构建。
- 不包含：
  - 远端仓库创建、公共版本发布和 Cloudflare Pages 实际部署；由后续发布 issue 负责。
  - Pi 专属体验优化。
  - Voice、Schedule、Loop、Terminal、Git/PR、Worktree 等尚未明确要求删除的能力。
  - daemon Go 重写或新的插件系统。

## 归属

- 隶属 epic：`.cs/epics/2026/07/14/web-only-paseo-fork/spec.md`
- 相关 spec：`.cs/epics/2026/07/14/web-only-paseo-fork/spec.md`

## 背景与证据

- Paseo 当前用一个 Expo App 同时承担 iOS、Android、浏览器 Web 和 Electron renderer，平台发布面独立但共享根布局、依赖和协议。
- `packages/desktop` 与桌面发布工作流可以独立删除；原生构建脚本和 workflow 也有清楚入口。
- 内置 Browser 虽由 Electron webview 承载，但还跨越 App panel、protocol browser automation、daemon broker 和 Agent tool catalog，必须按完整路径删除。
- Provider 工厂和通用 ACP 已形成可复用接缝，不属于本轮裁剪对象。

## 待确认问题

- Voice 是否在后续单独删除；它不是本 issue 的默认范围。
- 部分 Expo/React Native Web 依赖即使名称包含 native 仍可能是 Web 构建基础，必须由实际 import 和构建结果判断，不能按包名机械删除。

## 现状如何工作

同一个 monorepo 通过协议与客户端库连接 App/CLI 和本地 daemon。App 的 Expo 导出生成 hosted Web，同时也通过平台扩展和运行时 gate 支撑移动端与 Electron。daemon 在本地管理 Agent、时间线、工作区、终端和 relay，Provider registry 将各种上游 Agent 归一到同一生命周期。内置 Browser 从 Electron pane 注册浏览器能力，经共享协议与 daemon broker 暴露给 Agent 工具。

## 影响范围

- 必须修改：根 workspace 与脚本、Electron package/workflow、App 的平台配置和根组合、Browser 的 App/protocol/server/tool 切片、开发与发布文档、CI job。
- 需要验证：Web 路由与 host 连接、协议生成验证、server bootstrap、Provider registry、CLI daemon 管理、relay 连接、Web 构建产物、干净安装。
- 仍待调查：哪些 Expo/React Native 依赖只服务原生，哪些 Electron helper 以通用命名进入 App；Browser 工具是否被其他保留能力间接引用。

## 方案判断

不重写 Web 或 daemon，而是在现有可运行纵向路径上按外到内删除。先移除独立 package、workflow 和构建入口，让剩余目标明确；再沿 import 和协议引用删除平台实现；最后删除 Browser 跨层切片。每完成一个边界就运行最小相关检查，避免一次大删后无法定位 Web 回归。Provider 层尽量不改，降低未来移植 Paseo 上游更新的成本。

## 实现设计

### 这次要怎么做

把当前多端发行版收缩为一个 Web-only 发行版，但继续使用 Paseo 已有的 Web 客户端、协议、daemon、relay 和 Provider。源码删除以“剩余 Web 构建是否仍需要”为准，而不是看到 Electron、Expo 或 React Native 名称就机械移除。Browser 则按用户能力整体移除，避免留下不可达协议和服务。

### 功能怎么分工

- 仓库与构建层只声明 Web、daemon/CLI、relay 和这些产物真正需要的共享包。
- Web App 继续负责 host 连接、工作区和 Agent UI，但不再启动或调用桌面 daemon bridge、原生通知/扫码/音频等平台入口。
- daemon 继续负责本地执行和状态；Browser broker 及其工具入口被删除，其他能力保持原职责。
- Provider 层继续作为独立上游对齐区域，不因客户端裁剪改变接口。

### 请求 / 数据怎么走

用户打开 Web 后，客户端仍通过共享 client/protocol 建立 direct 或 relay WebSocket，daemon 处理工作区与 Agent 请求并把 Provider 事件写入权威时间线。此次变化只删除产生 Electron/native 客户端行为以及 Browser automation 请求的入口和处理链，不改变正常 Agent 请求的数据含义。

### 哪些边界不碰

- 不改变 Agent Provider 的会话语义和事件归一化。
- 不顺手删除未确认的 daemon 功能。
- 不承诺继续解析已删除 Browser 功能的 fork 内旧客户端；这是新 fork 的首次协议基线。
- 不在本 issue 完成品牌、npm 发布身份或远端部署。

### 设计侧重点

- **可维护性**：Provider 区域保持接近 upstream；客户端删除以清楚的完整能力切片为单位，不留下无主 gate。
- **可靠性**：每个删除阶段都由 Web/server/CLI 的聚焦构建保护，最终以干净安装证明没有依赖本机旧产物。
- **可测试性**：验证用户可观察的 Web 连接与 Agent 主路径，并保留协议与 Provider 现有测试，而不是为删除后的内部形状新增大量断言。

### 一步步怎么改

1. 在当前工作区初始化 git，获取并检出 Paseo 主线历史，保留 `.cs` 文档。
2. 建立基线检查，确认未修改源的 Web、server 和 CLI 构建入口。
3. 删除 Electron package、workflow、根脚本和 App Electron bridge/variants。
4. 删除 iOS/Android workflow、配置、脚本和经引用证明确认为原生专用的实现与依赖。
5. 沿 App → protocol → daemon → tool catalog 删除内置 Browser。
6. 清理 workspace、锁文件、文档、开发脚本和 CI，只保留剩余产物。
7. 从干净依赖状态运行聚焦测试、typecheck、lint 与 Web/server/CLI build，修复裁剪回归。

### 怎么确认做对

- `npm ci` 能从干净 checkout 完成。
- Web 导出成功，且没有 Electron/native 启动入口或 Browser UI。
- server 与 CLI 构建、类型检查成功。
- protocol 生成与相关测试成功，Browser 消息不再属于 fork 协议。
- Provider registry 和 Catalog 仍包含现有接入面。
- CLI 能启动隔离 daemon，Web 能连接并完成至少一个 Pi 会话的创建/流式输出/恢复冒烟验证；真实凭据或运行环境阻塞时记录可复现的手动步骤。

## 验证

- `npm ci`：通过，干净重装后共安装 1851 个 package。
- `npm run build:server:clean`、App typecheck、Web export、root typecheck、root build：通过。
- `npm run lint`、`npm run format:check`、`git diff --check`：通过。
- Protocol：38 files / 304 tests 通过；Client：4 files / 114 tests 通过。
- App 受影响切片：6 files / 117 tests 通过；Browser 删除后的 server 配置/MCP 切片：3 files / 151 tests 通过。
- CLI foundation、daemon、daemon launch supervision：通过；Provider 列表与禁用状态验证通过，模型查询因当前验证环境没有安装 Claude/Codex/OpenCode/Pi CLI 而按预期报告 provider unavailable，未完成真实 Pi 会话冒烟。
- Nix npm dependency hash 由固定 nixpkgs revision 重新计算并通过 `update-nix.sh --check`；`nix build .#default --no-link` 在干净 Nix 容器通过。
- 全量 server unit 额外跑到 238 files / 3296 tests 通过，仅 `src/terminal/terminal.test.ts` 两个 zsh 用例在清理临时目录时稳定报 `ENOTEMPTY`；单文件重跑仍复现，和本次裁剪路径无关。
- 精确残留搜索确认 Browser automation、Electron variants、native variants 均为零；唯一 `packages/desktop` 字样位于未修改的 Claude tool-call mapper 测试输入 fixture。

## 执行记录

- 将当前工作区接到 Paseo `279e1aa91` 历史，`upstream` 指向 `getpaseo/paseo`，并保留 `.cs`。
- 删除 `packages/desktop`、`packages/expo-two-way-audio`、Android/iOS/EAS/Fastlane/Maestro、桌面/移动发布 workflow 与 Nix desktop output。
- 将共享 App 真正收缩到浏览器 Web 路径，删除 Electron bridge、native implementation、native-only dependencies 和恒假平台 stub；保留 Expo/React Native Web 与 browser voice。
- 完整删除内置 Browser 的 App UI/state、protocol、client、daemon broker/config/WebSocket routing、Agent MCP tools、测试和文档；Service Proxy、文件预览及普通 browser runtime 不变。
- Provider registry、全部 Provider/ACP 源码、relay 源码和 service proxy 源码没有改动。
- CI App job 新增 Web export，Nix workflow 删除 desktop build 并改为校验固定 hash；文档和 Agent 指令更新为 Web-only 边界。

## 关闭回写

- epic spec：回写实际保留能力、删除边界、验证结果和发布 issue 的前置条件。
- notes：若裁剪发现影响后续 upstream 移植的非显然约束，再沉淀可复用经验。
- AGENTS.md / CLAUDE.md：只有出现每次 Agent 启动都必须知道的短规则时再写。
- tools：无稳定重复流程前不新增工具。

## 关闭结论

- 关闭判断：待用户在实现与验证完成后授权关闭。
- 验证摘要：待执行。
- 回写位置：待关闭。
- 遗留事项：首次发布与部署由后续 issue 承接。
