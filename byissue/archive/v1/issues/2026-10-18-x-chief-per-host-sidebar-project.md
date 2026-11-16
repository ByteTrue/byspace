---
kind: issue
title: "Chief 按 host 可见：固定首位的 BySpace-WorkSpace 项目与删掉顶栏入口"
type: refactor
created: 2026-10-18
---

# Chief 按 host 可见：固定首位的 BySpace-WorkSpace 项目与删掉顶栏入口

> **读者：** 接手的人——为什么 Chief 从「一个按钮」变成「侧栏第一条项目」、合并机制在哪、删了哪些入口、怎么验。

## 目标

多 host 时，每台机器的 Chief 在侧栏里是**各自可见的一行**，而不是被一个按钮和一个聚合状态灯糊成「一个 Chief」。

## 问题

`ensureHomeWorkspace` 给每台 daemon 各建一个 Home workspace（`$BYSPACE_HOME/chief`，label `byspace.home-workspace`），所以实体上本来就是每台机器一个 Chief。但呈现上：

- 每台 host 的 Home workspace 都叫 `Chief`、项目都叫 `BySpace-WorkSpace`，无 host 标识；
- 顶栏只有一个 Chief 胶囊按钮，落点由 `resolveChiefTargetServerId` 静默决定（当前路由 → 最早在线 → 列表第一个）；
- 状态灯聚合**所有** host 的 Home 状态，回答不了「哪台在等我」；
- Home 与其项目壳又被从侧栏列表里排除，除按钮外没有第二个入口。

结果多 host 用户无法分辨也无法选择。

## 方案

**把已经存在的 N 个实体显性化，不新建编排。**

1. **跨主机合并成一条项目**：`buildWorkspaceStructureProjects` 对 Home 项目给固定 viewKey（`home:chief` 而非 `host:<serverId>:<path>`），现有按 key 合并的逻辑把 N 台 host 的 Home 项目并成一个带多个 host placement 的项目。`shouldShowProjectHostLabels` 在多 host 时自动出行内 host badge，无需新逻辑。
2. **固定第一条**：project 分组模式下该项目的顺序是常量，不参与 `applyStoredOrdering`、拖拽排序与「Sort projects」。status / label 分组模式不特殊化（那两种视图的价值是按状态/标签排，钉一条进去会破坏它）。
3. **参与 Host / Project / Label 筛选**：被 host 筛选排除是正确的语义。
4. **交互全禁**：rename、archive、delete、拖拽、新建 workspace 的项目选择器。Home 是 daemon 自建的，标题/cwd/位置每次启动都会被重新断言，做成可编辑只会产生「改了又变回去」的假象。
5. **删除顶栏入口**：顶栏 Chief 胶囊按钮、`chief.open` 快捷键与路由动作、Command Center 的 Chief 动作、Appearance → Sidebar 里 Chief 的可见性开关、聚合状态灯、`resolveChiefTargetServerId` / `openChiefWorkspace`。Chief 只剩侧栏项目一个入口。

## 必须保持

- **Home 的身份是 label + serverId，不是路径。** 各 host 的 Home cwd 都是 `$BYSPACE_HOME/chief`，跨机器同名不同机；任何按路径判等两处 Home 的代码都会踩雷。
- **路由到哪台 host 由 placement 的 serverId 决定**，不能只看合并后的 viewKey。合并后 viewKey 跨 host，而它同时是项目选中态与路由判据——这是本次唯一可能翻车的点。
- `chief.suggestions.*`（开场三条建议）仍在用，保留。

## 验证

- `npx vitest run packages/app/src/projects/workspace-structure.test.ts --bail=1`
- `npx vitest run packages/app/src/hooks/sidebar-workspaces-view-model.test.ts --bail=1`（如拆出固定首位逻辑则补测）
- `npx vitest run packages/app/src/chief/home-workspace.test.ts --bail=1`
- `npx vitest run packages/app/src/sidebar-nav/model.test.ts --bail=1`
- `npx vitest run packages/app/src/keyboard/keyboard-shortcuts.test.ts --bail=1`
- e2e：`packages/app/e2e/browser/sidebar-workspace.spec.ts`、`sidebar-nav-settings.spec.ts`（后者现在断言 Chief 开关）
- `npm run typecheck && npm run lint`

## 关闭回写

已毕业到 `byissue/spec/workspace.md`（「Chief 项目」一节）与 `byissue/spec/agent-conversation.md`（Chief 入口）。

## 执行记录

**已实现。** 关键改动与验证：

- `chief/home-workspace.ts`：`HOME_PROJECT_VIEW_KEY = "home:chief"`、`isHomeProjectViewKey`、`findHomeWorkspace`；删掉 `resolveChiefTargetServerId` / `openChiefWorkspace` / `useChiefAvailable` / `useChiefWorkspaceStatusBucket` / `useIsShowingChiefWorkspace` / `deriveHomeWorkspaceStatusBucket` / `hasHostChiefRole` / `findHomeWorkspaceId`（`hasHostChiefRole` 随之无用）。
- `projects/workspace-structure.ts`：Home 项目改用保留 viewKey；只对「带 label 的 workspace 所在项目且该项目无非 Home workspace」的才算 Home，用户共享的项目保持普通行；`projectKey` 置 null 以阻断 host-scoped key 再参与合并。
- `stores/session-store-hooks/selectors.ts`：`composeWorkspaceStructure` 在应用存储顺序之后 `hoistHomeProject`（晚于存储顺序，因此它不受任何排序影响）。
- `utils/sidebar-sort-projects.ts`：Sort projects 排除 Home 项目。
- `components/sidebar-workspace-list.tsx`：Home 项目渲染在 DraggableList 之外（无拖拽）；项目行无 kebab / 右键菜单 / 新建 workspace；工作区行 `isFixedActionRow` 关掉 archive / rename / rename-with-agent / pin / label / archive 快捷键。
- `components/sidebar/sidebar-workspace-row-content.tsx`：离线或出错的 host 行保留并降至 0.55 透明度。
- `projects/host-project-model.ts`：`filterWorkspaceProjectsForHost` 排除 Home 项目（新建工作区的项目选择器）。
- 删除入口：`components/sidebar/sidebar-chief-button.tsx`、`hooks/use-global-chief-action.ts`、`sidebar-nav` 的 chief 项（含 Appearance 开关与 `Bot` 图标）、Command Center 的 chief 动作、`chief.open` 快捷键与路由、`keyboard-shortcuts` 的两条绑定，以及 10 个语言文件的 `chief.title` / `switchHost` / `maximize` / `open` / `close` / `retry` / `noHomeWorkspace`（保留 `chief.suggestions.*`）。
- 验证：`npm run typecheck`、`npm run lint`、`npm run format:check` 均通过；单测 `workspace-structure`（8）、`home-workspace`（4）、`sidebar-nav/model`、`sidebar-sort-projects`（4）、`session-store-hooks/selectors`（20）、`new-workspace/project-selection`（23）、`sidebar-workspace-list`、`components/sidebar/*`、`keyboard/*`、`command-center/*`、`i18n/*`、`hooks/*`、`stores/*`、`screens/*` 全绿。e2e 已按新布局改写（`sidebar-workspace.spec.ts`、`sidebar-nav-settings.spec.ts`、两个 helper），**未在本机跑 Playwright**。

**留下的已知上限：** 合并后的 viewKey 跨 host，行点击走 placement 的 `serverId`（已如此）；若将来出现第二个需要跨 host 唯一的保留项目，把改写抽成机制。

### 对抗审查后的补修

首版把「固定行」当 prop 从项目块往下传，这在大屏常态下能用，但侧栏还有两个入口不在项目块里。审查找到了它们，浏览器复验确认：

- **status / label 分组与 Pinned 段**（`sidebar/sidebar-status-list.tsx`）：同一行从这两个入口渲染时没有项目块在上，prop 根本传不到，Home 重新变得可归档/可改名/可 pin。修法不是补一条传递路径，而是把判据改成 `isHomeWorkspace(workspace)`——从 workspace 自身的保留 label 推导。`sidebar-workspace-list.tsx` 的 `WorkspaceRowWithMenu` 同样改掉，`isFixedActionRow` 不再逐层穿过 `WorkspaceRow` / `WorkspaceRowItem`。
- **全局快捷键绕过行内禁用**：`use-global-workspace-pin-action.ts` 与 `workspace-rename-host.tsx` 按路由选中项注册，不看行是否渲染；Command Center 的 `workspace:pin` / `workspace:rename` 同理。三处都改成从缓存的 workspace descriptor 算 `isHomeWorkspace`。生效状态要足够残：`SplitPinnedSidebarGroups` 会把 pinned 行从项目块里摘出来，一旦 pin 成功，Home 就跑出固定项目并恢复全部写入口。
- **设置 → Projects**（`screens/projects-screen.tsx`）：侧栏 kebab 关掉了，但列表直接遍历 `useProjects()`，点进项目设置能改默认 host 或移除项目。已过滤。
- **`sortProjectsByRules` 改成「置顶」而不是「剔除」**：返回值是要落盘的 `projectOrder`，剔除它等于存一份没有 Chief 的顺序，它原来的槽位会被别的项目顶掉。
- **Labels 子菜单绕过回调**：它只判 `serverId && workspaceId`，`on*` 全关也照常出现。`SidebarWorkspaceMenuItems` 收到 `isFixedActionRow` 后才隐藏。浏览器复验暴露了这条，单测没拓到。

## 暂不纳入

跨 host 编排、Chief 直连其他 host 的 agent、用 host 名替换行标题（行标题保持 `Chief`，host badge 承担消歧）。
