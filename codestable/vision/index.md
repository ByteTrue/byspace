# Vision

> **读者：** 想理解 BySpace 最终为谁创造什么，并从这里找到下一步该读哪的人。目标世界写在这里；当前现实读 `codestable/spec/index.md`。

---

## 产品核心

BySpace 让你从任何一个浏览器查看和操控自己开发环境里的 AI coding agent。Daemon 装在你的机器上，代码、密钥和 agent 进程都不离开它。

它是 daemon 优先、web 优先的。在任何一台机器上装一个 daemon，打开浏览器就能用全部功能，不需要 VPN，不需要先装某个客户端。桌面 App 和手机 App 提供各自平台的便利，不是使用前提。

**Agent 有两条并行的运行方式，都是一等公民。**

- **结构化会话。** BySpace 与 provider 的协议对接，把时间线、工具调用、权限批准、subagent 拆成界面元素。换来的是移动端和窄屏上真正可读可操作的体验，代价是每个 provider 都要维护适配。
- **Terminal 会话。** agent 以自己的 TUI 在 PTY 里运行，BySpace 提供宿主、活动提示和通知。换来的是任何 agent 都能跑、没有第二份状态真相，代价是全屏 TUI 在手机上很难用。

两条路解决的是不同场景，不是过渡关系，谁也不取代谁。选哪条由 provider 支持情况和当前设备决定。

目标用户是单人开发者：使用多个 agent，多设备多机器工作，在乎自己拥有工具和数据。

## 用户怎样获得结果

- **开始一项工作。** 从侧栏选 project，进入 workspace 或新开一个 worktree，起一个 agent 会话或一个 terminal。多个会话并排各占一个 pane。深入读 `codestable/spec/workspace.md`。
- **跟一个 agent 协作。** 结构化会话里读时间线、展开工具调用、批准权限、追问。深入读 `codestable/spec/agent-conversation.md`。
- **跑任何一个 TUI agent。** terminal 里启动它，用它自己的界面。tab 圆点和通知告诉你它在跑、在等你，还是结束了。深入读 `codestable/spec/terminal.md`、`docs/terminal-activity.md`。
- **离开，然后被叫回来。** 关掉窗口或出门。turn 结束、需要输入时收到通知。回来后时间线和 terminal 滚动历史都在。
- **从手机接管。** 手机上继续同一个会话。结构化会话在手机上可读可操作；terminal 会话在手机上以"够用"为目标。
- **看 agent 改了什么。** 会话旁边看 Changes、diff 和文件树，确认或撤回。
- **在别的机器上跑。** daemon 放在远程机器或 VM 上，通过 E2EE Relay 连接，浏览器里的体验与本地一致。深入读 `codestable/spec/connection.md`。
- **让 agent 按时自己跑。** 定时任务、MCP 和 CLI 创建的会话，结果同样出现在界面和通知里。

## 能力怎样支撑旅程

- **Workspace 与 worktree。** project 组织、分支与推送状态、worktree 创建。
- **Agent 会话。** provider 适配、时间线、工具调用、权限、subagent。支撑"跟一个 agent 协作"。
- **Terminal。** PTY 宿主、快照、恢复、daemon 重启后的标签恢复、性能。支撑"跑任何一个 TUI agent"。
- **活动与通知。** 结构化会话从协议事件得到状态；terminal 会话从装进 agent 配置的 hook 得到状态。两者汇入同一套圆点、workspace 汇总和通知。
- **远程访问。** Relay 与 web 客户端。桌面外壳只是包了 web 的窗口。
- **Changes 与文件。** diff、Changes、explorer、forge 上的 PR。
- **自动化。** 定时任务、MCP、CLI。

## 边界与探索空间

**产品形态：**

- 任何机器都可以装 daemon，daemon 是唯一的运行时。
- 浏览器打开即用，并拥有全部功能；不存在"只有桌面 App 才有"的能力。
- 远程访问经 E2EE Relay，不依赖 Tailscale、VPN 或端口转发。
- 不绑定任何客户端 App。手机与桌面 App 只提供该平台特有的便利，例如推送与系统通知。
- terminal 会话里，terminal 内容是 agent 状态的唯一真相。hook 上报的活动状态是提示，允许不准，不允许把用户锁在错误状态里。

**与上游的关系。** BySpace 以 Paseo 为基线并持续同步。同步是选择性的：取修复与我们要的能力，不取与本项目方向无关的部分。协议保持双向兼容，见 `docs/protocol-compatibility.md`。

**参考产品。** orca 是 terminal agent 体验的吸收来源，只借交互，不借架构，按区域逐块吸收而不整体照搬。它 MIT 授权，移植代码需保留版权声明；栈不同，UI 按 BySpace 设计系统重做，daemon 侧逻辑可以移植。当前吸收工作在 Epic 003。

**探索中或候选：**

- terminal 会话的转录投影视图：从 agent 写在磁盘上的会话转录派生只读对话，压在活的 PTY 之上，发送回 PTY。orca 用它解决全屏 TUI 在手机上不可读的问题，但其支持列表不含 Pi。候选，待 Epic 003 排序。
- 侧栏 project → worktree → agent 行的模型。候选。
- 语音听写进 terminal 输入栏。候选。

## 演化地图

- `codestable/epics/003-o-orca-terminal-agent-experience/spec.md`：建设中。对照 orca 优化 terminal agent 体验，不改变结构化会话。
- `codestable/issues/019-o-sync-upstream-to-0-8-0-beta.md`：进行中。同步上游到 `v0.8.0-beta.1`。
- `codestable/spec/agent-conversation.md`、`terminal.md`、`workspace.md`、`connection.md`、`desktop-updates.md`：当前真相，Epic 003 只扩展 terminal 一侧。
- `codestable/talks/001-terminal-native-hard-fork.md`：一次关于"要不要转向 terminal-native 并独立 fork"的完整讨论，结论是撤回。想知道为什么两条路共存、为什么不以 orca 为底、为什么继续同步上游，读它。

## 用语与下一步读哪

- **结构化会话：** BySpace 通过 provider 协议驱动的 agent 会话，有时间线与工具调用界面。
- **Terminal 会话：** agent 以自己的 TUI 在 PTY 里运行的会话。
- **活动状态：** 圆点与通知背后的粗粒度状态。terminal 一侧由 hook 上报，尽力而为。
- **Hook：** 安装进 agent 配置目录、把事件转成活动状态发给 daemon 的小段代码。
- **吸收：** 从 orca 借鉴交互做法，在 BySpace 自己的架构和设计系统里重做。
- 想理解方向怎么来的 → `codestable/talks/001-terminal-native-hard-fork.md`
- 想知道现在能做什么 → `codestable/spec/index.md`
- 想摘开发切片 → `codestable/epics/003-o-orca-terminal-agent-experience/spec.md` 与其 `issues/`
