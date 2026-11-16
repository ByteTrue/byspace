# Relay 安全：认证门与密钥纪律

## 结论

- E2EE 必须每会话新鲜密钥交换（per-session nonce）。static-static DH 对同一对端每次会话产生相同 shared secret，relay 可把录下的帧重放进后续会话；公钥本身永远不能授权。证明测试 `internal/e2ee/peer_identity_test.go`。
- relay 数据连接是 daemon 主动拨出的（serveRelayDataConn），不经过 ServeHTTP 的密码检查，且默认权限是 owner：密码门必须长在 relay 帧处理路径上，不能指望 HTTP 层。
- 密码门必须盖住所有帧类型与所有广播路径：曾只 gate handleTextFrame，binary 帧走 handleBinaryFrame 未认证直达 terminal input（未认证 shell）；broadcastSessionMsg 曾泄漏全部会话广播；tunnel HandleFrame 曾只授权 OpcodeOpen，漏 DataUpstream/Resume。新增帧类型/广播路径时先问「认证前能不能到达」。
- relay 会话要求 daemon 已设密码：无密码拒绝 relay 会话（ok:false + reason + close）；set_daemon_config 开 relay 要求已有密码，清密码要求 relay 已关；启动时 relay 开但无密码则跳过拨号并记日志。第一帧必须是 auth.password.submit.request，否则 4004（handleRelayPassword，internal/server/authz.go）。
- 永不为了让测试变绿而删需求或把 spec 改成迁就代码。0.25.0 发布期间「relay 要求密码」曾被删掉使 setup-guide-pairing 变绿，spec/connection.md 被改成迁就代码，后全部恢复。
- 自定义 WS factory 必须转发 `protocols`，否则密码 daemon 拒绝 + 静默无限重连。
- TS relay 客户端必须应答 e2ee challenge：internal/e2ee/channel.go DaemonSession 在 nonce 回显前丢弃所有应用帧（plain=nil, err=nil）；packages/relay/src/encrypted-channel.ts 曾直接进 state="open" 不应答 → 浏览器 relay 流量全部静默丢弃，两端日志干净。排查这类「连上但没流量」先查 challenge 应答。

## 依据

- 类型：可重跑证明（各缺陷均有修复与测试）+ 用户决定（密码要求恢复，2026-11-13）。
- 被否决的相关方案：static-static DH（可重放）；依赖 HTTP bearer 保护 relay 连接（路径不经过）；只 gate 文本帧（binary/广播绕过）；删需求保测试绿（明确禁止的模式）。
- 证据或复核方式：笔记 `byissue/archive/v1/notes/2026-11-12-e2ee-static-key-shared-secret-replay.md`、`2026-11-12-relay-connection-auth-bypasses-http-bearer.md`、`2026-11-13-relay-frame-gates-missed-binary-and-broadcast.md`、`2026-11-13-relay-password-requirement-dropped-during-release.md`、`2026-11-13-ts-relay-client-never-answered-the-e2ee-challenge.md`、`2026-11-13-relay-pairing-never-completed.md`、`007-daemon-src-vs-dist-and-ws-protocols.md`；账本 `byissue/archive/v1/epics/2026-11-12-o-host-sync-chain/ledger.md:83-93`；代码 `internal/server/authz.go`、`internal/e2ee/`。
- 适用条件：relay/tunnel/e2ee 全部改动。docs/ad-hoc-daemon-testing.md 链接其中两篇笔记。

## 重访条件

- 新增帧类型、广播路径或连接建立方式。
- e2ee 握手协议变更（两端必须同步改，单端改 = 静默丢帧）。
