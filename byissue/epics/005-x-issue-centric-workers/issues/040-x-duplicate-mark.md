---
kind: issue
title: duplicate 标记（源 MUL-7349）：mark 写、三层拒、清标记路径
type: feature
status: closed
created: 2026-09-29
---

# duplicate 标记（源 MUL-7349）：mark 写、三层拒、清标记路径

> **读者：** 接手的人——duplicate_of_issue_id 列从 536/537 搬来，读写行为全无。

## 源语义（issue_duplicate.go + 536 迁移注释）

- mark 走 UpdateIssue 一次 status 写：带 duplicate_of_issue_id 的请求强制 status=cancelled（或本来就给 cancelled）；**没有 duplicate 状态**，重复就是记住原 issue 的已取消 issue。
- 三层拒（锁两行后验）：目标不存在 400；目标自身是 duplicate 409（该标向它的原）；自己已被别人标 409（先清那些）。
- 标记只活在 cancelled：离开 cancelled 的写清掉（reopen 即取消标记，再 cancel 不复活）；删原 issue 同事务清指向它的标记（无 FK，仓库规则）。
- 读面：duplicate_of 只在"已取消且原 issue 存在"时渲染，否则 null。

## 收法

- store：issue.update 增 duplicateOf 可选字段——出现即强制 status=cancelled 路径 + 三层验（目标存在、目标非 duplicate、自身无人指向）+ 离开 cancelled 的写在同 UPDATE 里清列（源同句）。
- deleteIssue 前清指向被删 issue 的标记（同事务）。
- summary 带 duplicateOf（读面同源：仅 cancelled+原存在时非 null）。
- CLI：issue update --duplicate-of <id>；UI：详情页属性段 "Duplicate of #N" 行 + mark 入口（cancelled 状态下的行内操作，无模态——同 033/038 偏离记）。

## 验证

- 单测：mark 强制 cancelled、三拒、reopen 清、删原清、读面 null 两形；
- 真机：标两个 issue 重复 → 详情见 "Duplicate of"→ 拒链式 mark → reopen 后标记消失。

## 执行记录

- store：updateIssue 增 duplicateOf——mark 强制 cancelled + 三验（自引用/目标不存在、目标自身 duplicate、自身已被指向）；离开 cancelled 的写在同 UPDATE 清列；deleteIssue 前同事务清指向被删原的标记。4 单测（mark 语义、三拒、reopen 清+再 cancel 不复活、删原 detach）。
- 读面 liveDuplicateOf：仅 cancelled 且原存在时非 null。
- RPC/summary/CLI(--duplicate-of)/UI（属性段 Duplicate of 行：已标=chip "reopen to clear"（点击=reopen 即移除，源语义）；未标=行内 mark 输入）。
- **断点教训（第 5 处 client 透传漏）**：client 的 multicaIssueUpdate 是逐字段构造 message，我加了 options 类型却漏了 message 字段行——CLI 一直静默不 mark。自引用探针（应抛）一次定位。已加进 notes/004 模式族。
