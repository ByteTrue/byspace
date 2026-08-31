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
current_wave: 2
current_item: null
active_items: []
blocked_by: null
next_action: 创建并合入 Wave 2 PR；exact-head CI 全绿后推进 Wave 3
---

# Epic Work: 保留能力交付路线

## 当前状态

- Owner 已批准永久 Epic、5 个 Wave、21 个 ITEM 及推荐执行策略；规划 PR #14 已合入。
- 34 个保留 ID 已唯一映射到 21 个 ITEM。
- Fresh design review `a86fc285-9028-4634-85f9-661375af1b24` 返回 `verdict=pass`，无 blocking/important finding；两项 minor 已修正。
- Wave 1 从 exact-main CI 绿色 commit `5dc678bdefb77e52fe729c00b8034eb89ad7f7de` 开始。
- Owner 已选择 parallel 推荐方案 A：最多两个 writer，按 worker 完成顺序串行集成。
- Bounded-parallel contract review 同 lineage round 2 已通过：0 blocking / 0 important；路径级所有权、canonical 集成规则与恢复状态机已生效。
- ITEM-01 已通过 worker 验证、fresh change review、connection-offer daemon E2E 和集成分支静态门槛，并以 reviewed patch 完成串行集成（`976480bd60c37c43d55e98b17f41b9e62778bdc9`）。
- ITEM-02 已通过 worker TDD、父流程 Host Runtime 验证、fresh security review 和集成静态门槛；reviewed patch 已以 `fe45b78e6e3819a02422b09566bfa04d7dd8867e` 完成串行集成。
- ITEM-03 已通过 fresh compatibility review（0 blocking / 0 important）、Protocol 8/8、App 69/69、完整 `build:server`、Server E2E 3/3 和集成分支静态门槛；reviewed patch 已完成串行集成。
- ITEM-03 read-only scout 已完成 optional hostname 的协议/客户端接缝与兼容测试包，没有修改文件。
- Wave 1 PR #16 已由 reviewed head `db08188e9b0be50d4d966eac0851ab44aa2a5ecb` 合入 `main`，merge commit 为 `0d81e9fa376a2fb98518e94b5080d97440371811`；post-merge exact-SHA CI `33375176914` 与 Docker `33375176920` 均通过。
- Wave 2 从上述绿色 `main` 创建；ITEM-04 已取得 Node、Browser Direct、本地 Wrangler Relay/E2EE 与 exact-head Windows 证据。Desktop-web 超大 turn hard cap 已在 Windows 将组合 workload 的 `longTaskMaxMs` 从 `1343` 降到最终 `478`（Direct）/`794`（Relay），`rafMaxGapMs` 从 `1379.3` 降到最终 `706.8`/`999.9`；canonical xterm buffer 完整性 oracle 在两种 transport 均确认 1,000/1,000 输出与 24/24 echo，无 duplicate、out-of-order 或 mismatch。Exact-head run `33405590748` 全绿，final aggregate review `caf8c1ed-6591-4d97-8afb-0758a6fa2d11` 判定 PASS（0 blocking / 0 important）。
- ITEM-05 已完成 retained renderer 恢复与 revision gap replay：隐藏/返回不 reset，共享 renderer 保留 1,500 行并只补一次 gap；1MB backlog 不连续、终端退出、完整 transport 丢失或 backpressure overflow 均回退权威 snapshot。Protocol 8/8、App 12/12、Server 128/128、Direct/Relay 各 1/1、Build/Typecheck/Lint/Format 全绿；Round 2 review `31a2f709-a9d9-47ec-ad24-421ea8b82986` 为 PASS（0 blocking / 0 important）。
- ITEM-06 已完成 Windows/ConPTY 多行文本 paste fallback：keyboard、context menu 与 imperative paste 汇入同一 framing 策略，单行/非 Windows 保持 xterm 原路径，reload mode replay 与无 mode fallback 均由真实 PTY byte oracle 覆盖。Reviewer `19112db0-a596-443a-b414-bf6ca9c9cb1f` 为 PASS（0 blocking / 0 important）；exact-head Windows run `33425004246` 在 source milestone `055d0000b` 上 Direct/Relay 各 5/5 全绿。
- Wave 2 frozen aggregate patch `3ed57574257c38e18d6fcbd98f9ccc7ec95300167e034ce960805d16ab9cbf30` 经 reviewer `91c20656-547e-43b0-b027-f74b57daebec` 审查为 PASS（0 blocking / 0 important）；ITEM-04/05/06 的协议兼容、backlog/reconnect 生命周期、renderer/paste 交互、性能 oracle、CI gating 与文档证据均通过交叉核对。

## Wave 1 · 发布通道路由与远程连接安全

- [x] ITEM-01 · RELEASE-01 · B01 · integrated
- [x] ITEM-02 · RELAY-02 · R03 · integrated
- [x] ITEM-03 · RELAY-01 · R02 · integrated

## Wave 2 · Terminal 性能与恢复基础

- [x] ITEM-04 · TERM-01 · T01/T02/T08/T09/T16 · reviewed and integrated
- [x] ITEM-05 · TERM-02 · T03/T04/T05 · reviewed and integrated
- [x] ITEM-06 · TERM-05 · T10/T12 · reviewed and integrated

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

- ITEM-05 唯一 writer lineage 首轮 `1619df3f-b0f3-4fef-8811-3aa52a0ef803`、续跑 `b779914e-c2cd-46cf-9e96-dac86c08791a` 在隔离 worktree `epic-002-wave2-item05` 建立 RED 并完成首轮实现；父流程在 runner settlement 后接管。首轮 reviewer `6fcf9c03-e55c-49dd-b452-bdd67f2490a7` 提出的 stale preamble 与 overflow-resume 两项 important 均经专门 RED 修复；Round 2 `31a2f709-a9d9-47ec-ad24-421ea8b82986` 返回 PASS（0 blocking / 0 important）。最终 21-path manifest 为 `849c36c761f99fb728dca39e494120f59ff695b2310d90378fae34e88b60fe67`。
- ITEM-06 在隔离 worktree `epic-002-wave2-item06`（base `159a70640`）串行执行；scout workflow `dec0aff1-0930-4a1f-9018-98686354501a` 分别审计当前 runtime/E2E seam 与历史 T10/T12 边界。两个 scout 均确认 T10 已在 tracker/restore preamble，缺口仅为 T12 Windows 多行 framing，且不得整体移植图片 scope；唯一 writer `94da2f9c-f5d0-4a06-babe-8f3eb84cf63d` 完成 RED→GREEN，父流程修正非 Windows listener 与 mode replay 测试保真后冻结 7-path patch `ba654cd7…fa6aa`；reviewer `19112db0-a596-443a-b414-bf6ca9c9cb1f` 返回 PASS（0 blocking / 0 important），source milestone `055d0000b` 经 exact-head Windows run `33425004246` 验证并完成串行集成。
- Wave 2 aggregate reviewer `91c20656-547e-43b0-b027-f74b57daebec` 审查 base `0d81e9fa3` 至 frozen head `35a0c1341` 的 9 commits / 46 paths，返回 PASS（0 blocking / 0 important）。其 Playwright JSON reporter 环境变量疑问已由锁定版本源码 `node_modules/playwright/lib/reporters/base.js` 核实：当前版本正式读取 `PLAYWRIGHT_JSON_OUTPUT_FILE`，无需改动。
- ITEM-04 worker lineage：首轮 `557f41e3-cf60-4bfa-a1f5-f43eb405109a`，round 2 `980c4c05-9d0d-4831-9d99-b9b2369e9d03`，round 3 `5caaae27-606f-461a-a9f4-90dae2b57409`。父流程接管后修复跨平台 fixture、真实 Relay/E2EE、完整性断言、teardown 与 trace 隔离。
- ITEM-04 independent reviewer `43a46b21-f879-4943-b0eb-4048af658d25` 对 base `0d81e9fa3` 上 20-path frozen manifest 返回 pass：0 blocking / 0 important。集成 Lint 随后发现 Relay readiness helper 的共享 resolver 触发 `promise/no-multiple-resolved`；父流程改为三个独立 Promise 的 race，targeted Lint、App Typecheck 和真实 Relay/E2EE 2/2 通过，同 reviewer 复审该单文件修正仍为 pass。最终 manifest 为 `3eb63d3e…d95df6`。
- ITEM-04 read-only audit workflow `0d44efcb-871f-4ffd-80c9-516689703922` 与 minimization review 均已完成；没有稳定分段产品 RED 前不得修改 Terminal/Git/Relay/renderer 热路径的边界得到遵守。
- Windows run `33395542756` 提供稳定 desktop-web renderer RED 后，worker `d9836ea7-92ab-49c2-b52f-4435b610a8ce` 以 TDD 实现超大单 turn hard cap；independent reviewer `aa4c01cd-204f-443c-9350-63f8092245e7` 对冻结 patch `b0f6c892b5068c2c026d3020a860a62eaa750729eb5d5621be7f2552a63af736` 判定 pass（0 blocking / 0 important）。
- Windows run `33398770223` 显示 hard cap 已通过 1 秒 smoothness 门槛；worker `bc6e03ab-4e53-4ef2-8df1-28579fdb1753` 将完整性 oracle 从 raw VT/ConPTY frame 拼接迁到 workload 完成后的一次 canonical xterm buffer 读取。Independent reviewer `25648c01-e53e-43b1-b7a9-b1e78539df10` / resumed `1afb8977-35e6-406c-bf8a-ab44eeec33e8` 对冻结 patch `614f50d8…181ebe9` 判定 pass（0 blocking / 0 important）。

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
- 2026-08-31：ITEM-01 worker `2da13fbf-181a-4a81-84cd-696e764307d8` 与 reviewer `2830ea2b-2be9-4414-b292-5ba50517957b` 完成；reviewed patch `036df3112dbb754078ae10e43b1e7b48f7a438a02a3b66bad28b1b394bf0039a` 经 29 个 Protocol、17 个 Server config、6 个 CLI 与 3 个 connection-offer E2E 验证，集成 Build、Typecheck、Lint 通过。
- 2026-08-31：从 ITEM-01 milestone `976480bd60c37c43d55e98b17f41b9e62778bdc9` 创建 ITEM-02 writer worktree 与 ITEM-03 detached read-only scout worktree。
- 2026-08-31：ITEM-02 worker `c2e38a29-ce22-4a0a-99f4-f3b0c937895d` 交付；focused utility 12/12 与 App Typecheck/Lint/Format 通过。父流程确认先前 Host Runtime 收集失败源于从仓库根绕过 App Vitest config；以显式 App config 重跑 `host-runtime.test.ts` 67/67 通过，临时 symlink 已清理且 frozen patch SHA 保持 `0fa84e1b…9497fe`；fresh security reviewer `3cf260f5-f81b-4db9-b28d-590fa705d7c3` 判定 `pass`（0 blocking / 0 important）；集成 Format、Typecheck、Lint 与 source patch 字节一致性通过；语义原子提交为 `fe45b78e6e3819a02422b09566bfa04d7dd8867e`；ITEM-03 scout `af0a1e45-16a7-415a-b2d6-a607ff1f5563` 同时完成只读实现包。
- 2026-08-31：清理 ITEM-02 worktree 后从 `fe45b78e6e3819a02422b09566bfa04d7dd8867e` 创建 ITEM-03 writer worktree；worker `b7b9a314-7e01-4778-8a9d-f3d7b11977f0` 按 optional append-only 协议演进与 client label precedence 任务包开始执行。
- 2026-08-31：ITEM-03 worker 交付六文件候选；Protocol 8/8、App Host Runtime 69/69、Server producer smoke、targeted lint/format/diff-check 通过；Server E2E 的错误 TTLCache 与跨 workspace typecheck overlay 由父流程在冻结 diff 后复验。
- 2026-08-31：父流程在 worktree-local internal package view 中完成完整 `build:server` 与 Server pairing-offer E2E 3/3，清理后 frozen SHA 保持 `ebd95b72…0bed8`；fresh compatibility reviewer `75befb32-2916-4a92-a998-b80e7286ef72` 裁定 `pass`，ITEM-03 进入串行集成。
- 2026-08-31：ITEM-03 reviewed patch `ebd95b72…0bed8` 收割后经全仓 Format、`build:server`、Typecheck 与 Lint 验证，source bytes 保持一致；ITEM-03 状态推进到 `integrated`，Wave 1 三个 ITEM 全部完成。
- 2026-08-31：Wave 1 aggregate review 通过（0 blocking / 0 important）；PR #16 exact-head checks 在已知 Timeline E2E flaky 的单 job 重跑后全绿并合入。相同 Timeline 测试已在 exact PR head 以 2 workers、0 retry 连续通过 20/20。Post-merge exact-SHA CI 与 Docker 均通过，Wave 1 分支已清理。
- 2026-08-31：从绿色 merge commit `0d81e9fa376a2fb98518e94b5080d97440371811` 创建 Wave 2 集成分支；ITEM-04 按 `cs-issue` 先做 Direct/Relay 分段与 Windows 等价证据只读审计，没有测量 RED 前不改 Terminal 热路径。
- 2026-08-31：ITEM-04 父流程验证 Node L0/L1/L2 echo p95 为 3.44/3.48/3.43ms；Browser Direct 3/3 与本地 Wrangler Relay/E2EE 3/3 均通过。Stress 在两个 transport 下均确认 Terminal 1,000/1,000 输出、24/24 输入、1,007 Agent stream events、约 256KB 单消息、0 snapshot/restore、0 个 >=1s 主线程停顿；Direct/Relay 最大 Long Task 分别为 264ms/199ms。Workflow contracts、focused Vitest、Build、Typecheck、Lint 与 Format 全绿。
- 2026-08-31：初始候选完整内容 manifest 为 `f4d1b56d02086cd07e5e39f1d9f8c339fb35643bee6794b3d40a836990121e96`（20 paths，含 5 个新增文件）；independent reviewer `43a46b21-f879-4943-b0eb-4048af658d25` 判定 pass，0 blocking / 0 important。集成分支完整 Lint 暴露 Relay readiness helper 的 `promise/no-multiple-resolved`，父流程以三路 Promise race 做最小修正；targeted Lint、App Typecheck、真实本地 Relay/E2EE performance 2/2（50,000 行 3.96MB/s，echo p95 10.1ms）与 reviewer 同 lineage 复审均通过。最终 20-path manifest 为 `3eb63d3ef90188bac1ce9f354987e4d2a068e15bf6e6b9e27c549aa144d95df6`；等待 milestone exact-ref Windows CI 后关闭 ITEM-04。
- 2026-08-31：提交并推送 exact HEAD `97671daa8551fe0fc0551b2909d640af3f22dee8` 后，Windows workflow run `33392118839` 的 job `94812205263` 在 Direct 组合 workload 触发固定 smoothness gate：1,000/1,000 输出与 24/24 输入仍完整有序，但 `rafMaxGapMs=1659.1`、`longTaskMaxMs=1602`，xterm commit p95 `359.4ms`；同一 artifact 中 daemon-only L0/L1/L2 约 2.29MB 均在 `254-270ms` 排空、echo p95 约 `16.5ms`、ping p95 `1ms`。独立 50,000 行样本的 `16.883s` 同时包含每 50ms 全量扫描增长中 xterm scrollback 的观察者开销，因此先把最终标记检测改为仅检查光标附近固定上限的末尾窗口，再重跑 exact-head Windows 门槛；不把未经净化的 `0.03MB/s` 直接归因为产品热路径。
- 2026-08-31：有界 terminal-tail observer 在本地真实 Direct 与 Wrangler Relay/E2EE 复验通过：两种 transport 均为 3/3，50,000 行分别在 `117ms`（4.80MB/s）和 `110ms`（5.11MB/s）完成；组合 workload 仍完整接收 1,000 输出、24 输入、1,007 Agent events 与约 256KB 单消息，Direct/Relay 最大 Long Task 分别为 `326ms`/`183ms`。该修正只去除测量观察者效应，不降低 workload 或 smoothness 门槛；independent reviewer `6e2dc4da-093a-4c0f-a47b-056e4eb205f4` 判定 pass（0 blocking / 0 important）。下一步以修正后的 exact head 重跑 Windows，若组合 workload 仍红则进入产品 reducer/render 热路径修复。
- 2026-08-31：修正后 exact-head Windows run `33395542756`（`80e5b26cf56e7ecb67725d440d76fb85f4df8479`）仍 RED：组合 workload 的 1,000 条 Terminal 序列与 1,007 条 Agent 帧均完整到达，但页面实际挂载同一 turn 约 1,000 个 todo activity 行，产生 `rafMaxGapMs=1379.3` / `longTaskMaxMs=1343` 并阻塞最终 sentinel；独立 50,000 行 throughput 为 `18.474s`（仍低于 30s gate），keystroke p95 `5.9ms`，Node L0/L1/L2 正常。由此把组合故障收敛到 desktop-web 超大单 turn 绕过 partial virtualization，而非 wire/daemon/observer；在隔离 worktree `epic-002-item04-web-virtualization` 按 RED contract 修复，并给 throughput case 增补无额外轮询的 runtime trace artifact。
- 2026-08-31：超大单 turn 修正的 focused model test 10/10、targeted Lint、App Typecheck、Format 与 diff-check 通过；冻结 patch `b0f6c892…af736` 获 independent review pass。集成分支本地真实 Direct browser 回归 3/3：组合 workload 完整接收 1,000 输出、24 输入与 1,007 Agent events，最大 rAF gap `248.2ms`、Long Task `153ms`、0 snapshot/restore；50,000 行 `109ms`（5.15MB/s），keystroke p95 `9.2ms`。下一门槛为修正后 exact-ref Windows Direct/Relay。
- 2026-08-31：修正后 exact-head Windows run `33398770223` 的独立 throughput/latency 与 Relay 均通过，组合 workload 也以 `rafMaxGapMs=485.4`、`longTaskMaxMs=451` 通过响应性门槛；最终截图可见 `OUT:999`，但 raw `terminal_output` 拼接被 Windows ConPTY repaint/control sequences 误解析成 44 duplicates、45 payload mismatches 与 1 out-of-order。历史 run `33395542756` 同一 raw oracle 又在 1,000/1,000 序列完整时漏掉已呈现在 xterm buffer 的 DONE marker，确认这是测试 oracle 缺陷而非产品数据损坏。修正只在 DONE 可见、Agent workload 结束后读取一次 canonical xterm buffer 并拼接 soft-wrapped rows，完整性断言仍要求 1,000 输出、24 echo、单一 DONE 与有效 digest；raw frame/write trace 继续独立承担 latency/transport 指标。本地 Direct 1/1 返回 1,000/24/valid digest、1,007 Agent events、`rafMaxGapMs=244.4`、`longTaskMaxMs=146`，App Typecheck、targeted Lint、Format 及 independent review 全绿。
- 2026-08-31：canonical integrity probe 以 `e1a651382` 推送后，首次 Windows exact-head run 暴露 teardown 中 `taskkill` 已终止进程但返回非零的竞态；本地 fake-taskkill RED 复现后，`killProcessTree` 仅在目标 PID 已退出时接受该非零结果，仍会抛出存活进程的真实失败。修复提交 `0d0dd540e` 的 exact-head Windows run `33405590748` 全绿：Node L0/L1/L2 各 100/100 echo，p95 `16.79/16.73/16.4ms`，每级约 `2.29MB` burst 且 `0 snapshot`；Direct/Relay 组合 workload 均为 1,000/1,000 输出、24/24 echo、单一有效 digest、0 duplicate/out-of-order/mismatch，rAF 最大间隙 `706.8/999.9ms`，Long Task 最大 `478/794ms`；普通逐键 p95 `6.5/9.4ms`。Windows 软件渲染下 50,000 行仍耗时 `10.6–14.7s`，且 Relay rAF 距 1 秒门槛仅 `0.1ms`，作为 residual risk 交 final aggregate review，不把一次绿色结果表述为所有 Windows/驱动上的性能上限。
- 2026-08-31：最终只读 aggregate review `caf8c1ed-6591-4d97-8afb-0758a6fa2d11` 覆盖 base `0d81e9fa3` 到 frozen head `0d0dd540e` 的 6 个 ITEM-04 commits，结论 PASS（0 blocking / 0 important）。Review 确认真实 Direct/本地 Wrangler E2EE Relay、负载与严格完整性/1 秒 stall 门槛、超大 Agent turn 可访问性、Windows teardown、手动 CI gating 和文档一致性均符合交付契约；Relay `999.9ms` 边界、Windows throughput `10.6–14.7s`、taskkill 理论窄窗口继续作为 report-only residual risks。ITEM-04 关闭。
- 2026-08-31：在 reviewed milestone `4270217f1` 创建 ITEM-05 隔离分支/worktree；两个只读 scout 已确认当前 retained panel 与 persistent emulator 覆盖 T03/T04 基础，历史 commit `2c92dcd4c` 提供 T05 的 optional `restore.resume`、bounded revision backlog 与 gap replay 参考。唯一 writer lineage 首轮 `1619df3f-b0f3-4fef-8811-3aa52a0ef803` 按先 RED 后实现执行，并额外锁定 reconnect grace 中零 socket 输出不得被当作 delivered 的断线安全修正；首轮 Direct E2E 已稳定复现返回 workspace 后同一 renderer 的 reset write 从 1 增至 2，Protocol optional resume 也完成 RED→8/8 green。首轮因 runner 将预期 RED 非零退出记为失败而 settlement，续跑 `b779914e-c2cd-46cf-9e96-dac86c08791a` 保留原 worktree 与 RED 证据继续。
- 2026-09-01：父流程完成 ITEM-05 四层 contract：optional `restore.resume`；App late-frame/retained-renderer；Daemon per-session delivered revision、1MB contiguous backlog 与安全 gap；最后 socket 断开清 anchor。Direct 与本地 Wrangler Relay/E2EE 均验证 1,500 行历史保留、隐藏输出单次补齐、返回后输入可用，`RESTORE_WINDOW` 分别为 `87ms` / `100ms`。首轮 reviewer 找到成功 resume 后 stale input-mode preamble 和 overflow 仍保留 resume 两项 important；两项均补 RED 修复并经 Round 2 结构化 PASS。最终 Protocol 8/8、App 12/12、Server 128/128（3 skipped）、Build、Typecheck、Lint、Format 与 Direct/Relay E2E 全绿，21-path manifest `849c36c7…fe67` 逐文件收割一致；ITEM-05 以 commit `159a70640` 关闭并推进 ITEM-06。
- 2026-09-01：ITEM-06 初审确认 T10 的 DECSET 2004 tracker/preamble 已存在；当前缺口收敛为 T12：Windows ConPTY 从未透传 mode 2004 时，多行 clipboard 仍走裸 `Terminal.paste()`。历史 commit `9522a985f` 可作语义参考，但其中图片 path framing 属于已排除 T11，不得整体 cherry-pick。current/legacy 两个 scout 均返回相同边界；已冻结 browser RED（Ctrl+V、context paste、ESC sanitation、snapshot+preamble）和仅文本 PTY E2E，交由唯一 writer 执行。
- 2026-09-01：ITEM-06 worker 以 Windows 多行 paste 无 framed input 的 browser timeout 建立 RED；父流程将 context listener 收窄为仅 Windows 多行、补齐非 Windows/单行原路径断言，并令 E2E 显式区分 mode=false fallback 与 reload 后 mode=true replay。最终 browser 30/30、App unit 24/24、Protocol input-mode 9/9、Direct PTY 2/2、本地 Wrangler Relay/E2EE PTY 2/2、CI contract、build、全仓 Typecheck/Lint/Format 均通过；7-path frozen patch `ba654cd73895d39d6a24b26dec16ccf0100dfb09a67994f96df4566e383fa6aa` 进入独立审查。
- 2026-09-01：ITEM-06 reviewer `19112db0-a596-443a-b414-bf6ca9c9cb1f` 逐入口核对 keyboard/context/imperative paste、真实 PTY byte oracle、mode=false 与 reload mode=true 区分、cleanup 及 CI gating，结论 PASS（0 blocking / 0 important）。语义原子 source milestone `055d0000b17214db79c738af5454c71fdd14fea3` 的 exact-head Windows workflow `33425004246` 全绿：Direct 与本地 Wrangler Relay/E2EE 各 5/5，其中两条 clipboard spec 均在实际 `windows-latest` / ConPTY 上通过；Node L0/L1/L2 各 100/100 echo，Direct/Relay 组合 workload 均保持 1,000/1,000 输出、24/24 echo、有效 digest 与零 duplicate/out-of-order/mismatch。ITEM-06 已串行集成，Wave 2 三项进入 aggregate review。
- 2026-09-01：Wave 2 aggregate reviewer `91c20656-547e-43b0-b027-f74b57daebec` 对 9 commits / 46 paths 的 frozen patch `3ed57574…b9cbf30` 返回 PASS（0 blocking / 0 important）。报告确认三项交付契约、协议双向兼容、无双投/丢失、无常态 trace 内存增长、Windows paste 单次 framing、真实 PTY/E2EE oracle 和 manual CI isolation 均成立；`PLAYWRIGHT_JSON_OUTPUT_FILE` 疑问已由当前 Playwright 源码核实为正确，其他 minor 均为既有或 report-only residual。Wave 2 可创建 PR。
