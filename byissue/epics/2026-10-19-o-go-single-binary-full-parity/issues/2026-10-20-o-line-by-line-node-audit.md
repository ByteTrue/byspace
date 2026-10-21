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

## 高杠杆的做法：用脚本对集合，而不是靠眼睛

逐行读是必要的，但**「有没有遗漏」这件事不能靠读**。本审计里有三处是靠脚本把两个集合求差
查出来的，每处都在几十秒内给出了确定答案：

| 对什么            | 怎么对                                                                             | 查出了什么                                                           |
| ----------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| MCP 工具名        | 抽 `byspace-tools.ts` 的 `name:` 集合 ∩ Go 的 `mcpToolDef(...)` 集合               | 40/40 一致；两个只出现在 Node 的词是枚举值不是工具名                 |
| 顶层 CLI 子命令   | 抽 `cli.ts` 的 `command("...")` 集合 − Go 的 `case "..."` 集合                     | 每个分组子命令的缺口（`agent mode`、`daemon install-service` 等）    |
| provider 通知方法 | 抽 `codex-app-server-agent.ts` 的 `"<ns>/<method>"` 字符串集合 − Go 的 `case` 集合 | 31 vs 13，逐个核实后补了 `thread/tokenUsage/updated` 与 `turn/steer` |

这些是**可判定的**（集合相等或不等），所以脚本比人可靠。反过来，下面这些不可判定、只能读：

- 「这个字段接了但逻辑没实现」（`script` 字段一直在，值恒为 `nil`）
- 「这段分支没有生产端」（`TargetGoneError` 定义了，executor 从不返回）
- 「这个实现没有调用者」（`FormatSystemNotificationPrompt` 零调用者）

判据：**能写成集合运算的，就不要用眼睛看；剩下的才逐行读。**

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

| 批次 | 范围                               | 文件 | 结论条数 | 状态   |
| ---- | ---------------------------------- | ---- | -------- | ------ |
| 1    | `server/` 顶层（含子系统目录）     | 195  | 约 90    | 进行中 |
| 2    | `server/agent/**`                  | 194  | 部分     | 未完成 |
| 3    | `services/**`                      | 20   | 8        | 进行中 |
| 4    | `terminal/**`                      | 20   | 6        | 进行中 |
| 5    | `utils/`、`executable-resolution/` | 24   | 24       | 完成   |
| 6    | `archive/packages/cli/src`         | 117  | 19       | 进行中 |
| 7    | `packages/relay/src`               | 6    | 6        | 完成   |

**口径**：一个文件算有结论，当且仅当 `audit-log.md` 里出现它的文件名。目录级的结论
（如「`server/agent/**` 见下表」）**不折算成逐文件结论**——那正是这个 Issue 要避免的
自我欺骗。

严格计数（按上面口径）：512 个文件里 **133 个有逐文件结论，379 个还没有（约 12.4 万行）**。

已经完成的整块：`utils/**`、`executable-resolution/**`、`packages/relay/src`、`server/` 顶层
非目录文件、以及 `server/` 的 `file-upload`/`file-download`/`migrations`/`pagination`/
`managed-processes`/`auto-archive-on-merge`/`worktree`/`checks` 等子系统目录。

### 仍未移植的部分（已记明条件，不是遗漏）

| 子系统                                                             | 状态    | 条件                                             |
| ------------------------------------------------------------------ | ------- | ------------------------------------------------ |
| `service-proxy` + `script-health-monitor` + 端口注册表             | MISSING | 脚本预览链路的整块反向代理，需要独立设计         |
| `tunnel-manager` / `tunnel-registry`                               | DROPPED | 需要第二台机器验证；盲写风险高于收益             |
| `hub.*` 远程控制                                                   | MISSING | 未实现子系统，权限表已就位                       |
| `plugin.*` 运行时                                                  | MISSING | 插件沙箱未实现，只读端返回空                     |
| quota-fetcher 其余 6 家（claude/cursor/copilot/grok/kimi/minimax） | MISSING | 需要真实凭据才能验证；框架与 codex/zai 已实现    |
| `workspace-create-shared` / 目录同步                               | MISSING | 跨主机同步，产品方向未定                         |
| `persisted-config` 迁移路径                                        | N/A     | 本项目是 hard fork，明确不做数据迁移             |
| `windows-command` 的 ConPTY 部分                                   | PARTIAL | 进程与 PowerShell 已对齐，ConPTY 走 `creack/pty` |
| `project-custom-icon` 的 revision 指纹                             | PARTIAL | 行为差异未观察到用户可见故障                     |

## 与其他 Issue 的关系

这条 Issue 是**发现机制**，不直接修代码。审计出的 `PARTIAL` / `MISSING` 按主题归到其他 Issue，
或在积累成一类后新开 Issue。审计本身不改 Go 实现。

例外：如果缺口是「一行就能补且无歧义」的（例如漏发一个已在内存里算好的字段），
顺手修掉并在日志里标注 commit，避免开一堆只有一行改动的 Issue。

## 关闭条件

9 个批次全部审完，`audit-log.md` 里每个文件都有结论，
所有 `MISSING` 要么修掉、要么转成独立 Issue、要么明确 `DROPPED` 并写明理由。
