---
kind: issue
title: "全量 UI 审计与做工精细化（对齐基线、呼吸空间与视觉韵律）"
type: refactor
status: closed
created: 2026-09-21
---

# 全量 UI 审计与做工精细化（对齐基线、呼吸空间与视觉韵律）

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。  
> **自检：** 目标与范围 · 背景与当前证据 · 根因分析 · 影响面 · 方案/设计 · 验证与交付记录。

---

## 做成以后是什么样

1. **水平线基准完全贯通（消除 10px 错位 Bug）**：
   - 修复右侧 Explorer 侧栏顶部 TabRail 因 Electron 遗产样式（`{ flex: 1 }`）导致的高度塌陷（从 26px 恢复为规范的 36px）；
   - 左侧主区域第一行（ScreenHeader 36px）与右侧第一行（Explorer TabRail 36px）底部分割线在 `y = 36px` 处**严格对齐**；
   - 左侧主区域第二行（Workspace Tabs 36px）与右侧第二行（Branch 工具栏 36px）底部分割线在 `y = 72px` 处**严格对齐**；
   - 核心工作区内容（聊天流水）与右侧检视内容（Changes / Files 主体）统一自 `y = 72px` 起跑。

2. **多处呼吸感充盈、消除紧迫拥塞感**：
   - **Explorer Tabs（右侧）**：高度恢复 36px 后获得 5px 垂直呼吸缓冲，Tab 内左右 padding 与文字图标间隙由过紧的 8px/4px 调优为更加适宜的 10px/6px；
   - **Workspace Tabs（中间）**：Pi/Agent 图标与名称的间距由 4px 提升至 6px，水平 padding 由 8px 提升至 10px，文字与图标不再粘连；
   - **Workspace Header（顶部）**：工作区标题与所属项目副标题（如 `ByIssue`）增加轻量胶囊/衬底或更清晰的视觉分隔，避免误读为一长串连体字；
   - **Changes 面板工具栏与 Banner**：
     - `Run gh auth login` 提示卡片补齐与上方工具栏底边的 `marginTop: 8px`，不再贴底边硬悬挂；
     - 差异/分支工具栏控件内边距优化，去除多层紧贴压迫感；
   - **左侧导航侧边栏（主侧边栏）**：
     - "Workspaces" 分组标题与上方快捷导航底边分隔线之间拉开合理间距（由 4px 增至 10px），建立清晰的分组节奏；
   - **设置页（Settings）做工精雕**：
     - Appearance 中的侧边栏重排序按钮（`↑` `↓`）优化为精致规整的图标按钮组或分段控件，消除暗色模式下散落漂浮的纯文本箭头感；
     - `Interface font` 长字体族配置行优化输入体验，避免在狭窄的右侧 280px 小框内严重截断；
     - Settings 侧栏选中项与悬停态优化层次区隔。

**范围：**

- `packages/app` 核心界面视觉与排版：工作区外壳、头部、标签栏、侧边栏、Changes 面板、设置面板；
- 遵循 `docs/design.md` 设计系统和 `impeccable` 规范；
- 不破坏任何既有交互逻辑、快捷键、拖拽重排和协议通信契约。

---

## 为什么现在做 / 当前坏在哪

用户在实际使用中反馈整个 UI 看起来别扭，特别是右侧线条未对齐左边，各处呼吸空间留白不足。通过对 2x Retina 截图实测与代码审查，发现以下确切问题：

1. **基线错位 10px（P0 视觉 Bug）**：
   - 测量证据：中间栏两条底边分别位于 `y = 71px (35.5pt)` 与 `y = 143px (71.5pt)`；而右侧两条底边分别位于 `y = 51px (25.5pt)` 与 `y = 123px (61.5pt)`。右侧整整向上缩进 10px，水平线产生明显错位台阶。
   - 根因：`explorer-sidebar-tab-rail.tsx` 引用了退役 Electron 遗留的 `titlebarDragSurfaceStyle = { flex: 1 }`，在 RN Web 列式弹性盒中父级未设固定高度时，导致子容器高度直接塌缩成 Tab 控件自身的高度（26px），声明的 36px 高度失效。
2. **Tab 极度紧迫（0px 垂直留白）**：
   - 26px 高的 Tab 塞在塌缩为 26px 的栏内，直接贴在窗口上沿和分割线上。
3. **多处元素粘连与零间隙**：
   - Tab 栏内图标与文字 gap 仅 4px；
   - Changes 视图中 `forgeSetupCallout` (`Run gh auth login...`) `marginTop: 0`，与上方 toolbar 分割线零距离粘连；
   - 左侧栏 "Workspaces" 标题距上方分割线仅 4px；
   - 设置页 Sidebar 重排序箭头裸露飘移。

---

## 动哪些、验哪些

### 必须改的文件：

1. `packages/app/src/screens/workspace/explorer-sidebar-tab-rail.tsx` — 清除 `titlebarDragSurfaceStyle`，规范 Tab 间距与高度；
2. `packages/app/src/screens/workspace/explorer-sidebar.tsx` — 为 `tabRail` 容器显式约束 `height: WORKSPACE_SECONDARY_HEADER_HEIGHT`；
3. `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx` — 优化中间 Tab 的 padding 与 icon-text gap；
4. `packages/app/src/screens/workspace/workspace-screen.tsx` — 优化 WorkspaceHeader 项目副标题与标题间的排版呼吸感；
5. `packages/app/src/git/diff-pane.tsx` — 优化 `forgeSetupCallout` 上边距与 Changes 工具栏内边距；
6. `packages/app/src/components/left-sidebar.tsx` — 优化 "Workspaces" 分组标题顶边距；
7. `packages/app/src/screens/settings/appearance/sidebar-nav-section.tsx` — 优化重排序按钮的做工与视觉包装；
8. `packages/app/src/screens/settings/appearance/appearance-section.tsx` — 优化字体长文本输入的宽度与排版布局。

### 需要验：

- 桌面端亮色与暗色模式下，两条横向分割线像素级贯通无错位；
- Tab 拖拽与切换功能正常；
- 单元测试、类型检查、代码风格检查全部通过。

---

## 方案与实现安排

1. **第一阶段：基准线像素级对齐**
   - 移除 `explorer-sidebar-tab-rail.tsx` 中的 `titlebarDragSurfaceStyle`；
   - 在 `explorer-sidebar.tsx` 中为 `styles.tabRail` 加上 `height: WORKSPACE_SECONDARY_HEADER_HEIGHT`；
   - 验证两侧在 36px / 72px 处的线完全重合。

2. **第二阶段：工作区与侧栏呼吸感提升**
   - 调整中间与右侧 Tab 的 horizontal padding (8 -> 10px) 和 gap (4 -> 6px)；
   - 给 `forgeSetupCallout` 增加 `marginTop: theme.spacing[2]` (8px)；
   - 左侧栏 workspacesSectionHeader 的 paddingTop 由 4px 调整至 10px。

3. **第三阶段：头部项目标识与设置页做工提升**
   - 优化 `WorkspaceHeaderProjectRow`，给项目名称更舒适的字距与视觉区分；
   - 优化 `SidebarNavRow` 中的重排序控件，改用带有微边框和触控反馈的按钮组或规整按钮；
   - 优化 `FontFamilyRow` 的布局，让长字符串在宽松宽度下平铺编辑。

---

## 验证

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- 针对修改的测试文件运行 targeted vitest
- 通过 node / sharp 脚本验证渲染后的分割线像素绝对对齐。

---

## 执行记录

1. **水平线基准完全贯通（解决 10px 错位 Bug）**：
   - 清除 `packages/app/src/screens/workspace/explorer-sidebar-tab-rail.tsx` 中旧 Electron 遗留的 `titlebarDragSurfaceStyle`（`{ flex: 1 }`），消除 flex 容器下的高度塌缩；
   - 在 `packages/app/src/screens/workspace/explorer-sidebar.tsx` 的 `styles.tabRail` 中显式指定 `height: WORKSPACE_SECONDARY_HEADER_HEIGHT`（36px）；
   - 右侧 Explorer 顶部 TabRail 与中间 ScreenHeader 高度统一为 36px，底部分割线完全贯通于 `y = 36px`，第二层（Tabs 栏与 Branch 栏）完全贯通于 `y = 72px`。

2. **工作区与侧栏呼吸感提升**：
   - `packages/app/src/screens/workspace/explorer-sidebar-tab-rail.tsx`：Tab 高度采用标准 `buttonControlHeight.xs` (28px)，水平内边距放宽为 `theme.spacing[3]` (12px)，文字与图标间距由 4px 放宽为 `theme.spacing[1.5]` (6px)；
   - `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx`：Tab 内部文字与图标间距 `TAB_CONTENT_GAP` 由 4px 提升至 6px，水平内边距 `TAB_CHIP_HORIZONTAL_PADDING` 由 8px 提升至 10px，两端 padding 由 4px 增至 6px，消除文字粘连；
   - `packages/app/src/screens/workspace/workspace-screen.tsx`：`headerProjectTitle`（如 `ByIssue`）增加轻量 `surface2` 背景、`fontSize.sm` 与圆角微胶囊，使得工作区标题与所属项目产生层次分明的视觉区分；
   - `packages/app/src/git/diff-pane.tsx`：`forgeSetupCallout`（`Run gh auth login`）增加 `marginTop: theme.spacing[2]` (8px)，不再贴着工具栏底边悬挂；
   - `packages/app/src/components/left-sidebar.tsx`：`workspacesSectionHeader` 顶部内边距调整为 `theme.spacing[3]` (12px)，`sidebarHeaderGroup` 底部内边距调整为 `theme.spacing[2]` (8px)，给工作区列表留足分组呼吸空间。

3. **设置页做工精细化**：
   - `packages/app/src/screens/settings/appearance/sidebar-nav-section.tsx`：侧边栏重排序按钮（`↑` `↓`）采用一体化 `reorderCluster` 包装（微边框 + `surface2` 背景），按钮规范为 `size="xs"`，消除深色模式下裸露散落的纯文本箭头感；
   - `packages/app/src/screens/settings/appearance/appearance-section.tsx`：`FontFamilyRow` 的 `fontFamilyInput` 最大宽度放宽至 380px，字号调整为 `fontSize.sm`，长字体族名称显示更完整且更具代码可读性。

4. **第二轮用户反馈专项推进（左侧对齐、用户气泡与浅色调色板）**：
   - **右上角文字/图标轨完全对齐**：
     - `BranchSwitcher` 与 `DiffModeMenu` 补充统一规格的前置图标（`GitBranch` 与 `FileDiff`，13px，居中）；
     - `ExplorerSidebarTabRail` 调整左侧内边距至 4px + 8px = 12px；
     - 使得右侧栏 Row 1（`Files` 标签）、Row 2（`main` 分支）、Row 3（`Uncommitted` 模式）的**前置图标完全对齐在 12px 纵向基准线上**，**文字完全对齐在 32px 纵向基准线上**，彻底消除了之前 30px 的参差不齐。
   - **底栏输入框（Composer）悬浮岛屿重塑**：
     - 彻底去除灰暗笨重的底栏大灰槽（`surface1` 灰色填充），改为**纯净白（`surface0`）**；
     - 注入精致的 `border: 1px solid theme.colors.border` 与柔和悬浮微阴影 `...theme.shadow.sm`，使其成为自然漂浮在对话上方的现代轻盈控制台；
     - 内边距收紧至更加贴合的 `paddingVertical: 12px` 与 `paddingHorizontal: 16px`。
   - **用户消息气泡（UserMessage）做工重塑**：
     - 根除上游残留的卡通对话框畸形圆角（`borderRadius["2xl"]: 16` 搭配 `borderTopRightRadius: 2` 的缺角异形怪异感），改为对称精致的 `borderRadius.xl` (12px)；
     - 剔除原本臃肿的 `padding: 16px`，调整为舒适紧凑的 `paddingHorizontal: 12px` 与 `paddingVertical: 8px`；
     - 背景色由生硬灰块升级为白底卡片 `surface0` + 1px 细微内敛边框 `border` + `theme.shadow.sm` 微阴影，与浮岛输入框保持一致的高定现代语言。
   - **彻底无保留一次性完全对齐 `DESIGN.md`（OpenCode 终端原生系统）**：
     - **全站纯等宽字体家族（100% Monospace Family）**：
       - `DEFAULT_UI_FONT_STACK` 与 `DEFAULT_MONO_FONT_STACK` 统一采用 Berkeley Mono / JetBrains Mono / IBM Plex Mono 终端字体栈；
       - 全界面彻底摆脱普通无衬线字体的混杂感，整个系统呈现出纯粹如 manpage 的极客优雅美感。
     - **4px 精准几何架构（`rounded: 4px`）**：
       - `BORDER_RADIUS` 基础阶梯统一收敛为 4px（`base: 4, md: 4, lg: 4, xl: 4, "2xl": 4`）；
       - 彻底告别所有臃肿大圆角与畸形异型角，卡片、按钮、输入框、消息气泡、徽标统一采用 4px 微圆角。
     - **纯粹黑墨调色（Ink Monochrome `#201d1d`，彻底告别所有蓝紫绿杂色）**：
       - 画布底色：温和软质表面 `surfaceSidebar: #f8f7f7`；
       - 卡片容器：`surface0: #fdfcfc`（温和纸陶白卡片）；
       - 核心主色与墨水：温润深黑墨 `ink: #201d1d`，无任何蓝紫绿杂色干扰；
       - 按钮主态：深墨底色 `#201d1d` + 纯白文字 `#fdfcfc` + 4px 圆角；
       - 分割线：细微发丝线 `hairline: rgba(15, 0, 0, 0.12)`；
       - 阴影系统：彻底消除人工模糊大阴影，贯彻 OpenCode "Nothing lifts, nothing floats" 的平面纯粹哲学。
     - **彻底消除顶栏与内容区的明度割裂（右上角和卡片同一亮度的根因修复）**：
       - `ScreenHeader` 顶栏背景设为 `transparent` 继承外壳底色 `#f8f7f7`，与左侧侧边栏顶栏连成一条完整温润的外壳基座；
       - 页面底色为 `#f8f7f7`，卡片为 `#fdfcfc`，卡片自然从底面脱出，彻底消除“顶栏白、卡片白、中间夹条灰”的斑马层级割裂。
     - **消息区与输入框**：
       - 用户消息气泡：`surface-card` (`#f1eeee`) + 发丝细线 + 4px 圆角 + 墨黑文字；
       - 底栏输入框：`surface-soft` (`#f8f7f7`) + 发丝细线 + 4px 圆角；
     - **状态徽标（StatusBadge & HostStatusBadges）**：
       - 4px 微圆角 + 纯等宽字体 `fontFamily.mono` + 2px 8px 紧凑内边距芯片；
     - **Host Overview 头部与预览槽**：
       - 主机名升级为等宽中大标题，`PREVIEW` 英文微胶囊大写提示，明确为侧栏徽标的实时预览槽。

   - **三栏顶栏贯通与标签宽度扩展（精雕细琢）**：
     - **Tab 标签栏最大宽度放宽**：将 `TAB_MAX_WIDTH` 由原先过于保守的 160px 放宽至 240px，在宽屏有大量空间时不再将普通长度的工作区/会话标题腰斩截断为 `Emit a synthe...`，多标签时自适应平滑压缩；
     - **左侧栏顶栏基线与品牌字标对齐**：左侧栏最顶栏增加 `BySpace` 品牌标题，并将 `(v main)` 分支徽标优雅固定在右侧，底边发丝线在 `y = 36px` 处与中间工作区标题栏、右侧 Explorer 标签栏三栏彻底无缝贯通；
     - **曲率统一与字体自然化落地**：正文使用高可读性系统无衬线字体，代码与终端保持纯等宽；全站统一 4px/6px/8px/12px 严谨递进几何，彻底消灭孤立的大圆形与方块的曲率冲突。

   - **边框柔化与细节精雕（解决“边框有点粗”与开发标识隔离）**：
     - **超细发丝边框落地**：
       - 查明“边框感觉有点粗”的技术根因：此前 `borderAccent` 写成了正文级深炭灰 `#646262`，导致所有外描边按钮（Edit / Restart / Commit 等）和微控件边框如同深色粗线；
       - `border` 细化为 `rgba(15, 0, 0, 0.08)` 超细发丝线，`borderAccent` 调整为自然克制的 `rgba(15, 0, 0, 0.20)`（暗色模式同步为 `#3e3a3a`），所有控件边缘锐利细致，彻底消除粗重描边感；
     - **开发分支徽标隔离与生产纯净化**：
       - `left-sidebar.tsx` 严格保留 `DEV_BUILD_LABEL` 纯开发特性，不在顶栏植入常驻标题，生产环境下侧边栏顶部直接干净衔接快捷导航行；
     - **Composer 纵向弹性呼吸感精简**：
       - 输入文字与底栏工具条之间的 `gap` 由 12px 收紧至 8px，内边距微调为垂直 8px / 水平 12px，单行短句输入时更加紧凑克制，无空旷大槽感。

   - **暗色模式（Dark Theme）全量重构与层级阶梯建立（彻底解决“黑色奇怪且无层级”）**：
     - **剔除暗红/泥棕杂色**：查明此前将 `DESIGN.md` 中用于浅色文本的墨黑（`#201d1d`）错误当成了暗色模式画布底色，导致界面泛出怪异红棕泥泞感；全面重塑为真正纯粹深邃的中性终端暗黑（`#0f1011`）；
     - **建立 5 级空间明度阶梯（解决“没有层级区别”）**：
       - 侧栏基座：`surfaceSidebar: #0a0b0c`（最深暗，稳固导航重心）；
       - 页面画布：`surface0: #0f1011`（柔和深暗承托桌面）；
       - 卡片容器：`surface1: #18191b`（微抬升 8%，卡片清晰从底面脱出）；
       - 边框分界：`border: #25272a`（1px 细微发丝边框，锐利划出卡片与行间边界）；
       - 控件交互：`surface2: #222426`（下拉按钮、输入框、微型标签自然置于卡片之上）；
       - 高对比文本：`foreground: #f2f4f6` 与 `foregroundMuted: #8a8f96`；
       - **暗色模式从底面到卡片再到控件，立体层次分明、深邃通透！**

   - **侧边栏选中与 Hover 态重塑（方案 1 全面落地）**：
     - **根除纯白“大膏药”与浮肿感**：
       - 彻底删除侧边栏条目选中时粗暴套用的纯白 `#ffffff` 大厚块与 8px 膨胀圆角；
       - `surfaceSidebarHover` 调整为柔和浅微灰 `surface2: #f0f1f3`，`surfaceSidebarSelected` 调整为内敛微灰 `surface3: #e5e7eb`（暗色模式同步为深度半透明微灰）；
     - **左侧 3px 精准指示条（Linear / VS Code 标配）**：
       - 选中时左侧绝对定位一道 3px 宽精致垂直指示条（`selectedIndicator`），文字提升为墨黑 + 字重 `Medium`，图标同步转深，瞄准基准清晰确定；
       - 条目圆角严格统一为 **4px**（`borderRadius.base`）；
     - **`< Back` 返回按钮曲率与悬停对齐**：
       - `< Back` 圆角收束为 4px，Hover 态使用统一的柔和微灰，彻底告别悬浮大白药丸。

   - **主工作区侧边栏全面装配方案 1（全站侧栏体验终极闭环）**：
     - **主工作区列表无缝对齐**：将设置页中验证优异的**左侧 3px 精致指示条 + 柔和内敛微灰选中底色 + 4px 微圆角**，全量装配进主界面左侧栏；
     - **全场景覆盖**：
       - 工作区条目（`workspaceRow`）：选中时左边缘紧贴 3px 竖线，底色柔和，文字与状态点清晰聚焦；
       - 项目条目（`projectRow`）：选中时同样呈现 3px 竖线与 4px 规整轮廓；
       - 顶部快捷导航项（`History` / `Schedules` / `< Back` 等）：激活态同步展示 3px 竖线；
     - **全站侧边栏从此在交互语言、视觉焦点和做工精度上达成 100% 绝对统一**。

   - **按钮边框与三栏分割线墨度绝对对齐（彻底解决“按钮边框比分界线粗”）**：
     - **光学错觉根因定位**：三栏分界线使用的是细微的 `border: rgba(15, 0, 0, 0.08)`，而按钮此前套用了 `borderAccent: rgba(15, 0, 0, 0.20)`；20% 墨度是 8% 墨度的整整 2.5 倍，导致在视网膜屏上经过抗锯齿渲染后，按钮的 1px 边框在视觉上比边界线粗了一倍以上；
     - **绝对对齐落地**：
       - `Button variant="outline"`（`button.tsx`）直接对齐三栏边界线 `borderColor: theme.colors.border`；
       - `ActionsSplitButton` 顶部 Commit 按钮（`actions-split-button.tsx`）边框直接对齐 `borderColor: theme.colors.border`；
       - `composerPillStyles` 胶囊边框直接对齐 `borderColor: theme.colors.border`；
       - `borderAccent` 降至极轻柔的 `0.09`（暗色模式收敛为 `#2c2e32`）；
       - **所有按钮边框的色度与细度与三栏分界线、卡片边框完全处于同一水平线，彻底告别粗黑框**。

   - **全站圆角矩形曲率终极统一排查（彻底消灭曲率打架）**：
     - **全量扫描全仓 24 处硬编码数值与 58 处 `borderRadius.full` 使用**：
       - 底栏模型切换器 `modeBadge` / `modeIconBadge`：由臃肿的 `full`（9999px）统一收敛至标准 `md: 6px`；
       - 底栏队列操作按钮 `queueActionButton` 与语音按钮 `realtimeVoiceButton`：由正圆形收束为统一的 `md: 6px` 极客小方块；
       - 底部抽屉模态 `ToolCallSheetModal`：由硬编码 16px 规范为标准 `lg: 8px`；
       - 工作区标签芯片 `chip.tsx`：由跑道大椭圆 `full` 收敛为利落精准的 `base: 4px`；
       - 文件树重试按钮 `retryButton`：由大胶囊 `full` 收束为精致规整的 `base: 4px`；
     - **曲率统一成果**：仅保留真正的圆形指示点灯（如 6px 状态小圆点与圆形用户头像）使用 `full: 9999px`，所有圆角矩形严格按照 **4px（微标/芯片）→ 6px（按钮/控件）→ 8px（卡片/气泡）→ 12px（浮岛输入框）** 严密递进，彻底杜绝方圆互冲与曲率割裂！

   - **搜索（Search）与历史（History）交互态无缝覆盖（彻底消灭全宽直角白块）**：
     - **搜索中心（Command Center）重塑**：
       - 彻底删除搜素浮窗内 0 圆角、顶天立地切断全宽的纯白生硬色块（`surface1: #ffffff`）；
       - 结果列表增加两端内嵌留白（8px），条目统一为 **4px 微圆角** + 柔和内敛选中底色（`surfaceSidebarSelected`）+ **左侧 3px 精致垂直指示条**；
       - 上下键切换或鼠标悬停时，呈现出类似 Raycast / Linear 般轻盈克制的极客浮层质感；
     - **历史列表（History / Sessions / AgentList）重塑**：
       - 桌面端条目圆角由原本的 0px 修正为标准的 **4px**（`borderRadius.base`）；
       - Hover 与选中态彻底淘汰高对比度白块，统一采用 `surfaceSidebarHover` 柔和浅浮光与 `surfaceSidebarSelected` + 3px 指示条；
     - **全站无论是工作区、设置、搜索弹窗还是历史会话列表，Hover 与选中态达成 100% 绝对一致**。

   - **CR 与 Ponytail Review 专项审查闭环（代码做工与精简瘦身）**：
     - **修复浏览器测试漂移**：更新 `status-badge.browser.test.tsx` 中硬编码的旧颜色断言，使浏览器端组件测试 100% 绿灯通过；
     - **增强无障碍与触控纯净度**：全站所有 3px 选中指示条补充 `pointerEvents="none" aria-hidden`，确保纯视觉装饰不干扰任何点击事件和屏幕阅读器；
     - **Ponytail 复杂度猎杀与瘦身（-37 lines）**：
       - 清除 `ProjectHeaderRow` 中硬编码 `selected={false}` 的死指示条分支；
       - 扁平化 `input.tsx` 中重复声明的响应式内边距；
       - 将 `settings-screen.tsx` 中动态 `useMemo` 样式抽取为标准静态 `labelSelected` 类；
       - 清除 `contentPane` 对父容器已声明背景色的重复套用；
       - `theme.ts` 抽象 `noShadow` 统一零阴影常量；
       - `host-appearance-section.tsx` 精炼固定大写 `PREVIEW` 标头。

5. **完整工程验证**：
   - `npm run typecheck`（7 workspaces）全部通过；
   - `npm run lint`（3363 files）0 errors, 0 warnings；
   - `npm run format:check`（3576 files）全部格式化合格；
   - 相关 vitest 单测（38/38）+ 浏览器组件测试（8/8）全绿；
   - `impeccable detect` 深度检测合格。

## 关闭时

- **回写到 Project Spec / Notes 沉淀**：
  - 核心设计系统与空间明度阶梯在 `packages/app/src/styles/theme.ts` 中完全固化；
  - 侧边栏统一选中态（3px 竖线 + 柔和浅灰阶 + 4px 圆角）为全站终极标准；
  - 按钮边框与三栏分割线墨度（`border: rgba(15, 0, 0, 0.08)`）严格统一；
  - 4px 终端曲率体系（4px 基础，6px 控件，8px 卡片，12px 浮岛输入框）形成全站几何契约。
- **关闭判断与验证摘要**：
  - 用户确认：“非常棒，我觉得可以收工了”；
  - 界面截图实测，亮色与暗色模式下水平线基准 100% 对齐，空间明暗层级清晰立体，粗边框与浮肿白块彻底消灭；
  - 7 工作区全量类型检查（`npm run typecheck`）0 errors，代码检查（`npm run lint`）0 warnings/errors，代码格式化检查（`npm run format:check`）全部通过，相关 38 项单测全绿通过。
- **遗留**：无。
