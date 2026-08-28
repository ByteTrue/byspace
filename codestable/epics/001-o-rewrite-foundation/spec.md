---
kind: epic
name: "建立 Go 重写基线"
status: open
created: 2026-08-27
---

# Epic：建立 Go 重写基线

## 做成以后是什么样

用户可以从一个新的 byspace 工作区构建 Web 和 `byspace` Go 二进制，在独立的 `~/.byspace` 启动 daemon，通过 Web 或同一二进制的 CLI 创建 Pi Agent、发送一轮任务、实时看到 Timeline，并在页面刷新或 daemon 重启后重新取得该会话。

这个结果同时证明四条后续演化都依赖的边界：复制来的 Web 能与新 daemon 协作；协议可以被 Go 精确实现和测试；Agent 生命周期不依赖某个 provider；CLI 与 daemon 可以形成可分发的产品。

**本 Epic 的完成范围：**

- 复制并建立 Paseo Web 的纯浏览器构建基线，不复制 `packages/desktop`，不生成或发布 iOS/Android 客户端。
- 保留多主机、Relay、Hub 和完整 daemon/Web 能力需要的前端类型与能力协商，不因 Pi 优先删除后续范围。
- 建立包含 daemon 与完整 CLI 的 `byspace` Go 二进制、provider-neutral Agent 边界和 Pi RPC 适配器。
- 实现首轮所需的 WebSocket、Agent、Timeline、持久化、重连和 daemon 监督能力。
- 为 Relay E2EE 做 Go 互操作夹具；为插件运行时和 Hub 来源留下有证据的后续决策，不在本 Epic 内伪装解决。

**仅本 Epic 暂不交付、但仍属于产品目标：** 生产 Relay 部署、Hub 服务部署、终端与文件二进制流、Git/Forge/Review、worktree、schedule、script、plugin、voice/push、浏览器工具和 Pi 之外的 provider。

## 当前推进

已关闭的 [`issues/001-x-paseo-baseline/`](issues/001-x-paseo-baseline/) 沿本地 Agent、远程多主机和 Hub 自动化三条路径确认了迁移现状；[`issues/002-c-web-import/`](issues/002-c-web-import/) 至 [`issues/008-x-web-workspace-provider-bootstrap.md`](issues/008-x-web-workspace-provider-bootstrap.md) 已交付并关闭 Web-only 基线、共享协议、daemon/CLI、Agent/Pi、本地 WebSocket、持久化恢复和同源 Web 闭环。Go daemon 现在同源托管 copied Web 与 local-only `/ws`，提供稳定 single-directory workspace/project、Pi provider snapshot、Agent create/send/stream/cancel/timeline、read-only CLI observation，并通过原子私有状态与 Pi resume 跨 daemon restart 保持 Agent/Timeline/dedupe/native session identity。

最后一个 foundation 缺口 [`issues/009-x-relay-e2ee-interop.md`](issues/009-x-relay-e2ee-interop.md) 已关闭：copied TypeScript Relay 与 Go 使用同一组 golden vectors，证明 Curve25519/NaCl shared key 和 XSalsa20-Poly1305 bundle 逐字节互操作。至此本 Epic 的原始交付范围、focused review 和自测均已完成；生产 Relay 与多主机连接仍属于下一 Epic。

现阶段已经确认：

1. Web 不是独立目录，而是共享 Expo 应用的 Web 平台构建；安全起点是复制整个浏览器构建闭包，再从可通过的 Web 构建向内裁剪原生依赖。
2. `packages/protocol` 与 `packages/client` 是现有 Web 的核心边界，现已与 app、relay、highlight、plugin 一起形成六 workspace 的可构建闭包；首轮保留它们作为兼容标尺，而不是同时重写前端客户端和 daemon。
3. Go daemon 必须拥有协议会话、Agent/Timeline、项目与工作区、终端、文件、Git、计划任务、插件、语音、Relay 与 Hub 客户端等完整领域；Pi 只是第一个 provider adapter。
4. 生产 Relay 和 Hub 服务分别位于外部 `getpaseo/paseo-relay` 与 `getpaseo/hub` 仓库。当前 Paseo monorepo 中的 Cloudflare Relay 是可用的 Worker/Durable Object 起点，但被上游明确标为旧部署路径。
5. 现有插件 ABI 在 Node 子进程中执行 TypeScript/TSX。保留插件能力与“daemon 核心由 Go 重写”并不矛盾，但是否允许受管理的 Node 插件 sidecar 需要单独决策，不能在首轮暗改生态契约。

## 直接切片

### 1. 固定参考行为和迁移账本（已关闭）

Explore 已关闭并保留三条触发—结果路径、组件迁移矩阵、永久排除项和高风险未知。它是后续 Issue 的范围账本，不把阶段性未实现写成永久删除。

### 2. 建立 Web-only 上游基线（已完成）

已复制 `packages/app` 的共享/Web 源码、浏览器资产以及 client/protocol/relay/highlight/plugin 最小 workspace 闭包，在 byspace 中复现浏览器静态导出。共享代码需要的 browser-safe desktop adapter 被保留；desktop/server/CLI/native app/release tooling 均未导入。

**证据：** `npm ci`、Web build、全 workspace typecheck、646 个单元/Worker test files / 5,667 个 tests、11 个 Chromium browser test files / 103 个 tests、lint、静态 HTTP smoke、namespace/scope/PWA/Relay/许可证审计通过。完整记录见 [`issues/002-c-web-import/`](issues/002-c-web-import/)。

### 3. 固定 Go 边界的协议夹具（已关闭）

语言无关的 `fixtures/protocol/v1/` 已固定首轮 JSON 消息、hello/server-info、Timeline 投影以及终端/文件二进制格式。独立的 `go/` module 避免 Go 工具误扫 npm 依赖源码，并以标准库实现所选 client JSON 信任边界、server encoder 和二进制 codec。协议兼容在首轮是降低前端改造风险的内部手段，不构成对所有 stock Paseo 客户端的永久兼容承诺。

**证据：** TypeScript 与 Go 共同消费 19 个 JSON fixtures 和 11 个二进制向量；有效、未知字段兼容、未知类型/缺字段拒绝和逐字节 binary round-trip 通过。独立 review 发现并修正 Timeline cursor / `limit: 0`、非空 client ID 与具体 status payload 测试盲区；Go race/vet、Web build、全量 typecheck、5,697 个通过的单元/Worker tests、103 个 browser tests 与 lint 均通过。

### 4. 建立 Go daemon 与 CLI 监督骨架（已关闭）

`byspace` Go 二进制使用独立的 `~/.byspace`、稳定 server ID、私有状态文件和 lifetime OS advisory lease 提供 daemon start/status/stop。status 只有在 ownership lease 已占用且 `/healthz` 身份逐项匹配时才报告 running；stop 只调用带本地随机 secret 的 `/shutdown`，不按进程名或未验证 PID 杀进程。stale record 的 PID 即使被无关活进程复用，也只在持锁复核后删除 record。

**证据：** `go vet ./...`、`go test -race -cover ./...`、30 轮并发 lifecycle stress 和 Windows cross-build 通过；真实二进制 E2E 覆盖后台/前台启停、并发 stale reclaim 单 owner、损坏 record 保留、端口冲突无遗留、未授权 shutdown 与 decoy PID 保护。独立 reviewer 首轮阻止了 check/remove 所有权竞态；改为进程全生命周期持有 `flock`/`LockFileEx` 后，两轮 focused review 均为 `OK`。全 workspace typecheck、单元/Worker tests、lint、Web production export 与 103 个 browser tests 继续全绿。该 slice 交付时尚无 `/ws`；现已由 slice 6 补齐本地 Agent WebSocket，但 Web 托管仍未实现。

### 5. 打通 provider-neutral Agent 与 Pi（已关闭）

`go/internal/agent` 现在拥有 Agent lifecycle、runtime/capability snapshot、幂等 delivery、single-flight abort 和 canonical append-only Timeline；`go/internal/provider/pi` 只负责 `pi --mode rpc` 子进程、LF JSONL 请求/事件、native session handle 与 provider-neutral event 映射。Daemon 启动时创建 manager，任意退出路径都先关闭 provider sessions 并等待进行中的 mutation。

Pi adapter 对 post-write unknown acceptance 采取 fail-closed：同步 poison/reap session，禁止旧 turn event 污染后续发送。Abort 只有在真实 `agent_settled` 后成功，且有 adapter-owned timeout；Unix process group 与 Windows suspended-start Job Object 负责完整子进程树生命周期。

**证据：** fake provider 覆盖 create/send/stream/settle、Timeline 顺序/防御性复制、并发幂等、abort/settle、provider exit、self-unsubscribe 和 shutdown mutation；helper RPC 覆盖交错 response/event、U+2028、assistant/reasoning/tool、late event、abort crash/timeout、异常 parent/descendant、stderr 和 fd 泄漏。`go vet`、全量 race、30 轮 focused stress、Windows amd64 cross-build 通过；本机 installed `pi 0.84.3` 在 offline mode 完成 `get_state` 且未发送 prompt；完整 Web 回归维持 5,697 passed / 1 skipped 和 103 browser tests。Reviewer 两轮阻止具体 P1 后，最终结论为 `No issues found / Merge OK`。详细记录见 [`issues/005-x-agent-pi-lifecycle.md`](issues/005-x-agent-pi-lifecycle.md)。

### 6. 打通本地 Agent WebSocket（已关闭）

Go daemon 现通过 local-only `/ws` 与 copied `@byspace/client` 完成 hello、能力协商、Agent fetch/create/send/cancel、canonical Timeline 分页和 live stream。Loopback peer/Host 与 browser same-origin 组成当前本地信任边界；Issue 008 已让当前完整 provider-neutral rows 满足 projected history，attachment/image、active-turn steer 和 advanced create option 继续 correlated fail-closed。

**证据：** 真实 Go binary + PATH fake Pi 的 TypeScript E2E 覆盖 hello→fetch→create→send→stream→timeline→abort→reconnect，并直接验证 daemon stop 后 provider PID 消失；Go integration 覆盖双 client broadcast、安全拒绝、超限/timeout、Timeline window 与 shutdown drain。完整 Go race、30 轮 Agent/daemon stress、Windows cross-build和完整 Web 回归通过。Focused review 的七类 P1 均修复，最终结论 `No issues found / Merge OK`。详细记录见 [`issues/006-x-local-agent-websocket.md`](issues/006-x-local-agent-websocket.md)。

### 7. 持久化 Agent/Timeline 并恢复 Pi session（已关闭）

Agent catalog、provider-neutral persistence handle、delivery dedupe 与 canonical Timeline 现以 versioned `~/.byspace/state/agents-v1.json` 保存；写入使用同目录临时文件、file sync、平台原子 replace 与 directory sync。Unix 目录/文件固定为 `0700`/`0600`；Windows 使用仅授权当前用户与 LocalSystem 的 protected DACL。损坏或访问控制非法的文件阻止 daemon 启动且不覆盖证据；replace 后 directory sync 失败会锁存 fatal persistence error、停止 provider 并拒绝后续 mutation，避免内存与已安装文件各自回滚。

Daemon shutdown 只停止 provider process，不把 Agent 领域状态永久写成 closed；重启恢复 snapshot/Timeline epoch/连续 seq 和已完成 delivery dedupe。重启前仍 active 的 turn 确定性变成 restart interruption error，不伪造 assistant completion。Pi adapter 以受 session-dir containment 和 `get_state` identity 双重校验的 `--session <nativeHandle>` 恢复；单 Agent resume 失败保留 catalog/Timeline 并隔离为 error。

**证据：** store round-trip/corruption/permission、mutation-before-visibility、pre-replace rollback、post-replace fail-stop、in-flight Create cancellation/recheck、explicit close vs daemon shutdown、active restart 与 Pi argv/identity/path tests 通过；30 轮 persistence/restart race stress、全 Go race/vet、Windows amd64 cross-build、copied `DaemonClient` 真实 daemon stop/start E2E 和完整 Web 回归均通过。Focused review 的 persistence visibility、close race、post-replace ambiguity 与 in-flight Create 盲区已逐项修复。后续 Windows mode-bit 误判由 [`issues/010-x-windows-private-agent-state.md`](issues/010-x-windows-private-agent-state.md) 修复；Agent/Relay Windows test binaries 原生执行通过，shared DACL test 10/10，复审 `Merge OK`。详细记录见 [`issues/007-x-agent-persistence-resume.md`](issues/007-x-agent-persistence-resume.md)。

### 8. 补齐 workspace/provider catalog 与同源 Web 托管（已关闭）

Go daemon 现在从 canonical launch directory 生成稳定 `prj_` / `ws_` identity，投影 Pi availability 与 dynamic empty model/mode snapshot，并从 `--web-dir > BYSPACE_WEB_DIR > <cwd>/packages/app/dist` 同源托管 Web 与 `/ws`。Rooted filesystem access、SPA fallback、current-origin hint、no-listing/cache、缺失 index fail-closed 和 local WebSocket origin 边界已有 focused tests。Copied Web 启动需要但未交付领域能力的 config/icon/checkout/terminal/setup 查询只返回 schema-valid disabled/empty 响应。

Read-only `byspace agent list` / `timeline [--follow]` 通过 `/ws` 观察事实；follow 使用 bounded canonical cursor pagination/reconciliation，不直接读 state file，也不依赖 best-effort live queue。

**证据：** 真实 browser tracer 用 Go binary + deterministic fake Pi 覆盖 SPA、自动 workspace/provider bootstrap、create/stream/idle、refresh、daemon stop/start、Pi resume 续写与并发 CLI follow；超过 2MiB、含单个 >1MiB row 的 300-row CLI Timeline 验证有限分页、完整单 row 与连续 seq。Go vet/race、30 轮 daemon/protocol/CLI stress、Windows amd64 cross-build、copied client E2E 与完整 Web build/typecheck/unit/lint/103 browser tests 均通过。Focused review 阻止并修复 flag order、wildcard dial、best-effort gap/final tail 和 unbounded frame 四类问题，最终 `Merge OK`。

已验证的最终验收路径为：

```text
byspace daemon start
→ 打开 Web 并选择临时项目
→ 创建 Pi Agent 并发送提示词
→ Web/CLI 同时看到流式结果并结束为 idle
→ 刷新 Web、重启 daemon
→ 重新连接并看到同一 Agent 与已持久化 Timeline
```

### 9. 固定 Relay E2EE 的 Go↔TypeScript 互操作（已关闭）

[`issues/009-x-relay-e2ee-interop.md`](issues/009-x-relay-e2ee-interop.md) 穿刺了远程连接里失败代价最高的密码兼容边界：`fixtures/relay/e2ee-v1.json` 固定公开测试 key、tweetnacl `box.before` shared key、24-byte nonce、UTF-8/binary plaintext 与 XSalsa20-Poly1305 authenticated bundle，由 copied TypeScript 与 Go 共同消费。Go `internal/relay` 使用 `golang.org/x/crypto v0.55.0`，先以 X25519 拒绝 low-order peer，再调用 NaCl precomputation；短包与认证篡改 fail closed。

**证据：** TS fixture contract 4/4、Go race package 与 100 轮 focused race 通过；全 Go vet/race、Windows amd64 cross-build、5,702 passed / 1 skipped 的完整单元/Worker tests、Web build/typecheck/lint、103 browser tests 与真实 Go-daemon tracer 全绿。独立 focused review 无 P0/P1/P2，结论 `No issues found / Merge OK`。本切片没有实现 Relay socket、pairing、key persistence 或 Cloudflare deployment。

### 10. 修复 Windows Agent state 私有 ACL（已关闭）

[`issues/010-x-windows-private-agent-state.md`](issues/010-x-windows-private-agent-state.md) 修复了 Issue 007 的跨平台运行时缺口：Windows 不再以无意义的 `Mode().Perm() == 0600` 判断私有状态，而以 current-user owner、current-user + LocalSystem allow ACE、protected DACL、非 reparse point 与正确文件类型验证。Agent 与 Relay 现在复用 `go/internal/privatepath`，Unix 规则保持不变。

**证据：** 全 Go vet/race 与 Windows cross-build通过；Agent/Relay focused race 30/30；交叉编译出的 Windows Agent 与 Relay suites 经原生 `cmd.exe` 运行通过，shared DACL test 10/10；Go-daemon Playwright 2/2；独立 reviewer 无 P0/P1/P2，结论 `Merge OK`。

## 目标架构约束

- **前端协议先兼容、后演化。** 首轮让 Go daemon 适配复制来的 Web；只有当新契约能减少长期复杂度且有迁移测试时，才协同修改两端。
- **provider-neutral ownership。** Agent manager 与 Timeline 不能读取 Pi 私有事件；每个 adapter 映射到公共生命周期，并容忍未知上游事件。
- **能力协商而非删类型。** 尚未实现的领域由 daemon feature/capability 明确为不可用；不能从 Vision、迁移账本或前端模型中抹掉。
- **一个用户动作只有一个事实源。** Agent/Timeline 在 daemon，外部 workflow 在 Hub，传输会话在 Relay，主机聚合在 Web/CLI；不要让 Relay 或 Hub 复制 daemon 领域状态。
- **安全边界先于远程便利。** 文件路径包含、进程所有权、WebSocket 鉴权、Relay E2EE、Hub grant 都必须在相应能力上线前被测试。

## 质量承诺与风险穿刺

| 风险                                                               | 概率 / 影响 | 本 Epic 的最小验证                                                                 |
| ------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------- |
| 复制 Web 时过早删除共享 native/desktop adapter，导致浏览器构建断裂 | 高 / 高     | 先复制完整 Web 构建闭包并建立绿色基线，再按 import graph 删除                      |
| Go 实现偏离庞大的 JSON/二进制协议                                  | 高 / 高     | TS↔Go golden fixtures、畸形输入测试、能力协商                                      |
| Pi 私有语义泄漏到 Agent manager，堵死后续 provider                 | 中 / 高     | provider-neutral interface + fake provider contract tests                          |
| Timeline 流式顺序、重连或落盘丢失                                  | 高 / 高     | live/restart/reconnect 一条端到端路径和持久化夹具                                  |
| Relay 加密选错原语而无法互操作                                     | 中 / 高     | 用 Go 实现 NaCl `box.before`/XSalsa20-Poly1305 golden vectors，不用裸 X25519 替代  |
| 插件能力被“纯 Go”口号意外删除                                      | 高 / 高     | 在进入插件 Issue 前决定兼容 sidecar 还是版本化新 ABI；本 Epic 不宣称无 Node 运行时 |
| 误读或污染现有 Paseo home                                          | 低 / 高     | 默认只使用 `~/.byspace`；如以后需要迁移，另做显式、单向导入                        |

## 已确认的项目决策

- 产品、二进制和代码标识使用 `byspace`。
- daemon 数据只写入 `~/.byspace`，不直接兼容或共享 Paseo home；若以后需要历史迁移，另做显式单向导入。
- CLI 与 daemon 使用同一个 Go 二进制；现有 TypeScript CLI 仅作为行为与测试标尺。

以下事项不阻塞首轮本地闭环，将在对应 Epic 决定：Hub 是 fork/adapt `getpaseo/hub` 还是重写；插件是否允许受管理的 Node sidecar；Relay 是否保留 v1 客户端兼容。

## 关闭判断

上述本地 Pi 路径已被真实运行验证，Relay E2EE 的 Go↔TypeScript golden vectors 已逐字节互操作，Web/Go 全量测试可重复，迁移账本未静默删除既定能力，文档也已按实际实现更新。全部 Issues 已关闭，本 Epic 已满足技术关闭条件，保持 open 等待用户对 Epic 本身的明确关闭确认。
