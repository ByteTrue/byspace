---
kind: issue
title: "Windows 上 execSync 里的单引号：65 处 git 命令静默污染或直接失败"
type: ff
status: closed
created: 2026-10-13
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# Windows 上 execSync 里的单引号：65 处 git 命令静默污染或直接失败

> **读者：** 在 Windows 上跑 server 测试遇到莫名 git 报错，或发现 git author 带引号时读这条。

---

081 复盘时顺手发现的，本次一并处理。`execSync` 在 Windows 上走 `cmd.exe`，它**不把 `'` 当引号**。仓里 67 处 `execSync("... '...' ...")` 因此分两类坏掉：

| 内层值        | 行为                                                  | 例                              |
| ------------- | ----------------------------------------------------- | ------------------------------- |
| 多词（26 处） | **硬失败**，`error: pathspec 'commit'' did not match` | `commit -m 'Initial commit'`    |
| 单词（46 处） | **静默污染**，值里带引号存进去                        | `user.name 'Test'` → `"'Test'"` |

两类都用 Node 实跑复现过，不是推断。

## 修法

内层单引号换双引号（cmd.exe 认）。Biome 随后把外层统一规范成单引号、内层双引号 —— 无转义噪音，65 处形态一致：

```ts
execSync('git config user.name "Test"', { cwd, stdio: "pipe" });
```

改动 65 处 / 11 个文件。逐个实跑过 13 种独特命令形状：全部 OK，且**校验了写入值无引号污染**。

## 剩 2 处不是同一问题

`agent-operations.e2e.test.ts` 的 `pgrep -f 'sleep 30'` / `pkill -f 'sleep 30'`：单引号在 POSIX 下**是对的**，问题在命令本身 Windows 不存在，ENOENT 被外面那个 `catch` 吞掉 —— 检查悄悄变成 no-op。按仓里既有的 `process.platform` 守卫先例包成 `if (process.platform !== "win32")`。

## 严重度（081 里判断有误，此处更正）

081 写「影响面更大」不准确。查证后：这 12 个文件**都不在 CI 的 server-tests 清单里**（`test:integration` 是固定文件列表；Windows job 只跑 PTY benchmark）。

但有**一个例外**：`session.test.ts` 是单元测试，`test:unit` 只排除 `*.e2e.test.ts`，所以它**在 Windows CI 上真跑**。它踩的是"静默污染"那一类 —— commit 用带引号的 author 名，但该用例不断言 author，所以 CI 一直是绿的错误状态。本次修好，本机跑该文件 **144 passed / 1 skipped**。

## 验证

- 13 种命令形状在 Windows 实跑：13/13 OK，写入值无污染。
- `session.test.ts`：144 passed / 1 skipped。
- `agent-operations.e2e.test.ts`（pgrep 守卫所在）：**4 passed / 1 failed**，其中 `cancelAgent > cancels a running agent mid-execution` **✓ 通过** —— 守卫在 Windows 上跳过整段而不崩。那 1 个失败是 `setAgentMode`，需要真实 codex CLI（本机没有），**基线同样失败**（1 failed / 4 passed），与本改动无关。
- `typecheck` / `lint` / `format:check` 全绿。
- 行尾：脚本初版把 11 个文件从 LF 写成 CRLF，已修正（git 里存 LF，工作区保持 LF），最终 diff 无 CRLF 警告。

## 顺手发现（不在本次范围）

`session.test.ts:4036` 等处的 `commit -m init` 用了**无引号**单词值 —— 本次没动，它在两个平台都正常。若将来值含空格，同样要注意。

## 对 `byissue/` 的影响

无。
