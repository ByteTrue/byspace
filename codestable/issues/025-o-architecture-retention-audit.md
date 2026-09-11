---
kind: issue
title: "架构去留审计与清理决策"
type: chore
status: open
created: 2026-09-10
---

# 架构去留审计与清理决策

## 范围与决策状态

**执行状态（2026-09-12）：** 除批次 7（provider 收缩，Owner 指示暂缓）外全部执行完毕——Web UI 默认开启（399d5a210c）、原生移动端退出（da626db362）、Electron 退出（b1c37223af）、Hub 移除（446bc38a3d）、插件系统移除（a5c6bb6588）、语音移除（8d96875115）、Nix 与营销站移除（e61194ccd1）。归档 ref：archive/pre-{mobile,electron,hub,plugin,voice,nix-website}-removal。

Owner 于 2026-09-11 确认 Web/PWA + daemon 路线：移动原生与 Electron 退出，现有网页技术暂不更换；内嵌浏览器不保留，SSH 移除（同日修订，见 A5），Hub 移除，Docker 保留。本 Issue 记录已确认方向、待决项与执行门槛；不代表已经取得精确删除批次、数据迁移或停部署的执行授权。

- **审计基线：** 静态审计在 `6e8e98a1042e1161dd6512ea3df1d531f69a04ab`（v0.13.0），SSH 补充核对在 `a54087a1d14c6bff45064dd678b572c6263e4344`。**当前基线：** `8ce02b66707dad700eea9104ecd308a35779316c`（Paseo v0.8.0 同步合并后，PR #34），关键路径已复核，见下。
- **上游状态：** 最后一次 Paseo `0.8.0` 正式版同步已于 2026-09-11 完成并合并。此后 BySpace 独立发展，上游仅作参考，不再追版本。局域网连接用 daemon 监听局域网地址 + 内置 Web UI 同源直连；远程走 Relay；SSH 已改判移除（见 A5 修订）。
- **优先级：** 先整理架构，[Orchestrator](026-o-cross-workspace-orchestrator.md) 暂不启动；不为未来助手或插件工具箱预建框架。
- **本轮行为：** 只读源码、文档、包清单和构建配置，维护审计与决策记录。不改运行时，不读取个人配置或凭据，不控制 daemon，不查询或改动线上部署。
- **证据边界：** 有静态调用和配置证据；没有本轮真机 PWA、运行时性能、产物体积、CI 计费或删除后回归证据。下文的成本等级指改动范围与验证难度，不是工时报价。

上游同步已完成，关键路径在 `8ce02b6670` 上的复核结论：SSH 实现四处证据（CLI 隧道、Electron local-transport、protocol ssh-transport）全部仍在且未被改动，承接方案不受影响；Hub 集成随 0.8.0 增长了 organization triggers（`.paseo/triggers/`），移除范围比审计时略大；插件系统新增 header buttons、custom providers、settings screens、client slash commands、lifecycle hooks/transforms，待决项的影响面相应扩大；changelog 更新为 in-app 特性，品牌路径已改为 ByteTrue；Electron Linux 桌面标识钉为 `BySpace.desktop`。仓库迁移另见[已有交接记录](../talks/002-repo-identity-cleanup-and-pending-migration.md)，不与本轮客户端清理自动合并。

## 目标主干

```text
同一份 Web UI
├─ 电脑浏览器
└─ 手机 PWA：轻量查看、输入、批准
          │
          ├─ Direct：本机同源 / 受保护的远程连接
          └─ 可选 Relay：远程访问
                    │
                  daemon
                    ├─ Agent / Terminal
                    ├─ Workspace / 文件 / Git
                    └─ 已有自动化与工具能力

CLI：安装、启动、诊断和脚本入口
Web UI：可由 daemon 内置提供，也可使用托管版本
```

不另建手机前端，不要求浏览器运行 agent，不把 daemon 改成插件宿主后再恢复现有功能。手机的“轻量”先体现为使用方式和响应式布局，不据此删除 Compact Web 的输入、选择、导航与恢复能力。

### 现有结构中值得保留的边界

根 `package.json` 有 11 个 workspace。当前 npm 发布流程将 CLI 和 6 个内部运行时包合为一个 `@bytetrue/byspace` 产物，并测试安装时不访问 `@getpaseo` registry。内部包名不意味着需要逐个发布、部署或继续同步上游。

- `protocol`：共享 wire 契约与生成验证器。
- `client`：连接和 daemon API，供 Web、CLI 等复用。
- `server`：机器侧执行与持久化。
- `relay`：远程传输，同时有库代码和可部署 Worker。
- `highlight`：跨 app/server 的语法处理。
- `plugin`：上游插件 SDK，是否保留见下文独立决策。

这些边界先保留。仅为减少目录数量合包，会同时碰浏览器/Node 导出、构建顺序和 npm 依赖闭包。

证据：`package.json:23`；`scripts/package-bytetrue-baseline.mjs:17`、`:95`、`:127`；`.github/workflows/npm-release.yml:89`、`:102`。

## A · 客户端形态

| ID  | 能力与现状                                                    | 建议                                                            | 损失、牵连与成本                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Web 与手机 PWA 共用现有 app                                   | **保留为主入口**                                                | 保留宽屏和 Compact Web 两种布局；不把“无原生客户端”解释为不再验证手机浏览器。成本中：需要真实手机验收，而非新写一份 UI。                                                                                                                                                                                                                                                                               |
| A2  | iOS unsigned IPA、Android 签名 APK                            | **已确认退出方向，待执行授权**                                  | 放弃原生分发、系统集成与不受浏览器 mixed-content 规则限制的连接方式。Android APK 本来不依赖 Google Play；退出理由是维护成本，不是必须交商店费用。成本中高，影响构建、模块、通知、输入、更新与发布元数据。                                                                                                                                                                                              |
| A3  | Electron 本地 daemon 管理与桌面更新                           | **已确认退出方向**                                              | CLI 已可独立启动 daemon，但不等价于 GUI 的安装、启动和更新体验。关闭浏览器后任务应继续运行；不补造第二个常驻桌面管理器。SSH 不再是前置条件（A5 已改判移除）。成本高。                                                                                                                                                                                                                                  |
| A4  | Electron 内嵌浏览器、持久浏览器 profile、人工接管与自动化 IPC | **已确认不保留，随 Electron 退出**                              | 不重做内嵌浏览器、登录态、标签页、页面选择附件或人工接管。Playwright 可继续作为独立自动化工具，但不承诺继承 Electron profile，也不清除用户浏览器数据。                                                                                                                                                                                                                                                 |
| A5  | SSH 接入、本地 socket transport                               | **已确认移除（2026-09-11 修订）；socket/pipe 随 Electron 退出** | Owner 复核后撤销保留决定：局域网用 daemon 监听局域网地址 + 内置 Web UI 同源直连（页面与 WS 同源，无 mixed-content 限制）；远程走 Relay；SSH 仅剩“远端只开 22 端口”的边角价值，不值得维护整条链路。浏览器无 TCP 原语，无 daemon 时纯浏览器 SSH 本就不可能。曾实现的 daemon 隧道批次（8ab3b2f218）已 revert（9272812e5b）。CLI 的 `ssh://` 解析与 Electron socket/pipe transport 随 A3/A6 批次一并退出。 |
| A6  | 桌面文件路径、编辑器跳转、原生对话框、通知和窗口集成          | **随壳退出，保留已有 Web 路径**                                 | 浏览器上传不提供任意本地绝对路径或目录权限；daemon 的文件操作针对 daemon 所在机器。不为补齐全部桥接再写浏览器扩展或新外壳；具体损失列入执行前影响报告。                                                                                                                                                                                                                                                |
| A7  | daemon 内置 Web UI                                            | **已确认改为默认开启，待执行授权**                              | 历史上默认 `false` 是上游保守默认，与 Web/PWA 主干路线相悖：目标体验就是“安装 daemon → 打开浏览器即可用”。执行时需验收绑定地址、启动提示与既有 `PASEO_WEB_UI_ENABLED` 覆盖链；Docker 镜像已默认开启，不受影响。                                                                                                                                                                                        |
| A8  | Web Push 与离线能力                                           | **保留现有 Web Push；不扩为离线优先架构**                       | SW 没有 fetch/cache；冷启动通知只开根页面，已有窗口才转交 app 定向导航。完整真机推送投递没有既有手测证据。PWA 替代前应验证或明确接受这些边界，不能宣称已实现全离线与原生通知等价。                                                                                                                                                                                                                     |

### SSH 移除说明（2026-09-11 修订）

原“daemon 承接 SSH 隧道”方案已废弃，实现已 revert。替代矩阵：

- **局域网**：daemon `listen` 配置局域网地址，内置 Web UI 从 `http://daemon-ip:6777` 同源提供，页面与 WebSocket 同源，无 mixed-content 限制；手机连同一网络直接用。
- **远程**：Relay（已保留）。
- daemon 原生 TLS 监听（让 HTTPS 页面直连 `wss://`）作为潜在后续增强，暂不立项。

### PWA 入口的硬约束

- iOS Web Push 需要 iOS 16.4+、加入主屏幕并从 PWA 入口使用；用户手势触发授权。
- HTTPS 页面不允许连接非 loopback 的 `ws://`。手机上访问 daemon 的明文 LAN 页面与 HTTPS PWA + Web Push 不是同一套条件；需要 Relay、`wss://` 或受信 TLS 入口。
- Web/PWA 不提供任意手机后台执行。重任务继续归 daemon，浏览器关闭不等于 daemon 停止。
- 不删除共用的 push token store 或 wire 字段来清理 Expo；Web Push 复用同一 token 注册协议。

证据：`packages/desktop/src/preload.ts:84`、`:116`；`packages/desktop/src/main.ts:29`；`packages/cli/src/commands/daemon/local-daemon.ts:132`；`packages/server/src/server/config.ts:397`；`packages/app/public/sw.js:1`、`:79`；[连接边界](../spec/connection.md)、[通知约束](../spec/notifications.md)、[Issue 023 的验证缺口](023-x-web-push-notifications.md)。

## B · 前端技术栈

| ID  | 对象                                                | 建议                                         | 原因、牵连与成本                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Expo / Metro / React Native Web / Expo Router       | **先保留，不做 React DOM + Vite 整体重写**   | Web 已经使用这套栈。删除原生发布不要求同时替换路由、样式、组件、输入与状态生命周期。整体替换成本高，且会把架构整理变为重新验证整个产品。以后可以按真实问题迁移局部。                                                                                          |
| B2  | Unistyles、Reanimated、手势、键盘与布局             | **保留 Web 实际使用的部分**                  | “名字像原生库”不能作为删除依据。宽屏/Compact Web、Terminal、面板与弹层也依赖共同布局机制。先看 Web 解析与调用链，再收掉只服务原生的部分。                                                                                                                     |
| B3  | `.electron.*`、`.native.*`、`.web.*` 和无后缀文件   | **按真实解析结果裁剪，不按文件名批删**       | Metro 的 Electron overlay 先找 `.electron.*` 再回落 Web。无后缀文件可能是共享实现、Web fallback 或 TypeScript 类型入口；删原生文件也不自动删除共享导出与构建引用。成本中高。                                                                                  |
| B4  | 原生模块、自定义音频包、Terminal WebView 与生成资源 | **随原生退出裁剪，Web 音频和 Terminal 保留** | `expo-two-way-audio` 的 app runtime 调用只在 `audio-engine.native.ts`；Web 有独立实现。该包仍挂在 app manifest、`build:app-deps`、CI 和脚本测试中，清掉这些构建引用后可整包移除。Terminal 原生 WebView、Mermaid 资源和浏览器 xterm 分开识别，不删除共享协议。 |
| B5  | 多语言、Appearance、Terminal/Timeline 状态 owner    | **本轮保留**                                 | 已有用户能力与跨端正确性，不因移动原生退出变成死代码。尤其 Appearance 既有主题、字体、字号与持久化有明确保留边界。不得借清理恢复历史已撤回的定制。                                                                                                            |

证据：`packages/app/metro.config.cjs:13`、`:54`、`:79`；`packages/app/src/constants/platform.ts:23`；`package.json:64`；`packages/app/package.json:30`、`:38`；`packages/app/src/voice/audio-engine.native.ts:73`、`packages/app/src/voice/audio-engine.web.ts:88`；[Expo Router](../../docs/expo-router.md)、[Unistyles](../../docs/unistyles.md)、[Mobile Panels](../../docs/mobile-panels.md)、[既有保留清单](../epics/002-x-retained-capabilities-delivery/spec.md)。

## C · daemon 与运行能力

| ID  | 能力                                                     | 建议                                              | 损失、耦合与成本                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Agent Providers、会话与时间线                            | **保留当前能力，不以清理名义只留某一个 provider** | 已有 provider 与原生 Terminal 并存的决策仍有效。停止上游同步不会消除 provider SDK/CLI 的变化成本；是否缩减 provider 支持需单独确认。                                                                                                                                                                |
| C2  | Terminal、PTY、活动 hooks、Windows 适配                  | **保留**                                          | Electron 退出不代表 Windows daemon 或浏览器 Terminal 退出。背压、revision 恢复、粘贴、中文和尺寸同步是既有正确性约束，不是平台冗余。                                                                                                                                                                |
| C3  | Workspace、worktree、文件、Git/Forge、布局与持久化       | **保留现有主干**                                  | 它们服务当前开发工作流，也供 UI、CLI 和工具调用复用。清理不得修改用户仓库、重建会话 ID、丢弃布局或搬迁用户数据。                                                                                                                                                                                    |
| C4  | MCP、注入工具与异步结果回传                              | **保留现有能力，不扩 Orchestrator**               | 当前编排原语已有用途；上层统一跟进另由 Issue 026 负责。它们不能因“未来不采用上游插件系统”而一起删掉。                                                                                                                                                                                               |
| C5  | Schedules / Heartbeats、workspace 脚本                   | **首批保留**                                      | 后台自动化独立于客户端壳，也是已有产品能力。避免为了暂不实施的新助手先拆旧能力，再重造相同调度基础；本轮不预建新调度器。                                                                                                                                                                            |
| C6  | 上游插件系统与 SDK                                       | **已确认完整移除，待执行授权**                    | Owner 已确认不是工具箱方向，且 provider 扩展路径改走 `config.json` custom provider + skill/提示词适配（见 C9）。删除运行时、SDK、客户端表面、plugin-examples、脚手架与专属文档；保留 wire 解析契约与 protocol 字段（旧客户端可解析）。独立发展后不再承担上游插件 API 的兼容包袱。                   |
| C7  | Paseo Hub 接入                                           | **已确认移除专用集成，待执行授权**                | 这是 daemon 主动连接外部 Hub 服务的集成，有登录、关系存储、权限与执行恢复；不经 Relay，也不等于 Issue 026 的本地编排者。删除专用 UI/CLI/连接与执行入口，保留共用的 Agent 生命周期、权限和 wire 解析契约；不另造 BySpace Hub 服务。                                                                  |
| C8  | 语音输入、STT/TTS 与实时语音                             | **已确认全部移除（方案 C），待执行授权**          | 听写、实时语音对话、TTS、daemon speech provider（local sherpa-onnx + openai）、音频双声道包与相关配置一并退出。删除时注意与手机轻量入口解耦：PWA 仍可用浏览器原生输入法。追踪 `packages/expo-two-way-audio`、`server/speech/`、app 端 voice/audio 模块与协议事件。                                  |
| C9  | Relay、安全、协议与恢复                                  | **保留主干契约**                                  | 去掉壳或断开上游不消除托管 Web、CLI 与 daemon 的版本漂移。保留 wire 解析兼容、capability gate、认证、DNS rebinding 和 E2EE；不用放宽安全规则换取接入方便。                                                                                                                                          |
| C11 | 内建 agent provider 收缩（claude/codex/opencode/pi/omp） | **已确认收缩，待执行授权**                        | 保留 claude、codex、opencode、pi、omp；移除 cursor、kimi、kiro、trae、copilot、generic ACP、mock load test 等其余内建适配器。用户适配新 agent 走 `config.json` custom provider（ACP 接入/自定义二进制/API 端点/profiles，独立于插件系统）+ skill/提示词指导；单独成批执行，不动 provider 注册框架。 |
| C10 | Service Proxy：workspace 脚本的 HTTP 访问                | **保留现有能力，不随 Electron 浏览器删除**        | 它由 daemon 为脚本服务提供访问地址，与 Electron 内嵌浏览器、Agent 消息 Relay 分工不同。公网暴露仍有 DNS/TLS/权限边界；本轮不调整域名或暴露范围。                                                                                                                                                    |

### 插件能力与依赖风险

现有 SDK 区分 shared / client / server，前端插件基于 React Native，并借用所选 host 的连接；这不是独立离线工具运行时。插件代码不应当被当作安全隔离的第三方代码执行环境。

当前打包器还明确记录了一处 ACP 版本折叠限制：server 使用 `@agentclientprotocol/sdk ^0.17.1`，plugin 使用 `^1.4.0`，单一 npm 产物以 daemon 版本为准。依赖新 ACP API 的插件不保证与 repo/desktop 安装行为一致。本轮只确认声明与打包逻辑，没有运行第三方插件复现。若保留插件支持，这是一项实际兼容风险；不是仅凭包名就能删除或合包的理由。

证据：`packages/server/package.json`、`packages/plugin/package.json`；`scripts/package-bytetrue-baseline.mjs:95`；`packages/server/src/server/bootstrap.ts:587`、`:641`、`:1265`；`packages/server/src/server/plugins/index.ts:135`；[SDK 边界](../../docs/plugins.md#sdk-import-boundaries)、[Hub](../../docs/hub.md)、[Service Proxy](../../docs/service-proxy.md)、[Agent 生命周期](../../docs/agent-lifecycle.md)、[权限](../../docs/permissions.md)、[协议兼容](../../docs/protocol-compatibility.md)、[Terminal 契约](../spec/terminal.md)。

## D · 发布、依赖与维护承诺

| ID  | 表面                                           | 建议                                                | 影响、恢复与成本                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `@bytetrue/byspace` npm 包与 CLI               | **保留为安装主线**                                  | 当前已聚合内部包，内置 Web 也随版本打包。不为“独立项目”批量改所有内部包名；先保住可安装、可启动、可升级与不依赖上游 registry 的验证。                                                                                                                                                                            |
| D2  | 托管 Stable/Beta Web                           | **保留现有双通道**                                  | 是既有 B01 决策；与 daemon 内置 UI 共用源代码。退出原生分发不意味着停托管域名，也不要求新增独立手机站。线上域名/部署变化需另行确认。                                                                                                                                                                             |
| D3  | 单 Relay 通道                                  | **保留现有远程入口及适配器**                        | 当前配置使用 `relay.byspace.cc.cd:443`，仓库有 BySpace Worker 入口。旧文档另称生产是上游 Elixir 服务；本轮没有查询控制台确认线上映射，不能据此删 Cloudflare adapter。远程入口仍有域名、TLS、运行配额与运维成本。                                                                                                 |
| D4  | iOS / Android / Electron 发布流程              | **随 A2/A3 验收与执行授权后退出**                   | 涉及三个当前 workflow，以及构建依赖、平台测试、版本元数据和更新协议。先满足 SSH 等保留能力的前置条件，再清理退出产品的发布链；不删除历史 Release、签名密钥或用户安装数据。                                                                                                                                       |
| D5  | Website 源码                                   | **已确认移除，待执行授权**                          | 没有当前部署 workflow，但 package 内 `deploy` 仍可调用，不能说已物理禁用；Wrangler 仍留上游站点身份。保留 `public-docs`，迁走 README 引用的截图并修链接。移除源码不授权删线上域名、站点或 Cloudflare 配置。                                                                                                      |
| D6  | Docker                                         | **已确认保留**                                      | 当前构建 amd64/arm64 daemon + Web 镜像，默认启用内置 UI，不预装 agent CLI。它复用同一份 Web，不引入另一套客户端栈。                                                                                                                                                                                              |
| D7  | Nix                                            | **已确认移除，待执行授权**                          | Owner 不使用 Nix/NixOS；npm-deps.hash 随依赖变更频繁过期是持续负担（本次同步已破过一次）。移除 flake.nix/lock、nix/ 目录（daemon 包、module、desktop 包）、`update-nix.sh`/`fix-lockfile.mjs` 的 nix 部分、`.github/workflows/nix.yml` 与 npm-deps.hash 维护链。Linux daemon 支持不受影响（npm/Docker 仍提供）。 |
| D8  | EAS / 商店 / Fastlane / F-Droid 元数据与旧说明 | **先区分仍活跃的 APK 生成链与遗留内容，再成组清理** | F-Droid changelog 当前仍接在根 `version` 生命周期；不是删目录即可。若 Android 退出，连同钩子、校验、版本推导和对应文档一起处理。商店集成的线上状态本轮未查询。                                                                                                                                                   |
| D9  | 质量门禁与发布文档                             | **跟随批准后的支持矩阵收缩，保留剩余行为覆盖**      | 更新 root scripts、workspace 列表、lockfile、CI 路径路由与 release 完成清单。只删除已退出产品的专用门禁；Web、daemon 三 OS、Relay、CLI 的测试不能连带减少。                                                                                                                                                      |

### 已确认的文档漂移

`docs/release.md` 开头描述当前 BySpace 的单 npm 包、APK 与 unsigned IPA；后文仍混有 `@getpaseo/*` 逐包发布、EAS/TestFlight/商店提交及不存在于当前 workflow 列表的流程。根实际脚本与八个 workflow 应作为核验依据，不能把这些旧段落当成当前额外承担的线上任务。

`docs/architecture.md:178` 和 `docs/release.md:131` 的上游 Elixir Relay 说明，与 `packages/relay/wrangler.toml` 的 `byspace-relay` / `relay.byspace.cc.cd` 配置及 B01 的 Worker 历史记录不一致。不能用旧说明判定 BySpace adapter 无线上用途。官网同理：无 workflow 不代表 package 内不能手动部署。本轮不运行这些部署命令。

`codestable/vision/index.md` 仍写持续同步，旧 talk 也有“暂不独立”的历史结论。当前过渡安排由后来的[交接记录](../talks/002-repo-identity-cleanup-and-pending-migration.md)与本轮 Owner 前提补充；最后一次同步完成后再毕业为正式独立边界，不改写历史讨论。

证据：`.github/workflows/`；`package.json:64`、`:88`、`:97`、`:109`；`.github/ci-paths.yml`；`docs/release.md:9`、`:113`、`:159`、`:272`；`packages/website/package.json:12`、`packages/website/wrangler.toml:1`、`README.md:27`；`packages/relay/wrangler.toml:1`；`flake.nix:39`、`nix/module.nix:219`；[B01 最终记录](../epics/001-x-legacy-cs-requirements-triage/decision-matrix.md)；`codestable/vision/index.md:53`。

## 执行顺序与回退规则

本节是建议顺序，不是本轮要执行的任务。

1. **剩余取舍已全部确认。** 主干路线、浏览器退出、SSH 保留、Hub 移除、Docker 保留、插件系统完整移除、语音全移除、provider 收缩至五家、Nix 移除、营销站移除、内置 Web 默认开启均已定案；后续批次只做影响报告与执行授权，不再重新审批方向。
2. **完成最后一次上游同步，重新定基线。** 重新检查本清单涉及的源代码与构建依赖，不重放旧版本的删除脚本。仓库迁移如果也要做，单独安排窗口。
3. **给出执行前影响报告。** 精确 SHA、文件/能力清单、数据边界、验证命令、发布影响、远程归档 ref 与恢复步骤全部列齐，再请求执行授权。SSH 明确承接机器和鉴权边界。本轮没有创建远程归档或操作分支。
4. **退出桌面壳。** 按批准批次裁剪原生移动端、Electron 及其构建、更新、依赖、门禁和说明，不长期留下半退出状态。SSH 不再是前置条件（A5 已改判移除）。
5. **保持 Web 现有栈完成验收。** 不同时迁移 React DOM、重写插件系统或开发 Orchestrator。
6. **分别裁剪附加能力。** Hub 专用集成按已确认方向单独处理；其余可选项按后续决定安排，不把所有删除风险混入客户端退出的一批改动。

### 回退必须覆盖两种状态

- **源码与产物：** 用归档 SHA 恢复相应删除批次及其构建/发布配置；保留最后可用的安装包。已发布 npm 版本不能覆盖，恢复发布时使用新版本号。
- **用户与线上状态：** 不清除 `$BYSPACE_HOME`、客户端 profile、浏览器登录态、证书或密钥。Git 回退不能恢复这些数据，也不能代替恢复 CI secrets、域名和部署配置。需要迁移或停服务时另行备份、审计并确认。

现有终端、会话和 workspace 不能因审计或构建被中断。不重启 6767/6777 daemon；后续验收使用隔离 home、随机或批准的开发端口。

## 删除前需要的验证证据

这些是未来执行门槛，本轮没有声称已通过：

- 新安装 npm 包，启用内置 Web，配对、重连、升级和关闭浏览器后的 agent 继续执行。
- 宽屏浏览器与手机 PWA 的发送、权限回复、Workspace 切换、后台返回及输入法/键盘行为。
- 真机 Web Push 的授权、投递和点击；冷启动到首页的边界由 Owner 接受或另开修复，不隐含承诺深链或离线。
- Direct / Relay、Terminal 输入输出/粘贴/恢复；保留 daemon OS 的专项证据。
- ~~经 daemon 的 Web/PWA SSH 接入~~（已废弃，见 A5 修订）。
- 已保存 Electron SSH Host 与信任记录的接续方案；退出的浏览器 profile、原生通知等能力有处置说明，不静默搬凭据、丢数据或让配置失效却没有提示。
- Web 构建、npm 产物依赖闭包与受影响的定向测试；完整套件交 CI，本地不跑全仓测试。
- 按剩余支持矩阵核对 CI 必需检查、workflow 触发、release 完成清单与用户文档，不能只让 TypeScript 通过。

## 已确认与待决项

**已确认方向：** Web/PWA + daemon 为主干；移动原生与 Electron 退出；现有网页技术暂不替换；内嵌浏览器不保留；SSH 移除（局域网走内置 Web UI 同源直连，远程走 Relay）；Hub 移除；Docker 保留；上游插件系统完整移除（provider 扩展改走 config custom provider + skill 适配）；语音全部移除；内建 provider 收缩至 claude/codex/opencode/pi/omp；Nix 移除；营销站源码移除；daemon 内置 Web UI 改默认开启。

**不自动改变：** CLI、现有 Relay 和双 Web 通道、daemon 的 macOS/Linux/Windows 支持、Schedules/Heartbeats、MCP 注入工具、Workspace/Git、Appearance、协议和安全边界。

**仍待决定：** 无。方向全部定案；所有删除批次进入影响报告与执行授权阶段。

本 Issue 保持 open，作为执行批次的追踪入口；方向已全部确认，未启动任何删除。执行批次仍需精确影响报告、归档和授权；Issue 026 继续暂缓。
