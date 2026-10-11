---
kind: issue
title: "Home workspace 与 Chief 角色：AgentRole 数据结构、自动工作区与提示词注入"
type: feature
created: 2026-10-10
---

# Home workspace 与 Chief 角色

## 目标与范围

让每台 daemon 自动拥有一个 "Home" workspace（directory 源指向 `~/.byspace`），其上可创建携带 **Chief** 角色的普通 agent 会话；Chief 的系统提示词通过角色注入，不写 cwd 文件。

包含：`AgentRole` 数据结构与协议字段；daemon 侧 Home workspace 的自动确保；角色提示词复用 `appendSystemPrompt` 注入管道并按会话收窄作用域；内嵌 Chief 提示词初版。

不包含：浮窗 UI（issue 002）、开场建议（003）、自定义角色 UI、多对话。

## 现状怎么工作

- `workspace.create` 已支持 `source: { kind: "directory", path, projectId? }`（`packages/protocol/src/messages.ts` WorkspaceCreateRequestSchema）——不挂 project 的目录工作区零新模型。
- 提示词注入管道：host 设置页 `appendSystemPrompt` → daemon config → 注入该 daemon 所有 agent（`packages/app/src/screens/settings/host-page.tsx` AppendSystemPromptCard）。本 issue 的差异仅在作用域：从「所有 agent」收窄到「带角色的会话」。
- daemon 注入 agent 的 byspace-tools（`packages/server/src/server/agent/tools/`）与 `byspace` CLI 是 Chief 观察/操作 daemon 的现成手段，本 issue 不扩展它们。

## 方案要点

- `AgentRole`：`{ name, description, systemPrompt }`，Chief 为第一个内建角色，提示词内嵌 daemon（发版即全体生效）。结构按可扩展设计，但不做用户自定义界面。
- 协议：agent 创建请求可携带角色标识；新字段 optional，遵守 protocol 兼容规则。
- Home workspace：daemon 自动确保存在（幂等；Multica 的教训是按「会话真的可用」而非「记录已建」判断完成）。列表中可见、可置顶，不做隐藏。
- Chief 提示词初版以 `byissue/talks/007-chief-floating-assistant.md` 中的草案为准，三段：角色行 / Working model（目标驱动自己路由；`~/.byspace` 只读为主改动先问）/ Collaboration（普通操作视为授权，破坏性先确认；可以承诺跟进——schedule/heartbeat 能叫醒）。

## 验证

- 干净 daemon 启动后 Home workspace 自动出现且指向 `~/.byspace`。
- 在其上创建的 Chief 会话带有角色提示词（可从 agent 行为或注入日志验证）；同 daemon 其他会话不受 Chief 提示词影响；`appendSystemPrompt` 全局设置仍然生效且两者可叠加。
- 旧客户端连接新 daemon 不炸（协议兼容）。

## 执行记录

**改了什么、为何。**

- `packages/protocol/src/messages.ts`：`AgentSessionConfigSchema` 加 `role: z.string().optional()`。只传名字不传提示词文本，daemon 解析注册表。
- `packages/server/src/server/agent/agent-roles.ts`（新）：内嵌角色注册表，Chief 角色 + 提示词。`getAgentRole` 对未知名字返回 null（静默降级），`AGENT_ROLE_LABEL = "byspace.agent-role"`。
- `packages/server/src/server/agent/agent-manager.ts`：`applyDaemonAppendSystemPrompt` 在 daemon 全局提示词后追加角色提示词；`createAgentInternal` 把已解析的角色名写入 agent labels（未知角色不写 label、不注入提示词）。
- `packages/server/src/server/agent/agent-sdk-types.ts`：`AgentSessionConfig.role` 字段。
- `packages/server/src/server/agent/agent-storage.ts`：`SERIALIZABLE_CONFIG_SCHEMA` 加 `role`；`SerializableAgentConfig` Pick 列表加 `"role"`。
- `packages/server/src/server/agent/agent-projections.ts`：`buildSerializableConfig` 加 `role` 持久化。
- `packages/server/src/server/home-workspace.ts`（新）：`ensureHomeWorkspace`，按 cwd 查重、失败降级为 warn 不阻塞启动。
- `packages/server/src/server/bootstrap.ts`：daemon 启动时调用 `ensureHomeWorkspace`。

**关键设计决策。** 角色提示词不持久化文本——每次启动从注册表重新解析，daemon 升级即生效。角色 label 只在创建时写入，不回流到 config，避免重复注入。

**验证。**

- `agent-manager.test.ts`：189/189 通过，含 3 个新用例——角色提示词追加在 daemon 提示词之后、无角色 agent 不受影响、未知角色静默降级。
- `home-workspace.test.ts`：3/3 通过——首次创建、幂等复用、provisioning 失败降级。
- `messages.wire-compat.test.ts`：协议兼容通过。
- `agent-storage.test.ts` + `agent-projections.test.ts`：37/37 通过。
- typecheck 0 error，lint 0 warning，format 通过。

**与设计偏差。** 无。

## 关闭结论（2026-10-10）

交付关闭。目标达成：AgentRole 数据结构、Chief 角色提示词注入、Home workspace 自动确保，验证证据见上方执行记录（agent-manager 189/189、home-workspace 3/3、wire-compat 36/36）。

沉淀：「新增 AgentSessionConfig 字段三处登记」坑点 → `byissue/notes/010-agentsessionconfig-field-three-registries.md`。其余毕业候选（glossary、workspace spec、agent-conversation spec）按原计划等 002/003 交付、用户可见行为定型后随 Epic 关闭一并回写，避免写两遍。

遗留：无。002（FAB + 浮窗）是下一刀。
