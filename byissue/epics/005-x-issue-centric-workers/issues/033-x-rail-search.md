---
kind: issue
title: rail 搜索行（源 ⌘K 的无对话框翻译）
type: feature
status: closed
created: 2026-09-29
---

# rail 搜索行（源 ⌘K 的无对话框翻译）

## 源形

nav 顶 Search… 行带 ⌘K 快捷键，打开 cmdk 命令面板（search-command.tsx），跨 issues/agents/…分组过滤跳转。

## 偏离（记，不改）

仓无对话框机制（唯一 overlay 是 bottom sheet），cmdk 面板不引入——为一个搜索面引 overlay 机制是机制债。翻译为**rail 内联搜索**：输入即过滤，结果列表（issues 前六+agents/squads 前四）列在搜索框下，点击跳详情，跳转后清空。同一可达性，少一个机制。⌘K 键盘绑定在 web 壳可做但 RN 面无键盘事件面，defer。

## 执行记录

- multica-nav.tsx：rail 顶搜索框+RailSearchResults（issue 标题/agent 名/squad 名前缀包含，大小写不敏）；行组件各自 useCallback（仓规禁 JSX 回调内联 lambda）。
- 真机：搜 "release" 出三条 issue 带 #编号；搜 "writer" 出 Writer agent；无匹配显示 No matches。
