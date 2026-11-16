# Vision

> 目标世界写在这里。当前行为以代码与 `docs/` 为准；v1 行为规格快照在 `byissue/archive/v1/spec/`（冻结记录，可能过时）。跨任务的长期判断在 `byissue/memory/`。

## 目标世界

BySpace 让你从任何一个浏览器查看和操控自己开发环境里的 AI coding agent。Daemon 装在你的机器上，代码、密钥和 agent 进程都不离开它。

它是 daemon 优先、web 优先的。在任何一台机器上装一个 daemon，打开浏览器就能用全部功能，不需要 VPN，不需要先装某个客户端。桌面 App 和手机 App 提供各自平台的便利，不是使用前提。

Agent 有两条并行的运行方式，都是一等公民，谁也不取代谁：

- 结构化会话：BySpace 与 provider 的协议对接，把时间线、工具调用、权限批准、subagent 拆成界面元素。换来移动端和窄屏上真正可读可操作的体验，代价是每个 provider 都要维护适配。适配分先后：Pi 一等公民，其余 best-effort，见 [pi-first-class](../memory/pi-first-class.md)。
- Terminal 会话：agent 以自己的 TUI 在 PTY 里运行，BySpace 提供宿主、活动提示和通知。换来任何 agent 都能跑、没有第二份状态真相，代价是全屏 TUI 在手机上很难用。

两条路解决不同场景，不是过渡关系。选哪条由 provider 支持情况和当前设备决定。为什么两条路共存、为什么不转向 terminal-native 独立 fork，完整讨论在 [talks/001](../archive/v1/talks/001-terminal-native-hard-fork.md)（结论：撤回 hard-fork）。

目标用户是单人开发者：使用多个 agent，多设备多机器工作，在乎自己拥有工具和数据。

用语：活动状态指圆点与通知背后的粗粒度状态；Hook 指安装进 agent 配置目录、把事件转成活动状态发给 daemon 的小段代码。结构化会话的状态来自协议事件，terminal 会话的状态来自 hook，两者汇入同一套圆点、workspace 汇总和通知。

## 旅程与能力方向

- 开始一项工作：从侧栏选 project，进入 workspace 或新开一个 worktree，起一个 agent 会话或一个 terminal，多个会话并排各占一个 pane。支撑能力：project 组织、分支与推送状态、worktree 创建。行为细节见 [workspace 规格快照](../archive/v1/spec/workspace.md)。
- 跟一个 agent 协作：结构化会话里读时间线、展开工具调用、批准权限、追问。支撑能力：provider 适配、时间线、工具调用、权限、subagent。见 [agent-conversation 规格快照](../archive/v1/spec/agent-conversation.md)。
- 跑任何一个 TUI agent：terminal 里启动它，用它自己的界面；tab 圆点和通知告诉你它在跑、在等你，还是结束了。支撑能力：PTY 宿主、快照、恢复、daemon 重启后的标签恢复、性能。见 [terminal 规格快照](../archive/v1/spec/terminal.md) 与 [docs/terminal-activity.md](../../docs/terminal-activity.md)。
- 离开，然后被叫回来：关掉窗口或出门，turn 结束、需要输入时收到通知；回来后时间线和 terminal 滚动历史都在。支撑能力：Web Push 与平台系统通知，见 [notifications 规格快照](../archive/v1/spec/notifications.md)。
- 从手机接管：手机上继续同一个会话。结构化会话在手机上可读可操作；terminal 会话在手机上以「够用」为目标。
- 看 agent 改了什么：会话旁边看 Changes、diff 和文件树，确认或撤回；forge 上的 PR 同面板可见。
- 在别的机器上跑：daemon 放在远程机器或 VM 上，通过 E2EE Relay 连接，浏览器里的体验与本地一致。见 [connection 规格快照](../archive/v1/spec/connection.md)。
- 让 agent 按时自己跑：定时任务、bundled skill + byspace CLI 创建的会话，结果同样出现在界面和通知里。自动化通道是 skill + CLI，MCP 交付已退役，见 [agent-tools-delivery](../memory/agent-tools-delivery.md)。

## 候选与边界

已确认的边界：

- 任何机器都可以装 daemon，daemon 是唯一的运行时。
- 浏览器打开即用，并拥有全部功能；不存在「只有桌面 App 才有」的能力。
- 远程访问经 E2EE Relay，不依赖 Tailscale、VPN 或端口转发；P2P 已被 owner 否决。
- 不绑定任何客户端 App。手机与桌面 App 只提供该平台特有的便利，例如推送与系统通知。
- terminal 会话里，terminal 内容是 agent 状态的唯一真相。hook 上报的活动状态是提示，允许不准，不允许把用户锁在错误状态里。
- 与上游的关系：以 Paseo 为基线，最后一次同步停在 v0.8.0（2026-09-11），此后不追上游，只作参考。身份迁移已改掉包作用域、wire 字面量与磁盘命名空间，不设兼容层，见 [docs/protocol-compatibility.md](../../docs/protocol-compatibility.md)。
- orca 吸收已放弃（owner 2026-10-14 drop，Epic 003）。原则仍是借交互不借架构、UI 按 BySpace 设计系统重做，但吸收工作本身停止。
- 能力准入判据：一个能力属于 BySpace，当且仅当它不替代用户本来就会调用的东西；工作流住在用户自己的 agent 配置里。VelaTerm 是反例：同一件事两套实现，加上没人管的悬挂。完整不做列表与判据见 [product-scope](../memory/product-scope.md)。

候选（未确认，推进前需要 owner 决定）：

- 侧栏 project → worktree → agent 行的模型。
- 语音听写进 terminal 输入栏。

已放弃的候选：

- terminal 会话的转录投影视图（从磁盘会话转录派生只读对话压在活 PTY 之上）：随 Epic 003 drop 放弃，orca 的支持列表也不含 Pi。
