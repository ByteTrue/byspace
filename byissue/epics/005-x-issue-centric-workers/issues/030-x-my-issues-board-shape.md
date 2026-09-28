---
kind: issue
title: my-issues 向源形收：四 scope + 板形（非列表）
type: feature
status: closed
created: 2026-09-29
---

# my-issues 向源形收：四 scope + 板形（非列表）

> **读者：** 接手的人——真服务对照（ref-my-issues.png）下 my-issues 面的两处形差距。

## 源形（my-issues-view-store.ts + issues-page）

- scope 四段：All / Assigned / Created / **My Agents and Squads**（API relation=involved）。
- involved 谓词（issue_table_query.go:396）三腿：assignee 是我拥有的 agent / assignee 是我在的 squad / 第三腿（subscriber 等）——subscriber 折在 involved 里，不是独立 tab。
- 面=**与 Issues 同形的板**（列+卡+拖拽），不是列表。

## 我们现状（018）

- scope 三 tab（assigned/created/subscribed），面=平列表（复用 IssueList）。
- 协议 enum(["assigned","created","subscribed"])。

## 收法

- 协议**加性**扩 enum：all/involved 新增；subscribed 保留为 involved 的旧名（老客户端不发新值，兼容纪律不收窄）。store scopeWhere 加 all（无 where）与 involved（三腿：assignee 任一 agent/squad——单用户形态全部 agent/squad 都属 owner 的团队——或 subscriber 行在）。
- UI：mine 页 tabs 四段（All/Assigned/Created/My agents and squads）；面从 IssueList 换**板形**：从 multica-board 抽出 BoardCanvas（DndContext+列渲染+drop 解析），board 与 mine 共用，拖拽写同路。

## 验证

- 单测：scope 四值语义（all 全集、involved 含 agent-assigned 与 subscriber、subscribed 别名同 involved）；
- 真机：四 tab 切换各见其集；mine 板形拖拽落库同 board。

## 执行记录

- 协议加性扩 enum（all/involved 新增；subscribed 保留为旧名=involved 同集合，兼容纪律不收窄）。store scopeWhere：all=无 where；involved=源谓词逐字翻译——**只有 assignee 是 agent/squad 一腿**（先误加了 subscriber 腿，测试顶出后核对源 appendIssueTableInvolvedPredicate：三块 UNION 全是 agent/squad 归属，subscriber 不在 involved 里；子测试随之改正）。
- 板形：从 multica-board 抽 BoardCanvas（DndContext+列+卡+drop 解析+overlay，grouping 作 prop），board 与 mine 共用一份拖拽语义；mine 的拖拽写走同路（multicaIssueUpdate + revision + refetch）。
- tabs 四段（All/Assigned/Created/My agents and squads），默认 Assigned（源 my-issues-view-store 的初始 scope）。
- 真机：四 tab 各见其集（All 16 / Assigned 0——owner 指派的早改派给 worker / Created 16 / involved 5=agent 与 squad 指派的）；板列渲染同 board。
- 一处 bash 探针自错：for 循环里的 $(...) 插值把 tab 名打坏，三次"点击"其实点同处——逐名精确点后数据才可信。
