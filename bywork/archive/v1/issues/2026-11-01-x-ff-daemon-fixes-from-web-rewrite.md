---
kind: issue
title: "快改：前端重写中发现的 daemon 问题"
type: ff
created: 2026-11-01
---

# 快改：前端重写中发现的 daemon 问题

前端重写（`epics/2026-10-31-x-web-frontend-rewrite`）对照旧版时发现、两个前端都有的 daemon 问题，全部按 Node 版的语义修掉。

为了把同类问题一次找全，用两种方式收集客户端「Message validation failed」告警（每条都是 daemon 发了客户端拒收的回包）：一是浏览器把旧版每个页面、工作区、标签、文件面板都打开一遍；二是把前端重写第 2、3 步的 36 个操作脚本（发消息、终端、文件编辑、Diff、PR、新建工作区等）全部对旧版跑一遍。找到 3 类：打不开的 agent（第一种方式，74 次）、新建工作区的分支搜索、空文件（第二种方式）。修完后两种方式在 8081 和 8082 上都是 0。

- **隐藏空白（Hide whitespace）不生效**：协议里的 `ignoreWhitespace` 没传给 git。现在 Changes 和 Diff 按 Node 的做法给 `git diff` 加 `-w`，只改了空白的文件从列表里消失。`internal/workspace/git.go`、`internal/server/ws_agent.go`。
- **PR 面板没有代码行上的评审讨论串**：GitHub 时间线只取了评审和普通评论。改成 Node 的 GraphQL 查询（评审、评论、讨论串各前 100 条），讨论串评论带所属评审和位置（文件、行、已解决、已过时），客户端把它挂在对应评审下面；评审状态、空的已撤销评审不显示、评论里 GitHub 附件图片换成可直接显示的代理地址、按时间再按 id 排序、截断和错误分类（not_found / forbidden）都按 Node。`internal/workspace/github_timeline.go`（新）、`forge.go`、`internal/server/ws_git_system.go`。
- **打不开的 agent 让客户端无限重试**：`fetch_agent_timeline_response` 出错时漏了 `agent`、`window`、游标、`hasOlder`、`hasNewer`，客户端判为非法回包、不断重发。按 Node 的出错回包补齐。`internal/server/server.go`。
- **开发版 daemon 重启后 Mock 模型的 agent 打不开**：恢复 agent 时判断提供方是否存在，漏了开发版才有的 `mock`。`internal/agent/providers/driver.go`。
- **gh / glab / tea 命令 5 秒超时**：Node 是 30 秒（认证探测 10 秒，Go 本来就对）。网络慢时合并 PR、读 PR 状态会在 5 秒后失败。统一改成 30 秒。`internal/workspace/forge.go`。
- **新建工作区的起始分支列表里没有 PR**：搜索没结果时 `forge.search.response` 的 `items` 是 null，客户端判为非法回包，整个列表都丢了。改成空列表，同时把 GitHub 搜索按 Node 改齐：PR 和 issue 分开查，一边失败另一边照常返回，两边都失败才报错（原来 PR 查询一失败就整个报错）；粘贴 github.com（或仓库所在的 Enterprise 主机）的 PR、issue 链接时按编号搜。`internal/workspace/forge.go`。
- **空文件打不开、清空文件保存后报错**：文件版本和写入结果的 `size` 带了 `omitempty`，空文件的 0 被省掉，客户端要求这个字段必须有。改成总是发送。`internal/workspace/files.go`。
- **「标为未读」**：daemon 对没有已完成 agent 的工作区报错，这和 Node 一致，不是 bug。但和 Node 有两处不同，一并改了：手动标为未读会触发「agent 完成」推送（Node 只在真正跑完时推送），挑哪个 agent 的规则也不同（Node 只挑会话根 agent、不挑子 agent，按更新时间取最新）。`internal/server/agent_attention.go`、`ws_project.go`。

验证：

- 新增/更新 Go 测试：出错回包字段齐全、开发版能识别 mock 提供方、搜索无结果是空列表、一边失败另一边照常返回、链接按编号搜、空文件带 size、`-w` 隐藏只改空白的文件、GraphQL 时间线映射（顺序、讨论串位置、截断、错误分类、非法仓库名不调 gh）、附件图片地址替换、标为未读只挑根 agent。`internal/server`、`internal/workspace`、`internal/agent/providers` 三个包测试通过。`npm run audit` 通过：go test、入站和出站字段对账都是 0 缺口；浏览器验证 3 项过 2 项：两项 daemon 检查（归档最后一个工作区后项目还在、删除项目后目录里清掉）通过，没过的一项是 bsk 浏览器会话被别的会话占用（`shared page control or observation changed`），检查本身没跑起来，修之前也是这样。
- 起始分支搜索：没结果时回包是空列表；粘贴 `https://github.com/cli/cli/pull/14781` 时 daemon 返回 #14781。不过新建工作区页的列表会再按输入文字在本地过滤，链接和 PR 标题对不上，所以页面上仍显示「No matching refs.」。这是客户端的行为，旧版新版一样，没改。
- 浏览器（8081 旧版、8082 新版，同一个开发版 daemon，已用新二进制重启；截图在本机 `screenshots/对照全集/快改-daemon/`）：Hide whitespace 打开后改动统计从 +3 −1 变成 +2 −0；cli/cli#14798 的 PR 面板出现 `pkg/cmd/auth/login/login.go:254-254` 讨论串，带 Resolved 和 3 条评论，挂在 Copilot 评审下面，菜单 Open on GitHub，加入对话正常；Mock 模型建的老 agent 能打开；工作区菜单「Mark as unread」后该 agent 标为未读，打开后清除。

对 `byissue/` 的影响：已更新 `notes/2026-10-31-mock-provider-for-ui-checks.md`（去掉「重启后打不开」这个坑）；前端重写的工作区事项里指向这些问题的记录已注明修复。逐页收集校验告警的脚本和其他对照脚本放在一起（本机 `screenshots/对照全集/_脚本/sweep-validation.js`）。

顺手发现：

- 工作区菜单在没有可标记的 agent 时也显示「Mark as unread」，点了报错。旧版新版一样，是前端问题。
