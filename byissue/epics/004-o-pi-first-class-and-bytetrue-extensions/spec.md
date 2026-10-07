---
kind: epic
title: "Pi 一等公民与 ByteTrue 扩展适配"
status: open
owner_decision: approved
created: 2026-10-06
amended_at: 2026-10-06
approval_evidence:
  owner: "「现在派还没有对Subagent插件做专门的UI适配，我想给它补上适配。并且调整本项目的定位，之后派将会是一等公民，会优先给派做适配。这些以ByteTrue开头的是我自己做的扩展，这些扩展也将会是一等公民扩展，我们只按照这些来适配。」（2026-10-06）"
  scope: "「第一个我想A和B都做。第二个按你建议来吧。第三个，就是Pi 排第一，其余 provider 维护降级为 best-effort，可以立一个Epic。非白名单扩展，就现在这样就好了。」（2026-10-06）；第二轮四问「都按你建议来吧。」（2026-10-06）"
  talk: ../../talks/006-pi-subagent-first-class-adaptation.md
---

# Pi 一等公民与 ByteTrue 扩展适配

> **读者：** 在这条变化里对齐的人。为什么 Pi 优先、白名单是谁、首批做什么、哪些明确不碰。

---

## 这条线要改变什么

BySpace 的 provider 适配目前是均等的：五个 provider 谁都接，谁都没有优先。Owner 调整定位——**Pi 升为一等公民**，界面新能力先给 Pi 做；其余 provider 维护降级为 best-effort。**@bytetrue/\* 六个 pi 扩展是一等公民扩展**，扩展 UI 适配只认这个白名单。standing rule 在 `byissue/decisions/003-pi-first-class-and-bytetrue-extension-whitelist.md`。

首个交付：**pi-subagent 的 UI 适配**。现状它是结构化会话里的黑盒——codemode 并行两个 subagent，时间线只有「Codemode used 2 other tools」加两行静态 Task 文本。

- 规则与决策全程：`byissue/talks/006-pi-subagent-first-class-adaptation.md`
- 关联 spec：`agent-conversation.md`（subagent 展示语义将被本 Epic 扩展），交付后回写。

## 已拍板的形态（七条决策）

1. **双通道都做。** subagents track（provider_subagents 通道，Claude 已接入的那条路）+ 父会话时间线行内卡片增强。
2. **数据靠 pi-subagent 主动上报。** daemon 拉起 pi 时经 `launchContext.env` 注入 `BYSPACE_*` 上报地址与标识；pi-subagent 的 `buildChildEnv` 把进程环境传给子进程，子代理天然继承。关联键是 `toolCallId`——pi 工具 `execute()` 第一个参数，协议 descriptor 本就带此字段，协议零改动。feature 协商靠 env 在场性：旧版 pi-subagent 忽略新 env，行为如旧。
3. **只读 tab 的 timeline 走子会话 jsonl。** daemon tail 子会话文件（`<agentDir>/sessions/<encoded cwd>/<ts>_<sessionId>.jsonl`，pi-subagent 的 `sessionLogPath` 规则），复用 pi history-mapper 映射成完整时间线，与 Claude subagent tab 体验对齐。ProgressDetails 只喂 descriptor 摘要，不拼视图。
4. **协议枚举不动。** descriptor status 保持 `running|completed|failed|canceled`；pi-subagent 的 `pending`、`paused`（超时/达轮次上限，可恢复）映射到 `running`，`paused` 时 subtitle 写「已暂停 · 可恢复」。`subtitle` 协议注释「provider 自定、client 不得解析」，pi-subagent 的 behaviorSummary（「Modifying files」「Running tests」）放这里，track 与行内卡片共用。
5. **行内卡片逐行增强，不聚合。** 保持 062 的 codemode 嵌套行结构，每行按 `toolCallId` 订阅 descriptor，实时显示状态点 + 行为摘要 + turns/cost。不为并行 subagent 发明组卡片层。
6. **切两刀。** issue 001 垂直切片（上报端点 + descriptor 通道 + jsonl 只读 tab），issue 002 行内卡片。track 没有 timeline 时是半个功能，不单独交付。
7. **首期只读。** track 行不加停止/恢复按钮；子代理控制在对话里走 pi-subagent 自己的 `subagent_stop`/`resume`。

## 白名单适配候选（登记，未评估）

| 扩展                     | 适配方向                                                    |
| ------------------------ | ----------------------------------------------------------- |
| `pi-subagent`            | track + 只读 tab + 行内卡片——本 Epic 首批（issues 001/002） |
| `pi-web-search`          | 未评估，开 issue 时补现状与方向                             |
| `pi-image-gen`           | 未评估，开 issue 时补                                       |
| `pi-vendor`              | 未评估，开 issue 时补                                       |
| `pi-background-terminal` | 未评估，开 issue 时补                                       |
| `pi-vision`              | 未评估，开 issue 时补                                       |

## 必须守住

- 协议契约（`docs/protocol-compatibility.md`）：descriptor 枚举不扩、新字段全 optional、wire schema 保持纯。
- 非白名单扩展与其它 provider 的现状行为不变；没有上报 env 时一切如旧。
- Claude 的 provider_subagents 三件套不回退——Pi 是第二个接入方，通道语义向 Claude 对齐。
- 062 的 codemode 嵌套行机制在非 subagent 场景渲染不变。

## 质量承诺

- **可靠性：** daemon 重启后 track 从父会话转录（工具结果 final details）+ 磁盘子会话 jsonl 重建；子进程已死而状态悬在 running 的，以 jsonl 尾部为准收敛，不允许僵尸 running 行。证明：daemon 重启场景测试。
- **性能：** 上报沿用 pi-subagent 侧 300ms 节流；jsonl tail 只在 tab 打开时进行。
- **兼容：** 旧 pi-subagent + 新 daemon、新 pi-subagent + 旧 daemon，都退化为现状行为。

**Issues：**（位于同目录 `issues/`；编号仅在本 Epic 内有效）

- [x] `issues/001-o-pi-subagent-track-vertical-slice.md` — 垂直切片：上报端点 + descriptor 通道 + jsonl 只读 tab / 无依赖 / 验证：真机 e2e 起 pi + pi-subagent 断言 descriptor 序列与 tab timeline
- [x] `issues/002-o-pi-subagent-inline-tool-card.md` — 时间线嵌套行实时卡片 / 依赖 001 / 验证：组件三态测试 + 真机场景行内进度可见（三态测试完成；真机核对待 pi-subagent 发版，见 issue 002 验证记录）

**不在本 Epic：** 其余五个白名单扩展的适配（各自开 issue 时评估）；track 行写操作；terminal 会话侧的 subagent 展示。
