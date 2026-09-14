---
kind: issue
title: "实时流中 tool_call 类任务工具（如 Pi todowrite）同步发布 taskSnapshot"
type: ff
status: closed
created: 2026-09-15
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 实时流中 tool_call 类任务工具（如 Pi todowrite）同步发布 taskSnapshot

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `codestable/` 有无影响。

---

修复 Pi 等第三方 Provider 在实时执行流中调用 `todowrite` 时，输入框上方 Tasks track 药丸按钮（`<AgentTaskList />`）不显示的问题。

- **根因**：
  Claude/Codex/OpenCode 会在服务端将任务工具调用转换并下发为 `{ type: "timeline", item: { type: "todo", items: [...] } }`，而 Pi provider 保持第三方原始形式下发为 `{ type: "timeline", item: { type: "tool_call", name: "todowrite", detail: ... } }`。前端虽然在 `types/stream.ts`（`reduceTimelineToolCall`）中能将 `todowrite` 识别并渲染为消息流里的 `TodoListCard`，但在实时流状态机（`session-stream-reducers.ts`）提取 `taskSnapshot` 时写死了 `event.item.type === "todo"`，导致流式期间 `taskSnapshot` 永远为 `undefined`，`session.agentTasks` 未被写入，输入框上方药丸按钮因无任务数据直接隐藏（`return null`）。
- **做了什么**：
  1. 在 `packages/app/src/types/stream.ts` 中导出 `extractTaskSnapshotFromStreamEvent(event)`，当事件为 `tool_call`（如 `todowrite`）时通过 `extractTaskEntriesFromToolCall` 提取任务条目并转成规范的 `TodoEntry[]`（保留 `status`）。同时增强 `inputFromUnknownDetail` 防御性支持含有 `input` 属性的对象。
  2. 在 `reduceTimelineToolCall` 中为 `appendTodoList` 补齐 `status: entry.status`，避免任务状态退化为纯 completed/pending 布尔值。
  3. 在 `packages/app/src/timeline/session-stream-reducers.ts` 的 `processAgentStreamEvent` 中，使用 `extractTaskSnapshotFromStreamEvent(event)` 替换原本只认 `event.item.type === "todo"` 的写死判断，使实时流中的 `tool_call` 同样能产出 `taskSnapshot` 并写入 `session.agentTasks`。
- **改动文件**：
  - `packages/app/src/types/stream.ts` — 导出 `extractTaskSnapshotFromStreamEvent`，支持从 `tool_call` 提取 `TodoEntry[]`；`inputFromUnknownDetail` 增加兼容；补齐 `appendTodoList` 中的 `status`。
  - `packages/app/src/timeline/session-stream-reducers.ts` — 引入 `extractTaskSnapshotFromStreamEvent`，在 `processAgentStreamEvent` 中为合法的任务工具调用流事件发布 `taskSnapshot`。
  - `packages/app/src/timeline/session-stream-reducers.test.ts` — 新增单元测试 `publishes task snapshots from accepted todowrite tool_call events`，验证 Pi `todowrite` 流事件能被正常解析并发布 `taskSnapshot`。
  - `packages/server/src/server/agent/providers/mock-load-test-agent.ts` — 在 Mock Load Test provider 中增加 `shouldEmitSyntheticToolCallTodo` 与 `emitSyntheticToolCallTodoTurn`，便于后续持续复现和测试 `todowrite` 工具调用场景。
  - `packages/server/src/server/agent/providers/mock-load-test-agent.test.ts` — 新增单测验证 mock provider 发出 synthetic `todowrite` 事件。
- **怎么验证**：
  - `npx vitest run packages/app/src/timeline/session-stream-reducers.test.ts --bail=1`：121/121 全绿（含新测试）。
  - `npx vitest run packages/app/src/types/stream.test.ts --bail=1`：66/66 全绿。
  - `npx vitest run packages/server/src/server/agent/providers/mock-load-test-agent.test.ts --bail=1`：17/17 全绿。
  - `npm run lint`：0 warning 0 error。
  - `npm run format:files`：格式化通过。
  - **浏览器真实端到端验证**：启动本地 dev daemon（6778）与 web app（8081），使用 Playwright 自动化驱动浏览器打开，在会话中发送 `Emit synthetic todowrite.`。经实测验证：输入框上方实时出现 `2/4 tasks` 药丸按钮；点击按钮正常弹出任务浮层，准确展示已完成、进行中和待办条目。验证完成后清理浏览器及本地临时文件，终止后台进程。
- **对 `codestable/` 的影响**：无 spec 漂移，仅为前端对齐多 provider 任务工具快照提取的内部实现补强。
