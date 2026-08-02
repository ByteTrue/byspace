---
kind: issue
title: "切换 workspace 不再卸载重建 Terminal emulator"
type: refactor
status: closed
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

- 必须修改：**两道**门控。`packages/app/src/panels/terminal-panel.tsx` 在 `!isWorkspaceFocused` 时直接返回空 `View`（卸载整个 `TerminalPane`，连带 refs 与 stream controller）；`packages/app/src/components/terminal-pane.tsx` 里又有一道同语义的 `isWorkspaceFocused ? <TerminalEmulator/> : <View/>`。只去掉内层那道无效（实测仍多出 3 个 xterm 实例）。
- 需要验证：隐藏期间不订阅（`terminal-retained-stream.spec.ts`）、失焦创建的终端不抢 claim（`terminal-stuck-size.spec.ts`）、被动 refit 仍到达 PTY（`terminal-passive-refit-claim.spec.ts`）。

### 待调查项的结论

- **门控是否还有别的职责**：没有。流所有权跟的是 `isTerminalStreamActive = isWorkspaceFocused && isPaneVisible`，不是渲染；加载遮罩 `shouldShowTerminalLoadingOverlay` 仍然只在 workspace 聚焦时显示，只是因为 renderer 不再重建而不再闪一下。手机/紧凑布局走 `MobileMountedTabSlot`，只挂载访问过的 tab，不依赖这道门控。
- **实例数上限**：deck 的 `WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES = 3` × 每个 workspace 已访问过的 terminal tab。同一 workspace 内多个 terminal tab 共存本来就是现有行为，本改动只是把它从 1 个 workspace 扩到最多 3 个。xterm 的 WebGL context 丢失已有降级路径（`onContextLoss` → dispose → DOM renderer），超出浏览器 context 上限也不会崩，只是降级。不为此引入额外的 LRU 机制。

## 实现设计

### 这次要怎么做

删掉上述两道以 `isWorkspaceFocused` 为条件的渲染门控，让 `TerminalPane`/`TerminalEmulator` 随所在 workspace 的 RetainedPanel 一起保留挂载。不动订阅、claim、快照恢复与 deck 保留策略。

### 哪些边界不碰

- `isTerminalStreamActive` 的计算与含义（隐藏/失焦仍然不持流）。
- 006 定型的尺寸同步规则（`shouldSendTerminalResize`、attach 补发 measured、250ms 合并）。
- deck 的 3 workspace 上限、pane focus 语义、快照恢复路径。

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

## 关闭回写

- epic：`.cs/epics/2026/07/21/terminal-experience/spec.md` 已记 retained emulator 不再随 workspace 失焦卸载，并链入后续的 014。
- project spec：不单独毕业，随 epic 关闭统一合并。
- docs：`docs/terminal-performance.md` 新增三条不变量（emulator 跨 workspace 切换存活、文档滚动锁引用计数共享、快照回放跳过宽字符占位格）与一条容量记录（回放窗口就是用户能留住的历史，含实测数字）。

## 关闭结论

- 可以关闭：目标是“切回不重建 renderer、行为不变”，回归测试证明往返一次不新建 xterm、列数不变、不产生新尺寸；用户在 dev server 上逐项验收（切换流畅、中文不再撑开、历史明显变长）。
- 实际做了四件事：去掉两道 `isWorkspaceFocused` 渲染门控（上游行为）；修掉被它掩盖着的宽字符快照回放缺陷（grid 与 scrollback 两处）；把全局滚动锁改成引用计数共享（共存数上限从 1 个 workspace 扩到 3 个，不先修就会放大旧竞态）；把回放窗口对齐到 daemon 实际容量。
- 质量证据：性能效率——`terminal-workspace-switch-retention.spec.ts` 断言往返零新建实例、零新尺寸（修复前 1 → 4 个实例）；可靠性——retained-stream / stuck-size / passive-refit-claim / alternate-screen / clipboard 保持通过，浏览器用例覆盖非 LIFO 卸载的滚动锁，协议 + 真 PTY 用例覆盖宽字符（含滚入 scrollback 后）。所有新增用例均先写失败再修。
- 遗留：历史仍受 daemon 1000 行保有量与“每次切回重传”双重制约 → `.cs/issues/014-o-terminal-restore-resume-from-revision.md`。

## 待确认问题

- 是否顺带把 `terminal-emulator-runtime` 的 mount fit 阶梯收窄（不重挂载后它每个终端只跑一次，价值下降）。本次未动：它现在只影响首次挂载，改它没有可观察收益。

## 验证

- `npm run test:browser --workspace=@bytetrue/byspace-app -- src/terminal/runtime/terminal-emulator-runtime.browser.test.ts --bail=1`：35/35 通过；新增用例以非 LIFO 顺序卸载两个终端，断言滚动锁在最后一个卸载前不松、之后完全还原。**修复前失败**（`expected '' to be 'hidden'`）。
- 新增 `packages/app/e2e/terminal-workspace-switch-retention.spec.ts`：带 alt-screen TUI 的 workspace 往返一次，断言 xterm 实例数不增、列数不变、TUI 绘制宽度等于列数、客户端声明过的尺寸集合仍然只有一个。**修复前失败**（往返一次多出 3 个 xterm 实例：1 → 4），修复后通过。
- 回归：`terminal-passive-refit-claim`、`terminal-stuck-size`、`terminal-retained-stream`、`terminal-alternate-screen`、`terminal-split-resize`、`terminal-activity-indicators`、`terminal-protocol-query`、`workspace-terminal-tab-rename`、`terminal-clipboard` 逐个跑。
- `npm run typecheck` / `npm run lint` / `npm run format:check` 全绿。

## 执行记录

- 先只改了 `terminal-pane.tsx` 内层门控，回归测试显示往返仍多出 3 个 xterm 实例；用浏览器内临时埋点（TerminalPanel 渲染、TerminalPane 挂载/卸载、runtime.mount 堆栈）定位到真正卸载点在 `terminal-panel.tsx` 的外层门控，两道一起去掉后才真正保留。临时埋点已全部移除。
- 回归测试的断言从“往返后 resize 帧数不变”改为“**声明过的不同尺寸**不变且只有一个”：重新订阅时 attach 会幂等地重申同一尺寸（006 的有意行为，尺寸未变时 TIOCSWINSZ 不会发 SIGWINCH），把它当回归会把正确行为锁死。

## 被本改动揭开的旧 bug：快照回放把宽字符的占位格当成空格（已修）

- 现象：切 workspace 回来后，英文正常、**所有中文字符之间多出巨大空位**，点击不恢复，只有让应用自己重画（reload pi）才好。
- 根因：xterm 在双宽字符溢出的那一列保留一个零宽占位格，`extractCell` 对它取 `getChars() || " "` → 变成空格；回放时宽字符已经把光标推过两列，多写的空格把本行剩余内容每遇一个中文就右移一列。
- 为什么现在才看得见：以前每次切回都伴随尺寸抖动 → PTY resize → SIGWINCH → 应用整屏重画，把损伤盖掉了。本改动消除了抖动，就不再有重画来掩盖。
- 修法：daemon 对 `cell.getWidth() === 0` 的占位格发空 `char`（格子保留，所以列对齐与换行填充的算法不变）；`renderTerminalSnapshotToAnsi` 遇到空 `char` 不写任何字符。旧 daemon 仍发空格，客户端不猜不改（无法与真空格区分），保持旧行为。
- 第二处：`extractScrollback` 另有一份重复的单元格提取代码，所以修了 grid 后“当前屏正常、往上滚仍然撑开”。已改为复用 `extractCell`，删掉重复实现。
- 验证：`packages/protocol/src/terminal-snapshot.test.ts` 新增两例（新 daemon 跳过占位格、旧 daemon 的空格逐字节保留）；`packages/server/src/terminal/terminal.test.ts` 新增真 PTY 用例（`printf '中文ab'` 后快照回放仍是 `中文ab`，**并且在该行滚出可视区进入 scrollback 后再断言一次**）。所有用例在修复前均失败。

## 回放窗口提到 daemon 的实际容量（用户要求）

切回时客户端会 `ESC c` 全量重置再回放快照，所以**回放窗口就是用户能留住的全部历史**。原来客户端只请求 200 行、服务端上限 500 行，而 daemon 的 headless xterm 实际保有 1000 行——白白丢掉了已经存着的历史。现将两者都对齐到 1000。

实测（`packages/app/e2e/terminal-restore-window.spec.ts`，本地 Direct、headless、1500 行历史）：

| 窗口       | 切回耗时 | 最老恢复到 | 保留历史                        |
| ---------- | -------- | ---------- | ------------------------------- |
| 200（原）  | 105ms    | line-1257  | 约 243 行                       |
| 1000（现） | 195ms    | line-457   | 约 1043 行（daemon 全部保有量） |

代价是每次切回多约 90ms 的重传（该用例每行很短，回放文本约 10KB；真实内容会大得多，Relay 下还要加 RTT 与加密）。这是用传输成本换历史长度的权宜，天花板仍在；根治方案是 `.cs/issues/014-o-terminal-restore-resume-from-revision.md`（按 revision 续传，切回不重传也不截断），014 落地后可以把窗口调回小值。

## 顺手发现（用户要求一并修复）

- **已修：全局 `html`/`body` 滚动锁的所有权竞态。** `applyDocumentBoundsStyles` 原来每个 emulator 自己快照、自己还原，只在 LIFO 卸载下成立：两个终端共存时，先卸载的会把锁掤掉（另一个还需要），后卸载的又把“已含锁的快照”写回去，页面永久停在 `overflow: hidden`。现在改为引用计数的共享锁（第一个挂载时上锁、最后一个卸载时还原），并且 root 容器路径不再接管 `html`/`body`，避免同一批样式两个生命期不同的主人。本改动把共存上限从 1 个 workspace 扩到 3 个，不先修它就会把这个竞态放大。
- **已单独修复（`.cs/issues/015-x-service-proxy-websocket-upgrade-stolen-by-daemon-socket.md`，根因不是 header 而是 `ws` 抢答 400）：服务代理下的 dev server 整页重载循环。** 用户经 `app--….localhost:6777` 访问 Expo dev server 时页面每 ~400ms 重载一次。只读复现对比：直连 Metro（`localhost:50876`）12s 内 4 次导航、无异常；走代理 28 次导航，并反复报 `ws://…/hot`、`ws://…/message` 握手 400 —— Metro 的 HMR 与消息通道升级失败，Expo dev client 以整页重载重试。daemon 以 `passthroughUnknown: true` 注册了 upgrade handler，所以 WS 升级总体支持，最可能是 upgrade 路径与 HTTP 路径的 header 组装（尤其 `Host`）不一致。与本 issue 无关。
- **已消失：启动阶段的一次性 xterm 实例。** 那 1–2 个实例同样是两道门控造成的；两道删除后回归测试里启动只构造 1 个实例，无需单独处理。
