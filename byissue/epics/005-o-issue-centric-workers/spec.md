---
kind: epic
title: "worker 域 v2：issue 为协作中心（multica 架构），秘书为常驻入口"
status: open
created: 2026-09-26
supersedes: byissue/epics/004-x-worker-domain/spec.md 的协作模型
---

# worker 域 v2：issue 为中心

> **读者：** 决定是否开工的人（Owner）。这是规格，不是任务清单：读完应知道新模型长什么样、旧模型的什么被替换、什么被继承、判据是什么。

## 结论先行

Epic 004 交付了"agent 成为长期实体并自协调"，但**协作空间选错了**：群聊里干活，工作记录与对话分离——群里说了的，issue/任务没记。multica（multica-ai/multica，Apache-2.0，Go+TS，49k★，一手源码已审）证明了正确轴心：

- **issue 是唯一协作空间**。需求、讨论、进度、结果都在 issue 上；agents 在 issue 评论区说话；工作天然被记录。
- **团队（squad）只是名单**。谁在组里、谁是 leader——不是聊天室。派给 squad 时 leader 先动，leader 决定分给谁。
- **秘书（mika 形态）是常驻入口**。老板对它说话，它拆解、分派、跟进、汇清单要审批。**它不产出需求文档**——写 PRD 是产品经理的活，秘书协调的是事务。

**执行底座不换。** multica 的会话痛点（打断丢上下文、续不上、卡死）正是我们复用 BySpace agent session 的强项；Epic 004 的身份/预算/守卫/记忆是 multica 没有的。**换的是组织轴，不是执行轴。**

## 旧模型的处置（逐条）

| Epic 004 已交付                                   | 处置             | 理由                                                                                                          |
| ------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| worker / 角色 / 工作区 / 记忆 / 守卫 / skill 落位 | **继承**         | 与组织轴正交，全部继续有效                                                                                    |
| 协调者拉人建组（squad=项目组，leader 先动）       | **继承并改名**   | 与 multica 的 squad 语义一致；"项目组"→ squad，协调者→ leader                                                 |
| `worker.message.*` 群聊、投递、inbox              | **退役（删除）** | 对话空间换成 issue 评论区；群聊与工作记录分离是本 epic 要消灭的缺陷。**不保留兼容**                           |
| 预算闸（turnLimit/估算上限）                      | **迁移**         | 闸住的是"唤醒烧钱"；issue 模型里等价物 = 每 issue 的 run 上限 + 名单规模上限。规则不变，载体搬家              |
| `worker_tasks`（一次性 title）                    | **替换为 issue** | issue = 描述+讨论+指派+状态+评论再触发；任务是 issue 的一次 run                                               |
| 提及唤醒                                          | **改造**         | @mention 出现在 issue 评论里：触发被点名 agent 的一次 run（不换 assignee，学 multica 的"handle one request"） |
| schedule→worker 触发                              | **继承**         | 等价 multica autopilot 的 schedule 面                                                                         |
| New task 表单 / 任务会话面                        | **改造**         | 表单建 issue；点开 issue 看时间线（会话 run + 评论流合一）                                                    |

## 新模型（照 multica，逐件）

### 1. Issue

- 字段：标题、描述、assignee（member/agent/squad）、状态（四类生命周期：unstarted/started/done/closed，内置状态固定）、评论区、创建者
- **评论区是唯一对话面**：老板、秘书、agents 都在评论里说话。agent 评论 = 一次 run 的产物（汇报、追问、blocker）
- @agent 评论 → 该 agent 的一次 run（读取 issue 上下文）；改 assignee 或状态进入 started → 触发 assignee 的 run
- issue 的每次触发 = 新 run；run 断了 issue 还在（打断/续跑走 BySpace session 既有能力）

### 2. Squad（原项目组）

- 一张名单：leader + members（agents），绑一个项目
- 派给 squad 的 issue → **leader 先动**：leader 判断拆不拆、分给谁（成员各自的 run），进度写回 issue
- 预算闸的新家：**每 issue 的 run 数上限**（默认按名单规模估算，可调）

### 3. 秘书（Mika 形态，Chief of Staff）

- **每工作区一个，内置**，随 daemon 创建（MikaSystemKey 形态：system key 标识身份、显示名可改、prompt 内嵌随版本更新）
- **唯一老板入口**：老板对它说任何话——它拆解成 N 件事、逐件开 issue、选路由（自己/某 agent/某 squad）、跟进、汇总
- **路由决策归它**（mika 原文："Never answer by naming the agent they should use…route it yourself"）：一轮能答的当场答；要工具/仓库/多轮/留痕的→开 issue；要人拍板的→**整理成一份清单**回来找老板
- **确认门槛**（照 mika 原文）：建 agent/squad/改配置前给预览要确认；涉及部署/花费/权限/敏感数据/破坏性操作前必须确认
- **禁区**（照 mika 原文）：聊天轮内不 checkout 仓库、不写代码、不产出交付物——开 issue 让 run 干

### 4. 人（老板）

- 只跟秘书对话 + 看 issue（自己的和被 @ 的）+ 处理秘书汇来的审批清单
- 看板/console：issue 列表（按状态分列）、点开看时间线

## 判据（可验的完成形态）

1. **一段话 → 多 issue**：老板对秘书说一段含 3 件事的话 → 秘书澄清关键分歧 → 开出 3 个 issue 并各自指派 → 回复路由摘要
2. **issue 即工作记录**：一个 squad issue 跑完 → issue 评论里能看到 leader 的拆解、每个成员的汇报、最终结果——**没有发生在群聊里的事**
3. **审批清单**：两件事需要老板拍板 → 秘书在对话里给一份含两个决定的清单 → 老板答复 → 秘书执行
4. **评论触发**：老板在 issue 里 @ 某 agent 提修改 → 该 agent 一次 run → 汇报写回评论
5. **打断安全**：issue 的一个 run 被打断 → issue 不丢、下一个触发继续（multica 做不到的）
6. **预算**：一个 issue 的 run 数到上限 → 新评论不再触发 run，秘书收到通知转告老板

## 范围外（明确不做）

- webhook/API 触发面（autpilot 的那两档）
- GitHub 集成（fork/PR 流）
- 跨 workspace/云同步；移动端
- QoderWake 参考线归档：talk 003 与 vision 里的"完全参考 QoderWake"条目改记为"协作模型已被 multica 模型取代，UI/角色/守卫等资产仍源于 QoderWake 收割"

## 工程切法（供排期，不是承诺）

1. **issue 模型 + 状态机**（SQLite，四类生命周期，单一转换入口——沿袭 worker_tasks 的教训）
2. **评论触发 + run 绑定**（@agent、assignee 变更；run 写回评论）
3. **秘书**（内置 agent、INSTRUCTIONS 照 mika 适配、CLI/skill 配套）
4. **squad 派发**（leader 先动；成员 run 写回）
5. **预算迁移 + 群聊退役**（删 `worker.message.*` 全链路；预算迁到 issue run 上限）
6. **console 改造**（issue 看板/详情；删群聊 UI）
