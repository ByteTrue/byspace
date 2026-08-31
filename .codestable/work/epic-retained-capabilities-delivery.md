---
title: 保留能力交付路线 · Work
status: approved
spec: ../epics/002-o-retained-capabilities-delivery/spec.md
source_revision: f592e54bf43e5501383224891053d2e0a9dfbf45
approved_revision: 1e4d1e9a4e45cb674b89559aa49506584e9cc714e232e8d2347cb86a4124e1ea
item_progression: sequential
commit_strategy: semantic-atomic-per-item
publish_strategy: epic-plan-pr-then-one-pr-per-wave
current_wave: 1
current_item: ITEM-01
blocked_by: planning_pr_merge
next_action: 提交并合入 approved Epic 规划 PR；随后从最新 main 启动 ITEM-01
---

# Epic Work: 保留能力交付路线

## 当前状态

- Owner 已批准永久 Epic、5 个 Wave、21 个 ITEM 及推荐执行策略。
- 34 个保留 ID 已唯一映射到 21 个 ITEM。
- Fresh design review `a86fc285-9028-4634-85f9-661375af1b24` 返回 `verdict=pass`，无 blocking/important finding；两项 minor 已修正。
- 执行策略已锁定：sequential ITEM、每 ITEM 语义原子 commit、每 Wave 独立 PR。
- 当前授权只覆盖规划 PR；合入前仍不得修改 runtime、协议、UI 或基础设施。

## Wave 1 · 发布通道路由与远程连接安全

- [ ] ITEM-01 · RELEASE-01 · B01
- [ ] ITEM-02 · RELAY-02 · R03
- [ ] ITEM-03 · RELAY-01 · R02

## Wave 2 · Terminal 性能与恢复基础

- [ ] ITEM-04 · TERM-01 · T01/T02/T08/T09/T16
- [ ] ITEM-05 · TERM-02 · T03/T04/T05
- [ ] ITEM-06 · TERM-05 · T10/T12

## Wave 3 · Terminal 功能与呈现

- [ ] ITEM-07 · TERM-03 · T06
- [ ] ITEM-08 · TERM-04 · T07
- [ ] ITEM-09 · TERM-06 · T11
- [ ] ITEM-10 · TERM-07 · T13/T14/T17
- [ ] ITEM-11 · TERM-08 · T15/T18

## Wave 4 · Agent、Session 与 Timeline

- [ ] ITEM-12 · AGENT-03 · A06/A07/A08
- [ ] ITEM-13 · AGENT-02 · A05
- [ ] ITEM-14 · AGENT-04 · A09
- [ ] ITEM-15 · AGENT-01 · A04

## Wave 5 · Workspace、侧栏与 Compact UI

- [ ] ITEM-16 · WORKSPACE-03 · W04
- [ ] ITEM-17 · WORKSPACE-01 · W01
- [ ] ITEM-18 · WORKSPACE-04 · W05（仅 hover 展示全部 Agent 精确状态）
- [ ] ITEM-19 · WORKSPACE-02 · W02
- [ ] ITEM-20 · WORKSPACE-05 · W14
- [ ] ITEM-21 · UI-01 · U03/U05

## 规划证据

- 起点：PR #13 merge `f592e54bf43e5501383224891053d2e0a9dfbf45`。
- 当前 App URL 已由 `packages/protocol/src/release-channel.ts` 按版本区分 Stable/Beta。
- 当前 Relay 默认仍在 protocol/server/CLI 多处使用 `relay.byspace.cc.cd:443`；ITEM-01 必须收敛为单一版本路由，而不是增加更多散落判断。
- 当前 `ConnectionOfferV2Schema` 没有 hostname；ITEM-03 必须走 optional append-only 协议演进。
- Terminal、Timeline、Hover、Mobile Panels 均已有现行 canonical docs；实现不得以旧快照覆盖这些不变量。

## Owner 首次批准

1. 已同意 5 个 Wave 和 21 个 ITEM 的范围及顺序。
2. `item_progression = sequential`。
3. `commit_strategy = semantic-atomic-per-item`。
4. `publish_strategy = epic-plan-pr-then-one-pr-per-wave`。
5. 本次批准先提交/合入 Epic 规划；实际实现按 Wave 推进。

## 变更日志

- 2026-08-31：从已验收盘点 Epic 创建 proposed 交付 Epic；尚未实施。
- 2026-08-31：Fresh design review 通过；明确 W04 六组 Git fixture，并纠正旧矩阵中遗漏 OpenCode hook registry 的事实。
- 2026-08-31：Owner 批准 Epic 及推荐策略；ITEM-01 进入 queued 状态，等待规划 PR 合入。
