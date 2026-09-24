---
kind: issue
title: "修复 048 hover 反馈回归与 049 host 选项过滤失真"
type: bug
status: open
created: 2026-09-24
---

# 修复 048 hover 反馈回归与 049 host 选项过滤失真

> **读者：** 修这两个回归的人。两者都源自 `8d30839b6`（issue 048 曲率 + 049 host scoping），main 自该 commit 起 CI 的 playwright shard 2/8 常红。issue 050（设置分类精简）的 PR 只是与该 shard 重叠，不承载本修复。

## 预期与实际

**回归一：Changes 文件头 hover 反馈不可见（视觉回归）**

- 预期：hover 文件头出现可辨别的背景变化；e2e `changes-pane.spec.ts:393`（canvas 像素断言）通过。
- 实际：048 把浅色主题 `surface0` 从 `#f6f7f8` 改为 `#ffffff`，与 `surface1`（`#ffffff`）撞色。文件头 hover/按压画的是 `surface1`（DOM：`file-header.tsx` 的 `documentActive`/`documentPressFeedback`；canvas：`diff-document/palette.ts` 的 `headerActiveSurface`），平时背景是 `surface0`——两者同色，反馈消失。

**回归二：host 选项过滤的两种失真（049 实现方式错误，语义本身正确）**

- 049 意图正确（项目不在某 host 上时该 host 不应出现在选项里），但实现有两处失真：
  1. 过滤基于选中条目的 `hosts`，而等价合并条目在同 server 有重复 clone 时会被拆分逻辑削掉部分 host（`workspace-structure.ts` 的 `canUseSharedKey` 仅在单 clone 时用等价 viewKey）——preservation 场景两台都添加过 BySpace，选项却只剩 secondary。
  2. `canSwitchHost` 禁用门控把「选项过滤」错误实现成了「触发器禁用」，误伤 fork 草稿（路由钉定项目但目标只在主 host）与自动带出项目场景的切 host 契约。
- 用户拍板语义：选项 = 添加过该 repo（含等价 clone）的 host；没 clone 过的 host 不得出现；**触发器不禁用**。

## 改什么

1. 文件头 hover/按压背景：`surface1` → `surface2`（`#f0f1f3`，与 sidebar hover 同灰阶层）。落点：`src/git/file-header.tsx` 的 `documentActive`、`documentPressFeedback`；`src/git/diff-document/palette.ts` 的 `headerActiveSurface`。画布 `headerSurface`（平时底色）保持 `surface0` 不变。
2. host 选项过滤重写：project picker 暴露 `isProjectSelectionLocked`（manual 选择或路由钉定）；`availableHosts` 在锁定时按等价组（同 projectKey）覆盖的 host 服务器集合过滤，未锁定（自动带出）时列全部。删除 `canSwitchHost` 禁用门控与触发器 disabled 逻辑。
3. e2e：fork 用例改断言「没添加项目的 host 不出现在选项」；preservation/composer-draft/new-workspace/entry 各用例随新语义恢复（选项过滤而非禁用）。

## 验证

- `npx vitest run src/git/file-header-presentation.test.ts src/git/diff-document/palette.test.ts src/git/diff-document/paint.web.test.ts --bail=1`（像素/调色板断言需与 `surface2` 同步）。
- Playwright：`changes-pane.spec.ts:393` 与 `assistant-fork-menu.spec.ts:154` 在本地或 CI 通过（二者正是 main 上红的两个用例）。
- `npm run typecheck`、`npm run lint`。

## 执行记录

（实现阶段追加）

## 关闭回写与结论

- 回归一若复核出其他 `surface0`/`surface1` 撞色点，逐个记录 token 决策；稳定结论（如「surface0 与 surface1 不得同为 #ffffff」的设计约束）进 project spec。

**执行记录**：

- 第一轮：hover token 修复完成并验证（4 个 git 单测文件 22 断言绿）；fork 用例一度改写为「断言 disabled」的契约测试并关闭。随后 shard 5 用例本地复现推翻该结论。
- 关键纠正：本地 Playwright 复现 preservation 用例 + trace 快照证实——项目正确选中 BySpace，触发器仍持续 disabled。根因是等价合并条目在同 server 有重复 clone 时被 `canUseSharedKey` 拆分，选中条目的 `hosts` 缺失部分 host；`canSwitchHost` 门控则把过滤错误放大成禁用。用户裁决：049 语义（按添加过滤）正确、实现错误、触发器不禁用。
- 第二轮：picker 暴露 `isProjectSelectionLocked`；`availableHosts` 锁定时按等价组 host 并集过滤，未锁定列全部；删 `canSwitchHost` 禁用门控；fork 用例改断言选项集合。探针代码已移除。
