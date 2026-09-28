---
kind: issue
title: subscriber（隐式+显式订阅与软退订）与子 issue 树读面
type: feature
status: closed
created: 2026-09-29
---

# subscriber（隐式+显式订阅与软退订）与子 issue 树读面

> **读者：** 接手的人——谁自动订阅、退订为何是软的、子 issue 面为什么只读。

## 源语义（015/016 + subscriber.sql）

- reason 七枚举：creator / assignee / commenter / mentioned / manual / autopilot / delegated；**隐式订阅在写时落**：创建者建 issue、被指派者接到指派、评论者发评论、被 mention 者被点名。
- 退订是**软**的：unsubscribed_at 盖章；再次隐式触发（如再评论）会复活（源 AddIssueSubscriber 清戳）。
- 子 issue：parent_issue_id 的树；源详情有 sub-issues 组（staged 分组、progress chip）。

## 翻译

- store：addSubscriber（reason；已软退订的复活=清戳）、unsubscribe（软）、listActiveSubscribers；写点接隐式：createIssue（creator）、updateIssue 的 assignee 变更（assignee）、createComment（commenter + 提及者 mentioned）。
- RPC 三对：subscriber.list / subscribe（manual）/ unsubscribe。
- UI：详情头 Subscribe/Unsubscribe 按钮 + 订阅者头像列；子 issue 读面 = 详情"Sub-issues"段（parent 的 children 列表，状态点+标题，点开子）；**不做**子 issue 创建表单与 staged 分组（源面重，读面先把树显形）。
- 不做：子树退订（HasAncestorOptOut）、delegated/autopilot reason 的自动落（autopilot reason 在 006 的 run 面可补，记欠账）。

## 验证

- 单测：隐式四原因各落一行；软退订后再评论复活；unsubscribe 戳保留行（历史可读）。
- 真机：评论一次 → 评论者进订阅列；点 Unsubscribe → 戳落；再评论 → 复活；建子 issue（RPC 带 parentIssueId，创建面已有字段则用之）→ 父详情见 Sub-issues 段。

## 执行记录

- store：addSubscriber（ON CONFLICT 清戳复活 + 覆盖 reason——行键是 (issue, person)，同人多次触发只留最新 reason，源同款）、unsubscribe（软戳）、listActiveSubscribers、listChildIssues（board 序）。
- 隐式四写点：createIssue（creator + 带指派的 assignee）、updateIssue 的 assignee 变更（assignee）、createComment（commenter + mentions→mentioned，名→id 用 agent 名单解析）。
- RPC 三对：subscriber.list / subscriber.set（subscribed bool，senderSessionId 同 comment 规则）；issue.get 响应增 children；issue.create 请求增 parentIssueId。
- UI：详情右栏 Sub-issues 段（子卡可点进子 issue）+ Subscribers 段（Subscribe/Unsubscribe 按钮 + 「谁 · reason」行）。
- **又抓一处 client 透传漏**（本线第三处同类）：client multicaIssueCreate 没传 parentIssueId，子的 parent 列空、children 读面空。store/handler/schema 都对，漏在 client 的字段列表 —— 记为模式：client 方法体是手工字段映射，每次协议加字段都要三处同步（schema/handler/client），缺一处即静默丢写。
- 真机：create 即 creator 订阅；owner Unsubscribe → 行保留且戳=1；评论带 @Writer → subs 多一行 agent:mentioned；详情页 Sub-issues 见子卡、Subscribers 见两行与 toggle。截图 /tmp/ours-subscribers.png。
- 测试：隐式四原因（四个不同人，一行一人）、同人两次触发留最新 reason、软退订后评论复活、子 issue 读面序。19 store 测。
- 欠账：子树退订（HasAncestorOptOut）、delegated/autopilot reason 的自动落、子 issue 创建表单与 staged 分组。

## 关闭回写

- Epic spec 进度；parity-audit 的 subscriber/子 issue 行更新。
