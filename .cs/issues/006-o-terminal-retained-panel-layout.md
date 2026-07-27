---
kind: issue
title: "修复 Terminal 切换后的首帧布局失真"
type: bug
status: open
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

- 根因链：RetainedPanel 用 `display: none` 保留 xterm → 切换时 focus/resize effect 与浏览器布局恢复存在时序窗口 → `fitAndEmitResize` 看到零尺寸后直接返回 → 没有后续显式重试 → renderer 保留旧几何，直到点击/输入再次请求 reflow。
- 证据：`terminal-emulator-runtime.ts` 的零尺寸 guard；`terminal-emulator.tsx` 的 focus/resize token 原先仅同步调用一次 `resize()`；点击路径会再次增加 resize token。
- 影响面：桌面/紧凑布局中所有保留挂载的 Terminal；不涉及 daemon Terminal 数据流。

## 修复方案

在 runtime 增加 `resizeAfterLayout()`：立即尝试一次，并在下一动画帧重试。若立即 fit 成功，重试关闭 `force` 以复用尺寸去重；若立即 fit 因零尺寸失败，重试保留原参数，确保显式 PTY claim 不会被并发 passive refit 吞掉。显式 focus/resize token 和浏览器可见性恢复统一走这条路径。保留现有零尺寸 guard；不新增定时轮询，也不改 PTY claim 规则。

## 验证

- `npm run test:browser --workspace=@bytetrue/byspace-app -- src/terminal/runtime/terminal-emulator-runtime.browser.test.ts --bail=1`：34/34 通过；新增用例在禁用 `ResizeObserver` 后覆盖隐藏阶段请求 resize、恢复可见后下一帧自动采用新列数，确认可见状态下立即 fit 成功时只产生一次 PTY claim，并覆盖 hidden passive refit 排在显式 claim 前时仍保留一次 claim。
- `npx vitest run packages/app/src/terminal/runtime/terminal-emulator-runtime.test.ts --bail=1`：17/17 通过。
- `npm run test:e2e --workspace=@bytetrue/byspace-app -- terminal-stuck-size.spec.ts --workers=1`：1/1 通过；确认第二次 frame retry 未破坏真实 daemon/PTTY 的 focus size claim 与去重。
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

## 关闭回写

- epic：完成后在 Terminal experience 当前推进中记录 retained-panel 首帧布局约束。
- project spec：本 issue 不单独毕业，随 epic 关闭统一合并。
- docs：在 `docs/terminal-performance.md` 记录可见性切换的 resize 时序不变量。

## 关闭结论

- 待完成验证后填写。
