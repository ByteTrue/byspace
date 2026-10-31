# 验界面用 Mock 模型，不用接真模型

**结论：** 开发版（daemon 6778 + Expo 8081）的模型列表里有 Mock Load Test。选「Ten second stream」随便发一句，10 秒内会流出一段带标题、正文、Thinking、Read 和 Search 工具调用、列表、行内代码的回复，截图对比对话界面够用。要看某种卡片，就发下面对应的指令句。

**何时用：** 改了对话流、Markdown、工具调用、权限卡、通知这类界面，要在真实浏览器里看效果或截图对比时。

**细节：**

- 只有开发版有这个提供方（`docs/development.md`），打包版没有。
- 模型（`internal/agent/providers/mock_provider.go`）：Ten second stream 最适合截图；One minute、Five minute、Thirty minute stream 是长时间流，调滚动用；Bursty stream 按不均匀的节奏吐字，调流式平滑度用。
- 指令句，不分大小写（`internal/agent/providers/mock_directives.go`）：`emit a synthetic plan approval` 出一张等你批准的计划卡；`emit a synthetic questions` 出问题表单；另有 `notification`、`custom message`、`todowrite`、`turn failure` 几种同样句式；`free-write` 或 `text-only` 只出正文。
- 坑：
  - 开发版 daemon 重启后，之前用 Mock 模型建的 agent 再打开会报 `Response validation failed for fetch_agent_timeline_response`；真实提供方的 agent 不受影响（2026-10-31 实测）。要验界面就新开一个 agent 标签：标签栏的「+」→ Agent → 选 Mock 模型。
  - 工作区里已经有 agent 时，输入框的模型选择器显示当前模型名，不再是「Select model」，脚本要按当前文字去点。
  - 页面里有一个 `aria-hidden` 的隐藏 textarea（量高度用），找输入框要排除它：`textarea:not([aria-hidden="true"])`。
  - 用 Playwright 新开浏览器上下文直接打开工作区地址，会落到首页。切浅色深色在同一个页面上调 `page.emulateMedia({ colorScheme })`，不要新开上下文。
  - Playwright 是仓库依赖，`node -e` 脚本里 `require("<仓库>/node_modules/playwright")` 就能用。

**相关：** [UI 美化 Epic](../epics/2026-10-31-o-ui-style-refresh/spec.md)
