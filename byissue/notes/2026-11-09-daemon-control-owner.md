# daemon 控制面只有一个 owner：服务端只排队

**结论：** `restart_server_request` / `shutdown_server_request` 不在服务端执行。`internal/server` 收下请求、回一条 `status: restart_requested` / `status: shutdown_requested` 的 ack，然后把 `ControlRequest{Restart, Reason}` 交给 `srv.ControlRequests()`；真正动手的是持有 daemon 进程的那个 owner —— `byspace serve` 自己拉起替代进程，桌面 App（`byspace tray`，daemon 跑在 app 进程内）走整进程 relaunch。服务端没有 `ShutdownRequested` 之外的第二条路，也没有「服务端自己重启」的实现。

**何时用：** 改 `internal/server` 的生命周期、加新的控制类 RPC，或者排查「点了重启没反应」时。

**细节：**

- **ack 必须先于断连。** 客户端的 `restartServer()` / `shutdownServer()` 就在等这条 `status`；少这条 ack，请求会悬挂到超时，UI 报「请求失败」。ack 在 `sendSessionMsg` 里同步写出，和后面的 socket 关闭共用同一条连接，顺序有保证。
- **restart 的分支必须持主 goroutine。** `internal/cli/main.go` 的 `serve` 把 `httpSrv.Serve` 放在 goroutine 里，主 goroutine 在一个 `select` 里等 `serveErr` / `ctx.Done()` / `ControlRequests()`。写在独立 goroutine 里会输掉这场比赛：Shutdown 一关监听器 `Serve` 立刻返回，`runServe` 返回、`main` 退出，spawn 代码还没跑到。第一版就是这么写的，实测新进程根本没起来。
- **spawn 之前要先放掉 pid lock、监听器和 server 状态，否则替代进程会死在 pre-bind 检查里，或者读到正在拆的 agent/terminal 状态。** 顺序固定：`httpSrv.Shutdown` → `daemon.RemovePID(home, myPID)` → `srv.Close()` → `daemon.StartBackgroundArgs(..., args)`。用原始 argv 重启（不是 `StartOptions`），`--web-dir` 这类旗标才不会被吃掉。
- **CLI 必须走 RPC，不能只发信号。** `StopRunning` 用 `lock.ExeName + " serve"` 做身份匹配，而桌面 App 的 cmdline 是 `byspace tray`，匹配不上 —— 旧行为是被当成 pid 复用、只删 pid lock 不杀进程，接着 `start` 看到健康检查正常就打印 `already running`。`daemon restart` / `daemon stop` 现在先发 RPC 等 ack，失败才回落信号。这条约定 Node 时代就有（[043](../issues/043-x-daemon-service-install.md)：stop 优先 RPC、失败回落 owner PID signal），Go 移植时丢了。
- **「重启成功」不能只看健康检查。** 答话的可能是那个还没动的旧进程，而且交接期间 pid lock 有一小段是空的。判定标准是**有一个活着的、pid 不同的进程在答**（`awaitDaemonRestart` 要求 `alive && pid != pidBefore`，少了前半条就会在 lock 被删的窗口里误判成功）；停下来的判定是健康检查不再应答（`awaitDaemonStop`）。
- **受服务管理器托管的 daemon 不能自己 spawn。** systemd 在主进程退出时清掉整个 cgroup，spawn 出来的替代进程会跟着死；launchd 会让它变成游离进程而 unit 报 not running。所以 `serve` 在 `daemon.Supervised()`（`BYSPACE_SERVICE_MANAGED`，模板写入；老的 systemd unit 靠 `INVOCATION_ID`）时以非零码退出，让管理器重启它 —— 两个模板都是「失败才重启」，退出 0 等于告诉它「用户停掉了」。
- **桌面 App 侧的接线点是 `DaemonSupervisor.SetControlHandler`。** 它在 `startInProcess` 里起一个 goroutine 把 `ControlRequests()` 转给 App；App 用自己的 relaunch（`BYSPACE_REPLACES` 握手，与更新路径同一个 `exitForRelaunch`）。attached 到外部 daemon 时 `sup.srv == nil`，没有这个 goroutine，请求由那个外部 `serve` 自己处理。
- 桌面 App 上的 stop 等于退出 App —— 它就是 host，而 `watchLoop` 会在几秒内把被停掉的 in-process daemon 重新拉起来。

**相关：** [快改：daemon restart 三条入口都没有真的重启](../issues/2026-11-09-x-ff-daemon-restart-rpc.md) · [Node 时代 stop 走 RPC 的约定](../issues/043-x-daemon-service-install.md) · [docs/architecture.md](../../docs/architecture.md)
