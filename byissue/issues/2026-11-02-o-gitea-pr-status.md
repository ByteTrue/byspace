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
