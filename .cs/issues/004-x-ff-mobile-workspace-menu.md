---
kind: issue
title: "手机端工作区菜单可见性"
type: ff
status: closed
created: 2026-07-23
epic: ""
---

# 手机端工作区菜单可见性

## 做了什么

让紧凑布局下的工作区行始终显示三点菜单入口，这样手机端不需要 hover 也能点开二级菜单。

## 改了哪些

- `packages/app/src/components/sidebar-workspace-list.tsx` — 工作区行右侧操作区把 compact breakpoint 也视为无 hover 场景，手机端直接显示 kebab。
- `packages/app/e2e/sidebar-workspace.spec.ts` — 补了紧凑布局下无需 hover 也能打开工作区菜单的回归用例。
- `packages/app/e2e/helpers/sidebar.ts` — 侧边栏菜单 helper 兼容「compact 直接可见 / 宽屏 hover 显示」两种触发方式。

## 怎么验证的

定向 Playwright：`npm run test:e2e --workspace=@bytetrue/byspace-app -- sidebar-workspace.spec.ts --grep "shows the workspace menu trigger without hover in compact layout"`；随后跑过 `npm run typecheck`、`npm run lint`。

## 对 .cs/ 的影响

无已记录真相受影响；这是现有工作区列表在 compact Web 布局下的交互修复。
