---
type: ff
---

# Pi 模型调用失败不再静默结束

## 做了什么

生产 daemon（Windows）上 chief agent 用 `magpie/auto/glm-5.3-flash-free` 发消息，模型返回 429 免费额度耗尽，界面上只有用户气泡，没有回复、没有报错，agent 停在 idle。pi 不把模型失败当错误抛出，而是结束回合时留一条 `stopReason: "error"`、`errorMessage` 带供应商原文的空 assistant 消息；Go 侧的 pi provider 只看 content，于是把失败报成 `turn_completed`。现在 provider 读出这条错误文本，在回合结束时发 `byspace_turn_failed`，daemon 已有的通路把它变成 `turn_failed` 事件、agent 状态 `error` 和一条 `[System Error]` 时间线行。用户按停止得到的 `stopReason: "aborted"`（`errorMessage` 是 "Operation aborted"）仍然算正常结束，不写错误行。

## 改了哪些

- `internal/agent/pi/pi.go`：新增 `assistantErrorMessage`；`turnError` 字段记录本轮最后一条 assistant 消息的错误；`agent_end`/`agent_settled` 有错误时发 `byspace_turn_failed` 而不是 `byspace_turn_completed`，并把 `WaitForFinish` 的等待者用 error 结算。
- `internal/agent/pi/pi_test.go`：三个事件流测试——失败、重试后成功、aborted。

## 怎么验证的

- `go test ./internal/agent/...`（282 passed）与 `go vet`、`gofmt` 干净。
- `npm run audit -- --no-browser` 四项全绿（Go 测试、入站/出站字段对账、重审账本一致）。
- 真机端到端：dev daemon（`127.0.0.1:6778` + `.dev/byspace-home`，不碰 6777）跑 `byspace run --provider pi --model magpie/auto/glm-5.3-flash-free`，CLI 直接打回 `[System Error] 404: …magpie knows no model…`，`byspace ls -a -g` 读作 `error`，`byspace logs <id>` 里错误行在位；同一个 dev daemon 换成可用模型 `magpie/auto/crouton-alpha` 正常回 `ok`，无错误行。本次遇到的是 404 而不是原报的 429（免费路由组 id 已不在当前 magpie 配置里），同一类：pi 以 `stopReason: "error"` 结束回合。
- 单测用的是本机真实会话里的原文：`~/.pi/agent/sessions/--C--Users-byte-.byspace-chief--/2026-11-07T11-08-05-511Z_*.jsonl` 两条 `stopReason: "error"` 消息。
- daemon 侧 `turn_failed` → `[System Error]` 行与状态转换由既有 `internal/server/stream_conformance_test.go`、`turn_failed_notice_test.go` 覆盖，本次未改。
- 未重启生产 daemon；界面生效需要重新构建并发布桌面 App。
- 提交停在本地 `main`（`4677af4e1`），未 push；按用户决定等下次发布一起走。

## 对 byissue/ 的影响

无影响。`spec/agent-conversation.md` 未描述回合失败的来源，未产生新真相。

## 顺手发现

- Windows 上 `npm run dev:daemon` 与 `npm run cli` 直接失败：`make build` 的 nogui 目标产出 `bin/byspace`（无 `.exe`），两个脚本在 win32 下硬要求 `bin/byspace.exe`。已同日快改，见 `2026-11-07-x-ff-windows-go-binary-exe-suffix.md`；本次验证当时是手敲 env 直接跑 `./bin/byspace serve` 绕过的。
- `internal/agent/pi/history.go` 从 pi 会话文件重建时间线时不看 `stopReason`/`errorMessage`，所以 `[System Error]` 行只存在于内存，重载后会消失。归档的 Node daemon 同样如此，不是本次引入。
- Go 侧除 mock 外没有任何 provider 发 `byspace_turn_failed`；Claude、Codex、ACP、OpenCode 大概率同样静默吞错，已开 `byissue/issues/2026-11-07-o-provider-turn-failure-silent.md`。
