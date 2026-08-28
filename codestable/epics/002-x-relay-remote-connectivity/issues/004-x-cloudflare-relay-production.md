---
title: Cloudflare Relay 生产部署、滥用边界与真实链路 smoke
status: closed
kind: tracer
milestone: Epic 002
created: 2026-08-28
---

# Issue 004：Cloudflare Relay 生产部署、滥用边界与真实链路 smoke

## 为什么现在做

Epic 002 Issues 001–003 已经在本地 Wrangler、真实 Chromium、Go daemon、TypeScript client 与 Go CLI 之间证明了 Relay v2 mutual-auth E2EE 闭环。但 `packages/relay/wrangler.toml` 的 deployable artifact、公开 hostname 上实际运行的 Worker version、入口滥用保护和 production smoke 还没有形成同一条可复核证据链。

2026-08-28 的只读探测确认 `https://relay.byspace.cc.cd/health` 当前返回 `200 {"status":"ok"}` 且 DNS/TLS 由 Cloudflare 提供；当前环境的 Wrangler 未认证，无法证明该 deployment 属于本仓库当前 source/version，也不能据此宣称 production closure。

## 目标

将 repository Cloudflare Worker/Durable Object 明确部署到 `relay.byspace.cc.cd`，收紧公开入口，并用真实公网 Relay 验证 daemon/client/CLI encrypted session，而不是只检查 health。

完成后必须成立：

1. `packages/relay/wrangler.toml` 是唯一 production deploy config；custom domain、SQLite Durable Object migration、observability、workers.dev/preview exposure 与 rate-limit binding 都显式、可 dry-run 验证。
2. `/health` 只返回不含 build secret、account ID 或环境数据的稳定 JSON；非 `/ws` 路径 404。
3. Relay v2 `/ws` 在进入 Durable Object 前校验 canonical server ID，并按请求来源/role 对 WebSocket upgrade attempts 做 edge rate limiting；429 不创建或触达目标 Durable Object。
4. Durable Object 保留已有 2 MiB frame、per-connection/total pending buffer、client/socket capacity、server-assigned connection ID 和 hibernation lifecycle 边界。
5. production smoke 至少覆盖：TLS health、Relay-assigned v2 connection ID、双向 binary ciphertext forwarding、Go daemon outbound control/data、TypeScript authenticated client Agent RPC，以及 Go CLI imported target observation。
6. smoke 只使用随机 ephemeral `srv_` ID、临时 `BYSPACE_HOME` 与 fake Pi，不输出或持久化 pairing auth token；测试结束后关闭 daemon/client sockets。
7. Wrangler deploy output、deployment/version identifier、custom-domain health 和 smoke 结果写回本 Issue；凭据只通过 Wrangler login / `CLOUDFLARE_API_TOKEN` 环境提供，不进入仓库、命令行记录或日志。

## 不做什么

- 不在本 Issue 引入 Hub 账号、租户注册或付费计费。
- 不让 Relay 解密 Agent payload；Relay 仍只看到路由 metadata 和 ciphertext。
- 不在 Worker 内建立长期 daemon/client identity 数据库。
- 不以 health 200 代替 real WebSocket/E2EE smoke。
- 不删除 Relay v1 compatibility；但新的生产验证和 protection 以 v2 为主。

## 设计

### 1. Production config 与 release evidence

- Worker name：`byspace-relay`。
- custom domain：`relay.byspace.cc.cd`，由 Worker 直接作为 origin。
- Durable Object binding：`RELAY` / `RelayDurableObject`，保留 `v1` SQLite migration。
- 禁用不需要的 workers.dev 与 preview URL 公开入口，避免绕开 custom-domain policy。
- deployment 只能由 authenticated Wrangler 执行；部署前执行 package tests、typecheck、build 与 `wrangler deploy --dry-run`。

### 2. Edge admission

- v2 `serverId` 必须匹配 canonical `^srv_[A-Za-z0-9_-]{12}$`；v1 compatibility 不在本 Issue 强行改写历史 ID contract。
- Rate Limiting binding 对 `/ws` initial request 生效，key 使用 `role + CF-Connecting-IP`。Relay 暂无 Hub user identity，因此来源 IP 是当前唯一不可由 query parameter 任意轮换的 edge actor signal；阈值必须足够高以容纳 NAT 与 reconnect，同时阻止单来源持续创建新 Durable Object IDs。
- Rate limiting 是 best-effort/PoP-local admission，不替代 Durable Object 内的 hard capacity/buffer bounds。

### 3. Production smoke

分两层：

1. `packages/relay/src/live-relay.e2e.test.ts`：直接验证公开 endpoint 的 v2 control/client/data 拓扑，由 Relay 分配 connection ID，并双向转发 opaque encrypted binary frames。
2. gated production tracer：启动临时 Go daemon 指向 `wss://relay.byspace.cc.cd`，从 daemon RPC 获取 canonical v3 offer；TypeScript `DaemonClient` 完成 fresh challenge/HMAC + NaCl session 并执行 Agent turn；独立临时 CLI home 经 stdin 导入同一 offer，执行 remote `agent list` 与 canonical `timeline`。全程 fake Pi / `PI_OFFLINE=1`。

默认 test suite 不依赖公网；只有 `RUN_LIVE_RELAY_E2E=1` 时运行 live tests。

## 验收标准

- [x] Relay package unit/type/build 和 Wrangler dry-run 通过。
- [x] canonical v2 server ID validation 与 edge 429 有 deterministic unit tests，且 rate-limit rejection 不调用 `RELAY.idFromName/get/fetch`。
- [x] `workers.dev` / preview exposure、custom domain、DO migration、observability 与 rate-limit binding 在 production config 显式声明。
- [x] authenticated Wrangler deployment 成功并记录非敏感 deployment/version evidence。
- [x] `curl https://relay.byspace.cc.cd/health` 返回预期 JSON；404 与 malformed `/ws` probes fail closed。
- [x] live raw Relay v2 binary bridge smoke 通过。
- [x] live Go daemon ↔ TypeScript client Agent turn + Go CLI observation smoke 通过，wire/log/stdout 不含 prompt 或 pairing secret。
- [x] focused security/operability review 无阻塞项。
- [x] Epic/spec/README 写回完成；满足 gate 后按 standing authorization 关闭本 Issue。

## 风险验证

| 风险 | 验证 |
|---|---|
| health 属于旧/未知 deployment | authenticated Wrangler deployments/version evidence + deploy output，而非只看 hostname |
| 任意 serverId 造成 DO cardinality/cost 放大 | canonical v2 ID + source/role edge rate limiter + 429 不触达 DO test |
| public alternate hostname 绕过 custom-domain policy | config 显式关闭 workers.dev/preview，deployment inspection |
| local mock 与 Cloudflare control contract 漂移 | live test 接受 Relay-assigned ID，再连接 server data socket |
| health 正常但 E2EE data path 已坏 | full daemon/client/CLI production tracer |
| smoke 泄漏长期 pairing secret | ephemeral homes/identity、日志/stdout scan、finally teardown |
| shared NAT 被错误封锁 | 仅限制 initial upgrade、阈值留出 reconnect 余量；记录 PoP-local/best-effort 属性 |
| deploy 凭据进入仓库 | 只用 Wrangler auth/env，git/diff 与 output redaction review |

## 当前实现进展（2026-08-28）

- `cloudflare-adapter.ts` 已在 Worker entry、DO lookup 之前完成 role/upgrade/version/canonical v2 server ID validation，并通过 `RELAY_RATE_LIMITER` 以 `role:CF-Connecting-IP` 做 120 requests / 60s / PoP 的 initial-upgrade admission；limiter rejection/exception 都不触达 DO。
- `wrangler.toml` 已显式关闭 `workers_dev` / preview URLs，保留 custom domain、observability、SQLite DO migration，并加入稳定 account-local rate-limit namespace `791437345`。Wrangler 4.127.0 dry-run 已识别所有 bindings，最终 bundle 为 18.41 KiB / gzip 4.40 KiB。
- local Relay suite 已通过 72 tests（另 1 个 opt-in live skip）；既有 local E2E 已改为 canonical random `srv_` IDs。追加全链验证通过：Go vet/race、`internal/relay` race 100 轮、Windows amd64 cross-build、Web build、全 workspace typecheck/tests/lint、103 browser tests 与 Go-daemon Playwright E2E。
- `live-relay.e2e.test.ts` 已改为真实 v2 server-assigned connection ID contract，并在当前 `relay.byspace.cc.cd` 上通过双向 encrypted binary bridge。
- `go-daemon-relay.e2e.test.ts` 已加入 opt-in production tracer，并在当前公开 endpoint 上通过真实 Go daemon outbound control/data、fresh challenge/HMAC + NaCl `DaemonClient` Agent turn、stdin CLI host import、remote Agent list/Timeline 与 secret redaction，全程使用临时 homes 和 fake Pi。

## 生产部署与关闭证据（2026-08-28）

- 当前实现以 GitHub 分支 `rewrite/go-daemon` 的 commit `6d939b4806fc9c0bca96c2146f9982955b6baeda` 为唯一部署输入；仓库 Actions secret 仅注入 Wrangler 进程，没有写入 source、argv 或普通日志。
- [GitHub Actions run 33170940010](https://github.com/ByteTrue/byspace/actions/runs/33170940010) 依次通过 Relay typecheck、72 tests、protocol/Relay build、Wrangler dry-run、authenticated deploy、HTTP boundary probes 与两层 live smoke。
- Wrangler 将 `byspace-relay` version `b20690a6-41c1-47f2-80e9-b5327a51d939` 部署到 custom domain `relay.byspace.cc.cd`；deploy output 确认 `RelayDurableObject`、`RELAY_RATE_LIMITER (120 requests/60s)` 与 18.41 KiB / gzip 4.40 KiB bundle。
- post-deploy probes 确认 `/health` 为精确 `200 {"status":"ok"}`、未知路径为精确 `404 Not found`、带 WebSocket upgrade 的非法 v2 server ID 为精确 `400 Invalid v2 serverId parameter`。
- live raw bridge 1/1 通过；Go daemon + copied `DaemonClient` + Go CLI suite 2/2 通过，其中 production tracer 完成 mutual-auth E2EE Agent turn 和远程 CLI Timeline observation。
- Review 首轮发现 orphan server-data socket occupancy、缺失 dry-run/probes gate 与 secret-bearing failure diagnostic；commit `6d939b4` 分别以 live-client tag admission、完整 release gates 和 boolean redaction assertions 修复。复审结论：`No issues found`，Merge `OK`，Issue closure `APPROVED`。
- Deployment log 对 `clientAuthTokenB64`、daemon private key、`#offer=` 与 bearer credential markers 的扫描为空；测试只使用 ephemeral identity/home 和 fake Pi。

本 Issue 在 standing authorization 下关闭。Epic 002 的全部实现 Issues 已完成；Epic 级关闭仍按其规格等待用户明确确认。
