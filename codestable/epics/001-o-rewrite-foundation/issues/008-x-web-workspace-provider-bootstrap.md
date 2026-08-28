# Issue：Workspace/Provider 启动目录、同源 Web 托管与本地闭环

**类型：** feature
**状态：** closed
**所属 Epic：** `001-o-rewrite-foundation`
**目标版本：** foundation tracer bullet
**建立日期：** 2026-08-27

## 1. 当前真相

Issue 006/007 已让 copied `@byspace/client` 连接真实 Go daemon，并让 Agent、canonical Timeline 和 Pi native session 跨 daemon restart 恢复。本 Issue 现已补齐 copied Web 启动所需的 stable directory workspace/project、Pi provider snapshot、`packages/app/dist` 同源托管和 startup compatibility responders，形成 `byspace daemon start → browser` 的本地产品闭环。

Go CLI 除 daemon lifecycle 外，现提供最小只读 `agent list` / `agent timeline [--follow]` seam，让 Web 与 CLI 同时观察同一 canonical Timeline；它不是完整 Agent CLI，也不提前实现 Relay target 或 mutation commands。

## 2. 做成以后

从一个临时项目目录启动带 fake 或真实 Pi 的 daemon，打开 daemon 自己的 HTTP 地址：

- copied Web 由同一 origin 加载并通过注入的初始连接 hint 自动连接同一 `/ws`；
- sidebar 出现启动目录对应的 project/workspace，provider picker 只显示 daemon 实际暴露的 Pi；
- Web 创建 Agent、发送 prompt，CLI follow 同时看到 canonical Timeline，Web 收到 live stream 并最终 idle；
- 浏览器 refresh 与 daemon stop/start 后仍能打开同一 Agent，看到相同 Timeline epoch/rows，并继续发送。

## 3. 范围与设计

### 3.1 单目录 workspace/project catalog

- Foundation 首版把 daemon 启动工作目录视为一个 local directory workspace；使用 canonical absolute path 的稳定哈希生成 project/workspace ID，restart 后不随机漂移。
- Project/workspace descriptor 严格通过 copied Zod schema；首版不伪造 Git、Forge、diff、scripts 或 worktree 能力，`projectKind/workspaceKind` 明确为 `directory`。
- Daemon 宣告 `workspaceMultiplicity` 与 `projectList`，实现 `fetch_workspaces_request` 与 `project.list.request` 的只读 snapshot；不宣告未实现的 `directorySync`，不虚构 live directory delta/subscription。
- 首版不保存独立 project registry。Agent 已由 Issue 007 保存 CWD/workspace identity；“添加/删除/重命名项目”和多 workspace 属于后续 workspace Epic。

### 3.2 Pi provider snapshot

- Daemon 宣告 `providersSnapshot`；实现 snapshot、available providers、list models、list modes 与 refresh acknowledgement 的 copied wire contract。
- Pi 是否 `ready` 由当前 daemon 环境能否解析 Pi command 决定；不可用时保留 Pi entry 并明确 `unavailable/error`，不能把其它既定 provider 从产品范围删除。
- Pi 沿用 Paseo manifest 的真实语义：没有 provider mode；模型由 Pi runtime 动态决定。Foundation snapshot 返回空 `models/modes`，让 copied Web 使用其“provider default”行，不伪造模型 ID。
- Snapshot 仅暴露已实现的 Pi adapter；Codex/Claude/OpenCode/ACP 等仍是 deferred，不是删除。

### 3.3 同源静态 Web

- Go daemon 通过 `/` 托管 Web asset root，同时保留更具体的 `/ws`、`/healthz`、`/shutdown`。
- Asset root 优先级为 `--web-dir > BYSPACE_WEB_DIR > <daemon 启动目录>/packages/app/dist`。路径不存在或缺少 `index.html` 时启动 fail closed，并提示先构建 Web 或显式指定路径；API-only 启动开关不在本 Issue 内。
- 静态 handler 使用 Go rooted filesystem 边界，禁止 symlink/path traversal 逃逸；不提供目录 listing。未知 browser route 回退到 `index.html`，支持 SPA refresh。
- 只在 daemon 响应的 `index.html` 注入 `globalThis.__PASEO_INITIAL_DAEMON_CONNECTION__`，值来自浏览器当前 origin。Cloudflare 独立 Web build 不携带该 hint。
- 当前 Issue 不把 20MB `dist` 复制或提交到 Go 源码，也不决定发行包如何 embed/安装静态资源；发布打包在 distribution slice 收束。

### 3.4 最小 CLI 观察 seam

- 增加本地 `byspace agent list` 与 `byspace agent timeline <agent-id> [--follow]`，通过 daemon `/ws` 读取事实，不直接读写 `agents-v1.json`。
- `--follow` 输出已有 canonical rows，再以 `{epoch,seq}` cursor 每 250ms 从 daemon reconciliation；CLI hello 明确关闭 best-effort `agent_stream`，因此即使 Web subscriber queue 在 burst 下丢事件，CLI 也不会留下永久 Timeline 洞。由用户取消或 daemon 断开结束。首版只连 `--home` 对应的本地 daemon，不提前实现 Relay target、创建、发送、abort 或格式化 DSL。
- JSON 输出保持机器可消费；human output 只做最小稳定文本，不复制 TS CLI 呈现层。

## 4. 质量目标

- **功能适合性：** 真实静态 Web 能发现启动 workspace 和 Pi，创建/发送并恢复同一 Agent；Playwright 对真实 Go daemon 验证。
- **安全性：** browser WebSocket 仍受 loopback + same-origin 约束；静态路径不能逃出 asset root，显式错误路径 fail closed；Go tests 覆盖 traversal/symlink/SPA。
- **兼容性：** 所有新增 response 通过 copied `SessionOutboundMessageSchema`；copied `DaemonClient` 直接调用 workspace/provider APIs 验证。
- **可靠性：** refresh、daemon restart 与 CLI follow 不丢 canonical Timeline；fake Pi 避免模型消费，live smoke 继续 `PI_OFFLINE=1`。
- **简洁性：** 单启动目录、immutable catalog、stdlib static handler；不引入数据库、文件 watcher、Git library、资源 bundler 或第二套状态源。

## 5. 明确不在本 Issue

- project add/remove/rename、workspace create/archive、worktree、Git/Forge status、directory delta journal；
- provider 动态 discovery cache、真实 Pi model enumeration、provider config UI、其它 provider adapter；
- static assets 嵌入单二进制、installer/package/release pipeline、Cloudflare Web 发布；
- Terminal/file/Git/Relay/Hub API；
- 完整 Go Agent CLI、远程 target 和 CLI mutation。

## 6. 验收标准

- [x] copied client 能读取 schema-valid project/workspace 与 Pi provider/model/mode snapshot。
- [x] daemon 从启动目录生成稳定 workspace/project ID，refresh/restart 不漂移。
- [x] daemon 同源安全托管 Web assets，SPA deep-link refresh、HEAD/cache 与 traversal 边界有测试。
- [x] Web index 仅由 daemon 注入当前-origin initial hint，Cloudflare/exported `dist/index.html` 保持无 hint。
- [x] copied Web 真实浏览器完成 workspace → create Pi Agent → send/stream → idle。
- [x] `byspace agent timeline --follow` 与 Web 同时看到该 turn；CLI 不直接读取 state file。
- [x] browser refresh 与 daemon stop/start 后重新连接同一 Agent/Timeline 并成功续写。
- [x] `go vet ./...`、`go test -race ./...`、30 轮闭环 stress、Windows cross-build与完整 Web 回归通过。
- [x] focused reviewer 无 P0/P1 blocker。

## 7. 实现记录

### 7.1 Catalog 与 copied Web 启动 closure

- `go/internal/daemon/catalog.go` 对 daemon launch directory 做 absolute + symlink canonicalization，以 SHA-256 path digest 生成稳定 `prj_` / `ws_` ID，并投影一个只读 directory project/workspace。
- `/ws` 现在宣告 `workspaceMultiplicity`、`projectList`、`providersSnapshot` 与 `providersSnapshotCwd`，实现 workspace/project/provider model/mode/feature snapshot。Pi 通过 daemon PATH 中的 `pi` 可解析性投影为 `ready` 或 `unavailable`；其它 provider 仍明确 deferred。
- copied Web 启动实际触发但本 Epic 尚未实现的 heartbeat、project icon、daemon config read、checkout/PR empty status、terminal empty snapshot 与 workspace setup status，均以 schema-valid read-only/empty 响应处理；没有借此宣告 Terminal/Git/Forge 已实现。
- Go canonical Timeline 已是 provider-neutral 完整 row，因此 `projected` 请求在当前 row 类型上返回同一有序窗口，消除 copied Web refresh 的虚假 history error；active Pi turn 的 steer 仍 correlated reject，idle turn 上的 `activeTurnBehavior=steer` 按普通新 turn 发送且不发生竞态 interrupt。

### 7.2 同源 Web 与 CLI

- `go/internal/daemon/web.go` 以 `os.OpenRoot` 限定 asset root，拒绝 symlink/path escape，禁止目录 listing，并为未知 browser route回退内存中的注入版 `index.html`；磁盘 `dist/index.html` 不修改。`/ws`、`/healthz` 与 `/shutdown` 继续使用更具体 route 和原安全边界。
- CLI 新增 `agent list` 与 `agent timeline`；它通过 PID/health identity 找到 daemon，再以 `clientType=cli` 连接 `/ws`。Wildcard listen 会归一化到本地 loopback。文档顺序 `timeline <agent-id> --follow` 与 flags-first 顺序都已测试。
- `--follow` 不依赖 best-effort stream queue，而使用每页 32 rows 的 canonical cursor pagination/polling。CLI 只连接经 PID/health identity 验证的本地 daemon，因此 response reader 允许完整单 row；300-event、总输出超过 2MiB 且含单个超过 1MiB row 的测试验证有限分页、连续 seq、最终 tail 和 wildcard listen。

### 7.3 E2E 与 review

- `packages/app/e2e/go-daemon/tracer.spec.ts` 构建真实 Go binary，用共享 deterministic fake Pi 启动同源 daemon，验证 SPA fallback、自动连接、workspace/provider default、create/stream/idle、browser refresh、daemon stop/start、同 Agent Pi resume/续写，以及同 turn 的 CLI follow。
- Focused review 阻止并修复了 positional flag order、subscriber overflow/final-tail gap、wildcard listen 与 unbounded aggregate response；最后一项 report-only P2（单 row 可超过固定 client frame limit）通过保留 bounded aggregate pagination、对 verified local daemon response 取消额外 frame cap 并加入 >1MiB 单 row 回归测试解决。最终无 P0/P1 blocker，结论 `Merge OK`。
- 验证矩阵：`go vet ./...`、`go test -race ./...`、daemon/protocol/CLI 30 轮 race stress、Windows amd64 cross-build、copied client Go-daemon E2E、真实 browser Go-daemon tracer，以及完整 Web build/typecheck/unit/lint/103 browser regression 均通过。

## 8. Closure

Workspace/provider bootstrap、同源 Web、CLI canonical reconciliation、真实 browser restart/resume E2E 和最终 focused review 均已通过；稳定能力与边界已进入本 Epic `spec.md`。用户已授权关闭满足 review 与自测条件的既有 Issue，本 Issue 关闭。
