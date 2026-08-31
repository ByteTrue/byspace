---
title: 保留能力交付路线 · Work
status: approved
phase: executing
spec: ../epics/002-o-retained-capabilities-delivery/spec.md
source_revision: f592e54bf43e5501383224891053d2e0a9dfbf45
approved_revision: 522c41c499b7c193899e11601816edbe9aa50249e0253da14140679431f3121c
item_progression: parallel
milestone_commit: authorized
remote_publish: each-milestone
commit_strategy: semantic-atomic-per-item
publish_strategy: epic-plan-pr-then-one-pr-per-wave
current_wave: 1
current_item: ITEM-01
active_items:
  - item: ITEM-01
    state: integrating
    run: native worker 2da13fbf-181a-4a81-84cd-696e764307d8
    workspace: /Users/zijie/workspace/projects/byspace-worktrees/epic-002-wave1-item01
    base: 5dc678bdefb77e52fe729c00b8034eb89ad7f7de
blocked_by: null
next_action: 以已核验 patch 串行收割 ITEM-01，在集成结果上重跑 focused tests 与静态门槛后创建语义原子 commit
---

# Epic Work: 保留能力交付路线

## 当前状态

- Owner 已批准永久 Epic、5 个 Wave、21 个 ITEM 及推荐执行策略；规划 PR #14 已合入。
- 34 个保留 ID 已唯一映射到 21 个 ITEM。
- Fresh design review `a86fc285-9028-4634-85f9-661375af1b24` 返回 `verdict=pass`，无 blocking/important finding；两项 minor 已修正。
- Wave 1 从 exact-main CI 绿色 commit `5dc678bdefb77e52fe729c00b8034eb89ad7f7de` 开始。
- Owner 已选择 parallel 推荐方案 A：最多两个 writer，按 worker 完成顺序串行集成。
- Bounded-parallel contract review 同 lineage round 2 已通过：0 blocking / 0 important；路径级所有权、canonical 集成规则与恢复状态机已生效。
- ITEM-01 worker 与 fresh change review 均已完成，既有 connection-offer daemon E2E 3/3 通过；当前进入父流程串行集成。

## Wave 1 · 发布通道路由与远程连接安全

- [ ] ITEM-01 · RELEASE-01 · B01 · integrating
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

## 活跃委派

- `ITEM-01`
  - state：`integrating`；父流程已取得唯一串行集成焦点。
  - worker：native worker `2da13fbf-181a-4a81-84cd-696e764307d8`（completed）。
  - reviewer：fresh reviewer `2830ea2b-2be9-4414-b292-5ba50517957b`（pass，0 blocking / 0 important）。
  - workspace：`/Users/zijie/workspace/projects/byspace-worktrees/epic-002-wave1-item01`。
  - branch：`item/epic-002-01-release-channel`。
  - base：`5dc678bdefb77e52fe729c00b8034eb89ad7f7de`。
  - scope：只允许 ITEM-01 实现与 focused tests；不得修改 `.codestable`、commit、push、PR、基础设施或 ITEM-02/03。
  - validation：worker focused tests/build/typecheck/lint 已通过；既有 `packages/server/src/server/daemon-e2e/connection-offer.e2e.test.ts` 在同时指向 ITEM-01 Protocol 与正确 Server package-local dependencies 的临时模块视图下 3/3 通过。该用例仅回归 Server pairing/connection offer 对 endpoint utility 的消费，未新增或修改 ITEM-03 hostname schema。

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

## Owner 追加批准

1. `item_progression = parallel`，最多两个 writer。
2. Worker 交付按完成顺序进入单一串行集成队列。
3. 只允许永久 Epic 中 Wave 3、Wave 4 与 Wave 5 的具名 lane；超出路径所有权立即 stop-to-serial。
4. `milestone_commit = authorized`、`remote_publish = each-milestone`、每 ITEM 语义原子 commit 与每 Wave 一个 PR 保持不变。

## 变更日志

- 2026-08-31：从已验收盘点 Epic 创建 proposed 交付 Epic；尚未实施。
- 2026-08-31：Fresh design review 通过；明确 W04 六组 Git fixture，并纠正旧矩阵中遗漏 OpenCode hook registry 的事实。
- 2026-08-31：Owner 批准 Epic 及推荐策略；ITEM-01 进入 queued 状态，等待规划 PR 合入。
- 2026-08-31：规划 PR #14 合入；CI 修复 PR #15 合入后 exact-main CI `33362367443` 在 `5dc678bdefb77e52fe729c00b8034eb89ad7f7de` 通过。
- 2026-08-31：从绿色基线创建 Wave 1 集成分支并将 ITEM-01 委派到独立 worktree。
- 2026-08-31：Owner 选择 parallel 推荐方案 A；按完成顺序串行集成，最多两个 writer，Wave 3/4/5 只使用永久契约中的具名 lane。
- 2026-08-31：Bounded-parallel contract review 首轮要求补齐结构化 `active_items`、路径级所有权和 canonical 集成/回滚规则。
- 2026-08-31：同 lineage round 2 通过（0 blocking / 0 important）；机械 minor 已吸收，ITEM-01 进入父流程串行集成。
