# 验证纪律：绿不等于可交付

## 结论

- knip/grep 报「unused」只是线索：先验证非静态调用通道（RPC 名、动态 import、配置引用）再删。等价性必须在仓库 pin 的运行时上测。本地绿不等于可交付：只有 `npm ci` 会暴露依赖漂移。
- 把无关前置条件与被测行为分开：audit 浏览器验证曾因环境问题从 10/10 掉到 2/4，修好前置后 7/8，掉的不是被测行为。
- 发布门必须区分「必需 job 真的跑了」与「被 path filter 跳过但整体绿」：0.25.0 tag 建在 docs/scripts-only commit 上，CI 跳过 go/app/browser/relay job，release:push 把整体 success 当 verified；补跑全量 tag CI 后 setup-guide-pairing 与 sidebar-workspace-mark-unread 仍失败。
- 汇总器只数失败标记（如 `--- FAIL:`）时，空输出 = 假全绿；先确认子进程有输出。
- `npm run cli -- daemon status` 报 stopped **不代表 6778 空闲**——它只认自己 dev home 的 pid 文件。别的 worktree 的 dev daemon 可能正占着端口并 serve 它自己的旧 UI，此时 `audit:browser` 会失败在首屏快照（`text: Not found`），看着像自己改坏了。先 `lsof -nP -iTCP:6778 -sTCP:LISTEN` 看 PID 的真实 cmdline；不是自己的就别动，改用 `BYSPACE_LISTEN=127.0.0.1:6779 npm run dev:daemon` + `audit:browser -- --base http://127.0.0.1:6779`。
- 用 `git stash` 取基线时，Makefile 也被退回旧产物路径（`bin/byspace`），e2e 会全数失败在「binary not found」——那不是有效基线。用 `BYSPACE_E2E_DAEMON_BINARY=<仍在的二进制绝对路径>` 指过去再跑。stash/pop 会触发 AGENTS.md 的 system-update 通知来回翻转，那是副作用不是真实编辑。
- 守卫自己也会烂，而且**静默**：`scripts/docs-links.test.mjs` 第二个 test 扫的是已退役的 `packages/app/src`，`if (!existsSync(dir)) return` 让它长期跳过，一直显示通过。同类：`.github/ci-paths.yml` 的死 glob 不报错、`docs-links` 只查 `](path)` 不查反引号里的代码路径。**守卫的绿灯要先问「它这次真的检查了什么」**——插一条已知错误的输入见红，才算它还在工作。
- 文档里最难发现的腐烂不是路径错，是**机制描述整个失效**：`docs/permissions.md` 说权限表靠 TS 类型穷举（Go 是运行时 map），`docs/architecture.md` 说新事件要在三处注册（Go 只对 `agent_stream` 过滤，其余无条件）。路径守卫抓不到这类，只能逐条对代码复核。
- **本地钩子与 CI 的覆盖面要对齐**：`lefthook.yml` 只跑 oxfmt/oxlint/typecheck，CI 的 format job 还跑 `gofmt -l main.go internal workers`。Go 改动因此能带着格式问题提交，到 CI 才红（d5519d14e 就这么红的）。加一种语言就要同时加它的本地钩子。
- **「工具不可用」要区分是哪个入口**：记成 heartbeat 工具不可用，其实只是 MCP 侧没有 `create_heartbeat`；CLI 一直有 `byspace heartbeat <create|list|delete>`。断言某能力不存在前，先 `--help` 看一眼 CLI。
- **新守卫要在 CI 的运行条件下验证，不是本机**。CI 的 `changes` job 是路由门，**不装依赖**，那里的 `scripts/*.test.mjs` 只能用 `node:` 内建；本机有 node_modules 所以 import js-yaml/picomatch 全绿，CI 直接 `ERR_MODULE_NOT_FOUND`。要渲染/要 sharp 的守卫属于已 `npm ci` 的 job。验证法：`git ls-files | tar` 到临时目录（无 node_modules）+ `git init` 后跑一遍。
- **守卫不能把 gitignore 的生成物当腐烂**。文档引用 `*.aot.ts` 这类构建产物是对的（文档自己写着 "is gitignored"），本机有文件所以绿、CI 全新 checkout 没有所以红。存在性之外要接受 `git check-ignore -q`。
- **搬文件会改变相对路径深度，而 typecheck 抓不到指向仓库根的路径**（`../../../public/sw.js`、`../../../../../CHANGELOG.md` 不是模块解析）。搬完要专门 grep 读仓库根文件的调用点，按新深度重算。
- **CI 红了先分清是谁红的**：把本次失败集合与 main 最近一次同 job 运行的失败集合逐条比对（用例名+行号），只修真正新增的。本轮 8 个 playwright 失败全是 main 11 个的子集，2 个 app-tests 失败才是自己的。

## 依据

- 类型：可重跑证明（各误判均有事故记录）。
- 被否决的相关方案：静态 unused 报告直接当删除依据；整体 CI success 当发布验证；空输出当通过。
- 证据或复核方式：笔记 `bywork/archive/v1/notes/001-dead-code-audit-criteria-and-traps.md`、`016-verification-tools-report-false-failures.md`、`2026-11-04-windows-url-pathname-is-not-a-disk-path.md`（audit 汇总假绿）；账本 `bywork/archive/v1/epics/2026-11-12-o-host-sync-chain/ledger.md:95`（跳过 job 事故）。
- 适用条件：删除代码、发布、解读任何守卫/CI 结果时。

## 重访条件

- CI path filter 或 release:push 的验证逻辑变更（检查是否已区分 skipped 与 ran）。
