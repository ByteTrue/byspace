---
kind: issue
title: "侧栏新建 Workspace 尊重默认 Host 偏好（项目 pin → 本机）"
type: ff
status: closed
created: 2026-10-06
---

# 侧栏新建 Workspace 尊重默认 Host 偏好（项目 pin → 本机）

## 预期与实际

预期：多 Host 环境下，点侧栏项目行的"+"（新建 Workspace），Host 默认选中本机（DESKTOP-BYTE，loopback daemon）；项目在设置里 pin 了默认 Host 时选 pin。这是 062 定下的语义。

实际：默认选中了 `project.hosts` 顺序里的第一个可用 Host（截图里是 zijies-MacBook-Pro.local），062 的偏好从未生效。

## 根因

062 只修了 new-workspace screen 的解析器（`resolveNewWorkspaceInitialServerId`：route → pin → 本机 → lastActive），但侧栏"+"的入口把 host 写进了 route：`handleBeginWorkspaceSetup`（packages/app/src/components/sidebar-workspace-list.tsx:761）用 `worktreeTarget.serverId` 构建 `/new?serverId=...`，而 `worktreeTarget` 由 packages/app/src/utils/sidebar-project-row-model.ts 的 `resolveNewWorkspaceTarget` 按 `project.hosts` 顺序取第一个可建 workspace 的 host——与偏好无关。screen 解析器对 known route serverId 无条件信任，pin/local 链永远轮不到。

## 改了哪些

- packages/app/src/utils/sidebar-project-row-model.ts：`resolveNewWorkspaceTarget` 新增 `preferredServerIds` 参数，先用偏好 host（仍须通过 worktree/multiplicity 能力门，且携带该项目），再回落原顺序；`buildSidebarProjectRowModel` input 新增可选 `preferredServerIds`。
- packages/app/src/components/sidebar-workspace-list.tsx：Root `SidebarWorkspaceList` 计算 `preferredServerIdsByProjectViewKey`（每项目：项目 pin → 本机 loopback host，均要求 online，去重），沿 ProjectModeList → ProjectBlock 穿透进 row model；在线门槛对应 screen 的 stale-pin 规则。状态订阅放 Root 一层（`useHostRuntimeConnectionStatuses` 订阅全局 store version），不进每行 ProjectBlock。
- packages/app/src/utils/sidebar-project-row-model.test.ts：新增 4 用例（偏好优先于 hosts 顺序、pin 先于本机、偏好 host 不带项目时回落、偏好 host 无能力时跳过）。

### 2026-10-06 审查修复（正确性审查指出侧栏性能回归）

useHostRuntimeConnectionStatuses 走 useSyncExternalStore，host-runtime 每次 emit（含 agent 输出等高频事件）都递增全局 version 并返回新 Map——Root 里的 preferredServerIdsByProjectViewKey memo 随之拿到新引用，areProjectBlockPropsEqual 失配，整个项目列表跟着无关 emit 重渲染。修复：查找逻辑抽为 packages/app/src/utils/sidebar-project-row-model.ts 的 buildPreferredServerIdsByProjectViewKey（纯函数），Root 用 isSamePreferredServerIds 做内容比较，内容不变时复用上一个 Map 实例（useRef 暂存）。补 4 用例（build 三态 + compare 一例五断言）。订阅仍只在 Root 一层。

## 怎么验证的

- `npx vitest run packages/app/src/utils/sidebar-project-row-model.test.ts --bail=1`：16 passed。
- `npm run typecheck` 全 workspace 通过；`npm run lint --` 三文件 0 warnings 0 errors；`npm run format:files --` 已格式化。
- 待人工 e2e：在线 Web 点项目"+"，确认 Host 默认 DESKTOP-BYTE（localhost:6777）。

## 对 byissue/ 的影响

无既有真相失效。062 的偏好语义不变，本条补上它在侧栏入口的缺口。
