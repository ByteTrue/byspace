---
kind: work
status: in_progress
current_unit: "死包+quota+COMPAT 三批全删并通过全部验证（typecheck/lint/format 三绿，audit 四步全过，浏览器 12/12）"
next_action: "收尾：记忆已同步（settings-taxonomy Usage 删除/product-scope 无版本漂移+quota）；待 commit（不 push）；另聊 serviceproxy/provider-ACP/forge 插件化"
must_hold: "只删已授权项；保留平台广度/changelog/schedules/git review/forge(GitHub+GitLab)/Chief；不 push 不开 PR"
proof_gap: ""
---

# 瘦身批次一：死代码 + quota + 版本兼容层

## 目标与边界

用户拍板（m00196）：①四个死包直接删；②quota 余额链完全砍掉；③COMPAT 版本漂移兼容层一个不留（政策改为 app/daemon 同版本部署，无兼容需求）；④过时文档删或重写自行判断。

保留不砍：平台广度（安卓/Web/Windows/Mac 天天用）、changelog（What's New 入口）、schedules/heartbeat、完整 git review UI、forge 的 GitHub+GitLab（Gitea 待商榷）、Chief/roles（远期认真做）。

搁置另聊：provider 官方支持策略（skill+模板/ACP 接入点）、forge 插件化取舍、serviceproxy 去留（先给用户讲解）。

## 已定方案与约束

- 死包：internal/ssh、internal/agent/workflowrun、internal/agent/workflowout、internal/versioned（全仓零真实 import，实测 grep；directorysync/collection.go:9 只是注释提及）。连包内测试一起删。
- quota 链（触点已机械枚举，见下）：internal/quota 整包 → ws_git_system.go:1471-1479 case + :21 import → server.go:1392 feature flag → authz/table.go:147,378 → protocol messages.ts 一组 schema+union+feature → client daemon-client.ts:94,502,4840 + index.ts:573,838-847 → web provider-usage/ 8文件 + host-page.tsx HostUsagePage + settings-screen.tsx usage 导航 + context-window-meter tooltip 摘除 → e2e 两 spec + helper → docs/providers.md:220 → i18n settings.hostSections.usage。
- context-window-meter 本体（context 占用环）保留，只摘 usage hook/tooltip section；serverId/provider props 随之删，composer/index.tsx renderContextWindowMeter 调用点同步。
- COMPAT 批删是独立大批次（310处/72文件），需先改 AGENTS.md 协议规则 + docs/protocol-compatibility.md + product-scope 记忆，声明"无版本漂移需求"政策。schema 的向后兼容规则整体作废，wire 可直接窄化。
- 既有测试只读原则例外：被删功能的专属测试（quota/usage e2e、死包测试）随功能一起删，属删除不属于改写。
- 每步验证：make build + 受影响包 go test + npm run typecheck + lint + npm run audit（--no-browser 若无 daemon）。
- 记忆同步：settings-taxonomy.md 的 Usage 独立层条目被本次删除推翻，须更新；product-scope.md 增补"不做版本漂移兼容/不做余额报表"。

## 行为证明表

| 行为路径 | 真实入口 | 操作 | 应观察到 | 证据 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 死包删除后构建 | make build | 删四目录后构建 | 编译通过，无 unresolved import | bin/byspace 0.26.4 构建成功（make-build-2.txt） | 通过 |
| 死包删除后全仓测试 | go test ./internal/... | 构建后跑 | 全绿（被删包测试随包消失） | EXIT=0，52 ok 零 FAIL（go-test-2.txt；quota 删除后复跑） | 通过 |
| Usage 页消失 | web settings-screen | 打开 Host 设置 | 导航无 usage 项，直达 /usage 路由无此页 | Playwright 探针：设置侧栏仅 Projects/Connections/Agents，无 Usage；/settings/hosts/…/usage 无 Usage heading | 通过 |
| context meter 仍工作 | composer tooltip | 悬停 context 环 | tokens/cost 照常显示，无 usage 段、无 provider.usage RPC | 探针：img "Context window 2% used"，tooltip "16k / 1m tokens Session cost $0.0047"，无 Balance/Usage/Quota 字样 | 通过 |
| provider.usage RPC 移除 | daemon WS | 发 provider.usage.list.request | 无此 case（unknown message），authz 表无此条目 | rg 全仓零残留（仅 node-surface-snapshot.json 历史快照）；go test 全绿；入站对账缺口 0 | 通过 |
| COMPAT 清零 | rg "COMPAT\(" | 批删后全仓 grep | 零命中（含注释政策改写） | 源码仅剩 2 个故意保留标签：terminal-keys.ts xterm-ipad-ctrl-c（WebKit iPad 硬件键盘 Ctrl+C keyCode=13 上游 bug，永久）+ workers/relay/main.go relay-room-v3（dated 迁移，remove after 2026-12-15）。其余 ~310 处全删 | 通过 |
| COMPAT 删后 Go 测试 | go test ./... | audit 第一步 | 全绿 | stream 4 测试因 selective timeline 恒开重写：conformance 3 个（subscribeTimeline helper + pace script + subscribeTimelineOnly 避免 fetch 复活死 runtime）+ TestStreamFramesAreCoalesced（create 不带 initialPrompt→idle 时订阅落地→再 send_agent_message 触发 turn，首 token leading flush 不再早于订阅被滤掉）；create_agent_request.git 死字段全链删；audit-3.txt go test ok | 通过 |
| COMPAT 删后入站/出站对账 | npm run audit:go-parity / go-emit-parity | audit 第二三步 | 缺口 0 | 入站缺口 0/出站缺口 0/未路由 0（parity-2.txt）；出站 MISSING 0/OPTIONAL 0/NEVER_SENT 0 | 通过 |
| COMPAT 删后浏览器验证 | npm run audit:browser | audit 第四步（daemon origin 服务 embedded UI） | 12/12 | 先重建 embedded web UI（build:daemon-web-ui，dist 原为 Nov 15 陈旧→仍门控已删 features 走 legacy fallback）+ make build 重嵌 + 重启 dev daemon；browser-2.txt 12/12 全过（Chief home/pinned/providers/thinking menu 全恢复） | 通过 |
| 类型/规范 | npm run typecheck && npm run lint && npm run format | 每批后跑 | 全绿 | typecheck EXIT=0（typecheck-10.txt）、lint 0 警告 0 错误（lint-4.txt，2095 文件 177 规则）、format EXIT=0（format-1.txt，2492 文件）；改动测试文件分批 vitest 全绿（protocol/client/relay/web ~1400 tests） | 通过 |

## 证据与决定

- quota 链额外触点（枚举后补发现）：server.go:2114 dispatcher case、messages.test.ts "provider usage list message contract" describe 块、public-docs/sdk/reference.md listUsage 行、docs/providers.md "Provider Usage Fetchers" 整节、mock_directives.go:25 与 mock_cycle_test.go:397 注释、web/e2e/support/helpers/settings.ts HostSection 类型 + expectRetiredSidebarSectionsAbsent 的 usage 断言（改为 toHaveCount(0)）。
- scripts/node-surface-snapshot.json 的 quota-fetcher/versioned-collection 条目是 Node 归档面历史快照，不改。
- 环境：shell 的 GOROOT 指向不存在的 mise 目录，go 命令一律 env -u GOROOT / export GOROOT="$(env -u GOROOT go env GOROOT)"；后台 shell 不继承 export，dev:daemon 启动命令需自带。
- dev daemon 第一次启动失败（GOROOT），已带修正重启（sh_1e9c2820c001vMecOCUnVN7Jw9）。生产 6777 未动。
- browser-conformance 修了一个既有测试缺陷（git stash 基线复验确认与本次删除无关）：思考菜单检查原来只认 "Select model (Select model)" 占位文案且永远点第一个 provider 的第一个模型；本机 Claude/Codex/Copilot CLI 不在 PATH（status unavailable 无 models），第一个可选模型是 opencode 动态目录（无 thinkingOptions）→ 必失败。改为：匹配任意已选模型标签 + 优先选声明了 thinkingOptions 的 provider/model（本机 Pi）。修后 12/12 全过（conformance-4.txt）。
- COMPAT 批关键教训：①audit:browser 默认对 daemon origin（6778）跑，服务的是 **embedded web UI**（internal/webui/dist，go:embed），不是 Vite 8082。改 web 源码后必须 `npm run build:daemon-web-ui`（重建 web/dist→同步 internal/webui/dist+预压缩）+ `make build` 重嵌 + 重启 dev daemon，否则浏览器测的是陈旧 UI（本次 dist 停在 Nov 15，仍门控已删 features→sidebar 走 structural fallback、providers 缺）。早期 quota 12/12 是对 Vite 8082（--base）跑的，故未暴露。②selective timeline 恒开后，Go stream 测试须先订阅 agent_stream；fetch_agent_timeline 会 ensureAgentLoaded 复活刚 process_exit 删除的 runtime，故 test2 用 subscribeTimelineOnly 不 fetch。TestStreamFramesAreCoalesced 另有一层：首 token 走 leading-edge 立即 flush，若 create 带 initialPrompt 则 turn 在订阅握手期间就跑完、首帧早于订阅被滤掉（merged text 少 tok0）→改 create 不带 initialPrompt（agent idle）→订阅落地→send_agent_message 触发 turn，全部 600 delta 在订阅后流出。③python replace() 静默跳过曾致两次误删→全程改用 edit 工具并行批量。
- COMPAT 删除范围（~310 处/72 文件）：features 版本门（只留 webPush/daemonServiceInstall/daemonTunnels/agentRoleNames 四个 runtime-state/catalog 门）、legacy RPC/字段别名（github_pr/github_issue 附件→forge_*、github_search、checkout.github.*→checkout.forge.*、githubPrNumber→checkoutSource、githubFeaturesEnabled、PR-status github 镜像、pipeline rawStatus）、client caps 机制、retired 子系统 wire（chat/loop/browser-automation/plugin/voice/dictation/hub-execution/editor）、localStorage 迁移、model-normalize shim、binaryCiphertext 协商、create_agent_request.git 死字段。Go 发送表/authz/审计豁免同步。
- 过时文档清理：git rm docs/refactors/session-decomposition-plan.md（Node 时代 god-file 拆分计划，packages/server 已不存在）；docs/forge-providers.md 删 GitHub compat shim 段；docs/product.md 改 Go 单二进制/Wails 平台/删 in-app browser；docs/data-model.md voice/dictation 段改 keys 已删；docs/timeline-sync.md 删 features 门；docs/protocol-compatibility.md 全文重写（无版本漂移政策）；AGENTS.md 规则改 "No version compatibility"。docs/custom-providers.md（791 行段落堆积）未动，留待后续。

## 完成核对

- （收尾时逐项核对）