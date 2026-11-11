---
kind: issue
title: "修复 Windows 上 Pi 报找不到 Node：PATH 大小写重复项覆盖真 PATH"
type: ff
created: 2026-11-11
---

# 修复 Windows 上 Pi 报找不到 Node：PATH 大小写重复项覆盖真 PATH

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

---

Windows 生产版（0.24.8）上 `node` 明明在 PATH 里，Pi 仍以 9009 退出并打印 `Pi could not find Node.js`。

根因：Windows 进程环境块保留父进程的变量名大小写，Explorer 启动的 daemon 拿到的是 `Path=`。`internal/server/agentenv.go` 的 `envValue`/`setEnv` 与 `internal/execres/find.go` 的 `AppendStandardDirs` 都按字面 `PATH` 匹配：真正的 `Path` 条目没被找到，也没被替换，于是追加了只含 `C:\Users\zijie1\apps` 和 `~/.pi/agent/bin` 的第二条 `PATH`；Windows 解析后出现的那条，子进程 PATH 里就没有 `C:\Program Files\nodejs` 了。macOS 的变量名恰好是 `PATH`，所以只有 Windows 中招。

- 改动：`internal/server/agentenv.go` — `setEnv`/`envValue` 改用 `sameEnvKey`（`strings.EqualFold`）；`internal/execres/find.go` — `AppendStandardDirs` 按大小写不敏感找到 PATH 条目，并在原位置按原拼写写回，不再追加第二条。
- 验证：在用户 Windows 机器（10.1.115.59）上读到 daemon 进程的 PEB 环境块确为 `Path=...` 且含 `C:\Program Files\nodejs\`；用同样的 env 组装逻辑跑 `cmd /c node -v`，旧逻辑 `'node' is not recognized`（9009），就地替换后输出 `v26.13.0`。Go 单测 `TestEnvHelpersMatchNamesRegardlessOfCase`、`TestAppendStandardDirsExtendsTheInheritedEntry` 通过。
- byissue：新增 note `2026-11-11-windows-env-block-key-case.md`。**未验证**：装上新二进制的 Windows 包后 Pi 能否真正起来（本机只验证了环境组装，没替换用户的 0.24.8 安装）。
