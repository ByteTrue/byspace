---
kind: issue
title: "CI/CD 效率根治：E2E 测试架构、CI 结构与发布纪律"
type: chore
status: open
created: 2026-09-04
---

# CI/CD 效率根治：E2E 测试架构、CI 结构与发布纪律

> **读者：** 跨会话接手的人。
> **目标：** 一次发布会话不再浪费 5 小时在等 CI 与重跑上；外部 agent CLI 的更新永远不会让 BySpace 的测试必现失败。
> **别碰：** 不降低 exact-SHA 发布门禁；开发机不装任何 agent CLI；测试结果以 CI 为基准。
> **验证：** 一次真实发布全程无人工 rerun；mock 化后普通 spec 不再触达真实 provider。

---

## 触发事件（2026-09-04 v0.11.3 发布）

全程约 6 小时，其中约 5 小时消耗在 CI 重跑与人工等待：

| 事件                           | 消耗                          | 性质                       |
| ------------------------------ | ----------------------------- | -------------------------- |
| `ba2184de4`（merge PR #25）CI  | 重跑 4 次才绿                 | flake 抽卡                 |
| `3ecc55327`（bump commit）CI   | 自动重试 4 轮仍不绿           | flake 抽卡                 |
| `bed6d2e69`（seed 超时缓解）CI | 1 次全绿                      | 缓解生效                   |
| docs-only commit CI            | 白跑 ~30min 全量矩阵          | CI 结构缺陷（已修）        |
| 本地「复现」e2e                | 污染开发机（装 3 个全局 CLI） | 会话操作纪律错误（已纠正） |

**核心症状**：playwright shard 4 的 `worktree-restore-after-restart`、`settings-toggle-tab-regression` 当天 8 次尝试挂 7 次，重跑 3-4 轮才绿。

## 根因分析（按因果链，非按表面症状）

### 根因 A：普通 UI/daemon e2e 测试错误依赖真实 agent CLI

- `settings-toggle-tab-regression` 验证的是「设置页开关后回到同一 workspace tab」——纯 UI 回归；
- `worktree-restore-after-restart` 验证的是「daemon 重启后 History 显示 worktree 分支」——纯 daemon 持久化；
- 两者都不测 agent 集成，却通过 `archive-tab.ts` 的 `createIdleAgent` seed **真实 opencode 进程**（CI 上冷启动 50-70s+，双 worker 并发加剧）；
- daemon 内置 `MockLoadTestAgentClient`（毫秒级 idle、零外部依赖），19 个普通 spec 已用它，但这 10 个没有；
- **后果**：测试贴 60s RPC 超时线侥幸通过（绿跑 1.1-1.2m）；runner 稍慢或 opencode 稍慢必挂。若 opencode 更新变慢，测试必现失败——这正是用户指出的「测试写得有问题」。
- 真正测 agent 集成的测试已有单独归类：`.real.spec.ts`（17 个）+ `real-provider` project + CI 专用安装 CLI。**真实 provider 只应出现在 `.real` 里。**

### 根因 B：UI 测试对「seed 完成时间」做脆弱假设

- 生产 RPC 默认 60s（交互场景合理），UI 测试却把「冷启动真实 CLI」塞进这条链路；
- 测试自身超时余量不足：绿跑也要 1.1-1.2m，与超时线只有几十秒余量。

### 根因 C：CI 结构放大 flake 的代价

- PR 的 changes 过滤器常跳过 cli/relay/browser 测试 → 代码合入 main 后全量矩阵第一次真正跑这些测试 → **flake 在 main 首曝，发布时才付代价**（PR #25 的 cli-tests 就被跳过）；
- main push 旧 run 不被取消（docs push 白跑 30min，随即被下一 push 取代）；
- main push 与 PR 路由不同（docs-only 也全量）——**已修**（`1354b631c`）；
- 无自动重试机制 → flake 需要人守着 `gh run rerun --failed`。

### 根因 D：发布会话操作纪律（本次会话教训）

- 为了「本地复现 CI 失败」，擅自全局装了 claude/codex/opencode 三个 CLI 并改写 `~/.npmrc`——用户开发机明确不装这些；
- 用被污染的本地环境当「基线」，得出「本地 10s 过 / CI 1m 挂 → 测试脆弱」的部分错误结论；
- 用户裁决（审计修正 2）：**测试结果以 CI 为基准**；本地跑不了（缺 provider）就不跑；开发机不装任何 agent CLI。

## 已落地（按 commit，可复核）

| Commit            | 内容                                                                                                                                                                         | 是否仍必要（mock 化后评估）                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bed6d2e69`       | `createAgent` 加可选 timeout，e2e seed 传 180s                                                                                                                               | **待定**：mock 化后 seed 毫秒级完成，180s 缓解不再需要；`timeout` 参数本身是防御性 API，可保留也可 revert 简化                                                                                  |
| `429898b2f`       | seed upsert 30→60s；cli provider models 重试接住超时 reject + 120s；observation 测试 runOnlyPendingTimers（windows 时序）；plugins git-update 30→60s；mermaid 采样容忍重挂载 | **分项评估**：windows vitest 两项是纯 mock 真实修复，**保留**；seed upsert 放宽与 mermaid 容忍依赖根因 A 修复（mock 化），mock 后**可 revert**；cli 重试接住 reject 是 harness 真缺陷，**保留** |
| `1354b631c`       | main push 取消旧 run；main push 走 paths 路由（docs-only 快，bump 全量）                                                                                                     | **保留**（独立于 provider 问题，已实测生效）                                                                                                                                                    |
| nix hash PR #26   | bump 后 hash 刷新路径固化                                                                                                                                                    | **保留**                                                                                                                                                                                        |
| `docs/release.md` | dry-run 输入、上传脚本参数序、flake rerun 处置                                                                                                                               | **保留**（含此次教训）                                                                                                                                                                          |

**诚实标注**：`bed6d2e69`/`429898b2f` 的 seed 部分治的是症状（放大超时容忍慢 CLI），没治根因 A（UI 测试根本不该等真实 CLI）。若本次方案落地 mock 化，这两项的 seed 部分应 revert，保持代码与测试贴近上游、无冗余。

## 实施计划（一次性完整落地）

### 阶段 1：普通 spec 的 seed 全面 mock 化（治根因 A + B）

**方案**：复用现存成熟链路 `seedMockAgentWorkspace`（建于 daemon 内置 mock provider，19 个普通 spec 已在用），把 10 个通过 `createIdleAgent` 拉真 opencode 的普通 spec 改成同样用法；不引入新基建，不拆 api。

**10 个调用方**（全部普通 spec，全部把 seed 从真 opencode 换 mock）：

- `archive-tab.spec.ts`
- `command-center-host.spec.ts`
- `command-center-workspaces.spec.ts`
- `sessions-search-hosts.spec.ts`
- `sessions-search.spec.ts`
- `settings-toggle-tab-regression.spec.ts`
- `workspace-agent-tab-rename.spec.ts`
- `workspace-pane-remount.spec.ts`
- `worktree-restore-after-restart.spec.ts`
- `worktree-restore.spec.ts`

**撤回项**：`429898b2f` 中的 seed upsert 30→60s、mermaid 采样容忍重挂载，在 mock 化后失去意义，评估后 revert；windows vitest 两项与 cli 重试接住 reject 为独立修复保留。`bed6d2e69` 的 `timeout` 参数保留（对齐 checkout 先例），但 e2e seed 不再传 180s。

**效果**：普通 spec 永不触达真实 CLI；外部 CLI 更新不再影响它们；shard 4 不再有 50-70s 冷启动等待；开发机本地可跑（依赖 mock，无 provider 也可）——与用户裁决完全一致。

### 阶段 2：CI flake 自动重试（缓解残余 flake）

- CI workflow 加收尾 job：白名单内的已知 flake 形态（含 `.real` 的 provider 冷启动、windows 时序）失败后自动 rerun 一次；rerun 仍红才报红；
- 白名单不放宽成无条件重试（掩盖真失败）；
- 人工 `gh run rerun --failed` 兜底流程保留，文档已写（`docs/release.md`）。

### 阶段 3：CI 时长与结构收尾

- `.real.spec.ts` 单独 shard/跑在独立 project 已有；评估是否需要单独 job（避免真 provider 慢测试拖累普通 shard 的并行度）；
- 观察 playwright shard 均衡（mock 化后自然变化，先测后调）；
- gradle/oxlint/metro 缓存如经实测有显著收益再做（低优先）。

## 决策边界（本 issue 锁死）

1. 开发机不装任何 agent CLI；测试结果以 CI 为基准；
2. 真实 agent CLI 只允许出现在 `.real.spec.ts`（CI 专用 project 内）；
3. 不降低 exact-SHA 发布门禁；
4. mock 化不改普通 spec 的测试意图（它们验证 UI/daemon 行为，不验证 agent）。

## 验证

- 阶段 1：普通 spec（含 settings-toggle、worktree-restore）CI 连续全绿且 shard 时长显著下降；无 opencode 的开发机本地可跑通这些普通 spec；
- 阶段 2：人为注入白名单 flake 观察自动 rerun 生效一次后仍红（不掩盖）；
- 总体验收：一次真实发布 exact-SHA CI 一次全绿、全程零人工 rerun。

## 执行记录

- 2026-09-04：v0.11.3 发布（触发本 issue）；当日已落地缓解项见上表。
- 2026-09-04：审计修正（用户裁决）：开发机不装 CLI、CI 为基准、普通 spec 缺 provider 快速失败是设计边界。
- 2026-09-04：本文件重写为完整梳理版（原版为发布当日边修边记的散乱记录）。

## 关闭时

- 回写候选：`docs/testing.md`（普通 spec 不触达真实 CLI 的约定）、`docs/release.md`（已补）、issue 内已标注的 revert 项需在代码中执行；
- 关闭判断：验证标准全部达标；
- 遗留：阶段 3 缓存优化若未做，拆后续 issue（低优先）。
