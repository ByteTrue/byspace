---
kind: issue
title: "重新订阅 Terminal 时按 revision 续传，不再重置回放"
type: feature
status: closed
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

## 实现

没有引入 revision 字段：**daemon 自己就知道给过这个客户端什么**。二进制 output 帧不携带 revision，要让客户端上报就得改热路径上的帧格式；而会话控制器只需记住自己发出的最后一个 revision（`deliveredRevisions`，跨 unsubscribe 保留，终端退出时清除）。

- `packages/server/src/terminal/terminal-output-backlog.ts`：有界回放缓冲（默认 100 万字符，最坏约 2 MiB/终端）。`since(revision)` 要么返回完整缺口，要么返回 null——**绝不返回残缺区间**。已淘汰、超前、无 revision 的情况都让它拒绝。
- 两侧都接入：`terminal.ts`（进程内）在 `writeOutputToHeadless` 追加；`worker-terminal-manager.ts`（worker 模式的父进程门面）在 `terminalMessage` 追加——worker 无论有无客户端都把输出推给父进程，所以父进程能直接服务缺口，不需新增 IPC 往返。
- 协议：`restore.resume?: boolean`。**没有新增 capability gate**：旧 daemon 不认识该键只会忽略并按 `mode` 回放（即今天的行为），客户端两种情况行为一致，再加一个没人读的 feature 位就是死代码。这也是用平级字段而不新增 `mode` 枚举值的原因：新枚举值会让旧 daemon 整条消息校验失败。
- **`resume` 是客户端的声明，不是 daemon 的记忆**：页面 reload 后 daemon 会话可能被 resume（`helloResumed`），但渲染器是全新空白的——只看 daemon 端“我给过你什么”会把新渲染器饵死。因此 pane 维护一个 resume 锚点（emulator 实例 + terminalId），两者都匹配才发 `resume: true`。这一条是 `terminal-clipboard.spec.ts` 的 reload 用例抳出来的，不是推想出来的。
- 客户端：`resolveTerminalRestoreOptions` 新增 `canResume` 入参；`terminal-pane.tsx` 的 `onOutput` **不再按 stream 活跃性丢帧**——退订时 daemon 已刷出的帧在它那边算"已送达"，客户端丢掉就会在续传点上留空洞。
- 背压溢出路径（`resolveRestoreAfterOutputOverflow`）会清掉 `resume`：那条路的目的是让落后的客户端跳过积压，续传恰好相反。

## 验证

- `terminal-output-backlog.test.ts` 7 例：正常缺口、已最新、未收到任何输出、淘汰后拒绝、单块超预算、无 revision、客户端声称超前。
- `terminal-session-controller.test.ts` 新增 3 例（用真的 `TerminalOutputBacklog`，不是手写桩答）：续传只发缺口且不发 restore 帧、缺口不可服务时回落快照、从未收过输出的客户端不续传。变异验证：关掉 resume 分支后第一例立即失败。
- `messages.terminal-restore.test.ts` 新增 2 例：`resume` 与 fallback mode 共存；未知 restore 字段不会让请求校验失败（旧 daemon 兼容性的依据）。
- `terminal-restore-options.test.ts` 4 例，包含“渲染器是新的就拿快照”。
- e2e `terminal-clipboard.spec.ts`（reload 后恢复 bracketed paste）先失败后通过，是它暴露了锚点缺失。
- e2e `terminal-restore-window.spec.ts` 改成续传口径：**实测 91ms、oldestRestored = line-1**（1500 行全保留），对比 013 的快照回放 195ms / 约 1043 行。
- 协议 + 服务端终端单测 94/94；typecheck / lint / format 全绿。
- 远端 CI（PR #18）抳出一条写错的断言：我把 `restoreMs < 150` 当成了回归门，runner 上实测 427ms（本地 91ms）。性能阈值不该做跨机器的 CI 门；真正的回归信号是 `oldestRestored === 1`——一旦退回快照回放，历史就会被截到约 line-500，它会先失败。时间改为只打日志。

## 待确认问题（已定）

- 缓冲上限：按终端 100 万字符，不做全局预算。超限从头部淘汰并记住"已丢到哪个 revision"，于是落后太多的客户端得到 null（回落快照）而不是残缺区间。
- daemon headless xterm 仍保持 1000 行：续传后它只影响"首次订阅/无法续传"的回落快照，不再是日常切换的历史上限，没有理由为此多占内存。

## 关闭回写

- epic：`.cs/epics/2026/07/21/terminal-experience/spec.md` 已记录续传为当前方案并勾掉本 issue。
- docs：`docs/terminal-performance.md` 新增"返回的客户端是续传而非重置"不变量（含两条容易被后人推翻的约束：客户端不得丢退订后到达的帧、溢出路径必须清 resume）。

## 关闭结论

- 可以关闭：三条质量目标均有证据——无缺口（区间单测 + 只能经续传到达的隐藏期标记）、不再随历史变贵（91ms < 195ms 且历史不截断）、新旧兼容（未知字段不失败的协议测试）。
- 顺手修正：013 把回放窗口改成 1000 行时漏跑了 `terminal-restore-options.test.ts`，该文件在 013 提交后一直是红的（仍断言 200 行）。本次一并修正并补上 resume 断言。教训：改常量后要跟着跑引用它的单测，而不只跑自己新写的那几个。
