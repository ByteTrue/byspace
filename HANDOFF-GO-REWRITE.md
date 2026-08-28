# Go Agent Handoff：独立域名下继续 daemon 重写

> 更新时间：2026-08-29
>
> 读者：新机器上的 Go 线 Agent
>
> 负责分支：`ByteTrue/byspace` 的 `rewrite/go-daemon`
>
> 主协调者：Node 主 Agent。涉及 main、现有生产域名、Cloudflare 或 `byspace-hub` 共享仓库时，先与主 Agent 对齐。

## 1. 最新战略变化

用户决定并行维护两条产品线：

- **Node `main`**：直接跟随上游 Paseo 最新 beta，作为日常使用版本；保留现有生产域名。
- **Go `rewrite/go-daemon`**：继续独立重写，但必须使用新的 Go 专用域名，不能再占用 Node 线现有 hostname。

这意味着：

1. Go 分支不是下一次 `main` reset 的基础，也不要跟随 Node main 做机械 merge/rebase。
2. Node main 即将从上游真实 tag/history 重建；Go 只按需要审查并移植协议或 Web 变化。
3. 当前 Go Relay 虽已部署到 `relay.byspace.cc.cd`，但该 hostname 现在应归 Node 线。Go Agent 下一项基础设施工作是建立独立域名并迁移所有默认值、测试和部署配置。
4. Desktop/Electron 与原生 iOS/Android 仍永久不属于 Go 产品；Web/PWA、CLI、Relay、多主机、Hub 和 provider 仍在范围内。

先读同分支的 `HANDOFF-NODE-MAIN.md`，了解工作区、归档 CS 和跨线约束。

## 2. 仓库与版本快照

### Go 主仓库

- GitHub：`git@github.com:ByteTrue/byspace.git`
- 分支：`rewrite/go-daemon`
- handoff 前实现 tip：`b38f4ffc5f826eea1680d0f8743fbcd409ecc920`
- tip commit：`feat: add Hub relationship private preview`
- 该分支在当时的 `main` v0.6.1 source tree 上另有 7 个聚合 commits；后续 main force-reset 不应改变本分支。
- Go module：`go/`
- 当前 module path：`byspace`，Go `1.25.0`
- TypeScript/Web 使用 Node 24 CI 环境和 npm workspaces。

### Hub fork

- 本地应单独 clone：`ByteTrue/byspace-hub`
- `main`：`37090cff35d4c6a4f6711e8648c387d5126de98d`
- upstream 基线：`getpaseo/hub` @ `8eac5f3536a4e0d9afaaf09986ca3d49b7fd53be`
- 包/二进制：`@byspace/hub` / `byspace-hub`
- 数据目录：`BYSPACE_HUB_DATA_DIR` 或 `$XDG_DATA_HOME/byspace-hub`，默认 `~/.local/share/byspace-hub`
- 容器目标：`ghcr.io/bytetrue/byspace-hub`

Hub 仓库当前是共享协调点。除非 Node 主 Agent 明确分配 branch/worktree，不要与其他 Agent 同时写它。

## 3. 当前产品链路

已经打通的纵向链路：

```text
Web/PWA / Go CLI
        │ local WebSocket or Relay v2 E2EE
        ▼
Go daemon
        │
        ├─ Agent manager / canonical Timeline / atomic state
        ├─ Pi RPC subprocess + native session resume
        ├─ workspace/provider bootstrap + static Web hosting
        ├─ Relay daemon control/data sessions
        └─ Hub relationship control connection
```

数据与权限归属：

- Go daemon 持有 workspace、Agent、Timeline、provider process 和本地凭据真相。
- Relay 只转发密文，不知道 prompt、模型输出或认证 secret。
- Hub 当前只管理授权关系；没有权力直接执行 host 工具。
- Hub workflow/lease/receipt 将来属于 Hub，但实际 Agent/文件/工具执行仍归 host daemon。
- Go 本地状态固定隔离在 `~/.byspace` 或显式 `BYSPACE_HOME`。

## 4. 已完成的实现

### 4.1 Epic 001：Go foundation

主要目录：

- `go/internal/protocol`：TypeScript ↔ Go JSON/binary fixture parity。
- `go/internal/daemon`：supervisor、HTTP、WebSocket、static Web、catalog、Relay/Hub runtime。
- `go/internal/cli`：daemon、agent、pair、host、hub 命令。
- `go/internal/agent`：provider-neutral lifecycle、Timeline、subscription、持久化。
- `go/internal/provider/pi`：`pi --mode rpc` subprocess adapter。
- `go/internal/privatepath`：Unix mode 与 Windows protected DACL。

已完成：

- `byspace daemon start/status/stop`、PID ownership、advisory lock、health/shutdown。
- Agent create/send/cancel/list/timeline RPC 和 live stream。
- Timeline cursor epoch/seq、pagination、dedupe、并发 shutdown。
- `~/.byspace/state/agents-v1.json` 原子保存与 restart recovery。
- Pi `--session` resume、进程树清理、Windows Job Object。
- Web static assets、SPA fallback、动态 daemon connection 注入。
- workspace/project/provider bootstrap responder。
- `byspace agent list` 与 `agent timeline --follow`。
- Windows state/credential protected DACL 和 reparse-point 防护。

### 4.2 Epic 002：Relay remote connectivity（已关闭）

主要目录：

- `go/internal/relay`
- `go/internal/daemon/relay_runtime.go`
- `go/internal/daemon/relay_socket.go`
- `packages/relay`
- `packages/client/src/daemon-client-relay-e2ee-transport.ts`
- `packages/app/src/runtime/host-runtime.ts`

已完成：

- Relay v2 control/data socket contract。
- X25519 + XSalsa20-Poly1305 E2EE。
- pairing offer v3、HMAC-SHA256 client challenge-response。
- strict endpoint/key/server ID validation。
- nonce sequencing、replay/tamper rejection。
- Web direct + Relay 多主机 registry、切换、reload/reconnect。
- Go CLI `host import/list/remove` 及 `agent ... --host`。
- daemon restart 后远程 Agent 与 Pi session 恢复。
- Cloudflare Worker rate limit、frame/buffer/capacity bounds。
- production live bridge 与 daemon/client/CLI smoke。

当前生产 Relay：`relay.byspace.cc.cd`。它技术上由本分支实现并已验证，但最新产品决策把该域名归 Node 线；见第 7 节迁移要求。

### 4.3 Epic 003 Issue 001：Hub relationship private preview

Go 实现：

- `go/internal/hub/origin.go`：HTTPS/loopback origin、HTTP/WS authority validation。
- `go/internal/hub/store.go`：relationship/identity/enrollment 私有原子存储。
- `go/internal/hub/credentials.go`：origin-scoped human credential store。
- `go/internal/hub/api.go`：device authorization 与 enrollment token API。
- `go/internal/hub/remote.go`：enroll/revoke/connect HTTP+WebSocket transport。
- `go/internal/hub/manager.go`：状态机、reconnect、revocation、generation fencing。
- `go/internal/cli/hub.go`：`hub login/connect/status/disconnect`。
- `packages/client`：Hub management client API。

关键安全不变量：

- 人类 CLI credential、10 分钟单次 enrollment token、daemon relationship credential 严格分离。
- daemon 只上传 relationship secret 的 SHA-256 verifier；raw secret 留在 private storage。
- verification URL、HTTP redirect、WebSocket endpoint 必须同 authority。
- malformed/corrupt/cross-origin credential/relationship 文件进入 quarantine，不静默忽略或覆盖。
- graceful disconnect 先持久化 `disconnecting`，Hub 离线时重试远端 revoke；force 才本地立即清除。
- Hub management RPC 只允许 local loopback WebSocket；Relay remote client 不能调用。
- 当前 Hub socket 收到 execution frame 会明确关闭：`Hub execution protocol is not enabled`。
- `hub.execution.*` dispatch、MCP 注入、tool policy 均不属于 Issue 001。

## 5. 暂停点与验证状态

### 5.1 Hub Issue 001 技术状态

实现、focused review 和 CI 已通过，但 CodeStable 文件仍是：

```text
codestable/epics/003-o-hub-automation/issues/001-o-hub-relationship-tracer.md
```

暂停前 reviewer 结论：`No issues found / Merge OK`。最后一个 blocker（pending enrollment 转 durable disconnecting 时残留 pending-only 字段）已修复并有回归测试。

Hub fork GitHub CI：

- Run：`33187755315`
- URL：`https://github.com/ByteTrue/byspace-hub/actions/runs/33187755315`
- 10/10 jobs success：test、release-check、migrations、Docker smoke、browser E2E、source-built daemon E2E、relationship E2E。

因此恢复工作后，先审查当前 SHA 未漂移，然后：

1. 把 Issue 001 implementation/test/review evidence 回写完整；
2. 将 `001-o-...` 改为 `001-x-...`；
3. 更新 Epic 003 和 `codestable/spec/index.md`，但不要误写为 Hub workflow execution 已完成。

### 5.2 旧机器上的环境型失败

不要把以下情况当成已知产品 bug：

- Playwright 精确 Chromium 下载在旧机器网络上卡住，已停止。
- 本地系统 Chrome 151 跑 browser suite 时 80 tests 通过、2 个 project activation 测试超时；GitHub CI 的受控浏览器 job 全绿。
- Hub 本地 `npm test` 曾因 Docker Hub 拉 `postgres:17-alpine` connection reset 失败；GitHub `test` job 已通过。

新机器应先用项目 lockfile/CI 要求安装受控 browser；不要循环下载或用系统 Chrome 的偶发结果覆盖 CI 证据。

## 6. 常用验证入口

从 `go-rewrite` worktree：

```bash
# Go
cd go
go vet ./...
go test -race ./...

# Windows cross-build（只编译；不尝试执行 Windows test binary）
GOOS=windows GOARCH=amd64 go test -exec=true ./...

# Web/TypeScript
cd ..
npm ci
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build:web
npm run test:browser

# Go daemon browser tracer
npm run test:e2e:go-daemon
```

Focused cross-language tests：

```bash
npm test --workspace=@byspace/client -- src/go-daemon.e2e.test.ts
npm test --workspace=@byspace/client -- src/go-daemon-relay.e2e.test.ts
```

Hub fork：

```bash
npm ci
npm test
npm run release:check
BYSPACE_E2E_BINARY=/absolute/path/to/byspace npm run test:e2e:byspace-relationship
```

不要在没有明确生产授权时设置 `RUN_LIVE_RELAY_E2E=1` 或运行 deploy workflow。

## 7. 第一优先级：给 Go 线建立独立域名

### 7.1 当前域名不能继续由 Go 占用

以下 hostname 现在按用户决策归 Node main：

- `app.byspace.cc.cd`
- `relay.byspace.cc.cd`
- `hub.byspace.cc.cd`

Go 专用域名尚未最终命名。可以向用户/Node 主 Agent 提议：

- `go.byspace.cc.cd`
- `relay.go.byspace.cc.cd`
- `hub.go.byspace.cc.cd`

但这只是候选。不要自行创建 DNS、覆盖 custom domain 或复用现有 Cloudflare project。

### 7.2 推荐迁移顺序

1. 与主 Agent/用户确认 Go app、Relay、Hub 三个 hostname。
2. 为 Go 线创建独立 Cloudflare Pages/Worker/Hub deployment resources、GitHub environments 和 secrets；不要复用会覆盖 Node 目标的 project name。
3. 先部署新 Relay endpoint，运行 HTTP boundary、binary bridge、Go daemon ↔ TS client ↔ Go CLI live E2E。
4. 更新 pairing offer、Web HostRuntime、CLI defaults 和文档到新 Go endpoint。
5. 部署新 Go Web hostname，再验证 direct + Relay multi-host 浏览器 tracer。
6. Hub execution 尚未实现；若先迁移 relationship tracer，则在新 Hub hostname 完成 login/connect/restart/disconnect E2E。
7. 只有 Node 主 Agent 确认接管旧 hostname 后，才移除或重定向旧 Go deployment 配置。

### 7.3 必须审计的引用

使用：

```bash
rg -n 'app\.byspace\.cc\.cd|relay\.byspace\.cc\.cd|hub\.byspace\.cc\.cd' \
  --glob '!node_modules/**' --glob '!packages/app/dist/**'
```

至少涉及：

- `packages/relay/wrangler.toml`
- `.github/workflows/deploy-relay.yml`
- `go/internal/cli/pair.go`
- `go/internal/daemon/pairing.go`
- `packages/protocol/src/connection-offer.ts`
- `packages/protocol/src/daemon-endpoints.ts`
- `packages/client/src/go-daemon-relay.e2e.test.ts`
- `packages/relay/src/live-relay.e2e.test.ts`
- App pairing/host UI 与 multi-host E2E
- README、Vision、Project Spec、Epic 002/003 historical docs

历史规格中的旧域名可以保留为历史证据，但当前配置、默认值、测试目标和运行说明必须明确区分 Node/Go。不要做无差别全仓替换。

`.github/workflows/deploy-relay.yml` 当前只有 `workflow_dispatch`；在改到 Go 专用 Worker/custom domain 前禁止手动运行。

## 8. 距离 Go 线可日常使用还差什么

### 8.1 最近的 dogfood 门槛

1. **真实 Pi 任务**
   - 目前 installed Pi 只做过 offline/get-state smoke；大量 E2E 使用 `fixtures/pi/fake-rpc.mjs`。
   - 需用用户真实 credential 验证 prompt、工具调用/权限、cancel、重启和 session resume。
2. **安装/发布**
   - Go module path 从临时 `byspace` 改成最终公开 path。
   - 生成 Linux/macOS/Windows binary、checksum/signature、版本和升级/卸载路径。
   - 决定 Web dist 嵌入 binary 还是随包安装；目前主要从磁盘 `packages/app/dist` 托管。
   - daemon service/autostart 尚未产品化。
3. **Go 专用 Web 生产入口**
   - Pages/static hosting、版本兼容、缓存和 rollback。
4. **项目管理 UX**
   - 当前 catalog 主要映射 daemon launch directory；需正常添加/删除/切换多项目。
5. **核心开发环境**
   - 文件浏览/读写/传输、Terminal、Git/Diff、权限请求等仍需要真实 daemon service，而不是空/default bootstrap responder。

这些完成后才适合用户日常真实工作；当前状态是安全、完整的 tracer/foundation。

### 8.2 完整产品范围

仍需多个 Epic：

- Provider parity：Codex、Claude Code、OpenCode、ACP 等；当前真正实现的是 Pi。
- Terminal、文件服务、Git/worktree、Forge/Review。
- scripts、schedules、plugins、MCP、Agent 协作。
- 生产诊断、迁移/升级、崩溃恢复和多平台 runtime E2E。
- 用户明确保留的 Web 可承载体验；继续永久排除原生 Desktop/iOS/Android。

### 8.3 Hub automation

Issue 001 只完成 relationship。后续必须先解决：

- provider exact tool/MCP preapproval；
- execution-scoped MCP server injection；
- `hub.execution.*` dispatch；
- 显式 `finish_execution` terminal result；
- durable lease/receipt/retry；
- triggers；
- Go 专用 Hub 部署与 self-host path。

在 exact policy 能力完成前，不得让 Hub 驱动 Agent 或本地工具，也不能把“Agent idle”当成 workflow success。

## 9. 分支与协作规则

- 只在 `go-rewrite` worktree 写 `rewrite/go-daemon`。
- Node 主 Agent 独占 `node-main`；不要给它提交 Go branch merge。
- `archive-cs` 由主 Agent 只读审计；Go 线当前 CodeStable 与旧 Node fork CS 是两套不同文档。
- `byspace-hub` 每次只允许一个 writer；先由主 Agent 分配。
- Go 线仍可复用 copied Web packages，但上游 beta 变化按功能/协议小切片审查，不整体替换。
- 所有新 wire 字段保持 optional/feature-gated，并继续做 TS ↔ Go fixture/E2E。
- 所有 credential/state 继续使用 `internal/privatepath`；不得通过 argv、URL query、日志或 JSON output 泄漏。

## 10. 建议恢复后的任务顺序

1. 验证两个仓库 SHA、工作树与 CI run。
2. 完成 Hub Issue 001 CodeStable 关闭回写。
3. 与 Node 主 Agent 确定 Go 专用 app/relay/hub 域名和 Cloudflare project 名。
4. 在不触碰旧域名的前提下迁移 Go Relay，并跑 live E2E。
5. 建立 Go binary + Web assets 的可安装 dogfood artifact。
6. 跑一次真实 Pi 凭据任务闭环。
7. 创建“项目管理 + 核心文件/Terminal/Git”Epic，而不是继续添加空 responder。
8. 再推进 exact-policy provider 与 Hub execution tracer。

## 11. 不要做的事

- 不要把 Node main reset 合并到 Go branch。
- 不要运行仍指向 `relay.byspace.cc.cd` 的 Go production deploy。
- 不要自动把旧域名 CNAME 到 Go 新域名。
- 不要把 Hub relationship complete 写成 Hub automation complete。
- 不要允许 Relay client 调用 local-only Hub management。
- 不要在 provider 无 exact preapproval 时接收 Hub execution。
- 不要把 fake Pi E2E 当成真实 credential dogfood 验收。
- 不要恢复 Desktop/Electron/iOS/Android 代码。
