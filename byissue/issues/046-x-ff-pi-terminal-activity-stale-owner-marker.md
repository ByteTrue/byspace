---
kind: issue
title: "修复 Pi 终端活动因过期 owner marker 被永久静音"
type: ff
status: closed
created: 2026-09-22
---

# 修复 Pi 终端活动因过期 owner marker 被永久静音

## 预期与实际

预期：在 BySpace 终端里运行 Pi，开始一个 turn 后终端圆点显示「进行中」，turn 结束回到空闲。

实际（用户报告）：重启 Pi 之后（`pi --continue` 或直接重开），新 Pi 完全不上报，界面既没有「进行中」也没有任何状态；只有第一次启动的 Pi 正常。

## 根因

Pi 扩展用 `BYSPACE_PI_TERMINAL_HOOK_OWNER_PID` 防止被继承的子 Pi 重复注册上报器。该变量写在 `process.env` 上，是**进程内状态**，却会被子进程继承：

1. Pi 扩展把自己 pid 写进 `process.env.BYSPACE_PI_TERMINAL_HOOK_OWNER_PID`。
2. 从该 Pi 里 fork 的任何进程（子 Pi、agent、终端）都带着这个 marker。
3. 新 Pi 启动时读到 marker，值不等于自己的 pid，于是判定「我是被继承的子进程」→ **一个 handler 都不注册**，此后该终端里的 Pi 永远静默。

原来只判断 `ownerPid !== String(process.pid)`，不检查那个 pid 是否还活着，因此残留的**死 pid** 会永久静音后续所有 Pi。

## 改了哪些

- `packages/server/src/server/byspace-env.ts`：把 `PI_TERMINAL_HOOK_OWNER_PID_ENV_KEY`（`BYSPACE_PI_TERMINAL_HOOK_OWNER_PID`）加入 `RUNTIME_CONTROL_ENV_KEYS`，所有 `createExternalProcessEnv` / `createExternalCommandProcessEnv` / `buildSelfNodeCommand` 出口都会剥离它，终端与 agent 不再继承。
- `packages/server/src/terminal/agent-hooks/pi/pi-extension.ts`：owner gate 增加 `ownerIsLive()`（`process.kill(pid, 0)`），marker 指向的 pid 已不存在（或非数字）时不视为 owner，新 Pi 正常接管上报。
- `packages/server/src/terminal/terminal.ts`：OSC 633 `D`（前台命令结束）现在同时 `activityTracker.interrupt()`。agent 被 SIGKILL／崩溃、没发出 `session_shutdown` 时不再永久停在 `working`。
- `docs/terminal-activity.md`：更新 Pi 扩展 marker 语义与异常退出清理说明。

## 怎样验证

- 直接驱动扩展（无 daemon）：`marker = 死 pid` → 5 个 handler 全部注册；`marker = 活着的父 pid` → 0 个 handler（保持去重语义）。
- 沙箱泄漏证明：给 `process.env` 塞 marker 后调 `createExternalProcessEnv`，修复前 marker 原样带出，修复后为 `undefined`。
- 单测：`npx vitest run packages/server/src/terminal/terminal.test.ts packages/server/src/server/byspace-env.test.ts packages/server/src/terminal/agent-hooks/pi/pi.test.ts --bail=1` → 74 passed / 3 skipped。
- typecheck + lint 全绿。
- 实机端到端（真实 daemon，仅新建测试终端）：新建终端 `env | grep TERMINAL_HOOK_OWNER` 为 0；`pi` 首启 + turn 上报 `working → idle(finished)`；`/quit` 后 `pi --session <id>` 恢复，再发消息仍完整上报 `working → idle(finished)`。

## 对 byissue/ 的影响

无 spec 违背。`docs/terminal-activity.md` 已同步 marker 与异常退出清理的行为。
