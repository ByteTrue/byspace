---
kind: issue
title: "审阅 2026-07-16 Paseo upstream 更新"
status: open
created: 2026-07-16
epic: ""
---

# 审阅 2026-07-16 Paseo upstream 更新

## 目标

完整审阅上一 cursor 之后的每一笔 Paseo upstream commit，给出对 BySpace 的可观察价值、依赖、冲突、风险和唯一 disposition；在用户明确批准前不 replay 任何实现提交。

## 冻结区间

- Start exclusive：`6804882761fcb9a511338f1fed19b9ed45e99e45`
- End inclusive：`d42ab91971a92bf2e2a981848989c7ca6536a18e`
- Commit count：19
- Fetch：`git fetch --no-tags upstream main:refs/remotes/upstream/main`
- Cursor 语义：本区间完成逐笔 disposition 后才可推进到 End；不是最后应用 commit。

## 范围

- 审阅完整 commit message、file list 和相关 diff。
- 区分 retained Web/CLI/daemon/Provider 行为与已删除 Electron/native/Browser/website 面。
- 对每个 SHA 给出 inherited / apply full / port partial / defer / skip 之一。
- 对建议同步的共享生命周期、协议、Provider 或 App 变化列出 focused verification。
- 用户批准后才在隔离 worktree replay；本 issue 当前阶段只形成批准 artifact。

## 约束

- 不导入 upstream tags，不 wholesale merge。
- 不恢复 Electron、原生 iOS/Android、内置 Browser automation 或 marketing website。
- 不重新引入旧 package/env/config/type 名；行为必须翻译到 BySpace/byspace/BYSPACE。
- 不因冲突大而静默遗漏 aligned feature。
- 用户摘要必须覆盖 19 个 SHA，且每个 SHA 恰好一次。

## 质量目标

- **兼容性**：任何建议的协议、Provider 或持久状态变化都要说明旧 BySpace 数据与客户端是否仍可解析；以 schema/diff 审阅和对应聚焦测试计划为证据。
- **可靠性**：涉及 timeline、workspace、daemon update 或 history loading 的修复必须说明失败路径和可观察恢复行为；以现有回归或需新增的最小回归为证据。
- **可维护性**：完整 ledger 必须能证明 19 个 SHA 唯一覆盖，并保持 excluded surfaces 与 BySpace identity 边界；以机器可核对的 SHA 集合和 residual search 为证据。

## 完整 Ledger

### 建议完整同步

#### `37bde90d9f4aaf45c755f828ee25a6b189f18065` — 统一 assistant fork boundary resolver

- 行为：删除只被旧测试使用的重复 resolver，让 failed-turn 与普通 assistant fork 只保留一个边界定义；生产路径已经调用统一 resolver。
- 面：仅 retained Web timeline/fork；无协议、daemon 或 excluded surface。
- 冲突：patch 对当前树可干净应用；只需保留 BySpace 文案。
- 建议：**full**。这是纯删除型收敛，减少两套边界判断继续漂移的可能。
- 风险/验证：低；运行 `turn-boundary.test.ts`、App typecheck/lint，并确认 failed-turn cursor 与旧 host fallback。

#### `90e0a0e353a90e12d91d88a91e64dda7984928c0` — Command Center 搜索并打开 workspace

- 行为：Command Center 增加 workspace 结果；支持 title/host/branch 搜索、跨 host 导航、归档过滤、detached branch 归一化，并在面板关闭时停止 project/runtime 订阅。
- 面：完整属于 retained browser Web/PWA 和 multi-host workspace；无 Electron/native/协议变化。
- 依赖：后续 Add Project flow 会复用其 item/type 结构，但本功能可独立落地。
- 冲突：patch 可干净应用；需要检查 BySpace i18n 与 keyboard row index。
- 建议：**full**。
- 风险/验证：中；运行 projects unit tests、Command Center workspace/host E2E、i18n parity、App typecheck/lint 与 Web export。

#### `e528a0db067cf32f2a615347290a1f72ac40a010` — 从 Settings 删除 custom Provider

- 行为：给 snapshot 增加 optional `source`，给 server features 增加 optional capability，给 mutable config 增加 optional `removeProviders`；只允许删除 custom provider，同时清理持久配置与 metadata-generation 引用，并实时重建 Provider registry。
- 面：完整属于 retained custom/ACP Provider 管理；BySpace 当前确实只能 disable/merge，无法删除误配 Provider。
- 兼容：新增 wire 字段均 optional/capability-gated；旧 client 可忽略，新 client 可解析旧 snapshot。
- 冲突：patch 可应用，但 upstream 失败路径使用 Web 不显示的 `Alert.alert()`，且 COMPAT 版本/日期要按 BySpace 重写。
- 建议：**full behavior + 本地 hardening**。保留完整删除语义，改用 rendered inline error/toast，并补 cancel/failure browser coverage；不是删减功能。
- 风险/验证：高（破坏性持久配置）；覆盖 Protocol 双向解析、DaemonConfigStore 删除/去重/重启、snapshot/AgentManager 不复活、built-in 不可删、Settings cancel/success/failure E2E 和 custom-provider docs。

#### `d42ab91971a92bf2e2a981848989c7ca6536a18e` — invalid correlated RPC response 立即失败

- 行为：schema validation 失败时只从 raw envelope 读取 response type/requestId，立即 reject 对应 waiter；不再让 history 等请求等待 60 秒；invalid progress event 不终止最终 response。
- 面：共享 Client，被 Web/CLI 使用；无 excluded surface 或 wire schema 变化。
- 冲突：patch 可干净应用。
- 建议：**full**。
- 风险/验证：中；覆盖 invalid timeline/history response、progress 非终态、并发 requestId 隔离、uncorrelated message 仍忽略及完整 Client tests。

### 建议 Web-only 部分移植

#### `6aba0370aeea9973260a9dd594097d127e7dc834` — remote daemon update 失败可见

- 行为：把 Web 上无效的 `Alert.alert()` 改为 rendered failure state，展示 daemon 原始错误并允许重试；用 `clientGeneration + lastOnlineAt` 识别同一 client 的真实重连。
- 面：上述行为属于 retained Web；同 commit 的 `desktopManaged` wire/env/diagnostics/update suppression 属于已删除 Electron daemon ownership。
- 建议：**partial**，只移植 Web failure state、reconnect marker、相应 unit/E2E 与 Web testing rule；不引入 `desktopManaged`、旧 env 或 desktop guidance。
- 风险/验证：中；覆盖初始连接不误判、同 generation 新 `lastOnlineAt`、generation 变化、失败可见/按钮恢复、成功 disconnect→reconnect。

### 建议暂缓为独立高风险 bundle

#### `dfe3330ef837d801dd8c4de499247aa7d7a63896` — keyboard-driven Add Project flow

- 行为：提供 host 选择、daemon directory search、手工路径注册、GitHub repo 搜索、clone destination 和原子空目录创建；新增 additive RPC 与 1000+ 行 Web flow。
- 面：Web/daemon/client/protocol 主能力高度 aligned；少量 desktop directory dialog 必须省略。
- 依赖：依赖 Command Center workspace 基础，并被下一笔 registration/workspace 语义修正。
- 冲突：跨 protocol/session/App root/route/i18n；upstream 新 UI 大量硬编码英文，不能直接进入多语言 BySpace。
- 建议：**defer** 到单独 Add Project issue，与下一笔一起做 Web-only partial port；不是拒绝。
- 风险/验证：高；需要 trust-boundary path validation、rollback、GitHub auth/SSH/HTTPS、multi-host/capability gate、全量本地化和完整 Web E2E。

#### `943d03ad995a613558752d2863b51e78419fba54` — registration 与 workspace setup 分离

- 行为：clone/add/create 只注册 project，再进入 New Workspace；Add Project 与 Search 独立挂载；归一化重复 clone destination；CLI 输出改为 project identity。
- 面：Web/daemon/CLI 全部 retained，且是上一笔功能的必要修正。
- 协议 blocker：upstream 删除已发布的 `workspace.github.clone.*` 与 `workspaceGithubClone`；BySpace 协议合同禁止移除。未来必须 additive 保留 legacy request/response/feature，并以 `COMPAT(...)` 标记。
- 建议：**defer** 并与上一笔一起 partial compatibility port；绝不 full replay。
- 风险/验证：高；覆盖 old-client/new-daemon、new-client/old-daemon、legacy clone response、新 project clone 不隐式创建 workspace、CLI JSON compatibility 与 Add Project/Search ownership。

### 已由 BySpace 基线覆盖

#### `3e8dce7d7c9b1a3ef8e1ed8c18faa3d6f36da113` — Web 隐藏 Browser pin

- 行为：普通 Web 不显示 desktop-only Browser shortcut。
- 当前状态：BySpace 已删除 Browser target union、launcher branch 与默认 pin，并在 store 读取时过滤未知旧 target；当前结果比 upstream conditional 更彻底。
- 建议：**inherited**，不 replay，防止恢复 Browser/Electron 检测。
- 风险/验证：低；保留 workspace-pin target/store tests。

### 建议跳过

#### `5ef1b9dbb118001729ac13ffc03b26d121bce809` — website deploy test dependency

- 仅修已删除 marketing website workspace 的 deploy install；**skip**。

#### `38cfe109c937a8bd8c33e7c5a2b5d625e252103f` — website lock 对应 Nix hash

- hash 绑定上一笔 excluded lock graph，不能用于 BySpace；**skip**。

#### `d791a0aa91236a28fe23b0be362f0baf0abf2fd1` — upstream 0.1.108 changelog

- 混合 Browser/Electron 与未全部采用的行为；复制会产生虚假 BySpace release notes；**skip**。

#### `75ea0d4534a2922e6f3072d805008474ac4728bd` — upstream 0.1.108 release bump

- 会恢复旧 package identity、已删除 workspaces 和 upstream 版本线；**skip**。

#### `8554b94cdb3c6374ce3fb10ac5dafb7a15eb3364` — 0.1.108 lock 对应 Nix hash

- 只对 upstream release lock 有效；**skip**。

#### `64c819efeb6fa301b751f5382468ab1beaaa68af` — Electron sandbox preload 修复

- 只修 Electron preload 与 in-app Browser partition；两个面均已删除；**skip**。

#### `75d784534f07b0ebb1a7ff35de7f15783e7000ac` — upstream 0.1.109 changelog

- 只描述 Electron bridge 修复；**skip**。

#### `42e101c81ea6a1ab9da6c49b36a55cafc1df9c8e` — upstream 0.1.109 release bump

- 同样与 BySpace package/version/workspace identity 冲突；**skip**。

#### `d7ca1b5a03f812d4147695c54ec55b58b72d8b79` — 0.1.109 lock 对应 Nix hash

- 只对 upstream release lock 有效；**skip**。

#### `47532952f325912094593889b65c98ea5aa49912` — packaged Electron smoke

- 依赖 desktop artifact、Xvfb/CDP/preload/managed daemon；BySpace 已有 Web export 与三平台 npm tarball smoke；**skip**。

#### `f4509fe04450be76eac7ab574b3944590f46f571` — 打开更多本机 editor

- 实际能力依赖 Electron IPC、本机 executable discovery、OS process launch 与 desktop assets；Web 的文件 tab/GitHub blob 打开是独立能力，不能用这笔实现替代；**skip**。

## 用户批准 Artifact

- **Full（4）**：`37bde90d9f4aaf45c755f828ee25a6b189f18065`、`90e0a0e353a90e12d91d88a91e64dda7984928c0`、`e528a0db067cf32f2a615347290a1f72ac40a010`、`d42ab91971a92bf2e2a981848989c7ca6536a18e`
- **Partial（1）**：`6aba0370aeea9973260a9dd594097d127e7dc834`
- **Defer（2）**：`dfe3330ef837d801dd8c4de499247aa7d7a63896`、`943d03ad995a613558752d2863b51e78419fba54`
- **Inherited（1）**：`3e8dce7d7c9b1a3ef8e1ed8c18faa3d6f36da113`
- **Skip（11）**：`5ef1b9dbb118001729ac13ffc03b26d121bce809`、`38cfe109c937a8bd8c33e7c5a2b5d625e252103f`、`d791a0aa91236a28fe23b0be362f0baf0abf2fd1`、`75ea0d4534a2922e6f3072d805008474ac4728bd`、`8554b94cdb3c6374ce3fb10ac5dafb7a15eb3364`、`64c819efeb6fa301b751f5382468ab1beaaa68af`、`75d784534f07b0ebb1a7ff35de7f15783e7000ac`、`42e101c81ea6a1ab9da6c49b36a55cafc1df9c8e`、`d7ca1b5a03f812d4147695c54ec55b58b72d8b79`、`47532952f325912094593889b65c98ea5aa49912`、`f4509fe04450be76eac7ab574b3944590f46f571`
- Coverage：`4 + 1 + 2 + 1 + 11 = 19`；19 个 full SHA 唯一，覆盖 frozen range 全部提交。
- 推荐批准集：执行 Full 4 + Partial 1；Defer 2 留给独立 Add Project bundle；Inherited/Skip 只记账不 replay。
- 未经用户明确批准不进入 scratch replay。

## 执行记录

- 已冻结 range 与 count；尚未 replay。
- 两个独立只读 reviewer 分别审查 App/UX 与 daemon/protocol/release 全部 19 笔；父级复核关键 diff、当前 BySpace 实现与依赖。
- 对 Full 4、Partial 1 和 Add Project bundle 做了 patch applicability 检查：除明确排除的 Electron/website 面外，当前推荐集可在 scratch 中逐笔验证；Add Project 的主要 blocker 是高风险协议/路由/i18n 范围而非简单冲突。
- 用户批准 Artifact 通过 `git rev-list` 对比验证：19 个 SHA 唯一且与 frozen range 完全一致。

## 关闭回写

- 完成 replay 后把 batch、source-to-local mapping、defer/skip 和 hardening commits 写入 `.byspace/upstream-sync.json`。
- 稳定维护约束只有发生变化时才更新 `docs/upstream-sync.md` 或 project spec；逐笔证据留在本 issue。
