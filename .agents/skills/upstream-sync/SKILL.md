---
name: upstream-sync
description: Sync ByteTrue/byspace with a user-approved getpaseo/paseo release tag. Use when checking for a new Paseo stable or prerelease, upgrading BySpace to an exact Paseo tag, preparing or continuing an upstream sync candidate, resolving Paseo merge conflicts, verifying a sync candidate, or creating and merging its PR after exact-SHA user acceptance. Do not use for dependency updates, ordinary Git merges, other repositories, releases, or deployments.
argument-hint: "[check|prepare|continue|verify|submit|merge] [tag, candidate SHA, or PR]"
user-invocable: true
---

# Upstream sync

Update `ByteTrue/byspace` with the complete diff between two accepted Paseo releases. Keep the process small: use standard Git diff/apply, with no custom sync engine, state file, helper script, release, or deployment.

## Non-negotiable rules

- Target only a user-confirmed `getpaseo/paseo` release tag and its peeled commit SHA. Never merge `upstream/main`, `latest`, or another moving ref.
- Fetch upstream tags with `--no-tags` into `refs/upstream/tags/<tag>`. Never fetch upstream tags into `refs/tags/*`; BySpace and Paseo can have same-named tags pointing to different commits.
- Freeze the peeled upstream target SHA and `origin/main` start SHA before creating anything. Use those SHAs throughout.
- Create `sync/paseo-<version>` and a separate worktree from the frozen `origin/main` SHA. Never sync in the main worktree.
- Apply the complete `LAST_UPSTREAM_SHA..UPSTREAM_TARGET_SHA` release diff. Never copy a release tree or cherry-pick selected upstream features.
- Do not auto-stash, reset, clean, delete worktrees, overwrite branches, or force-push a candidate. Unrelated dirty worktrees are reported but block only when they occupy this sync's branch or path.
- Synchronization may contain only the upstream merge, required conflict reconciliation, and minimal preservation of established BySpace boundaries. Do not add features, refactor, fix unrelated bugs, expand branding scope, alter release policy, publish, or deploy.
- Never run `paseo daemon stop` or `byspace daemon stop` on the development host. Use isolated homes, ports, worktrees, and caches for any runtime check.
- Follow repository verification rules: never run the full local test suite; build generated workspace declarations first, then run static checks and focused tests. PR CI supplies the broad matrix after acceptance.
- A pushed candidate is immutable while awaiting acceptance. Any new, amended, rebased, or rewritten commit creates a new candidate SHA and invalidates prior tests and acceptance.
- CI success is not user acceptance. No PR of any kind exists before the user explicitly accepts the exact full candidate SHA.
- PR creation does not authorize merge. Never enable auto-merge. Merge only after a second explicit user instruction, using a merge commit rather than squash or rebase.

## Operations

Infer the operation only when unambiguous. Before any write, state the operation and the changes it can make.

- `check`: read-only release and repository inspection. Do not fetch into the repository or create refs.
- `prepare`: freeze a confirmed target, create the branch/worktree, merge, reconcile, validate, push a candidate, and stop for acceptance.
- `continue`: resume the existing branch/worktree; do not create a replacement.
- `verify`: validate the current candidate without creating a PR.
- `submit`: after exact-SHA acceptance, create a PR and stop.
- `merge`: after separate explicit authorization and green checks, merge the unchanged PR with a merge commit.

Report one of: `checking`, `preparing`, `decision-needed`, `already-synced`, `awaiting-user-acceptance`, `accepted`, `pr-created`, or `merged`. These are report labels, not persisted state.

## `check`: discover without changing the repository

1. Confirm the checkout belongs to `ByteTrue/byspace`; inspect `origin`, `upstream`, current branch, `git status`, local/remote branches, and worktrees.
2. Confirm `upstream` resolves to `getpaseo/paseo`. Do not add or rewrite a remote during a read-only check.
3. Query GitHub releases, not a moving branch. If the user says only “latest,” list stable and prerelease candidates separately with tag, release type, publish time, URL, and resolved commit when available. Do not silently choose between them.
4. Compare candidates with the last Paseo release previously accepted into BySpace. Do not assume a release commit belongs to upstream `main`.
5. If a target-specific sync branch or worktree already exists, report its path, local SHA, remote SHA, cleanliness, and merge state; ask whether to continue it. Do not replace it.

`check` ends after reporting. A release selection made during `check` is not permission to write unless the request already explicitly says to prepare that exact tag.

## `prepare`: preflight and freeze

Before creating the sync branch:

1. Fetch `origin/main` only, without tags. Require the main worktree to be clean and local `main` to equal `origin/main`; report uncommitted or unpushed work and stop instead of fixing it.
2. List worktrees and matching local/remote sync branches. Unrelated dirty worktrees are informational. A same-target branch/worktree must be continued or explicitly discarded by the user.
3. Resolve the confirmed tag through GitHub and fetch only that tag into its namespaced ref, for example:

   ```bash
   git fetch --no-tags upstream \
     refs/tags/vX.Y.Z:refs/upstream/tags/vX.Y.Z
   ```

4. Peel the fetched tag explicitly:

   ```bash
   git rev-parse "refs/upstream/tags/vX.Y.Z^{commit}"
   ```

   Record the upstream tag object SHA, peeled target commit SHA, release URL, and frozen `origin/main` SHA. If GitHub, `ls-remote`, and the fetched ref disagree, stop.

5. If the target tag equals the previously accepted Paseo release, report `already-synced` and stop without creating a branch or candidate.
6. Find `LAST_UPSTREAM_SHA`: the exact commit of the most recent previously accepted Paseo release, using namespaced release refs and the prior sync record. If it is missing or ambiguous, show the candidates and ask the user; do not guess.
7. Read the target's `.tool-versions` before installing dependencies. Do not assume the previous Node/npm versions still apply.
8. Create the uniquely named branch and worktree from the frozen main SHA. Push only to explicit `origin`; never push to `upstream`.

Record this tuple in every progress report:

```text
upstream tag
upstream tag object SHA
UPSTREAM_TARGET_SHA
LAST_UPSTREAM_SHA
START_MAIN_SHA
sync branch
worktree path
```

Do not create a database or metadata file for it. Recover it from namespaced refs, the prior sync record, and the conversation when continuing; stop if recovery is ambiguous.

## Dual-change review: detect product conflicts Git can miss

A textual merge conflict is only one signal. Before choosing behavior, compare both sides from the previous upstream base with rename/copy detection:

```bash
git diff -M -C --name-status "$LAST_UPSTREAM_SHA".."$START_MAIN_SHA"
git diff -M -C --name-status "$LAST_UPSTREAM_SHA".."$UPSTREAM_TARGET_SHA"
```

Intersect changed paths to find review candidates, counting both old and new paths from rename/copy entries. Then inspect hunks, commit history, callers, tests, release notes, schemas, and user flows. Path overlap is only a lower bound: review known BySpace capability divergences against upstream release notes and history even when paths do not intersect. Same-file changes are not automatically semantic conflicts; independent changes may merge normally.

Enter `decision-needed` and stop whenever BySpace intentionally changed a capability and Paseo changed the same capability, even when Git merged it cleanly. Also stop when upstream removes or redesigns local behavior, upstream and local tests assert different product expectations, a local workaround may now be obsolete, or more than one user-visible result is reasonable.

Batch related decisions instead of interrupting for each hunk. For each capability report:

```text
capability
BySpace behavior and evidence
Paseo behavior and evidence
files and tests
textual conflict or clean semantic overlap
options and user impact
recommendation and reason
```

Do not resolve the capability until the user decides. Compilation convenience is not product intent, and prior acceptance of another target does not decide this target.

## Apply and reconcile

1. In the sync worktree, generate and apply the complete release interval:

   ```bash
   git diff --binary --full-index "$LAST_UPSTREAM_SHA".."$UPSTREAM_TARGET_SHA" > /tmp/paseo-release.patch
   git apply --3way --index /tmp/paseo-release.patch
   ```

   Keep every upstream interval change unless an approved BySpace boundary or semantic decision requires reconciliation.

2. For every textual conflict, inspect base, BySpace, and Paseo versions plus callers and tests. Never choose whole-file `ours` or `theirs` merely to finish.
3. Mechanical conflicts such as generated output, lockfiles, or version metadata may be resolved from authoritative source and regenerated with existing project commands. A conflict touching intentional product behavior follows the dual-change decision gate.
4. Audit conflict-free additions for violations of established BySpace boundaries: public BySpace identity, CLI and app IDs, `6777/6778` and `~/.byspace` coexistence, approved app/relay/Hub endpoints, ByteTrue publication ownership, single-package release staging, and supervisor daemon entrypoints.
5. For clear user-facing brand conflicts, preserve the established BySpace behavior and group the resolutions in the report. Do not use a sync to broaden the current rebrand—for example, do not introduce a new `byspace.json` migration while syncing. If a name is also a protocol, storage, SDK, plugin, Hub, or backwards-compatibility contract, stop for a user decision.
6. Preserve intentional internal/upstream compatibility names unless the current code already migrated that boundary, including internal `@getpaseo/*`, protocol/RPC identities, and internal storage namespaces. Never perform a global search-and-replace rebrand.
7. Make only the edits required by approved semantic decisions and established boundaries. Format manually edited files with existing npm scripts.
8. Commit the applied interval and reconciliations with a message such as `chore(sync): apply Paseo vX.Y.Z`. Record the exact `LAST_UPSTREAM_SHA..UPSTREAM_TARGET_SHA` interval in the commit body.

If an unmodified upstream target appears broken, reproduce only the failing command in a detached checkout of the exact target. If it fails there too, save the command and relevant log, report the upstream failure, and stop; do not repair upstream during the sync.

## Validate the candidate

Use project scripts and the target toolchain. In a fresh worktree, install once and generate workspace declarations before diagnosing cross-package errors. Run the minimum authoritative set:

1. focused tests for every conflict, approved semantic decision, and manually preserved boundary;
2. `npm run build:server` and `npm run build:app-deps` when required by the current repository;
3. `npm run typecheck`;
4. `npm run lint`;
5. `npm run format:check`;
6. `npm run release:check` when packaging inputs or workspace dependencies changed;
7. `actionlint` or existing workflow contract tests when workflows changed.

Do not run all Vitest or Playwright tests locally. Do not delete/skip a test to make the merge pass, treat a lucky rerun as a fix, or increase a timeout without measured duration evidence. Investigate CI failures before any targeted rerun; never reflexively rerun the whole matrix.

Use an isolated `TMPDIR` or cache for Expo/Metro build validation so another checkout cannot contaminate generated assets. Runtime acceptance must not start, stop, or reuse the installed Paseo/BySpace daemons or their state directories.

Finally verify and report:

```bash
git status --short
git diff "$START_MAIN_SHA"..HEAD
git diff "$UPSTREAM_TARGET_SHA"..HEAD
```

The first diff shows what this sync introduces. The second shows the complete BySpace delta that remains over the new upstream target.

## Push and wait for user acceptance

After successful local validation:

1. Require a clean worktree.
2. Record the full candidate commit SHA.
3. Push the sync branch to an explicit `origin` ref without force.
4. Verify the remote branch points to the same full SHA.
5. Make no further candidate changes.
6. Report branch, candidate SHA, start main SHA, upstream tag/object/target SHA, release URL, conflicts, semantic decisions, brand-boundary resolutions, every command and result, skipped checks and reasons, known issues, residual risks, fetch instructions, isolated launch instructions, and a focused user acceptance checklist.
7. Stop with `awaiting-user-acceptance`. Do not create even a draft PR and do not dispatch publication or deployment workflows.

Acceptance must unambiguously name the current full SHA, for example:

```text
I tested candidate <full SHA>; create the PR.
```

“Looks good,” “continue,” an approval of a branch name, or an approval of an older SHA is insufficient. Ask for clarification instead of inferring acceptance.

## `continue` and `verify`

For `continue`, locate the existing same-target branch and worktree, then report local/remote SHA, status, merge state, and the recovered frozen tuple. Continue from that state; do not create a second candidate. If refs diverge or the tuple cannot be proven, stop.

For `verify`, bind every result to `git rev-parse HEAD`, require that SHA to equal the remote candidate when one exists, and do not change files. If verification requires a fix, continue in the existing sync worktree under the merge/reconcile rules; do not repeat prepare preflight or create another branch/worktree. Create a new candidate SHA, rerun affected checks, push normally, and require new acceptance.

## `submit`: create the accepted PR

Only after explicit exact-SHA acceptance:

1. Verify the accepted SHA, local HEAD, and origin sync branch SHA are identical.
2. Verify `origin/main` still equals `START_MAIN_SHA`. If main moved, merge the new main into the candidate, revalidate, push a new SHA, and require acceptance again; do not create or update the PR.
3. Verify the candidate is clean and still contains the complete approved release interval.
4. Create a PR with base `main` and the accepted sync branch as head. Include upstream tag, target SHA, candidate SHA, start main SHA, conflict/decision summary, validation evidence, skipped checks, residual risk, and the accepted SHA.
5. Do not enable auto-merge, merge the PR, or push more commits. Stop with `pr-created` while PR CI runs.

PR CI is the broad verification pass. Do not duplicate it with a full pre-PR remote matrix unless the user explicitly requests that cost.

## `merge`: merge the accepted candidate PR

PR creation never grants merge permission. After a separate explicit user instruction:

1. Verify the PR is still open, its head equals the accepted candidate SHA, and its base has not moved from the accepted start SHA. Require the repository CI workflow to have actually run for the current PR head/merge ref and every applicable check to have completed successfully; zero check runs is failure, not success. Verify reviews and conflicts are resolved.
2. If any SHA changed or CI provenance cannot be tied to the current PR head/merge ref, stop and require a new candidate and acceptance.
3. Merge using GitHub's **Create a merge commit** method only. Never squash, rebase, bypass checks, use auto-merge, or push directly to main.
4. Fetch `origin/main` and verify the accepted candidate is now its ancestor:

   ```bash
   git merge-base --is-ancestor "$ACCEPTED_CANDIDATE_SHA" origin/main
   ```

5. Report the merge commit and verification. Remove the sync worktree and branch only after successful verification and only when they are clean.

The sync is complete only at `merged`. Release tagging, package publication, artifact building, and production deployment remain separate user-authorized tasks.
