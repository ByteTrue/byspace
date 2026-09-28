---
kind: issue
title: agents 与 squads 管理页：有真数据的面，不建空壳
type: feature
status: closed
created: 2026-09-29
---

# agents 与 squads 管理页：有真数据的面，不建空壳

> **读者：** 接手的人——源的 agents/squads 页为什么只抄一小块、每块的数据从哪来。

## 源的形态与我们的取舍

源 agents 页是带十几个 tab 的巨兽（skills / mcp-config / env / custom-args / integrations / runtime-config / access / activity…）， squads 页有 profile card + 成员管理。本形态只建**背后有真数据、真写面**的部分（延续 050 的"无机制不建壳"原则）：

- **agents 列表**：卡片 = 头像/名字/状态点/kind（system 标 internal）/model/permission_mode/description；系统 agent 单独一排（它们是执行载体不是队友，但管理面要看）；
- **agent 详情**：instructions 全文（秘书与自建 agent 的行为文本，可读可改是管理面的本职）、model、permission_mode、max_concurrent_tasks、近 20 条 task（状态+issue 链接+耗时）；enable/disable（updateAgentStatus 的暴露）；
- **squads 列表**：卡 = 名字/leader 名/成员数/description；
- **squad 详情**：成员 roster（含 leader 标）、加成员/移成员（写面已存在于 store，缺 RPC）、leader 只读展示（改 leader 不在本批：源亦走 squad update 的大写面）。

不建：skills/mcp/env/custom-args/integrations/runtime tabs（我们的 agent 配置在创建时定，运行时配置域未建）、agent 创建表单（CLI 已覆盖）、批量工具条、activity hover。

## RPC 面（6 对，增量）

- multica.agent.get（单 agent 全字段）
- multica.agent.status（enable/disable，workspace.write）
- multica.squad.get（squad + members 一次回）
- multica.squad.add_member / multica.squad.remove_member（workspace.write）
- multica.task.list 增可选 agentId 过滤（agent 详情的近况列表）

## 影响面

- 必须改：protocol（6 对）、session handler、permission map、client、app 两页 + 详情、CLI 面可选（agents 详情 CLI 已有 agent ls；不加）。
- 需要验：agent 详情显示真 instructions 与真 task 历史；disable 后 agent 状态落库且列表反映；squad 加/移成员后 roster 变化；系统 agent 在管理面可见、在 assignee 过滤里不可见（005 的 includeSystem 语义延续）。
- 仍未知：无。

## 验证

- store 已有方法直接复用（不新写 SQL）；新 RPC 走 verifier 增补。
- 真机浏览器：两页 + 详情各截一图；disable/enable 一次；squad 加成员一次。

## 执行记录

- 页面三块：/multica/agents（agents 卡网格 + squads 卡网格，系统 agent 带 internal 标）、/multica/agent（instructions 全文 + 边界 + 近 20 run + archive/restore）、/multica/squad（roster + leader 标 + 加/移成员；leader 只读）。board header 增 Rosters 药丸为入口。
- RPC 六对：agent.get / agent.status（**archived 语义**）/ squad.get / squad.add_member / squad.remove_member / task.list 增 agentId 过滤（与 issueId 互斥可选）。store 只增 listTasksForAgent 与 setAgentArchived，其余复用既有写面。
- **抓到的语义错（本轮最重要的纠正）**：我先按"enabled/disabled"做了 agent 开关，真机 handler_error 才暴露 agent.status 是 presence 枚举（idle/working/blocked/error/offline，运行时状态不是开关）；源的 enable/disable 实为 **archive（031 的 archived_at/by）**。RPC 改 archived 语义、UI 文案改 Archive/Restore、卡片状态点改 presence（idle/working 绿，其余灰）。
- **第二处截图抓的错**：archive 后 agent 从管理页消失（listAgents 默认藏 archived，源语义对但管理面失去恢复入口）—— 管理页改传 includeArchived（协议与 client 本就透传，只是页面没传）；assignee 过滤与名册继续藏 archived（catalog 默认），两个面语义各归其位。
- 真机：rosters 页 3 agents + 1 squad；squad 详情 add Editor → roster 两行、remove → 回一行；agent 详情 instructions 真文本、Archive→DB archived_at=1 且列表带 archived 标、Restore→0；三页截图 /tmp/ours-rosters2.png、/tmp/ours-agent-detail.png、/tmp/ours-squad-detail.png、/tmp/ours-rosters-archived2.png。
- verifier 增 6 检查（detail/agent 归档与恢复/squad 加移/roster 回读）→ 43/43。
- 欠账仍存：agents 页的 skills/mcp/env/custom-args 等 tabs（配置域未建）、agent 创建表单（CLI 已覆盖）、批量工具条。

## 关闭回写

- Epic spec 进度；parity-audit 欠账面 "agents/squads 管理页" 行标记完成（tabs 面仍欠，已记）。
