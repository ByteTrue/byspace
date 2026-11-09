---
kind: issue
title: "补齐 Node 版有、Go 版没有的 provider 设置通道"
type: feature
created: 2026-11-09
---

# 补齐 Node 版有、Go 版没有的 provider 设置通道

## 目标与范围

MCP 退役时的审计发现 App 上有一部分 provider 设置只有记录、没有传输（清单见 `docs/providers.md` 的「What the daemon can actually send each provider」）。第一批已补：Codex 的 mode/thinking/fast、Claude 的 system prompt/thinking、OpenCode 的 model/mode/thinking、ACP 的 model/mode/thinking、运行时的 mode setter。

这一事项补剩余的缺口，判据是**Node 版曾经做到、Go 版没做**：

- **Codex system prompt**：Node 把它和 `daemonAppendSystemPrompt` 合成 `developer_instructions`，经 `collaborationMode/list` 拿到的 settings 下发。Go 一个都不发，所以 role prompt 与 host-wide append system prompt 对 Codex 无效。
- **Codex `plan_mode`**：同一套 `collaborationMode`；Go 的 feature 开关写了记录就想不出任何协议动作。
- **Claude `fast_mode`**：Node 用 SDK 的 `fastMode`；Go 走 `claude` CLI，目前没有对应 flag。
- **Claude / Pi 中途换模型或 thinking**：Node 的 Claude 用 SDK 会话可以换；Go 的 CLI 只在启动读参数，`set_agent_model` 只改记录。Pi 有 `set_model`/`set_thinking_level` RPC，已经生效。

不包含：ACP 客户端的 BySpace 能力（技能根本读不到）、OpenCode 的 per-agent 身份（共享进程环境）——这两条是已知上限，记在 `spec/agent-tools.md` 的边界里。

## 现状与落点

- Codex：`internal/agent/providers/codexturn.go` 已集中构造 `turn/start`；`collaborationMode/list` 需要在 `StartCodexSession` 的握手后取一次，缓存在 session 上，`turn/start` 的 `collaborationMode.settings.developer_instructions` 才能填。
- Claude：`claudeLaunchArgs` 是纯函数，加 flag 容易；换模型需要「重启 provider process 并 `--resume <session>`」，落点在 `internal/server` 的 agent reload 路径。
- Pi：换模型已有 RPC，无需改。

## 验证

- Codex：`codexturn` 单测覆盖 collaborationMode 填写；没有 codex 二进制，行为只能靠协议形状复核。
- Claude：`claudeLaunchArgs` 单测；`fast_mode` 若无 CLI 对应则改为**不发且告知**（notice），不能继续假装。
- 换模型：既有 `handleSetAgentModel` 的响应要如实说明「下一轮生效」还是「需要重启」。

## 执行记录

**Codex system prompt + `plan_mode`**：会话握手后调一次 `collaborationMode/list` 并缓存；`turn/start` 增加 `collaborationMode: {mode, settings}`。`settings.developer_instructions` 由该 mode 的默认指令 + `LaunchConfig.SystemPrompt`（已含 role、agent、host-wide append）合成，`settings.model` / `settings.reasoning_effort` 按当前选择覆盖——这正是 Node 的 `resolveCollaborationMode`。选 plan 还是普通工作模式按名字匹配（`plan`/`read` vs `auto`/`code`），与 Node 一致；Codex 答不出列表时这一项就不发，回合照常。Fast 与 Plan 的运行时切换经新增的可选接口 `FeatureValueSetter` 下一轮生效。

**Claude `fast_mode`**：`claude --settings '{"fastMode":true}'`（该 flag 读的就是设置文件里的同一字段），只在模型支持时发；不支持就不发。

**Claude 换模型/thinking**：CLI 只在启动读 `--model`/`--effort`，所以 `SetModel`/`SetThinkingLevel` 改为**明确报错**（"restart the agent to switch models"）。记录已经写入，重启即生效。Pi 有 `set_model`/`set_thinking_level` RPC，本来就生效。

**Mode 变更的响应**：provider 没有 `ModeSetter` 时（Claude），`set_agent_mode` 现在回 `accepted:false` 并说明原因，不再回「applies next turn」——那句对谁都曾经不成立。

**per-agent `env`**：Node 的四家适配器都把 `config.env` 交给 provider 进程；Go 从来没接（`create_agent_request.env` 解析了没人读，CLI `--env` 写进了 `config.env` 而 daemon 不解析）。现在按 wire 的顶层 `env` 解析、存进 `AgentConfig.Env`，`agentEnv()` 在 daemon 环境之上叠加，BySpace 身份变量最后写入（agent 不能借 `env` 改自己的 `BYSPACE_AGENT_ID`）；CLI `--env` 重新可用。OpenCode 仍拿不到：共享 `opencode serve` 的环境不是 per-session。

**usage（context ring）**：Claude 与 OpenCode 在 Node 版把 token 记账交给上下文环，Go 版两家都返回 nil。现在 Claude 从每条 assistant 消息的 `message.usage` 取（used = 输入 + cache creation + cache read，`--model` 的窗口来自 manifest），`result` 事件补 cost；OpenCode 从响应里 `step-finish` parts 的 `tokens`/`cost` 取，cost 跨 step 累加。ACP 无标准 usage 字段，继续显示无。

**验证**：`codexturn` 测试覆盖 collaboration 选择、settings 合成、无列表时不发；`claudeLaunchArgs` 覆盖 fast settings 与 effort；Claude 的拒绝路径有测试。`internal/{server,cli,agent/providers}` 全绿。

**仍未做**：Claude 的 `--json-schema`（需要把 schema 从 per-turn 提到 `LaunchConfig`）；OpenCode 的 per-agent 身份；ACP 的 BySpace 能力。前两条是已知上限，第三条是范围外。
