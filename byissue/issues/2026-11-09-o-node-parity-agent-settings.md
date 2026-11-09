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

（实现阶段追加）
