---
kind: issue
title: "穿刺 Standalone WSS Data Relay"
type: feature
status: closed
created: 2026-08-20
---

# 穿刺 Standalone WSS Data Relay

## 做成以后是什么样

一个进程内 standalone Node WSS Relay 能在不依赖 Cloudflare Worker/Durable Object 的情况下，实现 Relay v2 的 server-control、client data、server data 配对，并让现有 BySpace E2EE client/daemon channel 双向传递密文消息。

该穿刺只证明数据载体和 adapter 边界。最终部署决定为：由任意 BySpace daemon 通过独立监听端口托管该 adapter，不创建独立产品、安装包或镜像。它不实现 Remote Web Service 映射、Service Proxy、持久化、RPC 或 UI。

## 当前结构问题

- 当前生产 Relay 的会话配对实现在 Cloudflare Durable Object adapter 中，状态与 WebSocket hibernation API 耦合。
- Remote Web Service 的 AI SSE 等高频数据即使合并帧，经过共享免费 Durable Object 仍无法提供不会触发账号级操作上限的承诺。
- daemon 已经具备 Relay v2 控制 socket、按 connection id 建立 server data socket，以及 E2EE channel；需要证明 standalone 实现能复用这些客户端边界，而不是重新设计传输或加密协议。
- 历史 `origin/human-seahorse` 证明了单连接 E2EE 数据 bridge，但依赖 Cloudflare Relay、逐帧 ACK 和浏览器 session 生命周期，不能整体复用。

## 穿刺边界

### 必须证明

1. Standalone Relay 提供 `/health` 和 `/ws`，只接受 Relay v2。
2. 一个 target server-control 注册后，多个 client 能获得独立 connection id；Relay 通知 target 建立匹配的 server-data socket。
3. client/server-data 配对后，文本与二进制 WebSocket message 双向透明转发。
4. 现有 `createClientChannel` / `createDaemonChannel` 能通过该 Relay 完成 E2EE 握手并交换应用消息。
5. 一端关闭、超时或超过缓冲/会话限制时，另一端被有界关闭，Relay 不无限缓存。
6. Relay stop 会关闭 listener 和所有活动 socket，不遗留 timer 或 handle。
7. Relay 不读取、记录或持久化 E2EE 应用正文。

### 明确不做

- Remote Web Service 协议、HTTP/SSE/WebSocket proxy、daemon 配置、映射存储或 UI。
- TLS 证书自动化、Cloudflare Tunnel 自动部署、账号系统或计费。
- Relay v1、Cloudflare adapter 替换、控制 Relay 迁移或旧 daemon fallback。
- 将历史通用 TCP/TUN 功能带回主线。

## 设计约束

- 优先在 `packages/relay` 增加 Node adapter，复用现有 package 的 `ws` 依赖和 E2EE tests；只有证据表明部署或依赖边界不成立时才拆 workspace。
- Relay session 以 `serverId` 为内存键；server-control、等待配对的 client 和 server-data socket 都必须有总量与单 session 上限。
- 不在 client 与 server-data 配对前缓存任意应用消息；连接只在 counterpart ready 后进入转发状态，或使用严格的小上限并证明必要性。
- 慢端通过 WebSocket `bufferedAmount` 高水位失败关闭，不建立无限用户态队列。
- 记录连接生命周期和计数，不记录 message payload。
- Node adapter 与 Cloudflare adapter 共享协议常量/解析器时，只提取真正相同的最小纯逻辑；不为了形式统一重写现有生产 adapter。

## 验证

- `packages/relay` 定向单测覆盖 health、参数校验、control sync、连接配对、双向 text/binary、duplicate/replacement、disconnect、limit、backpressure 与 stop。
- 一个真实本地 WebSocket E2E 使用现有 E2EE client/daemon channel 完成握手并交换消息。
- `npx vitest run <changed relay test files> --bail=1` 通过。
- `npm run typecheck`、`npm run lint`、`npm run format` 与 `npm run format:check` 在代码变化后通过。

## 关闭时

- 回写 Epic：确认 standalone adapter 的 package/入口边界、Relay v2 兼容结论、资源限制和后续 daemon locator 所需字段。
- 如果 E2EE 或 Relay v2 无法复用，保留失败证据并回到 Epic 重新设计；不以半成品继续堆 Remote Web Service。
- 本 Issue 完成后不自动关闭；等待用户授权收尾。

## 实现证据

已实现 `packages/relay/src/standalone-adapter.ts`，并导出为 `@bytetrue/byspace-relay/standalone`。

实现范围：

- 只实现 Remote Web Service 所需的 Relay v2 `/ws` 角色；
- 在内存中维护 server session 和 client/server-data pairing；
- 不解析应用正文，透明转发 text/binary frame；
- 兼容已有 `sync`、`connected`、`disconnected`、`ping`、`pong` 控制消息；
- 限制 session、connection、frame、待配对消息和物理 WebSocket 缓冲；
- 超时关闭未配对 client；
- 提供 `GET /health`；
- stop 会关闭活动 socket，且可重复调用；
- 可选 access token 在 WebSocket upgrade 前鉴权，健康检查保持可探测；
- adapter 由 daemon 生命周期托管，但 Data Relay listener 与完整 daemon API 保持物理端口隔离。

验证结果：

- `packages/relay/src/standalone-adapter.test.ts`：10 个真实 WebSocket 测试通过；
- 覆盖 health、无效参数、target 缺失、connection limit、pair timeout、disconnect、双向 text/binary、backpressure、control replacement、现有 E2EE channel 互通和 graceful stop；
- 与 `packages/relay/src/cloudflare-adapter.test.ts` 一起运行通过；
- `npm run build:relay:clean` 和 Relay package typecheck 通过。

穿刺结论为通过。

## 重新打开原因

PR #1 的安全复核发现 standalone Relay 尚不能视为完成：共享 token 不绑定 `serverId` 所有权，任意 token 持有者可以替换其他 daemon 的 control session；单 session 上限也缺少 relay-wide socket 与 aggregate-buffer 总预算。该攻击主要影响可用性，但必须明确并验证其信任模型，不能继续以“无遗留事项”关闭。

本 Issue 在重新打开期间要求：

- 明确 Data Relay bandwidth token、daemon 身份和 Remote Web Service 来源授权之间的边界；
- 对 control replacement 的跨身份行为给出实现约束与负向测试；
- 增加 relay-wide 连接与待转发字节总预算，避免逐 session 上限相乘；
- 与 Issue 002 的 E2EE 来源授权和 replay protection 一起完成复审。

当前修复已完成实现与定向测试：活动 control/data socket 不再允许同 token 连接替换；Relay 新增全局 physical socket 与 aggregate buffered-byte budget；公开 HTTP 与 Upgrade handler 对 malformed request target 返回 400 而不会让进程退出；文档明确共享 token 仍是可用性信任域，而目标端 source grant、双向长期 daemon 公钥身份、目标新鲜 challenge 和 sequence replay protection 才是 loopback 数据安全边界。

## 关闭结论

Standalone adapter 的 Relay v2/E2EE 兼容、daemon-hosted 独立 listener、全局与单会话资源预算、活动 socket replacement 拒绝、malformed request target 防护和共享 token 信任边界均已实现并有负向测试。完整 backend/security 独立复审没有剩余 finding；CI run `32353615653` 的 Relay、Linux/Windows server、typecheck、lint、format 与 distribution jobs 全部通过。

稳定结论已回写 Epic，并随 Epic 毕业到 `codestable/spec/index.md` 的“私有远程 Web 服务”章节。没有遗留项需要移出本 Epic。
