---
kind: issue
title: "Provider 的模型/请求失败在对话里静默结束"
type: bug
created: 2026-11-07
---

# Provider 的模型/请求失败在对话里静默结束

> **读者：** 接手的人——要做成什么、pi 那条已经修好的路径怎么当参照、其余 provider 还没核对到什么程度。

## 预期 / 实际

模型调用失败（额度耗尽、429、鉴权失效、请求被拒）时，对话里应有一行 `[System Error] <供应商原文>`，agent 状态转 `error`，`WaitForFinish` 的等待者拿到 error。实际是回合报成 completed：只剩用户气泡，agent 停在 idle，错误只在 provider 自己的终端输出里看得见。

生产实例（2026-11-07，Windows 桌面版）：chief agent 用 `magpie/auto/glm-5.3-flash-free`，OpenCode Zen 返回 429 `FreeUsageLimitError`，界面空白。Pi 那条已按快改修好，见 `2026-11-07-x-ff-pi-turn-error-swallowed.md`。

## 根因位置

daemon 侧只有一条通道：provider 发 `byspace_turn_failed` → `internal/server/server.go:3627` 广播 `turn_failed`、状态转 `error`、`appendSystemErrorRow` 落行。Go 里除 mock provider 外没有任何 provider 发这个事件；`process_exit`（进程死了）有兜底，进程活着但请求失败没有。契约见 `spec/agent-conversation.md`「运行与加载指示」，pi 的事件形状见 `notes/2026-11-07-pi-model-call-failure-shape.md`。

## 待逐个核对的入口

只有 pi 已核实并修复，其余是读代码得到的同一形状，尚未复现：

- `internal/agent/providers/claude.go:366` `case "result"` — 只取 `ev["result"]` 文本；Claude 的错误 result（`is_error: true`，无 result 文本）走 `status = idle` + `agent_end`，即 completed。
- `internal/agent/providers/codex.go:464` — 同一 `agent_end` 收尾；`codex.go:187` 只处理 JSON-RPC 层错误。
- `internal/agent/providers/acp.go:740` — 同上；`acp.go:188` 只处理 JSON-RPC 层错误。
- `internal/agent/providers/opencode.go:210` `Prompt` — HTTP 非 2xx 不算 Go error，`replyText` 留空即无行、无事件；`LastError()` 硬编码返回 `""`。

## 验证

每条改动用原来的坏法再看一眼：让 provider 真的失败一次（免费额度模型、无效 key、或 provider 自己的错误注入），确认对话里出现 `[System Error]` 行、侧边栏读作 error、重开 App 后行为符合 `spec/agent-conversation.md`「时间线恢复与同步」里记的重载缺口。pi 侧已有事件流单测（`internal/agent/pi/pi_test.go`）可作模板。

## 范围

不包含：把 `[System Error]` 行做进 transcript 重建（重载后消失是已知缺口，pi 与 Node 同形，另议）；不改客户端渲染；不引入 provider 侧的错误文案格式约定——原文透传即可。

## 执行记录

四个入口都改成「provider 自己报的失败 = 失败的回合」，事件形状取自各自的协议而不是猜的：

| provider | 失败信号                                                                                            | 落点                  |
| -------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| Claude   | `result` 事件的 `is_error: true` 或 `subtype` 以 `error` 开头；`result` 里的原文进 `[System Error]` | `claudeResultFailure` |
| Codex    | `turn/completed` 的 `turn.status: "failed"` + `turn.error.message`（旧版本把 message 放顶层）       | `codexTurnFailure`    |
| ACP      | `session/prompt` 的 JSON-RPC 错误                                                                   | `finishPrompt(err)`   |
| OpenCode | 消息接口的非 2xx（状态 + 响应体前 4KB）                                                             | `Prompt`              |

每家都设 `lastError`/`LastError()`（侧边栏和 hover card 读它），发 `byspace_turn_failed`（带 `turnId`），并且**不再**发 `agent_end` —— 一个失败回合不能同时报完成。`WaitForFinish` 的等待者本来就拿到 error。

**验证**：`turnfail_test.go` 覆盖四家的检测与事件（真事件形状、httptest 429、`finishPrompt`），`go test ./internal/{server,cli,agent/...}` 589 通过；`npm run audit` 的字段对账不受影响。

**还没做**：真实 provider 的失败复现（免费额度/无效 key）。四家的失败**形状**有 Node 源码与 CLI 文档作证，但「真实 429 时这一行出现在对话里」需要一次真调用；这条留在 `-o-`，是本事项唯一未完成的验收项。
