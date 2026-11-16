# relay 密码闸门只挡了文本帧，二进制帧和广播都漏着

日期：2026-11-13
状态：已修

## 事实

relay 数据连接在 e2ee 通道内先证明 daemon 密码（`handleRelayPassword`）。闸门写在 `handleTextFrame` 里，而读循环（`serveSessionOnSinkGreeted`）对二进制帧**先于任何鉴权**就把 `frame.Data` 交给 `handleBinaryFrame`。三个漏洞都由此而来：

1. **终端和文件传输**。终端输入帧是二进制（opcode `0x02` + slot）。一个只答出 e2ee 挑战、从未提交密码的 relay socket 发一帧，`ensureTerminalSlot` 就为它开了一个 shell。拿到配对 offer 的人等于拿到该机器的 shell。
2. **广播**。relay 路径调 `serveSessionOnSinkGreeted(..., true)`，`s.clients[sink]` 一进来就是「已握手」，而 `broadcastSessionMsg` 只过滤未握手的 sink。没验密码的 socket 在证明之前就收到 agent 输出、状态、workspace 等全部会话广播。
3. **隧道流劫持**。`HandleFrame` 按 `TunnelID` 路由，目标端的授权检查只覆盖 `OpcodeOpen`。任何知道流 id 的 peer 都能往别人已拨号的 socket 注入字节（`OpcodeDataUpstream`），或对别人的流发 `OpcodeResume` 并拿到 ACK。授权实际只管「开门」，不管「用门」。

三个都有可复现探针（见下方）。修复前探针全部打印 BYPASS。

## 修法

- relay socket 的初始状态改成未握手（`greeted=false`），证明密码后才升级为 `true`。广播过滤因此天然生效。对端 daemon 不证明密码，它只走点对点隧道帧，不需要广播。
- 未握手豁免 15 秒 hello 超时：对端 daemon 对端本来就不发 `hello`，否则会被踢。
- `handleBinaryFrame` 开头加闸门：什么都没证明的 relay socket 直接丢；只证明了挑战密钥的 socket（对端 daemon）只允许隧道 opcode，终端和文件传输一律拒绝。
- `targetStream` 记录 `ownerKey`（开流时的 peer 公钥），之后所有帧必须来自同一 peer。本地或已证明密码的操作者传空 key，拥有它够得着的一切（这是操作者重连后 resume 的路径）。

## 验证

`scripts/e2e-relay-client-check.mjs` 从进程外验证第 1 条：新起的 daemon 上，未鉴权的 relay socket 发终端输入后 `sessions.terminals` 保持 0；同一条脚本带密码的成绩是 1。第 2、3 条由 `TestRelayConnectionReceivesNoBroadcastBeforePassword`、`TestRelayConnectionCannotSpawnTerminalWithoutPassword`、`TestTargetStreamOwnerRejectsOtherPeers` 覆盖。

## 教训

鉴权写在「某个帧类型的处理函数里」就等于没写：读循环有几条分支，闸门就要在分叉之前。凡是 `switch frame.Kind` 之前能拿到 socket 的代码，都要先确认这个 socket 已经证明过身份。
