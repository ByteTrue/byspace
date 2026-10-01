# 062 · ff · New Workspace 默认 Host 偏好 + 侧栏折叠 UI 修复

Status: ff (fast, 快交付)

## 需求 A：New Workspace 默认 Host

**用户原话（意译）**：新建 Workspace 时若连接的 Host 中有本地 Host（directTcp 为 loopback），应优先默认选中本机；边界情况（同一台机器两个 daemon）视为测试场景不处理。另在项目设置中增加"默认使用哪个 Host"设置项。

### 语义（issue 058 延续）

- 本机判定复用 `resolveLocalDaemonServerId`（packages/app/src/hooks/use-is-local-daemon.ts）：第一个 directTcp endpoint 为 loopback 的 host。
- 默认 host 偏好按项目存：键 = project 的 viewKey（跨 host 稳定，等同 projectKey 的项目），存于 AppSettings（AsyncStorage，仅 app 侧）。

### 实现

1. **AppSettings**（packages/app/src/hooks/use-settings/storage.ts）：新增 `defaultHostByProject: Record<string, string>`（viewKey → serverId），schema `z.record(z.string(), z.string()).catch({})`。
2. **解析优先级**（packages/app/src/screens/new-workspace-initial-context.ts）：`resolveNewWorkspaceInitialServerId` 优先级变为 routeServerId → pinnedServerId(online) → **localServerId(online)** → lastActiveProject(online) → 原有链。`resolveNewWorkspaceAutomaticServerId` 新增迁移规则（`isPreferredPinOrLocalServer` helper）：settings/registry hydrate 后自动选择迁移到 pin/local host（若可达），manual 选择不受影响。两个 input 新增可选字段 `pinnedServerId`/`localServerId`。
3. **接线**（packages/app/src/screens/new-workspace-screen.tsx `useNewWorkspaceInitialContext`）：`localServerId = useLocalDaemonServerId()`；`pinnedServerId = defaultHostByProject[(routeProject ?? lastActiveProject)?.viewKey]`。
4. **项目设置 UI**（packages/app/src/screens/project-settings-screen.tsx `DefaultHostSection`）：ProjectSettingsBody 内（ProjectEditSheet 后、宿主 config renderContent 前，不依赖宿主配置加载成功）；SettingsSection + SelectField（`field={false}` 防双重 label）；选项 = Automatic + project.hosts；写 `persistAppSettings({defaultHostByProject})`（Automatic = 删键）。
5. **i18n**：9 locales `settings.project.defaultHost{label,automatic,hint}`。

**设计取舍**：

- pin 键用 viewKey 而非 projectKey——buildProjects 的 ProjectSummary 与 new-workspace 的 HostProjectListItem 同源 builder，viewKey 一致。
- local host 排在 lastActiveProject 之前：用户意图是"有本机就默认本机"，不要求本机有可选项目。
- 自动迁移规则与既有的 "switches to the remembered online host after it hydrates" 模式一致（useSettings 异步 hydrate 竞态）。

### 测试

packages/app/src/screens/new-workspace-initial-context.test.ts 新增 4 用例：pinned > local > lastActive、local offline 回落、automatic hydrate 迁移。storage.test.ts 既有用例覆盖新默认字段。

## 需求 B：侧栏左上角折叠 UI 修复（PR#11 回归）

用户抱怨四点，逐条修：

1. **BySpace 字大不协调** → packages/app/src/components/sidebar/sidebar-nav-menu.tsx label fontWeight 匹配 ScreenTitle 的 `{xs:"400", md:"300"}`（原来 normal=400 恒定，桌面档缺 300）。
2. **不在同一行** → 与 #3 同根因。
3. **折叠时分隔线与右侧不齐** → packages/app/src/components/left-sidebar.tsx `sidebarHeaderArea` 的 `paddingBottom: spacing[2]` 破坏了 "row+hairline=HEADER_INNER_HEIGHT(36)" 不变量（PR#11 自留 bug）。paddingBottom 移到新增 `expandedNavRows` 样式，只挂展开态的 SidebarNavRows 上；折叠时 hairline 回到 insetsTop+35+1=36，与 ScreenHeader 对齐；内容 center 两侧同为 17.5，#2 随之解决。
4. **折叠箭头太小** → chevron `ICON_SIZE.xs(12)` → `ICON_SIZE.md(16)`，与 toggle 的 PanelLeft 图标一致。

## 验证

- typecheck 通过；lint 0/0（含全仓 lint，complexity 22→提取 helper 后通过）。
- vitest：new-workspace-initial-context.test.ts (19) + use-settings/storage.test.ts (68) 全过。
- 待人工 e2e：折叠态对齐（第二张截图场景）、默认 host picker 行为。
