---
kind: issue
title: 线程解析：resolve/unresolve 写面 + 时间线折叠（源 foldResolvedThreads）
type: feature
status: closed
created: 2026-09-29
---

# 线程解析：resolve/unresolve 写面 + 时间线折叠（源 foldResolvedThreads）

> **读者：** 接手的人——schema 的 resolved_at/resolved_by 三列在源是活行为（线程收口的语义），我们只躺列。

## 源语义（comment.go 708-780 + foldResolvedThreads 171-285）

- resolve：COALESCE 保首解（resolved_at/resolver 不覆盖），仅状态翻转时 revision+1；**墓碑不能是解析**（deleted 行拒）。
- unresolve：幂等清空，仅在原本已解析时 revision+1。
- 折叠（读侧 fold=true）：root 已解析→只留 root，folded=replies 数；某 reply 已解析→留 root+**最晚解析的那条**（结论），其余折；未解析→全留。
- UI：root 卡菜单 Resolve/Unresolve thread；折叠行有 "show replies" 拉回全量。

## 收法

- store：resolveComment/unresolveComment（同 COALESCE/幂等/墓碑拒语义）。
- RPC 一对带 resolved 旗（源两端点同 store 形的翻译）+ senderSessionId（归属同评论纪律）。
- timeline entry 加 resolvedAt（加性）。
- 纯函数 threadFold(entries)（源 foldResolvedThreads 的翻译）+ 单测三情形；CommentThread 渲染折叠态 + "N folded · show" 拉全（本地态）。

## 验证

- 单测：resolve 保首解不覆盖、unresolve 幂等不 bump、墓碑拒、折叠三情形；
- 真机：resolve 后流只留 root+标注，show 拉全，unresolve 还原。

## 执行记录

- store：resolveComment（COALESCE 保首解、仅翻转时 revision+1、墓碑拒）与 unresolveComment（幂等不 bump）——源 comment.go 708-780 逐句翻译。
- RPC 一对带 resolved 旗 + senderSessionId（归属同评论纪律）；timeline entry 与 comment summary 各加 resolvedAt（加性）。
- multica-thread-fold.ts：foldThreads 纯函数（源 foldResolvedThreads 翻译：root 解析=整线程折、reply 解析=root+最晚结论、未解析=全留）；4 单测含嵌套回复归真根。
- UI：threadedEntries 按 fold 分 visible/folded 两桶挂在 root 节点；root 下控制行=Resolve/Unresolve thread（源菜单文案）+折叠时 "N folded · show" 拉回（本地态，不重读）。
- CLI：comment send 补 --parent-id（源 CLI 的 reply 面；**源 CLI 无 comment resolve 命令**——resolve 只走 UI 菜单，我们不补 CLI 是照源不是遗漏）。
- 真机：root+两回复建线→resolve root→流折成 root+"2 folded · show"→show 拉回 middle→unresolve→折叠消失、resolved_at 归 NULL。
- 一次探针自伤记录（034）：click 辅助双 dispatch 曾复制评论；本轮探针已单次 dispatch。
