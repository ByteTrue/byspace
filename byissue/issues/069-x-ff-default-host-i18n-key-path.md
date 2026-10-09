---
kind: issue
title: "修正 defaultHost 设置的 i18n key 路径错位（sidebar.project → settings.project）"
type: ff
created: 2026-10-06
---

# 修正 defaultHost 设置的 i18n key 路径错位（sidebar.project → settings.project）

## 预期与实际

预期：Project 设置里"默认 Host"分区显示翻译文本（`settings.project.defaultHost.{label,automatic,hint,saveFailed}`）。

实际：设置页显示原始 key `settings.project.defaultHost.label`。

## 根因

062 添加 i18n 时把 `defaultHost` 块插进了 `sidebar.project`（zh-CN.ts:1088 等），而屏幕读取的是 `settings.project.defaultHost.*`（project-settings-screen.tsx:213-225）。key 路径错位，9 个 locale 全部同样错挂，所以跨 locale 校验（如有）也查不出来。

## 改了哪些

- packages/app/src/i18n/resources/{ar,en,es,fr,ja,ko,pt-BR,ru,zh-CN}.ts：`defaultHost` 块从 `sidebar.project` 移至 `settings.project`（仅移动，文案不变）。

## 怎么验证的

- 脚本断言：每个 locale 恰好 1 处 `defaultHost: {` 且位于 `settings:` 块内；`sidebar.project` 无空壳残留。
- `npm run typecheck` 全 workspace 通过；lint 0/0；`format:files` 已格式化。

## 对 byissue/ 的影响

无既有真相失效。068 的"现状"提到 host 项已存在，其 i18n 由本条修正。
