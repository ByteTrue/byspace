---
kind: issue
title: "自托管发布形态：web/relay 容器、Node relay、daemon 镜像退役与引导弹窗"
type: feature
status: closed
created: 2026-09-30
closed: 2026-10-01
---

<!-- 读者：跨会话接手的人。目标与范围 · 根因证据 · 现状怎么工作 · 影响面 · 方案 · 验证 · 关闭回写 -->

# 自托管发布形态：web/relay 容器、Node relay、daemon 镜像退役与引导弹窗

## 为什么做

用户主力开发环境不会跑在 BySpace 容器里（agent 需要的项目工具链在用户本机）；带 daemon 的容器镜像暗示「部署一个服务」的心智模型，误导大于便利。daemon 的正确分发是 npm 包 `@bytetrue/byspace`。自托管的正确形态：一个 compose、两个容器——静态 web（nginx + dist）+ 可选自建 relay（Node 实现）。

讨论全程见 [talks/005](../talks/005-self-hosted-web-relay-containers.md)，交互面与协议契约均已在彼处拍板。本 issue 是执行清单，按批次推进。

## 做成以后是什么样

- `ghcr.io/bytetrue/byspace`（daemon+web 合体镜像）退役；新发布 `byspace-web` 与 `byspace-relay` 两镜像 + 一个 compose。
- 自托管用户：部署 compose → 打开 Web B → welcome 弹窗（平台 tab、步骤化命令）→ 复制 `byspace onboard --web-origin <origin> [--relay <addr>]` → daemon 生成配对链接 → 粘贴回弹窗闭环。
- 迁移用户（已有 daemon A + 官方 Web A/Relay A）：同一漏斗——部署 Web B/Relay B → 打开 Web B → 同一弹窗 → onboard 命令幂等改写 daemon 配置 → 重新配对。
- relay 线协议 v1/v2 握手语义冻结，写入 protocol-compatibility 契约。

## 影响面与方案（按批次）

### 批次 1 · Node relay（唯一的真代码）

- `packages/relay/src/node-adapter.ts`（新）：`/health`、`/ws` upgrade、按 serverId 的内存 session 注册表、role 标签 socket（server-control / server:{connectionId} / client / client:{connectionId}）、双向转发。v1/v2 语义与 `cloudflare-adapter.ts` 对齐（缺省 v1、`normalizeRelayProtocolVersion` 校验）。hibernation 是 CF 成本优化，Node 不需要；单副本即可。
- e2e：现有 `packages/relay/src/e2e.test.ts` 起 wrangler dev，Node 版需新 e2e（可仿 `dist-handshake-parity.test.ts` 做 parity）。
- 依据：`ws` 已是运行时依赖；relay 包已在 npm pack 管线（docker/base/Dockerfile 六 workspace 之一，镜像退役后此管线复用于 relay 镜像）。

### 批次 2 · 镜像与 compose

- 删 `docker/base/`（Dockerfile + rootfs entrypoint）、`docker/Dockerfile.agents.example`、`docker/docker-compose.example.yml`。
- 新增 `docker/web.Dockerfile`（nginx + packages/app/dist，含 `/schemas/*.json`）与 `docker/relay.Dockerfile`（node:22-slim + relay 包）。
- compose：web（默认）+ relay（可选，profile 或注释启用）；默认 HTTP，TLS 可选 profile（具体形态随实现定）。
- `.github/workflows/docker.yml` 改造：不再发 daemon 合体镜像；发 `byspace-web` / `byspace-relay`，多架构沿用（amd64/arm64），tag 策略沿用（stable 全 tag、beta 精确 tag）。

### 批次 3 · 文档与契约

- 重写 `README.md:77-90`（Docker 段）、`docs/docker.md`、`public-docs/docker.md`：自托管 compose 为主线；「想在容器里跑 daemon」给出 `FROM node:22` + `npm install -g @bytetrue/byspace` 的 10 行示例。
- `docs/docker.md` 写 HTTP 代价表：terminal 剪贴板（`terminal-emulator-runtime.ts:381,431-444` 静默降级）、PWA/SW（安全上下文才注册）、Web Push、密码明文过线。
- `SECURITY.md:57` 非 root 描述改写（official image 不复存在）。
- `docs/protocol-compatibility.md` 加 relay v1/v2 握手语义冻结条款（旧 relay 镜像必须能服务新 app/daemon）。
- **修订 025-D6**：原「Docker 保留（daemon+Web 镜像）」→「daemon 不出镜像，npm 包唯一分发；容器发布物为 web/relay 两镜像」。025 仍 open，正好作为记录载体。

### 批次 4 · onboard `--web-origin`（daemon 侧命令面）

- `packages/cli/src/commands/onboard.ts` 新增 `--web-origin <url>`：一条命令设 `app.baseUrl` + `daemon.cors.allowedOrigins`，与 `--relay` 组合覆盖自托管三件配置。
- 幂等：daemon 已在跑时走 reload（`ensureDaemonStarted` `onboard.ts:209` 已有检测；`daemon reload` 对 `app.baseUrl` 已支持，见 `daemon/reload.test.ts:16`）；cors/relay 热 reload 支持情况待实现时确认，不支持则带 restart。
- 语义边界：`--hostnames` 是 Host header 检查（DNS rebinding 防护），与 CORS 无关，不合并。

### 批次 5 · 引导式连接弹窗（web 交互面）

- welcome screen 加引导弹窗：大弹窗、平台 tab（mac/linux | windows，差异仅 shell 语法与路径，同一组命令不同变体高亮）、步骤化可复制命令（安装 → `onboard --web-origin <当前origin，预填> [--relay <地址>]` → 生成配对链接）、尾部粘贴框贴回闭环（复用 PairLinkModal 解析）。
- 弹窗按 `window.location.host` 自适应：托管 origin（`app.byspace.cc.cd` / `app-beta.byspace.cc.cd`）显示简版；自托管 origin 显示完整版。
- relay 地址：可选输入框，localStorage 记住（方案 a）；web 容器不做模板注入。
- add-host-modal 保持三入口不变（直连/SSH/粘贴链接）；**不做**「手动添加 relay」与 host-settings 的 relay 编辑（见 talk 的 B 砍除理由）。

## 制度记忆影响

- `byissue/spec/connection.md`：自托管发布形态成型后补「自托管部署」节（web/relay 容器、onboard --web-origin、HTTP 代价），与既有「通道与地址」「安全边界」并列。
- 025-D6 修订见批次 3。
- talk 004 已存在，本 issue 不重复其讨论过程。

## 验证口径

- Node relay：新 e2e 覆盖 v1/v2 握手、control/data socket 分离转发、serverId 隔离；与 CF adapter 行为 parity。
- compose：本地 `docker compose up` 起两容器，web 可开、relay `/health` 通。
- onboard：`--web-origin` 后 config 落盘正确、pairing 链接指向自托管 origin、websocket origin 检查放行（`verifyWsUpgrade` 路径）。
- 弹窗：本地 dev 双 origin（8081 直连 / 自托管模拟）实测平台 tab、预填 origin、粘贴闭环；i18n 9 locale 全加 key。
- 回归：typecheck / lint / format；涉及 e2e spec 的批次跑对应 spec。

## 执行记录

### 2026-09-30 · 自托管成功路径 e2e（引导弹窗粘贴真实 offer）

批次 5 的弹窗当时只做过 Playwright 视觉冒烟（人工看截图），成功路径没有自动化证据。补上两个文件：

- `packages/app/e2e/support/helpers/local-node-relay.ts`（新）—— 起本地 Node relay：`startLocalNodeRelay()` spawn `node packages/relay/dist/node-main.js`（`BYSPACE_RELAY_HOST=127.0.0.1`、`BYSPACE_RELAY_PORT=<空闲端口>`），60s/250ms 健康探针，失败时把进程最后 40 块输出拼进错误。仿 `local-wrangler-relay.ts` 的壳，但跑的是本 issue 的交付物而不是 CF adapter。
- `packages/app/e2e/browser/setup-guide-pairing.spec.ts`（新，browser project）—— Node relay + `startIsolatedHostDaemon(..., {mutableRelay:{enabled:true, endpoint: relay.endpoint}})` + `connectDaemonClient(...).getDaemonPairingOffer()` 拿真实 offer → 清掉默认 host registry 种子（写 `@byspace:e2e-disable-default-seed-once`）→ `/welcome` → 开弹窗 → 断言 onboard 命令含 `--web-origin <metro origin>` → 粘贴 offer → Pair → 断言 `sidebar-settings` 可见且 host row 显示 relay endpoint。

**这条 spec 就是帧类型缺陷的发现者**（见上一条执行记录）。修好后 4.4s 通过。它同时验证了三件此前只有人工证据的事：自托管 origin 走完整弹窗分支、onboard 命令预填当前 origin、真实 relay 链路（不是直连）能配对成功。

### 2026-09-30 · Node relay 帧类型缺陷（self-hosted e2e 发现并修复）

**怎么发现的。** 为补「弹窗粘贴真实 offer → Pair → 连上 host」这条成功路径的证据，新写 `packages/app/e2e/browser/setup-guide-pairing.spec.ts`（真 daemon + 真 Node relay + 真实 offer）。首轮失败：弹窗停在配对链接输入处，行内红字 `Server disconnected`。

**根因。** `Server disconnected` 在 app/client 源码里不存在，全仓只有 relay 的 close 文案（`packages/relay/src/node-adapter.ts:298`、`cloudflare-adapter.ts:553`）。逐层往下：daemon 日志记 `relay_e2ee_handshake_failed` + `Invalid hello message (receivedType=undefined, hasKey=false, preview="<binary frame>")`（`packages/server/src/server/relay-transport.ts:495` → `packages/relay/src/encrypted-channel.ts:248`）→ daemon 关数据 socket `1011 "E2EE handshake failed"` → relay 的 `handleV2Close` 对浏览器执行 `clientWs.close(1012, "Server disconnected")` → 弹窗把 close reason 直接显示出来。

**缺陷本体。** 旧 `normalizeIncoming(message: WebSocket.RawData)` 把所有非 string 的 RawData 强转 `ArrayBuffer`。`ws` 库对**文本帧**同样交付 `Buffer`（`isBinary=false`），而 Cloudflare runtime 对文本帧交付真正的 string——两条链路因此分叉：Node relay 把 client 的明文 JSON hello 以二进制帧转给了 daemon，E2EE 握手看到的是 binary preview，直接拒绝。同一处的 `if (typeof message === "string") handleControlKeepalive(...)` 分支在 Node 下也是死代码（buffer 永不是 string），一个 bug 两个症状。

验证手法：最小 ws 探针（`/tmp/ws-text-probe.mts`）打印服务端收到的 `typeof / isBinary / ctor`，实测文本帧 `object / false / Buffer`，与 CF 的 string 行为对照即定位。

**修复。** `normalizeIncoming(message, isBinary)` 按 `isBinary` 分流：非二进制 → `Buffer.concat(...).toString("utf8")`（或 `Buffer.from(ArrayBuffer).toString("utf8")`）；二进制 → 新的 `toArrayBuffer(buffer)`。`attachV1` / `attachV2` 的 message 监听都接住第二参数，进入时算一次 `payload`，四处转发/buffer 点（v1 转发、v2 control keepalive、v2 bufferFrame、v2 两个方向的 data）统一使用它。

**回归测试。** `packages/relay/src/node-relay-e2e.test.ts` 新增 `frame types survive the relay: text stays text, binary stays binary`：client→daemon 文本帧断言 `isBinary === false` 且 JSON 可解、二进制帧 `isBinary === true` 且字节一致；daemon→client 同款。**测试有效性已反证**：把 `normalizeIncoming` 临时改回总是返回 ArrayBuffer，该测试失败；恢复后 `Test Files 1 passed / Tests 10 passed`。

**验证。** `npm run build:relay` 重建 dist（spec 跑的是 `packages/relay/dist/node-main.js`，不重建就仍在跑旧 bug）；`npx tsgo --noEmit` relay 与 app 均 0 错；`npm run format:files` + `npm run lint` 4 文件 0/0；独立 repro 复跑 daemon.log 出现 `transport":"relay"..."msg":"Client connected via hello"`；`setup-guide-pairing.spec.ts` 由失败转绿（4.4s）。

**教训。** Node 与 Cloudflare 的 WebSocket 消息表示不同（Buffer+isBinary vs string），任何跨 runtime 的 relay 逻辑都不能只看「非 string 就是二进制」。这条差异在批次 1 的 e2e 里没暴露，因为那些测试自己也在 Node 侧用 Buffer 收发，绕过了文本帧路径；只有真实的浏览器→daemon 明文握手才踩到。

### 2026-09-30 · COMPAT 补齐 + 自引入的 lint 回归修复

**发现 1：新 COMPAT 标记缺移除条件。** 规则见 `docs/protocol-compatibility.md:71`（「Give it a name, a version, and a removal condition or date. Six months out is the usual default.」）。批次 4/5 我新加的 6 处标记只有名字+版本，补齐为 `added in v0.17.0, remove after 2027-03-30 once daemon floor >= v0.17.0`：

- `packages/protocol/src/messages.ts:191`（relayEndpointConfig）、`:369`（webOriginConfig）
- `packages/server/src/server/daemon-config-store.ts:38`、`:65`、`:1086`
- `packages/server/src/server/bootstrap.ts:535`、`:1680`

**发现 2（更重要）：批次 4/5 引入了 5 个 lint 错误，此前报告的「lint 0/0」不成立。** 验证方式：`git show HEAD:<file>` 写到同目录临时文件后跑同一 lint，HEAD 版本 0 错。5 处全部由本 issue 的改动引起：

| 位置                       | 规则               | 原因                                     |
| -------------------------- | ------------------ | ---------------------------------------- |
| `pickSupportedPatchFields` | complexity 29 > 20 | 内联的 relay 三字段 pick 展开            |
| `applySupportedPatch`      | complexity 21 > 20 | 内联的 relay endpoint/useTls guard       |
| `mergeMutableDaemonPatch`  | complexity 23 > 20 | 新增两条 relay endpoint/useTls 落盘分支  |
| `createBySpaceDaemon`      | complexity 22 > 20 | 新增 relayEndpointMutable 内联 `.some()` |
| `bootstrap.ts:603`         | no-shadow          | 箭头参数 `path` 遮蔽外层 `path` 模块导入 |

修法（沿用本文件既有的 pick/apply helper 模式，未改行为）：

- 新增 `pickRelayPatchFields(patch)` —— 与既有 `pickWebOriginPatchFields` / `pickNetworkAuthPatchFields` 并列。
- 新增私有 `assertRelayPatchMutable(parsedPatch)` —— 收纳两条 relay 可改性 guard，错误文案不变。
- 新增 `applyPersistedRelayEndpointPatch(next, patch)` —— 与既有 `applyPersistedCorsPatch` 并列，收纳 endpoint/useTls 落盘。
- 新增模块级 `isRelayEndpointMutable(config)` —— 消除 `path` 遮蔽，同时把 `.some()` 判据从 `createBySpaceDaemon` 里移出。

**验证**：`npm run lint` 三个文件 0 warnings / 0 errors；`npm run format:files` 通过；`daemon-config-store.test.ts` 53/53；`relay-runtime.test.ts` + `onboard.test.ts` 20/20；`npm run build:server` 通过；`npm run typecheck` 全 workspace 通过。

### 2026-09-30 · Playwright 视觉冒烟（引导弹窗）

环境：`npm run dev:app`（Expo web dev server :8081，无 daemon 在 6778）→ 落到 `/welcome`。

**观察到（横幅 → 弹窗）**

- 欢迎页（宽视口）：三个动作 `Set up a new daemon`（primary 白底）/ `Direct connection` / `Paste pairing link`。localhost 非托管 origin → 自托管顺序，Set up a new daemon 排第一且为 primary，与 `welcome-screen.tsx:208-239` 的 `isHostedWeb` 分支一致。
- 弹窗（宽视口）：`Connect a daemon`，三段 Install the daemon / Run onboarding / Paste the pairing link，两条命令块各有 Copy，底部 Cancel + Pair。命令文本 `npm install -g @bytetrue/byspace`、`byspace onboard --web-origin http://localhost:8081 --relay` —— webOrigin 取自 `window.location.origin`，relay 缺省故为 `--relay`。
- 输入 relay 端点 `relay.example.com:443` 后命令热更新为 `byspace onboard --web-origin http://localhost:8081 --relay-endpoint relay.example.com:443` —— 与 `buildSetupCommands` 的 relay 分支一致，且 `--relay` 被 `--relay-endpoint` 替换（`--relay-endpoint` 隐含 relay on）。
- Pair 错误路径：粘贴 `not-a-link` 后点 Pair → 行内红字 `Link must include #offer=...`（`pairing.link.errors.missingOffer`），弹窗不关。
- Copy：点 onboard 命令块 Copy → toast `Copied`。
- 紧凑视口 390×844：弹窗转 bottom sheet（顶部 grabber），内容滚动可达，命令块与输入框均换行正常，Cancel/Pair 在 sheet 底部。

**结论**：无布局破损、无文案缺失、无交互死路。控制台除开发环境预期噪声外无本次新增错误。

**唯一非预期控制台错误（已定位为既有问题，非本 issue 引入）**

`Accessing element.ref was removed in React 19. ref is now a regular prop.`（bundle 行 67099，页面加载后首次挂载 sheet 时出现一次，每次会话仅一次）。

定位方法（modal 层自 HEAD 起未变——`pair-link-modal.tsx` 本体在批次 5 重构过，但 `git show HEAD:` 与工作树的 AdaptiveModalSheet/SheetHeader/visible/onClose 用法计数完全一致，且 `AdaptiveModalSheet` 不在改动或新增列表中）：全新页面 + 紧凑视口，先开 `PairLinkModal` → 同样触发一次；随后开 setup-guide 弹窗不再新增。宽视口（dialog 形态）开 setup-guide 也不触发。即触发条件是 React Native Web 的 Modal 包装层首次挂载，与 setup-guide-modal 无关。

其余控制台错误全是 `ws://localhost:6778/ws` 连接失败（开发机未起 daemon），预期。

截图：`.playwright-mcp/welcome.png`、`page-2026-09-30T18-31-57-583Z.png`（宽弹窗）、`page-2026-09-30T18-32-03-812Z.png`（relay 端点已填）、`page-2026-09-30T18-32-13-946Z.png`（紧凑欢迎页）、`page-2026-09-30T18-32-36-299Z.png`（紧凑 sheet 底部）。

### 2026-09-30 · 批次 5 引导式连接弹窗完成

**A 线：--relay-endpoint 全链路（CLI → protocol → server）**

- `packages/protocol/src/messages.ts`：`MutableRelayConfigSchema` 扩为 `{enabled, endpoint: z.string().min(1).optional(), useTls: z.boolean().optional()}.passthrough()`，`// COMPAT(relayEndpointConfig): added in v0.17.0`。
- `packages/server/src/server/relay-runtime.ts`：`setEndpoint(endpoint, useTls)` —— 同值早退；停旧 transport（fire-and-forget + warn）；public 字段跟随 endpoint（pairing offer 不得广告旧 relay）；enabled 时重启，失败置 disabled 再 throw（镜像 setEnabled 语义）。
- `packages/server/src/server/daemon-config-store.ts`：patch 支持 `relay.endpoint/useTls`（pickSupportedPatchFields 三字段、guard 仿 relayEnabledMutable——`relayEndpointMutable=false` 时 throw "Relay endpoint is controlled by a daemon launch override..."、mergeMutableDaemonPatch 落盘、RELOADABLE_PATHS + PERSISTED_TO_MUTABLE_PATH 各加两条）。
- `packages/server/src/server/bootstrap.ts`：mutable 视图 relay 带 endpoint/useTls；store 构造 options.relayEndpointMutable 由 `config.configReload.overrideControlledPaths` 驱动；`syncRelayEndpoint()` 双注册 `onFieldChange("relay.endpoint")`+`onFieldChange("relay.useTls")`（幂等）。
- `packages/cli/src/commands/onboard.ts`：`--relay-endpoint <host[:port]|ws(s)://host[:port]>`（scheme 推 useTls；缺省端口 ws/http→80 其余→443；纯 host 无 scheme 默认 443+wss；IPv6 必带 []）；`resolveRelayEnabled`（--relay-endpoint 隐含 relay on，与 --no-relay 同用报错）；patch 走既有 configure 通道（探活→回读验证→log.warn 提示升级 daemon）。
- pair.ts 无需改：daemon 在跑→getRelayConfig→runtime.getConfig() 热应用后即新值；fallback→loadConfig 读 persisted。

**B 线：web 引导弹窗**

- `packages/app/src/utils/setup-commands.ts`：`buildSetupCommands({webOrigin, relayEndpoint})` 纯函数——托管 origin（webOrigin null）无 --web-origin；relay 非空用 --relay-endpoint（隐含 relay）否则 --relay。
- `packages/app/src/utils/pair-offer.ts`：`parsePairingOfferUrl`（错误映射 pairing.link.errors.\*，zod message 不再直出）+ `pairWithOfferUrl`（探活+isNewHost+upsert）。pair-link-modal.tsx 重构为消费共享 util，错误展示改 i18n 键。
- `packages/app/src/utils/setup-guide-storage.ts`：AsyncStorage key `@byspace:setup-guide-relay-endpoint-v1`。
- `packages/app/src/components/setup-guide-modal.tsx`：AdaptiveModalSheet 三步弹窗（install 命令块 → onboard 命令块+自托管时 relay 输入框 → 配对链接粘贴闭环）。CommandBlock = selectable mono Text + Copy 按钮（CODE_SURFACE_DATASET 豁免界面字体替换）。
- `packages/app/src/components/welcome-screen.tsx`：web actions 自托管=[setup-guide(primary), direct, pasteLink]、托管=[direct(primary), pasteLink, setup-guide(尾)]；native 不变。
- i18n 9 locale 全加 `pairing.setupGuide.*` + `pairing.connectionMethods.setupGuide.*`。
- **设计偏差：平台 tab 砍除**。原计划 mac/linux | windows tab（前提：方案 A env 前缀，命令差异仅 shell 语法）；持久化方案 B 后命令跨平台完全一致（npm install -g + byspace onboard flags），tab 无内容可切，砍。未来出现真实差异再加。

**验证**：protocol/server/cli/app typecheck 全绿；onboard.test.ts 16/16（parseRelayEndpoint 5 + buildRelayEndpointPatch 3 + 原有 8）；daemon-config-store.test.ts 53/53（新 3：persist/hot-apply/guard reject）；relay-runtime.test.ts 4/4；setup-commands.test.ts 4/4；i18n resources.test.ts + key-contract.test.ts 40/40；lint 0/0；format 绿。真实冒烟：in-process daemon + 本地 Node relay，patch relay:{endpoint,useTls:false} → 回读/persisted/幂等/热 enable→transport 连上 → getDaemonPairingOffer 的 offer 解出 relay={endpoint,useTls:false} → getDaemonStatus relay 字段全对（public 跟随）。

**坑**：①AdaptiveTextInput 非受控（无 value prop），受控需求用 initialValue+resetKey+onChangeText。②react-native-unistyles v3 无 vars 导出、useUnistyles 被 lint 硬禁——命令图标/placeholder 颜色用 `UnistylesRuntime.getTheme().colors.*`（file-pane/pane.tsx 先例）。③oxlint complexity max 20——拆 defaultRelayPort/resolveRelayEnabled helper。④i18n 插入用 node 脚本锚点法（readFileSync+replace+唯一断言）比 9 次 edit 稳。⑤docs/docker.md TLS 节措辞同步修正（--relay 不收地址 → --relay-endpoint 示例）。

### 2026-09-30 · 批次 4 onboard --web-origin 完成

**CLI（packages/cli/src/commands/onboard.ts）**

- 新增 `--web-origin <url>`：一条命令设 `app.baseUrl` + 把 origin 并入 `daemon.cors.allowedOrigins`。
- `parseWebOrigin`（导出）：URL 校验、只收 http/https、去尾斜杠；子路径场景 baseUrl 带路径、CORS 只用 origin。
- `buildWebOriginPatch`（导出）：已配置返回 null（幂等）；否则 `app.baseUrl` + 合并后的全量 allowedOrigins（daemon 侧整组替换数组，必须送全量）。
- `configureWebOrigin` / `applyWebOrigin`：tryConnectToDaemon → serverId 校验（防打错 home）→ getDaemonConfig → patch → 回读校验；老 daemon 静默丢 patch 时 log.warn 提示升级。错误路径 exit(1) 与其他 onboard 失败路径一致。为 runOnboard 复杂度上限抽出。
- `printNextSteps` 加第 4 参 webBaseUrl：设了显示自托管 URL，否则 hosted 默认。

**daemon patch 通路补齐（实现时发现的真实缺口）**

- 冒烟发现 `set_daemon_config` 的 app/cors 键在 daemon 侧被 `pickSupportedPatchFields` 白名单静默剥离 → patch 变 no-op。批次 3 之前的「app.baseUrl/cors 已支持热 reload」结论只覆盖了 config.json 文件编辑路径，RPC patch 路径从未接过这两个字段。
- packages/protocol/src/messages.ts：MutableDaemonConfigPatchSchema 增显式 `app`/`cors` 字段（COMPAT(webOriginConfig) added in v0.17.0；老 daemon 丢弃。纯增量可选字段，协议兼容规则内的变更）。
- packages/server/src/server/daemon-config-store.ts：SupportedMutableConfigPatch 增 app/cors；`pickWebOriginPatchFields`（复杂度上限强制抽出）、`applyPersistedCorsPatch`；`mergeMutableDaemonPatch` 落盘 `daemon.cors.allowedOrigins`、`mergeMutablePatchIntoPersistedConfig` 落盘顶层 `app.baseUrl`。热生效链本就存在（RELOADABLE_PATHS + bootstrap 订阅 onFieldChange("cors.allowedOrigins") 更新 ws upgrade 白名单 Set），patch 后无需重启。

**测试**

- packages/cli/src/commands/onboard.test.ts（新）：8 测试（parseWebOrigin 4 + buildWebOriginPatch 4）。
- daemon-config-store.test.ts +2：patch 持久化 app/cors 进 config.json；onFieldChange("cors.allowedOrigins") 热生效断言。
- in-process 冒烟（一次性 web-origin-smoke.ts，跑完已删）：真 daemon + DaemonClient 走 getDaemonConfig → patch → 回读 → 幂等，SMOKE OK + IDEMPOTENT OK。

**验证**

- protocol 改后先 `npm run build:client` 重建声明，再 `npm run typecheck` 0 错；vitest：daemon-config-store 50/50、onboard 8/8、daemon/reload 3/3；`npm run lint` 0 错（两处 complexity 超限分别抽 helper 解决）；format:files 过。

**遗留**

- 批次 5：引导式连接弹窗（web 交互面，方案 a：relay 地址可选输入框 + localStorage）。

### 2026-09-30 · 批次 3 文档与契约完成

**重写/更新文档**

- docs/docker.md — 全文重写为自托管主线：双镜像说明、compose 快起（curl 拉取两个文件）、What is where 表（web 容器/daemon 本机/relay 可选）、版本 pin、TLS profile、HTTP 代价表（剪贴板/PWA/Web Push/明文密码 + secure-context 说明）、daemon-in-container 10 行示例（FROM node:22 + npm install -g @bytetrue/byspace）、本地构建。
- public-docs/docker.md — 同步重写（公共文档站版本）；public-docs/index.md Docker 段 + Where next 行同步。
- docker/README.md — 重写为双镜像说明 + daemon-in-container 示例。
- README.md / README.ko.md — Docker 段替换为自托管 compose 快起（zh-CN/ja 版无 Docker 段，无需动）。
- SECURITY.md:57 — 「official image 非 root 运行 daemon」改为「官方容器只有 web/relay，都不跑 agent 不持凭据；自建 daemon 容器时信任模型同 loopback 规则」。
- docs/release.md — 发布目标表改双镜像；release 资产名改 BySpace-<version>-{web,relay}-container.txt；tag 推送语义改双镜像 + latest。

**契约与制度记忆**

- docs/protocol-compatibility.md — 新增「Relay wire compatibility」节：/ws 握手参数冻结（role/serverId/v）、固定 400 文案、v1/v2 语义（单席位替换 1008、connected/disconnected 通知、缓冲上限 200）、行为规约指向 cloudflare-adapter.ts + node-adapter.ts + node e2e parity。
- byissue/issues/025-o-architecture-retention-audit.md — D6 修订四处：D 表行（保留→双容器自托管，原「保留」作废，注明 2026-09-30）、开头 Owner 确认句、执行顺序第 1 条、已确认方向汇总句。修订理由：agent 需要用户真实工具链，合体镜像误导大于便利；npm 唯一分发。

**验证**

- 残留扫描：grep ghcr.io/bytetrue/byspace: 与 docker/base/Dockerfile.agents.example/docker-compose.example 在文档全零命中（.github/release/ 历史 release note 按惯例不改，byissue/ 记录不改）。
- npm run format:files（10 文件）+ npm run lint 全绿。

**遗留**

- 批次 4：onboard --web-origin（daemon 侧命令面）。
- 批次 5：引导式连接弹窗（web 交互面）。

### 2026-09-30 · 批次 2 镜像与 compose 完成

**删除**

- docker/base/（旧 daemon 合体镜像 Dockerfile + rootfs entrypoint）、docker/Dockerfile.agents.example、docker/docker-compose.example.yml。

**新增**

- docker/web.Dockerfile — 两阶段：manifests-first npm ci（issue 027 层缓存）→ COPY . . → strip prepare/postinstall（COPY 恢复了带钩子的 package.json，两处都要删）→ build:web → nginxinc/nginx-unprivileged:stable-alpine 运行时。产物含 /schemas/byspace.config.v1.json（issue 044）。
- docker/relay.Dockerfile — 同上 npm ci/pack 模式，npm pack --workspace=@bytetrue/relay（prepack=build:clean 自动构建）→ node:22-bookworm-slim + npm install -g，CMD node dist/node-main.js，HEALTHCHECK /health，USER node（无状态，sessions 在内存）。安装后 test -f + node --check 验证。
- docker/web-nginx.conf — 8080 端口、gzip、/\_expo/static/ immutable、/schemas/ no-cache、/sw.js no-cache、SPA fallback try_files。
- docker/compose.yml — web（默认，8080）+ relay（profile "relay"，8081）+ tls（profile "tls"，caddy:2 + BYSPACE_DOMAIN）。坑：docker compose 插值不感知 profile，`:?` 硬错误会挡默认用法——改 `:-` 空默认 + Caddyfile 空域名时 caddy 启动报错快速失败，注释已写明。
- docker/Caddyfile — ${BYSPACE_DOMAIN} 反代 web:8080；relay TLS 块注释掉待用户取消注释。

**改造**

- .github/workflows/docker.yml — build/publish 两 job 改 matrix（suffix: web|relay）；setup outputs image→image_prefix + publish_latest；publish 加「Resolve publish tags」步（per-matrix 拼版本 tag + 条件 latest）；冒烟改 matrix.smoke_path（web /，relay /health），容器端口 8080；digest 资产名 BySpace-$VERSION-$SUFFIX-container.txt；gh release create 加竞态容忍（matrix 双 job 同时创 release）。actionlint 通过（修了两处 shellcheck：&& 链改 if 块、docker run 行尾双反斜杠）。

**验证**

- 两个镜像本地真实构建成功（BuildKit relay 172s / web 70s）。
- 容器冒烟：web / 200、/schemas/byspace.config.v1.json 200、/sw.js 200、SPA fallback /random/route 200；relay /health 200 {"status":"ok"}、/ 404。
- docker compose --profile relay up：两容器起、web 200、relay health ok（本地 tag ghcr.io/bytetrue/byspace-{web,relay}:latest）。
- compose config 三 profile 组合（default / relay / relay+tls+BYSPACE_DOMAIN）语法校验通过。

**遗留**

- 批次 3：README.md:77-90、docs/docker.md、public-docs/docker.md、SECURITY.md:57、025-D6 修订、protocol-compatibility.md relay 冻结条款。
- compose 的 web/relay 镜像 latest tag 在新镜像首次发布前不存在——首次 stable 发布后自然解决。

### 2026-09-30 · 批次 1 Node relay 完成

**新增文件**

- `packages/relay/src/relay-session.ts` — 与运行时无关的会话核心：tag 索引 socket 注册表（`server-control` | `server` | `server:{cid}` | `client` | `client:{cid}`）、`resolveRelayVersion`（缺省 v1、非法 null）、buffered frames（上限 200）、`nudgeOrResetControlForConnection`（10s+5s 两段）、`handleControlKeepalive`（COMPAT relay-json-ping，与 CF 版同款注释与移除期限）、close 语义。行为规约 = `cloudflare-adapter.ts`，逐条对应。
- `packages/relay/src/node-adapter.ts` — Node 壳：`http` server + `ws` `WebSocketServer({noServer:true})`；`/health` 返回 `{"status":"ok"}`；`/ws` upgrade 校验 role/serverId/v（缺 serverId 400 "Missing serverId parameter"、非法 v 400 "Invalid v parameter (expected 1 or 2)"，与 CF 文案一致）；session key = `relay-v{version}:{serverId}`（对齐 DO idFromName）；client 未带 connectionId 时补 `conn_${randomUUID.slice(0,16)}`；v2 close 语义（client 全关→server-data 1001 + disconnected 通知；server-data 关→client 1012）；`normalizeIncoming` 处理 RawData 三形态防 view 别名；`close()` 先 terminate 全部 clients 再关 server。
- `packages/relay/src/node-main.ts` — 独立入口：`BYSPACE_RELAY_PORT`/`PORT`（默认 8080）、`BYSPACE_RELAY_HOST`（默认 0.0.0.0）、SIGTERM/SIGINT 优雅退出。Docker CMD 用。
- `packages/relay/src/node-relay-e2e.test.ts` — 6 场景 e2e：health、v2 全流程 E2EE（hello→ready→双向密文）、buffered frames（先注册监听再 open 防同 tick 丢帧）、server close→client 1012、v1 单对转发、参数校验拒绝。

**修改**

- `packages/relay/package.json`：exports 增 `./node`（types/node/import/default 四键，仿 ./cloudflare）。

**验证**

- `npx tsgo --noEmit` 0 错；`npx vitest run src/node-relay-e2e.test.ts` 6/6 过（235ms）。
- 真实进程冒烟：起 dist、`/health` 200、v2 control+client 接线、control 收到 `{"type":"connected","connectionId":"smoke-conn"}`。
- `npm run format:files` + `npm run lint` 全绿。

**决策**

- CF 版（cloudflare-adapter.ts）**未重构**：生产 Worker 是行为规约载体，批次 1 增量交付；两实现对齐由 e2e 断言保证。后续如要统一，可让 CF DO 委托 relay-session（另立小步）。
- 原计划「纯逻辑核心 + 双壳共享」简化为「Node 侧独立实现 + e2e parity 断言」：CF 的 tag/attachment API 与 ws 差异大，强行统一会引入序列化边界，收益低。

**遗留**

- 批次 2 起：relay.Dockerfile 用 node-main.ts 为 CMD；web.Dockerfile nginx+dist；删 daemon 合体镜像。

## 关闭结论

- **判断**：五个批次全部交付并验证，范围未暗扩。唯一的实现缺口（Node relay 帧类型）由本 issue 自己的 e2e 发现并修复，回归测试已变异反证。
- **验证**：`setup-guide-pairing.spec.ts` 单跑 1 passed (9.4s) / `--repeat-each=2` 2 passed (15.3s)；relay 单测 + e2e 16/16；relay 与 app 的 `tsgo --noEmit` 0 错；format 与 lint 绿；两个镜像本地真实构建，容器冒烟（web `/` `/schemas` `/sw.js` SPA fallback；relay `/health`）与 compose 三种 profile 组合配置校验通过。
- **毕业**：`byissue/spec/connection.md` 新增「自托管部署」节（发布形态、`onboard --web-origin`、relay 随 offer 流入、HTTP 代价、relay 握手契约指针）；`byissue/spec/index.md` 条目描述同步；relay 帧类型契约落在 `docs/protocol-compatibility.md`；跨 runtime 帧表示差异落 `byissue/notes/006-relay-runtime-frame-representation.md`；025-D6 已修订。
- **遗留**：无阻塞项。可选后续（未立 issue）：让 Cloudflare DO 委托 `relay-session.ts`，消除双实现；首次 stable 发布前 compose 引用的 `latest` tag 尚不存在，随发布自然解决。
