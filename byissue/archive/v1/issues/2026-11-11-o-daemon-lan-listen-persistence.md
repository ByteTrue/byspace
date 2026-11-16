---
kind: issue
title: "补齐 daemon 局域网开关：daemon.listen 持久化与启动解析"
type: feature
created: 2026-11-11
---

# 补齐 daemon 局域网开关：daemon.listen 持久化与启动解析

## 做成以后是什么样

设置里的「允许局域网访问」开关真正决定 daemon 下一次监听在哪：

1. 打开（需要已设置密码）：patch 把持久化 `daemon.listen` 写成 `0.0.0.0:<当前端口>`；关闭写回 `127.0.0.1:<当前端口>`。端口保持当前绑定值不变。
2. 重启后生效。重启的来源都按同一优先级解析监听地址：显式 `--addr` > `BYSPACE_LISTEN` > 持久化 `daemon.listen` > 默认 `127.0.0.1:6777`。桌面 App 的「重启」是整进程 relaunch，自然重新解析。
3. 视图如实：`network.allowLanAccess` 与 `network.tcpPort` 从生效的监听目标派生，不再读盘上那个会过期的布尔值。保存后、重启前显示已保存的意图（040 的「显示待生效状态」）。
4. 不变量服务端强制：开 LAN 必须有密码；LAN 开着时拒绝清密码；socket/pipe 拒绝 LAN；`BYSPACE_LISTEN` 接管时拒绝 patch 并说明原因。

## 为什么现在做

`byissue/spec/connection.md` 的安全边界写的是「放开局域网 = 改写 `daemon.listen`」，但 Go daemon 从未读写这个键：2026-11-11 在 Windows 机器（10.1.115.59，0.24.8）实测 `allowLanAccess=true` 时仍只监听 `127.0.0.1:6777`，开关只存了一个值。同一次排查还发现 `network.allowLanAccess` 被写进 config 后会让配置帧缺 `tcpPort`、被客户端整帧拒绝（见 `2026-11-11-x-ff-daemon-config-network-view.md`），这一条把视图的来源一并修正。

## 动哪些、验哪些

- `internal/store/store.go`：新增 `PersistedListenAddr()`；写入时删掉旧的派生 `daemon.network`。
- `internal/server/daemon_network_patch.go`（新）：patch 的 `network` 只认 `allowLanAccess`，翻译成 `daemon.listen`；LAN 语义与不变量判定。
- `internal/server/ws_git_system.go`：`set_daemon_config_request` 接入翻译与不变量；视图从生效监听目标派生。
- `internal/daemon/listen.go`：`DialAddress()`，wildcard 监听对客户端要回到 loopback（Windows 不能连 `0.0.0.0`）。
- `internal/cli/main.go`：`serve` / `daemon start` / `daemon restart` 按上面的优先级解析；客户端触发的 `serve` 重启重新解析；`install-service` 不再把默认地址烤进 unit（显式 `--addr` 才写）。
- `internal/cli/main.go`：`probeHealth` 与 WS 拨号前把 wildcard 归一成 loopback。
- `internal/gui/backend.go`、`internal/gui/app.go`：sup 分开「绑定目标」与「拨号地址」，启动时读 home 的 `daemon.listen`。
- 需要验：新增 Go 单测（翻译、viewport 派生、CLI/GUI 解析、`DialAddress`）；`go test` 受影响包；`npm run audit -- --no-browser`。手工：dev daemon 上开关 → 重启 → 实际监听 `0.0.0.0`（`lsof`/`netstat`），再关掉restart → 回到 loopback。

## 边界与已知限制

- 显式 `--addr` 仍然优先于设置项，且 daemon 看不到它是 flag 还是默认值。以 `--addr` 启动的 daemon 上改开关不会生效；`install-service --addr` 会把地址烤进 unit，因此只在显式传入时写。
- 不做「打开开关时自动生成密码」；密码必须先由用户设置。
- 迁移：旧配置里的 `daemon.network.allowLanAccess` 不转成 `daemon.listen`，避免升级后未经重新确认就监听局域网。视图会显示为关闭，用户重新打开一次即可。

## 关闭判断

上面的单测与手工验收通过即可关闭；回写候选：`byissue/spec/connection.md` 补一条启动优先级与 `--addr` 限制。

## 执行记录（2026-11-11）

- `internal/store/store.go`：新增 `PersistedListenAddr()`；从默认值里删掉 `network`（它是视图，不是存储）；`SaveDaemonConfig` 写入时删除旧版本留下的 `daemon.network`，避免盘上的布尔值与实际监听继续打架。
- `internal/server/daemon_network_patch.go`（新）：`takeDaemonNetworkPatch` 只取 `allowLanAccess` 并把整个 view 块从 patch 移除；`daemonListenForLAN` 把开关翻译成 `0.0.0.0:<port>` / `127.0.0.1:<port>`（socket 与 `BYSPACE_LISTEN` 接管时拒绝）；`lanOpen` 与 `listenIntent` 判定生效地址。
- `internal/server/ws_git_system.go`：`set_daemon_config_request` 接入翻译与不变量（同一次 patch 可先关 LAN 再清密码）；视图改为从 `listenIntent` 派生 `allowLanAccess`/`tcpPort`，不再读盘上的 `network`。
- `internal/daemon/listen.go`：`DialAddress()` 把 wildcard 归一成 loopback（Windows 连不上 `0.0.0.0`）。
- `internal/cli/main.go`：`serve`/`daemon start`/`daemon restart` 用 `resolveServeListenAddr`（`--addr` > `BYSPACE_LISTEN` > 持久化 > 默认）；`serve` 被客户端要求重启时丢掉非显式的 `--addr`，让替代进程重新解析；`install-service` 只在显式传地址时把 `--addr` 烤进 unit；`probeHealth` / WS 拨号前归一 wildcard。
- `internal/gui/backend.go`、`internal/gui/app.go`：supervisor 拆分 `ListenAddr`（绑定目标，可为 wildcard/socket）与 `Addr`（拨号地址，loopback）；启动时读 home 的 `daemon.listen`。

**验证**

- 单测：`internal/server` 新增 `TestSetDaemonConfigTogglesLANThroughDaemonListen`（WS 全链路：无密码拒绝开 LAN、拒绝清密码时不动盘、同时关 LAN+清密码放行、`daemon.listen` 落盘为 `0.0.0.0:6777`/`127.0.0.1:6777`）；`TestNetworkViewReportsTheListenTarget`、`TestLANPatch*`、`TestListenIntentPrefersTheSavedAddress`、`TestTakeDaemonNetworkPatch`；`internal/store`、`internal/daemon`（`TestDialAddress`）、`internal/cli`（`TestResolveServeListenAddr`）、`internal/gui`（`TestResolveDesktopListenAddr`）。
- 实测（本机，隔离端口，临时 home）：只写 `daemon.listen = 0.0.0.0:<port>` 启动 `serve`，`lsof` 显示 `TCP *:<port> (LISTEN)`，`/health` 在 `127.0.0.1` 正常；改写为 `127.0.0.1:<port>` 后显示 `TCP 127.0.0.1:<port>` 与 `[::1]:<port>`。未在 Windows 上跑；未重启真实 6777 daemon。
- `go test ./internal/{server,cli,gui,store,daemon,execres}` + `./internal/agent/providers` 全绿；`npm run audit -- --no-browser` 全过。

**未覆盖 / 限制**

- 显式 `--addr` 与 `install-service --addr` 仍然优先，daemon 看不到它来自 flag 还是默认值；旧安装的 service unit 需要重装才会跟随设置。
- 旧配置里的 `daemon.network.allowLanAccess` 不迁移成监听地址；视图显示为关闭，用户重新打开一次。
- 未在 Windows 真机上验证 wildcard 绑定与 App relaunch 后的重新解析。
