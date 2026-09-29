---
kind: issue
title: stage 屏障（源 MUL-3508）：有序子组、最低未完 stage 关闭才唤醒父
type: feature
status: closed
created: 2026-09-29
---

# stage 屏障（源 MUL-3508）：有序子组、最低未完 stage 关闭才唤醒父

> **读者：** 接手的人——`issue.stage` 列 123 迁移搬来、row 读到，协议与行为零暴露。这是子 issue 的**有序分组**+父唤醒门。

## 源语义（issue_child_done.go 全读）

**屏障判定 `stageBarrierClosed`**：

- 无 staged 子（全 NULL）→ 全体 terminal 即"隐式单一 stage"关闭（最后一只完成时才醒一次——修 #4320 的逐子轰炸）。
- staged 集：完成的子**自身无 stage → 关不了任何屏障**；有 stage s → 所有 `stage ≤ s` 的子全 terminal 才关闭。**更低 stage 有非 terminal 子 → 屏障不开**（前沿推进语义）。
- cancelled 也是 terminal 子（永不完成的兄弟不能卡住 stage）。

**触发守卫（通知+唤醒两路都过）**：

- 子**进入** terminal 的迁移才算（terminal→terminal 幂等零再发）。
- 父 must 有 parent_issue_id；父状态 done/cancelled → 跳过；父 **backlog → 跳过**（#4320：泊着的父不被自动激活，直到人显式挪出）；父 assignee 是 human → 跳过（人自己读时间线，系统评论是噪音）。
- 系统评论**直接写库**（绕过 comment 触发路径），mention 父 assignee；评论+唤醒失败 best-effort（warn+吞，不回滚用户的状态写）。
- agent 父 assignee 的唤醒**故意无自触发守卫**（MUL-2808：子→父是两个 issue 间的串行交接，同 agent 自拆自省是唯一唤醒路径），靠 pending-task 去重防失控。

**评论文案**：stage N complete/closed + 每阶段 done/cancelled 计数 + 下一未完 stage 提示 + `multica issue status <parent> in_review` 指令。

## 收法（对齐我们的形）

- store：`#afterStatusWrite` 挂 child-done 评估——子进入 terminal 且父过守卫且屏障关闭 → 系统评论（authorType=system、mention 父 assignee 的 markup）+ `createTask`（agent 父 assignee，trigger_summary=`child_done`，context 带 parent/child/closedStage）。
- 协议：issue summary + create/update 请求加 `stage`（nullable）；store 的 issue 写点透传。
- UI：详情页 Sub-issues 段按 stage 分组显示（"Stage 1 · 2/2 closed"行头）；子 issue 创建/编辑可设 stage（CLI `--stage`）。
- 系统评论的 comment 触发豁免：child-done 评论不带 run（系统评论不进 mention 触发路径——源同"smuggled mentions 不点火"）。

## 验证

- 单测：屏障判定矩阵（unstaged 全终/最后一只、staged 低阶卡、staged 完成、cancelled 关门）、父守卫四分支、幂等（terminal→terminal）、系统评论文案与归属；
- 真机：两 stage 各两子 → stage1 关 → 父收评论+agent 唤醒；stage2 未完不醒。

## 执行记录

- **迁移 552**（真缺陷）：源 107（comment.author_type 加 'system'、零 UUID author_id）从未翻译——001 冻结了两值 CHECK，屏障的系统评论直接死在约束上。sqlite_master 取现形 rebuild 加宽（551 同法），链测 42/42。
- store：`#notifyChildDone` 挂 `#afterStatusWrite`（best-effort try/catch 吞错不回滚状态写——源同）；屏障判定前沿语义（stage ≤ s 全 terminal）、unstaged 单隐式组、四守卫（父 closed/backlog/human、terminal→terminal 幂等）、系统评论 mention 父 assignee、agent 直建任务 / squad 路由 leader（**无自触发守卫**——MUL-2808 语义照搬）。
- create 带 stage（INSERT 列补）；summary/协议/client/CLI `--stage` 透传（client 逐字段构造两处都改——第 5 处漏的教训已进 notes）。
- UI：Sub-issues 段 StagedChildren 分组渲染（unstaged 平铺 + 每组行头"Stage N · x/y closed"）。
- 测试：stage-barrier.test 4 例矩阵（unstaged 最后一醒、低阶卡前沿、幂等、backlog/human 父惰性）。
- 真机：两 stage 父+agent assignee——stage2 全完零评论零任务；stage1 关 → 1 系统评论（"Stage 1 of this issue is complete (3/3)…"）+ 1 child_done 任务。UI 两分组行头与系统评论渲染成立。
- 调试教训：吞错的 catch 是黑洞（先插探针再见错），测试对 create 默认 backlog 的父必须显式挪出。
