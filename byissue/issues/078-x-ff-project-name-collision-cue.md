---
kind: issue
title: "同名 Project 行加归属线索与路径提示"
type: ff
status: closed
created: 2026-10-11
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 同名 Project 行加归属线索与路径提示

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

多台 Host 各自添加同名的普通目录（或同名 Git 仓库无 remote）时，侧栏会出现两行完全一样的名字，用户无法分辨哪个对应哪台机器。现在这种行会在名字下方多一行线索 `Host 名 · 缩短路径`，不冲突的行一行字都不加。

**为什么必须两半都给。** 只给 Host 名区分不了同一台机器上的 `~/dev/chat` 与 `~/work/chat`；只给路径区分不了两台机器的 `~/chat`——`shortenPath` 会把两者都变成 `~/chat`，恰好抹掉要用的信息。

- 改动：
  - `packages/app/src/utils/project-row-cue.ts`（新增）— `buildProjectRowCues` 按最终显示名（trim + 小写）分组，只有 ≥2 行同名才产出线索；`buildProjectRowPathLines` 给出 tooltip 用的完整路径。
  - `packages/app/src/components/sidebar-workspace-list.tsx` — 新增 `ProjectRowLeading`（行左半 + 名字上的路径 tooltip），`ProjectBlock` 透传 `hostLabelByServerId` 与 `projectNameCueByViewKey`；线索渲染在标题下方第二行，不占 trailing 槽。
- 关键取舍：
  - **线索算的是当前可见列表**，不是全部项目。过滤到只剩一个同名项时线索消失。
  - **触发面是标题，不是整行**。整行触发会在移向 kebab 时弹出没人要的 tooltip。
  - 名字下方第二行，不放标题右侧：trailing 槽是 hover 操作区，放那里会在最需要它的时候被挤掉。
- 验证：
  - `packages/app/src/utils/project-row-cue.test.ts`（新增，10 例）：不冲突不产出、缩短后同名仍可区分、大小写与空格归一、无标签回落 serverId、跨多 Host 只列前两个、无路径时只给 Host。
  - `npm run typecheck`（7 workspace 全绿）、`npm run lint`（0/0）、`npm run format`。
- 对 `byissue/` 影响：已同步 `spec/workspace.md`——新增「同名 Project 的归属线索」小节。

## review 修正（独立审查后同一分支追加）

- **P2，已知缺口**：线索只加在 project 模式的项目行上（`ProjectHeaderRow`）。status / label 模式下同名项目渲染成 workspace 行，那里带的是 `leadingProjectName`，没有线索，歧义仍在。本轮范围就到此为止，需要时另开。

顺手发现：`docs/hover.md` 的规范在本次没被违反（tooltip 走 `Tooltip` 组件而非裸 `onPointerEnter`），但 `sidebar-workspace-list.tsx` 里 project 行的 hover 仍是 `onPointerEnter` 直接挂在容器 `View` 上，属于该规范允许的形状，未动。
