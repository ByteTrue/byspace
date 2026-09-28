---
kind: issue
title: autopilot 面：archived 退出默认列表、详情动作行禁用
type: bug
status: closed
created: 2026-09-29
---

# autopilot 面：archived 退出默认列表、详情动作行禁用

> **读者：** 接手的人——archived 在源是"退出默认面"的终态，我们的面为何要跟着收。

## 触发

清理验证残留时我对一个已 archived 的 autopilot 跑了 pause，它被拉回 paused（写路径无迁移门，源同——DB CHECK 只保枚举）。真问题不在写路径而在面：源列表默认过滤 `status !== "archived"`（autopilots-page 694），默认面里 archived 行不存在，因此没有"对终态行点动作"的入口；我们的列表显示 archived 卡且动作可用。

## 收法

- 列表面默认排除 archived（源同款默认过滤；scope UI 不做，记欠账）；
- 详情面对 archived 行禁用动作行（Trigger/Pause/Enable 不渲染）——写路径保持源的无门形态（与源一致），门在面上。

## 验证

- 真机：archived 行不在列表；详情无动作按钮；active/paused 行为不变。

## 执行记录

- 列表默认面过滤 archived（源 autopilots-page 694 同款默认）；详情面对 archived 行不渲染动作行并给一行终态说明。写路径保持源的无迁移门形态（DB CHECK 保枚举），门在面上 —— 与源同。
- 真机：归档 Pause probe 后列表只剩 Minute patrol（paused 非终态，仍可见可动）；archived 详情无 Trigger/Pause/Enable、有终态说明行。
- 触发本 issue 的操作复盘：我对 archived 行跑 pause 把它拉回 paused —— 写路径与源同（无门），真缺口是面把终态行当活行展示。顺带把两个验证残留 autopilot 归位（Minute patrol paused、Pause probe/Nightly digest archived），不再每分写 skip run 行。

## 关闭回写

- parity-audit autopilot 行注一句面的终态处理。
