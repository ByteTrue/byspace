---
kind: issue
title: "工作区：标签页和分屏、对话、输入框、终端、文件、Diff、PR、代码审查"
type: feature
created: 2026-11-01
---

# 工作区：标签页和分屏、对话、输入框、终端、文件、Diff、PR、代码审查

## 目标与范围

把旧版工作区页面（`packages/app/src/app/h/[serverId]/workspace/[workspaceId]/index.tsx` 和 `screens/workspace/`）在 `web/` 里做全，对照基线是旧版 8081 的实际行为。

从这条路由能走到的依赖 React Native 界面的文件有 177 个、约 6.6 万行。分批做，每批一个提交，每批做完 8082 都能用：

1. **框架**：工作区页面本身（顶栏、标题、脚本按钮、在编辑器中打开、Git 操作按钮、右侧面板开关）、标签栏（拖拽排序、右键菜单、关闭、新建标签菜单）、分屏（拖拽标签到边缘分屏、拖动分隔条）、右侧文件面板的框架和页签、各种门禁页（主机离线、工作区不存在、恢复）、手机上的标签切换。面板通过面板注册表接入（`panels/register-panels.ts` 的覆盖），这一批先接对话面板（第 1 步的对话和输入框），其余面板显示「这个面板在本步后面的批次迁移」。
2. **对话**：消息、思考、工具调用（详情按工具类型展示，不是原始 JSON）、权限请求卡片、问题表单、计划卡片、子 agent、回退菜单、附件、上下文用量、Markdown（代码高亮、文件链接、Mermaid）。
3. **输入框**：模型、模式、思考等级选择，附件和图片，斜杠命令和 @ 文件补全，草稿、导入、引导和打断、排队消息。
4. **终端**。
5. **文件**：文件树、文件预览和编辑器、图片和 Markdown 预览。
6. **Diff**：工作区改动、改动树、提交 Diff、提交列表。
7. **PR 面板和代码审查**。
8. **其余面板**：新建标签启动器、安装脚本面板、插件面板。

动手前先读旧版对应文件，界面用 shadcn 组件重写，逻辑用共享代码；共享模块里引到 React Native 界面的，在 `web/src/overrides/` 覆盖，对外接口不变。

## 验证

- 每批做完和旧版 8081 并排截图对照，浅色深色各一张，挑出来的放 `screenshots/web-step3/`；全部对照截图（拼图、原图、裁图和生成脚本）放 `screenshots/对照全集/`，留作以后调布局的参考，不删。
- 每批涉及的操作逐项在浏览器里做一遍，结果写进执行记录。
- 关键元素带上旧版的 `data-testid`。
- `npm run typecheck`、`npm run lint`、`npm run format:check` 通过。

## 执行记录

### 2026-11-01 第 1 批：工作区框架

工作区页面换成旧版的 `WorkspaceScreen`（`overrides/screens/workspace/workspace-screen.tsx`）：逻辑原样保留，只把视图从 React Native 换成 DOM 和 Tailwind。路由 `/h/:serverId/workspace/:workspaceId` 用旧版的路由文件（打开意图、工作区卡片保留），第 1 步临时写的 `web/src/workspace/workspace-page.tsx` 删除。

这一批用 shadcn 重写的部分：顶栏（标题、项目名、主机徽标、工作区菜单、Git 操作按钮、Open 按钮、脚本按钮、右侧面板开关）、桌面标签栏（量出标签文字宽度后交给旧版的标签布局算法，拖拽排序、提示、右键菜单、关闭按钮、中键关闭）、分屏（`split-container`：拖标签到边缘分屏、分隔条拖动、最大化、右侧面板停靠）、右侧面板的页签栏、新标签启动页、各种门禁页（连接中、主机离线、工作区已归档或不存在）、手机上的标签切换（底部抽屉）。

公共组件补了网页版：菜单引擎（`components/ui/menu`，下拉和右键共用）、提示气泡、按钮、加载圈、快捷键、图标按钮外框、窗格工具栏、横向滚动渐隐；`react-native-svg` 和 `react-native-unistyles` 的读主题部分有了网页替身，旧版 22 个 SVG 图标文件和用主题给图标上色的写法原样可用。`react-native-unistyles` 的替身故意不提供 `StyleSheet`：用 React Native 画界面的模块在新前端里编译不过，必须写网页版覆盖。

各面板接在旧版的面板注册表上：对话面板用第 1 步的对话；文件、Diff、终端、PR、安装脚本、子 agent、新建 agent 面板先显示「本步后面的批次迁移」。

和旧版逐项对照（同一个开发版 daemon，8081 和 8082 同视口同操作，截图在 `screenshots/web-step3/`）：切换标签、标签提示（标题、agent 编号、最近活动）、右键菜单 8 项、新建标签菜单、⌘T 新标签启动页、向右分屏、拖动分隔条（556/556 → 362/749，和旧版一致）、最大化和还原、右侧面板开关和页签、工作区菜单、关闭标签、拖拽标签排序、新建 agent 标签、深色主题、手机标签切换和工作区菜单。两边结果一致，控制台没有错误。

已知差异：

- 拖标签到窗格边缘分屏，在两边用脚本模拟拖动都没有触发（拖动中的标签浮层两边都出现），需要手动确认。
- 用 Mock 模型建的 agent 打不开时，旧版显示「Failed to load agent」和重试按钮，新版一直转圈。对话面板在第 2 批整体迁移，到时按旧版处理。
- 手机标签切换抽屉的标题左对齐、每行的 ⋯ 菜单都在，和旧版的底部面板一致；抽屉的拖动手柄是 shadcn 样式。

### 2026-11-01 第 2 批：对话

对话面板换成旧版的 `AgentPanel` 和 `AgentStreamView`（`overrides/panels/agent-panel.tsx`、`overrides/agent-stream/view.tsx`）：加载和查找状态、重连提示、清除提醒、历史同步、归档、子 agent 和任务、回退后恢复草稿、工具调用分组和详细程度、嵌套 codemode、聊天大纲、历史分页都是旧版逻辑，只换视图。这类大文件用 `web/scripts/port/` 下的脚本从旧版生成（逐段替换视图，替换不上就报错；第 1 批的工作区页面和分屏也补进去了），旧版改了就重跑脚本再 `npm run format:files`，不要手改生成结果。第 1 步临时写的对话（`web/src/agent/agent-conversation.tsx`、`stream-item.tsx`、`markdown.tsx`）和它用的 shadcn 聊天组件（bubble、message、message-scroller、trace、collapsible）删除，`@shadcn/react` 依赖一并去掉：滚动、锚定底部、历史窗口这些行为在共享的 `agent-stream` 里，换成 shadcn 的消息滚动组件就得重写这部分逻辑。

这一批重写的视图：用户消息（图片和附件、悬停显示时间、回退菜单、复制）、助手消息（按块渲染、匀速显示、超长截断提示）、工具调用（标题行、运行中闪光、按工具类型展开：命令和输出、编辑的 Diff、读写文件带行号和高亮、搜索、抓取、子 agent、BySpace 工具字段、思考自动跟随到底）、手机上点工具调用从底部弹出详情、一组工具调用折叠成一行、计划卡、权限请求卡（批准和拒绝按钮）、问题表单（多题页签、单选多选、补充文字）、通知、自定义消息、上下文压缩分隔线、任务和子 agent 的输入框上方小标签及弹出面板、改动行数标签、回合结束行（复制、分叉菜单、用时）、运行中的六点加载动画和计时、回到底部按钮、全部折叠按钮、聊天大纲、悬浮滚动条、归档后的「取消归档」、拖放文件的遮罩、图片查看器（缩放、Esc 关闭）。

Markdown：markdown-it 的输出转成和旧版一样的节点树（`web/src/markdown/ast.ts`，节点类型、key、列表标记、复制标记都对齐旧版，共享的列表编号和复制逻辑原样可用），再渲染成 DOM（`web/src/markdown/render.tsx`），样式数值照 `styles/markdown-styles.ts`。代码块用 `@bytetrue/highlight` 高亮、悬停出复制按钮；行内代码里的文件路径可以点开；Mermaid 图在沙箱 iframe 里画，可缩放、看源码、全屏。代码配色跟随设置里的代码主题（之前固定是 GitHub 配色，和旧版的 One 不一样，已改）。

验证（8081 和 8082 同一个开发版 daemon，Mock 模型建的 agent，截图 15–27）：

- 对话首屏和底部、展开 Read 和思考、深色，两边一致。
- 回退菜单 3 项、复制用户消息（剪贴板内容正确）、分叉菜单 2 项、展开两个工具调用后全部折叠、上翻出现回到底部按钮并能回到底部。
- 计划卡点拒绝后卡片消失；问题表单两题依次作答提交后表单消失。
- 发一条消息：运行中显示加载动画、计时和停止按钮，结束后出现复制、分叉和用时。
- 选中一段助手回复复制，两边剪贴板里的 Markdown 完全一样。
- 助手回复里的图片能显示，点开是图片查看器，Esc 关闭。
- 任务面板宽度和旧版一致（之前比旧版窄、文字被截断，已改：下拉面板没给宽度时按内容宽度）。
- 手机尺寸：对话、点工具调用弹出详情。
- Markdown 样例（标题、粗斜体、删除线、行内代码、链接、引用、有序和嵌套列表、表格、代码块、Mermaid、分隔线）浅色深色各一张；代码块复制、Mermaid 缩放、全屏、Esc 退出、看源码再切回图都试过。Mock 模型不输出代码块和表格，这部分是在一个临时页面里用真实组件渲染的，页面没有提交。
- 控制台没有错误；`npm run typecheck`、`npm run lint`、`npm run format:check`、`vite build` 通过。

还没做的（第 3 批已做完，见下）：

- 输入框还是第 1 步的文本框（发消息、引导或打断、停止可用）。模型、模式、思考等级、附件、斜杠命令、@ 文件、排队消息在第 3 批；所以往输入框拖文件目前没有反应（旧版会加成附件）。
- 新建 agent 标签页还是占位，第 3 批随输入框一起做。
- agent 配置（profile）的编辑弹窗和设置分区没迁移：草稿模型只引用了它的类型和取数据的 hook，界面在第 4 步设置里做。

已知差异：

- 表格的列对齐（`:---:`、`---:`）两边都不生效，旧版就是这样，没改。
- 用户消息附件的缩略图没验到：用旧版发的带图消息，在两边的对话里都只显示文字。（第 3 批用新输入框发了带图消息，气泡里的缩略图正常。）

### 2026-11-01 第 3 批：输入框

输入框换成旧版的 `Composer`、`MessageInput`、agent 控件条和新建 agent 标签页（`overrides/composer/index.tsx`、`composer/input/input.tsx`、`composer/agent-controls/index.tsx`、`composer/draft/workspace-tab.tsx`），agent 配置的编辑弹窗也一起迁了（`overrides/agent-profiles/settings/agent-profile-edit-modal.tsx`）。这 5 个文件用 `web/scripts/port/` 下同名脚本从旧版生成：草稿、附件、GitHub 链接、斜杠命令和 @ 文件补全、排队、发送和引导打断、键盘动作、输入框高度、输入法、粘贴图片、控件密度、配置的应用和编辑都是旧版逻辑，只换视图。第 1 步临时写的输入框（`web/src/agent/agent-composer.tsx`）删除。

手写的网页版：模型选择（`components/model-browser.tsx`、`combined-model-selector.tsx`：配置区、按提供方下钻、全局搜索、加载和出错、悬停出「新建配置」）、窄输入框的「模型 · 思考」按钮和它的面板（`composer/agent-controls/model-sheet.tsx`）、控件按钮和下拉选项（`control.tsx`、`option-control.tsx`）、`Combobox`（桌面是弹出层，手机是可拖到两个高度的底部面板）、补全浮层、上下文用量圈、弹窗外框、表单字段、选择框、开关、状态徽标、能粘贴图片的文本框、配置的图标和颜色选择。剪贴板替身补了读图片（附件菜单的「粘贴图片」）。

菜单：旧版标了 `compactMode="sheet"` 的菜单在手机上是底部面板，子菜单变成带返回的下一页。菜单引擎（`components/ui/menu`）和侧栏用的 shadcn 菜单（`~/components/adaptive-menu`）都按这个规则做了：附件菜单、侧栏显示偏好（含子页）、项目菜单、工作区菜单，右键菜单在手机上也是底部面板。

顺带修的：

- 去掉了 `StrictMode`。开发模式下它把每个 effect 多跑一遍卸载，共享代码里的配置表单在卸载时关闭、再挂载时不会重开，结果配置弹窗里改什么都不生效。旧版没开 `StrictMode`，共享代码按 effect 只跑一次写的。
- 带提示气泡的按钮点击无效：提示气泡的触发器会换掉按钮自己的 `onClick`，思考等级按钮点了不打开。`Button` 和 `ComboboxTrigger` 改成两个都执行。
- 手机上的底部面板按停靠高度给内容定高，模型面板底部的控件列表不再落在屏幕外。

验证（8081 和 8082 同一个开发版 daemon，Mock 模型，截图 28–52）：

- 桌面：输入框静止、多行变高、斜杠命令（上下键选择）、@ 文件、模型选择（搜索、进入提供方、悬停提示）、思考等级、模式、附件菜单、新建 agent 标签和它的模型选择、深色，两边一致。
- 端到端（新版）：附件菜单选图片 → 出现在输入框 → 发送，气泡里有缩略图，运行中有停止按钮；运行中按 ⌘Enter 排队，输入框上方出现排队条（编辑、立即发送），这一轮结束后自动发出；新建 agent 标签选 Mock Load Test 的 Ten second stream 发消息，建出 agent、切到它的标签、正常流式回复。
- 拖图片到对话上出现「Drop files here」，松手后加进输入框；往输入框粘贴图片也加进去，两边一致。
- 从模型行的「+」新建配置：弹窗里名称、提供方、模型、模式、思考都带上了；选颜色后弹层不关、图标跟着变色，选图标后关闭并更新。
- 手机：输入框、「模型 · 思考」面板、点模型进入第二层选模型、附件面板、侧栏显示偏好面板和子页、项目菜单。
- 控制台没有错误；`npm run typecheck`、`npm run lint`、`npm run format:check` 通过。

已知差异：

- 配置颜色色块：旧版在浅色主题下画出来的是 `styles/identity-colors.ts` 里深色主题那套颜色（实测紫色是 `#a392d5`，浅色那套是 `#6d49b5`），新版按浅色主题用浅色那套，色块比旧版深一些。

没验到的：

- 手机上长按侧栏行打开菜单：两边的代码都靠浏览器的 contextmenu 事件（Android 长按会触发，iOS 不会，iOS 上用行尾的 ⋯），无头浏览器模拟不了长按，需要真机确认。
- 附件菜单的「粘贴图片」读系统剪贴板，要浏览器授权，无头浏览器里没测；直接往输入框粘贴图片测过。

### 2026-11-01 第 4 批：终端

终端面板和终端窗格换成旧版的 `TerminalPanel` 和 `TerminalPane`（`overrides/panels/terminal-panel.tsx`、`overrides/components/terminal-pane.tsx`，用 `web/scripts/port/terminal-pane.py` 从旧版生成）：连接流、断线重连后回放、尺寸认领、焦点、按键和修饰键、粘贴文字和图片、复制、本地文件链接、手机按键行都是旧版逻辑。xterm 本体（`components/terminal-emulator.tsx`）是旧版原文件：它是 Expo 的 `"use dom"` 组件，在浏览器里本来就是普通组件，新前端补了 `expo/dom` 的替身（`web/src/shims/expo__dom.ts`，`useDOMImperativeHandle` 就是 `useImperativeHandle`）就能直接用。网页版重写的只有窗格外框、断开提示、加载遮罩、出错行、手机按键行和「粘贴」「复制」按钮。

旧版窗格里有两段在网页上本来就不起作用，没有搬：跟随系统键盘高度的内边距（`react-native-keyboard-controller` 在网页上不报告键盘，浏览器自己会为屏幕键盘缩小页面），和有选区时屏蔽手机侧滑打开面板（新前端的手机外壳没有侧滑手势）。

验证（8081 和 8082 同一个开发版 daemon，「Coding task」工作区，截图 53–60）：

- 新标签菜单 → Terminal：起出 shell，提示符、`echo`、带颜色和粗体的输出、`ls -la` 正常。
- `seq 1 300` 长输出后滚轮上翻、回到底部；`sleep 30` 后 Ctrl+C 打断；`clear`。
- 窗口从 1440×900 改到 1100×760，`tput cols; tput lines` 两边都是 105 和 48。
- 双击选词、拖选，⌘C 复制，剪贴板内容正确；⌘V 粘贴后回车执行。
- 输出里的 `web/src/main.tsx:5` 悬停出下划线，⌘ 点击打开文件标签（文件面板在第 5 批）。
- 往终端粘贴图片：上传后把图片路径打进命令行，两边一致。
- 切到别的标签再切回来，内容还在；深色主题；关闭终端标签先确认再关。
- 手机：终端加两行按键（Esc、Tab、Ctrl、方向键、Shift、键盘开关、Alt、粘贴、Enter），Ctrl 按下后高亮。
- 控制台没有错误；`npm run typecheck`、`npm run lint` 通过。

已知差异：

- 终端字体：旧版终端里的文字是界面字体 Geist，不等宽，`ls -la` 的列对不齐。原因是旧版 `appearance/apply-root-font.web.ts` 给 `#root` 下所有元素强制设了界面字体，盖掉了 xterm 自己给行设的字体。新前端没有这条全局规则，终端用设置里的等宽字体（默认 JetBrains Mono，没有就 SF Mono、Menlo），列是对齐的。这是旧版的毛病，没有照搬。
- 关闭终端的确认：旧版网页用浏览器自带的 `confirm` 弹窗，新版用第 2 步做的确认对话框。

没验到的：

- 新标签菜单里的终端配置（Claude Code、Codex、OpenCode、Pi）会在终端里启动真实的 agent 命令行，没点；它们走的是同一个终端窗格，区别只在启动命令。
- 往终端拖文件在桌面客户端里的表现：两边的代码只认文件对象上的本机路径（`file.path`），浏览器里拖进去两边都没有反应（测过）；Wails 客户端里有没有这个字段要在客户端里确认。

### 2026-11-01 第 5 批：文件

文件树换成旧版的 `FileExplorerPane`（`overrides/components/file-explorer-pane.tsx`，用 `web/scripts/port/file-explorer.py` 生成）：列目录、展开和恢复展开状态、排序、隐藏文件、刷新、新建文件和文件夹、重命名、Duplicate、删除、复制路径、下载、加入对话、拖进输入框都是旧版逻辑。旧版树用 FlatList 只渲染可见附近的行，新版一次画出全部行；桌面上用第 1 批的叠加滚动条。

文件标签换成旧版的 `FilePane`（`overrides/file-pane/pane.tsx`，用 `web/scripts/port/file-pane.py` 生成）：读取、实时更新、编辑自动保存、磁盘冲突、重新加载和覆盖是旧版逻辑；源码视图和编辑器（CodeMirror）、HTML 预览本来就是旧版的网页文件（`.web.tsx`），原样用。网页版重写的是文件栏（大小、行数、保存状态、Vim 模式、光标、预览/源码切换）、冲突提示条、Markdown 预览外框，以及分段切换控件（`components/ui/segmented-control`，后面设置页也用）。

手机上的文件面板：旧版点右上角的面板按钮会从右侧滑出整屏面板（Changes、Files、PR 页签），新前端之前点了没有反应，是第 1 批漏掉的。这批补上 `CompactExplorerSidebarHost` 和 `CompactExplorerSidebar` 的网页版：整屏 sheet，页签和关闭按钮同旧版；Changes 页签先显示「本步后面的批次迁移」（第 6 批），PR 页签同（第 7 批）。旧版的侧滑手势没有搬，和左侧栏一样用按钮或 Esc 关闭。`mobile-panels/provider` 有了网页版：当前面板直接读面板 store，旧版那套依赖 reanimated 和手势的实现不进新前端。

下载走旧版 `download-store` 的浏览器下载分支；它引用的 `expo-file-system`、`expo-sharing` 换成网页替身，网页上走不到。

顺带修的共享问题：

- 右键菜单触发器丢掉了调用方的 `onContextMenu`，文件行右键时没有先选中该行。
- 手机上内层触发器已经打开菜单时，外层触发器（树的空白区域）又打开一个。
- 图片查看器的「缩小」「还原」在不可用时没有变淡（第 2 批漏的）。
- 菜单项打开的就地输入框（新建、重命名）拿不到焦点：Radix 菜单关闭时先拉住焦点再还给触发器。输入框改为在菜单关闭后取焦点，焦点被关闭中的菜单拉走不算离开输入框。

验证（8081 和 8082 同一个开发版 daemon，「Coding task」工作区就是本仓库，截图 61–74）：

- 文件树：根目录列表一致；展开 web、src；排序 Name → Modified → Size → Name；隐藏文件开关；行高 30px，与旧版一致。
- 右键文件行，菜单项一致；树的空白处右键只有 New file、New folder。
- Copy relative path 得到 `web/src/main.tsx`；Download 触发浏览器下载 `main.tsx`；文件行可拖（`draggable`），文件夹不可拖，两边一致。
- README.md 显示 Markdown 预览，切到 Source 是 CodeMirror 源码；vitest.config.ts 是带高亮的源码；index.html 是 HTML 预览（页面里的脚本被预览的 CSP 拦下，两边控制台都有这条，属预期）；hero-mockup.png 是图片查看器，缩放按钮状态一致。
- 写操作（在仓库根目录建临时文件，做完删除）：工具栏和空白处右键新建文件，新建后自动打开；源码视图里输入后出现未保存点，自动存盘后磁盘内容一致；有未保存修改时外部改写磁盘，出现「Changed on disk」提示条，Reload 确认后读回磁盘内容；重命名、Duplicate（生成 `… copy.md`）、删除（确认对话框）；新建文件夹再删除。两边逐条一致，结束后仓库里没有残留。
- 深色主题。
- 手机：面板按钮打开整屏面板，Files 页签的树，点 README.md 打开预览并收起面板；文件行的菜单以底部 sheet 打开（用 contextmenu 事件模拟长按）。
- 控制台没有新增错误；`npm run typecheck`、`npm run lint` 通过。

已知差异：

- 右键菜单靠近右边缘时，旧版贴着点击位置往里挪，新版（Radix）翻到点击位置左边。
- 重命名输入框聚焦时，旧版有浏览器默认的焦点框，新版没有。
- 记一个两边一致的行为：没有未保存修改时文件在磁盘上被改写，3 秒内编辑器都没有换成新内容。

没验到的：

- 手机上真实长按：无头浏览器的触摸长按两边都不出菜单。新版靠 contextmenu 事件，Android 浏览器长按会发，iOS 不发，需要真机确认（同第 3 批的侧栏）。
- 从文件树拖文件到输入框：拖拽源两边一致，没有用脚本模拟拖放。
- 编辑器的 Vim 键位：在设置里打开，设置页在第 4 步，没测。

### 2026-11-01 第 6 批：Diff

Changes 视图和 Diff 面板换成旧版的 `ChangesSurface` 和 `diff-panel`（`overrides/git/diff-pane.tsx`、`overrides/panels/diff-panel.tsx`，用 `web/scripts/port/diff-pane.py` 生成）：分支和 PR 行、Uncommitted/Committed 模式、工具栏（刷新、选项菜单、全部折叠、分栏、空白、换行）、改动树（文件夹折叠、单子目录压缩）、提交列表、丢弃改动、Duplicate、复制路径、下载、加入对话、打开文件和在旁边打开都是旧版逻辑。画布 Diff（`git/diff-document/index.tsx`、`surface.web.tsx`）本来就是旧版的网页文件，用 `web/scripts/port/diff-document.py` 复制过来，只改两处：引用走 `@/`，好让文件头和评审用网页版；包住画布的右键触发器改成纵向 flex（旧版是 React Native 的 View）。绘制、点击定位、选区、横向滚动、吸顶文件头都没动。

网页版重写的：文件行（改动树里的行，以及画布文件头上面那层透明的点击层）、文件夹行、提交列表和提交行、分支切换、树栏（拖左边缘调宽，松手才存）、工具栏标签按钮、改动类型图标、Diff 过大提示、行内评审（行上的「+」、评论列表、输入框，⌘Enter 保存，Esc 取消）。改动树一次画出全部行（旧版 FlatList 只画可见附近的），和第 5 批的文件树一样。手机上文件面板的 Changes 页签换成真的 Changes 视图（第 5 批是占位）。

顺带修的共享问题：提示气泡在点击后又弹出来。点 Diff 的分栏按钮后，新标题「Switch to unified diff」的提示一直挂着：指针移入时提示刚打开，紧接着的按下要关它，而 Radix 拿关闭请求和 `open` 属性比较，属性还没跟上，于是没关。改成按下时直接关掉，并且在指针离开前不再打开，和旧版提示气泡一样。

验证（8081 和 8082 同一个开发版 daemon；未提交改动用「Coding task」工作区，也就是本仓库；提交相关的用一个临时仓库的 worktree `zz-feature`，比 main 多两个提交、外加一处未提交改动；截图 75–94）：

- 改动树：行数一致；文件夹收起展开；文件右键菜单 8 项一致；模式菜单（Uncommitted、Committed main -> base）；选项菜单（Open Diff tab、Inline diff）；分支切换的分支列表一致。
- 点树里的文件打开 Diff 标签并定位到该文件；文件头悬停；文件头右键菜单 7 项一致。
- 行内评审：悬停一行出现「+」，点开输入，⌘Enter 保存后评论显示在该行下面，再删除，两边一致。
- 分栏和切回、全部折叠和展开、自动换行（长行折成 3 行）、选项菜单的 Open Diff tab、刷新（进行中按钮不可点）、右键 Open to the side（右侧新开一个窗格）、深色主题。
- 提交列表：两个提交的 sha、标题、时间，标题行 34px、提交行 26px，和旧版一致；点提交打开 `adb751c` 的提交 Diff，里面的分栏切换；Committed 模式的改动树是 `src/farewell.ts`、`items.ts`、`greet.ts`；打开 Inline diff 后侧栏改动树下面直接显示 Diff。
- 右键 Open file 打开文件标签；Discard changes 弹确认，确认后磁盘上的文件恢复、改动树更新。
- 手机：文件面板的 Changes 页签（分支、模式、Diff、提交列表），点提交打开提交 Diff。
- 控制台没有错误；`npm run typecheck`、`npm run lint`、`vite build` 通过。

已知差异：

- 丢弃改动的确认：旧版网页是浏览器自带的 `confirm`，新版是确认对话框（同第 4 批关闭终端）。
- 隐藏空白（Hide whitespace）两边都没有效果：按钮状态会变，Diff 不变。原因在 daemon：`internal/server/ws_agent.go` 的 `checkoutDiffFiles` 只读比较模式和 baseRef，协议里的 `ignoreWhitespace` 没传给 git。不是前端问题，没在这一批改。（2026-11-01 已在[快改](../../../issues/2026-11-01-x-ff-daemon-fixes-from-web-rewrite.md)修好，两边都生效。）

没验到的：

- 需要代码托管平台的部分：Changes 头部的 PR 链接、`gh`/`glab` 没装或没登录时的设置提示。PR 面板在第 7 批，到时一起看。
- Diff 过大的提示没有触发过。
- 从文件头拖文件到输入框：拖拽源两边一致，没有用脚本模拟拖放。

### 2026-11-01 第 7 批：PR 面板和代码审查

PR 面板换成旧版的 `PullRequestPane`（`overrides/git/pull-request-panel/pane.tsx`，用 `web/scripts/port/pull-request-pane.py` 生成）：刷新、检查详情、把评论/评审/讨论串/检查日志加入对话、Add all to chat、活动折叠状态、GitLab 的审批和流水线接入点都是旧版逻辑。网页版重写的：检查区（结果环、按状态分组、组折叠、超过约 8 行就在区内滚动）、分区和汇总小标、加载骨架、出错重试、无 PR 空状态、活动卡片（评论、评审、讨论串和回复、⋯ 菜单悬停才显示、手机上常显，`web/src/pull-request/activity-cards.tsx`）、GitLab 的审批徽标和流水线区（`overrides/git/forges/gitlab.view.tsx`）。

「代码审查」部分：Diff 里的行内评审（第 6 批）写下评论后，输入框上方出现「Review N comments」附件，移除附件即清掉；这条链路用的是旧版共享代码，这一批验证过。

顺带补上和修掉的：

- **命令面板的「当前工作区」命令**：新前端之前没挂 `CommandCenterWorkspaceActions` 和 `WorkspaceRenameHost`（外壳那一步留到第 3 步的），现在 ⌘K 在工作区里有 Workspace actions（New agent、Commit、Pin to top 等），⌘K 搜 rename 能改名。副作用和旧版一样：打开工作区就开始查 PR 状态，手机上点开文件面板时 PR 页签立刻就在（之前要等 3 秒）。
- **按钮的 `leftIcon` 传 lucide 图标会整个页面报错**：网页版 `Button` 把「是对象」当成「是元素」，而 lucide 图标是 forwardRef 对象，结果把组件本身当子节点渲染。改成判断 `isValidElement`（`overrides/components/ui/button.tsx`）。
- **daemon：GitHub 的 PR 状态被客户端整条拒收**（`internal/workspace/forge.go`，单独提交）。Go 版 `GetPRStatus` 的 GitHub 分支是个桩：不返回协议必填的 `isMerged`，检查恒为空，`mergeable` 和 `reviewDecision` 写死。客户端按协议校验失败，整条 `checkout_pr_status_response` 丢弃，于是两个前端在 GitHub 仓库上都看不到任何 PR（Changes 头部没有 PR 链接、没有 PR 页签），合并后自动归档也读不到 `isMerged`。照 Node 的 `toCurrentPullRequestStatus` 重写：`gh pr view` 多取 `mergedAt` 和 `statusCheckRollup`（没有检查权限时退回不带检查的字段），合并判定、检查去重（同名取最新一次）、耗时、检查汇总、评审结论、仓库 owner/name 都按 Node。加了单元测试；`npm run audit` 通过（浏览器一项是 bsk 会话冲突，两项实际检查通过）。开发版 daemon（6778）已用新二进制重启，6777 没动。

验证（8081 和 8082 同一个开发版 daemon；PR 用两个临时仓库的 worktree：分支名对上 ByteTrue/byspace#16，已合并、25 个检查、1 条评论；以及对上 cli/cli#14798，6 条评审；截图 95–108）：

- Changes 头部出现 `#16` 链接，点开右侧 PR 页签：标题、Merged、仓库名、「18 successful, 7 skipped checks」，分组 18/7，组折叠和检查区折叠，点检查行打开对应的 Actions 页面，View 打开 PR 页面。
- 评论卡片：悬停出 ⋯，菜单 Add to chat / Copy / Open on GitHub，Copy 拿到原文 Markdown，点卡片头折叠正文，Add to chat 后输入框出现「ByteTrue Comment」附件。
- cli/cli#14798：4 张评审卡片的作者、动作（reviewed、approved 带绿勾）、时间、正文和 `<details>` 折叠块一致，点卡片头折叠。
- 新建标签菜单里的 Pull request 打开 PR 标签页（标签名 `16`），内容和右侧面板一致。
- 检查区标题行和旧版一样高（60px）；手机上文件面板的 PR 页签和旧版逐像素一致。
- 深色主题；控制台没有错误；`npm run typecheck`、`npm run lint`、`vite build` 通过。

已知差异：

- 旧版评论正文里的长行会超出卡片右边被截掉，新版正常换行，所以新版卡片更高。
- 旧版切换深色主题后评审卡片的折叠状态会复原，新版保留。

没验到的：

- 讨论串（代码行上的评审评论、Resolved/Outdated 标记、回复、整串加入对话）：Go daemon 的 PR 时间线只取评审和普通评论，不取讨论串（Node 用 GraphQL 的 `reviewThreads`），两个前端都显示不出来。daemon 的问题，记成待办，没在这一批改。（2026-11-01 已在[快改](../../../issues/2026-11-01-x-ff-daemon-fixes-from-web-rewrite.md)改成 Node 的 GraphQL 查询，cli/cli#14798 的讨论串两边都能显示、折叠、加入对话。）
- 检查日志加入对话（只有失败的检查有这个按钮，测试用的 PR 检查全部通过）。
- GitLab 的审批徽标和流水线区（需要 GitLab 仓库和 `glab`）；`gh` 没装或没登录时 Changes 里的设置提示。
- 无 PR 时手动打开 PR 页签的空状态、加载失败的重试页。

### 2026-11-01 第 8 批：其余面板

范围里的三样：新建标签启动器第 1 批已经做完；插件面板在旧版里就是空的（`plugins/workspace-panels/panel.ts` 注册的是 `null`，没有任何插件面板），不用做；剩下安装脚本面板。

安装脚本面板换成旧版的 `SetupPanel`（`overrides/panels/setup-panel.tsx`，用 `web/scripts/port/setup-panel.py` 生成）：拉取安装状态、正在跑的那条自动展开、手动折叠后不再自动展开、`\r` 进度输出只留最后一段、外部 PR 检出的工作区被拦下时的提示和「运行」按钮，都是旧版逻辑。公共的 `Alert` 换成 shadcn 的 Alert（`overrides/components/ui/alert.tsx`，接口不变），设置页等其他地方以后也用它。

有意改的一处：失败命令下面的错误卡片，旧版在深色主题下也是浅粉底红字，在一片深色里很刺眼；新版深色主题下用深红底浅红字，浅色主题不变。

验证（临时仓库 `zz-diff-repo` 加了 `byspace.json` 的安装命令后建了两个 worktree：`zz-setup-ok` 三条命令都成功，含一条带 `\r` 的进度输出；`zz-setup-fail` 第二条命令写 stderr 后 `exit 3`；建完已从 main 去掉安装命令；截图 109–111）：

- ⌘K 搜 setup 出现 Show setup，回车打开 Setup 标签。
- 成功的：三行命令和耗时（1s、19ms、2s），最后一条自动展开显示 `setup done`；进度输出那条只显示最后的 `progress 100%`。
- 失败的：第一行绿勾、第二行红色叹号并自动展开，日志是 stdout 和 stderr 两行，下面是错误卡片「setup command failed: …」；没跑到的第三条不显示，和旧版一致。
- 点行展开和收起；行高 36px、失败那项 143px，和旧版一致；深色主题。
- 控制台没有错误；`npm run typecheck`、`npm run lint` 通过。

没验到的：

- 安装正在跑时的实时刷新（两个 worktree 截图时都已跑完）。
- 外部 PR 检出被拦下的提示（需要从别人的 fork 检出 PR）。
- 手机上的安装脚本面板（手机没有 ⌘K，要从标签切换里打开，没做）。
