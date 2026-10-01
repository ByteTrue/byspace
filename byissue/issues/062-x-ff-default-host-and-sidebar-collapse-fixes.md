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
   - 标题层（`BySpace` 与工作区标题）：统一为 `fontSize.base`（14px）、`fontWeight: { xs: "400", md: "300" }`、`color: theme.colors.foreground`。
   - 徽标层（开发分支徽标 `devBuildBadge` 与项目徽标 `headerProjectTitle`）：统一为 `fontSize.sm`（12px）、`fontWeight.normal`（400）、`color: theme.colors.foregroundMuted`、`backgroundColor: theme.colors.surface2`、`borderRadius.sm`（4px），去掉了原开发徽标突兀的纯黑实心底色。
2. **箭头与文本内联贴合**：去掉 chevron 的绝对定位右靠齐，改为与 `BySpace` 文本内联排列（`gap: 4px`），形成紧凑自然的下拉标题触发器，不再出现中间突兀的大段留白。
3. **高度与中线完全对齐**：触发器按钮高度统一为 `HEADER_CONTROL_HEIGHT`（26px），与左侧折叠按钮及右侧更多按钮尺寸完全对齐；所有元素垂直中线严格锁定在 `17.5px`。
4. **折叠时底线对齐**：移除了 `sidebarHeaderArea` 的额外 `paddingBottom`，折叠时底部分隔线精准落在 `36px` 基准线上，与右侧 `ScreenHeader` 的底部分隔线完全对齐。

## 验证

- typecheck 通过；lint 0/0（含全仓 lint，complexity 22→提取 helper 后通过）。
- vitest：new-workspace-initial-context.test.ts (19) + use-settings/storage.test.ts (68) 全过。
- 待人工 e2e：折叠态对齐（第二张截图场景）、默认 host picker 行为。
