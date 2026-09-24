---
kind: issue
title: "修复 048 引入的文件头 hover 反馈回归；将 fork host 用例改写为 049 契约测试"
type: bug
status: closed
created: 2026-09-24
---

# 修复 048 引入的文件头 hover 反馈回归；将 fork host 用例改写为 049 契约测试

> **读者：** 修这两个回归的人。两者都源自 `8d30839b6`（issue 048 曲率 + 049 host scoping），main 自该 commit 起 CI 的 playwright shard 2/8 常红。issue 050（设置分类精简）的 PR 只是与该 shard 重叠，不承载本修复。

## 预期与实际

**回归一：Changes 文件头 hover 反馈不可见（视觉回归）**

- 预期：hover 文件头出现可辨别的背景变化；e2e `changes-pane.spec.ts:393`（canvas 像素断言）通过。
- 实际：048 把浅色主题 `surface0` 从 `#f6f7f8` 改为 `#ffffff`，与 `surface1`（`#ffffff`）撞色。文件头 hover/按压画的是 `surface1`（DOM：`file-header.tsx` 的 `documentActive`/`documentPressFeedback`；canvas：`diff-document/palette.ts` 的 `headerActiveSurface`），平时背景是 `surface0`——两者同色，反馈消失。

**回归二：fork 草稿的 host 切换被 049 项目 scoping 禁用（测试过时，非行为回归）**

- 049 加的 `canSwitchHost = host.allHosts.length > 1`（`new-workspace-screen.tsx:1484`）把 `host-picker-trigger` 禁用，`availableHosts` 在选中项目后收窄到项目所在 host。
- 深入诊断后确认这是**正确设计**（用户拍板）：fork 跳转带源项目 `projectId` 进路由（`use-fork-agent.ts:186`），草稿预选了该项目；项目不存在于其他 host 时切过去工作区根本建不出来。附件保留性由 `draftId` 作用域保证，与切 host 无关。
- `e2e/browser/assistant-fork-menu.spec.ts:154` 是 049 之前的旧契约（「附件在切 host 后存活」），已过时。

## 改什么

1. 文件头 hover/按压背景：`surface1` → `surface2`（`#f0f1f3`，与 sidebar hover 同灰阶层）。落点：`src/git/file-header.tsx` 的 `documentActive`、`documentPressFeedback`；`src/git/diff-document/palette.ts` 的 `headerActiveSurface`。画布 `headerSurface`（平时底色）保持 `surface0` 不变。
2. e2e 用例改写为 049 契约测试：「forks an assistant turn into New Workspace and locks the host picker to the source project」——断言 host-picker-trigger disabled（两台 seeded host、源项目仅在主 host）；附件存活改由紧随其后的提交用例（「keeps the fork attachment after the new agent receives its user message」）继续覆盖。

## 验证

- `npx vitest run src/git/file-header-presentation.test.ts src/git/diff-document/palette.test.ts src/git/diff-document/paint.web.test.ts --bail=1`（像素/调色板断言需与 `surface2` 同步）。
- Playwright：`changes-pane.spec.ts:393` 与 `assistant-fork-menu.spec.ts:154` 在本地或 CI 通过（二者正是 main 上红的两个用例）。
- `npm run typecheck`、`npm run lint`。

## 执行记录

（实现阶段追加）

## 关闭回写与结论

- 回归一若复核出其他 `surface0`/`surface1` 撞色点，逐个记录 token 决策；稳定结论（如「surface0 与 surface1 不得同为 #ffffff」的设计约束）进 project spec。

**执行记录（收尾补充）**：hover token 修复 + e2e 契约改写已实现并验证（4 个 git 单测文件 22 断言、typecheck/lint/format 绿）；fork 用例按用户裁决改写为 049 契约测试，附件存活由相邻提交用例继续覆盖。无 spec 毕业候选。
