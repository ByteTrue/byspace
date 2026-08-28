# Node 主 Agent Handoff：恢复上游直系版本并组织双线开发

> 更新时间：2026-08-29
>
> 读者：新机器上的主 Agent
>
> 角色：你是总协调者，同时负责 Node `main`；Go Agent 只负责 `rewrite/go-daemon`。
>
> 重要：先完整阅读本文，再执行任何 reset、force-push、部署或域名修改。

## 1. 用户已经决定的方向

后续采用双线开发：

1. **Node 主线：`ByteTrue/byspace` 的 `main`**
   - 继续直接跟随上游 `getpaseo/paseo`；它是用户日常使用的版本。
   - 重置到执行时最新的上游 beta，保留上游 Git ancestry，以后继续按上游 release/tag 同步。
   - 不再把 Paseo 全面改名为 BySpace；保留上游产品、包、环境变量和数据目录命名，除非用户另行确认某个发布层名称。
   - 去掉 Electron/Desktop 与 iOS/Android 等原生客户端相关代码，只保留 Web/PWA、Node daemon、CLI、Relay 及其必要依赖。
   - 对外发布收敛成**一个用户安装包**；内部 monorepo workspace 不必为了“一个发布包”而强行合并。
   - 当前已经使用的生产域名继续归 Node 主线。

2. **Go 线：`ByteTrue/byspace` 的 `rewrite/go-daemon`**
   - 独立继续 Go daemon 重写。
   - 使用新的 Go 专用域名/hostname 集合，不能覆盖或继续占用 Node 主线的现有域名。
   - 不应机械合并 Node `main`；只按明确的协议/前端适配需求选择性移植。

3. **主 Agent 的协调职责**
   - 在新机器上准备一个 clone 和多个 git worktree，使 Node、Go、归档需求审计能够并行且互不污染。
   - 给每条写入线指定唯一 Agent；不要让两个 Agent 在同一个 worktree 写文件。
   - 先确定域名和部署 workflow 的所有权，再允许任一分支发布。

## 2. 已验证的仓库与分支状态

### 主仓库

- GitHub：`git@github.com:ByteTrue/byspace.git`
- 上游：`https://github.com/getpaseo/paseo.git`
- 当前远端 `main`：`8464a1b32eb434c7af172c6fae3f133bbb5f907d`
  - commit：`chore: reset source to Paseo v0.6.1`
  - tree：`46493b12e9a00dc63357f5e974b16550d10ab85f`
  - 该 tree 与上游 `v0.6.1` 相同，但 commit 本身不是上游 release commit。
- Go 分支 handoff 前的实现 tip：`rewrite/go-daemon` @ `b38f4ffc5f826eea1680d0f8743fbcd409ecc920`
- 旧 fork/CS 的主要归档：`sync/paseo-v0.5.1` @ `f9e266c00ff408f48d579048808dc15cc430e487`
  - 含 95 个 `codestable/` 文件。
  - 它与当前 `main` 没有共同祖先；**不要 merge 到新 main**。

### 上游 beta（仅为 handoff 时快照，执行时必须重新查询）

- 2026-08-29 查询到的最新 prerelease：`v0.7.0-beta.1`
- release commit：`1860a6f3afdf7710a7e86677dd183dc7eb9b8a0d`
- tree：`022cb80af46b41fe4c8cf9195726fd76fef9b1b0`
- 上游 `main` 的根 `package.json` 版本当时也是 `0.7.0-beta.1`。

不要把上面的 beta 当成永远有效。开始 reset 前运行：

```bash
gh release list -R getpaseo/paseo --limit 20
git fetch upstream --tags --prune
```

选择**最新的 GitHub prerelease tag**，记录 tag、commit、tree 和发布时间。

### Hub 仓库

- GitHub：`git@github.com:ByteTrue/byspace-hub.git`
- `main`：`37090cff35d4c6a4f6711e8648c387d5126de98d`
- upstream：`getpaseo/hub` @ `8eac5f3536a4e0d9afaaf09986ca3d49b7fd53be`
- 该 fork 已改为 `@byspace/hub` / `byspace-hub`，并已接通 Go daemon relationship tracer。
- 它是独立 Node 仓库，但当前功能来源于 Go 线的 Hub Epic；在确定双线 Hub/域名策略前，把它视为**共享且由主 Agent 协调的仓库**。不要因为它是 Node 代码就自动把所有权划给 Node `main`。

## 3. 新机器工作区布局

推荐只 clone 一次主仓库，然后创建三个 worktree：

```text
~/workspace/byspace/
├── node-main/        # 唯一写入者：Node 主 Agent
├── go-rewrite/       # 唯一写入者：Go Agent
├── archive-cs/       # detached、只读审计
└── hub/              # 独立 byspace-hub clone；写入由主 Agent 协调
```

一种可复现的建立方式：

```bash
mkdir -p ~/workspace/byspace
cd ~/workspace/byspace

git clone --filter=blob:none git@github.com:ByteTrue/byspace.git node-main
cd node-main
git remote add upstream https://github.com/getpaseo/paseo.git
git fetch origin --prune
git fetch upstream --tags --prune

# Go worktree：不得从 main 重建，它已有独立实现历史。
git branch --track rewrite/go-daemon origin/rewrite/go-daemon
git worktree add ../go-rewrite rewrite/go-daemon

# 旧 CS 归档：只读、detached，不要在这里继续实现。
git fetch origin refs/heads/sync/paseo-v0.5.1:refs/remotes/origin/sync/paseo-v0.5.1
git worktree add --detach ../archive-cs origin/sync/paseo-v0.5.1

cd ..
git clone --filter=blob:none git@github.com:ByteTrue/byspace-hub.git hub
cd hub
git remote add upstream https://github.com/getpaseo/hub.git
git fetch upstream --prune
```

约束：

- `node-main` 与 `go-rewrite` 使用不同依赖目录和运行端口。
- Go daemon 当前默认 `127.0.0.1:6767`；上游 Node 开发脚本当时使用 `127.0.0.1:6768`。启动前仍应检查最新版脚本。
- Node 默认数据目录应保留上游 `~/.paseo`；Go 继续使用 `~/.byspace`。禁止隐式迁移或共用状态。
- `archive-cs` 始终 detached；只从中提取需求、测试思想和小型补丁，不合并历史。

## 4. Node `main` 重置步骤与安全门

用户已经授权重置方向，但仍要保留可回滚证据。

### 4.1 先冻结当前 main

开始前：

1. 确认 `origin/main` 仍是预期 SHA。
2. 创建明确的安全分支，例如 `archive/node-main-v0.6.1-before-beta-reset`。
3. 将安全分支推到 origin。
4. 记录 main、上游 beta tag、commit/tree，以及 `git status`。

示例（先替换并重新核对 SHA）：

```bash
git switch main
git pull --ff-only origin main
git branch archive/node-main-v0.6.1-before-beta-reset 8464a1b32eb434c7af172c6fae3f133bbb5f907d
git push origin archive/node-main-v0.6.1-before-beta-reset
```

### 4.2 用真实上游 ancestry 建立新 main

目标不是再次复制一个无父 tree，而是直接从上游 prerelease tag/commit 开始：

1. 切到已确认的最新 beta tag。
2. 让本地 `main` 指向该上游 commit。
3. 后续原生端裁剪和单包发布使用独立、可审计的小 commits。
4. 最终推送只用带明确旧 SHA 的 `--force-with-lease`，绝不用裸 `--force`。

在 force-push 前先展示计划和 SHA 给用户；不要同时删除任何旧分支、tag、release 或部署。

## 5. Node 主线实现边界

### 5.1 不再全面改名

保留上游：

- `Paseo` 产品标识；
- `paseo` / `@getpaseo/*` 内部命名；
- `PASEO_*` 环境变量；
- `~/.paseo` 数据目录；
- 上游 Git history 和 LICENSE/NOTICE。

“单一发布包”的最终 registry/name 如果与上游命名或 npm 所有权冲突，必须单独向用户确认；不要通过全仓替换偷偷做第二次改名。

### 5.2 删除所有原生客户端相关内容

预期删除/禁用：

- Electron/Desktop package、构建、签名和 release jobs；
- iOS/Android、Expo native build、EAS/App Store/APK 路径；
- 只服务原生客户端的 native modules，例如经依赖闭包确认后可删除的 `expo-two-way-audio`；
- 原生平台文档、测试、CI matrix 和发布 secrets 引用。

必须保留：

- Web/PWA；
- Node daemon/server；
- CLI；
- Relay；
- Web 所需的共享 protocol/client/highlight/plugin；
- `packages/app` 内同时服务 Web 的代码。

不要按目录名盲删共享 Expo/React Native 源码。先从 Web build、server build、CLI package 和 tests 反向证明依赖闭包，再裁剪原生入口。

### 5.3 收敛为一个发布包

用户要的是**一个用户安装/升级入口**，不是强制把 monorepo 改成单包源码树。

主 Agent 应先审计最新版上游 release pipeline，然后提出最小方案：

- 只允许一个 public publishable package；其余 workspace 标记 private；
- 该包包含或可靠获取 Node daemon、CLI 和 Web dist；
- 全局安装 smoke 可以启动 daemon、打开 Web、运行 CLI；
- Web/daemon/protocol 来自同一 exact SHA；
- Beta/Stable tag、digest、upgrade/rollback 可追溯。

在实现前确认唯一包的最终 npm 名称、scope 和发布权限。不要为了“一个包”引入自定义 updater 或新的构建平台。

## 6. 现有域名与双线隔离

用户最新决策：**当前生产域名由 Node `main` 使用**。

当前已知域名：

- `app.byspace.cc.cd`
- `relay.byspace.cc.cd`
- `hub.byspace.cc.cd`

除非用户明确缩小范围，按这三个 hostname 都归 Node 主线处理。Go 线必须迁移到另一套 hostname；可讨论的命名示例是：

- `go.byspace.cc.cd`
- `relay.go.byspace.cc.cd`
- `hub.go.byspace.cc.cd`

这只是候选，不是已批准配置。主 Agent 要先与用户确认最终命名，再分配 Cloudflare Pages/Worker/Hub 项目、DNS、GitHub environments 和 secrets。

特别注意：Go 分支的 `.github/workflows/deploy-relay.yml` 目前仍会手动部署 `relay.byspace.cc.cd`。它只有 `workflow_dispatch`，普通 push 不会自动发布，但**在重定向前禁止手动运行**。

## 7. 归档 CodeStable 需求审计

### 7.1 权威归档与旁支

以 `sync/paseo-v0.5.1` @ `f9e266c00ff408f48d579048808dc15cc430e487` 作为旧 fork/CS 主档。它包含其他旧分支的大部分历史，但还有两组未包含在该 tip 的旁支 commits，审计时不可遗漏：

- `bold-moth`：
  - `a166cb93` — `feat: improve terminal defaults and Windows setup`
- `human-seahorse`：
  - `a031aefc` — `feat: add remote TCP forwarding`
  - `b0053430` — `feat(app): add port forwarding page`
  - `8725ac8c` — `test(server): mark tunnel supervisor tests POSIX-only`

这些 commits 不代表必须重做；只代表要进入需求审计矩阵。

### 7.2 已发现的 active/open 需求

归档里有三个 active Epic：

1. `001-o-clean-beta1-rebuild`
   - 原目标包含 orphan root、全面 BySpace 改名、删除网站、不引入 Hub。
   - 与用户现在“直接跟随上游、不改名、Node 主线使用现有域名”的决定冲突。
   - **不能照搬。** 只保留仍适用的 Web-only、移除原生端和单包安装目标。

2. `002-o-terminal-experience`
   - Direct Terminal 完整体验、恢复、bracketed paste、图片 clipboard、Windows ConPTY、retained renderer 等。
   - 仍开放的子项：
     - `024-o-windows-local-terminal-input-latency`
     - `025-o-terminal-direct-baseline`
   - 大部分实现已在归档 fork 完成，但需要先检查上游 beta 是否已有同等或更好的实现，再决定重做哪些切片。

3. `003-o-ci-cd-release-latency`
   - exact-SHA 发布、Playwright sharding、一次构建后晋升相同 artifact。
   - 仍开放：`issues/002-o-single-build-release-artifacts.md`。
   - “一个发布包”新决策与该需求高度相关，但应基于最新版上游 workflow 重新设计，不直接 cherry-pick 旧 workflow。

独立 open Issues：

- `011-o-sync-paseo-v0.2.5.md`
  - 旧 release-delta 同步任务；在直接跟随最新 beta 的新策略下大概率废弃。
- `022-o-local-dictation-models.md`
  - 本地 start/stop、final-only dictation；SenseVoice/FireRed 模型管理；AI refinement。
  - 自动化与实现证据很完整，但仍缺真实人声产品验收。需与最新 beta 的 voice/dictation 能力做差异审计。
- `040-o-windows-forge-pr-body-lost.md`
  - Windows 上 GitHub/GitLab/Gitea CLI resolved executable path 与多行 PR/MR body。
  - 代码/自动化在旧 fork 中完成，缺真实 Windows + GitLab 发布版验证。若上游 beta 未覆盖，属于高价值小型重做候选。

Talks/尚未转成稳定需求的材料：

- `talks/001-app-settings-information-architecture.md`
- `talks/002-import-session-manual-id.md`
- `talks/003-local-dictation-models.md`

### 7.3 必须产出的完整需求矩阵

上面只是 seed inventory。主 Agent 必须枚举归档中**所有** CodeStable 文件，包括 closed issue 中仍代表用户偏好的行为，输出一个新审计文档，至少包含：

| Archived CS | 用户结果/稳定偏好 | 最新 beta 是否已有 | 决策                    | 要迁移的测试/证据 | 理由 |
| ----------- | ----------------- | ------------------ | ----------------------- | ----------------- | ---- |
| path + SHA  | 一句话            | yes/partial/no     | keep/rebuild/drop/defer | paths             | why  |

审计规则：

- `closed` 不等于无需重做；它可能描述用户已验收的产品差异。
- `open` 不等于必须重做；旧同步、旧身份、旧发布策略可能已失效。
- 先看最新版 beta 行为和测试，再看归档代码；不要先 cherry-pick。
- 优先迁移最小测试和行为契约，而不是整块旧实现。
- 明确标记：上游已覆盖、需要重做、决定废弃、等待真人/Windows 验收。
- 审计完成后先请用户确认重做队列，再创建新的 Node-main CodeStable roadmap。

可用于初始枚举的命令：

```bash
cd ../archive-cs
find codestable -type f | sort
rg -n '^status:|^title:|^# ' codestable
```

## 8. 建议执行顺序

1. 建立 worktree 与唯一写入者规则。
2. 核实最新上游 beta、当前 main、归档和 Go tip。
3. 冻结当前 main 安全分支。
4. 把 Node main 重置到真实上游 beta ancestry。
5. 先跑未修改上游 baseline，记录测试、构建、包和部署现状。
6. 做 Web-only/native removal，验证 Web/daemon/CLI/Relay 闭包。
7. 设计并实现单一发布包，完成三平台 global-install smoke。
8. 建立归档 CS 完整矩阵，和用户确认重做队列。
9. 迁移 Node 生产域名；同时确保 Go workflow 不会写入这些目标。
10. Node 日常使用链路验收后，再逐项重做已确认的 CS 需求。

## 9. 首轮验收清单

- [ ] 工作区包含 Node、Go、archive、Hub 四个隔离目录。
- [ ] 每个写入目录只有一个 Agent。
- [ ] 当前 main 和归档 tip 都有远端安全 ref。
- [ ] 执行时最新 beta tag/SHA/tree 已记录。
- [ ] 新 main 保留真实 upstream ancestry。
- [ ] 未修改 beta baseline 已运行并记录。
- [ ] 原生客户端依赖闭包已列出并安全裁剪。
- [ ] Web、Node daemon、CLI、Relay 仍通过。
- [ ] 唯一 publishable package 及其 npm 名称已获确认。
- [ ] 归档 95 个 CS 文件及旁支 commits 已形成需求矩阵。
- [ ] Node 与 Go 域名、Cloudflare project、workflow、secrets 已隔离。
- [ ] 没有把归档代码或 Go 分支机械 merge 到 main。

## 10. 不要做的事

- 不要删除远端旧 branches/tags/releases 来“清理”。
- 不要把 `sync/paseo-v0.5.1` merge/rebase 到新 main。
- 不要继续全仓 BySpace/Paseo rename。
- 不要让 Node 与 Go 共用数据目录、端口或生产 hostname。
- 不要把 Go 当前通过的 tracer 当作 Node 最新 beta 已兼容的证据。
- 不要在域名重分配前运行 Go 的生产 Relay/Pages/Hub 部署。
- 不要在不清楚 npm 包名所有权时发布。
