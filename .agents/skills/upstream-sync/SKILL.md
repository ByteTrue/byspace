---
name: upstream-sync
description: Synchronize current BySpace main with a newer frozen getpaseo/paseo release: first present every upstream feature, fix, and change with a recommendation and reason, then faithfully copy the user-approved release delta with only mechanical BySpace adaptations. Use for any upstream/Paseo check, comparison, review, update, pull, merge, sync, or adoption request.
---

# Sync BySpace with upstream

Port one upstream release delta onto the current BySpace tree. The current BySpace `main` is always the implementation base.

First explain the release in user terms: enumerate what upstream added, fixed, or changed; give a recommendation and reason for every item; then end with a concise summary and only the decisions that require the user. After approval, transfer the selected upstream code without redesigning, hardening, or improving it.

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
- Do not merge, rebase, or cherry-pick upstream. Copy approved behavior as BySpace-authored commits so public ancestry and contributor identity stay BySpace-owned.
- Do not redo BySpace identity migration, client deletion, packaging, or release infrastructure. They are existing product invariants; only stop new upstream changes from violating them.
- Keep current `main`, npm, Cloudflare, `~/.byspace`, and port `6777` untouched during candidate work.
- Keep one writer. Use independent reviewers read-only.
- Freeze the approved disposition before implementation. After approval, do not silently change a behavior from Port to Superseded, Needs user decision, or a downstream redesign.
- For an approved Port, preserve upstream behavior and code structure as closely as the retained BySpace tree permits.
- Only deterministic mechanical adaptations may be made without asking: BySpace names/imports/package paths, removal of wiring used only by excluded surfaces, and direct compile/test adjustments caused by those edits.
- Stop and ask before any non-mechanical change: new state, schema, RPC, fallback, policy, UX, architecture, broader compatibility layer, bug fix, hardening, or behavior that has more than one reasonable implementation.
- If upstream code appears buggy or unsafe, report the exact upstream behavior and options. Do not repair it during sync unless the user explicitly chooses that work.
- Syncing source does not publish a release. Never tag, publish, deploy, or restart production as part of this skill.

## Delta dispositions

Account for every relevant part of the upstream release delta with one internal outcome:

- **Port** — copy the approved upstream behavior with only mechanical BySpace adaptations.
- **Already present** — BySpace independently has equivalent behavior; add nothing.
- **Excluded surface** — belongs only to Electron, native iOS/Android, marketing website, Browser automation, or another unsupported authority; skip it and any wiring used only by it.
- **Superseded by BySpace** — conflicts with a previously documented BySpace decision. Do not invent a new superseding design during sync.
- **Needs user decision** — copying is not mechanical, upstream appears defective, or behavior conflicts with BySpace. Stop before implementation, present the evidence and choices, and wait. An unresolved decision blocks baseline advancement; an explicit user choice to Port, Exclude, or handle separately resolves it.

These labels are the audit ledger, not the primary user-facing report. Translate them into direct recommendations: **建议采纳**, **BySpace 已有，无需重复**, **建议不采纳**, or **需要你决定**.

Do not create a per-commit ledger. Dispositions are by behavior and retained subsystem, using the release diff as evidence. Maintain a separate commit/file coverage index so the user-facing simplification cannot hide an omitted change.

## First user-facing decision report

The first approval checkpoint must be a change-by-change release review, not a taxonomy dump or a subsystem summary.

1. Start directly with the numbered change list under plain-language headings: **新增功能**, **问题修复**, **体验调整**, and **工程、依赖与发布变化**. Omit an empty heading. Put baseline → target context in the report title or later audit evidence, not in a preamble before the changes.
2. Split independent behaviors even when they share a commit. Combine files/commits only when they implement one inseparable user or system behavior.
3. For every numbered item, report in this order:
   - **上游改了什么** — concrete before/after behavior, not a commit-title paraphrase;
   - **影响** — which user, API, runtime, or operational path changes;
   - **我的意见** — exactly one of 建议采纳 / BySpace 已有，无需重复 / 建议不采纳 / 需要你决定; include the internal disposition in parentheses only when useful;
   - **原因** — product fit, existing BySpace behavior, excluded boundary, compatibility risk, or upstream defect;
   - **BySpace 处理** — only when a mechanical adaptation or preserved invariant matters.
4. Keep commit/file evidence in a compact trailing **依据** line. After the complete list, add compact **审计依据** covering frozen coordinates, complete coverage, independent review, and target build status. Evidence must support the recommendations without obscuring the behavior.
5. Then add **精炼总结** with counts by recommendation and the few highest-impact outcomes.
6. End the report with **需要你介入**: list only genuine product, architecture, security, or compatibility choices, each with the recommended default and consequences. If there are none, say so explicitly. Then provide one approval shortcut such as `按建议冻结`; the user may override individual numbered items. Nothing follows this section.

The detailed list must account for every behavior in the internal ledger, including excluded and release-only changes. Do not make the user reconstruct features and fixes from Port/Excluded labels, commit hashes, or file manifests.

## Workflow

1. Require a clean current BySpace `main`; fetch `origin/main` and record its exact SHA without changing it.
2. Read the recorded upstream baseline and verify that its tag, commit, and tree are available in a disposable upstream checkout.
3. Discover the newest candidate release, then freeze `TARGET_TAG`, `TARGET_COMMIT`, and `TARGET_TREE`.
4. Build the complete behavior inventory from the aggregate `BASE..TARGET` diff and release notes. Compare retained subsystems: protocol, persistence, lifecycle, Providers/Pi, terminal, Git/worktrees, Web, Relay, packaging, dependencies, and security.
5. Identify excluded-surface changes and cross-layer dependencies that must not be resurrected. Give every behavior an internal disposition and prove complete commit/file coverage.
6. Obtain an independent read-only classification review that checks for omissions, cross-subsystem conflicts, whole-commit misclassification, and incorrect Already present/Superseded claims. Fix the ledger before showing it as final.
7. Present the first user-facing decision report in the required format above and wait for explicit target and disposition approval. A long target build may run concurrently, but it must not delay this first explanation unless buildability changes a recommendation.
8. Prove the exact unmodified target with its own clean install, server build, typecheck, and Web build before copying code.
9. Freeze the approved dispositions. Do not begin implementation while any **需要你决定** item is unresolved.
10. Create an isolated persistent worktree from the recorded current BySpace `main` SHA.
11. Copy each approved Port from upstream as directly as possible. Apply only the mechanical BySpace adaptations listed above.
12. If direct copying exposes an upstream defect, architecture conflict, unclear compatibility choice, or additional responsibility, stop that slice and ask the user before writing a solution.
13. Import only dependency and lockfile changes required by copied behavior. Rebuild workspace declarations before diagnosing cross-package type errors.
14. Run the upstream tests that cover copied behavior plus focused adaptation tests; then run the complete gates in `docs/upstream-sync.md`.
15. Audit only transfer fidelity and fixed BySpace boundaries: no omitted approved code, accidental redesign, excluded client, old identity, upstream package namespace, port, home path, deployment target, or release-channel regression.
16. Obtain independent reviews limited to copied-versus-upstream fidelity, approved dispositions, mechanical adaptation scope, excluded-surface leakage, and fixed release boundaries. Reviewers must not propose upstream improvements or new hardening as sync blockers.
17. Fix transfer mistakes. Classify a discovered upstream defect or desirable improvement as **Needs user decision**; do not implement it automatically. Only then update the recorded upstream baseline.
18. Push the sync branch and run the full `CI` workflow on its exact SHA (PR to `main` or `workflow_dispatch`). The baseline marker rides in the sync branch, so it can only reach `main` together with green CI evidence.
19. Present the candidate SHA, CI result, validation, approved change list, user decisions, and residual upstream concerns. With user approval, fast-forward `main` to the exact CI-green SHA and push. Never merge a red or unverified candidate into `main`.
20. Stop after source convergence. Use `release-beta` or `release-stable` only for a separate explicit shipping request.

## Worktree lifecycle

- Treat every sync worktree and disposable upstream checkout as temporary process resources, not durable project directories.
- Before creating one, record its absolute path, purpose, owning branch, base SHA, and whether it is a candidate or a read-only worker.
- Use persistent sibling worktrees when a long-lived candidate needs them, but do not leave them as the default final state. Parallel worker worktrees must have one writer and an explicit owner.
- Before integration, inventory every sync worktree and checkout with its path, branch/HEAD, clean or dirty state, and uncommitted file summary.
- After the exact-SHA CI-green candidate is integrated, remove every clean worktree whose commits are integrated or explicitly archived with `git worktree remove`. Remove clean disposable upstream checkouts as well.
- Never delete a dirty worktree, force-remove it, commit its changes, or silently discard its untracked files. Preserve it and present the changed-file/stat summary for an explicit user decision.
- Do not delete local sync branches automatically; branch retention is separate from bulky worktree cleanup.
- Run `git worktree prune` after removals, then verify `git worktree list` and the repository's sibling directory inventory. The sync is not operationally closed while stale worktrees or disposable checkouts remain unexplained.

## Failure discipline

- Treat a timeout as evidence, not restart permission.
- Never patch inferred types merely because generated workspace declarations are stale; rebuild the owning stack first.
- Never delete or regenerate the lockfile to escape conflicts. Preserve unrelated resolved dependency versions.
- If direct copying requires anything beyond deterministic mechanical adaptation, stop before implementing and ask the user.
- Treat possible upstream bugs, security concerns, architecture weaknesses, and desirable hardening as observations, not permission to change code.
- A review finding blocks the sync only when the approved upstream code was copied incorrectly, omitted, or leaked across a fixed BySpace boundary. All other findings go to the user for disposition.
- If upstream changed an excluded surface and a retained shared module together, copy only the clearly separable retained code; if separation requires design judgment, stop and ask.
- If the baseline marker is wrong or incomplete, stop and repair the evidence before applying code.

## Required result

At the first approval checkpoint, report in this order:

1. the complete numbered upstream change list, grouped as new features, fixes, experience changes, and engineering/release changes, with a recommendation and reason on every item;
2. compact audit evidence: baseline → target, frozen coordinates, complete-coverage result, independent classification review, and unmodified-target build result if already available;
3. concise recommendation-count summary and highest-impact outcomes;
4. only the items that require user intervention, with recommended defaults and an approval shortcut; this is the final section.

At final handoff, additionally report:

- current BySpace base SHA;
- upstream baseline and frozen target tag, commit, and tree;
- unmodified-target baseline result;
- approved change list and recorded dispositions;
- candidate commits and changed retained subsystems;
- focused tests, full gates, and fidelity/boundary reviews;
- every **Needs user decision** item, the user's recorded choice, and unresolved upstream concerns;
- exact statement of any remote or production mutation.
