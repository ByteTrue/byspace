---
kind: issue
title: "Go relay worker 不走 hibernation，一次连接烧掉 TS 版 4000 倍的 DO 时长"
type: bug
created: 2026-10-28
---

# Go relay worker 不走 hibernation

## 现象

稳定域名 `relay.byspace.cc.cd` 对所有 WebSocket 握手返回 **500**（`error code: 1101`），
浏览器侧表现为 `Transport closed (code 1006)`。`/health` 仍是 200，因为它不碰 Durable Object。

`wrangler tail` 抓到的运行时异常：

```
"outcome": "exception"
"scriptName": "byspace-relay"
"message": "Exceeded allowed duration in Durable Objects free tier."
```

owner 的判断是对的：Node 版高频用几个月没触发，Go 版几天就耗尽。**不是用量攒满，是 Go 版的计费模型不同。**

## 证据

Cloudflare Durable Objects 页面（周期 10-22 至 11-22，账户总值 49.7k GB-秒）：

| Durable Object       | 绑定 Worker                      | 请求数  | 持续时间   | 每次请求    |
| -------------------- | -------------------------------- | ------- | ---------- | ----------- |
| `RelayDurableObject` | `byspace-relay`（TS，Node 时代） | 774,140 | 3.2k GB-s  | **4.1 ms**  |
| `RelayRoom`          | `byspace-relay-go-beta`          | 2,860   | 46.3k GB-s | **16.2 秒** |
| `RelayRoom`          | `byspace-relay-go`               | 114     | 252 GB-s   | 2.2 秒      |

免费层 DO 时长额度 13,000 GB-s/月。**Go worker 一家吃掉 46.3k，是总额度的 3.5 倍**，
而 TS worker 跑了 774k 次请求只花 3.2k。

## 根因

Node 用 **WebSocket Hibernation API**：

```ts
// packages/relay/src/cloudflare-adapter.ts
 * This module provides a Durable Object class ... It uses WebSocket hibernation for cost efficiency.
this.state.acceptWebSocket(server, tags);
```

Go 用**常驻 goroutine**：

```go
// workers/relay/main.go
socket, err := cfws.Upgrade(w, req)   // 非 hibernation
...
go r.serve(socket, peer, conn)        // 一个连接一个常驻 goroutine，直到断开
```

hibernation 下空闲连接让 DO 冻结、不计费；`Upgrade` 下 socket 一直握在内存里，DO 全程唤醒。
隧道还配置了一个常驻 peer（`srv_KpHUSmbbklHz` 指向 3425），那条连接 7×24 挂着，
把「常驻」的代价放大成全天候计费。

`internal/relay` 的路由逻辑与传输无关，所以只有这一层要换。

## 影响面

**必须改**：`workers/relay/main.go` 的 socket 接收（`Upgrade` → `UpgradeHibernating` +
`AcceptHibernatingConn`）、读循环（goroutine → `WebSocketMessage` 触发器）、连接状态存放
（内存 map → `serializeAttachment`，hibernation 会丢内存）。

**必须保留**：`internal/relay` 的路由语义（`Router.BeforeRegister/Connected/Message/Closed`）、
帧缓冲、v1/v2 协议、tag 语义（`server-control` / `client:<cid>` / `server:<cid>`）。

**需要验**：休眠后唤醒仍能正确路由；控制通道的 `sync` / `connected` / `disconnected` 通知不变；
帧缓冲在 daemon 离线期间的行为不变。

## 方案

照抄 Node 的 `cloudflare-adapter.ts`：

1. `fetch()` 里 `websocket.UpgradeHibernating(w, req)` 拿到 `*HibernatingConn`，再
   `state.AcceptHibernatingConn(conn, tags...)`。
2. 把 `ConnectionID/role/version` 存进 `conn.SerializeAttachment`，因为 hibernation 之后内存状态没了。
3. `room` 实现 `WebSocketMessageHandler` / `WebSocketCloseHandler` / `WebSocketErrorHandler`，
   在里面用 `state.GetWebSockets(tag)` 找对端，取代内存里的 `peers` map。
4. 删掉常驻 `go r.serve(...)`。

**有界简化**：帧缓冲仍放内存（Node 也是这样，注释写明「best effort」）。已知上限——DO 被驱逐时
缓冲的帧丢失；升级触发——出现「daemon 短暂离线后客户端首包丢失」的报告。

## 执行记录

`workers/relay/main.go` 改成 hibernation：

- `cfws.Upgrade` → `cfws.UpgradeHibernating` + `state.AcceptHibernatingConn(socket, tags...)`
- 常驻 `go r.serve(...)` 删除，改由 `WebSocketMessage` / `WebSocketClose` / `WebSocketError` 三个触发器驱动
- `room.peers` 内存 map 删除，`roomView.Peers` 改走 `state.GetWebSockets(tag)` —— 这是 hibernation 的必然结果，
  对象被驱逐后内存表就是空的
- 连接身份写进 `socket.serializeAttachment`（`serverId`/`role`/`version`/`connectionId`），
  字段名与 TypeScript 的 `RelaySessionAttachment` 一致，hibernation 后由 `deserializeAttachment` 重建
- `relay.Connection` 补了 `ServerID()` / `Version()` 两个访问器（原来只有 `Role()`/`ConnectionID()`/`Tags()`/`RoomKey()`）

**顺序对齐**：`BeforeRegister` 移到 accept 之前。它通过 tag 注册表找要替换的旧 socket，
如果先 accept 再调，新 socket 会找到自己并把自己关掉。TypeScript 也是先
`closeExistingServerSockets` 再 `acceptWebSocket`。

**守卫**：`scripts/relay-worker.test.mjs` 新增两条——必须用 `UpgradeHibernating` + `AcceptHibernatingConn`、
不得出现 `cfws.Upgrade`、必须实现 `WebSocketMessage`/`WebSocketClose`、不得有 `go r.serve(`。
反向核对：把 `UpgradeHibernating` 改回 `Upgrade` 后 9 项里红 1 项。

## 验证

1. `GOOS=js GOARCH=wasm` 构建通过
2. 部署 beta worker 后：`relay.byspace.cc.cd` 的 `/ws` 从 500 恢复
3. **关键判据**：部署后观察 DO 的「持续时间 / 请求数」比值，必须从 16 秒回到毫秒级
4. 端到端：真浏览器经 relay 配对并打开 agent 会话
