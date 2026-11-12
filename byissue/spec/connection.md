# 连接与发布通道

App 与 Relay 的地址按发布通道选择；用户的自定义配置始终优先。

## 通道与地址

- Stable 构建使用 `app.byspace.cc.cd`，prerelease 构建使用 `app-beta.byspace.cc.cd`；选择集中在发布通道定义，不散落多处判断。
- Relay 默认在 stable App 的 origin 上：`app.byspace.cc.cd:443`，两个渠道共用同一个 relay 与同一个 Durable Object namespace。`relay.byspace.cc.cd` 已下线——它曾是同一 Worker 的第二个 hostname、同一个 namespace 的第二个入口，而配对 offer 本来就假设页面和它的 relay 同源。prerelease 的 relay 仍部署在 `app-beta.byspace.cc.cd`（独立 namespace，用于验证 relay 改动），但不再是默认。
- 用户自定义 App/Relay endpoint 覆盖通道默认值。

## 安全边界

- Hosted HTTPS 页面在创建 WebSocket 前拒绝非 loopback 的 `ws://` Direct endpoint，并给出可行动提示；loopback、`wss://`、Relay 与同源 Web UI 不受影响。
- 上一条让**浏览器装成 PWA 与局域网明文直连互斥**：service worker 只在安全上下文里注册，而从 HTTPS 源加载的浏览器页面又连不了 `ws://192.168.x.x`。Wails v3 Android 客户端（侧载 APK，运行于本地 `https://wails.localhost` 并开启 `MIXED_CONTENT_ALWAYS_ALLOW` 与 `usesCleartextTraffic`）不受此限制，可直接连接局域网/Tailscale 明文 `ws://` daemon。影响到的能力见 [通知送达](notifications.md) 与 [notes/019](../notes/019-wails-v3-in-process-assets-and-android-mixed-content.md)。
- 配对 offer 携带可读 hostname，新 Host 首次保存时默认采用；缺少 hostname 的旧 offer 与旧客户端保持双向兼容。
- **局域网监听以密码为前提**：daemon 默认只监听 loopback；在设置里放开局域网（`daemon.listen` 改写为 `0.0.0.0:<port>`）前必须先设置访问密码，服务端强制此不变量，清密码同理被拒绝。密码只在 patch 时以明文进入，落盘与回读只有 bcrypt 哈希与 `passwordSet` 视图字段。网络与密码改动统一重启生效；`BYSPACE_LISTEN` / `BYSPACE_PASSWORD` 启动 override 存在时，对应设置被拒而非静默失效。能力声明为 `features.daemonNetworkConfig`。监听地址解析优先级为 显式 `--addr` > `BYSPACE_LISTEN` > 持久化 `daemon.listen` > 默认 `127.0.0.1:6777`；显式 flag 会被 `daemon install-service` 烤进 unit，旧安装需要重装才跟随设置。

## Relay 会话生命周期

- daemon 的 `server-control` 连接与 ping 常驻，保留 remote client 的接入口；这不代表业务数据正在上传。每个 remote client 对应独立的 server-data socket，零 remote client 时没有 data socket，最后一个 client 离开后 relay 关闭对应 socket，后续 agent、terminal 与 workspace 业务帧不再进入 relay。
- 离线期间不缓存并重放所有 delta。remote 重连后从现有快照、agent timeline seq/cursor 与 terminal backlog 恢复；本地和 LAN 客户端不依赖 relay 生命周期。
- 不按 App 页面 presence 设置全局发送开关。daemon 发起的 tunnel 也是 relay client，没有 App 页面时仍需转发；发送边界是每个 remote client 的 data socket。请求计量约束见 [notes/018](../notes/018-durable-object-billing-and-hibernation.md)。

## Daemon 隧道（远端端口的本地转发）

- **形态**：一台 daemon 经 relay 连另一台（E2EE），把对端一个端口的 TCP 服务呈现为本机某个地址上的端口；每个本地 TCP 流独立隧道。与 workspace/agent 零耦合，裸 daemon 可用。哪一台监听、哪一台出端口可以任选，不限于「本机转发远端」。
- **身份与授权**：发起端用自己的 daemon 固定密钥握手，目标端能由此认出它。两端都用固定密钥时每次会话的共享密钥相同，所以目标端每次会话发一个随机数，发起端在加密通道里回传，回传之前的帧一律丢弃，挡住跨会话重放。通过之后，目标端查本地的 `tunnel-grants.json`：哪把公钥可以访问哪个端口。这份授权不进同步数据，只能由出示过该 daemon 密码的客户端写入。出示过密码的连接（机主本人）不受授权限制，只受端口白名单约束。
- **规则**：建一条隧道时，客户端必须连着两端，当场写两处——目标端写授权，源端写转发。转发规则进同步副本，只用于在各设备上展示，不代表权限。`tunnels.json` 不再保存对端密码，编辑旧条目时会丢掉以前存的密码。
- **实验性，默认关闭（063）**：`daemon.tunnel.enabled` 缺省 false。未开启时 D2 拒绝一切 `tunnel.open`、D1 拒绝 `tunnel.create`；app `/tunnels` 显示 Enable 卡（开启走 config patch 热生效，D1 侧热启停已配置的 peers）。开启后的界面带 Experimental 标注。
- **启用门槛（服务端强制）**：目标端设了密码；目标端 `daemon.tunnel.allowedPorts` 白名单外的端口拒绝转发。配置经 config patch 通道热生效。
- **relay 归属**：隧道走目标端 pairing offer 携带的 `relayPublicEndpoint`（自托管 relay 用户的流量天然走自己的 relay，与 app 客户端同一条信任模型——E2EE 不依赖 relay）。
- **生命周期**：daemon 级常驻（`tunnels.json` 持久化，boot 恢复），内嵌客户端复用 DaemonClient 重连；app 不在线时隧道照常工作。
- **交互面**：app 的 `/tunnels` 独立路由（类比 Schedules）。新建时两个下拉框分别选端口所在的主机和监听的主机，监听地址默认 `127.0.0.1`，填 `0.0.0.0` 或 `::` 时提示该端口对网络开放。列表里每条规则分两端显示状态。入口是侧栏 BySpace 菜单里的 Tunnels 行（内置导航项，可在 Appearance 里排序/隐藏），命令中心保留同名动作。
- **流式原样透传与闪断无损续传**：已连接状态下两端都是 `socket.on("data") → 帧` 与 `socket.write(payload)` 直通，不聚合、不缓冲，也没有额外的等待窗口——SSE / chunked 这类逐块响应在客户端按产生节奏到达（`tunnel-streaming.e2e.test.ts` 用到达时间跨度钉住）。当底层 WebSocket 发生短时闪断时，依托服务端 Session 重连宽限期，两端暂停 TCP 读取（施加背压）并有界缓存途中帧，重连恢复时按序续传并对账存活流；重连窗口内新到达的本地连接挂起等待重连而非立即拒绝，超出宽限期则主动销毁本地流避免死挂。
- **托管 relay 的计量不能切断 Tunnel。** 请求计数与日阈值只产生告警，不拒绝握手、不关闭在线 socket，也不设帧率上限。合法并发没有可假定的静态 FPS 上限，硬关会把完整响应截成半截；成本护栏是 hibernation、agent 合帧和零 remote client 时关闭 data socket。
- **同一 socket 的帧必须按到达顺序转发，且转发前不能有 await。** Durable Object 并发派发 `webSocketMessage` 事件，handler 里任何一次挂起（一次 DO 子请求就够了）都会让后到的帧先被写出去；实测连发 300 帧有 291 帧错位，本地 workerd 串行派发所以本地测试永远看不到。计量因此只在握手做。守卫是 `go run ./workers/relay/probe -url <ws endpoint>`，对已部署的构建跑；它不能在本地跑出结论，这也是这条约束唯一可靠的验证方式。
- **半关闭与恢复需要双端新版。** `CloseWrite` 只结束请求方向，不能销毁尚未完成的响应；重连在原 stream ID 上恢复，保留有界途中帧并施加背压，不另起目标 TCP。旧 Target 不支持恢复，混合版本必须显式失败，不能承诺无损。恢复的重放必须**先于**重连后的新数据上线：新帧抢在重放帧前面时，对端游标看到空洞，只能丢弃。
- **范围边界**：手动互导 offer，无 relay 成员网络；不做 agent 工具跨机与反向隧道；不尝试 NAT 打洞，流量一律经 relay（owner 网络环境下打洞从未成功，架构取向是稳定优先于延迟；自托管 relay 就近部署是延迟正解，实测见 [notes/008](../notes/008-tunnel-performance-and-relay-vs-p2p.md)）。

## 主机列表同步

- **同步链只有 daemon。** 每台 daemon 在自己的 home 里存一份完整副本（`host-sync.json`），手机和浏览器不是成员。它们连上任意一台 daemon，用 `hosts.sync.exchange` 拿整份数据，本地只留缓存。清掉缓存只会丢掉这台设备记住的密码和见过的主机公钥，链上不留任何东西。
- **同一台机器的前端共用本机 daemon 的那份。** 桌面客户端和浏览器打开的本机页面，在本机 daemon 连上后都改读写它的副本，不再各存各的。判断本机沿用回环地址。daemon 不支持同步时，前端继续用自己的本地存储。
- **同步的都是公开信息。** 主机的 serverId、公钥、地址、标签，链上的成员，以及隧道规则的展示信息。副本拒绝带密码或 token 的记录。每台主机的密码只存在使用它的那台设备上，每台单独记。
- **合并按记录逐条进行。** 每条记录带逻辑版本号和最后修改它的 daemon。版本号高的胜出，相同比 daemon ID。删除留标记，主机和规则的标记保留 90 天，成员的标记永久保留，所以被移出的 daemon 不能被一台没赶上这次移除的副本带回来。整份上限 256 KB，超出时这次交换整个不生效。
- **主机公钥固定。** 设备第一次见到某台主机的公钥就记住。之后公钥变了，连接被拦下，要用户确认才放行。这是为了防止同步数据里的地址被改，让用户把密码交给假主机。
- **加入和移除。** `byspace devices add --public-key <key> <serverId>` 把一台 daemon 加入链，`byspace devices remove <serverId>` 移除。界面在主机设置页的 Devices 区，只能把这台设备已经连上的主机加入，因为连得上就说明两边的密码都出示过。
- **经 relay 的连接要在加密通道里证明密码。** relay 的数据连接是 daemon 自己拨出去的，不经过 HTTP 层的密码检查。所以这类连接起步没有任何权限，第一条加密帧必须是密码，通过之前发 hello 或别的请求都会被断开。没设密码的 daemon 直接拒绝 relay 连接。客户端不再把密码放进发往 relay 的子协议或请求头，那些是明文，relay 看得到。本机回环和 SSH 不在此列。

## 托管部署

- **托管产物是一个 Go Worker，两个渠道。** `workers/relay` 编译成 wasm，stable 部署为 `byspace-relay-go`（`app.byspace.cc.cd` + `relay.byspace.cc.cd`），prerelease 部署为 `byspace-relay-go-beta`（`app-beta.byspace.cc.cd`）。原先 stable 跑 TypeScript 的 `packages/relay` 是 Go relay 未验证时的保守选择，现在已合并：同一场景下单个空闲连接保持 180 秒，Go 花 0.06 GB-s，TS 花 1.93 GB-s。TypeScript 的 Worker 适配层（`cloudflare-adapter.ts` / `cutover-proxy.ts` / `wrangler.toml`）已删除，`packages/relay` 只留 client 依赖的 E2EE 原语。Cloudflare 自定义域一个 hostname 只能路由到一个 Worker，所以两者不可能共用。各自从同一 origin 服务：`/` 静态 web 导出、`/docs/*` 与 `/changelog` 文档（`build:web` 链内由 markdown-it 渲染 `public-docs/` 与 `CHANGELOG.md`）、`/ws` `/health` 走 relay 逻辑（`run_worker_first` 保证不被 SPA 回落吞掉）。与自托管容器是同一形状、同一 relay 核心。`/download` 不设页面——无可直下产物（见 074）。
- **UI 与 relay 原子发布。** `deploy-app.yml` 在 web 发版时按渠道 `wrangler deploy` 一次部署两者；出问题 `wrangler rollback` 整体回退。发版流程外的紧急 relay 修复：stable `npm run deploy:hosted`，beta `npm run deploy:relay-go:beta`。
- **域名与 origin 稳定性。** cutover 保持域名不变（从 Pages 解绑再挂 Worker），已装 PWA、localStorage host 配置、`#offer` 配对链接全部不受影响。Workers 自定义域要求 hostname 无外部 DNS 记录——Pages 解绑不清理 DNS，迁移时必须先删 zone 里的遗留 CNAME。
- **`wrangler.toml` 的 account_id 曾长期是错的**（v0.10.0 写入的 ID 与真实账号不符，本机 deploy 从未成功过）——已修正。对「约定说手动部署、实际从未部署成功」这类漂移保持警惕。
- **beta 与 stable 是两个 Worker**（独立 DO 命名空间），不是同一 Worker 的两个 route。zijieapi.de5.net 时代的 byspace 子域已废弃，routes 已移除。
- **relay 的 socket 必须用 Durable Object 的 hibernation API 接收。** 这不是性能优化，是能不能在免费额度里活下去的前提：`acceptWebSocket` 收进来的连接空闲时对象被驱逐、不计费，而 `Upgrade` + 常驻读循环让对象在整个连接生命周期里保持唤醒、全程计费。同一账户实测差 4000 倍（TS 版 4.1 毫秒/请求，Go 版 16.2 秒/请求），后者几天就烧穿免费层每日额度。**任何一方改动 socket 接收方式前先读 [notes/018](../notes/018-durable-object-billing-and-hibernation.md)。** 守卫在 `scripts/relay-worker.test.mjs`。
- **额度的症状与 relay 故障不同。** 额度耗尽时所有 WebSocket 握手 500（浏览器侧 `code 1006`），但 `/health` 仍 200——它不碰 Durable Object。这种时候换 worker、换 serverId 都没用，是账户级、按日重置。
- **隧道经托管 relay 的成本是可算的，且远低于额度。** 实测 0.28 毫 GB-s/帧（含两跳 DO 消息）。按真实用量折算，历史峰值日（9,080 次 AI 调用）全走隧道也只占免费层额度 13%，常态 1–5%。折算方法、两个反直觉细节（按字节输入占 96% 但按帧数只占 5–13%；不要用看板的 token 总量估）见 [notes/018](../notes/018-durable-object-billing-and-hibernation.md)。

## 自托管部署

自托管的发布物是一个容器（`ghcr.io/bytetrue/byspace`）：web 静态资源与 relay 在同一镜像、同一端口（`https://host/` 与 `wss://host/ws`，TLS 反代下一张证书同时罩住两者）。daemon 不出独立镜像，通过安装脚本直接安装预编译单二进制（`curl -fsSL https://app.byspace.cc.cd/install.sh | sh` 或 Windows `irm https://app.byspace.cc.cd/install.ps1 | iex`）。agent 跑的是用户本机的项目工具链，自带 daemon 的容器会把「控制本机」误导成「部署一个服务」；确实想在容器里跑 daemon 的人装同一个二进制，见 `docs/docker.md`。

## 二进制直发与自更新

- **不走 npm，全部产物由 GitHub Releases 直接分发并强制校验 `SHA256SUMS`**。
- **安装脚本全平台行为统一**：`install.sh`（macOS / Linux / Termux）与 `install.ps1`（Windows）默认**只安装独立 CLI 二进制**（`byspace-cli-<os>-<arch>`）到 `~/.local/bin`；桌面与 Android 客户端常规从 GitHub Releases 下载安装包（`.dmg` / `.exe` / Linux 桌面二进制 / `.apk`），或向安装脚本显式传 `--app`。
- **Android 侧载签名固定**：APK 仅作直接侧载分发，使用仓库固定签名证书保证跨机器/CI 构建的新版 APK 可直接覆盖安装升级。
- **CLI 与客户端同源自更新**：`byspace update [check]` 与桌面客户端后台巡检共用 `internal/selfupdate`（支持 `--proxy` 与 `--mirror` 加速，哈希仍严格比对原始 `SHA256SUMS`）；桌面端在后台静默 stage 新版后通过托盘菜单一键重启切换或在退出时自动替换。

- **配对链接跟随 `app.baseUrl`**。自托管 origin 下 `byspace onboard --web-origin <origin>` 一次设好 `app.baseUrl` 与 `daemon.cors.allowedOrigins`，之后生成的配对链接指向该 origin。命令幂等，daemon 已在跑时走热更新。`--hostnames` 是 Host header 检查（DNS rebinding 防护），与 CORS 无关，两者不合并。
- **App 侧没有 relay 白名单。** relay 是每个 host 的连接属性，随 pairing offer 流入——认证材料（E2EE 公钥）只能这样传递。因此不提供手动添加 relay，也不在 host 设置里编辑 relay：首次部署与迁移是同一个漏斗，部署 compose → 打开自托管 web → 弹窗给出命令 → 粘贴配对链接。
- **默认 HTTP，TLS 可选。** 局域网明文直连可用，代价来自非安全上下文：terminal 剪贴板、Service Worker/PWA、Web Push 失效，密码明文过线。这与上文的「PWA 与局域网明文互斥」是同一条约束。
- **自托管 relay 必须在 TLS 反代后面。** 托管 web 是 HTTPS 页面，浏览器拒绝非 loopback 的裸 `ws://`（mixed content），所以「手机走官方 web + 自己的 relay」这条路线里 relay 一定要有证书。全自托管时同一个域名一张证书同时给 web 与 relay。
- **Relay 线协议冻结在 v1/v2 握手语义。** 旧 relay 镜像必须能服务新 app/daemon，因此 `/ws` 握手参数、错误文案、席位与关闭语义、帧类型都是契约的一部分，完整条款见 `docs/protocol-compatibility.md`。

## 历史证据

- [Epic 002 交付记录](../epics/002-x-retained-capabilities-delivery/spec.md)
- [Epic 2026-10-29：Wails v3 桌面端与 Android 客户端同构延伸及二进制直发](../epics/2026-10-29-x-wails-v3-desktop-and-android/spec.md)
