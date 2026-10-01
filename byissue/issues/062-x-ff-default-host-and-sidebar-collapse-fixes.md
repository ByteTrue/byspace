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

**hydrate 语义**（已确认）：useNewWorkspaceInitialContext 的 localServerId/pinnedServerId 都是响应式读取（useLocalDaemonServerId + useSettings），mount 时 settings 未加载则先按 lastActive/local 预选，hydrate 后 defaultServerId 重算并经 resolveNewWorkspaceAutomaticServerId 平滑迁移到 pin——不会固化在 mount 时刻；manual 选择不受迁移影响。用户可能看到一次预选切换（与既有 remembered-host hydrate 行为相同）。

**陈旧 pin 展示**：pin 的 host 被删/离线时，解析器按 known+online 校验直接忽略；项目设置的 SelectField 因 options 中无匹配回落显示 placeholder（Automatic）。defaultHostByProject 不做主动 GC（每项目一条，量级可忽略；选 Automatic 即删键）。

### 测试

packages/app/src/screens/new-workspace-initial-context.test.ts 新增 4 用例：pinned > local > lastActive、local offline 回落、automatic hydrate 迁移。storage.test.ts 既有用例覆盖新默认字段。

## 需求 B：侧栏左上角折叠 UI 修复（PR#11 回归）

用户抱怨四点，逐条修：

1. **排版层级两层收敛**：
   - 标题层：`BySpace` 用 `fontSize.base`（14px）、`fontWeight.semibold`（600）、`color: theme.colors.foreground`。此前是 `{ xs: "400", md: "300" }`——标题比它下面的导航行（400）还轻，层级是反的，用户要求加粗。
   - 徽标层（开发分支徽标 `devBuildBadge` 与项目徽标 `headerProjectTitle`）：统一为 `fontSize.sm`（12px）、`fontWeight.normal`（400）、`color: theme.colors.foregroundMuted`、`backgroundColor: theme.colors.surface2`、`borderRadius.sm`（4px），去掉了原开发徽标突兀的纯黑实心底色。
2. **箭头靠右与文字居中（尊重设计决策）**：`BySpace` 文本相对**整个 sidebar 宽度**居中（不是相对按钮——左侧的折叠按钮与移动端关闭按钮会占据行内空间，按按钮居中会把标题推离 sidebar 轴），右侧展开箭头 `>` / `v`（`ICON_SIZE.md` = 16px，不小于 Sort 按钮的 14px）贴靠最右侧（`right: 8px`）。做法：label 从 trigger 的 Pressable 内移出，与 trigger 同层，作为绝对定位全宽层（`labelLayer`）居中；trigger 内只剩绝对定位的右侧 chevron。
3. **开发分支名移出顶栏**：原本在顶栏右侧挤占位置的开发分支徽标 `devBuildBadge` 移到左下侧 `+ Add project` 的正上方（`SidebarFooter` 上方），作为安静低调的次级徽标展示；顶栏不再有分支名干扰，彻底还原用户在真实生产环境看到的视图。
4. **标签光学中线提取为共享样式**：新增 packages/app/src/styles/sidebar.ts，导出 `SIDEBAR_LABEL_OPTICAL_OFFSET` 与 `sidebarLabelStyles.{title,row,rowHighlighted}`。`SidebarNavMenuTrigger` 的标题层与四个导航行（`SidebarHeaderRow`）的标签层都从这里取偏移，新增导航行不会漏加。偏移值由 DOM 实测决定（probe19，六行一致）：无偏移时标签的 ink box（罩住 cap height **和** workspace/History/Schedules 的降部）中线比图标中心低 1px，因此取 -3，让 cap band 落在图标中心上方 1px、x-height band 落在下方 0.5px，两者夹住图标中心。
5. **折叠时底线对齐**：移除了 `sidebarHeaderArea` 的额外 `paddingBottom`（它破坏了 row + hairline = `HEADER_INNER_HEIGHT` 这个不变量），折叠时底部分隔线精准落在 `36px` 基准线上，与右侧 `ScreenHeader` 的底部分隔线完全对齐。

## 验证

- typecheck 通过；lint 0/0（含全仓 lint，complexity 22→提取 helper 后通过）。
- vitest：new-workspace-initial-context.test.ts (19) + use-settings/storage.test.ts (68) 全过。
- packages/app/e2e/browser/sidebar-workspace.spec.ts：label 移出 trigger 后，两处 `trigger.getByText("BySpace")` 改为 `page.getByTestId("sidebar-nav-menu-label")`，并与角行（`trigger.locator("xpath=..")`）中心比对居中——断言的仍是"相对整个 sidebar 行居中"，不是相对按钮。
- packages/app/e2e/browser/sidebar-workspace.spec.ts 全绿：21 passed（2.0m）。
- 浏览器实测（agent-browser，DOM 几何）：标签中心 159.5 vs sidebar 中心 160（trigger 中心是 174，所以"相对按钮居中"会偏 14px）；chevron 右缘 299 / sidebar 右缘 320；折叠态 sidebar hairline bottom = 36 = 右侧 ScreenHeader hairline bottom。
- 待人工 e2e：默认 host picker 行为。
