---
kind: issue
title: "Windows terminal: no PTY backend in the Go daemon"
type: bug
created: 2026-10-28
---

# Windows terminal: no PTY backend in the Go daemon

## 预期与实际

**预期**：在 Windows 主机上新建终端，打开一个用配置的 shell（`pwsh.exe`）的标签页。

**实际**：弹出一个只有 `unsupported` 一词的提示，不创建标签页。同一台主机上 agent 正常工作，只有交互式终端坏。

## 根因

`internal/terminal/pty.go` 无条件调用 `github.com/creack/pty`：

```go
ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
```

`creack/pty v1.1.24` 没有 Windows 后端，在 Windows 上编译的是 `pty_unsupported.go`，`open()` 返回 `ErrUnsupported = errors.New("unsupported")` —— 与 UI 里那个词的字节完全一致。`internal/terminal` 下没有任何 Windows 专用文件，0.21.0 的 Windows 二进制里也没有 ConPTY 符号（`CreatePseudoConsole`）。

Node 版有专门的 Windows 终端工作（PR #4 / PR #7），Go 重写时整个丢了。

## 影响面

**必须改**：`internal/terminal/pty.go` 的启动、读写、resize、关闭路径。

**需要验**：`Session` 的读循环、`writeMu` 串行化、`Resize`、`Close`、`Wait` 拿退出码、`OSC` 应答回写。

**仍未知**：ConPTY 下进程组语义与 Unix 不同，`internal/providers` 里杀进程组的逻辑是否受影响需要单独确认（不在本 issue 范围，发现即记）。

## 方案

引入 `github.com/aymanbagabas/go-pty v0.2.3`，它同时提供 Unix 与 Windows（ConPTY）后端：

- `pty.New()` 返回 `Pty` 接口，Windows 上走 ConPTY
- `pty.Command(name, args...)` 返回可设置 `Dir` / `Env` 的 `*Cmd`
- `Resize(width, height)` 跨平台，替代 `creack/pty` 的 `Setsize`

改动集中在 `pty.go`：保留 `Session` 的全部外部行为（`Read` 循环、`Write`、`Resize`、`Close`、`Wait`、退出码），只把底层的 `*os.File` 换成 `pty.Pty`。

**有界简化**：不改 `internal/providers` 的进程组终止逻辑。已知上限——Windows 上 ConPTY 的子进程树终止语义与 Unix 不同；升级触发——出现「关闭终端后子进程残留」的报告。

另外把错误信息改成人能读的：即使某平台仍不支持，也别让库的裸 `unsupported` 直接进 UI。

## 验证

1. 现有 `internal/terminal` 测试全绿（Unix 路径不被破坏）
2. `GOOS=windows go build ./...` 通过
3. Windows 真机：新建终端 → 标签页打开 → 能输入、能 resize、能关闭
4. 用原来的坏法再看一眼：Windows 上新建终端不再弹 `unsupported`

## 执行记录

- 引入 `github.com/aymanbagabas/go-pty v0.2.3`（Unix + Windows ConPTY 双后端），替换 `creack/pty`。
- `Session.ptmx` 从 `*os.File` 改为 `pty.Pty`，启动改走 `pty.New()` + `term.Command()`，resize 改走 `Pty.Resize(width, height)`。Unix 上 `pty.Pty` 的读写仍是同一个 master fd，所以读循环、`writeMu` 串行化、退出码回收都没动。
- `osc_color_test.go` 里的 `*os.File` 替身用一个 `writerOnly` 适配器满足接口；只用到 `Write`，其余方法不会执行。
- `GOOS=windows go build ./...` 通过，产物里能查到 `CreatePseudoConsole` 符号。
- macOS 真机验证：新建终端、`echo` 回显、resize 均正常（用真实 daemon 跑）。
- 未验证：Windows 真机。需要在一台 Windows 上跑一次新建终端，这是本 issue 唯一遗留的验证项。

### Windows 真机验证（已完成）

在 `zijie1@10.1.115.59`（Windows 11, build 26300.9711, AMD64）上用构建产物实测：

- 通过 SSH 隧道把 Windows daemon 的 6777 映射到本机 16777，用 bsk 打开 web UI。
- 新建项目、新建 workspace、`Ctrl+Shift+T` 打开终端：**没有出现 `unsupported`**，终端标签页正常创建。
- `echo WINDOWS_PTY_OK_$((6*7))` 返回 `WINDOWS_PTY_OK_42`。
- `mode con` 输出 `Lines: 55 / Columns: 206 / Code page: 437`，证明拿到的是真实 ConPTY 而非伪终端，且 resize 生效。

**Windows 上启动 daemon 的坑**（与产品无关，记录供后续测试用）：`Start-Process` 和 SSH 直接执行都会在会话结束时把 daemon 一起杀掉。可靠做法是注册计划任务再 `Start-ScheduledTask`，进程才脱离 SSH 会话存活。

## 结论

已交付。代码提交 `24a7b83de`，验证记录见上。

## 沉淀去向

- **`docs/go-parity-audit.md` →「编译得过不等于跑得起来」**：`creack/pty` 在 Windows 编进
  `pty_unsupported.go`、运行时返回哨兵错误；交叉编译和单测都看不见这类缺陷。同在 `pty.go` 的注释里
  留了具体选型理由。
- 产品边界未变（Terminal 的字符与顺序语义在 `byissue/spec/terminal.md`），不需要回写 spec。
