---
kind: note
title: "清理由已删除 worktree 留下的 BySpace daemon：怎么数、怎么归因、怎么不误杀"
created: 2026-10-15
---

# 清理由已删除 worktree 留下的 BySpace daemon

来源：2026-10-15 清掉 71 个残留进程。问题本身见 [issues/2026-10-15-x-worktree-daemons-survive-deletion.md](../issues/2026-10-15-x-worktree-daemons-survive-deletion.md)。这里只记操作。

## 三个会让排查看错的地方

**1. `BySpace Supervisor` / `BySpace Daemon` 是 `process.title`，`ps` 里没有路径。** 直接 grep 名字只能得到 PID，判断不了归属。归属靠 `lsof -a -p <pid> -d cwd -Fn` 读 cwd。

**2. 孤儿进程的 ppid 是 1，这是正常现象，不是判据。** 有个容易犯的错是把「ppid 是 1」当成可疑信号——反过来也会错：把「祖先链里有 1」写进保护条件，会让所有孤儿进程被静默排除在清单外，看起来像「清干净了」。保护条件只写明确要保的 PID。

**3. 不要 `pkill -f BySpace`。** 它会把正在服务用户的那个 daemon 一起杀掉（那个 daemon 管着运行中的 agent）。必须按 PID 清单精确终止。

## 清单怎么建

判据是「命令行或 cwd 指向目标 worktree」，两个来源取并集：

```bash
WT="/path/to/.byspace/worktrees/<slug>/<name>"

# (a) 命令行里出现该路径：relay、terminal-worker、esbuild 走这条
ps -eo pid=,command= | grep -F "$WT" | awk '{print $1}'

# (b) BySpace Supervisor/Daemon 用 cwd 归因
for pid in $(ps -eo pid=,command= | awk '/BySpace (Supervisor|Daemon)[[:space:]]*$/ {print $1}'); do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep '^n' | head -1 | cut -c2-)
  case "$cwd" in "$WT"*) echo "$pid";; esac
done
```

然后**展开传递闭包**（`pgrep -P` 逐层），否则会漏掉 daemon 底下的 terminal-worker 和 esbuild。最后从清单里显式剔除受保护的 PID 和排查 shell 自己的祖先链。

**杀手顺序很重要：先 `SIGTERM` supervisor。** supervisor 带 `restartOnCrash: true`，先杀 daemon 会被它拉起来。supervisor 停掉后其余进程一次 `SIGTERM` 即可；实测会有约四分之一不响应，收尾再对清单里还活着的补 `SIGKILL`。

## 收工验证

```bash
ps -eo pid,command | grep -cF "$WT"                       # 期望 0
lsof -nP -iTCP:<用户 daemon 端口> -sTCP:LISTEN            # 期望仍在监听
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/health   # 期望 200
```

杀完要顺手确认受保护的那个 daemon 还活着**且响应**——只查「进程还在」不够。

## 用进程树杀，别用进程组

清理完顺手检查有没有自己的探针漏下来时，会撞上同一件事：`kill -9 -<pgid>` 只覆盖还在那个组里的进程。交互式 shell 的 job control 会给每条命令**单独一个组**，`detached: true` 更是直接脱离任何可命名的组。所以「按组杀」在真实终端里经常漏掉最外层那个长命进程。

可靠的做法是沿 PPID 树走（`listProcessTreePids` 就是这么实现的）：先取一次 `ps -Ao pid=,ppid=` 快照建 children map，再 BFS 展开。**快照必须在信号之前取**——父进程一退出，子进程就被 reparent 到 init，和 shell 的那条链就断了，之后就再也找不回来。

两个自己踩到的坑：

- `process.kill(-0, sig)` 等于 `process.kill(0, sig)`，打的是**自己所在的进程组**。任何不可信的 pid 进 `process.kill` 之前都要挡 `<= 0`。
- 探针脚本自己也会泄漏（空转的 `setInterval` + 一个 `spawn`）。跑完按同样的判据复查一遍 `ps`，别只清现场的、留下自己的。
