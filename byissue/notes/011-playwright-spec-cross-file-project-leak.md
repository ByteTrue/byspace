---
kind: note
title: "e2e 项目泄漏：守卫只差 workspace、testid 给的是 viewKey"
created: 2026-10-12
---

# e2e 项目泄漏：守卫只差 workspace、testid 给的是 viewKey

> **读者：** 跑两三个 app Playwright spec 时某条断言莫名变红，或 `projectOwnership` 报了一个不该报的 leak——先读这条。

## 结论

本地默认 `workers: 1`（`packages/app/playwright.config.ts:25`），**一个 worker 顺序跑很多 spec 文件，共用一个 daemon 和 `BYSPACE_HOME`**。隔离单位是 worker 不是文件名，所以前一个文件留下的项目，后面每个文件都看得见。

拦住这件事的是 `projectOwnership` 自动 fixture（`packages/app/e2e/support/fixtures.ts:87`）。它原先用 `fetchWorkspaces().entries` 求项目差集，**两个缺口**叠在一起让它形同虚设：

1. **零 workspace 的项目不在 `entries` 里。** 一个项目的最后一个 workspace 被归档后，项目记录还在 daemon 上、侧栏还渲染它，但它没有 workspace 条目，差集算不出来。已改为 diff `listProjects()`（`session.ts:5604` 的 `project.list.request` 只过滤 `archivedAt`，零 workspace 的项目在里面）。
2. **侧栏项目行的 testid 是 viewKey，不是 projectId。** `sidebar-project-row-<viewKey>`（`sidebar-workspace-list.tsx:952`），equivalence 形态下 viewKey 就是 projectKey（`workspace-structure.ts:120`），只有 placement 形态才是 `JSON.stringify([serverId, projectId])`。把 testid 后缀当 projectId 传给 `removeProject` 会被 daemon 拒绝，而调用点普遍写作 `.catch(() => undefined)`——失败被吞掉，项目留下。

修好第 1 条后守卫立刻抓到了第 2 条的实例：`empty-project-persists.spec.ts` 的 `adding a project starts with only the project header row`，泄漏 `prj_*`。用 `addProject` 解析出真正的 projectId 后转绿。

## 为什么这些一直没被发现

几个叠加的原因：

- 守卫本来就漏报（缺口 1），失败又被 `.catch()` 吞掉（缺口 2），两个错误互相掩护。
- CI 的分片布局与本地单 worker 不同（`.github/workflows/ci.yml` 每个 shard 是独立 job），文件与 worker 的绑定不一样，本地能复现的跨文件污染在 CI 上未必出现。**CI 绿不代表本地那次是幻觉。**
- 表现是「单跑绿、合跑红」，很容易被判断为 flake。

已复现的最短组合：`empty-project-persists.spec.ts` 后接 `sidebar-project-filter.spec.ts`，后者 `hides the filter row when there is only one project` 会红——它数到两个项目。修掉上面的泄漏后该组合转绿（8/8）。

## 怎么用

- 看到 `Test leaked daemon project records: prj_*` 时，这是**真泄漏**，去查那个用例的 cleanup，不要调宽守卫。
- cleanup 里要用 daemon projectId。从 UI 拿到的 testid 后缀是 viewKey，用 `addProject(path)` → 读 `lookup.project.projectId` 解析（`addProject` 是 find-or-create，不会重复建）。
- 写「项目数恰好为 N」这类断言时别依赖「我前面没人」，断言前先清掉无关项目。
- `removeProject(...).catch(() => undefined)` 会吞掉失败。要么别吞，要么至少确认参数是 projectId。

## 边界

- 没验证 worker 之间是否完全隔离；这条只覆盖「同一 worker 内、文件之间」。
- 没逐一排查全部 spec 的 cleanup，只修了修复守卫后报出来的那些。

## 相关

[012-github-fixture-repo-leak](012-github-fixture-repo-leak.md) 是同一形状的另一半：那条讲 GitHub **仓库**泄漏（delete_repo scope 缺失 + `try/catch` 吞掉），这条讲 daemon **项目**记录泄漏。共同点是「清理失败被吞 → 症状延后到下一个不相关的测试」。
