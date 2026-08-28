---
kind: issue
title: "固定 Go↔TypeScript Relay E2EE 互操作契约"
type: feature
status: closed
created: 2026-08-27
---

# 固定 Go↔TypeScript Relay E2EE 互操作契约

## 做成以后是什么样

仓库中有一组语言无关的 Relay E2EE golden vectors，由 copied TypeScript `@byspace/relay` 与 Go 同时消费。双方必须从固定 Curve25519 key pair 得到同一个 `nacl.box.before` shared key，并逐字节互相打开 `[24-byte nonce][XSalsa20-Poly1305 ciphertext]` bundle；密钥长度错误、low-order public key、短包和认证篡改都 fail closed。

这条穿刺只回答“Go daemon 能否与 copied Web 使用完全相同的密码原语和 framing”，为后续 daemon outbound Relay transport 消除最高代价的兼容风险。

## 范围与边界

**本 Issue 包含：**

- 在 `fixtures/relay/e2ee-v1.json` 固定测试专用的 daemon/client secret/public keys、预计算 shared key、UTF-8 与 binary plaintext、nonce 和完整 ciphertext bundle；
- TypeScript contract test 通过生产 `deriveSharedKey` / `decrypt` 与 tweetnacl deterministic seal 消费同一 fixture；
- Go `internal/relay` 使用 `golang.org/x/crypto/nacl/box` 实现最小的 shared-key derivation、deterministic seal 和 authenticated open，并消费同一 fixture；
- 两端共同拒绝 low-order peer key、短 bundle 与 tag/ciphertext 篡改；
- 锁定实际解析到的 `golang.org/x/crypto` 版本，不自行实现 Curve25519、HSalsa20、XSalsa20 或 Poly1305。

**明确不包含：**

- Relay WebSocket、control/data socket、Durable Object 路由或 Cloudflare 部署；
- daemon key 的生成、持久化、轮换与 pairing offer CLI；
- `e2ee_hello` / `e2ee_ready` 状态机、重连、backpressure 或 text/binary opcode 转发；
- stock Paseo Relay v1 长期兼容承诺。

这些是下一条 remote connectivity Epic 的真实垂直切片，不能用 crypto vectors 冒充已经可远程连接。

## 方案与风险穿刺

- Go shared-key derivation 先用 `curve25519.X25519` 拒绝 all-zero/low-order 结果，再调用 `nacl/box.Precompute` 得到与 tweetnacl `box.before` 相同的 HSalsa20 后处理结果；不能把裸 X25519 输出当 shared key。
- 加密 bundle 精确为 24-byte nonce 后接 `box.SealAfterPrecomputation` 的 16-byte authenticated overhead 和 ciphertext，不增加自定义 envelope。
- 固定 nonce 只存在于 golden fixture 和显式 deterministic primitive；未来生产发送路径必须用 CSPRNG 保证同一 shared key 下 nonce 唯一，本 Issue 不提前设计发送器。
- Golden secret keys 仅为公开测试数据，不允许从 fixture 进入 runtime 配置或默认值。

| 会推翻后续方案的风险 | 怎样算打通 |
| --- | --- |
| 把 Go 的 raw X25519 误当 tweetnacl `box.before` | 两端 derived shared key 逐字节等于同一 fixture |
| nonce/tag/bundle 顺序不同 | Go seal 与 fixture bundle 逐字节一致，TS/Go 都能 open |
| text/binary 发生隐式 UTF-8 或 base64 转换 | fixture 分别包含 UTF-8 JSON 和含 `00/ff/80` 的 binary bytes |
| 无效 peer 或篡改被静默接受 | 两端 low-order key、短包和 tampered bundle 均明确失败 |

## 质量目标与验证

- **兼容性 / 互操作性：** Go 与 copied TypeScript 对 key derivation、bundle bytes 和 plaintext 逐字节一致；由共享 fixture 的双端 tests 证明。
- **信息安全性 / 完整性与真实性：** low-order peer、长度错误和认证失败 fail closed；不自行实现密码原语，由负例 tests 证明。
- **可维护性 / 可测试性：** fixture 是唯一向量来源，Go 包只有密码契约所需的三个操作，不建立 transport interface 或 Relay client 脚手架。

验收命令：

- `npm test --workspace=@byspace/relay`；
- `cd go && go test -race ./internal/relay`；
- `cd go && go vet ./... && go test -race ./...`；
- `npm run typecheck && npm test`；
- focused review 无 P0/P1/P2 finding。

## 执行记录

- `fixtures/relay/e2ee-v1.json` 固定两组公开测试 key pair、tweetnacl `box.before` shared key、UTF-8 JSON / binary edge bytes、24-byte nonce、完整 authenticated bundle，以及 low-order/short/tampered 负例。
- `packages/relay/src/e2ee-interop-fixtures.test.ts` 使用生产 `deriveSharedKey` / `decrypt` 与 tweetnacl deterministic `box.after` 验证同一 fixture。
- `go/internal/relay/e2ee.go` 只实现 `DeriveSharedKey`、nonce-explicit `Seal` 和 `Open`：先以 `curve25519.X25519` 拒绝 low-order peer，再使用 `nacl/box` 完成 exact NaCl precomputation 与 XSalsa20-Poly1305。`go.mod` 锁定 `golang.org/x/crypto v0.55.0`，传递依赖为 `golang.org/x/sys v0.47.0`。
- 聚焦 tests 通过：TypeScript 4/4，Go race package；Go Relay race test 连续 100 轮通过。
- 全量验证通过：`go vet ./...`、`go test -race ./...`、Windows amd64 cross-build、Web build、全 workspace typecheck、650 test files 中 5,702 passed / 1 skipped、lint 0 errors（6 个既有 warnings）、11 browser files / 103 tests，以及真实 Go-daemon Playwright tracer 1/1。
- 独立 focused reviewer 结论：`No issues found / Merge OK`，无 P0/P1/P2 finding。

## 关闭结论

Exact algorithm/framing、Go crypto dependency 与 fail-closed 边界已回写本 Epic `spec.md`；共享 fixture 和双端 contract test 已消除 foundation 范围内的 Relay crypto 互操作未知。生产 Relay、daemon transport、pairing/key persistence 与 Cloudflare behavior 仍进入下一 Epic，不能写成当前可远程连接能力。

本 Issue 满足 standing user authorization 的实现、focused review、自测和规格回写条件，关闭。Epic 关闭仍单独确认。
