# Issue：本地 Agent WebSocket contract

**类型：** feature
**状态：** closed
**所属 Epic：** `001-o-rewrite-foundation`
**目标版本：** foundation tracer bullet
**建立日期：** 2026-08-27

## 1. 当前真相

Issue 005 已完成 provider-neutral Agent/Timeline core 与 Pi RPC adapter，daemon lifetime 也拥有该 manager；但网络面仍只有 `/healthz` 和带 secret 的 `/shutdown`。Copied `@byspace/client` 会连接 `/ws`，先发 top-level `hello`，收到 `status/server_info` 后才视为 connected；Agent request/response 和 live event 都封装在 top-level `session` frame 中。

Copied Web 启动还会访问 workspace/project directory、provider snapshot、模型与模式。它们不是 Agent transport 的同义词，因此本 Issue 只证明 copied client 与 Go Agent core 的真实跨语言通路，不把“WebSocket 可用”写成“完整 Web 已可用”。

## 2. 本 Issue 范围

1. 在 Go daemon 提供 `GET /ws`：
   - 首帧必须是 protocol v1 `hello`；
   - 回 `status: server_info`，声明 `agentSessionV2`、`agentTurnIdentity`，不虚报尚未实现的 feature；
   - top-level `ping` 回 `pong`；
   - text frame 上限、hello timeout、单 writer、连接取消与正常 close 都有界。
2. 支持 copied client 的首轮 Agent RPC：
   - `fetch_agents_request`；
   - `create_agent_request`（Pi config 与可选 initial prompt/clientMessageId）；
   - `send_agent_message_request`；
   - `cancel_agent_request`；
   - `fetch_agent_timeline_request` 的 `tail | before | after`、cursor epoch/seq、limit 与 canonical projection。
3. 投影 provider-neutral manager event：
   - state → `agent_update(kind=upsert)`；
   - turn/thread/timeline → `agent_stream`；
   - snapshot、Timeline row 与 request response 必须通过 copied Zod schema。
4. 建立跨语言 E2E：使用 copied `@byspace/client` 连接真实 Go daemon，fake `pi` executable 通过 PATH 注入而不增加生产 test hook；验证 hello→fetch→create→send→stream→timeline→abort/reconnect。
5. 保持 daemon lifecycle 安全：shutdown 会关闭全部 WS connection，再关闭 Agent manager，不泄漏 goroutine/provider process。

## 3. 明确不在本 Issue

- workspace/project CRUD 与 directory；
- provider/model/mode catalog；
- 静态 Web 托管或完整 copied UI 启动；
- Agent/Timeline 落盘、Pi `--session` resume、daemon restart 恢复；
- Relay、E2EE、Hub、LAN pairing/password；
- binary terminal/file frame。

这些不是删除项。持久化/resume 进入 Issue 007，workspace/provider closure 与同源静态 Web 进入 Issue 008。

## 4. 安全边界

- 当前 `/ws` 是 local-only capability：只接受 TCP loopback peer。即使 daemon 被误配为 `0.0.0.0`，远端 peer 也不能控制 Agent。
- 浏览器 upgrade 使用同源 Origin 检查；无 Origin 的 CLI/测试 client 可从 loopback 连接。不能用 `Access-Control-Allow-Origin: *` 绕过。
- 本 Issue 不发明长期 remote auth。LAN、多主机与 Relay 必须在 pairing/grant/E2EE 边界实现后另行开放。
- WebSocket framing 使用成熟依赖，不自行实现 RFC 6455。通过 `go get ...@latest` 解析并锁定真实版本，不手写猜测版本号。
- malformed/unsupported frame 不得 panic；握手前 session request、binary frame 和超限 text frame fail-closed 关闭连接。

## 5. Wire 投影

### 5.1 Agent snapshot

Go snapshot 映射 copied schema 的 required fields；尚未实现的 optional 领域明确为空：`availableModes=[]`、`pendingPermissions=[]`、`labels={}`。`activeTurn` 由 manager turn ID 投影，Pi native session/model/thinking 放在 persistence/runtimeInfo，而不是泄漏私有 event。

`fetch_agents_response.entries[].project` 暂用 cwd 的非 Git compatibility placement，以满足 copied client 的现有 directory schema；它不是持久 workspace/project 事实源，Issue 008 会替换为真实 workspace placement。

### 5.2 Timeline

- canonical row `seq` 映射 `seqStart=seqEnd`，`sourceSeqRanges=[{startSeq:seq,endSeq:seq}]`，`collapsed=[]`；
- cursor epoch 不匹配时 `staleCursor=true`、`reset=true`，返回 tail window；
- `limit: 0` 表示不限制；空 Timeline cursor 为 `null`；
- live timeline event 的 `seq/epoch` 与随后 fetch 的 canonical row 一致。

### 5.3 Error correlation

已解出 requestId 的领域错误必须返回对应 response 的 `accepted/error`、`agent/error` 或 `agent_create_failed`，不能让 client 只等到 timeout。无法安全提取 requestId 的 envelope/protocol 错误才关闭连接。

## 6. 验收标准

- [x] copied `DaemonClient.connect()` 只有收到 Go `server_info` 后成功，ping/liveness 可持续。
- [x] fetch/create/send/cancel/timeline response 全部通过 copied `SessionOutboundMessageSchema`。
- [x] user row 先于任意 provider delta；live `seq/epoch` 与 fetch 结果逐项一致。
- [x] before/after/tail、`limit: 0`、stale epoch 和空 Timeline 边界有测试。
- [x] 两个 client 同时连接时都能看到 live update；慢/断开的 client 不阻塞 manager。
- [x] 非 loopback peer、cross-origin browser、binary/oversize/hello-timeout 被拒绝。
- [x] daemon shutdown 后 WS、subscriber 和 provider process 全部退出。
- [x] `go vet ./...`、`go test -race ./...`、TS contract/E2E、Windows cross-build 和完整 Web 回归通过。
- [x] focused reviewer 无 P0/P1 blocker。

## 7. 实现记录

- `go/internal/daemon/websocket.go` 使用锁定的 `github.com/coder/websocket v1.8.12` 实现 `/ws`，包含 loopback peer/Host、same-origin、5 秒 hello timeout、1 MiB read limit、256 项单连接 outbound queue、5 秒 write timeout、单 writer 与 shutdown drain。
- `go/internal/daemon/websocket_projection.go` 将 manager snapshot/event/Timeline 映射为 copied schema。canonical cursor 始终携带 `{epoch, seq}`；空 Timeline cursor 为 `null`；`lastUserMessageAt`、空 labels/modes/permissions 与 runtime/persistence placement 均保持 schema-valid。
- handler 已接通 hello、ping、fetch/create/send/cancel/timeline 和 live `agent_update` / `agent_stream`。Issue 008 已让当前 provider-neutral 完整 rows 同时满足 canonical/projected history 请求；active-turn steer、非空 image/attachment、advanced create options 仍返回 correlated error，不伪造成功语义。Idle `activeTurnBehavior=steer` 作为普通新 turn 发送。
- `go/internal/agent.Manager.SendInterrupt` 在 manager 内原子完成 clientMessageId 幂等判定、active turn interrupt 与新 send；同 Agent send 使用 context-aware gate 串行化，断连/取消的排队请求不会被挂在另一个 provider command 后。
- `packages/client/src/go-daemon.e2e.test.ts` 用 copied `DaemonClient` 启动真实 Go binary，并通过 PATH 注入 fake `pi`。测试覆盖完整 request/live/fetch/cancel 路径、unsupported rejection、legacy interrupt、steer rejection、双 client broadcast、重连和 daemon stop 后 provider PID 消失。

## 8. Review 修复记录

Focused review 先后阻止并已修复：timeline cursor 丢 epoch、未验证 create/send optional payload、omitted active-turn behavior 偏离 legacy interrupt、initial prompt 失败后 phantom Agent、伪装 projected response、幂等重试先 abort 原 turn，以及排队 send 无法响应 context cancellation。最终 reviewer 复核 manager send/abort/shutdown 并发路径后结论为 `No issues found / Merge OK`。

## 9. 验证记录

- `cd go && go vet ./... && go test -race ./...`：通过；Pi process suite 约 30 秒。
- `cd go && go test -race ./internal/agent ./internal/daemon -count=30`：通过。
- `GOOS=windows GOARCH=amd64 go test -exec=true ./...` 与 Windows binary cross-build：通过。
- `npm run build:web && npm run typecheck && npm test && npm run lint && npm run test:browser`：通过；649 个单元/Worker test files，5,698 passed / 1 skipped；11 个 browser test files / 103 passed；lint 维持 6 个既有 warning、0 error。
- focused `@byspace/client` Go-daemon E2E 在最终 manager hardening 后再次通过；fake Pi child 的退出由 PID probe 直接断言。

## 10. Closure

实现、验收、focused review 与 CodeStable 回写均已完成；local-only WebSocket 信任边界、copied client wire 契约和 Timeline/live projection 已进入本 Epic `spec.md`。用户已授权关闭满足 review 与自测条件的既有 Issue，本 Issue 关闭。
