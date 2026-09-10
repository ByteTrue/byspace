---
kind: epic
title: "吸收 orca 的 terminal agent 体验"
status: open
owner_decision: approved
created: 2026-09-09
amended_at: 2026-09-09
approval_evidence:
  owner: "“开始 terminal agent 体验优化，看 orca 有哪些值得我们吸收的。我们只做吸收吧”（2026-09-09）"
  scope_retraction: "Owner 撤回 terminal-native 迁移与删除适配器；UI 与 terminal 共存，保存现状（2026-09-09）"
  talk: ../../talks/001-terminal-native-hard-fork.md
---

# 吸收 orca 的 terminal agent 体验

> **读者：** 在这条变化里对齐的人。要改什么、只借什么、哪些明确不碰、怎么排序、关了合回哪里。

---

## 这条线要改变什么

BySpace 的 terminal 会话目前只是「一个能跑 TUI 的终端」加一层活动指示。orca 把同一件事做成了完整产品：约 40 种 agent 的启动命令表、装进 agent 配置的 hook、四档生命周期、完成通知、手机端可用的 terminal 与可选的转录投影视图。

本 Epic 把其中值得的部分吸收进来，让 terminal 会话这条路本身好用。

**只做吸收。** 不迁移、不替换、不删除。结构化会话与 terminal 会话是两条并行的一等路径，见 `codestable/vision/index.md`「产品核心」。

- 来源 Vision：`codestable/vision/index.md`「参考产品」与「探索中或候选」。
- 关联 spec：`terminal.md` 扩展 agent 宿主与活动语义；`workspace.md` 的 Agent 状态展示新增 terminal 一侧来源。`agent-conversation.md` 本 Epic 不动。

## 当前怎么理解（活规格）

**为什么值得做。** 结构化会话覆盖不了所有 agent：provider 适配是有成本的，新 agent、小众 agent、用户自己改过的 agent 都进不来。terminal 会话是那条兜底的通用路径，但它现在的体验明显弱于 orca。补齐它，等于用一份工作换来对任意 agent 的支持。

**只借交互，不借架构。** orca 是桌面优先，daemon 与 web 都是后加的；BySpace 是 daemon 优先、web 优先。吸收时按 BySpace 的架构和设计系统重做，daemon 侧逻辑可移植。orca 为 MIT，移植代码需保留版权声明。

**吸收候选与 orca 落点。** 排序由 `issues/001` 产出，这里只登记候选与证据位置：

| 候选                   | orca 的做法                                                                                   | 落点                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 启动命令表             | provider 到可执行命令与参数的映射，加 PTY 环境注入                                            | `src/shared/tui-agent-launch-command.ts`、`tui-agent.ts`、`src/main/providers/local-pty-spawn.ts`  |
| 四档生命周期           | `working / blocked / waiting / done`，本仓库现为三档，缺「等权限」与「等输入」的区分          | `src/shared/agent-status-types.ts`、`src/renderer/src/components/AgentStateDot.tsx`                |
| hook 安装与事件归一    | 每个 agent 一个安装器，事件归一后 POST 到本地监听                                             | `src/main/agent-hooks/managed-agent-hook-registry.ts`、`src/shared/agent-hook-listener/providers/` |
| 完成通知与 dock 徽标   | turn 结束通知、未读 workspace 徽标、agent 工作时阻止休眠                                      | `src/main/dock/unread-badge.ts`、`src/main/agent-awake-service.ts`                                 |
| 手机端 terminal 可用性 | 辅助键行（含 Tab、Shift+Tab）、Live 模式逐字符直达 PTY、滚屏水合、选择复制粘贴                | `mobile/src/terminal/TerminalWebView.tsx`                                                          |
| 转录投影视图           | 磁盘会话 JSONL 转录（优先级 3）> hook 事件（2）> 滚屏抓取（1），压在活 PTY 之上，发送写回 PTY | `src/shared/native-chat-types.ts`、`src/renderer/src/components/native-chat/`                      |

**关于转录投影视图的两个事实。** 它是 orca 解决「全屏 TUI 在手机上不可读」的答案，也是本 Epic 最有价值的候选。但 orca 的支持列表是 claude、openclaude、codex、grok、omp，**不含 Pi**；Pi 在 orca 里只有 terminal。另一面，本仓库 Pi provider 已在跟踪 Pi 的会话文件并用作原生句柄，转录在磁盘上、路径已知，缺的是解析器。而且 orca 在这块有本仓库没有的麻烦：部分 agent 的 hook 不暴露转录路径，只能扫会话根目录，SSH 远程时读到错的机器，只好让聊天视图保持关闭；daemon 跑在 agent 所在机器上，这一点对 BySpace 更容易。

**必须守住。**

- 结构化会话不受影响：不改 `agent-conversation.md` 描述的行为，不动 provider 适配器。
- `codestable/spec/terminal.md` 的字符与顺序语义、daemon 重启后的标签恢复。
- terminal 会话里 terminal 内容是唯一真相。任何投影视图只读，不拥有生命周期。
- 全部能力在浏览器里可用，不得只做进桌面外壳。
- Epic 002 交付的保留能力不退化。

**质量承诺。**

- 可靠性：活动提示不得把用户锁在错误状态。证明方式：Ctrl-C、agent 崩溃、扩展后处理拖慢三种场景下圆点最终归位或被输入清除。
- 可维护性：接入一个新的 TUI agent 的成本是一条启动命令加一个 hook provider 文件。
- 可用性（手机）：吸收清单中被采纳的手机端项，在 iOS 与 Android 上有真机证据。

**术语。** Terminal 会话：agent 以自己的 TUI 在 PTY 里运行的会话。活动状态：hook 上报的粗粒度状态。吸收：借鉴 orca 的交互做法，在 BySpace 的架构与设计系统里重做。

## 现在推什么、先搁什么

**可推进：**

- 产出吸收清单：逐项对照 orca 与本仓库现状，判断值不值得、代价多大、依赖什么，给出排序。清单出来之前不动实现。

**Issues：**（位于同目录 `issues/`；编号仅在本 Epic 内有效）

- [ ] `issues/001-o-orca-absorption-inventory.md` — 产出带排序的吸收清单 / 无依赖 / 验证：每项有现状、orca 做法、代价与建议

**暂不推进：** 具体吸收项的实现，等清单排序。转录投影视图的 Pi 解析器可行性，作为清单中的一项评估。

**不在本 Epic：** 上游同步，见 `codestable/issues/019-x-sync-upstream-to-0-8-0-beta.md`。建议同步完成后再开始实现，避免吸收改动与全量同步的大 diff 互相冲突。

**明确不做：** 删除或弱化 provider 适配器；把 terminal 变成默认或唯一路径；照搬 orca 的架构、Kanban、Design Mode、SSH worktree 等未点名区域。

**关闭时要满足：** 吸收清单已产出并经 Owner 排序；清单中被采纳的项已实现并验证；结构化会话行为未变。

**合并回 project spec 的候选：** `terminal.md` 新增 agent 宿主、启动方式与活动语义；`workspace.md` Agent 状态展示补 terminal 来源；手机端 terminal 章节。

**Vision 同步检查：** 演化地图中本 Epic 状态；「探索中或候选」里转录投影视图与侧栏模型是否转为目标或放弃。

## 相关材料

- `codestable/talks/001-terminal-native-hard-fork.md` — 为什么两条路共存、为什么不以 orca 为底、撤回的完整经过。
- `docs/terminal-activity.md` — 现有 hook 上报链路，吸收直接建在它上面。
- `/Users/zijie/workspace/forks/orca` — 参考产品源码，落点见上表。
