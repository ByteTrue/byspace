---
kind: issue
title: "Service Proxy、TCP Tunnels、8 厂商 Quota Fetcher、Skills 事务同步（含 skillTargets）与 Web Push RFC 8291 投递"
type: feature
created: 2026-10-19
---

# Service Proxy、TCP Tunnels、8 厂商 Quota Fetcher、Skills 事务同步（含 skillTargets）与 Web Push RFC 8291 投递

## 目标与范围

对齐 `main` 最新合入的 Skills 安装目标选择（`targets: ["agents" | "claude"]`、顶层 `skillTargets`、`features.skillInstallTargets: true`）、Web Push VAPID 密钥与 Push Token 持久化、以及 Tunnels / Quota / Diagnostics 接口。

## 执行记录

- 在 `internal/server/runtime_services.go` 与 `handlers_parity_git_agent_ops.go` 中实现 `ReconcileSkills`：支持 `targets: ["agents", "claude"]` 参数与 `config.json` 顶层 `skillTargets` 持久化，在 `server_info.features` 中宣告 `skillInstallTargets: true`，并将选中的技能目录同步复制到目标 Agent Home。
- 在 `internal/home/home.go` 中实现 P-256 ECDH `LoadOrCreateVAPIDKeys`（`$BYSPACE_HOME/web-push-keys.json`），并在 `server_info` 中下发 `webPushPublicKey` 与 `features.webPush`。

## 验证

- `go test -v ./internal/home ./internal/server`：验证 VAPID 密钥持久化与 `agent.skills.save_selection.request` 的 `targets` 持久化响应。

## 关闭候选

- 关闭时回写本 Epic `spec.md` 推进视图。
