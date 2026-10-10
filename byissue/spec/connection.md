# 连接与发布通道

App 与 Relay 的地址按发布通道选择；用户的自定义配置始终优先。

## 通道与地址

- Stable 构建使用 `app.byspace.cc.cd`，prerelease 构建使用 `app-beta.byspace.cc.cd`；选择集中在发布通道定义，不散落多处判断。
- Stable 与 prerelease 使用同一个 Relay：`relay.byspace.cc.cd:443`，不保留 Beta Relay 兼容通道。
- 用户自定义 App/Relay endpoint 覆盖通道默认值。

## 安全边界

- Hosted HTTPS 页面在创建 WebSocket 前拒绝非 loopback 的 `ws://` Direct endpoint，并给出可行动提示；loopback、`wss://`、Relay 与同源 Web UI 不受影响。
- 上一条让**装成 PWA 与局域网明文直连互斥**：service worker 只在安全上下文里注册，而从 HTTPS 源加载的页面又连不了 `ws://192.168.x.x`。两者要同时成立，只能走 Relay、`wss://`，或给 daemon 配一张受信证书。原生 App 没有这个限制，它不是网页。影响到的能力见 [通知送达](notifications.md)。
- 配对 offer 携带可读 hostname，新 Host 首次保存时默认采用；缺少 hostname 的旧 offer 与旧客户端保持双向兼容。
- **局域网监听以密码为前提**：daemon 默认只监听 loopback；在设置里放开局域网（`daemon.listen` 改写为 `0.0.0.0:<port>`）前必须先设置访问密码，服务端强制此不变量，清密码同理被拒绝。密码只在 patch 时以明文进入，落盘与回读只有 bcrypt 哈希与 `passwordSet` 视图字段。网络与密码改动统一重启生效；`BYSPACE_LISTEN` / `BYSPACE_PASSWORD` 启动 override 存在时，对应设置被拒而非静默失效。能力声明为 `features.daemonNetworkConfig`。

## Daemon 隧道（远端端口的本地转发）

- **形态**：本机 daemon（D1）以配对客户端身份经 relay 连远端 daemon（D2，E2EE + bearer 密码双因子），把 D2 白名单端口的 TCP 服务呈现为本机 `127.0.0.1:<动态端口>`；每个本地 TCP 流独立隧道。与 workspace/agent 零耦合，裸 daemon 可用。
- **实验性，默认关闭（063）**：`daemon.tunnel.enabled` 缺省 false。未开启时 D2 拒绝一切 `tunnel.open`、D1 拒绝 `tunnel.create`；app `/tunnels` 显示 Enable 卡（开启走 config patch 热生效，D1 侧热启停已配置的 peers）。开启后的界面带 Experimental 标注。
- **启用门槛（服务端强制）**：两端 daemon 都设密码；D2 侧 `daemon.tunnel.allowedPorts` 白名单外的端口拒绝转发。配置经 config patch 通道热生效。
- **relay 归属**：隧道走 D2 pairing offer 携带的 `relayPublicEndpoint`（自托管 relay 用户的流量天然走自己的 relay，与 app 客户端同一条信任模型——E2EE 不依赖 relay）。
- **生命周期**：daemon 级常驻（`tunnels.json` 持久化，boot 恢复），内嵌客户端复用 DaemonClient 重连；app 不在线时隧道照常工作。
- **交互面**：app 的 `/tunnels` 独立路由（类比 Schedules）——添加隧道（粘贴 D2 pairing offer + 密码 + 端口）、outbound/inbound 列表、白名单 GUI。入口仅本机（回环）daemon 在场时显示。
- **范围边界**：手动互导 offer，无 relay 成员网络；不做 agent 工具跨机与反向隧道。
- **入口**：BySpace 菜单（侧栏第一行）新增 Tunnels 行，与 Schedules 同级；命令中心保留同名动作。

## 托管部署

- **托管产物是一个 Worker。** 自 073 起，`app.byspace.cc.cd`（stable）、`app-beta.byspace.cc.cd`（prerelease）与 `relay.byspace.cc.cd` 由 `packages/relay` 的同一个 Worker（`byspace-relay` / `byspace-relay-beta`）从同一 origin 服务：`/` 静态 web 导出、`/docs/*` 与 `/changelog` 文档（`build:web` 链内由 markdown-it 渲染 `public-docs/` 与 `CHANGELOG.md`）、`/ws` `/health` 走 relay 逻辑（`run_worker_first` 保证不被 SPA 回落吞掉）。与自托管容器是同一形状、同一 relay 核心（runtime-agnostic session core，Node/CF 两个 adapter，parity 由测试钉住）。`/download` 不设页面——无可直下产物（见 074）。
- **UI 与 relay 原子发布。** `deploy-app.yml` 在 web 发版时 `wrangler deploy` 一次部署两者；出问题 `wrangler rollback` 整体回退。发版流程外的紧急 relay 修复可手动 `npm run deploy:hosted`。
- **域名与 origin 稳定性。** cutover 保持域名不变（从 Pages 解绑再挂 Worker），已装 PWA、localStorage host 配置、`#offer` 配对链接全部不受影响。Workers 自定义域要求 hostname 无外部 DNS 记录——Pages 解绑不清理 DNS，迁移时必须先删 zone 里的遗留 CNAME。
- **`wrangler.toml` 的 account_id 曾长期是错的**（v0.10.0 写入的 ID 与真实账号不符，本机 deploy 从未成功过）——已修正。对「约定说手动部署、实际从未部署成功」这类漂移保持警惕。
- **beta 与 stable 是两个 Worker**（独立 DO 命名空间），不是同一 Worker 的两个 route。zijieapi.de5.net 时代的 byspace 子域已废弃，routes 已移除。

## 自托管部署

自托管的发布物是一个容器（`ghcr.io/bytetrue/byspace`）：web 静态资源与 relay 在同一镜像、同一端口（`https://host/` 与 `wss://host/ws`，TLS 反代下一张证书同时罩住两者）。daemon 不出镜像，只从 npm 安装 `@bytetrue/byspace`。agent 跑的是用户本机的项目工具链，自带 daemon 的容器会把「控制本机」误导成「部署一个服务」；确实想在容器里跑 daemon 的人装同一个 npm 包，见 `docs/docker.md`。

- **配对链接跟随 `app.baseUrl`**。自托管 origin 下 `byspace onboard --web-origin <origin>` 一次设好 `app.baseUrl` 与 `daemon.cors.allowedOrigins`，之后生成的配对链接指向该 origin。命令幂等，daemon 已在跑时走热更新。`--hostnames` 是 Host header 检查（DNS rebinding 防护），与 CORS 无关，两者不合并。
- **App 侧没有 relay 白名单。** relay 是每个 host 的连接属性，随 pairing offer 流入——认证材料（E2EE 公钥）只能这样传递。因此不提供手动添加 relay，也不在 host 设置里编辑 relay：首次部署与迁移是同一个漏斗，部署 compose → 打开自托管 web → 弹窗给出命令 → 粘贴配对链接。
- **默认 HTTP，TLS 可选。** 局域网明文直连可用，代价来自非安全上下文：terminal 剪贴板、Service Worker/PWA、Web Push 失效，密码明文过线。这与上文的「PWA 与局域网明文互斥」是同一条约束。
- **自托管 relay 必须在 TLS 反代后面。** 托管 web 是 HTTPS 页面，浏览器拒绝非 loopback 的裸 `ws://`（mixed content），所以「手机走官方 web + 自己的 relay」这条路线里 relay 一定要有证书。全自托管时同一个域名一张证书同时给 web 与 relay。
- **Relay 线协议冻结在 v1/v2 握手语义。** 旧 relay 镜像必须能服务新 app/daemon，因此 `/ws` 握手参数、错误文案、席位与关闭语义、帧类型都是契约的一部分，完整条款见 `docs/protocol-compatibility.md`。

## 历史证据

- [Epic 002 交付记录](../epics/002-x-retained-capabilities-delivery/spec.md)
