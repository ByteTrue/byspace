---
kind: issue
title: "local 目录创建 workspace 不再自动跑 setup"
type: ff
created: 2026-11-04
---

# local 目录创建 workspace 不再自动跑 setup

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

`workspace.create`（`source.kind: directory`）原来只要 `byspace.json` 配了 `worktree.setup` 就无条件自动跑，对已装好依赖的 local 目录等于强制 `npm ci`，且用户在 Windows 上撞见（跑了过时缓存里的 `npm run build:server` 还失败）。现在目录路径只回 `setupSkippedReason`，不执行；两个 worktree 创建路径（`ws_project.go` / `ws_agent.go`）和手动 `workspace.setup.run` 不变。

- 改动：`internal/server/server.go` — directory 路径删掉 `go s.runWorkspaceSetup(...)`，恒回 skip 原因（配了命令→`local directory: setup runs only for BySpace-created worktrees`；没配→`no setup commands configured`）；`internal/server/stream_conformance_test.go` — `TestWorkspaceCreateRunsSetup` 翻转为 `TestWorkspaceCreateSkipsSetupForDirectories`（断言 skip 原因 + marker 3 秒内不出现）。
- 验证：`go test ./internal/server/ -run TestWorkspaceCreate -count=1` 两条全绿；原坏法（建带 setup 的 local 目录 workspace）现在得到 skip 原因而非跑命令；全量 `npm run test:go`（`go test ./... `）exit 0。`npm run audit` 在 Windows 上本身是坏的（四步全 ENOENT，另记 note），本次以后者替代。
- byissue：无 spec 变动（setup 触发条件此前没有写进 spec）；本条即痕迹。

顺手发现：本机（Windows）PATH 里没有 `make`，byspace.json 的 setup 第三条 `make build` 在这台机器上即使触发也会挂；修完后 local 目录不再自动跑，只有建 worktree 才需要，届时再定 Windows 的 setup 命令。
