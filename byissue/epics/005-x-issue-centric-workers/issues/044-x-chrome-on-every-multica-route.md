---
kind: issue
title: chrome 常驻：multica 全域保留 BySpace 侧栏（Owner：不要独立界面）
type: bug
status: closed
created: 2026-09-29
---

# chrome 常驻：multica 全域保留 BySpace 侧栏（Owner：不要独立界面）

> **读者：** 接手的人——026 的 chrome 判定只写了精确 `/multica`，子路由全丢侧栏；详情页连 rail 都没有。

## 现象（Owner 2026-09-29）

"不要再独立界面了，所有的界面都和 board 一样，左侧永远留着。"Agents 页左侧 BySpace 栏消失（042 的墙），issue/agent/squad/autopilot 详情页连 multica rail 都没有。

## 根因两处

1. `_layout.tsx` 的 shouldShowAppChrome 精确匹配 `/multica`——Board 有 chrome、其余子路由没有。
2. 五个详情页（issue/agent/squad/autopilot/inbox 组件内）从未套 MulticaShell——列表页套了、详情页漏了。

## 收法

- chrome 判定改 `pathname.startsWith("/multica")`（注释写明：multica 是 BySpace 的一张脸不是独立应用）。
- 五个详情页在路由边界套 MulticaShell（active 各自对齐 rail 项）；inbox 组件内部已套，路由层不双套。
- **042 的 "← BySpace" 出口行撤掉**：它是 chrome 缺失期的补丁；chrome 常驻后工作区侧栏本身就是出口，留补丁=第二扇门。

## 执行记录

- 真机六面（board/agents/inbox/autopilots/issue/agent）全部 sidebar+rail 双在、出口行无。
