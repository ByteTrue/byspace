---
kind: issue
title: "优化会话输入区控件布局"
type: ff
status: closed
created: 2026-08-04
epic: ""
---

# 优化会话输入区控件布局

## 做了什么

弱化会话内容区的折叠与回到底部操作，并将移动端上下文用量并入输入框工具栏，避免额外占行。

## 改了哪些

- `packages/app/src/panels/agent-panel.tsx` — 将两个纵向悬浮圆钮改为输入框上方的紧凑按钮组。
- `packages/app/src/composer/index.tsx` — 统一上下文用量位置并收回侧边按钮预留空间。

## 怎么验证的

通过全仓 typecheck、lint 与 App Web export；在 1200×900 和 390×844 真实 Web 视口验证布局、折叠及回到底部交互。

## 对 .cs/ 的影响

- 无已记录真相受影响；这是现有会话操作的纯展示层优化。
