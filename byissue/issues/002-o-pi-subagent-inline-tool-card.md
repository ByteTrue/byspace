---
kind: issue
title: "Pi subagent 时间线行内实时卡片"
type: feature
status: done
created: 2026-10-06
epic: ../epics/004-o-pi-first-class-and-bytetrue-extensions/spec.md
---

# Pi subagent 时间线行内实时卡片

## 做成以后是什么样

父会话时间线上，pi-subagent 的 `subagent` 工具行实时显示子代理状态：状态点（running 旋转/completed/failed/canceled）+ 行为摘要副标签（descriptor.subtitle）+ turns/cost 摘要。并行多个 subagent 时每行各自独立显示，不为并行发明组卡片层。行内卡片点击打开只读 tab（复用 001 的 timeline RPC）。

**范围：** App 侧（packages/app）为主。daemon/协议零改动——001 已把 descriptor 按 `toolCallId` 关联到时间线工具行。

## 为什么现在做 / 当前坏在哪

001 之后 subagents track 与只读 tab 已通，但父会话时间线上的 `subagent` 工具行还是普通工具行（或 codemode 嵌套行）的静态渲染，运行中看不到进度，与 Claude subagent 的行内体验不对齐。

## 方案（待实现）

- 数据源：`agent.provider_subagents.update` 推送 + `agent.provider_subagents.list` 拉取，App 现有 store 已收（Claude 已消费）。行内卡片按 `toolCallId` 从该 store 订阅 descriptor。
- 渲染位置：062 的 codemode 嵌套行机制内——`subagent` 工具行渲染为专用卡片组件（状态点 + subtitle + turns/cost），非 subagent 工具行渲染不变。
- 回放：daemon streamHistory 已从转录派生 provider_subagent 事件，重载后行内卡片三态（running/completed/failed）正确重建。
- 兼容：descriptor 缺席（旧 pi-subagent / 旧 daemon）时按普通工具行渲染，不算坏。

## 方案（已实现）

- **纯函数层**（`packages/app/src/components/tool-call-subagent-row.ts`）：`ToolCallSubagentBinding{status, secondaryLabel, onOpen}`；`resolveJoinedSubagentRow(subagent, status, canOpenDetails, handleToggle)` 合并「有/无 binding」两条渲染逻辑（无 binding 走原工具行：running/executing→loading、failed→error、canOpenDetails 才可点；有 binding 走 descriptor 状态 + onOpen）；`isToolCallSubagentEqual` 供 memo 比较器。独立成模块是因为 message.tsx 无法被单测 import（react-native-markdown-display 在 jsdom/vite 下 import-analysis 失败）。
- **ToolCall 行**（message.tsx ~3045）：`joinedRow = resolveJoinedSubagentRow(...)`，ExpandableBadge 的 `onToggle={joinedRow.handlePress}`；binding 存在时 `secondaryLabel = subtitle ?? description ?? title`，`isExpanded`/`renderDetails` 抑制（点击进只读 tab 而非展开详情）；`areToolCallPropsEqual` 增 `isToolCallSubagentEqual`。
- **绑定来源**（view.tsx）：`useProviderSubagentsByToolCallId({serverId, parentAgentId})`（feature gate `providerSubagents` 关闭时空 Map）→ `useStableEvent` 按 `data.callId` 查 descriptor → binding.onOpen 调 `onOpenProviderSubagent(agentId, descriptor.id)`。`AgentStreamViewProps.onOpenProviderSubagent` 为可选回调——view.tsx 被 workspace-tab 等无 PaneProvider 场景复用，不能直接 usePaneContext。
- **打开只读 tab**（agent-panel.tsx AgentStreamSection）：`openPreferredTarget({kind:"provider_subagent", parentAgentId, subagentId}, "subagents")`。
- **selector**（provider-store.ts:70）：`selectProviderSubagentsByToolCallId(state, serverId, parentAgentId)→Map<toolCallId,descriptor>`，parentPrefix 扫描，无 toolCallId 的 descriptor 跳过。

## 验证与执行记录

- 组件三态测试：`message.tool-call-subagent.test.tsx` 4 用例（无 binding 四状态、binding 覆盖工具状态、canceled binding + tool running 非 loading、比较器相等性）。
- selector 测试：select.test.ts 3 用例（toolCallId 索引、跨 parent 隔离 + 无 toolCallId 跳过、空 Map）。
- 回归：subagents + 组件 87 绿、agent-stream 205 绿；全 workspace typecheck 0 错、oxlint 0 警告 3391 文件。
- 真机场景：受阻——已安装 pi-subagent（~/.pi/agent/npm）为真目录且 dist 无上报代码，descriptor 需 pi-subagent 发版后才会在真会话出现；纯函数三态测试覆盖退化路径（descriptor 缺席 → 普通工具行）。发版后走浏览器核对行内状态点与点击开 tab。

## 审查修复记录（2026-10-06，双子代理审查后）

两个子代理（正确性审查 + ponytail 过度设计审查）并行审查了未提交改动，仲裁后落地：

**正确性修复：**

- **closure 泄漏**：`prepareAgentForClosure`（reload/close 路径）补 `piSubagentReportTokens.delete` + `piSubagentTailers.removeAgent`——原只在 archive/delete 的 `discardRetainedAgentState` 清理。
- **终态 latch**：`applyProviderSubagentEvent`（agent-manager 私有）统一 5 处 store apply 点——upsert 后若 descriptor 已终态则丢弃 running 事件，杜绝「HTTP 上报与工具事件无顺序保证，succeeded 先落 running 后到把终态打回 running」的竞态；tailer 同步删除 reopen-on-running 分支。store.apply 保持纯函数不动。
- **app memo 三件套**：`useProviderSubagentsByToolCallId` 补 Map 浅相等 equalityFn（selector 每次 new Map，缺了任意 provider-subagent 事件会全量重渲染所有订阅流）；view.tsx binding 用 WeakMap 按 descriptor 缓存稳定身份（comparator 按 identity 比较 onOpen）；`agentStreamViewPropsEqual` 补 `onOpenProviderSubagent` 比较。
- **sessionFile 上报**：mono 侧 `buildByspaceReportRecord(task, sessionLogPath)` 上报子会话 jsonl 绝对路径，tailer 优先直用，跳过 daemon 侧目录猜测——配自定义 `sessionDir`/`PI_CODING_AGENT_SESSION_DIR` 的 fork 原本会静默空 tab。resolver 注入而非 import，避免 index.js 运行时循环。
- **短读修复**：tailer drain 用 `handle.read` 返回的 `bytesRead` 截断，原 `void read` 在截断窗口会丢数据。
- `mapPiSubagentStatus` 补 `pending` case（契约 pending→running）。

**精简（ponytail 采纳项）：** 删 `observePiSubagentReportRecord`（与 `observePiSubagentRecord` 同构）、tailer 本地 `walkJsonlFiles`（复用 session-descriptor 导出）、tailer 测试旋钮（pollMs/autoStart/entryCount）、bootstrap 路由工厂内联、`readPiToolResultDetails` 内联、`ToolCallSubagentEqualityInput` 别名、mono `get enabled()`；selector 移入 select.ts。

**验证：** server 26 绿、app 18 绿、mono 68 绿（全量）；全 workspace typecheck 0 错；oxlint 0 警告 3391 文件；双仓 format 完成。
