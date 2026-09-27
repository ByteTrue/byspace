---
kind: issue
title: "Windows：裸命令名不再经 cmd.exe，多行参数不再被截断"
type: ff
status: closed
created: 2026-09-27
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# Windows：裸命令名不再经 cmd.exe，多行参数不再被截断

在 Windows 上，任何不带路径、不带扩展名的命令（`gh`、`glab`、`tea`、`node`…）都被 `execCommand`/`spawnProcess` 用 `shell: true` 交给 cmd.exe，参数只是拼接进命令行。cmd.exe 遇到第一个换行就结束命令行，于是**多行参数被静默截断**：forge 的 `gh api graphql -f query=<多行 GraphQL>` 只剩 `query Q {`，报 `gh: Expected NAME, actual: (none) ("")`。GitHub PR 状态因此永远拿不到 forge 事实，app 里显示「GitHub merge facts are unavailable for this pull request」并拒绝合并——用户在 BySpace 里合自己的 PR 就是被这条卡住的。多行 commit message 同理。

- 改动：`packages/server/src/utils/windows-command.ts` — 新增 PATH/PATHEXT 解析器 `resolveWindowsExecutable` + `parsePathExtSuffixes`，以及 `windowsCommandNeedsShell`：只有解析到原生二进制（`.exe`/`.com`）才直接 spawn，批处理启动器（`.cmd`/`.bat`）、脚本宿主（PATHEXT 里的 `.ps1`）和解析不到的名字仍走 shell
- 改动：`packages/server/src/utils/spawn.ts` — `shouldUseWindowsShell` 按解析结果决定；`childEnv` 移到 shell 判断之前，PATH/PATHEXT 用子进程的实际环境（含 `envOverlay`）而不是父进程
- 改动：`packages/server/src/utils/windows-command.test.ts`（新增）— 解析规则、`windowsCommandNeedsShell` 四类目标、多行参数保真、本机真实 `gh` 直接 spawn；`packages/server/src/utils/spawn.percent-escape.test.ts` — `%` 用显式 `shell: true` 继续覆盖 cmd.exe 那条路；`packages/server/src/utils/hidden-daemon-children.test.ts` — 锁住 POSIX-only 豁免表（新豁免点要登记，表里没人调用的名字算死豁免）
- 验证：真实 `gh` 解析为 `C:\Program Files\GitHub CLI\gh.exe`、`needsShell` 为 false、直接 spawn 正常。同一条多行 GraphQL 查询：修前 `gh: Expected NAME, actual: (none) ("")`，修后返回 `{"data":{"rateLimit":{"remaining":4874}}}`；多行 commit message 三行完整到达子进程。`.cmd` 启动器仍能被 `execCommand` 跑起来。11 个 spawn/shell/解析测试文件 72 passed（Windows），`npm run typecheck`、`npm run lint`、`npm run format` 全绿，Linux 由 CI 覆盖
- 注意：批处理启动器仍然经 cmd.exe，所以给 `.cmd` 传多行参数仍然会被截断——只有原生二进制这条路径被修好。另外 PATH/PATHEXT 解析现在发生在自己代码里：解析不到的名字退回 shell，不会变成新失败模式，但解析规则跟 cmd.exe 不完全一致（例如 cwd 优先、App Paths 注册表都不查）
- byissue：无影响；`spec/` 未描述 Windows 的 shell 选择，forge 合并门（`assertDirectPullRequestMergeReady`）的行为不变，只是 Windows 上终于拿得到事实
