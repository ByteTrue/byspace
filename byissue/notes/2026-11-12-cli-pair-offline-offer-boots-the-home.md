# `byspace pair` 连不上 `--addr` 时的回退：既会启动被指向的 home，也会铸出错 home 的身份

**结论：** `byspace pair --addr <一个连不上的 daemon>` 过去不报错，而是**回退到离线铸 offer**。这条回退有两个毛病，都在 `pairingOfferURL` / `buildOfflinePairingOffer` 里：

1. **它会启动被指向的 home。** 离线路径用 `server.New()` 读两个身份值——等于把那个 home 的 daemon 启动逻辑整个跑一遍。不带 `--home` 时 `home.Resolve("")` 解析到默认 home，所以一条「给我个配对链接」的命令会往**生产 home** 里写 `chief/`、`cli-credential`，恢复终端会话、尝试起隧道 peer。
2. **它铸的是错 home 的身份。** 显式给了 `--addr` 指向 daemon A，A 连不上，回退却用**默认 home**（可能是 B，或生产）的 serverId 和公钥铸 offer。拿到的链接会把设备配对到**另一台 daemon**，且毫无提示。

修法：离线铸 offer 只读 `server-id` 和 `daemon-keypair.json`，绝不构造 Server（解决 1）；显式 `--addr` 拿不到那台 daemon 的真实 offer 时**直接报错**，不静默换成别的 home（解决 2）。未给 `--addr` 时保持原有离线铸法——那才是「先铸链接再起 daemon」的正当用法，身份一致。

**何时用：** 改 `internal/cli` 里任何「连不上 daemon 就回退到读 home 文件」的命令；或者在别的机器上跑 `pair`、`onboard` 这类命令前，想确认它会不会动生产 home。

**细节：**

- **触发条件是「daemon 连不上」，不是「命令写错」。** `pairingOfferURL` 先 `dialDaemonWS(addr)`；目标 daemon 设了密码而 CLI 手里没有对得上的凭证时，升级被 401 拒，`err != nil`，于是 `return buildOfflinePairingOffer(...)`。这条回退本身是对的（`pair` 也用来在启动 daemon 前先铸链接），错的是回退的实现。
- **`server.New()` 是有副作用的构造函数，不是读配置。** 它跑 daemon 的启动路径：`EnsureHomeWorkspace`（建 `chief/`）、`EnsureCLICredential`（写 `cli-credential`）、`RebuildWorkspaceRegistryFromAgents`、`BackfillProjectKeys`，`Server.Close` 时还会恢复终端会话。实测日志：`restored 2 terminal tab(s)`、`tunnel gate set to true`、`cannot open local listener on 127.0.0.1:34125`（它想绑生产 daemon 已经在用的隧道端口）。这些全是「一个 daemon 启动时该做的事」，被一条打印链接的命令触发了。
- **铸 offer 只需要四个值**：`serverId`、`daemonPublicKeyB64`、`version`、`hostname`。前两个直接读 `home.GetOrCreateServerID` / `home.LoadOrCreateKeyPair`，后两个本来就有。`store.New(home).LoadDaemonConfig()` 读 relay/app 配置也是纯读。没有一样需要 Server 实例。修复把方法体抽成 `server.BuildPairingOfferURLForHome(serverID, pubKeyB64, version, ...)`，方法委托给它，CLI 直接调。
- **生产没有真的坏，是运气。** 生产 daemon（PID 552）没重启、`config.json` 的 mtime 没变（`tunnel gate` 只进了临时 daemon 的内存，没落盘）、relay 仍是官方地址。被写的是 `terminal-sessions.json`（会话 id 是生产原有的，属读后回写）。但这条路径能写生产 home 本身就是红线：`docs/ad-hoc-daemon-testing.md` 明令禁止为了复现而 spawn daemon，而 `pair` 绕过了它描述的全部保护，连端口冲突都撞上了。
- **守卫测试：** `internal/cli/pairing_offer_test.go` 的 `TestOfflinePairingOfferDoesNotBootTheHome` —— 对空 home 铸 offer，断言 `chief` 和 `cli-credential` 都没被创建。把实现改回 `server.New()` 会让它失败（实测报 `created chief`）。
- **第 2 条（身份错配）单独看。** 触发条件是「显式 `--addr` + 连不上」，不是「没给 addr」。`pairingOfferURL` 现在区分 `explicitAddr`：给了 addr 又拨不通（或那台 daemon 的 relay 没配、返回空 url），就返回错误，错误文案点明「offer 会是别的 home 的」；没给 addr 才走离线铸法。实测中这条正是 S17 端到端里 `pair --addr 127.0.0.1:8793` 铸出生产 serverId 的直接原因——8793 设了密码、CLI 凭证对不上，连接被拒，于是拿默认 home 铸了 offer。
- **第 2 条的守卫测试：** `TestPairingOfferRefusesToMintForAnotherHomeWhenAddrUnreachable` —— 显式 addr 指向 `127.0.0.1:1`（关闭端口，秒拒，不碰 6777），断言报错且文案含 `different home`。把错误分支改回静默铸 offer 会让它失败（实测报 `minted an offer instead of failing`）。

**相关：** [docs/ad-hoc-daemon-testing.md](../../docs/ad-hoc-daemon-testing.md) · [docs/development.md 不要为了测东西重写生产 home](../../docs/development.md#never-rewrite-the-production-home-to-test-something) · epic [host-sync-chain](../epics/2026-11-12-o-host-sync-chain/spec.md)
