# Workspace

侧栏把 Workspace 按 Project 组织，行内呈现分支与宿主信息；行级操作走 hover 与菜单。
侧栏提供一键整理 Project 顺序操作，按活跃（running/attention/needs_input/failed）、有 Workspace（全 done）、无 Workspace 三层排列，各层内按名称首字母 A–Z 升序。

## 分支与推送状态

- BranchSwitcher 区分 Local、Remote、Both 并用可辨识图标分组；远端名不硬编码为 `origin`。
- 无 configured upstream 但存在同名同步的 `origin/<branch>` 时显示为已同步，不显示 Push；显式 upstream 优先，configured-gone 显示 unknown。
- Git/Forge 查询保持 directory-backed `(serverId, cwd)` 语义。

## Agent 状态展示

- Workspace hover card 展示该 Workspace 下全部 Agent（含 subagent）的精确 lifecycle 状态并随快照实时更新；不按 cwd 推断，不改变目录顺序。
- Compact 与 native 的 Workspace 行始终显示三点菜单，菜单打开时触发器不卸载；wide Web 才依赖 hover。
- Project 只跨多台 Host 时自动显示 Host 名 badge；单 Host Project 保持安静，显式 Name/Icon/Hidden 设置始终优先。

## Agent 精炼命名

- Workspace 菜单在 capability 可用时只复制固定 prompt，由拥有完整上下文的当前 Agent 调用 `rename_workspace` 与独立 `rename_branch` 精炼标题与分支；菜单不自动发送、不选择 Agent、不加确认弹窗。
- 分支改名只允许 BySpace 管理、非默认、未发布、无 upstream/PR/MR、未人工改名且无冲突的分支；标题成功不因分支跳过或失败回滚，用户显式标题或分支始终优先。Directory Workspace 只改标题。

## 侧栏顶栏与面板折叠

- 桌面固定侧栏的左上角始终是折叠按钮（`menu-button`），它占据第一行的最左侧；侧栏收起后同一按钮由内容标题栏渲染在同一像素（`x=11, y=4.5`），因此展开/收起不移动指针目标。
- 对齐的是**看得见的图标**，不是按钮的外框：折叠按钮是 26px 外框居中一个 16px 图标，图标天然在框内缩 5px；而各行图标在内缩 8px 处（图标轨 `x=16`）。共用的 `leadingToggle` 负边距按「图标轨 − 外框内缩 − 宿主行内缩」算出，让两个 host 的折叠按钮图标都落在 `x=16`，与下方四个导航行及 workspace 行的图标同在一条基准线上。若改成对齐外框，图标会偏左 3px。
- **`BySpace` 按钮是独立的标题栏型按钮，不是导航行**：它占据第一行折叠按钮右侧的剩余宽度，字符串在其中点居中，展开箭头贴按钮右缘（内缩 `spacing[2]`）。之所以不让它冒充导航行：与角落折叠按钮同行会把它的左缘推到图标轨右边，领头的箭头永远无法与下行图标对齐；居中 + 箭头靠右就不存在这个期待。箭头随展开在右/下之间翻转。
- 点开时，四个导航项（New workspace / History / Search / Schedules）**就地**出现在该按钮下方（就是普通导航行），把 Workspace 列表往下推，不是悬浮二级菜单。顺序与显隐沿用 Appearance → Sidebar 设置；全部隐藏时 `BySpace` 按钮与这些行一起不渲染。选中一项后展开收起并导航。
- Explorer 折叠按钮固定窗口右上角：dock 打开时由 dock 自己的标签栏承载，关闭时由内容标题栏承载。打开或关闭 Explorer 不移动指针目标。
- 四个导航项在展开前不可见，因此当前所在页不再随侧栏常显高亮；这是合并成一个按钮的取舍。
- **Compact 侧栏同样折叠**（这是按钮存在的目的，不是桌面专属）：面板头部一行是 `BySpace` 按钮 + 关闭按钮，四行收在按钮的就地展开里、默认收起，因此手机上面板不再被四行占满。两个 shell 共用 `useSidebarNavDisclosure`，开关/收起回调不会漂移。关闭按钮不参与折叠、始终在位，也是 e2e 判定「面板已开」的标记（旧的 `sidebar-sessions` 探针已改为 `sidebar-close`，因为那些行现在默认隐藏）。

## 历史证据

- [Epic 002 交付记录](../epics/002-x-retained-capabilities-delivery/spec.md)
