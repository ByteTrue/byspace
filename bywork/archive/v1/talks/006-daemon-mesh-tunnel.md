# Daemon 异地组网（tunnel）talk

> **写法：** 按当时讨论推进的顺序写，每一节 = 一轮推进或一次关键纠正。
> **自检（出现过的都要落到文中某处，没出现过的整项删除）：** 开场意图 · 关键纠正与最终以何为准 · 已确认决策/约束 · 术语 · 影响与取舍 · 仍开放项 · 出口与暂不纳入。

---

## 开场：调研「异地组网」可行性

Owner 起意（2026-10-09）：想给 BySpace 加异地组网功能，调研可行性。第一句说的是「Relay 之间组网」，当场纠正为 **Daemon 之间**。

## 第一轮：三种「组网」与起步机制

查现状：daemon 之间零连接（各自出站连 relay，app 在 relay 汇合连多 host）；E2EE（Curve25519 + NaCl box）、principal/credential 权限模型、pairing offer 流转皆可复用；026（跨 workspace 统一编排）已放弃，理由「daemon 不持有工作流状态」。

抛三问：组网给谁用 / 规模 / 发现机制。另发现最便宜的起步是 **daemon 即客户端**——daemon A 导入 daemon B 的 pairing offer，以 client 角色连 B，relay 零改动、协议零新增。

## 第二轮：场景纠正——是端口转发，不是 agent 跨机

Owner 给出主场景：另一工作室有一台 Host 连到本机 Web；想在它上面看 dev server 前端、访问它端口上部署的服务。方向从「agent 跨机」改为**反向端口转发**。同时 Owner 预判了本机判定问题：存在本机没装 daemon、纯 Web 连远端 host 的用法，功能必须只在「拥有连接到本机 daemon」时启用；并提议一个「客户端状态」概念。发现机制拍板手动互导，Keep simple。

查证补充：

- service proxy（docs/service-proxy.md）入口在远端 daemon 的 HTTP listener（`*.localhost` Host 路由），人在本机时够不着——缺口真实。
- 058 已把「本机 daemon 判定」重做为回环 endpoint 语义（`useLocalDaemonServerId`），客户端状态的门控 hook 现成。
- Hub 遗产：025 C7 砍掉的是「daemon 连外部 Paseo Hub 服务」，与 daemon-to-daemon 无关，wire 层留 hub.management.\* stub。

## 第三轮：通道与安全边界

三问拍板：025「不另造 BySpace Hub」不约束本功能（半毛钱关系没有）；D1 连 D2 **走 relay**（两端默认只听 loopback，直连要开入站，违反默认安全姿态）；**端口白名单** + **两端 daemon 都设密码**才能启用。

查证：daemon 设密码后含 relay 路径的所有 WS 连接都要求 `byspace.bearer.<password>` subprotocol（websocket-server.ts:820-831），双因子天然成立：公钥（pairing offer）+ 密码。

## 第四轮：产品层分叉清空

- 凭据传递：GUI 手动添加（app 里粘贴 D2 offer + 密码），不做纯 CLI 入口。
- 本地呈现：**动态端口**（远端 :3000 → 127.0.0.1:34xxx，GUI 列表显示映射）。Owner 委托判据「方便就行」。
- 白名单来源：我先提「service script 自动 + 手动兜底」，**当场被纠正**——Owner 明确组网是独立功能，不与 Workspace 耦合，裸 daemon（无任何 workspace）也要可用；类比 Schedules，要独立路由/独立 Page。白名单修正为**组网自己的静态端口列表，GUI 管理**。
- 生命周期：**常驻**。Owner 强调「跟 AI、前端没有任何关系」，是 daemon+relay 后端的独立小功能；app 不在线时隧道照常工作。

## 落定的形态

| 维度     | 结论                                                                                  |
| -------- | ------------------------------------------------------------------------------------- |
| 场景     | 访问远端 host 上的端口服务（dev server 等）                                           |
| 规模     | 只组自己的机器                                                                        |
| 发现     | 手动互导 pairing offer                                                                |
| 通道     | D1 以 client 身份经 relay 连 D2，复用 E2EE，relay 零改动                              |
| 认证     | 公钥（offer）+ 双端密码（bearer subprotocol）双因子                                   |
| 暴露面   | D2 侧静态端口白名单，GUI 管理                                                         |
| 本地呈现 | 动态本地端口，GUI 显示映射                                                            |
| 入口     | app GUI 手动添加；仅本机回环 daemon 在场时显示（058 hook）                            |
| 生命周期 | 常驻、自动重连，不依赖 app 在线                                                       |
| 定位     | daemon+relay 层独立功能，与 agent/workspace 解耦；app 内独立路由/页面，类比 Schedules |

## 术语

- **D1 / D2**：发起方（本机）daemon 与目标（远端）daemon。讨论用代号，实现时按代码惯例定名。
- **客户端状态**：Owner 提出的概念——连着本机 daemon 时，本机具备「客户端」能力（可发起隧道）。判定复用 058 回环语义。

## 仍开放（实现时定，不阻塞）

- tunnel.\* RPC 具体形态与二进制隧道帧的分帧设计（可借 file-transfer 的 FileBegin/Chunk/End 先例；注意 relay 32 MiB 单帧上限，note003）。
- D1 持有的 D2 凭据存哪里（host registry 同层 or 新 store）。
- principal 的权限切分粒度（预计只授 tunnel 相关）。
- 白名单 config 字段名与 schema。

## 出口

- 常规 feature issue 一个：`byissue/issues/062-x-daemon-tunnel.md`（本次创建，已交付关闭）。
- 暂不纳入：agent 工具跨机互通、反向隧道（D2 访问 D1）、relay 成员网络/自动发现、他人机器、workspace 联动。
