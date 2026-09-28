---
kind: issue
title: inbox 面对齐：窄列+Archived 入口行+过滤菜单+批量三动词
type: feature
status: closed
created: 2026-09-29
---

# inbox 面对齐：窄列+Archived 入口行+过滤菜单+批量三动词

> **读者：** 接手的人——真服务对照（ref-inbox.png）下 inbox 面的四处差距。

## 源形（inbox-page.tsx + filter-store.ts）

- 列表是**窄左列**（详情在右大 pane）；列表头=标题+过滤漏斗+`…` 菜单。
- 空态=图标+"No notifications"；列表底一条 **Archived 入口行**（图标+名+右箭头），点进 archived 视图（分页）。
- 过滤是**菜单**（filter-store：statuses/priorities/actors/unreadOnly 四维），不是 severity tabs。
- `…` 菜单=三个批量动词：mark all read / archive all / archive all read。

## 我们现状

- 宽双 pane（窄屏堆叠）——保留（我们详情 pane 复用自有形，宽窄都有验过）；
- severity chips tabs（Needs you/Attention/Info）——换成过滤菜单（unread only + severity 多选）；
- Archived 是头部 view toggle——换成列表底入口行（源形）；
- 批量只有 mark_all——补 archive_all 与 archive_all_read 的 RPC/CLI（store 的 archiveAllReadInbox 在、archiveAllInbox 缺）。

## 范围

- store：archiveAllInbox（全归档）；RPC 两对（archive_all / archive_all_read）+ client + CLI inbox 动词补 archive-all/archive-all-read；
- UI：severity tabs → 过滤菜单（漏斗图标，unread only + severity 多选）；头部 view toggle → 列表底 Archived 入口行（进入后行变"Live"返回）；空态文案与图标对齐源。

## 验证

- 单测：archiveAll 两动词语义（只动未归档、archive_all_read 只动已读）；
- 真机：过滤菜单 unread only 生效；Archived 行进出；… 菜单三动词各落库。

## 执行记录

- 批量三动词收齐：store 补 archiveAllInbox（archiveAllReadInbox 本在）；RPC 一对带 readOnly 旗（源是两端点同 store 形，一 RPC 带旗是翻译且更省）；权限按 inbox 族同列 workspace.read（domain 门在 handler 的 owner gate）；CLI `inbox archive-all [--read-only]`。
- UI：severity chips tabs → 漏斗过滤菜单（unread only + severity 多选，激活时触发器带点）；头部 view toggle → 列表底 **Archived 入口行**（archive 视图内行变 Live 返回）；`…` 菜单=三批量动词。宽双 pane 保留（有意偏离：我们详情 pane 复用自有形）。
- 真机：unread-only 过滤生效（1 行+触发器点）；Archive all 后 live 空、Archived 行见 2 项、Live 行返回。
- 测试补一例（archive-all 与 archive-all-read 的分界：只读的那条先归档，另一条留到全归档）。
- 写测试两次踩自家 API 名（createInboxItem 的 type 必填、markInboxRead 非 markInbox）——都是先写期望再查真名的旧习，现查现写即可免。
