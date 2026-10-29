# Durable Object 的计费模型：hibernation 不是优化，是能不能用下去的分界

> **读者：** 有人要动 `workers/relay` 的 socket 接收方式、或者 relay 又出现「所有握手 500」时，先读这条。
> **自检：** 一句话结论 · 怎么判断 · 数字 · 该怎么做 · 症状长什么样 · **隧道+AI 场景够不够用**。

---

**结论：** Cloudflare Durable Object 的「持续时间」按对象**保持唤醒的时长**计费。socket 用
`acceptWebSocket`（hibernation）收进来，空闲时对象被驱逐、不计费；用 `websocket.Upgrade` 收进来，
对象在整个连接生命周期里都是醒的，**全程计费**。两者在同一个账户上是 4000 倍的差距。

## 数字（2026-10-28 实测，同一账户、同一周期）

| 实现                                  | 请求数  | 持续时间   | 每次请求     |
| ------------------------------------- | ------- | ---------- | ------------ |
| TS worker，hibernation                | 774,140 | 3.2k GB-s  | **4.1 毫秒** |
| Go worker，`Upgrade` + 常驻 goroutine | 2,860   | 46.3k GB-s | **16.2 秒**  |

免费层每日 13,000 GB-s。Go worker 一家用了 46.3k，是两天多的额度。跑了几天的代价，
TS 版跑几个月都没碰到。**不是用量变大的问题，是单位成本错了三个数量级。**

## 症状长什么样

- 所有 WebSocket 握手返回 **500**（`error code: 1101`）；浏览器侧显示 `Transport closed (code 1006)`。
- **`/health` 仍然 200** —— 因为它不碰 Durable Object。这条最容易误导人，会让人以为是 relay 挂了。
- `wrangler tail` 里能看到原文：`Exceeded allowed duration in Durable Objects free tier.`
- 额度耗尽期间**换 worker、换 serverId、换 DO 实例都没用** —— 是账户级的。全新 serverId 同样 500，
  TS worker 同样 500。
- 按日重置；重置前什么都做不了。

## 诊断顺序

1. `wrangler tail <worker> --format json` 抓真实异常，不要停在「500」和图表上。
   OAuth token 读不了 DO 计量，但 tail 能读运行时异常。
2. Cloudflare 控制台 → Durable Objects 列表，看每个对象的 **请求数 / 持续时间 / 每次请求**。
   单位成本是不是毫秒级，一眼就能判断实现对不对。
3. 拿**同一个账户里已知健康的实现**（TS worker）做对照。差异出现在单位成本上，不是总量上。

## 该怎么做

socket 接收必须是 hibernation：

- **Go**：`websocket.UpgradeHibernating` → `state.AcceptHibernatingConn(conn, tags...)`，
  然后实现 `WebSocketMessage` / `WebSocketClose` / `WebSocketError` 三个触发器。**不要**起常驻
  goroutine 读循环 —— 对象会被驱逐，那个 goroutine 读的是一个已经不存在的实例。
- **TS**：`state.acceptWebSocket(server, tags)` + `webSocketMessage` / `webSocketClose`。
- 连接身份写进 attachment（TS `serializeAttachment`，Go 直接调 `socket.serializeAttachment(json)`），
  hibernation 之后内存状态全丢。
- `getWebSockets(tag)` 是唯一可靠的注册表，不要另存一份内存 map。
- **替换旧连接要在 accept 之前**：`BeforeRegister` 走的就是 tag 注册表，先 accept 会让新 socket
  找到并关掉自己。

守卫：`scripts/relay-worker.test.mjs` 里两条断言钉住「必须用 `UpgradeHibernating` + `AcceptHibernatingConn`、
不得出现 `cfws.Upgrade`、不得有 `go r.serve(`」。改回 `Upgrade` 会红。

## 隧道 + AI API 的实际额度占用（2026-10-29 实测）

**实测常数：0.28 毫 GB-s / 帧。** 3 次流式对话（2156 个 SSE chunk，24 秒，3041 字输出）共
0.603 GB-s。**决定成本的是消息次数，不是字节数** —— 一个 32 KB 帧和一个小帧唤醒 DO 的开销相同。

隧道两侧各算一次 DO 消息（发起端发、目标端收），这个常数已经包含了两跳。

### 用真实用量折算

`~/.config/magpie/usage.jsonl` 是 magpie 网关的逐条调用日志，含 `in` / `out` / `cache_read`。
折算方式：

- **上游帧** = `(in + cache_read) × 4 字节/token ÷ 32 KB`
  —— `cache_read` 是本次 prompt 里命中缓存的部分，**仍会出现在请求体里发出去**，不算它会把输入量
  低估 40 倍。
- **下游帧** = `out`（输出 token 与 SSE chunk 大致 1:1）

| 日期          | 调用  | 上行帧  | 下行帧    | 折算 GB-s | 占额度    |
| ------------- | ----- | ------- | --------- | --------- | --------- |
| 10-23（峰值） | 9,080 | —       | —         | 1,691     | **13.0%** |
| 10-24         | 4,280 | 128,144 | 2,245,610 | 664       | 5.1%      |
| 10-25         | 1,543 | 54,091  | 848,292   | 252       | 1.9%      |
| 10-26         | 1,893 | 39,671  | 904,399   | 264       | 2.0%      |
| 10-27         | 1,042 | 37,884  | 420,819   | 128       | 1.0%      |
| 10-28         | 1,617 | 85,943  | 576,984   | 185       | 1.4%      |
| 10-29         | 735   | 26,322  | 533,879   | 157       | 1.2%      |

**结论：即使历史峰值日全部走隧道，也只占额度 13%。容得下。**

### 两个反直觉的细节，下次别再算错

1. **按字节算输入是绝对大头（约 96%），按帧数算输入是少数（5–13%）。**
   平均每请求 prompt 约 0.5–1.7 MB，但 32 KB 一帧能装约 8000 个 token，而一个 SSE chunk 只有
   几个 token。所以量大的是下行帧，不是上行帧。
2. **不要用 token 总量估额度。** 一次调用的「Tokens」看板数字（可达 1.4B/天，98% 是缓存命中）
   和隧道帧数没有比例关系。看 `out`（≈ chunk 数）和 `in + cache_read`（≈ 上行帧），
   不要看合计 token。

### 真正的成本大头从来不是对话

历史数据里额度是怎么被烧穿的：

```
10-25  Go-beta:  6,017 GB-s   ← 隧道常驻 + 非 hibernation 代码
10-26  Go-beta: 13,247 GB-s   ← 打穿额度
10-27  Go-beta: 13,914 GB-s
10-28  Go-beta: 13,114 GB-s
10-29  Go-prod:      1 GB-s   ← hibernation 修复后
```

和对话量无关，是**常驻连接**。修好 hibernation 后一整天 1 GB-s。

## 一条更普适的教训

「两边代码看起来一致」不等于一致。协议层比过（ping 间隔、超时、重连退避都一样），
但**传输层怎么持有资源**没比 —— 而计费模型正好在那里。比对移植实现时，除了协议行为，
还要问「它对托管环境的资源占用模型是什么」，尤其是免费额度这种硬约束。
