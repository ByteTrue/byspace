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
3. 将 GitHub Actions 隔离 shard 从 4 增至 8。每个 shard 仍使用独立 runner 和独立 daemon/relay/Metro，runner 内保持串行。
4. 观察至少 5 次成功 run；如单个 shard 仍因大 spec 明显偏长，只拆分证据指出的少数大文件。不得引入按历史数据动态生成的自定义 scheduler。
5. 记录总 runner minutes 与墙钟时间，确认增加隔离栈的成本在预计约 10%～15% 范围；若显著超出，先查重复 setup，而不是退回减少测试。

## 质量承诺

- 可靠性：现有场景、断言、retry 上限、trace/screenshot 失败证据不减少；启动 readiness 必须确定、可重复。
- 性能效率：目标是 Playwright 最长 job 约 9～11 分钟，并使完整 CI 至少 5 次成功样本的 runner 执行中位数不高于 11 分钟。该数值用于评估方案，不写成单次跨机器硬 gate。
- 可维护性：只使用 Playwright/GitHub Actions 现有 sharding 和必要的 spec 拆分；不建立新的测试编排基础设施。
- 成本：接受有限额外 runner setup 换墙钟时间，但所有 runner minutes 与排队时间必须在验收证据中显式列出。

## 验证

- 两个已知首轮失败场景在隔离重复运行中首次通过；修复能在 readiness 回归时确定失败。
- 完整 8-shard Playwright CI 全绿，测试总数与原完整集合一致。
- 至少 5 次成功 run 记录每个 shard 的 started/completed、测试数、retry 数和 runner minutes；queue time 单列。
- 完整仓库 typecheck、lint、format 与 App Web export 通过。
- 没有启用 `fullyParallel`、提高 runner 内 `workers`、跳过文件或按改动路径裁剪场景。

## 关闭时

- 回写候选：Epic spec 中写入最终 shard 数、startup root cause、CI 中位数和 runner 成本。
- 关闭判断：启动型 flake 根因已修、全量场景稳定、至少 5 次样本达到已确认时间目标。
- 遗留：若 GitHub 外部排队仍主导用户等待，只保留为独立运营证据；没有自托管 runner 的授权。
