---
kind: issue
title: "New workspace 与 History 移到 Workspaces 标题行"
type: ff
status: closed
created: 2026-10-11
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# New workspace 与 History 移到 Workspaces 标题行

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

`New workspace` 与 `History` 原本收在 BySpace 按钮的就地展开区里，是五个导航项中最常用的两个，却要两次点击才能到。现在它们是 `Workspaces` 标题行右侧的两个图标按钮，与既有的排序、显示偏好同排。展开区剩下 Search / Schedules / Tunnels。

- 改动：
  - `packages/app/src/sidebar-nav/model.ts` — 新增 `HEADER_SIDEBAR_NAV_IDS` / `isHeaderSidebarNavId` / `isDisclosureSidebarNavId`；`moveSidebarNavItem` 只在「可重排的那一段」内移动，跨过标题项的位置不再被交换。
  - `packages/app/src/sidebar-nav/use-sidebar-nav-entries.ts` — 拆成 `useSidebarNavEntryMap`（解析一次）+ `useSidebarNavDisclosureEntries`（展开区：用户顺序 − 标题项）+ `useSidebarHeaderNavEntries`（标题行：固定顺序 `new-workspace`, `history`）。
  - `packages/app/src/components/left-sidebar.tsx` — 新增 `HeaderNavButton`（28pt，与排序/显示偏好同族；active 走字形颜色不走背景）；`WorkspacesSectionHeader` 渲染这两个按钮，且**零项目时也渲染**，此时排序与显示偏好两个列表控制隐藏；接受 `onBeforeNavigate`，compact shell 传 `closeSidebar`，与展开区的行同一规则。
  - `packages/app/src/components/sidebar-workspace-list.tsx` — `listHeaderComponent` 从条件渲染改为常驻；原来的条件含 `hasActiveHostFilter` 与 `hasActiveProjectFilter` 两个词，前者在重构中被一起丢掉（见下方「review 修正」），后者确实已无消费者。
  - `packages/app/src/components/sidebar/sidebar-nav-menu.tsx` — BySpace 触发器的「有没有东西可展开」改成只数展开区的项，否则只剩标题项时会留一个点开为空的按钮。
  - `packages/app/src/screens/settings/appearance/sidebar-nav-section.tsx` — 标题项不再渲染 Move up/down，可见性开关保留；`isFirst`/`isLast` 按可重排段算。
- 关键取舍：
  - **compact 上必须顺带关面板。** 这两个按钮不参与折叠，所以它们不会像展开区的行那样自带收起；e2e 抓到一次真实回归——手机上点 History 导航到该页后，面板正盖在它上面。
  - **排序对标题项失去意义，可见性保留。** 顺序已由版面决定；「我不想要这个按钮」仍是合理诉求。
  - **进滚动区可以接受。** 标题行在 ScrollView 内，项目多时要滚动才看得到；空项目时由空状态接管，且键盘快捷键与命令中心仍在。
  - **窄侧栏（200pt 最小宽）标题截断**，按钮不压缩。
- 验证：
  - `packages/app/src/sidebar-nav/model.test.ts` — 新增三例：展开区内上移、跨过标题项、拒动标题项。
  - e2e `sidebar-nav-settings.spec.ts`（3/3 通过）、`sidebar-workspace.spec.ts`（含新增「不开展开区直达 History」）。
  - e2e 基建：`sidebar-chrome.ts` 的展开探针从 `sidebar-global-new-workspace` 换成 `sidebar-search`（前者移出后恒可见，会让所有依赖它的断言误判「已展开」）；`clickTopLevelNavItem` 改为目标已可见时不展开。
  - `npm run typecheck`（7 workspace 全绿）、`npm run lint`（0/0）、`npm run format`。
- 对 `byissue/` 影响：已同步 `spec/workspace.md`——「侧栏顶栏与面板折叠」中「四个导航项就地出现在按钮下方」与「展开前不可见因此不再常显高亮」两条已按新形状重写。

## review 修正（独立审查后同一分支追加）

- **P1，真回归**：重构 `listHeaderComponent` 的条件时，把 HEAD 上 `hasActiveHostFilter ||` 这一项一起删掉了。于是「把侧栏筛到一台没有项目的 Host」会清空 `allProjects`，连带卸载显示偏好菜单——而那是唯一的解除入口，且筛选状态是持久化的，重载也回不来（`SidebarFilterEmptyState` 只清 label 与 project 筛选）。修法：`hasListControls = allProjects.length > 0 || hasActiveHostFilter`。
- **P2**：路径提示的行按内容做 key，两台 Host 同名同路径时会撞 key。改为按位置 key。
- **P2（记录为已知缺口）**：线索只加在 project 模式的项目行上。status / label 模式下同名项目渲染成 workspace 行（带 `leadingProjectName`），那里没有线索，歧义仍在。
- **P1（spec 措辞）**：`spec/workspace.md` 原文写「列出全部 Host 名、超过两个截断」自相矛盾，已改为「列出前两个、超出以 … 截断（完整清单在悬停提示里）」。
- **合跑红/单跑绿**：把本文件与 `empty-project-persists.spec.ts` 放同一 worker 跑时，`sidebar-project-filter.spec.ts` 的「只有一个项目时隐藏筛选行」会红。已在干净树上复现，与本次改动无关；机制与用法见 [notes/011](../notes/011-playwright-spec-cross-file-project-leak.md)。
