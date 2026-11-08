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
- **兼容性 / 互操作性**：relay v1/v2 帧格式与路由不变，E2EE 与 Tunnel 帧布局不变；Close 的可选单字节 `CloseWrite` 保留旧 peer 的整流关闭语义，恢复能力需要双端新版 daemon。

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
- 2026-11-08 Windows 复测：relay 100 帧突发不再触发 1013，握手也不返回 429，证明生产限流已移除；但 6 路仅 2 路完整，其余仍为 `IncompleteRead`、无 `[DONE]`、`BadStatusLine`，顺序大请求和小请求也失败。不能把该版本记为生产验收通过。
- 用户明确授权后，通过 macOS 正常退出并重新打开桌面应用重启 Mac 6777 daemon；健康检查正常，仍为 0.24.3。CLI `daemon restart` 对桌面托管进程显示 `already running`，没有完成重启，不能拿它当重启证据。用户转述 Windows agent 的后续结果尚未提供，不能把这次重启记为问题消失。
- 代码对照发现 Go 版没有完整实现 spec 中的闪断续传：D1 `SetPeer` 会 teardown 全部流；D2 data socket 替换后旧 sink 不再持有后续帧。Go relay 在 server-data 消失时还以 1012 关 client。此前 6 路测试只覆盖稳定 socket，不能覆盖生产连接替换。
- 目标端收到 Close 后立即 `conn.Close()` 会截断半关闭后的响应。`TestTargetUpstreamHalfCloseKeepsResponse` 在修复前收到 0 字节，修复后完整收到响应；Close 的可选 `CloseWrite` 只关闭写方向，省略 payload 时保留旧整流关闭行为。
- 双端 in-process daemon、随机 loopback 端口、真实 relay 与 E2EE 的 6 路 SSE 测试已通过，含客户端写半关闭。该测试不启动或占用 6777/6778。
- 新增 server-data 观测接缝并注入真实 socket 丢失：收到首段后关闭 socket，目标 TCP 继续发送，原 stream 在新 socket 上重新 Open。单轮测试曾通过，但后续多轮 race 仍出现跳段，不能记为断连无损已验证。D1 有实际上行字节队列，D2 保留失败帧并暂停 TCP 读取，两端有 30 秒超时。
- 旧 transport 的迟到帧、恢复 Open、断开清理有代际/实例守卫；这些减少了误删/误发，但未消除断连边界丢帧。稳定并发、Target 半关闭通过；断连恢复仍须以多轮 race 验收。
- 恢复需要双端新版 daemon；旧 Target 不认识恢复语义，不能只更新一端就宣称跨版本无损恢复。该兼容边界已回写 `byissue/spec/connection.md`。
- v0.24.4 changelog 经用户确认：半关闭截断、relay 重连丢流、usage threshold 切断合法流量三项。用户授权提交、push 并发布 stable v0.24.4；发布验收完成前本 Issue 保持 `-o-`。
- 修复提交 `debdc3e` 与版本提交 `566ae67c9` 已 push。版本 CI 的 `TestTwoDaemonsResumeStreamAfterRelaySocketLoss` 失败：收到 chunk 0 后跳到 chunk 181，末尾仍有 `[DONE]`，证明不是测试时序误报。本地 race 重复也复现该跳段。
- 已证实的一个竞态是旧 transport 的 EOF/Close 可能落到新 transport；代际修复只覆盖这一部分，后续压力测试仍失败。两端帧对照进一步证明：旧 socket 的最后一帧可能“写成功但对端未收到”，简单重放最后一帧不足以保证完整恢复。E2EE `DaemonSession.Send` 的锁外加密也曾允许发送顺序变化，已在本轮回退相关实验，不能记为已修复。
- 经用户决定，未通过的序号/ACK 恢复实验已全部回退，仅保留本 issue 的证据；回退前临时补丁在 `/tmp/byspace-43-reverted-recovery-experiment.patch`，未提交。`release:patch` 因精确 SHA CI 失败退出，v0.24.4 tag 尚未创建；不为构建失败另起新版本号。
- 当前已 push 的 `debdc3e` 仍带断连竞态，不能作为生产修复验收。v0.24.4 发布保持阻塞，后续应单独设计有界、兼容的确认/恢复协议，不能继续叠加局部补丁。

## 根治设计：逻辑流与物理连接分离

### 必须成立的不变量

1. **未收到对端确认的帧不能丢弃。** `WebSocket.Write` 成功只表示本机交给传输层，不表示对端已读。
2. 每个 stream 有两个独立方向；各自维护**发送序号、连续确认游标、未确认队列**。序号是 Tunnel 元数据，不进入 HTTP/TCP 字节。
3. 正常连接的接收端按序消费；重复帧丢弃，空洞不猜测、不跳过。恢复时先同步游标，再重放未确认帧，最后恢复新流量。
4. 旧物理 socket 的迟到帧、错误、EOF、Close 只能影响该 socket，不能删除或结束新 socket 接管的逻辑流。
5. 发送窗口有界：单流未确认数据上限 16 MiB，断连最多 30 秒；超限明确关闭并记录原因，不伪装无损。
6. 恢复需要两端支持；普通旧帧仍可转发。老 peer 不启用恢复，不发送新帧，不宣称无损。

### 协议与归属

- `internal/tunnel/frame.go`：增加独立控制帧 `OpenResume` / `ResumeAck`，以及带序号的下游数据帧。`OpenResume` 携带恢复所需的 stream 身份与能力声明；`ResumeAck` 携带**下一可接收序号**。现有 `Open/OpenAck/Data/Close` 布局不变。
- `internal/tunnel/manager.go`：D1 拥有本地逻辑流、下游连续游标与上行未确认队列。断连时保留本地连接、暂停继续读；收到新 peer 后逐流发送 `OpenResume`，收到恢复确认后同步游标、发送恢复确认、 flush 未确认数据并恢复。
- `internal/tunnel/target.go`：D2 拥有目标 TCP、下行未确认队列和当前物理发送归属。`OpenResume` 不再拨号、不创建第二个读泵，先恢复旧流；收到游标后从该游标重放，确认后允许新数据。旧流不存在或已结束则明确拒绝。
- `internal/server/server.go`：data socket 的建立/退出只通知 attach/detach，不能直接删除逻辑流。每个物理回调有明确代际；旧 detach 不影响新 attach。
- `internal/e2ee/channel.go` / `client.go`：发送锁覆盖加密与写出，保证调用顺序就是线上帧顺序，不能让后到帧越过先到帧。
- relay 仍只转发 E2EE 密文，不理解 Tunnel 序号或游标；不改变 relay v1/v2、配对、E2EE 或计费行为。

### 状态转换

```text
connected
  │ socket lost
  ▼
paused（保留 TCP、未确认帧；停止继续读）
  │ new socket + OpenResume
  ▼
syncing（交换连续游标，拒绝旧代帧）
  │ ResumeAck + 未确认重放完成
  ▼
connected
```

超时、缓冲超限、对端明确不存在：进入显式失败，关闭对应流并写日志；不得无限等待。对端正常 EOF 的 Close 按所属代际发送，不能与恢复后的数据混序。

### 风险打通顺序

1. **先验证序号/游标协议**：一帧在旧 socket 写成功、下一帧失败，恢复后只补未确认内容；重复 ACK、重复帧、空洞都按规则处理。
2. **再验证物理连接替换**：真实双 daemon + E2EE + relay，连续断连与并发 SSE 多轮 race，逐字节验证不重、不漏、不乱。
3. **最后加厚边界**：半关闭、超时、16 MiB 上限、老 peer 普通转发、6 路并发；再跑 Go audit 与真实 DeepSeek 请求。

### 需要修正的现有结构

当前 `Target`/`Manager` 将 socket 生命周期与流生命周期混在同一回调里，导致局部修复不断产生新竞态。本设计先切分责任，再加恢复，不保留“重开 Open 即恢复”的旁路。当前已 push 的恢复实现和版本提交不能视为完成，发布仍以本设计的验证结果为准。

## 协议穿刺与验证结果（2026-11-08）

- 新增 `internal/tunnel/replay.go`：`replayBuffer` 按方向保存未确认帧，只有连续 ACK 才释放；`receiveCursor` 只接受当前序号，重复与空洞不交付。容量默认 16 MiB，超限失败。
- 新帧 `OpcodeDataDownstreamSeq` 携带序号元数据，`OpcodeResume` / `OpcodeResumeAck` 交换恢复与游标。Open 的第三字节是可选能力请求，OpenAck 第一位增加可选 capability 位；旧帧和老 peer 仍按原布局解析，不启用恢复。
- Target 的下行帧在发送前进入未确认窗口；D1 按连续序号写入本地 TCP，序号不进入 HTTP/TCP 内容。恢复时不重新拨号、不创建第二个读泵，收到游标后重放未确认帧，再恢复新流量。
- 协议级测试覆盖未确认保留、确认释放、容量、重复/空洞、序号不泄漏到 TCP。Target 测试覆盖普通流、半关闭、Resume ACK 与恢复。
- 真实双 daemon + relay + E2EE 的断连与并发测试通过 30 轮 race：6 路 SSE 稳定并发、首段后强制 server-data 断开、250 个 chunk 加 `[DONE]` 完整有序。
- `internal/e2ee` 两端发送锁覆盖加密与写出，防止后调用越过先调用；E2EE 与 Tunnel race 测试通过。
- `npm run typecheck`、`lint`、`format:check`、`git diff --check` 通过。`env -u GOROOT npm run audit -- --no-browser` 全部通过：完整 Go 测试、入站/出站字段缺口为零、重审账本一致。浏览器验证按参数跳过。
- 生产 relay 仍只有限流移除，daemon 恢复协议尚未发布；Windows 原拓扑与真实 DeepSeek 验收待新版部署后执行。
