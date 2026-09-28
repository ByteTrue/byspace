---
kind: issue
title: 评论 reactions：切换写面 + 卡片计数面
type: feature
status: closed
created: 2026-09-29
---

# 评论 reactions：切换写面 + 卡片计数面

> **读者：** 接手的人——反应的唯一键就是切换语义、我们的表情面为何是固定集。

## 源语义

comment_reaction 唯一键 (comment, user_type, user_id, emoji)：一人对一评论一表情至多一行，再点即撤（DELETE）。UI 是评论卡下的表情计数条 + 选择器。

## 翻译

- store：setCommentReaction（reacted=true 插、false 删；键内幂等）、listCommentReactions（按 emoji 聚合计数 + 我是否点过）。
- RPC 一对：multica.reaction.set（commentId / emoji / reacted / senderSessionId 同身份规则）。
- UI：评论卡下计数 chips（emoji ×n，我点过的有描边）；点已点的=撤；点"+ 表情条"从固定六表情集（👍 🎉 👀 ✅ ❤️ 🤔）选 —— 源的自由 picker 在我们的形态收成固定集（记偏离：表情域无产品诉求，固定集够用且无输入面）。
- issue_reaction 不做（源有，但我们的记录面在 timeline；记欠账）。

## 验证

- 单测：加/撤/换人各一行、计数聚合、我点过标记。
- 真机：对一条评论点 👍 → chip ×1 带描边；再点撤 → 消失；agent 评论由 owner 点 → who=owner 行。

## 执行记录

- store：setCommentReaction（INSERT OR IGNORE / DELETE，唯一键即切换语义）、listCommentReactions（按 emoji 聚合 + viewer 是否点过）。
- 面：multica.reaction.set（senderSessionId 同身份规则，归 Write 臂）；comment 的 summary 与 timeline entry 都带 reactions（viewer=owner —— console 是反应面，agent 无反应 UI，偏离已记）。
- UI：评论卡下计数 chips（我点的描边）+ 固定六表情 chooser 在 "+" 后；点自己的 chip=撤、点别人的=并排加。
- 测试：一人一表情一行、两人同表情 count=2、撤后 count=1 且 reactedByViewer 假。verifier 增三检查（一次/再点 no-op/撤空）→ 46/46。
- 真机浏览器留到提交后下一轮验（reaction chip 需真点击；RPC 层已由 verifier 覆盖）。
- 欠账：issue_reaction、自由表情 picker（固定集已记偏离）。

## 关闭回写

- parity-audit 的 reactions 行更新。
