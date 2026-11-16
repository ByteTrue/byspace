---
kind: issue
title: "Daemon tunnel：修复闪断窗口期丢帧、死挂与重连退避翻倍，保障 LLM 流式 API 稳定传输"
type: bug
created: 2026-10-19
closed: 2026-10-19
---

# Daemon tunnel：修复闪断窗口期丢帧、死挂与重连退避翻倍，保障 LLM 流式 API 稳定传输

## 背景与生产证据

通过 Daemon Tunnel（D1 `127.0.0.1:56100` → Relay E2EE → D2 `127.0.0.1:23000`）桥接本机与远端 Claude Code Hub（`CCH-AG_Copy`）承载 LLM 流式请求（SSE，单次持续 10–120s）时，对齐 `~/.byspace/daemon.log` 与本机 CCH `message_request` 数据库记录（78 条请求），定位到三类由隧道闪断引发的真实故障：

1. **流式输出中途闪断导致本机报 `502 STREAM_PROCESSING_ERROR`，而远端记 `200 OK`（如 `req #19716`、`#19670`）**
   - D2 的 `DaemonWebSocketServer` 对隧道连接设有 90 秒重连宽限期（`EXTERNAL_SESSION_DISCONNECT_GRACE_MS = 90_000`）。WebSocket 闪断期间（`connection.sockets.size === 0`），D2 的 `TunnelSession` 保持目标 TCP socket 打开，远端 CCH 正常发完整个流并记 200；但 `sendBinaryToConnection` 因 `connection.sockets` 为空将断连窗口期（2–4s）内的 `DataDownstream` 帧静默丢弃。
   - 重连命中 `resumeSession` 后，D1 收到缺失中间段的残缺 HTTP chunked 流，流尾关闭时 `undici` 报 `SocketError: other side closed`（`502 STREAM_PROCESSING_ERROR`）。
2. **等待首字节期间闪断导致本地连接死挂满 300 秒（`req #19671`，`499 Client aborted`）**
   - 远端目标连接若在闪断窗口期内关闭，其 `Close` 帧在 D2 侧被静默丢弃；D1 侧重连后既未对账远端存活 `tunnelId`，D1 发送端又因 `suppressSendErrors: true` 静默吞掉发往断连通道的帧，导致本地 TCP socket 死挂 300 秒直至客户端超时。
   - 反例对照：`req #19672` 与 `#19709` 在模型思考阶段（远端尚未吐字节）遇到 2.3–2.5s 闪断，因期间无下行帧丢失，重连 `resumeSession` 后完整收到响应并以 `200 OK` 结束。这证明**不能在闪断时盲目 `socket.destroy()` 杀掉所有在途流**，而应把重连宽限期做成真正的“暂停 + 有界缓冲 + 恢复续传/对账”。
3. **`DaemonClient` 在 `onError` + `onClose` 同 tick 触发时重复调用 `scheduleReconnect`，使首次重连退避直接翻倍（1.5s → 3.0s）**
   - `daemon.log` 中每次底层 `ECONNRESET` 都在同一毫秒打印两条 `status: "disconnected"`，`reconnectAttempt` 连加两次，平白把闪断恢复窗口拉长一倍。
   - 此外，`TunnelManager` 拒绝/失败时只写 `lastError` 不改 `forward.state`，UI 徽章恒绿；收到 `Close` 帧时直接 `socket.destroy()`（发 RST）而非 `socket.end()`（发 FIN），存在截断尾部缓冲区数据的风险。

## 目标与范围

- **包含**：
  1. **D2 端（`TunnelSession` + `Session` + `DaemonWebSocketServer`）**：WebSocket 断开进入宽限期（`handleTransportUnavailable`）时暂停所有入站隧道的 target socket（`socket.pause()`），并将已在途的 `DataDownstream` / `Close` 帧写入有界缓冲队列（上限 16 MiB）；`resumeSession` 恢复连接（`handleTransportResumed`）时按序 flush 缓冲帧并 `socket.resume()`。
  2. **D1 端（`TunnelManager`）**：peer 断连时暂停 `forward.streams` 本地 socket、缓冲在途上行帧并启动 30 秒断连宽限计时器；重连期间新进来的本地连接等待重连完成（最多 30 秒）而非立即拒绝；重连成功时调用 `client.listTunnels()` 对账远端存活的 inbound `tunnelId`（清理远端已关闭或因 D2 重启失效的孤儿流，存活流则 flush 上行缓冲并 `socket.resume()`）；超 30 秒未连上则销毁所有流快速失败。
  3. **半关闭语义（D1 & D2）**：收到对端 `TunnelFrameOpcode.Close` 时改用 `socket.end()` + 5s 兜底 `destroy()`，确保已写入缓冲区的数据完整刷给本地 HTTP 客户端。
  4. **客户端重连（`DaemonClient` & `TunnelManager`）**：修复 `transport.onError` 后紧跟 `transport.onClose` 重复触发 `scheduleReconnect` 与遗留心跳定时器的问题；`TunnelManager` 配置 `reconnect: { baseDelayMs: 250, maxDelayMs: 2000 }` 并移除 `suppressSendErrors: true`。
  5. **状态与可观测性**：D1 `openTunnel` 被拒或失败时置 `forward.state = "error"` 并打 `logger.warn`，后续开放成功或连接恢复时治愈回 `"connected"`；D2 授权放行时记录 `logger.info`。
- **不包含**：
  - 不改变隧道强制经配对连接（Relay / Direct）的架构，不引入第三方组网工具。
  - 不改变已连接状态下 `socket.on("data") → 帧` 与 `socket.write(payload)` 零缓冲直通的实时性契约（仅在断连重连窗口期内暂停并缓冲）。

## 质量承诺

- **可靠性（容错性与可恢复性）**：
  - 在途 SSE / chunked 流式响应期间发生短时（<30s）WebSocket 断连重连并命中 `resumeSession` 时，下行与上行字节零丢失、零乱序，客户端完整收到全部数据块且不报 `other side closed`。
  - 若远端目标服务在断连窗口期内关闭连接，或远端 Session 未能恢复，D1 重连后通过 `listTunnels` 对账或 30s 兜底超时立即关闭本地 socket，不发生 300s 死挂。
- **性能效率（时间特性）**：
  - 正常 `connected` 状态下保持直通零聚合（`tunnel-streaming.e2e.test.ts` 到达时间跨度测试保持通过）。
  - 单次传输层错误断开只触发一次 `scheduleReconnect`，首次重连退避严格取 `baseDelayMs`（隧道客户端为 250ms）。

## 有界简化

- **断连缓冲上限**：D2 端 `pendingDownstreamBytes` 与 D1 端单流 `pendingUpstreamBytes` 上限设为 `16 MiB`，D1 断连保流与新连接等待宽限期设为 `30s`。
  - **已知上限**：若断连期间目标端在 `socket.pause()` 生效前瞬间吐出超过 16 MiB 数据，或断连超过 30 秒，该流会被主动关闭。
  - **升级触发**：若未来出现超过 30 秒断连仍需保流、或无 Session 保持的跨进程重启续传需求。
  - **升级方向**：引入帧序列号（seq/ack）与滑窗重传协议；当前 90s Session 保持 + TCP pause 背压已完全覆盖数秒级网络闪断。

## 影响面

- **必须改**：
  - `packages/client/src/daemon-client.ts`
  - `packages/server/src/server/websocket-server.ts`
  - `packages/server/src/server/session.ts`
  - `packages/server/src/server/session/tunnel/tunnel-session.ts`
  - `packages/server/src/server/tunnel-manager.ts`
- **需要验**：
  - `packages/client/src/daemon-client.test.ts`
  - `packages/server/src/server/session/tunnel/tunnel-session.test.ts`
  - `packages/server/src/server/tunnel.e2e.test.ts`
  - `packages/server/src/server/tunnel-hardening.e2e.test.ts`
  - `packages/server/src/server/tunnel-streaming.e2e.test.ts`

## 执行记录

- `packages/client/src/daemon-client.ts`：
  - `attemptConnect()` 中为 `onOpen`/`onClose`/`onError`/`onMessage` 增加 `if (this.transport !== transport) return;` 守卫；非通用 `transport.onError` 触发重连前先调用 `this.disposeTransport(1001, reason)` 解绑同代 `onClose`，`scheduleReconnect` 统一调用 `this.stopLivenessHeartbeat()`，彻底消除单次 `ECONNRESET` 连续触发两次 `scheduleReconnect` 导致退避翻倍与双发 `disconnected` 日志的问题。
- `packages/server/src/server/websocket/encrypted-relay-socket.ts` & `packages/server/src/server/relay-transport.ts`：
  - 透传底层 WebSocket 的 `getTransportReadyState: () => socket.readyState`，修复底层 WebSocket 已处于 `readyState === 2 (CLOSING)` 而 `encryptedRelaySocket.readyState` 仍返回 `1 (OPEN)` 导致的 `sendAfterClose` 丢帧窗口。
- `packages/server/src/server/websocket-server.ts` & `packages/server/src/server/session.ts` & `packages/server/src/server/session/tunnel/tunnel-session.ts`：
  - `sendBinaryToConnection` 返回 `boolean` 表示是否至少有一个处于 `OPEN` 状态的物理连接接收了该帧；
  - 当连接断开（`handleTransportUnavailable`）或发送瞬间发现无可用物理 socket 时，`TunnelSession` 暂停所有目标 `socket.pause()` 施加 TCP 背压，并将已在途的 `DataDownstream` / `Close` 帧缓存进 `pendingDownstreamFrames`（上限 16 MiB）；
  - 当客户端在 90s 宽限期内重连命中 `resumeSession` 时，调用 `handleTransportResumed()` 按序 flush 缓冲帧并 `socket.resume()`；
  - 收到对端 `Close` 帧时采用 `gracefulCloseSocket`（`socket.end()` + 5s 兜底 `destroy()`），授权放行时打 `logger.info`。
- `packages/server/src/server/tunnel-manager.ts`：
  - 移除 `suppressSendErrors: true`，配置重连退避 `baseDelayMs: 250, maxDelayMs: 2_000`（最快 250ms、最慢 2s 重试一次）；
  - `handleLocalConnection` 在 `await client.openTunnel` 期间先 `socket.pause()`；若隧道曾成功连接过（`hasConnectedOnce`）而当前正处于闪断重连窗口，新进来的本地连接不再 0ms 当场 `socket.destroy()`（避免 CCH 在 150ms 内耗尽重试直接报 `503 所有供应商暂时不可用`），而是等待重连完成（默认最多等 `30_000ms`）并在 `openTunnel` 途中若遇断连自动重试一次；拒绝或失败时置 `forward.state = "error"` 并打 `logger.warn`，后续开放成功时恢复 `forward.state = "connected"`；
  - peer 断连时暂停本地流 socket、缓冲上行帧并启动 `30_000ms` 宽限计时器；重连成功时立即 flush 上行缓冲并 `socket.resume()`，随后调用 `client.listTunnels()` 对账重连前的 `tunnelId`，立即关闭远端在断连期间已结束或失效的孤儿流；若超过宽限期未重连则主动销毁所有本地流，杜绝 300s 死挂。

## 验证

- `npx vitest run packages/client/src/daemon-client.test.ts -t "non-generic transport error" --bail=1`（1 passed）
- `npx vitest run packages/server/src/server/session/tunnel/tunnel-session.test.ts --bail=1`（11 passed）
- `npx vitest run packages/server/src/server/tunnel-streaming.e2e.test.ts --bail=1`（2 passed，含 SSE 流传输中途重启 Relay 无损续传 e2e）
- `npx vitest run packages/server/src/server/tunnel-hardening.e2e.test.ts --bail=1`（4 passed，含白名单拒绝置 `error` 状态与超过 `disconnectGraceMs` 自动清理在途流 e2e）
- `npx vitest run packages/server/src/server/tunnel.e2e.test.ts --bail=1`（2 passed）
- `npm run build:server`、`npm run typecheck`、`npm run lint`、`npm run format:files` 全部 0 warning / 0 error 通过。

## 关闭结论

- **关闭判断**：交付关闭（`-x-`）。全部目标与质量承诺（在途流闪断零丢块续传、远端已关流重连对账与超时清理不死挂、重连期间新连接等待不秒拒、单次错误断开不双发退避）均已实现并通过单测与 e2e 验证。
- **沉淀回写**：
  - 已更新 `byissue/spec/connection.md`「Daemon 隧道」章节，补充“闪断无损续传与宽限期边界”契约。
  - 已更新 `byissue/notes/008-tunnel-performance-and-relay-vs-p2p.md`「已知的稳定性行为」，移除已过时的“中断时进行中的 TCP 连接会断”限制说明。
- **遗留事项**：无。
