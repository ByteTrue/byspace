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

`scripts/e2e-runnable.mjs` + 6 个测试（分类器）。`browser-conformance.mjs` 增加两条**操作序列**断言
（归档最后工作区后项目仍在、移除项目后侧栏消失），并用 `ab9f16418` 验证它们在修复前会红。

## 验证状态

```
npm run audit 五项全绿
浏览器验证 12/12
单跑：agent-skills-settings 12/12 · projects-settings 15/15 · branch-switcher 2/2 · changes-pane 36/41
```
