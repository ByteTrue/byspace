# Host 设置分类收敛与终端集成的归属

> **写法：** 按讨论推进顺序，每节 = 一轮推进或一次关键纠正。
> 起点是「Terminals 设置页能不能砍」，收在「Host 一级分类 7 → 5，终端集成落进 provider 详情弹层」。

---

## 开场：Terminals 页看起来是三个不相关的东西

Owner 的原始说法：想知道 terminal 这个设置页能否砍掉并到别处——钩子、profile 这类「关于 agent 客户端的」配置放进 provider，「正常逻辑是你得先启用这个 provider，你再去谈什么钩子」；剩下的默认 shell 单独找地方。

先查现状。Terminals 页（`HostTerminalsPage`，`packages/app/src/screens/settings/host-page.tsx`）只有三块：逐 provider 的 `Terminal agent hooks`、`Default shell`、`Terminal profiles`。四处深链入口指向它，全部是「Manage terminal profiles」语义（`workspace-tabs/launcher/index.tsx:111`、`new-workspace-launch/launch-control.tsx:147`、`workspace-header-menu.tsx:222`，e2e 两处）。

## 第一轮纠正：「先启用 provider 再谈钩子」这个前提不成立

Owner 提的 tab 位置理由是 enabled→hooks 的依赖。查下来这条依赖不存在，而且不该有：

- hooks 由 daemon 侧 `packages/server/src/terminal/agent-hooks/` 独立写入 agent 自己的 config 文件，`resolveTerminalAgentHookSettings()` 完全不看 `providers[x].enabled`。
- BySpace 里的 enabled 语义是「在 BySpace 里可不可选」（`provider-registry.ts:737`），不是「装没装」。
- 反例合法：关掉 Claude Code 但仍要它的终端活动上报——用 BySpace 看终端，不在 BySpace 里起 Claude 会话。

**已确认：并入 provider 之后不联动两个开关**，并在 spec 写死这条约束。真实语义是「这个 agent 的终端集成」，与是否可在 BySpace 里起会话无关。Owner 认可该纠正。

## 第二轮：一级分类太杂，Providers 和 Usage 要不要一起并 Agents

Owner 提出更一般的原则：设置大类应尽可能精简，配置项多就在**域内**做二级甚至三级分类，而不是全部铺开在一级迷惑用户。

查三页内容后给的答案是**并 Providers、不并 Usage**：Usage 页只有一个只读报表（`ProviderUsageSettingsSection`，带 Refresh、无一条配置），issue 050 已拍板「监控视图，非设置」。折进 Agents 的代价是把「这个月花了多少、哪家掉线」藏到设置树第三层。

为让原则有停止条件，立了三层规则（详见 `../decisions/001-settings-taxonomy-and-integration-layers.md`）：一级 = 用户任务，二级 = 同一任务内的视角切换，三级 = 逐个对象。Providers 与 Agents 是同一任务的两个视角，能并；Usage 是另一个任务。

Owner 同意 Usage 保持独立。

## 第三轮关键纠正：tab 属于弹层内部，不是页面级

我先画了一版把 hooks / profiles 做成 Providers 页顶部大 tab 的示意。Owner 否掉：「那些配置项本来就是和各个 provider 概念上在一起的……我说的 tab 也只是举例，你做成这种交互我觉得会很难用」。

这条纠正同时消掉一个真实成本：页面级 tab 必须可 URL 寻址，否则五处深链里点「Manage」会落到错误 tab——那是本轮最重的一块机制。挪进弹层后不需要它，深链只需改 slug。

**已确认：provider 详情弹层（`ProviderDiagnosticSheet`）顶部 `Agent` / `Terminal` 两个 tab。** Agent = 现在的模型浏览；Terminal = 逐 provider 的 hooks 开关与该 provider 的启动命令。弹层即三级「逐个对象」，页级大 tab 不做。

## 遗留冲突：profile 列表有非 provider 条目，不能整体拆进弹层

`terminalProfiles` 不只是四条 agent 启动命令：

- 空白终端 `BLANK_TERMINAL_PROFILE_ID`（`launch-control.tsx:141`）不属于任何 provider；
- 用户自建条目走生成 id（`profile_<ts>_<rand>`），命令可以是任意程序——protocol 里那段注释就是靠 command base name 而非 id 认 agent 的；
- 列表有顺序语义，↑↓ 就是启动菜单的排列。

三件事都没有 provider 可归属。把列表彻底拆进各弹层会带来一个做不出来的交互（跨弹层排序），并且要么删掉要么无处安放「Manage terminal profiles」入口。

**已确认（Owner 认可「大体上没问题」）：列表的唯一所有者仍是页级的一份列表，落在 Overview**；弹层 Terminal tab 展示该 provider 的启动命令并提供编辑入口，打开同一个 `TerminalProfileEditModal`。是链接，不是重复所有权。

## 落定的归属

| 内容                                                 | 去处                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| Terminal agent hooks（逐 provider）                  | provider 详情弹层 ▸ Terminal tab                           |
| 该 provider 的启动命令                               | provider 详情弹层 ▸ Terminal tab（编辑入口，所有权在列表） |
| Terminal profiles 列表（含空白终端、自建条目、排序） | Overview                                                   |
| Default shell                                        | Overview（它是 shell 的属性，不是某个 agent 的属性）       |
| Providers 页                                         | 平面折叠进 Agents 页，不做 tab                             |

结果：Host 一级分类 7 → 5（Overview / Projects / Connections / Agents / Usage），Terminals 与 Providers 两个 slug 消失。

## 影响与取舍

- **入口：** 三处「Manage terminal profiles」改指 Overview（目标仍唯一稳定）；`open-project-screen.tsx:53` 的 providers 深链改指 agents；`agent-controls/index.tsx:283` 不变（同页）。
- **零向后兼容（#1807）：** `HOST_SECTION_SLUGS` 直接删 `terminals`、`providers`，不写 `LEGACY_HOST_SECTION_SLUGS` 映射、不加 COMPAT 标记。注意这与 issue 050 当时的做法相反——那条是历史记录，不是当前规范。
- **hooks 的 provider 集合是硬编码四个**（`TERMINAL_AGENT_HOOK_PROVIDERS` / daemon 的 `AGENT_HOOK_PROVIDERS`）：ACP 与自定义 provider 没有 hook provider，Terminal tab 对它们不出现。
- **弹层内的 profile 定位需要新 helper：** 按 command base name 找该 provider 的 profile，`getCommandBaseName` 目前在 `packages/protocol/src/terminal-profiles.ts` 内私有。
- **代价：** Overview 变长（多了 shell 与 profile 列表两节）。这是「一级分类少」的必然结果，Owner 的原则明确接受这个交换。

## 候选质量目标（尚未成为承诺）

- **可达性不降级**（易操作）：每条配置在合并后仍能在两次点击内到达，且从启动菜单点「Manage」落到的是唯一正确的列表。来源：issue 050 的同类承诺。
- **自描述性**：Terminal tab 里「启用 provider」与「上报状态」并列可见，读者不会误以为二者联动——这是那条不联动约束的界面侧证明。

## 仍开放

无。Tab 命名按 Owner 贴的示意用 `Agent` / `Terminal`。

## 出口

- 已执行：落本 talk + Decision 001。
- 已关闭：`../issues/052-x-host-settings-terminal-consolidation.md`（refactor）已实现并验证。
- 暂不纳入：Usage 的位置调整；Agent profiles 是否也进 provider 弹层（Owner 未提，其编辑 modal 与 Providers 页节奏不同，留作后续）；hooks 与 provider enabled 的任何联动。
