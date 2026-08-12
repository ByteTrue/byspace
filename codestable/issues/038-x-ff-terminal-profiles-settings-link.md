---
kind: issue
title: "修正 Terminal profiles 设置入口"
type: ff
status: closed
created: 2026-08-11
---

# 修正 Terminal profiles 设置入口

New Workspace 的 “Manage terminal profiles” 现在直接打开当前 Host 的 Providers 设置，不再错误进入 Host 首页；Agents 与 Providers 继续保持独立页面。

- 改动：`packages/app/src/new-workspace-launch/launch-control.tsx` — 将入口目标改为 Host Providers route。
- 改动：`packages/app/e2e/new-workspace-entry.spec.ts` — 覆盖菜单入口与目标 URL。
- 验证：目标 Playwright 场景、全仓 typecheck、lint、目标文件格式化与 App Web export。
- codestable：无稳定真相变化；行为与 `codestable/talks/001-app-settings-information-architecture.md` 中 Agents / Providers 分离的信息架构一致。
