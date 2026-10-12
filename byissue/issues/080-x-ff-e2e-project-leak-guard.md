---
kind: issue
title: "修 e2e 项目泄漏守卫（零 workspace 的项目 + viewKey 当 projectId）"
type: ff
status: closed
created: 2026-10-12
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 修 e2e 项目泄漏守卫（零 workspace 的项目 + viewKey 当 projectId）

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

起因是 078/079 那批改动跑 e2e 时，`empty-project-persists.spec.ts` 与 `sidebar-project-filter.spec.ts` 合跑会红。查下去发现 `projectOwnership` 守卫有两个缺口互相掩护，导致跨 spec 的项目泄漏长期看不见，也把那个失败误判成了 flake。

- 改动：
  - `packages/app/e2e/support/fixtures.ts` — `projectOwnership` 的差集从 `fetchWorkspaces().entries` 换成 `listProjects()`。**零 workspace 的项目不在前者的 entries 里**：项目最后一个 workspace 被归档后，项目记录还在 daemon 上、侧栏还渲染它，但差集算不出来，所以报「干净」并把它留给了后面每个文件。
  - `packages/app/e2e/support/helpers/seed-client.ts` — 新增 `resolveProjectId(client, projectPath)`：用 `addProject`（find-or-create）解析出真正的 daemon projectId。
  - `packages/app/e2e/browser/empty-project-persists.spec.ts` — 变量从「自称 `projectId`、实际是 viewKey」改为 `projectViewKey`，cleanup 改用 `resolveProjectId`。
  - `packages/app/e2e/browser/projects-settings.spec.ts` — 同上。
  - `docs/testing.md` — 修正两条失效表述，见下。
  - `byissue/notes/011-playwright-spec-cross-file-project-leak.md` — 重写为已验证的机制与用法。
- 关键事实：**侧栏项目行的 `data-testid` 是 viewKey，不是 projectId。** `sidebar-project-row-<viewKey>`（`sidebar-workspace-list.tsx:952`），equivalence 形态下 viewKey 就是 projectKey（`workspace-structure.ts:120`），只有 placement 形态才是 `JSON.stringify([serverId, projectId])`。把 testid 后缀传给 `removeProject` 会被 daemon 拒绝，而调用点普遍写成 `.catch(() => undefined)` —— 失败被吞掉，项目留下。
- 为什么一直没被发现：守卫漏报 + 失败被吞（两个错误互相掩护）；CI 每 shard 独立 job，文件与 worker 的绑定与本地单 worker 不同，本地能复现的污染在 CI 上未必出现；表现是「单跑绿、合跑红」，容易被判成 flake。
- 验证：
  - 先只改守卫、不改用 testid 的两个 spec，`empty-project-persists.spec.ts` 立刻报 `Test leaked daemon project records: prj_e62e1e20fb495eed` —— 证明守卫确实抓到了真泄漏（而不是被调宽）。
  - 修完后 `empty-project-persists.spec.ts` 5/5、`projects-settings.spec.ts` 相关 3/3 通过。
  - 最初那条最短复现组合（`empty-project-persists` → `sidebar-project-filter`）8/8 通过，原先红的 `hides the filter row when there is only one project` 转绿。
  - 广扫 5 个项目密集 spec（`add-project-flow`、`new-workspace`、`projects-settings`、`sidebar-project-grouping`、`archive-tab`）44 passed / 12 failed；12 条全部是环境依赖，与本改动无关：缺 agent CLI（`Provider 'opencode' is not available`）、Windows `EBUSY: resource busy or locked`、真实 `git clone`/`gh pr create` 走网络、以及 `blockBySpaceConfigWrites` 用的 `chmod 0o555` 在 Windows 上不阻断写入。唯一与本改动相关的是上面那条 `prj_3ee8d9aad649ea6b` 泄漏，已修。
- 对 `byissue/` 影响：无 spec 变更。e2e 基建约定归 `docs/testing.md`（project spec 不含测试脚手架），已就地修正两处：
  - `Spec files run concurrently without exposing one file's projects ... to another worker` → 把「隔离单位是 worker 不是 spec 文件」写清楚，并点明本地 `workers: 1` 下一个 worker 顺序跑很多文件、共用 daemon。
  - `an automatic fixture fails any test that still leaks a project record` → 补上它 diff 的是 `listProjects()` 而非 `fetchWorkspaces()`，以及 viewKey/projectId 那条陷阱。

另一个顺手发现，已一并写入 `docs/testing.md`：**`npx playwright test ... | tail -N` 会给出假绿。** 管道的退出码是 `tail` 的（恒 0），而 Playwright 先打 `12 failed` 再打 `44 passed`，所以取最后一行看到的也是 `44 passed`。本批次广扫那次就是这样被包装成「exit 0，最后一行 44 passed」的，但实际是 12 failed。规则补成「重定向到文件，别用管道；读 summary 行，别读最后一行」。

顺手发现：仓库里 `void <var>;` 当依赖提示的写法在 `use-projects.ts` 等多处存在，与 076 记录的 React Compiler 冻结同源，未在本批次处理。
