---
kind: note
title: "参数存了不传：provider 设置的高发缺陷与判据"
created: 2026-11-09
---

# 参数存了不传

移植 provider 适配层时最容易漏的不是崩溃，是**设置只落进记录**：App 改了、记录变了、界面显示新值，provider 进程还在用默认值。用户看不到错误，只看到「点了没反应」。MCP 退役那一轮一次抓到五处（`env`、`featureValues`、mode、thinking、systemPrompt），之前一直是把它当单个 bug 修的。

## 判据

对 App 上每一个 provider 设置问一句：**这个值通过哪条通道到达 provider 进程？** 答不出通道就是没实现。通道只有四种：

| 通道         | 例子                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 启动参数     | claude `--model` / `--effort` / `--append-system-prompt`、pi `--thinking`                                                            |
| 每回合参数   | codex `turn/start` 的 `effort` / `serviceTier` / `approvalPolicy` / `sandboxPolicy`、opencode 消息体的 `model` / `agent` / `variant` |
| 会话配置 RPC | ACP `session/set_config_option`（model / mode / thought_level）                                                                      |
| 进程环境     | 每 agent 的 `env`；BySpace 自己的 `BYSPACE_HOME` / `BYSPACE_AGENT_ID`                                                                |

启动参数和每回合参数的区别决定「运行时能不能改」：只有每回合参数（或 setter RPC）能中途生效，启动参数只能重启进程。适配器如果只能收启动参数，运行时 setter 就应该**明确拒绝**，不要只改记录。

## 什么时候会漏

- 照着「协议字段」写 struct，然后忘了把值接到 printf/RPC 上：`req.Env` 解析了没人读，CLI 还把 `--env` 写进了另一个不存在的字段。
- 移植时把「Node 用 SDK」改写成「Go 用 CLI」：SDK 里可以直接设的东西（`fastMode`、`maxThinkingTokens`、`setModel`）在 CLI 里可能是别的 flag、可能是设置文件、也可能根本不存在。先查 `--help`，不要照抄 SDK 的字段名。
- 值在 provider 的**不同层级**：Codex 的 system prompt 不是顶层参数，而是 `collaborationMode.settings.developer_instructions`；Claude 的 fast mode 是 settings 而不是 flag。

## 防线

- `docs/providers.md` 的「What the daemon can actually send each provider」表：一家一行、一个设置一列。加 provider 填行，加设置填列；写不出格子就说明没实现。
- 每个设置一个能失败的测试（构造参数 / 解析事件），不要只测「记录被写入」。
- `npm run audit:go-parity` 的「解析了但从未使用」清单是线索：字段在 struct 里却没被读，通常就是漏接。
