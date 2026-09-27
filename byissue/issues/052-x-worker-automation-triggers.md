---
kind: issue
title: "worker 自动化触发：schedule 到点给 worker 派任务"
type: feature
status: closed
created: 2026-09-26
related_issue: byissue/epics/004-x-worker-domain/spec.md
---

# worker 自动化触发

> **读者：** 要让 worker 定时自己干活的人。上游叫 Automation/Trigger，我们已有 schedule 全套，本 issue 只补"执行器是 worker"这一段。

## 为什么成本低（评估结论，2026-09-26）

上游 New Automation 表单 = 触发条件（Schedule 重复/一次性、Event、API）+ 执行方式（Waker 或 WakerFlow）+ 执行 prompt + 工作区/项目。

对照我们：

- **Schedule 触发器已整套存在**：cron/every、一次性（maxRuns=1）、过期、运行历史、CLI、app 屏。
- **执行到 worker 的链已存在**：`createTask + runTask`，且自动带 `BYSPACE_WORKER_ID`（工具守卫）、一 worker 一并发、任务状态机。
- 接缝现成：`ScheduleService` 的执行是注入式 runner；`ScheduleTarget` 加第三种 `worker` 即可，**无需新表**。

**不做（本 issue 范围外）：** Event(Hook) 与 API 触发 —— webhook 端点 + 鉴权是独立一大块，上游此面也多绑 IM；`@Waker` 按 Owner 决定不做。

## 范围

1. 协议：`ScheduleTarget` 增加 `worker` 变体（`workerId`）。
2. 执行：schedule runner 遇 `worker` 目标 → `workerService.createTask + runTask`，产出按 agent target 同样回填（agentId = 任务的 session）。
3. CLI：`byspace schedule create --worker <id>`（与现有 `--agent` 同级）。
4. UI：app schedules 屏创建表单加 worker 目标（如果现有表单有 agent 目标的话；没有就 CLI 先行）。

## 判据

- 一个真实 worker + 一条 `--worker` schedule（every 5s、maxRuns 1）→ 到点后 worker 收到任务并跑完，schedule run 记录 `succeeded` + agentId。
- 无 worker 身份伪造（目标 worker 不存在 → schedule run 记 `failed` 且 error 明确）。
- 触发产生的任务在 console 的 worker 详情页可见、可点开对话。

## 关闭记录（2026-09-26）

四条判据全部真机验证（`worker:wkr_7c4eaab` + cron `* * * * *` + maxRuns 1）：

- 到点 → 任务出现在 worker 名下（`in_progress → submitted`，agentId 记录）
- worker 回答了 prompt（"OK"），cwd 是自己的 workspace → **带 `BYSPACE_WORKER_ID`，工具守卫对触发产生的会话同样生效**
- schedule run 记 `succeeded` + agentId（= 任务 session，可点开对话）+ `output: task <id> submitted`
- maxRuns=1 到数即 completed

**实现要点**：`ScheduleTarget` 加 `worker` 变体（协议 + CLI `--target worker:<id>`）；执行走注入式 `runWorkerPrompt`（bootstrap 在 worker subsystem 之后接线，`ScheduleService` 不知道 worker 怎么跑）；`executeSchedule` 顺势重整为纯分发器（complexity 超限的处理）。agent 分支原样抽出，行为不变（62+12 测试全过）。

**不做**（范围外，有记录）：Event(Hook)/API 触发（webhook 端点 + 鉴权是独立一块）；`@Waker` 依赖 IM，Owner 定不做。
