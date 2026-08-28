---
kind: issue
title: "打通 Relay v2 E2EE 远程 Agent 穿刺"
type: feature
status: closed
created: 2026-08-27
updated: 2026-08-28
---

# 打通 Relay v2 E2EE 远程 Agent 穿刺

## 做成以后是什么样

一个使用隔离 `BYSPACE_HOME` 启动的 Go daemon 能主动注册到 Relay v2。copied `@byspace/client` 取得该 daemon 的 pairing offer 后，经 Relay client socket 和端到端加密建立标准 daemon session，完成 `fetchAgents`、创建 Pi Agent、发送 prompt、接收实时 Timeline，并在 daemon 重启后使用相同 offer 恢复同一 Agent。

这是 remote connectivity 的第一条端到端用户路径，不是只证明 control socket 能连通，也不是把密文 echo 当成 daemon 已可远程使用。

## 已知契约

- Relay v2 control socket：`/ws?serverId=<id>&role=server&v=2`；接收 `sync`、`connected`、`disconnected`，daemon 为每个 `connectionId` 主动打开 `role=server&v=2&connectionId=...` data socket。
- client data socket：`role=client&v=2`，`connectionId` 由 Relay 分配，不由 client 指定。
- copied legacy E2EE 是 client 先发 plaintext `e2ee_hello`、daemon 回 plaintext `e2ee_ready`；它只认证 daemon，不能抵御主动恶意 Relay 扮演 client。
- byspace authenticated E2EE 先由 daemon 发送 fresh 32-byte `e2ee_challenge`；client 的 hello 用 HMAC-SHA256 把 256-bit pairing secret、challenge、32-byte ephemeral public key 和协商能力绑定。daemon constant-time 验证后才发 ready 并接受密文。旧 hello 不能在新 challenge 上重放。
- ready 后 text application frame 作为 base64 ciphertext text，binary application frame 在协商后作为 binary ciphertext；application 层仍从 protocol `hello` 开始，随后是现有 `ping` / `session` frames，remote 与 direct 共用同一 dispatcher。
- Relay routing protocol 仍是 v2；byspace 新 pairing offer 使用 `ConnectionOfferV3Schema`（`v:3`），包含 `{serverId,daemonPublicKeyB64,clientAuthTokenB64,relay:{endpoint,useTls}}`，编码为 `https://app.byspace.cc.cd/#offer=<base64url-json>`。copied parser/store/client 需要显式扩展，不能把 secret 放入 Relay query、HTTP request 或普通日志。

## 范围

### 1. 持久 Relay identity

- 在 daemon exclusive lifecycle lease 内生成并加载 Curve25519 keypair和独立 32-byte client-auth secret；使用 CSPRNG，不接受 fixture/default key。
- 置于 `~/.byspace` 的 versioned private file（目录 `0700`、文件 `0600`），temp + sync + atomic replace；已有文件 malformed、长度错误、公私钥不匹配或不可读时 daemon startup fail closed，原文件保留。
- `serverId` 继续复用现有 stable daemon identity；同一 home 的 offer 在 clean restart 前后逐字节稳定。Relay 可见 `serverId`，但永远看不到 offer fragment 中的 client-auth secret。

### 2. Pairing offer contract

- 扩展 TypeScript connection-offer schema/store 以解析并保存 `ConnectionOfferV3Schema`，同时保留 v2 legacy parse；扩展 Go protocol handler；`daemon.get_pairing_offer.request/response` 通过标准 application session 返回可解析的新 authenticated offer。`qr` 本 Issue 保持 `null`，不引入 QR dependency。
- Relay 未启用或 control 尚未 ready 时返回 `relayEnabled:false`；ready 后为 true。offer URL 不包含 daemon private key；fragment 中的 client-auth secret不得出现在 app server HTTP request、Relay URL、日志或 error text。
- 提供最小 Go CLI 输出 pairing URL 的命令，CLI 通过 local `/ws` RPC 请求 daemon，不直接读取 key file。

### 3. Outbound Relay v2 runtime

- daemon 配置提供显式 enable、endpoint 与 TLS mode；测试可连接 local plaintext Relay，生产默认 endpoint 为 `relay.byspace.cc.cd:443`，未显式启用时不产生后台网络流量。
- 使用 `github.com/coder/websocket` client 打开一个 control socket，并按 bounded connection registry 打开 data sockets；严格验证 control JSON、connection ID、重复事件与 `sync` reconciliation。
- retry 使用 context-aware bounded exponential backoff + jitter；shutdown 取消 control/data sockets、timers 和 goroutines后再释放 daemon lifecycle。
- 单 client 的失败不终止其它 client 或 Agent manager；超过并发/queue/frame 上限 fail closed。

### 4. Daemon-side E2EE channel

- 基于已经验证的 `internal/relay` crypto primitive 实现 fresh challenge、HMAC-SHA256 client proof、CSPRNG nonce seal/open、binary negotiation、same-key rehello retry 和 key-change rejection；proof 的 canonical input 必须 version/domain-separated并绑定 capability bytes。
- proof 使用 constant-time compare；challenge 单 socket、单次有效。missing/wrong proof、recorded hello replay、plaintext downgrade、invalid/low-order key、short/tampered ciphertext、base64 非法、handshake timeout 与 nonce source failure全部关闭该 data socket，不进入 application dispatcher。
- 绝不记录 private/shared key 或 plaintext payload；错误只保留有界的 phase/type/connection context。

### 5. 共用 protocol session

- 从当前 `agentWebSocketHandler.serveConnection` 提取最小 transport seam，使 direct coder WebSocket 与 decrypted Relay data socket共用 hello timeout、server_info、subscriptions、RPC handlers、outbound backpressure 和 close semantics。
- direct `/ws` 继续执行 loopback/Host/Origin gate；Relay 是 daemon 发起的独立 outbound transport，不能借此绕过本地 HTTP 安全边界。
- 当前 Agent protocol 只接受 text application frames；transport seam 保留 opcode，以便 binary frame 被标准 unsupported-data 语义拒绝，而不是错误 UTF-8 化。

## 不在本 Issue

- 真实 Cloudflare production deployment、DNS/TLS 和运维告警；
- 最终 Web multi-host UX polish 与 PWA hosted release；
- 完整 CLI remote target store；
- Relay v1、Hub、terminal/file binary protocol；
- daemon key rotation/revocation UI。

## 风险与穿刺证据

| 风险 | 必须怎样证明 |
| --- | --- |
| remote transport 复制出第二套 RPC 行为 | direct 与 Relay adapter 跑同一 session contract tests，业务 handler 只有一份 |
| offer/restart 后 identity 漂移 | 同 home clean restart 后 `serverId`、public key、offer URL 相同，旧 client 可重连 |
| 主动 Relay 用已知 `serverId` 冒充 client | 没有 offer secret 时无法为 fresh challenge 和自选 public key 生成 HMAC proof，daemon 不发 ready |
| Relay 重放录制的合法 hello | 每个 socket fresh challenge，旧 proof 验证失败且无 session side effect |
| Relay 或攻击者注入 plaintext/tamper | negative E2EE tests 关闭 socket且没有 session side effect |
| v2 `sync` / duplicate events 泄漏 sockets | race/stress tests 验证 registry 收敛、active count 和 goroutine cleanup |
| 自制 fake Relay 与 Worker 行为漂移 | harness 固定 copied Worker 的 query/control contract；package Worker tests 同时通过，真实 Worker smoke 留到部署 Issue |
| remote disconnect 污染 Agent | 中断 transport 只取消该请求/订阅，不关闭持久 Agent 或伪造 Timeline rows |

## 验收

- Go unit/race tests覆盖 identity file、authenticated offer、challenge/HMAC proof、control reconciliation、E2EE handshake/negative cases、transport shutdown；
- `@byspace/client` ↔ local Relay v2 harness ↔ Go daemon 跨语言 E2E 完成 create/send/live timeline/restart；使用 `fixtures/pi/fake-rpc.mjs`，不消费模型 API；
- existing direct TS↔Go E2E 与 Playwright Go-daemon tracer 保持绿色；
- `go vet ./...`、`go test -race ./...`、Windows amd64 cross-build、workspace typecheck/tests/lint/build 通过；
- focused review 无 P0/P1/P2；实际实现、限制和验证回写 Epic/Project Spec 后按 standing authorization 关闭。

## 实现记录（2026-08-27）

- `go/internal/relay` 现在拥有私有原子持久化的 daemon X25519 identity、独立 32-byte client-auth capability、NaCl E2EE framing 和 Go↔TypeScript golden vectors。identity 损坏、权限过宽、trailing JSON、keypair 不一致和 low-order key 全部 fail closed，不静默轮换。
- `go/internal/daemon/relay_runtime.go` 已实现生产 Worker 契约的 Relay v2 control/data runtime：消费 `connected` / `disconnected` / `sync`，由固定 Relay origin 推导 data URL，使用有 jitter 的 context-aware retry，限制 32 个并发 data sessions，并在 `sync` reconciliation 中先停止并等待 stale generation 后再重建 wanted session。
- `go/internal/daemon/relay_socket.go` 已实现 fresh challenge + HMAC-SHA256 client proof + X25519/XSalsa20-Poly1305 channel。authenticated pairing 强制把 `binaryCiphertext:true` 绑定到 proof 和 ready confirmation；24-byte nonce 中的 sequence 必须单调递增；入站和最终出站 wire frame 均限制为 2 MiB；所有失败只关闭对应 remote session。
- direct `/ws` 与 Relay 解密 transport 进入同一个 `agentWebSocketHandler.serveConnection`，共享 application hello、server info、Agent RPC、Timeline subscription、outbound queue 和 shutdown 语义，没有复制业务 dispatcher。
- `daemon.get_pairing_offer.request/response` 成为 active daemon 的 pairing offer 事实源；`byspace pair` 只经 local `/ws` 请求。Version 3 offer 使用 canonical server ID、32-byte canonical base64 daemon key/auth token 和严格有效的显式 host:port endpoint；Web diagnostics 会 redact auth token。
- copied `@byspace/client`、`@byspace/relay` 与 Web HostRuntime 已贯通 `clientAuthTokenB64`。Web 以独立 `pairingOfferRpc` feature 检测新 RPC，不谎报 legacy `daemonStatusRpc`。
- Cloudflare Durable Object Relay v2 由 Relay 分配 connection ID，严格限制 ID 语法；pending frames 同时具备单 frame、单 connection、全局 frame/byte/connection budgets，并限制 256 个 active client sockets。server-data replacement 先注册新 socket 再关闭旧 generation，避免误杀仍有效的 paired client。

## Focused review

- 首轮 security/concurrency review 发现并修复 authenticated binary capability downgrade、Relay 全局 pending memory 无界、server-data replacement 误杀 client、Go sync 满容量不收敛、Go outbound frame 无 wire-size 上限、public auth config 缺口和 v3 offer 解析过宽等问题。
- 第二轮 focused review 确认以上修复正确，只指出 IPv4-embedded IPv6 endpoint 被误拒；随后移除预过滤并以 bracketed URL parser 验证，新增 `[::ffff:192.0.2.128]:443` 正例。最终不存在已知 P0/P1/P2，结论为 Merge OK。

## 验证记录（2026-08-28）

- `cd go && go vet ./... && go test -race ./...`
- `cd go && go test -race ./internal/daemon -run 'TestRelay' -count=30`
- `cd go && GOOS=windows GOARCH=amd64 go build ./...`
- `npm run typecheck && npm run test && npm run lint`
- `npm run build:web && npm run test:browser && npm run test:e2e:go-daemon`
- `npm run test --workspace=@byspace/client -- go-daemon-relay.e2e.test.ts`
- `npm run test --workspace=@byspace/relay`，含本地 Wrangler Worker/Durable Object E2E
- `npx wrangler deploy --dry-run --config packages/relay/wrangler.toml`

跨语言 remote tracer 使用 `fixtures/pi/fake-rpc.mjs`，已证明 create/send/live Timeline、pairing offer RPC、Relay 与 daemon restart、Pi native session resume、captured hello replay、wrong token、ciphertext tamper、in-channel replay 和 Relay wire 零明文。direct browser tracer、workspace unit/Worker suites 和 103 条 browser tests 保持绿色。

## 关闭

本 Issue 的实现、focused review、self-test 与规格回写均已完成；按 standing authorization 于 2026-08-28 关闭。真实 Cloudflare 部署、Web 多主机完整浏览器路径和 CLI remote target 仍按 Epic 002 后续 Issues 推进，不能由本地 tracer 倒算为已完成。
