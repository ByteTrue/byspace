---
type: ff
---

# daemon restart 三条入口都没有真的重启

## 做了什么

预期：客户端「Restart daemon」和 `byspace daemon restart` 都重启 daemon，客户端断开再连回来。
实际：两边都没动静，`daemon restart` 还报成功。

三条独立断点，前两条让重启变成静默 no-op：

1. **服务端只排队，不回应。** `restart_server_request`/`shutdown_server_request` 把 reason 塞进
   `s.shutdownRequested`（容量 1 的缓冲 channel），全仓库没有第二个读者；也没有回
   `status: restart_requested`。客户端 `restartServer()` 在等这个 ack，于是请求悬挂到超时，UI 报
   「请求失败」。Go 移植时只补了 `reason` 字段的解析，动作本身从来没接上。
2. **`byspace daemon restart` 撞不上 daemon。** `StopRunning` 用 `lock.ExeName + " serve"` 做进程
   身份匹配。桌面 App 的 daemon 跑在 `byspace tray` 进程里（pid lock 的 exeName 是 `byspace`），
   cmdline 里没有 `serve` → 被当成 pid 复用 → 只删 pid lock 不杀进程；随后 `start` 探测到健康检查
   正常，打印 `already running` 就返回成功。等于「重启成功」而进程未动，顺手把 pid lock 删了。
3. **`serve` 自己也没有重启通道。** 即使把请求送到 `serve`，它只会退出，不会拉起新进程。

按用户裁决的两条语义修：桌面 App 用整进程重开（复用 selfupdate 的 relaunch + `BYSPACE_REPLACES`
握手，tray 模式菜单栏基本无感）；CLI 侧 RPC 优先、失败回落信号。

## 改了哪些

- `internal/server/server.go`：`shutdownRequested chan string` → `controlRequests chan ControlRequest`
  （带 `Restart` 标记，restart 和 shutdown 必须区分开），对外 `ControlRequests()`。
- `internal/server/ws_git_system.go`：先回 `status: restart_requested` / `status: shutdown_requested`
  （客户端等这个 ack），再交给进程 owner。
- `internal/cli/main.go`：`serve` 的 `httpSrv.Serve` 挪到 goroutine，主 goroutine 在一个 `select` 里等
  `serveErr` / `ctx.Done()` / `ControlRequests()`。**restart 必须在这个 select 里处理**：Shutdown 一
  关监听器 `Serve` 就返回，写在独立 goroutine 里的重启逻辑会和进程退出赛跑，实测新进程根本没起来。
  restart 分支先 `RemovePID` + 关监听器，再 `daemon.StartBackgroundArgs` 拉起替代进程，然后返回。
- `internal/daemon/daemon.go`：`StartBackgroundArgs` 用原始 argv 重启（`StartOptions` 覆盖不到
  `--web-dir` 之类的旗标）。
- `internal/cli/commands_daemon_extra.go`：`daemonControl`（发请求等 ack）、`runningDaemonAddr`
  （serverId 校验，避免停别人家的 daemon）、`awaitDaemonStop`、`awaitDaemonRestart`（要求 pid 变化，
  健康检查单独不算证据 —— 原来「重启成功」正是旧进程在答）。
- `internal/cli/main.go`：`restart`/`stop` 先走 RPC；`restart` 的回落路径在「daemon 没停下但仍答健康
  检查」时直接报错，不再打印 `already running` 假装成功。
- `internal/gui/backend.go`：`DaemonSupervisor.SetControlHandler` + 一个把 `ControlRequests()` 转给 App
  的 goroutine（这是缺的那一段）。
- `internal/gui/update.go` / `internal/gui/app.go`：`relaunchApp`（不装更新、只重开进程），restart 走
  它 + 与更新路径共用的 `exitForRelaunch`；stop 退出 App。
- `docs/architecture.md`：「Restart and stop belong to the process owner」一段。

## 怎么验证的

- 新增 `internal/server/control_request_test.go`：两种请求都回对应 ack，且 owner channel 收到正确
  `Restart`/`Reason`。
- 新增 `internal/gui/backend_control_test.go`：supervisor 的 in-process daemon 收到重启请求后交给 App。
- dev daemon 实测（`npm run dev:daemon` 6778 + `npm run cli`）：
  `daemon restart` → `restarted pid=89469`，`ps` 见新 `bin/byspace serve`；再 restart → `pid=90047`；
  `daemon stop` → `stopped pid=90047`，进程消失；已停时再 stop → `not running`；
  `daemon start` → restart → stop 一轮同样正常。
- `npm run audit --no-browser` 全绿（Go 测试 / 入站 0 / 出站 0 / 账本一致；浏览器步骤本机无 daemon，跳过）。
- 未验证：桌面 App 那条 relaunch 路径只到单测层面。实机验证要重装 App 并重启用户正在用的 6777
  daemon，按要求没有动。

## 审查后修正

- `awaitDaemonRestart` 原来接受「lock 不存在」当重启成功：交接期间 lock 短暂为空，而旧进程还在答健康检查，于是会打印 `restarted pid=0` 提前返回。改成必须 `alive && pid != pidBefore`，并加了 `internal/cli/daemon_control_test.go`（改前失败、改后通过）。
- 受服务管理器托管的 daemon（`daemon install-service`）不能自己 spawn：systemd 会随主进程清掉 cgroup，launchd 会留下游离进程。改成 `daemon.Supervised()` 时以非零码退出交给管理器重启；模板写入 `BYSPACE_SERVICE_MANAGED=1`，老的 systemd unit 靠 `INVOCATION_ID`。
- 桌面 App 的重启沿用更新路径的窗口判断（`mainWin.IsVisible()`），不再用启动参数，否则自动启动的 tray 用户点重启会把窗口弄丢。
- `daemon restart` 用 `fs.Visit` 区分「用户显式给了 --addr」和默认值，没给时才会去探 pid lock 记下的地址（否则非默认端口上的 daemon 走不到 RPC）。
- spawn 前显式 `srv.Close()`，替代进程不再和旧进程的 agent/terminal 收尾赛跑；`runningDaemonAddr` 的 serverId 校验改成读不到 id 就拒绝（fail closed）。
- 按审查意见删掉了重复的 relaunch/CLI 分支和重复注释（`InstallAndRelaunch` 复用 `relaunchApp`，restart/stop 的 RPC 块合成一行条件）。

## 对 byissue/ 的影响

- `docs/architecture.md` 补了 owner 语义与「为什么 CLI 走 RPC 而不是信号」。
- 新增 [notes/2026-11-09-daemon-control-owner.md](../notes/2026-11-09-daemon-control-owner.md)：控制面只有进程 owner 执行这一条事实，加上 ack 先于断连、restart 必须持主 goroutine、spawn 前先放 pid lock 三个坑，并记下 Node 时代 043 定过、Go 移植时丢掉的「stop 优先 RPC」约定。
