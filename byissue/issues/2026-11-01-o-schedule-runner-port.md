---
kind: issue
title: "定时任务的执行层没有移植：不按时运行、新 agent 忽略配置、运行完归档了项目的主工作区"
type: issue
status: open
created: 2026-11-01
---

# 定时任务的执行层没有移植

前端重写第 4 步第 5 批（定时任务页）对照旧版时发现。旧版和新版前端都受影响，问题在 Go daemon。

## 现状

Node 的 `ScheduleService`（`git show 20721fdcf^:archive/packages/server/src/server/schedule/service.ts`，约 1000 行，加 `store.ts`、`cron.ts`）和 Go 的 `internal/schedule/schedule.go`（约 630 行）+ `internal/server/ws_agent.go` 的 `executeScheduledPiRun` 比，Go 只有增删改查和手动「Run now」：

1. **定时任务从不按时运行**：Go 没有计时器（Node 的 `start()` / `tick()`），只有 Run now 会执行。开发版里那条每小时一次的任务停在「Last run Oct 15」，正是 Go 接手（10 月 25 日）之前 Node 最后一次运行。
2. **新 agent 类任务忽略配置**：`executeScheduledPiRun` 把提供方写死成 `pi`，任务里的提供方、模型、模式、思考等级、隔离方式（worktree）、标题、`byspace.schedule-*` 标签都没用上。测试时配的是 Mock 模型，实际起了一个 pi agent，用真实模型跑了提示词。
3. **运行完把项目的主工作区归档了**：Node 每次运行新建一个工作区（local 隔离是同目录的新工作区，worktree 隔离是新 worktree），跑完按 `archiveOnFinish`（默认开）归档**这个工作区**。Go 用 `EnsureWorkspaceForCwd` 拿到的是该目录现有的主工作区，跑完把它归档了。开发版的 `/tmp/zz-diff-repo` 主工作区就是这样被归档的（11 月 1 日 14:51 UTC，旧版 Run now 一次），已用工作区页的 Unarchive 恢复。
4. **运行记录里的 agent id 让客户端拒收回包**：Go 的 agent id 是 `agt_` 加 16 位十六进制，Node 是 UUID（`randomUUID`）；协议的定时任务 schema 把 agent id 校验成 GUID（`ScheduleRunSchema.agentId`、agent 类目标）。所以跑过一次的任务，编辑（`schedule/update/response`）、Run now（`schedule/run-once/response`）、查看（`schedule/inspect/response`）的回包都被客户端判为非法；目标是 Go 建的 agent 的心跳任务会让整个列表（`schedule/list/response`）非法，定时任务页显示「Unable to load schedules」。**已修**：`newAgentID` 改成 UUID v4（`internal/server/server.go`，测试 `agent_id_test.go`；`server_test.go` 里要求 `agt_` 前缀的断言改成要求 UUID）。实测新建的 Mock agent id 是 UUID，旧版新版的历史都能列出、没有校验报错。正式版 `~/.byspace/schedules` 里没有任务，没有受影响的数据。
5. Node 还有、Go 没有的：运行中途重启后的恢复（`recoverInterruptedRuns`，把中断的运行记成失败并归档它的工作区）、清理孤儿任务（`sweepOrphanedSchedules`）、目标 agent 被归档时结束心跳任务（`completeForAgent`）、运行开始时就把工作区和 agent 记到运行记录上（`recordRunWorkspace`）、Run now 不推进下次运行时间等 `finishRun` 的规则。需逐项对照。

## 要做

照 Node 的 `service.ts` 移植执行层，逐项对照上面 1–5，补 Go 测试（Node 的 `service.test.ts`、`schedule-run-lifecycle.e2e.test.ts` 是用例来源），`npm run audit`，再在开发版用 Mock 模型实测：按时触发、Run now、local 和 worktree 两种隔离、archiveOnFinish 开关、主工作区不受影响。
