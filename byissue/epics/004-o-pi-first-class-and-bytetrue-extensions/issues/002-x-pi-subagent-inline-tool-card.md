---
kind: issue
title: "Pi subagent 时间线行内卡片：嵌套行按 toolCallId 订阅 descriptor 实时增强"
type: feature
status: closed
closed: 2026-10-07
created: 2026-10-06
---

<!-- 读者：跨会话接手的人。目标与范围 · 现状怎么工作 · 方案 · 验证 · 关闭回写 -->

# Pi subagent 时间线行内卡片

Epic：`../spec.md`。依赖：`001-o-pi-subagent-track-vertical-slice.md`（descriptor 通道）。

## 为什么做

issue 001 解决「会话里有哪些子代理、完整过程在哪看」，但父会话时间线里的 subagent 工具行仍是静态文本——运行中看不到进度，要切到 track 或 tab。owner 截图的场景（codemode 并行两个 Task，只显示两行黑字）正是痛点。

## 现状怎么工作（改前）

- 062 建好 codemode 嵌套行机制：daemon 透传 `parentToolCallId`，App 侧 `projectNestedCodemodeCalls` 分桶，渲染 [父行, ...子行] 竖轨缩进组（`packages/app/src/tool-calls/detail-level/nested-codemode.ts`、`projection.ts`）。
- `tool-call-details.tsx` 的 `SubAgentDetailSection` 只解析静态 log 的 `[tool] summary` 括号行；OMP/OpenCode 已填 `childSessionId` 也只显示「session <id>」文本。
- descriptor 通道（issue 001 交付）带 `toolCallId`——现成的行级订阅键；`subtitle`（behaviorSummary）与 `status` 即是行上要显示的东西。

## 方案（已实现）

- **逐行增强，不聚合。** subagent 工具行（含 codemode 嵌套子行）按 `toolCallId` 订阅 provider_subagents descriptor，行上实时显示：状态点 + subtitle（「Modifying files」「已暂停 · 可恢复」）+ turns/cost。复用 062 的嵌套渲染槽，不为并行场景发明组卡片。
- 非 codemode 的直接 subagent 工具行走同一增强。
- **降级**：无 descriptor（旧 pi-subagent、其它 provider）保持 062 现状渲染，不允许出现等 descriptor 的加载态闪烁。
- 行点击行为保持现状（展开详情）；是否加「在 track 中定位」入口实现时按设计系统定，非必需。

## 方案（已实现）

- **纯函数层**（`packages/app/src/components/tool-call-subagent-row.ts`）：`ToolCallSubagentBinding{status, secondaryLabel, onOpen}`；`resolveJoinedSubagentRow` 合并「有/无 binding」两条渲染逻辑；`isToolCallSubagentEqual` 供 memo 比较器。独立模块因 message.tsx 无法被单测 import。
- **ToolCall 行**（message.tsx）：binding 存在时状态点走 descriptor 状态、secondaryLabel=subtitle??description??title、点击开只读 tab（展开抑制）。
- **绑定来源**（view.tsx）：`useProviderSubagentsByToolCallId`（Map 浅相等 equalityFn + feature gate）→ WeakMap 按 descriptor 缓存 binding → `onOpenProviderSubagent` 可选回调；agent-panel 用 `openPreferredTarget` 兜住。
- **终态 latch**（审查修复）：daemon 应用点丢弃终态后的 running 事件；`agentStreamViewPropsEqual` 补 `onOpenProviderSubagent`。

## 验证

- 组件测试 4 用例（三态 + 降级）+ selector 测试 3 用例（索引/隔离/空 Map）；agent-stream 回归 205 绿。
- 真机场景：pi-subagent 0.14.0 发版并本地安装后，Owner 真机验收通过（codemode 并行两个 subagent，行内状态点实时、点击开只读 tab、终态落定）；退化路径由纯函数测试钉住。

## 审查修复记录（2026-10-07，双子代理审查后）

正确性（M1 closure 泄漏、M2 终态 latch、M3 memo 三件套、M4 sessionFile 上报、L6 短读、L7 pending）+ ponytail 精简 8 项，全部落地；详见 talk 006 与 issue 001 关联记录。

## 不在本 issue

并行聚合成组卡片（已拍板不做）；行上写操作（停止/恢复）；track 与 tab 本身（issue 001）。

## 关闭回写

已毕业：`byissue/spec/agent-conversation.md` 的 subagent 展示语义（工具行一节）；嵌套行机制未动，`docs/` 无需同步。
