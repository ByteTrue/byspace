---
kind: issue
title: "删除 desktop-open 死链：Electron 退役 shim 及其全部消费管道"
type: refactor
created: 2026-09-28
---

<!-- 读者：跨会话接手的人。目标与范围 · 现状怎么工作 · 方案 · 验证 · 关闭回写 -->

# 删除 desktop-open 死链：Electron 退役 shim 及其全部消费管道

## 为什么做

Issue 025 退役 Electron 时留下了 `desktop-open-targets.ts` shim（`useDesktopOpenTargets()` 恒返回 `{targets: [], isAvailable: false}`、`openDesktopTarget()` 恒 `Promise.resolve()`）。058 只清了其中 `useIsLocalDaemon`/`isLocalExecution` 的喂入，整条 desktop-open 链仍在编译、渲染与 i18n 里活着，但**每个消费点拿到的都是编译期常量**：`fileManagerTarget` 永远 undefined、`source === "desktop"` 的 planner 结果永远找不到、`ThemedEditorTargetIcon` 永远不渲染。

Ponytail review（PR #10，2026-09-28）确认该链 100% 死代码，净删约 260 行 + 孤儿 i18n 键。按 058 的范围声明（「shim 本体与其余消费不在本 issue 范围」）留作本 issue。

## 删除清单（ponytail 报告原文整理）

1. `packages/app/src/workspace/desktop-open-targets.ts`（34 行，整文件）
2. `packages/app/src/workspace/open-in-editor/directory.ts`（63 行，整文件——`canUseDesktopBridge: false` 使 hook 恒返回 null；唯一调用方 `file-explorer-pane.tsx:449` 已用 `?.` 容忍）+ `file-explorer-pane.tsx` 调用点
3. `planner.ts`：`planDesktopOpenTargets`、`PlannedDesktopOpenTarget`、`source: "desktop"` union 成员、`desktopTargets`/`canUseDesktopBridge` 入参（三个调用点全是常量 false）
4. `components/icons/editor-target-icon.tsx`（27 行，`ThemedEditorTargetIcon`，唯一消费者 button.tsx 且永不渲染）
5. `open-in-editor/button.tsx`：`useDesktopOpenTargets`/`isDesktopOpenAvailable`/`openDesktopTarget`/`ThemedEditorTargetIcon` 管道（约 25 行；forge/web 源保留）
6. `file-explorer-pane.tsx`（L447-448、L598-621、L977-980）与 `diff-pane.tsx`（L1607-1608、L1736-1750）：`fileManagerTarget` find（恒 undefined）→ `handleRevealEntry`（永远早退）→ `onRevealEntry`/`revealTargetName`/`onOpenInEditor`/`editorTargetName` props
7. `file-actions-menu.tsx`（L61、L88、L178-182、L269）及 `diff-document/document-file-header.tsx`、`diff-document/types.ts`、`file-header.tsx`、`diff-folder-row.tsx`：`revealTargetName`/`onReveal` 线程与永远不渲染的「Reveal in {{target}}」菜单项；随后删除孤儿 i18n 键 `workspace.fileActions.revealIn`、`workspace.fileExplorer.errors.revealFailed`（× 9 locale）

## 方案

主会话内按清单批量删除（项目规则：大批量删除/refactor 不派子代理），每删一层跑一次 typecheck 收敛引用。planner 保留 forge 源与 web 语义；`open-in-editor/button.tsx` 保留（forge 打开仍活）。

## 验证

- `npm run typecheck` / `npm run lint` / `npm run format` 全绿
- `rg "desktop-open-targets|useDesktopOpenTargets|openDesktopTarget|ThemedEditorTargetIcon|planDesktopOpenTargets|revealIn|Reveal in"` 零命中（除本 issue 与 025 记录）
- 相关 vitest：planner、file-explorer 相关测试文件
- 浏览器抽查：文件管理器菜单无「Reveal in」残留项，diff 面板正常

## 执行记录（2026-10-10，当日完成并关闭）

**净删减：22 文件，+15 / −546 行**（含 i18n 18 键、3 个整文件）。

清单逐项落地：

1. 删 `desktop-open-targets.ts`（34 行整文件）、`open-in-editor/directory.ts`（63 行整文件）、`components/icons/editor-target-icon.tsx`（27 行整文件）。
2. `planner.ts` 剥掉 desktop 分支：删 `planDesktopOpenTargets`、`PlannedDesktopOpenTarget`、`source: "desktop"` union 成员、`desktopTargets`/`canUseDesktopBridge` 入参；`planWorkspaceOpenTargets` 只剩 forge 源。
3. `button.tsx`：删 `useDesktopOpenTargets`/`isDesktopOpenAvailable`/`ThemedEditorTargetIcon` 与 desktop 分支，forge map 内联（不再需要 source 判别）。
4. `file-explorer-pane.tsx`：删 `onOpenInEditor`/`editorTargetName`/`onRevealEntry`/`revealTargetName` 四个 props 及其 handler、dispatcher 转发与 deps。
5. `diff-pane.tsx`：删 `fileManagerTarget`/`handleRevealPath` 与 mode 的 `onReveal`/`revealTargetName`；删 JSX 两处转发。
6. `file-actions-menu.tsx`：删 `reveal` 菜单项与两 props；顺带删孤儿 import `FolderOpen`。
7. `file-header.tsx`、`diff-folder-row.tsx`、`diff-document/types.ts`、`diff-document/document-file-header.tsx`：删 props 线程与 memo 比较器两项。
8. i18n：9 locale × 2 键（`workspace.fileActions.revealIn`、`workspace.fileExplorer.errors.revealFailed`）= 18 键删除。

**与 059 清单的一处偏差：** `planner.test.ts` 未在清单中，但它 8 个用例里 5 个测 desktop 规划——按 ponytail 的「测试跟着行为走」原则重写为只留 forge 三例（blob/tree URL、forge 推断、无 git 时为空）。

**验证：**

- `tsgo --noEmit` 全绿；`oxlint` 0 error 0 warning；`format` 全绿。
- 测试：open-in-editor + file-actions-menu + diff-document 95 绿；i18n 54 绿（含 key-contract 的 9 locale 对称性）；file-header 6 绿；diff-tree + explorer-paths 20 绿。
- 零命中：`desktop-open-targets|useDesktopOpenTargets|openDesktopTarget|planDesktopOpenTargets|ThemedEditorTargetIcon|onRevealEntry|revealTargetName|useOpenDirectoryInEditor|revealIn|revealFailed` 全仓（除 byissue 历史）。
- **浏览器抽查（真实 dev 环境，daemon 6778 + expo 8081）**：文件管理器上下文菜单为 `Open file / Open to the side / Copy path / Copy relative path / Download / Add to chat / Duplicate / Discard changes`，**无「Reveal in」项**；diff 面板文件头菜单同样无该项且面板渲染正常。保留面确认：`Open workspace in GitHub` 按钮仍在（forge 源未受影响）。

完成后 `desktop-open` 主题归零，025 的退役残留再少一条。

## 制度记忆影响

- 来源：ponytail review of PR #10（记录见 058 执行记录与 PR 讨论）；058 的范围排除声明由本 issue 接手。
- 完成后 `desktop-open` 主题归零，025 的退役残留再少一条。
