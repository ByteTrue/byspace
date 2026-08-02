---
kind: issue
title: "切换 workspace 不再卸载重建 Terminal emulator"
type: refactor
status: open
created: 2026-08-02
epic: ".cs/epics/2026/07/21/terminal-experience/spec.md"
---

# 切换 workspace 不再卸载重建 Terminal emulator

## 目标

在保留挂载的 workspace 之间来回切换时，Terminal 的 renderer 保持存活：不重建 xterm 与 WebGL、不重跑 mount fit 阶梯、不重新订阅与重放快照。用户可观察到的行为不变（内容、滚动位置、输入语义、PTY 尺寸都与今天一致），只是切回更快、不再有肉眼可见的落定过程。

## 范围

- 包含：`terminal-pane.tsx` 中 `isWorkspaceFocused ? <TerminalEmulator/> : <View/>` 这道渲染门控，以及由此产生的 mount 阶梯 / WebGL 换装 / 重新订阅代价。
- 包含：由重挂载带来的首帧尺寸抖动（实测 107 → 106 → 107 → 112）。
- 不包含：`workspace-deck-retention.ts` 的"最多挂载 3 个 workspace"策略（超出上限的 workspace 本来就应该卸载）。
- 不包含：PTY 尺寸同步规则本身，已由 `006-x-terminal-retained-panel-layout.md` 定型。

## 归属

- 隶属 epic：`.cs/epics/2026/07/21/terminal-experience/spec.md`
- 前序 issue：`.cs/issues/006-x-terminal-retained-panel-layout.md`
- 相关说明：`docs/terminal-performance.md`

## 当前问题

workspace 一失焦，`terminal-pane.tsx` 就把整个 `<TerminalEmulator/>` 从树上摘掉，切回时重新挂载。于是每次切换都要：新建 Terminal 实例与全部 addon、异步换装 WebGL renderer（cell 尺寸与 DOM renderer 不同，约 5% 列数差）、跑一遍 `FIT_TIMEOUT_DELAYS_MS`（0/16/48/120/250/500/1000/2000ms）的 fit 阶梯、重新订阅并重放 daemon 快照。

代价有三层：切换本身变慢、切回后有一段肉眼可见的尺寸落定过程、以及这正是 006 那个"渲染宽度与 PTY 宽度长期不一致"的土壤——006 已经用不变量把尺寸漂移兵束住，但产生漂移的重建过程没有消除。

RetainedPanel 在这条路径上其实已经在做正确的事（`display: none` 保留挂载），这道额外的门控绕过了它。

## 行为保持

- 必须保持的外部行为：切回后的终端内容、滚动位置、焦点与输入语义不变；隐藏期间不持有 daemon stream（`docs/terminal-performance.md` 的既有不变量）；未 claim 的 pane 不抢 PTY 尺寸。
- 兼容性边界：纯客户端改动，不涉及协议与 daemon。
- 不借重构顺手改变的行为：deck 的 3 个 workspace 上限、pane focus 语义、快照恢复路径。

## 现状如何工作

workspace 失焦 → `isWorkspaceFocused` 变 false → emulator 卸载（runtime `unmount()`，xterm dispose）→ 切回 → 重新挂载 → mount fit 阶梯 + WebGL 换装 + 重新 subscribe + 快照重放。日志证据：每个切换周期出现两次 `__byspaceTerminal` 赋值（unmount + mount）。

## 影响范围

- 必须修改：`packages/app/src/components/terminal-pane.tsx` 的渲染门控。
- 需要验证：隐藏期间不订阅（`terminal-retained-stream.spec.ts`）、失焦创建的终端不抢 claim（`terminal-stuck-size.spec.ts`）、被动 refit 仍到达 PTY（`terminal-passive-refit-claim.spec.ts`）。
- 仍待调查：这道门控在上游是否还承担别的职责（例如手机端布局或内存上限）；卸载消失后，隐藏 workspace 的 xterm 实例数量上限由 deck 的 3 个 workspace 约束是否足够。

## 上游归属

- `workspace-deck-retention.ts` 与 `upstream/main` 逐字节相同。
- 该渲染门控在上游 `terminal-pane.tsx` 同一位置存在，随 `bed137d6d Import Paseo v0.2.0-beta.1 source snapshot` 进入本仓库。
- 结论：这是上游行为，不是 BySpace 终端工作引入的；改动属于对上游行为的有意偏离，需要在 epic 里记明理由。

## 质量目标

- 性能效率 / 时间特性：
  - 目标：在保留挂载的 workspace 之间切换时，Terminal 不产生 renderer 重建，也不产生由重建引发的额外 PTY resize。
  - 来源：Terminal experience epic 的 Direct 热路径约束；用户对切回落定过程的主观反馈。
  - 预期证据：e2e 断言一次往返切换中 xterm 实例数不增加、PTY resize 次数为 0。
- 可靠性 / 无故障性：
  - 目标：不重建换来的状态复用不得引入陈旧画面或订阅泄漏。
  - 来源：既有 retained stream 不变量。
  - 预期证据：上述三个既有 e2e 保持通过。

## 待确认问题

- 是否顺带把 `terminal-emulator-runtime` 的 mount fit 阶梯收窄（不重挂载后它每个终端只跑一次，价值下降）。
