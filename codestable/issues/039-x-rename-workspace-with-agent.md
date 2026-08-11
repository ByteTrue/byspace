---
kind: issue
title: "用 Agent 精炼 Workspace 与分支名称"
type: feature
status: closed
created: 2026-08-11
---

# 用 Agent 精炼 Workspace 与分支名称

## 目标

首条 prompt 生成的 title 与 branch 继续提供零操作初始命名；当工作意图收敛后，用户可以从 Workspace 菜单复制固定 prompt，交给最理解该 Workspace 的 Agent，根据完整对话和实际仓库改动精炼名称。

## 已确认边界

- 菜单只复制 prompt 并提示用户粘贴，不自动发送、不选择 Agent、不新增确认 modal。
- `rename_workspace` 与 `rename_branch` 是两个独立 Tool；标题是 Workspace 状态，分支是共享 Git 状态，不伪装成原子操作。
- 第一版只允许重命名仍为 BySpace 生成名称（包括一次性初始自动名）、未发布、无 upstream、无 PR/MR 的 BySpace-owned worktree branch。
- default、published、upstream-tracking、PR/MR、非 BySpace、已人工改名或名称冲突的 branch 只改 title，并报告跳过原因。
- title 与 branch 分别生成，不把 title 机械 slugify 成 branch。
- 保留现有首 prompt 自动生成逻辑，但只视为一次性初始命名；不得持续自动改名。
- 延迟的初始 branch 自动命名和显式 branch rename 都必须在真正应用前重新检查安全条件。

## 实现

1. 在共享 Tool Catalog 暴露 `rename_branch`，CLI 继续通过 `byspace tool call` 使用，不新增专用 CLI。
2. 在 Git/worktree 服务集中执行 branch 资格、发布状态与冲突检查。
3. 在 bundled `byspace` Skill 中记录两个独立 Tool 的语义和安全边界。
4. 在 Workspace `⋮` 菜单新增 capability-gated “Rename with agent”，复制固定 prompt 并显示 toast。
5. 保留现有 `rename_workspace` 和首 prompt 自动命名流程。

## 验证

- 目标单测覆盖可重命名分支、已人工改名、published/upstream 以及初始自动命名的应用时复检。
- Tool Catalog 测试覆盖 caller cwd 传递与结构化结果。
- 旧 daemon 不声明 optional capability 时不显示入口。
- 运行目标测试、Web export、全仓 typecheck、lint、format check 与独立复核。

## 执行记录

- 共享 Tool Catalog 新增 `rename_branch`；CLI 与 MCP 继续复用同一 catalog，不新增专用命令。
- 分支重命名统一经过 worktree metadata、default/upstream/published/conflict 检查；初始自动命名与显式重命名共用 lifecycle 串行边界，并在 Git mutation 时校验预期当前分支，避免检查与应用之间改名。
- 自动与显式重命名都只在 Git 成功后写入 `renamedBranchName`；后续 Agent 仍可继续精炼 BySpace 已命名的分支。
- daemon 通过 optional `server_info.features.workspaceAgentRename` 暴露能力；旧 daemon 不显示菜单项。Workspace 菜单只复制固定 prompt 并显示成功/失败 toast。
- bundled `byspace` Skill 记录 title-first、branch-best-effort 的两个独立 Tool 流程和跳过规则。

## 验证与关闭结论

- 分支服务目标测试：7/7；Git rename guard 目标测试：3/3；Tool Catalog 与 `server_info` 目标测试各 1/1。
- Desktop Chrome E2E：`sidebar-workspace-rename.spec.ts` 2/2；最终单独复跑 copy-prompt 用例 1/1。
- `npm run build:server`、`npm run typecheck`、`npm run lint`、`npm run format:check`、`git diff --check` 全部通过；真实 Web export 成功。
- 独立复核指出的检查/应用竞态、成功前写 metadata、刷新失败误报和 prompt 顺序问题均已修复。
- 关闭：首 prompt 自动名继续作为一次性初始名；用户可显式把固定 prompt 交给最理解当前工作的 Agent，title 始终可改，branch 只有通过安全检查时才 best-effort 改名。
