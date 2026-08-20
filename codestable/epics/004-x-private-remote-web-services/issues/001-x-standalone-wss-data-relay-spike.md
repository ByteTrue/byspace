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

## 关闭结论

- 判断：Standalone Node WSS Relay 已证明能够复用 Relay v2 与现有 daemon 间 E2EE channel；daemon-hosted 独立 listener 的部署边界成立，不需要新产品、安装包或镜像。
- 质量证据：真实 WebSocket 测试覆盖鉴权、会话配对、text/binary 双向转发、E2EE 互通、连接/消息/缓冲限制、背压、超时、断开和 graceful stop；后续双 daemon 真机链路也使用了同一 adapter。
- 回写位置：稳定的控制面/数据面分离、daemon-hosted listener、E2EE 与资源边界已回写本 Epic，并随 Epic 毕业到 `codestable/spec/index.md` 的“私有远程 Web 服务”。
- 遗留事项：无本 Issue 阻断项；TLS 终止与公网入口继续属于部署环境，不扩展 Relay 产品范围。
