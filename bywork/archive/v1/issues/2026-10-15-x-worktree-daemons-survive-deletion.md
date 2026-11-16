---
kind: issue
title: "worktree 删除后，从它启动的 daemon 活了下来：kill 只打直接子进程，心跳又够不到它的 home"
type: bug
created: 2026-10-15
---

# worktree 删除后，从它启动的 daemon 活了下来：kill 只打直接子进程，心跳又够不到它的 home

> **读者：** 接手 terminal kill、workspace service 生命周期或 worktree 归档清理的人。清理现场的命令与陷阱见 [notes/2026-10-15-byspace-stray-daemon-inventory-and-cleanup.md](../notes/2026-10-15-byspace-stray-daemon-inventory-and-cleanup.md)。
>
> 两条独立的闸都失效才导致 6 天不收敛：**杀掉那棵树**（归档路径没打穿，见「根因」），和**杀掉树**（pid-lock 心跳够不到 home，见「第二条泄漏路径」）。少修任何一条，下一次仍会泄漏。

## 预期 / 实际

**预期：** 一个 worktree 被归档、目录被删除后，从它启动的 workspace service（`byspace.json` 里的 `scripts.daemon`）随之结束。没有任何进程继续把一个已不存在的目录当作 cwd。

**实际：** 2026-10-15 在一台机器上清出 **71 个进程**，全部指向 2026-10-10 就已归档、目录早已不存在的 worktree。它们在 10-09 11:20–11:54 分批启动，**存活 6 天 21 小时**，期间持有 **33 个监听端口**。

## 证据

| 项             | 值                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 进程数         | 16 supervisor + 16 daemon + 16 terminal-worker + 16 esbuild + 7 relay = 71                                                                              |
| 启动时刻       | 10-09 11:20:27–11:54:45，7 批（6 批 2 个、1 批 4 个），批内相隔约 1 秒                                                                                  |
| cwd            | `/Users/zijie/.byspace/worktrees/090riccu/tough-elk/packages/server`（目录不存在）                                                                      |
| workspace 记录 | `wks_8553098039c0e40a`，`isBySpaceOwnedWorktree: true`，`mainRepoRoot: /Users/zijie/workspace/projects/byspace`，`archivedAt: 2026-10-10T14:08:23.760Z` |
| 内存           | supervisor 11–13MB + daemon 21–23MB，两层合计约 540MB                                                                                                   |

进程标题是 `process.title` 设的 `BySpace Supervisor` / `BySpace Daemon`，`ps` 里看不到路径，**归属只能靠 cwd 判断**——这是上面「指向已删除 worktree」结论的得出方式，也是排查时最容易看错的地方。

## 根因

**`terminal.ts` 的 kill 只打到直接子进程。**

`killPtyProcess` 调 `ptyProcess.kill()`，而 node-pty 的实现是 `process.kill(this.pid, signal)`（`node-pty/lib/unixTerminal.js:228`）。于是 shell 之下的一切都收不到信号：它们被 reparent 到 init，永远留着。

实测确认，实测时踩到两种逃逸，**只打进程组（`-pid`）也不够**：

- **job control**：交互式 shell 给每条命令单独一个进程组。命令的 pgid 不等于 shell 的 pgid，所以对 shell 组发信号打不到它。这是 BySpace 终端的**默认形态**——服务命令是「typed」进交互 shell 的。
- **`detached: true`**：完全脱离任何可命名的组。`local-daemon.ts:597` 的 `byspace daemon start` 就是这么起的。

所以修法只能是**沿 PPID 树走**，且必须在**信号之前**取快照——父进程一退出，子进程就被 reparent 到 init，和 shell 之间的链就断了。

## 修法

- `packages/server/src/utils/tree-kill.ts`（新导出）：`listProcessTreePids(rootPid)`。用一次 `ps -Ao pid=,ppid=` 快照建 children map，BFS 展开，父先子后。POSIX only——Windows 没有 PPID 树可走，那边靠 console process list。
- `packages/server/src/terminal/terminal.ts`：
  - `signalPtyProcessTree(signal)` 取代对 `ptyProcess.kill()` 的单点调用。
  - `killAndWait` 先取快照，再 `SIGHUP`；升级条件从「shell 是否退出」改成「shell 没退出 **或** 快照里还有活着的人」。原来只等 shell 退出，而 shell 退出得很快——trapping SIGHUP 的后代照样活下来，这条路径会**报成功**，这正是泄漏的来源。
  - `kill()` 是无等待路径，走 `forceKillPtyProcessTree()`：先快照，再 `SIGKILL`。
  - `ptyProcess.pid <= 0` 时退回 `ptyProcess.kill()`。`-0 === 0`，而 `kill(0, sig)` 打的是**守护进程自己的进程组**，不可信的 pid 绝不能进 `process.kill`。

**有界简化。** 够不到的两种情况，代码注释里已写明：已经 reparent 的进程（和 shell 再无链），以及快照与信号之间新生的进程。所以 `supervisor-entrypoint.ts` 的 pid-lock 心跳仍是必要的第二道闸——见下面 Q1。

## 验证

新增两条 POSIX 测试（`packages/server/src/terminal/terminal.posix.test.ts`），都先跑红再修绿：

- **traps SIGHUP、留在 shell 组里**的后代 → 修前泄漏，修后回收。
- **traps SIGHUP 且 `detached: true` 自建进程组**的后代 → 这条连「改组信号」都打不到，只有 PPID 走树能收。

外加 `listProcessTreePids` 的两条单测（`src/utils/tree-kill.test.ts`）：能到自建组后代；叶子进程只返回自己。

**端到端实测**（真实 `createTerminal` + 交互 zsh + 5 层链 `zsh → dev-daemon → npm → concurrently → dev-runner → supervisor`，最深层 trapping SIGHUP）：`killAndWait` 后 `pgrep -f chain.js` 为空。实测时最深层 pid 的 pgid 与 shell 不同，确认是走树而不是组信号起的作用。

命令：`npx vitest run src/terminal/ src/utils/tree-kill.test.ts src/utils/hidden-daemon-children.test.ts src/server/workspace-archive-service.test.ts src/server/session/workspace-scripts/workspace-scripts-service.test.ts`（340 passed / 7 skipped）；`npm run lint`、`npm run typecheck` 全清。

## Q1：心跳这条闸是好的（原假设被证伪），但它的前提没成立

原稿怀疑「pid lock 随 worktree 消失后没触发自杀」。三次实测把它拆成了两步：

**心跳本身没问题。** 用 `supervisor-entrypoint.ts` 的真实接线（`acquirePidLock` 加 `startPidLockHeartbeat` 加 `runSupervisor`，worker 换成空转进程）跑，删掉 home 后 supervisor 在 **约 11 秒**内自行退出，stderr 连续 4 次 `Cannot refresh PID lock: lock file is missing`，最后 `Worker exited (SIGKILL). Supervisor shutting down.`。删掉 cwd 也照样能察觉（`existsSync(process.cwd())` 变 false）。

**但「home 落在 worktree 里」这个前提不成立。** 三条实测：

1. `BYSPACE_HOME` **不在** `RUNTIME_CONTROL_ENV_KEYS` 里（`byspace-env.ts:6`），所以它随 `buildTerminalEnvironment` 传给终端，再传给 terminal 里起的一切——实测 `/bin/sh` 里能读到父进程的 `BYSPACE_HOME`。同文件里 `BYSPACE_SUPERVISED`、`BYSPACE_DESKTOP_MANAGED` 是被剥掉的，只有 `BYSPACE_HOME` 漏了。
2. `configureDevBySpaceHome()` 的第一件事是 `if (process.env.BYSPACE_HOME) return process.env.BYSPACE_HOME`，**继承来的 home 优先于 `BYSPACE_WORKTREE_PATH`**。实测：同一个 worktree 路径，不继承时得到 `<worktree>/.dev/byspace-home`，继承时得到父 daemon 的 home。于是 worktree 里的 service 把 home（连带 pid lock 和 daemon.log）留在 worktree 之外，删 worktree 自然删不到它，心跳永远等不来 ENOENT。
3. 反过来，pid lock **确实**排他：同 home 的第二个 supervisor 会被拒（实测退出码 1，`rejected-B`）。

所以 6 天没收敛的链条是：**home 不在 worktree → 心跳等不到「lock 没了」→ 没人杀那棵树**。第二段（没人杀树）已由本 issue 的 PPID 走树修好；第一段（home 位置）见下。

## 第二条泄漏路径：service 继承了父 daemon 的 home

上面第 2 条不是理论推断，已端到端复现。用真实的 `dev-home.mjs` 加真实的 `acquirePidLock`/`startPidLockHeartbeat` 起一个 cwd 在 worktree 里、env 继承了一个外部 home 的进程：

| 观察点                                    | 结果                                                 |
| ----------------------------------------- | ---------------------------------------------------- |
| 它解析出的 home                           | 外面那个（worktree 之外）                            |
| worktree 里有没有生成 `.dev/byspace-home` | 没有                                                 |
| 删掉 worktree，16 秒后                    | **仍存活，且没有任何 `HEARTBEAT_ERROR`**             |
| 再删掉它真正的 home                       | 立刻 `Cannot refresh PID lock: lock file is missing` |

**触发点是一行代码**：`scripts/dev-home.mjs:139` 把 `BYSPACE_HOME` 写进了 dev daemon 自己的 `process.env`。service 由这个 daemon 拉起、继承该变量，而 `configureDevBySpaceHome` 的第一行就把它 `return` 了——`BYSPACE_WORKTREE_PATH` 根本没机会参与。所以每个 worktree 的 setup 明明准备了 `<worktree>/.dev/byspace-home`（`seed-worktree-dev-state.mjs:27`），运行时却没人用它。

## 修法（第二段）

`scripts/dev-home.mjs`：新增 `isWorkspaceServiceProcess()`（判据是 `BYSPACE_SERVICE_DAEMON_PORT`——runner 给 workspace 里每个 service 都注入它）。service 进程跳过「继承 home」分支，按 worktree 自己的路径解析。

回归验证（短心跳间隔，同一套真实代码）：

| 场景                                               | home 落点           | 删 worktree 后心跳 |
| -------------------------------------------------- | ------------------- | ------------------ |
| service（带 `BYSPACE_SERVICE_DAEMON_PORT`）        | worktree 里面 ✅    | 察觉 ✅            |
| 非 service（用户在 worktree 里直接 `npm run dev`） | 继承的 home（不变） | 不变               |

两条测试写进 `scripts/dev-home.test.mjs`（`node --test` 5 passed）。已做红-绿：回退修复后新测试变红、另一条保持绿。

## 仍未知

- **16 个 home 从哪来。** 由上面第 3 条可以反推：同 home 不可能有 16 个 supervisor 同时活着（pid lock 排他），所以那 16 套**各有各的 home**。但 7 批里的 16 个 cwd 完全相同，看不出差别；logs 已随 worktree 删除，无从核对。
- **`--inspect` 端口线索。** 16 个 daemon 里 15 个监听两个端口（service 端口加 `--inspect=0` 的随机端口），**只有 74688 用 9229**——9229 是 `--inspect` 不带 `=0` 的默认端口，而 `dev-daemon.mjs` 必定写 `--inspect=0`。那棵树**没走 `dev-daemon.mjs`**，存在第二条启动入口。
- **7 批叠加未解释。** 每批留下一整套进程树，说明 service 重启没收停前一批。本 issue 修的是「杀掉树」，「重启时是否先停旧的」是另一条路径，未查。
- **「给 service 剥掉 `BYSPACE_HOME`」这条路没走。** `createExternalProcessEnv` 同时服务终端和 agent，在那里剥会改变所有 dev 终端里 `byspace` CLI 的默认 home 解析。改成在 `dev-home.mjs` 里只让 service 不采用继承的 home，改动落在真正做决定的那一层，影响面小得多。

## 关闭结论

**判断：两条闸都修好了，已达目标。** 6 天不收敛需要两条闸同时失效，现在两条都堵上：归档路径能打穿进程树（PPID 走树），service 的 home 也落回自己的 worktree（心跳够得到，删 worktree 后约 30 秒内自停）。

**质量证据：**

| 闸              | 证据                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 杀掉那棵树      | 2 条 POSIX 测试（traps SIGHUP 留组内、`detached: true` 自建组），先红后绿；2 条 `listProcessTreePids` 单测；真实 `createTerminal` + 交互 zsh + 5 层链端到端实测，`killAndWait` 后 `pgrep` 为空                                      |
| 心跳够得到 home | 真实 `dev-home.mjs` + 真实 `acquirePidLock` / `startPidLockHeartbeat` 端到端复现：修前 home 落 worktree 外、删 worktree 后 16 秒仍存活且零 `HEARTBEAT_ERROR`；修后 home 落 worktree 内、心跳察觉。2 条 `node --test` 测试，先红后绿 |

`npm run lint` / `npm run typecheck` / `npm run format:check` 全清。

**回写位置：** 没有毕业进 Project Spec。本次的稳定结论是工程实现约束（kill 必须走 PPID 树、service 必须拥有自己 checkout 内的 home），按 Project Spec 的准入判据不写——它已在代码注释里承重，读代码更准。可复用的排查与清理手法留 notes。

**遗留（都靠重新复现，不是本 issue 的完成条件）：**

- **16 个 home 从哪来未解开。** pid lock 排他（实测第二个被拒、退出码 1），所以 16 个 supervisor 共存必有 16 个不同 home，但 7 批 cwd 完全相同，logs 已随 worktree 删除。
- **`--inspect` 9229 线索**：16 个 daemon 里 15 个用 `--inspect=0` 的随机端口，仅 1 个用 9229（`--inspect` 的默认端口），说明存在第二条启动入口。未追。
- **7 批叠加**：每批留下一整套树，「service 重启是否先停旧的」是另一条路径，未查。

**有界简化：** 走树有两个够不到的情况（信号前已 reparent 的进程、快照与信号之间新生的进程），已在代码注释写明。所以 pid-lock 心跳不是冗余的第二道闸，是必要的一道——两者互为补集。

## 执行记录

- 2026-10-15：清掉全部 71 个进程（先 `SIGTERM` supervisor 阻断重启，再清理其余，15 个赖着不走的用 `SIGKILL`）。清理时显式排除当时在跑的 6777 daemon 进程树和排查 shell 自身的祖先链，清完验证 6777 仍监听且 `/health` 返回 200。
- 2026-10-15：定位根因（`ptyProcess.kill()` 只打直接子进程），实现 PPID 走树修复，补 4 条测试，端到端实测 5 层链全部回收。
- 2026-10-15：查清 Q1。三次实测（心跳在 home 删除后约 11 秒生效；`BYSPACE_HOME` 会继承进终端；继承的 home 优先于 `BYSPACE_WORKTREE_PATH`）把「为什么心跳没救场」收敛到「home 不在 worktree」。
- 2026-10-15：**试过一版「supervisor 发现 cwd 消失就退出」的补丁，已撤回。** 生产 daemon 的 cwd 是 `/Users/zijie`，不是 worktree；这条检查会在无关场景下杀掉正常 daemon，而「当时 home/cwd 究竟在哪」又无从证实。按仓库「零复杂度预算 / 不给未证实的假设加防御代码」的标准，不留它。
- 2026-10-15：复现第二条路径（cwd 在 worktree 内、env 继承外部 home）并修 `dev-home.mjs`，补 2 条红-绿测试。
- **现场证据已随清理消失**：进程已杀、worktree 已删、`daemon.log` 一并没了。上面「仍未知」的三点要靠重新复现，不能继续挖旧现场。
