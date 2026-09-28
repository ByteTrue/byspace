---
kind: issue
title: label 管理页：rename/recolor/delete（源 settings labels-tab）
type: feature
status: closed
created: 2026-09-29
---

# label 管理页：rename/recolor/delete（源 settings labels-tab）

> **读者：** 接手的人——label 从"贴标面"到"目录管理面"缺的那半。

## 背景

017 建了目录+贴标+卡点+过滤，但目录本身不可管理：源 settings 的 labels-tab 有 create/rename/recolor/delete 全 CRUD。删除语义：junction 行同事务清（源无 FK 应用层清；我们 junction 带 FK ON DELETE CASCADE，删除即级联，同义更强）。

## 范围

- store：updateLabel（omit=keep）、deleteLabel（FK 级联清附件）；
- RPC 两对（update/delete）+ client + CLI 两动词 + UI：rosters 页加 Labels 管理段（行内 rename/recolor 预设色/delete，与源 tab 的行内编辑同形）。

## 验证

- 单测：rename/recolor 落、delete 后附件行消失（级联）、未知 id 报错；
- verifier：update 后 list 见新名、delete 后 issue 的 labels 空；
- 真机：console 改色改名删除三动作。

## 执行记录

- store：updateLabel（omit=keep 同源的 COALESCE）、deleteLabel（junction 的 FK ON DELETE CASCADE 使附件自清——源同事务手清，同义）。未知 id 抛错不静默。
- RPC 两对 + client 两方法 + CLI 四动词（label ls/create/update/delete）+ UI：rosters 页 Labels 段（行内改名、10 预设色 chips——色板照抄源 color-picker 的 COLOR_PICKER_PRESETS、行尾 delete、段尾 Add label）。
- 测试三例（rename/recolor 互留、删除级联空附件、未知 id 报错）；verifier 增 4 检查 → 56/56。
- **verifier 的旧隐患被新块顶出**：verifyReactions 与 verifyLabels 两异步块从未被 await，一直在与后续写竞速，此前靠时序侥幸全绿；label 管理块一加（create+delete 动目录）即现形（"the directory lists both" 读到管理块的中间态）。修为 await —— 检查序列必须串行，竞速的"绿"不是绿。
- 真机：首轮三动作未落 —— daemon 还是旧协议（label RPC 建在重启后），而 UI 的 catch(refresh) 把 unknown_schema 吞成一次普通刷新。重启后三动作全落（改名+换色落库、删除行消失）。吞错刷新是 UI 面的静默失败面，记入 notes 家族候选。

## 关闭回写

- parity-audit 的 label 行收口；毕业 spec 欠账清单移除 label 管理页。
