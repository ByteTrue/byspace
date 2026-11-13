# relay 数据连接绕过 HTTP 鉴权，默认是 owner

> **读者：** 改 relay 连接鉴权、加新的出站连接类型，或排查「daemon 设了密码，为什么经 relay 还能被连上」的人。
> **自检：** 一句话结论 · 何时用 · 两条路径的差异 · 修法 · 相关代码位置。

---

**结论：** daemon 有两种入站路径，鉴权是分开写的。浏览器/CLI 走 HTTP，`ServeHTTP` 在设了密码时校验 `Authorization` 头或 `byspace.bearer.<pw>` 子协议。relay 走的是 daemon **自己拨出**的出站 WebSocket（`serveRelayDataConn`），根本不经过 `ServeHTTP`；而一条连接的权限默认是 **owner**（不在 `sinkPermissions` 里就是 owner）。两者一叠加：设了密码的 daemon，经 relay 仍然对任何拿到 pairing offer 的人敞开——offer 里有 serverId 和公钥，没有密码，但那条路径压根不问密码。（读代码 + 本地实测，2026-11-12，B 单元修复前。）

**何时用：** 动 relay 连接的鉴权、权限默认值、或任何「daemon 主动拨出、对端反向驱动它」的连接类型时。判断标准：**这条连接经过 `ServeHTTP` 吗？** 不经过，就不受 HTTP 那层密码保护。

**细节：**

- **两条路径。** HTTP 侧校验在 `internal/server/server.go` 的 `ServeHTTP`（`s.daemonPasswordHash() != ""` 那段）。relay 侧在 `serveRelayDataConn`，包一个 `e2eeSinkAdapter` 直接进 `serveSessionOnSinkGreeted`，没有密码这一步。
- **默认 owner 是根因的一半。** `internal/server/authz.go` 的 `authorizationForSink`：sink 不在 `sinkPermissions` map 里就返回 owner 权限集。设计意图是「本机直连 = 机主 = owner」，但 relay 连接也不在 map 里，于是白捡了 owner。
- **修法（B 单元）。** relay 连接起步标记 `relayAuthPending`，权限清空；它发的第一条加密帧必须是 `auth.password.submit.request`，`handleRelayPassword` 校验通过才 `SetSinkPermissions(owner)` 并放行 hello，否则用关闭码 `4004` 断开。**没设密码的 daemon 直接拒绝 relay 连接**——relay 可达性正是密码要覆盖的场景。
- **客户端侧配套。** `packages/client/src/daemon-client.ts` 的 `relayHandshakeAuth`：relay 连接**不再**把密码放进子协议或 `Authorization` 头。那两个是明文握手字段，relay 读得到，等于把密码交给了本该零知识的中转方。密码改成第一条加密帧发出。直连不变，仍用子协议（见 [007](007-daemon-src-vs-dist-and-ws-protocols.md)，那条讲的 protocols 坑只对直连成立）。
- **守卫测试。** `internal/server/relay_password_test.go`：无密码被拒、密码错被拒、hello 先于密码被拒、密码对才拿到 server_info。`packages/client` 的 `proves a relay password inside the channel instead of the subprotocol`：握手里没有密码、密码是第一条帧。

**相关：** [007 直连子协议密码](007-daemon-src-vs-dist-and-ws-protocols.md) · [003 relay 帧预算](003-relay-frame-budget-and-large-payloads.md) · [006 relay 两 runtime 帧表示](006-relay-runtime-frame-representation.md) · [docs/permissions.md](../../docs/permissions.md) · [spec/connection.md](../spec/connection.md)「主机列表同步」末条 · epic [host-sync-chain B 单元](../epics/2026-11-12-o-host-sync-chain/ledger.md)
