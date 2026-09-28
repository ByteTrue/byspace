---
kind: issue
title: 端到端叙事验证：老板→秘书→建组派活→回报→收件箱→处理
type: verification
status: closed
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

## 执行记录（链逐环证据）

1. **老板点名**：issue #12 建立后 `comment send --mention "Chief of Staff"` —— 首探失败暴露 mention 语法偏离（裸名截断），020 修后 markup 叫醒成立（run running→completed，评论带完整 markup）。
2. **秘书拆派**：她的 run 建两子 issue（#13 inventory→Editor、#14 release note→Editor），把 #12 移 in_progress，评论汇报路由决定，并对子 issue 注册 event wakeup（三行 issue_wakeup，enabled=1）。
3. **worker 执行与回报**：Editor 的 #13/#14 run 均 completed，评论归属 agent（attribution 链工作）。
4. **秘书自主跟进**：#13 完成后 wakeup receipt 落（#14 上 receipt=1），tick 叫醒她的第二个 run（186cd7b0）；她读 #13 的回报、逐条核对库存与板面、把措辞选择以 action_required 放上老板收件箱（d3ed6683，指向 #14 的两版草稿），并在 #14 留下验证报告与"等老板选择"的下一步。
5. **老板处理**：console inbox 面见该项（Needs you），开详情后点归档；DB read 保持 0、archived=1（老板的归档，非 agent 的），live 面清空。截图 /tmp/ours-inbox-final.png。

## 链上抓到并修的两处（已各自成 issue）

- **020 mention 语法**：裸名 @ 与源 markup 不符，多词名截断即"叫不醒"；链的第一环因此断过一次。
- **021 inbox 读管面**：修 020 前的探针证明 run 会话能读老板队列（真机 ls 返回过该项）；秘书的指示与行为也把 inbox 当自己的工具面（transcript 里她读 --help 并规划用法）。收为 owner-only：读/标/归档/mark-all 拒绝 run 会话，create 保留。

## 边界注记（dev 形态，非缺陷）

秘书的 run 会话里读了仓库源码核对 CLI 语义 —— 因为 dev home 的 issue workspace 落在 repo worktree 内。生产形态（BYSPACE_HOME 在 repo 外）workspace 与源码分离，此面自然消失；不改机制，仅记形态差。

## 结论

六环全通，证据在 DB（task/wakeup/receipt/inbox 行）、transcript（她的动作序列）、console（末环点击与截图）。链的断点都出在**我偏离源的地方**（语法、身份面），不在抄来的机制 —— 这正是"先照抄再改"纪律的价值实证。

## 关闭回写

- Epic 005 收尾：progress 表与质量承诺核对；本 issue 的证据成为收尾依据。
