---
kind: issue
title: "Desktop 左侧栏避让 macOS 红绿灯并统一为单一折叠入口"
type: ff
status: closed
created: 2026-08-26
---

# Desktop 左侧栏避让 macOS 红绿灯并统一为单一折叠入口

## 做了什么

1. 在 Electron 左侧栏顶部使用 Window Chrome safe area，为 macOS 红绿灯保留独立的 45px 标题栏区域；“BySpace”等首行产品入口从安全区下方开始。
2. 删除窗口级 `WindowSidebarMenuToggle`，只保留页面内容区 Header 中已有的折叠按钮，避免同一动作同时出现两个入口。
3. 为左侧栏顶部空白区保留 Electron drag region；进入全屏或非 macOS 平台时，safe area 继续由现有 Window Chrome obstruction 模型自动收敛。
4. 扩展 Electron CDP verifier：检查左侧首行不与红绿灯相交、可见折叠按钮恰好一个，且该按钮位于内容区而不是左侧栏标题栏。

## 为什么这样做

Paseo `v0.5.1` 同时提供窗口级和内容区两个左侧栏折叠入口。BySpace 明确选择单入口产品策略：用户只在当前页面内容 Header 操作左侧栏；macOS 顶部空间只负责原生窗口控制避让与窗口拖动，不再重复放置同一功能按钮。

## 改了哪些

- `packages/app/src/app/_layout.tsx` — 移除窗口级折叠按钮及其布局所有权。
- `packages/app/src/components/desktop-sidebar-layout.ts` — Window Chrome 布局只分配角落所有权，不再分配第二个 toggle owner。
- `packages/app/src/components/left-sidebar.tsx` — 在首行前加入 Window Chrome safe area 与 drag region。
- `packages/app/src/components/desktop-sidebar-layout.test.ts` — 固化“Chrome ownership 不创建第二个折叠入口”。
- `packages/desktop/scripts/verify-electron-cdp.mjs` — 增加真实 Electron 几何与单入口检查。

## 怎么验证的

- 聚焦单测先以旧实现失败，再在修改后通过：`desktop-sidebar-layout.test.ts` 3/3。
- App workspace typecheck、全 workspace typecheck、lint、format check 与 `git diff --check` 通过。
- App Web production export 与 macOS arm64 Desktop `.app`/ZIP/DMG build 通过。
- 最新 packaged macOS Electron CDP 实测：红绿灯占用区 `0,0,78×45`；左侧首行从 `y=53` 开始；唯一可见折叠按钮位于内容区 `x=324`；首行无相交；该按钮可关闭并重新打开左侧栏。
- 最新 packaged 截图：`/tmp/byspace-sidebar-packaged-shot/sidebar-window-chrome.png`。

## 对 `codestable/` 的影响

这是 BySpace 的长期 Desktop 产品决策，已同步到 Project Spec 与 Epic 005：后续上游同步不得恢复 Paseo 的窗口级 + 内容区双折叠入口。
