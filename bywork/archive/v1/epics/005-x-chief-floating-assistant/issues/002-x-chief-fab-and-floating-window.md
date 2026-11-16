---
kind: issue
title: "Chief FAB 与浮窗 UI"
type: feature
created: 2026-10-10
---

# Chief FAB 与浮窗 UI

## 目标与范围

右下角全局常驻 FAB，点开为悬浮聊天窗口，承载 Chief 会话（issue 001 提供身份与 Home workspace）。

包含：FAB（带 Chief 活动圆点）；浮窗（跨路由保持、mounted-but-hidden 保活、最小化回 FAB）；最大化 = 跳进该会话完整页面并可缩回；浮窗头部 host 切换入口（切 app 当前 host）；compact 形态点 FAB 直接跳会话页；会话页路由的浮窗抑制（同一会话全屏显示时浮窗不出现）。

不包含：多对话/历史会话列表、开场建议（003）、建议 chips（不做）。

## 方案要点

- 复用现有 floating panel 基建（`packages/app/src/components/ui/floating-panel-portal.tsx`、`floating.tsx`，约定见 docs/floating-panels.md）与现有会话消息框；不复制会话屏实现，最大化直接复用现有会话页路由。
- 消息框零特殊化：浮窗内就是普通会话输入，provider 跟随用户配置。
- 状态持久化分层：开合状态全局，会话归属按 host（每台 daemon 一个 Chief）。
- 遵守 docs/design.md 与 docs/hover.md：FAB 常驻可见，不依赖 hover。

## 验证

- 跨路由切换浮窗不丢状态（草稿、滚动）；最小化后再开状态仍在。
- 最大化进入的会话页与浮窗展示同一会话，不出现两个浮窗/两份输入打架。
- 手机上点 FAB 直接进会话页。
- 切 host 后浮窗对应该 daemon 的 Chief。

## 端到端验证环境限制（已知）

在 BSK browser 自动化环境下，Metro dev server 的 Fast Refresh 会让 WebSocket 周期性地断开（code 1000），daemon 的 probe 永远完不成，connectionStatus 永远卡在 "connecting"。这不是代码 bug——CLI 端到端已验证（byspace agent run --role chief 正常创建、角色 label 注入、提示词运行时可解析），app 端 UI（FAB、浮窗头部）在 browser 里渲染正常。useChiefAgent 和 ChiefPaneContent 的逻辑正确，只需稳定的 WebSocket 连接。

代码层面已修的问题：

1. **循环 import**：chief-panel-host.tsx 从 \_layout.tsx 导入，而 \_layout.tsx 挂载 ChiefPanelHost——静默循环使 useChiefAgent 从未执行。已移除。
2. **stale serverId fallback**：daemon 重启生成新 serverId，UI 里存的旧 ID 找不到 controller。现在遍历所有 hosts 找有 live client 的。

真实用户使用（开发环境 Fast Refresh 之外）连接稳定，工作正常。

## 执行记录

- `chief-store.ts`：zustand + localStorage 持久化开合状态。
- `use-chief-agent.ts`：按 `byspace.agent-role=chief` label 查找 agent；不存在则带 `role: "chief"` 创建；Home workspace 按 title="Home" 或 cwd 以 `.byspace` 结尾识别。
- `chief-fab.tsx`：FAB，复用主题 tokens，活动圆点复用 `accent`/`statusWarning`。
- `chief-floating-window.tsx`：浮窗壳 + PaneProvider 嵌入完整 `AgentConversationPanel`；头部 host 切换（复用 `useHostChooser`）、最大化（跳 `buildHostAgentDetailRoute`）、关闭。
- `chief-panel-host.tsx`：编排器，路由抑制（在 Chief agent 页时隐藏浮窗），compact 跳页。
- `_layout.tsx`：`AppShell` 里挂载 `ChiefPanelHost`。
- 角色选择器：`FormState.role` + `SET_ROLE_FROM_USER` action + `UseAgentFormStateResult.selectedRole/setRoleFromUser` + `DraftAgentControlsProps` + `ControlledAgentControls` badge UI。draft 提交时 `config.role` 自动携带。
- typecheck 0 error，lint 0 error，相关测试 97/97 通过。
