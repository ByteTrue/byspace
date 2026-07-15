---
kind: issue
title: "审阅并移植最新 Paseo upstream 更新"
status: open
created: 2026-07-15
epic: ".cs/epics/2026/07/14/web-only-byspace/spec.md"
---

# 审阅并移植最新 Paseo upstream 更新

## 目标

冻结 Web-only 基线之后新增的完整 upstream 提交区间，逐笔判断对 BySpace 保留能力的价值。在用户看过完整提交账本并批准前不 cherry-pick；批准后只移植 Provider（尤其 Pi）、Agent 生命周期、Relay/安全、CLI/daemon 与浏览器 Web 真正需要的提交。

## 现状如何工作

BySpace 保留 Paseo Git 历史并把 `upstream` 指向 `getpaseo/paseo`。本地分支在 upstream 基线提交上增加自己的裁剪提交，因此 raw SHA 分叉不能直接代表功能差异。上游同步应固定 `COMMIT1..COMMIT2`，读取该范围内每个提交及其 diff，按保留/删除的产品边界判断，而不是 merge 整条分支。

## 影响范围

### 必须修改

- 建立覆盖 `COMMIT1..COMMIT2` 每个 SHA 的 ledger，不遗漏 release、维护或冲突提交。
- 标记每笔提交的行为、所触及的保留/删除边界、建议动作和风险。
- 用户批准后，通过 scratch replay 验证获批序列，再进入主分支。

### 需要验证

- Provider registry、Pi/Claude/Codex/OpenCode 和 ACP 行为。
- Agent lifecycle、timeline、session、WebSocket、pairing、relay、安全与 CLI/daemon。
- upstream 提交是否重新引入 Electron、native App、Browser automation 或 marketing website。

### 仍待调查

- 当前 `COMMIT2` 的确切 SHA 与提交数量，需成功 `fetch --no-tags upstream main` 后冻结。
- 大型战略功能若与 BySpace 方向一致但冲突较重，必须作为 rewrite/defer 交用户决定，不能因难合就静默跳过。

## 实现设计

1. 使用显式 `--no-tags` fetch，记录 `COMMIT1`、`COMMIT2` 和提交总数。
2. materialize 全部提交元数据与逐笔 diff，形成一 commit 一行的 ledger。
3. 对 ledger 做 coverage check，确保范围中的每个 SHA 在用户摘要中恰好出现一次。
4. 按功能、bugfix、安全、release/maintenance 分组向用户展示；每组列出全部 SHA、建议与风险。
5. 等用户明确批准范围；若批准全部或高风险集合，先重新呈现高风险计划并做 scratch replay。
6. scratch 通过后逐笔 cherry-pick 或按行为重写，保留原 SHA 追溯；冲突文件不得盲取 upstream。
7. 运行受影响的聚焦测试与全仓 typecheck/lint/build，并记录未移植原因。

## 验证

- 冻结范围计数与 ledger 数量一致。
- 用户摘要 coverage check 每个 SHA 恰好一次。
- 获批序列 scratch replay 通过后才修改主分支。
- 移植后 Provider/Pi、Web、daemon/CLI、relay 的相关验证通过。

## 执行记录

待执行。

## 关闭回写

- 稳定的 upstream 选择策略先回写 epic；epic 关闭时毕业到 project spec。
- 每笔提交的证据和未移植原因留在本 issue。
