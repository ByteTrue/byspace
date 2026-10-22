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

## 未解决

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
npm run audit 五项全绿
浏览器验证 12/12
单跑：agent-skills-settings 12/12 · projects-settings 15/15 · branch-switcher 2/2 · changes-pane 36/41
```
