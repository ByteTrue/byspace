---
kind: issue
title: label 域：CRUD + issue 贴标 + 卡片点行与过滤 chips
type: feature
status: closed
created: 2026-09-29
---

# label 域：CRUD + issue 贴标 + 卡片点行与过滤 chips

> **读者：** 接手的人——label 的三面（管理/贴标/过滤）与 resource_type 的取舍。

## 源语义

issue_label（name+color，resource_type 三值 issue/agent/skill）+ issue_to_label（多对多，键即关系）。UI：label 管理面、issue 详情的 label 编辑、卡片的色点行、过滤 chips 的 label 组。

## 翻译（issue 域内）

- store：label 的 create/list、issue 的 setLabels（全量替换，键内幂等）/listLabelsForIssue；
- RPC 三对：multica.label.list / multica.label.create / multica.issue.labels.set（issueId + labelIds 全量）；
- UI：卡片下色点行（hover 无名，点行带 title 属性不可得——RN 无 title；点色点不做交互，仅视觉）；详情 Properties 增 Labels 段（已有 label 可摘、未贴可选）；board 过滤 chips 增 label 组（与 status/priority/assignee 同 AND 语义）。
- resource_type 的 agent/skill 两值不做（两域的 label 面在源亦属配置面）；label 管理页（改名/改色/删）不做——create 足够开面，改删记欠账。

## 验证

- 单测：set 全量替换语义、键内幂等、label 删除级联 unlink（FK CASCADE）。
- 真机：建两 label、给 #2 贴一、卡片见点、chips 过滤生效、详情摘掉后点消失。

## 执行记录

- store：createLabel/getLabel/listLabels、setIssueLabels（全量替换、BEGIN IMMEDIATE、INSERT OR IGNORE 键内幂等）、listLabelsForIssue（join 按名序）。
- RPC 三对：label.list / label.create / issue.labels.set（set 归 write 臂）；issue summary 与 get 都带 labels 数组。
- UI 三面：卡片色点行；详情 Labels 段（已贴带 × 摘、目录带 + 贴，set 写全量）；board 过滤 chips 增 label 组（AND 语义同其余）。
- **抓到的真缺陷（本轮最值得记的一条）**：四臂 dispatch 的 read 守卫链漏了 label.list —— 类型谓词含它、switch 含它、但运行时 `isReadMessage` 的 || 链没有它，于是读请求落进 write 臂被**静默吞掉**（无响应=客户端 60s 超时）。类型层对、运行层错的这类裂缝只有真发请求才暴露；探针先 create 通、list 超时即此。修守卫链并加注释"类型谓词独自会说谎"。
- 验证：22 store 测（含全量替换/幂等/清空）；verifier 49/49（增三检查）；真机：详情贴 probe label 见 ×、board chips 见该名、卡片点行由 issue labels 驱动。验证后清理 probe-\* label 残留。
- 欠账：label 管理页（改名/改色/删）、agent/skill 两 resource_type 的 label 面。

## 关闭回写

- parity-audit 的 label 行更新。
