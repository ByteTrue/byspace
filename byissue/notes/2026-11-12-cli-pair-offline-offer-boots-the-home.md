# `byspace pair` 铸不出链接时会启动一个 daemon 并写它被指向的 home

**结论：** `byspace pair --addr <一个连不上的 daemon>` 不是报错，而是**回退到离线铸 offer**，而那条离线路径过去用 `server.New()` 读两个身份值 —— 等于把那个 home 的 daemon 启动逻辑整个跑了一遍。不带 `--home` 时 `home.Resolve("")` 解析到默认 home，所以一条「给我个配对链接」的命令会往**生产 home** 里写 `chief/`、`cli-credential`，恢复终端会话、尝试起隧道 peer。修法是离线铸 offer 只读 `server-id` 和 `daemon-keypair.json`，绝不构造 Server。

**何时用：** 改 `internal/cli` 里任何「连不上 daemon 就回退到读 home 文件」的命令；或者在别的机器上跑 `pair`、`onboard` 这类命令前，想确认它会不会动生产 home。

**细节：**

- **触发条件是「daemon 连不上」，不是「命令写错」。** `pairingOfferURL` 先 `dialDaemonWS(addr)`；目标 daemon 设了密码而 CLI 手里没有对得上的凭证时，升级被 401 拒，`err != nil`，于是 `return buildOfflinePairingOffer(...)`。这条回退本身是对的（`pair` 也用来在启动 daemon 前先铸链接），错的是回退的实现。
- **`server.New()` 是有副作用的构造函数，不是读配置。** 它跑 daemon 的启动路径：`EnsureHomeWorkspace`（建 `chief/`）、`EnsureCLICredential`（写 `cli-credential`）、`RebuildWorkspaceRegistryFromAgents`、`BackfillProjectKeys`，`Server.Close` 时还会恢复终端会话。实测日志：`restored 2 terminal tab(s)`、`tunnel gate set to true`、`cannot open local listener on 127.0.0.1:34125`（它想绑生产 daemon 已经在用的隧道端口）。这些全是「一个 daemon 启动时该做的事」，被一条打印链接的命令触发了。
- **铸 offer 只需要四个值**：`serverId`、`daemonPublicKeyB64`、`version`、`hostname`。前两个直接读 `home.GetOrCreateServerID` / `home.LoadOrCreateKeyPair`，后两个本来就有。`store.New(home).LoadDaemonConfig()` 读 relay/app 配置也是纯读。没有一样需要 Server 实例。修复把方法体抽成 `server.BuildPairingOfferURLForHome(serverID, pubKeyB64, version, ...)`，方法委托给它，CLI 直接调。
- **生产没有真的坏，是运气。** 生产 daemon（PID 552）没重启、`config.json` 的 mtime 没变（`tunnel gate` 只进了临时 daemon 的内存，没落盘）、relay 仍是官方地址。被写的是 `terminal-sessions.json`（会话 id 是生产原有的，属读后回写）。但这条路径能写生产 home 本身就是红线：`docs/ad-hoc-daemon-testing.md` 明令禁止为了复现而 spawn daemon，而 `pair` 绕过了它描述的全部保护，连端口冲突都撞上了。
- **守卫测试：** `internal/cli/pairing_offer_test.go` 的 `TestOfflinePairingOfferDoesNotBootTheHome` —— 对空 home 铸 offer，断言 `chief` 和 `cli-credential` 都没被创建。把实现改回 `server.New()` 会让它失败（实测报 `created chief`）。

**相关：** [docs/ad-hoc-daemon-testing.md](../../docs/ad-hoc-daemon-testing.md) · [docs/development.md 不要为了测东西重写生产 home](../../docs/development.md#never-rewrite-the-production-home-to-test-something) · epic [host-sync-chain](../epics/2026-11-12-o-host-sync-chain/spec.md)
