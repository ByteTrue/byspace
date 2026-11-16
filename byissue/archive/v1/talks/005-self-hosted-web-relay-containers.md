# 自托管发布形态：web/relay 容器化与 daemon 镜像退役

> **写法：** 按讨论推进顺序，每节 = 一轮推进或一次关键纠正。
> 起点是「web 能不能部署在容器上、daemon 留本机」，收在「一个 compose、web+relay 两容器、daemon 只走 npm、引导弹窗承接自托管交互面」。

---

## 开场：受 multica 启发的容器定位问题

Owner 起意（2026-09-30）：从 multica 项目收到启发，或许架构可以调整为 web 部署在容器上、daemon 跑在本机。印象里我们发布的 docker 容器是带 daemon 的？

查现状：`ghcr.io/bytetrue/byspace`（`docker/base/Dockerfile`）确实是 daemon+内置 web UI 一容器，同源自服务；镜像内只有 node22+git 等基础包，无 python/rust/go/docker/pnpm。装 agent CLI 容易（npm i -g），但 agent 跑项目命令时工具链缺失。「容器是一台机器，不是你的本机」——适合 homelab 无头盒，不适合控制本机已有环境。

## 第一轮：四层 web 形态并存的判定

当时已有多层 web 并存：daemon 内置 UI（同源）、托管 Pages（纯静态，`app.byspace.cc.cd`）、自建容器（新提案第三形态）。我对提案的判定：**成立且便宜**。唯一要写代码的是 Node 版 relay；web 容器近乎白送；daemon 侧接线全是现成 config。

抛出三问：daemon 镜像去留 / compose 的 TLS 终止 / relay wire 协议兼容契约。

## 第二轮：Owner 三连回应，方案定型

Owner（2026-09-30）：

1. **daemon 镜像不保留**——「daemon 就是一个 npm 包，如果真的有用户需要在 docker 里使用 daemon，正确的姿势是安装这个 npm 包而不是部署这个容器。留这个容器只会存在误导」。
2. **质疑 HTTPS 必要性**——「如果是局域网场景，用户直接打开主机的 ip+端口访问 web，然后链接 daemon，为什么一定要 https？」
3. **质疑 relay 更新担忧**——「relay 装了就不更新？relay 也是一个正常的服务啊，那肯定就和正常的 web 服务一样更新」。

我核查后逐条收敛：

- **镜像退役成立**。npm 包 `@bytetrue/byspace`（唯一发布包，docs/release.md:15；`byspace`/`@bytetrue/cli` 是内部 workspace 名）本来就是唯一正确分发形态。执行面：删 `docker/base/`、`Dockerfile.agents.example`、`docker-compose.example.yml`；`docker.yml` 改发 web/relay 两镜像；重写 `README.md:77-90`、`docs/docker.md`、`public-docs/docker.md`（核心内容换成 FROM node:22 + npm install -g @bytetrue/byspace 的 10 行示例）；`SECURITY.md:57` 非 root 描述要改；**修订 025-D6**（原「Docker 保留」→「daemon 不出镜像，npm 唯一分发」）。
- **HTTPS 收回「承重墙」说法**。机制上 Owner 对：mixed content 只约束 HTTPS 页面；`http://192.168.1.10` 的页面连 `ws://daemon:6777` 完全合法，核心功能不缺。但 secure-context 退化真实存在：`navigator.clipboard` 未定义 → terminal 复制/粘贴图片静默失效（`terminal-emulator-runtime.ts:381,431-444` 可选链降级）；Service Worker 不注册 → 装不了 PWA、无离线；Web Push 不可用 → 无通知（`web-subscription.ts`）。结论：**compose 默认 HTTP，TLS 可选 profile；文档给 HTTP 代价表**（terminal 剪贴板/PWA/推送三项 + 密码明文过线）。与 spec/connection.md 已有安全边界条款一致（HTTPS 页面拒非回环 ws://；PWA 与 LAN 明文互斥）。
- **relay 兼容担忧收窄成一条**：v1/v2 握手语义冻结，写进 `docs/protocol-compatibility.md`。E2EE 让 relay 表面积只剩握手+转发，功能迭代基本不动 relay。更新责任归用户，同普通自托管服务。

## 第三轮：web 交互面补齐（A 首进指引 / B relay 管理）

Owner 提出两块配套交互面。我先摆正一个事实模型：**「relay 白名单」不在 web 侧，在 daemon 侧**。默认配置只有官方地址的出处是 `packages/server/src/server/persisted-config.ts:359-372`（`daemon.cors.allowedOrigins: ["https://app.byspace.cc.cd"]`、`app.baseUrl` 同值、`daemon.relay.enabled: false`）。App 侧没有全局 relay 列表概念——relay 是每个 host 的 connection 属性（`host-connection.ts:53` `HostConnection` union），随 pairing offer 流入（`pair-link-modal.tsx:141-143`），手动填 endpoint+serverId 凑不齐认证材料（E2EE 公钥），手抄公钥不现实。所以 add-host-modal 保持三入口（直连/SSH/粘贴链接），**不需要**新增「手动添加 relay」。

**A. 首进指引（welcome screen）**：Owner 拍板「没问题」。现状 welcome 只有四个 action（扫码/直连/SSH/粘贴链接），无任何「装 daemon」指引。自托管用户配对前要在 daemon 侧配三件事：`app.baseUrl`（pairing 链接指向自托管 web）、`daemon.cors.allowedOrigins`（websocket origin 检查放行，`websocket-server.ts:795-812`）、可选 `daemon.relay.*`。三件今天都没有 CLI 参数——`onboard --hostnames` 是 Host header 检查（DNS rebinding 防护），与 CORS 是两码事。**新增 `onboard --web-origin <url>`**：一条命令设 `app.baseUrl` + `cors.allowedOrigins`，与 `--relay` 组合三件一步到位。

**B. relay 管理（host settings）**：Owner 推演后砍掉——「即使是迁移，正常流程也是：我有正在使用的 daemon A 和官方 Web A 和 Relay A，突然想自托管了，部署了 Web B 和 Relay B，这时正常交互应该是：打开 Web B，点击链接的弹窗变大，里面放好指引，可切换 tab 区分 mac/linux 和 win，用户复制指引里的命令，完成安装 daemon，给白名单添加 host，启动，生成配对链接」。即**迁移和首次部署是同一个漏斗**——daemon 侧三件配置反正都得在机器上重来，web 不需要任何「编辑 relay」界面，引导弹窗本身就是迁移入口。换引擎问题（改 relay endpoint 时当前连接正在走该 relay，元数据同步/重连/回退）整个消失。

## 落定的形态

| 层             | 落点                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------- |
| 发布物         | 一个 compose：web 容器（nginx + 静态产物）+ relay 容器（Node relay，可选启用）                      |
| daemon         | npm 包唯一分发（`@bytetrue/byspace`），镜像退役                                                     |
| TLS            | compose 默认 HTTP；可选 profile；文档写 HTTP 代价表（clipboard/PWA/push/密码明文）                  |
| web 首进       | 引导式连接弹窗：平台 tab（mac/linux \| windows）、步骤化可复制命令、尾部粘贴框闭环                  |
| 引导命令       | `byspace onboard --web-origin <当前origin，预填> [--relay <地址>]`，幂等，已在跑的 daemon 走 reload |
| relay 地址来源 | 弹窗里可选输入框，填一次 localStorage 记住（方案 a）；web 容器不做模板注入（方案 b 否决）           |
| 协议契约       | relay v1/v2 握手语义冻结条款写入 `docs/protocol-compatibility.md`                                   |

## 三个已核实的实现要点

1. **relay 地址预填逻辑**：弹窗按 `window.location.host` 判断——托管 origin（`app.byspace.cc.cd` / `app-beta.byspace.cc.cd`，`packages/protocol/src/release-channel.ts:3-15`）显示简版（装 daemon → pair），自托管 origin 显示完整版。
2. **平台 tab 差异比想象小**：npm 命令三平台一致，差异只剩 shell 语法与路径。tab 做成「同一组命令、不同 shell 变体高亮」，不维护两套文案。
3. **幂等迁移**：onboard 检测 daemon 在跑（`onboard.ts:209` `ensureDaemonStarted`）；`daemon reload` 对 `app.baseUrl` 已支持（`daemon/reload.test.ts:16` `overrideControlledPaths: ["app.baseUrl"]`）；cors/relay 路径是否可热 reload 待实现时确认，不行就带 restart。

## 关键事实存档（支撑后续 issue 执行）

- **默认配置出处**：`packages/server/src/server/persisted-config.ts:359-372`。CORS 解析链：`config.ts:400-413` `resolveCorsAllowedOrigins`（persisted + `BYSPACE_CORS_ORIGINS` env 合并、hosted URL 重定向到本通道）；`bootstrap.ts:734-752` fixed origins（`byspace://app` + tcp 的 localhost 变体）与热更新（`daemonConfigStore.onFieldChange("cors.allowedOrigins")`）。
- **websocket origin 检查**：`websocket-server.ts:784-812` `verifyWsUpgrade`——hostnames 检查（DNS rebinding 防护）先于 origin 检查；origin 通过条件 = 无 origin / 白名单含 `*` / 精确匹配 / sameOrigin。
- **relay 线协议**：`packages/protocol/src/daemon-endpoints.ts:185-205` `buildRelayWebSocketUrl` → `${ws|wss}://${host}:${port}/ws?serverId&role&v[&connectionId]`；CF 侧版本协商 `cloudflare-adapter.ts:25-32`（LEGACY="1"/CURRENT="2"，缺省回落 v1）。
- **Node relay 依据**：`packages/relay/src/` 无 Node 入口（index.ts 只导出 crypto/encrypted-channel），但 ws 已是运行时依赖；relay 包已进 npm pack 管线（docker/base/Dockerfile 六个 workspace 之一）。
- **web 容器依据**：`packages/app/dist` 纯静态（wrangler pages deploy dist），`/schemas/*.json` 也在 dist；nginx 即可服务。
- **onboard 现有 flags**：`--listen` `--port` `--home` `--relay/--no-relay` `--no-mcp` `--hostnames`（DNS rebinding 防护，非 CORS）`--timeout`（`onboard.ts:189-200`）。
- **`onboard --relay` 现状**：`pair.ts:100` offer 携带 `appBaseUrl: config.appBaseUrl`——`--web-origin` 设了 `app.baseUrl` 后 pairing 链接自动指向自托管 web，无需额外接线。

## 顺带修正

- 公开包名是 `@bytetrue/byspace`（docs/release.md:15「the only published package」；README.md:65 `npm install -g @bytetrue/byspace@beta`）。根 package.json `"name": "byspace"` 与 `@bytetrue/cli` 均为内部 workspace 名，不对外发布。

## 遗留待实现时确认（不阻塞落盘）

- cors / relay 路径在 `daemon reload` 的热更新支持情况（app.baseUrl 已确认支持）。
- Node relay e2e（现有 e2e 起 wrangler dev，Node 版需新 e2e；可参考 `dist-handshake-parity.test.ts` 先例）。
- compose TLS profile 的具体形态（caddy 或 nginx TLS），随实现定。
