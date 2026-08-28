---
kind: issue
title: "硬化 Relay data session 重试、收敛与 teardown"
type: bug
status: closed
created: 2026-08-28
---

# 硬化 Relay data session 重试、收敛与 teardown

## 做成以后是什么样

Relay control 已通知 `connected` 后，即使 daemon 首次 data-socket dial 遇到瞬时 HTTP/网络失败，也会在同一个 active `connectionId` 下有界退避重试，不需要等待 Relay 重发 control event。`disconnected`、新 `sync`、control reconciliation 或 daemon shutdown 能立即取消重试和已建立 session，并等待 goroutine/socket/timer 回收。

**范围：** 只硬化 Go daemon Relay runtime 的 per-connection lifecycle 与可重复 fault-injection tests；不改变 Relay v2 wire、E2EE handshake、Agent protocol、pairing identity 或 Cloudflare deployment 配置。

## 为什么现在做 / 当前坏在哪

当前 `serveDataConnection` 对 data-socket `websocket.Dial` 只尝试一次。若 `connected` 通知已经消费，而该次 dial 因瞬时 503、连接复位或 edge 波动失败，session 会从 map 删除；在 Relay 没有重复发送同一 `connected` 的正常契约下，仍在线的 client 将永久等待，直到额外 sync/control reconnect 才可能恢复。

这不是 Agent/Timeline 领域错误，但会把一个可恢复的 transport 抖动放大为整次 remote connection 丢失。直接无限紧循环也不可接受：重试必须受现有 32-session cap、context cancellation、dial timeout 和 capped jitter backoff 约束。

## 动哪些、验哪些

- data dial 失败在 session 仍属于当前 `connectionId` 时重试；成功 attach 后继续现有 E2EE/dispatcher 路径。
- `disconnected` / `sync` stale removal / runtime `Close` 必须取消 dial 与 timer，并等待 `session.done`。
- duplicate `connected` 不创建重复 goroutine；同 ID 在前一 session 完整退出后才允许新 generation。
- 用本地 WebSocket fault harness 验证 first-dial failure → retry success、cancel-during-backoff、duplicate notification 与 close/reconcile liveness；加入 race stress。

## 质量承诺

- **可靠性：** 单次瞬时 data dial failure 不再永久丢失已通知 client。
- **性能效率：** 每个 active ID 至多一个 goroutine/一个 timer；全局仍最多 32 sessions，退避有随机抖动与上限。
- **安全性：** 只重试 transport dial；E2EE proof/handshake/tamper 失败仍 fail closed，不对同一未认证 peer 无限重试。
- **可维护性：** 不引入通用 retry framework；最小 helper 与 deterministic timing seam 足以测试。

## 实现记录

- `go/internal/daemon/relay_runtime.go` 保持每个 active `connectionId` 一个 tracked session，在 data WebSocket dial 遇到 network、HTTP 408/425/429/5xx 时以 100ms 起、5s 封顶的 full-jitter backoff 重试；其它 HTTP response 与已进入 E2EE 的 authentication/proof failure 仍永久 fail closed。
- 每次 dial 继续受 10s context timeout 约束；backoff wait 同时监听 session context，`disconnected`、stale `sync` 和 runtime `Close` 可立即打断。
- `disconnected` 现在等待对应 `session.done` 后才继续消费下一条 control intent。Cleanup 先释放全局 capacity，但在同一 `sessionsM` critical section 内删除 generation map entry并关闭 `done`，确保同 ID replacement 不会在旧 generation 未完成时重叠或丢失。
- 没有引入通用 retry framework；唯一测试 seam 是可注入的 per-runtime retry wait，用于确定性进入/取消 backoff，production 默认仍使用标准 timer。
- 共享 `agentWebSocketHandler` 的 slow-consumer 边界保持 connection-scoped：256-frame outbound queue 满后只取消该 local/remote connection，不改变 canonical Agent。`serveConnection` 现在显式等待 context-triggered socket closer goroutine，返回时不留下辅助 goroutine。

## 验证记录

- 新增 fault tests：first dial 503 → 第二次 attach/challenge 成功；retryable/permanent HTTP 分类；backoff 中 cancellation；runtime Close 等待；duplicate `connected` single-flight；`disconnected → connected` teardown barrier 与 generation replacement；blocked writer + 256-frame queue overflow 后 remote session/socket/closer 全部退出且 Agent 保留。
- `cd go && go test -race ./internal/daemon -run 'TestRelay' -count=100`：100/100 通过。
- `cd go && go vet ./... && go test -race ./... && GOOS=windows GOARCH=amd64 go build ./...`：通过。
- `npm test --workspace=@byspace/client -- go-daemon-relay.e2e.test.ts`：1 passed / 1 opt-in live skipped。
- `npm test --workspace=@byspace/relay`：71 passed / 1 opt-in live skipped。
- `npm run test:e2e:go-daemon`：production Web build 与 2/2 Playwright tracers 通过。
- Workspace typecheck 通过；lint 0 errors（14 个既有 warnings）。
- Focused review 首轮发现并阻止 `disconnected` 不等待、generation cleanup ordering 和非确定性 backoff test 三个 P1；逐项修复后复审无 P0/P1/P2。Slow-consumer/socket-closer follow-up 再次复审通过，最终结论 `Merge OK`。

## Closure

瞬时 data dial failure、backoff cancellation、control generation handoff 与 daemon teardown 现在形成同一个有界 lifecycle；Agent/Timeline、Relay v2 wire 和 E2EE contract 未改变。按 ordinary-Issue standing authorization，本 Issue 关闭。
