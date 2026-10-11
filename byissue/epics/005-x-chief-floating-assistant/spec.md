---
kind: epic
title: "Chief — 全局悬浮助理"
created: 2026-10-10
---

# Chief — 全局悬浮助理

> **读者：** 在这条变化里对齐的人。讨论全程见 `byissue/talks/007-chief-floating-assistant.md`。

## 要改变什么

在 app 右下角加一个全局常驻的 FAB，点开是一个悬浮聊天窗口，里面是一个名为 **Chief** 的内建角色会话。Chief 是用户在 BySpace 的管家与统一入口：快速问答直接聊，需要动仓库、跑多步的工作由它通过自己的工具与 CLI 去驱动其他 workspace 的 agent。不用添加项目、不用配置（选了 provider 即可用），开箱就在。

## 为何现在做

- Multica 验证了这个形态（浮窗 + Chief of Staff），用户带着截图与 fork 源码来提。
- 前置条件已在位：`workspace.create` 支持 `kind: "directory"` + 可选 `projectId`；daemon 注入 agent 的 byspace-tools 有编排原语；CLI 命令面齐全；前端有 floating panel 基建。
- 与已放弃的 026（跨 workspace 编排）是同一个终态，但走「普通 agent 会话 + 角色」路径，daemon 不持有编排状态，绕开其死因。

## 当前方案

**实体**：浮窗里是一个普通结构化会话，挂在 daemon 自动确保的 "Home" workspace（directory 源指向 `~/.byspace`）上。出现在 workspace 列表、可置顶，无隐藏、无特殊工作区概念。时间线、通知、持久化、移动端全部复用。

**角色**：引入 `AgentRole` 数据结构（name、description、systemPrompt），Chief 是第一个内建角色，提示词内嵌于 daemon（发版即热更新）。协议层 agent 创建可携带角色；daemon 复用 `appendSystemPrompt` 的注入管道，把作用域从「该 daemon 所有 agent」收窄为「带角色的会话」。不做自定义角色的设置 UI——结构可扩展，UI 等需求验证。

**Chief 提示词**（三段结构，以 talks/007 草案为准继续磨）：角色行（BySpace 内建助理、唯一对话入口）→ Working model（用户带目标不带路由决策；能一轮答完的直接答，需要仓库/多步的用 CLI 和注入工具去做；`~/.byspace` 只读为主，改动前先问）→ Collaboration（清晰请求即普通操作的授权；破坏性、发布、花费先预览确认；**可以承诺跟进**——用 schedule/heartbeat 叫醒自己，这是对 Multica "never promise to report back" 的反转与差异化）。

**浮窗 UI**：全局悬浮层、跨路由保持、mounted-but-hidden 保活（Multica 模式）；最大化 = 跳进该会话的完整页面（可缩回），不做大浮窗；compact 形态（手机）点 FAB 直接跳会话页。FAB 带 Chief 会话的活动圆点，复用现有圆点语义。浮窗头部提供 host 切换入口——切的是 app 的当前 host，浮窗永远属于当前 daemon；每台 daemon 一个 Chief。注意现有会话页路由的抑制逻辑（同一会话全屏显示时不出现浮窗）。

**Provider**：跟随用户配置，不固定；消息框复用现有会话消息框；提示词按「任何 provider 都能跑」写，不依赖 provider 独有扩展。

**开场**：空状态下三条写死的建议按钮，点击即发送；不做自定义配置；不做 Multica 那种每轮后的 LLM 建议 chips（用户明确不做）。

## 架构与质量取舍

- **daemon 永不持有编排状态。** Chief 的跟进逻辑、记忆、待办活在它自己的会话里；schedule/heartbeat 是会话级机制。这是本方向与 026 的分界线，也是后续所有演进的护栏。
- **借结构不搬文本。** Multica License 禁止把代码与提示词文本用于第三方产品；本 Epic 只吸收其架构模式（通用浮窗面 + 角色身份、三层提示词组装、服务端开场消息、mounted-but-hidden、路由抑制）。
- **有界简化：** 第一刀一个持续会话（不多对话/历史列表）、固定三条开场建议、Home workspace 无写保护沙箱、不做自定义角色 UI。升级触发：用户对多对话或自定义角色的需求真实出现时，模型均已预留扩展点。

## 统一语言

- **Chief**：BySpace 内建助理角色，每台 daemon 一个，用户与全系统对接的单一入口。
- **Home workspace**：自动创建的 directory 工作区，cwd 为 `~/.byspace`，承载 Chief 会话。
- **AgentRole**：命名的角色实体（name / description / systemPrompt），创建 agent 时携带。

## 推进视图

可推进（同目录 `issues/`）：

- `issues/001-x-home-workspace-and-chief-role.md` — **已交付。** AgentRole 数据结构、Chief 提示词注入（复用 appendSystemPrompt 管道按角色追加）、Home workspace 自动确保。关键决策：只持久化角色名不持久化提示词文本，daemon 升级即热更新；未知角色静默降级。
- `issues/002-o-chief-fab-and-floating-window.md` — FAB + 浮窗 UI（app）
- `issues/003-o-chief-opening-suggestions.md` — 开场三条建议 + 空状态（app）

切片 1 不依赖切片 2（会话可从列表正常使用）；2 依赖 1 提供的 Chief 身份与 Home workspace；3 依赖 2。

**暂不推进**：建议 chips、多对话、自定义角色 UI、heartbeat 主动巡视、跨 daemon 编排。

**关闭条件**：三切片交付，用户在干净的 daemon 上什么都不配置即可从 FAB 与 Chief 对话，且 Chief 能用 CLI/注入工具观察与操作同 daemon 的 workspace。

**合并候选**：`byissue/spec/workspace.md`（Home workspace）、`byissue/spec/agent-conversation.md`（角色与注入）、glossary（Chief / Home workspace / AgentRole）。

**关闭时检查的 Vision 区域**：vision 的「用户怎样获得结果」需增加 Chief 入口旅程；「探索中或候选」不涉及。
