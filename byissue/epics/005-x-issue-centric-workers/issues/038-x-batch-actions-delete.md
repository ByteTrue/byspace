---
kind: issue
title: 批量操作面 + issue 删除（源 BatchActionToolbar + DeleteIssue）
type: feature
status: closed
created: 2026-09-29
---

# 批量操作面 + issue 删除（源 BatchActionToolbar + DeleteIssue）

## 源形（batch-action-toolbar.tsx + issue.go 4308/4866）

- board/列表多选 → 顶部批量条：status/priority/assignee/delete 四动作 + 计数 + clear；status 直接应用（MUL-4155：不弹 run 确认），assignee 对非全 backlog 选择弹 run-fan-out 确认，delete 弹确认。
- DeleteIssue：先 CancelTasksForIssue（在飞 run 取消）+ FailAutopilotRunsByIssue，再删行（FK 级联收尾）。
- BatchDelete = 循环 DeleteIssue。

## 我们原状

无删除（issue 只能状态流转）；无多选；无批量。

## 收法（含偏离）

- store：cancelTasksForIssue（在飞行→cancelled，源 CancelTasks 的形）+ deleteIssue（先取消再删；autopilot_run.issue_id SET NULL 源同，不 fail runs——fail 需要 run 失败语义与 reason 码，欠账记）。
- RPC 三对：issue.delete / issue.batch_update（status|priority|assignee 三字段 omit-keeps、逐 issue 走同 updateIssue 触发语义）/ issue.batch_delete。
- UI：board 卡与列表行带勾选；>0 时顶部批量条（计数+四动作+clear）；**assignee 的 run-fan-out 确认不建**（无对话框机制，033 既定）——批量 assignee 直接应用同 status；delete 用两步按钮（Delete → Confirm delete N）代替模态。

## 执行记录

- store：deleteIssue（FK 级联收全场：comment/activity/label/task 行随 issue 消失——源同 ON DELETE CASCADE；autopilot_run 失链 SET NULL 源同）。**修正了我第一版**：先"cancel 在飞再删"是死代码（级联本就带走行），删之；真正的守护在 executor——mid-run 的 run 在 settle 时读行不在即放弃 settlement 并日志（源靠同事务 cancel+settle 避窗口；我们无 outbox，drop 是诚实等价）。
- executor-deleted-issue.test：mid-turn 删 issue → drain 不抛、agent 槽释放、同批下一个 issue 的 run 照常 completed。
- RPC 三对 issue.delete / issue.batch_update（逐 id 走 #applyIssueWrite——批量=N 次单写：各自 revision 检查与触发判定，源 batch endpoint 同形；expectedRevisions 缺省读现值）/ issue.batch_delete（循环 deleteIssue）。
- 写臂复杂度超限再现：三 case 抽 #handleIssueAdminMessage 二级 dispatch（类型谓词+守卫链两处同改——记忆 #1950）。
- UI：board/list 卡带 SelectTick 勾选；>0 顶部 BatchToolbar（计数+Status/Assignee 下拉+两步 Delete+clear）；**assignee 的 run-fan-out 确认模态不建**（无对话框机制，033 既定偏离），批量 assignee 直接应用同 status（源 MUL-4155 对 status 本就直应用）。
- CLI 不补 delete（源 CLI 无此动词，REST/UI-only）——照源。
- 真机：两 issue 勾选→批量条"2 selected"→Status→In Review 双落库；再勾→Delete→"Confirm delete 2"→两行消失。
