---
type: ff
---

# Skills 默认不安装任何一项

## 做了什么

用户要求：默认不安装任何 skill，不管是什么模式。把 `defaultSkillSelection()` 从 `{mode:"custom", skills:["byspace"]}` 改回空选择 `{mode:"custom", skills:[]}`。

这是对 `2026-11-09-x-retire-mcp-tools-for-skill-cli.md` 第 4 条的回收：那次把参考 skill 设为默认安装，理由是 agent 需要它才知道 CLI 存在；结果是任何没有存档选择的新 daemon home（dev、测试、全新 checkout）启动时都会把 `byspace` 写进共享的真实用户目录，用户在任一 host 卸载后又会看到它出现。现在安装永远是显式选择。

空默认下的行为：

- 全新 home / 没有存档选择：启动不装任何 skill，Skills 卡片进入选择流程。
- 用户显式保存选择（`custom` 或 `all`）：启动维护照常补齐/更新，这是用户自己的选择。
- 卸载仍然保存空选择，启动不会装回来。

## 改了哪些

- `internal/server/skills.go`：`defaultSkillSelection()` 返回空选择；删除 `noSkillsSelection()`（默认与卸载后的选择现在是同一个值，区别只在是否已存档）；启动维护注释改为“没有存档就什么都不装”。
- `internal/server/ws_git_system.go`：卸载成功后保存 `defaultSkillSelection()` 的空选择。
- `internal/server/skills_test.go`：回归测试改为三断言——构造 server 不写；无存档启动不写；显式保存 `byspace` 后启动才安装到两个 home。
- `web/e2e/support/helpers/agent-skills.ts`：E2E 的隔离 daemon 只设了 `HOME`；Windows 的 `os.UserHomeDir()` 读 `USERPROFILE`，所以 spec 里的安装仍会写进开发者真实目录。补设 `USERPROFILE`，并更新两处「启动会装参考 skill」的过期注释。
- `web/e2e/browser/agent-skills-settings.spec.ts`：首次安装和保存失败两处断言从默认 `["byspace"]` 改为空选择。
- `byissue/spec/agent-tools.md`：「技能默认装」改为「技能不默认安装，用户显式选择后才有」。
- `public-docs/skills.md`、`public-docs/agent-tools.md`、`docs/providers.md`：删掉 `/byspace`「Always installed / installs by itself」的表述，改成必须先选择。

## 怎么验证的

- 新增测试 `TestSkillInstallRequiresAnExplicitSelection`：`New` 后为空；`AutoUpdateInstalledSkills`（无存档）后仍为空；保存 `{mode:"custom",skills:["byspace"]}` 后再启动，两个 home 都安装。
- `go test ./internal/server -run 'TestSkillInstallRequiresAnExplicitSelection|TestUninstallRecords|TestSkillsInstallAndUninstall' -count=1` 通过。
- `go build ./internal/...`、`npm run typecheck`、`npm run lint`、`npm run format:check` 通过。
- 本机真实目录 `~/.agents/skills`、`~/.claude/skills` 当前没有 `byspace`；本机生产配置本来就是空选择。
- Playwright 的 `agent-skills-settings.spec.ts` 未跑通：本机没有安装 chromium。但这次尝试复现了 E2E helper 的 Windows 泄漏（隔离 daemon 只设 `HOME`、没设 `USERPROFILE`，跑 spec 时真实目录在 12:15:32 又出现），已随本条补上 `USERPROFILE` 并删除真实目录；浏览器安装后需重跑该 spec 作为 UI 验收。

## 对 byissue/ 的影响

- **spec 约束变更**：`byissue/spec/agent-tools.md` 的「技能默认装」已按用户 2026-11-11 的要求改为「不默认安装」。这是需求变更，不是文档纠错。
- 与 `2026-11-09-x-ff-orchestration-skills-default-install.md`、`2026-11-09-x-retire-mcp-tools-for-skill-cli.md` 的关系：前者已经要求“没选过就是没选过”，本条恢复该行为并作为长期默认。
