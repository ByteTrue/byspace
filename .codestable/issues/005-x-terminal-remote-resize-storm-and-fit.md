---
kind: issue
title: "复原 Terminal 首帧 post-WebGL 尺寸就绪与 250ms 被动合并机制"
type: bug
status: closed
created: 2026-09-02
closed: 2026-09-02
---

# 复原 Terminal 首帧 post-WebGL 尺寸就绪与 250ms 被动合并机制

## 做成以后是什么样

- 远端连接或本地挂载 Terminal 时，首帧直接以完全铺满容器的准确尺寸（如 150 列）完成挂载与数据流订阅；
- 远程 PTY 从第一帧起只接收一次最终确定的准确尺寸，彻底消除“80 列窄屏 -> 106 列未铺满 -> 150 列满屏”的 3 段式跳变与反复触发全屏重绘（Pi 会话被强制重刷 3 遍）；
- 被动尺寸调整（如 DOM 挂载阶梯、字体度量落定、WebGL 换装）统一通过 250ms 尾部窗口合并，只向 PTY 发送最终落定尺寸；交互式操作（窗口拖拽、点击、焦点切换）保持即时发送；
- 分屏（Split Pane）或窗口大小调整时，失焦的 Terminal 仍能准确跟随容器收缩并通知 PTY。

## 为什么现在做 / 当前坏在哪

- 此前在基线重置与上游同步时，上游粗粒度的 100ms debouncer 与同步立刻 attach 覆盖了 `v0.6.0` 中精细的 `onRendererReady` 门控与 `PASSIVE_TERMINAL_RESIZE_COALESCE_MS = 250ms`；
- 导致组件在未完成真实像素测量与 WebGL 换装前，立即向 Daemon 发送了初始未测量尺寸（80 列），随后在 DOM fit、WebGL 换装阶段又连续发出两次 resize，在 Relay / 远程网络高延迟下放大为 3 次完整的 SIGWINCH 中断与全屏重新渲染。

## 方案与实现安排（对齐 v0.6.0 归档标准实现）

1. **TerminalEmulatorRuntime**：
   - 增加 `onRendererReady` 挂载回调；
   - 必须等 WebGL 渲染器换装完成且容器完成首次非零有效 fit 后，才触发 `onRendererReady`；
   - 提供 `resizeAfterLayout` 并在下一帧自动重试。
2. **TerminalEmulator**：
   - 挂载时不传递过时客户端快照（`initialSnapshot: null`），等真实 WebGL 渲染器测量就绪后再由服务端权威 restore 渲染；
   - 仅在 runtime 发出 `onRendererReady` 时才向外上报 `isReady: true`。
3. **TerminalPane**：
   - 恢复 `shouldAttachTerminalStream = isTerminalStreamActive && isTerminalRendererReady`，未就绪前不发起 stream 订阅，保证首次发送的 `restore.size` 100% 为最终几何；
   - 恢复 `PASSIVE_TERMINAL_RESIZE_COALESCE_MS = 250ms` 尾部合并窗口；
   - 恢复 `workspaceTerminalSession.sizeClaims` 与 `hasTerminalSizeClaim`，保证分屏与多面板并存时尺寸归属稳定。

## 验证与执行记录

- App 单元测试全量通过：`5,051/5,051 passed`（含 `terminal-pane-focus-claim.test.ts` 8/8）；
- Playwright Browser E2E 全量通过：`17/17 passed`（覆盖 `terminal-split-resize.spec.ts`、`terminal-stuck-size.spec.ts`、`terminal-restore-window.spec.ts`、`terminal-retained-tab-stream.spec.ts`、`terminal-clipboard.spec.ts`、`terminal-protocol-query.spec.ts`、`terminal-alternate-screen.spec.ts`、`terminal-activity-indicators.spec.ts`、`workspace-terminal-tab-rename.spec.ts`）；
- 全工作区静态类型检查 (`npm run typecheck`)、代码规范 (`npm run lint`) 与格式化检查 (`npm run format:check`) 全部通过。

## 关闭结论

- 判断：已完整复原 `v0.6.0` 的首帧 post-WebGL 尺寸稳定与被动 resize 合并机制，远程连接时不再发生 3 阶段尺寸跳跃与会话重刷。
- 验证：单元测试、Browser E2E 与全部静态门禁通过。
- 毕业：更新 `.codestable/spec/terminal.md`。
- 遗留：无。
