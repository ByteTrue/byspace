# BySpace Project Spec

## 这个项目是什么

BySpace 让用户从手机 PWA、Web 或 CLI 查看和控制自己开发环境中的 AI coding agents。Daemon 留在用户的机器上，App 通过 Direct 或 E2EE Relay 连接；代码和 Agent 状态不托管到 BySpace 服务。

## 当前体验地图

- [Agent 对话](agent-conversation.md) — 对话、工具调用和消息输入如何共处，以及 active 与 archived stream 的操作边界。
- [Terminal](terminal.md) — Terminal 快照、历史和恢复必须维持的字符与顺序语义，以及 daemon 重启后的标签恢复。
- [Workspace](workspace.md) — 侧栏行内信息、分支与推送状态、hover 状态展示与 Agent 精炼命名。
- [连接与发布通道](connection.md) — App 与 Relay 地址按通道选择、连接安全边界与配对 hostname，自托管部署的发布形态与限制，以及 daemon 隧道（远端端口转发到本机）。
- [通知送达](notifications.md) — 各平台怎样收到「agent 需要你」的通知，Web Push 的凭据归属与加密边界，以及 PWA 与局域网直连的互斥。

系统架构、协议、发布和性能的工程约束仍由 `docs/` 中的主题文档负责。Project Spec 记录用户能依赖的当前产品行为；实现过程和验证证据留在已关闭 Issue。

## 典型使用路径

1. 用户连接运行 BySpace daemon 的开发环境。
2. 用户选择 workspace 和 Agent，在对话 pane 中查看流式输出、工具调用和上下文状态。
3. 需要 shell 交互时，Terminal 在同一连接上提供实时输出，并能在重连后恢复。
4. CLI 可以脚本化地驱动 daemon、workspace 和 Agent，不改变 daemon 与用户项目的所有权边界。

## 边界与考量

- 同一套 Go 单二进制与内嵌 Web 前端通过编译标签（`-tags nogui` vs Wails v3）延伸出无头 CLI/Daemon/Docker、桌面客户端（macOS / Windows / Linux，单主窗口 + 托盘驻留 + 本机 daemon 主从自愈接管与外部旧进程一键接管，支持开机自启、Agent 运行期间智能防休眠、macOS Dock 显隐控制与 Template 菜单栏图标、轻量模式、空闲自动安装更新以及核心配置自动滚动备份）与 Android 远程客户端（侧载 APK，不在手机本地起 daemon），见 [Decision 005](../decisions/005-wails-v3-unified-desktop-and-android-client.md)、[Epic Wails v3](../epics/2026-10-29-x-wails-v3-desktop-and-android/spec.md) 与 [Epic Magpie Gems](../epics/2026-10-29-x-magpie-gems-absorption/spec.md)。
- App 与 daemon 可以异步更新，wire protocol 保持双向兼容。
- Terminal、Agent stream 和移动面板的性能优化不得以删除现有用户能力为代价。
- BySpace 使用统一 Data Relay；Relay 只转发 E2EE 数据，不解析 Agent 会话内容。
- **已决定不做的方向**：独立 React Native 原生工程、Electron 桌面包装器、iOS 原生壳、应用商店上架分发（Android 仅走直接侧载 APK）、npm 包分发、SSH 接入、Hub 集成、插件系统（provider 扩展改走 custom provider）。历史退出批次见 [025](../issues/025-x-architecture-retention-audit.md)，Wails v3 单二进制同构延伸与二进制直发决策见 [Decision 005](../decisions/005-wails-v3-unified-desktop-and-android-client.md)；跨 workspace 编排的放弃理由见 [026](../issues/026-d-cross-workspace-orchestrator.md)。
