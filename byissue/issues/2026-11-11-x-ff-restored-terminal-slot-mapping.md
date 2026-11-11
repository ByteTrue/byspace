---
kind: issue
title: "修复 daemon 重启后恢复的 terminal tab 报 Terminal not found"
type: ff
created: 2026-11-11
---

# 修复 daemon 重启后恢复的 terminal tab 报 Terminal not found

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

---

远程连接/daemon 重启后，客户端恢复到几个 terminal tab；点开显示 "Terminal not found"，只有新建一个 terminal 才正常。

根因：`restorePersistedTerminals`（`internal/server/runtime_services.go`）把恢复出来的 session 放进 `s.terminals`，但没有写 `s.terminalSlotsByID[created.ID] = slot`。`list_terminals_request` 直接遍历 `s.terminals`（所以 tab 会出现在列表里、不会被客户端的 stale-tab 清理删掉），而 `subscribe_terminal_request`、`terminal_input`、`capture_terminal_request`、`kill_terminal_request`、rename 全部通过 `terminalSlotsByID` 解析 → 恢复的 tab 一律 "Terminal not found"。新建 terminal 走正常的 create 路径，会注册映射，所以新 tab 正常。

- 改动：
  - `internal/server/runtime_services.go` — 恢复时走统一的 `registerTerminalSession`：同一把锁内找空槽位、写入 `s.terminals` 和 `s.terminalSlotsByID`。原实现用从 1 开始的 `nextTerminalSlot`，而 create 路径用 `len(s.terminals)`，所以重启后新建的第一个 tab 会覆盖最后一个恢复的 shell（且新映射让旧 ID 指向新 shell）。
  - `internal/server/ws_workspace.go`、`internal/server/ws_plugin_setup.go`、`internal/server/server.go` — 所有插入 terminal 的路径改用同一个注册函数；`ensureTerminalSlot` 补上 ID 映射。
  - `internal/server/ws_project.go` — 归档/停止工作区删除 terminal 时同步删除 `terminalSlotsByID`，避免槽位复用时旧 ID 路由到新 terminal。
- 验证：新增 `internal/server/terminal_restore_test.go`。只放映射断言在干净 HEAD 上会失败；现在覆盖「恢复后新建 terminal 不覆盖恢复槽位」和「每个列出的 terminal 都能通过 `terminalSlotsByID` 解析」。`go test ./internal/server` 与 `npm run audit -- --no-browser` 全过。
- byissue：无影响。
