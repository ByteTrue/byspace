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

## 执行记录

**Claude 换模型/thinking（以及任何 launch-only 设置）**：新增 `providers.ErrSettingNeedsRestart` 作为「这个设置要重启才生效」的哨兵。Claude 的 `SetModel`/`SetThinkingLevel` 用它包装错误；daemon 侧 `applyOrRestart` 看到哨兵就**自己重启**：`restartAgentSession` 关掉进程、按记录重新启动、`SeedTimeline` 把已有时间线搬进新会话。运行中的回合会被拒绝（先停再改），因为重启会杀掉它。model、thinking、mode、feature、profile（`agent.config.apply`）五条入口统一走这一条路径。

重启要能续上会话，所以 `syncPiPersistence` 现在：有 session 文件就用文件（pi），否则用 session id（Claude 的 `--resume`）。此前 Claude 的句柄是空的，重启会开一段新对话。

**OpenCode 的 per-agent env**：池子改为按（home、命令、参数、环境）分桶。同一环境的 agent 仍共用一个 `opencode serve`（常见情况），环境不同的各自一个。**身份变量被排除在桶和投递之外**：一个共享 server 无法按 session 变身份，把它算进去等于每个 agent 一个 server；`BYSPACE_HOME`/`BYSPACE_HOST` 保留，所以在 OpenCode 里 `byspace` 能用，但以宿主 CLI 的身份行事——这是 `spec/agent-tools.md` 已记录的边界。

**验证**：`opencodepool_env_test.go` 覆盖分桶与身份剥离；`turnparams_test.go` 断言两个 setter 都带哨兵；`go test ./internal/{server,cli,agent/...}` 589 通过。

**还没做**：真机验证（用 Claude 换一次模型看它是否续上时间线、用 OpenCode 配一个 `env` 看变量是否到达 server）。这台机器上 Claude 有二进制但没有做真调用，OpenCode 有二进制但没有模型凭据。
