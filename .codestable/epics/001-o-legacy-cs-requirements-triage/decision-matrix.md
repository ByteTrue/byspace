# 旧 CodeStable 需求证据与 Owner 决策矩阵

审计基线：`main` / `3eb257825f30d3c44bc82ec14e72324056ec3c25`。

本矩阵与 `requirements-catalog.md` 配套使用：catalog 保存原始需求和精确归档路径，本文件保存 reset 前证据、当前证据和 Owner 决策。Owner 已完成全部决策：34 个原子 ID 保留，38 个不做，5 个一次性任务剔除，不再有待决定项。

“**不做**”表示不再作为 BySpace 定制实现、验收或维护目标；不会为此主动删除上游当前已有且仍可用的功能。W05 只保留“hover 展示该 Workspace 下全部 Agent 精确状态”，同项内的 Project 单一结构和 attention 优先不做。

## 证据状态

- **缺失/回退**：原验收行为当前不存在，或实现方向与原要求相反。
- **部分/待验收**：有相关机制，但没有证据证明原验收完整成立。
- **强代码证据**：当前有直接实现与测试；仍由 Owner 决定是否接受为已满足，必要时实机验收。
- **架构已变**：原触发路径或 UI 已被替换；不能自动推导价值消失。
- **一次性剔除**：只绑定旧版本或旧目录，不再执行；独立长期约束已经拆到其他 ID。

## T · Terminal 完整体验

Terminal 全组已由 Owner 确认保留；这里记录当前缺口，用于后续 `cs-issue` / `cs-feat` 排序。

| ID  | reset 前证据                                                                     | 当前 `main` 证据                                                                                               | 证据状态                    | Owner 决定         |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------ |
| T01 | Epic 持续目标；历史 Direct 基准未最终闭环。                                      | 有 worker、coalescing、性能 E2E 等机制；用户仍在当前 Paseo 复现历史 Terminal 问题。                            | 部分/待验收                 | **保留并逐项重验** |
| T02 | Epic 持续目标；要求 Relay 仅有有界性能下降。                                     | Relay/E2EE 与 Terminal stream 存在，但没有当前 Direct/Relay 同 workload 等价基准。                             | 部分/待验收                 | **保留并逐项重验** |
| T03 | 归档 closed；reset 前有 retained panel layout 修复和专项测试。                   | 有 resize/stuck-size/retained-tab 测试；历史首帧与 passive-refit 专项测试不在。                                | 部分/待验收                 | **保留并逐项重验** |
| T04 | 归档 closed；reset 前有 workspace 切换 renderer retention 实现与测试。           | pane 有 retained 结构，但 workspace focus 会改变 presented/stream 状态；缺少“不 remount、不 replay”专项证据。  | 部分/待验收                 | **保留并逐项重验** |
| T05 | 归档 closed；reset 前实现 revision backlog/resume 和 10,000 行客户端保留。       | restore 固定走 `visible-snapshot` 200 行；未见 revision resume、缺口续传或 delivered revision。                | **缺失/回退**               | **保留并实施**     |
| T06 | 归档 closed；reset 前实现最近非空输出通知摘要。                                  | 当前通知模型、Terminal 输出预览与 WebSocket 测试仍在。                                                         | 强代码证据；待实机          | **保留并逐项重验** |
| T07 | 归档 closed；reset 前有 compact Web 长按选择/复制验收。                          | 当前有 Terminal selection/clipboard 基础路径，但没有原移动手势组合的直接当前证据。                             | 部分/待验收                 | **保留并逐项重验** |
| T08 | 归档 open；Windows 逐键延迟未闭环。                                              | 当前浏览器输入仍经 WebSocket round trip，无本地 echo；没有 Windows 实机通过证据。                              | **缺失/未闭环**             | **保留并实施**     |
| T09 | 归档 open；留下阶段化 benchmark 文档与 JSON。                                    | 有性能测试，但没有固定同机 workload 的 input→daemon→transport→decode→commit 分段报告。                         | 部分/未闭环                 | **保留并实施**     |
| T10 | 归档 closed；reset 前有 snapshot preamble 与 DECSET 2004 恢复测试。              | live paste 能按 bracketed mode 包装；缺少 attach/restore 后 mode 恢复并进入单个 PTY block 的端到端证明。       | 部分/待验收                 | **保留并逐项重验** |
| T11 | 归档 closed；reset 前实现剪贴板图片上传、daemon 临时路径和 Pi paste。            | 当前 Terminal clipboard 仅 `readText()`；Composer 图片上传不能替代 Terminal 图片粘贴。                         | **缺失/回退**               | **保留并实施**     |
| T12 | 归档 closed；reset 前有 Windows ConPTY 强制 framing fallback。                   | 当前只依据 live DECSET mode 决定 framing；未见 Windows fallback。                                              | **缺失/回退**               | **保留并实施**     |
| T13 | 归档 closed；reset 前建立 provider hook 解耦。                                   | 当前 Claude/Codex provider registry、全局启停、activity endpoint 和测试都在；Pi provider 不在。                | 强代码证据；Pi 缺口拆在 T14 | **保留并逐项重验** |
| T14 | 归档 closed；reset 前有 Pi 全局 extension 与内置 profile。                       | 当前 registry 只有 Claude/Codex；没有 Pi hook provider、全局 extension 或内置 Pi profile。                     | **缺失/回退**               | **保留并实施**     |
| T15 | 归档 closed；reset 前移除低收益字体/主题配置并收敛默认值。                       | 当前 Terminal 使用统一外观/mono theme 路径，未见独立 Terminal 字体主题配置面；需浅色/深色/系统与高亮实机复核。 | 强代码证据；待验收          | **保留并逐项重验** |
| T16 | 归档 closed；reset 前针对 Windows 页面、Timeline、Agent、Terminal 秒级停顿修复。 | 当前缺少 Windows 组合 workload 与长任务延迟门禁；静态代码不能证明无秒级停顿。                                  | 部分/待验收                 | **保留并逐项重验** |
| T17 | 归档 closed；reset 前 Pi reporter 串行、latest-wins、有界合并与失败续传。        | Pi reporter/extension 已不存在，因此其顺序与恢复保证也不存在。                                                 | **缺失/回退**               | **保留并实施**     |
| T18 | 归档 closed；当时入口改到 Host Providers。                                       | 当前入口直接打开更精确的 `/settings/host/terminals` 专页。                                                     | 架构已变；结果更贴近意图    | **保留并逐项重验** |

## R · Relay、远程访问、配对与 Service Proxy

| ID  | reset 前证据                                                                   | 当前 `main` 证据                                                                                  | 证据状态           | Owner 决定     |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------ | -------------- |
| R01 | 归档 closed；曾把 bundled Web UI 改为默认启用并显示地址。                      | 当前配置默认 `webUi.enabled = false`，必须显式 `--web-ui`；关闭开关仍在。                         | **缺失/回退**      | **不做**       |
| R02 | 归档 closed；曾给 pairing offer 增加 hostname。                                | 当前 offer 只有 serverId、key、relay；扫码仍不能从 payload 得到 hostname。                        | **缺失/回退**      | **保留并恢复** |
| R03 | 归档 closed；曾在 App 连接探测前阻断 Hosted HTTPS→明文非 loopback WS。         | 当前 `test-daemon-connection.ts` 没有该客户端安全边界；server 的 loopback bind 检查不是同一功能。 | **缺失/回退**      | **保留并恢复** |
| R04 | 归档 closed；曾实现 `.remote.localhost` 远端 loopback 服务访问。               | 当前 Relay 仅承载 BySpace client↔daemon 控制协议；Service Proxy 仅代理 daemon 本机服务。          | **缺失/回退**      | **不做**       |
| R05 | 归档 closed；曾实现 standalone WSS Data Relay spike。                          | 当前没有独立 daemon-to-daemon data relay server/transport；普通 Relay v2 不能替代。               | **缺失/回退**      | **不做**       |
| R06 | 归档 closed；曾实现 remote mapping/grant/persistence 和 HTTP/SSE/WS/HMR 转发。 | 当前未见 remote service mapping、grant RPC、本地 route 生命周期或 daemon-to-daemon 转发。         | **缺失/回退**      | **不做**       |
| R07 | 归档 closed；曾有 Data Relay 和 Remote Web Services 设置 UI。                  | 当前设置只覆盖普通 Relay/连接与 Service Proxy；没有旧 Data Relay 热重载、映射向导和端口预设。     | **缺失/回退**      | **不做**       |
| R08 | 归档 closed；修过 Service Proxy WebSocket upgrade 被 daemon `/ws` 抢走。       | 当前有独立 Service Proxy upgrade routing、workspace host 解析和测试。                             | 强代码证据；待实机 | **不做**       |

## A · Agent、Session、编排与项目准备

| ID  | reset 前证据                                                            | 当前 `main` 证据                                                                                                            | 证据状态           | Owner 决定     |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------- |
| A01 | 归档 closed；任意 Host 的编排 Skills 状态与安装生命周期曾闭环。         | 当前 orchestration-skills controller 有 status/reconcile/uninstall/update，App 有 Agent Skills 设置；未做跨 Host 实机验收。 | 部分/待验收        | **不做**       |
| A02 | 归档 closed；曾支持按 Skill/目标目录选择并确认移除。                    | 当前 selection store、`saveSelection(selection, confirmedRemovals)` 等机制仍在；旧 modal 测试路径已变。                     | 强代码证据；待验收 | **不做**       |
| A03 | 归档 closed；Pi 多题、多选、自定义答案与 fallback 曾有组件/服务端测试。 | 当前 question form 和 Pi provider 路径仍在，但未重新证明真实 Pi RPC fallback 顺序。                                         | 部分/待验收        | **不做**       |
| A04 | 归档 closed；曾有专用 project-readiness Skill 与确认后修改流程。        | 当前只有普通 workspace setup；未见专用 readiness 检查、建议、确认和验证闭环。                                               | **缺失/回退**      | **保留并恢复** |
| A05 | 归档 closed；曾实现 provider + manual session/thread ID 导入。          | 当前 Import Session 只列举可发现会话；未见手输 provider handle 的 UI 路径。                                                 | **缺失/回退**      | **保留并恢复** |
| A06 | 归档 closed；曾在 focus/visible 时强制 timeline catch-up。              | 当前有 timeline hydration/recovery 与 workspace lifecycle 管道，但未直接证明所有 focus/visibility 场景立即 catch-up。       | 部分/待验收        | **保留并验收** |
| A07 | 归档 closed；曾统一 Host 级 timeline owner 与请求顺序。                 | 当前 timeline sync/controller、gap recovery 与分页测试较完整；需用真实切换/refresh/rewind 并发场景复核。                    | 强代码证据；待验收 | **保留并验收** |
| A08 | 归档 closed；曾保留旧 timeline 并显示“正在同步最新进度”。               | 当前未找到该同步 banner/状态文案的实现。                                                                                    | **缺失/回退**      | **保留并恢复** |
| A09 | 归档 closed；曾设计初始命名后由当前 Agent 基于上下文精炼名称。          | 当前有默认/自动命名基础机制，但没有 Agent 上下文精炼 workspace/branch 名的闭环。                                            | 部分/缺失核心      | **保留并补齐** |

## V · 本地语音输入

| ID  | reset 前证据                                                         | 当前 `main` 证据                                                                              | 证据状态        | Owner 决定 |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------- | ---------- |
| V01 | 归档 open；SenseVoice/FireRed 等本地模型允许列表、下载和设置未完成。 | 当前有语音输入框架/其他 provider，但没有 Host 本地 STT 模型目录、下载切换删除和离线听写管理。 | **缺失/未实现** | **不做**   |

## W · Workspace、Git、Forge 与侧栏

| ID  | reset 前证据                                                                   | 当前 `main` 证据                                                                                     | 证据状态               | Owner 决定                                         |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------- |
| W01 | 归档 closed；分支列表曾区分 local/remote/both。                                | 当前 BranchSwitcher 未见来源字段、三种图标或对应专测。                                               | **缺失/回退**          | **保留并恢复**                                     |
| W02 | 归档 closed；compact workspace 行常驻三点菜单。                                | 当前 workspace 行按 compact/native gating 常驻菜单，并有相关浏览器测试。                             | 强代码证据；待实机     | **保留并验收**                                     |
| W03 | 归档 closed；Changes Refresh 一级、布局切换二级。                              | 当前 Changes 工具栏有刷新，布局选项位于菜单。                                                        | 强代码证据；待验收     | **不做**                                           |
| W04 | 归档 closed；无 upstream 但 origin 同名已推送时不再显示 Push。                 | 当前 checkout Git 计算 origin 同名 ref/ahead-behind，并有对应测试。                                  | 强代码证据；待验收     | **保留并验收**                                     |
| W05 | 归档 closed；Project 单一结构、attention 优先、hover 展示全部 Agent 精确状态。 | 当前有 Project/Status 两种分组；hover card 不展示全部 Agent 状态。                                   | **部分；核心验收缺失** | **仅保留 hover 展示全部 Agent 精确状态；其余不做** |
| W06 | 归档 closed；统一 Project-first New Workspace flow。                           | 当前各入口共用 New Workspace 流程并支持上下文预填、Isolation/Base branch。                           | 强代码证据；待验收     | **不做**                                           |
| W07 | 归档 closed；hover card 只由 focus-visible 钉住。                              | 当前 card 使用 pointer enter/leave 与 press toggle，未见 focus-visible-only 保持策略。               | **缺失/回退**          | **不做**                                           |
| W08 | 归档 closed；排序不随选择或 Agent 活动变化。                                   | 当前 project projection 大体沿持久顺序，但仍混有 pinned/status mode；缺少原稳定性专测。              | 部分/待验收            | **不做**                                           |
| W09 | 归档 closed；曾删除 Workspace pin。                                            | 当前 pin、pinned projection、菜单和快捷键重新存在。                                                  | **缺失/回退**          | **不做**                                           |
| W10 | 归档 closed；曾删除 Project collapse/expand。                                  | 当前 `collapsedProjectKeys`、项目折叠和 toggle 重新存在。                                            | **缺失/回退**          | **不做**                                           |
| W11 | 归档 closed；attention 保持原位并提供“只看待处理”。                            | 当前 status 分组可改变视图；未见原位 attention-only filter 完整语义。                                | 部分/待验收            | **不做**                                           |
| W12 | 归档 closed；曾让本地 Git 先返回、Forge 后台更新并主动推送。                   | 当前 `handleRefresh()` 以 `includeForge: true` 同步等待完整 snapshot；旧非阻塞方案已回退。           | **缺失/回退**          | **不做**                                           |
| W13 | 归档 closed；hover 显示可换行完整绝对 worktree 路径。                          | 当前 card 路径 `numberOfLines=1`，另有 Copy path；不满足完整可换行展示。                             | **缺失/回退**          | **不做**                                           |
| W14 | 归档 closed；Host Badge `auto` 根据同 Project 跨 Host 决定。                   | 当前策略只是全局 local/remote 可见性；没有按 Project host 基数自动判定。                             | **缺失/回退**          | **保留并恢复**                                     |
| W15 | 归档 closed；History/Schedules 收进顶部 BySpace 单行菜单。                     | 当前左侧栏仍把 History、Schedules 等作为固定一级条目。                                               | **缺失/回退**          | **不做**                                           |
| W16 | 归档 closed；Web drag reorder 兼容 pointer 与长按。                            | 当前有 web draggable list、长按协调、drop/reorder 状态和测试。                                       | 强代码证据；待实机     | **不做**                                           |
| W17 | 归档 open；Windows PR/MR 多行正文与 resolved CLI path 未闭环。                 | body file 机制能保留多行；主 runner 仍以裸 `gh/glab/tea` 名执行，resolved path 只用于探测/特殊调用。 | **部分；路径核心缺失** | **不做**                                           |

## U · 设置、外观、会话与 Explorer UI

| ID  | reset 前证据                                                          | 当前 `main` 证据                                                                  | 证据状态                      | Owner 决定     |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------- | -------------- |
| U01 | 归档 closed；Host 名称、身份色、Badge 预览曾修复。                    | 当前 Host appearance store/设置 UI/测试完整存在。                                 | 强代码证据；待实机            | **不做**       |
| U02 | 归档 closed；设置 IA 曾收敛为 Preferences/Projects/About。            | 当前 App/Host 设置重新拆成多个一级页面，不是原三类信息架构。                      | **缺失/架构回退**             | **不做**       |
| U03 | 归档 closed；弱化消息悬浮操作并把 compact context 用量放入 composer。 | 当前仍有消息区 scroll-to-bottom 悬浮按钮；compact context 布局未证明等价。        | 部分/回退                     | **保留并恢复** |
| U04 | 归档 closed；compact Web 隐藏桌面聚焦快捷键。                         | `keyboardShortcutsAvailable` 明确在 compact/native 返回 false。                   | 强代码证据                    | **不做**       |
| U05 | 归档 closed；compact Web 折叠工具/回到底部进 pane header。            | 当前回到底部仍在 Agent stream 内悬浮；未见 pane header actions。                  | **缺失/回退**                 | **保留并恢复** |
| U06 | 归档 closed；Status 分组 workspace 卡片常驻三点菜单。                 | 当前 menu visible 使用 compact/native gating；status/project 共用 workspace row。 | 强代码证据；待实机            | **不做**       |
| U07 | 归档 closed；修复 Archive split button caret 区高度。                 | 当前 archive 操作 UI 已改，原 split button/caret 触发路径不在。                   | 架构已变；原 bug 不可直接复现 | **不做**       |
| U08 | 归档 closed；桌面模型选择弹窗有合理最小宽度。                         | 当前 selector 支持 `desktopMinWidth`，主要调用点传入 200–360px。                  | 强代码证据                    | **不做**       |
| U09 | 归档 closed；Files/Changes 使用连续滑动下划线。                       | Explorer 已改为通用 pane/tab rail，旧 Files/Changes 二段导航不存在。              | 架构已变                      | **不做**       |
| U10 | 归档 closed；BranchSwitcher 合并到 Explorer 顶栏。                    | 新 Explorer 由通用 tab rail 和 panel host 构成；原独立顶栏/分支行结构已替换。     | 架构已变                      | **不做**       |

## B · 品牌、域名与网站

| ID  | reset 前证据                                                                    | 当前 `main` 证据                                                                                                                                                            | 证据状态                           | Owner 决定             |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------- |
| B01 | 归档 closed；旧 BySpace 根域、stable/beta App 和 stable/beta Relay 迁移曾完成。 | `relay-beta.byspace.cc.cd:443` / Worker `byspace-relay-beta` 仍解析并响应；reset 前版本契约明确将 prerelease 指向该 endpoint。当前 `main` 未恢复按版本自动选择 Beta Relay。 | **基础设施存在；运行时路由待恢复** | **保留并恢复版本路由** |
| B02 | 归档 closed；官方静态落地页曾实现。                                             | `https://byspace.cc.cd` 当前 HTTP 200，标题和产品内容为 BySpace；website 源码仍在。                                                                                         | 强代码与线上证据                   | **不做**               |

## C · CI、发布与工程可靠性

| ID  | reset 前证据                                                | 当前 `main` 证据                                                                                      | 证据状态                     | Owner 决定 |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------- | ---------- |
| C01 | 归档 closed；当时 exact-SHA CI 恢复全绿并留下可复算 run。   | 当前 `3eb257825` exact-SHA CI run `33328833896` 全绿；用时约 32 分 26 秒。                            | 强线上证据；速度另见 C03/C06 | **不做**   |
| C02 | 归档 open；单 build、原字节晋升未完成。                     | 当前 CI 会本地产 tarball 并 smoke，但发布/部署 workflow 仍各自构建；没有同一 artifact digest 晋升链。 | **缺失/未实现**              | **不做**   |
| C03 | 归档 closed；曾保留全覆盖并优化为 12 shard、零 retry 采样。 | 当前仍有完整 Playwright 门禁，但只有 4 shard，整条 CI 约 32 分钟；历史关键路径优化未保留。            | **部分/回退**                | **不做**   |
| C04 | 归档 closed；旧共享 Git stdin 路径曾修复 EPIPE。            | 旧 `runGitCommand` 路径已被新的 Git service 架构替换；当前未发现同一未处理错误证据。                  | 架构已变；需按当前路径复现   | **不做**   |
| C05 | 归档 closed；曾删除 Codex resume 测试的私有 500ms race。    | 当前 `agent-manager.test.ts` 又存在 `Promise.race(...500ms)` 启动门。                                 | **缺失/回退**                | **不做**   |
| C06 | Epic 持续目标；曾以不减覆盖为前提优化 exact-SHA→发布耗时。  | 当前 exact-SHA CI 约 32 分钟，npm/Web/Relay 仍非单 artifact 晋升；没有当前完整发布时间预算证明。      | **未闭环**                   | **不做**   |
| C07 | 归档 closed；基于当时 Web-only 架构净删 643 行。            | 当前上游已恢复 iOS/Android/Desktop 等跨平台边界，原“平台分支不可达”前提失效；通用删死代码原则仍成立。 | 架构已变；原清单不应重放     | **不做**   |

## O · 明确的一次性执行记录

| ID  | reset 前/历史证据                        | 当前证据                                                          | 证据状态   | 处置       |
| --- | ---------------------------------------- | ----------------------------------------------------------------- | ---------- | ---------- |
| O01 | 绑定 Paseo `0.2.0-beta.1` 的旧基线重建。 | 当前基线为 `v0.7.0-beta.2`，已有新的 upstream-sync/release 流程。 | 一次性剔除 | **已剔除** |
| O02 | 绑定 Paseo `v0.2.0` delta。              | 版本已越过，不能重跑。                                            | 一次性剔除 | **已剔除** |
| O03 | 绑定 Paseo `v0.2.3` delta。              | 版本已越过，不能重跑。                                            | 一次性剔除 | **已剔除** |
| O04 | 绑定 Paseo `v0.2.3..v0.2.5` delta。      | 版本已越过，不能重跑。                                            | 一次性剔除 | **已剔除** |
| O05 | 绑定旧 `.cs/`→`codestable/` 目录迁移。   | 当前 CodeStable 使用 `.codestable/`，旧迁移无可执行对象。         | 一次性剔除 | **已剔除** |

## 支撑文档覆盖

以下 9 份 Markdown 不单独投票，但已映射到对应需求，确保 78 / 78 文档覆盖：

- Terminal benchmark evidence、Direct path、paste path → T09–T12。
- mock provider note → A05 测试约束。
- Settings IA talk → U02。
- Import Session talk → A05。
- Local dictation talk → V01。
- Project spec、Vision → 跨能力边界与目录入口。

Terminal benchmark JSON 单独归入 T09 证据。

## 决策汇总

- **保留 34 项**：T01–T18、R02–R03、A04–A09、W01、W02、W04、W05 的 Agent 状态 hover 子目标、W14、U03、U05、B01。
- **不做 38 项**：其余 R/A/V/W/U/B/C 条目；它们不再进入 BySpace 定制 backlog。
- **一次性剔除 5 项**：O01–O05。
- **无待决定项**。

B01 纠偏证据：Beta Relay 并未缺失。历史发布契约和 `ef1f2ac4:scripts/smoke-byspace-package.mjs` 都记录 `relay-beta.byspace.cc.cd:443`，部署 Worker 为 `byspace-relay-beta`；该域名当前仍解析并响应。真正的当前缺口是 `main` 没有恢复 prerelease→Beta Relay 的版本路由。
