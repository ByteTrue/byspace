# Workspace

侧栏把 Workspace 按 Project 组织，行内呈现分支与宿主信息；行级操作走 hover 与菜单。

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

## 历史证据

- [Epic 002 交付记录](../epics/002-x-retained-capabilities-delivery/spec.md)
