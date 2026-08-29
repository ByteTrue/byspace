---
kind: issue
title: "侧栏 Workspace 拖拽排序修复"
type: ff
status: closed
created: 2026-08-21
---

# 侧栏 Workspace 拖拽排序修复

## 做了什么

修复了 Web 浏览器环境下侧栏 Workspace 无法拖拽改变顺序的问题：

1. **统一 Pointer 传感器**：在 `packages/app/src/components/draggable-list.web.tsx` 中将 `@dnd-kit/core` 的 `MouseSensor` / `TouchSensor` 替换为 `PointerSensor`，以兼容 React Native Web 的指针事件系统，距离达到阈值（6px）时正常触发拖拽。
2. **移除冗余的 `useDragHandle` 约束**：在 `packages/app/src/components/sidebar-workspace-list.tsx` 中移除 `ProjectBlock` 内部 `DraggableList` 的 `useDragHandle` 属性，使外层容器 `div` 直接接收拖拽监听与 ref，避免 React Native Web `View` / `Pressable` 内部吞掉事件或 activator ref 丢失。
3. **Web 端跳过长按拖拽定时器**：在 `packages/app/src/components/sidebar/use-long-press-drag-interaction.ts` 中针对 Web 平台跳过 180ms 长按判定定时器，避免短暂停留导致单击点击被当作长按而拦截。

## 改了哪些

- `packages/app/src/components/draggable-list.web.tsx`
- `packages/app/src/components/sidebar-workspace-list.tsx`
- `packages/app/src/components/sidebar/use-long-press-drag-interaction.ts`

## 怎么验证

- `npx vitest run packages/app/src/components/drag-reorder/ --bail=1` 通过
- `npx vitest run packages/app/src/components/sidebar-workspace-list.test.tsx --bail=1` 通过
- `npx vitest run packages/app/src/utils/sidebar-reorder.test.ts --bail=1` 通过
- `npx vitest run packages/app/src/stores/sidebar-order-store.test.ts --bail=1` 通过
- `npm run typecheck` 全绿
- `npm run lint` 0 警告 0 错误
- `npm run format:check` 通过

## 对 `codestable/` 的影响

无，符合 `codestable/spec/index.md` 中侧栏持久化拖拽序/用户管理序定义。
