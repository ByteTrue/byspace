---
kind: issue
title: "空项目行不再显示展开/折叠 chevron"
type: ff
status: closed
created: 2026-09-15
closed: 2026-09-15
---

# 空项目行不再显示展开/折叠 chevron

## 做了什么

Issue 028 移除了无 workspace 项目的幽灵新建行，但项目行的 hover chevron（折叠/展开指示）仍然渲染。空项目没有可展开的内容，这个状态切换指示属于无意义 affordance。现约定：`project.workspaces` 为空时行模型返回 `chevron: null`，行首保持项目图标，不再出现 chevron。

## 改了哪些

- `packages/app/src/utils/sidebar-project-row-model.ts`：`SidebarProjectSectionRowModel.chevron` 类型放宽为 `"expand" | "collapse" | null`；新增 `projectChevron()`，空项目返回 `null`；
- `packages/app/src/utils/sidebar-project-row-model.test.ts`：空项目用例改名为 "renders an empty project with no expand toggle"，断言 `chevron: null`。

消费侧无需改动：`ProjectHeaderRow` 与 `ProjectLeadingVisual` 本就接受 `chevron: null`（null 时 `showChevron` 恒 false，回落到项目图标）。

## 怎么验证的

- `npx vitest run packages/app/src/utils/sidebar-project-row-model.test.ts --bail=1`：12 通过；
- `npm run typecheck`：全 workspace 通过；
- `npm run lint`：0 warnings / 0 errors；
- `npm run format:check`：通过。

## 对 codestable/ 的影响

- 无影响（纯视觉 affordance 收敛，不改变 Project/Workspace 模型与侧栏交互结构）。
