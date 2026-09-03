---
title: 保留能力交付路线
status: active
kind: epic
owner_decision: approved
approved_at: 2026-08-31T05:01:54Z
amended_at: 2026-09-01T09:45:27Z
approval_evidence:
  owner: "“批准 Epic，按推荐策略执行”（2026-08-31）"
  parallel_owner: "“确认”并选择推荐方案 A：按 worker 完成顺序串行集成（2026-08-31）"
  review: "bounded-parallel contract review lineage 9ebed510-b74e-4eb9-b796-c6fa1d9a29e6 round 1 needs_changes; resumed run 8aea6ea4-463f-42eb-a90c-febe642a68bb round 2 passed with 0 blocking/important"
  verification: "33/33 retained IDs remain uniquely mapped to 21/21 ITEMs after the Owner cancelled T15"
  scope_correction: "Owner approved the consolidated correction plan on 2026-09-01: restore Appearance, retain T18, document T05 boundaries and opt-in Windows CI, and require explicit Pi opt-in for legacy configs"
  execution_acceleration: "Owner approved the recommended worktree/subagent pipeline and hash-verified non-duplicate validation contract on 2026-09-01 after read-only audit workflow 2b44522e-874d-4f91-8642-afe06687b092; review dcf5e62e-9701-4e55-8290-25c0561c3b15 round 1 needs_changes and resumed round 2 bfc9e44d-2ce6-4e33-8391-9ada07f76ecf passed with no findings"
  item14_scope_correction: "Owner approved recommended Plan A on 2026-09-01 after historical A09 issue/commit audit: capability-gated copy-only Workspace menu, separate rename_workspace and rename_branch tools, title-first/branch-best-effort, guarded BySpace-owned branch mutation, localization, bundled skill, and browser evidence"
source_epic: ../001-x-legacy-cs-requirements-triage/spec.md
source_revision: f592e54bf43e5501383224891053d2e0a9dfbf45
created_at: 2026-08-31T04:38:14Z
---

# Epic: 保留能力交付路线

## 背景

[`001-x-legacy-cs-requirements-triage`](../001-x-legacy-cs-requirements-triage/spec.md) 已由 Owner 验收，并把 78 份历史文档归并为 77 个原子决策 ID。Owner 最终保留 33 项，并在 [`retained-delivery-index.md`](../001-x-legacy-cs-requirements-triage/retained-delivery-index.md) 中唯一映射为 21 个后续入口。T15 于 2026-09-01 被明确取消。

本 Epic 负责在当前 `main` 上按依赖顺序交付这 21 个入口。它不重新讨论已剔除需求，不把“历史曾实现”当作可直接恢复的补丁，也不把所有能力塞进一个巨型实现分支。

## 目标

1. 完成 33 / 33 个 Owner 保留的原子需求，且每个只由一个入口负责。
2. 先建立安全、版本路由和性能基线，再修改依赖这些基础的功能。
3. 每个入口独立复现或验收、独立实现、独立验证、独立审查。
4. 优先复用当前 `main` 的架构和上游已有能力；旧快照只提供意图与历史证据。
5. 按波次合入 `main`，避免 21 项长期堆积在一个分支上。

## 非目标

- 恢复盘点 Epic 中已明确不做的 39 个产品 ID 或 O01–O05。
- 删除与“不做”条目对应但上游当前仍提供的功能。
- 重放旧 CodeStable 文档中的实现步骤或整块 cherry-pick reset 前代码。
- 在本 Epic 规划阶段修改 runtime、协议、UI、Cloudflare Worker 或发布基础设施。
- 超出本契约具名 lane、文件所有权和最多两个 writer 限制的写入型并行。

## 不可变范围

保留集合固定为：

- Terminal：T01–T14、T16–T18。
- Relay：R02、R03。
- Agent：A04–A09。
- Workspace：W01、W02、W04、W14，以及 W05 中仅“hover 展示该 Workspace 下全部 Agent 的精确状态”。
- Compact UI：U03、U05。
- Hosted release channel：B01。

T15 保留在历史 catalog 中作为 Owner 已取消项：不得修改或删除现有 Appearance 主题、语法高亮、UI/code 字体、字号或持久化。W05 不允许扩大为 Project 单一分组、attention 优先排序或其他侧栏重构。任何新增需求都必须另走 `cs-feat`，不得借本 Epic 顺带加入。

## 执行原则

### 当前架构优先

- Terminal 修改遵守 [`docs/terminal-performance.md`](../../../docs/terminal-performance.md) 的低延迟、backpressure、revision 和 retained-panel 不变量。
- Terminal activity 修改遵守 [`docs/terminal-activity.md`](../../../docs/terminal-activity.md) 的单一 tracker、provider registry 与 opt-in hook 安装边界。
- Timeline 修改遵守 [`docs/timeline-sync.md`](../../../docs/timeline-sync.md) 的 live/authoritative 双路径、单一 owner、paged-to-completion 和 replica lifetime 边界。
- 协议修改遵守 [`docs/protocol-compatibility.md`](../../../docs/protocol-compatibility.md)：append-only、可选字段、单点 capability gate、纯结构 wire schema。
- Workspace hover 遵守 [`docs/hover.md`](../../../docs/hover.md)；Compact UI 遵守 [`docs/mobile-panels.md`](../../../docs/mobile-panels.md)。

### 证据驱动

每个 ITEM 开始时先选择以下一种入口：

- `cs-issue`：先在当前 `main` 复现或证明验收失败，再写修复。
- `cs-feat`：先锁定用户可观察验收，再写最小实现。

当前已有强代码证据的条目先验收；若行为已满足，补足必要测试并关闭，不为“看起来像旧实现”而重写。

### 推进与提交策略

Owner 在批准本 Epic 后追加确认有界并行 revision：

- **Item progression：** parallel。只有硬依赖已集成且处于当前 Wave 的 ITEM 才可激活；最多同时运行两个写入型 worker。
- **Integration：** worker 交付按完成顺序进入单一集成队列；父流程逐项 review、验证并串行集成，不允许两个 worker 同时写集成分支。
- **Commit strategy：** 每个 ITEM 至少一个语义原子 commit；协议、daemon、app 为同一能力不可拆时可在同一 ITEM 内共同提交。
- **Publish strategy：** 每个 milestone push 到当前 Wave 的同一个 PR 分支；Wave 通过集成验证并合入后，从最新 `main` 开始下一波。
- **Rolling pipeline：** 硬依赖集成前只允许为后续 ITEM 做只读调查、RED/fixture 设计和 worker brief；这些预热产物由父流程保存在仓库外的 brief/evidence，不写 integration branch 或后续 ITEM worktree。依赖满足后立即补发下一位 writer，不等待另一 lane 或重复 discovery。

### 有界并行、交付验证与文件所有权

- 本节未展开的并行调度、集成机制、`active_items` 状态机、blocker 分类与退化规则，以 `cs-epic` skill-local `references/parallel-execution.md` 为准；本节展开的 byte-identical 候选验证规则优先，并把该 reference 中的“权威验证”具体化为 manifest 一致性加本节保留的父流程门槛。
- 每个 writer 使用独立 Git worktree；子 Agent 不得 commit、push、开 PR、merge、发布或修改 `codestable`。父流程独占集成分支、work cursor 和远端操作。
- 最多同时运行两个写入型 worker；正常活跃子 Agent 上限为三名，第三名只做只读 scout 或 fresh review。Heavy validation 期间可以保留只读调查，但不得并发另一项 heavy validation。
- 父流程不接管常规 ITEM 实现。Worker 失败、停滞或越界时，先冻结当前 worktree 和证据，再在同一 worktree 恢复或替换唯一 writer；任何时刻仍只能有一个 Agent 写该 worktree。
- Worker WIP 历史不得进入 Wave PR。父流程只以 patch、squash 到工作树或 `cherry-pick -n` 等不推进主历史的方式收割交付，并核对 base、路径 manifest、完整内容 SHA-256 与 review 对象一致。
- Worker 必须在冻结候选上完成 ITEM 定向测试并保存命令与结果；fresh reviewer 审查同一候选。若父流程收割后的 source bytes 与 reviewed manifest 一致，不重复运行 worker 已报告绿色的相同完整套件；父流程运行 owning stack 所需 build、全仓 Typecheck/Lint/Format，以及存在跨 ITEM 共享接缝时至少一项针对该接缝的 focused integration test。父流程必须在 ITEM work log 记录 reviewed manifest 与收割结果的完整内容 SHA-256 比对结果，以及复用而未重跑的测试套件清单。字节、base、生成产物、依赖声明或测试前提不一致时，候选失去复用资格并重新执行受影响验证。
- 每个 Wave 结束时在集成 head 运行跨 ITEM focused integration 与 UI/平台证据；PR exact-head CI 仍是合并前完整远端门槛。Format 写入完成后，互不写文件的 Typecheck、Lint 与轻量 focused tests 可以并行；Playwright、benchmark、Windows、模拟器、Electron、Relay/daemon E2E 继续使用单一验证锁。
- Reviewer 首轮收到 manifest、diff、scope、测试输出、截图/trace 和 residual risks 的完整 evidence pack；修复后只复审 blocker/important delta 及其必要回归，不重复全量 discovery。
- Wave 1 与 Wave 2 保持单 writer；允许只读调查和 review 与实现并行。
- Wave 3 在 ITEM-06 集成后启用两个 lane。Lane A `ITEM-07 → ITEM-10` 独占 `packages/server/src/terminal/activity/**`、`packages/server/src/terminal/agent-hooks/**`、待新增的 `packages/server/src/terminal/agent-hooks/pi/**`、`packages/server/src/terminal/terminal-capture.ts`、`packages/server/src/server/websocket-server.ts` 中的 Terminal 通知路径、`packages/server/src/server/bootstrap.ts` 的 hook 安装接线、`packages/server/src/server/config.ts`、`packages/server/src/server/persisted-config.ts`、`packages/server/src/server/daemon-config-store.ts` 的 Terminal profile 配置与 `packages/app/src/screens/settings/host-page.tsx` 中的 hook/profile 呈现，以及 `packages/app/src/screens/settings/terminal-profile-edit-modal.tsx`、`packages/app/src/components/terminal-profile-icon.tsx` 和对应测试；Lane B `ITEM-08 → ITEM-09` 独占 `packages/app/src/terminal/**`、`packages/app/src/components/terminal-pane.tsx`、`packages/app/src/components/terminal-copy-paste-actions.tsx`、既有 binary upload 接线及对应测试。两条 lane 完成后才启动 ITEM-11；ITEM-11 可在串行阶段继续修改上述 profile 路径，不构成并发所有权。
- Wave 4 先串行集成 ITEM-12，再并行预备 ITEM-13 与 ITEM-14，最后执行 ITEM-15。ITEM-13 独占 `packages/app/src/components/import-session-sheet*`、`packages/client/src/daemon-client.ts` 中的 import API、`packages/protocol/src/messages.ts` 中的 import schema，以及 `packages/server/src/server/agent/provider-session-import.ts`、`agent-manager.ts` 和 provider import adapter。ITEM-14 的历史合同审计触发了 stop-to-serial：先完成并集成 ITEM-13，再由 ITEM-14 串行拥有可选 capability、Agent Tool Catalog、`paseo-worktree-service.ts`、`workspace-auto-name.ts`、`worktree-branch-name-generator.ts`、`checkout-git.ts`、`worktree-metadata.ts`、Workspace 菜单、i18n、bundled skill 与对应测试；不得与 ITEM-13 并行写 protocol、app 或共享持久化接缝。任一 ITEM 需要改动 `session-store`、workspace registry/reconciliation 或本节未列出的共享 owner 时，继续停止并交父流程裁决。
- Wave 5 启用两个 lane。Lane A `ITEM-16 → ITEM-17` 独占 `packages/app/src/git/policy.ts`、`use-actions.tsx`、`branch-switcher-operations.ts`、`packages/app/src/components/branch-switcher.tsx`、`packages/app/src/hooks/use-branch-switcher.ts`，以及必要的 `packages/server/src/server/workspace-git-service.ts`、`packages/server/src/utils/checkout-git.ts`、`packages/client/src/daemon-client.ts` 和 `packages/protocol/src/messages.ts` Git 查询接线；Lane B `ITEM-18 → ITEM-19 → ITEM-20` 独占 `packages/app/src/components/sidebar-workspace-list.tsx`、`packages/app/src/components/sidebar/sidebar-workspace-row*.tsx`、`packages/app/src/components/sidebar/workspace-meta-row/**`、`packages/app/src/components/workspace-hover-card.tsx`、`packages/app/src/hosts/use-host-badges.ts`、`packages/app/src/hooks/use-sidebar-workspaces-list.ts`、`packages/app/src/hooks/sidebar-workspaces-view-model.ts` 及对应测试。两条 lane 完成后才启动 ITEM-21。
- Lane 可以只读引用另一 lane 的模块；任何超出具名路径的编辑必须先交父流程检查所有权。发现同一文件、共享 type/schema、持久化或状态 owner 的双重声明时，立即停止相关 lane，不做乐观合并；收窄所有权或退回串行后重新 review。

## 波次与依赖

| 波次 | 目的                         | ITEM       | 进入条件                                     |
| ---- | ---------------------------- | ---------- | -------------------------------------------- |
| 1    | 发布通道路由与远程连接安全   | ITEM-01–03 | 本 Epic 已批准并合入 `main`                  |
| 2    | Terminal 性能与恢复基础      | ITEM-04–06 | Wave 1 已合入；隔离 benchmark 环境可用       |
| 3    | Terminal 功能与 profile      | ITEM-07–11 | Wave 2 基线和恢复不变量通过                  |
| 4    | Agent、Session 与 Timeline   | ITEM-12–15 | Wave 3 已合入；Timeline 权威路径保持单 owner |
| 5    | Workspace、侧栏与 Compact UI | ITEM-16–21 | Wave 4 已合入；相关平台 QA 环境可用          |

跨波次保持串行。同一波次只允许上述具名 lane 并行；每个 ITEM 仍独立归因，集成分支按 worker 完成顺序逐项串行落盘。

## Wave 1：发布通道路由与远程连接安全

### ITEM-01 · RELEASE-01 · Stable/Beta App 与单 Relay 路由

- **Skill：** `cs-feat`
- **需求：** B01
- **依赖：** 无
- **交付：** prerelease 自动选择 `app-beta.byspace.cc.cd`，stable 使用 `app.byspace.cc.cd`；两者统一使用 `relay.byspace.cc.cd:443`；用户自定义 App/Relay endpoint 始终优先。
- **验收：** stable、prerelease 与自定义 endpoint 测试通过。
- **约束：** 不新增 Relay channel，不把版本判断散落到多个调用点。

### ITEM-02 · RELAY-02 · Hosted HTTPS 阻断明文明网 Direct

- **Skill：** `cs-issue`
- **需求：** R03
- **依赖：** ITEM-01
- **交付：** Hosted HTTPS 在创建 WebSocket 前拒绝 `ws://` 非 loopback Direct endpoint。
- **验收：** 明文 LAN/public Direct 被阻断并给出可行动提示；loopback Direct、`wss://` Direct、Relay 和 daemon 同源 Web UI 不受影响。
- **约束：** 安全判断集中在连接规划边界，不以浏览器失败后的错误字符串作为策略。

### ITEM-03 · RELAY-01 · Pairing offer hostname

- **Skill：** `cs-feat`
- **需求：** R02
- **依赖：** ITEM-02
- **交付：** daemon pairing offer 携带可读 hostname，新 Host 首次保存时默认采用该名称。
- **验收：** 新 offer、缺少 hostname 的旧 offer、自定义用户名称和重复配对均有协议/客户端测试；旧客户端仍可解析新 offer，新客户端仍接受旧 offer。
- **约束：** hostname 必须是 optional append-only 字段；规范化只发生在 wire validation 之后。

## Wave 2：Terminal 性能与恢复基础

### ITEM-04 · TERM-01 · Direct/Relay 性能与 Windows 停顿

- **Skill：** `cs-issue`
- **需求：** T01、T02、T08、T09、T16
- **依赖：** ITEM-03
- **交付：** 建立当前 Direct、Relay、Windows 逐键和组合 workload 的可重复分段基线，定位并修复可复现瓶颈。
- **验收：** Node benchmark、浏览器分段指标和 Windows 实机/等价证据分别记录 before/after；无字符丢失、乱序、额外 snapshot 或主线程秒级停顿。
- **约束：** 使用随机端口和隔离 `BYSPACE_HOME`，绝不操作 6777 daemon；不得靠降低测试负载或删除测试达标。Windows 实机证据保留在 shared CI 的手动 opt-in `terminal_performance` job 中；默认 PR CI 不运行，且不接收部署权限、secret 或发布输入。

### ITEM-05 · TERM-02 · Retained renderer 与 revision resume

- **Skill：** `cs-issue`
- **需求：** T03、T04、T05
- **依赖：** ITEM-04
- **交付：** 切换首帧布局正确；focused workspace 中 retained terminal 保持 renderer/stream；同一 renderer 的正常恢复按 revision 补缺口并保留客户端 10,000 行历史。
- **验收：** tab/workspace 切换、隐藏期间输出、断线恢复、超出窗口和 resize 序列测试通过；gap 不可恢复或必须创建新 renderer 时回退权威 snapshot，最多携带 1,000 行 scrollback，不产生固定 200 行重放造成的丢失或重复。
- **约束：** 不破坏 daemon-owned size claimant、backpressure gate 或 native retained-panel 生命周期。

### ITEM-06 · TERM-05 · Bracketed paste 恢复与 ConPTY fallback

- **Skill：** `cs-issue`
- **需求：** T10、T12
- **依赖：** ITEM-05
- **交付：** attach/restore 后恢复 DECSET 2004；Windows ConPTY 丢失 mode 时，多行文本仍作为一个 bracketed paste block 发送。
- **验收：** mode-on、mode-off、restore、Windows fallback、单行输入和 escape sequence 测试通过；逐键输入行为不变。
- **约束：** fallback 只覆盖可证明的 ConPTY 边界，不把所有输入无条件改成 paste。

## Wave 3：Terminal 功能与 profile

### ITEM-07 · TERM-03 · 通知输出摘要

- **Skill：** `cs-issue`
- **需求：** T06
- **依赖：** ITEM-06
- **交付：** 实机验收 Terminal 完成通知优先采用最近非空输出摘要；只修复失败链路。
- **验收：** 空白尾行、多行输出、无输出、退出和 attention transition 覆盖；通知内容稳定且不泄漏超过既有通知边界的数据。
- **约束：** 不新增第二套 Terminal activity 状态。

### ITEM-08 · TERM-04 · Compact Web 选择与复制

- **Skill：** `cs-feat`
- **需求：** T07
- **依赖：** ITEM-06
- **交付：** Compact Web 支持长按选词、拖动选区与复制，同时保留滚动、点击输入和面板手势。
- **验收：** Compact Web 真实浏览器完成选词、扩展、复制、滚动和取消选择；native/wide Web 无回归。
- **约束：** 手势所有权遵守 mobile panel revision 模型；不复制第二套 panel lifecycle。

### ITEM-09 · TERM-06 · Terminal 剪贴板图片粘贴

- **Skill：** `cs-feat`
- **需求：** T11
- **依赖：** ITEM-08
- **交付：** 使用既有 binary upload 把剪贴板图片写入 daemon 临时文件，并把真实远端路径作为单个 paste block 交给 Terminal/Pi。
- **验收：** Direct 与 Relay、路径含空格、上传失败、非图片剪贴板、远端 daemon 和 Windows framing 均覆盖；客户端本地路径绝不发送给远端 Agent。
- **约束：** 不新建平行上传协议；临时文件生命周期和权限必须明确。

### ITEM-10 · TERM-07 · Terminal agent activity 与 Pi

- **Skill：** `cs-feat`
- **需求：** T13、T14、T17
- **依赖：** ITEM-07
- **交付：** 保持 provider 独立 hooks，加入 Pi extension/profile，并使 activity 请求串行、有界合并、latest-wins、失败后续传。
- **验收：** Claude、Codex、OpenCode 既有行为不回退；Pi running/idle/needs-input 与中断序列可见；并发和失败测试证明无请求风暴及最终状态丢失。
- **约束：** 复用 provider registry 和单一 `TerminalActivityTracker`；修改 Pi extension 前按 Pi 官方本机文档核对 API。缺少 provider map 的历史 global `true` 只继承给 Claude、Codex、OpenCode，Pi 必须由用户显式启用；旧客户端后续主动切换 global 开关也只更新这三个历史 provider，并保留显式 Pi 或未来 provider 设置。

### ITEM-11 · TERM-08 · Terminal profile 入口

- **Skill：** `cs-issue`
- **需求：** T18
- **依赖：** ITEM-08、ITEM-09、ITEM-10
- **交付：** Manage Terminal Profiles 精确打开所选 Host 的 Terminals 设置。
- **验收：** 从 New Workspace 入口进入所选 Host 的 `/settings/host/terminals`，并由 exact-host E2E 证明没有打开其他 Host。
- **约束：** T15 已取消；不得修改 Appearance 主题、语法高亮、UI/code 字体、字号、默认值或持久化。

## Wave 4：Agent、Session 与 Timeline

### ITEM-12 · AGENT-03 · Timeline 恢复、仲裁与同步状态

- **Skill：** `cs-issue`
- **需求：** A06、A07、A08
- **依赖：** ITEM-11
- **交付：** 统一 Host timeline owner；补齐 focus catch-up、并发顺序、gap/分页/rewind；远程恢复保留旧 timeline 并显示同步状态。
- **验收：** cache paint、live-before-hydration、multi-page gap、reconnect、rewind、失败重试和远程旧内容保留序列测试通过；同一 agent 不出现第二请求 owner。
- **约束：** focus 不是正确性 gate；authoritative page 不得当 live delta 追加；不建立 fallback transport。

### ITEM-13 · AGENT-02 · 手动 Session ID 导入

- **Skill：** `cs-feat`
- **需求：** A05
- **依赖：** ITEM-12
- **交付：** Import Session 支持选择 provider 并输入 session/thread ID，精确导入目标主会话。
- **验收：** 有效 ID、未知 ID、provider 不匹配、已导入、active owner、cwd 不匹配和导入后 authoritative timeline 恢复均通过。
- **约束：** 复用现有 provider-session import 服务，不建立第二套 agent resume 存储。

### ITEM-14 · AGENT-04 · 使用当前 Agent 精炼 Workspace 名称

- **Skill：** `cs-feat`
- **需求：** A09
- **依赖：** ITEM-13（ITEM-12 已完成；历史合同审计触发 stop-to-serial）
- **交付：** 首条 prompt 继续给出初始名称；Workspace 菜单在 capability 可用时只复制固定 prompt，由拥有完整上下文的当前 Agent 依次调用既有 `rename_workspace` 与新增 `rename_branch` 精炼标题及适用 branch。菜单不自动发送、不选择 Agent、不新增确认弹窗；bundled BySpace skill 记录 title-first、branch-best-effort 与跳过原因。
- **验收：** 可选 capability 在新旧 daemon/client 间保持兼容；菜单可见性、复制内容、成功/失败 toast 与无自动发送通过浏览器证据，新增菜单/toast 文案覆盖现有九种 locale。Title 成功不因 branch 跳过或失败回滚。Branch 只允许修改仍由 BySpace 管理、非默认、未发布、无 upstream/PR/MR、未人工改名且无本地/远端冲突的分支；check/apply 间分支变化、Workspace 归档/删除、并发 metadata/registry 更新与 Git 失败均不得写入 stale metadata。Directory Workspace 只允许改标题。
- **约束：** 标题与 branch 保持两个独立工具；不新增 WebSocket rename RPC，不把 branch 参数并入 `rename_workspace`，不整块移植历史补丁。现有初始自动命名保持一次性初始化，不允许后台模型替代当前 Agent 精炼；用户显式标题或 branch 始终优先，Git 成功后才写 branch metadata 和 Workspace 状态。

### ITEM-15 · AGENT-01 · Agent 引导项目准备

- **Skill：** `cs-feat`
- **需求：** A04
- **依赖：** ITEM-13、ITEM-14
- **交付：** Agent 检查项目能否在干净 worktree 中重复准备和并行开发，展示计划，并只在用户确认后修改脚本和 `byspace.json`。
- **验收：** 只读检查、拒绝确认、确认写入、重复执行、失败回滚和干净 worktree 实跑覆盖。
- **约束：** 修改用户仓库是 HITL 边界；未确认前不得写文件、安装依赖或执行破坏性命令。

## Wave 5：Workspace、侧栏与 Compact UI

### ITEM-16 · WORKSPACE-03 · 已推送分支的 Push 状态

- **Skill：** `cs-issue`
- **需求：** W04
- **依赖：** ITEM-15
- **交付：** 无 upstream 但 `origin/<branch>` 与本地同步时，刷新后不显示 Push。
- **验收：** 无 remote、无 upstream/无同名 remote、有同名同步、有同名 ahead、有同名 behind、显式 upstream 六组 Git fixture 通过。
- **约束：** Git/Forge 查询保持 directory-backed `(serverId, cwd)` 语义。

### ITEM-17 · WORKSPACE-01 · 分支来源标识

- **Skill：** `cs-feat`
- **需求：** W01
- **依赖：** ITEM-16
- **交付：** BranchSwitcher 区分 Local、Remote、Both，并使用可辨识图标。
- **验收：** 分组、去重、默认分支、远端删除/新增和键盘/屏幕阅读器标签通过。
- **约束：** 不把展示标签写回 Git，不把 remote 名称硬编码为 origin。

### ITEM-18 · WORKSPACE-04 · Hover 展示全部 Agent 精确状态

- **Skill：** `cs-feat`
- **需求：** W05（仅此子目标）
- **依赖：** ITEM-15
- **交付：** Workspace hover card 展示该 Workspace 下全部 Agent 的精确状态。
- **验收：** 多 Agent 混合状态、空列表、状态实时变化、跨 Host 同名 Workspace 和 hover safe-zone 行为通过。
- **约束：** 不改 Project/Status 分组，不增加 attention 排序；必须复用 canonical hover pattern 与 `useHoverSafeZone`。

### ITEM-19 · WORKSPACE-02 · 手机 Workspace 菜单可见性

- **Skill：** `cs-issue`
- **需求：** W02
- **依赖：** ITEM-18
- **交付：** compact/native Workspace 行始终显示三点菜单，只修复失败平台。
- **验收：** iOS/Android 或对应原生自动化、Compact Web、wide Web hover 路径均通过，且菜单打开时触发器不卸载。
- **约束：** hover 隐藏不得成为 touch 设备唯一入口。

### ITEM-20 · WORKSPACE-05 · Project 级 Auto Host Badge

- **Skill：** `cs-feat`
- **需求：** W14
- **依赖：** ITEM-19
- **交付：** 同一 Project 跨至少两台 Host 时显示设备名，单 Host Project 隐藏。
- **验收：** 单 Host、多 Host、Host 增删、跨 Host 同 project identity、手动 badgeDisplay override 和无项目 Workspace 通过。
- **约束：** 判定是 Project 级，不得退化为全局 Host 数量。

### ITEM-21 · UI-01 · Compact Agent controls

- **Skill：** `cs-feat`
- **需求：** U03、U05
- **依赖：** ITEM-17、ITEM-20
- **交付：** 弱化消息区悬浮控件；compact context 用量进入 composer；折叠工具调用和回到底部进入 pane header。
- **验收：** Compact Web/native 的可见性、可达性、长 timeline、键盘打开、滚动状态和 wide layout 无回归；真实 UI 证据随 PR 提交。
- **约束：** 不复制 composer 状态，不新建 compact-only timeline owner，不用平台判断代替 form-factor gate。

## 单项完成标准

每个 ITEM 只有在以下条件全部满足时才可标记完成：

1. 当前 `main` 的复现或验收证据已记录。
2. 最小实现与范围约束一致，没有顺带恢复“不做”条目。
3. 针对性测试通过；修改的测试文件只运行该文件，不在本机运行全套测试。
4. `npm run typecheck`、`npm run lint`、`npm run format` / `format:check` 通过。
5. 平台相关功能提供对应平台证据；UI 项提供真实交互或截图证据。
6. 独立 review 无 blocking finding；important finding 已修复或由 Owner 明确接受。
7. ITEM 的 commit、worker 验证命令、manifest 比对结果、复用而未重跑的测试套件和残余风险写入 work log；波次完成后写入最终 delivery index。

## 波次合入标准

- Wave 内所有 ITEM 完成并各自可追溯。
- 跨 ITEM 的 focused integration tests 通过。
- 不存在未解释的性能回退、协议兼容风险或平台缺口。
- PR 只包含本 Wave 的实现和必要文档更新。
- CI 在 PR head 精确 SHA 上通过后才可合入。
- 下一 Wave 必须从合入后的最新 `main` 开始，不长期 rebase 一个总实现分支。

## 风险与停止条件

- **上游双向修改：** 当前架构与旧需求存在语义冲突时停止，不把 reset 前实现直接覆盖到 `main`。
- **协议兼容：** 任何 required field、schema narrowing、旧端解析失败或分散 capability branch 都阻断交付。
- **Terminal 性能：** benchmark 波动无法归因、字符/顺序错误、snapshot 增多或 event-loop delay 回退时不得继续后继 Terminal ITEM。
- **安全边界：** R03 若误阻断 loopback、TLS、Relay 或同源 Web UI，停止并回滚。
- **用户仓库写入：** A04 在确认前产生写操作即为阻断问题。
- **基础设施：** B01 若需要修改 DNS、Cloudflare Worker 或生产 secret，先停下并单独请求 Owner 授权。
- **平台证据：** 声称修复 Windows、iOS 或 Android 但没有对应证据时不得关闭 ITEM。
- **范围漂移：** W05 或其他 ITEM 引入已明确不做的需求时停止并拆出新提案。

## Epic 验收标准

- 21 / 21 个入口全部完成，覆盖 33 / 33 个保留 ID，且没有重复或遗漏。
- 5 个 Wave 均已从各自最新 `main` 开始并通过 exact-head CI。
- Direct/Relay/Windows Terminal 有可比较的最终性能与正确性证据。
- Stable/Beta App 与 Relay 路由、Hosted HTTPS Direct 安全边界和 pairing hostname 已通过兼容测试。
- Agent/Timeline、Workspace/Sidebar 和 Compact UI 的保留目标均有当前版本验收证据。
- 最终 delivery index 记录每个 ITEM 的 commit/PR、测试、平台证据和残余风险。
- 独立最终 review 通过并由 Owner 明确验收。

## Final Delivery Index

待 ITEM 完成后逐项填写；规划通过不算交付。
