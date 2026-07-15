---
name: upstream-sync
description: Synchronize BySpace with its getpaseo/paseo upstream. Use whenever the user asks to check, review, sync, pull, merge, cherry-pick, or inspect upstream/Paseo updates, asks what changed upstream, or wants to advance the upstream cursor. Enforces complete commit accounting, user approval, isolated replay, Web-only boundaries, and durable cursor updates.
---

# BySpace upstream sync

Synchronize behavior selectively; never merge upstream product scope wholesale.

## Read first

1. `docs/upstream-sync.md`
2. `.byspace/upstream-sync.json`
3. The current CodeStable epic and upstream-review issue when `.cs/` exists
4. Relevant product/provider docs for commits under review

The JSON cursor is authoritative. `lastReviewedCommit` means every upstream commit through that SHA has a recorded disposition, not that every commit was applied.

## Hard gates

- Fetch `upstream/main` with `--no-tags`; never import or push upstream tags.
- Freeze full `COMMIT1` and `COMMIT2` SHAs before review. Do not move the endpoint mid-review.
- Materialize every commit in `COMMIT1..COMMIT2`.
- Give every SHA exactly one disposition: inherited, apply full, port partial, defer, or skip.
- Show the user every SHA exactly once in a grouped summary and prove coverage.
- Do not replay implementation commits before explicit user approval.
- Replay an approved sequence in an isolated worktree before touching `main`.
- Never restore Electron, native iOS/Android, in-app Browser, or marketing website while resolving conflicts.
- Never blindly take upstream versions of lifecycle, protocol, Provider, session, WebSocket, App root, stream, composer, sidebar, settings, pairing, i18n, or release files.
- After the BySpace naming migration, translate upstream names into current `BySpace/byspace/BYSPACE_*` identifiers. Do not reintroduce old-name aliases.

## Workflow

### 1. Freeze

```bash
git fetch --no-tags upstream main:refs/remotes/upstream/main
```

Read `COMMIT1` from `.byspace/upstream-sync.json` and `COMMIT2` from `upstream/main`. Record both and the `git rev-list --count` result in the issue before inspecting individual commits.

### 2. Build the complete ledger

For each commit, inspect its message, file list, and relevant diff. Record:

- behavior and user impact;
- retained versus excluded surfaces;
- dependencies on other commits;
- conflicts with current BySpace;
- recommended disposition and risk;
- focused verification needed.

Treat strategically aligned but difficult features as `defer` or `partial`, not silent skips.

### 3. Present the approval artifact

Group commits into inherited, bugfix/core, feature/UX, deferred bundles, and excluded release/maintenance work. Every group lists all of its SHAs. End with counts and a uniqueness/coverage check.

Wait for an explicit approval set. If the user approves all commits or any high-risk lifecycle/protocol/Provider/UI bundle, restate the high-risk plan before replay.

### 4. Scratch replay

Create a temporary branch/worktree from current `main`. Replay in upstream order:

- Full ports use `cherry-pick -x` where the patch fits.
- Partial ports make a local commit whose message names the full source SHA and omitted surfaces.
- Keep one writer in the scratch worktree.
- Build workspace declarations before diagnosing cross-package type failures.

Run focused tests as each responsibility lands. For high-risk batches, explicitly cover Pi normal/local turns, cancellation races, Provider subagents, ACP spontaneous updates, protocol compatibility, timeline behavior, and the changed Web flow.

### 5. Review and promote

Run typecheck, lint, formatting, retained builds, Web export, and `git diff --check`. Ask independent read-only reviewers to inspect `main...scratch`. Resolve every blocker and add regression tests for review-discovered bugs.

Only then fast-forward `main` to the validated scratch branch.

### 6. Advance durable state

Append one batch to `.byspace/upstream-sync.json` containing the frozen range, issue, decisions, upstream-to-local commit mappings, and review hardening commits. Set `cursor.lastReviewedCommit` to the frozen `COMMIT2`, even when the final commit was skipped.

Run:

```bash
npm run upstream:check
```

Commit the cursor, docs, and implementation together. Report deferred bundles and residual risks; do not close the CodeStable issue unless the user asked for close-out.

## Required report

- Frozen range and count
- Complete grouped SHA ledger
- Approved versus deferred/skipped actions
- Scratch replay path and resulting local commits
- Tests/builds/reviews run
- Updated cursor path and value
- Deferred bundles and risks
