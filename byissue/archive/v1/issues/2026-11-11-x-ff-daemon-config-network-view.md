---
kind: issue
title: "修复设置密码报 Response validation failed：network 视图缺 tcpPort"
type: ff
created: 2026-11-11
---

# 修复设置密码报 Response validation failed：network 视图缺 tcpPort

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

---

用户在设置里改密码，报 `Unable to update network settings` + `Response validation failed for set_daemon_config_response`。

根因：`set_daemon_config_response.config` 走 `MutableDaemonConfigSchema`，其中 `network.tcpPort` 必填（nullable）。用户在 UI 开过局域网后，磁盘上只有 `daemon.network.allowLanAccess`（`SaveDaemonConfig` 往原始 disk 段合并，`tcpPort` 是派生值，从不落盘），`store.LoadDaemonConfig` 又让 disk 的 `network` 整体覆盖默认值。于是 GET/SET 的 config 帧里没有 `tcpPort`，客户端整帧拒绝；设置页看起只是「保存失败」，实际任何配置读取都已被拒。

- 改动：`internal/server/ws_git_system.go` — `set_daemon_config_response`（成功与三条错误路径）与 `get_daemon_config_response` 统一走新的 `loadDaemonConfigWithService`；新增 `withDaemonNetworkView` 从实际绑定的 `listenAddr` 派生 `tcpPort`（socket/pipe 为 null），保留盘上的 `allowLanAccess`。保存后重新读取而不是使用合并结果，顺带修掉成功响应里 `passwordSet` 是旧值的问题。（后续：`2026-11-11-o-daemon-lan-listen-persistence.md` 把 `allowLanAccess` 也改为从生效监听目标派生，并让开关真正改写 `daemon.listen`。）
- 验证：取用户 Windows 机器上真实的 `config.json`，用 `packages/protocol/dist/validation/ws-outbound.js` 跑 `set_daemon_config_response`：补 `tcpPort` 前 INVALID（`network.tcpPort expected number, received undefined`，与线上文案一致），补 6777 后 VALID。Go 侧新增 `internal/server/daemon_config_view_test.go` 覆盖 TCP 与 socket/pipe/未设置；`go test ./internal/server -run 'TestNetworkView'` 通过。
- byissue：无影响。**漂移已处理**：`byissue/spec/connection.md` 写「放开局域网时改写 `daemon.listen`」，Go daemon 此前没有实现；本轮由 `2026-11-11-o-daemon-lan-listen-persistence.md` 补上（持久化 + 启动解析 + 视图派生），该条记录保留作为问题来源。
