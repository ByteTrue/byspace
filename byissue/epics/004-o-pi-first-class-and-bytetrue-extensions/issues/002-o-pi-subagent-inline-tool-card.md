---
kind: issue
title: "Pi subagent 时间线行内卡片：嵌套行按 toolCallId 订阅 descriptor 实时增强"
type: feature
status: open
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

## 方案（待实现）

- **逐行增强，不聚合。** subagent 工具行（含 codemode 嵌套子行）按 `toolCallId` 订阅 provider_subagents descriptor，行上实时显示：状态点 + subtitle（「Modifying files」「已暂停 · 可恢复」）+ turns/cost。复用 062 的嵌套渲染槽，不为并行场景发明组卡片。
- 非 codemode 的直接 subagent 工具行走同一增强。
- **降级**：无 descriptor（旧 pi-subagent、其它 provider）保持 062 现状渲染，不允许出现等 descriptor 的加载态闪烁。
- 行点击行为保持现状（展开详情）；是否加「在 track 中定位」入口实现时按设计系统定，非必需。

## 验证

- 组件测试：descriptor 到达 / 更新 / 终态三态的行渲染；无 descriptor 降级渲染。
- 真机场景（沿用 001 的 e2e 环境）：codemode 并行两个 subagent，两行各自实时滚动进度，终态落定。

## 不在本 issue

并行聚合成组卡片（已拍板不做）；行上写操作（停止/恢复）；track 与 tab 本身（issue 001）。

## 关闭回写

`byissue/spec/agent-conversation.md` 工具行一节；docs 如动嵌套行机制则同步 `docs/` 对应文档。
