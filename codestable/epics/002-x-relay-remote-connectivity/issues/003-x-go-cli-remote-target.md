---
kind: issue
title: "让 Go CLI 显式使用已保存的 Relay remote target"
type: feature
status: closed
created: 2026-08-28
---

# Issue 003：让 Go CLI 显式使用已保存的 Relay remote target

## 要解决什么

当前 `byspace agent list` 与 `byspace agent timeline` 只能根据本机 daemon PID record 连接 local `/ws`。Epic 002 已证明 copied Web 能保存 authenticated v3 offer 并经 Relay 访问远端 daemon，但统一 Go CLI 仍无法选择远端主机。

本 Issue 建立最小、可安全落盘的 CLI remote target 闭环：用户把另一台 daemon 生成的 v3 pairing offer 通过 stdin 或私有文件导入本机 CLI，随后以稳定 `serverId` 显式选择该 target，让已有 Agent observation 命令经过同一个 Relay v2 + mutual-auth NaCl E2EE + daemon session protocol 工作。没有 `--host` 时保持现有 local daemon 行为。

## 已确认的产品与安全边界

1. **offer 不做命令行参数。** `clientAuthTokenB64` 是长期 capability；`byspace host import` 只从 stdin 或 `--file` 读取，避免进入 shell history、process argv、普通错误或日志。成功输出和 `host list --json` 都不回显 offer、auth token 或 client ephemeral key。
2. **CLI 有自己的 remote registry。** 保存位置是私有目录 `BYSPACE_HOME/state/remote-hosts-v1/`，每个 canonical `serverId` 对应一个 create-only 原子 JSON record；它只含 CLI 需要的 remote public endpoint、daemon public key 和 client-auth capability，不读取 daemon 的 `relay-identity-v1.json`，也不尝试读取浏览器 localStorage。Web 与 CLI 可导入同一个 offer，但各自拥有本地持久化边界。
3. **显式 target，不猜主机。** `byspace agent ... --host <serverId>` 只匹配完整稳定 `serverId`；缺失、重复或未知目标 fail closed。无 `--host` 仍连接当前 home 的 local daemon，既有脚本不改变语义。
4. **同一远程协议。** CLI 作为 Relay v2 client 连接 server-assigned data socket，验证 offer 中的 daemon public key，以 fresh challenge + pairing secret 生成 HMAC proof，强制 `binaryCiphertext=true`，然后发送同一 `hello` / `session` Agent 消息。不得设计第二套 REST/CLI remote protocol。
5. **私有、原子、严格状态。** registry 目录保持 `0700`、record 保持 `0600`，使用 tempfile + file sync + no-replace install + directory sync；create-only per-host record 避免并发导入不同主机时发生整库 lost update。unknown version/field、record/filename serverId mismatch、invalid canonical v3 key/endpoint、宽权限、trailing JSON 或 durability uncertainty fail closed，不能静默清空或覆盖证据。
6. **有界网络。** handshake、read/write、frame、reconnect/command deadline 都有明确上限；CLI 单次命令不创建后台重连 daemon。nonce prefix/sequence 和 in-channel replay 规则与 Web/daemon E2EE 一致。

## CLI 形状

```text
byspace host import [--file <path|->] [--home <dir>]
byspace host list [--json] [--home <dir>]
byspace host remove <server-id> [--home <dir>]

byspace agent list --host <server-id> [--json] [--home <dir>]
byspace agent timeline <agent-id> --host <server-id> [--follow] [--home <dir>]
```

- `host import` 默认读取 stdin；交互式终端可以提示粘贴，但不得把原文写回屏幕。`--file -` 等价于 stdin。
- 重复导入同一 `serverId` + 同一 trust material 是幂等成功；同一 `serverId` 的 endpoint/key/token 发生变化时拒绝隐式替换，后续如需 rotation 必须设计显式确认流程。
- `host list` 只输出 `serverId`、Relay endpoint、TLS 和非敏感元数据。`host remove` 只删 CLI registry entry，不关闭远端 Agent 或 daemon。
- 首轮不增加 Agent create/send CLI；`--host` 先覆盖当前已经存在且有稳定输出契约的 `agent list` 与 `agent timeline [--follow]`。

## 实现落点

- 将 canonical v3 offer 的 Go wire model、严格校验与 fragment decode 放到可由 daemon offer producer 和 CLI importer 共用的 Relay/协议边界，避免 Go 端生成与消费各写一套规则。
- 把现有 local CLI WebSocket JSON client 收束到很小的 daemon transport interface；local raw WebSocket 和 remote encrypted WebSocket 只替换 framing/handshake，不复制 Agent list/timeline RPC、cursor pagination 或输出逻辑。
- E2EE session cipher（随机 16-byte prefix、monotonic 64-bit sequence、replay rejection）由 `internal/relay` 共享，daemon 与 CLI 不各自维护易漂移的 nonce 实现。
- remote connection 在 encrypted channel ready 后再执行 daemon `hello`，并核对返回 `server_info/status` 的 `serverId` 与所选 registry entry 一致；错主机 fail closed。

## 验证

- registry unit tests：首次创建、round-trip、幂等 import、conflicting trust material、strict JSON/invariant/permission failures、atomic pre/post-replace failures与无 overwrite。
- offer/crypto tests：canonical v3 success；v2、bad endpoint/serverId/key/token、wrong token、wrong daemon key、capability downgrade、tamper、nonce replay 全部 fail closed。
- CLI tests：stdin/`--file` import 不泄密，list redaction、remove、unknown host、local-default compatibility 与灵活 flag ordering。
- cross-language E2E：复用真实 Go daemon + Cloudflare Relay v2 harness，由 `byspace host import` 经 stdin 保存 offer，再让 Go CLI remote `agent list` / `timeline --follow` 观察 Web/TypeScript client 创建和续写的同一 Agent；Relay restart 和 daemon restart 后重新执行命令仍命中同一 host/Timeline。
- 全量 `go vet ./...`、`go test -race ./...`、Windows amd64 cross-build、workspace typecheck/tests/lint/build、Relay/client/Web E2E 通过；focused review 无 P0/P1/P2 后按 standing authorization 关闭。

## 不在本 Issue

- 新增 Agent create/send/control CLI 命令；
- Web localStorage 与 CLI registry 的自动同步、Hub 账户同步或多用户授权；
- pairing secret rotation、别名/模糊匹配、交互式 TUI host chooser；
- `relay.byspace.cc.cd` 生产部署与凭据配置；
- terminal/files/Git/Forge 等尚未进入 Go daemon 的领域。

## 实现记录（2026-08-28）

1. `go/internal/relay/offer.go` 建立了 Go 端 canonical v3 offer consumer：严格 base64url fragment、零 unknown/trailing JSON、canonical `srv_` ID、32-byte daemon/auth keys、low-order X25519 rejection，以及显式 DNS/IPv4/[IPv6]:port 校验。daemon offer producer 复用同一 `PairingOfferV3`，不再维护漂移的第二份 wire struct。
2. `go/internal/relay/remote_hosts.go` 在 `BYSPACE_HOME/state/remote-hosts-v1/` 实现 per-host create-only registry：tempfile sync、no-replace install、directory sync、幂等 durability retry、冲突 trust material 拒绝、全记录严格加载及 unexpected/hidden entry fail closed。原子 failure tests 覆盖 replace 前失败不留下 destination，以及 replace 后 directory-sync uncertainty 在重试时重新 sync 后收敛。
3. `go/internal/cli/host.go` 与 `cli.go` 增加 `byspace host import|list|remove`。offer 只允许 stdin 或 `--file`；文件入口要求私有 regular file 并以 open 后 `SameFile` 检查收束 TOCTOU。text/JSON list 都只投影 `serverId`、endpoint、TLS，不输出 daemon public key、client auth token 或 ephemeral key。
4. `go/internal/relay/encrypted_socket.go` 抽取 daemon/CLI 共用的 NaCl session framing、wire-size bound、nonce sequence 与 replay rejection；`client_socket.go` 实现 Go CLI Relay v2 client handshake，提交并核对 `binaryCiphertext=true`、验证 daemon public key、发送 fresh HMAC proof，随后进入同一 daemon hello/session protocol。daemon adapter 改为组合共享 cipher，而不是复制 nonce 实现。
5. `go/internal/cli/agent.go` 将既有 RPC/pagination/output 保持在共享 client 上；`--host <serverId>` 仅替换 local raw socket 为 saved remote encrypted socket，并在 daemon hello 后核对实际 `serverId`。省略 `--host` 的 local PID-record 行为与原命令输出保持不变；显式空值、重复 flag、未知目标及错 daemon identity 全部 fail closed。
6. 私有 Relay identity 与 remote registry 在 Unix 继续验证 `0700`/`0600` 和拒绝 symlink；Windows 使用 protected DACL，只授权当前用户与 LocalSystem，并拒绝 reparse point、非当前用户 owner、继承/额外 principal。Windows runtime tests 已落盘，当前环境完成交叉编译，真实 Windows host execution 仍作为平台验证残余风险保留。
7. `packages/client/src/go-daemon-relay.e2e.test.ts` 扩展为跨语言 CLI tracer：经 stdin 导入真实 daemon RPC 生成的 offer，远程执行 `agent list` / `timeline` / `timeline --follow`，观察 TypeScript client 创建与续写的同一 Agent，并覆盖 Relay restart、daemon restart、Pi native resume、wrong token、wrong daemon key、server identity mismatch 及 secret redaction。

## Focused review 处置

- reviewer 指出的 Windows POSIX mode 假设已改为 platform-specific protected DACL；offer file 权限/TOCTOU、重复/空 `--host`、post-replace retry re-sync 和 hidden temp evidence 均已补实现与 tests。
- reviewer 认为提交 `binaryCiphertext=true` 后 JSON ciphertext 也必须改成 binary WebSocket frame。复核 copied `@byspace/relay` contract 后不采纳该解释：该 capability 认证两端具备 raw-binary ciphertext 支持，并要求 binary logical payload 使用 binary wire；text logical payload 仍按既有 channel contract 使用 canonical base64 **ciphertext** text frame。Go 的共享 socket 保留 logical WebSocket message kind，与 TypeScript 行为一致，不存在 plaintext 或 capability downgrade。
- 修复后的逐项复核未发现剩余 P0/P1/P2；Issue 按 standing authorization 关闭。

## 验证记录（2026-08-28）

- `cd go && go vet ./... && go test -race ./...`：通过。
- `GOOS=windows GOARCH=amd64 go test -c ./internal/relay` 与 `GOOS=windows GOARCH=amd64 go build ./...`：通过。
- remote CLI cross-language E2E 连续 5/5 stress 通过；加入 wrong-daemon-key negative case 后再次通过。
- `npm test`：highlight 96、plugin 8、protocol 633、client 141、app 4,777、Relay 68 tests 通过（Relay 1 个既有条件性 skip）。
- `npm run typecheck`、`npm run lint`、`npm run build:web`：通过；lint 为 0 error，仅保留既有 warnings。
- `npm run test:browser`：11 files / 103 tests 通过。
- `npm run test:e2e:go-daemon`：multi-host 与 local tracer 2/2 通过。
