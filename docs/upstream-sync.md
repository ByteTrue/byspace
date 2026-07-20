# Upstream release synchronization

BySpace updates from Paseo by rebuilding from a frozen upstream release snapshot. It does **not** merge, rebase, or cherry-pick upstream history into the public branch.

## Current baseline

- Upstream: `https://github.com/getpaseo/paseo`
- Source release: `v0.2.0-beta.1`
- Source commit: `0bec06c2db7d3ee071416cde80229eabd682b03e`
- Source tree: `bb00a77858523a24ff3de173c5197bb0f6cb0488`
- BySpace source root: `bed137d6dfab63046d07e884f628f27baff97d3c`

The root commit records the upstream URL, tag, commit, tree, and AGPL license. `docs/release.md` records the same baseline in human-readable form. Update both when the source snapshot changes.

## What “sync upstream” means

A sync replaces the source floor with one complete Paseo release and reapplies a bounded BySpace overlay:

1. Web/PWA + CLI + daemon + relay only.
2. Remove Electron, native iOS/Android, `expo-two-way-audio`, marketing website, and Electron Browser automation.
3. Apply the complete BySpace identity (`BySpace`, `byspace`, `BYSPACE_*`, `@bytetrue/byspace*`, `~/.byspace`, port `6777`).
4. Reapply the single-package npm distribution and Stable/Beta Cloudflare release channels.
5. Preserve Web responsive behavior, general browser APIs, URL opening, file preview, Providers, terminal, Git/worktrees, schedules, voice, and orchestration.

The target release is imported whole. Do not resurrect per-commit disposition ledgers: they recreated deep-fork maintenance without product value.

## Hard gates

- Default to an upstream **stable release tag**. A beta or arbitrary commit requires explicit user approval.
- Resolve and record the tag, full commit SHA, and tree SHA before review. Never move the target mid-run.
- Never fetch upstream tags into the BySpace tag namespace. Inspect with `git ls-remote` or use a disposable upstream clone.
- Keep current `main`, npm, Cloudflare, and the daemon untouched while building the candidate.
- Establish a green unmodified-upstream baseline before deleting or renaming anything.
- Reimplement the overlay against the new tree; do not blindly replay old commits or resolve conflicts with “take theirs.”
- Keep one writer in the candidate checkout. Independent agents review read-only.
- No public-history replacement, tag, publish, deploy, or port-6777 daemon restart without explicit approval.

## Workflow

### 1. Freeze and review the release

1. Identify the newest approved Paseo release without importing its tags.
2. Freeze `TARGET_TAG`, `TARGET_COMMIT`, and `TARGET_TREE`.
3. Compare the current source release to the target by release notes and tree diff.
4. Summarize changes by retained subsystem: protocol, lifecycle, Providers/Pi, terminal, Git/worktrees, Web, relay, persistence, packaging, and security.
5. Flag data-model changes, protocol compatibility changes, dependency/toolchain changes, and features that depend on excluded clients.
6. Present the frozen target, impact, risks, and rebuild plan to the user before implementation.

This review is impact accounting, not commit-by-commit selection: the approved target snapshot is imported whole.

### 2. Prove the upstream baseline

In a disposable checkout of the exact target commit:

```bash
npm ci
npm run build:server
npm run typecheck
npm run build:web --workspace=@getpaseo/app
```

Use the target's own documented commands if package names or scripts changed. Record any upstream failure before touching the BySpace overlay.

### 3. Create a clean candidate history

1. Clone BySpace into an isolated temporary directory.
2. Create an orphan candidate branch.
3. Materialize the exact upstream target tree as the root commit.
4. Record upstream URL, tag, commit, tree, and license in the root commit message.
5. Prove the candidate root tree equals `TARGET_TREE` byte-for-byte.

Do not add BySpace docs or metadata to the source root. They belong in later overlay commits.

### 4. Reapply the bounded overlay

Apply separate, reviewable responsibilities in this order:

1. **Client-surface reduction** — remove excluded packages and their full cross-layer capability slices. Delete dead branches; do not replace them with false platform stubs.
2. **Identity migration** — rename packages, runtime identifiers, config/home paths, CLI, UI text, and infrastructure consistently. Preserve the target lockfile's resolved dependency graph; do not regenerate it from floating ranges.
3. **Distribution** — restore the one-package `@bytetrue/byspace` pack/smoke/publish path. Embedded workspaces remain code-only; the public root owns external dependencies.
4. **Release infrastructure** — restore exact-SHA CI, immutable-tag publication, and isolated Stable/Beta Pages + Relay deployment.
5. **Docs and skills** — update source metadata, release docs, upstream-sync docs, README, and maintainer skills.
6. **Review hardening** — add only fixes required by the new target or review findings. Report scope expansion immediately.

Use the current BySpace tree as the behavioral reference, not as a patch that must apply mechanically.

### 5. Verify the candidate

Run focused tests while each responsibility lands, then:

```bash
npm run branding:check
npm run build:server
npm run typecheck
npm run lint
npm run format:check
npm run build:web --workspace=@bytetrue/byspace-app
npm run release:check
```

Also prove:

- zero Electron/native/website/Browser-automation resurrection;
- no old product namespace or local Node version pin;
- protocol compatibility at changed trust boundaries;
- real global tarball install and native-module loading;
- daemon start/status/stop in an isolated home and port;
- Stable/Beta endpoint selection;
- unchanged production daemon and Cloudflare resources.

Run the repository's targeted Playwright and Provider tests for changed behavior. Let full CI, not a local full-suite run, provide the broad matrix.

### 6. Review and approve the cutover

Ask independent read-only reviewers to inspect:

- complete source-root-to-candidate diff;
- deleted-surface residuals;
- identity/package graph;
- persistence and protocol boundaries;
- release trust chain and channel isolation.

Resolve every blocker. Then report the exact candidate SHA, source proof, test evidence, residual risks, and destructive cutover steps. Wait for explicit approval.

### 7. Replace public history safely

1. Create an offline Git bundle of all old refs.
2. Independently clone the bundle and run `git fsck`.
3. Force-push the approved orphan candidate with `--force-with-lease` against the observed old `main` SHA.
4. Wait for exact-SHA push CI.
5. Confirm the Contributor graph and public branch show only the clean BySpace history.
6. Stop. Shipping is a separate operation handled by `release-beta` or `release-stable`.

## Failure rules

- A timeout is evidence, not permission to restart production.
- Missing workspace declarations usually require rebuilding the owning package, not adding local duplicate types.
- Never delete `package-lock.json` or `node_modules` to “clean up” a rename.
- Never modify production while a candidate or its CI is unresolved.
- If review expands the task into architecture or data-safety hardening, state the expansion and get approval instead of silently extending the sync.

## Required report

- frozen upstream tag, commit, and tree;
- baseline result;
- overlay responsibilities and candidate commits;
- removed-surface and identity residual results;
- focused tests, full gates, independent reviews, and CI;
- backup bundle path and verification;
- candidate/main SHAs;
- deferred risks;
- explicit statement that no release/deploy occurred unless separately requested.
