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

## Agent 状态展示

- Workspace hover card 展示该 Workspace 下全部 Agent（含 subagent）的精确 lifecycle 状态并随快照实时更新；不按 cwd 推断，不改变目录顺序。
- Compact 与 native 的 Workspace 行始终显示三点菜单，菜单打开时触发器不卸载；wide Web 才依赖 hover。
- Project 只跨多台 Host 时自动显示 Host 名 badge；单 Host Project 保持安静，显式 Name/Icon/Hidden 设置始终优先。

## Agent 精炼命名

- Workspace 菜单在 capability 可用时只复制固定 prompt，由拥有完整上下文的当前 Agent 调用 `rename_workspace` 与独立 `rename_branch` 精炼标题与分支；菜单不自动发送、不选择 Agent、不加确认弹窗。
- 分支改名只允许 BySpace 管理、非默认、未发布、无 upstream/PR/MR、未人工改名且无冲突的分支；标题成功不因分支跳过或失败回滚，用户显式标题或分支始终优先。Directory Workspace 只改标题。

## 侧栏顶栏与面板折叠

- 桌面固定侧栏的左上角始终是折叠按钮（`menu-button`），它占据第一行的最左侧；侧栏收起后同一按钮由内容标题栏渲染在同一像素（`x=11, y=4.5`），因此展开/收起不移动指针目标。
- 对齐的是**看得见的图标**，不是按钮的外框：折叠按钮是 26px 外框居中一个 16px 图标，图标天然在框内缩 5px；而各行图标在内缩 8px 处（图标轨 `x=16`）。共用的 `leadingToggle` 负边距按「图标轨 − 外框内缩 − 宿主行内缩」算出，让两个 host 的折叠按钮图标都落在 `x=16`，与展开区导航行及 workspace 行的图标同在一条基准线上。若改成对齐外框，图标会偏左 3px。
- **`BySpace` 按钮是独立的标题栏型按钮，不是导航行**：它占据第一行折叠按钮右侧的剩余宽度，字符串在其中点居中，展开箭头贴按钮右缘（内缩 `spacing[2]`）。之所以不让它冒充导航行：与角落折叠按钮同行会把它的左缘推到图标轨右边，领头的箭头永远无法与下行图标对齐；居中 + 箭头靠右就不存在这个期待。箭头随展开在右/下之间翻转。
- 点开时，展开区内的导航项（默认 Search / Schedules / Tunnels）**就地**出现在该按钮下方（就是普通导航行），把 Workspace 列表往下推，不是悬浮二级菜单。顺序与显隐沿用 Appearance → Sidebar 设置；展开区内没有可见项时 `BySpace` 按钮与这些行一起不渲染。选中一项后展开收起并导航。
- **New workspace 与 History 不在展开区**：它们是 `Workspaces` 标题行右侧的两个图标按钮，与排序、显示偏好同排同形（28pt），一次点击即达。顺序由版面固定（`New workspace` 在前），Appearance → Sidebar 因此不对这两项提供 Move up/down，但保留可见性开关——关掉即从标题行消失。
- `Workspaces` 标题行在**零项目时也渲染**（这两个导航项与列表内容无关），此时排序与显示偏好两个列表控制隐藏。侧栏收到最小宽度 200pt 时标题截断，四个按钮不压缩。
- 标题行的按钮在 **Compact 侧栏同样一次点击即达**（它们不参与折叠），因此它们与展开区的行一样，在 compact 上必须顺带关闭面板——否则选完 History 后，面板正盖在刚导航到的那一页上。
- Explorer 折叠按钮固定窗口右上角：dock 打开时由 dock 自己的标签栏承载，关闭时由内容标题栏承载。打开或关闭 Explorer 不移动指针目标。
- 展开区内的导航项在展开前不可见，因此当前所在页不在侧栏常显高亮；这是合并成一个按钮的取舍。标题行的两个按钮始终在位，History 所在页由字形颜色（而非背景块）标出，与旁边的工具按钮保持同一族。
- **Compact 侧栏同样折叠**（这是按钮存在的目的，不是桌面专属）：面板头部一行是 `BySpace` 按钮 + 关闭按钮，展开区的行收在按钮的就地展开里、默认收起，因此手机上面板不再被它们占满。两个 shell 共用 `useSidebarNavDisclosure`，开关/收起回调不会漂移。关闭按钮不参与折叠、始终在位，也是 e2e 判定「面板已开」的标记（旧的 `sidebar-sessions` 探针已改为 `sidebar-close`，因为那些行现在默认隐藏）。

## 历史证据

- [Epic 002 交付记录](../epics/002-x-retained-capabilities-delivery/spec.md)
