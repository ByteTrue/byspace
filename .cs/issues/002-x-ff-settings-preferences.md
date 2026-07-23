---
kind: issue
title: "整合 App 偏好设置"
type: ff
status: closed
created: 2026-07-23
epic: ""
---

# 整合 App 偏好设置

## 做了什么

将 App 设置一级导航收敛为 Preferences、Projects、About；Preferences 聚合 General、Appearance、Diagnostics，不保留旧入口的专门兼容逻辑。

## 改了哪些

- `packages/app/src/screens/settings-screen.tsx` — 合并侧栏入口与页面内容。
- `packages/app/src/utils/host-routes.ts` — 更新默认设置路由。
- `packages/app/src/i18n/resources/` — 补齐八种语言的 Preferences 文案。
- `packages/app/e2e/` — 更新导航、国际化与字体设置路径测试。

## 怎么验证的

定向单测与 Playwright 场景通过；全仓 typecheck/lint、目标文件 format check、App Web export 通过。

## 对 .cs/ 的影响

无 project/epic spec 受影响；已将确认的信息架构记录到 `.cs/talks/001-app-settings-information-architecture.md`。
