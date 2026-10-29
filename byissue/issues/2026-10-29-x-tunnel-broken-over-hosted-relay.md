---
kind: issue
title: "隧道经托管 relay 不通（已修）：socket attachment 丢 this"
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

## 结论：就是那一个缺陷，修复后通

打完点之后一次就看清了，之前三轮猜测全是浪费：

```
RELAY attach ok=true type=string len=93 val="{\"role\":\"client\",\"connectionId\":\"conn_54e2...\"}"
RELAY msg ok=true role="client" mt=BinaryMessage len=46
RELAY peers tag="server:conn_54e2..." sockets=1
RELAY msg done role="client" sent=1
```

attachment 一旦能读写，`GetWebSockets(tag)` 与 `conn.Tags()` 都对得上，双向转发恢复。

**第二个"原因"是我自己的测试配置写错了**：目标端密码键写成了 `auth.passwordHash`，实际是
`auth.password`（`daemonPasswordHashKey` 常量）。目标端因此报
`This host has no daemon password set, so tunnels are disabled` 并拒绝开流。
不是产品缺陷，但值得记：拼错的键**不会**报配置错误，只会让功能静默失效。

## 顺带：实测「隧道 + AI API」的消耗

3 次流式对话（2156 个 SSE chunk，24 秒传输，3041 字输出）：**0.603 GB-s**，即
**每次对话约 0.20 GB-s**。

| 使用强度    | 每日     | 占免费层额度（13,000 GB-s） |
| ----------- | -------- | --------------------------- |
| 10 次对话   | 2 GB-s   | 0.015%                      |
| 100 次对话  | 20 GB-s  | 0.15%                       |
| 1000 次对话 | 200 GB-s | 1.5%                        |

**原先的估算（0.002 GB-s/次）低估了 100 倍**——每个 chunk 在 relay 上要过两次 DO 消息处理，
固定唤醒开销远大于预期的 CPU 时间。但量级仍然安全：重度使用一天也只占额度个位数百分比。
真正烧额度的是常驻连接，那已由 hibernation 解决（14,527 → 0.27 GB-s/天）。

## Windows 也验过了

Windows 11（10.1.115.59）作**发起端**、本机 Mac 作**目标端**（暴露 3425 的 magpie 网关），
同一条生产 relay：

```
port=50307  bytes=28097  chunks=124  done=1  textlen=113
text=我是由深度求索公司开发的AI助手，能为你解答问题、提供信息并协助完成各种任务。
```

完整 SSE 流：124 个 chunk、收到 `[DONE]`、中文回答完整。

**一个 Windows 特有的启动抖动**：首次启动时隧道那条 WS 报
`net/http: TLS handshake timeout`，而同一进程的 control 通道已连上、PowerShell 的 HTTPS 也是 200。
重启后不再出现。判断是冷启动时并发 TLS 握手的一次性超时；隧道自己的重连退避会恢复，
但第一次失败会让本地转发端口短暂处于"已监听但不通"的状态。未深究，记在这里。

## 影响

（已修）隧道经托管 relay 可用，macOS 与 Windows 双向验过。

## 验证

1. D1/D2 连托管 relay，`curl` 通过隧道的 `/v1/models` 返回 200
2. SSE 流式对话能完整流出
3. 之后才能测「隧道 + AI API」的 DO 消耗量

## 沉淀去向

- **`byissue/notes/018`**：新增「隧道 + AI API 的实际额度占用」一节 —— 实测常数 0.28 毫 GB-s/帧、
  按真实用量的折算表、两个算错过的细节（按字节输入占 96% 但按帧数只占 5–13%；不要用看板 token
  总量估额度）、以及「真正的成本大头是常驻连接不是对话」。
- **`byissue/spec/connection.md`**：加一条指针，说明隧道成本可算且远低于额度。
- **`scripts/relay-worker.test.mjs`**：守卫 `socket.Get("(de)?serializeAttachment")` 不得出现。

`this` 丢失这条本身留在本文作证据：它是「编译通过 + 单测通过 + 浏览器可用」三重假象下仍存在的
runtime 错误，只有 `wrangler tail` 能看见。没有独立成 note —— 它的教训和 notes/018 的
「单位成本」是同一条：托管环境的运行时语义不在代码里。
