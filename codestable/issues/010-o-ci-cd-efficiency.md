---
kind: issue
title: "CI 发布门禁与 flaky 测试治理（CI/CD 效率优化）"
type: chore
status: open
created: 2026-09-04
---

# CI 发布门禁与 flaky 测试治理（CI/CD 效率优化）

> **读者：** 跨会话接手的人——目标：发布打 tag 不再靠人工 rerun 抽卡。别碰：不降低 exact-SHA CI 门禁标准，不改生产 60s RPC 默认值。验证：连续发布演练无 flake 阻塞。

---

## 做成以后是什么样

- 发布时 exact-SHA CI 一次全绿是常态；已知 flaky job 失败后有自动重试，仍失败才需要人介入；
- e2e seed 链路在冷 runner 上有充足超时余量，不再贴生产默认 60s 线；
- windows vitest 时序断言类 flake 被修复或隔离，不再随机打红 CI；
- bump commit 导致的 nix/npm-deps.hash 过期有明确、可执行的取数修复路径，不拖到下个 PR 才暴露。

**审计修正（2026-09-04 补充）：** v0.11.3 发布故障不全是既有 flake，部分由会话中全局环境变更造成（全局装 claude/codex/opencode 最新版、写错 `~/.npmrc` 只留一条 allow-scripts）。「本地没在跑过 15-provider」是用户真实环境特征；「CI 上 15-provider 跑过且绿」是 v0.11.2 事实。把本地与 CI 混为一谈是不准的。

**范围：** 包含 CI workflow、e2e/单测 flake 治理、发布门禁配套自动化；不包含：降低门禁标准、缩减测试覆盖、生产 RPC 超时调整。

## 为什么现在做 / 当前坏在哪

v0.11.3 发布（2026-09-04）实测：全程 ~6 小时，其中 ~5 小时在等 CI 与重跑。具体证据：

- merge commit `ba2184de4` 的 CI 重跑 **4 次才绿**；bump commit `3ecc55327` 自动重试 4 轮仍不绿，最终靠修复 commit `bed6d2e69` 才一次全绿；
- playwright shard 4 的 `worktree-restore-after-restart` 与 `settings-toggle-tab-regression`：seed 阶段 `createIdleAgent → daemon createAgent` RPC 等 60s 默认超时（`DEFAULT_SESSION_RPC_TIMEOUT_MS`）。冷 runner 上 opencode 首会话创建 50–70s+（双 worker 并发加剧），绿跑本就 1.1–1.2m 贴线，本地同 spec 仅 10–17s。当天 8 次尝试挂 7 次；
- windows vitest 随机时序断言：`workspace-git-service.observation.test.ts`（mock 调用计数 2 次 vs 1 次）与 `plugins/index.posix.test.ts`（git 更新构建命令）两处中过；
- cli-tests 的 `paseo provider models opencode --json` 60s 超时随机挂；`mermaid-streaming.spec` 为已知 flake；
- PR CI 的 changes 过滤器常跳过 cli/relay tests，flake 在 merge 后 main 首曝，发布时才付代价。

## 已落地（本次发布中）

- `bed6d2e69`：`DaemonClient.createAgent` 增加可选 `timeout`（复刻 checkout git metadata RPC 的既有模式），e2e seed helper 传 180s。落地后 bed6d2e69 CI 一次全绿，shard 4 不再抽卡。生产 60s 默认不变。

## 方案与实现安排

分三层，按根治程度排序：

1. **flake 治理（根治）**——第一批已落地（见执行记录）；余项：
   - 本地 mermaid reload 步稳定失败（CI 未见）：调查是真实产品 bug（blob/srcdoc 生命周期）还是本地环境伪影；
   - codex CLI 本机冷启动挂起导致 daemon models RPC 超时（本地复现）——与 CI opencode 超时同族，观察 CI 验证。
2. **自动重试（结构性缓解）**
   - 为已知 flaky job 建「失败自动 rerun 一次」机制（workflow 收尾 job 或轻量脚本），rerun 仍红才报警；人工 `gh run rerun --failed` 流程保留为兜底（注意：run 必须 completed 才能 rerun）。
3. **配套（缓解）**
   - CI 时长优化：gradle/oxlint/metro 缓存、shard 均衡（shard 4 集中了 terminal-\* 重负载 spec）；
   - ~~nix/npm-deps.hash~~ 已完成（见执行记录）；
   - ~~main push 取消旧 run + paths 路由~~ 已完成（见执行记录）。

**危险边界：** 不降低 exact-SHA 门禁；不为掩盖失败而无条件重试——自动重试仅限白名单内的已知 flake 形态。

## 验证

- 连续 2 次发布演练（或真实发布）exact-SHA CI 一次全绿；
- playwright shard 4 在 CI 连续多次全绿；
- windows server-tests 连续多次无时序 flake。

## 执行记录

- 2026-09-04：v0.11.3 发布过程中发现问题并落地 seed timeout 修复（见上）。
- 2026-09-04：nix/npm-deps.hash 刷新路径实战验证：发 PR 触发 nix.yml → 从 darwin job FOD 报错的 `got:` 值取正确 hash → 回填分支 → build + build-desktop-darwin 双绿 → PR #26 合入 main（`nix/package.nix` 顺带文档化了刷新路径）。bump 后的 nix 修复从此有可复制的固定流程。
- 2026-09-04：flake 治理第一批落地（`429898b2f`）：seed 链路 upsert 等待 30→60s；cli provider models 重试接住 harness 超时 reject（此前超时直接炸测）+ 120s 命令超时；observation 测试用 runOnlyPendingTimers 替代零余量 exact-1s advance（windows flake 形态）；plugins git-update 测试超时 30→60s（windows 实测 33s）；mermaid 采样循环容忍 ≤2 个连续 svg 瞬时丢失（已知 composer ~157ms 重挂载）。本地验证：observation+plugins 56 测试全绿、15-provider claude 路径过（codex 本机挂起未验，重试逻辑已本地复现生效）、mermaid 本地 reload 步失败为既有问题与 diff 无关（基线同挂，CI 从未在此挂，已列为后续调查项）。
- 2026-09-04：结构性缓解落地（`1354b631c`）：CI/Docker 对 main push 开启 concurrency 取消（新 push 取消在飞旧 run）；CI 的 `full` 门控对 main push 改为与 PR 相同的 paths 路由（docs/codestable-only push 几分钟出结果；bump commit 因触碰 package.json 仍全量，release 门禁不变）。当天实测 docs-only push 白跑 ~30min 全量矩阵且被下一 push 立即取代——此形态不再发生。

## 关闭时

- 回写候选：`docs/release.md`（rerun 处置已补）、`docs/testing.md`（flake 隔离策略）、`nix/npm-deps.hash` 修复路径；
- 关闭判断：验证标准连续达标；
- 遗留：CI 时长优化若未完成，拆后续 issue。
