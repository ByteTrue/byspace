---
kind: issue
title: "逐文件逐函数审计 Node 实现，确认每一项能力都在 Go 侧有对应物"
type: process
created: 2026-10-20
---

# 逐文件逐函数审计 Node 实现

归属 Epic：`byissue/epics/2026-10-19-o-go-single-binary-full-parity`。

## 为什么用这种方式

前面十一轮的真机修复有一个共同模式：**问题都是被用户撞见才发现**，没有一次是我主动扫出来的。
已有的三个自动化工具只覆盖「协议字段」这一层：

| 工具              | 覆盖               | 覆盖不到                   |
| ----------------- | ------------------ | -------------------------- |
| `go-parity-audit` | 入站消息的字段名   | 字段接住了但逻辑没实现     |
| `go-emit-parity`  | 出站消息的字段名   | 字段发了但值是假的         |
| `audit:browser`   | 页面上看得见的行为 | 没点到的路径、没触发的分支 |

字段齐了不等于功能对。`workspace.script.start` 就是例子：response 里 `script` 字段一直在，
但值是 `nil`，因为脚本根本没跑。协议校验通过，审计通过，功能不存在。

所以需要一次**穷举式**的源码对读：按文件、按函数、按行为，逐条确认 Go 侧有没有等价实现。

## 范围

| 目录                          | 文件    | 行数        |
| ----------------------------- | ------- | ----------- |
| `archive/packages/server/src` | 389     | 155,825     |
| `archive/packages/cli/src`    | 117     | 13,467      |
| `packages/relay/src`          | 6       | 837         |
| **合计**                      | **512** | **170,129** |

不含 `*.test.ts`（测试是规格参考，不是待迁移行为；需要时单独看）。

## 判定口径

每个文件给出一个结论，并附证据：

| 结论      | 含义                                            | 处理                 |
| --------- | ----------------------------------------------- | -------------------- |
| `PORTED`  | Go 有等价实现，逐项对得上                       | 记录 Go 侧文件:行    |
| `PARTIAL` | Go 有部分实现，缺分支/缺状态/缺错误路径         | 记为缺口，写明缺什么 |
| `MISSING` | Go 无对应实现                                   | 记为缺口             |
| `DROPPED` | Node 有，但**明确决定不做**（如原生客户端能力） | 写明理由与决策出处   |
| `N/A`     | 类型定义、测试工具、构建脚本等无运行时行为      | 说明为什么不适用     |

`DROPPED` 与 `MISSING` 必须分开。前者是有意放弃，后者是还没做。

## 执行顺序

按「影响面 × 被用户撞见的概率」排，不按目录字母序：

1. **`server/` 顶层 76 个文件** —— session、websocket、bootstrap、agent-manager，是所有 RPC 的落点
2. **`server/session/**`\*\* —— 按 RPC 分组的分发层
3. **`server/agent/**`\*\* —— agent 生命周期与 provider 驱动
4. **`server/{file-*,directory-*,pagination,push,schedule,worktree,...}`** —— 各子系统
5. **`terminal/**`\*\* —— PTY、shell 集成、agent hooks
6. **`services/quota-fetcher/**`\*\* —— 8 家厂商额度抓取
7. **`utils/`、`executable-resolution/`** —— 工具函数
8. **`archive/packages/cli/src`** —— CLI 命令面
9. **`packages/relay/src`** —— E2EE 原语（服务端已归档）

## 进度

审计结果写进 `audit-log.md`（同目录），逐条累积。每完成一个目录更新一次计数。

| 批次 | 范围                               | 状态   |
| ---- | ---------------------------------- | ------ |
| 1    | `server/` 顶层 76 文件             | 未开始 |
| 2    | `server/session/**`                | 未开始 |
| 3    | `server/agent/**`                  | 未开始 |
| 4    | `server/` 子系统目录               | 未开始 |
| 5    | `terminal/**`                      | 未开始 |
| 6    | `services/quota-fetcher/**`        | 未开始 |
| 7    | `utils/`、`executable-resolution/` | 未开始 |
| 8    | `archive/packages/cli/src`         | 未开始 |
| 9    | `packages/relay/src`               | 未开始 |

## 与其他 Issue 的关系

这条 Issue 是**发现机制**，不直接修代码。审计出的 `PARTIAL` / `MISSING` 按主题归到其他 Issue，
或在积累成一类后新开 Issue。审计本身不改 Go 实现。

例外：如果缺口是「一行就能补且无歧义」的（例如漏发一个已在内存里算好的字段），
顺手修掉并在日志里标注 commit，避免开一堆只有一行改动的 Issue。

## 关闭条件

9 个批次全部审完，`audit-log.md` 里每个文件都有结论，
所有 `MISSING` 要么修掉、要么转成独立 Issue、要么明确 `DROPPED` 并写明理由。
