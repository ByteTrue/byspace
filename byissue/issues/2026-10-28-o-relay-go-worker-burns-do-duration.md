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

1. `GOOS=js GOARCH=wasm` 构建通过 ✅
2. **关键判据：单位成本** ✅ 部署 beta 后新实例 17,174 请求 / 平均 1.7 毫秒
   （修复前 16.2 秒/请求，TS 版 4.1 毫秒）
3. 端到端恢复 ⏳ **未完成，被账户额度挡住**

第 3 项失败的原因不是代码：账户已用 49.7k GB-秒（免费层 13,000/日），额度耗尽期间**任何**
worker 的 DO 请求都会抛 `Exceeded allowed duration in Durable Objects free tier`。
用全新 serverId（=全新 DO 实例）验证过，同样 502；TS worker 同样 500 —— 与 worker 和代码都无关。

额度按日重置。**明天需复验**：真浏览器经 relay 配对、打开 agent 会话、并确认 DO 的
「持续时间/请求数」保持在毫秒级。

### 2026-11-05 本地 DO 触发器与请求预算验证

当前分支进一步用真正的 localhost `workerd` 和 Durable Objects 验证了控制通知、ping/pong、
client/server 双向 opaque 数据路由。新增 `RelayMeter` 让不同 serverId 的 room 共享同一 UTC
请求预算：四个握手计 8 次 billable DO 调用（含 meter 自身），下一次合法握手收到 429；
在线 client→server 数据消息超额时不转发，发送端以 1013 关闭。复现命令和预算边界见
`byissue/notes/018-durable-object-billing-and-hibernation.md`。

这补齐了**本地真实 DO 触发器**证据，仍不替代真浏览器配对、agent 会话与线上计量验收；
本 issue 保持 open。最后复核补了订阅回调重入关闭的 race 回归，并让单连接限流先于全局 meter；
真实本地 DO 三种场景再次通过。

### 2026-11-05 生产部署、关闭修复与真实浏览器验证

用户授权跳过 beta，直接部署生产。首次部署被 Cloudflare 以 10061 拒绝：不能把 `RelayMeter`
追加到已经应用的 `v1` migration。保留 `v1: RelayRoom`，追加 `v2: RelayMeter` 后部署成功；
静态守卫已钉住两个环境的迁移顺序。`app.byspace.cc.cd` 的 `/health` 返回 `{"status":"ok"}`，
首页新资源已发布，独立随机 serverId 的 `sync`、ping/pong、`connected` 通知和双向 opaque
数据原样送达。没有启动或重启本机 daemon。

首次生产 smoke 还暴露两个关闭问题：hibernated `webSocketClose` 没有回送关闭帧；关闭回调的
`getWebSockets` 仍包含当前 socket，使 router 误以为还有替代 client，跳过对端通知。现在显式
回送 code/reason，并在 disconnect 视图排除当前 socket。`--close` 真实本地 workerd 测试同时
验证 Node 主动 1000 关闭、raw frame 的 1001/1012 对端通知；正常路由、共享预算和在线预算
三种场景也全部通过。修复后生产版本为 `9ea1d647-f7a8-48ec-854a-6d26b79ea1e7`，Node 与
真实 Chromium 的独立 control socket 均收到 1000。

真实 Chromium 以 relay-only host 配置连接现有生产 daemon，看到真实 workspaces，并进入
Workout 的现有 agent 路由。页面正确显示 daemon 的 `Failed to load agent: exec: "pi": executable
file not found in $PATH`；这是 v0.24.0 生产 daemon 尚未包含本分支标准 CLI 路径修复，不是 relay
失败。未发送新 prompt，因此 agent 流式验收仍未完成。

Cloudflare GraphQL `durableObjectsInvocationsAdaptiveGroups` 在 13:00 UTC 记录：生产 room
176 次成功请求 / 4,451,195 wall time，约 25ms/请求；共享 meter 180 次 / 4,987,309，约
28ms/请求，保持毫秒级。计量字段是 wallTime，不是早期记录里的 duration；维度字段是
name/objectId，不是 durableObjectClassName/durableObjectId。正常 WebSocket 关闭仍可能对应
DO 的 responseStreamDisconnected 终态，不能用该状态否定浏览器已完成的关闭握手。

本 issue 保持 open：还缺新 provider 合帧代码在本机生产 daemon 运行后的真实流式输出与请求量
对照。

### 2026-11-05 v0.24.1 Claude 生产验证

生产桌面应用及其托管 daemon 已升级到 v0.24.1。通过正常配置 API 临时开启 Claude 后，无需 command
覆盖即可发现 `~/.local/bin/claude`，provider 为 ready；真实 Chromium 经生产 relay 创建 Haiku 4.5
会话，完整收到 20 行回答，最终状态 idle。测试 workspace 和 agent 已归档，Claude 开关已恢复关闭。

这轮不能记作增量流式通过：浏览器只采到一个已经包含全文的 assistant DOM 状态。Claude 原生转录也
只有 thinking 和完整 text 两个 assistant 事件，没有 `stream_event`；v0.24.1 的 Claude provider
未传 `--include-partial-messages`，只在完整 assistant 消息到达时追加 timeline 文本。这是当前的
消息级更新行为，不足以判断 relay 丢失了增量帧，也没有验证 Codex/ACP 的未发布合帧代码。

验证脚本在流式样本断言处提前失败，后续 relay socket close/error 断言未执行；测试 agent 又在读取
timeline 前被归档，daemon 拒绝读取归档 agent 的 timeline，因此没有取得无重复和顺序证据。Cloudflare
GraphQL 与 token verify 均返回鉴权失效，本轮没有流式前后的 DO 请求量对照。后续验收必须在归档前
抓取 timeline 和 socket 结果，并先恢复 Cloudflare 鉴权。

后续改用 v0.24.1 已能正常发现的 Pi，在相同生产 relay-only Chromium 链路发送 200 行回答：
页面采到 18 次单调增长，首个样本 567 字符，最终 1,776 字符，增长窗口 2.154 秒；单条 relay
socket 收到 99 帧，无 page error、socket error 或完成前关闭，agent 最终 idle。归档前抓取的
timeline 只有 user/reasoning/assistant 三类行，assistant 文本与浏览器全文一致，没有重复；
合并行的 source seq 从 1 到 44 连续无缺口。测试 workspace `wks_6844cee0809ac6bb` 和 agent
`84acb4e9-337f-4fb4-8b59-ec57ab1c0f08` 已归档，截图和原始结果保存在
`/tmp/byspace-pi-v0241-long-validation.{png,json}`。

这证明生产 daemon、relay、timeline 和浏览器可见增长链路可用，但 v0.24.1 不包含当前分支的
Codex/ACP 合帧代码；Cloudflare 鉴权失效仍阻止本轮请求量前后对照，本 issue 保持 open。

### 2026-11-06 v0.24.1 发布补发

Release Binaries 的 publish 首次因 GitHub API 500 失败，所有 build 已成功且 19 个资产已补齐；
只重跑 failed job 后 attempt 3 全部通过。Release 正文与 changelog 一致，全部平台资产通过
SHA256SUMS，容器描述符也通过独立 `.sha256` 校验，source 为发布提交，digest 与 GHCR
`0.24.1`/`latest` 的 `44dd3fbb…` 一致。

Deploy App 仍不能重试：tag 内只有 `v1/RelayRoom`，而生产已应用 `v2/RelayMeter`，日志已证实
10074 migration 错误。保留当前 relay 代码和双 DO bindings，用 release tag 构建 Web/PWA 后补发，
生产版本为 `398df464-e672-4e06-b637-143b341c518c`；线上 JS/CSS/manifest 与该 tag 的构建逐字节
一致，bundle 版本为 `0.24.1`，Chromium 加载无 page error。Deploy App 的原始失败记录保留，实际
生产发布由这次定向补发完成，没有修改 tag 或重复发版。

## 部署状态

- `byspace-relay-go-beta`（`app-beta.byspace.cc.cd`）：旧版本
  `9d4ae964-4422-47e3-9ec7-24824960564c`，本次按用户决定未发布 beta
- `byspace-relay-go`（生产）：**已部署**，版本
  `9ea1d647-f7a8-48ec-854a-6d26b79ea1e7`，真实 relay 路由、关闭握手、浏览器连接与毫秒级
  计量已通过；v0.24.1 Pi 真实流式与 timeline 顺序通过，Cloudflare 请求量对照仍未完成

## 沉淀去向

- **`byissue/spec/connection.md` →「托管部署」**：relay 必须用 hibernation API 接收 socket，
  这是长期约束不是性能优化。同时记了「额度耗尽的症状与 relay 故障不同」（`/health` 仍 200）。
- **`byissue/notes/018-durable-object-billing-and-hibernation.md`**：数字来源、诊断顺序、
  代码该怎么写、以及一条更普适的教训——比对移植实现时除了协议行为，还要问它怎么持有托管环境的资源。

## 遗留

本机 `~/.byspace/tunnels.json` 有一个指向 `srv_KpHUSmbbklHz`（那台已关机的 Windows，3425 端口）的
peer。它是 owner 10-23 自己配的，不是测试残留。它每 30 秒重连一次，在额度紧张时也是一份消耗；
是否保留由 owner 决定。
