# BySpace Project Spec

## 这个项目是什么

BySpace 是一个 local-first 的 AI coding agent 控制平台。用户从 hosted Web/PWA 或 CLI 发起、观察和控制 Agent；真正的代码、凭据、进程、工作区与执行状态留在自己的 daemon 机器上。离开本地网络时，Web 与 daemon 可以通过自托管的端到端加密 Relay 通信，而不是把执行环境搬到云端。

它服务于希望从任意设备管理本地 coding agents、同时保留本机开发环境和数据控制权的个人开发者。当前产品主动优化的唯一一等 Provider 是 Pi；Claude Code、Codex、OpenCode、Copilot CLI、Generic ACP 与自定义 Provider 继续共享同一控制面和生命周期。

## 当前方向

- 保持 Web + daemon/CLI + encrypted relay 的窄发行面，用真实使用问题持续改善 Pi 体验。
- 跟随 Agent CLI 的当前版本，选择性吸收 Paseo upstream 中对 Provider、Agent 生命周期、可靠性与安全有价值的变化。
- 保持协议向后兼容；新功能通过 daemon capability 明确门禁，不为旧 daemon 编写降级实现。
- 先复用现有 daemon、协议和 Provider 接缝；没有已测量问题时不重写为 Go，也不预建通用插件系统。

## 能力地图

- **Hosted Web/PWA**：`https://byspace.pages.dev` 提供主要图形界面，用于配对 host、管理工作区、运行 Agent、查看时间线、终端、计划任务和保留的 daemon 能力。
- **CLI 与本地 daemon**：`@bytetrue/byspace` 安装 `byspace` 命令。daemon 管理 Agent 进程、会话恢复、权限、工作区、时间线、终端、MCP 与 WebSocket API。
- **连接方式**：同机或局域网可 direct 连接；远程连接通过 `byspace-relay.bytetrue.workers.dev` 转发端到端加密流量。Relay 不拥有 Agent 数据或执行能力。
- **Provider 层**：直接 Provider、ACP、自定义 Provider 与 Catalog 共用 Agent 生命周期契约。Pi 接受最积极的真实验证，其他 Provider 保持可用和滚动兼容。
- **发行面**：公开 npm 包、Cloudflare Pages、Cloudflare Worker/Durable Object、GitHub Release，以及可选的 `linux/amd64` / `linux/arm64` Docker image。

## 使用路径

### 在本机启动并从 Web 使用

1. 安装 `@bytetrue/byspace`，运行 `byspace` 或 `byspace daemon start`。
2. daemon 在本地发现已安装的 Agent CLI，并生成指向 hosted Web 的配对链接。
3. Web 使用 direct WebSocket 或配对 offer 中的 Relay 信息连接 daemon。
4. 用户在 Web 中创建或恢复 Agent；所有进程和持久状态仍由本地 daemon 管理。

### 从终端或自动化使用

CLI 可以直接创建、列出、附加、等待和控制 Agent，也可以使用 `--host` / `BYSPACE_HOST` 操作远端 daemon。Agent 自身也可通过 CLI 或 daemon MCP 接口组织其他 Agent。

### 维护 upstream

所有 Paseo 更新先按 `docs/upstream-sync.md` 冻结完整提交区间、逐笔记账并由用户批准，再在隔离 worktree replay。`.byspace/upstream-sync.json` 保存最后已审阅 cursor；cursor 表示“已完整审阅到哪里”，不是“最后 cherry-pick 哪一笔”。

### 发布

发布遵循 `docs/release.md`：版本提交先通过精确 SHA 的 CI，再推单一 BySpace tag。npm 只发布一个 bundling 内部 runtime workspaces 的 `@bytetrue/byspace` artifact；`main` 的自动 Pages/Relay 部署只消费成功 CI 的 SHA，显式 `workflow_dispatch` 保留为操作者手动 redeploy 通道。

## 架构落点

- **Web App**：浏览器界面和响应式窄屏布局；只面向 Web，不承担 Electron 或原生移动发行。
- **Protocol + Client**：声明并验证 WebSocket wire contract，给 Web、CLI 和 daemon 提供共享类型与连接能力。
- **Server + CLI**：本地权威执行边界；Provider 适配、Agent 生命周期、持久化、终端和 MCP 都在 daemon 侧完成。
- **Relay**：Cloudflare Worker + Durable Object，只负责加密连接的 rendezvous/转发。
- **Provider 适配**：Claude、Codex、OpenCode、Pi 等直接适配保留各自 SDK/协议语义；其余兼容 Agent 优先复用 ACP/Pi-compatible 接缝。

需要修改系统行为时，先从 `docs/architecture.md` 理解跨层数据流；Provider 变化读 `docs/providers.md` / `docs/custom-providers.md`；路由变化先读 `docs/expo-router.md`。

## 统一语言

- **BySpace**：正式产品显示名。
- **byspace**：CLI、仓库、npm、域名、配置文件和其他机器标识。
- **BYSPACE\_\***：运行时环境变量前缀。
- **daemon / host**：运行 Agent 与保存权威本地状态的机器端服务；UI 文案以 glossary 的既有术语为准。
- **Web-only**：唯一支持的图形客户端是浏览器 Web/PWA；不表示云端执行，也不排除响应式窄屏浏览器布局。
- **Provider 层**：直接 Provider、ACP、自定义 Provider、Catalog 及共享生命周期契约。
- **一等公民**：会被持续真实验证和主动优化的 Provider；当前仅 Pi。
- **upstream**：`getpaseo/paseo`，只用于无 tag fetch、审阅和选择性移植。

## 阅读路径

- 想理解产品目标和用户场景：读 `docs/product.md`，再读本 spec 的能力地图和使用路径。
- 想理解系统如何连接与运行 Agent：读 `docs/architecture.md`、`docs/agent-lifecycle.md` 和 `docs/data-model.md`。
- 想开发或验证改动：读 `docs/development.md`、`docs/coding-standards.md` 与 `docs/testing.md`。
- 想修改 Web UI：先按影响域阅读 `docs/design.md`、`docs/forms.md`、`docs/hover.md`、`docs/unistyles.md`、`docs/floating-panels.md` 或 `docs/expo-router.md`。
- 想同步 upstream 或发布：分别读 `docs/upstream-sync.md` 与 `docs/release.md`。

## 当前边界

### 做

- 浏览器 Web/PWA、CLI、本地 daemon 和自托管 encrypted relay。
- Pi-first 的真实体验优化，同时保留完整 Provider/ACP 接入面。
- AGPL-3.0 下的公开源码、单包 npm 发行、GitHub Release 与 Docker image。
- 通过 CI、branding gate、协议验证和完整 upstream ledger 维持可重复维护。

### 不做

- Electron、原生 iOS/Android、EAS/App Store/APK 或 native-only 依赖。
- 与 Electron webview 绑定的内置 Browser automation capability。
- 单独的营销网站；`byspace.pages.dev` 是产品 Web App。
- 云端 Agent 执行、云端账户/历史控制面或把本地代码上传给 Relay。
- 未经完整账本和用户批准的 upstream wholesale merge、tag 导入或盲目冲突覆盖。
- 为尚未出现的需求重写 daemon 或建立通用插件系统。

允许保留 `Paseo/paseo` 的位置只有 AGPL/版权与上游归属、Git remote/历史、upstream sync 元数据，以及历史 changelog/issue 证据。活跃接口、配置、工具与用户路径不得依赖旧名。

## 关键考量

- **数据与执行归属本地**：host 才是工作区、Agent 进程和持久状态的权威；hosted Web 与 Relay 都不能成为第二个执行源。
- **协议兼容优先**：wire schema 保持双向可解析；新增字段 optional，新能力集中 capability-gate，不散落 fallback。
- **按完整能力切片维护**：跨 Web、协议和 daemon 的能力必须整体保留或删除，避免不可达 broker、死 schema 与恒假平台 gate。
- **Provider 不强行同构**：成熟直接适配保留各自协议行为；Generic ACP 只承接真正共享协议的 Agent。
- **发布物可重现**：CI 在 Linux、macOS、Windows 安装同一 npm tarball并启动隔离 daemon；自动生产部署只消费绿灯 SHA，手动 redeploy 必须由操作者显式触发。
- **凭据最小化**：npm 后续发布使用 OIDC Trusted Publisher；Cloudflare CI token 只具有目标 account 的 Workers Scripts Edit 与 Pages Edit。

## 证据索引（按需）

- 系统与流程文档：`docs/architecture.md`、`docs/development.md`、`docs/release.md`、`docs/upstream-sync.md`。
- 产品边界与 Agent 指令：`README.md`、`AGENTS.md`。
- Upstream cursor 与完整 disposition：`.byspace/upstream-sync.json`。
- Web-only fork、身份迁移、upstream replay 与首次发布的一次性执行证据：`.cs/epics/2026/07/14/web-only-byspace/spec.md` 及其 closed issues。
