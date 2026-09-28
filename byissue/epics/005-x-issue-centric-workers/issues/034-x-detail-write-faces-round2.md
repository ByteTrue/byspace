---
kind: issue
title: 第二轮对照：agent 写面、评论线程、squad 管理面
type: feature
status: closed
created: 2026-09-29
---

# 第二轮对照：agent 写面、评论线程、squad 管理面

> **读者：** 接手的人——真服务对照第二轮查出的三处"只读面"差距。

## 差距（源形 → 我们原状）

1. **agent 详情写面**：源 inspector 的 name/description autosave、并发数内联编辑 → 我们只有 archive 开关与 instructions 只读。
2. **评论线程**：源 reply-input 嵌套（reply 挂 parent，缩进渲染）→ 我们平流（parentId 在协议与 schema 里躺着未用）。
3. **squad 管理面**：源 profile 编辑（name/description/instructions）+ leader 换 + member role 编辑 → 我们只有成员加删。

## 收法

1. `multica.agent.update`（name/description/maxConcurrentTasks omit-keeps；description 255 上限在写侧拦、空名拒——源同两条界）；UI=InlineEditField（click-to-edit，blur 提交）+并发步进器。
2. timeline 条目加 `parentId`（加性）；流按 root/replies 分组渲染（回复缩进在 root 下；源的长回复折叠不抄——折叠是阅读辅助非线程语义）；每评论行加 reply 链 → composer 进入回复态（横幅+cancel），发送带 parentId。
3. `multica.squad.update`（omit-keeps + leader 轮换自动把非成员新 leader 以 role=leader 入册——源 UpdateSquad 同语义；旧 leader 行 role 不动——源亦不降级，谁领导读 leader_id）与 `multica.squad.member_role`；UI=profile 三内联编辑+Leader 段行选择+成员行 role 内联编辑。
   - 偏离记：源换 leader 时对新 leader runtime 未绑定的 autopilot 做 pause 级联；我们 runtime 形无此联动，不建。

## 验证

- 单测 3 例（leader 轮换自动入册带 role=leader、role 写只动该行、profile omit-keeps）。
- 真机：reply 链→横幅→nested 评论落库带 parent 且 UI 缩进；agent 改名落库、并发 +1 落 2；squad 换 leader 落库、role 写 "docs owner" 落库。
- **探针自错记**：我的 click 辅助对 Text+Pressable 各 dispatch 一次导致评论重复（产品无缺陷——真点击是单事件）；改单次 dispatch 后数据可信。

## 关闭回写

- parity-audit：agent/squad 行与 comment 线程收口。
