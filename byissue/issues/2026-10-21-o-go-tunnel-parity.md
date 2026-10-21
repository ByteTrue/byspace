---
kind: issue
title: "Go 侧 tunnel 只是桩：Node 已交付并被真双机验证过的隧道能力全部缺失"
type: feature
created: 2026-10-21
---

# Go 侧 tunnel 能力回填

> **读者：** 接手「把已经验证过的隧道能力搬进 Go 单二进制」的人。
>
> **这不是新功能。** [062](../062-x-daemon-tunnel.md) 已于 2026-10-09 交付并**通过了真双机
> 实测**（Windows D1 + WSL D2 + 公网 CF relay：建隧道、`curl 127.0.0.1:65379` 返回对端内容、
> 杀对端后 3 秒自动恢复）。[063](../063-x-tunnel-experimental-gate.md) 补了实验性门控与自托管
> relay 支持。本 issue 是**把这套能力翻译到 Go**，不是重新设计。

## 现状：Go 侧全是硬编码桩

`internal/server/ws_git_system.go` 里五个 `tunnel.*` handler 都只回固定值：

| RPC                     | Go 现在返回                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `tunnel.list.request`   | `entries: []`                                                    |
| `tunnel.open.request`   | `remotePort: 0, allowed: false, reason: "Tunnel not configured"` |
| `tunnel.close.request`  | 只有 `requestId` + `tunnelId` 回显                               |
| `tunnel.stats.request`  | `entries: []`                                                    |
| `tunnel.create.request` | `ok: true`                                                       |

`runtime_services.go:44` 只有一个 `tunnelRecord` 类型，**没有任何代码用它**。

## 要搬的是什么

`archive/packages/server/src/server/tunnel-manager.ts`（567 行）+
`tunnel-registry.ts`（210 行）。核心是：

1. **D1 以 client 角色**经 relay 连 D2 的 serverId，复用 E2EE 与 relay v2 数据通道
   （`internal/relay` 与 `internal/e2ee` 已有）。
2. **本地 listener**：为每个白名单远端端口在本机开一个 `127.0.0.1:<动态端口>`，
   把 TCP 字节搬过去。这就是「本机浏览器访问 `http://127.0.0.1:34xxx` 即达远端服务」。
3. **端口白名单**：远端只允许转发的端口清单，超出则拒绝（错误要含 allowlist 字样）。
4. **常驻与重连**：D1 自动重连 D2；app 不在线时照常工作；D1 重启后恢复。
5. **统计**：每条隧道的字节数、连接数、状态（`connected` / `disconnected`）。

## 已有前提（不必重做）

- E2EE 握手：`internal/e2ee` 与 Node 的 `tweetnacl` 字节兼容，已测。
- Relay 通道：`internal/relay` 已完成 v1/v2 session 状态机。
- 密码鉴权：`internal/authz` 的 bcrypt + `byspace.bearer.<token>` subprotocol 已实现。
- 启用门槛（两端都设密码）：这是 063 定的护栏，翻译时保持。

## 验证方式（062 已经跑通过一遍，照抄即可）

1. 本地 relay 三层：单元 → in-process e2e → supervisor + 浏览器 GUI e2e。
2. 单机等价形态：**D1 = 本机，D2 = 本机的另一个网络命名空间或 WSL**。062 的真双机就是
   Windows D1 + WSL D2，WSL2 有独立网络命名空间，网络路径上等价于真远程机（仅共享硬件）。
   这意味着**不需要第二台物理机器**也能验证。
3. 端到端判据：`curl 127.0.0.1:<本地端口>` 返回对端服务内容且与对端内直连逐字一致；
   杀对端 daemon → 状态转 `disconnected`；恢复 → 3 秒内回 `connected`；白名单外端口被拒。

## 已知的独立问题（不是本 issue 范围）

[076](../076-x-tunnel-list-first-load-stuck-loading.md)：隧道列表首次加载卡 Loading
（RPC 直查正常，是前端查询层的问题）。翻译时如果重写列表渲染，顺手确认这条是否仍然存在。

## 参考

- Node 实现：`archive/packages/server/src/server/tunnel-manager.ts`、`tunnel-registry.ts`
  与四个 e2e（`tunnel.e2e.test.ts`、`tunnel-streaming.e2e.test.ts`、`tunnel-hardening.e2e.test.ts`、
  `tunnel.live-relay.e2e.test.ts`）
- 设计决策：`byissue/talks/006-daemon-mesh-tunnel.md`、`byissue/spec/connection.md` 的「Daemon 隧道」节
- 台账：`epics/2026-10-19-o-go-single-binary-full-parity/issues/audit-log.md`
