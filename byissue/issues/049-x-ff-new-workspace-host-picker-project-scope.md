---
kind: issue
title: "修复 New Workspace 在单宿主项目下错误展示其它 Host 选项"
type: ff
status: closed
created: 2026-09-24
---

# 修复 New Workspace 在单宿主项目下错误展示其它 Host 选项

## 预期与实际

预期：在多宿主（Multi-Host）环境下，当选中的项目仅在某一台主机（如本机）上存在时，Host 选择器绝不应该列出压根没有该项目的其它主机。

实际：当用户选中仅单台机器拥有的项目（如 `ByIssue`）时，点开 Host 选择器，依然列出了没有该项目的其它主机（如 `zijie`）；若点击该主机则直接抛错导致流程中断。

## 根因

在 `packages/app/src/screens/new-workspace-screen.tsx` 中：

1. 计算 `availableHosts` 时错误地使用了 `if (!selectedProject || selectedProject.hosts.length <= 1) return allHosts;`。导致只要项目关联的主机数 `<= 1`，逻辑不仅没有过滤，反而退化返回系统全局全部主机（`allHosts`），将无关主机也灌入了 `HostPicker` 的选项中。
2. 触发器未判断 `canSwitchHost`（`host.allHosts.length > 1`）：即便当前项目只存在于 1 台主机上且无可选项，依然渲染了下拉小箭头 `metaChevron` 并允许展开下拉列表。

## 改了哪些

- `packages/app/src/screens/new-workspace-screen.tsx`：
  - 修正 `availableHosts` 过滤条件为 `if (!selectedProject || selectedProject.hosts.length === 0)`，严格按照 `selectedProject.hosts` 将可用宿主过滤为拥有该项目的集合，彻底排除无关主机。
  - 增加 `canSwitchHost = host.allHosts.length > 1` 判定：当项目仅在 1 台机器上存在时，隐藏下拉箭头并禁用点击展开，作为清晰的宿主归属展示；当存在于多台机器时，才允许展开切换，且下拉列表严格收敛为拥有该项目的机器。
  - 提取 `NewWorkspaceHostControl` 独立渲染逻辑，收敛函数圈复杂度至规范范围内。

## 怎么验证的

- 单测：`new-workspace-*.test.ts`、`project-picker.test.tsx`、`project-selection.test.ts` 全部通过。
- 类型与代码检查：`npm run typecheck`（7 workspaces 全绿）、`npm run lint`（0 warnings, 0 errors）、`npm run format:check`（100% 通过）。

## 对 byissue/ 的影响

无影响。对齐了 `030-x-ff-multi-host-project-removal-and-workspace-selection.md` 中“Host 候选池由已选中的 Project 动态收敛”的既定规格。
