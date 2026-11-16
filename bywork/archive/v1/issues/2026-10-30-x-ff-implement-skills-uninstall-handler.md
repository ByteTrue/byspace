---
kind: issue
title: "修复 Orchestration skills 点击 Uninstall 后未卸载：补齐 Go 端 uninstallSkills 实现"
type: ff
status: closed
created: 2026-10-30
closed: 2026-10-30
---

# 修复 Orchestration skills 点击 Uninstall 后未卸载：补齐 Go 端 uninstallSkills 实现

- **做了什么**：
  - **根因定位**：在 `internal/server/ws_git_system.go:1239` 中，`"agent.skills.uninstall.request"` 与 `"agent.skills.reconcile.request"` 此前共用同一个 `case` 分支，收到 `uninstall` 请求时错误地调用了安装函数 `applySkillsStatus(sourceDir, userHome, getSkillsStatus(...))`（当已处于 `up-to-date` 时 `ops` 为空，什么都不删除），根本未移植 Node 原版 `operations.ts` 的 `uninstallSkills`！
  - **修复（对照 `v0.23.0:archive/packages/server/src/server/orchestration-skills/internal/operations.ts`）**：
    1. 在 `internal/server/skills.go` 中补齐 `legacySkillNames`（10 个受管 skill 名称）与 `uninstallSkills(sourceDir, userHome, selection, selectedTargets)`，遍历所有受管 agent homes（`~/.agents/skills` 与 `~/.claude/skills`）生成 `delete` ops 并通过事务化 `applySkillsStatus` 完整删除；
    2. 在 `internal/server/ws_git_system.go` 中将 `"agent.skills.uninstall.request"` 独立分派至 `uninstallSkills`；
    3. 在 `internal/gui/app.go` 中移除 `d.AttachToWindow(w)`，使确认弹窗居中展示而不再受自定义隐藏标题栏影响贴在窗口左上角。
- **改了哪些**：
  - `internal/server/skills.go`、`internal/server/ws_git_system.go`、`internal/server/skills_test.go`
  - `internal/gui/app.go`
- **怎么验证的**：
  - `go test -v ./internal/server -run TestSkillsInstallAndUninstallRemovesAllManagedSkillDirs` 通过；
  - `go test ./internal/gui/...` 全绿。
- **对 `byissue/` 的影响**：修复 Node→Go 移植遗漏的伪实现（遵守 #2189 规则）。
