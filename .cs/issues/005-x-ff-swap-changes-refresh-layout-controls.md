---
kind: issue
title: "调整 Changes 面板刷新/布局入口顺序"
type: ff
status: closed
created: 2026-07-23
epic: ""
---

# 调整 Changes 面板刷新/布局入口顺序

## 做了什么

把 Changes 面板高频使用的刷新操作提到工具栏一级按钮位置；原来的 Side-by-side 布局切换改收到更多选项菜单里。

## 改了哪些

- `packages/app/src/git/diff-pane.tsx` — 新增工具栏刷新按钮组件；支持刷新时显示 loading；在支持 checkout refresh 的主机上把布局切换入口移入 options 菜单，实现与刷新入口对调。

## 怎么验证的

跑 `npm run format:files -- packages/app/src/git/diff-pane.tsx .cs/issues/005-x-ff-swap-changes-refresh-layout-controls.md`、`npm run format:check:files -- packages/app/src/git/diff-pane.tsx .cs/issues/005-x-ff-swap-changes-refresh-layout-controls.md`、`npm run lint -- packages/app/src/git/diff-pane.tsx`、`npm run typecheck`。

## 对 .cs/ 的影响

无已记录真相受影响；这是 Changes 面板工具栏入口顺序的局部交互调整。
