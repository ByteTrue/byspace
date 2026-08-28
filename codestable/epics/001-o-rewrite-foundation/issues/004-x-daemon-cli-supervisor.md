# Go daemon 与统一 CLI 监督骨架

## 状态

closed

## 问题

byspace 已有共享 Web 协议 fixtures，但还没有可执行的 Go daemon，也没有统一的 `byspace` CLI。若先进入 Agent/provider 实现而没有稳定的 home、身份、进程所有权和启停边界，后续测试会依赖临时脚本，陈旧 PID 或 PID 复用还可能使 stop 命令误杀无关进程。

Paseo 当前使用 TypeScript CLI 启动 Node supervisor，再由 supervisor 管理 daemon worker。这个分层承担 JS worker crash restart 和 Electron 兼容；byspace 首轮是一个 Go 进程，不应复制不再存在的问题。

## 目标

建立一个仅依赖 Go 标准库的 `byspace` 单二进制，使其：

1. 默认只读写独立的 `~/.byspace`，并允许 `BYSPACE_HOME` / `--home` 为测试或显式隔离覆盖；
2. 在 home 中以私有权限持久化稳定的 `server-id`、`daemon.lock`、`byspace.pid` 和 `daemon.log`；
3. 支持 `byspace daemon start [--foreground]`、`status` 和 `stop`，默认监听 `127.0.0.1:6767`；
4. 由 foreground daemon 进程直接拥有 PID record，不引入多余的 supervisor/worker PID 层；
5. 通过本地 HTTP `/healthz` 证明 PID record、server ID、instance ID 与监听端点属于同一 daemon；
6. 通过 PID record 中的随机 secret 调用 `/shutdown`，只停止可验证为当前 home 所拥有的 daemon；
7. 对重复启动、陈旧 PID、损坏 PID record、端口占用和“ownership lease 存活但身份无法验证”返回有界错误。

## 行为契约

### Home 与身份

优先级为 `--home` > `BYSPACE_HOME` > `~/.byspace`。目录权限收敛为 `0700`，私有文件为 `0600`。`server-id` 使用 `srv_` 前缀和 9 字节随机值的 base64url 编码，同一 home 跨重启稳定。

### PID record

`byspace.pid` 至少包含：

- daemon PID；
- RFC3339 `startedAt`；
- hostname 与可用时的 uid；
- 实际 `listen` 地址；
- 每次启动唯一的公开 `instanceId`；
- 只保存在本地私有文件中的 shutdown secret。

`daemon.lock` 是固定路径、永不 unlink 的 OS advisory lock：Unix 使用 `flock`，Windows 使用 `LockFileEx`。foreground daemon 在整个生命周期持锁，进程崩溃时由内核释放；所有生产路径中的 PID record 创建、stale 回收与删除都必须在持锁时进行。PID record 创建另使用 exclusive create；daemon 退出时只在文件仍包含自己的 instance/secret 时删除。有效 record 存在但 ownership lock 可被重新取得时即为 stale；即使其中的 PID 已被无关进程复用，也只删除 record、绝不向该 PID 发信号。无法解析的 record 不自动覆盖。

### 探活与停止

`GET /healthz` 返回 `product=byspace`、status、server ID、instance ID、PID 和实际 listen，不暴露 shutdown secret。`POST /shutdown` 必须携带 record 中的 secret。

`status` 分类为：

- `stopped`：没有 PID record；
- `stale_pid`：record 有效，但没有进程持有该 home 的 ownership lease；
- `running`：ownership lease 已占用，且探活身份逐项匹配；
- `unresponsive`：ownership lease 已占用，但端点不可达或身份不匹配；
- `invalid_pid`：record 无法安全解析。

`stop` 只向已通过身份匹配的 HTTP endpoint 请求优雅退出。若 ownership lease 已占用但无法证明 HTTP 身份，它必须失败并保留进程；若 lease 空闲，则 stale record 可在持锁并复核后删除，不依据 PID 数值向任何进程发信号。首轮不提供绕过该边界的 `--force`。

### 后台启动

后台 start 派生同一可执行文件的 `daemon start --foreground`，将输出追加到 `daemon.log`，并等待匹配 child PID 的 `/healthz` 就绪。Unix 使用 nonblocking `wait4` 识别并回收启动期提前退出的 child；只有探活成功才 release process handle。另一个并发启动获胜、子进程提前退出或超时时，父 CLI 会终止并 wait 自己派生的精确 child，只按 PID+owner record 清理它遗留的 stale 状态，然后返回非零。

## 非目标

- 不实现 Agent、Pi adapter、Timeline 落盘或 WebSocket `/ws`；
- 不托管 Web 静态文件；
- 不连接 Relay/Hub；
- 不实现 JS worker crash respawn；Go daemon 本身就是被监督的所有者；
- 不复制 Paseo 的 Electron/desktop-managed 兼容分支；
- 不承诺本 Issue 已完成 Windows 后台分离语义；首轮必须在当前 Linux/WSL 环境有真实 E2E，跨平台差异在后续发布切片收口。

## 验收

- [x] `go vet ./...` 与 `go test -race ./...` 通过；
- [x] server ID 在同一临时 home 中重复读取一致，home/file 权限正确；
- [x] CLI E2E 能 background start → status running → stop → status stopped；
- [x] foreground daemon 收到 SIGINT/SIGTERM 后释放自己拥有的 PID record；
- [x] 两次 start 只有一个 daemon，第二次返回明确错误；
- [x] stale PID 被安全回收，损坏 record 被拒绝覆盖；
- [x] 占用监听端口时启动失败且不遗留 PID record；
- [x] stale record 复用 decoy 活进程 PID 时，status 依据空闲 ownership lease 判为 stale，stop 只清理 record 且 decoy 仍存活；
- [x] 未授权 `/shutdown` 被拒绝；
- [x] 现有 TypeScript/Web 全量验证保持绿色。

## 关闭判断

进程所有权和失败边界已被真实二进制 E2E 覆盖；本 Issue 的实现记录没有把后续 `/ws`、Agent 或 provider 冒充为本切片成果。用户已授权关闭满足 review 与自测条件的既有 Issue。

## 实施记录

实现位于：

- `go/cmd/byspace/`：统一二进制入口与真实二进制 E2E；
- `go/internal/cli/`：参数解析、后台派生、child readiness/exit 回收与人类/JSON 输出；
- `go/internal/daemon/`：home/身份/PID 状态、跨进程 ownership lease、HTTP health/shutdown 与停止边界。

已验证：

- `cd go && go vet ./...`；
- `cd go && go test -race -cover ./...`；
- `cd go && go test -count=30 ./cmd/byspace ./internal/daemon`；
- `GOOS=windows GOARCH=amd64 go build ./cmd/byspace` 交叉编译；
- 独立 reviewer 在发现并阻止最初 stale-record check/remove 竞态后，对 lifetime advisory lease、失败 child 回收、并发 stale reclaim 和私有文件模式修复给出 `OK`；将 lease 收紧为唯一 ownership 权威后再次 focused review，结论仍为 `OK`；
- `npm run typecheck`、`npm test`（648 个 test files，5,697 passed / 1 skipped）、`npm run lint`（0 errors，6 个上游 warnings）、`npm run build:web` 与 `npm run test:browser`（11 files / 103 tests）全绿。

实现、两轮 focused review 与全部本地验收均已完成，lifetime ownership lease、身份探活和 secret shutdown 已回写本 Epic `spec.md`，本 Issue 关闭。后续 Issues 已在相同 daemon 上补齐 `/ws`、Web 托管、Agent、Timeline 与 provider；这些不倒算成本 Issue 的交付范围。
