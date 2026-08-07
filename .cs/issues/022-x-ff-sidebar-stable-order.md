---
kind: issue
title: "侧栏稳定排序：去掉活动驱动重排、置顶与项目折叠"
type: ff
status: closed
created: 2026-08-07
---

# 侧栏稳定排序：去掉活动驱动重排、置顶与项目折叠

## 做了什么

侧栏从“活动流”改回“用户管理”：除需关注（needs_input/failed/attention）浮顶外，Project 与 Workspace 顺序一律保持输入序（持久化拖拽序），选中、Agent 活动不再触发重排。同时删除两个失效/低价值功能：Workspace 置顶（改版后仅剩项目内优先，跨项目无效，且提升逻辑已是死代码）与 Project 收起/展开（整行可点导致误触，产品上会话用完即关、不堆积）。

- `packages/app/src/components/sidebar/sidebar-projection.ts` — 排序只保留 attention 浮顶（项目按最早等待、工作区同理），其余保持输入序；删除 activity 排序、pin 优先、空项目沉底；shortcut 分区不再跳过折叠项。
- `packages/app/src/components/sidebar/sidebar-model.tsx` / `left-sidebar.tsx` / `sidebar-workspace-list.tsx` / `sidebar-workspace-menu.tsx` / `utils/sidebar-project-row-model.ts` / `utils/sidebar-shortcuts.ts` — 移除 pin 与折叠的 props、菜单项、chevron、header 点击折叠（Project 行点击不再有任何动作）。
- 删除：`hooks/use-sidebar-pins.ts`、`hooks/use-sidebar-workspace-pin.ts`、`hooks/use-global-workspace-pin-action.ts`、`components/workspace-pin-shortcut-handler.tsx`、`stores/sidebar-collapsed-sections-store/`、键盘动作 `workspace.pin`（含 Cmd/Ctrl+Shift+P 绑定与 route-shortcut 映射）、e2e `sidebar-workspace-pin-shortcut.spec.ts` 与 helper `pinWorkspaceFromSidebar`、8 个语言包的 pin/unpin 文案。
- 服务端 `server_info.features.workspacePinning` 保留（COMPAT 门，旧客户端仍可读），仅客户端不再消费。

## 改了哪些

见上；测试同步更新：`sidebar-projection.test.ts`（稳定序/浮顶新断言）、`sidebar-shortcuts.test.ts`、`sidebar-project-row-model.test.ts`、`route-shortcut.test.ts`、`workspace-shortcut-targets-subscriber.test.tsx`。

## 怎么验证

- `npx vitest run` 上述 6 个测试文件 86/86 通过。
- `npm run typecheck`、`npm run lint`、`npm run format:check` 全绿。
- 待人工验收：侧栏点击会话不再跳序；Project 行点击不再误折叠；kebab 菜单无置顶项。

## 对 `.cs/` 的影响

`.cs/spec/index.md` 侧栏章节已同步：排序真相改为“attention 浮顶 + 用户管理序”，删除置顶与折叠描述。
