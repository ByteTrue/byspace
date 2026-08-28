---
kind: issue
title: "打通 Hub 授权关系 private-preview tracer"
type: feature
status: open
created: 2026-08-28
---

# 打通 Hub 授权关系 private-preview tracer

## 做成以后是什么样

用户在 Go CLI 发起一次 Hub device login，在浏览器由 owner/admin 明确批准后，CLI 只接收一次 origin-scoped 人类 credential，并以它申请十分钟有效、单次消费的 daemon enrollment token。CLI 只把 `{origin, token}` 经可信本地 `/ws` management RPC 交给 Go daemon；daemon 持久化自己的 relationship authority、向 Hub 提交 credential verifier，并建立 same-authority authenticated WebSocket。

`byspace hub status` 能无敏感信息地显示 relationship 状态；daemon 重启后使用相同 daemon identity/credential 自动重连；`byspace hub disconnect` 必须先确认远端 revoke 再清理本地 authority，Hub 不可达时保留 authority 并明确报错，只有显式 `--force` 才允许仅本地删除。

**本 Issue 只证明 control-plane relationship private preview。** 不发送 `hub.execution.*` Agent 请求，不实现 MCP/tool policy，不宣称 Hub automation 已完成，Epic 003 保持 open。

## 为什么现在做

copied protocol/client 已定义 `hub.management.daemon.connect/get_status/disconnect` 与 Hub execution envelopes，但 Go daemon 没有实现 `hubRelationship` feature，也没有 Hub authority store/runtime/CLI。外部 Hub 已有成熟 enrollment 和 daemon WebSocket endpoint；先建立真实、持久、可撤销的 relationship，可以隔离 identity/lifecycle 风险，而不把尚未解决的 Pi exact-policy blocker 偷渡进同一个 Issue。

当前 byspace Pi adapter 不支持 execution-scoped MCP server injection 或精确 tool preapproval。Hub 的成功边界依赖 Agent 调用 `finish_execution`；把 turn idle/completed 当成功、删除 toolPolicy、daemon 自动代调 completion，均不允许作为本 Issue 的简化。

## 范围与实现路径

### Hub fork/provenance

- 以外部 Hub commit `8eac5f3536a4e0d9afaaf09986ca3d49b7fd53be` 为 audited source，记录 machine-readable provenance、Apache-2.0 attribution、lockfile 与修改清单。
- 首轮保留 Node 22/TanStack/Drizzle/PostgreSQL/PGlite 架构和上游测试；不做 Go rewrite、service split 或 broad redesign。
- 用户可见品牌、package/image、运行目录与环境变量使用 byspace namespace；daemon-facing protocol-v1 identifiers 暂时冻结。
- 独立 fork 已在用户授权继续推进后创建为 `ByteTrue/byspace-hub`；本地工作树 `/home/zijie-wsl/workspace/forks/hub` 的 `main` 跟踪该 fork，并保持完整 upstream history。

### 人类 CLI credential

- 实现 `byspace hub login [origin]` 的 device authorization start/poll；输出 verification URL/user code，但 credential 只保存一次。
- 实现 origin 精确规范化：生产只允许 HTTPS；仅 loopback local development 可用 HTTP；拒绝 credentials/query/fragment 和 authority drift。
- 人类 credential 独立存放，不进入 daemon relationship record；目录/文件复用 `privatepath` 的 Unix `0700/0600` 与 Windows current-user + LocalSystem protected DACL。
- `hub connect/status/disconnect` 普通与 JSON 输出不得包含 API key、enrollment token、daemon secret/verifier 或 WebSocket credential。

### Daemon relationship

- 实现 copied `hub.management.daemon.connect/get_status/disconnect` trusted-local RPC 与 `hubRelationship: true` feature；remote Relay session 不得拥有 Hub management namespace。
- pending record 在 enrollment HTTP 前原子持久化；同 origin pending retry 复用 daemon ID、relationship secret 和 idempotency key，不同 origin fail closed。
- enrollment 只发送 SHA-256 verifier；响应必须匹配 daemon ID、精确包含 `hub.execution.*` scope，且 WebSocket protocol/host 与 normalized Hub origin 一致。
- active transport 在 dial 前持久化；socket 使用 daemon ID header + raw relationship credential，并以有界 exponential jitter 重连。
- socket `401/403` 或 close `4403` 进入 sanitized revoked record；不保留 raw credential、token 或 idempotency key。
- startup 对 corrupt/widened-scope/cross-origin/unsafe record fail closed 并隔离原文件；不得静默覆盖。
- shutdown 取消 HTTP、retry timer 和 socket并等待退出；disconnect/revoke/new generation 不能被旧 callback 恢复 authority。

## 实施记录（进行中）

- Go 侧已新增 `go/internal/hub`：严格 origin 规范化、Hub HTTP device/enrollment/revoke client、Unix/Windows 私有 atomic credential/relationship stores、pending-before-enroll manager、same-authority WebSocket、bounded jitter reconnect、`Retry-After` admission、401/403/4403 sanitized revoke、restart reuse、可恢复的 interrupted revocation 与同步 teardown。
- daemon 已持有并关闭 Hub manager，local `/ws` 已实现三条 `hub.management.daemon.*` RPC；只允许 direct loopback client，Relay data session fail closed；server handshake 宣告 `hubRelationship: true`。
- 统一 Go CLI 已新增 `byspace hub login/connect/status/disconnect`，人类 credential 位于独立 `state/hub-cli-credentials-v1/<origin-hash>.json`，daemon authority 位于 `state/hub-relationship-v1.json`，普通与 JSON 输出均不投影 secret。
- copied protocol/client 已新增 `hubRelationship` feature 及 typed Hub management methods；Go/TypeScript fixture tests 固定 correlation、response shape 与 disconnected baseline。
- `ByteTrue/byspace-hub` fork 已新增 `UPSTREAM.json`、fork policy、Apache/provenance/vulnerability 记录，改用 `@byspace/hub` / `byspace-hub` / `BYSPACE_*` / `byspace-hub` data root，并保留 `hub.execution.*` 与 `x-paseo-daemon-id` compatibility identifiers。
- fork 已新增 browser-level cross-repository tracer `e2e/byspace-relationship.spec.ts`，驱动真实 Go CLI/daemon 完成 login → enroll → connected → daemon restart/reconnect → revoke，并扫描 CLI/daemon output 与持久化隔离。

## 验收与验证

### A. Provenance baseline

- [ ] 固定 upstream Hub/daemon commits、clean-tree hash、license/attribution 与 lockfile。
- [ ] 从干净 source 通过 install/build/unit/integration/built-server/foundation E2E；container image 可构建。
- [ ] 记录依赖 vulnerability 输出和明确 exception，不伪称完全无风险；不删除/弱化上游 tests。

### B. Wire/HTTP conformance

- [ ] fixture 覆盖 device login poll states、enrollment、status/revoke 与 Hub envelopes；Go decoder 对 required IDs、frame bounds、correlation、malformed frame fail closed。
- [ ] HTTP status/response shape/bearer/15s bounds 与 pinned Hub oracle 一致；fork 与 pinned source 均通过 conformance。
- [ ] local management RPC 仅 trusted local session 可调用；Relay/browser/Hub socket不能反向调用 management namespace。

### C. Secret 与 authority separation

- [ ] 人类 credential 只绑定 normalized origin且不进入 daemon；enrollment token 十分钟过期、单次消费。
- [ ] credential/token/verifier/idempotency key 不出现在 logs/errors/status/CLI output/Agent projection；tests 扫描持久化和日志。
- [ ] 私有存储覆盖 Unix permissions、Windows DACL、symlink/reparse/TOCTOU 和 atomic replace uncertainty。
- [ ] production HTTPS、same-authority `wss`、精确 `hub.execution.*` scope 均 fail closed。

### D. Lifecycle fault matrix

- [ ] pending-before-enroll、active-before-dial、同 origin idempotent retry、different-origin conflict。
- [ ] transient enrollment/socket failure bounded backoff；401/403/4403 permanent sanitized revoke。
- [ ] old generation fencing、replacement、response-after-disconnect、disconnect-vs-enroll race。
- [ ] daemon restart reconnect 使用同 relationship；force/non-force disconnect 语义与 warning 可观察。
- [ ] goroutine/socket/timer/HTTP teardown 无 leak；race stress 与 Windows runtime 验证通过。
- [ ] 用真实 forked Hub/PGlite 完成 login → enroll → connected → daemon restart → reconnect → revoke E2E；PostgreSQL container integration 覆盖同一路径。

## 质量承诺

- **功能适合性：** 一个真实人类授权关系可建立、查询、恢复和撤销。
- **信息安全性：** 人、enrollment 与 daemon credential 三类 authority 不混用，Hub 只得到 verifier。
- **可靠性：** 所有持久化与 network phase 有明确顺序、generation 与 restart 语义。
- **兼容性：** 以 pinned upstream source 为 oracle，不靠自制 mock 双端自洽。
- **简单性：** 不提前实现 execution/provider/trigger；只复用现有 `privatepath`、daemon dispatcher 与 mature WebSocket library。

## Closure gate

本 Issue 通过 Gates A–D 和 focused review 后可作为 relationship private preview 关闭。它不授权关闭 Epic 003；在真实 provider 完成 exact MCP/tool preapproval 与 execution-scoped `finish_execution` 前，Hub automation 必须继续标为未完成。
