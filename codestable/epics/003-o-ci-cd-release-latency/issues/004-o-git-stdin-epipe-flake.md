---
kind: issue
title: 消除 Git stdin 提前关闭导致的 CI EPIPE
status: open
type: bug
created: 2026-08-11
updated: 2026-08-11
---

# 消除 Git stdin 提前关闭导致的 CI EPIPE

## 问题

CI `31489371511` 的 Ubuntu server test 在 4,263 个断言全部通过后仍因未处理的 `write EPIPE` 失败。异常来自 `runGitCommand()` 向 `git check-ignore --stdin -z` 写入候选目录时：非 Git 仓库中的子进程可先退出并关闭 stdin，Node 随后在 `child.stdin` 单独发出 `error`；现有实现只监听 ChildProcess 的 `error` / `close`，因此这个流错误逃逸成 Vitest uncaught exception。

## 契约

- Git 子进程的 `error` / `close`、退出码和 stderr 继续决定命令结果。
- 子进程先退出时，stdin pipe error 不得成为第二个未处理异常。
- 不改变 `check-ignore` 在非仓库中回退为可见候选、在仓库内失败时 fail-closed 的现有语义。
- 修复落在共享的 `runGitCommand()`，同时保护当前两个 stdin 调用方：`check-ignore --stdin` 与 `cat-file --batch`。

## 实现

- 在写入 Git stdin 前注册流错误监听；进程结果仍由既有 ChildProcess 生命周期处理。
- 在 `run-git-command.test.ts` 用确定性的 fake stdin `EPIPE` 覆盖“子进程未读取输入即退出”边界。

## 验证

- [x] `run-git-command.test.ts` 与 `directory-suggestions.test.ts`：43/43。
- [ ] Ubuntu server test 在新的 exact-SHA CI 中通过且无 uncaught `EPIPE`。
- [ ] 完整 CI 通过。

## 关闭条件

- 上述验证全部通过。
- 证据链接和 exact SHA 记录在本 Issue。
