---
kind: issue
title: "没有 remote client 时 daemon 仍向 relay 发送业务帧"
type: bug
created: 2026-11-06
---

# 没有 remote client 时停止 relay 业务帧

## 预期与实际

relay 控制连接保留，让手机随时可以连进来；但没有任何 remote client 时，agent、terminal 和
workspace 业务广播不应上传。它们只产生 Cloudflare Durable Object 请求费用，relay 在没有对应
client 时也不会把它们缓冲下来。

最初怀疑 `broadcastSessionMsg` 只筛已握手的 socket，会在最后一个客户端离开后持续上传。真实
relay 测试否定了这个稳态假设：没有 remote client 时 daemon 只有 `server-control`，没有
server-data socket；最后一个 client 离开后 relay 关闭对应 server-data，并通知 control。
data session 的 context 取消使后续文本与二进制写入失败，随后 E2EE 会话退出并移除 sink。
`selective_agent_timeline` 与零客户端无关，不应拿它改出另一套全局在线状态。

验证中还发现一个独立的 Go client 兼容 bug：`ClientSession` 协商 binary ciphertext 后把
JSON 也作为 binary 密文发送，且把所有解密帧标为 binary；daemon 因而无法解析 tunnel peer
的 BySpace hello。它会让 tunnel/RPC 验证在真正进入转发前失败，必须先修复。

## 范围与约束

- 本地或 LAN 客户端照常实时更新；relay 是否有其他人观看不影响它们。
- relay 控制连接与 ping 保留，不用断开 daemon 的远程入口来省额度。
- 最后一个 remote client 离开后停止后续业务帧；新 client 上线后通过现有快照、timeline
  seq/cursor 与订阅恢复，不能靠重放无人观看时的每一条 delta。
- App client 和 daemon 发起的 tunnel 都使用 relay client 角色。存在 live tunnel 时不能按
  “没有 App 页面打开”停掉隧道业务帧。
- 不把旧 Windows peer 的配置清理混入本改动；那条重连消耗单独处理。

## 质量承诺

- **性能效率 / 资源利用**：零 remote client 时没有 relay 业务帧，运行中的 agent 也不再
  产生这部分 DO 请求；用真实 relay 消息计数验证，而不只看本地函数未被调用。
- **可靠性 / 可恢复性**：remote client 上线、最后一个离开、重新连接后，本地与远端内容
  一致，timeline 无重复、无 seq 缺口；tunnel 在 App 关闭时仍保持可用。
- **兼容性 / 互操作性**：不改变 relay v1/v2 线协议或旧 client 的握手、订阅和恢复行为。

## 实现方向

以每个 remote client 对应的 server-data socket 为发送边界，不按 App 页面 presence 增减全局
开关。保留 control socket 与 ping；data socket context 已覆盖 session 文本、terminal 和 tunnel
二进制回复。广播 sink 的移除只承担会话与订阅清理，不能替代物理 socket 的关闭。

E2EE 的 binary-ciphertext 能力只优化 binary 明文；文本明文始终是 base64 密文文本帧，解密后
保留传输帧的文本/binary 类型。Go `ClientSession` 按此修正，旧 peer 的 raw binary ciphertext
接收保留 COMPAT 分支，不改变 relay v1/v2 握手或恢复协议。

`relay.Options.ObserveFrame` 在共享 `Router.Message` 之前观测真实入站帧，只供本地测试计数；
生产路由不变。

## 执行记录与验证

`internal/server/relay_client_lifecycle_test.go` 使用真实 in-process daemon、relay、E2EE、
fake Pi、PTY 和 TCP echo 服务，在 relay 物理入站边界计数。没有启动或重启 6777 daemon。

- 本地 client + 零 remote client：fake Pi 在没有任何 remote data socket 时完成第二轮，
  新 connectionId 的 relay 帧为零。local PTY 在最后一个 remote 离开后继续输出，旧 connectionId
  没有新增帧，新 remote 尚未连接时也没有上传。✅
- 两个 remote client 同时订阅 terminal，第一个离开后第二个仍收到后续输出；最后一个离开后
  物理 data socket 退出，relay 新增业务帧为零。新 client 重连后按既有 backlog 顺序回放，
  证明 control 入口仍接受新 client。✅
- agent 重连使用旧 `endCursor` 请求 after 页面，只收到离线第二轮的 user/reasoning/assistant
  三行，source seq 连续、无重复，`gap/staleCursor/reset` 均为 false。✅
- tunnel client 没有 App 页面或 presence，经同一 relay/E2EE 完成 BySpace hello、open ack 与
  TCP echo 二进制回复。✅
- E2EE 单测覆盖文本 base64 密文、协商后的 binary 密文、文本/binary 类型保留，以及旧 raw
  binary ciphertext 接收；`internal/tunnel` 包测试和原有 relay control/握手测试通过。✅

通过的命令：

```sh
go test ./internal/e2ee -count=1 -v
go test ./internal/relay -count=1
go test ./internal/tunnel -count=1
go test ./internal/server -run '^(TestRelay(AgentRunsOfflineAndReconnectsFromTimelineCursor|TerminalStopsAfterLastClientWithoutStoppingLocal|TunnelForwardsWithoutAnAppSession|ControlChannelSurvivesASilentRelay)|TestServerOverRelayE2EEHandshake)$' -count=1 -v
go test -race ./internal/server -run '^(TestRelayTerminalStopsAfterLastClientWithoutStoppingLocal|TestRelayTunnelForwardsWithoutAnAppSession)$' -count=1
env -u GOROOT npm run audit -- --no-browser
npm run typecheck
npm run lint
npm run format:check
```

- 项目审计的完整 Go 测试通过（58.2 秒），入站/出站字段缺口均为零，重审账本一致。首次审计继承了失效的
  `GOROOT`，Go 在运行测试前退出；去掉该环境变量后通过，不需要修改代码。✅
- 6778 没有 dev daemon，浏览器 conformance 未运行，审计按 `--no-browser` 跳过；没有为检查启动或重启 daemon。
  这项不能记为浏览器验收通过。
- typecheck、lint 和全仓格式检查通过，`git diff --check` 无输出。✅

附加的 agent lifecycle race 检查暴露 `handleWaitForFinish` 未持锁写入 `mp.record`，与
`startOrGetPiAgent` 的完成回调竞争。它不是 relay gate 的回归，本 issue 不顺手扩大修复；
因此不把 agent 测试记为 race 通过。

### 2026-11-06 Cloudflare 只读计量

通过用户已登录的 Cloudflare 控制台读取生产 `byspace-relay-go_RelayRoom`：过去 1 小时为 0 请求、
0 WebSocket 消息、0 计费 GB-sec。当前部署版本是 `398df464`。这提供了真实零业务活动基线，
与本地 data socket 生命周期证据一致；该小时没有受控的运行中 agent，不能替代“运行中的 agent +
零 remote client”专项线上对照，也不验证尚未发布的 E2EE client 修复。没有导出 OAuth token、
部署新版本或重启 daemon。

## 关闭条件

- 在已有 dev daemon 上运行浏览器 conformance，确认现有页面行为未回归；本轮未运行。
- 发布当前 daemon 修复后，在受控运行中 agent 与零 remote client 的条件下复核 Cloudflare 请求量。
  当前只取得零业务活动的 1 小时零请求基线，没有发布当前修复或做受控前后对照，因此保留 issue。
  连接生命周期边界已回写 `byissue/spec/connection.md`，零客户端请求计量约束已更新到
  `byissue/notes/018-durable-object-billing-and-hibernation.md`。
