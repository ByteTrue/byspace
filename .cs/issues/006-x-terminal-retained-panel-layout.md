---
kind: issue
title: "修复 Terminal 切换后的首帧布局失真"
type: bug
status: closed
created: 2026-07-27
epic: ".cs/epics/2026/07/21/terminal-experience/spec.md"
---

# 修复 Terminal 切换后的首帧布局失真

## 目标

从其他保留面板切换到 Terminal 时，首帧就按当前容器宽度正确排版，不出现字符横向拉伸或右侧空白，也不需要点击或输入才能恢复。

## 归属

- 隶属 epic：`.cs/epics/2026/07/21/terminal-experience/spec.md`
- 相关说明：`docs/terminal-performance.md`

## 当前证据

- 预期行为：Terminal 显示时立即以当前可见区域完成 fit 和重绘。
- 实际行为：切换后的初始画面偶尔沿用隐藏前的 renderer 几何；字符间距被拉大或右侧留白，点击/输入触发下一次 reflow 后恢复。
- 最小场景：保留挂载的 Terminal 从 `display: none` 恢复可见，显式 resize 恰好发生在容器仍不可测量的时刻。
- 原始证据：用户提供正常/异常对比截图；runtime 在 `offsetWidth/offsetHeight === 0` 时会跳过 fit，而 tab 切换的显式 reflow 此前只尝试一次。

### 第二轮证据（2026-08-02，首轮修复后仍复现）

- 用户复现路径收敛为：**切到别的 workspace 再切回来，必现**；右侧空约 6%。
- 浏览器内读数（点击前 / 点击后完全一致）：`cols=105, cellWidth=8, screenWidth=840, rootWidth=853` → **渲染器几何一直是对的**，首轮那条"renderer 保留旧几何"的假设被证伪。
- 线上报文探针（用户真实 Chrome，patch `WebSocket.send` + `terminal.onResize`）：

  ```text
  xterm-resize 107x57 → 106x57 → subscribe restore.size=null
  → 107x57 → 106x57 → 107x57 → 112x57
  → resize-sent 106x57          # attach 用 lastSent 补发的旧值
  → (用户点击) resize-sent 112x57  # 才纠正
  ```

  即 xterm 停在 112 列、PTY 停在 106 列：应用只画 106 列，右侧空 6 列 ≈ 5.4%，与截图吻合。

- 本地 headless 无法复现（三轮 e2e：切 tab、隐藏期改窗宽、alt-screen TUI、切 workspace 全绿），因为 headless Chromium 不发生 WebGL renderer 的 cell 尺寸切换。

## UI 实际与预期

```text
实际：┌─ Terminal（旧几何，被横向拉伸）────────┐░░右侧空白░░│
预期：┌─ Terminal（按当前容器完整 fit）────────────────────┐
```

- 关键差异：切换首帧的 xterm renderer 几何是否与当前容器一致。
- 稳定约束：不改变 Terminal 内容、字体设置、PTY 所有权或输入语义。
- 仅作示意：空白宽度和字符拉伸比例不构成固定像素要求。

## 质量目标

- 可靠性 / 无故障性：
  - 目标：保留面板恢复可见时，即使第一次 resize 发生于零尺寸布局阶段，也会在下一动画帧自动完成有效 resize。
  - 来源：用户报告与 Terminal experience epic。
  - 预期证据：真实浏览器回归测试覆盖“隐藏时请求 resize、下一帧恢复可测量”。
- 性能效率 / 时间特性：
  - 目标：只在已有显式 reflow 请求上增加一次下一帧重试，不引入轮询、持续 observer 或额外 renderer。
  - 来源：Terminal experience epic 的 Direct 热路径约束。
  - 预期证据：实现仅复用现有 fit，并由 resize 去重阻止重复 PTY resize。

## 根因定位

首轮定位（renderer 保留旧几何）已被第二轮读数证伪，真实根因如下。

- 根因链：pane 首次 claim 后，**被动 refit（`shouldClaim: false`）只更新 `measuredTerminalSizeRef`，从不发给 daemon**。mount 后的 fit 阶梯、字体度量落定、WebGL renderer 换装（cell 尺寸与 DOM renderer 不同，约 5% 列数差）、可见性恢复都走这条路径，于是 xterm 宽到 112 列而 PTY 停在 106 列 → 应用按 106 列绘制 → 右侧空一条，直到点击清空去重并重新 claim。
- 次因：`TerminalStreamController` attach 成功后用 `getPreferredSize()`（原为 `lastSentTerminalSizeRef`）补发一次 resize。subscribe 响应是异步的，落地时那些被动 refit 往往已经跑完，于是这条"最后落地"的报文反而把 PTY 钉回旧值。
- 为什么切 workspace 必现：切回时 emulator 会重挂载（日志中每周期两次 `xterm-mounted`），mount 阶梯 + WebGL 换装必然在 claim 之后再次改变列数；而 pane 自身未重挂载，`lastSentTerminalSizeRef` 跨周期保留，attach 补发的正是上一周期的旧值。
- `shouldClaim` 的语义被过度解读：它的目的只是"不要从别的客户端手里抢 PTF 所有权"，不应该等同于"不要告诉 daemon 我现在多宽"。
- 影响面：所有 Terminal pane（不限于 retained 切换）；不涉及 daemon 侧数据流与 PTY 所有权规则。

## 修复方案

第一轮（已在树上）：runtime 的 `resizeAfterLayout()` 立即 fit + 下一帧重试。保留，它解决的是零尺寸时序，不是本 issue 的主因。

第二轮（本次）：

1. 新增纯函数 `shouldSendTerminalResize({ shouldClaim, hasClaimedSize })`（`terminal-pane-focus-claim.ts`）：本客户端**尚未** claim 过尺寸时，被动 refit 保持静默（不抢 PTY）；一旦 claim 过，任何测到的新尺寸都必须发出去。`handleTerminalResize` 用它替换原来的 `if (!input.shouldClaim) return`。
2. 被动 refit 的发送过一层 250ms 尾部合并（`PASSIVE_TERMINAL_RESIZE_COALESCE_MS`），只发落定值；用户驱动的 claim（focus/点击/reflow token/拖拽/改窗宽，均为 `shouldClaim: true`）仍然立即发送。原因：上游在 workspace 失焦时会卸载整个 emulator（`terminal-pane.tsx` 的 `isWorkspaceFocused ? <TerminalEmulator/> : <View/>`），每次切回都会重跑 fit 阶梯 + WebGL 换装，不合并就是 2–3 次 PTY resize 与整屏重绘，Relay 下代价明显。
3. `getPreferredSize` 改为返回 `measuredTerminalSizeRef.current ?? lastSentTerminalSizeRef.current`，让 attach 补发的是渲染器当前真实几何，而不是可能已经过时的"上次发出值"。

不轮询、不新增 observer、不改 daemon、不改 PTY 所有权规则（未 claim 的隐藏或失焦 pane 仍然发不出 resize）。唯一新增的定时器是上述尾部合并窗口，有明确上限且只作用于非交互路径。

### 已查清的上游归属

- `packages/app/src/screens/workspace/workspace-deck-retention.ts`（最多挂载 3 个 workspace）与 `upstream/main` 逐字节相同。
- workspace 失焦即卸载 emulator 的门控在上游 `terminal-pane.tsx` 同位置存在，随 `bed137d6d Import Paseo v0.2.0-beta.1 source snapshot` 进入本仓库。
- 结论：重挂载是上游行为，不是 BySpace 终端性能工作引入的；取消重挂载属于另一个（更大的）切换性能话题，不在本 issue 范围。

## 验证

第二轮：

- 新增 `packages/app/e2e/terminal-passive-refit-claim.spec.ts`：alt-screen TUI 每次 SIGWINCH 重画整宽标尺；失焦 → 改窗宽（claim 被 `isAppVisible` 丢弃）→ 重新聚焦（只剩被动 refit 路径）。**修复前失败**（`ruler=112` vs `cols=150`，与用户截图同形），修复后通过。
- `npx vitest run packages/app/src/components/terminal-pane-focus-claim.test.ts`：9/9 通过（含两条新用例：未 claim 前被动 refit 不发、已 claim 后必发）。
- `npm run test:e2e --workspace=@bytetrue/byspace-app -- terminal-stuck-size.spec.ts terminal-retained-stream.spec.ts --workers=1`：2/2 通过（失焦创建的终端仍然不抢 claim；retained 订阅语义未变）。中途 `terminal-stuck-size` 捕获到首版 attach 改得过宽（未 claim 过的 pane 会在失焦时抢 PTY），已收紧为“仅已 claim 时补发”。
- 加入 250ms 合并后重跑：passive-refit / stuck-size / retained-stream 均通过；交互路径（ResizeObserver、window resize、focus token）均为 `shouldClaim: true`，不经过定时器，延迟不变。
- 用户在 dev server 上人工验证：切 workspace 再切回不再出现右侧留白。

第一轮（保留记录）：

- `npm run test:browser --workspace=@bytetrue/byspace-app -- src/terminal/runtime/terminal-emulator-runtime.browser.test.ts --bail=1`：34/34 通过。
- `npx vitest run packages/app/src/terminal/runtime/terminal-emulator-runtime.test.ts --bail=1`：17/17 通过。
- `npm run test:e2e --workspace=@bytetrue/byspace-app -- terminal-stuck-size.spec.ts --workers=1`：1/1 通过。
- `npm run typecheck`：全 workspace 通过。
- `npm run lint`：0 warnings / 0 errors。
- `npm run build:web --workspace=@bytetrue/byspace-app`：Expo Web export 成功。
- `npm run format:files -- ...`：相关 6 个文件已格式化。

## 执行记录

- 先加入 retained-panel 回归用例，旧实现因缺少 `resizeAfterLayout` 按预期失败。
- runtime 统一立即 + 下一帧 resize；立即 fit 成功时下一帧关闭 `force`，由既有尺寸去重阻止第二次 PTY claim；立即 fit 失败时保留原 `force`，避免并发 passive refit 吞掉显式 claim。RAF 同时绑定当前 terminal 实例，避免跨 unmount/remount 命中新实例。
- 首轮独立 reviewer 发现初版会重复 forced claim；已先加入能稳定复现两次 claim 的失败用例，再修正并验证。
- PR code reviewer 随后发现 hidden passive/claiming RAF 竞争；已加入稳定复现 claim 丢失的失败用例，再让 `resize()` 返回 fit 是否成功并据此决定重试参数，browser tests 最终 34/34 通过。
- `docs/terminal-performance.md` 已记录 retained-panel 可见性恢复的 refit 时序不变量；parent epic 已链接本 issue。
- 实现与自动验证已完成；issue 保持 open，等待用户在原始切换路径 headed 验收后再关闭。
- 第二轮：首轮修复上线后用户仍复现，且给出精确路径（切 workspace）。本地三轮 e2e 均无法复现 → 改为在用户真实浏览器里取证（几何读数 + 报文探针），据此推翻首轮根因并定位到被动 refit 不上报 + attach 补发旧值。
- 第二轮先写出能稳定失败的 e2e（被动 refit 路径），再改代码；`docs/terminal-performance.md` 增补"被动 refit 也必须到达 PTY"的不变量。

## 关闭回写

- epic：已在 `.cs/epics/2026/07/21/terminal-experience/spec.md` 的当前方案与 Issues 记录尺寸同步不变量。
- project spec：本 issue 不单独毕业，随 epic 关闭统一合并。
- docs：`docs/terminal-performance.md` 已记录三条不变量（显式 refit 下一帧重试、被动 refit 仍须到达 PTY、被动发送合并而交互路径不合并）。

## 关闭结论

- 可以关闭：目标是“切换回来就是正确宽度，不需点击”，用户已在 dev server 人工验证切 workspace 往返不再出现右侧留白；范围未扩大到 daemon 侧或 PTY 所有权规则。
- 质量证据：可靠性——`terminal-passive-refit-claim.spec.ts` 修复前稳定失败（`ruler=112` vs `cols=150`）、修复后通过，`terminal-stuck-size` 保护“未 claim 不抢 PTY”边界（它真的拦下了首版过宽的 attach 改动）；性能效率——被动发送合并为 250ms 尾部窗口，一次重挂载只产生一次 PTY resize，交互路径（`shouldClaim: true`）延迟不变。
- 方法论教训：首轮根因是在无法复现的情况下推断的，结果错了。本轮先在用户环境取得几何读数与线上报文日志，才反推出“被动 refit 不上报”，再写出稳定失败的 e2e。headless 不发生 WebGL cell 尺寸切换，这类 bug 必须靠浏览器内探针取证。
- 遗留：上游在 workspace 失焦时卸载整个 emulator，每次切回重跑 mount 阶梯与 WebGL 换装——已确认为上游行为，属于切换性能话题，另开 issue 跟进，不藏在本结论里。
