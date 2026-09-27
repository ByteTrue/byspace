---
kind: issue
title: "Windows：daemon 启动不再弹出控制台窗口"
type: ff
status: closed
created: 2026-09-27
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# Windows：daemon 启动不再弹出控制台窗口

Windows 上 daemon 一启动就固定弹出一个空的「Windows PowerShell」窗口，并且一直留着。daemon 是脱离控制台启动的，任何没显式隐藏的子进程都会让 Windows 为它新建一个可见控制台；这里弹的是 supervisor 拉起 worker 时的那个子进程，标题是 Windows Terminal 默认 profile 名，跟 PowerShell 没关系。

- 改动：`packages/server/scripts/supervisor.ts` — worker 的 `fork`/`spawn` 加 `windowsHide: true`（常驻窗口的来源）
- 改动：`packages/server/src/terminal/worker-terminal-manager.ts` — 终端 worker `fork` 同样隐藏
- 改动：`packages/server/src/server/session/daemon/daemon-service-manager.ts` — 开机即跑的计划任务探测与 `npm prefix -g` 加 `windowsHide`（每次启动约 1.2s 的闪现窗口）
- 改动：`packages/server/src/server/session/daemon/daemon-service-install.ts`、`packages/server/src/utils/worktree.ts` — 同类 daemon 侧 powershell/shell 调用补齐
- 验证：用 `EnumWindows` + `IsWindowVisible` 数可见窗口。修前：daemon 启动前 17，启动后 18 且持续存在，owner 是 `WindowsTerminal`；修后 17/17/17。单独跑 `queryDaemonServiceView()` 同样从 +1 变 0。`npm run typecheck`、`npm run lint`、`supervisor.logging` + `supervisor.lifecycle-intents`（10 passed）
- 注意：本机 Node v24 上 `windowsHide` 的**默认值实测不生效**——省略该选项就会弹窗口，所以 daemon 侧每个子进程都得显式传。`ForkOptions` 类型里没有这个字段，运行时由 `spawn` 接收，两处用 `ForkOptions & Pick<SpawnOptions, "windowsHide">` 标注
- byissue：无影响；`spec/` 未描述控制台窗口行为

顺手发现（可选）：`packages/cli/src/commands/daemon/service/windows-task.ts:54` 的 `spawnSync("powershell.exe")` 同样没传 `windowsHide`，CLI 通常在终端里跑所以继承控制台、不弹窗，不在本次范围。
