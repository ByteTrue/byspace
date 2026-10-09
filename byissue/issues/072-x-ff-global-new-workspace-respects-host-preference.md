---
kind: issue
title: "全局 New workspace 入口尊重默认 Host 偏好（pin → 本机）"
type: ff
status: open
created: 2026-10-07
---

# 全局 New workspace 入口尊重默认 Host 偏好（pin → 本机）

## 预期与实际

预期：连接了 localhost 宿主后，从任意入口新建 Workspace，Host 默认选中本机（localhost daemon）；项目 pin 了默认 Host 时选 pin。这是 062 定下、spec/workspace.md 记录的语义（"任何入口都不默认选一个无关 Host"）。

实际：侧栏导航行 / BySpace 菜单 / 命令面板 / 快捷键的 New workspace 依然默认选中远端宿主（截图里是 zijies-MacBook-Pro.local），本机 localhost 从不成为默认。067 只修了侧栏项目行"+"入口，这是第四次复发。

## 根因

两个全局入口把当前活跃 workspace 的 host 写进了 new-workspace route：

- packages/app/src/sidebar-nav/use-sidebar-nav-entries.ts 的 onNewWorkspace（侧栏导航行与 BySpace 菜单共用）
- packages/app/src/hooks/use-global-new-workspace-action.ts（workspace.new 快捷键与命令面板）

而 screen 的解析器（resolveNewWorkspaceInitialServerId）对 known route serverId 无条件信任，pin → 本机 → lastActive 的偏好链永远轮不到。067 的 ff 明确记录了"screen 解析器对 known route serverId 无条件信任"，但只修了"+"入口。

## 改了哪些

- packages/app/src/sidebar-nav/use-sidebar-nav-entries.ts：onNewWorkspace 改为 `router.push(buildNewWorkspaceRoute())`，删除活跃 workspace 上下文（useActiveWorkspaceSelection / useWorkspace / useHostFeature 及 canUseActiveWorkspaceContext 判定）。
- packages/app/src/hooks/use-global-new-workspace-action.ts：handle 改为 `router.navigate(buildNewWorkspaceRoute())`，同样删除活跃 workspace 上下文。
- packages/app/src/hooks/use-global-new-workspace-action.test.tsx（新增）：2 用例锁住裸 route 语义——路由不带 host、无宿主时 isActive() 为 false（门在 dispatcher 的 enabled，handle 自身不带重复守卫）。

### 2026-10-09 审查应用（正确性审查"可合"+ ponytail 过度工程审查，无 blocker）

正确性审查确认：remember 副作用有四个存活来源（workspace 屏、侧栏两列表、根布局全路由挂载的 useKeyboardShortcuts + navigateToWorkspace），项目预选不退化；screen 侧能力门禁独立存在，非 git + 无 multiplicity 场景为既有行为；「+」/fork/archive/add-project/project-settings 入口未触碰；lastActive 项目不在本机时可逃逸（报错明确、host picker 未锁），符合 spec。采纳建议：mock 的 useHosts 从 string[] 改为最小 HostProfile 形状。
ponytail 审查（净 -23 行）采纳：删 handle 内不可达的 hosts.length 守卫（dispatcher 调 handle 前已过滤 enabled，keyboard-action-dispatcher.ts:139-148）；删"no host 不动作"直呼 handle 的用例，改为断言注册项 isActive() === false（测真正的门）；删"注册不堆积"用例（七成在测 mock 自身）；两处重复注释压成两行。

## 怎么验证的

- `npx vitest run packages/app/src/hooks/use-global-new-workspace-action.test.tsx --bail=1`：2 passed（审查应用后）。
- `npm run typecheck` 全 workspace 通过；触碰 3 文件 lint 0/0；format 过。
- **生产构建实测复现（2026-10-09，v0.18.0 Web，用户浏览器）**：停留在 DESKTOP-BYTE 的 workspace 上点侧栏导航行 New workspace，URL 变为 `/new?serverId=srv_0vMgjYiD90NG&...`，Host picker 显示 DESKTOP-BYTE 而非本机——与根因吻合，修复针对的入口被证实。
- 同场对照：侧栏项目行「+」入口在同构建上行为正确（路由带本机 srv_FiqtREcxE_Q3，Host 默认 MacBook）；用户报告的「+」入口异常是其 Web 端旧缓存所致，刷新后消失，不是代码缺陷。

## 对 byissue/ 的影响

无既有真相失效；spec/workspace.md「新建 Workspace 默认值」的语义从部分成立变为全入口成立。
