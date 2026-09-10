# terminal-native agent 会话与独立 fork talk

讨论日期：2026-09-09。参与：Owner、AI。

---

## 1. 开场：上游走插件路线，Pi 的 RPC 适配体验差，要不要独立 fork

Owner 起头：上游 Paseo 发了 0.8.0 beta，release note 看起来都围绕插件；上游路线和自己想要的完全不同，插件能做的也很少。深度使用后，主力 agent Pi 走 Paseo 这种"UI 适配 RPC / 非交互式调用"的方式维护成本高、问题多、体验差。开始觉得不如直接用原生 terminal，适配工作量大幅减少；orca（`/Users/zijie/workspace/forks/orca`）的思路和部分 UI 交互是认可的参考，细节不喜欢。上游已转 Apache-2.0，想干脆完全独立 fork，不再被上游束缚。

AI 先查了仓库和上游，事实如下：

- 上次同步是 2026-09-02 的 v0.7.2（PR #21）。一周内上游推了 54 个提交，本仓库领先 71 个。上游速度约每周 50 个提交。
- 那 54 个提交里插件相关约三分之一，其余是 Pi steer RPC、Codex rewind、macOS 更新修复、移动端键盘、diff 性能等适配器和体验修复。
- 本仓库与上游都已是 Apache-2.0，fork 一直允许，门槛只在维护量。
- byspace 已有 terminal-native 的半条路：`docs/terminal-activity.md` 描述的 hook 上报链路能让 terminal 里跑的 agent 显示 running / idle / needs-input 并发完成通知；`packages/server/src/terminal/agent-hooks/` 下已有 claude、codex、opencode、pi 四个 hook provider。
- orca 用 PTY 跑 agent，靠 hooks 加读 agent 状态文件给手机端做监控和跟进；但它最近的提交全是 "native chat pane"，说明纯 terminal 在他们那里也撞到上限，在往回补结构化对话层。

AI 的纠正：真正要做的决定不是"是否 hard fork"，而是"agent 会话要不要从结构化 RPC 适配切换到原生 terminal"。fork 是这个决定的后果，两者耦合，拆开看会误判成本。三种组合：

1. 保留结构化适配器并 hard fork：最贵，五个 provider 的协议漂移全由一人修，不推荐。
2. hard fork 并转 terminal-native：适配器维护量大降；代价是手机端 agent 对话退化成手机宽度的 xterm，权限批准、工具卡片、精确 steering 要重做或放弃，`codestable/spec/agent-conversation.md` 大半失效。
3. 先不 fork，只对 Pi 穿刺两周：暂停同步可逆，hard fork 一旦重排结构是单向门。

AI 推荐第三条，并抛出关键分叉：手机端在实际使用里占多大比例。同时确认"其实就是这个项目"指 orca 的思路。

## 2. 手机占比低，问题是生命周期类的，方向定下

Owner 回答：手机端占比少；现有结构化 UI 在手机上对 Pi 也没好到哪去，很多莫名其妙的问题，比如 UI 上会话已停止但实际还在生成。这类问题 terminal 能完全解决，因为都是生命周期导致的。Owner 认为解决 terminal 在手机上的体验，比继续适配 UI 简单。

AI 的判断：这类 bug 不是某个适配器写得差，而是所有靠旁路重建 agent 状态的方案都躲不掉的。terminal 之所以能解决，是因为 terminal 本身就是状态，没有第二份需要对齐的真相。hooks 上报的状态退化成尽力而为的提示，错了只是圆点不准，不会把用户锁在假的"已结束"界面里。这是结构性优势。

**已确认：** agent 会话转 terminal-native。

随后 AI 按依赖顺序提出三个分叉并给推荐：

**分叉一：只换 Pi，还是所有 provider 都走 terminal、删掉结构化适配器？** 推荐全部走 terminal、分阶段删适配器。只换 Pi 而保留其余四个，等于在没有上游的情况下继续维护上游最容易坏的部分。保留代码不维护也不行，没测试覆盖的适配器几个月就烂，git 历史足够找回。牵动的能力：

- 定时任务、MCP 创建 agent、Hub 触发：映射成"在 PTY 里启动一条命令"，能力保留，形态变 terminal 会话。
- 权限批准、工具卡片、subagent 树、会话导入、语音输入、rewind：依赖结构化事件流，terminal 化后消失或退化。权限批准变成在 terminal 里按键。
- Epic 002 的 A04–A09 大半作废；T01–T18、Relay、Workspace 不受影响。
- `codestable/spec/agent-conversation.md` 整份漂移，Epic 关闭时退役。

**分叉二：fork 形态。** 推荐现在停止同步，保留 upstream remote 只做 cherry-pick 参考，不再 rebase 或 merge。CLAUDE.md 里面向上游的 COMPAT 规则可撤，但自家 app 与 daemon 的版本漂移兼容保留，因为手机和桌面不会同时更新。

**分叉三：手机端 terminal 做到什么程度。** 划一个"够用"边界，第一版只做四件事：turn 结束通知、快捷输入栏、常用键工具条（Esc、Ctrl、方向键、Tab）、按屏宽自动定列数。更多的等用两周再说。

**已确认（Owner："都没问题"）：** 三个分叉均按推荐执行。出口安排：落 Talk、重写 Vision、开 Epic，第一个 Issue 是 Pi 穿刺两周，拿到证据再删适配器。

## 3. 上游那批提交还要不要

Owner 追问：前面提到的 Pi steer RPC、Codex rewind、macOS 更新修复、移动端键盘、diff 性能这些上游修复，还要吗。

AI 按每个提交触碰的目录分类：

- **不要（随适配器和插件一起放弃）：** Pi steer RPC、Codex rewind / dispose、OMP 超时、OpenCode 子会话、ACP 会话导入、subagent 归属、provider 通知进时间线、全部 plugins / Hub 提交、按 provider 控制工具、Gajae Code 目录、一键导入会话、provider 配置重载保状态、模型目录加 Fable、时间线卡顿和崩溃修复。
- **要，且随时可 cherry-pick（不碰 Epic 会重塑的区域）：** 大 diff 响应性（#4174）、diff 文件头同步（#4240）、web diff 复制（#4229）、Changes 与 working diff 同步（#4199）、禁用 fsmonitor（#4208）、Linux 打包 CLI shim（#4207）、Windows daemon 优雅关闭（#4168）、跨平台 CI flake（#4171）、Settings 导航残留（#4228）、fork PR 显式设置（#4215）。
- **要，但等穿刺后再拿：** 移动端键盘过渡（#4275）和侧栏自定义（#4203），它们碰的代码 Epic 会重排。
- **先对照再决定：** macOS 更新修复（#4322）。本仓库已在 Issue 002、006、014 三次自己修过这块，先比对再决定取谁。

**已确认规则：** 之后只 cherry-pick 进保留面（terminal、diff、workspace / forge、desktop 外壳、relay、移动端外壳），适配器、插件、Hub 一律不取。

## 4. 顺序：先选择性同步再断开；先删还是先优化；想抄 orca

Owner 提议：先做一次选择性同步，这次同步之后就下决心彻底分开，以后自己维护。同时提出一个要判断的点：先删适配器，还是先优化 terminal。因为还想吸收 orca 的产品体验，terminal agent 生命周期管理、对话、左侧工作区交互，大部分想抄过来。

AI 拿了两份证据。

第一份是 cherry-pick 干跑。上次同步是把 v0.7.2 整棵树导入成一个 squash 提交，所以这次只能逐个 cherry-pick，不能 merge。结果：

| 提交                                      | 干跑                       | 决定                                    |
| ----------------------------------------- | -------------------------- | --------------------------------------- |
| #4168 Windows 关闭、#4174 大 diff         | 内容已在 main              | 不需再取                                |
| #4199 #4207 #4208 #4228 #4229 #4240 #4275 | 干净                       | 取                                      |
| #4171 CI flake                            | 1 个测试文件冲突           | 取，手工解                              |
| #4215 fork PR 设置                        | 2 个文件冲突               | 取，手工解                              |
| #4203 侧栏自定义                          | 干净，37 个文件            | 不取，侧栏会按 orca 重做                |
| #4322 macOS 更新                          | 6 个文件冲突，含更新器核心 | 先与 Issue 002、006、014 的自家实现对照 |

移动端键盘 #4275 从"穿刺后再取"改为现在取：这是最后一次同步，之后成本高得多，terminal 在手机上同样要过键盘这关。

第二份是 orca 的做法：

- 所有 agent 以 PTY 起，约 40 种 agent 靠一张启动命令表加环境变量注入。生命周期完全来自装进 agent 配置的 hook，四档：working、blocked、waiting、done。byspace 现在三档，缺"权限阻塞"与"等输入"的区分。
- "对话"是可选的 native chat 覆盖层，压在活的 PTY 之上。内容按优先级来自磁盘会话 JSONL 转录、hook 事件、滚屏抓取；发送是往 PTY 合成按键。只支持 claude、codex、grok、omp，Pi 与 OpenCode 只有 terminal。
- 同时保留了 Claude 与 Codex 的 SDK 结构化通路，即 byspace 要放弃的东西。
- 侧栏是 project → host → worktree → agent 行，一个 worktree 卡片挂多个 agent 行，行上是状态点、名称和 hover 徽标。
- 手机端 terminal 与 Chat UI 并存，输入走 PTY 写。

AI 的判断：

- 先优化 terminal，现在冻结适配器，主力切过去后再删。先删会让过渡期没东西可用；删除是大 diff，会和 cherry-pick 打架；但适配器只要活着就会吸引工作，所以从今天起不再修、不再加功能。
- "对话"与 terminal-native 不冲突，前提是 chat 永远只做视图，没有生命周期权威。Pi 有会话 JSONL，byspace 仓库里已有读 Pi 会话文件的代码，删适配器时留下。Vision 里"放弃结构化对话面板"要修正：放弃的是适配器拥有会话的模式，转录派生的对话视图是候选。
- "抄 orca 大部分"先收成三块：terminal agent 生命周期、侧栏 worktree 到 agent 行的模型、后置的对话覆盖层。orca 是 MIT，需保留版权声明；栈不同，UI 是重做交互，主进程里的 hook 监听、状态归一化、启动命令表可以移植。

## 5. "其实想要整个 orca"

Owner 纠结后说出真正的诉求：可能想要的是整个 orca 的 UI 和交互；orca 唯一缺的是 paseo 的 web 使用能力，以及 relay、web、daemon 这种架构。

AI 核实 orca，前提被部分推翻：

- daemon 有。`orcad` 是纯 Node 无头运行时，`orca serve` 跑在无桌面的 Linux 上，PTY 由独立 terminal daemon 持有。标注 beta。
- web 有。配对式 web 客户端由运行时静态托管，构建自同一个 renderer。
- relay 有，但只服务手机。服务端在仓库 `cloud/`，MIT，director 加多区域 cell，GCP、Cloud SQL、Terraform 部署。桌面与 web 客户端连远程运行时走 Tailscale、局域网或 SSH 转发。
- 规模与速度：

|                  | byspace  | orca      |
| ---------------- | -------- | --------- |
| 非测试 TS 行数   | 约 49 万 | 约 180 万 |
| 上游近 7 天提交  | 54       | 694       |
| 上游近 30 天提交 | 约 200   | 2282      |

三条路：在 byspace 里重做 orca 的 UI，一个人做不完；hard fork orca，冻结等于独自维护 180 万行不熟的代码，最危险；当 orca 用户，用 Tailscale 或 SSH 补远程。AI 推荐第三条并建议试用两周，同时说明当天写入 `codestable/` 的三份文件前提动摇，暂不再动。抛出的分叉：桌面与 web 远程访问走 Tailscale 或 SSH 能否接受。

## 6. 架构底线与最终决定

Owner：不能接受。要的是不需要 Tailscale，通过 relay 在 web 上使用；要 daemon 架构，不强求客户端；在任何地方都能装一个 daemon，然后打开 web 直接用，拥有所有功能，不强绑定客户端。并且要做的是自己的项目：基于 paseo，产品交互面后面慢慢从 orca 抄过来。

AI 补充核实：orca 的 web 客户端确由运行时托管，但整体设计是桌面优先。web 上隐藏 mobile emulator，managed browser 依赖运行时支持 streaming，renderer 里约 30 处 `isWebClient` 分流；`orca serve` 的配对地址假定 tailnet；relay 只给手机，且带独立的 E2EE 设备注册。要把它改成 daemon 优先、web 全功能、relay 通用，是逆着它的设计改一个每周 700 提交的代码库。

**已确认：**

- 基于 paseo / byspace 做自己的项目，选择性同步一次后彻底断开。
- 架构底线四条：任何机器可装 daemon；浏览器打开即用且拥有全部功能；远程经 relay，不需要 Tailscale 或 VPN；不绑定任何客户端 App。
- orca 是交互面的参考产品，按区域慢慢吸收；第一块是 terminal agent 生命周期，即 Epic 003。
- 第 4 节的顺序、冻结与取舍表，Owner 未再提出异议，按 AI 推荐写入 Epic 003：先同步再断开，先优化后删，适配器自 2026-09-09 冻结。执行 Issue 001 前仍可修正。

## 7. 重排结构：同步独立、删除搁置、Epic 改成抄 orca

Owner 要求改结构：cherry-pick 开一个单独的 Issue 来做；删除适配器先搁置；以 orca 为模板去抄和改造 terminal agent 体验，这个作为一个 Epic。terminal agent first 的决策保留。

AI 按此重排：

- 上游同步与断开从 Epic 内提到根 `codestable/issues/017-…`（第 8 节撤回后该 Issue 更名并改号为 `019-o-sync-upstream-to-0-8-0-beta.md`）。理由是断开上游是项目级决定，不属于任何一个 Epic；取舍表、冲突解法和断开点原样带走。
- Epic 003 更名为「以 orca 为模板改造 terminal agent 体验」，目录改为 `003-o-orca-terminal-agent-experience`。边界从「迁移加删除」收窄为「把 terminal 跑 agent 做成主力路径」，吸收对象是 orca 的启动命令表、四档状态、hook 装配、通知和手机端，并记下这些能力在 orca 源码里的落点供移植。
- 删除适配器移入 Epic 的「搁置」：删除只能是主力切换完成后的结果，不是逼迫切换的手段。随之保留现状的还有权限 UI、工具卡片、subagent 树、会话导入、rewind，以及 `agent-conversation.md` 的退役和 CLAUDE.md 上游兼容措辞的清理。
- 穿刺 Issue 在 Epic 内改号为 001，与同步 Issue 之间只保留顺序建议，不设硬依赖。

**AI 主动调整并说明的一点：** 第 4 节写的「适配器自 2026-09-09 冻结，不修 bug、不加功能」在删除搁置后不再合适。结构化路径仍是 Owner 当前的日常工具，完全不修会让它在 terminal 路径成熟前先坏掉。改为：不加新功能；是否修 bug 按痛感决定，不承诺维护。同时在 Epic 的「必须守住」里写明结构化路径在本 Epic 期间保持可用。

**已确认：** terminal agent first 保留为 Vision 层决策；执行层拆成一个独立 Issue（同步并断开）加一个 Epic（抄 orca 的 terminal agent 体验）；删除搁置。

## 8. 撤回：UI 与 terminal 共存，继续同步上游，只做吸收

Owner 在手机上批准本会话时实地用了一次移动端，得出与前面相反的结论：Claude 这类全屏 TUI 在手机上基本不可用，之前太乐观了。提出撤回，并问 orca 的移动端是怎么处理的，是不是也做了 UI。

AI 查证 orca 移动端：

- **做了，而且 Chat UI 是默认视图**，raw terminal 是备选。设备默认值在设置里，长按会话标签可只切换该标签。terminal 视图另配辅助键行与 Live 模式（每个字符直接进 PTY）。
- **聊天内容是投影，不是适配。** 三个来源按优先级合并：磁盘会话 JSONL 转录（3）> 实时 hook 事件（2）> 滚屏抓取（1，降级兜底）。发送是往 PTY 写按键。terminal 仍是唯一真相，聊天不拥有生命周期。
- **支持列表不含 Pi。** 只有 claude、openclaude、codex、grok、omp；Pi 与 OpenCode 在 orca 里只有 terminal。照抄拿不到 Pi 的手机端体验。
- 本仓库 Pi provider 已在跟踪 Pi 的会话文件并用作原生句柄，转录在磁盘上、路径已知。orca 在这块反而有我们没有的麻烦：部分 agent 的 hook 不暴露转录路径，只能扫会话根目录，SSH 远程时读到错的机器，只好让聊天视图保持关闭。daemon 跑在 agent 所在机器上，这一点对我们更容易。

Owner 随后给出最终判断：撤回最开始的决定，UI 与 terminal 依然共存，保存现状。任务改为——把同步 Issue 扩展成同步上游到最新 beta release，然后开始 terminal agent 体验优化，看 orca 有哪些值得吸收的。**只做吸收。**

**已确认（推翻前面第 2、6、7 节的相应结论）：**

- 不做 terminal-native 迁移，不删除任何 provider 适配器，结构化 UI 与 terminal 两条路都保留，都是一等公民。
- 不与上游断开。继续以 Paseo 为基线同步，本轮目标是 `v0.8.0-beta.1`。第 3、4 节的「保留面 cherry-pick」与「断开点」不再适用。
- orca 只作为交互面的吸收来源，不作为架构参照，也不整体照搬。
- 第 6 节的架构描述（daemon 优先、web 优先、经 Relay 可达、不绑定客户端）不属于被撤回的部分——那是 BySpace 本来就有的形态，继续成立。

**处置在途工作：** PR #31 当时已开且 CI 全绿。它的八个 cherry-pick 全部包含在 `v0.8.0-beta.1` 里，全量同步会覆盖它们。因为工作已完成且验证通过，改正描述中已被撤回的「断开上游」措辞后合入（`28c770533`），既落袋已验证的修复，也缩小后续同步的 diff。

---

## 出口

- 已执行：本 Talk；PR #31 合入 `main`；`codestable/vision/index.md` 改回 UI 与 terminal 共存；`codestable/issues/019-o-sync-upstream-to-0-8-0-beta.md`（由原「选择性同步并断开」扩展而来）；`codestable/epics/003-o-orca-terminal-agent-experience/` 重定为「吸收 orca 的 terminal agent 体验」。
- 建议下一步：完成 Issue 017 的全量同步，再做 Epic 003 的吸收清单。
- 暂不纳入：删除适配器、terminal-native 迁移、断开上游（均已撤回）；侧栏模型与转录投影对话视图（吸收候选，待清单排序后再定）。
