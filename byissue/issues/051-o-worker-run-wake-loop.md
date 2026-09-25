---
kind: issue
title: "worker 的 Run 与唤醒闭环：让消息真的能叫醒一个 worker"
type: feature
status: open
created: 2026-09-24
related_issue: byissue/issues/050-o-worker-surface-align-to-qoderwake.md
---

# worker 的 Run 与唤醒闭环

> **读者：** 要实现或评审这块的人。先看为什么必须是 Run，再看已经有什么、缺什么。

## 为什么是 Run（Owner 定）

被否掉的做法是"复用现有 agent session，唤醒时把收件箱塞进同一个会话"。**否决理由是上下文连续性**：那样只有一个办法能让上下文不断 —— 把一个 worker 的全部历史堆进同一个 session。后果是会话无限增长、每个任务继承无关上下文、成本无上界。**独立任务本该是独立的 run。**

上游正是为此引入 Run 的。所以照做。

## 已经有什么（这块让 A 比看起来小）

| 能力                     | 现状                                                                                | 位置                                     |
| ------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| **run 内身份**           | **已有。** 每个 session 启动时注入 `BYSPACE_AGENT_ID` / `BYSPACE_AGENT_CWD`         | `agent-manager.ts:5093`                  |
| CLI 读身份               | 已有。`requireCallerAgentId()` 读该变量，缺失就拒                                   | `cli/src/commands/heartbeat/index.ts:35` |
| worker 能干活            | 已有。`worker.task.run` → 建 session → 跑 → 结果映射到任务状态                      | `worker-runner.ts`                       |
| 消息与唤醒的**数据模型** | 已有。`worker_message_deliveries` 每收件人一行、`wake`/`store_only`、私密与唤醒正交 | `worker-store.ts`                        |
| CLI 实体                 | 已有                                                                                | `packages/cli/bin/byspace`               |

**缺的是让它转起来的那部分。**

## 缺什么

1. **没有任何东西消费 delivery。** `listInbox` 的唯一调用方是 session handler（给 UI 读）。没有调度器、没有 claim 循环 —— 消息能存、能算出该醒谁，**但没人醒**。
2. **没有 Run 记录。** 只有 agent session；无法回答"这次唤醒是谁、因为哪条消息、跑了哪个 session、结果如何"。
3. ~~worker 的 PATH 里能不能解析到 `byspace`~~ —— **已实测：能，无需改动。**
4. **我此前"真机验证 B 跑通"是误报** —— 那些命令是我用 CLI 敲的，不是 worker 自己敲的。已改为从 worker 内部发起验证（见下）。
5. **身份映射缺失（新发现，见"已实测"）。** 这是写代码前必须先定 R1/R2 的那一条。

## 设计

**Run = 一次唤醒的执行记录。** 表 `worker_runs`：

| 字段                      | 说明                                                 |
| ------------------------- | ---------------------------------------------------- |
| `run_id`                  | 一次唤醒                                             |
| `group_id` / `worker_id`  | 谁被叫醒（participant 在本域即组内成员，不另造实体） |
| `session_id`              | 承载它的 agent session（`agentId`）                  |
| `state`                   | `running` → `completed` / `failed` / `cancelled`     |
| `trigger_message_ids`     | 这次唤醒消费了哪些消息                               |
| `started_at` / `ended_at` |                                                      |

**唤醒循环**：daemon 侧一处，把某个 worker 的 `unread` delivery 变成一次 run。

- claim 语义照上游：**认领即从 `unread` 变 `claimed`**，run 失败或取消则退回 `needs_review`，让中断的工作能被重新拾起而不是丢掉。
- **一个 worker 同时只有一个 run**（已有 `WorkerBusyError` 保证），所以唤醒天然串行，不需要新的并发控制。
- run 的 prompt 带**这一批消息**，不带历史 —— 连续性来自 worker 用 `worker.message ls` 主动读，而不是靠会话堆积。**这是"上下文连续"的正解**：状态在库里可查，不在 transcript 里越长越大。
- run 结束时把消费掉的 delivery 置 `read`。

**身份沿用现有的 `BYSPACE_AGENT_ID`**，不引入第二套 token。上游 token 是"每次唤醒新建、run 结束即失效"，因为它要跨进程证明身份；本域的 CLI 与 daemon 同机、且已有 agent 身份注入，再造一个是两套会漂移的东西。**这条偏离上游，已明确记录。**

**范围外**：run token 轮换、跨机凭证、`@Waker`、`Autonomous Work`、知识库、插件。

## 已实测（2026-09-24，探针三个，结论推翻了我最初的猜测）

| 探针                                | 结果                                                          |
| ----------------------------------- | ------------------------------------------------------------- |
| worker 内 `which byspace`           | ✅ `/…/node_modules/.bin/byspace`                             |
| worker 内 `byspace worker ls`       | ✅ 拿到真实名册                                               |
| worker 内 `echo $BYSPACE_AGENT_ID`  | `42a8860c-f491-…`（**session UUID**）                         |
| worker 内 `echo $BYSPACE_AGENT_CWD` | `…/worker/workers/wkr_78f49fb7722a`（**worker id 在路径里**） |

**所以：PATH 注入不用做，CLI 通路是通的。** 我原本把它列为"最大的未知"，是错的。

**但探针挖出一个我原来没想到的硬问题：身份对不上。** CLI 拿到的 `BYSPACE_AGENT_ID` 是 **agent session 的 UUID**，不是 `wkr_*`。daemon 侧 `worker → session` 的映射目前**只存在于任务上**（`worker_tasks.agent_id`），而**唤醒产生的 run 未必挂在任何任务上**。所以"这条消息是谁发的"无法从 session id 反查出来。

这不是小事：没有这个映射，worker 发的消息就只能靠它自报 `--sender-worker-id`，等于**没有身份**，只是没有校验的字符串。

**两个可选解法（这是本 issue 真正要先定的事）：**

- **R1：`worker_runs` 承担映射。** run 记录 `run_id / session_id / worker_id / group_id`；daemon 从 `BYSPACE_AGENT_ID` 反查 run 得到 worker。**顺带把"这次唤醒是谁、因为哪条消息"这件事一并记了**，正是 Run 该记的。
- **R2：把 worker id 也注入 env**（如 `BYSPACE_WORKER_ID`）。改动最小，但它是**自报的**，daemon 只能选择相信；且它不解决"哪条消息唤醒了我"。

**建议 R1**：它同时是身份映射和唤醒记账，不需要第二个概念；R2 只补一半，还留下一个可伪造的洞。

另外两条实测到的行为，写下来免得以后当 bug 查：

- 一个 Project Administrator worker 被要求 `worker create` 时**自己拒了**，理由是角色边界与"无授权痕迹"。这是 skill/角色生效的证据，不是 daemon 拦的 —— **daemon 层面当时并没有拒绝**，因为那条命令根本没执行。**"worker 能否创建 worker"在权限层仍未被真实验证过。**
- 探针里模型把"照做并原样回报"识别为注入模式并拒绝。写 run prompt 时**不要用命令式措辞**要求 worker 执行 shell。

## 已交付并真机验证（2026-09-24）

一条人类消息进去，两条 worker 消息自己出来：

| seq | 发送者            | 策略       | 正文                                                                    |
| --- | ----------------- | ---------- | ----------------------------------------------------------------------- |
| 1   | Coord（人代发的） | wake       | Reply with exactly one word confirming you are awake.                   |
| 2   | Responder         | wake       | Awake.                                                                  |
| 3   | Coord             | store_only | Received — Responder is awake. No task pending on my side; standing by. |

**判据满足**：我只发了 seq 1，之后没有任何人参与，被点名的 worker 自己动起来并回复进组。三条 run 全部 `completed`，`unread` 归零，wake loop 总共只响应 3 次（1 次触发 + 2 次真实唤醒），不空转。

**顺带证伪了我自己上一次的误报**：现在从 agent 会话里直接跑 `worker message send` 会被 daemon 拒绝（`Session … is not a worker run`）。也就是说"我用 CLI 冒充 worker 验证 B 跑通"这条路已经被关掉 —— 那类误报的成因没了。真实操作者（无 `BYSPACE_AGENT_ID` 的环境）仍可代发。

## 闭环之后补的两道界（Owner 复核时指出）

真机跑通之后发现一个未闭合的风险：Responder 的回复用的是 `wake` 策略，它叫醒了 Coord。**两个 worker 可以互相无限唤醒**，而 e2e 之所以 3 条就停，是模型自己选了 `store_only`，不是机制拦住的。

上游有两道界，都已照搬：

1. **行为层** —— `protocol.md`："a wake alone creates none"、"Acknowledgements never restart work"、"lifecycle updates must not become attendance noise"。写进 wake 的 framing（`worker-wake-prompt.ts`）和 skill 两处。**放两处是刻意的**：skill 按需读取，而"要不要回话"正是在被唤醒那一刻决定，所以 framing 里必须有。
2. **结构层** —— 上游的 Goal **总是存在**（"When the runtime designates you to create a missing Goal"），预算因此天然给所有唤醒封顶。我们原本是 `if (goal && ...)`，**没有 goal 就没有界**。照上游做法：被唤醒的协调者在"确实有活要干"时被指派先建 goal。条件收成 `!hasGoal && isCoordinator && hasRequestedWork`，否则一句问话会被升级成一次规划任务。

## 顺手修掉的三个真缺陷（都是实测逼出来的）

- **`workerWakeLoop: false` 形同虚设**：我只挡住了 `start()` 里的定时器，但 `sendMessage → onWakeRequested → requestPass()` 会绕过 `start()` 直接驱动一趟 pass。改成**未启动的循环什么都不做**（`closed` 默认 true），并加了测试证明测试 daemon 不再花钱起真 agent。
- **`runPass()` 契约不完整**：它承诺"跑一趟"，却在别人正在跑时立刻返回。`start()` 的开箱 pass 因此会把后续的显式 pass 合并掉再提前返回 —— 我的 wake-loop 测试就是这么红的。改成等待**含自己被合并那一轮**的整趟排空。
- **`createBySpaceDaemon` 复杂度 21 超限**：我那个 `if` 是压垮它的最后一根。没有调阈值，而是把 runner + service + loop 抽成 `createWorkerSubsystem` 工厂（三者本就互相引用），巨函数里少了一个分支。**代价**：那两个 workspace helper 是 `createBySpaceDaemon` 里的闭包，工厂拿不到，只能作为参数注入。

## 判据

- 一条 `--mention` 出去之后，**没有人类参与**，被点名的 worker 自己动起来并回复到组里。这是"自协调"的最低可验形态，也是本 Epic 一直没真正交付的那件事。
- 一个 run 能说清：谁、因为哪些消息、跑了哪个 session、结果是什么。
- run 失败时它的 delivery 回到可重取状态，不会被静默丢掉。

## 验证

真实 daemon、真实两个 worker、真实一条唤醒；**发起方是 worker 而不是我**。加一条 e2e：send → 轮询到 run 出现 → run 结束 → 对端收到回复消息。
