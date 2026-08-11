---
kind: issue
title: "压缩 Playwright CI 关键路径"
type: refactor
status: open
created: 2026-08-11
---

# 压缩 Playwright CI 关键路径

## 做成以后是什么样

完整 Playwright 场景仍在每个 `main` exact-SHA CI 中执行，但隔离 shard 更均衡，首轮启动不再靠 retry 才通过，最长 Playwright job 不再把完整 CI 拉到 15～19 分钟。

**范围：** 当前 Desktop Chrome CI 场景的启动可靠性、shard 数、少数大 spec 的边界和耗时证据。**不包含：** 删除场景、path-based selective CI、真实 Provider `.real.spec.ts`、同一 daemon 栈内并发、自定义调度平台或产品代码性能优化。

## 当前证据

成功 GitHub Actions run `31417319455` 的四个 Playwright 测试阶段：

- shard 1/4：80 passed，约 16 分 24 秒
- shard 2/4：70 passed，约 11 分 30 秒
- shard 3/4：76 passed，约 12 分 24 秒
- shard 4/4：75 passed，约 14 分钟

总测试计算量约 54 分钟，最长 shard 比最短高约 43%。当前配置为 `workers: 1`、`fullyParallel: false`，因为每个 runner 内的测试共享 daemon/relay/Metro 栈；这个约束仍然成立。

同一 run 有两个明显 retry 税：

- `00-sessions-empty.spec.ts` 首轮约 72 秒失败，retry 约 7.7 秒通过。
- `subagent-detach.spec.ts` 首轮约 72 秒失败，retry 约 8 秒通过。

还存在约 72～90 秒才通过的首批用例，需要确认是场景本身有意等待，还是 global setup/readiness 没有建立确定边界。不能把增加 retry 或放宽 timeout 当修复。

## 推进顺序

1. 用失败 trace/log 和最小重复运行定位两个首轮失败及异常慢首用例的共同启动边界；如果根因位于 global setup/readiness，在共享入口修一次，而不是逐测试加等待。
2. 保留失败重试用于真实偶发环境抖动，但让已知首轮场景在正常启动后首次通过。
3. 先将 GitHub Actions 隔离 shard 从 4 增至 8；若真实最长 job 仍超过目标，优先继续使用原生静态 shard 数收敛，不打开 `fullyParallel` 或建立自定义 scheduler。每个 shard 仍使用独立 runner 和独立 daemon/relay/Metro，runner 内保持串行。
4. 观察至少 5 次成功 run；如增加原生 shard 后仍因大 spec 明显偏长，只拆分证据指出的少数大文件。
5. 记录总 runner minutes 与墙钟时间；初始 10%～15% 是估算而非隐藏硬上限，实测偏差必须显式报告并由缩短的墙钟时间解释。

## 执行进展

exact-SHA `9be5ae8f6` 的 CI run `31480047406` 暴露了两个可分离问题：

- `00-sessions-empty.spec.ts` 首次尝试中，`page.goto("/")` 等待冷 Metro bundle 约 63 秒，已经耗尽默认 60 秒测试预算；业务断言实际只获得不到 1 秒，retry 在热 bundle 下约 8 秒通过。global setup 现在会在进入测试预算前请求并完整读取入口 bundle，TCP 监听不再被误当成 Web readiness。
- `agent-stream-ui.spec.ts` 的共享滚动 helper 原先可能把滚轮交给嵌套 tool scroller；首轮修复改为直接滚动主 viewport。10-shard 实测进一步证明 `readScrollMetrics()` 仍会从所有后代中选最大可滚元素，可能用 tool scroller 通过“可滚动”门、随后却滚动主 viewport。现在指标、readiness、滚动与断言统一只读取 `data-testid="agent-chat-scroll"` 这个真实 Web stream scroll owner。

验证与成本模型：

- 本地定向运行中，`00-sessions-empty.spec.ts` 首次尝试通过，global setup 显式记录 bundle warmup，测试本体约 2 秒；`agent-stream-ui.spec.ts -g "places stream controls"` 首次尝试通过，约 25 秒。
- exact-SHA `1149b75a9` 的 run `31482108162` 完整全绿：303 passed、19 skipped，没有 flaky/retry 汇总；四个 Playwright test step 为 15:10、11:22、11:37、14:07，总测试计算量 52:16。
- 每个 runner 在 Playwright 前的 setup 约 1:41～1:55。由 4 增至 8 shard 的理想模型原本预计把最长 job 压到约 9～11 分钟，并把总 runner minutes 从约 59 增至约 66。
- 历史 `subagent-detach.spec.ts` retry 在后续两次 exact-SHA run 中未复现，不新增等待或 timeout。
- exact-SHA `d78c0b9e9` 的四个旧 4-shard job 都通过，但 shard 4 捕获到 `tool-call-shimmer.spec.ts` 首轮 18.1 秒找不到 group、retry 8.8 秒通过。该测试在 agent route 只有 URL settle、composer 尚未确认挂载时就从 seed client 发送实时 turn；现已复用共享 `expectComposerVisible` readiness，再发送 turn。本地该 spec `--repeat-each=10` 为 10/10 首轮通过、无 retry。
- exact-SHA `c2e5aa66f` 首次真实 8-shard 执行保持 322 个场景且 8/8 Playwright job 全绿、无 retry，但最长 shard 1 为 12:36；8 个 job 合计约 69 runner-minutes，比 4-shard 绿色基线约 59.7 分钟增加约 15.6%。8 shard 没达到 9～11 分钟目标。
- 继续使用 Playwright 原生静态 sharding 的 10-shard 候选已在本地枚举同一 322 场景且无遗漏/重复；它不改变 `workers: 1`、`fullyParallel: false` 或场景集合，exact-SHA CI 将验证最长 job 与实测成本。
- exact-SHA `348efeae0` 的 run `31489371511` 首次执行 10/10 Playwright job 全部通过，最长 shard 1 为 11:08；10 个 job 合计约 79.2 runner-minutes，比 4-shard 绿色基线约 59.7 分钟增加约 32.6%，高于初始成本估算。场景汇总为 302 passed、19 skipped、1 flaky（flaky 重试后通过），总计仍为 322。
- 唯一 flaky 正是 `agent-stream-ui.spec.ts` 的 scroll-owner 不一致：readiness 被嵌套 tool scroller 满足，主 viewport 的 `scrollTop` 仍为 0。统一到真实 scroll owner 后，该场景本地单次通过且 `--repeat-each=3` 为 3/3 首轮通过；下一次 exact-SHA CI 继续验证。
- 同一 run 的 workflow 最终由独立的 Ubuntu server-test stdin `EPIPE` 阻断，记录在 Issue 004；因此它是有效的 Playwright 性能样本，但不计入“成功完整 CI”五次验收样本。
- exact-SHA `39247795a` 的 run `31491465489` 再次让 10/10 Playwright job 全绿；303 passed、19 skipped、0 flaky/retry，证明 scroll-owner 修复生效。最长 shard 1 仍为 11:08，说明稳定关键路径不是 retry，而是静态 shard 1 同时承载 `agent-stream-ui`、`archive-tab` 与 `assistant-fork-menu`。该 workflow 由独立的 Windows Codex resume 测试 500ms 启动竞态阻断（Issue 005），仍不计入完整成功样本。
- 原生 11-shard 对 shard 1 的 33 个场景分配与 10-shard 完全相同，不能缩短关键路径；不采用。12-shard 将该组减为 28 个场景。按 `31491465489` 的逐场景实测时长回放，12 个 shard 的最大测试负载约 6.88 分钟，加上已测 global setup/job setup 后预计最长 job 约 10.2 分钟。
- 12-shard 本地枚举仍为同一 322 场景，0 重复、0 遗漏；预计比 10-shard 再增加约两个 runner setup，exact-SHA CI 将记录实际墙钟与总 runner-minutes。

## 质量承诺

- 可靠性：现有场景、断言、retry 上限、trace/screenshot 失败证据不减少；启动 readiness 必须确定、可重复。
- 性能效率：目标是 Playwright 最长 job 约 9～11 分钟，并使完整 CI 至少 5 次成功样本的 runner 执行中位数不高于 11 分钟。该数值用于评估方案，不写成单次跨机器硬 gate。
- 可维护性：只使用 Playwright/GitHub Actions 现有 sharding 和必要的 spec 拆分；不建立新的测试编排基础设施。
- 成本：接受有限额外 runner setup 换墙钟时间，但所有 runner minutes 与排队时间必须在验收证据中显式列出。

## 验证

- 两个已知首轮失败场景在隔离重复运行中首次通过；修复能在 readiness 回归时确定失败。
- 完整 12-shard Playwright CI 全绿，测试总数与原完整集合一致。
- 至少 5 次成功 run 记录每个 shard 的 started/completed、测试数、retry 数和 runner minutes；queue time 单列。
- 完整仓库 typecheck、lint、format 与 App Web export 通过。
- 没有启用 `fullyParallel`、提高 runner 内 `workers`、跳过文件或按改动路径裁剪场景。

## 关闭时

- 回写候选：Epic spec 中写入最终 shard 数、startup root cause、CI 中位数和 runner 成本。
- 关闭判断：启动型 flake 根因已修、全量场景稳定、至少 5 次样本达到已确认时间目标。
- 遗留：若 GitHub 外部排队仍主导用户等待，只保留为独立运营证据；没有自托管 runner 的授权。
