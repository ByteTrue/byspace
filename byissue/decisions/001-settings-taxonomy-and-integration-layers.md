---
kind: decision
title: "设置层级三层规则与终端集成落 provider 弹层"
created: 2026-09-24
superseded-by: ""
---

# 设置层级三层规则与终端集成落 provider 弹层

Host 设置按三层收敛：**一级 = 用户任务**（Overview / Projects / Connections / Agents / Usage），**二级 = 同一任务内的视角切换**（页内小节或 tab），**三级 = 逐个对象**（provider 详情弹层）。归类靠「是不是同一个任务」而非「是不是同一个名词」——Providers 与 Agent 编排是同一任务（本机有哪些 agent 客户端、BySpace 怎么和它们集成），故折叠进 Agents 页；Usage 是只读报表不是设置，保持独立。逐 provider 的终端集成（activity hooks、该 provider 的启动命令）放 provider 详情弹层的 Terminal tab，不做页面级大 tab——那会要求 tab 可 URL 寻址，且强迫用户在 per-provider 配置间横跳。

**同时拍板：terminal activity hooks 与 `providers[x].enabled` 永不联动。** enabled 的语义是「在 BySpace 里可不可选」，不是「装没装」；关掉某 provider 仍要它的终端上报是合法用法。

## 背景

讨论见 `../talks/003-host-settings-consolidation.md`。「一级分类尽量少」单独存在没有停止条件（会一路并到 2 个分类），三层规则是它的边界。
