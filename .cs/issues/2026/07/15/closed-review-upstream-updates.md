---
kind: issue
title: "审阅并移植最新 Paseo upstream 更新"
status: closed
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

## 冻结范围与提交账本

- `COMMIT1`: `279e1aa91c0e8c1a3afa1ef0f4e1094e8ebbb239`（范围左端不包含）
- `COMMIT2`: `6804882761fcb9a511338f1fed19b9ed45e99e45`
- 范围提交数：26
- 实际 baseline parent / merge-base：`1f5283f5a36926f31ec9cbf020072fe1dc35dfa7`；因此前 6 笔已经包含在 Web-only baseline，不再 replay。

|   # | Commit                                     | 结论               | 风险与理由                                                                                                                                                |
| --: | ------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | `3b078240a84d55c88f16ee425e1489003235c678` | 已包含             | Nix daemon Web UI packaging 已在 baseline；重复应用会冲突。                                                                                               |
|   2 | `81113d15829ccbc890096929cf0532d1f325309c` | 已包含             | Tool-call detail level 第一代实现已在 baseline。                                                                                                          |
|   3 | `f35b16b316594b693018cb5740b096fca99d5be1` | 已包含             | 跨 Provider orchestration 文档已继承；已删除的 Browser 文档不恢复。                                                                                       |
|   4 | `9ea58aae0cfece29a8ca0b696bc5e197e550a69b` | 已包含             | OpenCode SSE crash、mode discovery/default 和 create validation 修复已继承。                                                                              |
|   5 | `c0b801b80590d6bc75a72ca6de501d065c193cc7` | 已包含             | Web 键盘 `- = ; '` capture 修复保留；Electron IPC 已裁剪。                                                                                                |
|   6 | `1f5283f5a36926f31ec9cbf020072fe1dc35dfa7` | 已包含             | Cross-workspace provider subagent ownership/activity 已继承。                                                                                             |
|   7 | `cd6c608c9e25a0a1c1332c70bb68209d4c612094` | 建议完整合入       | **高价值 / 中高风险**。修复 Pi 本地 slash command 无 model turn 时永久挂起；需验证新旧 Pi、普通 turn、notify/output ordering。                            |
|   8 | `d781b687115b65058d4a8ad2b9abdc9a4d0e9ef3` | 建议部分移植       | **中风险**。只取 Web help menu 与 host version；删除 website/changelog 与上游 URL。                                                                       |
|   9 | `1b8af2e58ee872014f5940071a924b24e25c65f3` | 建议 defer rewrite | **高风险功能包**。Tool summary projection、live/error state 与 browser-native scrollbar 有价值，但跨 55 个 Web/native 文件；需连同 #14/#16/#23 重写。     |
|  10 | `50ed0d0ab11d8f5d9543096329436bb37c303ff0` | 建议 defer partial | **高风险混合提交**。只保留 half-screen Web width/sidebar/focus 思路；Electron window chrome 全部排除。                                                    |
|  11 | `d706c4339b0e98133b839771b756accc4ea87078` | 建议完整合入       | **高风险核心修复**。统一 run state 与 cancellation acknowledgment，修复 Codex hidden subagent/stuck parent；影响所有 Provider、loop、voice、rewind、CLI。 |
|  12 | `9c40cb76371247c2249e20fc708b4e02cd3360c6` | 建议完整合入       | **中风险 bugfix**。正确编码带空格/URI 字符/UNC 的 Provider image path；共享 Provider 边界且测试充分。                                                     |
|  13 | `77f6069ec142f58f3ccb85ed016adc90d076cfa1` | 建议跳过           | Electron window chrome/sidebar control ownership，依赖已删除的 #10 Electron 部分。                                                                        |
|  14 | `38e4d9ad5d2498e228bd1d6215576763b21cc719` | 建议 defer bundle  | Tool summary polish，依赖 #9 新 overview 模型；不得单独应用。                                                                                             |
|  15 | `abfe955867f036e6e32d67cd9ab2d06c43c9e1b1` | 建议完整合入       | **高风险 Provider UX**。保留 Claude/Codex native child 名称并隐藏 finished work，不是 native App；需确保 Pi/active descendants/history 不受损。           |
|  16 | `36738464339ff6d39c983294acfd2b82db762b3d` | 建议 defer bundle  | #14 的单 tool-call interaction 修复，必须随 #9/#14 一起。                                                                                                 |
|  17 | `5ddd5f3726782ef6793b6cfd304aab0097b089c0` | 建议 defer partial | Wide-Web sidebar retained-mount 可保留状态/性能，但需脱离 Electron layout chain，验证 accessibility/activity gates。                                      |
|  18 | `4a5630bfcefc728b57cd8fcc5efc4923e786fe17` | 建议部分移植       | **低风险 Web bugfix**。用 `scrollbar-gutter: stable` 修复 composer 高度闪烁，适配当前 scrollbar 路径。                                                    |
|  19 | `319d9017c225a7b2d38027959f7de7a71d320ee9` | 建议跳过           | 仅 Android APK version + marketing website，两者均已删除。                                                                                                |
|  20 | `7f011d16c5785f02581d53f943a44cc811b8cb78` | 建议部分移植       | **中高风险性能/数据语义**。Draft memory 实时、持久化 200ms throttle，并在 background flush；需手工适配 Web lifecycle。                                    |
|  21 | `f06792ae89d6be21457b025a98d336929730e287` | 建议跳过           | Stale PID lock reclaim 的授权入口来自已删除 Electron startup；只取 server heartbeat 会增加无消费者复杂度。                                                |
|  22 | `04e893417e2e95c77a25a413edb675557813d727` | scratch 完整合入   | **高风险战略功能**。允许 failed turn 以 timeline cursor fork；scratch 证明完整 patch 可落在当前 protocol/client/timeline/server，字段保持 optional。      |
|  23 | `9423b091b9ebe944dced8e1a28f698e27aa7c784` | 建议 defer bundle  | #9 overview 的 aggregate failure 中性化 follow-up；个体错误仍保留，不得独立应用。                                                                         |
|  24 | `328361667f20a74c791f18454e6a7de8576b3279` | 建议跳过           | 完全属于 Electron in-app Browser profile persistence/automation/settings。                                                                                |
|  25 | `13e92f8a3075ef815da143573c5f6a78cd2458f9` | 建议完整合入       | **中高风险 ACP 修复**。为 spontaneous ACP updates 创建 autonomous turns；需验证 timeout、foreground handoff 和 shutdown。                                 |
|  26 | `6804882761fcb9a511338f1fed19b9ed45e99e45` | 建议跳过           | Android SDK/JDK 与 iOS/Android 本地开发文档，超出 Web-only 边界。                                                                                         |

### Coverage check

- 冻结范围：26 commits。
- Ledger：26 rows / 26 unique hashes。
- 最终处理：已包含 6；完整合入 6；部分移植 3；defer rewrite/partial 6；跳过 5。
- 每个 SHA 恰好出现一次。

## 验证

- Ledger coverage：冻结 26 commits，26 rows / 26 unique SHA，每笔恰好一次。
- Scratch replay：从审批前 main 建立隔离 worktree；其中 failed-turn fork 完整 patch 无冲突且不触及排除面，最终按 upstream 顺序完整应用 6 笔、行为移植 3 笔；excluded-surface path scan 为零，再 fast-forward main。
- Server 高风险切片：12 files / 426 tests 通过；review hardening 后 AgentManager + ACP 2 files / 209 tests 通过。
- App：subagent、draft persistence、timeline/fork 等 9 files / 172 tests 通过；composer gutter 2 tests 通过。
- Protocol attachments 11 tests、Client 95 tests、CLI delete 1 test 通过。
- 修改过的 Help destination Playwright 用例 1 passed；同文件另 3 个 diagnostic-sheet 用例是 baseline 已存在的失败，相关 wiring 不在 replay diff 中。
- Root lint、format check、typecheck、server build、Web export、`git diff --check` 通过。
- 三轮独立只读 review 发现并复核修复：pending-start cancellation 假成功、ACP autonomous timer/ID 泄漏、composer inline gutter 覆盖 CSS、Help port 越过审批范围。
- `npm run upstream:check` 证明 `.byspace/upstream-sync.json` 的 Git range、分类、local mappings 与 cursor 完整。

## 执行记录

- 用户批准推荐集合时为完整 5、部分 4；scratch 证明 failed-turn fork 可以完整保留且不恢复排除面，最终记录为完整 6、部分 3；其余仍为已包含 6、defer 6、skip 5。
- 完整 replay：Pi local slash completion、AgentRunState/cancellation、Provider image URI、Claude/Codex native subagent naming/hiding、failed-turn cursor fork、ACP spontaneous autonomous turns。
- 行为移植：Web help/host version（不含 What's New/website）、composer stable gutter、draft persistence throttle/flush。
- Review hardening 另产生 stale Browser test cleanup 与 cancellation/ACP/composer/help 回归修复。
- Main 已 fast-forward 到验证后的 scratch 结果；完整 upstream-to-local 映射、deferred/skip 决策和 hardening commits 记录在 `.byspace/upstream-sync.json`。
- Cursor 已推进到 `6804882761fcb9a511338f1fed19b9ed45e99e45`。后续增量从该 SHA 的下一个 commit 开始。

## 关闭回写

- 稳定的 upstream 选择策略先回写 epic；epic 关闭时毕业到 project spec。
- 每笔提交的证据和未移植原因留在本 issue。

## 关闭结论

- 关闭判断：冻结区间 26 个 commit 已全部获得唯一 disposition，用户批准的 6 笔完整与 3 笔行为移植已在 scratch replay 后进入 main，cursor 和本地映射完整。
- 验证摘要：ledger coverage、`npm run upstream:check`、426 个高风险 Server tests、209 个 AgentManager/ACP hardening tests、172 个 App tests、Protocol/Client/CLI 检查、Web export 与三轮独立 review 均通过。
- 回写位置：选择性 upstream 维护策略、完整账本/审批门禁和 cursor 语义已合并到所属 Epic，并在 Epic 关闭时毕业到 `.cs/spec/index.md` 的“当前方向”“维护 upstream”和“关键考量”；操作流程由 `docs/upstream-sync.md` 与 repo-local skill 承担。
- 遗留事项：本批 defer/skip 的逐笔理由保留在本 issue 和 `.byspace/upstream-sync.json`，不阻塞关闭；下一批从 `6804882761fcb9a511338f1fed19b9ed45e99e45` 的下一个 commit 开始。
