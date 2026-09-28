---
kind: issue
title: wakeup 行为层：issue 状态变化自己叫醒订阅者
type: feature
status: closed
created: 2026-09-28
---

# wakeup 行为层：issue 状态变化自己叫醒订阅者

> **读者：** 接手的人——秘书"自主跟进"的机制基础是什么、源怎么做、我们怎么翻译、哪些语义一个字都不能丢。

## 目标

源的行为契约（`server/migrations/518`-`523` 存储函数 + `server/internal/service/issue_wakeup.go`）：agent（或 owner）在 issue 上**登记订阅**（kind: event/at/every/cron；mode: once/continuous；event_types 白名单；filter_agent/task），之后：

- **事件捕获**：issue 状态变化 / 新评论 / run 状态变化 发生时，事务内为每个匹配的 enabled 订阅写一条 receipt（`event_key` 幂等，`ON CONFLICT DO NOTHING`）；
- **派发**：有未处理 receipt 的订阅 → 为该 agent 建 run（context 带 `wakeup_id`），receipt 记 `task_id`/`processed_at`；
- **自触发守卫**：登记该订阅的 run 自己产生的事件**不**叫醒它（`source_task_id IS DISTINCT FROM p_task` + context wakeup_id 排除）—— 否则 run 一发评论就无限自循环；
- **关闭即停**：issue 进入 done/cancelled（或状态目录的 done/closed 类）→ 其订阅停用（`StopClosedIssueWakeups`）；
- **时间类**：at（一次性定点）/ every（间隔）/ cron（表达式+时区），`next_fire_at` 推进，Tick 驱动；
- **payload 克制**：只带引用与变更字段名，**不带评论正文/附件 URL/任意元数据**（源注释原话）。

这是秘书自主性的机制基础：它在关键 issue 上登记 `run.completed/run.failed` 订阅，状态一变就醒，自己决定"要老板决策的进汇报、其余自己安排"。没有它，秘书只能被人叫。

## 翻译决定（已在切片①记录，此处执行）

PG 存储函数与触发器 → **Node 触发引擎**：在我们的写路径（session handler 的 issue.status.update / comment.create、executor 的 task 状态移动）事务内调用 store 的 `captureWakeups(...)`，语义逐条对照 518/520 的函数体。Tick 由 subsystem 的定时器驱动（源是独立调度循环）。cron 解析复用仓库既有依赖（schedule 域同款），不引新依赖。

## 范围

- 包含：event/at/every/cron 四种 kind 的登记校验、捕获、receipt 幂等、派发（含自触发守卫与 closed 停）、RPC（wakeup.list/create/update）与 CLI（agent 自己登记的主路径）、秘书 INSTRUCTIONS 增"在关键 issue 登记跟进订阅"一句。
- 不包含：wakeup 的管理 UI（欠账面）、capacity 上限（源有 workspace 级上限；单用户形态先不设，记为后续）。

## 影响面

- 必须改：store（capture/dispatch/tick 查询）、session handler 写路径、executor、subsystem（tick）、protocol（3 对 RPC）、CLI、secretary 提示词。
- 需要验：事件叫醒（真机：run 完成 → 订阅者醒并评论）；自触发守卫（订阅者自己的 run 发评论不二次叫醒自己）；receipt 幂等（同 event_key 不重复派）；closed 停（issue done 后不再醒）；at/every/cron 各一例（tick 推进）。
- 仍未知：源 capacity 语义的细节（读 service 时确认是否影响单用户形态）。

## 验证

- store 单测：捕获匹配/过滤/自排除/幂等/closed 停/tick 推进。
- e2e verifier：登记 event 订阅 → 触发状态变化 → 订阅者出现 run。
- 真机：秘书登记订阅 → run 完成 → 秘书自醒并评论（无人叫它）。

## 执行记录

- 迁移 514（receipt 唯一索引）补译：切片①漏了源 514 的 UNIQUE（receipt 幂等的物理基础），本 issue 的前提；510/513 由 SQLite 主键等价，不译。
- store：`createWakeup`（校验 1..12000 字符、next_fire 计算）/ `captureWakeups`（518/520 函数体的 Node 翻译：closed 不捕、filter、自触发双守卫、ON CONFLICT 幂等）/ `listReadyWakeups`（event 有未处理 receipt 或时间到）/ `dispatchWakeup`（run 带 wakeup context、settle receipts、once/at 退役、every/cron 推进）/ `stopWakeupsForClosedIssue` / `purgeExpiredReceipts`（7 天）。
- 捕获挂载：`updateIssueStatus` 与 `updateIssue`（status 字段）共用 `#afterStatusWrite` —— verifier 首跑暴露 field 路径漏挂（状态变了订阅却聋），修在 store 内而非调用方。`createComment` 在 IMMEDIATE 事务内捕获；`updateTaskStatus` 捕获 `task.<status>`。
- executor：`readWakeupContext` + `[WAKEUP]` prompt（源 prompt.go 形态：触发报事实不报完成、可自查/disable 订阅）。
- RPC 3 对（list/create/disable）+ CLI `issue wakeup ls/create/disable`；create 带 `senderSessionId` 记登记来源（自触发守卫读回）。
- 秘书 INSTRUCTIONS 增一句：在关键 issue 登记 event 订阅自跟进、醒后自判、不再需要时退役。
- 验证：wakeup.test.ts 10 测（捕获匹配/自触发双守卫/幂等/closed 停/dispatch 身份/once 退役/every 推进/at 未到时不醒/receipt 过期清理）；verifier 28/28；multica 域 12 文件 99 测。
- 真机闭环（2026-09-28）：owner 给 #2 登记 Chief of Staff 的 `task.completed` 连续订阅 → Writer 被 mention 触发 run → run 完成 → tick 派 wakeup run → 秘书自醒核对 README、确认符合、另发现早前内容被后续 run 重写并明确"留给老板决定"、订阅保持。**无人叫它**。
- 偏差：源 capacity 上限未实现（单用户形态先不设，issue 已记）。

## 关闭回写

- Epic spec 进度；parity-audit 欠账面的 wakeup 行标记完成。
