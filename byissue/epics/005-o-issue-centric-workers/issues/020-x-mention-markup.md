---
kind: issue
title: mention 语法对齐源 markup：解析 + composer 插入
type: bug
status: closed
created: 2026-09-29
---

# mention 语法对齐源 markup：解析 + composer 插入

> **读者：** 接手的人——mention 是 markup 不是裸名，偏离怎么来的、为何必须收。

## 偏离

我们 parseMentions 收 `@Name` 裸名；源 util.MentionRe 收 markdown 链接 markup：
`[@显示名](mention://agent|squad|member|all/<uuid|all>)`。裸名语法在多词名上截断（"@Chief of Staff" 只取到 Chief），且与源前端 mention 菜单产出不兼容（源菜单写 markup）。

## 收法

- parseMentions 改收 markup（mention:// 的 kind+id 直读，不再名→id 反解——markup 自带 id）；裸名 @ 继续收但仅作"显示友好"的别名解析（名精确匹配 agent/squad 名，含空格名用最长匹配）；
- CLI comment send 增 --mention <name>（名→id 后拼 markup，多词名不截断）；composer 的 "@" 候选菜单记欠账（体验增量，语法对齐的核心是解析与写面）；
- 触发引擎与 subscription/inbox 各处读 mentions 的地方统一走新解析。

## 验证

- 单测：markup 的 agent/squad/all 三型、裸名单词名、裸名多词名（最长匹配）、CJK 边界仍成立；
- 真机：CLI --mention 叫醒多词名 agent；composer 菜单插 markup 叫醒。

## 执行记录

- parseMentions 改收 markup（agent/squad 带 id 直读、all；member/issue 不叫醒）+ 裸名别名（单词名、CJK 边界保留）；新导出 mentionWakeTargets 统一唤醒解析；store createComment 的 mentioned 订阅吃 ParsedMention（markup 带 id 直接订，裸名经名→id）。
- CLI --mention 可重复，名→id 后拼 markup；未知名报错不静默。
- 测试：markup 三型、markup 与裸名并存不重复列、裸名单词/CJK 边界原断言按新形状改写。17 触发测。
- 真机：--mention "Chief of Staff" 叫醒多词名秘书（run running→completed），评论文本带完整 markup —— 链的首环成立。
- 欠账：composer 的 @ 候选菜单；member/issue 两 markup 型的读面（本域无人类多成员，member 型无对象）。

## 关闭回写

- parity-audit B 行 mention 触发更新。
