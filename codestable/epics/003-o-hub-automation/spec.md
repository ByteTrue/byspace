---
kind: epic
title: "接入 Hub 自动化控制平面"
type: feature
status: open
created: 2026-08-28
---

# 接入 Hub 自动化控制平面

## 做成以后是什么样

用户可以把一台 byspace daemon 授权给 `hub.byspace.cc.cd` 或自托管 Hub。Hub 持有组织、项目、不可变配置修订、触发收据、workflow/execution 状态、允许的结果与外部集成凭据；daemon 继续独占主机文件、workspace/Agent/Timeline 事实、coding provider 进程和 provider 凭据。

一条最小自动化链路是：人工或外部事件产生 durable run，Hub 向已授权 daemon 下发一个 execution-scoped Agent，请求中只授予精确的 MCP completion capability；Agent 在主机本地运行并显式调用 `finish_execution` 后，Hub 才把 execution/workflow 持久化为 terminal。网络、Hub 或 daemon 重启不会重复创建 Agent、重复 prompt 或越权扩大工具权限。

## 当前基线与源码策略

- Epic 001 已交付 Go daemon/CLI、Agent/Timeline/persistence 与 copied Web；Epic 002 已交付 direct + Relay 多主机访问。Relay 是不可信零知识 transport，不承载 Hub control traffic。
- copied `@byspace/protocol` 与 `@byspace/client` 已保留 Hub relationship management 及 `hub.execution.*` wire schema；当前 Issue 已在 Go daemon/CLI 实现 relationship management、私有 authority store 与 direct Hub socket，execution envelopes 仍未接入 Agent。
- Paseo Hub 外部实现已审计并固定在 commit `8eac5f3536a4e0d9afaaf09986ca3d49b7fd53be`；对应 daemon/CLI 参考固定在 `a8734a972495cf343f628d1017e87775767aade5`。
- Hub 是 Apache-2.0、Node 22 + TanStack/Zod + Drizzle + PostgreSQL/PGlite 的独立服务，已有 durable receipt/lease/execution、tenant authority、daemon generation fencing、deadline recovery、execution-scoped MCP、two-phase completion/archive 以及跨仓 E2E fault tests。
- **本 Epic 采用 fork-and-adapt，不用 Go 重写 Hub。** Go 约束属于主机 daemon 与统一 CLI；重写独立 Hub 会先重造数据库事务和失败语义而不增加用户价值。首版保留当前进程内 worker 和单实例 registry，不引入 queue/workflow framework/service mesh。
- byspace Hub 使用独立仓库、数据目录、环境变量、包/镜像与部署命名，保留 upstream history、Apache attribution、lockfile、测试和 provenance。首轮冻结 `hub.execution.*` 与必要的 `x-paseo-daemon-id` 为 protocol-v1 compatibility namespace，避免同时替换 daemon 与改 wire。

## 不可妥协的边界

1. **事实所有权不漂移。** Hub 只保存 workflow/execution evidence 与 Agent 投影；canonical Agent/Timeline、文件、workspace 和 provider session 留在 daemon。
2. **人和 daemon 身份分离。** 人类 CLI credential 只属于规范化 Hub origin，不进入 daemon；短期单次 enrollment token 只用于建立 daemon relationship；daemon relationship secret 只在 daemon 本地持有，Hub 只存 verifier。
3. **Hub 是可信控制层，不是 Relay。** Hub 可以看到 prompt、选定路径、状态和允许的结果；它不得获得 coding provider credential 或任意主机文件。Hub traffic 直接连接 daemon，不并入 Relay。
4. **显式完成，不以 idle 冒充成功。** Automation 只有 execution-scoped `finish_execution` 通过 token、schema、deadline 与 tenant checks 后才能成功；Agent turn idle/completed 不是 workflow completion。
5. **工具权限精确且 fail closed。** daemon 只有在 provider 能证明同一 create request 中的 MCP server 与精确 tool preapproval 时才返回 `toolPolicyApplied: true`；unsupported 不能降级为 ambient `--no-approve`、shell/edit/write 或 daemon 代调 completion。
6. **幂等与恢复。** `(authenticated daemonId, executionId)` 是 durable ownership key；重连、response-loss、Hub/daemon restart 不重复 Agent/prompt。旧 socket generation 不得完成新请求。
7. **源代码与生产声明可追溯。** fork provenance、上游测试、schema fixtures、migration 和 deploy evidence 必须可重放；relationship-only preview 不得宣称 Hub automation 已打通。

## 实施切片

### 1. Hub relationship private-preview tracer（当前推进）

[`issues/001-o-hub-relationship-tracer.md`](issues/001-o-hub-relationship-tracer.md) 只打通人类 device login、私有 credential、单次 enrollment token、trusted local management RPC、daemon durable relationship、same-authority direct WebSocket、status/restart/reconnect/revoke。Go relationship 实现与 `ByteTrue/byspace-hub` provenance-controlled fork 已落地，正在通过真实 browser/PGlite/PostgreSQL、cross-repository 与多平台 gates；它不下发 Agent，不改变 provider，也不构成 automation 完成。

### 2. Exact-policy provider 与 execution tracer（后续）

先做有界安全审计，判断 Pi 是否能真实支持 per-execution MCP injection 与精确 tool preapproval；审计允许结论为 unsupported。若不能证明，则优先拉通 upstream 已有 exact-policy evidence 的一个 provider（当前候选 Codex），再实现 execution ownership/create/validate/control/update/stream、response-loss recovery 与真实 `finish_execution` tracer。

Epic 只有在至少一个真实 provider 完成“manual run → exact preapproval → execution-scoped `finish_execution` → durable terminal result”后，才可宣称 Hub automation 主链路成立。

### 3. Fork branding、自托管与生产部署（后续）

保留自托管与托管产品路径；使用 PostgreSQL 17、单个常驻 Node 22 process、显式 migration/backup/restore、同 authority HTTPS + WebSocket。PGlite 只用于单进程本地开发。初期不宣称水平扩展，因为 active daemon registry 仍在进程内。

### 4. Triggers 与 workflow 扩展（后续）

在 execution 事实和权限边界稳定后，再逐步接入 GitHub/Slack/Discord、schedule、多步 workflow、表达式、跨步输出和 integration marketplace；不删除 upstream 成熟实现与测试，但不把它们混入前两个 tracer 的完成声明。

## 质量目标

- **安全性：** credential/token/verifier/idempotency key/MCP bearer 不进入日志、普通输出、Agent projection 或不相关持久化；私有文件在 Unix 使用 `0700/0600`，Windows 复用 protected DACL seam。
- **可靠性：** pending-before-enroll、active-before-dial、bounded jitter reconnect、generation fencing、revocation races、shutdown leak 与 restart recovery 均有 deterministic tests。
- **兼容性：** fixture-backed Go decoders 与 forked Hub、pinned upstream oracle 双向验证；未知 additive fields 遵守固定 wire 契约而非任意更严或更松。
- **可维护性：** Hub 不复制 Agent manager，daemon 不复制 workflow engine；relationship、execution、provider-policy 三层独立推进。
- **可部署性：** fork provenance、license/attribution、lockfile、migration、container、health/readiness 与 post-deploy authenticated smoke 都有证据。

## 明确不在首个 Issue

- 配置 deploy、manual run、execution Agent create/control；
- MCP、toolPolicy 或任何 provider 改动；
- GitHub/Slack/Discord、schedule、多步 workflow、billing；
- worktree、attachments、任意 env secrets、native tool grants；
- Hub production deploy、水平 replicas、Kubernetes/外部 queue；
- wire namespace 重命名和 stock Paseo compatibility 承诺。
