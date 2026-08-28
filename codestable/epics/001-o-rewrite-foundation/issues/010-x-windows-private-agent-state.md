---
kind: issue
title: "修复 Windows Agent state 私有 ACL 与运行时加载"
type: bug
status: closed
created: 2026-08-28
---

# 修复 Windows Agent state 私有 ACL 与运行时加载

## 做成以后是什么样

Windows 上由 byspace 创建的 `state/agents-v1.json` 使用受保护 DACL，仅允许当前用户与 LocalSystem 访问；同一进程保存后可立即重新加载。Unix 继续要求目录无 group/world 权限、文件为 private regular file。

**范围：** 修复 Agent state store 的跨平台 private-path secure/validate seam，并复用 Relay registry 已验证的 Windows DACL 规则；保留现有 atomic replace、fail-stop 与 catalog wire format。暂不把本切片扩成 daemon log/PID/Pi session directory 的全仓 ACL 改造。

## 为什么现在做 / 当前坏在哪

预期：Issue 007 承诺 `agents-v1.json` 在 Windows 可私有持久化并恢复。

实际：`state_store.go` 写入后用 `Mode().Perm()&0077` 校验 `0600`。Windows `os.FileInfo.Mode().Perm()` 对合法文件通常显示 `0666`，因此 daemon 第二次加载自己刚保存的状态时 fail closed。原生 Windows test binary 已复现 `permissions are 0666, want private 0600`；此前 Windows cross-build 只能证明可编译，不能证明运行语义。

根因：Agent store 把 Unix mode bits 当成了跨平台访问控制模型；Relay remote-host/identity 路径后来已有 current-user + LocalSystem protected-DACL 实现，但 Agent store 未复用。

## 动哪些、验哪些

- 把 private directory/file secure + validate 下沉为 Go internal shared helper：Unix 使用 mode bits，Windows 使用 owner、protected DACL、allowed principals 与 reparse-point 校验。
- Agent state save/load 使用 shared helper；不得在 Windows 简单跳过权限检查。
- Relay 保持现有 API/行为并复用同一 helper，避免两套 DACL 规则漂移。
- 以 Linux race tests、Windows test binary 原生执行、Relay ACL tests 与 Windows cross-build验证。

## 质量承诺

- **信息安全性 / 保密性与完整性：** Windows state 只授权当前用户与 LocalSystem，拒绝 reparse point、错误 owner、继承 DACL 或其他 principal。
- **可靠性 / 可恢复性：** Windows 保存后的合法 catalog 可重新加载，损坏/权限非法状态仍 fail closed 且不覆盖。
- **可维护性 / 可测试性：** Agent 与 Relay 的平台访问控制只有一个 internal 实现，避免规则漂移。

## 实现记录

- 新增 `go/internal/privatepath` 作为单一跨平台策略：Unix secure/validate 使用 private mode bits；Windows 使用 current-user owner、current-user + LocalSystem allow ACE、protected DACL 与 reparse-point/type 校验。
- `go/internal/agent/state_store.go` 在写临时 catalog 前 secure directory/file，加载前 validate final file；缺失文件仍表示空 catalog，其余访问控制错误带路径 fail closed。
- `go/internal/relay/private_path.go` 保留已有 Relay API，但委托给同一 shared helper；原 Windows DACL 测试迁入 helper package，避免两套策略漂移。
- atomic temp → file sync → replace → directory sync、post-replace uncertainty fail-stop 与 catalog wire format 均未改变。

## 验证记录

- `cd go && go vet ./... && go test -race ./... && GOOS=windows GOARCH=amd64 go build ./...`：通过。
- `cd go && go test -race ./internal/agent ./internal/relay -count=30`：30/30 通过。
- 交叉编译 `internal/privatepath`、`internal/agent`、`internal/relay` 的 Windows test binaries，并从正确 package cwd 经原生 `cmd.exe` 执行：Agent 与 Relay suites 通过；shared privatepath DACL test 10/10 通过。
- Windows Agent native suite 覆盖多次 persistent-manager save/reopen、final-file protected DACL 验证、corruption preservation 与未知 version；修复前的 `0666` mode-bit 误判不再出现。
- `npm run test:e2e:go-daemon`：2/2 Playwright tracers 通过，daemon restart/persisted Agent path 无回归。
- 独立 focused review：无 P0/P1/P2，结论 `No issues found / Merge OK`。

## Closure

Windows Agent state runtime 已从不适用的 Unix mode-bit 判断切换为真实 protected-DACL 模型；保存后恢复、非法 ACL 拒绝、Unix 行为与 Relay registry 均有验证。按用户对普通 Issue 的 standing authorization，本 Issue 关闭。
