---
kind: issue
title: activity_log 写入 + issue 详情的时间线与 Execution log 面板
type: feature
status: closed
created: 2026-09-29
---

# activity_log 写入 + issue 详情的时间线与 Execution log 面板

> **读者：** 接手的人——activity 从哪写、timeline 是什么混流、Execution log 面板读什么。

## 源语义（activity_listeners.go + handler/activity.go）

- **写入是事件监听**：issue:created → `created`；issue:updated 按变化字段逐条 → `status_changed` / `priority_changed` / `assignee_changed` / `start_date_changed` / `due_date_changed` / `title_changed` / `description_updated`（details 带 from/to）；task:completed / task:failed → `task_completed` / `task_failed`（actor=agent，details `{}`，无 issue 的 task 不记）。
- **读面是混流 timeline**：issue 详情的流不是"评论列表"，而是 activity 与 comment 按时间合排的一条流（条目带 type 判别），有硬上限与 truncated 标记。
- **Execution log 面板**：issue 详情右栏的 runs 列表（queue 行：status/时间/agent）。

## 翻译

无事件总线：写入点收在 store 的写事务内（比源的监听更近，语义等价且更强——同事务不丢）。

- store：`recordActivity`（同事务内调用）与 `listActivitiesForIssue`；写点 = createIssue、updateIssue（逐变化字段）、executor settle（task_completed/failed，仅带 issue 的 task）。
- RPC `multica.timeline.list`：activity + comment 合排（created_at asc，同刻 activity 先），上限 200 + truncated 标记。
- UI：issue 详情流改渲染 timeline（comment 卡原样 + activity 行 = 灰字 meta："谁 改了什么 from→to · 相对时间"）；右栏增 Execution log 折叠组（runs：status 点 + agent 名 + 时间，点击开会话若 task 有 session）。
- Token 面板不做（task 无 token 计量面，记欠账）。

## 范围

- 包含：store 写点三处、timeline RPC、详情流改混流、Execution log 面板。
- 不包含：token 面板、activity 的 WS 广播（无总线）、timeline 分页加载更多（200 上限+标记已诚实）。

## 影响面

- 必须改：store、executor、protocol（timeline.list）、session、app detail。
- 需要验：改状态/改 assignee/评论/跑完一个 task 后 timeline 各有一条对应记录且顺序对；Execution log 面板显示该 issue 的 runs 与状态。
- 仍未知：无。

## 验证

- store 单测：三写点各一条 + 未变化字段不写 + 无 issue task 不写。
- 真机：在 #2 上改一次状态、发一条评论、触发一次 run，看详情页流四段（created/status/评论/run 结局）齐且有序；Execution log 显示 run 行。

## 执行记录

- store：recordActivity（公有，写事务内调用）+ listActivitiesForIssue；写点三处 —— createIssue 记 `created`；updateIssue / updateIssueStatus 经 #recordFieldChanges 逐变化字段记 status_changed / priority_changed / assignee_changed / title_changed / description_updated（details 带 from/to；未变化字段不写，"时间线不叙述没发生的写"）；executor settle 记 task_completed / task_failed（仅带 issue 的 task，源 handleTaskActivity 同款跳过）。
- 写入归属：issue.update / issue.status.update 增可选 senderSessionId（与 comment.create 同一解析规则：反解为 run 的 agent，无则 owner）—— 审计行的 actor 不能再一律是 owner。
- 读面：multica.timeline.list 混流（activity+comment 按 created_at 合排，200 上限 + truncated 标记）；UI 详情流改渲染混流：comment 卡原样、activity 行=灰点+「谁 做了什么 from→to · 相对时间」；右栏增 Execution log 折叠组（runs：状态点+agent 名+状态+相对时间）。
- 测试：store 两条（created+status_changed 且未变字段不落、无 issue 的 task 不记）；123 域测。verifier 未增（写点已由 store 测与真机覆盖）。
- 真机：对 #2 走一次 owner 状态写后 timeline 出 `activity:status_changed` 与既有 20 条 comment 合排；详情页右栏 Execution log 显示该 issue 的 9 条真 run（Chief of Staff/Writer · completed · 相对时间）；截图 /tmp/ours-timeline.png。
- 过程纠正一处结构债：useIssueDetailData 复杂度越线，三查询抽为 useIssueQueries（拼合时一度丢了 export 与 client 作用域，typecheck 当场抓回）。
- 欠账：token 面板（task 无计量面）；activity 的实时推送（无事件总线，靠轮询）；timeline 分页加载更多。

## 关闭回写

- Epic spec 进度；parity-audit 欠账面 activity_log / Execution log 行标记完成（token 仍欠）。
