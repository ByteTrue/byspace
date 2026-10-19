---
kind: issue
title: "文件/Git 实时监听推送、Agent Rewind 快照回滚、历史全文搜索分页与目录同步"
type: feature
created: 2026-10-19
---

# 文件/Git 实时监听推送、Agent Rewind 快照回滚、历史全文搜索分页与目录同步

## 目标与范围

对齐文件与 Git Diff 订阅实时更新推送（`fs.file.update` / `checkout_diff_update`）、Agent Rewind 对话截断与代码回滚、以及 Agent 历史列表的 `searchQuery` 全文检索、过滤、排序与游标分页。

## 执行记录

- 在 `internal/server/runtime_services.go` 中实现 `RegisterFileSubscription`、`UnregisterFileSubscription`、`RegisterDiffSubscription`、`UnregisterDiffSubscription` 与 `PollSubscriptionsOnce`，当被订阅文件版本或工作区 Git Diff SHA-256 摘要变化时主动向订阅客户端推送 `fs.file.update` 与 `checkout_diff_update`。
- 实现 `FilterAndSortAgents`：在 `fetch_agents_request` / `fetch_agent_history_request` 中支持 `searchQuery`、`filter`（`workspaceId`, `provider`, `status`）、`sort`（`updated_at`, `created_at`, `title`）与 `limit`/`cursor` 分页。
- 在 `internal/server/handlers_parity_git_agent_ops.go` 的 `agent.rewind.request` 中支持截断会话 Timeline 及调用 `workspace.DiscardChanges` 回滚工作树修改。

## 验证

- `go test -v ./internal/server -run TestServerFileExplorerPiSessionImportAndTerminalRPC`：验证订阅文件后修改磁盘文件触发 `fs.file.update` 实时推送。

## 关闭候选

- 关闭时回写本 Epic `spec.md` 推进视图。
