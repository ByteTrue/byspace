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

## 验收与关闭（2026-10-21）

**验收结论：交付。**

- GitHub（`gh`）/ GitLab（`glab`）/ Gitea（`tea`）三家的 PR 状态、创建、合并、搜索、
  check 详情、PR 讨论线程、GitLab pipeline 与 approvals 全部落地。
- 自动归档：只在 PR 已合并、工作树干净、无未推送提交、worktree 是 BySpace 自建、
  且未因该 PR 归档过时执行；`CountAheadOfOrigin` 返回 `-1`（未知）时**拦截而不是当成 0**。
- setup 脚本 + 异步进度推送、AI 自动分支命名（真实模型端到端验证：中文 prompt →
  `fix-safari-login-autofill`）。

审计后补的两处：`assertDirectPullRequestMergeReady`（此前只要有 PR 就给合并按钮，
仓库禁用该方式或被 block 时用户从 gh 原始报错里才知道）、forge 从 **URL 子串**判断改为
**精确 host 列表**（GitHub 上名为 `gitlab-mirror` 的仓库曾被判成 GitLab，之后所有 gh 调用
跑成 glab）。

**未做且已记录**：gitea 家族软件探测（Gitea/Forgejo/Codeberg 的 API 路径差异）与 CI 状态抓取。
