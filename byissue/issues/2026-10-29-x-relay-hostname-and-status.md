---
kind: issue
title: "下线 relay.byspace.cc.cd，并让 daemon status 报实时 relay 而不是配置"
type: bug
created: 2026-10-29
---

# relay 域名收敛与 status 说真话

两件事在同一次切换里做完：一个多余的 hostname，一个报告错误事实的命令。

## 一、`relay.byspace.cc.cd` 下线

**为什么多余。** Worker 在 `app.byspace.cc.cd` 上就同时服务 PWA 和 `/ws`（`run_worker_first`），
`relay.byspace.cc.cd` 是同一 Worker 的第二个 hostname、同一个 Durable Object namespace 的第二个入口。
配对 offer 本来就假设页面和它的 relay 同源。

**改了什么。**

- `DEFAULT_RELAY_ENDPOINT`（protocol）、`hostedRelayEndpoint`（Go）两处默认值 → `app.byspace.cc.cd:443`
- `workers/relay/wrangler.jsonc` 只声明 `app.byspace.cc.cd`（+ beta 的 `app-beta`）；重新部署后
  Cloudflare 释放该 custom domain
- 文档四处、测试期望值、`scripts/prove-relay-prod.mjs` 同步

**代价（owner 明确接受）**：老版本 daemon 的 config / 配对 offer 里存着旧地址，下线后它们连不上，
且无法自动恢复。这是基础设施地址而非协议字段，按「不做兼容」处理。

**已知遗留**：`prerelease` 的 relay 仍部署在 `app-beta.byspace.cc.cd`（独立 namespace，用于验证 relay
改动），但不再是任何 daemon 的默认值。是否连它由显式 endpoint 决定。

## 二、`daemon status` 报的是配置，不是实况

**症状。** `byspace daemon start --relay wss://app-beta.byspace.cc.cd/ws` 之后，`daemon status` 打印
`relay wss://relay.byspace.cc.cd:443` —— 与它实际连接的地址不同。

**根因。** `reportRelayStatus` 只读磁盘上的 `config.json`，从不问运行中的 daemon。而 `--relay` 覆盖
只存在于进程内（`SetRelayOverride`），不写回 config，所以两者必然分叉。

我先前的推断「config watcher 把 override 覆盖了」是**错的**：实测关掉其它 daemon、只留带 `--relay`
的那个 90 秒，beta 的 DO namespace 增加 0.011 GB-s、production 只增 0.002 —— override 一直生效，
错的是 status 的输出。

**改法。** `/health` 增加 `relay` 段，携带 `enabled` / `endpoint`（配置）/ `connected`（最后一次成功
拨号到达的地址），由 `relayRuntime` 在 `ConnectRelay` 拨号成功后记录。CLI 优先用 `/health` 的答案；
「配置了但从未连上」单独成一种输出，与「已连接」区分。daemon 太老、`/health` 没有这段时回落到读
config 的旧路径。

## 验证

- `relay.byspace.cc.cd/health` → **530**（路由已释放）；`app.byspace.cc.cd` 的 `/`、`/health`、`/docs/`
  → 200，`/ws` 握手 OPEN
- 本机 daemon 换 endpoint 后重连成功，浏览器经 relay 打开真实 workspace，侧栏数据完整
- `daemon status` 现在打印 `relay wss://app-beta.byspace.cc.cd (override)` —— 与实际连接一致
- 守卫：`TestHealthReportsTheLiveRelayEndpoint`、`TestHealthOmitsConnectedWhenTheDialNeverSucceeded`；
  反向核对（撤掉 `/health` 的 `relay` 段）后前者变红
- `scripts/relay-worker.test.mjs` 10/10，断言只剩两个 hostname，且 `relay.` 不再出现

## 沉淀去向

- **`byissue/spec/connection.md`**：relay 默认地址改为 app origin；`relay.` 的退役理由；beta relay 的定位。
- **`docs/architecture.md` / `docs/release.md` / `docs/docker.md` / `docs/development.md`**：地址与部署目标同步。
- 「status 读配置而不是读运行态」这类缺陷与 `publicEndpoint` 那次同源，留在本文作证据，不另立 note。
