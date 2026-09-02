# BySpace Project Spec

## 这个项目是什么

BySpace 让用户从移动端、Web 或桌面端查看和控制自己开发环境中的 AI coding agents。Daemon 留在用户的机器上，App 通过 Direct 或 E2EE Relay 连接；代码和 Agent 状态不托管到 BySpace 服务。

## 当前体验地图

- [Agent 对话](agent-conversation.md) — 对话、工具调用和消息输入如何共处，以及 active 与 archived stream 的操作边界。
- [Terminal](terminal.md) — Terminal 快照、历史和恢复必须维持的字符与顺序语义。
- [桌面更新](desktop-updates.md) — 各桌面平台怎样从 release manifest 进入安装流程，尤其是 macOS 的 DMG 交接。

系统架构、协议、发布和性能的工程约束仍由 `docs/` 中的主题文档负责。Project Spec 记录用户能依赖的当前产品行为；实现过程和验证证据留在已关闭 Issue。

## 典型使用路径

1. 用户连接运行 BySpace daemon 的开发环境。
2. 用户选择 workspace 和 Agent，在对话 pane 中查看流式输出、工具调用和上下文状态。
3. 需要 shell 交互时，Terminal 在同一连接上提供实时输出，并能在重连后恢复。
4. Desktop 检测到新版本后按平台进入安装流程，不改变 daemon 与用户项目的所有权边界。

## 边界与考量

- 默认实现跨 iOS、Android、浏览器和 Electron；只有平台能力确实不同才分流。
- App 与 daemon 可以异步更新，wire protocol 保持双向兼容。
- Terminal、Agent stream 和移动面板的性能优化不得以删除现有用户能力为代价。
- BySpace 使用统一 Data Relay；Relay 只转发 E2EE 数据，不解析 Agent 会话内容。
