# Pi 的模型调用失败不是错误，是一条空 assistant 消息

> **读者：** 以后要给任何 provider 接失败路径的人——先看结论，再看何时适用与细节。

---

**结论：** pi（`--mode rpc`）在模型调用失败时不抛错、不发错误事件，而是在 `message_end` 上给一条 `content: []`、`stopReason: "error"`、`errorMessage: "<供应商原文>"` 的 assistant 消息，然后照常发 `agent_end`。宿主只看 content 就会把它读成「这一轮说完了，没话说」，回合被报成 completed。判定失败的唯一依据是 `errorMessage`，且必须同时看 `stopReason`：`"aborted"` 同样带 `errorMessage`（`"Operation aborted"`、`"Aborted after 2 retry attempts"`），那是用户按停止，不是失败。

**何时用：** 任何消费 pi JSONL RPC 事件流或 pi 会话文件（`~/.pi/agent/sessions/**/*.jsonl`）的地方——provider 的回合结算、从 transcript 重建时间线、导入历史会话。

**细节：** 2026-11-07 生产 daemon（Windows）上 chief agent 用免费额度耗尽的路由模型发消息，界面上只有用户气泡、agent 停在 idle，报错只在终端里看得见。根因是 `internal/agent/pi/pi.go` 的 `agent_end` 无条件发 `byspace_turn_completed`。归档的 Node provider 一直读这条消息（`latestPiErrorMessage` / `formatPiErrorMessage`，还会把 `stopReason`、`model`、`responseModel`、`responseId` 拼进文本），Go 移植时整段丢了——`packages/server/dist/server/server/agent/providers/pi/agent.js` 可查。移植后的形态是：`message_end` 记下错误，`agent_end` 有错就发 `byspace_turn_failed`。重试场景要求「最后一条 assistant 消息说了算」：记录用赋值而非累积，否则第一次尝试的 429 会污染最终成功的那一轮。

同一形状还有一处没接：`internal/agent/pi/history.go` 从会话文件重建时间线时不看这两个字段，所以失败行在 daemon 内存里、刷新后消失。

**相关：** `internal/agent/pi/pi.go`（`assistantErrorMessage`、`turnError`）、`internal/server/turn_failed_notice.go`（daemon 侧唯一的 `[System Error]` 行落点）、`byissue/issues/2026-11-07-o-provider-turn-failure-silent.md`、`byissue/issues/2026-11-07-x-ff-pi-turn-error-swallowed.md`。
