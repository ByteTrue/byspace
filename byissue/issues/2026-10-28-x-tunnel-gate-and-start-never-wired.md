---
kind: issue
title: "Tunnels are dead: the gate is never read and the registry never starts"
type: bug
created: 2026-10-28
---

# Tunnels are dead: the gate is never read and the registry never starts

## 预期与实际

**预期**：在设置里打开 `daemon.tunnel.enabled` 并配置一个 peer 后，daemon 暴露该 peer 的白名单端口到本地；Tunnels 页面显示已连接的端口。

**实际**：Tunnels 页面是死的。不是 UI 不渲染——daemon 侧有两处接线缺失，任意一处都足以让隧道完全不可用。

## 根因（两处，彼此独立）

### 1. `tunnelsEnabled` 声明了但从未赋值

```go
// internal/server/server.go:258-259
tunnelsEnabled bool   // 声明
```

全仓库搜索 `tunnelsEnabled =` 没有任何结果。`config_reload.go` 把 `daemon.tunnel.enabled` 列为「可热重载」，但没有任何代码读它。所以：

- `tunnelRegistry()` 调 `registry.SetEnabled(false)`，恒定关闭
- `tunnelTarget()` 的门同样恒为关，拒绝所有入站 open

Node 版从 `config.tunnel?.enabled ?? false` 读（`config.ts:573`），Go 版把这段漏了。

### 2. `Registry.Start()` 从未被调用

```go
// internal/tunnel/registry.go:152
func (r *Registry) Start()   // 启动所有已配置 peer
```

全仓库搜索 `registry.Start(` 零处调用。即使把开关修好，daemon 启动时也不会拉起任何隧道。Node 版在 listener 起来后调 `tunnelRegistry.start()`。

### 3. 生产路径从未接上 peer 传输

```go
// internal/tunnel/registry.go:101-103
// SetPeerFactory overrides how a peer connection is built. Tests use it; production leaves it nil
```

`startPeer` 在 `factory == nil` 时直接返回，注释说「honest state for a build without a relay client wired in」。但 `internal/tunnel/relaypeer.go` 里 `TunnelReconnector` 已经实现了完整的重连逻辑（605 行文件），只是没人把它接到 registry 上。没有它，本地监听端口能建立，但永远连不上对端。

## 影响面

**必须改**：`internal/server/tunnels.go`（读配置、SetEnabled、Start）、`internal/server/server.go`（启动时接线 + 接 factory）。

**需要验**：`daemonConfigStore.onFieldChange("tunnel.enabled")` 等价的热重载路径；registry 的 kill-switch 语义（关掉要释放监听端口）。

**仍未知**：真实双机（或 WSL 对端）下的行为。本 issue 用两个本地 daemon 走 relay 验证打通，不搭真双机。

## 方案

按 Node `bootstrap.ts` 的顺序接线：

1. 构造 server 时从 config 读 `tunnel.enabled` / `allowedPorts` 初始化 `tunnelsEnabled`
2. listener 开始接受连接后调 `registry.Start()`
3. 启动时用 `SetPeerFactory` 把 `TunnelReconnector` 接上：从 peer 配置里的 relay endpoint / serverId / 公钥构造
4. 配置热更新时调 `SetEnabled`（registry 自己负责启停 manager）

**有界简化**：不改 `internal/tunnel` 内部实现（2185 行已移植完整）。已知上限——只验证本地双 daemon 走 relay；升级触发——接入真实第二台机器时若发现协议层问题，再开 issue。

## 验证

1. 新建 `internal/server` 测试：config 里 `tunnel.enabled: true` → `tunnelsEnabled` 为 true → `registry.IsEnabled()` 为 true
2. `registry.Start()` 在监听后确实被调用（可用已有 peer 配置断言 manager 数量）
3. 端到端：两个本地 daemon（不同 home/port），一个配置指向另一个的 serverId，走本地 relay；在 A 上 curl B 的端口，数据通
4. 用原来的坏法再看一眼：Tunnels 页面不再是死的

## 执行记录

比原判多出三层缺陷，逐个修完才真正打通。

1. **gate 从未读**：`ApplyTunnelConfig` 从 `daemon.tunnel.enabled` 读，启动和每次配置写入都调用；`registry.Start()` 接进同一条路径。
2. **生产路径没有 peer 传输**：`Start()` 现在在 `SetPeerFactory` 为空时自己构造 `TunnelReconnector`，从 peer 的 `url` / `daemonPublicKeyB64` / `token` 取参数。`SetEnabled(false)`、`Remove()`、`Close()` 都会 cancel 重连循环，否则关闸只停监听、循环还在拨号。
3. **relay data socket 的 hello 超时**：`serveRelayDataConn` 复用 `serveSessionOnSink`，而后者要求 15 秒内收到 `hello`。这个 socket 是 daemon 代远程客户端开的，没有客户端来发 hello，于是每条转发连接都在 15 秒后被 4001 关掉，表现为「对端立刻断开」。新增 `serveSessionOnSinkGreeted`，对齐 Node 的 `attachExternalSocket(..., initialHello)` 语义。
4. **协议缺建流帧**：`frame.go` 只有 Data/Close 三个 opcode，没有「打开流」。`Manager` 直接把字节发出去，`Target` 因为 `TunnelID` 不在表里而当成「已关闭的流」丢弃——TCP 能连，数据没人收。新增 `OpcodeOpen`(0x1f) / `OpcodeOpenAck`(0x23) 在线内完成握手：发起端发端口、目标端拨号后回允许/拒绝，收到允许才开始泵字节。
5. **数据处理方向反了**：`Target` 收 `DataDownstream`、发 `DataUpstream`，而 `Manager` 发的正是 `DataUpstream`、等的是 `DataDownstream`。两端各丢一半，各自单独测都能过。已改成真正镜像的方向。
6. **回复走错 socket**：`handleBinaryFrame` 用 `sendTunnelFrameToOpener` 查 `tunnelStreamSinks`，但那张表只有 JSON-RPC `tunnel.open.request` 路径会填。经 relay 转发的对端不在此表，所有回包（包括 open 的应答）查不到就被静默丢弃。改成直接回写收到请求的那个 sink。

### 验证

- 单元：`TestManagerAndTargetExchangeBytes` 把 Manager 和 Target 用进程内 PeerConn 对接，跑真实 TCP 服务，断言字节往返。反向核对：把数据方向改回错误版本，该测试 5 秒超时失败。
- 端到端：本地 relay + 两个 daemon（A 发起、B 目标），A 配置 peer 指向 B 的 serverId 与公钥；在 B 上跑 HTTP 服务，`curl` A 的隧道端口拿到 `200` 和完整页面。

## 结论

已交付。代码提交 `24a7b83de`，验证记录见上。
