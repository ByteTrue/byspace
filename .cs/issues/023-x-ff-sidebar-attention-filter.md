---
kind: issue
title: "侧栏去掉 attention 浮顶，改为「待处理」过滤按钮"
type: ff
status: closed
created: 2026-08-07
---

# 侧栏去掉 attention 浮顶，改为「待处理」过滤按钮

## 做了什么

022 保留了「需关注浮顶」，但浮顶在用户点击处理的那一刻状态变化、行掉回原位——自动重排固有的跳变，无法靠参数解决。本轮把位置彻底稳定下来，注意力改用「原位徽章 + 主动过滤」表达：

- `sidebar-projection.ts` — 删除 attention 分组/浮顶，顺序 100% 输入序；新增 `attentionOnly` 入参：开启时只保留需关注 Workspace，无关注项的 Project 整体隐藏；`needsAttentionWorkspaceCount` 供按钮徽章。
- `sidebar-view-store.ts` — 新增会话级 `attentionOnly` + `setAttentionOnly`（不持久化，重启默认关，避免打开应用看到残缺列表）。
- `left-sidebar.tsx` — Workspaces 标题栏新增 过滤按钮（带计数徽章，激活琥珀色，testID `sidebar-needs-attention-filter`）。
- `sidebar-workspace-list.tsx` — 删除 Needs attention / Other projects 两个分组标题与切片逻辑；过滤开启且无待处理时显示「当前没有需要你处理的会话」空态。
- `sidebar-model.tsx` — 模型改为单一 projects 列表 + needsAttentionWorkspaceCount。
- i18n 8 语言：新增 `sidebar.actions.needsAttentionFilter` / `emptyAttention`，删除已无用的 `sections.needsAttention` / `sections.otherProjects`。
- e2e `sidebar-model-b.spec.ts` 断言改为过滤按钮计数。

## 改了哪些

见上；`sidebar-projection.test.ts` 重写为稳定序 + attentionOnly 过滤两组断言。

## 怎么验证

- 6 个相关测试文件 51/51 过；`npm run typecheck` / `lint` / `format:check` 全绿。
- 待人工验收：处理需关注会话时行不再跳动；⚠ 按钮开关只切换视图、不引起其余重排。

## 对 `.cs/` 的影响

`.cs/spec/index.md` 侧栏章节已同步：状态只做原位表达、不参与排序；过滤是用户主动视图切换。
