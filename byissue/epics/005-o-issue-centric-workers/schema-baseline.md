# multica schema 复刻基线（Epic 005 第①片）

> **读者：** 把 multica 的 PostgreSQL schema 翻译成 Node+SQLite 的人。源：~/workspace/refs/multica/server/migrations（577 个 up 迁移，commit 04cdd48）。本文是冻结的对照基线，不是设计——所有结构决定以 multica 为准，翻译规则见文末。

## 复刻表清单（28 张，按依赖序）

### 工作域核心

| 表                      | 首见迁移 | 内容要点                                                                                                                                 | 后续关键演化                                                                                              |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| agent                   | 001      | ~26 字段：runtime/local                                                                                                                  | cloud、visibility、status(idle/working/blocked/error/offline)、max_concurrent_tasks、avatar、instructions | 002 agent_config；后续 mcp/plugin 关联表挂靠 |
| issue                   | 001      | title/description/status/priority/assignee(member\|agent，084 加 squad)/creator/parent/acceptance_criteria(JSONB)/position(看板排序)/due | 020 issue_number；332 状态改四类；007 删 repository                                                       |
| issue_status            | 332      | 四类状态目录（category: unstarted/started/done/closed + 内置锁定 + 自定义）                                                              | 是"四类生命周期"的载体表                                                                                  |
| comment                 | 001      | author(member\|agent)/content/type(comment\|status_change\|progress_update\|system)                                                      | 017 comment_parent_id（线程回复）                                                                         |
| agent_task_queue（run） | 001      | agent_id/issue_id/status(queued\|dispatched\|running\|completed\|failed\|cancelled)/priority/result(JSONB)/error                         | 090 is_leader_task；127 squad_id；549 task_supplement 关联                                                |
| task_message            | 026      | run 执行中产出的进度消息（区别于 comment）                                                                                               |                                                                                                           |
| inbox_item              | 001      | recipient/severity(action_required\|attention\|info)/issue_id/title/body/read/archived                                                   |                                                                                                           |
| activity_log            | 001      | 全域审计流                                                                                                                               |                                                                                                           |
| issue_subscriber        | 015      | issue 关注者                                                                                                                             |                                                                                                           |

### 组织

| 表           | 首见 | 要点                                                                    |
| ------------ | ---- | ----------------------------------------------------------------------- |
| squad        | 084  | name/description/leader_id(→agent)/creator                              |
| squad_member | 084  | member_type(agent\|member)/member_id/role —— **纯名单，无任何消息语义** |

### 自动化

| 表                   | 首见 | 要点                                                                                                                                    |
| -------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| autopilot            | 042  | title/description/assignee(096 起 member\|agent\|squad)/execution_mode(create_issue\|run_only)/concurrency_policy(skip\|queue\|replace) |
| autopilot_trigger    | 042  | kind(schedule\|webhook\|api)/cron/timezone/webhook_token —— webhook/api 属范围外，schema 仍建（1:1）                                    |
| autopilot_run        | 042  | 触发记录 + squad_id 归因                                                                                                                |
| issue_wakeup         | 509  | issue_id/agent_id/kind(at\|every\|cron\|event)/event(task.completed…)/instruction/mode(once\|continuous) —— 秘书自驱的基础              |
| issue_wakeup_receipt | 509  | 事件送达回执（防重复触发）                                                                                                              |

### 项目/资源

| 表                                | 首见    | 要点                                           |
| --------------------------------- | ------- | ---------------------------------------------- |
| project                           | 034     | 多 issue 共享一个产出时绑仓库与上下文          |
| project_resource                  | 065     | 项目的资源（仓库/文档）绑定                    |
| skill / skill_file / agent_skill  | 008     | 结构化技能：仓库级定义 + 版本文件 + agent 挂载 |
| attachment                        | 029     | 评论/issue 附件                                |
| issue_label / issue_to_label      | 001     | 标签                                           |
| issue_dependency                  | 001     | blocks/blocked_by/related                      |
| issue_reaction / comment_reaction | 026/027 | 表态                                           |
| task_usage                        | 032     | run 用量记账（032 起，101 小时化）             |

## 砍除清单（多租户/云圈，Owner 批准）

user、workspace、member、verification*code、personal_access_token、daemon_token、workspace_invitation、seat_capacity_outbox、contact_sales_inquiry、feedback（云端）、notification_preference、workspace_share_link、workspace_mcp_server、instance_telemetry_state、lark*\_/dingtalk\__/channel*\*（IM 渠道圈）、github*_（6 张，范围外）、cloudruntime 依赖表、plugin\_\_（10 张，范围外后置）、billing/usage 聚合表族（task_usage_daily/hourly/dashboard/rollup/dirty —— 云端计量，本地无意义）。

**砍除的连带处理**：所有表的 workspace_id 列删；user/member 引用（creator_id/assignee member 型）收窄为"单用户=daemon 属主"常量或删列；agent.runtime_mode 只留 local。

## SQLite 翻译规则（机械对照）

| PG                                  | → SQLite（node:sqlite）                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| UUID PK `gen_random_uuid()`         | TEXT PK，Node crypto.randomUUID()                            |
| TIMESTAMPTZ                         | TEXT ISO-8601                                                |
| JSONB                               | TEXT（读侧 Zod 解析）                                        |
| `FOR UPDATE SKIP LOCKED`（claim）   | `BEGIN IMMEDIATE` 事务内 SELECT…UPDATE（同语义：认领即独占） |
| pg_bgm 全文索引                     | FTS5（032 的 issue 搜索后置到需要时）                        |
| pg_cron                             | 进程内调度器（既有 scheduler 形态）                          |
| CHECK 约束                          | 保留（SQLite 支持）                                          |
| FLOAT position                      | REAL 保留                                                    |
| ON DELETE CASCADE/SET NULL/RESTRICT | 保留（SQLite 支持，需 PRAGMA foreign_keys=ON）               |

## 迁移策略

**按 multica 迁移序逐个翻译**（001→577 里命中复刻表/列变更的那些，~90 个文件），不按最终快照一次性重写 —— 保复刻保真度，且每个迁移的语义（含其注释里的契约）能被对照审阅。Node 侧建迁移 runner（版本表+逐个 apply），与 multica 的 go migrate 对应。

## 第①片完成判据

- [x] 复刻表清单冻结（本文档）
- [ ] 迁移 runner + 001_init 的 SQLite 翻译跑通（含 user/workspace/member 砍除后的连带删列）
- [ ] 001 翻译与源逐表对照审阅（字段名/类型/约束一致，翻译仅限规则表）
