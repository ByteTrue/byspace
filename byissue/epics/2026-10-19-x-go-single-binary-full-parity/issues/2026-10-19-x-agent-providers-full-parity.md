---
kind: issue
title: "全 Agent 客户端宿主适配：Claude Code / Codex / ACP 全家族 / OpenCode / OMP / Custom Providers"
type: feature
created: 2026-10-19
---

# 全 Agent 客户端宿主适配：Claude Code / Codex / ACP 全家族 / OpenCode / OMP / Custom Providers

## 目标与范围

在 Go 服务端实现 Node 版 `packages/server/src/server/agent/providers/` 支持的全部 Agent 客户端宿主（`pi`, `claude`, `codex`, `opencode`, `omp`, `copilot`, `cursor`, `kimi`, `kiro`, `trae` 及自定义 ACP Provider）。

## 执行记录

- 新增 `internal/agent/providers/driver.go`：定义统一的 `ManagedSession` 接口与全部 10 大内建 Provider 的 `ProviderSpec`（含各自默认命令、协议类型、Models、Modes、Features），提供 `BuildSnapshotEntries`、`BuildAvailableProviders` 与 `StartProviderSession` 工厂。
- 新增 `internal/agent/providers/claude.go`：实现 `ClaudeSession`（驱动 `claude -p --output-format stream-json --input-format stream-json --verbose`，支持 5 种 `--permission-mode`、Thinking、工具卡片、`Task` 子代理追踪、`control_request` 权限审批回调，以及 `~/.claude/projects/**/*.jsonl` 历史会话扫描与导入）。
- 新增 `internal/agent/providers/codex.go`：实现 `CodexSession`（驱动 `codex app-server` JSON-RPC 2.0，完成 `initialize` → `thread/start`/`thread/resume` → `turn/start`，实时处理 `item/agentMessage/delta`、`item/reasoning/summaryTextDelta`、`commandExecution` 与审批回调）。
- 新增 `internal/agent/providers/acp.go`：实现通用 `ACPSession`（标准 ACP JSON-RPC 2.0：`initialize` → `session/new`/`session/load` → `session/prompt` → `session/update`，并处理反向 `fs/read_text_file`、`fs/write_text_file`、`session/request_permission` 与 Kiro `_kiro.dev/commands/available`），驱动 Copilot、Cursor、Kimi、Kiro、Trae 与 Custom ACP。
- 新增 `internal/agent/providers/opencode.go`：实现 `OpenCodeSession`（支持 `opencode serve` HTTP `/session` + `/session/:id/message` 与 ACP 双模式）。
- 更新 `internal/server/server.go` 与 `handlers_workspace.go`：将 Agent 宿主会话泛化为 `providers.ManagedSession`，打通多 Provider Snapshot/Models/Modes/Features 与历史会话导入。

## 验证

- `go test -v ./internal/agent/providers`：`TestBuiltinProvidersCatalog`、`TestClaudeStreamJSONSessionAndSubagentTracking`、`TestCodexAppServerSession`、`TestACPProviderSessionAndReverseFSRead`、`TestOpenCodeHTTPSession` 全部通过。
- `go test -v ./internal/server`：通过 WebSocket 创建、查询和驱动 Agent 全绿。

## 关闭候选

- 关闭时回写本 Epic `spec.md` 推进视图。

## 验收与关闭（2026-10-21）

**验收结论：交付。** 十一个内建 provider 与自定义 ACP 工厂全部落地，逐文件审计后补了四处
只有真读 Node 实现才会发现的缺陷：

| 缺陷                                                       | 后果                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| omp 收到 pi 的 `--extension` / `--approve`                 | omp 拒绝未知 flag 并**立刻退出**，看起来像 omp 坏了                                                 |
| Claude 子代理消息混进主时间线                              | 委派的任务看起来像父 agent 去做了无关的事；`Task` 分支还漏了 map 写入与广播，子代理**从面板里消失** |
| Codex `thread/tokenUsage/updated` 未处理，`Usage()` 恒 nil | 上下文用量环**永远空白**                                                                            |
| Codex `Steer` 只是重新 `Prompt`                            | 纠偏没有作用到进行中的轮次，两轮同时写同一 thread                                                   |

图像输入在四个宿主（claude/codex/acp/opencode）上分别验证过帧内真的带 base64。

**未做且已记录**：copilot 的 `autopilot` 模式（与「只用 pi」方向无关且无法验证）。

验证：`go test ./...` 全绿；`npm run audit` 出站 MISSING/OPTIONAL/NEVER_SENT 全 0。
