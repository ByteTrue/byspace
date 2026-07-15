# Upstream synchronization

BySpace selectively imports fixes and aligned features from its upstream project without merging upstream product scope back into the fork.

## Source of truth

`.byspace/upstream-sync.json` is the machine-readable cursor and decision history.

`cursor.lastReviewedCommit` means **the newest upstream commit whose entire preceding range has been reviewed**, not the last commit that was applied. A commit can be skipped or deferred while the cursor still advances past it, because its disposition is recorded in the batch ledger.

Validate the file with:

```bash
npm run upstream:check
```

The validator reconstructs every recorded Git range and proves that every upstream SHA appears exactly once as inherited, applied, deferred, or skipped. It also verifies all local replay and hardening commits still exist.

## Mandatory workflow

```text
fetch without tags
  → freeze cursor..upstream tip
  → materialize every commit
  → complete one-SHA-one-decision ledger
  → show the complete grouped summary to the user
  → user approves an exact set
  → replay the whole set in an isolated worktree
  → review and test the replay
  → fast-forward main
  → append the batch and advance the cursor
```

### 1. Fetch without importing upstream tags

```bash
git fetch --no-tags upstream main:refs/remotes/upstream/main
```

Upstream release tags share the local tag namespace and must not be pushed to the BySpace origin.

### 2. Freeze the range

Read `cursor.lastReviewedCommit` as `COMMIT1`, resolve `upstream/main` as `COMMIT2`, and record both full SHAs before inspecting commits. The range is `COMMIT1..COMMIT2`; the left endpoint is excluded.

Do not move `COMMIT2` when upstream advances during review. A later commit belongs to the next batch.

### 3. Account for every commit

For every SHA in the frozen range, record:

- observable behavior;
- affected retained or removed product surfaces;
- dependencies on other commits;
- recommendation: full replay, partial behavioral port, defer, or skip;
- risk and required verification.

The user-facing summary must list every SHA exactly once. Release-only, documentation-only, conflicting, large, and excluded-surface commits still appear in the summary.

Do not skip an aligned feature merely because it is large or conflict-prone. Mark it as a rewrite/defer candidate and let the user decide.

### 4. Require explicit approval

No upstream implementation commit reaches `main` before the user approves the complete ledger. If the approved set includes shared lifecycle, protocol, timeline, Provider adapters, or a broad feature bundle, treat it as high risk.

### 5. Replay in an isolated worktree

Create a temporary branch/worktree from current `main` and replay the approved sequence in upstream order. Full ports retain the upstream SHA in the commit message. Partial ports name the source SHA and state what was omitted.

Never resolve conflicts by restoring removed surfaces or blindly taking upstream versions of fork-heavy files. In particular, scrutinize:

- Agent manager/run state and Provider adapters;
- protocol messages and client RPCs;
- session/WebSocket/timeline paths;
- App root layout, stream rendering, composer, sidebar, and settings;
- pairing, i18n, release, and package identity.

### 6. Protect the BySpace product boundary

Retained:

- browser Web/PWA;
- local CLI/daemon;
- encrypted relay;
- direct and ACP/custom Providers;
- Pi-first Agent experience;
- terminal, files, Git/worktrees, schedules, voice, and orchestration.

Excluded unless the user deliberately changes the epic specification:

- Electron;
- native iOS/Android clients and release tooling;
- in-app Browser automation;
- marketing website.

Upstream still uses its original product names. After the BySpace naming migration, port behavior into current BySpace identifiers instead of reintroducing old package, environment-variable, config, tool, or type names.

### 7. Validate before main

Use focused tests for every changed responsibility, then run typecheck, lint, formatting, retained builds, and a real Web export. High-risk lifecycle changes require explicit Pi, cancellation, subagent, and ACP coverage. Protocol changes remain optional/backward-compatible unless the current BySpace protocol baseline explicitly permits a break.

Ask independent read-only reviewers to inspect the final scratch diff. Resolve every blocker before fast-forwarding `main`.

### 8. Advance the cursor

Append a new batch to `.byspace/upstream-sync.json` with:

- frozen start/end SHAs and review date;
- issue/ledger path;
- inherited, applied, deferred, and skipped decisions;
- source-to-local commit mapping for full and partial ports;
- additional hardening commits produced by review.

Set `cursor.lastReviewedCommit` to the frozen `COMMIT2`, rerun `npm run upstream:check`, and commit the state with the replay.

## Current deferred bundles

Consult `.byspace/upstream-sync.json` and its linked CodeStable issue for exact SHAs. Deferred does not mean rejected: it means the behavior remains eligible for a later bounded issue rather than being mixed into the current sync batch.
