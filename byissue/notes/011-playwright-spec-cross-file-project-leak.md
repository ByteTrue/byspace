---
kind: note
title: "空项目会绕过 e2e 的泄漏守卫，并串到后面的 spec 文件"
created: 2026-10-12
---

# 空项目会绕过 e2e 的泄漏守卫，并串到后面的 spec 文件

> **读者：** 本地跑两三个 app Playwright spec，某条「只有一个项目 / 项目数恰好为 N」的断言莫名变红，单跑又绿——先读这条，别急着改代码。

## 事实

两个独立问题叠在一起。

**一、`projectOwnership` 守卫看不见没有 workspace 的项目。** `packages/app/e2e/support/fixtures.ts:82` 的自动 fixture 用 `fetchWorkspaces().entries.map(w => w.projectId)` 求前后差集来判定泄漏（`:84-97`）。一个**没有任何 workspace 的项目**不在 `entries` 里，于是守卫认为没泄漏，项目留在 daemon 上。

**二、隔离单位是 worker，不是 spec 文件。** `docs/testing.md` 写「Spec files run concurrently without exposing one file's projects ... to another worker」。前半句的隔离在 worker 层，同一 worker 里的多个 spec 文件共享一个 daemon 与 `BYSPACE_HOME`，所以上一个文件留下的空项目，下一个文件数得到。

复现（本地默认单 worker）：

```bash
cd packages/app
npx playwright test --project=browser \
  e2e/browser/empty-project-persists.spec.ts \
  e2e/browser/sidebar-project-filter.spec.ts
```

`sidebar-project-filter.spec.ts` 的 `hides the filter row when there is only one project` 变红：`sidebar-display-project-filter` 行出现了，因为侧栏数到两个项目。失败时的页面快照里那个多余的项目就是 `empty-project-add-*`——`empty-project-persists.spec.ts` 里专门验证「项目在没有 workspace 时也要活下来」的用例留下的，它的主题就是残留。

两个文件各自单跑都绿。已确认与本次改动无关：在干净树上（`git stash` 掉全部改动）同样复现。`sidebar-workspace` + `sidebar-project-filter` 不复现；最小组合就是上面这两个文件。

## 怎么用

- 跑多个 spec 时看到「单跑绿、合跑红」，先怀疑这个。用 `--grep` 或单文件跑确认，不要直接改产品代码。
- 写「只有一个项目 / 项目数恰好为 N」这类断言时，别依赖「我前面没人」：断言前先清掉无关项目，或把文件放到 `empty-project-persists` 之外。
- 别因为 CI 绿就认为本地那次是幻觉。CI 用 `E2E_WORKERS=2` 分片，文件与 worker 的绑定与本地单 worker 不同，同一失败未必出现。
- 新增「以残留为断言对象」的用例时，它天然与「数项目个数」的断言互斥；要么清理干净，要么在注释里写清它有意留下什么。

## 边界

- 没验证 worker 之间是否真的完全隔离；这条只覆盖「同一 worker 内、文件之间」。
- 没验证 `projectOwnership` 守卫对「有 workspace 但项目被归档」等其他残留形态是否有效，只确认了「零 workspace 的项目」这一种绕过。
