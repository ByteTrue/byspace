---
kind: issue
title: "Fix stale Push button after untracked push"
type: ff
status: closed
created: 2026-08-02
epic: ""
---

# Fix stale Push button after untracked push

## 做了什么

用户反馈：本地分支内容已经和 origin 同名分支完全一致（已推送），但 Web 端 Git 面板刷新多次后仍然显示 Push 按钮。定位到根因：daemon 计算 `aheadOfOrigin`/`behindOfOrigin` 只信任 git 配置的 upstream tracking（`branch.<name>.remote/.merge`）。如果分支是不带 `-u` 推送的（例如在终端直接 `git push origin <branch>`），本地永远不会记录 tracking 关系，`aheadOfOrigin` 永远是 `null`；`hasPushableCommits` 把"BySpace worktree + aheadOfOrigin 为 null + 领先 base 分支"当作"从未推送、可推送"，Push 按钮因此永远不消失——不是缓存问题，刷新多少次都一样。

## 改了哪些

- `packages/server/src/utils/checkout-git.ts` — `getOriginAheadBehind` 在没有配置 upstream 时，回退检查是否存在同名的 `refs/remotes/origin/<branch>`，存在则以它作为比较对象计算 ahead/behind，不再直接返回 `null`。新增私有 helper `getSameNameOriginRef`（复用已有的 `doesGitRefExist`）。真正从未推送过的分支（同名远端 ref 不存在）行为不变，仍返回 `null`。
- `packages/server/src/utils/checkout-git.test.ts` — 新增回归测试 "reports up to date when a branch was pushed without setting an upstream"。

## 怎么验证的

- 用真实证据复现根因：截图中的 worktree（`ruthless-camel`，分支 `feat/pair-device-qr-code`）本地 HEAD 与 `refs/remotes/origin/feat/pair-device-qr-code` 是同一 SHA，但 `branch.*.remote`/`.merge` 未配置，与假设的根因完全吻合。
- `cd packages/server && npx vitest run src/utils/checkout-git.test.ts --bail=1` → 130/130 通过（含新增用例，且既有的 3 个相关用例——remote 已删除、fresh no-track worktree、local-only no-track worktree——均未受影响）。
- `packages/server` 的 `npm run typecheck`（tsgo）→ 通过。
- `npm run lint -- packages/server/src/utils/checkout-git.ts packages/server/src/utils/checkout-git.test.ts` → 0 警告 0 错误。
- `npm run format:check:files -- 同上两个文件` → 格式正确。

## 对 .cs/ 的影响

- 无已记录真相受影响：ahead/behind-of-origin 的推导属于实现内部逻辑，project spec 未记录过这层细节，本次是修正推导正确性，不改变任何已写入 spec 的行为承诺。

## 顺手发现（可选）

- 同一个 `aheadOfOrigin` 计算结果也喂给 worktree 归档风险提示（`worktree-archive-warning.ts`）和自动归档安全检查（`archive-if-safe.ts`）；这次修复顺带让它们在"已推送但无 tracking"场景下更准确（之前会把 `null` 当成 0 处理），未单独改动这两个文件。
