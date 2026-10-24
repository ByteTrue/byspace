---
kind: issue
title: "tunnel 移植：Go 侧 Tunnels 页面目前完全是死的"
type: feature
created: 2026-10-22
---

# tunnel 移植

归属 Epic：`byissue/epics/2026-10-22-x-node-to-go-functional-port`。

## 这不是新功能

[062](../../../issues/062-x-daemon-tunnel.md) 已于 2026-10-09 交付并**通过真双机实测**：
Windows D1 + WSL D2 + 公网 CF relay，建隧道 → `curl 127.0.0.1:65379` 拿到对端内容 →
杀对端后 3 秒自动恢复。[063](../../../issues/063-x-tunnel-experimental-gate.md) 补了实验性
门控与自托管 relay 支持。

（上一轮 Epic 把这条判成 `DROPPED`，理由「需要两台机器」。那个理由错了两次：062 已经验证过，
且 WSL2 有独立网络命名空间，等价于真远程机——验证从来不需要第二台物理机器。）

## 现状

`internal/server/ws_git_system.go` 的五个 `tunnel.*` handler 全是硬编码桩：

| RPC                     | 现在返回                                                         |
| ----------------------- | ---------------------------------------------------------------- |
| `tunnel.list.request`   | `entries: []`                                                    |
| `tunnel.open.request`   | `remotePort: 0, allowed: false, reason: "Tunnel not configured"` |
| `tunnel.close.request`  | 只有回显                                                         |
| `tunnel.stats.request`  | `entries: []`                                                    |
| `tunnel.create.request` | `ok: true`                                                       |

`runtime_services.go:44` 有个 `tunnelRecord` 类型，**没有任何代码用它**。

## 要实现的

`archive/packages/server/src/server/tunnel-manager.ts`（567）+ `tunnel-registry.ts`（210）

- `session/tunnel/tunnel-session.ts`（552）+ `cli/ssh/ssh-tunnel.ts`（90）。

核心机制：

1. **D1 以 client 角色经 relay 连 D2**，复用 `internal/e2ee`（与 Node 的 tweetnacl 字节兼容）
   与 `internal/relay` 的 v2 数据通道。
2. **本地 listener**：每个白名单远端端口在本机开 `127.0.0.1:<动态端口>`，搬运 TCP 字节。
3. **端口白名单**：超出则拒绝，错误要含 allowlist 字样。
4. **常驻与重连**：D1 自动重连；app 不在线照常工作；D1 重启后恢复。
5. **统计**：字节数、连接数、`connected` / `disconnected` 状态。
6. **启用门槛**（063）：两端 daemon 都设了密码才启用，服务端强制。
7. **`ssh://`**：`-H ssh://user@host` 自动建 SSH 端口转发。

## 测试策略

按 spec 的规则：**能测的都测，测不了的部分仍然要写实现并注明条件。**

| 层                                      | 能否测           | 怎么做                                                              |
| --------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| 端口白名单判定                          | 能               | 纯函数单测                                                          |
| 本地 listener 建/拆                     | 能               | 起一个 `net.Listen`，断言端口可连、close 后可复用                   |
| 字节搬运（经内存 pipe 伪造 relay 通道） | 能               | 用一个假的 stream 接口，注入 `internal/relay` 的等价双向流          |
| D1↔D2 完整握手                          | 能（in-process） | 两个 `Server` 实例 + 内存 relay，不碰网络                           |
| 重连（杀对端）                          | 能（in-process） | 关掉一侧的 stream，断言状态转 `disconnected` 再恢复 `connected`     |
| 真双机 / WSL 跨网络命名空间             | 本机不具备       | **实现照写**，记录为 `PORTED-UNVERIFIED`，写明需要 WSL 或第二台机器 |

## 验收

- in-process 双实例端到端：建隧道 → 本地端口取到对端字节 → 杀对端 → 状态转 `disconnected`
  → 恢复 `connected`。
- 白名单外端口被拒。
- `npm run audit` 出站对账 0 缺口（`tunnel.*` 的响应字段全部真实填充）。

## 参考

- Node 实现 + 4 个 e2e：`archive/packages/server/src/server/tunnel*`
- 设计：`byissue/talks/006-daemon-mesh-tunnel.md`、`byissue/spec/connection.md` 的「Daemon 隧道」节
- 已知独立问题：`076-x-tunnel-list-first-load-stuck-loading.md`（前端列表首次加载，不是 RPC）
