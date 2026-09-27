# 复刻对照审计（2026-09-28）

multica（`~/workspace/refs/multica` @ `04cdd48`，一手读码）与本工程 `packages/server/src/server/multica/` + `packages/app/src/multica/` + CLI 的一对一对照。目的：看清抄到了哪、抄歪了哪、还差哪。

记号：✅ 已对齐 · ⚠️ 部分（能用但比源窄）· ❌ 未做 · 🔀 偏离（有理由，需 Owner 知晓或已批准）

## A. Schema（源 577 迁移 → 我们 76 翻译）

| 对象                                                                                                                                                                   | 源        | 我们                                         | 状态                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------- | ------------------------ |
| 28 表基线（agent/issue/issue_status/comment/queue/inbox/activity/subscriber/squad×2/autopilot×3/wakeup×2/skill×3/project/label×3/dependency/property×2/supplement×2…） | PG        | SQLite 76 迁移逐条翻译，终态快照测试逐列对齐 | ✅                       |
| `task_message`（run 流式进度消息）                                                                                                                                     | 有（026） | **基线文档列了，迁移从未建**（活库无此表）   | ⚠️ 文档与实现漂移，见 F1 |
| 多租户圈（workspace/user/member/auth/billing…）                                                                                                                        | 有        | 砍（Owner 批准）                             | 🔀                       |
| IM/GitHub/插件/云计量圈                                                                                                                                                | 有        | 砍（Owner 批准）                             | 🔀                       |
| PG 存储函数（settle 触发、wakeup 捕获）                                                                                                                                | 函数      | 归类为行为层（切片④），未实现                | ❌ 行为见 C              |

## B. 触发引擎（"谁该被叫醒"）

| 规则                                                         | 源                 | 我们                                                     | 状态           |
| ------------------------------------------------------------ | ------------------ | -------------------------------------------------------- | -------------- |
| 单一判定谓词（backlog 停车场 / squad→leader / pending 去重） | 分散但语义固定     | `WillEnqueueRun` 单一函数                                | ✅             |
| 评论 mention 触发（显式 @ 赢 @all；作者不隐式路由）          | 有                 | 同                                                       | ✅             |
| assign/status 变更触发（离开 backlog 才唤醒）                | 有                 | `#enqueueForIssueWrite`，create/update/status 三入口共用 | ✅             |
| 评论作者身份解析（run 的评论归 agent）                       | run token          | 见 D1 —— **RPC/CLI 评论硬编码 owner**                    | ⚠️ 抄歪，见 F2 |
| 全角标点后的 mention（中文高频形态）                         | 源无此问题（英文） | 修过（边界=非名字字符）                                  | ✅ 超出源      |

## C. 执行器（run）

| 环节                                                  | 源                   | 我们                                            | 状态                                  |
| ----------------------------------------------------- | -------------------- | ----------------------------------------------- | ------------------------------------- |
| 领取：原子 claim（PG SKIP LOCKED，多 daemon）         | DB 级                | in-process Set + status 守卫（单 daemon 形态）  | 🔀 形态偏离，单 daemon 下等价，见 F3  |
| 一 agent 一并发                                       | max_concurrent_tasks | 同（=1）                                        | ✅                                    |
| 执行：agent-manager seam（createAgent+runAgent+wait） | 本地 CLI 子进程      | 进程内会话                                      | 🔀 Owner 批准（不局限 pi 的高级抽象） |
| 产物回写：评论 + source_task_id                       | 有                   | 同                                              | ✅                                    |
| run 携带 agent.instructions                           | 有                   | 本轮补上（此前 run 是无角色提示词的失忆执行者） | ✅（新）                              |
| 流式进度（task_message）                              | 有                   | 无（表都没建）                                  | ❌ 连带 F1                            |
| 失败重试（attempt/max_attempts）                      | 有                   | 列在，行为未接                                  | ⚠️                                    |

## D. 身份与归属

| 事实                                        | 源        | 我们                                               | 状态           |
| ------------------------------------------- | --------- | -------------------------------------------------- | -------------- |
| run 的身份（daemon 反解 session→run→agent） | run token | **列在（session_id）但 executor 从未写、也无反解** | ⚠️ 见 F2       |
| 人类评论归 owner                            | 有        | handler 硬编码 owner                               | ✅（人类侧对） |
| agent 经 CLI 评论归自己                     | 有        | **归 owner**（RPC 无作者字段、CLI 不传身份）       | ⚠️ 抄歪，F2    |
| 秘书=内置 agent（system key + 预设提示词）  | mika      | 同（secretary.ts）                                 | ✅             |

## E. RPC / CLI 操作面

| 面                                                     | 源        | 我们                                             | 状态                                                |
| ------------------------------------------------------ | --------- | ------------------------------------------------ | --------------------------------------------------- |
| issue 读/写/状态                                       | REST      | 6 对 RPC（list/get/create/update/status.update） | ✅（update 与 status.update 语义重叠，见 F4）       |
| comment 读/写                                          | REST      | 2 对                                             | ⚠️ 写缺身份（F2）                                   |
| agent 读/写                                            | REST      | 2 对（list 含 includeSystem/includeArchived）    | ✅                                                  |
| squad 读/写                                            | REST      | 2 对（create 带 roster）                         | ⚠️ 无 update/archive                                |
| task 读                                                | REST      | 2 对（list/running.list）                        | ✅                                                  |
| status 目录                                            | REST      | 1 对                                             | ✅                                                  |
| wakeup 注册/查询（agent 自登记事件唤醒）               | REST+CLI  | **0**（表在，行为无）                            | ❌                                                  |
| autopilot（schedule/webhook/api 触发器）               | REST+CLI  | **0**（3 表在，行为无）                          | ❌                                                  |
| inbox（给人看的待办箱）                                | REST+页面 | **0**（表在）                                    | ❌                                                  |
| CLI：issue ls/create、agent ls/create、comment ls/send | 全命令面  | 6 子命令                                         | ⚠️ 缺 issue update/status、squad、wakeup、autopilot |

## F. UI / UX（对照官方截图）

| 面                                                          | 源             | 我们                                               | 状态             |
| ----------------------------------------------------------- | -------------- | -------------------------------------------------- | ---------------- |
| 看板：状态列+卡片+计数+Working 徽章+顶部 working 汇总       | 有             | 有（徽章按 running task 的 issue 键）              | ✅               |
| 看板：拖拽换列 / 列表视图 / Filter / Display / 泳道         | 有             | 无                                                 | ❌               |
| issue 详情：面包屑+标题+Markdown 描述+评论流+composer       | 有             | 有（Markdown 走仓库 renderer）                     | ✅               |
| issue 详情：Execution log + Token usage 面板                | 有             | 无（依赖 task_message/token 列，连带 F1）          | ❌               |
| issue 详情：Properties 折叠组+状态下拉+assignee 头像名      | 有             | 有                                                 | ✅               |
| 子 issue / subscriber / reactions / 附件                    | 有             | 表在，UI 无                                        | ❌               |
| chat 面（Daily Tasks 助手）                                 | 有             | **不做**（Owner：体验差；对话留在 workspace 会话） | 🔀 已批准        |
| agents/squads/autopilots/skills/runtimes/inbox/my-issues 页 | 有             | 无（仅 board+detail 两面）                         | ❌               |
| 秘书入口                                                    | chat 里的 mika | 看板药丸 → **常驻 workspace**（普通会话 UI）       | 🔀 本轮改，见 F5 |

## G. 秘书（Chief of Staff）

| 环节                                        | 源（mika） | 我们                                              | 状态      |
| ------------------------------------------- | ---------- | ------------------------------------------------- | --------- |
| 内置 agent + 预设 INSTRUCTIONS              | 有         | 有（工作模型五条全文）                            | ✅        |
| 对话面                                      | 产品 chat  | workspace 会话（composer/新聊天/Terminal 全复用） | 🔀 已批准 |
| 会话携带角色提示词                          | 有         | 本轮补（workspace 内新建会话注入 instructions）   | ✅（新）  |
| 自主跟进（自登记 wakeup：run.completed 等） | 有         | **无**（wakeup 行为层未建）                       | ❌ 见 E   |
| 通过 CLI 操作域                             | 有         | 有（instructions 指向 CLI）                       | ✅        |

## 抄歪清单（按严重度）

1. **F2 run 身份链整体缺失**（C/D/E）：executor 不写 `queue.session_id`，故 daemon 无法把任意会话反解为 run/agent；连带 `comment.create` 无作者字段、CLI 不传身份、handler 硬编码 owner —— agent 说的话在记录里读作 owner 说的。源里 run 的每句话都归它自己，issue 的记录才读得懂"谁说的"。修法有现成模式：worker 域的 `attachRunSession` + `resolveSenderFromRun` —— executor 建会话后写 session_id；CLI 传 `BYSPACE_AGENT_ID`；handler 反解并拒绝自报与反解不一致。**这是记录层的正确性问题，不是装饰。**
2. **F1 task_message 漂移**：基线文档列了 28 表含 task_message，迁移从未建。要么翻译（连带流式进度+Execution log 面板），要么从基线正式砍掉并记理由。现状是文档说谎。
3. **F3 claim 并发**：in-process Set 在单 daemon 下等价于 SKIP LOCKED，但"等价"依赖"永远单 daemon"这个前提未被记录。补一句约束即可。
4. **F4 状态双入口**：`issue.update`（带 status 字段）与 `issue.status.update` 都做乐观并发+触发入队。源只有一个 update 面。留着是兼容我们的 UI 快捷下拉，但两个入口的触发语义要永远一致 —— 值得一个共用私有方法（现在恰好共用 `#enqueueForIssueWrite`，风险已控）。
5. **F5 秘书入口形态**：从 Office issue 改为常驻 workspace（本轮）。与源的最大 UI 偏离，Owner 批准；代价是源的"chat 内 mika"体验我们没有对应物 —— 用 workspace 会话替代，功能等价、UI 零新增。

## 未做但源有（不是歪，是欠）

wakeup 行为层、autopilot、inbox、activity_log 写入、task_supplement、重试行为、拖拽/列表视图/筛选、Execution log/Token 面板、子 issue/subscriber/reactions/附件 UI、agents 等管理页。全部有表无行为或有 RPC 无 UI —— 切片④⑤⑥之后的增量面。
