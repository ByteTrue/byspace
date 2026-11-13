# TS relay 客户端从不回应 e2ee 挑战，帧被静默丢弃

日期：2026-11-13
状态：已修

## 事实

`internal/e2ee/channel.go` 的 `DaemonSession` 在每个 relay 数据连接上生成一次性 nonce，放在 `e2ee_ready.challenge` 里发出去。在对方把 nonce 加密回一帧之前，`Receive` 把每一个应用帧都丢掉，返回值是 `plain=nil, err=nil`——不报错、不断连接。

回应挑战的只有 Go 的 `ClientSession`（`internal/e2ee/client.go:85`），它只服务 daemon 之间的隧道。浏览器和手机用的是 `packages/relay/src/encrypted-channel.ts`，它收到 `e2ee_ready` 就直接 `state = "open"` 并 flush 待发队列，从来没有挑战回应。

结果是所有经 relay 的前端连不上 Go daemon，而且两边日志都干净：客户端以为连接正常，daemon 只是把帧安静地扔掉。

## 为什么测试没抓到

- Go 测试里的 `relaySession` 辅助函数自己实现了挑战回应（`relay_password_test.go`），测的是 Go 客户端的行为。
- 浏览器一致性检查被 `npm run audit -- --no-browser` 跳过了，而唯一能发现它的正是真实浏览器。
- 直连不经过 `DaemonSession`（`server.go:915` 是唯一创建点），所以本地直连一切正常。

## 复现

用 `scripts/e2e-relay-client-check.mjs` 连一台真实 daemon，把 `echoChallenge` 的调用去掉再跑：挑战帧之后收不到任何回包，客户端最终超时。恢复后立刻通过。

## 修法

`encrypted-channel.ts` 的 ready 分支先发 `{"type":"e2ee_challenge","challenge":...}`，再 flush 待发队列。daemon 不带 `challenge`（旧版）时不发，保持兼容。

必须排在 flush 之前：daemon 只接受第一帧加密数据作为回应。

## 教训

同一协议的 Go 端和 TS 端各有实现时，测试里自己实现的客户端会把两端都测成绿色。判断「relay 链路是否通」要用真实前端，别用自己写的 Go 客户端。
