# Agent 对话

Agent pane 把时间线、工具调用、状态轨道和消息输入保持在同一个连续工作面中。Stream 操作靠近消息输入，不占用 workspace 或 pane 导航区域。

## 当前布局

```text
┌─ Pane header：Agent / tab 导航 ───────────────┐
│                                               │
│ 对话时间线与工具调用                          │
│                                               │
├─ 状态与操作行 ───────── [收起全部] [滚到底部] ┤
└─ Composer：消息输入与发送 ────────────────────┘
```

Desktop、split pane 和 compact 布局都保持这一垂直关系。左侧状态可以显示 task、subagent、plugin 或 diff；Stream 控件固定在同一行右侧。状态过长时先收缩或截断，不能把操作挤出可见区域。

## 控件状态

- Active Agent 始终可以收起当前已展开的工具和 reasoning。
- 用户离开时间线底部或查看 detached timeline 时显示“滚动到底部”；回到底部后隐藏。
- 新到达的 reasoning 或工具调用仍按正常规则展开，不被之前的“收起全部”永久抑制。
- Archived 或 read-only stream 没有 active Composer，继续使用时间线内的 floating 返回底部操作。
- Pane header 不为这组控件保留 host 或空白宽度。

这些控件只调用 Agent stream 的现有 owner，不建立第二份 scroll、collapse 或 timeline 状态。

## 斜杠补全与技能发现

- 输入 `/` 时按需加载命令与技能列表；在命令拉取完成前，Autocomplete Popover 保持可见并展示加载动画（`ActivityIndicator`）与提示文案，数据返回后自动平滑切换为命令列表。
- Pi Provider 在后台启动会话时自动注入 `--approve` 信任标志，保证项目级 `.pi/skills/` 与 `.agents/skills/` 能够被自动发现并列入命令补全。

## 运行与加载指示

- 会话 turn 运行/思考指示器（`SyncedLoader`）承载关键的运行时存活反馈，不因操作系统的 `prefers-reduced-motion` 策略而冻结在初始静止帧，确保用户能明确感知 Agent 处于活跃执行状态而非崩溃死锁。
- Pi Provider 的 Turn 边界结算基于 `agent_end`（`!willRetry`）即时触发 `turn_completed` 并转入 `idle`，解除对扩展层异步后处理（如 Watchdog、LSP 或自动压缩）延迟发射的 `agent_settled` 的硬性等待，保证模型输出完毕瞬间前端输入框与操作按钮即刻解锁恢复；随后到来的 `agent_settled` 保持幂等忽略。

## 时间线恢复与同步

- 每个 Agent 的时间线只有一个请求 owner；恢复或切回 workspace 时从持久化 cursor 逐页补齐到当前，不做尾部截断回退。
- 断线重连、rewind 与多页缺口由 authoritative 路径处理；authoritative 页不当作 live delta 追加。
- 远程恢复保留旧 timeline 内容并展示同步状态，不以空列表覆盖。

## 会话导入与项目准备

- Import Session 支持选择 provider 并输入 session/thread ID，精确导入目标主会话；provider 不匹配、未知 ID、重复导入与 cwd 不匹配被拒绝并给出原因。
- Agent 可按 bundled `byspace-project-setup` skill 检查项目能否在干净 worktree 中重复准备与并行开发，展示计划；只有用户确认后才写入脚本和 `byspace.json`，未确认前不写文件、不装依赖、不执行破坏性命令。

## 历史证据

- [将 Agent stream 控件移到 Composer 操作行](../issues/003-x-composer-stream-controls.md)
- [Pi 启动注入项目信任并完善斜杠补全加载态](../issues/004-x-pi-project-skills-and-autocomplete-loading.md)
- [修复 Windows 下思考加载图标定格与终端 OSC 8 链接打开无反应](../issues/008-x-ff-synced-loader-and-terminal-osc8-links.md)
- [修复 Pi Agent 回复结束后客户端依然保持运行中状态的边界结算缺陷](../issues/009-x-ff-pi-turn-boundary-immediate-completion.md)
- [Epic 002 交付记录](../epics/002-x-retained-capabilities-delivery/spec.md)
