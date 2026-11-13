# E2EE 两端都用固定密钥时，每次会话共享密钥相同，旧帧能在新会话重放

> **读者：** 在 E2EE 通道上做身份认证或授权、给隧道/relay 加基于公钥的信任，或读 `internal/e2ee` 握手代码的人。
> **自检：** 一句话结论 · 何时用 · 为什么会这样 · 修法 · 相关代码位置。

---

**结论：** BySpace 的 E2EE 握手是 static-static DH——两端都用各自的**固定**密钥对（daemon 用 `daemon-keypair.json`，隧道发起端也用它自己的固定密钥，不是每连接临时生成）。共享密钥由两把固定密钥算出，所以**同一对 daemon 之间，每一次会话的共享密钥都一模一样**。后果：一个能看到密文的中转（relay）录下某次会话的帧，在**下一次**会话里原样重放，目标端照样能解开——因为它等的是同一把共享密钥。光有「对方握手里报了公钥 X」不足以授权，公钥可以随口声称，帧可以录制重放。（穿刺测试实测，2026-11-12，F 单元。）

**何时用：** 任何「用对端公钥决定给不给权限」的地方——隧道授权、daemon 之间的信任、以后任何基于固定密钥的身份。判断标准：**授权只凭公钥吗？** 是，就有重放面。

**细节：**

- **穿刺证明的三件事**（`internal/e2ee/peer_identity_test.go`）：
  1. `TestDaemonSessionIdentifiesStaticKeyPeer`：目标端能从握手里拿到发起端公钥（`DaemonSession.PeerPublicKey`），且真持私钥的一方发的帧能解开。
  2. `TestDaemonSessionRejectsFramesFromKeyClaimant`：只在 hello 里声称别人公钥、没有对应私钥的一方，发不出能解开的帧（ready 是给真公钥封的，冒充者解不开）。
  3. `TestStaticKeySessionsRejectReplayedFrames`：把会话 1 录下的帧，连 hello 一起丢进会话 2 的新 `DaemonSession`，**解不开、被丢弃**。这条测试以前叫 `...AcceptReplayedFrames`，是 F 单元加了挑战之后才翻过来的——名字就是给后来人的信号。
- **修法：每次会话挑战（challenge/nonce）。** 目标端握手时在 `e2ee_ready` 里带一个随机 nonce（`ReadyMessage.Challenge`），发起端必须在加密通道里把它原样回传（`{"type":"e2ee_challenge","challenge":...}`），`DaemonSession.Receive` 在 `challengeOK` 之前丢弃一切帧。重放的旧帧里带的是旧 nonce，对不上，进不来。nonce 每会话新生成（`NewDaemonSession` 里 `crypto/rand`），所以录一次用一次。
- **授权顺序是重点。** 光有 `PeerPublicKey` 不够——它只证明「对方声称是这个 key」，得等挑战通过（`ChallengeMet()`）才能把这把公钥当作已验证身份用于授权。隧道目标端正是这么做的：挑战过了才 `setRelayPeerKey`，之后开隧道帧才拿去查 `tunnel-grants.json`（授权的当前真相见 [spec/connection.md](../spec/connection.md)「Daemon 隧道」，实现见 `internal/server/tunnels.go` 的 grant 分发和 `internal/tunnel/grants.go`）。
- **别把这个缺口「修」成每连接临时密钥。** 那样目标端就认不出是哪台 daemon 了（每次都是新 key），授权没法做。固定密钥 + 每会话挑战是配套的一对：固定密钥给身份，挑战给新鲜度。
- **网页客户端不受影响。** 它们不靠公钥授权，靠密码（B 单元那条路径）。挑战是 daemon-to-daemon 授权才需要的。

**相关：** [relay 连接鉴权绕过 HTTP bearer](2026-11-12-relay-connection-auth-bypasses-http-bearer.md) · [008 隧道为什么强制 relay](008-tunnel-performance-and-relay-vs-p2p.md) · `internal/e2ee/channel.go`（`DaemonSession`、challenge）· `internal/e2ee/client.go`（`ClientSession.sendChallengeEchoLocked`）· epic [host-sync-chain F 单元](../epics/2026-11-12-o-host-sync-chain/ledger.md) · [spec/connection.md](../spec/connection.md)「Daemon 隧道」
