---
kind: epic
title: "worker 域 v2：复刻 multica —— issue 中心、秘书常驻、事件驱动跟进"
status: open
created: 2026-09-26
supersedes: byissue/epics/004-x-worker-domain/spec.md 的协作模型
---

# worker 域 v2：复刻 multica

> **读者：** 决定是否开工的人（Owner），以及第一个动手实现的人。这是复刻规格：以 multica（multica-ai/multica，Apache-2.0，一手源码在 /tmp/multica-ref，参考用后归档到 ~/workspace/refs/）为准绳，**不再参考 QoderWake 的架构**。

## 结论先行

Owner 决定（2026-09-26）：**架构上直接复刻 multica。** Epic 004 当作练手 —— 它验证了执行底座（worker=长期 agent、pi session 复用、守卫、记忆），但它的协作模型（群聊中心）整个让位。

**从 QoderWake 保留的只有资产**：8 个角色模板（IDENTITY/BIBLE/PERSONA + 各自技能）。这些是提示词产物，与架构无关，直接搬进新模型当 agent 的"角色包"。

**Epic 004 的东西分三类**：

1. **复用**（架构正交，重命名后继续）：worker→agent、角色模板、workspace/记忆/守卫/skill 落位、pi session 执行链、schedule 触发
2. **删除**（群聊中心的一切）：`worker.message.*` 全链路、inbox 投递、goal/预算闸载体 —— 预算思想迁移到 issue run 上限，但 goal/wake 机制不复刻
3. **练手价值**：状态机单一入口、404 语义身份门、事务认领 —— 这些**教训**带进 v2，代码不搬

## 复刻目标（multica 的架构，逐件）

### 数据模型（照 001_init + 后续迁移）

```
agent:        name, runtime(pi), visibility, status(idle/working/blocked/error/offline),
              max_concurrent_tasks(=1，一 worker 一并发不变)
issue:        title, description, status(四类), priority, assignee(member|agent|squad),
              creator, parent_issue, acceptance_criteria, position(看板排序)
issue_status: 四类生命周期 — unstarted(backlog|todo) / started(in_progress|in_review|blocked)
              / done / closed(cancelled)；状态目录表，内置状态锁定
comment:      issue_id, author(member|agent), content, type(comment|status_change|
              progress_update|system)
inbox_item:   recipient, type, severity(action_required|attention|info), issue, title, body
              ← 秘书的"要老板拍板的清单"就住这里
agent_task_queue (run): agent_id, issue_id, status(queued|dispatched|running|completed|
              failed|cancelled), result, error ← 每 issue 触发一次 = 一行
squad:        name, leader_id, members(agent|member)
issue_wakeup: 挂在 issue 上，agent 自己注册 —— kind(event|at|every|cron),
              event(task.completed/failed/cancelled), instruction
```

### 触发规则（multica 原文语义）

- **assign 即触发**：issue 指派给 agent/squad（或状态进入 started）→ assignee 的 run 入队；squad 则 leader 先动
- **@mention 即一次 run**：评论里 @agent → 该 agent 一次 run（读 issue 全上下文，不换 assignee）
- **wakeup 即自驱**：agent 给 issue 挂事件/定时唤醒（如 task.completed），事件到 → 注册者新 run —— **这是秘书自主跟进的机制**
- run 的产物写回 issue：进度=progress_update 评论、结果=评论、状态变化=status_change 评论

### 秘书（Mika 形态，Chief of Staff）

- **每 daemon 一个，内置**（MikaSystemKey：system key 标识、显示名可改、prompt 内嵌随版本更新、workspace notes 可追加）
- 工作模型照 mika INSTRUCTIONS（已全文审）：
  - "A member brings you a goal, not a routing decision" —— 自己路由，绝不把活推回给老板
  - 一轮能答的当场答；要工具/仓库/多轮/留痕的开 issue
  - 路由到最小够用者：自己 / 某 agent / 新专家 / squad（经 leader）/ autopilot
  - 聊天轮内不 checkout、不写码、不产出交付物
  - 建 agent/squad/改配置前给预览要确认；部署/花费/权限/敏感/破坏性前必须确认
- **自主跟进（Owner 补充的关键能力）**：秘书给关键 issue 挂 event wakeup（run.completed/failed）。issue 一到新状态它自己醒：
  - 需要老板决策的 → 写 inbox_item(action_required) 并在对话里汇报
  - 不需要的 → 自己继续：评论、改状态、再指派、催办
  - **不是被动客服，是事件驱动的参谋长**

### 人（老板）

- 与秘书对话（唯一发起口）+ 看 issue + 处理 inbox 的 action_required
- console：issue 看板（四类分列）+ issue 详情（时间线 = 评论 + run 记录 + 状态变化合一）

## 与 multica 的刻意差异（及理由）

| 差异                                                      | 理由                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 执行=daemon 内 pi session（无 run queue 轮询/云端 claim） | multica 的会话痛点（打断丢上下文/续不上/卡死）正是其 daemon-claim 架构的；BySpace session 久经考验。run 仍是 agent_task_queue 一行（记账/上限用），只是执行不离开 daemon |
| 无 workspace 多租户/云                                    | 单用户本地 daemon 是 BySpace 的形态；表结构去掉 workspace 维度                                                                                                           |
| 角色=模板收割的 8 个 + 秘书                               | mika 的能力面照抄，角色资产来自 QoderWake 收割                                                                                                                           |
| 预算=issue 的 run 上限（按 squad 名单估算）               | 闸住"烧钱 run"的思想延续；goal/turnLimit 机制不搬                                                                                                                        |

## 判据

1. **一段话 → 多 issue**：老板对秘书说 3 件事 → 澄清 → 3 个 issue 各自指派 → 路由摘要
2. **issue 即完整记录**：squad issue 完成后，评论里有 leader 拆解 + 成员汇报 + 结果；**没有任何工作发生在 issue 之外**
3. **审批清单**：两件事要拍板 → inbox 两个 action_required + 对话里一份清单 → 答复后执行
4. **评论触发**：@agent 提修改 → 一次 run → 汇报进评论
5. **自主跟进**：某 issue 的 run failed → 秘书自己醒 → 判断不需要老板 → 自己评论/重派 —— **老板全程未被通知**（对比：另一个需要决策的 issue，秘书主动汇报）
6. **打断安全**：run 被打断 → issue 不丢、状态不烂、再触发可继续
7. **run 上限**：一个 issue 的 run 到上限 → 新评论不再入队 → 秘书收到 inbox 通知

## 工程切法

1. **issue/comment/run 数据层 + 状态机**（四类、单一转换入口、append-only 历史）
2. **触发引擎**（assign/状态/@mention → run 入队；run 产物写回评论；run 执行绑 pi session）
3. **秘书**（内置 agent + mika INSTRUCTIONS 适配 + inbox 产出 + 对话入口）
4. **wakeup**（event/at/every/cron 四 kind；秘书的自主跟进建立在它上面）
5. **squad 派发**（leader 先动；成员 run 各自写回）
6. **inbox + console**（action_required 清单面、issue 看板/详情、删群聊 UI）
7. **退役**（删 `worker.message.*`/goal/inbox-delivery 全链路 + 旧 UI；worker→agent 域重命名收尾）

## 范围外

webhook/API 触发、GitHub fork/PR 流、云/多租户、移动端、multica 的 board 视图高级功能（swimlane/保存视图）
