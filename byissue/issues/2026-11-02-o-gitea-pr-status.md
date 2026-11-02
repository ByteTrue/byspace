---
kind: issue
title: "Gitea 的 PR 状态没有移植：侧栏徽标与 PR 面板对 Gitea 仓库永远显示没有 PR"
type: issue
status: open
created: 2026-11-02
---

# Gitea 的 PR 状态没有移植

## 现状

Go 的 `workspace.CurrentPRStatus`（`internal/workspace/pr_status_poll.go`）对 Gitea 直接返回「没有 PR」。这次之前 Go 把 Gitea 当 GitHub 处理，`gh pr view` 在 Gitea 仓库上失败，结果一样是没有 PR。所以 Gitea 仓库的侧栏 PR 徽标、PR 面板的状态、合并按钮从来没有可用过。

Node 的实现在 `git show 20721fdcf^:archive/packages/server/src/services/gitea-service.ts`：

- `loadCurrentPullRequestStatus`（约 1990 行起）：先翻开着的 PR（`listPullRequestItems`，每页 50），再查最近更新的 PR（`tea api repos/{owner}/{repo}/pulls?state=all&sort=recentupdate`），开着的优先，已结束的按 head 提交匹配，fork 的 PR 按 head 提交放行。
- `toCurrentPullRequestStatus`（约 1030 行）：状态、mergeable、CI 汇总、forgeSpecific（Gitea 家族统一标 `gitea`）。
- `loadCurrentPullRequestChecks`：`tea pr N -o json` 拿 head 提交，再读合并提交状态与 Actions 任务（`loadCombinedCommitStatusBestEffort`、`loadActionTasksBestEffort`、`loadActionRequiredRunIdsBestEffort`、`applyGiteaChecks`）。

## 要做

照 Node 移植，接进 `CurrentPRStatus` 的 `gitea` 分支（去掉那里的 `shortcut:` 注释），补 Go 测试（用假的 `tea` 脚本），`npm run audit`。本机没有 Gitea 账号，实测需要用户提供一个能登录的 Gitea/Forgejo/Codeberg 仓库。

## 实现（2026-11-02，同一快改）

照 Node 移植进 `internal/workspace/gitea_pr_status.go`，接到 `CurrentPRStatus` 的 `gitea` 分支（Gitea、Forgejo、Codeberg 都走这里），侧栏徽标与 PR 面板共用：

- 找 PR：先翻开着的 PR（`tea pr list`，每页 50、最多 4 页），按 head 分支和 origin 的 owner 匹配；没有再查最近更新的 50 个（`tea api …/pulls?state=all&sort=recentupdate`），开着的优先，已结束的只在 head 提交还是 checkout 的 HEAD 时算；fork 的 PR 按 head 提交匹配。
- 检查：`tea pr N` 拿 head 提交，读这个提交的合并状态（commit statuses）和 Actions 任务（最多 5 页 × 50）。Gitea 给自己的 Actions 作业镜像出来的 status 去掉（否则每个作业算两次），同一 workflow 只留最新一次执行，等待审批的运行标 `action_required`，`warning` 算失败；汇总同时看 status 和 Actions，一个失败的 Actions 运行不会因为合并状态是 success 而显示通过。任何一步失败都保留不带检查的 PR 状态，同 Node。
- forgeSpecific：`{forge: "gitea", mergeable, hasMerged, ciStatus}`。

验证：Go 测试用假的 `tea` 脚本覆盖开着的 PR、已合并 PR 按 head 提交匹配、镜像 status 去重、workflow 重跑取最新、审批等待、warning。本机没有能登录的 Gitea/Forgejo/Codeberg 账号，没有实测，需要你提供一个仓库才能验。
