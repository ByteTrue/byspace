---
kind: note
title: "新增 AgentSessionConfig 字段必须在三处登记，否则持久化静默丢失"
created: 2026-10-10
---

# 新增 AgentSessionConfig 字段必须在三处登记

在 Epic 005 issue 001 中加 `role` 字段时踩到：agent 创建时一切正常（提示词注入了），但 daemon 重启 / resume 后字段消失，测试才暴露。

原因：持久化链路有两道显式白名单，编译器都不会报错——

1. `packages/server/src/server/agent/agent-sdk-types.ts` — `AgentSessionConfig` 接口加字段（这层有编译器管）。
2. `packages/server/src/server/agent/agent-storage.ts` — `SERIALIZABLE_CONFIG_SCHEMA`（zod）和 `SerializableAgentConfig`（Pick 列表）都要加。
3. `packages/server/src/server/agent/agent-projections.ts` — `buildSerializableConfig` 逐字段 if 拷贝，不加就被丢。

如果要随 wire 传递，另加 `packages/protocol/src/messages.ts` 的 `AgentSessionConfigSchema`。

判断要不要持久化文本的先例：`daemonAppendSystemPrompt` 故意不持久化（每次启动从 daemon 设置重算），`role` 只持久化名字、提示词文本每次启动从角色注册表重解析（`agent-roles.ts`）。新字段先想清楚属于哪一类，再决定进不进白名单。

验证手段：`agent-manager.test.ts` 里「createAgent 后读 record.config」的用例会在字段丢失时失败——新字段照抄 role 的三个测试即可。
