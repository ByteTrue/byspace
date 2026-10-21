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

## 验收与关闭（2026-10-21）

**验收结论：部分交付。Service Proxy 与 Tunnels 未做，已转为 DROPPED/MISSING 并记录条件。**

已交付：

- **Web Push** 真实投递：RFC 8291 `aes128gcm` + RFC 8292 VAPID ES256，自实现；用浏览器私钥
  往返解密验证过（只有这一步能证明做对了）。
- **Skills 事务同步**：`targets: ["agents"|"claude"]`、`skillTargets` 持久化、SHA-256 比对、
  回滚（此前失败会静默留下半装状态而 UI 显示已最新）、启动时自动修复 drift（只做非破坏性操作）。
- **Quota**：框架 + `codex` / `zai` 两家（只读凭据不刷新——刷新归 provider CLI 管，
  两个 daemon 轮换同一 token 会把用户登出）。缺凭据返回 `unavailable` 而不是 `error`。

**未交付，已转 Issue 记录条件**：

- **Service Proxy 整条链路**（`service-proxy.ts` 1039 行 + `script-health-monitor.ts` +
  端口注册表）：脚本预览 URL 与主机名路由不存在。脚本能跑、能拿到 `PORT`，但没有反向代理。
- **TCP Tunnels**：需要第二台机器验证，盲写风险高于收益。
- **其余 6 家 quota**（claude/cursor/copilot/grok/kimi/minimax）：需要真实凭据。

这三项都已在 `audit-log.md` 与 Epic spec 的未完成清单里逐条写明。
