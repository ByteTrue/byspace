---
kind: issue
title: "审阅 2026-07-18 Paseo upstream 增量更新"
status: open
created: 2026-07-18
epic: ""
---

# 审阅 2026-07-18 Paseo upstream 增量更新

## 目标

审阅上一批执行期间新进入 Paseo `main` 的每一笔 commit；在用户明确批准完整 ledger 前不 replay。

## 冻结区间

- Start exclusive：`1977d330edefb8d7c8c0f0673e911586d40a6262`
- End inclusive：`a1de743ef67dde4fe7c48d045a3714f65dfa5e90`
- Commit count：3
- 顺序：`39cb3dbb9` → `a414f8ea8` → `a1de743ef`
- Fetch：`git fetch upstream main --no-tags`

## 约束

- 不恢复 Electron、native、Browser automation 或 website。
- 不覆盖上一批已验证的 Project/Add Project/Forge/recovery/selective-sync/CI hardening。
- 协议 append-only、字段 optional/capability-gated；BySpace identity 不回退。
- 高风险 commit 必须独立 scratch replay、完整 diff review、focused + exact CI gate。

## 完整 Ledger

### 建议完整同步（2）

#### `39cb3dbb9c8784f9f25fce54fc429b848076fe0e` — 每个 added folder 都是独立 Project

- 行为：Project identity 固定为用户选择的 exact root，不再随 Git root 变化；empty/non-Git folder 后续初始化为 Git 时原地刷新 metadata；worktree/source/placement 单独持久化；realpath/Windows alias、archive/recovery、Git observer、directory transaction 全链路一致。
- 规模：93 files，`+7391/-2727`，主要覆盖 protocol/client/App project flow、workspace registry/reconciliation/recovery/worktree lifecycle 与 E2E。
- 价值：直接修复当前 Add Project / empty project / nested folder / worktree identity 的根模型，和 BySpace 已批准方向完全一致。
- 风险：极高。与上一批 Project、Forge、recovery、selective directory sync 以及本地 rollback/Metro/E2E hardening 大面积重叠；不得 wholesale take upstream。
- Replay：**full atomic behavioral port**。保留现有 legacy RPC、Forge identity、BySpace path trust、`0.1.2` recovery gate、directory source-epoch guard、global package/release 边界。
- 验证：exact-root vs Git-root、folder becomes Git、transient Git failure、nested roots、worktree create/archive/recover/delete、Windows aliases、mixed old/new clients、directory transaction/reconnect、Add Project E2E。

#### `a1de743ef67dde4fe7c48d045a3714f65dfa5e90` — thinking/plain-text detail scroll layout

- 行为：expanded thinking/plain-text detail 使用与其他 detail section 一致的 bounded nested `ScrollView`。
- 规模：1 App file，`+14/-17`。
- 价值：Web UI 修复，和 retained tool detail surface 一致。
- 风险：低；重点验证 nested scroll、selection、compact viewport 和已有 detail sections。
- Replay：**full**。

### 建议暂缓（1）

#### `a414f8ea8572412cae498bcb62cac9429cc13bdf` — daemon ↔ Hub relationship

- 行为：新增 `hub connect/status/disconnect` CLI、Hub management/execution RPC、持久 relationship/credential、daemon outbound WebSocket、Hub-owned agent/execution ownership与 scoped grants。
- 规模：46 files，`+5799/-80`，新增完整 Hub subsystem 和约 4k 行 lifecycle/security tests。
- 安全边界：Hub 可远程创建并驱动其 owned agents；虽为显式 opt-in、同源 enrollment/socket、`hub.execution.*` allowlist，但它是新的远程执行 authority。
- 当前缺口：本 repo 只有 daemon-side client，没有 Hub server；BySpace 没有 Hub product/endpoint/token ceremony。原 wire header 为 `x-paseo-daemon-id`，按 BySpace identity 不能原样保留，改名后也不能直接兼容未修改的 Paseo Hub。
- 源码定位：CLI 强制要求 `paseo hub connect <url> --token <token>`，没有默认 URL；daemon 对该 origin 调用 `POST /api/daemons/enroll` 和 `DELETE /api/daemons/:daemonId`，enroll response 再返回同源 `ws(s)://` 地址。
- 服务端定位：upstream `docs/hub.md` 明写 consumer implementation 位于 **Paseo Cloud**，PR #2035 也称它是 cross-repository dependency；公开 `getpaseo` org 只有 `paseo` 与 `paseo-relay`，Hub header 的公开 GitHub code hit 也只有 daemon client。
- 公开状态：`https://paseo.sh/cloud` 是 Design Partners / early-access 落地页，注明无公开日期；`hub.paseo.sh`、`cloud.paseo.sh`、`api.paseo.sh` 经公共 DNS 均为 NXDOMAIN，`/docs/hub` 也未发布。当前没有可公开连接的 Hub endpoint。
- 建议：**defer**，先决定“自建 BySpace Hub、兼容 Paseo Hub、还是继续使用现有 relay + MCP orchestration”之一，再作为独立 security epic 导入。不是因体积跳过，而是缺少 counterpart 与产品信任决策。
- 若用户批准现在导入：按 full atomic port；全部命名改为 BySpace；不预置 vendor URL；默认 disabled；增加 capability gate、credential redaction、direct/relay/local management authority、disconnect cleanup、replay/idempotency、malicious Hub tests，并明确不承诺 Paseo Hub wire compatibility。

## 覆盖证明

```text
Full 2 + Defer 1 = 3
missing = 0
extra = 0
duplicate = 0
```

## 用户批准

- 2026-07-18：用户确认不引入 Hub，继续其余变更。
- Approved：Full `39cb3dbb9` + `a1de743ef`。
- Deferred：`a414f8ea8`，只记账并推进 reviewed cursor。

## 执行记录

- Scratch：`/private/tmp/byspace-upstream-2026-07-18-a1de743e`
- `39cb3dbb9` → `6532db522`（full atomic behavioral port）
- `a1de743ef` → `cd09ca3b1`（full）
- Hub `a414f8ea8`：未引入任何代码、协议、CLI 或配置。
- BySpace compatibility coverage：`60bf7930a`。
- Lifecycle hardening：`9559b0f8f`、`6788f69ab`、`58b323275`、`0f99c9757`、`dd2e2488c`。
- 修复的 review blockers：reconciliation stale write/removal resurrection、archive/reopen TOCTOU、import rollback concurrent update/adopter、unsafe Git ref、recovery orphan cleanup、project/remove FK race、archive transaction linearization、recreate→unarchive gap。
- 验证：440 server focused tests（4 skipped）、235 protocol/client/App/server cross-layer tests、45 Project/Add Project/worktree recovery/Forge Playwright，Web export、server build、root typecheck/lint/format/branding 全绿。
- 独立 fixed-tip review：Gemini 与 GPT reviewer 均返回 `No blockers`。
