# Issue：Provider-neutral Agent lifecycle 与 Pi RPC adapter

**类型：** feature
**状态：** closed
**所属 Epic：** `001-o-rewrite-foundation`
**目标版本：** foundation tracer bullet
**建立日期：** 2026-08-27

## 1. 当前真相

Issue 003 已建立 TypeScript↔Go wire fixtures；Issue 004 已建立单 Go `byspace` binary、daemon ownership 与安全启停。本 Issue 现已在 `go/internal/agent` 建立 provider-neutral Agent/Timeline 事实源，在 `go/internal/provider/pi` 建立 Pi RPC adapter，并由 daemon 进程拥有 manager 的完整生命周期。

Agent lifecycle 使用 `initializing | idle | running | error | closed`；Timeline 是带稳定 `epoch`、单调递增 `seq` 和时间戳的 append-only rows。Manager 只消费归一化 provider event，不读取 Pi 私有 event；Pi adapter 负责将 stdout JSONL、native session state 与进程退出映射到该公共模型。

官方 Pi RPC 的 command response 与异步 event 可以交错；实现只把同 ID response 用作命令接受结果，以 `agent_settled` 作为 turn 完成边界。mutating command 一旦已写入但结果未知，adapter 会 fail-closed poison 并同步回收整个 session，禁止下一 turn 误归因旧事件。

## 2. 本 Issue 范围

1. 建立 `go/internal/agent`：
   - provider-neutral `Provider` / `Session` seam；
   - Agent create/list/get/send/abort/close；
   - 独立 byspace Agent ID 与 turn ID；
   - lifecycle snapshot、runtime info 与 capability flags；
   - append-only in-memory Timeline，首行 `seq=1`，同一 Agent epoch 稳定；
   - `clientMessageId` 幂等，避免重试重复投递；
   - daemon shutdown 时关闭全部 provider session。
2. 建立 `go/internal/provider/pi`：
   - 启动 `pi --mode rpc`，cwd 为 Agent cwd；
   - session 文件定向到 `<BYSPACE_HOME>/providers/pi/sessions/`；
   - command response 按 request ID 关联，异步 event 归一为 provider-neutral stream event；
   - 首轮映射 user/assistant/reasoning/tool/error 和 turn lifecycle；
   - `get_state` 获取 Pi native session ID、session file、model 与 thinking level；
   - abort/close/异常退出必须有界，不遗留测试平台上的子进程。
3. 将 manager 纳入 daemon lifetime：daemon 启动时创建，退出前关闭。
4. 测试：
   - fake Provider 验证 manager 契约与竞态；
   - helper RPC subprocess 验证 response/event 交错、stream、abort、失败与 cleanup；
   - installed Pi offline smoke 仅执行 `get_state`，不调用模型、不消耗 API；
   - race、vet、Linux lifecycle stress 和 Windows cross-build。

## 3. 明确不在本 Issue

- `/ws` 或任何 Agent HTTP endpoint；
- Web UI 接线；
- daemon 重启后的 Agent/Timeline 恢复；
- provider session 导入、fork/rewind、permission UI、MCP 配置与 subagent 投影；
- Claude/Codex/OpenCode/ACP adapters；
- Relay、Hub、多主机。

Pi session 可在 byspace 私有目录中生成，但 byspace catalog 与 Timeline 本 Issue 仅在内存中；重启恢复属于下一切片。

## 4. 设计约束

### 4.1 Manager 拥有领域事实

- byspace manager 在 provider 调用前分配 turn ID 并先追加 user row，保证 Timeline 顺序不依赖 provider event 调度。
- Provider adapter 只报告归一化 event；不得直接修改 Agent lifecycle 或 Timeline。
- 单 Agent 首轮只允许一个 foreground turn；running 时再次 send 明确返回 busy。
- 相同非空 `clientMessageId` 返回原投递结果，不重复调用 provider。

### 4.2 Pi JSONL 与进程边界

- stdout 仅以 LF (`0x0A`) 分帧，不能以 Unicode line separator 分帧。
- response 只完成同 ID command；其余对象进入 event path。
- malformed/non-object stdout line 忽略并保留后续帧可读性；process exit 使全部 pending request 失败。
- stderr 只作有界诊断，不混入 stdout protocol。
- Start 在 `get_state` 成功前不向 manager 发布 session；任何启动失败必须关闭已创建 process。
- Close 先关闭 stdin/等待，再在超时后终止；Unix 以 process group 为边界清理子树。

### 4.3 Abort 竞态

Manager 在发送 abort 前标记当前 turn 为 aborting。此时收到同 turn 的 settle 不得发布 completed；abort response 成功且收到 `agent_settled` 后只发布一次 canceled 并回到 idle。adapter 自带有界 abort timeout；进程退出不能伪装成成功 settlement，结果未知时 session fail-closed 进入不可复用状态。并发 abort caller 等待并共享 owner 的最终结果。

### 4.4 安全与隔离

- Pi process 继承 daemon 环境和用户 Pi 配置，但不得自动增加 `--approve`；项目资源信任继续遵守 Pi 自身 trust policy。
- 生产默认 command 是精确的 `pi` executable，不经 shell 解释。
- byspace 只重定向 session storage，不复制或改写用户 `~/.pi` 身份/凭证。

## 5. 验收标准

- [x] fake Provider 下 create→send→stream→settled 的 snapshot、event 与 Timeline 顺序确定。
- [x] Timeline seq 连续、epoch 稳定，返回值不暴露可修改内部 slice/map。
- [x] 同一 `clientMessageId` 不二次 prompt；不同消息在 running 时明确 busy。
- [x] provider prompt failure、turn failure、process exit 均进入稳定可观察状态。
- [x] settle/abort 竞争只产生一个 terminal event，最终为 idle/canceled。
- [x] close 单 Agent及关闭 manager 都释放 session；daemon shutdown 调用 manager close。
- [x] Pi helper process 覆盖交错 response/event、assistant/reasoning delta、tool lifecycle、Unicode U+2028、abort 与异常退出。
- [x] installed `pi` offline smoke 通过，且测试不发送 prompt。
- [x] `go vet ./...`、`go test -race ./...`、Windows cross-build 和完整既有 Web 回归通过。
- [x] focused reviewer 无 P0/P1 blocker。

## 6. 实现记录

### 6.1 Provider-neutral core

- `go/internal/agent` 提供 `Provider` / `Session` seam、create/list/get/send/abort/close、snapshot、capability/runtime info 和内存 Timeline。
- manager 在调用 provider 前分配 byspace turn ID 并追加 user row；provider delta 无法抢在 user row 前面。
- `clientMessageId` delivery 与 abort 都使用 single-flight result；并发 caller 等待 owner 的真实结果，而不是读取 provisional 状态。
- provider event 必须携带当前非空 turn ID；空或 stale turn event 被拒绝。subscriber queue 是明确的 best-effort live projection，canonical Timeline 不丢失；回调可安全自行 unsubscribe。
- manager shutdown 先关闭全部 session 以打断操作，再等待 in-flight create/send/abort/close 返回；daemon `Serve` 的所有退出路径都会关闭 manager。

### 6.2 Pi adapter 与 process supervision

- 生产命令是直接执行 `pi --mode rpc --no-approve --session-dir <home>/providers/pi/sessions`，不经过 shell；session 目录强制为 `0700`。
- transport 按 LF 解码 JSONL、按 request ID 关联 response、容忍 malformed event 后继续读帧，并把 bounded stderr 只用于退出诊断。
- Pi event 映射 assistant/reasoning/tool call/error 与 turn lifecycle；`get_state` 固定 native session ID、session file、model 和 thinking level。
- post-write cancellation、abort timeout 和 process exit 均会 poison session；旧 turn 的晚到 event 不能被归入下一 turn。
- Unix 以独立 process group 清理进程树；Windows 使用 suspended start，在代码执行前加入 `KILL_ON_JOB_CLOSE` Job Object，再恢复 primary thread。父进程异常退出、后代保留 stdout/stderr、reap timeout 和 descriptor 生命周期均有回归测试。

### 6.3 Review 修复链

Focused reviewer 首轮阻止了 unknown-acceptance turn corruption、重复投递 provisional result、无界 abort、process tree 清理、self-unsubscribe 与 shutdown mutation race。第二轮继续阻止了 process-exit-as-settlement、pipe descriptor 泄漏和 Windows Job assignment 启动窗口。修复后最终 review 结论为 **No issues found / Merge OK**。

## 7. 验证记录

- `cd go && go vet ./...`：通过。
- `cd go && go test -race ./...`：通过；包括 daemon lifecycle 和新 Agent/Pi suites。
- focused race/stress：Agent/Pi 关键并发测试 30 轮通过。
- Windows `amd64`：`cmd/byspace` build 与 `internal/agent`、`internal/provider/pi` test binary 交叉编译通过。
- installed Pi：本机 `pi 0.84.3` 在 `PI_OFFLINE=1` 下完成真实 `get_state` smoke，未发送 prompt。
- 完整 Web 回归：`build:web → typecheck → npm test → lint → test:browser` 串行 exit 0；5,697 passed / 1 skipped，lint 0 errors / 6 个既有 warnings，11 browser files / 103 tests 通过。

## 8. 残余风险

- Windows Job Object 和 startup-descendant 测试已按平台编写且可交叉编译，但本轮没有 Windows runtime 环境，实际执行仍留到 Windows CI/主机验证。
- installed Pi smoke 证明当前本机 `pi 0.84.3` 的 `get_state` 兼容；CI 中未安装 Pi 时该 smoke 会明确 skip，helper subprocess 继续覆盖确定性协议行为。
- Agent catalog、Timeline 和 delivery ledger 本 Issue 仍只在内存中；daemon restart 恢复、WebSocket/API 投影和 Web 接线属于下一切片。

## 9. Closure

实现、两轮 focused review、race/stress、offline Pi smoke 与跨平台 build 证据均已完成；provider-neutral ownership、Pi JSONL/settlement 和 fail-closed process/session 边界已回写本 Epic `spec.md`。用户已授权关闭满足 review 与自测条件的既有 Issue，本 Issue 关闭。
