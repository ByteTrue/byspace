---
kind: epic
title: "缩短 CI/CD 与版本发布等待"
status: active
created: 2026-08-11
---

# 缩短 CI/CD 与版本发布等待

## 这条线要改变什么

让一次已经决定要发布的 Beta 或 Stable，在不减少测试、不改变发布时机与渠道语义的前提下，更快完成 exact-SHA CI、npm 发布、Web 部署与 Relay 部署。

当前一次成功发布从 release commit 推送到所有渠道可用通常需要约 24～28 分钟：最近 5 次成功 `main` CI 的中位数为 15 分 33 秒，CI 绿后 npm Publisher 与 App Deploy 又分别花约 6 分钟和 3 分钟。主要浪费来自 Playwright 关键路径不均，以及已经在 CI 构建、验证过的 npm/Web 产物在部署阶段被重新构建。

这项变化跨 GitHub Actions、npm package、Web、Relay 与发布证明，且需要分批验证，因此使用 Epic 承载。

- 关联 Project Spec：`codestable/spec/index.md` 的“身份与发布”——保持现有产品身份和 Stable/Beta 渠道。
- 关联系统说明：`docs/release-engineering.md`、`docs/release.md`——保持 exact-SHA、不可变 Tag、Trusted Publishing、渠道隔离和完整发布 tuple。

## 当前怎么理解

### 不改变发布策略，只消除重复工作

Beta 继续用于抢先体验尚不足以发布 Stable 的改动，Stable 继续承担正式版本；何时发布、选哪些改动、版本号如何推进都不在本 Epic 内改变。Beta 与 Stable 仍执行完整 CI，仍要求 npm、Web、Relay 和 daemon 对应同一 release commit。

优化遵循一个不变量：**构建一次，验证同一份产物，发布同一份产物。**

```text
release commit
      │
      ▼
exact-SHA CI
  ├─ package build ─> 唯一 Web dist + npm tarball ─> Linux/macOS/Windows smoke
  ├─ App typecheck/unit tests 与 Playwright 全量场景
  └─ 其余完整门禁
      │ 全绿
      ▼
immutable tag
  ├─ npm Publisher ──> 发布 CI tarball
  ├─ App Deploy ─────> 部署 CI Web dist
  └─ Relay Deploy ───> 从同一 SHA 部署
```

npm package 只在 CI 中生成一次。三个操作系统下载并 smoke 同一 tarball；Publisher 从该 exact-SHA 的成功 CI run 下载同一 artifact，再执行 Trusted Publishing。CI 负责承接原 Publisher `release:check` 中仍有独立价值的 package 结构、版本与 release verification 检查。artifact 缺失、过期、来源 SHA 不符、版本不符或 digest 不符时失败关闭，禁止静默重建另一份产物。

Web `dist` 只在 release artifact job 中生成一次，并在同一 job 中嵌入 npm tarball；App tests 作为并行门禁继续存在。App Deploy 从 exact-SHA CI run 下载该 artifact 并部署，不再重新 typecheck/export。Relay 当前部署约 30 秒且没有同量级重复构建，暂不优化。

### 全量测试不变，缩短 Playwright 最长 shard

当前 Playwright 使用 4 个彼此隔离的 runner，每个 runner 保持 `workers: 1`、`fullyParallel: false`，避免共享 daemon/relay/Metro 栈产生跨测试竞争。历史成功 run 的四个测试阶段约为 16:24、11:30、12:24、14:00；随后一次 run 的两个首用例各耗约 72 秒失败、retry 后约 8 秒通过。首用例根因修复后的 exact-SHA run `31482108162` 完整全绿，但四个 Playwright job 仍需 16:54、13:18、13:25、16:06，关键路径优化仍成立。

先消除首轮 retry 的真实原因，再把隔离 shard 增至 8；首次实测保持全量场景但最长 job 仍为 12:36，因此继续用 Playwright 原生静态 sharding 收敛到 10。全过程不打开同一栈内并发、不减少场景、不做 path-based selective CI；如 10 shard 仍因大 spec 明显失衡，才拆分少数有证据的大文件，不建立自定义调度器。

### 质量约束与取舍

- 性能效率 / 时间特性：以至少 5 次成功 run 的 runner 执行时间观察中位数，不把单次 GitHub runner 或网络抖动做成硬失败阈值。目标是完整 CI 中位数不高于 11 分钟，CI 绿后 npm/Web/Relay 的执行时间不高于 2 分钟；外部排队时间单独报告。
- 可靠性：所有现有测试面、三平台 package smoke、release verification 与 Stable/Beta 发布后证明继续存在。优化不能通过减少检查换时间。
- 信息安全性：artifact 只能来自同仓库、同 release SHA 的成功 CI run；PR 等不可信上下文不能获得 npm 或 Cloudflare 发布权限。Trusted Publishing、环境隔离与不可变 Tag 不变。
- 可维护性：优先使用 GitHub Actions artifact 与现有脚本；不先引入 Nx/Turbo、远程缓存、自托管 runner、自定义测试调度平台或新的发布渠道。
- 成本取舍：增加 Playwright shard 会增加隔离栈的启动 runner minutes，预计约 10%～15%；用户已选择用该有限成本换取更短墙钟时间。实际 shard 数仍由基线和复测证据收敛。

## 当前推进

### 可推进范围

1. 恢复当前 `main` CI 可信基线，并固化本 Epic 的耗时计算口径。
2. 统一 npm/Web artifact 的构建、跨平台验证和发布晋升。
3. 修复 Playwright 启动型 flake，增加隔离 shard 并复测关键路径。
4. 消除测量期间暴露的 Git stdin `EPIPE` CI 竞态。
5. 删除 Codex resume 集成测试私有的 500ms runner 调度门。

### Issues

- [x] `issues/001-x-restore-ci-baseline.md`：修正 Git 刷新异步 Forge 行为留下的旧测试断言，恢复 exact-SHA CI，并记录可复算基线。
- [ ] `issues/002-o-single-build-release-artifacts.md`：让三平台 smoke、npm Publisher 和 App Deploy 消费 CI 中唯一构建的 artifact。
- [ ] `issues/003-o-playwright-critical-path.md`：消除首轮 retry 税，增加隔离 shard，在保留全量场景的前提下压缩最长 job。
- [ ] `issues/004-o-git-stdin-epipe-flake.md`：共享 Git runner 消费提前关闭的 stdin pipe error，避免 CI 在断言全绿后以 uncaught `EPIPE` 失败。
- [ ] `issues/005-o-codex-resume-test-startup-race.md`：让 Codex fake app-server 集成测试等待协议结果，而不是假定 Windows runner 必须在 500ms 内启动子进程。

Issue 002 和 003 在 Issue 001 恢复可信基线后可以并行推进；Issue 004、005 是测量过程暴露的可靠性阻断，最终要合并观察端到端 release 时间。

### 暂不推进

- 改变 Beta/Stable 的发布时机、受众、版本选择或质量门禁。
- 新增 Edge/Canary 渠道，或自动发布每个 `main` commit。
- selective CI、按路径跳过测试、减少跨平台验证或取消 Playwright 场景。
- 自托管 runner、远程 build cache、Nx/Turbo 或自定义 duration scheduler。
- 优化目前只约 30 秒的 Relay deploy 本身。

### 未确认项

没有产品或发布策略待确认。实现阶段只需让最终 shard 数和 artifact retention 由实测数据收敛；不得借此放宽 fail-closed 与 exact-SHA 边界。

## 关闭条件

- 当前 `main` CI 回到绿色，Git 刷新的本地先响应、Forge 后更新行为有正确测试。
- Linux、macOS、Windows smoke 的 npm tarball digest 相同，npm 实际发布的也是该 artifact。
- CI release artifact job 构建的 Web artifact 与 Cloudflare Pages 实际部署输入相同；部署阶段不重新 export。
- Stable/Beta exact-SHA、不可变 Tag、npm dist-tag、Pages 与 Relay 隔离规则全部保持。
- 至少 5 次成功 CI 样本证明完整 CI runner 执行时间中位数不高于 11 分钟；外部排队单独列出，不作为单次硬门。
- 一次真实 Beta 和下一次真实 Stable 发布分别证明完整 tuple；如 Stable 尚无发布需求，Epic 保持开放，不为验收制造版本。
- 发布后证据记录 artifact/run/SHA/version/digest 对应关系，并证明另一渠道未变化。

## 合并回 Project Spec 的候选

Epic 关闭时，把以下稳定事实合并到 `codestable/spec/` 的发布能力说明：

- release artifact 在 CI 中唯一构建，跨平台验证与发布晋升共享同一份 npm/Web 产物。
- Stable/Beta 保持完整 exact-SHA 门禁，但 CI/CD 通过并行和 artifact promotion 缩短等待。
- 发布产物缺失或身份不符时失败关闭，不以部署阶段重建作为 fallback。

Vision 不涉及本次基础设施优化，关闭时只需确认产品目标未被发布工程变化改写。

## 相关材料

- `docs/release-engineering.md`：修改 workflow、artifact 信任或渠道切换前读取完整发布不变量。
- `docs/release.md`：执行真实 Beta/Stable 验收时按现有 release playbook 操作。
- `.github/workflows/ci.yml`：当前完整 CI 与 Playwright/distribution 关键路径证据。
- `.github/workflows/npm-release.yml`、`.github/workflows/deploy-app.yml`：当前重复构建发生的位置。
- GitHub Actions run `31417319455`：成功 Playwright shard 基线。
- GitHub Actions run `31471036867`：当前 stale assertion 失败及“早失败、晚结束”证据。
- GitHub Actions run `31482108162`：Issue 001 修复后的首个完整绿色基线，workflow 墙钟 16:58。
