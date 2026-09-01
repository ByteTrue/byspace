# 旧 CodeStable 需求完整目录

本目录先还原历史需求，再记录 Owner 的最终产品取舍。同一文档包含相互独立的需求时拆成多个条目；Epic、Talk、Note、Vision、Project Spec 和 Explore 证据在最后单独登记，确保 78 份 Markdown 无遗漏。

Owner 已完成全部决策。这里的“**不做**”表示不再作为 BySpace 定制实现、验收或维护目标；不会为了清理目录而主动删除上游当前已有且仍可用的功能。

## T · Terminal 完整体验

| ID  | 原始需求                                                                                                                                       | 归档来源                                                                                          | 历史状态 | Owner 决定                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| T01 | Direct Terminal 成为完整参考体验：输入、持续输出、TUI、resize、字体与长期稳定性不明显落后于 Orca Web Direct。                                  | `epics/002-o-terminal-experience/spec.md`                                                         | active   | **保留并逐项重验（Owner 已确认）**                                                        |
| T02 | Relay Terminal 只允许延迟和吞吐有界下降，字符、顺序、最终画面、恢复和 E2EE 安全不降级。                                                        | `epics/002-o-terminal-experience/spec.md`                                                         | active   | **保留并逐项重验（Owner 已确认）**                                                        |
| T03 | 在其他保留面板与 Terminal 间切换时，首帧按当前宽度正确排版，不拉伸、不留右侧空白。                                                             | `epics/002-o-terminal-experience/issues/006-x-terminal-retained-panel-layout.md`                  | closed   | **保留并逐项重验（Owner 已确认）**                                                        |
| T04 | 切换 workspace 时保留 xterm/WebGL renderer，不重新挂载、fit、订阅和回放。                                                                      | `epics/002-o-terminal-experience/issues/013-x-terminal-emulator-remount-on-workspace-switch.md`   | closed   | **保留并逐项重验（Owner 已确认）**                                                        |
| T05 | Terminal 重显后按 revision 只续传缺口，保留客户端 10,000 行历史，不重置 renderer 或截断。                                                      | `epics/002-o-terminal-experience/issues/014-x-terminal-restore-resume-from-revision.md`           | closed   | **保留并实施；正常同 renderer 10,000 行，gap 不可恢复时 fallback snapshot 最多 1,000 行** |
| T06 | Terminal 完成或需要输入的通知优先显示最近非空输出，没有内容才显示终端名。                                                                      | `epics/002-o-terminal-experience/issues/017-x-ff-terminal-notification-preview.md`                | closed   | **保留并逐项重验（Owner 已确认 Terminal 整体）**                                          |
| T07 | 紧凑 Web Terminal 支持长按选词、拖动选区和复制按钮，不破坏点击输入、纵向滚动和横向手势。                                                       | `epics/002-o-terminal-experience/issues/020-x-ff-mobile-terminal-copy.md`                         | closed   | **保留并逐项重验（Owner 已确认 Terminal 整体）**                                          |
| T08 | Windows localhost Direct Terminal 的普通逐键输入持续即时回显，不能靠刷新页面恢复。                                                             | `epics/002-o-terminal-experience/issues/024-o-windows-local-terminal-input-latency.md`            | open     | **保留并实施（当前未闭环）**                                                              |
| T09 | 建立可重复的同机、同浏览器、同 viewport、同 workload Direct Terminal 分阶段性能基线，能定位 input、daemon、transport、decode 与 xterm commit。 | `epics/002-o-terminal-experience/issues/025-o-terminal-direct-baseline/index.md`                  | open     | **保留并实施（当前未闭环）**                                                              |
| T10 | snapshot attach/restore 后恢复 DEC private mode 2004，多行文本仍作为一个 bracketed paste block 进入 PTY。                                      | `epics/002-o-terminal-experience/issues/026-x-terminal-bracketed-paste-restore/index.md`          | closed   | **保留并逐项重验（Owner 已确认）**                                                        |
| T11 | 浏览器剪贴板图片通过现有 binary upload 写到 daemon 临时文件，再把服务端真实路径作为单个 paste block 交给 Pi CLI；普通文本粘贴保持正确。        | `epics/002-o-terminal-experience/issues/027-x-terminal-clipboard-image-paste.md`                  | closed   | **保留并实施（Owner 已确认）**                                                            |
| T12 | Windows ConPTY 即使不转发 DECSET 2004，也要对多行文本和图片路径强制 bracketed framing。                                                        | `epics/002-o-terminal-experience/issues/028-x-terminal-windows-bracketed-paste-fallback/index.md` | closed   | **保留并实施（当前明确缺失）**                                                            |
| T13 | Terminal agent hooks 按 provider 独立启停，不与 managed-agent provider 启用状态耦合；手工运行 CLI agent 也能上报 running/idle/needs-input。    | `epics/002-o-terminal-experience/issues/029-x-pi-terminal-agents.md`                              | closed   | **保留并逐项重验（当前有强代码证据）**                                                    |
| T14 | Pi 通过全局 extension 上报 Terminal activity，并作为内置 Terminal profile 出现。                                                               | `epics/002-o-terminal-experience/issues/029-x-pi-terminal-agents.md`                              | closed   | **保留并实施（Owner 已确认）**                                                            |
| T15 | Terminal 呈现默认值收敛：系统 UI/等宽字体、统一代码字号、GitHub 高亮与浅色/深色/跟随系统，不保留无收益的字体和主题配置面。                     | `epics/002-o-terminal-experience/issues/030-x-terminal-presentation-defaults.md`                  | closed   | **取消（Owner 2026-09-01 明确撤回；不得改动 Appearance）**                                |
| T16 | Windows Local Direct 页面切换、Agent、Terminal、长 Timeline 和后台任务不得造成间歇性秒级停顿。                                                 | `issues/010-x-windows-local-web-interaction-latency.md`                                           | closed   | **保留并逐项重验（Owner 已确认）**                                                        |
| T17 | Pi Terminal activity 请求串行且有界合并，较早的 `running` 不能覆盖后续 `idle`，失败后能续传最新状态。                                          | `issues/037-x-ff-pi-status-and-archive-caret.md`                                                  | closed   | **保留并实施（Owner 已确认）**                                                            |
| T18 | New Workspace 的 “Manage terminal profiles” 直接打开当前 Host 的 Providers 设置。                                                              | `issues/038-x-ff-terminal-profiles-settings-link.md`                                              | closed   | **保留；按当前架构打开所选 Host 的 Terminals 设置**                                       |

## R · Relay、远程访问、配对与 Service Proxy

| ID  | 原始需求                                                                                                                   | 归档来源                                                                                  | 历史状态 | Owner 决定     |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- | -------------- |
| R01 | `byspace daemon start` 默认启用 bundled Web UI；资源存在时同时提示本地地址和 Hosted App 地址，保留显式关闭方式。           | `issues/002-x-ff-enable-web-ui-by-default.md`                                             | closed   | **不做**       |
| R02 | 配对 offer 携带 hostname，手机扫码添加 Host 时自动使用可读名称，而不是 `srv_...` serverId。                                | `epics/002-o-terminal-experience/issues/018-x-ff-pairing-offer-hostname.md`               | closed   | **保留并恢复** |
| R03 | Hosted HTTPS 页面在建立 WebSocket 前拒绝明文非环回 Direct；loopback、TLS 和 daemon 同源 Web UI 不受影响。                  | `issues/026-x-ff-block-insecure-lan-direct.md`                                            | closed   | **保留并恢复** |
| R04 | 本地 daemon A 通过稳定 `.remote.localhost` URL 访问远程 daemon B 的 loopback Web 服务，覆盖 AI Gateway 和 Web dev server。 | `epics/004-x-private-remote-web-services/spec.md`                                         | closed   | **不做**       |
| R05 | 用 daemon 托管的 standalone WSS Data Relay 承载独立 E2EE data channel，不依赖 Cloudflare Durable Object 计费路径。         | `epics/004-x-private-remote-web-services/issues/001-x-standalone-wss-data-relay-spike.md` | closed   | **不做**       |
| R06 | daemon 间完成 Remote Web Service 映射、持久化、授权、HTTP/SSE/WebSocket/HMR 转发和本地 URL 生命周期。                      | `epics/004-x-private-remote-web-services/issues/002-x-daemon-remote-web-services.md`      | closed   | **不做**       |
| R07 | Web UI 可配置、启动和热重载 Data Relay；Remote Web Services 有向导、状态、常用端口预设和复制 URL。                         | `issues/045-x-data-relay-ui-configuration-and-ux-redesign.md`                             | closed   | **不做**       |
| R08 | Service Proxy 的 WebSocket upgrade 必须转发给 workspace dev server，不能被 daemon 自身 `/ws` 抢走造成页面重载。            | `issues/015-x-service-proxy-websocket-upgrade-stolen-by-daemon-socket.md`                 | closed   | **不做**       |

## A · Agent、Session、编排与项目准备

| ID  | 原始需求                                                                                                             | 归档来源                                           | 历史状态 | Owner 决定     |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------- | -------------- |
| A01 | Web 可查看任意已连接 Host 上的编排 Skills 状态，并在目标 Host 安装、更新和卸载。                                     | `issues/001-x-host-orchestration-skills.md`        | closed   | **不做**       |
| A02 | 编排 Skills 可按具体 Skill 和目标环境目录选择安装；更新/卸载安全处理已托管与未选副本。                               | `issues/046-x-selective-orchestration-skills.md`   | closed   | **不做**       |
| A03 | Pi `ask_user_question` 在 Web 正确展示多题、多选和自定义答案，并按真实 RPC fallback 顺序回填。                       | `issues/016-x-ff-pi-questionnaire-ui.md`           | closed   | **不做**       |
| A04 | Agent 可检查项目能否在干净 worktree 中重复准备和并行开发，提出最小改进；用户确认后修改脚本与 `byspace.json` 并验证。 | `issues/019-x-agent-guided-project-readiness.md`   | closed   | **保留并恢复** |
| A05 | Workspace 内的 Import Session sheet 支持手选 provider + 填 session/thread ID，精确导入被子会话淹没的主会话。         | `issues/012-x-import-session-manual-id.md`         | closed   | **保留并恢复** |
| A06 | 浏览器恢复焦点或重新显示保留 workspace 时，立即做权威 timeline catch-up，修复后台冻结或漏送。                        | `issues/008-x-refresh-visible-chat-on-focus.md`    | closed   | **保留并验收** |
| A07 | 每个 Host 由单一 owner 统一 Agent Timeline 请求、并发仲裁、响应、gap recovery、刷新、rewind 和历史分页顺序。         | `issues/009-x-unify-agent-timeline-sync.md`        | closed   | **保留并验收** |
| A08 | 有历史的远程 Agent 恢复或切换时保留旧时间线，顶部显示“正在同步最新进度”，完成后自动消失。                            | `issues/028-x-ff-remote-session-load-indicator.md` | closed   | **保留并恢复** |
| A09 | 首条 prompt 先生成初始 workspace/branch 名；意图收敛后，用户可让拥有完整上下文的 Agent 精炼名称。                    | `issues/039-x-rename-workspace-with-agent.md`      | closed   | **保留并补齐** |

## V · 本地语音输入

| ID  | 原始需求                                                                                                                                     | 归档来源                                 | 历史状态 | Owner 决定 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------- | ---------- |
| V01 | Host 维护允许列表内的本地 STT 模型目录，App 可查看、下载、选择、切换和删除高质量中文/英文听写模型；聚焦 dictation，不扩大 Voice/TTS 产品面。 | `issues/022-o-local-dictation-models.md` | open     | **不做**   |

## W · Workspace、Git、Forge 与侧栏

| ID  | 原始需求                                                                                                             | 归档来源                                                                                                                       | 历史状态 | Owner 决定                                         |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------- |
| W01 | 分支切换列表标注本地、远程或两端都存在，并使用不同图标。                                                             | `issues/003-x-ff-distinguish-local-remote-branches.md`                                                                         | closed   | **保留并恢复**                                     |
| W02 | 手机端 workspace 行始终显示三点菜单，不依赖 hover。                                                                  | `issues/004-x-ff-mobile-workspace-menu.md`                                                                                     | closed   | **保留并验收**                                     |
| W03 | Changes 面板把高频 Refresh 放到一级工具栏，Side-by-side/Unified 布局切换收到更多菜单。                               | `issues/005-x-ff-swap-changes-refresh-layout-controls.md`; `issues/045-x-ff-model-picker-width-auto-host-badge-git-refresh.md` | closed   | **不做**                                           |
| W04 | 对没有设置 upstream、但已推送到 origin 同名分支的分支，刷新后 Push 按钮正确消失。                                    | `issues/013-x-ff-stale-push-button-no-upstream.md`                                                                             | closed   | **保留并验收**                                     |
| W05 | 侧栏以 Project 为单一结构，优先呈现待处理 workspace，并在 hover 中展示该 workspace 下所有 Agent 精确状态。           | `issues/020-x-sidebar-workspace-information-efficiency.md`                                                                     | closed   | **仅保留 hover 展示全部 Agent 精确状态；其余不做** |
| W06 | 所有 New Workspace 入口使用统一 Project-first 界面；按上下文预填 Project/Host，Isolation 与 Base branch 为次级选项。 | `issues/021-x-unified-new-workspace-flow.md`                                                                                   | closed   | **不做**                                           |
| W07 | workspace hover card 只被键盘 `focus-visible` 钉住；鼠标点击后离开应正常关闭，同时保留键盘可达性。                   | `issues/023-x-ff-hover-card-click-pinned.md`                                                                                   | closed   | **不做**                                           |
| W08 | 侧栏排序不受选中或 Agent 活动驱动；除明确注意力策略外保持用户持久化顺序。                                            | `issues/031-x-ff-sidebar-stable-order.md`                                                                                      | closed   | **不做**                                           |
| W09 | 删除低价值 Workspace pin 及相关快捷键/投影。                                                                         | `issues/031-x-ff-sidebar-stable-order.md`                                                                                      | closed   | **不做**                                           |
| W10 | 删除容易误触的 Project collapse/expand，Project 行不再承担折叠动作。                                                 | `issues/031-x-ff-sidebar-stable-order.md`                                                                                      | closed   | **不做**                                           |
| W11 | 不再将 attention workspace 自动浮顶；使用原位徽章和“只看待处理”过滤器，保持列表位置稳定。                            | `issues/032-x-ff-sidebar-attention-filter.md`                                                                                  | closed   | **不做**                                           |
| W12 | Changes 刷新先返回本地 Git/diff，再后台查询 Forge；完成后主动推送 PR/MR 状态更新。                                   | `issues/036-x-git-changes-refresh-waits-for-forge.md`; `issues/042-x-ff-refresh-forge-status-update.md`                        | closed   | **不做**                                           |
| W13 | Workspace hover 展示并可换行显示完整绝对 worktree 路径，不以 slug 代替或截断。                                       | `issues/040-x-ff-worktree-hover-full-path.md`                                                                                  | closed   | **不做**                                           |
| W14 | Host Badge 默认支持 `auto`：同一 Project 横跨至少两台 Host 才显示设备名；单 Host 项目完全隐藏。                      | `issues/041-x-ff-auto-host-badge-labels.md`; `issues/045-x-ff-model-picker-width-auto-host-badge-git-refresh.md`               | closed   | **保留并恢复**                                     |
| W15 | History、Schedules 和未来顶级页面收进侧栏顶部单行 BySpace 菜单，不持续占用固定高度。                                 | `issues/041-x-sidebar-top-level-page-entry.md`                                                                                 | closed   | **不做**                                           |
| W16 | Web 侧栏 workspace 拖拽排序可靠工作，并兼容 React Native Web pointer 与点击/长按语义。                               | `issues/043-x-ff-sidebar-workspace-drag-reorder.md`                                                                            | closed   | **不做**                                           |
| W17 | Windows 下 Forge 创建 PR/MR 时完整保留多行正文，并使用已解析的 `gh`/`glab`/`tea` 可执行路径。                        | `issues/040-o-windows-forge-pr-body-lost.md`                                                                                   | open     | **不做**                                           |

## U · 设置、外观、会话与 Explorer UI

| ID  | 原始需求                                                                                                 | 归档来源                                                            | 历史状态 | Owner 决定     |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------- | -------------- |
| U01 | 恢复 Host 名称编辑、真实身份色色块、Workspace Badge 预览和可访问名称。                                   | `issues/025-x-ff-host-appearance-sync-regression.md`                | closed   | **不做**       |
| U02 | App 设置一级导航收敛为 Preferences、Projects、About；Preferences 聚合 General、Appearance、Diagnostics。 | `issues/027-x-ff-settings-preferences.md`                           | closed   | **不做**       |
| U03 | 弱化消息区中的折叠/回到底部悬浮操作，并把移动端上下文用量并入输入框工具栏。                              | `issues/029-x-ff-refine-agent-composer-controls.md`                 | closed   | **保留并恢复** |
| U04 | Compact Web 不显示桌面输入框聚焦快捷键。                                                                 | `issues/030-x-ff-mobile-session-sidebar-polish.md`                  | closed   | **不做**       |
| U05 | Compact Web 将“折叠工具调用”和“回到底部”放到 workspace pane header。                                     | `issues/030-x-ff-mobile-session-sidebar-polish.md`                  | closed   | **保留并恢复** |
| U06 | Status 分组的 workspace 卡片与 Project 分组一样常驻三点菜单。                                            | `issues/030-x-ff-mobile-session-sidebar-polish.md`                  | closed   | **不做**       |
| U07 | Archive Workspace 分裂按钮的下拉区域填满容器高度，与主按钮几何对齐。                                     | `issues/037-x-ff-pi-status-and-archive-caret.md`                    | closed   | **不做**       |
| U08 | 模型选择弹窗在桌面有合理最小宽度，长模型名称不因窄 trigger 被截断。                                      | `issues/045-x-ff-model-picker-width-auto-host-badge-git-refresh.md` | closed   | **不做**       |
| U09 | Explorer Files/Changes 顶部导航使用连续滑动下划线动效，Tab 与底部分割线形成单一层级。                    | `issues/047-x-ff-explorer-sidebar-header-padding.md`                | closed   | **不做**       |
| U10 | 分支选择器合并到 Explorer 顶栏，移除冗余分支行和关闭按钮，减少垂直占用。                                 | `issues/047-x-ff-explorer-sidebar-header-padding.md`                | closed   | **不做**       |

## B · 品牌、域名与网站

| ID  | 原始需求                                                                                                        | 归档来源                                                        | 历史状态 | Owner 决定             |
| --- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- | ---------------------- |
| B01 | BySpace 的根域、Stable/Beta Web App、Stable/Beta Relay 使用独立 `byspace.cc.cd` 域名体系并完成 TLS/可用性验证。 | `issues/044-x-ff-official-landing-page-and-domain-migration.md` | closed   | **保留并恢复版本路由** |
| B02 | 维护并部署官方静态落地页，展示多 Agent workspace、E2EE、Provider、Worktree、语音和 CLI 能力。                   | `issues/044-x-ff-official-landing-page-and-domain-migration.md` | closed   | **不做**               |

## C · CI、发布与工程可靠性

| ID  | 原始需求                                                                                                        | 归档来源                                                                           | 历史状态 | Owner 决定 |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- | ---------- |
| C01 | `main` 完整 CI 持续可信全绿，并使用可复算的成功 run 作为发布优化基线。                                          | `epics/003-o-ci-cd-release-latency/issues/001-x-restore-ci-baseline.md`            | closed   | **不做**   |
| C02 | 同一 release commit 只生成一份 npm tarball 和 Web dist；CI 验证后 Publisher/Deploy 原字节晋升，禁止部署时重建。 | `epics/003-o-ci-cd-release-latency/issues/002-o-single-build-release-artifacts.md` | open     | **不做**   |
| C03 | 保留完整 Playwright 覆盖，同时消除启动 flake、均衡 shard，缩短最长 CI 关键路径。                                | `epics/003-o-ci-cd-release-latency/issues/003-x-playwright-critical-path.md`       | closed   | **不做**   |
| C04 | Git 子进程提前关闭 stdin 时不产生未处理 `EPIPE`，真实失败仍可见。                                               | `epics/003-o-ci-cd-release-latency/issues/004-x-git-stdin-epipe-flake.md`          | closed   | **不做**   |
| C05 | Codex resume 子进程测试不使用 500ms 启动竞速门，Windows 满载时不误判失败。                                      | `epics/003-o-ci-cd-release-latency/issues/005-x-codex-resume-test-startup-race.md` | closed   | **不做**   |
| C06 | 在不减少测试和不改变渠道语义的前提下，缩短 exact-SHA CI、npm、Web 和 Relay 完整发布时间。                       | `epics/003-o-ci-cd-release-latency/spec.md`                                        | active   | **不做**   |
| C07 | 删除确认不可达的平台分支、零调用文件、无用依赖和纯转发包装，保持可观察行为不变。                                | `issues/007-x-remove-unreachable-and-shallow-code.md`                              | closed   | **不做**   |

## O · 明确的一次性执行记录

这些条目仍完整列出，但它们绑定旧版本或旧目录，不应在当前 `main` 重跑。其内部若含可复用产品约束，已经拆入其他条目或将在证据矩阵中保留。

| ID  | 一次性任务                                                                          | 归档来源                                         | 历史状态 | 处置               |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------ | -------- | ------------------ |
| O01 | 从 Paseo `0.2.0-beta.1` 精确树重新建立旧 BySpace 基线并进行当时的裁剪、改名和发布。 | `epics/001-o-clean-beta1-rebuild/spec.md`        | active   | 直接剔除旧执行任务 |
| O02 | 同步 Paseo `v0.2.0` release delta。                                                 | `issues/033-x-sync-paseo-v0.2.0.md`              | closed   | 直接剔除旧执行任务 |
| O03 | 同步 Paseo `v0.2.3` release delta。                                                 | `issues/034-x-sync-paseo-v0.2.3.md`              | closed   | 直接剔除旧执行任务 |
| O04 | 同步 Paseo `v0.2.3..v0.2.5` release delta。                                         | `issues/011-o-sync-paseo-v0.2.5.md`              | open     | 直接剔除旧执行任务 |
| O05 | 把旧 `.cs/` 产物迁移到当时的 `codestable/` 布局。                                   | `issues/035-x-ff-codestable-layout-migration.md` | closed   | 直接剔除旧执行任务 |

## D · 需求容器与证据文档，不单独作为功能投票

| 文档                                                                                                 | 归属                                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `epics/002-o-terminal-experience/issues/025-o-terminal-direct-baseline/direct-benchmark-evidence.md` | T09 的历史性能证据；不能证明当前版本已满足。                  |
| `epics/002-o-terminal-experience/issues/025-o-terminal-direct-baseline/direct-terminal-path.md`      | T09 的 Direct 输入/输出路径分析。                             |
| `epics/002-o-terminal-experience/issues/025-o-terminal-direct-baseline/terminal-paste-path.md`       | T10–T12 的真实 paste 问题证据。                               |
| `notes/001-mock-provider-for-import-e2e.md`                                                          | A05 的确定性 E2E 测试约束。                                   |
| `talks/001-app-settings-information-architecture.md`                                                 | U02 的设计讨论。                                              |
| `talks/002-import-session-manual-id.md`                                                              | A05 的需求讨论。                                              |
| `talks/003-local-dictation-models.md`                                                                | V01 的模型边界讨论。                                          |
| `spec/index.md`                                                                                      | 历史 Project Spec；其中跨能力稳定约束需在最终矩阵中逐条映射。 |
| `vision/index.md`                                                                                    | 历史 Vision 模板/入口；不是独立实现任务。                     |

## 文档覆盖校验

- 决策条目覆盖 69 个 issue/epic Markdown 来源；一个来源可拆为多个决策条目。
- 上表另登记 9 个 Explore/Talk/Note/Spec/Vision 支撑文档。
- 总覆盖：78 / 78 Markdown。
- Terminal benchmark JSON：`epics/002-o-terminal-experience/issues/025-o-terminal-direct-baseline/direct-terminal-benchmark.json`，归入 T09 证据，不单独投票。
