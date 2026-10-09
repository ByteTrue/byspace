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
- 扩展注入的 custom 消息（Pi `sendMessage`、OMP custom）渲染为带 `[customType]` 标签的独立通知卡，不与 agent 正文混排；`display: false` 的消息从时间线隐藏。该项由 `custom_timeline_messages` client capability 门控。
- Archived 或 read-only stream 没有 active Composer，继续使用时间线内的 floating 返回底部操作。
- Pane header 不为这组控件保留 host 或空白宽度。

这些控件只调用 Agent stream 的现有 owner，不建立第二份 scroll、collapse 或 timeline 状态。

## 斜杠补全与技能发现

- 输入 `/` 时按需加载命令与技能列表；在命令拉取完成前，Autocomplete Popover 保持可见并展示加载动画（`ActivityIndicator`）与提示文案，数据返回后自动平滑切换为命令列表。
- Pi Provider 在后台启动会话时自动注入 `--approve` 信任标志，保证项目级 `.pi/skills/` 与 `.agents/skills/` 能够被自动发现并列入命令补全。

## 运行与加载指示

- 会话 turn 运行/思考指示器（`SyncedLoader`）承载关键的运行时存活反馈，不因操作系统的 `prefers-reduced-motion` 策略而冻结在初始静止帧，确保用户能明确感知 Agent 处于活跃执行状态而非崩溃死锁。
- Pi Provider 的 Turn 边界结算按**发起方**区分。客户端发起的 turn 在 `agent_end` 即时触发 `turn_completed` 并转入 `idle`，不等扩展层异步后处理（Watchdog、LSP、自动压缩）延迟发射的 `agent_settled`，保证模型输出完毕瞬间输入框与操作按钮即刻解锁；随后到来的 `agent_settled` 幂等忽略。
- 三种情况仍等待 `agent_settled`，因为它们的后续工作属于同一个 turn：Pi 标记将要重试或本次运行正在从重试中恢复；有 stop 在途，由取消决定结果；运行是自主的、没有客户端发起的 turn，扩展可能继续它。自主轮次是上游 v0.8.0 引入的能力。
- Pi 工具通过 `ctx.executeTool()` 跑出的嵌套调用（codemode 脚本里的 `tools.bash(...)` 等）作为独立时间线行流出，行上带 `metadata.parentToolCallId`——pi 在事件上给的是**直接调用者**，逐层套娃时它不是顶层行，由 App 沿父链走到流里留存的那个祖先。App 呈现层把它们摘出、按父行分桶，渲染为父行 + 缩进竖轨下的子行，默认可见。整屏 codemode 与看不出包含关系都不接受：061 的纯 daemon 过滤和 062 初版的折叠徽标都因此被推翻。父行徽标带着子调用摘要作副标签（首字母小写），摘要的归类只有一处实现：`packages/protocol/src/tool-call-category.ts` 的 `categorizeToolCall`，直播行与回放徽标都走它，否则同一段脚本两处口径会漂。BySpace 的 durable timeline 自己会记下这些嵌套行，重载后照常按父行归档；`metadata.nestedSummary` 是**没有子行可归**（pi 还没上报嵌套调用时录下的 transcript、或走 provider hydration/导入）时的兜底，父行从 tool result 顶层的 `nestedCalls` 列表算出它。
- Pi 的 `@bytetrue/pi-subagent` 子代理走与 Claude 相同的 subagents track + 只读 tab（`agent.provider_subagents.*` 通道），descriptor 来自三个源：launch 工具结果（立即建行）、运行中 HTTP 快照、转录内 `subagent-exit` 消息（负责回放）。状态枚举不扩：`pending` 显示为 running；`paused` 显示为 canceled——pi-subagent 暂停即杀进程，exit 消息就是该任务最后一条更新，恢复走新任务 id 产生新行，旧行读作 running 会永远卡住「N working」徽标。只读 tab 的内容是 daemon 对子会话 jsonl 的增量 tail；旧版 pi-subagent 不上报时退化为黑盒工具行，不算坏。

## 时间线恢复与同步

- 每个 Agent 的时间线只有一个请求 owner；恢复或切回 workspace 时从持久化 cursor 逐页补齐到当前，不做尾部截断回退。
- 断线重连、rewind 与多页缺口由 authoritative 路径处理；authoritative 页不当作 live delta 追加。
- 远程恢复保留旧 timeline 内容并展示同步状态，不以空列表覆盖。

## 会话导入与项目准备

- Import Session 支持选择 provider 并输入 session/thread ID，精确导入目标主会话；provider 不匹配、未知 ID、重复导入与 cwd 不匹配被拒绝并给出原因。
- Agent 可按 bundled `byspace-project-setup` skill 检查项目能否在干净 worktree 中重复准备与并行开发，展示计划；只有用户确认后才写入脚本和 `byspace.json`，未确认前不写文件、不装依赖、不执行破坏性命令。

## 图片与附件发送

- Composer 发送的图片在上 wire 前自动压缩：超过 1 MiB 的 jpeg/png 降采样到长边 ≤ 2048、重编码 JPEG；GIF/SVG/WebP 不重编码。压缩失败回退原图，绝不阻断发送；附件 store 里的原图与预览不受影响。
- 压缩后仍超出单帧内联预算的图片自动改走分块文件上传通道，作为 `uploaded_file` 附件（路径引用）发送；上传失败回退内联。用户不需要手动分条发送大图。

## 历史证据

- [将 Agent stream 控件移到 Composer 操作行](../issues/003-x-composer-stream-controls.md)
- [Pi 启动注入项目信任并完善斜杠补全加载态](../issues/004-x-pi-project-skills-and-autocomplete-loading.md)
- [修复 Windows 下思考加载图标定格与终端 OSC 8 链接打开无反应](../issues/008-x-ff-synced-loader-and-terminal-osc8-links.md)
- [修复 Pi Agent 回复结束后客户端依然保持运行中状态的边界结算缺陷](../issues/009-x-ff-pi-turn-boundary-immediate-completion.md)
- [pi codemode 的嵌套工具调用不再重复显示成独立工具行](../issues/061-x-ff-pi-codemode-nested-tool-call-dedup.md)（其实时过滤已回退，见下条）
- [回退 061 的 pi codemode 嵌套调用过滤，恢复独立工具行显示](../issues/062-x-ff-restore-pi-codemode-nested-rows.md)
- [扩展 custom message 全链路透传为 custom_message timeline 项](../issues/024-x-ff-custom-message-timeline-items.md)
- [大图片消息超 Relay 帧上限：发送前压缩与分块上传兑底](../issues/057-x-image-message-relay-frame-limit.md)
- [Epic 002 交付记录](../epics/002-x-retained-capabilities-delivery/spec.md)
