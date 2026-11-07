---
kind: issue
title: "Tunnel 并发流被 relay 预算关闭"
type: bug
created: 2026-11-07
---

# Tunnel 并发流被 relay 预算关闭

> 来源：[GitHub #43](https://github.com/ByteTrue/byspace/issues/43)。独立 Issue，不属于现有 Epic。

## 预期 / 实际 / 根因

- **预期**：Tunnel 中并发的 SSE / chunked 响应按原样完整转发；计量可以发现成本风险，但不能截断合法业务。
- **实际**：Windows 0.24.3 经生产 relay 连 Mac Magpie，单路请求成功，6 路流式请求出现 `IncompleteRead`、无 `finish_reason`、JSON / tool arguments 损坏；Pi 工具循环因此失败。另一个 `503 masking` 是 Magpie 并发问题，不在本 Issue 修复。
- **根因**：`workers/relay/main.go` 对每条在线业务消息执行 40 FPS / 120 burst 的持久化 token bucket，并以 1013 关闭超限 socket；日请求预算超限或计量不可用也关闭在线 socket。Tunnel 按项目规格逐帧透传，合法并发没有可安全假定的静态 FPS 上限。
- **证据边界**：硬断流路径由代码直接证实，用户提供了原坏法的并发复现。JSON 损坏的中间形成链路尚不逐字节确定，不把 relay 直接篡改或交换 payload 当作已证实事实。

## 范围与方案

- 删除在线业务消息的帧率封禁，不保留另一套静态阈值或 Tunnel 合帧。
- 托管 relay 保留全局 UTC 日请求计量；超阈值和计量失败记录告警，但不拒绝握手、不关闭在线业务连接。`RELAY_DAILY_REQUEST_BUDGET` 变为告警阈值。请求成本继续由 hibernation、daemon agent 合帧、无 remote client 时关闭 data socket 控制。
- 在 Tunnel 发起端与目标端补充有界诊断：streamId、双向帧数、关闭原因；不逐帧记录正常数据，不记录 payload 或凭据。
- 用真实本地 workerd 验证 6 路并发流式消息在旧限流与旧日预算下会失败、修复后完整；用真实 daemon / E2EE / TCP 服务验证 6 路 SSE 完整性及流间隔离。
- 不部署生产 relay、不重启 daemon、不修改 Magpie，不在本 Issue 增加自托管配置开关。

## 质量承诺

- **可靠性 / 可用性与容错性**：正常并发和超过日告警阈值后，已建立及新建业务连接仍完整转发；以真实 workerd 并发与超阈值测试证明。
- **性能效率 / 资源利用**：保留 hibernation 和全局请求计数，不为业务转发增加逐帧持久化 token bucket 或缓冲；生产发布后的请求量与单位成本需另行复核。
- **可维护性 / 可分析性**：一次 Tunnel 异常能从 daemon.log 的 streamId、帧数和原因定位；以日志捕获测试证明。
- **兼容性 / 互操作性**：relay v1/v2 帧格式与路由不变，E2EE 与 Tunnel 协议不变。

## 影响面

- **必须改**：`workers/relay/main.go`、`internal/relay/budget.go` 及各自测试；本地 workerd 回归脚本；`internal/tunnel` 两端流生命周期日志。
- **需要验**：真实 relay 路由、E2EE binary frame、6 路 SSE、断开与重连；Go audit、typecheck、lint、format。
- **仍待外部验收**：生产部署后 Windows 原拓扑的 Pi 多轮工具循环与 Cloudflare 计量。未完成前保持 `-o-`。

## 执行记录与验证

- 移除持久化 token bucket、握手 429 与在线 1013 预算关闭；`RelayMeter` 保留跨 room 的 UTC 日计数，超阈值或 meter 不可用只发 Worker warning，消息照常路由。relay v1/v2、E2EE 与 Tunnel 帧协议未改。
- Tunnel 两端在流结束时记录 streamId、双向帧数与原因；正常半关闭不标为端口错误。没有逐帧日志或 payload 日志。
- 旧代码上的真实本地 workerd 6 路并发测试以 `relay message timed out` 失败；修复后同一测试通过。普通路由、跨 room 计量、超阈值握手、超阈值在线转发、关闭握手及 11 项 Worker 守卫均通过。
- 真实 daemon / relay / E2EE / TCP SSE 的 6 路并发测试等待每条流明确关闭后逐字节校验，250 个有序 chunk 加 `[DONE]` 均完整且无流间串扰。Tunnel 包测试及流关闭日志捕获测试通过。
- `env -u GOROOT npm run audit -- --no-browser` 全部通过：完整 Go 测试、入站字段缺口 0、出站 `MISSING / OPTIONAL / NEVER_SENT` 均为 0、重审账本一致。按参数跳过浏览器验证，不能记为浏览器验收通过。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、`git diff --check` 均通过。
- 首次 workerd 启动继承失效 `GOROOT`，去掉环境变量后进入真实测试；首次告警把 Go struct 直接传给 JS 导致 `syscall/js.ValueOf` panic，改为字符串与数值后通过。本地 DO 日志从 workerd observability API 读取，不从 Wrangler stdout 判断。
- 2026-11-08：修复提交为 `93f9b4038`（`fix(relay): preserve tunnel streams beyond usage thresholds`）。经用户明确授权，stable `byspace-relay-go` 已部署到 `app.byspace.cc.cd`，Cloudflare Version ID `70798e43-104f-4345-b053-d3f4b59d5385`；线上 `/health` 返回 `{"status":"ok"}`。commit 尚未 push。
- 尚未在 Windows 原拓扑复测，也未读取修复后的生产 Cloudflare 计量。没有重启 daemon 或启动浏览器测试实例。

## 当前结论与关闭条件

代码修复和本地证据已完成，stable relay 已部署并通过健康检查。保持 `-o-`，待 Windows 原坏法验收及生产计量复核后再决定正式关闭。稳定约束已同步 `byissue/spec/connection.md`，历史成本行为与 workerd 宿主事实已更新 `byissue/notes/018-durable-object-billing-and-hibernation.md`。
