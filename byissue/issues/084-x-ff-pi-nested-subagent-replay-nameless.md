---
kind: issue
title: "pi 子代理轨满屏 Loading：回放按 id 去重丢掉了 codemode 内启动的子代理"
type: ff
status: closed
created: 2026-10-14
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# pi 子代理轨满屏 Loading：回放按 id 去重丢掉了 codemode 内启动的子代理

> **读者：** 看到 subagents 轨里一堆只有 spinner 没有标题的行，或要动 `replayPiSubagentSession` 时读这条。

---

pi 主代理用 codemode 里的 `tools.subagent(...)` 起子代理时，BySpace 的 subagents 轨会出现十几行永远的 `Loading...`，点开只有一个"Start chatting with this agent..."空态。原因不在渲染，在回放：**descriptor 只有状态、没有名字，timeline 也没有。**

## 根因

pi 把「工具里调工具」的嵌套调用**只**记成父工具结果上的 `nestedCalls` 参数快照（`ctx.executeTool()`，见 pi `core/nested-tool-calls.js`），嵌套调用自己的 toolResult **不入转录**。于是 codemode 里启动的子代理，在转录里根本没有 launch 记录。

`replayPiSubagentSession` 只从 launch 记录产出 `declared` observation（它带来 `title`/`description`/`toolCallId`），record 一律只映射成 `status`。结果这些子代理只有 `status: completed`，没有标题——app 的 `buildSubagentRowPresentationData` 对无名行返回 `titleState: "loading"`，行就渲染成 `Loading...`；tab 标题同样退化成兜底文案。**同一份转录里，agent 直接在顶层调 `subagent` 的行有名字，走 codemode 的没有。**

真实转录核对（`01a134ca-…`，14 个子代理）：14 条 `subagent-exit`，0 条 `declared`。

附带同一条链上的第二个洞：exit 记录里的 `sessionId`/`cwd`/`sessionFile` 也没被吸收为指针，这类子代理的只读 tab 连时间线都重建不了。

## 修了什么

`packages/server/src/server/agent/providers/pi/agent-subagents.ts`

- 新增 `declarationFromRecord`：把 record 自身的 `agent`（→ `title`）与 `description`（→ 任务摘要）折成 `declared`；两字段都没有则返回 null，不产空声明。
- `replayPiSubagentSession` 维护 `declared` id 集合：**record 只在「没有 launch 记录命名过这个 id」时才补声明，且每个 id 最多一次**——launch 的完整 task 文本优先，record 的 60 字一行摘要只在缺失时兜底，不重复 push。
- exit 自定义消息改为逐条 `absorbSessionPointer`，把指针从「只在 toolResult 里吸收」放宽到「exit 也吸收」——这是 codemode 类子代理唯一的指针来源。
- 单趟循环拆成 `MutableReplay` 累加器 + `declareFromRecord` / `applyToolResultMessage` / `applyRecord` 三个阶段函数（原先内联写法触发 oxlint complexity 21 > 20）。

不动的部分：live 路径不变（它从 `tool_execution_*` 事件拿名字，本来就有）；协议零改动，`declared` 本来就是既有 observation 类型。

## 验证

- `agent-subagents.test.ts` 22 绿（新增 3 例）：`names a codemode-nested child from its own task record`（含指针断言）、`names a child from its record for every origin, once`（重复声明只出一次）、`keeps the launch record's full task over a record's one-liner`（不覆写完整 task）。
- **真实转录回归**（`npx tsx` 直跑 `replayPiSubagentSession` + `foldSubagentObservations`）：修复前 `declared: 0, pointers: 0`；修复后 `declared: 14, pointers: 14`，14 行全部拿到 title/description，14 个指针全部能定位到子会话 jsonl（`locatePiSubagentSessionFile` 兜底命中，0 缺失），每个都能读出 timeline items（31–351 条）。
- 相邻回归：`agent.test.ts` + `history-mapper.test.ts` 109 绿；`agent-manager.test.ts` 193 绿；`session.workspaces.test.ts` 108 绿（4 skip）；`store.test.ts` + claude `observation.test.ts` + `subagent-session-tailer.test.ts` 25 绿。
- `npm run typecheck` 全仓过；`npm run lint` 0/0；`npm run format:files`。

## 对 `byissue/` 的影响

已同步 `spec/agent-conversation.md`：descriptor 三源那段的 launch 描述补上「codemode 内启动的子代理在转录里没有 launch 记录，回放由 record 自身补名」。

## 两层回归测试（补，2026-10-14）

这个 bug 的链路是 `transcript → replayPiSubagentSession → observations → descriptor → 协议`。**bug 全在 `messages → observations` 这一段**，jsonl 的解析与磁盘格式不参与。因此能造数据的那部分就造，只有「pi 到底怎么写转录」这个外部行为假设必须真机验。

**第一层：daemon 级 e2e，脚本化转录（`daemon-e2e/pi-subagent-replay.e2e.test.ts`，新增）**

用 FakePi 喂转录，但**走真实路径**：真回放、真 AgentManager store、真协议响应，只有模型和子进程缺席。三例：codemode 嵌套子代理拿到名字、它的 timeline 能从 exit 记录的指针在磁盘上重建、顶层 launch 的完整 task 不被 record 摘要覆盖（控制组）。**修复前 2 红 1 绿，修复后 3 绿**——控制组前后都绿，证明前两例测的确实是本次改的东西。

**第二层：真机跑一轮，在浏览器里看（不进测试套件）**

mock 验不了的那一半是「pi 真的不写 launch 记录」，只能真机。但**不写成测试**：它要花模型 token，而 CI 没有可用的模型，写进套件等于永远跳过或永远要钱。做法是手工跑一轮、亲眼看，代码不留碳。

步骤：起自己的 dev daemon（空闲端口）+ dev app → 建一个 `codemode: { mode: "only" }` 的 pi agent → 让它在一个 codemode 脚本里调 `tools.subagent(...)` → 用 bsk 打开 app。

看到的结果（`web` 客户端实测）：

- 主时间线里嵌套那行是 `reviewer Reply with exactly BROWSER_VERIFY_SENTINEL and nothing else.`；
- 子代理轨的面板里那一行是 `reviewer: Reply with exactly BROWSER_VERIFY_SENTINEL and nothing else.`，**不是 `Loading...`**；
- 点开它，只读 tab 渲染出子代理的完整 system prompt + 任务 + `BROWSER_VERIFY_SENTINEL` 回复 —— 078 的 timeline 重建也仍然正常。

同一场景在协议层再核一遍：live 行 `title="reviewer"`；`refreshAgent`（走重读 provider history 的回放路径）之后同一 id 仍是 `title="reviewer"`，描述变成 record 的一行摘要（`reviewer: Reply with…`）——正是 `declarationFromRecord` 的兜底在生效。

**踩到的坑**：

1. 子代理是后台任务，父轮次的 idle 早就到了，exit 记录要更晚才落盘。任何断言都得轮询等 `subagent-exit`，否则拿到的是还没有 exit 的转录。
2. **在 BySpace agent 的 shell 里手工跑真实 pi，会把假子代理塞进你的真实 daemon。** 这个 shell 的 `BYSPACE_SUBAGENT_REPORT_URL` / `BYSPACE_SUBAGENT_REPORT_TOKEN` 指向真实 daemon 与本 agent，手工起的 pi 继承了它们，它启动的子代理就以本 agent 的名义上报；而这条上报路径只带 `{id,status,sessionId,...}`、不带名字（名字来自 live launch 事件，手工 pi 不是 BySpace 托管的 RPC 会话，没有），于是 daemon 里多出一行永远 `running` 的无名子代理，渲染成转圈的 `Loading...`。真机验证要跑真实 pi 时，把这两个变量清掉再起进程；或者干脆只走第一层（FakePi）验证回放逻辑。

- 验证：`agent-subagents.test.ts` + `pi-subagent-replay.e2e.test.ts` + `agent.test.ts` + `history-mapper.test.ts` 134 绿；`npm run typecheck`、`npm run lint` 0/0、`npm run format:check` 过。

## 对抗性审查（2026-10-14，reviewer 子代理）

独立审了一轮，3 条发现，逐条自己求证后处理：

**已修 | 无名 launch 会永久占住 id，让 record 的名字再也补不上（P2，实际是本 bug 的另一种形态）**

旧的 `subagent` 参数形态是 `{ tasks: [...] }` —— 没有 `agent`、没有 `task`，其结果 details 也没有 `description`。`observePiSubagentLaunch` 照样产出一条**什么名字都没有**的 `declared`，而 launch 分支无条件把 id 加进 `declared` 集合，于是同 id 的 exit record 带着 `agent: "scout"` 也补不进来。实测（本机 30 个含 exit 的转录，55 条由 record 补名的声明里 39 条无 title）：修复前该 id 只有 `{kind:"declared",id,toolCallId}`；改完后 record 的 title/description 正常落地。

修法：launch 只在**真的带了名字**（`title || description`）时才登记进集合。新增单测 `names a child whose launch record states no name at all`；回退该条件验证过它变红。

**已修 | 新增 e2e 根本没进 CI（P2）**

我原先写「CI 能跑」是错的：`test:unit` 排除 `**/*.e2e.test.ts`，`test:integration` 只硬编码 4 个文件，而 CI 只跑 `npm run test`。这条 e2e 此前在任何 CI 上都不会执行，回归保护只存在于本机。已把 `src/server/daemon-e2e/pi-subagent-replay.e2e.test.ts` 加进 `packages/server/package.json` 的 `test:integration`。

**部分成立 | fixture 注释过度声称（P2）**

reviewer 说 fixture 里的嵌套调用形状是编的。**实测证伪**：采样 2291 个真实 codemode 结果，2290 个带 `details.calls[].args`（fixture 用的正是这个），2213 个另有顶层 `nestedCalls.calls[].arguments` —— 两个字段都真实存在。但它说对了一点：replay **从不读**这份嵌套快照（`codemode` 不进 `pendingLaunches`，那个分支是惰性的），所以原地那句「states that shape exactly」会让人以为快照被解成了子代理行。fixture 不动，把注释改成说明它为什么在那儿、以及为什么不能依赖它。

**reviewer 未验的两点，我自己补了**

- 无名 launch 在当前版本是否仍可达：可达，见上面实测。
- live 路径（`agent.ts` 的 `tool_execution_*` + HTTP report）是否有对称的洞：没有。live 的名字取自事件的 `args`，而当前 pi-subagent 的 `task` 是必填，匿名 launch 只可能来自旧转录 → 回放这条路径 —— 正是本次修的那条。

## 已知缺口（本次不做）

- record 的 `description` 是 pi-subagent 的 60 字一行摘要（带 `agent:` 前缀），不是 launch 那种完整 task 文本。无名变有名已解决，摘要比顶层调用短一截是可接受的次优。
- tab 空态文案仍是 `agentStream.empty` 的「Start chatting with this agent...」，对只读子代理不贴切。078 已记为遗留，本次不改。
- 真机那一轮验的是「pi 当前版本不写 launch 记录」这个外部事实。pi 或 pi-subagent 改了转录形状，第一层不会知道——只能靠下次真机跑时重新确认。
