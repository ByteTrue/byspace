---
kind: issue
title: My issues 面：owner 的三 scope 工作台
type: feature
status: closed
created: 2026-09-29
---

# My issues 面：owner 的三 scope 工作台

> **读者：** 接手的人——单用户形态下"我"是谁、三 scope 怎么算。

## 源语义

my-issues 按登录成员算三 scope：assigned（指派给我）/ created（我建的）/ subscribed（我订阅的），源是侧栏首面。

## 单用户形态的翻译

无登录，owner 是唯一的"我"：

- assigned = issue.assignee_type='owner'（owner 也可被指派，少见但合法）；
- created = issue.creator_type='owner' 且 creator_id='owner'；
- subscribed = issue_subscriber 里 user_type='owner' 的活跃行。

RPC 一对 multica.issue.mine（scope 参数 + 返回 issue 列表，读面复用 listIssues 的过滤参数扩展或 store 新方法）；UI：/multica/mine 页 = 三 tab（Assigned/Created/Subscribed）+ list 行形态复用 board 的 IssueList 组件不行（它在 board 文件内私有）——抽成共享组件 multica-issue-list.tsx。入口：board header 的 My issues 药丸。

## 范围

- 包含：RPC 一对、store 三 scope 查询、页 + 三 tab + 行、入口药丸、共享 list 组件抽取。
- 不包含：分页/排序参数（量小）、skills/runtimes 页（表无行为，空壳，defer 已记）。

## 验证

- 真机：owner 建的 issue 出现在 Created；给某 issue Subscribe 后出现在 Subscribed；三 tab 计数与 DB 一致。

## 执行记录

- store：listMyIssues 三 scope（assigned=assignee 是 owner 行；created=creator 是 owner 行；subscribed=owner 活跃订阅行的 issue 集合），board 序同款。
- RPC 一对 multica.issue.mine（scope 参数；读臂 —— 这次 guard 链与 type/switch 三处同步改，017 的裂缝教训直接应用）。
- UI：/multica/mine 三 tab 页，行复用 board 的 IssueList（抽为 export，两面不漂移）；board header 加 My issues 药丸。
- 真机：Created 10 / Subscribed 4 / Assigned 0，与 DB 三查一致；tab 切换计数随之变。截图 /tmp/ours-mine.png。
- 过程纠偏：mine schema 一度插在 IssueSummary 之前（TDZ），浏览器首屏即报初始化错 —— AOT 与 tsc 都不查模块内初始化序，只有运行时暴露；改位置后三处验证全绿。
- 欠账：scope 的计数徽标（源侧栏带数）、排序/分页。

## 关闭回写

- parity-audit 的 my-issues 行更新。
