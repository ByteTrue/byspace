---
name: upstream-sync
description: "Synchronize current BySpace main with a newer frozen getpaseo/paseo release: first present every upstream feature, fix, and change with a recommendation and reason, then faithfully copy the user-approved release delta with only mechanical BySpace adaptations. Use for any upstream/Paseo check, comparison, review, update, pull, merge, sync, or adoption request."
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
- Do not redo BySpace identity migration or flatten maintained platform boundaries. Browser Web/PWA, shared Android/iOS, Electron Desktop, Desktop Browser automation, and their tests/build/package/release source are retained surfaces even when public distribution is gated.
- Keep current `main`, npm, Cloudflare, `~/.byspace`, and port `6777` untouched during candidate work.
- Keep one writer. Use independent reviewers read-only.
- Freeze the approved disposition before implementation. After approval, do not silently change a behavior from Port to Superseded, Needs user decision, or a downstream redesign.
- For an approved Port, preserve upstream behavior and code structure as closely as the retained BySpace tree permits.
- Do not treat an inherited BySpace test, helper, comment, or runtime branch as proof of an intentional downstream contract. Preserve divergence only when docs, an active BySpace-specific path, or Git provenance proves it was deliberate; otherwise follow the frozen target.
- Only deterministic mechanical adaptations may be made without asking: BySpace names/imports/package paths/app identifiers, removal of wiring used only by explicitly documented excluded product paths, and direct compile/test adjustments caused by those edits.
- Stop and ask before any non-mechanical change: new state, schema, RPC, fallback, policy, UX, architecture, broader compatibility layer, bug fix, hardening, or behavior that has more than one reasonable implementation.
- If upstream code appears buggy or unsafe, report the exact upstream behavior and options. Do not repair it during sync unless the user explicitly chooses that work.
- Syncing source does not publish a release. Never tag, publish, deploy, or restart production as part of this skill.

## Implementation efficiency

The audit is exhaustive; implementation is intentionally coarse-grained. Once the release inventory and dispositions are approved:

- Implement coherent capability batches, not one upstream commit, file, hunk, test, or styling token at a time. Each batch owns a complete user/system capability, its dependency closure, and its support tests.
- Size a batch so one writer can finish it in one bounded run. Near the execution budget, finish and commit the coherent subset, hand off remaining owners, and stop exploring instead of leaving a broad dirty tree or forcing an overrun.
- Build the execution map once. Do not remap an approved slice before every batch or turn the coverage ledger into a construction queue. Use deep provenance work only for a real patch conflict, failing test, or suspected intentional BySpace seam.
- Include a deterministic prerequisite from the same approved release in its capability batch when the frozen target has one obvious end state. Ask only when more than one reasonable product or architecture outcome exists.
- Keep one candidate writer. Parallelize read-only inventory/review work, not overlapping candidate edits.
- Verify once per completed batch: affected upstream/adaptation tests, then typecheck, lint, and format. Build server/cross-workspace declarations only for batches that cross those boundaries. Export Web once after the aggregate shared-App stage and run the documented prebuild/build smoke for each affected Android/iOS/Electron surface.
- Run the complete local gate matrix, maintained-client source-closure checks, and `release:check` once on the finished candidate. Never run the full local test suite.
- Review high-risk capability batches or the aggregate candidate; do not commission an independent review for every micro-change.
- Report progress from existing Git state and command artifacts. Status reporting must not rerun tests, builds, exports, or global scans.

## Delta dispositions

Account for every relevant part of the upstream release delta with one internal outcome:

- **Port** — copy the approved upstream behavior with only mechanical BySpace adaptations.
- **Already present** — BySpace independently has equivalent behavior; add nothing.
- **Excluded surface** — belongs only to a product path explicitly excluded by the current Project Spec (currently replacement of BySpace's existing website with Paseo's marketing-site implementation, or a separately documented superseded path); skip it and wiring used only by it. Platform or distribution status alone is not an exclusion.
- **Superseded by BySpace** — conflicts with a previously documented BySpace decision. Do not invent a new superseding design during sync.
- **Needs user decision** — copying is not mechanical, upstream appears defective, or behavior conflicts with BySpace. Stop before implementation, present the evidence and choices, and wait. An unresolved decision blocks baseline advancement; an explicit user choice to Port, Exclude, or handle separately resolves it.

These labels are the audit ledger, not the primary user-facing report. Translate them into direct recommendations: **建议采纳**, **BySpace 已有，无需重复**, **建议不采纳**, or **需要你决定**.

Do not create a per-commit ledger. Dispositions are by behavior and retained subsystem, using the release diff as evidence. Maintain a separate commit/file coverage index so the user-facing simplification cannot hide an omitted change, but use that index only as audit evidence—never as an implementation queue.

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
4. Build the complete behavior inventory from the aggregate `BASE..TARGET` diff and release notes. Compare retained subsystems: protocol, persistence, lifecycle, Providers/Pi, terminal, Git/worktrees, Browser Web/PWA, shared Android/iOS, Electron/Desktop Browser, Relay, native modules, E2E, packaging, platform workflows, dependencies, and security.
5. Identify only explicitly documented excluded-product changes and their cross-layer dependencies. Never classify Android, iOS, Electron, Browser automation, or dormant platform release source as excluded merely because it is not publicly distributed. Give every behavior an internal disposition and prove complete commit/file coverage.
6. Obtain an independent read-only classification review that checks for omissions, cross-subsystem conflicts, whole-commit misclassification, and incorrect Already present/Superseded claims. Fix the ledger before showing it as final.
7. Present the first user-facing decision report in the required format above and wait for explicit target and disposition approval. A long target build may run concurrently, but it must not delay this first explanation unless buildability changes a recommendation.
8. Prove the exact unmodified target with its own clean install, server build, typecheck, Web build, Android/iOS prebuild, Desktop main build, and current-host unsigned package smoke before copying code. Assign unavailable foreign-platform artifact proof to exact-SHA CI.
9. Freeze the approved dispositions. Do not begin implementation while any **需要你决定** item is unresolved.
10. Create an isolated persistent worktree from the recorded current BySpace `main` SHA.
11. Group approved Ports into a few dependency-safe capability batches, then copy each batch directly. Transfer the complete support slice too: tests, shared E2E helpers, fixtures, factories, benchmarks, generated assets, smoke expectations, and removal residuals. Apply only the mechanical BySpace adaptations listed above.
12. If direct copying exposes an upstream defect, architecture conflict, unclear compatibility choice, or additional responsibility, stop that slice and ask the user before writing a solution.
13. Import only dependency and lockfile changes required by copied behavior. Rebuild workspace declarations before diagnosing cross-package type errors. Adapt new `COMPAT(...)` markers to the actual first BySpace release and cleanup date; never copy an upstream version marker or guess an unknown BySpace release.
14. At the end of each capability batch, run its upstream tests plus focused adaptation tests and the batch-level gates defined in `docs/upstream-sync.md`. Classify failures before editing. Run the complete gate matrix only after all batches are assembled.
15. Audit only transfer fidelity and fixed BySpace boundaries: no omitted approved code or support files, accidental redesign, omitted/stubbed maintained client, old identity, upstream package namespace, port, home path, app identifier, deployment target, release-channel regression, stale removed-feature references, or inconsistent compatibility markers.
16. Obtain independent review of high-risk aggregate batches or the finished candidate, limited to copied-versus-upstream fidelity, approved dispositions, mechanical adaptation scope, incorrect maintained-platform exclusion, explicitly excluded-product leakage, and fixed release boundaries. Do not review every micro-change independently; reviewers must not propose upstream improvements or new hardening as sync blockers.
17. Fix transfer mistakes. Classify a discovered upstream defect or desirable improvement as **Needs user decision**; do not implement it automatically. Only then update the recorded upstream baseline.
18. Push the sync branch and run the full `CI` workflow on its exact SHA (PR to `main` or `workflow_dispatch`). The baseline marker rides in the sync branch, so it can only reach `main` together with green CI evidence. For every red run, record failure → provenance → action → focused proof → replacement SHA, then rerun the complete matrix; deterministic platform failures cannot be waived by a lucky rerun.
19. Present the candidate SHA, CI result, validation, approved change list, user decisions, and residual upstream concerns. With user approval, fast-forward `main` to the exact CI-green SHA and push. Never merge a red or unverified candidate into `main`.
20. Stop after source convergence. Use `release-beta` or `release-stable` only for a separate explicit shipping request.

## Provenance-first failure triage

A red test says the candidate and expectation disagree; it does not say which side is authoritative. Before editing production behavior:

1. Find the earliest causal failure. Check whether a failed assertion left a deferred operation unresolved, a lifecycle lock held, a scheduler queue blocked, or a watcher half-started; later timeouts may be fan-out noise.
2. Compare the frozen upstream baseline, frozen target (implementation, tests, and support files), BySpace immediately before the candidate, and the candidate diff.
3. Choose exactly one outcome:
   - **Follow target:** inherited baseline behavior changed upstream and no deliberate BySpace divergence is proven; update/remove stale BySpace tests instead of restoring old behavior.
   - **Preserve BySpace seam:** docs, Git provenance, or an active BySpace-only caller proves intent; keep it with the smallest adaptation and a focused test.
   - **Complete the transfer:** the target's test/helper/fixture/factory/benchmark/generated asset/smoke expectation was omitted; copy it.
   - **Stop for an upstream defect:** unchanged target reproduces the failure; ask before fixing it, even when the defect is only in a benchmark or test.
   - **Isolate the test:** focused passes but the full suite fails because a unit test reaches real global state; inject the external resolver/home/scheduler dependency without changing production defaults.
   - **Fix a platform seam:** inspect path case/separators, home resolution, watcher readiness, and teardown ordering; do not start by increasing timeouts or weakening assertions.
4. Run the smallest focused proof, then the required local gates, then the full exact-SHA matrix. Do not infer that a broad failure cluster has one cause without evidence, or patch every secondary timeout independently.

## Worktree lifecycle

- Treat every sync worktree and disposable upstream checkout as temporary process resources, not durable project directories.
- Before creating one, record its absolute path, purpose, owning branch, base SHA, and whether it is a candidate or a read-only worker.
- Use a persistent sibling worktree for the long-lived candidate, but do not leave it as the default final state. The candidate has one writer; parallel worktrees are for read-only audit/review or explicitly separate experiments, each with an owner.
- Before integration, inventory every sync worktree and checkout with its path, branch/HEAD, clean or dirty state, and uncommitted file summary.
- After the exact-SHA CI-green candidate is integrated, remove every clean worktree whose commits are integrated or explicitly archived with `git worktree remove`. Remove clean disposable upstream checkouts as well.
- Never delete a dirty worktree, force-remove it, commit its changes, or silently discard its untracked files. Preserve it and present the changed-file/stat summary for an explicit user decision.
- Do not delete local sync branches automatically; branch retention is separate from bulky worktree cleanup.
- Run `git worktree prune` after removals, then verify `git worktree list` and the repository's sibling directory inventory. The sync is not operationally closed while stale worktrees or disposable checkouts remain unexplained.

## Failure discipline

- Treat a timeout as evidence, not restart permission. Inspect the earliest failure and shared deferred/lock/queue state first.
- Treat inherited tests as provenance evidence, not automatic product requirements.
- Treat focused-pass/full-suite-fail as an isolation signal and platform-only failures as platform-seam signals; neither authorizes changing production behavior without proof.
- Never patch inferred types merely because generated workspace declarations are stale; rebuild the owning stack first.
- Never delete or regenerate the lockfile to escape conflicts. Preserve unrelated resolved dependency versions.
- If direct copying requires anything beyond deterministic mechanical adaptation, stop before implementing and ask the user.
- Treat possible upstream bugs, security concerns, architecture weaknesses, and desirable hardening as observations, not permission to change code.
- A review finding blocks the sync only when the approved upstream code was copied incorrectly, omitted, or leaked across a fixed BySpace boundary. All other findings go to the user for disposition.
- If upstream changed an explicitly excluded product path and a retained shared module together, copy only the clearly separable retained code; if separation requires design judgment, stop and ask. Never use this rule to strip Android/iOS/Electron/Browser callers from a shared change.
- If the baseline marker is wrong or incomplete, stop and repair the evidence before applying code.
- A worker/provider failure before edits is an execution failure, not a reason to rebuild the inventory. Confirm the tree is clean and retry the same capability batch.
- Run focused tests from their owning workspace before treating a root-only parse or alias error as a source defect.
- Reuse existing gate output in progress reports; never rerun expensive commands merely to produce status.

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
