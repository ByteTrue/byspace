---
kind: issue
title: "pi 子代理面板空白转圈：回放收敛僵尸 running + 从磁盘重建 timeline"
type: bug
status: closed
created: 2026-10-12
closed: 2026-10-12
---

# pi 子代理面板空白转圈：回放收敛僵尸 running + 从磁盘重建 timeline

> **读者：** 接手 provider-subagents 数据链的人。根因链、宿主方案（pi-package-mono issue 115）与本仓库的服务端改动都在这里。

## 现象

用户报告（v0.18.0，另一台电脑，Windows）：点开 pi 子代理（provider subagent）tab,内容空白，只有运行中的点阵 loader 永远转圈。

## 渲染机制（为什么是这个样子）

`ProviderSubagentPanel`（`packages/app/src/panels/provider-subagent-panel.tsx`）把 `turnPresentation.isActive = descriptor.status === "running"` 传给 `AgentStreamView`。timeline 为空时：

- 空列表 + turnFooter 存在 → `renderListEmptyComponent` 返回 null（view.tsx 的 boundary 判断），连"暂无消息"文案都不渲染
- 画面 = 空白 + SyncedLoader 点阵转圈,永远

所以症状等价于:**descriptor 卡在 running + timeline 永远为空**。

## 根因链

pi 子代理 timeline 只有 daemon 内存一份（`ProviderSubagentStore` = 裸 `InMemoryAgentTimelineStore`,不落盘）,唯一生产路径是 `PiSubagentSessionTailers` tail 子会话 jsonl,其 session 引用（sessionId/cwd/sessionFile）只来自扩展的 loopback HTTP report——daemon 一重启全丢。回放侧 `replayPiSubagentObservations` 只重建 descriptor,且 transcript 里 launch 记录的 status 是 "running"、无终态记录时永远停在 running（pi 父进程被杀,exit 消息永远不会来）。

两者组合 = daemon 重启后打开父 agent:descriptor 回放为 running + timeline 永空 = 空白转圈。0.18.0 还叠加 paused→running 映射 bug（071 已修）。

## 宿主改动（已完成,pi-package-mono 9405cc9）

pi-subagent issue 115:launch tool result details 带 `{id, status, sessionId, cwd}`,`toMessageDetails()` 提升 `sessionId`/`cwd`/`sessionFile`——父 transcript 自描述子会话指针。旧 transcript 没有指针,救不回来（用户确认接受）。

## 本仓库方案

1. **回放收敛僵尸 running**（`providers/pi/agent-subagents.ts`）:`replayPiSubagentObservations` 单趟后补一趟——transcript 里最后状态仍为 running 的子任务补发 `status: canceled`。语义:回放发生在新 pi 进程读旧转录时,进程替换即树杀（`prepareForClosure`）,无终态记录的子任务必然已死,canceled 是诚实映射。live 路径不动。
2. **从磁盘重建 timeline**（lazy,按需）:
   - 回放/launch 时收集 每个子任务的会话指针（adapter 内部 Map,不进 store 不进协议）;
   - `AgentSession` 新增可选 `rebuildProviderSubagentTimeline(subagentId)`:定位子会话 jsonl（sessionFile 优先,sessionId+cwd 扫描兜底）,整文件过 `PiHistoryMapper` 返回 timeline items;
   - `AgentManager` 的 timeline fetch:store 零行 + descriptor 存在 + status 非 running + 会话在世 → 调一次重建（per-key 去重防并发双写）,经既有 timeline observation 通路 append + dispatch,再返回新页。
   - running 不重建:live 时 tailer 从 offset 0 全量回放,重建会与它双写。
3. **App 侧**:预计零改动——status 收敛为 canceled 后,终态事件使空时间线显示"暂无消息"文案而非转圈。实现后核实,若空态仍缺再补。

## 明确不做

- provider-subagent timeline 持久化落盘（jsonl 是权威,store 只是缓存,与主会话同构）;
- live 时 report 断链的 watchdog(另一类 bug);
- 旧 transcript 补指针。

## 执行记录（2026-10-12,已实现,与方案一致）

**server / pi adapter**（`packages/server/src/server/agent/providers/pi/`）:

- `agent-subagents.ts`:
  - `PiSubagentRecordDetails` 增加可选 `sessionId`/`cwd`/`sessionFile`;新增导出 `PiSubagentSessionPointer`。
  - `replayPiSubagentObservations` 重写为单趟 `replayPiSubagentSession`,返回 `{ observations, sessionPointers }`;原函数变薄包装。**回放收敛**:transcript 结束时最后状态仍为 running 的子任务补发 `{kind: "status", status: "canceled"}`——回放发生在新 pi 进程,进程替换即树杀,无终态记录的子任务必然已死。
  - `replayPiSubagentSessionPointers`:按 id 累积指针(launch result + subagent_status/stop result + exit message,后到者覆盖同键)。
- `subagent-session-tailer.ts`:新增导出 `readPiSubagentSessionTimeline(file, provider)`——整文件过 `PiHistoryMapper`,返回 `{item, timestamp}[]`;坏行/坏文件静默返回已解析部分。
- `agent.ts`(`PiRpcAgentSession`):
  - 实例 Map `subagentSessionPointers`;`streamHistory` 单趟回放吸收指针;live 路径(`emitPiSubagentToolObservations` 的 tool result、`subagent-exit` message_end)同样吸收。
  - 实现 `rebuildProviderSubagentTimeline(subagentId)`:sessionFile 优先、sessionId+cwd 扫描兜底,无指针/文件返回 `[]`。
- `agent-sdk-types.ts`:`AgentSession` 增可选 `rebuildProviderSubagentTimeline?`,新类型 `RebuiltProviderSubagentTimelineItem`。

**server / manager**（`agent-manager.ts`）:

- `fetchProviderSubagentTimeline` 改 async:先查重建条件(descriptor 存在、status 非 running、store 零行、session 实现 hook),满足则调一次重建,经既有 `applyExternalProviderSubagentObservation` append + broadcast,再返回 store 页。per-key `providerSubagentRebuilds` Set 防并发双写;失败不 latch。
- running 不重建:live tailer 从 offset 0 全量回放同一文件,第二生产者会双写。

**app**:

- 零改动(验证成立)。canceled 收敛后 `providerSubagentTerminalEvent` 产出 `turn_canceled`,`turnPresentation.isActive = false`,空时间线走 `agentStream.empty` 空态文案,不再是转圈。小偏差:该文案("开始和这个 Agent 对话...")是为可写主会话写的,只读子代理 tab 显示它略不贴切,但空态已可读,留待空态文案分层时统一处理。

**验证**:

- `agent-subagents.test.ts` 23 例(新增 4:僵尸收敛、收敛对 subagent_status running 的影响、指针提取、旧转录无指针)。
- `subagent-session-tailer.test.ts` 12 例(新增 2:整文件映射带 timestamp、坏文件空数组)。
- `agent-manager.test.ts` 188 例(新增 2:空行 fetch 触发一次重建且二次 fetch 不重建、running 不触发)。
- 组合 374/374 过;`npm run typecheck` 全仓过;`npm run lint` 0 警告 0 错误。
- 真机 e2e(daemon 重启后打开历史 pi 子代理)未跑——依赖真 pi 进程树,由真实使用回归。

## 对抗性审查与修复(2026-10-12,子代理审查)

审查 verdict:需修复后合入,阻塞项 1 个,已修:

- **P1(已修)|回放收敛误杀 live 子任务**:rewind 的 force-hydrate(`forceHydrateTimelineFromLegacyProviderHistory`)在**同一 pi 进程存活期间**跑 `streamHistory()`,原实现会把仍在跑的子代理收敛成 canceled 并被 terminal latch 卡住。修法:`streamHistory(options?: { processReplaced?: boolean })`,**默认不收敛**;仅 prime 路径(resume/unarchive/restore/reload-rehydrate——全部跟随新 session 对象)传 `processReplaced: true`;rewind force 路径不传。`replayPiSubagentSession` 增 `closeRunningAsCanceled` 开关,adapter 按入参透传。
- **P2(已修)|rebuild 与 live tailer 双写**:exit report 先到、tailer 3s grace 仍在 drain 时,fetch 触发整文件重建会与 tailer 各写一批重叠行。修法:重建 append 前同步复查 `rows.length > 0` 则放弃(tailer 保权威);`providerSubagentRebuilds` 从 Set 改 Map<key, Promise>,并发 fetch join 同一重建,根除空响应与 append 的到达竞态。
- **信息级(接受)**:整文件读内存峰值 ~2x 文件大小,已加注释标注流式改造路径;agent 在 await 期间被 discard 时客户端收到 error 响应(可接受);Archive finished 本就把 canceled 算终态(核对过 `archive-finished.ts:39`),语义正确。
- **测试**:新增 adapter 级测试(FakePi 真实回放链:同进程不收敛 / processReplaced 收敛),原 replay 测试改为双模式断言;最终 520/520 过(pi 目录 + provider-subagents + agent-manager + session),typecheck 全仓过,lint 0/0。

审查确认通过的方向:manager async 化调用方、协议兼容(可选方法+既有枚举值,双向兼容)、Archive finished 与 pill 计数、测试有效性(manager 门控)。真实 pi 组合链(回放收敛→指针→重建→整文件读)的端到端测试仍缺,由真机回归覆盖。

## 验证

- `agent-subagents.test.ts`:僵尸 running 收敛、指针提取（launch details + exit details + subagent_status details）。
- pi adapter 测试:rebuild 从伪造子会话 jsonl 产出 timeline items（带 timestamp）。
- manager 测试:fetch 空行触发一次重建、running 不触发、并发只重建一次。
- `npm run typecheck` + `npm run lint`。

## 关闭候选

- `byissue/spec/agent-conversation.md` subagent 段补一句:回放收敛 + 指针依赖 pi-subagent ≥ 0.18（transcript 自描述）,旧转录退化为 canceled + 空态。
- docs/agent-lifecycle.md "Provider-managed child agents" 或 pi provider 段落:回放语义一句。
