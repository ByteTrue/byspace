---
kind: issue
title: 体验对齐审计：与 multica 交互面的逐条差距与修复
type: feature
status: closed
created: 2026-09-29
---

# 体验对齐审计：与 multica 交互面的逐条差距与修复

> **读者：** 接手的人——准出是"体验与 multica 基本一模一样"；本 issue 是差距账本与修复记录。

## 方法

docker 不可用（本机无 daemon），起源真服务对照不可行；改双侧核查：
① 我们 console 的全旅程实测（board/mine/rosters/autopilots/inbox/secretary/窄屏/console 错误计数）；
② 源码交互清单逐条比对（issues-header 的搜索与创建、issue-detail 的 TitleEditor/ContentEditor 与属性编辑、agents-page 的创建、squads-page 的创建、comment 的编辑/删除）。

## 差距清单（按体验影响排序）

1. **board 无 New issue 创建面**（源 onCreateIssue 带列默认值）—— 建 issue 是最基本动作，我们只有 CLI 与子 issue 行。
2. **详情无标题/描述编辑**（源 TitleEditor/ContentEditor 内联）。
3. **详情属性面 priority/assignee 只读**（源是下拉写面）。
4. **board 无搜索框**（源 issues-header 文本搜索；我们的 chips 只过滤枚举维度）。
5. **rosters 无 agent 创建表单**（源 agents-page 有；我们 CLI-only）。
6. **rosters 无 squad 创建表单**（源 squads-page 有；我们 CLI-only）。
7. **评论无编辑/删除**（源有；schema 的 deleted_at/recovery 列在，行为未接）。
8. 已记欠账面（泳道/label 管理/Token/webhook/附件/子树退订/键盘导航）—— 不在本批，理由见各条。

## 修复记录

1. **board New issue**：标题+描述+assignee chips+priority chips 一表单（status 默认 backlog，与源 onCreateIssue 同形）。真机建 #15 成立。
2. **搜索**：filterBar 首格文本框，title 包含匹配（大小写不敏），Clear 经 uncontrolled 同步清空（reset）。真机 "Parity" 过滤到单卡。
3. **详情写面**：标题/描述 click-to-edit（resting=渲染面含 markdown，press 开输入，blur 提交且仅当变化）；priority 五 chip、assignee 名册 chip+unassigned（写走 updateField）。
   - **真机抓到的缺陷**：连点 priority 再点 assignee，前一次写**静默丢**（乐观并发的 stale revision 被 catch 吞）。修：updateField 冲突时重读 revision 再写一次 —— 点击消失是比报错更坏的失败。
4. **rosters 创建面**：New agent（名一个字段，默认 private/local 由 store）与 New squad（名+leader chip）。真机建 Audit Bot（user/private）与 Audit crew（leader 行自动在 roster，014 修的源语义生效）。
5. **评论编辑/删除**：store editComment（revision+1）与 deleteComment（有回复=tombstone 清内容清反应、无回复=硬删级联）；读面不再过滤 tombstone（源的 timeline 显示墓碑，流是记录不是精选）；RPC 两对带作者守卫（owner 改 owner 的、run 改自己的，mismatch 拒）；UI 仅 owner 作者的评论出 edit/delete 控制（机制拒的面不 Offer）。verifier 增三检查（编辑 bump/陌生会话拒/删除落）→ 52/52。真机：编辑 rev 1→2、删除行消失。
   - React 的 onBlur 不吃合成 blur（委托 focusout）—— 真机验证改用 focusout 事件才触发提交；记入 notes 家族（同 uncontrolled 一族）。
6. 欠账面维持原判（泳道/label 管理/Token/webhook/附件/子树退订/键盘导航），理由见各条与毕业 spec。

## 结论

七条差距全修且逐条真机验过；体验面与源的交互清单（创建/搜索/内联编辑/属性写/评论修订）对齐。剩余差异都在毕业 spec 的"故意没有"清单里，带理由。

## 关闭回写

- parity-audit F 行更新；毕业 spec 的"故意没有"清单复核（编辑面不再列欠账）。
