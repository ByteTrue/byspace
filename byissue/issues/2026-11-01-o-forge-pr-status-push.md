---
kind: issue
title: "PR 状态的后台轮询与推送（workspace payload 里的 github 段缺失）"
type: issue
status: open
created: 2026-11-01
---

# PR 状态的后台轮询与推送

## 现状

Node 的 `workspace-git-service` 为每个仓库目标维护 forge 快照，并按 PR 状态轮询：检查在跑时 20s（`FORGE_PR_STATUS_POLL_FAST_INTERVAL_MS`）、空闲 120s（`FORGE_PR_STATUS_POLL_SLOW_INTERVAL_MS`）、错误指数退避到 300s 上限，**变更后随 `workspace_update` 推送**（`session.ts` 的 workspace 快照带 `github: { featuresEnabled, pullRequest }`）。

Go 侧：

- 有拉取 API：`checkout_pull_request` → `workspace.GetPRStatus`，`internal/workspace/forge.go`。
- 没有周期性刷新，也没有推送。
- `internal/server` 的 workspace descriptor **完全没有 `github` 段**，协议里 `WorkspaceGitHubRuntimePayloadSchema.pullRequest` 在前端恒为缺失。

## 为什么现在不做

这不是一个可以就地补的不变量，而是一次 payload 契约与消费方的决定：

1. 要新增 workspace payload 的 `github` 段（含 `featuresEnabled`、`pullRequest`、`checks` 的完整形状），并决定它与 `checkout_pull_request` 响应的关系——两份数据同时存在时必须能说清谁是权威。
2. 消费方是正在重写的 web 客户端（`web/` 分支进行中）。现在推一个没人读的字段，等于制造第二个数据源。
3. 轮询本身要按 Node 的成本设计来做：检查 pending 时快、空闲时慢、错误退避、按仓库去重、GraphQL point 预算（Node 的批量上限 25、对齐网格 5s 都是为 5000 点/小时的配额设计的）。直接照抄成「每个 workspace 一次 `gh pr view`」会把配额打穿。

## 验收标准

- workspace payload 出现 `github.pullRequest`，字段通过协议校验，且与 `checkout_pull_request` 的同一 PR 数据一致（同源，不各自计算）。
- 检查 pending 时 ~20s 内面板能看到新状态，空闲时不再高频请求；连续失败时退避到 300s 上限并保留最后一次成功数据。
- 多 workspace 共享同一仓库时，一次轮询只发一次请求（按 repo 去重）。

## 参考

- Node：`packages/server/src/server/workspace-git-service.ts`（快照与轮询）、`services/github-service.ts`（批量、退避、配额）、`server/session.ts:4900`（payload 组装）。
- 本仓相关：`byissue/notes/018-durable-object-billing-and-hibernation.md`（为什么每帧都要算成本）、`docs/forge-providers.md`。
