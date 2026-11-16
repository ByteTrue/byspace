---
title: "Windows 环境块保留变量名大小写，手工拼 env 列表必须忽略大小写"
created: 2026-11-11
---

# Windows 环境块保留变量名大小写，手工拼 env 列表必须忽略大小写

**结论：** Windows 进程环境块里的变量名保留创建者的拼写，Explorer 启动的 daemon 通常是 `Path=` 而不是 `PATH=`。`os.Getenv` / `exec.LookPath` 在 Windows 上大小写不敏感，所以探测、`Find`、`Lookup` 都不会暴露问题；一旦代码自己遍历 `[]string`（读值、替换、追加），字面匹配 `PATH` 就会漏掉真实条目并追加第二条同名不同大小写的 `PATH`。Windows 解析重复项时用后出现的那条，子进程于是丢失真正的 PATH。

**判断信号：** provider 子进程报 `'node' is not recognized` / 退出码 9009，但机器上 `where node` 正常、daemon 进程的 PATH 也确实包含 node 目录；或任何 `cmd.exe` / JS CLI 在 daemon 下找不到同 PATH 里的工具。macOS/Linux 不会复发，单测默认都在 `PATH` 拼写下跑，CI 也测不出来。

**复核：** 读目标进程的环境块，不要读自己的 shell。elevated 不需要，同用户即可：`NtQueryInformationProcess` 取 PEB → `ProcessParameters`（x64 偏移 0x20）→ `Environment`（偏移 0x80），UTF-16、双 NUL 结尾。2026-11-11 在 Windows 机器 10.1.115.59 上读 PID 29684（byspace 0.24.8）得到 `Path=C:\...\Program Files\nodejs\;...`。同一台机器上用该 env 跑 `cmd /c node -v`：追加第二条 `PATH` 时 9009，就地替换时 `v26.13.0`。

**规则：** 处理 env 列表的键（`setEnv`、`envValue`、`AppendStandardDirs`、任何 `home.ExternalProcessEnv` 的上层拼装）用 `strings.EqualFold` 比较，并按已有条目的原拼写写回。`internal/terminal/pty.go` 的 `prependDirToPath` 早就是这么做的，可作参照；`docs` 里没有第二条相关约束。

**为什么记这条：** 2026-11-11 的 `2026-11-11-x-ff-windows-env-path-key-case.md` 就是它导致的：`internal/server/agentenv.go` 和 `internal/execres/find.go` 各有一处字面 `PATH` 匹配，两个叠在一起让 Pi 在 Windows 上完全起不来。
