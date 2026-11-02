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
- **CLI**：`schedule create` 需要 `--provider`，`heartbeat create` 只能在 agent 里用（同 Node CLI）；`--run-now` 原来发成协议没有的字段、不生效，现在发 `runOnCreate`，不加时与 Node 一样等第一个时段；补上 Node 的 `--target`；被 daemon 拒绝的请求显示原因，原来等到超时。`internal/cli/`。
- **侧栏 PR 徽标从没出现过**：Go 不发工作区的 `githubRuntime`，也没有 PR 状态的后台轮询。照 Node 补上，同时修了 GitLab MR 的状态（开着的 MR 被当成已关闭）、PR worktree 不写元数据（fork 的 PR 找不回来）。详见 [forge-pr-status-push](2026-11-01-o-forge-pr-status-push.md) 的「实现」一节。
- **Gitea、Forgejo、Codeberg 的 PR 状态**：Go 没有，侧栏和 PR 面板对这类仓库永远是没有 PR。照 Node 移植（找 PR、提交状态与 Actions 检查），详见 [gitea-pr-status](2026-11-02-o-gitea-pr-status.md)。
- **在终端里切分支、提交，侧栏要等 5 分钟**（分支名、改动统计、PR）：Node 用文件监听当场发现。Go 现在有客户端连着时每 2 秒读一次每个检出的 HEAD 和分支 ref 文件，变了才跑 git。`internal/workspace/head_fingerprint.go`、`internal/server/head_watch.go`。

前端（旧版、新版）：

- **「Mark as unread」**：只在有可标记的 agent（未归档、已完成的根 agent）时显示，原来没有 agent 的工作区也显示、点了报错。`packages/app/src/hooks/use-workspace-read-state.ts`。
- **只走 `Alert.alert` 的错误在网页上不显示**（关提供方失败、重启失败、保存失败等）：现在显示成错误提示条。三个已在表单里显示错误的配对弹窗不再另弹。`web/src/shims/react-native.ts`、`web/src/app/global-listeners.tsx`、`web/scripts/port/add-host-modals.py`、`welcome-screen.py`。
- **Markdown 表格的列对齐**（`:---:`、`---:`）生效。`web/src/markdown/render.tsx`。
- **Diff 发糊**（125%、150%、175% 缩放下，Windows 默认就是这几档）：Diff 画布的位图比浏览器实际绘制的尺寸多出零点几个像素，整张图被重新采样。画布尺寸改成浏览器能按 1:1 显示的值，多出的几像素由容器裁掉；画布改成不透明（Chrome 只在不透明画布上用 ClearType 画字），文字基线对齐到像素格。`packages/app/src/git/diff-document/device-canvas.web.ts`、`surface.web.tsx`、`paint.web.ts`。
- **新建工作区页粘贴 PR 链接，列表显示「No matching refs.」**：daemon 找到了 PR，选择器又按输入文字在本地过滤，标题里没有链接就被滤掉。PR 选项带上链接参与过滤。`packages/app/src/screens/new-workspace-picker-item.ts`。
- **旧版手机首页**：矮屏（375×667）上 Star、Sponsor、Community 盖住入口卡片，最后一张卡片被切掉、页面不能滚动。改成可滚动、链接跟在卡片后面，与新版一致；桌面位置不变。`packages/app/src/screens/open-project-screen.tsx`。

审计：

- `npm run audit` 把没有基线的一步（Go 测试、出站对账、浏览器检查）失败当成提醒，照样报「全部通过」。改成失败；「解析了但从未使用」仍只提醒。`scripts/audit.mjs`、`go-parity-audit.mjs`。
- 浏览器检查从 bsk 改用仓库里的 Playwright（无头 Chromium，不碰用户的浏览器），并适配现在的模型选择器；原来「3 项过 2 项」，现在 12/12。`scripts/browser-conformance.mjs`、`docs/go-parity-audit.md`。
- 出站对账能认出 builder 里按下标设置的字段。`scripts/go-emit-parity.mjs`。

验证：Go 测试（新增定时、命名、提供方目录、PR 讨论、GHES、output schema、CLI、Gitea PR 状态、HEAD 监听）、`npm run audit` 全部通过、typecheck、lint。开发版实测见定时任务事项；另外：命名在开发版建工作区得到「Fix flaky login redirect test in auth module」（原来是「Untitled coding task」）；8081、8082 上没有可标记 agent 的工作区不再有「Mark as unread」，有的仍有，8082 上标为未读、标为已读都正常；配对弹窗只显示表单里的错误，`Alert.alert` 在 8082 显示提示条；8082 的 Markdown 预览里左、中、右对齐生效。Diff：在 1、1.25、1.5、1.75、2 倍缩放下把屏幕截图和画布位图逐像素比，修前 1.25 倍只有 87% 的像素一致，修后各档、各滚动位置都是 100%，8081、8082 一样；固定在顶部的文件头照常吸顶，没有多出滚动距离。粘贴 `https://github.com/cli/cli/pull/14781`：8081、8082 都列出「#14781 Add global feature flag infrastructure」。手机首页：8081 在 375×667 上滚到底能看到最后一张卡片和链接，位置与 8082 相同，1440×900 下卡片和链接坐标与改前一致。在终端切分支：8082、8081 侧栏分别在 0.6 秒、2.3 秒内显示新分支，切回后 1.9 秒内恢复。

没验到：GitLab、Gitea 的真实 PR（本机没有登录的账号）；GitHub Enterprise（没有主机）；output schema 接真实 Codex、OpenCode（会调用付费模型，本机没装 Codex）；Windows 上的 ClearType（本机是 Mac，像素一致性已验）。

byissue：定时任务、PR 状态推送、Gitea PR 状态三个事项写了实现和验证，等用户验收关闭。
