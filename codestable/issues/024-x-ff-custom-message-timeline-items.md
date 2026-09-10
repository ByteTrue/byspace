---
kind: issue
title: "Pi/OMP 扩展 custom message 全链路透传为 custom_message timeline 项"
type: ff
status: closed
created: 2026-09-11
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# Pi/OMP 扩展 custom message 全链路透传为 custom_message timeline 项

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `codestable/` 有无影响。

---

Pi 扩展经 `sendMessage` 注入的通知类消息（如 background-terminal 的 `background-exit`、subagent 的 `subagent-exit`）原先被 daemon 的 provider 压平成 assistant_message，导致通知正文被当作 agent 的话渲染进对话正文。现在新增 `custom_message` timeline 项（`customType`/`display`/`content`/`details` 全字段透传），`display: false` 按Pi TUI 语义隐藏；App 端渲染为带 `[customType]` 标签、默认 6 行截断、点击展开的独立通知卡。老 client 兼容走既有逐项门控先例（`timelineNotifications`/`pluginTimelineItems` 同构）：新 cap `custom_timeline_messages`，daemon 对未声明的 client 不发该类项。

行为变更（review Finding 8）：custom 文本不再计入 `finalText`/`lastMessage`（二者只聚合 assistant_message）——只产生扩展命令输出的 turn（如 Pi `/show-status`）这两项现在为空。机器消费者影响：`activity-curator` 已补 `[customType]` 前缀条目，schedule/推送/跨 agent 工具链路继续可见；CLI `--output-schema` 兜底扫描只认 assistant_message，纯扩展输出 turn 会改报「no structured output message」。这是语义修正（通知不是 agent 的话），schedule 若依赖扩展输出作结果需改为消费 timeline。

- 改动：
  - `packages/protocol/src/agent-types.ts`、`messages.ts`、`client-capabilities.ts` — 新 timeline 项 + wire schema + client cap（COMPAT(customTimelineMessages): added in v0.13.X, remove after 2027-09-17）
  - `packages/server/src/server/agent/agent-sdk-types.ts` — server 内部镜像 union 同步
  - `packages/server/src/server/agent/providers/pi/{rpc-types,agent,history-mapper}.ts` — custom 消息映射为 custom_message 项，display=false 跳过
  - `packages/server/src/server/agent/providers/omp/{custom-message,agent,message-history}.ts` — 同构处理（advisor/system-notice 特例优先，fallback 落 custom_message）
  - `packages/server/src/server/session.ts` — `supportsTimelineItem` 门控接入新 cap
  - `packages/plugin/src/server/provider.ts` — ProviderTimelineItem union + schema 同步
  - `packages/client/src/daemon-client.ts` — hello 声明 `custom_timeline_messages`
  - `packages/app/src/types/stream.ts`、`components/message.tsx`、`agent-stream/{view,web-virtualization}`、`runtime/replica-cache/index.ts`、`plugins/timeline/projection.ts` — 新 `CustomMessageItem` + `CustomMessage` 卡片渲染 + 缓存/投影/高度估算
- 验证：provider 4 个测试文件 139 测试、app 3 个测试文件 96 测试、protocol zod-aot 回归 10 测试、selective-timeline-delivery e2e 7 测试全绿；`npm run typecheck` / `lint` / `format` 全过。
- codestable：`spec/agent-conversation.md` 的「对话时间线」小节补一句扩展 custom 消息的呈现约定。

顺手发现：`pi-vision` 的 `display: false` auto-analyze 消息以前会在 BySpace 里显示成正文，现在按 Pi 语义隐藏——这是行为修正，不是回归。
