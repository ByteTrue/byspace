---
kind: issue
title: 详情右栏向源形收：行值下拉 + Details 组
type: feature
status: closed
created: 2026-09-29
---

# 详情右栏向源形收：行值下拉 + Details 组

> **读者：** 接手的人——真服务对照（ref-issue-detail.png）下右属性栏的两处形态差距。

## 差距（源形 vs 我们）

源右栏=分组（Properties/Pull requests/Details），每行=标签+**行内值**（状态=色点+名、assignee=头像+名、priority=图标+名），值本身是触发器点开下拉；Details 组=Created by / Created / Updated 三只读行。
我们=Properties 组里 priority/assignee 用**芯片排**（五枚/名册全摊），无 Details 组（时间戳不在面上）。

## 收法

- priority/assignee 改行值下拉（同 StatusDropdown 的形：触发器显当前值，菜单列候选+当前项勾选）；芯片排退役。
- Details 组：Created by（owner=you / agent 名）、Created、Updated（短日期）。字段已在 summary（creatorType/creatorId/createdAt/updatedAt），无需协议改动。
- 源 Pull requests 组不建（GitHub 圈，砍）。

## 验证

- 真机：priority 下拉选 high 落库；assignee 下拉换人落库；Details 三行与 DB 一致；窄屏右栏堆叠不破。

## 执行记录

- PriorityDropdown/AssigneeDropdown：触发器显当前值（assignee 带头像），菜单列候选+当前项勾选，与 StatusDropdown 同形同族；芯片排（PriorityPick/AssigneePick 及其子组件）整体退役删除。
- Details 组三行：Created by（owner=you / agent 名经 agentNameById）、Created/Updated 短日期（源形 "Sep 28"）。字段全在 summary，零协议改动。
- 真机：priority 菜单五候选、选 high 落库；assignee 菜单选 Writer 落库；Details 三行渲染。
- 源 Pull requests 组不建（GitHub 圈，砍）；"+ Add property"（自定义属性）不建：property 表在基线但行为圈未立项，建一个只能看不能用的行即是装饰。
