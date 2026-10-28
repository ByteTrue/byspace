---
kind: issue
title: "对话 rewind 让 pi 回放整棵会话树，客户端收到整段 timeline 流"
type: bug
created: 2026-10-28
---

# 对话 rewind 让 pi 回放整棵会话树

## 预期与实际

**预期**：`agent.rewind.request` 之后，服务端不再向发起方推 timeline 行——那条历史是它自己要改写的，
客户端靠响应更新状态。

**实际**：`agent-message-rewind.spec.ts:48` 的计时门在「rewind 响应被扣住」窗口内收到 **48 条**
`agent_stream` / `event.type: "timeline"` 事件，断言要求 0。事件 seq 从 1 开始递增，是整棵树的回放。

## 根因

Go 的 pi rewind 走的是一条通用命令通道：

```go
// internal/agent/pi/rewind.go
prompt := "/" + TreeExtensionCommand + " " + base64.RawURLEncoding.EncodeToString(payload)
s.proc.Request(ctx, map[string]any{"type": "prompt", "message": prompt})
```

`/tree` 是 pi 的树导航命令，它会把导航后的会话重新流出来，于是 `handleRawEvent` 把每一行都当新行
`broadcastSessionMsg("agent_stream", ...)` 推给所有客户端。Node 走 provider 自己的 rewind API，
不产生回放。

一处侧证：`rewindConversation` 之后 Go 还广播 `agent.timeline.replacement` 给**所有**客户端；Node 的
`deliverTimelineReplacement(agentId, source)` 明确排除发起方（`isSubscribed && !isInitiator`）。
把排除加上后计数从 51 降到 48，说明那不是主因，主因是 provider 侧回放。

## 结论：不是 provider 回放，是测试把上一轮的尾部抖动算进了 rewind

加计时探针后拿到了决定性数据：**`agent.rewind.response` 到达时计数只有 52**，而断言拿到的 48 是
在「悬停 → 点开菜单 → 点 Rewind conversation」这段时间里继续到达的。

`completeSubmittedTurn` 用 `waitForFinish(...).status === "idle"` 判定 turn 结束，但 idle 只说明
provider 报完了，**最后几行还在过 socket**。这些行落在 rewind 之前，不是 rewind 回放出来的。

`rewindCompletion.clearTimelineStreamCount()` 是一次性清零，清在 idle 之后、拖尾行之前，于是把
「上一轮还在收尾」记成了「rewind 回放了历史」。

修法：新增 `settleThenClear(quietMs = 600)`——等到 600ms 内没有新的 timeline delta 再清零。
反向核对：撤掉 settle 后 2/2 稳定失败（`1 failed 2 passed`），恢复后 4/4 全绿。

`broadcastSessionMsgExcept`（让 `agent.timeline.replacement` 不回到发起方）仍然保留——它对齐
Node 的 `deliverTimelineReplacement(agentId, source)`，且能让计数从 51 降到 48。但它不是本 issue 的
主因，可以独立评审。

## 影响面

**必须改**：`internal/agent/pi/rewind.go` 的 rewind 通道，或 `internal/server/server.go` 里
`byspace_stream_timeline` 分支的抑制条件。

**需要验**：rewind 之后时间线仍然正确（这是本次改动的判据——不能靠丢事件让断言变绿）；
发起方与其他客户端的差异；`agent.timeline.replacement` 的受众。

**仍未知**：pi 是否提供不回放的 rewind 通道。若没有，只能在服务端按 turn 边界抑制。

## 方案

优先找 provider 侧的 rewind 入口。若只能继续走 `/tree`，则在 rewind 期间按 agent 抑制 timeline
广播，并在 rewind 完成后用一次完整的 `agent.timeline.replacement` 让**其他**客户端重取——
不能改动时间线本身的正确性。

## 验证

1. `agent-message-rewind.spec.ts` 三条全绿，其中第 48 行那条的计时门计数为 0
2. 手工在浏览器里 rewind 一次，确认消息确实消失、草稿保留、滚动位置正确
3. 两个客户端同时打开同一 agent，只有非发起方收到 replacement 并重取

## 沉淀去向

- **`docs/testing.md` →「Before debugging a failure, check the test reached its subject」**：
  `waitForFinish(...).status === "idle"` 只表示 provider 报完，不等于最后几行已经过 socket；
  用 idle 清零事件计数就会把上一轮的拖尾算到下一个动作头上。
- 该 issue 原判「provider 回放整棵树」被数据推翻（`rewind.response` 到达时计数只有 52），
  推翻过程保留在本文，不再另立记录。
