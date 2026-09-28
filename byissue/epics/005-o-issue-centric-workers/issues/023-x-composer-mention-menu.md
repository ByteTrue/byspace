---
kind: issue
title: composer @ 候选菜单：markup 的写入口（尾触发 v1）
type: feature
status: closed
created: 2026-09-29
---

# composer @ 候选菜单：markup 的写入口（尾触发 v1）

> **读者：** 接手的人——为何 v1 是尾触发而非光标处、为何点击选择而非键盘导航。

## 背景

020 把 mention 语法对齐到源 markup（`[@Name](mention://agent/<id>)`）；CLI 侧 --mention 已闭环，人侧（console composer）仍只能手敲 markup —— 语法有两个写面才算闭环。

## v1 形态（尾触发）

- 触发：draft 尾匹配 /@([\p{L}\p{N}_-]\*)$/u 即开菜单（候选=agent 名册+squad 名册，含 internal 秘书；输入片段做前缀过滤）；
- 选择：点击候选行 → 尾部的 @fragment 整段替换为 markup（draft 是受控字符串，替换=纯串操作，不需光标读面 —— text-input 的 handle 只有写面 replaceText 无光标读面，读光标要改组件，v1 不动）；
- 关闭：Esc 不清（无键盘面）、尾不再是 @fragment 即关、选择后关；
- 不做（记欠账）：光标中间处触发、键盘上下/Enter 导航（仓库 AutocompletePopover 有键盘面，接入需光标读面，v2）。

## 范围

- 只改 issue 详情 composer（聊天 composer 的 @ 是另一面，语法不同源，不动）。

## 验证

- 单测：尾触发解析（@空/@前缀/无@/中段@不触发）、替换后的 draft 串=markup 拼接正确；
- 真机：敲 @ 出菜单、点 Chief of Staff 后 draft 尾为完整 markup、发送后该评论叫醒秘书。

## 执行记录

- 纯逻辑 multica-mention-menu.ts：tailMention（尾 @fragment，/u 含 CJK）、mentionMenuState（前缀过滤、agent+squad 合册）、applyMentionChoice（尾替换为 markup+尾空格）。6 单测（尾触发三例、替换三例）。
- catalog 扩 allAgents（含 internal：秘书是可点名的队友）与 squads（mention 叫醒其 leader）；assignee 选择面继续排除 system，两面的名册语义各归其位。
- composer 改持自己的 draft（原受控于 data hook 的 draft 移走），菜单绝对定位在输入上方；候选行点击选择。
- **v1 的真边界被真机两次顶出**：uncontrolled 输入的 DOM 不跟 draft state —— ① 选择后可见文本停在旧 fragment（改：选择经 handle 的 replaceText 写回）；② 发送后旧文本残留（改：发送后 handle.reset()，组件自有的清空）。两处都是"state 真、DOM 假"的同一家族，与 007/016 的 uncontrolled 教训同根。
- 真机全链：敲 `@wri` 出单候选 Writer → 点击后 DOM 文本即完整 markup → 发送后输入清空、评论落库带 markup、Writer 被 comment mention 叫醒（running）。截图未留（菜单一闪面，DOM 断言已足）。
- 欠账（v2）：光标中间处触发与键盘导航 —— 都需要 text-input 的光标读面（handle 现只有写面 replaceText/reset）；仓库 AutocompletePopover 的键盘面可作 v2 的载体。

## 关闭回写

- parity-audit B 行 mention 欠账收口（composer 菜单完成）。
