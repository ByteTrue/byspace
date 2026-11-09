---
kind: issue
title: "Claude 换模型要重启会话、OpenCode 拿不到 per-agent 环境"
type: feature
created: 2026-11-09
---

# Claude 换模型要重启会话、OpenCode 拿不到 per-agent 环境

`2026-11-09-x-node-parity-agent-settings.md` 的收尾里留下的两件，都是「通道本身要改结构」而不是补一个参数：

1. **Claude 中途换模型/thinking**。CLI 只在启动读 `--model` / `--effort`，现在 `SetModel`/`SetThinkingLevel` 明确报错并提示重启。要做的是真重启：关掉 provider 进程，用记录里的持久化句柄 `--resume <session>` + 新 flag 重开，时间线不能丢（重启前的行要保留，且不能出现重复的用户气泡）。落点在 `internal/server` 的 agent reload 路径与 `internal/agent/providers/claude.go`。
2. **OpenCode 的 per-agent 环境与身份**。Go 用一个共享 `opencode serve`，进程环境是 daemon 的，所以 `BYSPACE_AGENT_ID` 在那边不成立、`env` 也传不进去。要做的是按环境桶化池子（per-env pool），或者在 OpenCode 暴露 session 级环境后改走它。

## 边界

- 第 1 条不要用「重启时丢掉未完成回合」当简化：正在跑的回合被换模型时，用户至少要知道它被中断了。
- 第 2 条不要为每个 agent 起一个 server 了事：共享正是为了不给每台机器堆进程；按环境分桶，且桶要能回收。
- 不属于本事项：Claude 的 `--json-schema`（Node 也没有，属于新功能）；ACP 客户端的 BySpace 能力。

## 验证

- 第 1 条：真实 claude 会话中换模型 → 下一轮用新模型（看 provider 参数或被试模型），时间线与父/子关系不变，未完成回合有中断记录。
- 第 2 条：同一 daemon 上两个 env 不同的 OpenCode agent 各自看到自己的环境；共享桶的 agent 仍共用一个 server；桶空闲后进程退出。

## 执行记录

（实现阶段追加）
