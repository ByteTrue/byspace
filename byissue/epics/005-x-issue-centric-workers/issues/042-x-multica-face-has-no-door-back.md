---
kind: issue
title: multica 面没有回 BySpace 的门（Owner 真机撞墙）
type: bug
status: closed
created: 2026-09-29
---

# multica 面没有回 BySpace 的门（Owner 真机撞墙）

> **读者：** 接手的人——026 建 nav rail 时照源抄了六入口，漏了源不存在的一个需求：源是独立应用，我们是 BySpace 里的第二张脸。

## 现象（Owner 2026-09-29 真机）

点 Agents 后左侧 BySpace 工作区栏不在（设计如此，026），但 multica rail 上没有任何回 BySpace 的口——浏览器后退是唯一出口。练习线 console 有 handleExit→router.replace("/")，026 建新 rail 时没带过来。

## 收法

rail 顶行 "← BySpace"（testID multica-nav-exit）→ router.replace("/")，交给应用自己的启动路由（记住的工作区或 open-project）。源无此物是偏离，理由：两张脸同一进程，门必须双向。

## 执行记录

- rail 首行 Pressable + ArrowLeft；真机：Agents 页点出口 → 落 /open-project（本浏览器无记住工作区时的 BySpace 正常面）；有记住工作区的浏览器会落回工作区（index 的启动路由语义）。
