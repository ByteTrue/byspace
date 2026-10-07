# Pi 一等公民定位与 pi-subagent UI 适配

> **写法：** 按讨论推进顺序，每节 = 一轮推进。
> 起点是「给 pi-subagent 补 UI 适配」，收在「Pi 升一等公民、ByteTrue 扩展白名单、Epic 004 两个 issue」。

---

## 开场：subagent 黑盒与定位调整

Owner 起意（2026-10-06）：「现在派还没有对Subagent插件做专门的UI适配，我想给它补上适配。并且调整本项目的定位，之后派将会是一等公民，会优先给派做适配。这些以ByteTrue开头的是我自己做的扩展，这些扩展也将会是一等公民扩展，我们只按照这些来适配。」

附截图：结构化会话里 codemode 并行调了两个 subagent，时间线只显示「Codemode used 2 other tools」加两行静态 Task 文本——子代理跑什么、跑到哪、结果如何全不可见。

先查现状再开口。关键事实：

- BySpace 本就有 provider subagents 通道（`agent.provider_subagents.*`：descriptor + timeline 流），App 侧 subagents track 与只读 tab 是 provider 无关的通用渲染，但只接了 Claude（`packages/server/src/server/agent/providers/claude/subagents/` 三件套）。Pi 完全未接入。
- pi-subagent v0.13.1 内部状态完整：ProgressDetails/RunState 流式维护（七值状态、usage、工具轨迹、behaviorSummary），300ms 节流 emit，子会话 jsonl 落盘路径可算，paused 可恢复。
- daemon 已把 pi 的 subagent 工具映射成静态 `sub_agent` detail（`tool-call-mapper.ts:407-427`），只有纯文本 log，无实时进度。
- 062 刚建好 codemode 嵌套行机制（parentToolCallId 分桶渲染），截图里两行 Task 就是它的产物。

## 第一轮：形态、上报机制、定位边界

抛三问，各带建议：

1. 形态：A=接 track 路线 / B=时间线行内卡片增强 / C=A+B。建议 A（通道现成、App 零改动）。
2. 上报机制：a=pi-subagent 主动 POST 到 daemon（复用 terminal hook 链）/ b=子 pi 注册为 BySpace 会话 / c=轮询子会话 jsonl。建议 a。
3. 定位边界：建议 Pi 优先其余不动、六扩展钉死白名单、立伞 Epic、非白名单保留 generic fallback。

Owner（2026-10-06）：「第一个我想A和B都做。第二个按你建议来吧。第三个，就是Pi 排第一，其余 provider 维护降级为 best-effort，可以立一个Epic。非白名单扩展，就现在这样就好了。现在怎么样就怎么样，我们不特意去搞它。」

→ 定：A+B 都做、主动上报、伞 Epic + 白名单规则（落在 `../decisions/003-pi-first-class-and-bytetrue-extension-whitelist.md`）。

## 第二轮：tab 数据源、协议枚举、卡片形态、切片

A+B 都要与主动上报解锁了新前沿。先自查事实：

- pi 工具 `execute(toolCallId, ...)` 第一个参数就是关联键，协议 descriptor 本就带 `toolCallId` 字段——协议零改动。
- env 注入链路通：daemon 拉起 pi 时 `launchContext.env`（`agent.ts:544`），pi-subagent 的 `buildChildEnv` 把 `process.env` 传给子进程。
- descriptor `subtitle` 协议注释「provider 自定、client 不得解析」——pi-subagent 的 behaviorSummary 天选落点。
- 坑：descriptor status 枚举 `running|completed|failed|canceled`，pi-subagent 有 `pending` 与 `paused`，旧客户端 zod 会拒未知枚举——枚举不能随便扩。

抛四问：tab timeline 来源（建议 tail 子会话 jsonl 复用 history-mapper，不用摘要拼）/ paused 怎么过协议（建议映射 running + subtitle 写「已暂停 · 可恢复」，不动枚举）/ 行内卡片形态（建议保持 062 嵌套行结构逐行增强，按 toolCallId 订阅 descriptor，一通道喂两处）/ 切片（建议 issue ①垂直切片=上报端点+descriptor 通道+jsonl tab，issue ②行内卡片；track 行写操作首期不做）。

Owner（2026-10-06）：「都按你建议来吧。」

## 收敛产物

- 规则：`../decisions/003-pi-first-class-and-bytetrue-extension-whitelist.md`
- 定位：`../vision/index.md` 产品核心与演化地图两处更新
- 工程：`../epics/004-o-pi-first-class-and-bytetrue-extensions/spec.md` 及 `issues/001`（垂直切片）、`issues/002`（行内卡片）

## 实施记录（2026-10-06，issue 001 完成日）

两处方案修正（发现于施工，已回写 issue 001）：

1. **env 不需要扩展文件注入。** 原以为要靠 byspace-integration.mjs 在加载期 set `process.env`；实测 `launchContext.env` 直通 pi 进程（agent-manager → pi/agent.ts → cli-runtime → spawn envOverlay），直接注入即可。
2. **wire 简化为 token-only。** 原案 body 带 agentId；token 本就 per-launch 随机 32 字节，daemon 可反查，agentId 字段删去。

其余按定稿落地：descriptor 三源（launch details / HTTP 快照 / subagent-exit 消息）、`/api/pi-subagent-report` loopback+token、jsonl tailer 单 timer 轮询喂 PiHistoryMapper、streamHistory 转录回放。App 侧零改动成立。端到端冒烟通过：上报→descriptor 翻转→list RPC；伪造子会话 jsonl→回放 user 行→增量 assistant 行→终态停 tail。pi-subagent 侧新增 `src/byspace-report.ts`（running 去重、终态必发、fire-and-forget），待发版。

## 实施记录（2026-10-06，issue 002 完成日）

按 toolCallId 把 descriptor 绑到父会话时间线工具行，App 侧四个文件 + 三个新测试文件，daemon/协议零改动成立。

关键取舍：

1. **纯函数独立成模块**（tool-call-subagent-row.ts）：message.tsx 无法被单测 import（react-native-markdown-display 在 jsdom/vite import-analysis 崩），三态逻辑抽出去测。
2. **view.tsx 不碰 PaneContext**：AgentStreamView 被 workspace-tab 等无 PaneProvider 场景复用，打开 tab 走 `onOpenProviderSubagent` 可选 props 回调，由 agent-panel 的 AgentStreamSection 用 `openPreferredTarget` 兜住。
3. **binding 存在时抑制展开**：行内点击语义让给「打开只读 tab」，renderDetails/isExpanded 抑制；secondaryLabel 优先 descriptor.subtitle。

真机场景缺口：已安装 pi-subagent（~/.pi/agent/npm 真目录）不含上报代码，descriptor 在真会话要等发版；退化路径（descriptor 缺席→普通工具行）已由纯函数测试钉住。发版后浏览器核对即可闭环。

## 审查记录（2026-10-06，issue 001+002 未提交改动）

用户新流程：施工完成后先派两个子代理并行审查再算完——一个正确性审查，一个 ponytail 过度设计审查，仲裁后统一落地修复。结论与施工清单见 issue 002 审查修复记录。要点：终态 latch 放 daemon 应用点而非 store（store 保持纯）；sessionFile 从扩展上报（推翻 ponytail 删字段的建议，正确性 M4 优先）；app 侧 selector/binding/comparator 三处 memo 失效是审查最大的捕获。

## 发版与交付（2026-10-07）

- **L5 端点测试补齐**：路由 handler 提取为 `createPiSubagentReportRouteHandler(getAgentManager)` 导出工厂（getter 注入 holder，一次挂载——回应 ponytail 对每请求重建的异议）；新 `packages/server/src/server/pi-subagent-report-route.test.ts` 5 用例钉住状态码阶梯（503 holder / 403 非 loopback / 400 缺 token 或空 observations / 403 错 token / 204 观测透传）。
- **BySpace 侧交付**：issue 001+002 + 审查修复 + L5 已提交并推分支 `pi-subagent-ui-adaptation`，PR #20（base main）。typecheck 0 错、oxlint 0 警告、全部触达套件绿。
- **pi-subagent 0.14.0 发版**：mono 仓库 release commit + tag `pi-subagent-v0.14.0`，CI OIDC 发布成功，npm 已可见；本地 `~/.pi/agent/npm` 已升到 0.14.0（byspace-report.ts 就位）。注意 `pi install` 需 `npm:` 前缀，裸包名会被当本地路径。
- **真机闭环待验**：下次真会话 launch pi agent 时 descriptor/sessionFile 上报应自动出现；浏览器核对行内状态点、点击开只读 tab、子会话 timeline 增量。
