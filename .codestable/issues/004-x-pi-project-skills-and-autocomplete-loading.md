---
kind: issue
title: "Pi 启动注入项目信任并完善斜杠补全加载态"
type: bug
status: closed
created: 2026-09-02
closed: 2026-09-02
---

# Pi 启动注入项目信任并完善斜杠补全加载态

## 做成以后是什么样

- Pi 会话启动时自动注入 `--approve` 信任参数，确保 Pi 在无 TUI 的后台 RPC 模式下正常发现项目级 `.pi/skills/`（如 `cs`、`impeccable`）和 `.agents/skills/`；
- 用户敲击 `/` 时按需触发后台命令加载，但补全浮层（Autocomplete Popover）在加载期间保持可见，并显示 `ActivityIndicator` 加载动画与文案（`正在加载 commands...` / `Loading commands...`）；
- 数据加载完成后，加载指示器与文案自动消失，平滑呈现完整的命令与技能列表。

## 为什么现在做 / 当前坏在哪

- Pi 底层默认在缺少项目信任记录时跳过项目级 `.pi/skills/` 发现；BySpace 以后台 RPC 模式启动 Pi 时未注入 `--approve`，导致项目级技能完全不出现；
- 前端 `useAgentAutocomplete` 曾设置 `isVisible = canShowAutocomplete && !(mode === "command" && isCommandsLoading)`，在初次敲击 `/` 命令加载中时强行隐藏了浮层，使浮层未能呈现加载状态，用户感知为“斜杠搜索卡死或失效”。

## 方案与实现安排

1. **Server 端**：在 `appendPiLaunchArgs` 中检查参数，默认追加 `--approve`（若显式指定 `--no-approve` 则不覆盖），使 Pi 子进程自动信任项目目录。
2. **App 端**：
   - `useAgentAutocomplete` 中移除 `!(mode === "command" && isCommandsLoading)` 对 `isVisible` 的阻塞，使浮层在命令加载中时正常显示；
   - `resolveAutocompleteIsLoading` 在 `mode === "command"` 且 `isCommandsLoading` 为 true 时正确返回加载态；
   - `Autocomplete` 组件在 `isLoading` 状态下使用 `ActivityIndicator` + `resolvedLoadingText` 呈现居中动画和文案。

## 验证与执行记录

- Server Pi runtime 单测全量通过（121/121 passed）：验证 `--approve` 注入及 `--no-approve` 避让行为；
- App 单元测试全量通过（5,054/5,054 passed）；
- Playwright Browser E2E 全量通过（`composer-autocomplete.spec.ts` 10/10 passed，含新增的加载态与完成切换端到端测试）；
- 全工作区类型检查 (`npm run typecheck`)、代码规范 (`npm run lint`) 与格式化检查 (`npm run format:check`) 全部通过。

## 关闭结论

- 判断：Pi 项目级技能已可正常发现，斜杠补全加载态动画与文案展示符合预期，数据到达后平滑显示。
- 验证：单元测试、Playwright E2E 与全套静态门禁全绿。
- 毕业：更新 `.codestable/spec/agent-conversation.md` 与 `.codestable/spec/index.md`。
- 遗留：无。
