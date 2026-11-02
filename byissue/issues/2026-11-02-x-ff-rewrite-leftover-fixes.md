---
kind: issue
title: "快改：前端重写途中发现、还没修的问题"
type: ff
created: 2026-11-02
---

# 快改：前端重写途中发现、还没修的问题

用户要求把定时任务和前端重写途中发现的其它问题（前端、daemon）全部快改修掉。每项照 Node 版或旧版的行为修。

Daemon：

- **定时任务执行层**：照 Node 重写，详见 [schedule-runner-port](2026-11-01-o-schedule-runner-port.md) 的「实现」一节。`internal/schedule/`、`internal/server/schedule_runner.go`、`internal/server/mcp_schedule.go`、`internal/server/ws_agent.go`。
- **工作区和分支的自动命名从不把提示词发给模型**：`PiGenerator.Generate` 只发了指令，名字都是「Untitled coding task」这类。`internal/naming/naming.go`。
- **不可用的提供方带着模型列表**：关掉或没装的提供方仍列出静态模型，选择器里能点没装的 Claude 的模型，点了没反应。照 Node 只有 ready 才带模型和模式；关掉的自定义提供方 `enabled` 不再恒为 true。`internal/agent/providers/driver.go`。
- **GitLab、Gitea 的 PR 讨论**：照 Node 移植。GitLab 读 discussions（回复串、文件和行、已解决），Gitea 读评论、审查和每个审查的行内评论。原来只读平铺的评论。`internal/workspace/forge_timeline.go`。
- **GitHub Enterprise**：`gh api` 原来总查 github.com。照 Node 给 gh 带 `GH_HOST`，SSH 别名先用 `ssh -G` 解析成真实主机，未登录的 Enterprise 主机报未认证。`internal/workspace/github_host.go`、`forge.go`、`forgeauth.go`。
- **`byspace run --output-schema` 被忽略**：照 Node 传给 Codex（规范化后放进 `turn/start`）和 OpenCode（`json_schema` 格式）；其它提供方 Node 也不支持。`internal/agent/providers/output_schema.go`、`codex.go`、`opencode.go`、`internal/server/server.go`。
- **CLI**：`schedule create` 需要 `--provider`，`heartbeat create` 只能在 agent 里用（同 Node CLI）；被 daemon 拒绝的请求显示原因，原来等到超时。`internal/cli/`。

前端（旧版、新版）：

- **「Mark as unread」**：只在有可标记的 agent（未归档、已完成的根 agent）时显示，原来没有 agent 的工作区也显示、点了报错。`packages/app/src/hooks/use-workspace-read-state.ts`。
- **只走 `Alert.alert` 的错误在网页上不显示**（关提供方失败、重启失败、保存失败等）：现在显示成错误提示条。三个已在表单里显示错误的配对弹窗不再另弹。`web/src/shims/react-native.ts`、`web/src/app/global-listeners.tsx`、`web/scripts/port/add-host-modals.py`、`welcome-screen.py`。
- **Markdown 表格的列对齐**（`:---:`、`---:`）生效。`web/src/markdown/render.tsx`。

审计：

- `npm run audit` 把没有基线的一步（Go 测试、出站对账、浏览器检查）失败当成提醒，照样报「全部通过」。改成失败；「解析了但从未使用」仍只提醒。`scripts/audit.mjs`、`go-parity-audit.mjs`。
- 浏览器检查从 bsk 改用仓库里的 Playwright（无头 Chromium，不碰用户的浏览器），并适配现在的模型选择器；原来「3 项过 2 项」，现在 12/12。`scripts/browser-conformance.mjs`、`docs/go-parity-audit.md`。
- 出站对账能认出 builder 里按下标设置的字段。`scripts/go-emit-parity.mjs`。

验证：Go 测试（新增定时、命名、提供方目录、PR 讨论、GHES、output schema、CLI）、`npm run audit` 全部通过、typecheck、lint。开发版实测见定时任务事项；另外：命名在开发版建工作区得到「Fix flaky login redirect test in auth module」（原来是「Untitled coding task」）；8081、8082 上没有可标记 agent 的工作区不再有「Mark as unread」，有的仍有，8082 上标为未读、标为已读都正常；配对弹窗只显示表单里的错误，`Alert.alert` 在 8082 显示提示条；8082 的 Markdown 预览里左、中、右对齐生效。

没验到：GitLab、Gitea 的真实 PR（本机没有登录的账号）；GitHub Enterprise（没有主机）；output schema 接真实 Codex、OpenCode（会调用付费模型，本机没装 Codex）。

byissue：定时任务事项写了实现和验证，等用户验收关闭。

顺手发现：Go CLI 的 `schedule` 子命令比 Node 少 `--target`，这次只让 `create` 的默认目标与 Node 一致。
