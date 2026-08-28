# Issue：Agent/Timeline 原子持久化与 Pi resume

**类型：** feature
**状态：** closed
**所属 Epic：** `001-o-rewrite-foundation`
**目标版本：** foundation tracer bullet
**建立日期：** 2026-08-27

## 1. 当前真相

Issue 006 已让 copied `@byspace/client` 通过 local-only `/ws` 使用 Go Agent manager，但 manager 仍只在内存中。Daemon 正常停止或进程退出后，Agent ID、Timeline epoch/seq、clientMessageId 幂等事实和 Pi native session handle 都会丢失；`Manager.Close` 还会把 daemon shutdown 与用户关闭 Agent 混成同一个 `closed` 生命周期。

Pi CLI 已提供 `--session <path|id>` 与 `--session-dir <dir>`。当前 adapter 只传 `--session-dir` 创建新 session，没有恢复入口。本 Issue 要建立最小但真实的 restart seam，不引入数据库。

## 2. 做成以后

在一个隔离 `BYSPACE_HOME` 中创建 Agent、完成 turn 并正常停止 daemon 后，再启动同一 daemon：

- `fetch_agents` 返回同一 byspace Agent ID；
- Timeline 保持同一 epoch、连续 seq、原有 canonical rows 与 clientMessageId 幂等事实；
- Pi 以已记录的 native session file 通过 `--session` 恢复，而不是创建无关会话；
- 新 prompt 追加到原 Timeline 并由恢复后的 Pi context 处理。

## 3. 范围与设计

### 3.1 私有 versioned state

- 状态固定为 `~/.byspace/state/agents-v1.json`（遵循 `--home > BYSPACE_HOME > ~/.byspace`），目录 `0700`、文件 `0600`。
- 文件保存 Agent snapshot、恢复所需 config/persistence handle、canonical Timeline rows，以及重建 clientMessageId 幂等所需事实；不复制 Pi transcript 内容。
- 写入采用同目录临时文件 → file sync → 原子 replace；replace 在 Unix 与 Windows 各使用平台原子语义。不得先删除旧文件再 rename。
- 每个 externally observable manager mutation 在 RPC/live event 对外可见前保存。状态写失败不得返回“已持久化成功”；provider side effect acceptance 已未知时沿用 fail-closed 关闭 session。
- 首轮全量重写一个 catalog 文件，容量上限是单用户 foundation 数据集；当持久化延迟可观测地影响 prompt/live stream，升级方向是 per-Agent journal/snapshot 或嵌入式数据库，而不是现在提前引入。

### 3.2 恢复与校验

- 缺失状态文件表示空 catalog；空文件、畸形 JSON、未知 version、重复 Agent ID、非法生命周期、Timeline epoch 缺失、seq 非 1 起连续、head 不一致、重复 clientMessageId 等视为损坏。
- 损坏文件必须原样保留并阻止 daemon 启动，错误包含可定位路径；不得静默 reset、覆盖或部分加载。
- 合法状态恢复 byspace Agent ID、时间、workspace/title/labels、Timeline epoch/rows/head，并从 user rows 重建 completed delivery dedupe。
- 上次正常 idle/error 的 Agent 尝试恢复 provider；上次仍 running 的 turn 不伪称继续 streaming：清空 active turn，标记可见的 restart interruption error，再恢复 native provider session供后续 prompt 使用。
- 单个 provider/session 无法恢复时保留 Agent 与 Timeline、标记 Agent error，不阻止其他合法 Agent 和 daemon 启动；后续 retry/rebind 不在本 Issue。
- daemon shutdown 只停止 provider process 并保存可恢复状态，不把所有 Agent 永久改成 `closed`。显式 `CloseAgent` 仍是领域关闭。

### 3.3 Pi resume 边界

- Provider-neutral `Config` 只携带可选 `PersistenceHandle`，manager 不读取 Pi 私有字段。
- Pi adapter 仅在 handle provider 为 `pi`、native handle 非空且落在配置的 Pi session directory 内时追加 `--session <nativeHandle>`；同时保留 `--session-dir`。
- RPC `get_state` 返回的 session ID/file 必须与请求恢复的 handle 对应；不匹配则关闭新进程并把该 Agent 恢复为 error，不能串接错误历史。
- 测试以 helper fake Pi 记录 argv 验证真实 `--session` 路径；live Pi smoke 继续只做 `PI_OFFLINE=1` 且不发送 prompt。

## 4. 质量目标

- **可靠性 / 可恢复性：** 正常 daemon stop/start 后同一 Agent/Timeline/Pi session 可继续；以 manager store round-trip、真实 daemon restart E2E 验证。
- **信息安全性 / 完整性：** 私有文件权限正确，损坏/篡改状态 fail-closed 且不覆盖证据，resume path 不越出 Pi session directory；以权限、path containment、corrupt fixture 测试验证。
- **兼容性 / 互操作性：** 恢复后 `/ws` snapshot 与 canonical Timeline 继续通过 copied Zod schema，cursor epoch/seq 不改变；以 copied client restart E2E 验证。
- **可维护性 / 可测试性：** Manager 持久化接口保持 provider-neutral，原子文件实现与 Pi resume 各自有窄测试面；memory-only `NewManager` 继续供现有测试使用。

## 5. 明确不在本 Issue

- SQLite、事件溯源、压缩、无限历史容量优化；
- 从 Paseo home 导入、跨版本迁移工具或 downgrade；
- provider 恢复失败后的 UI retry/rebind；
- workspace/project/provider catalog 与静态 Web 托管（Issue 008）；
- Relay/Hub/LAN remote persistence；
- crash 期间 Pi 已产生但 byspace 未收到的 transcript 反向导入。

## 6. 验收标准

- [x] 原子 state store round-trip 保留 snapshot、Timeline、epoch/seq 与 dedupe；Unix 权限为目录 `0700`、文件 `0600`，Windows 使用 current-user + LocalSystem protected DACL。
- [x] malformed/version/invariant/path containment 测试 fail-closed 且原文件不被覆盖。
- [x] manager mutation 在 response/live dispatch 前落盘；注入 write/replace 失败时不虚报成功或继续不确定 session。
- [x] daemon shutdown 保存可恢复 lifecycle，不把 catalog 全部写成 closed；显式 Agent close 语义不变。
- [x] Pi new session 与 resume argv/get_state identity 都有 contract test。
- [x] copied `DaemonClient` 真实 daemon stop/start 后看到同一 Agent ID、Timeline epoch/rows，并能追加新 turn。
- [x] restart 前 active turn 被确定性标记 interrupted，不冒充仍在运行。
- [x] `go vet ./...`、`go test -race ./...`、30 轮 persistence/restart stress、Windows cross-build 与完整 Web 回归通过。
- [x] focused reviewer 无 P0/P1 blocker。

## 7. 实现记录

### 7.1 State store 与恢复

- `go/internal/agent/state_store.go`、`state_file_unix.go`、`state_file_windows.go` 实现 `agents-v1.json` 的私有 versioned store：同目录 temp、file sync、Unix rename / Windows `MoveFileEx(REPLACE_EXISTING|WRITE_THROUGH)`、directory sync。后续 [`010-x-windows-private-agent-state.md`](010-x-windows-private-agent-state.md) 把原本错误复用于 Windows 的 `0600` mode-bit 判断替换为 shared current-user + LocalSystem protected-DACL secure/validate seam。
- `go/internal/agent/manager_persistence.go` 保存/校验 Agent snapshot、Timeline、delivery outcome 与 provider-neutral `PersistenceHandle`；缺失文件等价空 catalog，损坏、未知 version、重复 ID/dedupe、非法 lifecycle/head/seq 会带路径拒绝启动且不重写。
- Persistent manager 的读写由 `stateMu` 形成 response/live visibility barrier。Pre-replace Save 失败回滚 staged canonical mutation后 poison 对应 session；replace 已发生但 directory durability 未确认时锁存 manager-wide fatal error、取消 in-flight provider starts、停止 sessions 并拒绝后续 mutation。
- Persistent `Manager.Close` 使用 resumability-preserving shutdown；显式 `CloseAgent` 以 `domainClosing` 在并发 daemon shutdown 中仍升级为永久 `closed`。Active turn 在 shutdown/restart 后成为可见 restart interruption error，Timeline 不伪造 provider answer。

### 7.2 Pi resume

- `agent.Config.Resume` 只承载 provider-neutral handle；`go/internal/provider/pi` 新建时仍使用 `--session-dir`，恢复时额外使用 `--session <nativeHandle>`。
- Resume path 必须是 session directory 内的普通文件；路径和 directory 均解析 symlink 后做 containment。Startup `get_state` 的 session ID 与 file 必须同时匹配 persisted identity，否则关闭新进程并仅将该 Agent 标记为 error。
- 单 Agent/provider resume 失败不阻止其他合法 catalog 恢复；closed Agent 不启动 provider。

### 7.3 跨语言 restart 证明

`packages/client/src/go-daemon.e2e.test.ts` 在同一临时 home 下执行真实 Go binary stop/start，验证同一 Agent ID、metadata、Timeline epoch/rows/seq、`clientMessageId` dedupe 与新 turn 续写。Fake Pi 创建真实 session file、记录两次 PID，并要求第二次 argv 携带同一 `--session`；restart 前故意保留 active turn，恢复后只出现 error lifecycle，不出现伪 assistant row。

### 7.4 验证记录

- `cd go && go vet ./... && go test -race ./...`：通过。
- `cd go && go test -race ./internal/agent -run 'TestPersistentManager|TestFileStateStore|TestExplicitClose|TestPostReplace' -count=30`：通过。
- `cd go && GOOS=windows GOARCH=amd64 go build ./...`：通过。
- 后续 Windows ACL 修复额外交叉编译 `internal/privatepath`、`internal/agent`、`internal/relay` test binaries 并经原生 `cmd.exe` 执行：Agent persistence/reopen suite 与 Relay suite 通过，shared protected-DACL test 10/10 通过；详见 Issue 010。
- `npm run test --workspace=@byspace/client -- go-daemon.e2e.test.ts`：1 file / 1 test 通过。
- 完整 Web 回归：typecheck 通过；649 test files 中 5,698 passed / 1 skipped；lint 0 errors（6 个既有 warning）；Web export 通过；11 browser files / 103 tests 通过。
- Focused review 首轮发现 failed-save visibility、explicit close/shutdown race、post-replace ambiguity；复审发现 in-flight Create fail-stop 竞态与测试 fixture 盲区。实现与覆盖均已逐项修复；最终 verdict：`No issues found / Merge OK`。

## 8. Closure

原子持久化、fail-closed 恢复、Pi identity-checked resume、focused review 与 restart E2E 均已完成；稳定数据与恢复边界已进入本 Epic `spec.md`。Windows 上曾以 Unix mode bits 校验 ACL 的运行时缺口已由 [`010-x-windows-private-agent-state.md`](010-x-windows-private-agent-state.md) 修复并通过原生 Windows tests。用户已授权关闭满足 review 与自测条件的既有 Issue，本 Issue 保持关闭。
