---
kind: issue
title: "建立 upstream 0.2.0-beta.1 薄发行基线"
type: chore
status: open
created: 2026-07-19
epic: ".cs/epics/2026/07/19/upstream-thin-distribution/spec.md"
---

# 建立 upstream 0.2.0-beta.1 薄发行基线

## 目标

当前 BySpace 深分叉获得不可变 archive ref；新的 tracking branch 从 upstream `v0.2.0-beta.1` 精确 commit `0bec06c2db7d3ee071416cde80229eabd682b03e` 建立，并在隔离 worktree 中承载后续 overlay，不改动当前生产 `main`。

## 范围

- 包含：确认 tag/commit、记录当前 HEAD/origin/main、建立 archive branch/tag、建立 tracking branch/worktree、复制本 Epic 所需 `.cs` 当前材料、记录 upstream remote/base。
- 不包含：实现 overlay、改写 `main`、推送 archive/main、部署、npm 发布、本机 daemon 切换。

## 归属

- 隶属 epic：`.cs/epics/2026/07/19/upstream-thin-distribution/spec.md`
- 相关 spec：`.cs/spec/index.md`

## 背景与证据

- upstream beta tag 已解析到 `0bec06c2db7d3ee071416cde80229eabd682b03e`。
- 当前深分叉相对 upstream 有 1,905 文件差异，继续逐 commit replay 不再经济。
- 当前 local `main` 还包含未推送的全局 mise Node 修复，archive 必须覆盖实际本地 HEAD，不能只记录 origin/main。

## 质量目标

- **可靠性 / 可恢复性**：
  - 目标：任何后续步骤失败时，都能用明确 ref 恢复当前 Git 树；tracking 准备阶段不改变生产分支、部署或 daemon。
  - 来源：Epic 可靠性约束。
  - 预期证据：archive ref 指向准备前 HEAD；新分支 merge-base/ancestor 是精确 beta commit；当前 main/origin 保持不变。
- **可维护性 / 可分析性**：
  - 目标：新分支的 upstream base 与每个 downstream patch 可由 Git 直接解释，不通过树覆盖或 squashed vendor import 隐藏来源。
  - 来源：用户决定与 Epic。
  - 预期证据：Git log、base ref 与工作树状态。

## 操作方案

1. 给当前本地 HEAD 创建带日期和版本含义的 archive branch；切换前不删除任何旧 tag/release。
2. 从 beta commit 创建独立 tracking branch 与 `/private/tmp` worktree。
3. 把 `.cs` 中本 Epic 当前材料作为首个 downstream metadata commit 引入新分支；不携带旧 AGENTS/branding/upstream-sync 规则。
4. 新建一份简短 downstream base 记录，后续 patch queue 可从 base 到 HEAD 逐 commit审查。
5. 不推送、不修改 default branch；production cutover issue 才处理共享 Git 状态。

## 风险边界

- 可能影响：本地 refs、临时 worktree。
- 明确不碰：origin/main、Cloudflare、npm、`~/.byspace`、6777 daemon。
- 需要用户确认：无；实际共享 ref push 和 main 改写后置到 cutover。

## 验证

- archive ref、tracking HEAD、beta commit SHA 和 ancestor 关系。
- 两个 worktree 均 clean；当前 main/daemon/部署未改变。

## 执行记录

- 待执行。

## 关闭回写

- epic spec：记录 archive/tracking refs 和 exact base。
- notes：无。
- AGENTS.md / CLAUDE.md：新基线后按薄下游规则重建，不从旧深分叉复制。
- tools：无。
