---
kind: note
title: "Go 里杀子进程：只发 shell 会把真正干活的那个留下；信号要发给进程组"
created: 2026-10-21
---

# 停一个「脚本」≠ 停一个进程

## 症状

`workspace.script.stop` 返回成功，界面显示 `stopped`，但脚本仍在运行、端口仍被占用，
下一次 start 因端口已绑定而失败。

两个独立的问题叠在一起：

1. **只翻状态，不发信号**。`stopWorkspaceScript` 里只有 `entry.Status = "stopped"`，
   `cmd` 根本没保存在 entry 上。这是纯粹的漏实现。
2. **修了第 1 点之后仍然没杀掉**。第一版对 `cmd.Process.Signal(syscall.SIGTERM)` 发信号，
   实测 `pgrep -f "sleep 60"` 依然有进程。

第 2 点是这条 note 的重点。

## 根因

脚本是用 `sh -c "<command>"` 起的（`workspace.BuildShellInvocation`）。真正干活的
`sleep 60` / `vite` / `npm run dev` 是**shell 的子进程**。给 shell 发 SIGTERM，shell 退出，
子进程被 reparent 到 init 继续跑——`exec.Cmd.Wait()` 返回了，看起来「已退出」。

## 做法

```go
cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}   // 起的时候单独成组
...
pid := cmd.Process.Pid
_ = syscall.Kill(-pid, syscall.SIGTERM)                 // 杀整组
go func() {
    time.Sleep(3 * time.Second)
    _ = syscall.Kill(-pid, syscall.SIGKILL)              // 忽略 SIGTERM 的构建也要收掉
}()
```

三段式的理由与 `tree-kill.ts` 一致：先给清理机会，再强制。只 SIGKILL 会让 provider 来不及
写完会话文件，那是用户的历史记录。

## 与 `notes/2026-10-15-byspace-stray-daemon-inventory-and-cleanup.md` 的关系

那份 note 说「用进程树杀，别用进程组」，**结论不冲突，前提不同**：

| 场景                                                   | 可靠做法                 | 为什么                                                 |
| ------------------------------------------------------ | ------------------------ | ------------------------------------------------------ |
| 清理**不属于自己**的残留进程（pid 从文件读到、被复用） | 沿 PPID 树 BFS           | 不知道它的组，`kill -<pgid>` 可能打错或打空            |
| 停**自己刚起的**子进程（`cmd` 句柄在手）               | `Setpgid` + `kill(-pid)` | 组是自己设的，句柄不会指错进程；树遍历反而更慢更容易漏 |

共同点：**不要用裸 pid 假定它代表某个进程组**，`kill(-0, sig)` 打的是自己所在的组。

## 验证方式

只看接口返回不够——返回 `stopped` 本来就成立。要看**进程是否还在**：

```
启动一个跑 `sleep 97` 的脚本 → stop → pgrep -f "sleep 97" → 空
```

第一版修复后这一步是**有输出**的，这才是发现问题的唯一途径。

## 教训

- 「已停止」有三种含义：状态字段变了、句柄收了、**进程真的没了**。只有第三种是用户能感知的。
- 起子进程时如果将来要杀它，一开始就要 `Setpgid`。事后再加，已经起来的那些没有组。
- 端到端验证要断言**外部可观测的事实**（进程表、端口、文件），不要断言接口返回值——
  返回值是产品说的，不是机器状态。
