---
kind: issue
title: "隧道经托管 relay 不通：握手过了但数据不转发"
type: bug
created: 2026-10-29
---

# 隧道经 hosted relay 不通

## 现象

D1（发起端）配 `tunnels.json` 指向 D2（目标端），两侧都连 `app.byspace.cc.cd`：

- D1 的本地转发端口建立成功（`forwarding remote 3425 as 127.0.0.1:50589`）
- 请求该端口 → `curl` 立刻 `000`，D1/D2 都没有错误日志
- 两侧各 2 条到 relay 的 443 连接（control + data），都 ESTABLISHED
- relay 侧 `wrangler tail`：`outcome: "ok"`，无异常

同样的 D1/D2 指向**自托管 relay**（`byspace relay` 子命令）时是通的（2026-10-28 验过）。

## 已排除

- **不是 E2EE 握手**：早期报 `peer did not complete the handshake`，那是另一件事（见下），修掉后不再出现。
- **不是 tunnel gate**：两侧 `tunnel.enabled: true`，D2 `allowedPorts: [3425]`，D2 设了 password。
- **不是 relay 路由整体**：浏览器经同一 relay 配对、开 workspace、跑完一轮 agent 对话是通的 ——
  那条链路走的是同样的「client 连接 → 通知 server-control → 开 server:<cid>」流程。
- **不是上游**：D2 本机直连 `127.0.0.1:3425/v1/models` 返回 200。

## 顺带修掉的一个真实缺陷（已部署）

`workers/relay/main.go` 的 `writeAttachment` / `connectionFromAttachment` 原先写的是：

```go
serialize := socket.Get("serializeAttachment")
serialize.Invoke(string(encoded))
```

把方法从 socket 上取下来再调用会丢 `this`，运行时拒绝并抛
`Illegal invocation: function called with incorrect `this` value`，Durable Object 把它变成
message / close handler 的 panic。`wrangler tail` 里抓到 5 次，而同一批请求的 `outcome` 仍是 `ok`，
所以只看 outcome 发现不了。

已改为 `callJS(socket, "serializeAttachment", ...)`（`receiver.Call` 保留接收者）。
守卫：`scripts/relay-worker.test.mjs` 断言不得出现 `.Get("(de)?serializeAttachment")`，反向核对有效。

**这个缺陷是我在 `61ab7b359`（hibernation 改造）引入的，它让 attachment 读写在生产上一直失败。**

## 仍未知

`roomView.Peers(tag)` 依赖 `state.GetWebSockets(tag)` + 从 attachment 重建 `relay.Connection`。
attachment 修复后仍不通，说明还有第二个原因。候选：

1. 上传的 wasm 是否真的带上了修复（部署时间与旧 socket 的生命周期交错）
2. `deserializeAttachment` 的返回形状（字符串 vs 对象）与 `callJS` 的假设不符
3. hibernation 下 `GetWebSockets(tag)` 的 tag 与我 accept 时传的不一致

下一步需要在 `connectionFromAttachment` 与 `roomView.Peers` 上打点，用一次 `wrangler tail` 换取真相——
猜测已经浪费了太多轮。

## 影响

隧道经托管 relay 完全不可用。经自托管 relay 可用。

## 验证

1. D1/D2 连托管 relay，`curl` 通过隧道的 `/v1/models` 返回 200
2. SSE 流式对话能完整流出
3. 之后才能测「隧道 + AI API」的 DO 消耗量
