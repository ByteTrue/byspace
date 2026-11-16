---
kind: issue
title: "修复 reload 后 pi codemode 嵌套工具行全部消失（回放重建子行）"
type: ff
created: 2026-10-07
---

# 修复 reload 后 pi codemode 嵌套工具行全部消失（回放重建子行）

## 预期与实际

预期（spec/agent-conversation）：嵌套调用渲染为父行 + 缩进竖轨下的子行，reload 后照常按父行归档。

实际：reload（重新加载会话）后徽标还在（"运行了 6 个命令"），子行全部消失，只剩父行。

## 根因

Reload 走 `refresh_agent_request` → `reloadAgentSession({ rehydrateFromDisk: true })`（session.ts:3736），**清空 durable timeline**（嵌套子行只存在于这里）后从 pi transcript 重放。而 `PiHistoryMapper` 只把 `nestedCalls` 算成父行的 `metadata.nestedSummary`（徽标兜底），不重建子行——`nestedSummary` 的设计前提是"行到了但子行没到"，reload 恰恰是"子行已到但被清掉"的反例，此前未覆盖。

## 修了什么

packages/server/src/server/agent/providers/pi/history-mapper.ts：`mapToolResultMessage` 返回事件数组，新增私有方法 `replayedNestedCallEvents`——把 pi 记在 toolResult 消息上的 `nestedCalls.calls`（`{ id, name, status, arguments?, error? }`，含套娃的扁平列表）重建为带 `metadata.parentToolCallId` 的 tool_call 行，插在父结果行之前。pi 的嵌套 id 是 "<callerId>/<n>"，metadata 用 id 的最后一段分隔符前缀（直接调用者），与 live 路径 pi 事件上的权威字段口径一致；codemode-in-codemode 中间层由 app 侧 `resolveAncestorItemId` 上溯归组，与 live 相同。状态映射：ok→completed、error→failed（带截断的 error 文本）、unfinished→canceled（脚本被打断）。行名走 `resolveToolCallName`，args 驱动的改名（mcp → server.tool）与 live 对齐；details 驱动的改名（xdev write）因嵌套结果不入 transcript 而缺席，已注释接受。嵌套 id 是 transcript 原始值，注释钉住「pi 回放路径不启用 resolveToolCallId hook」这一前提。

history-mapper.test.ts：原用例改名并断言子行 + 父行结构；新增套娃/直接调用者归属/unfinished、mcp args 改名、表驱动畸形输入（nestedCalls 非 record / calls 非数组 / 缺 id / 空白 name / 未知 status / error 非字符串）三组用例。

## 审查结论（子代理 ×2）

- 过度工程：仅一条——`mapDetail` 回调单一实现，砍掉回调间接层改成私有方法。已采纳。其余（防御式解析、显式窄化联合、directCallerFromNestedId 与既有 parentToolCallIdFromId 的语义分工、两个行为测试）均判为值得保留。
- 正确性：无阻塞。已采纳：行名走 resolveToolCallName（Low）、hook 耦合注释（Low）、畸形输入用例（Info）。不改：徽标计数与子行数在畸形 transcript 下可不一致（App 端有子行时徽标由子行算，nestedSummary 只在无子行兜底分支显示，两路径互斥，UI 不会出现）；子行无输出（transcript 本就不存嵌套结果，非缺陷）。

## 怎么验证的

- `npx vitest run packages/server/src/server/agent/providers/pi/history-mapper.test.ts --bail=1` 9 绿（含审查后新增用例）。
- 相邻回归：subagent-session-tailer / tool-call-mapper / nested-codemode（app 投影）34 绿；agent.test.ts 99 绿；agent-manager reload 相关 17 绿。
- `npm run typecheck` 全过；lint 0/0；format 过。

## 对 byissue/ 的影响

byissue/spec/agent-conversation.md：「metadata.nestedSummary 是没有子行可归时的兜底」一句更新——reload 重放现在重建子行，兜底只留给 pi 未上报 nestedCalls 的旧 transcript 与 provider hydration/导入。
