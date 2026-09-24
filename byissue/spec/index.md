# BySpace Project Spec

## 这个项目是什么

BySpace 让用户从手机 PWA、Web 或 CLI 查看和控制自己开发环境中的 AI coding agents。Daemon 留在用户的机器上，App 通过 Direct 或 E2EE Relay 连接；代码和 Agent 状态不托管到 BySpace 服务。

## 当前体验地图

- [Agent 对话](agent-conversation.md) — 对话、工具调用和消息输入如何共处，以及 active 与 archived stream 的操作边界。
- [Terminal](terminal.md) — Terminal 快照、历史和恢复必须维持的字符与顺序语义，以及 daemon 重启后的标签恢复。
- [Workspace](workspace.md) — 侧栏行内信息、分支与推送状态、hover 状态展示与 Agent 精炼命名。
- [连接与发布通道](connection.md) — App 与 Relay 地址按通道选择、连接安全边界与配对 hostname。
- [通知送达](notifications.md) — 各平台怎样收到「agent 需要你」的通知，Web Push 的凭据归属与加密边界，以及 PWA 与局域网直连的互斥。
- [Worker 与项目组](worker.md) — 数字员工与项目组的长期对象模型、提及即唤醒的消息路由、目标与预算的边界，以及为什么「谁负责」由数据库保证。

系统架构、协议、发布和性能的工程约束仍由 `docs/` 中的主题文档负责。Project Spec 记录用户能依赖的当前产品行为；实现过程和验证证据留在已关闭 Issue。

## 典型使用路径

1. 用户连接运行 BySpace daemon 的开发环境。
2. 用户选择 workspace 和 Agent，在对话 pane 中查看流式输出、工具调用和上下文状态。
3. 需要 shell 交互时，Terminal 在同一连接上提供实时输出，并能在重连后恢复。
4. CLI 可以脚本化地驱动 daemon、workspace 和 Agent，不改变 daemon 与用户项目的所有权边界。
5. 需要把一件事整个托付出去时，用户向一个项目组提需求；组里的协调者拉人、派活、汇总，并把进展和结果汇报回来。

## 边界与考量

- 实现跨浏览器与手机 PWA；原生移动端与 Electron 已退出（见 [025](../issues/025-o-architecture-retention-audit.md)），只有平台能力确实不同才分流。
- App 与 daemon 可以异步更新，wire protocol 保持双向兼容。
- Terminal、Agent stream 和移动面板的性能优化不得以删除现有用户能力为代价。
- BySpace 使用统一 Data Relay；Relay 只转发 E2EE 数据，不解析 Agent 会话内容。
