# Workspace

侧栏把 Workspace 按 Project 组织，行内呈现分支与宿主信息；行级操作走 hover 与菜单。
侧栏提供一键整理 Project 顺序操作，按活跃（running/attention/needs_input/failed）、有 Workspace（全 done）、无 Workspace 三层排列，各层内按名称首字母 A–Z 升序。

## 新建 Workspace 默认值

- 新建 Workspace 的初始 Host 跟随 Project 设置的默认 Host（须在线），未设置或离线时回落本机 daemon；任何入口都不默认选一个无关 Host。Project 设置可为单个项目指定默认 Host、隔离模式（Local / New worktree）与新建 worktree 的基础分支，留 Automatic 表示不设偏好。
- 这些默认只决定创建时的初始值，不改变已有 Workspace；指定的基础分支在目标 Host 的仓库里不存在时按无偏好处理，回落 checkout 默认。

## 分支与推送状态

- BranchSwitcher 区分 Local、Remote、Both 并用可辨识图标分组；远端名不硬编码为 `origin`。
- 无 configured upstream 但存在同名同步的 `origin/<branch>` 时显示为已同步，不显示 Push；显式 upstream 优先，configured-gone 显示 unknown。
- Git/Forge 查询保持 directory-backed `(serverId, cwd)` 语义。

## Project 行与同名消歧

- 同名 Project 并列时（多台 Host 各添加同名的普通目录，或同名 Git 仓库无 remote），该行在名字下方多一行线索 `Host 名 · 缩短路径`；名字不冲突的行不加任何字。线索按**当前可见列表**判定：过滤到只剩一个同名项时它消失。
- 线索必须同时给 Host 与路径。只给 Host 分不清同一台机器上的 `~/dev/chat` 与 `~/work/chat`；只给路径分不清两台机器的 `~/chat`——`shortenPath` 会把两者都变成 `~/chat`。跨多台 Host 的项目在行内列出**前两个** Host 名、超出以 `…` 截断（完整清单在悬停提示里），路径取第一个有路径的 Host。
- 线索在标题**下方第二行**，不与标题同行：标题右侧是 hover 操作区，放那里会在最需要它的时候被挤掉。
- 悬停 Project 的**名字**显示该项目每个 Host 的完整路径（tooltip）。触发面是名字而不是整行，移向行内 kebab 时不会弹出。
- **线索跟着名字走，不跟着位置走。** 非 project 分组模式（status / label）没有项目行，项目名渲染在 workspace 行的元信息行上，线索就挂在那个名字后面（`名字 · 线索`），复用同一份冲突判定。同理，project 模式里被置顶提到项目块之外的行也要带线索——那些行上方没有 header，是线索唯一能出现的地方；留在项目块内的行不重复给，header 就在旁边。
- 元信息行上的线索随 `project` 这个 display item 一起开关：它是解释名字的，名字关掉之后它没有解释对象。

## Agent 状态展示

- Workspace hover card 展示该 Workspace 下全部 Agent（含 subagent）的精确 lifecycle 状态并随快照实时更新；不按 cwd 推断，不改变目录顺序。
- Compact 与 native 的 Workspace 行始终显示三点菜单，菜单打开时触发器不卸载；wide Web 才依赖 hover。
- Project 只跨多台 Host 时自动显示 Host 名 badge；单 Host Project 保持安静，显式 Name/Icon/Hidden 设置始终优先。

## Agent 精炼命名

- Workspace 菜单在 capability 可用时只复制固定 prompt，由拥有完整上下文的当前 Agent 调用 `rename_workspace` 与独立 `rename_branch` 精炼标题与分支；菜单不自动发送、不选择 Agent、不加确认弹窗。
- 分支改名只允许 BySpace 管理、非默认、未发布、无 upstream/PR/MR、未人工改名且无冲突的分支；标题成功不因分支跳过或失败回滚，用户显式标题或分支始终优先。Directory Workspace 只改标题。

## 侧栏顶栏与面板折叠

- 桌面固定侧栏的左上角始终是折叠按钮（`menu-button`），它占据第一行的最左侧；侧栏收起后同一按钮由内容标题栏渲染在同一像素（`x=11, y=4.5`），因此展开/收起不移动指针目标。
- 对齐的是**看得见的图标**，不是按钮的外框：折叠按钮是 26px 外框居中一个 16px 图标，图标天然在框内缩 5px；而各行图标在内缩 8px 处（图标轨 `x=16`）。共用的 `leadingToggle` 负边距按「图标轨 − 外框内缩 − 宿主行内缩」算出，让两个 host 的折叠按钮图标都落在 `x=16`，与 workspace 行的图标同在一条基准线上。若改成对齐外框，图标会偏左 3px。
- **侧栏第一行顶栏采用双按钮布局（`[◧] [BySpace ⌄] ── [🤖 Chief ●]`）**：左侧为折叠按钮与紧凑左对齐的 `BySpace` 菜单触发器（标题与翻转箭头并排），右侧常驻 `Chief` 胶囊按钮（带 `Bot` 图标、`Chief` 标签、选中高亮与 Home workspace 实时运行/待处理状态指示灯，零纵向空间增量）。移动端抽屉顶行同样为 `[BySpace ⌄] ── [🤖 Chief ●] [✕]`，点击 `Chief` 自动关闭抽屉并进入 Home workspace。
- **`BySpace` 点开后是悬浮下拉菜单，不是就地展开**：低频与扩展导航项（默认 Search / Schedules / Tunnels）由菜单引擎（`docs/menus.md`）渲染成普通 `MenuItem`，锚在该按钮下方，因此打开与关闭都不移动 Workspace 列表。顺序与显隐沿用 Appearance → Sidebar 设置；菜单内没有可见项时 `BySpace` 按钮与菜单一起不渲染（判据只数菜单内的项，Chief 与 New workspace / History 不参与）。选中一项后菜单关闭并导航；当前所在页由该行的勾标出（勾只在行渲染时才画，所以折叠态不付出成本）。入口零开销：项只在本菜单打开时才解析。daemon 自动确保的 Home workspace（`byspace.home-workspace`）及其独占的项目壳不在下方项目/工作区列表与新建工作区项目选择器中重复列出，由侧栏顶行右侧 `Chief` 按钮、全局快捷键（`⌘J` / `Ctrl+J`）及 Command Center 动作进入。
- **Chief、New workspace 与 History 不在菜单里**：`Chief` 固定在侧栏第一行右侧，`New workspace` 与 `History` 是 `Workspaces` 标题行右侧的两个图标按钮（与排序、显示偏好同排同形，28pt），均一次点击即达。位置由版面固定，Appearance → Sidebar 因此不对这三项提供 Move up/down，但保留可见性开关——关掉即从对应槽位消失。
- `Workspaces` 标题行在**零项目时也渲染**（这两个导航项与列表内容无关），此时排序与显示偏好两个列表控制隐藏。侧栏收到最小宽度 200pt 时标题截断，四个按钮不压缩。
- 标题行的按钮在 **Compact 侧栏同样一次点击即达**（它们不参与折叠），且与菜单项一样在选中后必须关闭面板——否则选完 History 后，面板正盖在刚导航到的那一页上。
- Explorer 折叠按钮固定窗口右上角：dock 打开时由 dock 自己的标签栏承载，关闭时由内容标题栏承载。打开或关闭 Explorer 不移动指针目标。
- 菜单项在打开前不可见，所以「当前所在页」不在侧栏常显高亮；标题行的两个按钮始终在位，History 所在页由字形颜色（而非背景块）标出，与旁边的工具按钮保持同一族。
- **Compact 侧栏用同一个菜单**：面板头部一行是 `BySpace` 按钮 + 关闭按钮，菜单默认关闭，因此手机上面板不再被导航项占满。菜单表面被 portal 到 overlay root、并不在面板内，而面板本身是 retained（`display: none` 保活），所以 shell 必须在 `active` 变假时显式关闭菜单（`useSidebarNavMenuOpen`），否则它会活过面板、下次打开时还悬浮在那里。关闭按钮不参与菜单、始终在位，也是 e2e 判定「面板已开」的标记。

## 历史证据

- [Epic 002 交付记录](../epics/002-x-retained-capabilities-delivery/spec.md)
