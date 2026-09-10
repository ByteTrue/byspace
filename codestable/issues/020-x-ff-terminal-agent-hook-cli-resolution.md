---
id: "020"
type: ff
title: 修复终端 Agent Hook CLI 路径解析与 command not found
status: closed
date: 2026-09-09
---

## 做了什么

在 BySpace 终端中运行 Claude 等 Agent 时，触发 `UserPromptSubmit` 等 hook 报错：
`UserPromptSubmit hook error: Failed with non-blocking status code: /bin/sh: byspace: command not found`。

而在终端当前目录下执行 `byspace` 是可用的。

根因：

1. 终端里用户交互式 shell（如 zsh）通过 rc 文件（或 mise/asdf 等）将 byspace 所在路径加入了 PATH，因此直接输入 `byspace` 正常。
2. 但 Claude Code 执行 hook 时调用的是非交互式 `/bin/sh -c '...'`。Hook 命令设计为优先读取环境变量：
   `"${BYSPACE_HOOK_CLI:-${PASEO_HOOK_CLI:-byspace}}" hooks claude UserPromptSubmit`
3. 按照 BySpace 设计，终端启动时 daemon 应将 CLI 绝对路径注入到 `BYSPACE_HOOK_CLI` / `PASEO_HOOK_CLI`，并将 CLI 所在 bin 目录前置注入终端的 `PATH`。
4. 但在 `packages/server/src/terminal/terminal.ts` 中，`resolvePaseoCliBinEntrypoint()` 硬编码只解析 `@getpaseo/cli/bin/byspace`。而 BySpace 作为 `@bytetrue/byspace` npm 包发布安装时，根本不存在 `@getpaseo/cli` 包，导致 `require.resolve` 报错失败返回 `null`。
5. 此外，`resolvePaseoCliExecutablePath()` 未支持 `BYSPACE_CLI` 环境变量，且当 entrypoint 无法通过 require 解析时缺乏向系统 PATH 探测 `byspace` 的 fallback。
6. 最终导致 daemon 既未能注入 `BYSPACE_HOOK_CLI`，也未能向 PATH 前置 CLI 目录，hook 只能回退为裸命令 `byspace`，在 `/bin/sh` 下触发 `command not found`。

修复：

- 在 `packages/server/src/terminal/terminal.ts` 中：
  - 支持 `process.env.BYSPACE_CLI` 作为 CLI 路径显式配置。
  - `PASEO_CLI_BIN_ENTRIES` 增加支持 `@bytetrue/byspace/bin/byspace` 候选，兼容生产 npm 单包安装形态。
  - 当 entrypoint 未能通过 require 解析时，增加 `resolvePaseoCliFromPath()` 使用 `which.sync("byspace", { nothrow: true })` 从系统环境探测回退。

## 改了哪些

- `packages/server/src/terminal/terminal.ts` — 扩展 CLI 路径解析候选项，支持 `BYSPACE_CLI`、`@bytetrue/byspace` 入口和 `which` PATH 探测。
- `packages/server/src/terminal/terminal.test.ts` — 新增 `resolvePaseoCliExecutablePath` 环境变量覆盖与有效解析测试。

## 怎样验证

- 单测验证：`npx vitest run packages/server/src/terminal/terminal.test.ts --bail=1`（54 passed, 3 skipped）。
- 类型与代码检查：`npm run typecheck` 全工作区通过，`npm run lint -- packages/server/src/terminal/terminal.ts packages/server/src/terminal/terminal.test.ts` 0 errors。
- 格式化：`npm run format:files -- codestable/issues/018-x-ff-terminal-agent-hook-cli-resolution.md packages/server/src/terminal/terminal.ts packages/server/src/terminal/terminal.test.ts`。

## 对 codestable/ 的影响

无既有 spec 违背，`docs/terminal-activity.md` 中关于 `BYSPACE_CLI` 与 `BYSPACE_HOOK_CLI` 的契约行为现已完全对齐实现。
