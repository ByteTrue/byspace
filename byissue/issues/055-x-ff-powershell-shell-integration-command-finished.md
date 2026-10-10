---
kind: issue
title: "修复 PowerShell 上 plain script 命令结束不上报、UI 永远显示运行中"
type: ff
created: 2026-09-28
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 修复 PowerShell 上 plain script 命令结束不上报、UI 永远显示运行中

Windows 上跑 `byspace.json` 里非 service 的 script（`lint`、`typecheck` 这类），命令已经结束、终端也回到提示符，Scripts 菜单里却一直显示运行中、也不出现 exit 徽标。根因：命令结束只有 OSC 633 `D` 一个来源，而 BySpace 只给 zsh 装了 shell integration；PowerShell 上这个信号从不存在，只剩 shell 进程真的退出时的 `onExit`，而交互 shell 不会退出。

排查中还挖出第二个同形 bug：PSReadLine 渲染提示符**早于**开始读输入，落在两者之间的键盘输入被 cooked-mode 行律回显、Enter 被吃掉，命令只停在编辑缓冲里永远不执行——script 会以「永远 running」卡死。这是 daemon「等首输出再敲命令」路径的既有竞态，在 PowerShell 上实测注入率 0–60%（zsh 上同窗口极窄、20/20 无注入）。

- 改动：`packages/server/src/terminal/shell-integration/pwsh/byspace-integration.ps1`（新增）— 包一层 `Prompt` 发 `]633;D;<0|1>`（历史上前进后才判定，resize 重绘不算）；包装 `PSConsoleHostReadLine`，首次 readline 把 `BYSPACE_TERMINAL_SPAWN_COMMAND` 环境变量作为命令行返回值交给 host 执行（与手打同路径：进历史、`$?` 真实）。加载包 `try/catch`：Windows PowerShell 5.1 默认 Restricted 执行策略下点源任何 `.ps1` 都会抛。
- 改动：`packages/server/src/terminal/terminal.ts` — `withShellIntegrationArgs` 按 basename 识别 pwsh/powershell 并注入集成；`createTerminal` 新增 `spawnCommand` 选项，env-handoff shell 经 `BYSPACE_TERMINAL_SPAWN_COMMAND` 移交首条命令；`getShellSpawnCommandMode()` 暴露 `env-handoff | typed`。
- 改动：`packages/server/src/server/worktree-bootstrap.ts` — script 与 worktree 终端的命令发送统一走 `sendBootstrapCommand`：env-handoff 的全新终端不敲（已移交），其余照旧等就绪后敲入。
- 改动：`packages/server/src/terminal/terminal-manager.ts`、`terminal-worker-protocol.ts`、`terminal-worker-process.ts`、`worker-terminal-manager.ts` — `spawnCommand` 与 mode 穿过 worker 协议。
- 改动：`packages/server/src/terminal/terminal.test.ts`、`packages/server/src/server/worktree-bootstrap.test.ts` — 注入 helper 单测 + 真 pwsh 端到端用例。
- 验证：真 pwsh 7.6.6（解压到 /tmp，未系统安装）。`npx vitest run packages/server/src/terminal packages/server/src/server/worktree-bootstrap.test.ts` 两轮 315 passed / 5 skipped（无 pwsh 时 pwsh 用例自动 skip，63 passed）。探针验证：env-handoff 20/20 无丢失无重复、完成延迟 132–384ms；成功/失败退出码正确（`D;0`/`D;1`）；handoff 后交互命令正常；profile 自定义提示符（含其自身 `$?` 判断）保留、`$?` 被正确还原；包路径含空格与单引号可用；集成脚本与 Restricted 策略失败均不污染输出。typecheck / lint / format:check 全绿。
- byissue：已同步 `spec/terminal.md`「Shell integration 与命令结束」新增 env-handoff 机制与竞态成因；`docs/terminal-activity.md` OSC 633 `D` 兜底句补覆盖范围并链到 spec。

已知边界：本次只覆盖 PowerShell。bash、fish 与 cmd.exe（Windows 默认 `%ComSpec%` 是 cmd.exe）仍无命令结束信号——这些宿主上 plain script 依旧不会自动结算。上游 `getpaseo/paseo` 同样只有 zsh，VS Code 也没有 cmd.exe 的 OSC 633 集成，无可照搬实现。
