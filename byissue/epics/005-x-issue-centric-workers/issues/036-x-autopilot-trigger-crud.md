---
kind: issue
title: autopilot trigger 增删面（源 AddTriggerDialog + 行删除）
type: feature
status: closed
created: 2026-09-29
---

# autopilot trigger 增删面（源 AddTriggerDialog + 行删除）

## 源形

详情页 Triggers 段：行列表 + Add trigger 对话框（kind=schedule|webhook；schedule 经 ScheduleConfig 转 cron；webhook 带 signing secret）+ 行内删除。

## 我们原状

只读行列表；创建 autopilot 时可带一个 cron；无增删面；store 有 create 无 delete。

## 收法（含偏离）

- store 补 deleteAutopilotTrigger（行删除即停该触发，源同）。
- RPC 两对：trigger.create（kind 限 schedule；cron+timezone+label）与 trigger.delete；webhook/api 行的创建**不建**——dispatch 未建（欠账），建了是不跑的空壳行；删除对任何行开放。
- UI：Triggers 段加 Add 行（cron+timezone+label 三输入）与行内 delete。

## 验证

- 单测：delete 后 list 不见、未知 id 报错；
- 真机：加一条 cron 触发见行与 next_run、删除行消失。

## 执行记录

- store：deleteAutopilotTrigger（行删除即停该 firing；未知 id 报错）。
- RPC 两对 trigger_create/trigger_delete（create 限 schedule；webhook/api 不建——dispatch 未建，空壳行是更坏的诚实）；trigger summary 抽 named schema 供复用（**TDZ 教训再犯**：named schema 插在使用点之后，AOT 生成器 ReferenceError 顶出——生成器过≠union 对的家族又一例）。
- **真机抓到的真缺陷**：我的 trigger_create handler 未算 next_run_at（create 路径算了，我漏）——行建了但永不 fire。修：插入时 computeNextRunAt，与 create 路径同。这类"行在但行为死"的缺陷只有真机看 next_run_at 列才现形。
- UI：Triggers 段=行列表+行内 delete+底部 Add 行（cron 输入）。
- CLI 无关：源 CLI 无 trigger 增删命令（UI-only），我们不补。
- 单测：加删落 list、未知 id 报错。真机：加 "0 7 \* \* \*" 行见 next_run 非空、删除行消失；验证残留 probe autopilot 已归档。
