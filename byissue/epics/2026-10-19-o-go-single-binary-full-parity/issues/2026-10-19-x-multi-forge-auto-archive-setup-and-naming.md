---
kind: issue
title: "多 Forge（GitHub/GitLab/Gitea）、PR 自动归档、Workspace Setup 脚本与 AI 自动命名"
type: feature
created: 2026-10-19
---

# 多 Forge（GitHub/GitLab/Gitea）、PR 自动归档、Workspace Setup 脚本与 AI 自动命名

## 目标与范围

对齐多 Git 托管平台（GitHub `gh`、GitLab `glab`、Gitea `tea`）自动识别与 PR/MR 操作、工作区脚本与 Worktree 管理。

## 执行记录

- 在 `internal/workspace/forge.go` 中实现 `DetectForge`（根据 `git remote get-url origin` 自动识别 `github` / `gitlab` / `gitea`），支持 `gh pr view/create/merge` 与 `glab mr view`、仓库搜索 `SearchGitHubRepos`。
- 在 `internal/server/handlers_parity_workspace.go` 中实现读取项目 `byspace.json` 脚本定义并在 PTY 会话中启动脚本。

## 验证

- `go test -v ./internal/workspace ./internal/server` 全部通过，且 `checkout_pr_status_response`、`forge.search.response`、`workspace.github.search_repositories.response` 通过 `WSOutboundMessageSchema` 校验。

## 关闭候选

- 关闭时回写本 Epic `spec.md` 推进视图。
