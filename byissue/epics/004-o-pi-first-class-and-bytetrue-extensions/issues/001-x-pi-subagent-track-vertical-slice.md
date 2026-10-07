---
kind: issue
title: "Pi subagent 接入 provider_subagents 通道：上报端点 + descriptor + jsonl 只读 tab"
type: feature
status: closed
closed: 2026-10-07
created: 2026-10-06
---

<!-- 读者：跨会话接手的人。目标与范围 · 现状怎么工作 · 方案 · 验证 · 关闭回写 -->

# Pi subagent 接入 provider_subagents 通道（垂直切片）

Epic：`../spec.md`。决策出处：`../../../talks/006-pi-subagent-first-class-adaptation.md`。

## 为什么做

pi-subagent 是白名单一等扩展，但在结构化会话里是黑盒：subagent 工具行只有静态文本，运行进度、行为摘要、结果全不可见。本 issue 交付垂直切片：子代理出现在 subagents track，点开 tab 有完整只读时间线。行内卡片在 issue 002。

## 现状怎么工作（改前）

- **通道与协议现成。** `agent.provider_subagents.*`（list/timeline.get/update，descriptor + timeline 流）；`ProviderSubagentDescriptorPayloadSchema`（`packages/protocol/src/messages.ts`）带 `toolCallId`、`cwd?`、`subtitle?`（协议注释：provider 自定显示内容，client 不得解析）、status 四值枚举 `running|completed|failed|canceled`。枚举不扩——`paused`/`pending` 映射 `running`，paused 时 subtitle 前缀「已暂停 · 可恢复」。
- **接入范本。** Claude 侧 `packages/server/src/server/agent/providers/claude/subagents/`（live-source、replay-source、observation 三件套）。Pi 的 `providers/pi/` 下没有 `subagents/`，完全未接入。
- **App 侧预期零改动。** subagents track（`packages/app/src/subagents/track.tsx`、`packages/app/src/panels/agent-tracks.tsx`）与 provider subagent 只读 tab（复用 AgentStreamView，无 composer/archive/rewind）已是 provider 无关渲染。若接入中发现 Pi 特有缺口，回写本节。
- **pi-subagent v0.13.1 现状**（`@bytetrue/pi-subagent`，pi-package-mono 仓库）：内部流式维护 `ProgressDetails { kind: "pi-subagent-progress", runs: RunState[] }`；RunState 有 `id/agent/sessionId/cwd/status(pending|running|succeeded|failed|cancelled|paused)/usage(turns,input,output,cost,ctxTokens)/tools` 轨迹；300ms 节流 emit；`sessionLogPath(run)` 可算子会话 jsonl 路径（`<agentDir>/sessions/<encoded cwd>/<ts>_<sessionId>.jsonl`）；`SubagentTaskRecord.parentSessionId` 已知父会话。pi SDK `execute(toolCallId, params, signal, onUpdate, ctx)` 第一个参数即关联键。
- **上报通路先例。** terminal activity：daemon 注 `BYSPACE_TERMINAL_ACTIVITY_URL`/`BYSPACE_ACTIVITY_TOKEN` 等 env，hook POST 到 `/api/terminal-activity`，缺 env/坏输入/网络失败全部静默 no-op（`docs/terminal-activity.md`）。subagent 上报同原则：**上报永不能让 agent 会话报错**。daemon 拉起结构化 pi 会话时 env 经 `launchContext.env` 注入（`packages/server/src/server/agent/providers/pi/agent.ts:544`），pi-subagent 的 `buildChildEnv` 把 `process.env` 传给子进程。

## 方案（已实现，与原案差异见下）

1. **pi-subagent 侧**（pi-package-mono，发新版）：读上报 env（URL/token/parent 标识，名字实现时定并回写本节）；env 不在场则完全不动作。在现有 300ms 节流 emit 上挂上报钩子，POST 幂等快照：`{ toolCallId, sessionId, parentSessionId, cwd, agent, status, subtitle, usage, updatedAt }`。
2. **daemon 接收端点**：新增 subagent 上报端点，token 校验 + 静默失败，参照 `/api/terminal-activity`。
3. **pi provider `subagents/` 源**：上报 → descriptor 映射（status 映射表见上；subtitle 直通；`title` 用 agent 名 + task 截断），经既有 `agent.provider_subagents.*` 发出。observation 词汇向 Claude 侧对齐，能复用则复用。
4. **只读 tab timeline**：daemon tail 子会话 jsonl（路径由上报带 `sessionId`+`cwd` 算出或由上报直带），复用 pi `history-mapper` 映射成 timeline 行；只在 tab 打开时 tail。注意 Windows 文件锁与 jsonl 半行。
5. **回放与重启**：app 拉 list / daemon 重启后，从父会话转录里 subagent 工具的 final details + 磁盘子会话 jsonl 重建 descriptor；子进程已死而状态悬 running 的以 jsonl 尾部收敛（succeeded/failed/cancelled 落定）。
6. **env 注入**：daemon 创建结构化 pi 会话时注入上报地址/token/parentAgentId，验证 `launchContext.env` → pi 进程 → `buildChildEnv` → 子进程全链路。

## 验证

- 单测：status 映射（含 paused→running + subtitle）、jsonl tail 的 history-mapper 复用、回放重建（含僵尸 running 收敛）。
- 真机 e2e（参照 `packages/server/src/server/daemon-e2e/pi.real.e2e.test.ts`）：真 pi + pi-subagent 跑一个 subagent，断言 daemon 产出 descriptor upsert 序列（running→completed）与 tab timeline 行。
- 兼容：旧 pi-subagent（无上报）+ 新 daemon = 现状黑盒行为不变；反向同理。

## 实现记录（2026-10-06）

原方案四点全部落地，差异与定稿：

- **env 名**：`BYSPACE_SUBAGENT_REPORT_URL` + `BYSPACE_SUBAGENT_REPORT_TOKEN`，经 `launchContext.env` 直通 pi 进程（agent-manager `buildLaunchContext`）。不需要 parent 标识 env——token 32 字节 base64url per launch，daemon 用 `resolvePiSubagentReportAgentId(token)` 反查 agent。
- **端点**：`POST /api/subagent-report`（CI 后由 `/api/pi-subagent-report` 改名——bootstrap 守卫测试拒绝任何 provider 词），body `{ token, observations: [record...] }`，record = `{ id, status, sessionId?, cwd?, sessionFile? }`。loopback-only + token 校验 + 静默失败，参照 terminal-activity。
- **descriptor 三源**：① launch 工具结果 details（tool_execution_end，立即建行不等上报）② HTTP 快照（状态推进 + 带子会话引用）③ `subagent-exit` custom message（转录内，负责回放）。共用 `providers/pi/agent-subagents.ts` 的 observation 词汇，经上移到 `provider-subagents/observation.ts` 的 fold 进入 Claude 同款通道。
- **timeline**：`PiSubagentSessionTailers`（`providers/pi/subagent-session-tailer.ts`）单 timer 轮询子会话 jsonl 增量，喂 `PiHistoryMapper`，timeline 行走 `applyExternalProviderSubagentObservation`。sessionFile 优先、sessionId 扫 `resolvePiSessionsDir` 兜底；终态后宽限 3s 停 tail；agent 删除/discard 时清理。**不是**只在 tab 打开时 tail——descriptor 状态机需要 timeline 行先落 store（tab 打开前也可能已有内容）。
- **回放**：`streamHistory` 里 `replayPiSubagentObservations` 从 runtime 转录重建 descriptor（launch details + exit message）；timeline 行来自子会话 jsonl 文件本身（不随转录走）。
- **App 侧零改动**，验证成立。冒烟：上报→descriptor 翻转→list RPC；伪造子会话 jsonl→回放 user 行→增量 assistant 行→终态停 tail，全通过。
- **pi-subagent 侧**（0.14.0 已发布）：`src/byspace-report.ts`，running 快照去重、终态必发，fire-and-forget；sessionFile 经 sessionLogPath 注入上报。

## 不在本 issue

行内卡片（issue 002）；track 行写操作（停止/恢复）；其余白名单扩展；terminal 会话侧展示。

## 关闭回写

已毕业：`byissue/spec/agent-conversation.md` 的 subagent 展示语义；`docs/providers.md` Pi 一节；env 名（BYSPACE_SUBAGENT_REPORT_URL/TOKEN）与端点（/api/subagent-report）。
