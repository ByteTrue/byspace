---
kind: issue
title: "Daemon tunnel：经 relay 的远端端口本地转发"
type: feature
status: closed
created: 2026-10-09
closed: 2026-10-09
---

<!-- 读者：跨会话接手的人。目标与范围 · 现状与方案 · 影响面 · 验证 · 关闭回写 -->

# Daemon tunnel：经 relay 的远端端口本地转发

## 为什么做

Owner 在多地有开发机，远端机器上的 dev server 与部署服务（人不在远端时）只能靠公网暴露或 SSH 隧道访问。BySpace 已有 relay E2EE 通道与多 host 模型，缺最后一公里：把远端 host 的白名单端口呈现为本机本地端口。

讨论全程见 [talks/006](../talks/006-daemon-mesh-tunnel.md)，全部产品决策已在彼处拍板。本 issue 是执行清单。

## 做成以后是什么样

- 远端机器 D2 跑 daemon（无需任何 workspace/project），在组网页面配置允许转发的端口白名单、设置 daemon 密码。
- 本机 D1 跑 daemon 并设密码，在 app 的组网页面（独立路由，类比 Schedules）粘贴 D2 的 pairing offer + D2 密码，建立隧道。
- 本机浏览器访问 `http://127.0.0.1:34xxx` 即达 D2 的白名单端口服务；dev server 的 HMR WebSocket 亦走隧道。
- 隧道常驻：D1 自动重连 D2，app 不在线时照常工作。D1 重启后恢复。
- app 无本机（回环）daemon 时，组网入口不显示。

## 方案（已定骨架）

### 通道

D1 以 **client 角色**经现有 relay 连 D2 的 serverId，复用 E2EE（Curve25519 + NaCl box）与 relay v2 数据通道。**relay 零改动**。daemon 侧的 client 连接代码可复用 `packages/client` 的 driver 或 `packages/relay` 的 client channel（实现时择优）。

### 认证

- D1 持有 D2 的公钥（pairing offer）与 D2 密码；连接时走 E2EE 握手 + `byspace.bearer.<password>` subprotocol（daemon 设密码后所有 WS 连接强制，含 relay 路径，`websocket-server.ts:820-831`）。
- 启用门槛：**两端 daemon 都设了密码**，缺一不启用（服务端强制，护栏风格同「局域网监听以密码为前提」）。

### 端口暴露面

- D2 侧静态白名单：组网自己的 config 字段（如 `daemon.tunnel.allowedPorts`），GUI 编辑，与 workspace/script 零耦合。
- 转发请求命中白名单才建立出站 TCP（目标为 D2 本机地址）。
- 白名单外一律拒绝，含明确错误回传。

### 本地呈现

- D1 为每条映射监听 `127.0.0.1:<动态端口>`，GUI 显示「远端 host:port → 本地端口」映射与连接状态。

### 协议

- protocol 新增 tunnel.\* RPC（dotted namespace + .request/.response，按 docs/rpc-namespacing.md）与二进制隧道帧（分帧参考 file-transfer 的 FileBegin/Chunk/End 先例；单帧预算注意 relay 32 MiB 上限，见 note003）。
- 全部 append-only + capability gate，遵守 protocol-compatibility 契约。
- D1 连 D2 的 hello clientType 沿用现有枚举（"hub" 已在 wire 上）或新增值——实现时定，走 gate。

### 权限

- D2 给 D1 的配对 principal 只授隧道相关权限，不碰 workspace 权限。权限分类进 `operation-permissions.ts` 的 exhaustive map（typecheck 强制）。

## 影响面

**必须改：**

- `packages/protocol`：tunnel.\* schema、二进制帧、capability。
- `packages/server`：D1 侧隧道管理器（配置、连接、重连、本地 listener、帧转发）、D2 侧白名单检查与出站 TCP、配对 principal 接线、config schema。
- `packages/app`：独立路由的组网页面（D1 视角：隧道列表/添加/删除/状态；D2 视角：白名单管理 + 已连接对端）；入口仅本机回环 daemon 在场时显示（复用 058 `useLocalDaemonServerId`）；i18n 9 locale。

**需要验：** relay e2e 语义不回归；`daemon reload` 对 tunnel 配置的热更新支持（不支持则 restart-required）。

**仍未知（实现时定）：** D1 凭据存储位置；clientType 取值；帧格式细节。

## 不包含

- agent 工具跨机互通（与 AI 无关，Owner 明确）。
- 反向隧道（D2 访问 D1 端口）。
- relay 成员网络/自动发现/他人机器。
- workspace 联动（service script 自动白名单等，讨论中被否决）。
- CLI 入口（GUI 优先；CLI 后续按需）。

## 验证口径

- e2e（双 daemon + relay）：本地端口 curl 通远端 HTTP 服务；HMR 式 WebSocket upgrade 走隧道通；断 relay/断 D2 后重连恢复；白名单外端口拒绝；任一端无密码时功能拒绝启用；未配对principal 无隧道权限。
- 单测：白名单判定、端口映射分配、配置 patch 校验。
- 回归：typecheck / lint / format；relay 既有测试不回归。

## 制度记忆影响

- `byissue/spec/connection.md`：功能落地后新增「Daemon tunnel」节（形态、门槛、白名单语义）。
- `byissue/spec/index.md` 条目同步。
- docs/permissions.md 若新增权限操作需同步。

## 执行记录

### 2026-10-09 · 批次 1+2：协议、D2 目标端、D1 发起端、e2e 全绿

**穿刺结论先行**：主路径端到端打通——真实 Node relay + 双 in-process daemon，HTTP 请求经 `本地端口 → tunnel 二进制帧 → E2EE WS → relay → D2 session → 目标 socket` 全链路往返，字节完整（`tunnel.e2e.test.ts` 2/2）。风险表全落定：连接栈复用（server 已依赖 `@bytetrue/client`，D1 内嵌 DaemonClient 走 `internal/daemon-client` 入口）、帧多路复用（tunnelId mux）、协议管线（aot 生成器吃 dotted schema）、config 链（persisted → resolve → mutable view → patch → 落盘，仿 relay endpoint 先例）。

**落地物：**

- `packages/protocol/src/messages.ts`：`tunnel.{list,open,close,stats,create,remove}.{request,response}` 8 组 schema + `TunnelEntrySchema`；`MutableDaemonConfig(Patch)Schema` 加 `tunnel.allowedPorts`；全部进 inbound/outbound discriminated union。
- `packages/protocol/src/binary-frames/tunnel.ts`（新）：`[1B opcode][1B id 长度][tunnelId][payload]`，opcode 0x20/0x21/0x22（DataUpstream/DataDownstream/Close），避开 terminal（0x01..）与 file-transfer（0x10..）区段；demux 与 index 导出接线；6 个单测含 payload 拷贝语义与 demux 共存。
- `packages/server/src/server/session/tunnel/tunnel-session.ts`（新）：D2 目标端控制器。open 请求双门槛（daemon 密码已设 + 端口在白名单），通过后向 `127.0.0.1:<remotePort>` 建出站 TCP，双向帧泵；list 融合 inbound（本 session 的隧道）与 outbound（D1 侧 manager registry）两类视图；create/remove 走注入的 `TunnelOutboundController`，D1 侧自身无密码时 create 直接拒绝（两端密码门槛的发起端半边）。
- `packages/server/src/server/tunnel-manager.ts`（新）：D1 发起端。每 peer 一个内嵌 `DaemonClient`（clientType "cli"，relay URL 自动叠 E2EE transport 工厂，复用内置重连）；每远端端口一个本地 listener（127.0.0.1:0 动态端口）；**每个 accepted socket 独立 open、独立 tunnelId**（多 TCP 流并发），data 事件逐块上行、close/error 下发 Close 帧；对端 Close 帧销毁对应本地 socket。
- `packages/server/src/server/tunnel-registry.ts`（新）：daemon 级注册表，`$BYSPACE_HOME/tunnels.json` 持久化（password 明文随 0600 私有文件，与 daemon-keypair 同规），boot 时恢复、add/remove 即时持久化；5 个单测覆盖持久化/重载/幂等/损坏容错。
- `packages/client/src/daemon-client.ts`：tunnel 二进制帧收发（`onTunnelFrame`/`sendTunnelFrame`）+ `openTunnel`/`closeTunnel` RPC 方法（requestId 关联）。
- `packages/server/src/server/persisted-config.ts`：`daemon.tunnel.allowedPorts` schema。
- `packages/server/src/server/config.ts` + `bootstrap.ts`：resolve 链、初始 mutable 视图、`TunnelRegistryService` 生命周期（start 在 listener accepting 后、stop 在 relay stop 后）。
- `packages/server/src/server/daemon-config-store.ts`：`pickTunnelPatchFields` + merge 落盘 + RELOADABLE_PATHS/PERSISTED_TO_MUTABLE_PATH 两条（config.json 手改后 `daemon reload` 热生效）。
- `packages/server/src/server/authorization/operation-permissions.ts`：tunnel.\* 全部分类（open/close/create/remove → tunnel.manage；list/stats → daemon.read）。

**验证：**

- `tunnel.e2e.test.ts` 2/2（HTTP 转发 + 并发双流）；`tunnel-hardening.e2e.test.ts` 3/3（白名单拒绝、密码错误拒绝、**relay 杀掉重启后自动恢复转发**）。
- `tunnel-session.test.ts` 9/9（双门槛三拒绝路径、上行/下行字节流、runtime 白名单收紧、close 语义、cleanup、方向错误帧忽略、list 投影）。
- 回归：daemon-config-store 53/53、authorization 7/7、relay 全套 74/74+1 skipped、binary-frames 25/25。
- typecheck：server tsgo 0 新增错误（既有跨包测试错误未动）；protocol/client build 绿。

**关键取舍（当场记录）：**

- D1 连 D2 用 `clientType: "cli"` 不新增枚举值——D2 无需感知对端是 daemon，密码 + 白名单已是完整授权边界；permissions.md 的 resource-scoped principal 本就标注 future，不为此提前实装。
- tunnelId 由 D2 生成（`tun-<ts>-<seq>`），帧里带全量 id 而非句柄索引——与 file-transfer 的 requestId 风格一致。
- e2e 里 D2 密码通过 config.json bcrypt 哈希 + `loadConfig` 真实加载路径注入，不走 mock。

**遗留（批次 3-4）：** app GUI（独立路由页面、058 回环门控）、i18n 9 locale、spec 回写。

### 2026-10-09 · 批次 3：app GUI 全量（路由、屏幕、e2e、i18n）

**落地物：**

- `packages/app/src/client（`daemon-client.ts`）`：`listTunnels`/`createTunnel`/`removeTunnel` RPC 方法（requestId 关联）。
- `packages/app/src/tunnels/aggregated-tunnels.ts` + `hooks/use-tunnels.ts`（新）：跨 host 聚合（对齐 schedules 的 useSchedules 模式，outbound + inbound 都可见）。
- `packages/app/src/screens/tunnels-screen.tsx`（新）：`/tunnels` 独立页面——隧道列表（outbound：peer → 远端端口、本地端口、StatusBadge、删除；inbound：远端 host 的入站会话）、`AllowlistSection`（本机 daemon 的端口白名单 GUI，走 config patch 通道）、`AddTunnelSheet`（粘贴 pairing offer + 远端密码 + 端口 → createTunnel RPC）。入口门控：`useLocalDaemonServerId()`（058 回环语义）为空时只显示提示、无添加按钮。
- 路由接线：`app/tunnels.tsx` + 根 layout 注册（storeReady 保护组）+ `AppWithSidebar` chrome 白名单 + command center 入口（rank 6，ArrowRightLeft 图标）+ `buildTunnelsRoute`。
- i18n 9 locale（en/zh-CN/ja/ko/es/fr/pt-BR/ru/ar）：`sidebar.sections.tunnels` + `tunnels.*` 全命名空间。
- e2e 基建：`isolated-host-daemon` helper 加 `daemonConfig` 选项（auth/tunnel 注入 config.json）；`daemon-client-loader` 加 password 支持；`node-ws-factory` 补 protocols 传递（**修了一个既有缺陷**：无 protocols 参数时带密码 daemon 的连接静默挂死在重连循环）。

**GUI e2e（`tunnels-screen.spec.ts`）**：双真实 daemon（supervisor spawn）+ Node relay + 浏览器驱动完整路径——替换 host registry 为回环 D1（disable-once 机制）→ `/tunnels` → 粘贴 D2 offer + 密码 + 端口 → 提交 → outbound 行出现 → 本地端口 fetch 到 D2 服务字节（retry 语义处理首连时序）。**1 passed（6.3s）**。

**调试过程中发现并修复的真 bug：**

1. **bootstrap 的 wsServer 构造漏传 `tunnelRegistry`**（批次 2 接线时 edit 实际未生效，本批次的 node-side create 探针暴露）——补传参后 supervisor 路径 create 全通。
2. `node-ws-factory` 不传 subprotocol → 带密码 daemon 连接被拒且 DaemonClient 静默重连挂死（先修于 e2e 诊断期）。
3. `e2e isolated daemon 的 worker 加载旧 dist`：supervisor 的 `resolveWorkerEntry` 优先 dist——改 server 代码后必须 `npm run build`（server）再跑 e2e，否则 supervisor 路径跑旧代码。这与 AGENTS.md 的「build before diagnosing」条款一致，此处为踩坑实录。

**验证汇总：** GUI e2e 1/1；i18n + command-center 回归 55/55；server tunnel 套件 19/19 + config-store 53/53；app tsgo 0 错；lint 0/0（本批次引入的 14 个规则违规全部按仓库模式修复：handler 全部 useCallback 化、leftIcon 传组件引用、leftIcon/JSX 不作 prop 内联表达式、无 map-spread）；format 绿。

**已知行为（非缺陷，记录在案）：** 隧道刚建立、对端首连完成前访问本地端口会被拒（socket destroy）；GUI 状态可见 connected，浏览器刷新即恢复。如需挂起语义留待后续。

**遗留（批次 4）：** 已全部完成，见下条。

### 2026-10-09 · 批次 4：制度记忆与文档回写

- `byissue/spec/connection.md`：新增「Daemon 隧道（远端端口的本地转发）」节（形态/门槛/生命周期/交互面/范围边界五条）；`byissue/spec/index.md` 条目描述同步。
- `docs/permissions.md`：`tunnel.manage` 的 authority 描述扩为含 daemon tunnels（tunnel.\* RPC 权限分类已在 exhaustive map 落地）。
- `public-docs/connectivity.md`：新增 Daemon tunnels 用户节（双端密码 + 远端白名单前提、添加流程指向 `byspace daemon pair`、持久重连语义）；docs-links 测试通过。

### 2026-10-09 · 关闭后补充：live 公网 relay 验证

用户关闭后追问「做过真实端到端验证吗」——已有的三层 e2e（vitest in-process / supervisor 双进程 + 本地 relay / 浏览器 GUI）全部走本地 Node relay，缺公网链路一跳。补 `tunnel.live-relay.e2e.test.ts`（仿 live-relay.e2e.test.ts 的 `RUN_LIVE_RELAY_E2E=1` 门控）：双 in-process daemon，D2 的 relay 指向真实 `relay.byspace.cc.cd:443`（Cloudflare Worker、TLS、公网往返），D1 侧 TunnelManager 连同一公网 relay，验证完整转发——**1 passed（24.8s）**，`hello from live d2 path=/live` 字节级断言通过。至此验证矩阵闭合：本地 Node relay（3 层）+ 官方公网 CF relay（1 层）。

## 关闭结论（候选，待用户授权关闭）

- **判断**：四个批次全部交付并验证——协议（8 组 RPC + 二进制帧 + mutable config 链）、D2 目标端（双门槛 + 帧泵）、D1 发起端（内嵌客户端 + 本地 listener + 持久化 registry）、app GUI（独立路由 + 白名单 + 添加 sheet + 9 locale）、spec/docs 回写。范围未暗扩：agent 跨机、反向隧道、relay 成员网络、CLI 入口均未做。
- **验证证据**：server e2e 5/5（含 relay 重启恢复、三拒绝路径）+ 单测 9/9 + registry 5/5；protocol 帧测试 6/6；GUI e2e 1/1（真实双 daemon + relay + 浏览器，字节级断言）；回归（relay 74、config-store 53、authorization 7、i18n/command-center 55）全绿；typecheck/lint/format 0 违规。
- **毕业去向**：connection.md 已回写；supervisor 优先 dist、ws factory 无 protocols 静默挂死两条坑已记录在本 issue 执行记录，可作为 note 候选。

## 双机真实验证交接（Win 机器上执行）

> **读者：** 在 Windows + WSL 开发机上完成 issue 062 最后一层验证的人或接手会话。前情读本 issue 上方执行记录；spec 见 `byissue/spec/connection.md` 的「Daemon 隧道」节。
> 已完成验证：本地 relay 三层（单元 15 / in-process e2e 5 / supervisor+浏览器 GUI e2e 1）+ 公网 CF relay 一层（`RUN_LIVE_RELAY_E2E=1 npx vitest run src/server/tunnel.live-relay.e2e.test.ts`，1 passed）。**唯一剩余：真双机。**

### 角色与网络

- **D2（目标机）= WSL**：daemon + dev server 都在 WSL 内，出站连 `relay.byspace.cc.cd:443`。WSL2 有独立网络命名空间，其 loopback 与 Windows 宿主隔离，网络路径上与真远程机等价（仅共享硬件、无物理 WAN 延迟——后者已被 live e2e 覆盖）。
- **D1（发起机）= Windows 宿主或另一台机**：daemon 出站连同一 relay，把 D2 白名单端口映射为本机 `127.0.0.1:<动态端口>`。
- 两侧**不需要互访**：各自只出站连公网 relay；D1 转发到的 `127.0.0.1:3000` 由 D2 daemon 在 WSL 内自己拨号（目标机视角），这正是产品语义。

### D2 侧（WSL 内，Node 22）

```bash
# 1. 取代码（分支 research/relay-cross-site-networking，两 commit：72450d511 + 204e2f726）
git clone -b research/relay-cross-site-networking https://github.com/ByteTrue/byspace.git && cd byspace
npm install
npm run build:server          # supervisor 优先加载 dist，必须 build（见 notes/007）

# 2. 起一个真实 dev server（被转发对象），记下端口，例如 3000
python3 -m http.server 3000   # 或任意 HTTP 服务

# 3. D2 daemon：独立 home + config（密码 + 白名单 + 公网 relay）
mkdir -p ~/d2-home
node -e "console.log(require('bcryptjs').hashSync('D2密码', 12))"   # 生成哈希填入下块
cat > ~/d2-home/config.json <<'EOF'
{
  "version": 1,
  "daemon": {
    "auth": { "password": "<bcrypt 哈希>" },
    "tunnel": { "enabled": true, "allowedPorts": [3000] },
    "relay": { "enabled": true, "endpoint": "relay.byspace.cc.cd:443", "useTls": true }
  }
}
EOF

# 4. 起 D2 daemon 并出 offer
BYSPACE_HOME=$HOME/d2-home BYSPACE_LISTEN=127.0.0.1:16777 \
  npx tsx packages/server/scripts/supervisor-entrypoint.ts --dev &
sleep 5
BYSPACE_HOME=$HOME/d2-home npx tsx packages/cli/src/index.ts daemon pair   # 打印 pairing link
```

`daemon pair` 生成的 offer 自带 relay endpoint 与 D2 公钥，把它交给 D1 侧。

### D1 侧（Windows 宿主或另一台机）

1. 同仓库同分支，`npm install && npm run build:server`；独立 home（`%USERPROFILE%\d1-home`）写同款 config（**密码用 D1 自己的 bcrypt 哈希**；063 起隧道默认关闭——D1 也需 `"tunnel": { "enabled": true }`，或在 app 的 Tunnels 页点 Enable）。
2. 起 D1 daemon：`BYSPACE_HOME=%USERPROFILE%\d1-home BYSPACE_LISTEN=127.0.0.1:16778 npx tsx packages/server/scripts/supervisor-entrypoint.ts --dev`（PowerShell 用 `$env:` 设环境变量）。
3. **走产品 UI 验证**：浏览器开 `http://127.0.0.1:16778`（daemon 内置 web UI）→ 连接 D1 → 命令中心或侧栏进 **Tunnels** → **Add tunnel** → 粘贴 WSL 的 pairing link + D2 密码 + 远端端口 3000 → 提交。
4. outbound 行出现后，浏览器开 `http://127.0.0.1:<行内本地端口>` ——应显示 WSL dev server 的页面（HMR WebSocket 也走隧道）。

### 验证清单（全过即真双机验证完成）

- [ ] D2 (WSL) daemon 在线、offer 生成（输出含 `#offer=`）。
- [ ] D1 add-tunnel 成功、outbound 行 state=connected。
- [ ] 本地端口返回 WSL dev server 内容，与 WSL 内 `curl 127.0.0.1:3000` 一致。
- [ ] 杀 D2 daemon 或断 WSL 网 → 行转 disconnected；恢复后自动回 connected。
- [ ] 白名单外端口（如 9999）转发被拒，错误含 allowlist。
- [ ] HMR：Vite/webpack 类 dev server 改文件，本机浏览器热更新生效。
- [ ] 结果回写本 issue 执行记录（一句通过/失败 + 现象）。

### 已知坑（notes/007，本流程已规避）

- supervisor 的 worker 优先加载 `packages/server/dist`——**改源码后必须 `npm run build`（server）**再跑，否则真进程执行旧代码。
