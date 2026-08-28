---
kind: epic
title: "打通 Relay E2EE 远程连接与多主机控制"
type: feature
status: closed
created: 2026-08-27
---

# 打通 Relay E2EE 远程连接与多主机控制

## 做成以后是什么样

用户在一台运行 byspace daemon 的主机上取得 pairing offer，把 URL 交给任意浏览器里的 Web/PWA 后，这个浏览器就能经 `relay.byspace.cc.cd` 进入该主机；同一个 Web 可以同时保存和切换多台 daemon。用户能远程查看 Agent、发送任务、实时接收 Timeline，并在浏览器、daemon 或 Relay 短暂断线及 daemon 重启后恢复到同一主机和同一 Agent。

Relay 只看到随机路由标识、连接生命周期和密文字节，不持有 daemon 私钥、provider 凭据、项目内容或 Agent 明文。CLI 也能使用同一 pairing identity 访问远程 daemon，而不是建立第二套远程协议。Cloudflare Relay 有仓库内可验证、可部署的 byspace 自有实现。

## 当前基线

- [`issues/001-x-relay-v2-agent-tracer.md`](issues/001-x-relay-v2-agent-tracer.md) 已关闭：Go daemon 拥有稳定 Relay identity、authenticated v3 pairing offer、outbound Relay v2 control/data runtime 和 daemon-side E2EE adapter；direct 与 remote 进入同一个 Agent session dispatcher。
- copied `@byspace/client` / `@byspace/relay` / Web HostRuntime 已保存并使用 `clientAuthTokenB64`，以 fresh challenge + HMAC proof 双向认证 channel；authenticated pairing 强制双方提交并确认 binary-ciphertext capability，不允许 plaintext downgrade。按 copied channel contract，text logical frame 使用 base64 ciphertext text wire，binary logical frame 使用 raw binary wire。
- 跨语言 E2E 已由 copied `DaemonClient` 经忠实 local Relay v2 harness 访问真实 Go daemon，覆盖 Agent create/send/live Timeline、Relay/daemon restart、Pi resume、wire privacy、auth/replay/tamper negative cases。
- [`issues/004-x-cloudflare-relay-production.md`](issues/004-x-cloudflare-relay-production.md) 已关闭：`packages/relay` 的 Cloudflare Worker + Durable Object 已从 GitHub branch 的精确 commit 经 authenticated Wrangler deploy 发布到 `relay.byspace.cc.cd`；server-assigned connection ID、pre-DO rate limiting、frame/byte/socket budgets、orphan server-data rejection、custom-domain-only exposure 与 Wrangler dry-run/deploy/live smoke 均有生产证据。
- [`issues/002-x-web-multi-host-relay-tracer.md`](issues/002-x-web-multi-host-relay-tracer.md) 已关闭：copied Web 在真实 Chromium 中同时运行 direct daemon A 与 Relay daemon B，经真实 offer fragment import、Hosts/project UI、production E2EE transport 和 Cloudflare Wrangler Relay 验证了 host 隔离、远程 Agent、reload、Relay/daemon restart 与 Pi resume。
- Web host registry 的初始加载与 placeholder migration 采用共享 single-flight；新 offer 持久化必须等待该加载完成，避免旧异步快照覆盖新 authenticated host。连接状态以 host-scoped accessible status 呈现，不用全局错误污染仍在线的其它主机。
- [`issues/003-x-go-cli-remote-target.md`](issues/003-x-go-cli-remote-target.md) 已关闭：Go CLI 可通过 stdin/私有文件导入 canonical v3 offer，以独立原子 registry 保存 trust material，并让 `agent list` / `timeline [--follow]` 经共享 mutual-auth E2EE transport 显式访问 remote host；跨语言 E2E 已覆盖 wrong token/key/identity 和 Relay/daemon restart。
- [`issues/005-x-relay-session-lifecycle-hardening.md`](issues/005-x-relay-session-lifecycle-hardening.md) 已关闭：daemon data session 对瞬时 dial failure 做 context-bound capped-jitter retry，`disconnected`/`sync`/shutdown 等待 generation teardown；duplicate intent、backoff cancellation 和 same-ID replacement 有 deterministic fault/race tests。

## 不可妥协的边界

1. **端到端加密与双向认证。** 业务 frame 只在 Web/CLI 与 daemon 端解密；client 以已知 daemon public key 认证 daemon，daemon 以 Relay 不可见的 pairing secret + fresh challenge 认证 client。Relay 永远不获得业务明文、pairing secret 或长期 private key。
2. **稳定但可识别的信任。** daemon keypair、client-auth secret 和 `serverId` 在同一 `BYSPACE_HOME` 内稳定，损坏时 fail closed，不能静默换 key/secret 让既有 pairing 漂移或失效。
3. **同一应用协议。** direct `/ws` 与 Relay E2EE 进入同一 hello/session dispatcher；不复制第二份 Agent RPC 业务逻辑。
4. **Relay v2 优先。** 新 Go transport 只实现 copied Web 当前的 v2 control/data 模式；v1 不作为新代码兼容承诺。
5. **本地安全不降级。** outbound Relay 不放宽本地 `/ws` 的 loopback 与 same-origin 边界，也不把 daemon 直接暴露到公网。
6. **元数据最小化。** Relay 可见 `serverId`、短生命周期 `connectionId`、大小与时序；pairing offer 本身是 capability，日志不得输出 daemon private key、client key 或解密 payload。
7. **有界资源。** control/data socket 数量、handshake、frame、queue、retry/backoff 和 shutdown 都必须有明确上限；未知 control message、非法 key、篡改、重复/过期 connection ID fail closed。
8. **不伪造生产完成。** local fake Relay、crypto fixture 或 Worker unit test 都不能单独宣称 `relay.byspace.cc.cd` 已部署；部署、域名、TLS 和真实 Cloudflare smoke evidence 必须分别记录。

## 实施切片

### 1. Relay v2 remote Agent tracer bullet（已关闭）

[`issues/001-x-relay-v2-agent-tracer.md`](issues/001-x-relay-v2-agent-tracer.md) 已建立持久 daemon Relay identity、pairing offer、outbound v2 control/data runtime、daemon-side E2EE channel，以及 direct/remote 共用的 session dispatcher。copied `@byspace/client` 已经忠实 local Relay v2 harness 对真实 Go daemon 完成 Agent list/create/send/timeline/restart E2E。

### 2. Web/PWA 多主机配对与恢复（已关闭）

[`issues/002-x-web-multi-host-relay-tracer.md`](issues/002-x-web-multi-host-relay-tracer.md) 已用 copied Web 的真实 offer import、connection store 和 HostRuntime 同时连接 direct daemon A 与 Relay daemon B；host 切换、canonical Timeline、page reload、Relay 原页自动重连、daemon B restart/Pi resume、secret 非泄漏和 teardown liveness 均有 browser-level 证据。实现只修复了实际暴露的 registry load/migration race，并补充 host-scoped accessible status，没有重写多主机层。

### 3. Go CLI 远程目标（已关闭）

[`issues/003-x-go-cli-remote-target.md`](issues/003-x-go-cli-remote-target.md) 已让现有 `byspace agent list` / `timeline` 显式选择独立私有 registry 中的 remote connection，复用相同 Relay v2、mutual-auth E2EE transport、pairing identity 和 daemon session protocol；offer 只从 stdin/私有文件导入，不进入 shell history、process argv 或普通日志。local-default 语义、secret redaction、wrong trust/identity、Relay/daemon restart 与 Pi resume 都有跨语言证据。

### 4. Cloudflare Relay 部署与运行边界（已关闭）

[`issues/004-x-cloudflare-relay-production.md`](issues/004-x-cloudflare-relay-production.md) 已将 Worker/Durable Object config、SQLite migration、pre-DO admission、capacity/buffer limits、health/404 diagnostics 和 GitHub Actions release gate 固定在仓库中。Commit `6d939b4` 经 authenticated Wrangler 发布为 Worker version `b20690a6-41c1-47f2-80e9-b5327a51d939`；production dry-run、custom-domain HTTP boundaries、raw v2 binary bridge 与 full daemon/client/CLI mutual-auth E2EE smoke 全部通过，部署日志未发现 credential/pairing secret markers。

### 5. 远程生命周期硬化（已关闭）

[`issues/005-x-relay-session-lifecycle-hardening.md`](issues/005-x-relay-session-lifecycle-hardening.md) 补齐了最后一个已知 transport liveness 缺口：`connected` 后第一次 data-socket dial 的瞬时失败不再永久丢失 client，而在同一 tracked generation 内以 10s attempt timeout 和 100ms→5s capped full-jitter backoff 重试。只有 network、408/425/429/5xx 会重试；其它 HTTP 与 E2EE authentication failure 继续 fail closed。

`disconnected`、stale `sync` 和 shutdown 会取消 dial/timer/socket并等待 `session.done`；capacity release、generation map removal 与 done signal 的顺序阻止 same-ID overlap/lost replacement。结合 Issues 001–003 已有的 control reconnect、Relay/daemon restart、bounded queue/frame、multi-client、slow-consumer cancellation 与 process teardown E2E，远程 lifecycle 当前承诺已有闭环证据。

**证据：** deterministic fault harness 覆盖 503→retry attach、backoff cancellation、duplicate notification、runtime Close 和 teardown-barrier generation replacement；focused Relay race 100/100、全 Go vet/race、Windows cross-build、client Relay E2E、Relay unit suite与 production Web 2/2 Playwright tracers通过。Focused review 首轮三个 P1 全部修复，复审 `Merge OK`。

## 质量目标与证据

- **功能适合性：** copied Web 与 Go CLI 都能经 Relay 完成 Agent 主路径；direct path 保持等价。
- **信息安全性：** 对主动恶意 Relay 仍保持零知识；fresh challenge + HMAC client authentication 阻止 Relay impersonation 和 recorded-hello replay；identity 损坏、invalid peer、tamper 与 plaintext downgrade fail closed；pairing/key 文件权限和原子性有 tests。
- **可靠性：** daemon/Relay/browser restart 后 connection 与 Timeline 可恢复；重试有 jitter/backoff，shutdown 可终止全部 sockets/goroutines。
- **性能效率：** 无每条 frame 的无界 goroutine；queue 和 frame 上限明确，密文 overhead 与 base64 legacy path 有预算。
- **兼容性：** TS client ↔ Go daemon E2E 与真实 Cloudflare Worker smoke 双重证明 Relay v2；不能只测自制 mock 的两端。
- **可维护性：** direct 与 remote 复用一个 protocol dispatcher；transport、E2EE、routing 和 Agent 领域边界清晰且没有 speculative plugin framework。

## 明确不在本 Epic

- Hub 的授权关系、外部事件和 workflow execution；
- terminal/files/Git/Forge 等尚未进入 Go daemon 的业务领域；
- 其它 provider 适配；
- 对公网直接开放 daemon `/ws`，或设计非 Relay 的 LAN/VPN 认证协议；
- 原生桌面或移动客户端；
- Relay v1 长期兼容。

这些都不等于从产品范围删除，只是不混入本次 Relay 多主机闭环。

## 关闭与毕业

用户于 2026-08-28 明确确认关闭本 Epic。Copied Web 与 Go CLI 已能经 byspace 自有 Cloudflare Relay 访问真实 Go daemon；E2EE/identity/reconnect/多主机隔离已有跨语言与真实部署证据，direct path 无回归，Issues 001–005 均已通过 focused review、自测与规格写回后关闭。

稳定成果已具体毕业到 [`../../spec/index.md`](../../spec/index.md) 的“远程连接与 Relay 当前契约”：同一 direct/remote daemon protocol、pairing trust、host-scoped state、零知识 Relay metadata boundary、resource/lifecycle bounds、production release gate，以及 Relay 与 Hub 的职责分界均可独立阅读。Vision 的产品目标未改变；其演化地图只更新本 Epic 的已完成状态与历史链接。Hub 授权自动化、terminal/files/Git 等范围仍留给后续 Epic。
