---
type: ff
---

# Orchestration skills 关了又被装回来

## 做了什么

预期：在设置里关掉（卸载）Orchestration skills 之后，这个 host 就不该再有它们。
实际：过一段时间、尤其是起 dev daemon 之后，`~/.agents/skills` 和 `~/.claude/skills` 里的 BySpace
skill 目录又出现了。

三个原因，第三条才是「每次起 dev 都给我装上了」的真正来源：

1. **没有存档的 host 默认想要整套 bundle。** `savedSkillsState`、`autoUpdateInstalledSkills` 和
   `agent.skills.*` 三个 handler 在 `config.json` 没有 `skillsSelection` 时都退到
   `{mode: "all"}`。dev home（`.dev/byspace-home`）就属于这种：没有任何存档，于是它对「要装哪些」
   的回答是「全部」。启动时的 `autoUpdateInstalledSkills` 只要看到一点 drift（比如另一个 host 装过、
   或者 dev bundle 多了一个 skill）就会把缺的补上——补的就是用户刚删掉的东西。安装目标同理：没有
   存档时默认两个 home 全写，所以只在 App 那边关掉 `~/.claude` 这一处，也拦不住 dev daemon。
2. **卸载不记录选择。** `uninstallSkills` 只删目录，存档里的 selection 还是 `all`，所以「关掉」从来
   没变成一条持久的选择。任何一次 drift 都会把它修回来。
3. **服务端的 skills 测试往真实 home 里装。** `internal/server/server_test.go` 的
   `TestServerFileExplorerPiSessionImportAndTerminalRPC` 会发真实的 `agent.skills.save_selection.request`
   （`{mode:"all"}`、targets `["agents"]`），而它构造的 server 用的是真实 `$HOME`，于是每跑一次
   `go test ./internal/server/`（`npm run test:go`、`npm run audit` 都包含）就把 6 个 skill 装进开发者的
   `~/.agents/skills`。实测：跑包测试后目录出现，创建时间正好落在那次测试里；`HOME=/tmp/xxx` 跑同样的
   包，目录就长在那个临时 home 里。

按「不要默认安装」改：没选过就是没选过。

## 改了哪些

- `internal/server/skills.go`：新增 `defaultSkillSelection()` = `{mode: "custom", skills: []}`，替换
  `savedSkillsState` 和 `autoUpdateInstalledSkills` 里的 `{mode: "all"}` 默认值。
- `internal/server/ws_git_system.go`：`get_status` / `reconcile` / `uninstall` 的默认 selection、
  `save_selection` 与 `import_legacy_selection` 的 nil 兜底都改成同一个默认；`uninstall` 成功后把空
  selection 存进 config 并用它重算 status，响应里的 `selection` 就是「什么都不选」。
- `public-docs/skills.md`：安装段补「没选之前不装」，卸载段补「卸载会记住，下次启动不会装回来」。
- `internal/server/server_test.go`：`TestServerFileExplorerPiSessionImportAndTerminalRPC` 开头
  `t.Setenv("HOME", t.TempDir())`，测试不再写开发者的真实 home。验证：清空 `~/.agents/skills` 后跑整个
  `go test ./internal/server/`，目录仍是空的（改前每次跑完多出 6 个目录）。
- 新增两个回归测试：
  - `internal/server/skills_test.go`：`TestBootRepairInstallsNothingWithoutAStoredSelection`——一个残留
    了旧副本、又没有存档的 home，`New()` 的启动修复不能补装。
  - `internal/server/skills_uninstall_test.go`：`TestUninstallRecordsEmptySelectionSoStartupDoesNotReinstall`
    ——走真实 WS：先让启动修复把 bundle 补齐（证明修复在这条路上是活的），再发
    `agent.skills.uninstall.request`（响应 selection 必须是 custom/空），然后在同一个 home 上再 `New()`
    一次，目录不能回来。

两个测试都验过「改前失败、改后通过」：把默认值改回 `all` → 启动修复打印
`skills auto-updated (1 operation(s))` 并装回；把卸载时的保存删掉 → 响应里 selection 还是 `all`。

## 怎么验证的

- `go test ./internal/server/ ./internal/store/ ./internal/cli/` 全绿（含上面两个新测试）。
- `cd web && npx vitest run src/core/agent-skills` → 2 passed（`hasSelectedSkill` 对 custom/空的选择
  返回 false，设置页只剩「Choose skills」，不会出现一个点了没反应的 Install 按钮）。
- 本机现状：`~/.agents/skills` 空、`~/.claude/skills` 只有 magpie-skills（测试期间装进去的 6 个已清掉）。
- `npm run audit --no-browser` 全绿。
- 未改：`~/.byspace`（打包版）里存的仍然是 `{mode: "all"}`，那是它自己的存档；在那一侧点一次
  Uninstall（现在会记住）或重新选择即可，dev home 不受影响。

## 对 byissue/ 的影响

无 spec 变更。沉淀候选：`byissue/notes/` 里没有「技能安装是每-home 存档、目录是全局的」这条事实，
下次再遇到「A host 关掉、B host 装回来」可以直接查。要不要写，等这批审查结论一起定。
