---
kind: issue
title: "恢复 Node 的流式合并窗口：relay 每帧 = 1 次 DO 请求"
type: ff
created: 2026-11-01
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 恢复 Node 的流式合并窗口：relay 每帧 = 1 次 DO 请求

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

Go daemon 把 provider 的每个 token delta 直接发成一帧 websocket 消息，而 relay 每帧收一次
Durable Object 请求。实测 pi 一次 200 词回答产生 1,230 个 delta（~140/秒），一个下午的 agent
工作把免费层的 10 万/天打穿到 226 万次，remote 连接全部 502。Node 版一直有 60ms 合并器，
移植时没跟过来。现在按 Node 的实现整体搬回：text/reasoning 相邻合并，tool_call 按 `callId`
就地覆盖（最新快照胜出），terminal 状态立即 flush，leading edge 保证首字不延迟。

- 改动：`internal/server/stream_coalescer.go`（新增，含 Node 的 collapsing 语义）、`internal/server/server.go`（接在 `byspace_stream_timeline` 出口、回合边界前 flush、Close 时 flushAll）、`internal/server/{ws_agent,mcp,agent_archive_cascade}.go`（agent 删除/归档/杀进程后丢弃 buffer）、`docs/agent-stream-performance.md`（写明这是额度约束）
- 验证：`stream_coalescer_test.go` 逐条移植 Node 的 24 个用例（leading/trailing、kind/turn/provider/messageId 边界、空白逐字节、空 delta、按 agent 隔离、重入、陈旧定时器、terminal 立即 flush、混合顺序），定时器注入所以不 sleep；`stream_frame_rate_test.go` 端到端 600 delta 由 609 帧降到 11 帧且正文逐字节一致；`go test ./internal/server`、`npm run audit` 全绿
- byissue：已同步 `byissue/notes/018-durable-object-billing-and-hibernation.md`（新增「第二个额度：requests，不是 duration」小节，含 140 事件/秒的实测常数与 60ms 上限换算）

顺手发现（不在本次范围）：免费层 10 万/天 ≈ 1.16 帧/秒，即使合并后重度使用仍会撞顶；relay 侧没有帧数配额保护，一个客户端的行为就能替整个账户花完额度。
