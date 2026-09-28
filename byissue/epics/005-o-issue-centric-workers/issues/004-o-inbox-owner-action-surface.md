---
kind: issue
title: inbox：给老板的待办箱（审批与关注的载体）
type: feature
status: open
created: 2026-09-28
---

# inbox：给老板的待办箱（审批与关注的载体）

> **读者：** 接手的人——inbox 在源里是谁写谁读、我们翻译到哪、秘书的"审批清单"为什么落在它上面。

## 目标

源（`server/internal/handler/inbox.go` + `server/internal/service/task.go` 写侧）：owner 的收件箱，条目带 severity（`action_required` / `attention` / `info`）、指向 issue、可读/未读/归档。写侧全是**系统**：run 失败→action_required、重试耗尽→action_required、quick-create 完成→info、autopilot 配额→attention。读侧是 owner 的整理面（list/archived/mark read/unread/archive/mark-all-read/archive-all）。

这是"秘书把需要我审批的整理成一份清单给我看"的载体：severity=action_required 的未读集合就是那份清单。

## 一处有理由的偏离（记在此，供 Owner 复核）

源的写侧只有系统；我们的秘书是自主操作员，它整理出的"需要你决策"条目需要一个落点。**增加一条 run 可写的入口**：`multica.inbox.create` 仅接受能反解为 run 的 `senderSessionId`（与评论归属同纪律：无会话或陌生会话拒绝），severity/issue/title/body 由 run 提供。人类面/console 不写 inbox（它们是读者）。理由：单用户形态里秘书就是"系统里会整理的那部分"；若不给它入口，审批清单只能留在它自己的会话里，老板得主动去问 —— 与"整理给我看"相反。

## 范围

- 包含：store 全读面（list/archived/count-unread）与写面（create/mark-read/mark-unread/archive/unarchive/mark-all-read/archive-all-read）；域内系统写：run failed→action_required（executor）；run 可写入口（RPC+CLI）；3+2 对 RPC；CLI `inbox ls/read/archive/create`。
- 不包含：inbox UI（欠账面，与 wakeup 管理 UI 同批）；autopilot 配额写（autopilot 未做）。

## 影响面

- 必须改：store、executor（失败写）、session handler、protocol、CLI。
- 需要验：run 失败产生 action_required 条目；run 会话可写、陌生会话被拒；read/archive/mark-all 语义；单用户形态 recipient 恒为 owner。
- 仍未知：无。

## 验证

- store 单测：读写面语义 + recipient 恒 owner。
- handler 单测：run 会话写 / 无会话拒 / 陌生会话拒。
- e2e verifier：失败 run → 条目出现 → mark read → count 归零。
- 真机：制造一次失败 run，读老板 inbox 见 action_required。

## 执行记录

- store：createInboxItem（recipient 恒 owner —— 单用户形态，收件人只有一个）/ listInbox(archived) / countUnread / markInboxRead / archiveInboxItem / markAllInboxRead / archiveAllReadInbox；InboxRow 与 mapper 在 rows.ts。
- 系统写侧：executor 失败（含等审批失败）写 `run.failed` + action_required，actor 记失败的 agent，details 带 task_id —— 源的 task.go 失败写同款。
- run 可写入口：`multica.inbox.create` 强制 `senderSessionId` 且必须反解为 run（与评论归属同纪律）；CLI `inbox create` 在无 BYSPACE_AGENT_ID 时本地即拒（"inbox create is for runs"）。
- 读面 RPC 5 对（list/create/mark/archive/mark_all）；CLI `inbox ls/read/archive/read-all/create`；权限：写=workspace.write，读=workspace.read。
- session handle 复杂度到顶：wakeup+inbox 两族改由前缀谓词 `isWakeupOrInboxMessage` 路由到子 dispatcher，穷尽性仍 fail-closed（default 臂 msg satisfies never）。
- 秘书 INSTRUCTIONS 增：需要老板决策的不埋在评论里，用 inbox create 上桌；action_required 只给决策、attention 给值得看的、info 慎用。
- 验证：executor-failure.test 2 测（失败→条目、成功→只评论不上桌）；归属测试追加 3 测（run 可写/陌生会话拒/read-all 结算）；CLI surface 测试锁 inbox 五动词；verifier 30/30（含空箱/拒写两条）。
- 真机（2026-09-28）：#4 探针 issue 指派 Writer（todo 触发 run）→ run 内执行 `byspace multica inbox create --severity action_required` → 老板 `inbox ls` 读到该条目（actor=Writer、unread）。无人代写。
- 偏差：inbox UI 未做（欠账面，与 wakeup 管理 UI 同批）；autopilot 配额写未做（autopilot 未做）。

## 关闭回写

- Epic spec 进度；parity-audit 欠账面 inbox 行标记完成（UI 除外）。
