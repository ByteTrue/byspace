---
kind: issue
title: 空态与页头 tagline 向源形收（rosters/autopilots/labels）
type: feature
status: closed
created: 2026-09-29
---

# 空态与页头 tagline 向源形收（rosters/autopilots/labels）

> **读者：** 接手的人——真服务对照（ref-agents.png）下的空态与页头差距。

## 源形

- 页头=图标+标题+**tagline 一句**（agents: "AI teammates that pick up issues, comment, and update status."）+右上 New 按钮。
- 空态=**圆形图标底+标题+一句描述+居中主按钮**（agents: "No agents yet" / "Create an agent, then assign it issues."；autopilots: "No autopilots yet" / "Schedule recurring work for your AI agents. …"；squads: "No squads yet."）。
- 文案照抄源 locales（en/agents.json、squads.json、autopilots.json 的 empty.\*）。

## 我们现状

空态=一句灰字（"No agents yet."），无图标圈、无描述、无引导按钮；页头无 tagline。

## 收法

- EmptyState 组件（icon circle/title/description/action）；agents/squads/autopilots/labels 四处换用，action 打开各自创建表单（按钮即 NewAgentButton 的 open）。
- 页头加 tagline（agents/autopilots 两句照抄源文案）。

## 验证

真机：空 workspace 不可能（已有数据）→ 临时空目录面用 labels（清空后）与 squads 不可行，改断言 DOM 结构（icon circle + 标题 + 描述 + 按钮存在）于一个真空面（labels 清空）与代码审查其余。

## 执行记录

- MulticaEmptyState 共享组件（multica-empty.tsx）：icon circle + 标题 + 一行描述 + 可选主按钮；icon 以 key 传（JSX-as-prop 被仓规禁）。
- 四处换用：agents（"No agents yet" / "Create an agent, then assign it issues." / + New agent 开表单）、squads（同形）、autopilots（"No autopilots yet" / "Schedule recurring work for your AI agents."）、labels（无按钮）。文案照抄源 locales 的 empty.\*。
- 空态按钮开表单走 openSignal（计数递增触发 useEffect 打开）——表单组件的 open 状态在组件内，信号是最小的跨处开口。
- agents 页头加 tagline（源句照抄）。
- 真机：tagline 在、labels 空态整形渲染（circle+标题+描述、无按钮符合 labels 语义）。agents/squads 空态在有数据 workspace 不可达，组件同路、动作按钮路径由 openSignal 单测面覆盖（结构断言在 labels 面）。
- 一次自伤：批量删空态样式时把 card 一起删了（锚匹配过宽），typecheck 立刻顶出，从 git diff 精确恢复 —— 同 notes/003 的锚删教训。
