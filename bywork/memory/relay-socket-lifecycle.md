# Relay socket 生命周期：谁在什么时候关掉哪条 socket

## 结论

- 一条 tunnel 在 relay 上是**三条** socket：initiator 的 `role=client&connectionId=<cid>`、target daemon 的 `server-control`、target daemon 自己拨的 `role=server&connectionId=<cid>` 数据 socket（`internal/server/server.go:serveRelayDataConn`）。配对由 relay 完成，initiator 只拨一条并等待。
- 日志读法：`1012 StatusServiceRestart "Server disconnected"` 唯一出处是 `internal/relay/protocol.go:218`，只在**对端那条 `role=server` 数据 socket 消失**时发出。看到它 = 对端 daemon 关了自己的 socket，不是公网丢包、不是 CF 回收。
- daemon 侧 `wsHelloTimeout = 15s`（`internal/server/server.go:59`）会杀掉没进 `hello` 的 socket（4001 `Timed out waiting for hello`）。豁免条件是 `relayAuthIsPending && relayPeerKeyOf != ""`。**peer key 的证明物是 e2ee challenge 回显，而回显在 `DaemonSession.Receive`（`internal/e2ee/channel.go:204-212`）里被吞掉、永不作为应用帧投递** —— 所以记录 key 必须挂在 `ChallengeMet()` 上，挂在「投递第一帧」上会让空闲 tunnel 每 15s 被杀一次（2026-11 修，`server.go:944`）。
- ws 协议 ping（`tunnelPingInterval = 20s`）只保护 initiator 自己那条 socket 不被 CF 的 ~60s 空闲回收，**到不了对端 socket**，所以它治不了上面那条。
- 重连 backoff（`internal/tunnel/relaypeer.go:Run`）是「故障」用的，不是「抖动」用的：连上过就必须复位到 base，否则周期性地被 15s 杀掉的 socket 会把 delay 永久钉在 30s 上限 → 45s 里断 30s，而 UI 每 ~3s 轮询 `tunnel.list`，多数时候仍显示 Connected。
- 定量指纹：断开周期 = `15s + backoff + 1~2s 握手`。看到 46–51s 的稳定周期、两条 tunnel 恒定错开几秒 = 定时器，不是网络。刚 create/edit tunnel 后头几轮会是 16,17,19,20,24,32,46（backoff ramp），跑几轮后进稳定期。
- 0.26.4 现场验证（2026-11-17，Windows 目标机）：运行中 exe 的 SHA256 匹配 0.26.4 发布物；`127.0.0.1:34125 → zijies-MacBook-Pro.local:3425` 这条 tunnel 空闲观察 180s（15:36:20–15:39:20，不主动发流量）零断连——此前每 46–51s 一断，180s 覆盖约 3–4 个故障周期；空闲后请求该端口 HTTP 200 拿到目标服务 JSON。证据支持本修复消除了这条 tunnel 的周期性空闲断连；长时间运行、网络切换与另一条 tunnel 未验证。

## 依据

- 类型：代码事实 + 一次实测复现 + 0.26.4 现场验证。
- 证据或复核方式：`go test ./internal/server/ -run TestRelayTunnelPeerSurvivesHelloDeadlineWithoutTraffic`（红的时候两边日志正好是 `4001 Timed out waiting for hello` 与 `1012 Server disconnected`）；`go test ./internal/tunnel/ -run TestRunResetsBackoffAfterAProvenConnection`（去掉复位 → 1s 内只重连 9 次）。真实事故日志在 `~/.byspace/daemon.log`，噪音是 `tunnel ... stream tXXXX.NN data received: sequence=`，按 `connection ended` 过滤。
- 适用条件：对端 daemon 需要更新到含本修复的版本才停止被杀；本机侧只改 backoff 只能把不可用占比从 2/3 降到 ~3%，空闲 socket 仍会重建。

## 重访条件

- `wsHelloTimeout`、`tunnelPingInterval`、relay 空闲回收时长任一变化。
- 新增「握手完成但不投递应用帧」的通道类型（同样会踩只认明文帧的坑）。
- 有人把重连 backoff 改成 jitter/指数单独实现。
