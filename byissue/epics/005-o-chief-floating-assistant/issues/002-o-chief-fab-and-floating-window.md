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
