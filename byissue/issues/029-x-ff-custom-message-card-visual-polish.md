---
kind: issue
title: "CustomMessage 时间线卡片改用 ExpandableBadge + mock 场景覆盖"
type: ff
status: closed
created: 2026-09-14
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# CustomMessage 时间线卡片改用 ExpandableBadge + mock 场景覆盖

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

用户反馈 `[background-exit]` 一类扩展注入的自定义消息卡片（`CustomMessage`，ff 024 引入）丑，经两轮修正定位到根因、拿到真实截图验证。过程：

1. 第一版只换头部图标 + 正文等宽字体，用户指出没解决根本问题：`Write`/`Shell` 等工具调用早有一套折叠徽标（图标+标签+一行摘要，点击展开），`CustomMessage` 却自成一套「方框 + 硬截 6 行」，两边视觉语言不一致——`docs/design.md` §2 明确禁止的情形。
2. 改为直接复用 `message.tsx` 里已服务 `ToolCall`（`Write`/`Shell` 走这条路）和 `TodoListCard` 的共享组件 `ExpandableBadge`——第三处使用它，达到"三处即为原语"的复用门槛。折叠态：图标 + `customType` 原样 + 内容首行摘要（一行，超长省略号）；展开态：完整原文，等宽 `fontSize.code`，与 `tool-call-details.tsx` 的原始输出排版一致。
3. 中间加了个 `humanizeCustomMessageType`（连字符转空格首字母大写）给 `label` 美化，用户追问"其他地方也这样吗，没有就不必要"——查证 `ToolCall` 的 `displayName` 来自 `tool-call-display.ts` 里针对**有限枚举** `ToolCallDetail.type` 的手工 case 映射，`TodoListCard` 的 label 来自 i18n 文案，两处都不是"对开放字符串做机械转写"。`customType` 是 `z.string()` 开放值，没有这个先例，删掉了这个函数，`label` 直接显示 `customType` 原文。
4. 用户问"不是有 mock 数据吗，加一条这种类型的不行吗"——在 `MockLoadTestAgentClient`（Mock Load Test provider）里按现有 `shouldEmitXxx(prompt)` + `scheduleXxxTurn`/`emitXxxTurn` 的既定模式新增一个场景：提示词匹配 `/emit (?:a )?synthetic custom message/i` 时，发出一条 `customType: "background-exit"`、内容与真实场景同构（多行、带路径/命令）的 `custom_message` timeline 项。这样以后要看这张卡片什么样，不用等真实 Pi/OMP 往返，本地起 dev daemon + app、选 Mock Load Test provider、发这句话就行——不再需要伪造截图或迁就 vitest 精简 fixture 主题。

- 改动：
  - `packages/app/src/components/message.tsx` — 删除 `customMessageStylesheet`/`CUSTOM_MESSAGE_COLLAPSED_LINE_COUNT`/`CUSTOM_MESSAGE_CHEVRON_EXPANDED_STYLE`/`customMessageChevronMapping`/`humanizeCustomMessageType`；`CustomMessage` 改为渲染 `<ExpandableBadge label={customType} secondaryLabel icon={Info} isExpanded onToggle renderDetails disableOuterSpacing />`，展开区复用 `fontFamily.mono`+`fontSize.code`+`lineHeight:18` 的既有原始文本排版。
  - `packages/server/src/server/agent/providers/mock-load-test-agent.ts` — 新增 `shouldEmitSyntheticCustomMessage`、`buildSyntheticCustomMessageContent`、`scheduleSyntheticCustomMessageTurn`/`emitSyntheticCustomMessageTurn`，接入 `startTurn` 的 `scheduleTurn` 判断链。
  - `packages/server/src/server/agent/providers/mock-load-test-agent.test.ts` — 新增单测，断言触发词能产出 `type:"custom_message", customType:"background-exit", display:true` 的 timeline 项并正常收尾。
- 验证：
  - `npm run typecheck --workspace=@getpaseo/app`、`npm run typecheck --workspace=@getpaseo/server`、`npm run lint`、`npm run format:files` 全过。
  - `packages/server`：`npx vitest run src/server/agent/providers/mock-load-test-agent.test.ts --bail=1` 16/16 过（含新测试）。
  - **真实像素截图**：本地起 `npm run dev:server`（6778）+ `npm run dev:app`（8081），Playwright 建工作区、选 Mock Load Test / Ten second stream，发送 "Emit a synthetic custom message."，实际渲染确认：折叠态是单行「图标 + background-exit + 2 background tasks finished:」，与同页面 `Write`/`Shell` 徽标视觉一致；点击展开，chevron 转向、等宽正文完整显示在带边框的展开区里，和 `Shell` 工具调用展开态同款外壳。验证完成后已 kill 掉本地 daemon/Metro 进程，删除截图与 `.playwright-mcp` 临时文件，工作区干净。
- byissue：无需要同步的 spec 段落。

顺手发现（未处理）：`docs/qa.md`/`CLAUDE.md` 链接的 `docs/browser-capture-harness.md`、`docs/mobile-testing.md` 在 `docs/` 目录下已不存在（前者概念上也过时，是给 Electron 截图用的，Electron 已在 025 号退役）。纯文档死链，未处理。
