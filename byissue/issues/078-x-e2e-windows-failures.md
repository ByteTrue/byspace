---
kind: issue
title: "e2e 在 Windows 上无法通过：路径分隔符、/bin/sh、滚动就绪竞态"
type: bug
status: closed
created: 2026-10-11
---

# e2e 在 Windows 上无法通过：路径分隔符、/bin/sh、滚动就绪竞态

> **读者：** 接手 e2e 基建的人。CI 的 8 个 playwright shard 全在 ubuntu 上跑，所以下面三类问题在 Windows 上从来没被验证过。三条都已修复，本机全绿。

## 背景

在 Windows 上跑 `agent-stream-ui`、`launcher-tab`、`new-workspace-*` 时大面积失败。逐个定位后发现是**三个独立根因**，都只在非 ubuntu 环境暴露：

| #   | 根因                               | 影响面                                                                     |
| --- | ---------------------------------- | -------------------------------------------------------------------------- |
| 1   | 测试按 `/` 分割路径                | `withWorkspace()` 系全部用例                                               |
| 2   | 测试用 `/bin/sh` 当终端命令        | `launcher-tab`、`new-workspace-launch-*`、`new-workspace-navigation-guard` |
| 3   | 测试在 chat 可滚动前就断言内容增长 | `agent-stream-ui:58`                                                       |

## 根因 1 — 路径分隔符

`e2e/support/helpers/workspace-setup.ts` 的 `projectNameFromPath` 只按 `/` 分割：

```ts
return repoPath.replace(/\/+$/, "").split("/").findLast(Boolean) ?? repoPath;
```

Windows 路径用 `\`，于是它返回**整条路径**而不是末段。侧栏渲染的是 basename（产品侧 `lastPathSegment`（`packages/server/src/server/project-key.ts:50`）按 `/[\\/]/u` 分割，是对的），`hasText` 是子串匹配 —— 拿整条路径去匹配 basename 永远不中。

同一写法还在 `e2e/support/helpers/app.ts:142`（工作目录选择器），一并修。

## 根因 2 — `/bin/sh` 在 Windows 上不存在

五处终端 profile 用 `command: "/bin/sh"`（或 `/bin/echo`）。daemon 的 shell 探测在 Windows 上只认 `pwsh.exe`/`powershell.exe`/`cmd.exe`（`packages/server/src/terminal/shell-detect.ts`），`spawnSync("/bin/sh", ...)` 直接 `ENOENT`，终端只显示 `File not found:`。

改为 `process.execPath` + `-e`，用 `argv` 复刻原来的 shell 语义：

- `sh -c SCRIPT name` 的 `$#`（不含 `$0`）→ `process.argv.length - 2`（`-e` 下 argv 是 `[node, ...args]`）
- `echo X: "$0"` → `console.log("X:", process.argv[1])`
- `exec cat` → `process.stdin.pipe(process.stdout)`
- `sleep N` → `setTimeout(() => {}, N)`

`new-workspace-launch-terminal.spec.ts` 里有一处硬编码了展开后的命令字符串，改为从 profile 派生，避免下次换二进制时又漂移。

## 根因 3 — 滚动就绪竞态

`agent-stream-ui.spec.ts:58` 先 `awaitAssistantMessage`（只等消息**可见**），立刻读 `readScrollMetrics` 再等内容增长。但 `readScrollMetrics` 挑的是「有 overflow 的元素」，而 mock 要几秒才产出足够文本：在那之前 `scrollHeight === clientHeight`（探针实测都是 532），读到的就是冻结值，10s 超时。

CI 上 14.6s 通过，本机 mock 慢（10s 才出现 612）就超时 —— 典型的环境相关 flaky。

修法：在测增长前先 `waitForScrollableChat`，等同文件其它用例已有的做法。

## 根因 4（顺带发现）— cwd 断言未归一化

`new-workspace-navigation.ts` 断言 agent 请求的 `cwd` 等于 `created.workspaceDirectory`。daemon 返回归一化（正斜杠）形式，Windows 上拿反斜杠的原始路径去比必然不等。改为比较前统一分隔符。

## 为什么 CI 没挡住

`.github/workflows/ci.yml` 的 8 个 playwright shard 全部 `runs-on: ubuntu-latest`；Windows 上跑的是 server-tests 和 terminal-performance。这三类问题都需要真实 Windows 环境才暴露。

## 验证

修复前后对照（本机 Windows）：

| spec                                        | 修复前               | 修复后          |
| ------------------------------------------- | -------------------- | --------------- |
| `agent-stream-ui` + `launcher-tab`          | 2 failed / 21 passed | **23 passed**   |
| `new-workspace-navigation-guard`            | 5 failed / 3 passed  | **10 passed**   |
| `new-workspace-launch-terminal`             | 1 failed             | **1 passed**    |
| `new-workspace-launch-memory` / `-composer` | 失败                 | **各 1 passed** |

六个文件合并跑：**36 passed / 0 failed**。typecheck、lint、format:check 全绿。

## 相关

首次发现于 `076-x-tunnel-list-first-load-stuck-loading` 的验收（当时判定为既有失败、与本 issue 无关）。
