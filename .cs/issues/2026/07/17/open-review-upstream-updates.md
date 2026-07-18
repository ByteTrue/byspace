---
kind: issue
title: "审阅 2026-07-17 Paseo upstream 更新"
status: open
created: 2026-07-17
epic: ""
---

# 审阅 2026-07-17 Paseo upstream 更新

## 目标

完整审阅当前 cursor 之后直到冻结的 Paseo `main` tip 的每一笔 commit，为每笔记录可观察价值、依赖、冲突、风险和唯一 disposition；在用户明确批准完整 ledger 前不 replay 任何实现提交。

## 冻结区间

- Start exclusive：`d42ab91971a92bf2e2a981848989c7ca6536a18e`
- End inclusive：`1977d330edefb8d7c8c0f0673e911586d40a6262`
- Commit count：33
- Fetch：`git fetch --no-tags upstream main:refs/remotes/upstream/main`
- Cursor 语义：本区间完成逐笔 disposition 后才推进到 End；不是最后应用 commit。

## 范围

- 审阅完整 commit message、file list 和相关 diff。
- 区分 retained Web/CLI/daemon/Provider 行为与已删除 Electron/native/Browser/website 面。
- 对每个 SHA 给出 inherited / full / partial / defer / skip 之一。
- 对协议、Provider、生命周期、timeline、terminal、workspace 和 App 变化列出 focused verification。
- 单独识别 `0.2.0-beta.1` 的功能提交与纯 changelog/version/lock/release 提交。
- 用户批准后才在隔离 worktree replay；当前阶段只形成批准 artifact。

## 约束

- 不导入 upstream tags，不 wholesale merge。
- 不恢复 Electron、原生 iOS/Android、内置 Browser automation 或 marketing website。
- 不重新引入旧 package/env/config/type 名；行为翻译为 BySpace/byspace/BYSPACE。
- 协议字段保持 append-only、optional/capability-gated；不因 upstream 版本线改变 BySpace protocol contract。
- 不因 feature 体积大或冲突多而静默遗漏。
- 用户摘要必须覆盖 33 个 SHA，且每个 SHA 恰好一次。

## 质量目标

- **完整性**：machine-checkable ledger 与 frozen range 集合完全一致。
- **兼容性**：所有 protocol/provider/persistence 变化说明旧 client/daemon/state 的解析与 gate。
- **产品边界**：Web-only、Pi-first、BySpace identity 和单包 release 结构不回退。
- **可靠性**：生命周期、timeline、terminal、sync traffic 等变化均有失败路径和 focused regression 计划。

## 完整 Ledger

### 建议完整同步（12）

#### `5da6548affc750e888db88ec3ded127dce649c0b` — archived workspace recovery

- 行为：History 中打开已归档 Agent 时显式 inspect/recover workspace；目录仍在则 unarchive，已删除 worktree 则重建；失败、host upgrade、并发 restore 均有明确状态。
- 面/兼容：Web + client/protocol/daemon 全 retained；新增 dotted RPC 与 optional `features.workspaceRecovery`，必须按 BySpace 版本重写 COMPAT，保留旧 client 的 `refreshAgent` 行为。
- 当前/建议：BySpace 只有隐式 refresh partial equivalent；缺少完整 recovery service/model。**full**。
- 风险/验证：高；覆盖目录存在/缺失、branch/project 缺失、共享 workspace 多 Agent、direct/relay 广播、新旧 client/daemon 双向兼容。

#### `0d3b717cf35ed5bb7887cb658631d5531333104b` — Git commit history

- 行为：Changes 展示 ahead-of-base commit history、local/remote 状态、每笔 file stats 和 commit diff tab。
- 面/兼容：Web/Git daemon retained；新增 `checkout.commits.list.*`、`checkout.commits.file_diff.*` 与 optional capability；不得恢复 Electron/Browser tab 语义。
- 当前/建议：当前完全不存在；跨 protocol/server/client/App 且冲突多，但战略一致。**full behavioral port**，与 `737f30c` 同一 milestone。
- 风险/验证：高；base/ref/detached/missing remote、rename/binary/200 cap、path/SHA trust boundary、tab migration、compact Web、legacy daemon gate。

#### `a1cd50c2ae45c11e618d34f55e7bb410d6cde9aa` — archived provider-session reimport

- 行为：已归档 provider session 重新导入时保留 Agent identity/timeline/workspace；校验 cwd/ownership，串行化并发 import，失败完整 rollback。
- 面/兼容：所有 Provider、Web、protocol、daemon retained；`workspaceId` 与 `features.importSessionWorkspaceTarget` 都保持 optional。
- 当前/建议：当前会 unarchive 后再创建重复 workspace，并把 archived handles 当已导入。**full**，不能只拿 UI 字段。
- 风险/验证：高状态完整性；重点验证 Pi、ACP、并发同 handle、realpath mismatch、parent labels、resume/history failure rollback、无 orphan workspace/runtime。

#### `d5baf1a7e6e6b5c4e32d1a57372a9703bc1a5e41` — ACP foreground lifecycle fix

- 行为：ACP setup/out-of-prompt notification 不再伪造 30 秒 autonomous turn，避免配置通知提前完成仍在 streaming 的 foreground run。
- 当前/建议：直接修复 retained ACP Provider；会删除 BySpace 先前对 autonomous timer 的本地 hardening，因为机制本身被撤销。**full**。
- 风险/验证：中高；配置更新不产生 turn、unscoped content 仍可见、foreground completion/cancel/failure 恰好一次、通用 ACP 无回归。

#### `737f30c339bbd80390e9ffe8d67ad6b7fe939d24` — commit-history review polish

- 行为：commit 相对时间、hidden/collapsed 时停钟、skeleton、commit diff unified/split toolbar。
- 依赖/建议：严格依赖 `0d3b717`。**full**，在 parent feature 后移植；不单独摘 utility。
- 风险/验证：中；timer cleanup、时间边界、layout persistence、compact Web、panel reopen。

#### `d2308f483558d19bf5121cc0c2ad310f34d67f41` — native OMP Provider

- 行为：OMP 不再伪装成 Pi；独立 rpc-ui launch、full/ask permissions、history/session/commands/host tools/subagents/todos/usage/v17 compat；Pi/OMP 仅共享 JSONL process transport。
- 面：完整 Provider 面 retained，且能阻止 OMP 语义继续污染 Pi；旧 `paseo-*` tools/types 必须翻译为 BySpace。`d2308f4` 自带的旧 OMP icon hunk明确不应用，保留当前已继承的 `dfada2a` monochrome icon。
- 当前/建议：当前 OMP 是 `PiRpcAgentClient + omp argv` 的近似适配。**full atomic Provider port**，不能拆成 manifest/transport/OMP 三段残缺状态。
- 风险/验证：极高且 Pi-first；先记录当前 Pi baseline，移植后把 Pi create/resume/history/cancel/permission/commands/tool mapping/MCP/subagents/process cleanup 与真实 current-Pi CLI smoke 作为 blocking gate；Pi parity 通过后才验证 OMP full/ask/v17/history/todos/subagents。

#### `9f5f5fce620684a5a5d2c74940c37482eb45feeb` — terminal resize race

- 行为：删除 viewport estimate cache；只有 workspace/app 真正 ready 后才发首次 focus reflow，避免 PTY 永久 80x24。
- 兼容：`CreateTerminalRequest.size` 继续 optional 且 daemon 永久接受，旧 caller 不破坏。
- 建议：**full**，当前 patch 可直接 apply；与 `bce2c50` 组成同一 terminal bundle，但保持 frozen DAG 的 reverse topological order（中间先处理 Forge、sidebar handle 与 reorder），到 `bce2c50` 后再做 terminal checkpoint。
- 验证：blurred mount→focus convergence、workspace switch、visibility、explicit initial size、real browser PTY size。

#### `bce2c50b9e16831ab395e1ea313698ba4dfa0b22` — retryable terminal focus claims

- 行为：renderer/client/connection/visibility 未 ready 时不消费 resize claim；仅实际发送后标记完成。
- 建议：**full**，严格依赖并取代 `9f5f5fc` 的临时 latch。
- 验证：reconnect/renderer delay retry、stale callback、dedupe、pane blur、terminal E2E。

#### `557fc42c890b8badcb60249fd0b30a2396f2b112` — daemon version in every log

- 行为：root logger child binding 加 `daemonVersion`，日志可定位升级边界。
- 建议：**full with BySpace identity translation**；低风险。
- 验证：JSON root/child、redaction、pretty/file/console 路由和 logger focused test。

#### `266d54463be65f01ef3e5e0d57505427d70e598e` — sidebar resize-handle highlight

- 行为：左右 sidebar resize hit area hover 100ms 后显示 1px border highlight。
- 建议：**full behavior**，但实现遵循 `docs/hover.md` 的 plain View pointer boundary，不复制易破的 nested Pressable hover。
- 验证：drag hit area、timer cleanup、左右边位置、compact layout、targeted Web E2E。

#### `293f55afc43200c69c9392b3b688be5580c658ab` — ACP catalog refresh

- 行为：更新 Cline、DeepAgents、DimCode、Dirac、Factory Droid、fast-agent、Gemini、Nova、Qoder、Qwen Code 的 pinned versions/commands。
- 建议：**full**；版本字段与 command pin 必须一一一致。
- 验证：catalog tests、`acp:version-drift:check`、npm/uvx representative smoke、Web export。

#### `1977d330edefb8d7c8c0f0673e911586d40a6262` — selective timeline + directory sync

- 行为：HostRuntime 以 subscribed bootstrap + ordered deltas 维护 agent/workspace directory；仅 viewed timelines 收 live rows，进入可见集后权威分页 catch-up；共享 socket union、retry/reconnect/gap/archive race 集中管理。
- 兼容：新增 client capability、optional feature 与 dotted subscription RPC；old client/new daemon、new client/old daemon、mixed sockets 都保留 global delivery fallback；attention 使用独立 envelope。
- 当前/建议：当前有完整 paged catch-up 但仍 global stream，且 sync 分散在 SessionContext。为真实 latest parity，建议 **full atomic port**，绝不能只移植 server selective filtering。
- 风险/验证：critical；mixed-capability shared session、direct/relay reconnect、split panes union、hidden timeline、attention、RPC retry、多页 catch-up、subscribe/catch-up race、workspace/agent delta ordering、old-client compatibility、流量测量。

### 建议 Web-only / BySpace 部分移植（4）

#### `a622860a3e37ce0a4fb657a3273cfaa5fa08d710` — workspace focus mode

- 移植 workspace-route scoping、workspace keyboard dispatch、可见/可访问 Exit Focus control 和 Web theme/i18n；省略 Electron traffic lights、preload/window manager。**partial**。

#### `a8ebd390fabb88e00b1c2d54890b6cf758eeb103` — Forge abstraction + GitLab/Gitea/Forgejo/Codeberg

- 移植 forge-neutral server/client/App、`gh`/`glab`/`tea` adapters、trust resolver、MR/PR status/timeline/pipelines/approvals/search/checkout/attachments/icons/i18n。
- 当前 Add Project/registration 两笔 `dfe3330`、`943d03a` 已在上一批获批并记录为 applied；所有重叠 hunk 只能按 Forge 所需适配到当前 flow，不改变 Add Project ownership/clone semantics，并继续接受 `workspace.github.clone.*`、`workspaceGithubClone` 及其他已发布 GitHub RPC/fields。
- 新 RPC dotted/capability-gated；`forgeSpecific`/auth state 保持 open；数组/container normalization 移出 wire schemas，不新增 transform/catch/preprocess；COMPAT 使用 BySpace 版本和清理日期。
- 该 upstream commit 本身没有 Electron/Browser/website/native-client 文件。保留名为 `native-data.ts` 的 Web forge data module；仅省略 `workspace-open-in-editor-button.tsx` 中依赖本机 editor/OS integration 的 hunk，翻译所有 Paseo identity。**partial full-feature Web/daemon port**。
- 风险极高；GitHub parity、SSH alias/enterprise trust、CLI missing/auth、GitLab fork pipeline、Gitea actions、archive-on-merge、Add Project overlap ledger、draft migration、old client/daemon、zod-aot 都要验证。

#### `a7cbf4f61ddd5adf78970e8c6584b6e8f5c78880` — immediate mouse reorder

- 移植 Web `MouseSensor` 6px + `TouchSensor` 180ms 分流和 tests；省略上游 native haptics/context-menu extraction。**partial**。

#### `df2b7cab46f42538c3c7240da14a8bc426eb0354` — release version classification

- 移植 patch/minor 分类、展示目标版本与理由后审批、禁止 agent 自主 major；命令和文档改为 BySpace，省略 Desktop/Android/website release 叙述。**partial**。

### 已由 BySpace 覆盖（1）

#### `dfada2a556a5013899214dea75fad874723f084c` — OMP icon

- 当前 `omp-icon.tsx` 已使用同一 `64x64` path 和 monochrome theme fill。**inherited**，不 replay。

### 跳过：excluded surface / upstream release bookkeeping（16）

- `ccf29f4c5034fc1682e571eada1e501f2ae98b01` — Electron embedded Browser OAuth popup；**skip**。
- `721ef03779fe4d3829a624926b852425b08e4ed6` — Paseo Desktop 0.1.108 手工升级告警；**skip**。
- `04c71c5890ed2980f258ed1859805a2343b905ec` — 上述告警 + marketing website CSS；**skip**。
- `7d80fdfd12c35a345c7220f5d1070aab9d1cf3d7` — Electron updater 中间实现；**skip**。
- `623c05aa4d01e824d6381ba5d547a17834fa157f` — 上述 excluded commit 的 revert；**skip**。
- `60855a0f3a7c13c2f22e07a0ae15657e57197cfe` — marketing website changelog grouping；**skip**。
- `6db7e53b6e0bf5eb69a11fb592480088828d38ad` — Paseo 0.1.110 changelog/version bump；ACP behavior 已单独由 `d5baf1a` 处理；**skip**。
- `d9a0b3e8d84d75b9b7fba6bb6d99ac3000190198` — 绑定 upstream 0.1.110 lock 的 Nix hash；**skip**。
- `04d1ebdce037180d31d9449adfa847468d90589a` — Electron guest Browser keyboard ownership；**skip**。
- `70472dc945753c745de008d627035b549b150e31` — Electron updater final replacement；**skip**。
- `388f1d426c01a9b492d084c207dfd99ff2bc33af` — Electron agent Browser tab bridge；**skip**。
- `263ccc2a19abaa1bff7991de688b4c591ef9613a` — topology-only merge，无独立 conflict-resolution diff；父提交均已单独记账；**skip**。
- `c0f80e2477d1c3781381d3a69dab6b35365bcf4b` — Paseo 0.2.0-beta.1 changelog，混含 excluded 功能；**skip**。
- `0bec06c2db7d3ee071416cde80229eabd682b03e` — Paseo 0.2.0-beta.1 package/version/lock bump；**skip**。
- `6f753a142d5e276e4a7089ad17f76997ca44863f` — 绑定 beta lock 的 Nix hash；**skip**。
- `6c99efae52cccb5426f9c300fafaf50ab5447027` — Android EAS release memory；**skip**。

## 用户批准 Artifact

- **Full（12）**：`5da6548affc750e888db88ec3ded127dce649c0b`、`0d3b717cf35ed5bb7887cb658631d5531333104b`、`a1cd50c2ae45c11e618d34f55e7bb410d6cde9aa`、`d5baf1a7e6e6b5c4e32d1a57372a9703bc1a5e41`、`737f30c339bbd80390e9ffe8d67ad6b7fe939d24`、`d2308f483558d19bf5121cc0c2ad310f34d67f41`、`9f5f5fce620684a5a5d2c74940c37482eb45feeb`、`bce2c50b9e16831ab395e1ea313698ba4dfa0b22`、`557fc42c890b8badcb60249fd0b30a2396f2b112`、`266d54463be65f01ef3e5e0d57505427d70e598e`、`293f55afc43200c69c9392b3b688be5580c658ab`、`1977d330edefb8d7c8c0f0673e911586d40a6262`。
- **Partial（4）**：`a622860a3e37ce0a4fb657a3273cfaa5fa08d710`、`a8ebd390fabb88e00b1c2d54890b6cf758eeb103`、`a7cbf4f61ddd5adf78970e8c6584b6e8f5c78880`、`df2b7cab46f42538c3c7240da14a8bc426eb0354`。
- **Inherited（1）**：`dfada2a556a5013899214dea75fad874723f084c`。
- **Skip（16）**：见上方逐笔列表。
- **Coverage**：`12 + 4 + 1 + 16 = 33`；与 frozen range 的 33 个 SHA 集合完全一致；无 missing、extra、duplicate。

### 推荐批准集

执行全部 aligned changes：**Full 12 + Partial 4**。Inherited/Skip 只记账，不 replay。

这是高风险批准集，不会作为一次盲 cherry-pick：只在单一隔离 scratch worktree 中按 frozen DAG 的 `git rev-list --reverse --topo-order` replay，主题 checkpoint 不授权重排。选中提交的精确顺序为：`5da6548` → `0d3b717` → `a1cd50c` → `d5baf1a` → `737f30c` → `d2308f4` → `a622860` → `9f5f5fc` → `a8ebd390` → `266d544` → `a7cbf4f` → `bce2c50` → `557fc42` → `df2b7ca` → `293f55a` → `1977d330`。任何 checkpoint 失败都先收敛再继续。

最终必须对 **整个 scratch diff** 做独立只读 review；另外对 `d2308f4` 做 Pi/OMP parity review、对 `a8ebd390` 做 Forge/protocol/Add Project overlap review、对 `1977d330` 做 sync/compatibility review。

未经用户明确批准上述精确集合，不进入 scratch replay。

## 用户批准

2026-07-17 用户明确确认：**“执行 Full 12 + Partial 4；Inherited/Skip 只记账。”**

## 执行结果

全部 replay 在隔离 worktree `/tmp/byspace-upstream-2026-07-17-1977d330` 中按批准的 topological order 完成；没有 merge upstream、导入 tags 或恢复 excluded surfaces。

| Upstream   | Local       | Mode                                          |
| ---------- | ----------- | --------------------------------------------- |
| `5da6548a` | `56f5fe938` | full                                          |
| `0d3b717c` | `9850ba542` | full                                          |
| `a1cd50c2` | `e02fb06d5` | full                                          |
| `d5baf1a7` | `625834ff5` | full                                          |
| `737f30c3` | `ee829d5aa` | full                                          |
| `d2308f48` | `7847843e9` | full                                          |
| `a622860a` | `a3ee82e5e` | partial Web-only                              |
| `9f5f5fce` | `573a2f4a1` | full                                          |
| `a8ebd390` | `0729c402a` | partial Web/daemon Forge                      |
| `266d5446` | `0bb34be2c` | full behavior, canonical hover implementation |
| `a7cbf4f6` | `c8d51a7fd` | partial Web sensors                           |
| `bce2c50b` | `ab7fb02af` | full                                          |
| `557fc42c` | `263aab67f` | full                                          |
| `df2b7cab` | `da5d07cb5` | partial BySpace release policy                |
| `293f55af` | `a4317ca1d` | full exact catalog data                       |
| `1977d330` | `c96ae649e` | full atomic selective sync                    |

Review hardening：

- `832fb14d5` — commit diff refs/pathspec 作为 Git data 处理；
- `c639d77c8` — archived import activation 纳入 rollback boundary；
- `3aac126ff` — Forge exact-host trust、bounded resources、checkout identity、forge-aware checks URL 与真实 daemon/browser E2E；
- `8c4b5b068` — Gitea current-PR head cache 上限 512；
- `a7f5767a1` — timeline completion 拒绝 superseded client generation / connection epoch；
- `d323ce590` — Playwright global setup 预热 Metro Web bundle，避免首测把 timeout 消耗在 cold compile；
- `6cbbeace0` — 保持失败 import 的 active project 原状态、对齐 adapter-authoritative Forge checkout fixtures、以 v0.1.2 seed 验证 explicit recovery，并允许 Windows npm global install 完成；
- `e4a349c62` — split-pane selective timeline E2E 只接受每个 active socket 的 latest requestId ack，并显式激活左 First / 右 Second panes；
- `92732ebf4` — move-right 后先等待包含 Second 的双-agent daemon ack，再激活 First，消除异步 layout commit race；
- `f3b243740` — split 后通过 daemon 创建新 agent、Command Center 打开至 focused right pane，移除 mac-only move-tab 依赖。

## 关键验证

- Pi blocking gate：本机 Pi CLI `0.80.9`；移植前 focused units `74/74`，移植后 `80/80`；real `fetchCatalog` smoke 继续通过。
- Native OMP：18 个 typed harness/v17 files、80 tests 全绿；OMP binary 未安装，因此 retained real OMP E2E 未运行，且 OMP 保持 disabled by default。
- Forge：protocol/client/server/adapters/worktree/App/retained-flow focused suites 全绿；review hardening 后 449 focused tests 与 real browser → WebSocket → dedicated daemon → injected ForgeService E2E `1/1` 通过。没有伪造 WebSocket transport。
- Selective sync：573 focused Vitest passed、4 skipped；12 targeted Playwright passed；mixed capable/legacy real WebSocket delivery、reconnect、attention、directory ordering 和 paged catch-up 均覆盖。
- Selective traffic：capable viewed delivery `7 frames / 2,331 UTF-8 bytes`，legacy global baseline `15 / 4,908`；real-daemon controlled sample 为 capable A/B `2 / 506`、legacy A/B/C `3 / 761`，unviewed attention 恰好一条 dedicated capable envelope 和一条 legacy stream。
- Retained builds/gates：`build:client`、`build:server`、root typecheck、lint、format、branding、Web export、`upstream:check` 与 diff check 全绿。
- ACP frozen catalog blob 与 upstream `293f55a` 完全一致；执行时 live registry 的 Dirac 已从 `0.4.17` 到 `0.4.18`，按冻结范围不扩大本批。
- Reviewer 误触发的 broad server E2E 在 terminal slow-websocket case 超时；随后该 exact file/exact case 在 scratch 与 pre-sync `main` (`8f7937df`) 均以同一 15 秒 timeout 失败，已证明不是本批 regression。没有以重跑 broad suite 作为验收。
- 首次远端 CI 的 Playwright shard 4 只因 Metro cold bundle 用时约 68 秒而让首个 terminal test 超过 60 秒；retry 在 warm bundle 上 11.7 秒通过。`d323ce590` 把 bundle 编译移到 global setup，清理 checkout-local Wrangler state 后 exact terminal alternate-screen spec `2/2` 通过。
- 第二轮 exact-tip CI 暴露三类确定性问题：Forge 安全加固后旧 tests 仍信任 client `refName`/缺失 GitLab project identity；Windows rollback 因 1ms `updatedAt` 变化破坏 exact state；recovery E2E 的默认 `0.1.1` seed 被 daemon 正确视为 legacy client。`6cbbeace0` 修复后，三个 server 文件 `25 + 25 + 22`、worktree recovery Playwright `5/5`、本地 single-package global install/daemon smoke 全绿。Windows install 在失败前 13 秒仍有 npm progress，原 5 分钟进程 deadline 调整为 10 分钟。
- 第三轮 CI 的 server suites、Windows package smoke（9m46s）与 Playwright shards 1/2/3 均绿；shard 4 唯一失败是 split layout 没有确定 active pane membership，随后又在 daemon ack 前发送 update。`e4a349c62` 扩展现有 real WebSocket gate：新 request 清除旧 ack、只接受 per-socket latest requestId response；测试把 Second 移到右 pane 后显式激活左侧 First，确认 active socket ack `[first, second]` 后再发送。未增加 sleep/timeout，exact selective timeline Playwright `4/4` 通过。
- 第四轮 CI 除同一 split test 外全部 green；两次 runner 都只观察到单-agent ack，证明 move-right 尚未提交便执行了下一步。`92732ebf4` 增加中间 real-ack barrier（2 IDs 且包含 Second），之后才选择 First 并等待精确 `[first, second]`；单 case `repeat-each=3` 为 `3/3`，完整 selective timeline file `4/4`。
- 第五轮 CI 再次只有 split test 失败，且卡在中间 barrier；根因明确为 `workspace-pane-move-tab.right` action 标记 `mac: true`，本地 macOS 可运行而 Linux runner 永不执行。`f3b243740` 改走平台无关的真实产品路径：split 聚焦右 pane → daemon 创建全新 agent → Command Center 打开该无既存 tab 的 agent；左侧 First 保持可见。单 case `repeat-each=3` 为 `3/3`，完整 selective timeline file `4/4`。

## 边界与残余风险

- 未恢复 Electron、native iOS/Android、内置 Browser automation 或 marketing website；active code 无旧 Paseo identity。
- Forge 的 rolling `gh`/`glab`/`tea` 与 self-hosted variants 仍依赖真实安装/凭据；默认测试使用 captured shapes 与 injected runners。
- Legacy worktree metadata 没有 forge/project identity，保持可读但无法追溯检测历史 origin 改动；新 metadata 已持久化并校验 identity。
- OMP live runtime 需安装 `>=16.3.9` 后再做 enable/release validation。
- Pi import discovery 继承 upstream 的 bounded 400-candidate window；direct resume/import-by-handle 不受影响。

## Tracking

`.byspace/upstream-sync.json` 已记录 33/33 dispositions、16 笔 source→local mapping、10 笔 hardening，并把 cursor 推进到 `1977d330edefb8d7c8c0f0673e911586d40a6262`；`npm run upstream:check` 通过。
