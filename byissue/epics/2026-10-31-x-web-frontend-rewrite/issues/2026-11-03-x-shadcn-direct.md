---
kind: issue
title: "界面组件直接用 shadcn：自己写的组件换成 shadcn 现成的，删掉自己的代码"
type: refactor
created: 2026-11-03
---

# 界面组件直接用 shadcn：自己写的组件换成 shadcn 现成的，删掉自己的代码

## 目标与范围

用户定的原则（2026-11-03）：shadcn 有的就直接用，尽量不自己写，尽可能减少以后的维护量；不管能不能和原来保持一样，都要换。只有 shadcn 怎么都没有、也完全找不到替代组件的，才保留自己写的。

所以外观和交互跟 shadcn 走，前几步「和旧版逐像素一致」的要求在这里不再适用。用 shadcn 组件时按 shadcn 文档的组合方式在调用处直接写，不再包一层自己的组件；状态色这类业务含义用 `className` 加在 shadcn 组件上。

shadcn 现在还有一整套对话界面组件（Message、Message Scroller、Bubble、Attachment、Trace、Code Block、Marker、Questionnaire）和基于它们的 AI Elements 写法（Chat、Tool、Reasoning、Plan、Queue、Subagent、Terminal、Confirmation、Prompt Input、Model Selector、Context、Checkpoint、File Tree），和 BySpace 的对话界面几乎一一对应，也按这个原则换。

## 对照表

| 现在自己写的                                                                                 | 结果                                                                                                                    | 批  |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --- |
| 开关 `core/components/ui/switch`                                                             | Switch                                                                                                                  | A1  |
| 分段控件 `segmented-control`                                                                 | Tabs                                                                                                                    | A1  |
| 状态徽标 `status-badge`                                                                      | Badge（状态色用 `className`）                                                                                           | A1  |
| 快捷键 `shortcut`（两份）                                                                    | Kbd / KbdGroup                                                                                                          | A1  |
| 加载圈 `loading-spinner`、`synced-loader`                                                    | Spinner                                                                                                                 | A1  |
| 提示框 `core/components/ui/alert`、各处提示条                                                | Alert                                                                                                                   | A1  |
| 外链 `external-link`                                                                         | Button `variant="link"`                                                                                                 | A1  |
| 输入框 `text-input`、`adaptive-text-input`、`form-field`、`search-field`、设置行里的输入框   | Input / Textarea / InputGroup / Field / Label（手机上保留 44px 高）                                                     | A2  |
| 按钮封装 `core/components/ui/button`、`icon-button-chrome`、`control-geometry`、各种 trigger | Button（variant / size）                                                                                                | A3  |
| 提示 `core/components/ui/tooltip`                                                            | Tooltip                                                                                                                 | A3  |
| 弹窗 `adaptive-modal-sheet` 及各个弹窗、确认框                                               | Dialog / Drawer / Sheet / AlertDialog                                                                                   | B   |
| 提示消息 `toast-host`                                                                        | Sonner                                                                                                                  | B   |
| 菜单引擎 `menu/`、`adaptive-menu`、`sheet-menu`、`menu-kit`、`snap-drawer`                   | DropdownMenu / ContextMenu                                                                                              | B   |
| 下拉选择 `select-field`                                                                      | Select                                                                                                                  | B   |
| 组合框 `combobox`（754 行）                                                                  | Combobox                                                                                                                | B   |
| 命令面板 ⌘K、输入框里的 @ 补全                                                               | Command / CommandDialog                                                                                                 | B   |
| 侧栏行、手机侧栏                                                                             | Sidebar（手机上是它自带的 Sheet）                                                                                       | C   |
| 分屏 `split-container`、`resize-handle`                                                      | Resizable                                                                                                               | C   |
| 滚动区 `overlay-scrollbar`、`scrollable-code-surface`、`horizontal-scroll-boundary`          | 浏览器原生细滚动条（`scrollbar-thin`）与 `scroll-fade`，shadcn 自己的 Command、Code Block 也是这样；代码框用 Code Block | C   |
| 设置卡片和行、提示卡片、空状态、骨架屏                                                       | Item / Card / Separator / Empty / Skeleton                                                                              | C   |
| 折叠区                                                                                       | Collapsible                                                                                                             | C   |
| 定时任务表格、快捷键列表                                                                     | Item（两处都是列表，不是表格）；Markdown 表格用 Table                                                                   | C   |
| 用量条                                                                                       | Progress                                                                                                                | C   |
| 对话时间线 `agent-stream`                                                                    | 保留虚拟滚动（用户选定：Message Scroller 不虚拟化）                                                                     | D   |
| 用户消息、助手回复、图片附件 `message.tsx`                                                   | Message / Bubble / Attachment                                                                                           | D   |
| 工具调用、思考过程、计划、待办、子 agent、终端输出、「Worked for 10s」                       | Trace（Tool / Reasoning / Plan / Queue / Subagent / Terminal / Task）                                                   | D   |
| 权限请求                                                                                     | Card（Confirmation 是 AI Elements，不用）                                                                               | D   |
| 提问卡片 `question-form-card`                                                                | Questionnaire                                                                                                           | D   |
| 输入框 `composer`                                                                            | 保留，里面用 shadcn 的 Button、Tooltip、Command（Prompt Input 是 AI Elements，不用）                                    | D   |
| 模型和思考档位选择                                                                           | 保留 Combobox（Command + Popover/Drawer）（Model Selector 是 AI Elements，不用）                                        | D   |
| 上下文用量 `context-window-meter`                                                            | 保留，Button + Tooltip（Context 是 AI Elements，不用）                                                                  | D   |
| 回退 `rewind`                                                                                | DropdownMenu（Checkpoint 是 AI Elements，不用）                                                                         | D   |
| Markdown 代码块                                                                              | Code Block                                                                                                              | D   |
| 文件树、改动树                                                                               | 保留（虚拟化的树；File Tree 是 AI Elements，不用）                                                                      | D   |

保留自己写的（shadcn 没有、也找不到替代）：终端（xterm.js）、文件编辑器（CodeMirror）、Diff 画布、Mermaid 图、Markdown 解析（markdown-it，渲染出来的代码块用 Code Block）、拖拽排序（dnd-kit）、图片缩放查看器、文件拖放、工作区标签栏（能拖动、能关闭，Tabs 做不了）、状态圆点和各种图标。

## 做法

每批：调用处改成直接用 shadcn 组件，删掉自己的组件和只给它用的代码，`npx shadcn add` 补缺的组件；相关单元测试和端到端用例按新组件的结构改；`docs/design.md`、`docs/forms.md`、`docs/menus.md`、`docs/mobile-panels.md` 里讲自己组件的部分改成讲 shadcn 组件或删掉。

## 验证

- 每批：`npm run typecheck`、`npm run lint`、`npm run format:check`，`web/` 单元测试，受影响页面的端到端用例，桌面与手机、浅色与深色截图逐页看过；推 CI，16 个端到端分片全过。
- 全部做完：对照表里「自己写的」一栏的文件都已删除，`rg` 查不到它们的导入。

## 执行记录

### 批 A–C（2026-11-03）

提交 `eeaa2b8bf`、`cded10f11`、`5d3ec206d`、`244604541`、`95479ca95`、`653d12806`、`53dfa1d66`、`33f3a5c80`。

- **先把 shadcn 组件本身改回原样**：`web/src/components/ui` 里此前为贴近 Expo 版改过的组件用 `npx shadcn add --overwrite` 重装（按钮、菜单、提示、弹层、对话框、抽屉、侧栏、Sheet 等），`index.css` 里重新定义 shadcn 样式的部分删掉：全局焦点外框、旧调色板与阴影、720px 断点（统一为 Tailwind 的 768px，紧凑布局判断同步）、行高覆盖、`extra-muted`/`interaction-highlight` 两个自造色。留下的 `BySpace:` 段只剩应用设置与 shadcn 没有的东西（字体变量、Markdown、状态色、闪屏动画等）。
- **A**：开关、分段控件（改为 Tabs）、状态徽标（Badge，状态色用 class）、加载圈（Spinner）、提示框（Alert）、外链、快捷键显示；输入框与表单（Input/Textarea/InputGroup/Field，非受控的地方保持 `defaultValue`）；按钮封装、图标按钮外观、工具栏按钮（Button 的 variant/size）、Tooltip。
- **B**：弹窗（`AdaptiveModalSheet` 改为桌面 Dialog、手机 Drawer）、确认框、提示消息（Sonner，放在工作区标题栏与标签栏下方）、菜单引擎整套删除（DropdownMenu/ContextMenu，选项行用 CheckboxItem，进行中的菜单项显示 Spinner）、设置里的下拉（Select）、组合框（Popover + Command）、命令面板（CommandDialog）。
- **C**：设置行与空状态（Item/Empty/Checkbox）、分屏与资源管理器宽度与树栏（Resizable）、折叠区（Collapsible）、用量条（Progress）、骨架行（Skeleton）、快捷键列表（Item）；手机上的侧栏用 shadcn Sidebar 自带的 Sheet，资源管理器用右侧 Sheet。
- **随之消失的行为**（shadcn 没有，按原则不再自己写）：手机上从屏幕边缘滑动打开侧栏/资源管理器、拖动开合（`docs/mobile-panels.md` 一并删除）；桌面侧栏拖动改宽（批 C 改成固定宽度，用户验收时要回来了，见下面「验收后」）；收起的桌面侧栏按 shadcn 的做法滑出窗口外但仍挂载；菜单只有弹出式，手机上不再变成底部抽屉；分段控件变成 Tabs（高 32px，方向键切换）。
- **途中修掉的问题**：手机会话列表里的会话菜单点一下会同时选中下面那一行（React 事件穿过菜单的 portal 冒泡）；从行内菜单打开的右键菜单在门户里再右键会打开外层区域的菜单；技能弹窗的保存错误被挤成 0 高（滚动区里的子元素被压缩），移到底部按钮旁；新建定时任务在上一张表单关闭动画期间点开会被一起关掉；Diff 选区（见前一批）。
- **端到端**：按 shadcn 组件的角色改断言（Select 是 combobox/option，选项行 menuitemcheckbox，Command 输入框是 combobox，紧凑布局的菜单仍是菜单），图标按钮按 shadcn `icon-xs`（24px 框、12px 图标）量尺寸，对话框几何在打开动画结束后再量，关闭中的菜单淡出后再点下一个；删掉 3 条只验证旧行为的用例（手机侧栏关闭后保持挂载、侧栏切换按钮固定在左上角、整页底部抽屉）。

### 批 D：对话区（2026-11-03）

用户选定：时间线的虚拟滚动保留（shadcn 的 Message Scroller 不虚拟化，长会话会卡，加载更早消息与跳转要重写），其余换 shadcn；输入框、模型选择器、上下文用量这类只用 shadcn 官方组件，不引入 Vercel 的 AI Elements（多一个第三方库要跟着维护）。

- **换成 shadcn**：用户消息（Bubble）、助手回合底栏（Message/MessageFooter）、图片与文件附件（Attachment，输入框里和消息里同一套）、工具调用与思考过程的行（Trace，运行中的光效用 Trace 自带的）、压缩分隔线（Marker）、通知（Alert）、朗读消息（Message + Bubble）、Markdown 代码块（Code Block，高亮仍用 `@bytetrue/highlight`，复制按钮用它自带的）、提问卡片（Questionnaire，放在 Card 里，一次一题、上一题/下一题、单选多选与自由填写；答案格式照旧）。
- **随之变化的行为**：提问卡片不再有按题目切换的标签行，改为 Questionnaire 的进度与上一题/下一题；当前题没答时点提交会提示原因而不是按钮变灰。
- **途中修掉的问题**：手机上从侧栏打开「导入会话」，侧栏 Sheet 关闭时把导入面板一起卸载了（导入面板移到侧栏外渲染）；代码块复制选区时丢了换行（每行带上换行符）。
- **端到端**：附件、工具调用行、代码块按 shadcn 组件的结构定位；提问卡片的用例改为 Questionnaire 的交互；几条只在 CI 上偶发的用例改得更稳（打开动画结束后再量覆盖关系、手机上关闭嵌套抽屉用 Esc、断线前先等对话加载完、主机名示例改短以适应 shadcn 侧栏宽度）。
- **本机仍失败、与本次无关**：`agent-timeline-resume` 的「未变化的恢复不动滚动位置」在改造前的提交 `1307ec9d0` 上本机也失败，CI 上通过。

### 批 E：剩下自己画的控件（2026-11-03）

先列出 `web/src` 里所有自己写的 `<button>`、输入框、卡片、分隔线、浮层、滚动条，再逐个换。

- **换成 shadcn**：
  - 按钮：剩下自己画的按钮都改成 Button，包括权限请求、发送与停止、手机上的标签切换、窗口标题栏的三个按钮、终端按键与粘贴/复制、侧栏提示卡片的操作、工具栏的标签按钮、组合框与下拉选择的触发按钮；「提交」「在编辑器中打开」的拆分按钮用 ButtonGroup；菜单、弹层、提示的触发器一律 `asChild` 包住 Button。整行可点的列表行用 Item（`asChild`），侧栏行里的 PR 用 Badge，终端的修饰键用 Toggle。
  - 设置侧栏：Sidebar 的 Group/Menu/MenuButton（`collapsible="none"`）。
  - 斜杠命令与 @ 文件补全：Command（选中项仍由输入框的方向键驱动，鼠标移上去也会选中）。
  - 滚动：自己画的悬浮滚动条删除，对话、Diff、文件树用浏览器的细滚动条（`scrollbar-thin`）；标签栏两端的渐隐改用 shadcn 的 `scroll-fade-x`。
  - 诊断详情、错误详情、工作区设置日志、首次连接命令用 CodeBlock；诊断状态用 Card。
  - 折叠：PR 检查及其分组、提交列表、工作区设置的每条命令、Markdown 折叠块用 Collapsible。
  - 标签颜色、代理资料的颜色与图标用 ToggleGroup（代理资料外观选择器改为 Popover）；使用 SSL 用 Checkbox；显示密码用 InputGroup 的按钮。
  - 图片查看器、Mermaid 全屏用全屏 Dialog。
  - 分隔线用 Separator / CommandSeparator；Markdown 表格用 Table。
  - 主机加载失败、表单错误、PR 平台未配置、对话同步失败、已归档提示用 Alert（带按钮的放在 AlertAction）；端口、版本、连接方式小标签用 Badge；主机行、评论、排队消息、平台目录、代理资料功能项用 Item；没有可添加的平台用 Empty；扫码不可用说明、权限请求用 Card；手机上的归档确认用 Drawer。
- **随之变化的行为**：项目设置里的脚本行不能再整行点击进入编辑，编辑在行尾菜单里（shadcn 的 Item 带操作时，行本身不可点）；资源管理器的新建/重命名框、新建标签名、评论框变成 shadcn 输入框的样子；滚动条变成系统细滚动条（macOS 默认本来就是悬浮的）；代理资料外观选择器从组合框变成 Popover。
- **途中修掉的问题**：代理资料编辑框在上一张关闭动画期间点「新建」会被一起关掉，和定时任务表单是同一个问题，抽成 `web/src/hooks/use-retained-open-props.ts` 两处共用。
- **保留自己写的**（shadcn 没有、也找不到替代）：对话大纲导轨的刻度；消息和 Markdown 里可点击的图片；Combobox（Command 加 Popover/Drawer 的组装，带分组、页脚、自定义行）与 SelectField；带输入法逻辑的输入框（输入框组件）；右键菜单的行触发器；补全浮层的定位；工具栏按钮（Button 加 Tooltip 的组装）。
- **端到端**：本机跑会在 gh 登录的账号里真建 GitHub 临时仓库。这次漏下 7 个 `byspacetmp-pr-pane-*`：`gh repo create --push` 推送失败时仓库已建好，夹具直接抛错，没人删。夹具改为失败时删除已建的仓库，`docs/testing.md` 写明本机用 `GH_CONFIG_DIR` 指向空目录跳过这些用例。已漏下的 7 个等用户确认后再删。
- **途中另修**：上下文用量圆环的底圈颜色在批 A 改 token 名时被写坏（`var(--surface-3)` 变成了无效的 `varaccent`），空的用量环只剩一个点，改为 `var(--accent)`（`a792ade9f`）。
- **验证**：类型检查、lint、格式检查通过；`web/` 单元测试全过；本机端到端按改动范围跑了 369 条，失败的只有需要本机没装的 Codex、OpenCode、Claude CLI 的用例（CI 上通过）；开发服务器上首页、对话、设置、主机、Agents、定时任务、隧道、历史、新建工作区在桌面浅色、深色和手机三种下逐页截图看过，无报错。CI `a792ade9f` 全部通过（22 项通过，4 项按路径没有触发）。
- **已解决（2026-11-14）**：`sidebar-workspace-mark-unread` 的「普通完成在离开时清除」在 CI 上偶发失败。根因：daemon 的 `broadcastAgentUpdate` 先发布 workspace 状态桶、再发 agent 快照，侧栏 row 先看到 attention，而客户端的自动清除看的是 agent 快照；用户这时离开，清除看到 `requiresAttention` 还是 false，什么都没清，row 就停在绿点。现在先发 agent 更新、再刷新/发布 workspace 状态桶（`13ea3fcaf`）。

### 验收后：桌面侧栏恢复可调宽度（2026-11-04）

用户验收这一轮，唯一的问题是左侧栏不能调宽度。批 C 删掉了自己写的拖动条，把侧栏固定在 shadcn 默认的 16rem。

shadcn 的 Sidebar 本身就有调宽的入口：边缘的 `SidebarRail`，以及 `SidebarProvider` 上的 `--sidebar-width` 变量（文档写明用 `style` 设置宽度）。现在的做法：

- **SidebarRail**：在打开的侧栏边缘上按住拖动，就调整宽度；单击和 shadcn 原版一样是收起/展开。侧栏收起时，窗口边缘那条 rail 只能点开侧栏。
- **宽度**：拖动时直接写 `--sidebar-width`，跟手且不重渲染；松开后存进面板状态，刷新后保留。范围 200–600px，并且至少给右边的内容留 400px（`resolveDesktopSidebarWidth`）。拖动期间关掉 shadcn 侧栏的宽度过渡动画。

`sidebar-resize-rail.tsx` 只是 SidebarRail 加上拖动处理，没有自己画任何东西。

同一天按「还有哪些没切到 shadcn」重新清点，又换掉 6 处漏网的（`1733bb501`）：关闭标签时自己画的转圈换成 Spinner；PR 动态的头像换成 Avatar；计划卡片和 PR 评审讨论串换成 Card；外观设置里侧栏项的上移/下移换成 ButtonGroup；Markdown 预览的 front matter 换成 Table；侧栏开关按钮去掉为了贴近旧版加的样式覆盖（包括去掉焦点框的那条），手机上自己画的三道杠换成 lucide 的 Menu。

清点后仍是自己写的，分两类。一类是 shadcn 没有对应组件：终端、编辑器、Diff 画布、Mermaid、文件树（虚拟列表）、工作区标签栏（可拖动、可关闭）、对话大纲导轨、状态圆点、PR 检查与上下文用量的圆环、拖动预览与分屏落点、消息与 Markdown 里可点的图片、二维码框。另一类是 shadcn 有、但换了会改变用户明确要过的效果，问过用户，两处都选了换：

- **侧栏的工作区行和项目行**改成 SidebarMenuButton（`isActive`），选中行左侧的竖条没有了，只剩底色和加粗；有第二行（分支、PR 等）的行用 `lg` 尺寸（48px），没有的用默认 32px。行尾的 ⋯ 和 + 改成 SidebarMenuAction 的 `showOnHover`：靠透明度隐藏，行有焦点时也会显示，手机上一直显示。快捷键序号用 SidebarMenuBadge 加 Kbd。命令面板里选中行的竖条原本是照着侧栏加的，一起去掉。
- **输入框外框**改成 InputGroup，输入框聚焦时有 3px 的焦点光圈。

`docs/hover.md` 按 `showOnHover` 改写。端到端里 Playwright 把透明度为 0 的元素算作可见，判断这类按钮是否显示要看透明度（`expectHoverActionHidden` / `expectHoverActionShown`）。

还剩两处 shadcn 有、还没换的，问过用户，都选了换（2026-11-04）：

- **命令面板（⌘K）**按 shadcn 的 CommandDialog 原样（`f4d773b87`）：弹窗大小随结果变化，分组用 CommandGroup 带标题，鼠标悬停就移动选中项。旧版的 640×560 固定尺寸、36px 行高、只用方向键选中都去掉；结果列表不再计算行高与偏移（那是旧版虚拟列表用的）。
- **组合框**换成 shadcn 的 Combobox（`cff8b0900`，新增依赖 `@base-ui/react`）：搜索框在弹出层里；选项仍由 `combobox-options.ts` 过滤排序，Combobox 自带的过滤关掉；手机上从底部抽屉变成横跨屏幕的弹出层。没有搜索的列表留一个看不见的只读输入框接方向键。自带内容的调用方（模型浏览）仍用 Popover/Drawer。途中修掉三处：在 Radix 弹窗里打开时，弹出层要挂进弹窗，否则弹窗的焦点陷阱与禁用指针让它点不动；正在关闭的列表去掉 test id，免得和下一个打开的混淆；手机标签切换器的行改为组合框条目里的普通内容，行尾 ⋯ 菜单改为点击打开（列表会阻止每次按下的默认行为，Radix 的触发器遇到被阻止的按下就不响应）。

另外删掉了已经没有任何地方使用的 AdaptiveTextInput（`8791b464c`）。

## 收尾（2026-11-04 验收通过）

用户在开发版桌面窗口上逐轮验收，剩下的都是 macOS 桌面窗口上的观感与性能问题，当天按快改修完，记录见 [2026-11-04-x-ff-desktop-polish-and-notifications.md](../../../issues/2026-11-04-x-ff-desktop-polish-and-notifications.md)：顶部一行对齐与红绿灯、侧栏拖动与收起展开的性能、⌘K 面板尺寸、输入框灰色、确认弹窗全部改为应用内、通知改走系统原生通知（另发现 daemon 从未发 agent_attention_required，一并补上）。最后一轮定下**选中态统一为 2px 竖线、悬停只留淡色**（`d6198cc41`），写进 `docs/design.md`。

至此本事项与整个前端重写 Epic 验收通过，关闭。

## 关闭结论（2026-11-05）

用户确认按整体完成关闭，后续残留 bug 另开事项，不再留在重写范围。
