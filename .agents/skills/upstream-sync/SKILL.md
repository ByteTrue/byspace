---
name: upstream-sync
description: Synchronize the current BySpace main branch with a newer frozen getpaseo/paseo release by reviewing and porting the release-level delta while preserving BySpace behavior, Web-only boundaries, identity, distribution, and Stable/Beta channels. Use for any upstream/Paseo check, comparison, review, update, pull, merge, sync, or adoption request.
---

# Sync BySpace with upstream

Port one upstream release delta onto the current BySpace tree. The current BySpace `main` is always the implementation base.

## Read first

Read these files completely:

1. `docs/upstream-sync.md`
2. `docs/release-engineering.md`
3. `docs/product.md`
4. `docs/architecture.md`
5. `docs/release.md`

Treat `docs/upstream-sync.md` as the process source of truth.

## Hard gates

- Default to a stable Paseo release tag. Require explicit approval for a prerelease tag or arbitrary commit.
- Read the current upstream baseline from `docs/upstream-sync.md`; freeze and report both baseline and target tag, commit SHA, and tree SHA.
- Inspect upstream in a disposable clone or dedicated local fork. Do not import upstream tags or ancestry into BySpace.
- Prove the exact unmodified upstream target builds before porting its changes.
- Create the candidate from the current, clean BySpace `main`, never from the upstream target tree.
- Review the aggregate upstream `BASE..TARGET` release delta. Commit history is navigation evidence, not a queue to replay.
- Do not merge, rebase, or cherry-pick upstream. Port applicable behavior as BySpace-authored commits so public ancestry and contributor identity stay BySpace-owned.
- Do not redo BySpace identity migration, client deletion, packaging, or release infrastructure. They are existing product invariants; only stop new upstream changes from violating them.
- Keep current `main`, npm, Cloudflare, `~/.byspace`, and port `6777` untouched during candidate work.
- Keep one writer. Use independent reviewers read-only.
- Syncing source does not publish a release. Never tag, publish, deploy, or restart production as part of this skill.

## Delta dispositions

Account for every relevant part of the upstream release delta with one of these outcomes:

- **Port** — needed by a retained BySpace subsystem.
- **Already present** — BySpace independently has equivalent or stronger behavior; add nothing.
- **Excluded surface** — belongs only to Electron, native iOS/Android, marketing website, Browser automation, or another unsupported authority; skip it and any wiring used only by it.
- **Superseded by BySpace** — conflicts with a deliberate BySpace product, protocol, security, packaging, or release decision; preserve BySpace and port only compatible fixes.
- **Deferred** — valuable but unsafe or too broad for this sync; require explicit user approval, record the reason, and do not advance the integrated upstream baseline while it remains unresolved.

Do not create a per-commit ledger. Dispositions are by behavior and retained subsystem, using the release diff as evidence.

## Workflow

1. Require a clean current BySpace `main`; fetch `origin/main` and record its exact SHA without changing it.
2. Read the recorded upstream baseline and verify that its tag, commit, and tree are available in a disposable upstream checkout.
3. Discover the newest candidate release, then freeze `TARGET_TAG`, `TARGET_COMMIT`, and `TARGET_TREE`.
4. Compare `BASE..TARGET` by retained subsystem: protocol, persistence, lifecycle, Providers/Pi, terminal, Git/worktrees, Web, Relay, packaging, dependencies, and security.
5. Identify changes tied to excluded surfaces and cross-layer dependencies that must not be resurrected.
6. Present the frozen target, impact, risks, and proposed dispositions; wait for target approval.
7. Prove the unmodified target with its own clean install, server build, typecheck, and Web build.
8. Create an isolated persistent worktree from the recorded current BySpace `main` SHA.
9. Port the approved release delta in small vertical slices. Preserve current BySpace behavior unless the upstream change intentionally fixes or replaces it.
10. Import only dependency and lockfile changes required by ported behavior. Rebuild workspace declarations before diagnosing cross-package type errors.
11. Run focused tests after each slice, then the complete gates in `docs/upstream-sync.md`.
12. Audit that no excluded client, old identity, upstream package namespace, port, home path, deployment target, or release-channel regression was introduced.
13. Obtain independent reviews for delta completeness, product boundary, persistence/protocol trust, package graph, and release-channel non-regression.
14. Resolve every review blocker and every deferred retained behavior. Only then update the recorded upstream baseline.
15. Present the candidate SHA, normal commit/push plan, validation, dispositions, and residual risks. Push or merge only with user approval.
16. Stop after source convergence. Use `release-beta` or `release-stable` only for a separate explicit shipping request.

## Failure discipline

- Treat a timeout as evidence, not restart permission.
- Never patch inferred types merely because generated workspace declarations are stale; rebuild the owning stack first.
- Never delete or regenerate the lockfile to escape conflicts. Preserve unrelated resolved dependency versions.
- If a port requires architecture or data-safety hardening outside the approved delta, report the scope expansion before implementing it.
- If upstream changed an excluded surface and a retained shared module together, port the shared fix without restoring the excluded authority.
- If the baseline marker is wrong or incomplete, stop and repair the evidence before applying code.

## Required result

Report:

- current BySpace base SHA;
- upstream baseline and frozen target tag, commit, and tree;
- unmodified-target baseline result;
- release-delta summary and dispositions;
- candidate commits and changed retained subsystems;
- focused tests, full gates, and independent reviews;
- deferred items, whether they block baseline advancement, and residual risks;
- exact statement of any remote or production mutation.
