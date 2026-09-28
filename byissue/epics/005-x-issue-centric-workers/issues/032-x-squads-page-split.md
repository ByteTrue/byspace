---
kind: issue
title: rosters 拆分：Agents 与 Squads 独立页（源 nav 两入口）
type: feature
status: closed
created: 2026-09-29
---

# rosters 拆分：Agents 与 Squads 独立页（源 nav 两入口）

> **读者：** 接手的人——源 nav 的 AI Team 组是 Agents/Squads 两入口两页；我们是单 rosters 页三节。

## 源形（ref-Agents-low.png / ref-Squads-low.png）

- /agents 与 /squads 两路由，nav 两入口；页头=图标+标题+（agents 有 tagline）+右上 New。
- squads 空态=icon 圈+标题+按钮，**无描述行**；agents 空态有描述行。

## 收法

- 新路由 /multica/squads（SquadsPage：squads grid + New squad + 空态无描述）；agents 页保留 agents grid + Labels 管理节（labels 的源家=Settings 的 issue configuration，我们无 settings 面，留在 agents 页是既定偏离）。
- rail 的 "Agents & squads" 拆成 Agents / Squads 两入口。
- EmptyState 的 description 改可空（squads 传 null）。
- squads 组件（SquadCard/NewSquadButton/空态）移共享或导出供新路由用。

## 验证

真机：rail 两入口各达其页；squads 页建/空态形与源同；agents 页 labels 节仍在。

## 执行记录

- 新路由 /multica/squads → SquadsPage（multica-squads.tsx 共享模块：grid+NewSquadForm+空态无描述行——源 squads 空态文案本无描述句）；agents 页移出 squads 查询/节/组件（NewSquadButton/LeaderChip/SquadCard 随迁），labels 节留在 agents 页（既定偏离）。
- rail 拆两入口（Agents / Squads 两图标两路由）；MulticaNavKey 扩 "squads"。
- 真机：agents 页 labels 节与 New agent 在、无 squads 节；nav 六入口；点 Squads 达 /multica/squads，两 squad 卡与 New squad 在。
- 一处探针自警：断言"squads 节不存在"的正文正则命中了 nav rail 的入口文本——页面判断要避开 nav 自身文本。
