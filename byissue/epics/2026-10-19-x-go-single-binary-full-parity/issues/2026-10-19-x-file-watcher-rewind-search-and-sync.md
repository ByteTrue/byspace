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

## 验收与关闭（2026-10-21）

**验收结论：交付，其中目录同步为 DROPPED。**

审计发现的三个真缺陷都只有逐文件读才会暴露：

| 缺陷                                   | 后果                                            |
| -------------------------------------- | ----------------------------------------------- |
| `PollSubscriptionsOnce` **从未被启动** | 文件订阅与 diff 订阅注册后永远不推送            |
| 文件订阅每秒**读整个文件**算 revision  | 对 agent 正在 tail 的 10 MB 日志是每秒 10 MB IO |
| `agent.rewind` 只截断内存时间线        | pi 的树导航是**扩展**不是 RPC，扩展从未移植     |

rewind 现在的做法是生成 pi 集成扩展并走真实 `navigateTree`，与 Node 同一机制。

**DROPPED**：跨主机目录同步（`directory-sync/`），产品方向未定。
