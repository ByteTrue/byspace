---
type: ff
---

# 测试构造 daemon 时把 byspace skill 装进真实用户目录

## 做了什么

根因：`server.New` 里无条件调用 `autoUpdateInstalledSkills`，而该函数用 `os.UserHomeDir()` 把参考 skill 写进真实的 `~/.agents/skills` 与 `~/.claude/skills`。任何只给 daemon 一个临时 home、没有同时重定向 `HOME`/`USERPROFILE` 的测试，都会在跑测试时装上 `byspace`——用户卸载后隔一段时间又出现，来源就是测试套件，不是用户点了安装。

修复：把启动维护从构造函数移到真正的 daemon 入口（`internal/cli/main.go` 的 `serve` 与 `internal/gui/backend.go`），方法导出为 `AutoUpdateInstalledSkills`。构造 server 不再产生任何用户目录副作用；离线配对等构造路径也不会。

## 改了哪些

- `internal/server/server.go`：移除 `New` 中的调用，留注释说明原因。
- `internal/server/skills.go`：`autoUpdateInstalledSkills` → 导出 `AutoUpdateInstalledSkills`，注释明确“只从 daemon 入口调用”。
- `internal/cli/main.go`、`internal/gui/backend.go`：在 `server.New` 后显式调用。
- `internal/server/skills_test.go`：新增回归测试，断言构造 server 不写用户目录、显式调用入口方法才安装。

## 怎么验证的

- 修复前，单独跑原本不涉及 skills 的 `TestBackgroundGitFetchTargetsArePerRepository` 会打印 `skills auto-updated (1 operation(s))`，并在真实 `~/.agents/skills/byspace`、`~/.claude/skills/byspace` 创建目录（实测，2026-11-11）。
- 修复后同一测试不再打印维护日志，两个真实目录保持不存在（实测）。
- `TestNewDoesNotInstallSkillsUntilTheDaemonEntryPointRuns` 通过：构造后为空，调用 `AutoUpdateInstalledSkills` 后两个 home 都有参考 skill。
- `go build ./internal/...` 通过。

## 对 byissue/ 的影响

无 spec 变更。本机 `~/.byspace/config.json` 的 `agents.skills.selection` 为空，生产 daemon 自身不会再安装；测试装出来的两份 `byspace` 副本已删除。注意：全新的 dev home（`.dev/byspace-home`）仍按产品默认在启动时安装参考 skill，那是 daemon 启动行为，不是测试；要在 dev host 也保持为空，需在该 host 的 Skills 页卸载一次（选择会持久化）。
