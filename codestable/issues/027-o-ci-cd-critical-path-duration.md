---
kind: issue
title: "CI/CD 关键路径耗时优化"
type: chore
status: open
created: 2026-09-14
---

# CI/CD 关键路径耗时优化

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。

---

## 做成以后是什么样

发布关键路径（push HEAD → exact-SHA CI 绿 → tag 发布）从 ~39 分钟降到 ~25 分钟以内；Windows flaky 最大源消除；Docker PR 构建从 10–16 分钟回到缓存命中后的 ~3 分钟。

**范围：** 包含 playwright 分片扩容、Windows server-tests 的 file-observer 千并发测试瘦身、Docker buildx PR 缓存修复；不包含 exact-SHA CI 门禁（安全设计，保留）、Publish npm / Deploy App 流程（发布后并行，不阻塞）、playwright 测试本身的用例级优化。

## 为什么现在做 / 当前坏在哪

v0.14.0 发布（2026-09-14）暴露的耗时数据（40 个 run 的逐 job 实测）：

1. **CI 总时长 ≈ 39 分钟，由 playwright 4 shards 决定**（17–24 分钟/片）。固定开销（build:server ~5m + browsers ~1.5m）之外，每片 ~155 个测试在 2 worker 上跑 ~17 分钟。发布者在 exact-SHA CI 绿之前无法推 tag，这 39 分钟是纯等待。
2. **server-tests windows 11–14 分钟**（ubuntu 同套件 4–8 分钟）。file-observer 千并发写入测试是最大慢源，且是已知的 Windows runner flaky 源（PR #34 期间与 v0.14.0 发布期间各出现一次，重跑即过）。
3. **Docker build 在 PR/main 上 10–16 分钟，tag 上仅 2m35s**。tag 命中缓存证明缓存链路可用，PR 路径近乎全 miss，缓存 key 策略有问题。
4. 一次性异常（已修，不立项范围）：退役 shim 的三个 bug（WindowChromeSafeArea 吞布局、owns-corner 恒 false、PairDeviceModal 误杀）造成 588 个 e2e 失败，两轮 CI 各烧 90+ 分钟超时×retry。这是失败循环的成本，不是 pipeline 设计问题。

## 现状怎么工作

- CI（`.github/workflows/ci.yml`）：`changes` job 按路径过滤 → 各测试 job 并行（playwright 4 shards / server-tests 双平台 / cli 3 shards / app / sdk / relay / release-package）。merge queue 与 full run 走全量。playwright 的 shard 由 `PLAYWRIGHT_SHARD` env + `--shard=N/4` 表达，`E2E_WORKERS` CI 默认 2。
- Windows file-observer 千并发测试：`packages/server/src/server/file-observer/index.test.ts` 中 "observes a thousand concurrent writes…"，双平台都跑。
- Docker（`.github/workflows/docker.yml`）：PR/main 构建不发布；tag push 发布 ghcr。buildx 缓存对 tag 命中、对 PR miss。

## 动哪些、验哪些

- 必须改：
  - ci.yml：playwright 分片 4 → 8（shard env、job 复制、`ci-workflow.test.mjs` 契约期望同步）。
  - file-observer 千并发测试：仅 ubuntu 跑（vitest 条件跳过或 CI 层面拆分），windows 保留其余覆盖。
  - docker.yml：审查 buildx cache key（大概率把源码 hash 混进 key 导致全 miss），对齐 tag 路径的命中策略。
- 需要验：改后一轮 full CI 全绿、CI wall time ≤ 25 分钟、Docker PR build ≤ 5 分钟、契约测试更新后通过。
- 仍未知：playwright 8 分片下固定开销占比（build+browsers ~7m 不可摊薄，8 分片测试段 ~8.5m，预计总 ~24–26m）；若不达标，备选是把 build 产物用 artifact 传递（改 job 依赖，动作更大）。

## 方案与实现安排

1. **A（playwright 4→8）**：改 ci.yml 的 shard 定义与 `PLAYWRIGHT_SHARD`，更新 `scripts/ci-workflow.test.mjs` 的 gated job 清单。风险低——分片是纯切分。
2. **B（windows file-observer 瘦身）**：优先测试内 `test.skip(process.platform === "win32", …)` 加注释说明（flaky + 双平台重复覆盖的价值判断），而非 CI 层面拆 job（后者改动大）。风险：windows 上千并发 watcher 行为少一层覆盖——接受，理由是 ubuntu 已覆盖同一逻辑，windows 特有差异在路径与句柄语义，千并发压测不针对它们。
3. **C（Docker 缓存）**：读 docker.yml 的 cache-to/cache-from 配置，对比 tag 与 PR 路径的 key 差异后最小修正。不动 Dockerfile 内容。

## 验证

- 一轮 full CI（workflow_dispatch 或 merge queue）全绿，核对逐 job 耗时对比本轮基线（playwright ≤ 13m/片、windows server-tests ≤ 9m）。
- Docker：一次 main push 后看 build 耗时。
- `npm run typecheck && npm run lint`、`node --test scripts/ci-workflow.test.mjs`。
- 契约：release-package、changes 不受影响。

## 执行记录

- **2026-09-14：** A——ci.yml playwright 分片 4→8（`PLAYWRIGHT_SHARD: N/8`，job 5–8 追加，`ci-workflow.test.mjs` 期望同步）。B——file-observer 千并发压测 `test.skipIf(win32)`，注释记录两次 flaky 证据与 ubuntu 覆盖理由。C——`docker/base/Dockerfile` 拆层：7 个 workspace 的 package.json + 根 manifest 先 COPY 使 `npm ci` layer 只随依赖变化失效；`COPY . .` 后重新剥 `scripts.prepare`（防止 `npm pack` 在容器内触发 lefthook），`.dockerignore` 已排除 node_modules/dist。本地 Docker daemon 未运行，Dockerfile 变更由 CI 的非发布 build 验证。

## 关闭时

- 回写候选：`docs/development.md` 或 `docs/qa.md` 若提及 CI 时长/分片约定；`codestable/notes/` 若沉淀 buildx 缓存 key 的结论。
- 关闭判断：CI wall ≤ 25m 实测 + 全绿 + Docker PR build 恢复缓存命中。
- 遗留：build 产物 artifact 化（若 8 分片仍不达标时的下一步）；playwright 用例级提速（不在本轮）。
