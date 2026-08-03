---
name: upstream-sync
description: Synchronize current BySpace main with a newer frozen getpaseo/paseo release by selecting the release-level delta with the user, then faithfully copying approved upstream code with only mechanical BySpace adaptations. Use for any upstream/Paseo check, comparison, review, update, pull, merge, sync, or adoption request.
---

# Sync BySpace with upstream

Port one upstream release delta onto the current BySpace tree. The current BySpace `main` is always the implementation base.

This skill transfers approved upstream code; it does not redesign, harden, or improve upstream behavior. The user owns every product or architecture decision discovered during the transfer.

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

Account for every relevant part of the upstream release delta with one of these outcomes:

- **Port** — copy the approved upstream behavior with only mechanical BySpace adaptations.
- **Already present** — BySpace independently has equivalent behavior; add nothing.
- **Excluded surface** — belongs only to Electron, native iOS/Android, marketing website, Browser automation, or another unsupported authority; skip it and any wiring used only by it.
- **Superseded by BySpace** — conflicts with a previously documented BySpace decision. Do not invent a new superseding design during sync.
- **Needs user decision** — copying is not mechanical, upstream appears defective, or behavior conflicts with BySpace. Stop before implementation, present the evidence and choices, and wait. An unresolved decision blocks baseline advancement; an explicit user choice to Port, Exclude, or handle separately resolves it.

Do not create a per-commit ledger. Dispositions are by behavior and retained subsystem, using the release diff as evidence.

## Workflow

1. Require a clean current BySpace `main`; fetch `origin/main` and record its exact SHA without changing it.
2. Read the recorded upstream baseline and verify that its tag, commit, and tree are available in a disposable upstream checkout.
3. Discover the newest candidate release, then freeze `TARGET_TAG`, `TARGET_COMMIT`, and `TARGET_TREE`.
4. Compare `BASE..TARGET` by retained subsystem: protocol, persistence, lifecycle, Providers/Pi, terminal, Git/worktrees, Web, Relay, packaging, dependencies, and security.
5. Identify changes tied to excluded surfaces and cross-layer dependencies that must not be resurrected.
6. Present the frozen target, impact, risks, and proposed dispositions; wait for explicit target and disposition approval.
7. Prove the unmodified target with its own clean install, server build, typecheck, and Web build.
8. Create an isolated persistent worktree from the recorded current BySpace `main` SHA.
9. Copy each approved Port from upstream as directly as possible. Apply only the mechanical BySpace adaptations listed above.
10. If direct copying exposes an upstream defect, architecture conflict, unclear compatibility choice, or additional responsibility, stop that slice and ask the user before writing a solution.
11. Import only dependency and lockfile changes required by copied behavior. Rebuild workspace declarations before diagnosing cross-package type errors.
12. Run the upstream tests that cover copied behavior plus focused adaptation tests; then run the complete gates in `docs/upstream-sync.md`.
13. Audit only transfer fidelity and fixed BySpace boundaries: no omitted approved code, accidental redesign, excluded client, old identity, upstream package namespace, port, home path, deployment target, or release-channel regression.
14. Obtain independent reviews limited to: copied-versus-upstream fidelity, approved dispositions, mechanical adaptation scope, excluded-surface leakage, and fixed release boundaries. Reviewers must not propose upstream improvements or new hardening as sync blockers.
15. Fix transfer mistakes. Classify a discovered upstream defect or desirable improvement as **Needs user decision**; do not implement it automatically. Only then update the recorded upstream baseline.
16. Push the sync branch and run the full `CI` workflow on its exact SHA (PR to `main` or `workflow_dispatch`). The baseline marker rides in the sync branch, so it can only reach `main` together with green CI evidence.
17. Present the candidate SHA, CI result, validation, dispositions, user decisions, and residual upstream concerns. With user approval, fast-forward `main` to the exact CI-green SHA and push. Never merge a red or unverified candidate into `main`.
18. Stop after source convergence. Use `release-beta` or `release-stable` only for a separate explicit shipping request.

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

Report:

- current BySpace base SHA;
- upstream baseline and frozen target tag, commit, and tree;
- unmodified-target baseline result;
- release-delta summary and dispositions;
- candidate commits and changed retained subsystems;
- focused tests, full gates, and fidelity/boundary reviews;
- every **Needs user decision** item, the user's recorded choice, and unresolved upstream concerns;
- exact statement of any remote or production mutation.
