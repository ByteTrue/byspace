---
kind: issue
title: autopilot：声明式定时/手动触发器（秘书的例行巡查）
type: feature
status: closed
created: 2026-09-29
---

# autopilot：声明式定时/手动触发器（秘书的例行巡查）

> **读者：** 接手的人——autopilot 与 wakeup 的分工、源的两个执行模式、我们翻译到哪。

## 与 wakeup 的分工

wakeup（issue 003）是**事件驱动**：某个 issue 的状态/评论变化叫醒订阅者，粒度是"这一个 issue 发生了一件事"。autopilot 是**声明式的计划**：一个长期存在的定义（标题、assignee、执行模式、触发器），到点或手动触发时**自己造工作** —— `create_issue` 模式开一个新 issue（带模板标题）并指派，`run_only` 模式直接给 assignee 派 run。秘书的"每天早巡一遍所有在飞的 issue"是 autopilot（cron），不是 wakeup（没有单一 issue 的事件可订阅）。

## 源语义（`server/internal/service/autopilot.go` + `server/internal/scheduler/jobs_autopilot.go`）

- 触发器 kind：`schedule`（cron+timezone，next_run_at 推进）/ `webhook`（token+签名）/ `api`（手动）；
- 执行模式：`create_issue`（插值模板标题开 issue，指派 autopilot 的 assignee，run 挂到该 issue）/ `run_only`（不开 issue，直接 task）；
- 并发策略：`skip`（有在飞 run 就跳过本次）/ `queue` / `replace` —— 本形态先实现 skip 与 queue（replace 需要取消语义，记后续）；
- 调度：scheduler tick 找 due 的 schedule trigger（next_run_at <= now 且 enabled），dispatch 后推进 next_run_at 并记 last_fired_at；
- run 记录在 `autopilot_run`（status、task_id/issue_id 链接、失败原因）。

## 翻译决定

- tick 复用 subsystem 的定时器（与 wakeup tick 同一循环，独立 pass）；cron 解析复用 `schedule/cron.ts`；
- 入队复用 executor 的 task 队列（create_issue 先建 issue 再走 `#enqueueForIssueWrite` 的等价 store 路径：willEnqueueRun 判据不变）；
- webhook kind 不在本批（无 HTTP 端点面；表与校验在，行为后续）；
- replace 策略不在本批（取消语义未建）。

## 范围

- 包含：autopilot/trigger/run 三表的 store 读写；schedule+api 两种触发（webhook 登记可存但 dispatch 拒绝并报错）；create_issue 与 run_only 两模式；skip/queue 两策略；cron next_run 推进；RPC 4 对（list/create/run-now/list-runs）；CLI `autopilot ls/create/trigger/runs`；秘书 INSTRUCTIONS 增"例行巡查用 autopilot"一句。
- 不包含：webhook dispatch、replace 策略、autopilot UI、quota/通知。

## 影响面

- 必须改：store、subsystem tick、executor（run_only 派 task）、protocol、CLI、secretary 提示词。
- 需要验：cron 到期 dispatch（tick 真推进 next_run_at）；create_issue 开出带模板标题的 issue 且指派正确；run_only 不开 issue；skip 策略下有在飞 run 则不重派；run-now（api）立即触发；失败 run 记 autopilot_run 原因。
- 仍未知：无。

## 验证

- store/引擎单测：due 查询、推进、skip/queue、两模式、模板插值（{{date}} 等基本占位）。
- verifier 增补：create → trigger → run-now → runs 列表。
- 真机：给秘书建一条 every-minute 的 run_only autopilot，看它到点自跑并在 issue/评论留痕。

## 执行记录

- rows：三表行类型+mapper；`interpolateIssueTitle` 仅 {{date}}（源 SupportedIssueTitleTemplateVariables 同款，花括号内空白容忍，时区跟随 trigger）。
- store：create/get/list autopilot、trigger、run（含 getAutopilotRunForSlot —— 源唯一索引的读侧）、setAutopilotStatus（pause/enable/archive 一个写）、listDueAutopilotTriggers、advanceAutopilotTrigger、listInFlightAutopilotRuns、touchAutopilotLastRun；createTask 增 autopilotRunId 链接、issueId 可空（033 的另一半）。
- 引擎：dispatch 两模式（create_issue 开带模板标题的 issue 并走共享入队判据；run_only 派无 issue task）、skip/queue 两策略、三拒前置（非 active / webhook 无 HTTP 面 / skip 在飞）；tick 走 subsystem 同循环独立 pass，推进 next_run_at 且丢错过槽（源 CatchUpLatestOnly）；dispatch 抛错把 run 落 failed 释放 in-flight（否则 skip 策略永远沉默）。
- executor：run_only 分支（无 issue、brief=autopilot 描述、run 行而非评论是记录）+ settleLinkedRun（task 结局回写 run，源 SyncRunFromTask）；run_only 失败同样上 owner 收件箱。
- 033 翻译漂移修复：旧 033 只带了 ADD COLUMN 没带 issue_id DROP NOT NULL —— 新翻译改为 rebuild 携带完整 17 列；既有库（已应用旧 033）由 **551 修复迁移**按目标表自身 DDL 松约束（只动约束、全列保序、自身索引重建、幂等），不用手写列清单（rebuild 也学会接受 sqlite_master 的带引号表名）。终态快照与链测试同步。
- 面：4 对 RPC（list/create/trigger/runs）走 inbox/wakeup 同款前缀路由；CLI autopilot ls/create/trigger/runs；秘书 INSTRUCTIONS 增"例行巡查用 autopilot 而非堆 wakeup"。
- 执行开关：BYSPACE_MULTICA_EXECUTION=off 时 kick/定时器不跑 executor（verifier 置 off 并以"被触发的 task 仍在 queued"为断言，notes/004 纪律）。
- 验证：引擎 7 测（两模式/skip 记录/queue/paused/tick 推进/时区插值）；551 修复测（旧形状→松约束→全列保序→幂等）；verifier 37/37（含 skip 第二发与执行暗置两断言）；multica 域 14 文件 112 测 + surface 5 测。
- 真机（2026-09-29）：Minute patrol（cron 每分钟、run_only）到点自跑：run completed、task completed、result 是真 wc -l 读数（16 行）；next_run_at 推进、last_fired_at 落戳；随后 pause。无人叫它。
- 过程抓到的真缺陷（全部真机或测试暴露）：① 旧 033 漂移使 createTask 抛 NOT NULL；② dispatch 抛错不留痕 → run 卡 in-flight → skip 永久沉默；③ skip 插同槽行撞唯一索引（源语义是槽行复用，改 getAutopilotRunForSlot 复用）；④ tick 抛错不推进 → 同槽热重试。
- 后续补：pause/enable/archive 的 RPC+CLI 面（setAutopilotStatus 的暴露，真机验证时的 SQL 收尾改由该面完成）；webhook dispatch、replace 策略、autopilot UI 仍未做（issue 范围已记）。

## 关闭回写

- Epic spec 进度；parity-audit 欠账面 autopilot 行标记完成（webhook/replace/UI 除外）。
