---
kind: work
status: complete
current_unit: "已交付"
next_action: "无（A–E 全部通过；commit/push 待用户授权）"
must_hold: "既有测试只读不改；E2EE/密码门/grant 语义不动；协议向后兼容；不碰生产 6777；F 公网 TLS 暴露不做"
proof_gap: ""
---

# relay/tunnel 加固（吸收 OpenTunnel 设计）

## 目标与边界

用户 (m00001) 要求分析 anomalyco/opentunnel 与 BySpace relay/tunnel 对比，吸收好设计。分析已交付（报告 m00180）。用户 (m00181) "@bw 那按你的建议把这些做了吧" 授权实现报告 A–E 项。F（公网 TLS 暴露）明确另议，本次不做。

报告建议（m00180）：
- A 背压/读循环纪律：manager.go handleFrame 与 target.go HandleFrame 在共享读循环里同步 conn.Write，一条慢流饿死所有流+ack。修=per-stream 有界写队列+写 goroutine，读循环只入队，满则 reset 单流。
- B relay 资源限额：frameBuffer 改字节预算+cid 数上限（当前只按 200 帧/cid 截断，无字节上限，恶意 client 可撑爆 DO 内存）。
- C 重连风暴：relaypeer.go Run 与 relay_runtime.go supervise 加 jitter+成功后重置 delay。
- D 连接卫生：tunnel 流 idle 超时、target.go Open net.Dial 显式超时。
- E 共享测试向量：Go frame.go 与 TS tunnel.ts 抽一份 vectors JSON 两边读，锁字节布局。

## 已定方案与约束

- 顺序 C→B→A→D→E（报告建议）。每轮一行，真实入口验证，既有测试只读。
- C 范围裁定：只做 daemon 侧重连循环（relaypeer.go Run、relay_runtime.go supervise）。worker closeAllSockets 配速 drain（报告 C 第三件）跳过：它是 COMPAT(relay-room-v3) 临时迁移代码，2026-12-15 后删，且 DO handler 内不能 sleep（会阻塞 hibernation），配速收益低风险高。jitter+reset 在 daemon 侧已消除 recurring 风暴源。
- C 重置信号：ConnectRelay 阻塞整个连接生命周期、只在死亡时返回 err（几乎总非 nil），所以"成功"不能用 err==nil 判，用连接存活时长 ≥ 阈值判稳定。relaypeer connectOnce 同理（<-conn.done 后返回）。
- B 范围裁定：核心=frameBuffer 字节预算+cid 上限（DO 与自托管共用，根因处修一次）。自托管 per-room 连接上限若廉价则加；idle/attach 视成本。
- A 用 per-stream 下游写队列+goroutine，镜像现有 pendingUp 上游队列模式（writeMu+byte cap）。读循环只入队。relaypeer readLoop 阻塞投递在 handleFrame 变非阻塞后自然缓解（消费者快）。
- E 共享面=通用帧布局 opcode|idLen|id|payload + DataUpstream/DataDownstream/Close 三 opcode（TS 只实现这三个，Open/OpenAck/Resume 等 Go 独有，不进共享向量）。
- 约束（memory/relay-security.md）：密码门盖所有帧类型；E2EE 每会话新鲜密钥；grant per host:port；不改 spec 迁就测试。
- Go 1.27.2，math/rand/v2 可用。TCP_NODELAY/keepalive Go 默认已开，不搬。

## 行为证明

| 行为路径 | 真实入口 | 操作 | 应观察到 | 证据 | 结果 |
|---|---|---|---|---|---|
| C1 tunnel 重连退避 | go test ./internal/tunnel -run 'TestReconnectJitterSpreadsDelay\|TestRunResetsBackoffAfterAProvenConnection' -race | 连上对端后断开再连 | delay 重置到 base 且带 jitter，不累积到 30s | 重置策略采用上游 3d3a9b89c 的 proved 信号（connectOnce onConnected 回调，连上即复位，优于我原 30s 存活启发式），上游 TestRunResetsBackoffAfterAProvenConnection 覆盖；我保留 equal jitter [d/2,d]，TestReconnectJitterSpreadsDelay 200 次都在区间且≥2 值，jitter 改常量 d/2 见红(no spread)恢复绿；-race tunnel 86 passed | 通过 |
| C2 relay supervisor 退避 | go test ./internal/server -run TestRelaySuperviseBackoff -race | 长连接死后重连 | attempt 重置，delay 带 jitter | relay_runtime_backoff_test.go：delay 序列[1s,2s,1s,2s]；删 reset 块见红[1s,2s,3s,4s]；既有 AppliesChanges/Reconnects/SilentRelay -race -count=3 15 passed；vet/gofmt clean | 通过 |
| B1 frameBuffer 字节预算 | go test ./internal/relay -race | 塞超字节预算/超 cid 数/超房间总量 | 按字节丢最旧、cid 数与房间总量受限，内存有界 | protocol_buffer_test.go 6 测试：per-conn 4MiB/房间 32MiB/cid 256/超尺寸帧丢弃/take-drop 记账归零；还原旧无界逻辑见红 4 项(6MiB>4MiB,257conns,36MiB>32MiB)；-race -count=3 48 passed；worker wasm build clean；vet/gofmt clean | 通过 |
| B2 自托管 room 连接上限 | go test ./internal/relay -run TestRelayRoomRejectsSocketsPastCap -race | 一个 room 塞满 512 socket 再连 | 第 513 个被 1013 TryAgainLater 关闭，不注册 | relay_roomcap_test.go：真 socket 填满 MaxRoomConns=512，overflow Read 得 CloseError code 1013；关掉 guard 见红(overflow 被接受读超时)；-race -count=2 34 passed；vet/gofmt clean | 通过 |
| A1 manager 下游不阻塞 | go test ./internal/tunnel -run TestSlowStreamDoesNotBlockOthers -race | 一条流本地 socket 填满不读，另一条流收发 | B 流字节与 DataAck 仍到达，读循环不停 | manager_hol_test.go：A 流灌 8MiB 本地写满，B 流仍读到 pong:ping 且 DataAck 到达 peer；还原 inline conn.Write 见红(flooding A 不完成,读循环阻塞)；close 经队列终端标记排空后再关(修 TestManagerAndTargetExchangeBytes EOF 回归)；-race -count=3 174 passed；vet/gofmt clean | 通过 |
| A2 target 下游不阻塞 | go test ./internal/tunnel -run TestTargetSlowStream -race | 一条流 conn.Write 阻塞 | 同 sink 其它流/帧继续 | target_hol_test.go：A 流服务永不读，灌 8MiB HandleFrame 全返回，B 流 echo 仍收齐；还原 inline conn.Write 见红(flooding A 阻塞读循环)；半关先排空队列写再 CloseWrite(TestTargetHalfCloseDrainsQueuedWrites)；修既有 race(handleLocalConn setError 先于 dropStream 的 t.Logf，删两处 premature setError)；-race -count=1 60 passed，25×count=3 races=0；vet/gofmt clean | 通过 |
| D1 连接卫生 | go test ./internal/tunnel -run 'TestTargetDialRespectsTimeout\|TestTargetIdleStreamCloses\|TestManagerIdleStreamCloses\|TestTargetActivityKeepsStreamAlive' -race | 流空闲超时 / dial 超时 / 有流量保活 | idle 流被关，dial 有显式超时，活跃流不被误杀 | idle_test.go 4 测试：dial 192.0.2.1:9 在 300ms 预算内失败(!Allowed+Reason 含 Failed to connect)；target/manager idle 200ms 流被回收；每 100ms 发字节×6(600ms>300ms 窗口)流仍活。关 sweep 见红 2 项(target 从未回收/manager 读到 deadline 超时非关闭)；收紧 manager 断言要求<2s 内被 sweep 关闭(排除 read deadline 假阳)；-race -count=3 全包 13.0s ok；vet/gofmt clean | 通过 |
| E1 共享向量 | go test ./internal/tunnel -run TestTunnelFrameVectors -race + cd packages/protocol && vitest tunnel-vectors | 两边读同一 JSON | 字节布局逐字节一致 | tunnel-vectors.json（7 valid+5 invalid，frameHex 从布局规格手算非 codec 输出）；Go frame_vectors_test.go 22 passed(decode/encode/reject)，TS tunnel-vectors.test.ts 20 passed；红证明：TS encoder 交换 opcode/idLen 字节→7 encode 全红，Go EncodeFrame 同样交换→encode 全红，恢复均绿；既有 tunnel.test.ts/demux.test.ts 29 passed 未改；protocol typecheck/lint/format clean | 通过 |

## 证据与决定

- C1（internal/tunnel/relaypeer.go）：reconnectJitter/reconnectSleep seam var，equal jitter [d/2,d]。startKeepalive 改在调用 goroutine 读 tunnelPingInterval/Timeout（修测试 seam race，keepalive goroutine 不被 join）。**同步上游后调整**：origin/main 的 3d3a9b89c（fix(tunnel): stop an idle tunnel from flapping on a 45s timer）独立实现了同一个 backoff 重置，且信号更好——connectOnce 加 onConnected 回调，连上对端（E2EE 握手完成或无 session 时 dial 成功）即 proved=true 复位 delay，不等 30s。我原 reconnectStableAfter=30s 存活启发式被它取代：删除该 var 与我的 TestReconnectBackoffResetsAfterStableConnection（重置由上游 TestRunResetsBackoffAfterAProvenConnection 覆盖），只保留 jitter 测试。上游 memory/relay-socket-lifecycle.md 的根因（peer key 证明物是 challenge 回显，被 DaemonSession.Receive 吞掉永不投递，挂「投递第一帧」会让空闲 tunnel 每 15s 被 wsHelloTimeout 杀）由上游 server.go:944 修，不在我 diff。合并后 tunnel -race 86 passed、audit 全绿。
- C2（internal/server/relay_runtime.go）：seam 用**实例字段** stableAfter/jitter/sleep（非全局），因 Apply 的 supervise goroutine 异步取消会 lingering，全局 seam 会与其它测试 race。relayStableAfter=30s const，relayJitter/relaySleep 默认函数，newRelayRuntime 注入。supervise 重置在 attempt++ **之前**（reset 后 delay=1s base，不是 0）。线性 attempt*1s cap 30s 不变。既有 connect 立即返回 nil 的测试寿命<30s 不触发重置，行为不变。
- B1（internal/relay/protocol.go frameBuffer）：新增 bytes map[string]int + total int。常量 MaxBufferedBytesPerConn=4MiB、MaxBufferedBytesTotal=32MiB（DO 128MiB 留余量）、MaxBufferedConns=256。add：超 per-conn 预算的单帧直接丢；新 cid 且 map 满→evict 一个；append 后按帧数+字节丢最旧，**幸存者 copy 到新 slice**（re-slice 尾部会让被逐帧留在 backing array，字节预算不约束真实内存）；total 超房间上限→整连接 evict 直到 fits（per-conn 4MiB<32MiB 保证终止）。take/drop 经 dropLocked 释放 total/bytes 记账。flushFrames 失败塞回 add 不变。
- B2（internal/relay/relay.go）：sessionRoom 加 conns int，add++/remove--，full()=conns>=MaxRoomConns(512)。handleWS acquireRoom 后若 full→ws.Close(1013 TryAgainLater,"relay room full") return（Accept 后关，client 见真 close code）。只 Go server build；hosted DO 由平台 per-DO 限。
- B 余项裁定不做：idle/attach 时限需 server-ping 机制+策略阈值（非廉价）；peerConn.Send 当前同步 writeMu+10s 超时，改有界发送队列要重写热路径且有 race 风险，收益（一个不读 client 挂转发 goroutine 10s）已被 10s 超时+room cap 缓解。报告 B 本就标"若廉价则加"。
- A1（internal/tunnel/manager.go）：stream 加 pendingDown []downItem + pendingDownBytes + downCap(16MiB) + downNotify(buffered 1) + owner *forward。downItem{payload,ackSeq,ack,closeStream}。handleFrame DataDownstream/Seq 只 enqueueDown（读循环非阻塞），溢出 dropStream 单流。pumpDownstream 每流 goroutine 排空写本地 socket，写成功后发 DataAck(ackSeq=accept 时 cursor，反映已写字节非已入队)。OpcodeClose 入队 closeStream 终端标记，writer 先排空已入队响应再 dropStream——否则本地 socket 早关，截断客户端还在读的尾部（TestManagerAndTargetExchangeBytes EOF 回归）。dropStream 置 closed 后 wake downNotify 让 park 的 writer 退出。cursor accept 只在读循环推进，无 race。
- A2（internal/tunnel/target.go）：targetStream 加 pendingUp []upItem + pendingUpBytes + upCap(16MiB) + upNotify(buffered 1)。upItem{payload,closeWrite,closeStream}。enqueueUp 在 writeMu 下 lazy init（upNotify/upCap，因既有测试手工建 targetStream 不经 Open）。HandleFrame DataUpstream 只 enqueueUp（读循环非阻塞，与 terminal/file 共 sink），溢出 closeReason="upstream buffer exceeded 16 MiB"+closeStream。Close 的 CloseWrite/全关也经队列终端标记，writer 先排空再 CloseWrite/closeStream（半关不截断已入队写）。pumpUpstream 每流 goroutine，空队列 select upNotify/time.After(250ms)（250ms 兜底手工流无 wake）。closeStream 置 closed 后 wake upNotify。
- A2 race 根因修（既有 latent bug，A1 新增 goroutine 改变调度使其浮现）：handleLocalConn 两条拒绝路径（!result.allowed、hostCapable）原先 m.setError(f,reason) 发布 StateError 在 m.dropStream 之前；baseline 测试 TestNonLoopbackForwardRequiresHostCapableTarget 用 WaitForState(StateError) 收尾→观察到 state 即结束测试→dropStream 内 m.logf(=t.Logf,manager.go:833) 在测试结束后触发→DATA RACE。git show HEAD 确认此排序 baseline 就有(HEAD:439-440,452-453)，非我 diff 引入。修：删两处 premature setError，dropStream 本就在 logf 之后才 setError(manager.go:835，reason 非正常时)→log 先于 state 发布，waiter 不可能在 log 前结束。证据：修复前我的代码+HOL 测试 3/20 races；修复后 25×count=3=75 suite runs races=0；baseline 单跑 hostCapable count=100 races=0。既有 flaky TestTargetReconnectResumesPendingResponse(target_test.go:406,3.01s 超时)baseline 2/20 同样失败，非我引入，不改（既有测试只读）。
- D1（internal/tunnel/target.go + manager.go）：顶部 var tunnelDialTimeout=10s、tunnelIdleTimeout=15min。Target.Open 的 net.Dial→net.DialTimeout("tcp",dialed,t.dialTimeout)（dialTimeout 构造时捕获，只 Open 同步读，plain 字段无 race）。idle=per-stream lastActivity atomic.Int64(UnixNano)，双向数据帧移动时 stamp（manager:handleFrame DataDownstream/Seq + pumpLocalToPeer n>0 + handleLocalConn 创建 + resumeStream；target:HandleFrame DataUpstream + pumpDownstream n>0 + Open 新建/复用 + resumeStream）。sweeper 每实例一个 goroutine（NewTarget/NewManager 启动），**idleTimeout 用 atomic.Int64 纳秒**（C1/C2 同款教训：sweeper goroutine 与测试构造后写并发，plain 字段无 happens-before→race），每 pass 重读 atomic + 轮询间隔 cap 500ms（缩短的 timeout 一个 poll 内生效；once-computed 7.5min ticker 在测试 deadline 内永不触发）。target 用 stop chan 停（Close 幂等 close），manager 用 closeCh。sweep 收集 lastActivity!=0&&<cutoff 的 stale（跳过手工 placeholder conn=nil/零 stamp，保 TestTargetResumeAcknowledgesExistingStream），解锁后逐个 closeReason "idle timeout"+closeStream/dropStream。
- E1（packages/protocol/src/binary-frames/tunnel-vectors.json + internal/tunnel/frame_vectors_test.go + packages/protocol/src/binary-frames/tunnel-vectors.test.ts）：一份 JSON 两边读，锁共享面=布局 [1B opcode][1B idLen][id utf8][payload] + TS 解码的三 opcode（DataUpstream 0x20/DataDownstream 0x21/Close 0x22）。Go-only opcode（Open/OpenAck/Resume/Seq/DataAck）不进共享向量。frameHex 从布局规格手算（node 脚本生成 + 人工核验小向量），非任一 codec 输出倒推。7 valid（含 255 字节 max-id、binary payload、close 无 payload）+5 invalid（empty/opcode-only/zero-id-len/truncated-id/unknown-opcode 0x7f，均结构拒绝，落在两 codec 交集）。Go 读 ../../packages/.../tunnel-vectors.json，TS 读 new URL("./tunnel-vectors.json",import.meta.url)（readFileSync，repo 既有 fixture 读法）。id 限 ASCII：TS 校验 UTF-16 .length 而 Go 校验字节长，非 ASCII id 近 255 边界超出共享面。红证明两侧各交换 opcode/idLen 字节→encode 向量全红，恢复绿。
- 全包回归发现的第二个既有 race（根因修，internal/tunnel/target.go HandleFrame Open 分支原:313）：`if stream := t.streams[frame.TunnelID]; stream != nil { stream.resumable = true }` 无锁读 map+写 resumable。git show HEAD:202 确认 baseline 就有此无锁读。A2/D1 新增的 pumpUpstream/sweepIdle goroutine 经 closeStream 在 t.mu 下 delete(t.streams)，使这条 latent 无锁读在 TestRelayTunnelForwardsConcurrentStreams 浮现（closeStream target.go:650 mapassign vs handleBinaryFrame→HandleFrame:313 mapaccess）。修：map 读加 t.mu（closeStream 在其下 delete），resumable 写加 stream.writeMu（sendOrPause:567 在其下读，匹配既有约定）。证据：修前该测试 -race 必红；修后 -race -count=3 ok(19.7s)，tunnel 包 -race -count=2 172 passed。
- internal/server 全包 -race 仍有 11 个 FAIL，**全部是 "race detected during execution of test"，无功能断言失败**，且全部指向既有 Pi-agent race（server.go:2902 handleCreateAgent 读 vs server.go:3799 startOrGetPiAgent.func2 经 pi.Session.handleRawEvent 写）。git stash 我的全部改动 + 移开新测试后，clean baseline 单跑 TestCreateAgentHonoursExplicitWorkspace -race 复现同一 server.go:2902/3799 race→确证既有，非我引入，不在本任务范围（既有测试/代码只读，不修无关 race）。audit 的 go test ./... 不带 -race，这些 race 不触发，功能绿。

## 完成核对

- 行为门：8 行证明表（C1/C2/B1/B2/A1/A2/D1/E1）全部通过，每行先红后绿（见证据列）。
- 范围门：无 scope.md。A–E 全实现；C3（worker closeAllSockets 配速 drain）与 B 余项（relay idle/attach 时限、peerConn.Send 有界队列）裁定不做，理由见决定区，非未决证明缺口。F（公网 TLS 暴露）另议。
- 契约门：共享路径基线+同入口比较；既有测试原文件原断言未改（git diff 确认无既有 _test.go/test.ts 改动）。
- 完成门：proof_gap 为空；scripts/check_work.py 通过。
- 验证汇总：npm run audit --no-browser 全绿（Go 测试全部通过、入站字段缺口 0、出站 MISSING/OPTIONAL/NEVER_SENT 0、重审账本一致）；internal/tunnel -race ok（合并上游后 86 passed）；internal/relay -race ok；worker wasm build ok；scripts/relay-worker.test.mjs 11 pass；protocol typecheck/lint/format clean。
- 同步上游：git fetch + ff-only 到 origin/main（bf55532ba，v0.26.4，11 commits）。唯一冲突 internal/tunnel/relaypeer.go——上游 3d3a9b89c 与我的 C1 同改 Run 退避。采用上游 proved 重置信号（更优），保留我的 jitter，删冗余 reconnectStableAfter 与重复重置测试。其余 5 源文件+全部新测试无冲突。合并后 audit 重跑全绿。C2（relay_runtime.go supervise）保留 30s 存活启发式：ConnectRelay 的证明物是 dial 本身（markConnected），控制通道不受 tunnel 的 15s hello-flap 影响，且改 ConnectRelay 签名会波及既有只读测试，故不与上游 proved 信号强行统一。
- 交付前清理：git diff 无 stray debug/TODO/if false；红证明临时改动全部还原（frame.go/tunnel.ts 未改）。
- 需要用户看的推断或无法判定：C3 worker drain 跳过（COMPAT 临时码 2026-12-15 删，DO handler 不能 sleep）；internal/server 全包 -race 的 11 个 FAIL 全是既有 Pi-agent race（server.go:2902/3799），clean baseline 复现确证非我引入，不在本任务范围。