# byspace Vision

> byspace 是确认的产品、二进制与代码标识。这里描述目标应用，而不是当前代码已经实现的能力。

## 产品核心

byspace 面向需要在一台或多台机器上持续运行 AI 编码 Agent 的个人开发者。用户只需一个浏览器或 CLI，就能在本地或远程进入任意主机，创建、观察和控制 Agent，并在项目文件、终端、Git、自动化与协作工作流之间保持连续上下文。

目标体验的最小本质是：**Agent 和开发环境留在用户控制的主机上，Web 与 CLI 随时连接，Relay 解决安全远程访问，Hub 解决跨主机和外部事件驱动的自动化。**

产品以 Paseo 的产品与架构思路为起点，但不是把 Node daemon 逐行翻译成 Go。Web 界面优先整体复用并适配，daemon 由 byspace 用 Go 完全重写；CLI 作为同一 `byspace` Go 二进制的命令面，保留完整产品能力。Relay 必须有可部署的 byspace 自有实现，Hub 保留 Paseo 的自托管与托管产品能力，具体源码策略后续决定。

## 用户怎样获得结果

### 在一台机器上开始工作

用户通过 CLI 启动 daemon，用 Web 或 CLI 添加本地项目，创建 Pi 会话，发送任务并实时查看文本、思考、工具调用、权限请求和执行状态。刷新、断线或 daemon 重启后，仍能找到项目、工作区和可恢复会话。

### 从任何浏览器控制多台主机

用户把 Web 安装成 PWA，在同一个界面保存多台 daemon。连接可走本机、局域网、VPN 或 Relay；Web 按主机隔离项目、工作区、Agent 与缓存，并能在连接质量变化时恢复正确状态。Relay 对业务内容保持零知识，客户端与 daemon 之间端到端加密。

### 在 Agent 对话之外完成开发工作

用户可在同一 Web 或 CLI 中使用终端、文件浏览与传输、Git 状态与 Diff、Review、Forge、worktree、脚本、计划任务、插件、语音以及 Agent 间协作，而不需要安装桌面或移动原生客户端。

### 让自动化跨越主机和外部事件

Hub 连接用户授权的 daemon，把 GitHub、Slack、Discord 等外部事件转成可审计的工作流执行；用户能够选择目标项目、主机、provider、模型和权限边界，并查看活动与结果。Hub 是 daemon 之上的控制层，不替代 Relay，也不取得主机文件和 provider 凭据的所有权。

### 逐步接入不同 Agent provider

Pi 是首个实现和首条验证路径。其他 provider 属于确定的后续能力，按各自原生协议或 SDK 接入统一 Agent 生命周期与 Timeline；实施顺序不改变它们仍在产品范围内。

## 能力怎样支撑旅程

```text
Web/PWA ───────┐
               ├─ direct / Relay ──> Go daemon ──> Agent providers
CLI ───────────┘                         │
                                         ├─ project / workspace / terminal
Hub ── authorized relationship ──────────┤
                                         └─ files / Git / schedule / plugins
```

- **Web/PWA**：主要图形界面，承载多主机导航、Agent Timeline 和开发工作区；从 Paseo Web 源码复制后按新协议与纯 Web 平台边界适配。
- **Go daemon**：每台主机的唯一事实源，数据独立存放在 `~/.byspace`；拥有本地资源、Agent 生命周期、持久化、实时流和权限执行，不直接读写 Paseo home。
- **Go CLI**：与 daemon 共用同一个 `byspace` 二进制；既管理本地 daemon，也是完整的脚本化客户端，支持直连和 Relay 远程目标。现有 TypeScript CLI 只作为迁移行为与测试标尺。
- **连接与多主机**：统一直接连接、配对、Relay E2EE、重连和每主机状态隔离。
- **Relay**：可独立部署到 Cloudflare 的不可信字节转发服务。目标域名为 `relay.byspace.cc.cd`；业务明文只存在于 Web/CLI 与 daemon 端。
- **Hub**：可部署的自动化控制层，目标域名为 `hub.byspace.cc.cd`；保留 Paseo Hub 的产品能力并在后续梳理服务端来源与重写边界。
- **Provider 系统**：先以 Pi RPC 打通，再扩展 Codex、Claude、OpenCode、ACP 等 provider。
- **开发环境能力**：终端、文件、Git、worktree、Forge、Review 等由 daemon 执行，Web 与 CLI 只表达意图和展示结果。
- **自动化与扩展**：schedule、script、plugin、MCP、Agent 间协作与 Hub 工作流共享 daemon 的权限和资源边界。

## 必须守住的边界

- 唯一永久排除项是 Electron 桌面原生客户端和 iOS/Android 移动原生客户端；不能把“后续实现”记录成“不做”。
- Web 的发布入口拟使用 `app.byspace.cc.cd`。根域 `byspace.cc.cd` 的网站或文档用途稍后确定，不阻塞应用架构。
- daemon 可执行文件与核心事实源必须由 Go 完全重写，不能在 Go 外壳后继续隐藏旧 Node daemon。Web 构建工具以及插件/provider 等能力专用的受管理外部运行时另行评估，不能反向取得 daemon 状态所有权。
- 复制 Paseo 前端时遵守 Apache-2.0 的许可证、归属和修改标记要求，并替换 Paseo 品牌与商标资产。
- 本地优先不是单机限制。直接连接、Relay、多主机与 Hub 都是正式产品路径。
- 安全边界不能因迁移简化：远程连接需要认证与加密，Relay 保持端到端加密，daemon 对文件、终端、Git 和 Agent 权限负责。
- 纯 Web 无法原样承接的 Electron/移动原生交互，需要重新表达为 Web 能力、CLI 能力或明确的平台限制，不能静默丢失对应用户结果。

## 演化地图与阅读路径

- 当前项目现实、已验证能力和活跃主线 → [`../spec/index.md`](../spec/index.md)
- foundation 迁移地图与证据 → [`../epics/001-o-rewrite-foundation/spec.md`](../epics/001-o-rewrite-foundation/spec.md)
- 当前 Relay 远程连接主线 → [`../epics/002-o-relay-remote-connectivity/spec.md`](../epics/002-o-relay-remote-connectivity/spec.md)
- 想理解产品最终服务哪些旅程 → 从本页“用户怎样获得结果”开始。
- 想判断某个 Paseo 组件是复制、适配、Go 重写还是外部依赖 → 读 foundation Epic 的迁移地图。
- 想开始具体实现 → 先读 Project Spec 标出的活跃 Epic，再进入其当前 Issue；阶段顺序不代表最终产品删减。

## 统一语言

- **客户端**：Web/PWA 与 CLI。项目排除的是桌面和移动原生客户端，不是排除 CLI。
- **主机（Host）**：运行一个 byspace daemon、持有代码与 Agent 进程的用户机器。
- **daemon**：主机内的 Go 服务与事实源。
- **Relay**：不可信、零知识的远程传输中继，不负责工作流编排。
- **Hub**：daemon 之上的授权自动化和外部事件控制层，不等同于 Relay 或多主机连接。
- **provider**：把某种 Agent 原生运行时映射到统一生命周期和 Timeline 的适配器。
- **后续**：实现顺序较晚，但仍在确认范围内；只有用户明确说“不做”才成为排除项。
