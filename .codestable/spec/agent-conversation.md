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

## 历史证据

- [将 Agent stream 控件移到 Composer 操作行](../issues/003-x-composer-stream-controls.md)
