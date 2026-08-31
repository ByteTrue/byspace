---
title: 保留能力交付路线
status: approved
kind: epic
owner_decision: approved
approved_revision: 1e4d1e9a4e45cb674b89559aa49506584e9cc714e232e8d2347cb86a4124e1ea
approved_at: 2026-08-31T05:01:54Z
approval_evidence:
  owner: "“批准 Epic，按推荐策略执行”（2026-08-31）"
  review: "subagent run a86fc285-9028-4634-85f9-661375af1b24; verdict=pass; 0 blocking/important"
  verification: "34/34 IDs, 21/21 ITEMs, typecheck, lint, format:check, git diff --check passed"
source_epic: ../001-o-legacy-cs-requirements-triage/spec.md
source_revision: f592e54bf43e5501383224891053d2e0a9dfbf45
created_at: 2026-08-31T04:38:14Z
---

# Epic: 保留能力交付路线

## 背景

[`001-o-legacy-cs-requirements-triage`](../001-o-legacy-cs-requirements-triage/spec.md) 已由 Owner 验收，并把 78 份历史文档归并为 77 个原子决策 ID。Owner 最终保留 34 项，并在 [`retained-delivery-index.md`](../001-o-legacy-cs-requirements-triage/retained-delivery-index.md) 中唯一映射为 21 个后续入口。

本 Epic 负责在当前 `main` 上按依赖顺序交付这 21 个入口。它不重新讨论已剔除需求，不把“历史曾实现”当作可直接恢复的补丁，也不把所有能力塞进一个巨型实现分支。

## 目标

1. 完成 34 / 34 个 Owner 保留的原子需求，且每个只由一个入口负责。
2. 先建立安全、版本路由和性能基线，再修改依赖这些基础的功能。
3. 每个入口独立复现或验收、独立实现、独立验证、独立审查。
4. 优先复用当前 `main` 的架构和上游已有能力；旧快照只提供意图与历史证据。
5. 按波次合入 `main`，避免 21 项长期堆积在一个分支上。

## 非目标

- 恢复盘点 Epic 中已明确不做的 38 个产品 ID或 O01–O05。
- 删除与“不做”条目对应但上游当前仍提供的功能。
- 重放旧 CodeStable 文档中的实现步骤或整块 cherry-pick reset 前代码。
- 在本 Epic 规划阶段修改 runtime、协议、UI、Cloudflare Worker 或发布基础设施。
- 未经单项授权并行启动多个写入型实现任务。

## 不可变范围

保留集合固定为：

- Terminal：T01–T18。
- Relay：R02、R03。
- Agent：A04–A09。
- Workspace：W01、W02、W04、W14，以及 W05 中仅“hover 展示该 Workspace 下全部 Agent 的精确状态”。
- Compact UI：U03、U05。
- Hosted release channel：B01。

W05 不允许扩大为 Project 单一分组、attention 优先排序或其他侧栏重构。任何新增需求都必须另走 `cs-feat`，不得借本 Epic 顺带加入。

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

### 推荐推进与提交策略

Owner 首次批准本 Epic 时一并确认：

- **Item progression：** sequential。一次只激活一个 ITEM；依赖未通过不得启动后继。
- **Commit strategy：** 每个 ITEM 至少一个语义原子 commit；协议、daemon、app 为同一能力不可拆时可在同一 ITEM 内共同提交。
- **Publish strategy：** 本 Epic 规划先独立 PR 合入；实现按 5 个波次分别开 PR，波次通过集成验证并合入后再从最新 `main` 开始下一波。push、PR 和 merge 仍遵守当时的明确授权。

## 波次与依赖

| 波次 | 目的                         | ITEM       | 进入条件                                     |
| ---- | ---------------------------- | ---------- | -------------------------------------------- |
| 1    | 发布通道路由与远程连接安全   | ITEM-01–03 | 本 Epic 已批准并合入 `main`                  |
| 2    | Terminal 性能与恢复基础      | ITEM-04–06 | Wave 1 已合入；隔离 benchmark 环境可用       |
| 3    | Terminal 功能与呈现          | ITEM-07–11 | Wave 2 基线和恢复不变量通过                  |
| 4    | Agent、Session 与 Timeline   | ITEM-12–15 | Wave 3 已合入；Timeline 权威路径保持单 owner |
| 5    | Workspace、侧栏与 Compact UI | ITEM-16–21 | Wave 4 已合入；相关平台 QA 环境可用          |

跨波次默认串行。同一波次中即使没有硬依赖，也按 ITEM 顺序推进，以减少共享文件冲突并保证每项可独立归因。

## Wave 1：发布通道路由与远程连接安全

### ITEM-01 · RELEASE-01 · Stable/Beta App 与 Relay 路由

- **Skill：** `cs-feat`
- **需求：** B01
- **依赖：** 无
- **交付：** prerelease 自动选择 `app-beta.byspace.cc.cd` 与 `relay-beta.byspace.cc.cd:443`；stable 使用 stable tuple；用户自定义 App/Relay endpoint 始终优先。
- **验收：** stable、prerelease、自定义 endpoint、旧官方默认迁移四组测试通过；现有 `relay-beta.byspace.cc.cd:443` / Worker `byspace-relay-beta` 只作为既有基础设施使用。
- **约束：** 不部署或改写 Worker，不新增第三套 channel，不把版本判断散落到多个调用点。

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
- **约束：** 使用随机端口和隔离 `BYSPACE_HOME`，绝不操作 6777 daemon；不得靠降低测试负载或删除测试达标。

### ITEM-05 · TERM-02 · Retained renderer 与 revision resume

- **Skill：** `cs-issue`
- **需求：** T03、T04、T05
- **依赖：** ITEM-04
- **交付：** 切换首帧布局正确；focused workspace 中 retained terminal 保持 renderer/stream；恢复按 revision 补缺口并保留 10,000 行目标历史。
- **验收：** tab/workspace 切换、隐藏期间输出、断线恢复、超出窗口和 resize 序列测试通过；没有固定 200 行重放造成的丢失或重复。
- **约束：** 不破坏 daemon-owned size claimant、backpressure gate 或 native retained-panel 生命周期。

### ITEM-06 · TERM-05 · Bracketed paste 恢复与 ConPTY fallback

- **Skill：** `cs-issue`
- **需求：** T10、T12
- **依赖：** ITEM-05
- **交付：** attach/restore 后恢复 DECSET 2004；Windows ConPTY 丢失 mode 时，多行文本仍作为一个 bracketed paste block 发送。
- **验收：** mode-on、mode-off、restore、Windows fallback、单行输入和 escape sequence 测试通过；逐键输入行为不变。
- **约束：** fallback 只覆盖可证明的 ConPTY 边界，不把所有输入无条件改成 paste。

## Wave 3：Terminal 功能与呈现

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
- **依赖：** ITEM-07
- **交付：** Compact Web 支持长按选词、拖动选区与复制，同时保留滚动、点击输入和面板手势。
- **验收：** Compact Web 真实浏览器完成选词、扩展、复制、滚动和取消选择；native/wide Web 无回归。
- **约束：** 手势所有权遵守 mobile panel revision 模型；不复制第二套 panel lifecycle。

### ITEM-09 · TERM-06 · Terminal 剪贴板图片粘贴

- **Skill：** `cs-feat`
- **需求：** T11
- **依赖：** ITEM-06
- **交付：** 使用既有 binary upload 把剪贴板图片写入 daemon 临时文件，并把真实远端路径作为单个 paste block 交给 Terminal/Pi。
- **验收：** Direct 与 Relay、路径含空格、上传失败、非图片剪贴板、远端 daemon 和 Windows framing 均覆盖；客户端本地路径绝不发送给远端 Agent。
- **约束：** 不新建平行上传协议；临时文件生命周期和权限必须明确。

### ITEM-10 · TERM-07 · Terminal agent activity 与 Pi

- **Skill：** `cs-feat`
- **需求：** T13、T14、T17
- **依赖：** ITEM-07
- **交付：** 保持 provider 独立 hooks，加入 Pi extension/profile，并使 activity 请求串行、有界合并、latest-wins、失败后续传。
- **验收：** Claude、Codex、OpenCode 既有行为不回退；Pi running/idle/needs-input 与中断序列可见；并发和失败测试证明无请求风暴及最终状态丢失。
- **约束：** 复用 provider registry 和单一 `TerminalActivityTracker`；修改 Pi extension 前按 Pi 官方本机文档核对 API。

### ITEM-11 · TERM-08 · 呈现默认值与 profile 入口

- **Skill：** `cs-issue`
- **需求：** T15、T18
- **依赖：** ITEM-08、ITEM-10
- **交付：** 验收字体、字号、高亮、主题默认值和 Manage Terminal Profiles 到当前 Host 的精确导航，仅修复不满足项。
- **验收：** Web、native、Desktop 的默认/覆盖/系统主题行为以及目标 Host 导航通过；现有满足项不重写。
- **约束：** 不把 React Native/Unistyles theme proxy 样式提升到 render 外。

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
- **依赖：** ITEM-12
- **交付：** 首条 prompt 继续给出初始名称；拥有完整上下文的当前 Agent 可精炼 Workspace 标题及适用的 branch 名。
- **验收：** 初始命名、后续精炼、用户手动改名保护、并发 archival/metadata write 和无 branch 的 directory workspace 覆盖。
- **约束：** 不允许后台模型越过当前 Agent 上下文另行生成；用户显式名称优先。

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
- **依赖：** ITEM-17
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
- **依赖：** ITEM-20
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
7. ITEM 的 commit、验证命令、残余风险写入 work log；波次完成后写入最终 delivery index。

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

- 21 / 21 个入口全部完成，覆盖 34 / 34 个保留 ID，且没有重复或遗漏。
- 5 个 Wave 均已从各自最新 `main` 开始并通过 exact-head CI。
- Direct/Relay/Windows Terminal 有可比较的最终性能与正确性证据。
- Stable/Beta App 与 Relay 路由、Hosted HTTPS Direct 安全边界和 pairing hostname 已通过兼容测试。
- Agent/Timeline、Workspace/Sidebar 和 Compact UI 的保留目标均有当前版本验收证据。
- 最终 delivery index 记录每个 ITEM 的 commit/PR、测试、平台证据和残余风险。
- 独立最终 review 通过并由 Owner 明确验收。

## Final Delivery Index

待 ITEM 完成后逐项填写；规划通过不算交付。
