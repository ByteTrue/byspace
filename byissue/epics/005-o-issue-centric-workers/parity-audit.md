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

| 规则                                                          | 源                 | 我们                                                                                              | 状态           |
| ------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------- | -------------- |
| 单一判定谓词（backlog 停车场 / squad→leader / pending 去重）  | 分散但语义固定     | `WillEnqueueRun` 单一函数                                                                         | ✅             |
| 评论 mention 触发（markup 语法；显式赢 @all；作者不隐式路由） | 有                 | markup+裸名别名（020）+CLI --mention+composer @ 菜单（023，尾触发 v1）；光标中间触发/键盘导航欠账 | ⚠️             |
| assign/status 变更触发（离开 backlog 才唤醒）                 | 有                 | `#enqueueForIssueWrite`，create/update/status 三入口共用                                          | ✅             |
| 评论作者身份解析（run 的评论归 agent）                        | run token          | 见 D1 —— **RPC/CLI 评论硬编码 owner**                                                             | ⚠️ 抄歪，见 F2 |
| 全角标点后的 mention（中文高频形态）                          | 源无此问题（英文） | 修过（边界=非名字字符）                                                                           | ✅ 超出源      |

## C. 执行器（run）

| 环节                                                  | 源                   | 我们                                               | 状态                                  |
| ----------------------------------------------------- | -------------------- | -------------------------------------------------- | ------------------------------------- |
| 领取：原子 claim（PG SKIP LOCKED，多 daemon）         | DB 级                | in-process Set + status 守卫（单 daemon 形态）     | 🔀 形态偏离，单 daemon 下等价，见 F3  |
| 一 agent 一并发                                       | max_concurrent_tasks | 同（=1）                                           | ✅                                    |
| 执行：agent-manager seam（createAgent+runAgent+wait） | 本地 CLI 子进程      | 进程内会话                                         | 🔀 Owner 批准（不局限 pi 的高级抽象） |
| 产物回写：评论 + source_task_id                       | 有                   | 同                                                 | ✅                                    |
| run 携带 agent.instructions                           | 有                   | 本轮补上（此前 run 是无角色提示词的失忆执行者）    | ✅（新）                              |
| 流式进度（task_message）                              | 有                   | 无（表都没建）                                     | ❌ 连带 F1                            |
| 失败重试（attempt/max_attempts）                      | 有                   | 启动期失败谱系（issue 010）；延后/理由码抬高顶欠账 | ⚠️                                    |

## D. 身份与归属

| 事实                                        | 源        | 我们                                               | 状态           |
| ------------------------------------------- | --------- | -------------------------------------------------- | -------------- |
| run 的身份（daemon 反解 session→run→agent） | run token | **列在（session_id）但 executor 从未写、也无反解** | ⚠️ 见 F2       |
| 人类评论归 owner                            | 有        | handler 硬编码 owner                               | ✅（人类侧对） |
| agent 经 CLI 评论归自己                     | 有        | **归 owner**（RPC 无作者字段、CLI 不传身份）       | ⚠️ 抄歪，F2    |
| 秘书=内置 agent（system key + 预设提示词）  | mika      | 同（secretary.ts）                                 | ✅             |

## E. RPC / CLI 操作面

| 面                                                              | 源        | 我们                                                                                                                                      | 状态                                          |
| --------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| issue 读/写/状态                                                | REST      | 6 对 RPC（list/get/create/update/status.update）                                                                                          | ✅（update 与 status.update 语义重叠，见 F4） |
| comment 读/写                                                   | REST      | 2 对                                                                                                                                      | ⚠️ 写缺身份（F2）                             |
| agent 读/写                                                     | REST      | 2 对（list 含 includeSystem/includeArchived）                                                                                             | ✅                                            |
| squad 读/写                                                     | REST      | 2 对（create 带 roster）                                                                                                                  | ⚠️ 无 update/archive                          |
| task 读                                                         | REST      | 2 对（list/running.list）                                                                                                                 | ✅                                            |
| status 目录                                                     | REST      | 1 对                                                                                                                                      | ✅                                            |
| wakeup registration/lookup (agent self-registers event wakeups) | REST+CLI  | behavior layer fully built (capture/tick/dispatch/receipt, issue 003) + CLI three verbs                                                   | ✅                                            |
| autopilot（schedule/webhook/api 触发器）                        | REST+CLI  | schedule+api 两触发、两模式、skip/queue、run 审计、CLI 七动词、管理 UI（issue 006/011）、archived 退出默认面（022）；webhook/replace 欠账 | ⚠️                                            |
| inbox（给人看的待办箱）                                         | REST+页面 | 后端 5 对 RPC + CLI 五动词 + owner UI 面（issue 004/005）                                                                                 | ✅                                            |
| CLI：issue ls/create、agent ls/create、comment ls/send          | 全命令面  | issue 六动词（含 update/status/timeline/wakeup 三）、squad 四动词、autopilot 七、inbox 五（issue 014）                                    | ⚠️ 余 label/attachment 面                     |

## F. UI / UX（对照官方截图）

| 面                                                     | 源             | 我们                                                                                                                               | 状态             |
| ------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 看板：状态列+卡片+计数+Working 徽章+顶部 working 汇总  | 有             | 有（徽章按 running task 的 issue 键）                                                                                              | ✅               |
| 看板：拖拽换列 / 列表视图 / Filter / Display / 泳道    | 有             | 拖拽（status+assignee 两轴）+列表+chips 过滤+Display 两态（issue 007/012）；泳道行轴与 project 轴欠账                              | ⚠️               |
| issue 详情：面包屑+标题+Markdown 描述+评论流+composer  | 有             | 有（Markdown 走仓库 renderer）                                                                                                     | ✅               |
| issue 详情：Execution log + Token usage 面板           | 有             | Execution log 有（issue 009，读 queue 行）；Token 面板欠账（无计量面）                                                             | ⚠️               |
| issue 详情：Properties 折叠组+状态下拉+assignee 头像名 | 有             | 有                                                                                                                                 | ✅               |
| 子 issue / subscriber / reactions / 附件               | 有             | 子 issue 读+创建面（013/016）+ subscriber 全写读面（013）+ 评论 reactions（015）；issue_reaction/附件（需存储基础设施，defer）仍欠 | ⚠️               |
| chat 面（Daily Tasks 助手）                            | 有             | **不做**（Owner：体验差；对话留在 workspace 会话）                                                                                 | 🔀 已批准        |
| agents/squads/autopilots/skills/runtimes/my-issues 页  | 有             | rosters+agent 详情+squad 详情（008）+my-issues 三 scope 页（018）；skills/runtimes 页欠账（表无行为）                              | ⚠️               |
| 秘书入口                                               | chat 里的 mika | 看板药丸 → **常驻 workspace**（普通会话 UI）                                                                                       | 🔀 本轮改，见 F5 |

## G. 秘书（Chief of Staff）

| 环节                                                              | 源（mika）    | 我们                                                                          | 状态      |
| ----------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- | --------- |
| 内置 agent + 预设 INSTRUCTIONS                                    | 有            | 有（工作模型五条全文）                                                        | ✅        |
| 对话面                                                            | 产品 chat     | workspace 会话（composer/新聊天/Terminal 全复用）                             | 🔀 已批准 |
| 会话携带角色提示词                                                | 有            | 本轮补（workspace 内新建会话注入 instructions）                               | ✅（新）  |
| autonomous follow-up (self-registers wakeups: run.completed etc.) | present       | present (wakeup behavior layer + real-machine self-wake loop, issues 003/019) | ✅        |
| 通过 CLI 操作域                                                   | 有            | 有（instructions 指向 CLI）                                                   | ✅        |
| identity boundary on the owner queue (inbox member-surface only)  | requireUserID | owner-only gate (issue 021, before/after on real machine)                     | ✅        |

## 抄歪清单（按严重度）

1. **F2 run 身份链整体缺失**（C/D/E）：已修（Epic Issue 001）。executor 写 session_id；`comment.create` 带 `senderSessionId`；handler 反解 run 归 agent，无字段归 owner，陌生会话拒绝；CLI 从 `BYSPACE_AGENT_ID` 发送身份。
2. **F1 task_message 漂移**：已裁决砍除，基线改 27 表并记理由（Epic Issue 002）。
3. **F3 claim 并发**：in-process Set 在单 daemon 下等价于 SKIP LOCKED，但"等价"依赖"永远单 daemon"这个前提未被记录。补一句约束即可。
4. **F4 状态双入口**：`issue.update`（带 status 字段）与 `issue.status.update` 都做乐观并发+触发入队。源只有一个 update 面。留着是兼容我们的 UI 快捷下拉，但两个入口的触发语义要永远一致 —— 值得一个共用私有方法（现在恰好共用 `#enqueueForIssueWrite`，风险已控）。
5. **F5 秘书入口形态**：从 Office issue 改为常驻 workspace（本轮）。与源的最大 UI 偏离，Owner 批准；代价是源的"chat 内 mika"体验我们没有对应物 —— 用 workspace 会话替代，功能等价、UI 零新增。

## 未做但源有（不是歪，是欠）

autopilot 的 webhook/replace/UI、task_supplement（defer，理由见 issue 010）、重试的延后与理由码抬高顶、泳道行轴与 project 轴、Token 面板、子树退订、issue_reaction/附件（存储基础设施 defer）、label 管理页、agents 的配置 tabs/skills/runtimes/my-issues 页。全部有表无行为或有 RPC 无 UI —— 切片④⑤⑥之后的增量面。
