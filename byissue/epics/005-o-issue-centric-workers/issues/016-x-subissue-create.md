---
kind: issue
title: 子 issue 创建面（CLI + UI 入口）；附件面 defer
type: feature
status: closed
created: 2026-09-29
---

# 子 issue 创建面（CLI + UI 入口）；附件面 defer

> **读者：** 接手的人——子 issue 从哪建、父的继承语义、附件为何 defer。

## 源语义

创建带 parent_issue_id 即子；源 UI 在 issue 详情的 sub-issues 段有 "Add sub-issue"（开创建模态带父预选）。父的 status 变更是否级联子：源**不级联**（子独立生命周期，仅展示分组）—— 我们的 updateIssueStatus 也不动子，天然一致，记此。

## 翻译

- CLI：`issue create --parent <id>`（字段已有，暴露之）；
- UI：详情 Sub-issues 段加 "+ Sub-issue" 行 → 内联单行标题输入（复用 composer 姿势），创建带 parentIssueId 与 status=backlog，成功后刷新 children；
- 附件面 defer：attachment 行的 url 需要文件存储+静态服务基础设施（源是对象存储/MinIO 圈），不在域内；硬挂 url 字段会造空壳。记 defer 连同基础设施诉求。

## 验证

- 真机：UI 建子 → 父详情 Sub-issues 两行（含新子）；CLI 建子带 --parent；改父 status 子不动。

## 执行记录

- CLI：issue create 增 --parent（client 字段本就透传，只暴露命令面）。
- UI：详情 Sub-issues 段下内联一行（单行标题输入 + Add），创建带 parentIssueId、默认 backlog，成功即刷新 children（refreshIssue）。
- 真机：CLI 建 #9、UI 建 #10，父详情两行同现；父 status 改 in_review 后两子仍 backlog —— 源的不级联语义成立（我们本就没写级联，此验是确认非实现）。
- 附件面 defer：attachment 行的 url 需要文件存储+静态服务基础设施（源为对象存储圈），域外；硬挂 url 即空壳。连带 task_id 列的投递语义一起记。

## 关闭回写

- parity-audit 子 issue 行更新；附件行记 defer 理由。
