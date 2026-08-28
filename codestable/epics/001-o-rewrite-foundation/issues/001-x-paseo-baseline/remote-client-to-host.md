# 远程浏览器如何安全到达某一台主机

## 一句话模型

多主机是客户端保存多个独立 daemon runtime；直连和 Relay 是到某个 runtime 的两种运输方式；Relay 只路由 WebSocket 字节，真正的主机认证与内容保密由 Web/CLI 和 daemon 之间的持久 daemon 公钥及临时 E2EE 会话完成。

## 多主机不是服务端集群

Web 保存多个 host profile。每个 profile 持有稳定 `serverId`、一个或多个连接方式与首选项，运行时为每台 host 建独立 client、snapshot、目录和 Timeline replica。跨主机页面可以聚合展示，但 daemon 之间不自动同步项目、标签或 Agent。

因此 Go 重写必须把 `serverId` 和 `workspaceId` 当作不透明身份，前端缓存也必须按 host 隔离。Relay 无权合并主机，Hub 也不替代这个客户端责任。

## Relay v2 的连接路径

1. daemon 用稳定 `serverId` 向 Relay 打开一个 outbound control WebSocket。
2. Web/CLI 用同一 `serverId` 以 client role 连接 Relay。
3. Relay 分配不透明 `connectionId`，通过 control 消息通知 daemon。
4. daemon 再为该 ID 打开 data WebSocket；Relay 把一对 data/client socket 的帧按原 WebSocket text/binary opcode 转发。
5. 客户端发送临时 Curve25519 公钥；daemon 用本地持久 keypair 回应 `e2ee_ready`。之后普通 daemon 协议才进入加密通道。

Relay 看得到连接元数据，但不应看到 Agent、终端或文件内容。它不解析 daemon JSON，不终止 E2EE，也不负责用户授权。

## 加密和帧契约

现有实现使用 NaCl `box.before` 兼容的共享密钥与 XSalsa20-Poly1305；每帧是 24 字节随机 nonce 加密文。Go 不能用裸 X25519 输出或 ChaCha20-Poly1305 作为“差不多”的替代。协商后，应用 text 作为 base64 的 WebSocket text frame，应用 binary 作为原始密文 binary frame；Relay 必须保留 opcode，否则终端和文件流会损坏。

配对 offer 放在 URL fragment，包含 server ID、daemon public key、Relay 公网 endpoint 与 TLS 选择。fragment 不会发给正常 app server，但提供 app 页的一方仍处于配对信任路径。

## Cloudflare 目标

Paseo monorepo 的 `packages/relay` 已有 Worker + Durable Object v1/v2 实现，可作为 `relay.byspace.cc.cd` 的最短起点。不过现有 Wrangler 配置绑定 Paseo 账户、域名和 upstream，当前所有请求会被转发到外部 Relay；迁移时必须使用 byspace Cloudflare 账户、移除 upstream，并验证 DO hibernation、同时客户端、daemon 重连、缓冲上限、大帧与二进制保真。

生产 Paseo Relay 位于外部 `getpaseo/paseo-relay` Elixir 仓库。没有读过该仓库和做黑盒互操作前，不能把 legacy Worker 宣称为生产等价。

## 证据入口

- `SECURITY.md`
- `docs/architecture.md`
- `public-docs/connectivity.md`
- `packages/protocol/src/daemon-endpoints.ts`
- `packages/relay/src/crypto.ts`
- `packages/relay/src/encrypted-channel.ts`
- `packages/relay/src/cloudflare-adapter.ts`
- `packages/relay/wrangler.toml`
- `packages/server/src/server/relay-transport.ts`
- `packages/server/src/server/daemon-keypair.ts`
- `packages/server/src/server/connection-offer.ts`
- `packages/client/src/daemon-client-relay-e2ee-transport.ts`
- `packages/app/src/runtime/host-runtime.ts`
