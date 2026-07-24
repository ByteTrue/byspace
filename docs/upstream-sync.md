# Upstream release synchronization

BySpace synchronizes with Paseo by porting the aggregate delta between two frozen upstream releases onto the current BySpace `main`. It does not replace the BySpace tree or import upstream Git ancestry.

## Current baseline

- Upstream: `https://github.com/getpaseo/paseo`
- Integrated source release: `v0.2.0-beta.1`
- Integrated source commit: `0bec06c2db7d3ee071416cde80229eabd682b03e`
- Integrated source tree: `bb00a77858523a24ff3de173c5197bb0f6cb0488`

Update this marker and the matching marker in `docs/release.md` only after a sync is fully implemented and verified.

## Sync model

For baseline `OLD` and approved target `NEW`:

```text
current BySpace main
+ applicable behavior from Paseo OLD..NEW
= synchronized BySpace candidate
```

The current BySpace tree is the product source of truth. The upstream release diff is input to review, not a replacement tree and not a commit queue.

A sync must preserve these established BySpace contracts:

1. Browser Web/PWA + CLI + SDK client + daemon + Relay are the supported surfaces.
2. Electron, native iOS/Android, `expo-two-way-audio`, marketing website, and Electron Browser automation stay absent.
3. BySpace identity remains complete: `BySpace`, `byspace`, `BYSPACE_*`, `@bytetrue/byspace*`, `~/.byspace`, `byspace.json`, and port `6777`.
4. The single-package npm distribution and isolated Stable/Beta Web and Relay channels remain intact.
5. Current BySpace behavior, hardening, and product decisions are preserved unless the approved upstream delta intentionally improves them.

Do not repeat existing client deletion, identity migration, packaging, or release setup during a routine sync. Audit them as invariants instead.

## Hard gates

- Default to a stable upstream release tag. A prerelease or arbitrary commit requires explicit approval.
- Freeze and record both baseline and target tag, full commit SHA, and tree SHA before implementation.
- Inspect upstream through a disposable clone or dedicated local fork; do not fetch its tags into BySpace's release-tag namespace.
- Keep the current BySpace `main`, npm, Cloudflare resources, `~/.byspace`, and port `6777` unchanged during candidate work.
- Build the exact unmodified target before porting code.
- Start the candidate from the recorded current BySpace `main` SHA.
- Do not merge, rebase, or cherry-pick upstream history. Create normal BySpace-authored sync commits.
- Use one writer for the candidate and independent read-only reviewers.
- Do not tag, publish, deploy, or restart production as part of source synchronization.

## Workflow

### 1. Freeze the comparison

1. Require a clean BySpace worktree and record local `main`, `origin/main`, and their relationship.
2. Read the integrated upstream baseline above.
3. Resolve the approved target tag to `TARGET_COMMIT` and `TARGET_TREE`.
4. Verify that the baseline and target objects exist in an isolated upstream checkout.
5. Do not move either endpoint during the sync.

### 2. Prove the upstream target

In a disposable checkout of the exact target:

```bash
npm ci
npm run build:server
npm run typecheck
npm run build:web --workspace=@getpaseo/app
```

Use the target's documented equivalents if scripts or package names changed. Record upstream failures before touching BySpace.

### 3. Review the release delta

Review the aggregate `BASE..TARGET` tree diff and release notes. Use individual commits only to understand intent.

Summarize impact by retained subsystem:

- protocol and backward compatibility;
- persistence and workspace/agent lifecycle;
- Providers, Pi, and ACP;
- terminal and PTY lifecycle;
- Git, worktrees, Forge, and file operations;
- Web/PWA UI and responsive behavior;
- Relay and connection security;
- dependencies, generated declarations, packaging, and CI.

For each relevant behavior, record one disposition:

- **Port**
- **Already present**
- **Excluded surface**
- **Superseded by BySpace**
- **Deferred with approval** — blocks baseline advancement until resolved

This is release-level accounting, not a per-commit ledger.

### 4. Build from current BySpace main

1. Create a persistent isolated worktree from the recorded current BySpace `main` SHA.
2. Port approved changes in small vertical slices, including protocol/client/server/Web tests when a behavior crosses layers.
3. Preserve BySpace behavior when upstream and downstream both changed the same area; import the upstream fix rather than replacing the downstream subsystem wholesale.
4. Skip code used only by excluded surfaces. If a shared module changed, port only the retained shared behavior.
5. Add only required dependency and lockfile changes. Preserve unrelated resolved versions.
6. Build workspace declarations before interpreting cross-package type errors.
7. Commit slices as ordinary BySpace commits; never import upstream ancestry.

### 5. Verify the candidate

Run focused tests for each changed behavior, then:

```bash
npm ci
npm run branding:check
npm run build:server
npm run typecheck
npm run lint
npm run format:check
npm run build:web --workspace=@bytetrue/byspace-app
npm run release:check
```

Also prove:

- every relevant upstream behavior has a disposition;
- no Electron/native/website/Browser-automation or unsupported authority was resurrected;
- no old product namespace, home path, config name, port, or deployment target was introduced;
- protocol and persisted-state compatibility remain valid at changed boundaries;
- the global tarball and native modules still work;
- Stable/Beta endpoint selection remains correct;
- the production daemon and deployed resources were not changed.

Use targeted Playwright and Provider tests for changed behavior. Broad platform coverage belongs to remote CI, not a local full-suite run.

### 6. Review and integrate normally

Ask independent read-only reviewers to inspect:

- release-delta completeness and dispositions;
- retained versus excluded product boundaries;
- persistence, path, ref, host, and protocol trust boundaries;
- package graph and lockfile scope;
- release-channel and deployment non-regression.

Resolve blockers and deferred retained behavior first. When none remain, update the baseline marker and report the candidate SHA, tests, reviews, and residual risks. Integrate through normal commits and a normal push after user approval.

Shipping is separate. Invoke `release-beta` or `release-stable` only when explicitly requested.

## Failure rules

- A timeout is evidence, not permission to restart production.
- A patch conflict is a request for semantic reconciliation, not a reason to take the upstream file wholesale.
- Missing generated declarations require rebuilding the owning workspace, not adding duplicate local types.
- Never delete the lockfile to make dependency conflicts disappear.
- Report scope expansion before adding hardening or architecture work outside the approved release delta.
- If the baseline marker cannot be proven, repair it before continuing.

## Required report

- current BySpace base SHA;
- upstream baseline and target tag, commit, and tree;
- unmodified target build result;
- release-delta summary and dispositions;
- candidate commits and changed subsystems;
- focused tests, full gates, independent reviews, and CI if pushed;
- deferred items, whether they block baseline advancement, and residual risks;
- explicit list of remote or production mutations.
