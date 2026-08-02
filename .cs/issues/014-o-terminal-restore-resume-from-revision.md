---
kind: issue
title: "重新订阅 Terminal 时按 revision 续传，不再重置回放"
type: feature
status: open
created: 2026-08-02
epic: ".cs/epics/2026/07/21/terminal-experience/spec.md"
---

# 重新订阅 Terminal 时按 revision 续传，不再重置回放

## 目标

隐藏后重新可见的 Terminal 不再丢历史：客户端保留自己已有的滚动缓冲（默认 10,000 行），daemon 只补发它错过的那段输出。切回时不重置渲染器、不重传已有内容，也不再有"只剩最近 N 行"的截断。

## 范围

- 包含：`subscribe_terminal_request` 的续传字段与 capability gate、daemon 侧有界输出缓冲与区间补发、客户端记录并上报最后应用的 revision、无法续传时回落到现有快照路径。
- 不包含：daemon headless xterm 的 1000 行上限（那是快照路径的容量，不是续传路径的）。
- 不包含：多客户端下谁拥有 PTY 尺寸的规则（见 `006-x`）。

## 归属

- 隶属 epic：`.cs/epics/2026/07/21/terminal-experience/spec.md`
- 前序：`.cs/issues/013-o-terminal-emulator-remount-on-workspace-switch.md`（本 issue 的动因与实测数据在其中）
- 相关说明：`docs/terminal-performance.md`

## 背景与证据

- 隐藏的 Terminal 会退订（"只有可见的 retained tab 才持有 stream"），重新可见时客户端 `ESC c` 全量重置再回放 daemon 快照，所以**回放窗口就是用户能留住的全部历史**。
- 实测（本地 Direct、headless、终端里有 1500 行历史，`packages/app/e2e/terminal-restore-window.spec.ts`）：
  - 窗口 200 行：切回耗时 105ms，最老只剩到 line-1257（约 243 行）
  - 窗口 1000 行：切回耗时 195ms，最老到 line-457（约 1043 行，即 daemon 的全部保有量），回放文本约 10KB（该用例每行很短，真实内容会大得多）
- 013 已把窗口提到 daemon 的实际容量 1000 行，这是用**每次切回的重传成本**换历史长度，天花板仍在。
- 用户诉求：`pi -c` 恢复的会话历史很长，切一次 workspace 就被截断，"翻会话历史都不方便"。

## 现状如何工作

隐藏 → `unsubscribe_terminal_request`，daemon 丢弃该客户端的输出（headless xterm 仍在消费）→ 重新可见 → `subscribe_terminal_request` 带 `restore: { mode: "visible-snapshot", scrollbackLines }` → daemon 取快照渲染成 ANSI → 客户端 reset + 回放。输出帧本来就带 revision，`emitRevision`/`snapshotRevision` 已经是同一序列里的两个游标。

## 影响范围

- 必须修改：`packages/protocol/src/messages.ts`（订阅请求 + `server_info.features`）、`packages/server/src/terminal/terminal.ts`（输出缓冲）、`packages/server/src/terminal/terminal-session-controller.ts`（订阅时的续传分支）、`packages/app/src/terminal/runtime/terminal-stream-controller.ts` 与 `terminal-restore-options.ts`。
- 需要验证：既有恢复路径（慢客户端溢出 → 强制快照）、alt-screen 应用、多客户端同时订阅、旧客户端/旧 daemon 组合。
- 仍待调查：缓冲大小取值（按字节还是按 revision 数）；与 `resolveRestoreAfterOutputOverflow` 的关系；relay 下补发大段输出的背压表现。

## 质量目标

- 可靠性 / 可恢复性：
  - 目标：续传不得产生缺口、重复或错位；请求的 revision 已滚出缓冲时必须**明确回落**到权威快照，而不是发一段残缺输出。
  - 来源：epic 的"Direct 与 Relay 都不得丢字符、重复、乱序"约束。
  - 预期证据：区间逻辑单测（含边界与已过期）、"切走 → 期间大量输出 → 切回"的 e2e 对比 daemon 权威内容。
- 性能效率 / 时间特性：
  - 目标：切回不再随历史长度线性变贵；常见情况下补发字节数接近隐藏期间的真实产出。
  - 来源：013 的实测基线（195ms / 1000 行窗口）。
  - 预期证据：`terminal-restore-window.spec.ts` 的同一测量，续传后应显著低于 195ms 且历史不再截断。
- 兼容性 / 互操作性：
  - 目标：新字段可选、旧 daemon 与旧客户端行为不变；能力检测集中在一处 `server_info.features`。
  - 来源：BySpace 协议契约。
  - 预期证据：新旧组合的解析与行为测试。

## 待确认问题

- 缓冲上限取多少（2MB？按终端还是全局预算？）以及超限后的丢弃策略。
- 是否顺带提高 daemon headless xterm 的 1000 行上限——它决定回落快照能给多少历史，与续传是两件事。
