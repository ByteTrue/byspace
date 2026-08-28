# byspace Project Spec

## 当前是什么

byspace 已从 Paseo 导入并建立独立的 Web-only 构建基线：当前仓库可用干净安装导出可安装的 PWA 静态产物，并包含前端所需的 client、protocol、Relay client/Worker、highlight 与 plugin workspace。`go/` 中已实现共享协议 fixtures/codec、统一 `byspace` 二进制的 daemon lifecycle/CLI 监督骨架、由 daemon 拥有的 provider-neutral Agent/Timeline manager 与 Pi RPC adapter、local-only `/ws` Agent contract、Agent/Timeline 原子持久化和 Pi native session resume，以及 single-directory workspace/project catalog、Pi provider snapshot、同源 Web 托管和 read-only Agent CLI。Copied Web 已在真实浏览器中通过真实 Go daemon + deterministic fake Pi 完成 create/send/stream/idle、refresh、daemon stop/start、同一 Agent resume/续写及并发 CLI Timeline observation。Go daemon Relay v2 transport、mutual-auth E2EE、authenticated pairing offer、copied client remote Agent tracer、Web/PWA direct + Relay 多主机浏览器闭环，以及 Go CLI saved remote target observation 已实现；生产 Relay 部署和 Hub 尚未实现。当前建设主线位于 [`../epics/002-o-relay-remote-connectivity/spec.md`](../epics/002-o-relay-remote-connectivity/spec.md)，下一切片是 Cloudflare Relay 在 `relay.byspace.cc.cd` 的真实部署、运行边界与 production smoke。

当前参考实现位于本机 `~/workspace/forks/paseo`，导入基线固定在 commit `a8734a972495cf343f628d1017e87775767aade5`。它继续提供产品行为、协议与测试证据；byspace 不在该目录直接开发。

## 现在从哪里进入

- 理解最终产品、永久边界与统一语言 → [`../vision/index.md`](../vision/index.md)
- 查看第一条建设主线、组件迁移判断与当前可推进范围 → [`../epics/001-o-rewrite-foundation/spec.md`](../epics/001-o-rewrite-foundation/spec.md)
- 查看已验证的 Web 导入闭包、命令与残余风险 → [`../epics/001-o-rewrite-foundation/issues/002-c-web-import/`](../epics/001-o-rewrite-foundation/issues/002-c-web-import/)
- 查看 TypeScript↔Go 共享协议契约 → [`../epics/001-o-rewrite-foundation/issues/003-x-protocol-fixtures.md`](../epics/001-o-rewrite-foundation/issues/003-x-protocol-fixtures.md)
- 查看 daemon/CLI 监督骨架与所有权边界 → [`../epics/001-o-rewrite-foundation/issues/004-x-daemon-cli-supervisor.md`](../epics/001-o-rewrite-foundation/issues/004-x-daemon-cli-supervisor.md)
- 查看 Agent/Timeline 事实源与 Pi RPC process boundary → [`../epics/001-o-rewrite-foundation/issues/005-x-agent-pi-lifecycle.md`](../epics/001-o-rewrite-foundation/issues/005-x-agent-pi-lifecycle.md)
- 查看 copied client ↔ Go daemon 的本地 Agent WebSocket contract → [`../epics/001-o-rewrite-foundation/issues/006-x-local-agent-websocket.md`](../epics/001-o-rewrite-foundation/issues/006-x-local-agent-websocket.md)
- 查看 Agent/Timeline 原子持久化、restart recovery 与 Pi resume → [`../epics/001-o-rewrite-foundation/issues/007-x-agent-persistence-resume.md`](../epics/001-o-rewrite-foundation/issues/007-x-agent-persistence-resume.md)
- 查看 workspace/provider catalog、同源 Web 托管与 Agent CLI 闭环 → [`../epics/001-o-rewrite-foundation/issues/008-x-web-workspace-provider-bootstrap.md`](../epics/001-o-rewrite-foundation/issues/008-x-web-workspace-provider-bootstrap.md)
- 查看 Relay E2EE 的 Go↔TypeScript golden contract → [`../epics/001-o-rewrite-foundation/issues/009-x-relay-e2ee-interop.md`](../epics/001-o-rewrite-foundation/issues/009-x-relay-e2ee-interop.md)
- 查看 Windows Agent state protected-DACL 修复与原生运行证据 → [`../epics/001-o-rewrite-foundation/issues/010-x-windows-private-agent-state.md`](../epics/001-o-rewrite-foundation/issues/010-x-windows-private-agent-state.md)
- 查看当前 Relay remote connectivity 建设主线 → [`../epics/002-o-relay-remote-connectivity/spec.md`](../epics/002-o-relay-remote-connectivity/spec.md)
- 查看已关闭的 authenticated Relay v2 remote Agent tracer → [`../epics/002-o-relay-remote-connectivity/issues/001-x-relay-v2-agent-tracer.md`](../epics/002-o-relay-remote-connectivity/issues/001-x-relay-v2-agent-tracer.md)
- 查看已关闭的 Web/PWA direct + Relay 多主机 tracer → [`../epics/002-o-relay-remote-connectivity/issues/002-x-web-multi-host-relay-tracer.md`](../epics/002-o-relay-remote-connectivity/issues/002-x-web-multi-host-relay-tracer.md)
- 查看已关闭的 Go CLI authenticated Relay remote target 切片 → [`../epics/002-o-relay-remote-connectivity/issues/003-x-go-cli-remote-target.md`](../epics/002-o-relay-remote-connectivity/issues/003-x-go-cli-remote-target.md)
- 查看当前 Cloudflare Relay production deploy/smoke 切片 → [`../epics/002-o-relay-remote-connectivity/issues/004-o-cloudflare-relay-production.md`](../epics/002-o-relay-remote-connectivity/issues/004-o-cloudflare-relay-production.md)
- 查看已关闭的 Relay data-session retry/generation/slow-consumer lifecycle hardening → [`../epics/002-o-relay-remote-connectivity/issues/005-x-relay-session-lifecycle-hardening.md`](../epics/002-o-relay-remote-connectivity/issues/005-x-relay-session-lifecycle-hardening.md)

## 当前开发边界

- byspace 工作区与 Paseo 参考仓库分离，运行数据使用独立的 `~/.byspace`，不直接读写 Paseo home。
- 当前只复制已经由 Web build 证明的六个 workspace 闭包；后续不得以“未来会需要”为由无差别复制 Paseo 的 server、CLI、desktop 或 native app 代码。
- 当前静态 Web 仍保留 Paseo wire/type/storage 兼容层作为 Go 重写标尺；首轮 fixtures 只固定 copied Web 所需契约，没有对 stock Paseo 客户端的永久兼容承诺，也没有正式发布或数据迁移义务。
- Electron 桌面原生客户端和 iOS/Android 移动原生客户端是已确认的永久排除项。其余能力的先后顺序见 Vision 和 Epic，不在 Project Spec 提前宣称已实现。

## 当前质量基线

- **可追溯性**：目标、迁移判断和实现切片必须能回到 Paseo 行为或用户确认，不能根据包名自行删减产品范围。
- **安全性**：涉及远程连接、Relay、Hub、终端和文件权限的实现，在进入当前真相前必须有明确的信任边界与验证证据。
- **可演化性**：Pi 优先只决定实施顺序；统一 Agent 边界不能写成 Pi 专用产品模型，从而堵死已确认的后续 provider。
- **可部署性**：最终产物必须覆盖带完整 CLI 的 `byspace` Go 二进制、Web，以及可部署的 Relay 和 Hub；具体平台拓扑由活跃 Epic 收束。

## 已验证的构建基线

- Node 只用于前端构建；`npm ci`、`npm run build:web`、全 workspace typecheck、单元/Worker tests、Chromium browser tests 和 lint 已通过。
- Go module 固定在 `go/`，当前使用临时 module path `byspace`；protocol、daemon/CLI、Agent manager 与 Pi adapter 的 `go vet ./...`、`go test -race ./...`、并发 lifecycle stress 与 Windows cross-build 已通过，首次公开 Go import/发布前必须改成最终仓库 module path。
- Pi RPC 当前通过 helper subprocess 覆盖交错 response/event、abort/settle、unknown acceptance、process tree 和 descriptor 生命周期；本机 installed `pi 0.84.3` 的 offline `get_state` smoke 通过且未发送 prompt。Windows Job Object 只有交叉编译证据，仍需要 Windows runtime CI/主机验证。
- Local-only `/ws` 已通过 Go integration 与 copied `DaemonClient`↔真实 Go binary E2E；loopback/same-origin、hello/size/write timeout、双 client live broadcast、correlated unsupported error、Timeline window、幂等 interrupt 与 shutdown 后 provider PID 退出都有验证。
- `~/.byspace/state/agents-v1.json` 以私有 versioned atomic replace 保存 Agent/Timeline/delivery/Pi handle；Unix 使用 `0700`/`0600`，Windows 使用 current-user + LocalSystem protected DACL。损坏或访问控制非法的状态阻止启动且不覆盖证据，post-replace durability uncertainty 会 fail-stop manager。Copied client E2E 已验证同一 home 下 daemon stop/start、active turn interruption、Pi `--session`、Timeline/epoch/dedupe 恢复与续写；Windows Agent/Relay test binaries 已原生执行通过，shared DACL test 10/10。
- daemon 已从 `--web-dir > BYSPACE_WEB_DIR > <cwd>/packages/app/dist` 同源托管静态产物和 `/ws`，使用 rooted filesystem access、SPA fallback、内存 current-origin hint 注入与 no-listing/cache 规则；缺失 index fail closed。稳定 directory workspace/project、Pi availability snapshot 与 startup compatibility responders 已由 Go/schema/browser tests 验证。
- `fixtures/relay/e2ee-v1.json` 由 copied TypeScript Relay 和 Go `internal/relay` 共同消费，固定 tweetnacl `box.before` shared key 与 `[24-byte nonce][XSalsa20-Poly1305 ciphertext]`；Go 使用 `golang.org/x/crypto v0.55.0`，low-order peer、短包与认证篡改 fail closed。
- Go daemon 已按 Cloudflare Worker Relay v2 的 `connected` / `disconnected` / `sync` control contract 打开 outbound data sessions，以 stable private identity 和 v3 offer 完成 fresh-challenge HMAC client authentication，并与 direct `/ws` 共用 Agent dispatcher。Copied client 跨语言 E2E 已验证 remote create/send/live Timeline、Relay/daemon restart、Pi resume、zero-plaintext wire、replay/tamper/wrong-token fail closed；真实生产部署仍是独立未完成证据。
- Relay Worker 对 v2 client 使用 server-assigned connection IDs，限制 ID 语法、active sockets、单/全局 pending frame 与 byte budget，并安全处理 server-data replacement。Go data registry 对瞬时 dial 做 context-bound capped-jitter retry；disconnect/sync/shutdown generation 收敛、inbound/outbound 2 MiB wire limit，以及 connection-scoped slow-consumer queue cancellation已有 deterministic fault/race/stress tests。
- Copied Web 已在真实 Chromium 中同时保存 direct A 与 Relay B，通过真实 Hosts/project UI 完成远程 Agent turns；page reload、Relay 原页自动恢复、daemon B restart/Pi `--session`、A/B canonical Timeline 隔离、pairing secret 非泄漏和进程/socket teardown 均由 production Web + Go daemon + Cloudflare Wrangler E2E 验证。Host registry 初始 load/migration 使用 single-flight，避免旧异步快照覆盖新导入的 authenticated host。
- Go CLI 已用 stdin/私有文件导入 canonical authenticated v3 offer，在 `~/.byspace/state/remote-hosts-v1/` 以 Unix private mode / Windows protected DACL 和 per-host atomic no-replace record 保存 trust；`agent list` / `timeline [--follow] --host <serverId>` 复用 Relay v2 mutual-auth E2EE 与 daemon hello/session protocol。跨语言 E2E 覆盖 remote observation、Relay/daemon restart、Pi resume、wrong token/key/server identity 与输出 redaction。
- 产品源码和 manifests 不再引用 `@getpaseo/*`，排除的 desktop/server/CLI/native app 路径不存在；Apache-2.0 许可证和 Paseo 修改归属保留。
- Playwright 已升级到支持 Ubuntu 26.04 的 1.62.1；Chrome for Testing 151.0.7922.34 下 11 个 browser test files / 103 个 tests 通过。生产依赖审计仍有非 critical 的 Expo/markdown 传递风险，这是可见缺口，不是绿色证据。

首个 Epic 的 Issues 001–010 已在实现、focused review、自测与规格回写通过后关闭，Epic 001 已满足技术关闭条件并等待 Epic 级明确确认。Epic 002 的 Relay v2 tracer、copied Web 多主机、Go CLI remote target 与 remote lifecycle hardening（Issues 001–003、005）均已关闭；当前只剩 Issue 004 的 authenticated Cloudflare deployment provenance 与 post-deploy live smoke 未完成。Hub 与其它 daemon 领域继续进入后续 Epic。
