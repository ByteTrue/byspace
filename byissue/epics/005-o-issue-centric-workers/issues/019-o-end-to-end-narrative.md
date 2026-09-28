---
kind: issue
title: 端到端叙事验证：老板→秘书→建组派活→回报→收件箱→处理
type: verification
status: open
created: 2026-09-29
---

# 端到端叙事验证：老板→秘书→建组派活→回报→收件箱→处理

> **读者：** 接手的人——这条链是 Epic 005 存在的全部理由；每环的证据与缺口。

## 链（源叙事 = 用户需求原文）

1. 老板在 secretarial workspace 里普通聊天说需求（秘书=常驻 workspace 的内置 agent）；
2. 或老板在某 issue 上 @秘书 / 指派秘书 → 触发引擎叫醒秘书（run）；
3. 秘书判断：小事自己办；大事拆子 issue、指派（或建 squad 拉人）；
4. 被指派的 worker 被触发引擎叫醒、执行、评论回报；
5. 秘书经 wakeup（run.completed）自主醒来，检查回报；需要老板决策的 → CLI inbox create（action_required）；不需要的 → 自己评论/追派；
6. 老板在 console 的 inbox 面看到待决项，处理后归档。

## 验法

- 全程**人不碰 worker 命令**：只有老板的评论/聊天与 console 点击；agent 的一切动作由其自身经 CLI/触发完成（沿用 004 的验证准则：验证者与被验证者不共享控制面）。
- 每环留证据：DB 行（task/run、comment 归属、inbox 行）、daemon 日志（触发来源）、console 截图。
- 缺口即记：哪环断了、断在机制还是提示词。

## 执行记录

（验证阶段追加）

## 关闭回写

- Epic 005 收尾：progress 表与质量承诺核对；本 issue 的证据成为收尾依据。
