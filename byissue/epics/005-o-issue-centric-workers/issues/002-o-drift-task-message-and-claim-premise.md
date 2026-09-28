---
kind: issue
title: 漂移修正：task_message 去留与 claim 前提记录
type: chore
status: open
created: 2026-09-28
---

# 漂移修正：task_message 去留与 claim 前提记录

> **读者：** 接手的人——两处"文档说的和代码做的不一致"，本 issue 只负责让它们重新一致。

对照审计（`../parity-audit.md` F1、F3）发现两处漂移，都不涉及新能力：

## 1. task_message：基线文档列了，实现从未建

`schema-baseline.md` 的 28 表清单含 `task_message`（源 026：run 执行中的流式进度消息），但 76 个翻译迁移从未建它，活库无此表。文档在说谎。

**裁决（已按 audit 建议）：砍。** 理由：本形态的执行面是普通 agent 会话 —— 流式进度天然在会话时间线里，BySpace 的会话 UI 已是一等公民；源要 task_message 是因为它的 run 是黑盒子进程，进度只能落表。Execution log 面板读 `agent_task_queue` 行（状态+时间戳+result）已够，不需要第二套消息表。

动作：从 `schema-baseline.md` 28 表清单移除 task_message，并在砍除清单里记一行理由（与多租户圈同列）。

## 2. claim 并发：等价性依赖未记录的前提

executor 的领取是 in-process Set + queue 行 status 守卫；源是 PG `SKIP LOCKED`（多 daemon 抢领）。单 daemon 下两者等价，但"永远单 daemon"这个前提从未写下来 —— 哪天有人起第二个 daemon，双领就静默发生。

动作：在 executor 的 drain 注释与 Epic spec 的边界一节各记一句约束（本复刻的部署形态是单 daemon per host；多 daemon 并发领取不在边界内，若将来需要，claim 必须改为 DB 级原子）。

## 验证

- 基线文档与活库 `.tables` 一致（28→27 表，task_message 不再被承诺）。
- Epic spec 与 executor 注释均含单 daemon 前提句。
- 无代码行为变化：跑 multica 域测试确认全绿。

## 执行记录

- 基线：28→27 表；task_message 行删除，砍除清单记理由（run 是普通会话，进度在会话时间线）。
- executor drain 注释：单 daemon 前提与多 daemon 时的升级方向（DB 级原子 claim）。
- Epic spec 边界节：同一前提句。
- parity-audit F1/F3 标记已修。
- 验证：multica 域 11 文件 89 测全绿（无行为变化）；活库 `.tables` 本就无 task_message，现与文档一致。

## 关闭回写

- parity-audit 的 F1/F3 标记已修。
