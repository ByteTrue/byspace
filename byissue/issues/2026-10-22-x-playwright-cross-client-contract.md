---
kind: issue
title: "用 Playwright 套件当跨端契约的验收面：跑得出、定位得到、修得掉"
type: bug
created: 2026-10-22
---

# 用 Playwright 套件当跨端契约的验收面

## 为什么做这件事

逐文件重审（`node-reaudit-log.md`，512/512）的判据是「Go 有没有等价行为」，它结构上看不到一类缺陷：
**Go 发的和后端要的、前端要的不一致**。

用户报的两个 bug 就是这一类：

- 归档 workspace 时整个 project 从侧栏消失 —— `workspace_update` 的 `kind: "remove"` 没带 `emptyProject`，
  前端删掉最后一个工作区就顺手删了项目组；
- 移除 project 没有任何反应 —— handler 归档了项目和它的工作区、返回 `accepted: true`，但**没有广播**。

两轮的字段对账都是绿的：`workspace_update` 的 payload 是判别联合，字段比对被当作 opaque 跳过；而消息确实发过，
连「发没发」都是绿的。

## 关键判断：不重审前端，跑已有的 185 个 spec

仓库里早就有 `packages/app/e2e/browser/*.spec.ts`，其中 `empty-project-persists.spec.ts` **正好覆盖这两个 bug**。
验证方式：用修复前（`ab9f16418`）构建的二进制跑同一 spec —— **1 failed / 4 passed**，失败的正是移除项目那条。

这比「再读 245,000 行前端」更准确：spec 是别人写好的、对行为的断言，我只需要让它跑得起来。

## 先解决「哪 92 个 spec 有判定力」

185 个 spec 里只有 92 个能对 Go daemon 说话。用手工清单筛过两轮，**两次都错**：

| 版本   | 判据                 | 漏掉的                                                                 |
| ------ | -------------------- | ---------------------------------------------------------------------- |
| 第一版 | `provider: "mock"`   | 按模型名（`one-minute-stream`）和按 helper（`mock-agent`）依赖的 20 个 |
| 第二版 | 加模型名与 helper 名 | `agent-tab-image-stability`（经 `assistant-images.ts` → `mock-agent`） |
| 第三版 | 递归跟随 import      | 跟到 `fixtures.ts`，131 个全被误判                                     |

每次错都产生约 26 条**看起来和真缺陷一样**的失败。最终版本 `scripts/e2e-runnable.mjs` 的判据落在两处事实：
被 import 的**文件名**（两跳）、以及**代码里**（去掉注释）的 provider 字面量。6 个测试锁住三次踩过的形状。

`archive-tab.ts` 的注释写着 "unlike the mock provider"，实际用 `provider: "opencode"` —— 按散文判会因错误的理由排掉它。

## 修掉的真缺陷（都是 e2e 跑出来的，不是字段对账能看见的）

| 缺陷                                     | 症状                                                                                       | 证据                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `checkout_status_update` 无 `requestId`  | `omitempty` 让空值把整个键删掉，协议要求 `z.string()` → 每条更新被丢弃，Changes 面板永远空 | 序列化测试；每个 update 都 invalid                     |
| Committed 模式发 working diff            | `compare.mode` 被忽略 → 干净 checkout 上永远空白，满提交的分支看起来毫无改动               | `{mode:"base"}` 实测返回 `committed-only.ts +1 -0`     |
| 分支选择器看不到仅 origin 的分支         | 只读 `refs/heads`，`branchDetails` 恒空 → 队友推的分支不在列表里，来源标签全错             | `["both-source","main"]` → `[...,"remote-only"]`       |
| Skills 缩目标静默删 6 个目录             | `confirmationRequired` 硬编码 `nil` → 关掉 `claude` 直接删托管技能，连问都不问             | 三态端到端：null → removals(6)（目录仍在）→ 确认后删除 |
| Skills 保存失败仍记录选择                | 先写记录再复制，失败后前端把记录读回当成当前选择                                           | `agent-skills-settings` 5 失败 → 12/12                 |
| 项目改名/agent 改名/项目图标不广播       | 只应答调用方 → 侧栏保持旧值，看起来什么都没发生                                            | `projects-settings` 7 失败 → 15/15                     |
| 标签分配不广播工作区                     | picker 的勾选状态从工作区记录派生 → 怎么点都不勾                                           | `workspace-labels` 2 失败 → 通过 2 / 仍失败 1          |
| `read_project_config_response` 发 `null` | `optional` 不等于 `nullable` → 整条响应被丢弃，配置面板空白                                | 控制台 validation 警告清零                             |

最后一条能定位，靠的是同一个提交里的另一处修复：那条警告原本把标识放在对象参数里，console 渲染成
`"Object"`，报告里写的是 `Message validation failed Object`，**什么都没说**。把标识写进消息文本后，一次就看到了
`read_project_config_response`。这类「optional 发 null」已经是第三次（`projectIconRevision`、`runtimeInfo`、这次）。

## 后续轮次补记（provider 快照的 scope 与 ETag）

`new-workspace-model-memory` 的失败把我引到一处结构性缺陷。Node 的 `ProviderSnapshotManager` 有
`catalogs: Map<scopeKey, Map<provider, catalog>>`，Go 只有一份全局状态：

- **刷新不带 scope 隔离**：`refreshProvidersSnapshot({cwd})` 与不带 cwd 的刷新是同一个缓存。项目刷新会把
  host 的观测覆盖掉 —— 二进制被移除后 host 报 `unavailable`，任意项目刷新一次又变回 `ready`。
- **`ifNoneMatch` 的 tag 与目录内容无关**：它 hash 的是 `serverId | 模型数 | 版本`，三个都不会因
  provider 可用性变化而变，也都与 scope 无关。客户端问「这个目录还是最新的吗」，在目录刚变过之后得到
  `notModified: true` + 空 entries。

已修（`88ae048f8`）：per-scope 缓存 + tag 按 scope 的 entries 计算。直接验证：park 二进制并刷新后，
带旧 `ifNoneMatch` 的读取返回 `notModified: false`、`status: unavailable`。

**这条修复让 3 个 spec 从「断言失败」变成新的失败形态**（超时、count 不符），说明它改变了行为而前端读取路径
还没有对应分支 —— 见下方未解决清单。

## 手工复现推翻了 e2e 的失败归因

`agent-message-submission` 26 条失败，我连续两轮把根因归到 turn 时序（先是 `Abort` 不发事件，再是延迟窗口内中断缺
`turn_started` 配对）。**两次都错。** 用 bsk 手工走同一路径，每一步都成功：

| 步骤                                | 手工                                        | e2e        |
| ----------------------------------- | ------------------------------------------- | ---------- |
| 深链 `/h/<serverId>/workspace/<id>` | 侧栏、tab bar 正常                          | 正常       |
| composer 渲染                       | `textbox "Message agent..."`                | 元素不存在 |
| 可访问名与 `composerInput()` 的期望 | 完全一致                                    | —          |
| `fetch_workspaces_response`         | 2 条、`WSOutboundMessageSchema` VALID       | —          |
| `workspace-new-tab-button` testid   | 存在于 `workspace-desktop-tabs-row.tsx:238` | —          |

同一路径、同一 daemon、同一前端产物，手工每次进得去、e2e 每次进不去。差别只在 fixture：`page.addInitScript`
注入 localStorage 的 daemon registry 与 `page.goto()` 之间存在时序窗口。

**这也不是测试基础设施的时序问题。** 我在 Playwright 里用临时 spec 逐段验证了 `openWorkspaceDraft` 的每一步：

| 检查                                       | 结果                                                   |
| ------------------------------------------ | ------------------------------------------------------ |
| `workspace-tabs-row` 存在且可见            | 2 个节点 / 1 个可见                                    |
| `workspace-new-tab-button` 可见            | 是                                                     |
| 点击后 `workspace-new-tab-menu-agent` 出现 | 是（菜单含 agent/terminal/diff/4 个 provider profile） |
| 连跑 3 个 test 共享同一 worker daemon      | 3 次都 `clicked=true`                                  |
| `fetch_workspaces_response`                | 2 条、VALID                                            |
| 页面文本                                   | 含 "New Agent"、composer、"Ten second stream"          |

所以在 Playwright 里这条路径也是通的。26 条失败的原因落在 spec 内部的某个具体交互上，**既不是 Go 实现，也不是
fixture 时序**。我先后把根因归到 `Abort`、中断时序、fixture 竞态，三次都错。

教训：靠 e2e 的错误信息倒推根因，比手工复现低效且容易错。手工五分钟看清的事，我从错误信息猜了几十分钟。

## 后续轮次补记（分步诊断 + mock 移植：26 条失败的真正根因）

前三次误判的共同点是**只跑完整 spec，从错误信息倒推**。改成写一个分步诊断 spec，每步把耗时与 WS 帧落盘，
一轮就拿到了硬证据：

| 步骤                             | 结果                                     |
| -------------------------------- | ---------------------------------------- |
| goto → tabs → 菜单 → composer    | 全通（composer 4ms、selectModel 126ms）  |
| fill + Enter + 点 Stop           | **全通**（Stop 点击成功 88ms）           |
| 等 `turn-working-indicator` 消失 | **30 秒不消失**（65 次采样全部 visible） |

26 条失败不在「进不去 composer」，在「中断后 running 状态不清除」。WS 帧给出三条决定性事实：
`turn_completed` 之后又来 `agent_update status:"running"`（状态倒退）、选中 `one-minute-stream` 却在 170ms 内完成、
点 Stop 后没有任何 `turn_canceled`。八处修复：

| 缺陷                                                     | 后果                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| mock 先发终态事件、后清 turn 状态（Node 与 pi 都相反）   | daemon 快照读到仍在跑的 turn，客户端据此**重开已关闭的 turn**，spinner 永挂                                            |
| 空时间线的 `window.minSeq/maxSeq` 发 `null`              | 整条 `fetch_agent_timeline_response` 校验失败被丢弃 → **agent 面板连同 composer 一起不渲染**（绝大多数失败的真正根因） |
| `turn_canceled`/`turn_failed` 的 event 内层缺 `provider` | 判别联合每分支必填，事件被丢弃 → 中断后 spinner 不消失                                                                 |
| mock 默认 turn 只回显一句就完成（忽略 `durationMs`）     | 永远拿不到可中断的长 turn，Stop 按钮来不及出现                                                                         |
| `config.featureValues` 从未接线                          | mock 的所有旋钮（脚本化拒绝、steer 失败、强制回复）静默失效                                                            |
| `hasOlder`/`hasNewer` 硬编码 false、`before` 方向不过滤  | 长对话**永远翻不到第二页**                                                                                             |
| files-only rewind 比对 `"code"` 而协议是 `"files"`       | 两个分支都不触发却回 `ok:true` —— 静默空操作，影响所有 provider                                                        |
| 时间线不做 projection，分页按原始 delta 计数             | 一个 turn 1894 条原始条目，tail-40 页全是同一条消息的碎片                                                              |

最后一条最贵，也最隐蔽：`projection` 参数被原样回显、从未应用。用不走浏览器的 WS probe
（`scripts/probe-timeline-page.mjs`）直接量化：

```
移植前  tail limit=40: entries=40  {assistant_message:40}  promptRow=false
        tail limit=0:  entries=1894 = {assistant_message:1636, reasoning:216, tool_call:40, user_message:2}
移植后  tail limit=40: entries=34  {user_message:2, assistant_message:8, reasoning:4, tool_call:20}  promptRow=true
```

客户端要的 `TIMELINE_FETCH_PAGE_SIZE=40` 计的是**合并后的行数**，Go 给的是 40 条原始 delta，于是 user_message 与
`(end of synthetic stream)` 被挤出页窗口。已移植 `timeline-projection.ts`：按 call id 折叠工具生命周期、合并相邻
assistant / reasoning delta，每行带上它覆盖的 source seq 区间，分页改成在 projected 行上做。

### 又两次误判，同样被实测推翻

- **「缺 durable timeline store」**：WS 诊断显示 reload 后 daemon 返回 `tail n=40`、首条就是带 clientMessageId 的
  user_message，DOM 里 `aria-busy=false`。时间线根本没丢。
- **「5 个失败都是产品缺陷」**：逐个单跑，`keeps one canonical prompt...` **单跑通过** —— 是共享 daemon 的状态残留，
  与已记录的 `agent-tab-image-stability`、`empty-project-persists` 同一现象。只有 4 个是真缺陷。

教训与前三次相同，但这次有了可复用的手段：**先用分步诊断或 WS probe 复现那一步，再改代码**。probe 不起浏览器、
不抢 Metro，一次就能把「daemon 发了什么」和「客户端怎么用」分开。

## 收尾（2026-10-28）

`--base` 之外的三个缺陷已修，上一轮「未解决」的前三条随之有了结论。

### 修掉的

1. **`browser-conformance.mjs` 的 provider 探针硬编码 6778**（上一轮「验证状态」里点名的那条）：
   `queryProviderSnapshot()` 现在拼 `BASE`，探针才真正问被测 daemon。
2. **跑之前不清 host 注册表**：应用只在 endpoint 未知时才用 daemon 的 same-origin 连接提示重建，
   而 `registryHasConnection` 按 endpoint 匹配。浏览器里留着同地址的旧记录（临时 home、重设过的
   server-id）时，应用保留旧记录、不再探测，整轮检查测的是那条旧记录 —— 表现为「侧栏空」的四条
   假失败。现在每轮先清 localStorage 再从提示重建。
3. **状态转移探针两处口径错**：`archive_workspace_response` 里根本没有 `projectId`（协议没有这个
   字段），而探针拿它去发 `project.remove.request`，于是 projectId 是空串、移除静默返回
   `accepted: false`；`emptyProject.projectId` 又被拿去和 update 上的 `projectId` 比较，而那条
   update **故意不带** `projectId`（客户端把它当「项目移除」的信号）。改为从 create 响应取
   projectId，并把「workspace update 带 removedProjectId」与「project.update kind=remove」都认作
   已广播。

### 查出的产品缺陷

**`enabledByDefault` 在 Go 侧不存在。** `BuildSnapshotEntries` 对每个内置 provider 一律
`enabled := true`，而 `packages/protocol/src/provider-manifest.ts` 给 `omp` 标了
`enabledByDefault: false`。空 home 里 Oh My Pi 因此出现在选择器里，与产品声明相反。
`ProviderSpec` 现在带 `EnabledByDefault`（nil 即 true，和 manifest 省略字段同义）。
守卫：`TestEnabledByDefaultMatchesTheManifest`、`TestExplicitEnableOverridesTheDefault`，都做了反向核对。

### 结果

临时 daemon（真实 home 数据副本）上 `node scripts/browser-conformance.mjs --base ...` **9/10**，此前 1/6。

### 第二轮：全部查完（同日）

**`Open thinking menu` 连同它后面的两条一起修好了，`browser-conformance.mjs` 现在 12/12。**
三个独立原因，每个都在报告「产品失败」而其实没测到产品：

1. **写死了 `Off..Max` 阶梯。** 检查断言菜单必须同时有 `Off` 和 `Max`，但它选中的那个模型
   声明的就是 `low/medium/high/xhigh/max`，根本没有 `off`。模型之间的档位本就不同
   （另一个是 `off/low/high/max`），写死阶梯要么要求模型不认的档位、要么漏掉它支持的档位。
   现在从 provider catalog 读出所选模型声明的档位，逐个与菜单比对。
2. **走侧栏 + `New tab → Agent` 进 composer。** 从空项目落地页出发，这条路三次都回到同一屏，
   并且上面还盖着一层 modal。改为直接用 daemon 自己的 id 构造 workspace 路由。
3. **新草稿没有选中模型**，而 thinking 按钮只在选好模型后才存在（它列的是那个模型的档位）。
   现在会选中 catalog 里的第一个模型，与用户实际会走到的入口一致。

顺带：`dismissOverlays` 加了 Escape 分支——侧栏 overlay 有 `Close menu`，但盖在它上面的
workspace actions 面板没有关闭按钮，只有 Escape 能关。

### 全量跑 + 逐条对照发布版（同日，第三轮）

`node scripts/e2e-runnable.mjs --files` 的 170 个文件、628 个用例，`E2E_WORKERS=1` 跑完：
**601 passed / 9 failed**。9 条逐条对照 0.21.1 发布版（同 spec、同方式），**没有一条是本轮改动引入的**。
6 条是既有缺口或环境限制，3 条是并发下的抖动（单跑全绿）：

| spec                                                                                                    | 单跑                | 0.21.1 对照 | 归类                                                |
| ------------------------------------------------------------------------------------------------------- | ------------------- | ----------- | --------------------------------------------------- |
| `agent-message-rewind`                                                                                  | 1 failed / 2 passed | 同样 failed | 既有缺口 → 已开 issue                               |
| `import-session-flow`                                                                                   | 1 failed / 1 passed | 同样 failed | 既有缺口 → 已开 issue                               |
| `new-workspace-entry` (Ctrl+P)                                                                          | 8 passed（已修）    | 同样 failed | **测试自身的平台假设错误，已修**                    |
| `new-workspace-mode-cycle-safety`                                                                       | failed              | —           | 本机未装 `codex`（CI 会装）                         |
| `new-workspace-codex-mode-preferences`                                                                  | 2 failed            | —           | 同上                                                |
| `pr-pane`                                                                                               | failed              | —           | `gh repo create` 触发 GitHub 限流（账户级，非代码） |
| `agent-timeline-resume` / `changes-pane-canvas-render` / `sessions-empty` / `replica-cache-measurement` | 全 passed           | —           | 全量并发下的抖动                                    |

**`Ctrl+P` 那条的根因**：`openNewWorkspaceProjectPickerWithShortcut` 写死了 `Control+P`，而
`keyboard-shortcuts.ts` 里是 `Cmd+P`（mac）+ `Ctrl+P`（非 mac）两个绑定。在 mac 上按 Control 匹配不到
任何快捷键，选择器自然不开。改用同文件其它 helper 已在用的 `ControlOrMeta+P` 后 8/8 通过。

### 第三轮结论：9 条失败全部有归属

| spec                                                                                                    | 归类                                       | 处置                                                           |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `agent-message-rewind`                                                                                  | 测试把上一轮拖尾算进 rewind                | **已修**（`settleThenClear`），反向核对后 4/4 绿               |
| `new-workspace-entry` (Ctrl+P)                                                                          | 测试写死 `Control+P`，mac 上绑定是 `Cmd+P` | **已修**（`ControlOrMeta+P`），8/8 绿                          |
| `import-session-flow`                                                                                   | 本机没装 `claude` CLI                      | 错误信息**已修**，见 issue 2026-10-28-x-import-failure-message |
| `new-workspace-mode-cycle-safety`                                                                       | 本机没装 `codex`                           | 环境；CI 装了                                                  |
| `new-workspace-codex-mode-preferences`                                                                  | 同上                                       | 环境                                                           |
| `pr-pane`                                                                                               | `gh repo create` 触发账户级限流            | 环境                                                           |
| `agent-timeline-resume` / `changes-pane-canvas-render` / `sessions-empty` / `replica-cache-measurement` | 全量并发下的抖动                           | 单跑全绿                                                       |

`import-session-flow` 那条还顺带修掉一个真实缺陷：失败原因从来没到过屏幕上（banner 由布尔驱动，
mutation 的 message 被丢掉），而服务端给的是 Go 的原始 `exec: "claude": executable file not found`。
现在两者都改了。

### 上一轮记的三条：已无法复现

单跑两轮、每轮 7 例，全绿：

| spec                                   | 结果                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `workspace-labels.spec.ts`             | 3 passed（含此前超时的 `creates, multi-assigns, filters, groups, and edits`） |
| `new-workspace-model-memory.spec.ts`   | 通过                                                                          |
| `new-workspace-model-recovery.spec.ts` | 通过                                                                          |
| `provider-removal.spec.ts`             | 通过                                                                          |

它们当初的失败记录来自「单 worker 共享 Metro 与 daemon 时的抖动」，与真实缺陷混在一起。
本轮在 `E2E_WORKERS=1` 下不再复现，说明当时的归因是对的：那不是产品缺陷。

## 未解决（2026-10-22 记录，部分已被上节取代）

- `new-workspace-model-memory` / `new-workspace-model-recovery` / `provider-removal`：provider 目录加上 scope 隔离后
  仍有 4 条失败。Go 侧读、写、ETag 都已单独验证正确，剩余差异在**前端使用哪个 scope** 上，属产品行为取舍。
- `workspace-labels.spec.ts` 的 `creates, multi-assigns, filters, groups, and edits` 仍在 toggle 的第二轮
  click 超时。加了工作区广播后另外两条通过、这一条仍失败；而 Node 侧 assignment 后**不发** `workspace_update`，
  说明前端本应从响应更新状态。这是前端与 Go 之间尚未定位的一处缺口，不猜测修法。
- 全量一次跑 157 个用例时 140 通过 / 30 失败，但逐个单跑时多数通过（如 `projects-settings` 15/15、
  `branch-switcher` 2/2、`changes-pane` 36/41）。单 worker 共享 Metro 与 daemon 时的抖动，与真实缺陷混在一起，
  需要先把「单跑稳定通过」的集合确认出来，再对剩余逐条定位。

## 机器检查

`scripts/e2e-runnable.mjs` + 8 个测试（分类器）。`browser-conformance.mjs` 增加两条**操作序列**断言
（归档最后工作区后项目仍在、移除项目后侧栏消失），并用 `ab9f16418` 验证它们在修复前会红。

`scripts/probe-timeline-page.mjs`：不起浏览器的 WS probe，一个临时 daemon + 一个 mock agent，直接问
`fetch_agent_timeline_response` 里有什么。分页与 projection 的两次定位都靠它，比 e2e 快一个量级。

mock 移植后 `scripts/e2e-runnable.mjs` 的可跑清单从 90 涨到 166：daemon 现在自带 mock provider，
「依赖 mock」是描述而非跳过的理由。

## 验证状态

```
npm run audit --no-browser 四项全绿（Go 测试 / 入站字段 / 出站字段 / 重审账本）
go test ./internal/... 全绿

typecheck 全绿（lefthook pre-commit 每次提交都跑）
```

### 浏览器验证的真实边界（更正）

上文「浏览器验证 12/12」这一条**不能用来证明本轮改动**，实测后更正：`scripts/browser-conformance.mjs`
的 UI 检查走 `bsk observe` 读**用户浏览器当前页面**，provider 检查里 `queryProviderSnapshot()`
**硬编码连 6778**（本仓库 dev daemon 的旧进程），只有两条 WS 层操作序列检查（归档最后工作区、
移除项目）用 `--base` 指向临时 daemon。起一个临时 daemon（`serve --addr 127.0.0.1:6791 --home <tmp>`，
绝不 `daemon start`，绝不碰 6777）指向新二进制后：那两条 WS 检查 PASS，其余检查测的是旧进程或
用户浏览器，与本轮代码无关。要让这一项真正覆盖 Go 改动，需要把 provider 检查的 6778 换成 `BASE`，
并让 UI 检查在临时 daemon 的 Agent Window 里跑。

### 全量 e2e（权威数据）

`node scripts/e2e-runnable.mjs --files` 得到 166 个可跑 spec（原 90，mock 实现后 +76），
展开 628 个用例：

```
455 passed · 158 failed · 1 flaky · 13 skipped · 3 did not run   (1.1h, workers=2)
Metro stopped: 0 · ERR_CONNECTION_REFUSED: 0
```

失败按可跑清单来源分成两类，两类都要看：

| 分组                                   | 失败用例 | spec | 基线对照                                 |
| -------------------------------------- | -------- | ---- | ---------------------------------------- |
| 改动前就可跑（90 个）                  | 65       | 34   | **63 → 65**，逐 spec 逐用例名对照，见下  |
| 本轮新启用（76 个 MOCK_PROVIDER spec） | 92       | 38   | 无基线：改动前 mock 不可用，这些从未跑过 |

**无回归，用同批 spec 换二进制证明。** 用 `git worktree add /tmp/baseline-wt 1ce7be1e4`（改动前）

- 复用当前 `internal/webui/dist`（本轮未改前端）build 出基线二进制，同一批 90 spec、同前端、
  只换 daemon（`BYSPACE_E2E_DAEMON_BINARY`，就是 `isolated-host-daemon.ts:17` 为此留的开关）跑一遍：

* 31/34 spec 失败数逐字节相同；
* 3 个 spec 在长跑批次里各多 1 例，单独 workers=1 复核后全部排除：
  - `branch-switcher` 2 passed / 0 failed，长跑里它本来就被标 `1 flaky`；
  - `workspace-setup-streaming` baseline 与 HEAD 是**完全相同的 7 个测试名**，差集为空；
  - `pr-pane` HEAD 比 baseline **少**一例失败。
* 长跑批次的失败计数会虚高：共享 Metro/daemon 的状态残留让个别用例在全量批里失败、单跑通过。
  本轮已知的三个：`agent-message-submission` 的 871、`agent-tab-image-stability`、`empty-project-persists`。
  所以判定回归只能按测试名做差集，不能比数字。

本轮新启用的 92 例失败，按签名归到已定位的独立缺口（都记在本 issue 与 note 里，都不是回归）：

| 失败例数 | 签名                                              | 归属                                                                                                                                                                                                     |
| -------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11       | `chat-outline-rail` 不渲染                        | probe 证明 daemon 的 `list_prompts` 返回 3 条正确 prompt（含 seq/timestamp），`agentTimelinePromptIndex: true` 也已声明；rail 需 `prompts.length >= 2`，数据满足，故在客户端首帧时序。**未改前端，未修** |
| 10       | `exec: "opencode"/"codex": not found in $PATH`    | 环境缺外部 CLI，与本轮无关                                                                                                                                                                               |
| 6        | `Open chat history attachment` / `[System Error]` | fork_context 与 turn_failed 的 daemon 缺口，见下                                                                                                                                                         |

### 本轮已修（20 个提交）

`agent-message-submission.spec.ts` 从 **1 passed / 26 failed → 25 passed / 2 failed**（零 Metro 崩溃）；
`agent-timeline-pagination`、`viewed-agent-timelines`、`rewind-menu.ui-contract` 从大面积失败转为基本全绿。

其中四个提交修的是**对 pi（真实 provider）而非 mock 才成立**、或**跨 provider 的 daemon 行为**，都是把 node
的实现照抄过来时漏掉的前提差异：

- `74b619e6f` projection 的 `makeCanonicalEntries` 把每个 entry 的 seq 区间压成单点。node 的 rows 是一条
  delta 一行、从不跨 seq，所以它只读 `row.seq` 是对的；但 **pi 把流式 delta 折叠进同一个 entry 并让
  `SeqEnd` 随文本增长**，一条 assistant 行可以合法地跨 seq 2..500。压成 `2..2` 之后，cursor 落在区间内的
  `after` 页会漏掉整条行（客户端丢一整条消息），而 `sourceSeqRanges` 谎报只覆盖一个 seq，这正是防止页边界
  切进合并消息的依据。mock 每个 delta 一条 entry，所以 probe 照不出这个问题——**只有 pi 的形状能暴露它**。
- `6f8c129a2` turn_failed 现在追加 `[System Error]` 时间线条目。`ManagedSession` 新增
  `AppendTimelineItem`：只存不广播，由 daemon 自己发事件，避免 provider 重入自己的事件循环；6 个 provider
  各自实现（pi/mock 用 `streamSeq`，其余用 `len+1`）。连续重复行去重，紧跟真实输出之后的失败仍然记录。
  新方法登记进 `selfLockingMethods`，AST 守卫反向验证过（注入持锁调用后确实变红）。
  验证：`assistant-fork-menu.spec.ts` 的失败点从 line 54（`[System Error]` 断言）推进到 line 105（fork
  attachment），该行不再出现在失败签名里。
- `9e81bca77` turn_failed 后 agent status 报 `idle` 而非 `error`（原未修清单第 2 项，note #15，已修）。
  根因有两层：`case "byspace_turn_failed"` 写 `LastStatus = "idle"`；且 `buildAgentSnapshotPayload`、
  `getAgentPayload`、`handleWaitForFinish` 三处用 `mp.session.Status()` **无条件覆盖** `LastStatus`，而
  provider session 拆掉失败 turn 后返回 idle。`"error"` 是 **daemon 拥有的生命周期状态**，没有 provider session
  会返回它，所以新增 `resolveAgentStatus(last, session)`：last==error 且 session 为 idle/空时保留 error，
  session 转 running（新 turn 已开始，顺带清除 error）或 closed（进程已死）时让位。四个覆盖点 + 快照构造
  统一走它。`wait_for_finish` 顶层 status 从硬编码 `idle` 改为按 daemon 记录派生（error 时带 lastError，
  对齐 node 的 `resolveWaitForFinishError`）；**permission 态刻意不派生**——node 靠 `waitForAgentEvent` 里一个
  在 turn settle 前就 resolve 的短路到达它，本 daemon 的 `WaitForFinish` 没有该短路，硬造一个替身会报出
  没有测试或客户端预期的状态。process_exit 路径不动（它 `delete(s.agents)`，之后快照走 `rec.LastStatus`，
  无 session 可覆盖）。验证：`workspace-hover-card-agents.spec.ts:43` 的 `errorSnapshot.status==="error"`
  断言转绿。消费端已逐个核对与 node 一致（`canMarkUnread` 判 idle、`session.ts:6861` 过滤 idle||closed，
  error 态在两处都正确地被排除在「已完成」之外）。
- `feec17498` "Emit N assistant messages before synthetic user message" 在 node 里是**独立快速完成分支**
  （N 条 pre-echo → user message → 立即 finish），我在 mock cycle 移植时把它当成默认 turn 的前缀，emit 完
  pre-echo 后 fall through 到 cycle stream，于是在 one-minute-stream 上这个 turn 跑满 60 秒才结束。提交该
  prompt 后等 idle 的 spec（`agent-message-submission.spec.ts:928`）超时在一个永不停止的 spinner 上。
  full166c 里它「通过」是长跑侥幸（60s cycle 碰巧没超 30s 断言窗口），行为本身与 node 背离。提成独立分支
  带独立完成，单测用 spec 实际的 model 断言「远快于 model duration 完成、205 条 assistant + 1 条 user 且
  user 在末位、无 tool_call」。

### 未修，已定位并记录的 daemon 缺口（都不是本轮回归，影响所有 provider）

1. **submitted-prompt 注册表缺失**（note #13）：Go 声明 `canonicalSubmittedPrompts: true` 却没有实现。
   Node 在 send 时就建 canonical 行（`messageId = clientMessageId`，故 rewind trigger 立即渲染），
   provider echo 到达时补 `providerMessageId`；rewind 守卫判 `!providerMessageId` 才拒绝。
   Go 的行只在 echo 后存在，守卫无从触发 → `agent-message-rewind.spec.ts:91` 失败。
2. **agent.fork_context 把 boundary seq 当数组索引**（note #14）：`cut := BoundaryCursor.Seq;
if cut < len(tl)` 量纲不符，条件几乎恒 false，边界被静默忽略；`boundaryMessageId` 分支在 Go 里
   完全没实现；也没有 Node 的 `<chat-history-summary>` 包装与 entry 筛选 →
   `assistant-fork-menu` 的 6 例失败全部死在这里（fork attachment、draft tab 未选中、URL 未跳到
   `/new?draftId=`）。
3. **turn_failed 不标 attention badge**（`9e81bca77` 的相邻缺口，本轮发现）：`markAgentAttention` 只被
   `AttentionReasonFinished` 调用，turn_failed 从不 badge；而 `AttentionReasonError` 常量已定义、
   `pushTitleFor` 也已支持 "Agent failed"，只是没人调用。node 对 error 有独立 attention。不影响 #15
   的 status 语义（那是两件事），但失败 agent 不会像完成 agent 那样在侧栏点亮。

这三项都是独立工作项，应各自开 issue，不要塞进本轮。
