---
kind: issue
title: "修复 Pi Agent 回复结束后客户端依然保持运行中状态的边界结算缺陷"
type: ff
status: closed
created: 2026-09-03
closed: 2026-09-03
---

# 修复 Pi Agent 回复结束后客户端依然保持运行中状态的边界结算缺陷

## 做了什么

1. **修正 Pi Provider Turn 边界结算判定逻辑**：
   在 `PiRpcAgentSession.handleTurnBoundaryEvent` 中，解除对非重试场景下延迟 `agent_settled` 事件的强依赖。当收到 `agent_end` 且 `!event.willRetry`（即 `willRetry: false` 或 `undefined`，且未处于 active auto-retry 恢复阶段）时，**立即调用 `completeTurn`**，发出 `turn_completed` 并将生命周期切换为 `idle`。助手文字输出完毕的瞬间，客户端立即解除锁定并恢复发送按钮。
2. **保持 Auto-Retry 恢复等待与结算幂等**：
   - 仅在 `event.willRetry === true` 或处于活跃重试（`isAutoRetrying`）时，才暂存消息并推迟到 `agent_settled` 进行重试结算；
   - 随后的 `agent_settled` 事件检测到 `this.activeTurnId` 已经清空后安全幂等忽略，不会重复触发完成；
   - 保证即便后台插件（如 Watchdog 代码审查、LSP 诊断、会话压缩检查、异步状态同步等）在 `agent_end` 后长时间执行或出现异常丢失 `agent_settled`，也不会再导致 BySpace 会话永久卡死在 `running` 状态。

## 改了哪些

- `packages/server/src/server/agent/providers/pi/agent.ts`：
  - 新增 `isAutoRetrying` 标记以识别是否处于网络/API 异常的主动重试循环中；
  - 重构 `handleTurnBoundaryEvent`：在 `agent_end` 阶段先保留 `pendingSettledMessages`，对非重试（`!event.willRetry`）情况立即调用 `completeTurn` 结束 turn；
  - 在 `auto_retry_start` 时激活 `isAutoRetrying`，在 `completeTurn` 时清理重置。
- `packages/server/src/server/agent/providers/pi/agent.test.ts`：
  - 新增单元测试 `completes normal turn immediately on agent_end without waiting for delayed agent_settled`，验证在 `settleTurn()` 尚未触发或严重延迟到达时，turn 已即时标记 `turn_completed`，随后到来的 settlement 幂等忽略。

## 怎么验证的

- `npx vitest run packages/server/src/server/agent/providers/pi/agent.test.ts --bail=1`：79/79 个测试全部通过；
- `npx vitest run packages/server/src/server/agent/providers/pi/ --bail=1`：6 套测试文件共 123/123 个测试全部通过；
- `npm run typecheck`：全 monorepo 0 错误；
- `npm run lint`：3996 个文件 0 warning 0 error；
- `npm run format:check`：格式校验完全通过。

## 对 .codestable/ 的影响

- 毕业更新 `.codestable/spec/agent-conversation.md`，记录 Pi Turn 边界结算的即时性与幂等性保障。
