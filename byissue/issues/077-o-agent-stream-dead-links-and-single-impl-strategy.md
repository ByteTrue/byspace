---
kind: issue
title: "清掉 agent-stream 的死链路与单实现抽象"
type: chore
status: open
created: 2026-10-11
---

# 清掉 agent-stream 的死链路与单实现抽象

> **读者：** 接手 agent-stream 渲染层的人。三件事都已在 HEAD 上复核过调用点，结论可直接用；动手时注意第三条的替换方式有代价。
> **目标：** 删掉编译期恒不可达的链路、只剩单个实现的转发层，以及会静默失效的手工比较器。
> **来源：** `076-x-ff-live-thinking-tail-and-thinking-level` 的两轮子代理评审顺手发现；其中策略层收敛是 041（过度工程审计）明确退出范围、未建 Issue 的遗留。
> **验证：** `npm run typecheck` + `npm run lint` + `agent-stream` 与 `message` 相关单测 + `timeline-detail-level` / `agent-stream-ui` 两条 e2e。

## 范围

包含：`packages/app/src/agent-stream/` 的策略层与内联展开链路、`packages/app/src/components/message.tsx` 的 memo 比较器。
不包含：`ToolCall` 内部展开状态的归属（见「仍未知」）；`getIsElectron()` 恒假分支（041 的 B3，另有 11 处调用方要一并改造）。

## 一：内联展开上报链路在 web 上整条不可达

web strategy 把 `disableParentScrollOnInlineDetailsExpansion` 硬编码为 `false`（`strategy-web.tsx:1307`），而 `strategy-resolver.ts` 永远返回 web strategy。于是：

- `view.tsx:787` 的守卫恒早退 → `setExpandedInlineToolCallIds` 永不被调用 → `expandedInlineToolCallIds` 恒空集 → `view.tsx:1277` 的 `streamScrollEnabled` 恒 `true`。
- 连带死掉的还有整条上报管道：`view.tsx` 的 `setInlineDetailsExpanded` → `ToolCallSlot`/`ThoughtSlot` 的 `itemId` 与 `onInlineDetailsExpandedChangeByItemId` prop → `ToolCall` 的两个 effect（`message.tsx:3006-3023`）。

**注意范围比评审估计的大。** 评审说 `onInlineDetailsHoverChange` 也是死路径——这条**不成立**：`ToolCall` 自持 hover 状态（`message.tsx:2999` 的 effect 与 `message.tsx:3085` 的 `onDetailHoverChange`），外部从不传该 prop，它服务的是组件内部的 hover 行为。删的时候别把它一起带走。

对比基线：`strategy.ts:116` 的接口成员与 `strategy.ts:135` 的 config 字段要一起删，否则 config 里会留下没人读的键（对比 041 已执行的 A1/A3，那里也有同类清理）。

## 二：策略层只剩一个实现，转发层可以折掉

`ResolveStreamRenderStrategyInput` 现在只有 `isMobileBreakpoint`（`strategy.ts:87-89`），`resolveStreamRenderStrategy` 只做一行转发，`createWebStreamStrategy` 的每个 `createStreamStrategy` 分支值都是 web 值。`strategy.ts` 334 行、`StreamStrategy` 十余个方法的接口，服务的是已经不存在的变化维度。

041 当时退出这条（「`platform` 同时门控虚拟化与缓存键，波及 3 个测试文件 21 处调用点」）——**那个前提现在已经不成立**：`model.ts` 里已经没有 `platform`，`ResolveStreamRenderStrategyInput` 只剩 breakpoint，`strategy-native.tsx` 已不存在。剩下的是一次删除 + 调用点收敛，不是跨 model/view 的重构。

做法方向：把 `createStreamStrategy` 的配置对象内联进 `strategy-web.tsx`，让 `StreamStrategy` 的消费者直接吃 web 实现；`strategy.ts` 只留类型。真实接缝要等第二个运行时出现再放，现在只有一个实现。

## 三：`areToolCallPropsEqual` 手工比 17 个字段

`message.tsx:3089-3112` 逐字段比较，新增一个 prop 忘了加进去就静默不更新行——本轮加 `defaultExpanded`/`forceInline`/`followTail` 时正是这条规则在起作用。

其中 `subagent` 的比较有已知绕法：`view.tsx:593` 的 `subagentBindingCache`（WeakMap 按 descriptor 缓存）就是为了让同一 descriptor 拿到同一个 binding 引用，否则每帧新对象会让 `isToolCallSubagentEqual` 永远判不等、整行重渲染。

**两条路线，动手时选一条并写清理由：**

1. 换 `memo` 默认浅比较 —— 依赖所有 prop 都是原始值或稳定引用。`detail`、`metadata`、`subagent` 现在靠别的机制保证稳定，换之前要逐个确认；确认不了就退回路线 2。
2. 保留手工比较，但在 props 接口处写明「新增 prop 必须同步加进比较器」，并在测试里加一条覆盖（例如断言两个仅在某新 prop 上不同的 props 判不等）。

路线 1 更省，但它是「靠约定」换成「靠引用稳定性」；如果 `subagent` 那条绕法不能去掉，路线 1 会把 WeakMap 缓存的必要性从「性能」升级成「正确性」。

## 影响面

- 必须改：`agent-stream/strategy.ts`、`strategy-web.tsx`、`strategy-resolver.ts`、`view.tsx`、`components/message.tsx`。
- 需要验：`strategy-web.test.tsx`、`render-strategy.test.ts`、`model.test.ts`（缓存键若含 strategy 身份则要跟着改）、`message` 相关单测；`timeline-detail-level` 与 `agent-stream-ui` 两条 e2e（内联展开链路的可见行为）。
- 仍未知：`model.ts` 的缓存键是否含 strategy 或 platform 身份（041 提到过「`platform` 同时门控缓存键」），第一、二条动手前先确认，它决定是不是单纯的删除。

## 与本次改动的关系

076 把 `forceInline` 的兜底收进了 `ToolCallSlot`；第一条清理会动到同一处 prop 转发，建议**先做这条清理再动 076 之后的展开逻辑**，避免两边在同一段代码上交叉。

## 执行记录

（实现时在此追加：实际改了什么、跑了什么、与方案的偏差。）
