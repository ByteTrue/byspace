---
kind: issue
title: 活动折叠块 + 子 issue 行内编辑（源 timeline 读感）
type: feature
status: closed
created: 2026-09-29
---

# 活动折叠块 + 子 issue 行内编辑（源 timeline 读感）

> **读者：** 接手的人——issue-detail 源的两个读感/写面差距。

## 源形（issue-detail.tsx 616-660 + 799）

- **活动块折叠**：连续 activity 成块；非尾块默认折成 "N activities" 一行（可展开）；尾块展开但只显示最近 8 条（LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT），更老折在 "Show N more activities" 行后（就地展开）。理由源注释写明：50 次状态翻转的块会淹没评论区。
- **子 issue 行内编辑**：子 issue 行带 inline status 与 assignee 编辑（不用跳详情页）。

## 我们原状

- activity 行平铺全显；
- 子 issue 行只是跳转按钮。

## 收法

- multica-activity-fold.ts 纯函数：groupActivityBlocks(entries)（连续 activity 成块、comment 断块）+ 每块的 visible/folded 划分（非尾块全折、尾块留 8）；单测四情形。
- UI：ActivityBlock 行（"N activities" 展开态切换）与尾块的 "Show N more"；子 issue 行加 status 菜单+assignee 菜单（复用 DropdownMenu 族），写走 updateField 同路（child 的 revision）。

## 验证

- 单测：块分组、尾块 8 上限、comment 断块、全 activity 单块；
- 真机：多翻转 issue 的流见折叠行与展开；子 issue 行内改 status 落库。

## 执行记录

- multica-activity-fold.ts：groupActivityBlocks（连续 activity 成块、comment 断块；非尾块全折、尾块留最近 8 条——LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT 照源常量）；4 单测。
- UI：buildStreamNodes 把流拆成 thread/block 两类渲染节点（块以首条目 id 为稳定身份）；ActivityBlockView 三态（折叠行"N activities"/展开/collapse、尾块 Show N more/hide）。展开与 show 都是本地态——折叠是投影非读。
- 子 issue 行内编辑：status 与 assignee 两个行内下拉（DropdownMenu 族），写走同 updateField 路（child 自己的 revision，冲突同静默重读重试继承）；行主区仍是跳详情按钮，两下拉在其右侧不抢主击区。
- 真机：#5 造 12 连续活动→尾块显 8 + "Show 4 more activities"→点开全见；子 issue 行内改 status→落库 in_review。
- 探针自记：CLI issue update 无 --expected-revision 旗（CLI 自管 revision，读-改-写自带）——我先前手传是错的假设，help 一查即明。
