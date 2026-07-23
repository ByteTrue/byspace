---
kind: issue
title: "区分本地/远程 Git 分支显示"
type: ff
status: closed
created: 2026-07-23
epic: ""
---

# 区分本地/远程 Git 分支显示

## 做了什么

给分支切换列表补上本地/远程来源说明，并用不同图标区分本地、远程和两端都存在的分支。

## 改了哪些

- `packages/app/src/hooks/use-branch-switcher.ts` — 优先消费 daemon 返回的 `branchDetails`，为分支项附加本地/远程描述与来源类型。
- `packages/app/src/components/branch-switcher.tsx` — 给分支选项渲染不同 leading icon：本地、本地+远程、远程。
- `packages/app/src/hooks/use-branch-switcher.test.ts` — 补了分支来源描述与图标来源判定的最小单测。
- `packages/app/src/i18n/resources/*.ts`、`packages/app/src/i18n/resources.test.ts` — 补齐 `branchSwitcher.localBranch` / `remoteBranch` 文案与校验。

## 怎么验证的

定向 vitest：`npm --prefix packages/app run test -- src/hooks/use-branch-switcher.test.ts src/i18n/resources.test.ts --bail=1`；随后跑过 `npm run typecheck`、`npm run lint -- ...`、`npm run format:check -- ...`。

## 对 .cs/ 的影响

无已记录真相受影响；这是现有分支切换 UI 的局部可见性优化。
