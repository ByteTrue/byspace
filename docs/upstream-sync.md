# Upstream release synchronization

BySpace synchronizes with Paseo by porting the aggregate delta between two frozen upstream releases onto the current BySpace `main`. It does not replace the BySpace tree or import upstream Git ancestry.

## Current baseline

- Upstream: `https://github.com/getpaseo/paseo`
- Integrated source release: `v0.2.5`
- Integrated source commit: `6fc491e6220fba6543bbbe4bf1b1f58cfe59228b`
- Integrated source tree: `99ab03dfde2a54fa6c18749df0324250b5dfe4e6`

Update this marker and the matching marker in `docs/release.md` only after a sync is fully implemented and verified.

## Sync model

For baseline `OLD` and approved target `NEW`:

```text
current BySpace main
+ applicable behavior from Paseo OLD..NEW
= synchronized BySpace candidate
```

The current BySpace tree is the product source of truth. The upstream release diff is input to review, not a replacement tree and not a commit queue.

A sync is a controlled source transfer, not a design or hardening project. Once the user approves which upstream behaviors to take, copy those behaviors as faithfully as possible. Discovery of a possible upstream bug or a non-obvious compatibility choice transfers decision authority back to the user; it does not authorize the synchronizing agent to invent a fix.

A sync must preserve these established BySpace contracts:

1. Browser Web/PWA + CLI + SDK client + daemon + Relay are the supported surfaces.
2. Electron, native iOS/Android, `expo-two-way-audio`, marketing website, and Electron Browser automation stay absent.
3. BySpace identity remains complete: `BySpace`, `byspace`, `BYSPACE_*`, `@bytetrue/byspace*`, `~/.byspace`, `byspace.json`, and port `6777`.
4. The single-package npm distribution and isolated Stable/Beta Web and Relay channels remain intact.
5. Current BySpace behavior and documented product decisions remain fixed. If approved upstream behavior conflicts with them, stop and ask rather than combining or improving either design.

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
- Freeze dispositions before implementation. The user, not the synchronizing agent, decides whether questionable upstream behavior is copied, excluded, or handled as separate work.
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

- **Port** — copy the approved upstream behavior with only mechanical BySpace adaptations
- **Already present**
- **Excluded surface**
- **Superseded by a previously documented BySpace decision**
- **Needs user decision** — stop before implementation; unresolved decisions block baseline advancement

This is release-level accounting, not a per-commit ledger. An explicit user decision to copy upstream as-is, exclude the behavior, or move a fix into separate work resolves the decision.

### 4. Copy approved upstream code

1. Create a persistent isolated worktree from the recorded current BySpace `main` SHA.
2. For each approved Port, copy the upstream implementation and its tests as directly as the retained BySpace tree permits.
3. Without further approval, make only deterministic mechanical adaptations:
   - BySpace product/package/import/path names;
   - omission of wiring used only by excluded surfaces;
   - direct compile and test adjustments caused by those edits;
   - dependency and lockfile changes strictly required by the copied code.
4. Mechanical means there is one obvious result and no product choice. It must not add state, schemas, RPCs, fallbacks, policies, UX, architecture, generalized compatibility layers, bug fixes, or hardening.
5. If copying reveals an apparent upstream defect, a conflict with BySpace, more than one reasonable adaptation, or any additional responsibility, stop that slice before implementing a solution. Report the upstream code, impact, and choices to the user.
6. Do not improve upstream code during sync. If the user wants a fix, record whether to copy upstream first, exclude it, or perform separately scoped follow-up work.
7. Build workspace declarations before interpreting cross-package type errors.
8. Commit copied slices as ordinary BySpace commits; never import upstream ancestry.

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
- every approved Port matches upstream except recorded mechanical adaptations;
- no unapproved redesign, bug fix, hardening, or generalized compatibility layer was added;
- no Electron/native/website/Browser-automation or unsupported authority was resurrected;
- no old product namespace, home path, config name, port, or deployment target was introduced;
- the global tarball and native modules still work;
- Stable/Beta endpoint selection remains correct;
- the production daemon and deployed resources were not changed.

Use upstream tests for copied behavior and focused tests for mechanical adaptations. Do not broaden a sync into an exploratory E2E campaign. If testing reveals behavior that requires a product decision, stop and ask. Broad platform coverage belongs to remote CI, not a local full-suite run.

### 6. Review and integrate normally

Ask independent read-only reviewers to inspect only:

- whether every approved upstream behavior was copied completely and faithfully;
- whether adaptations are mechanical and explicitly recorded;
- whether excluded surfaces or old identity leaked back in;
- whether package and release-channel boundaries regressed.

A reviewer finding is a sync blocker only when code was omitted, copied incorrectly, adapted beyond approval, or crossed a fixed BySpace boundary. A possible upstream bug, security improvement, architecture improvement, or desirable hardening is reported to the user and is not implemented automatically.

Fix transfer mistakes and resolve all **Needs user decision** items through explicit user choices. Then update the baseline marker inside the sync branch and report the candidate SHA, tests, reviews, decisions, and residual upstream concerns.

Integration is branch-first: push the sync branch, run the full `CI` workflow on its exact SHA (PR to `main` or `workflow_dispatch`), and only after it is green and the user approves, fast-forward `main` to that same SHA. The baseline marker therefore lands on `main` only together with green exact-SHA CI evidence; never merge a red or unverified candidate into `main`.

### 7. Tear down temporary sync trees

A sync worktree is a temporary process resource, not a second BySpace checkout to keep indefinitely.

1. Before creating a candidate or worker, record its absolute path, purpose, branch, base SHA, and owner.
2. Before integration, inventory every sync worktree and disposable upstream checkout. Record `HEAD`, branch, clean/dirty state, and uncommitted file/stat summaries.
3. After the candidate reaches exact-SHA CI green and is integrated, remove every clean worktree whose commits are integrated or explicitly archived with `git worktree remove`. Remove clean disposable upstream baseline/target checkouts too.
4. Never force-remove a dirty worktree, auto-commit its changes, or silently discard untracked files. Preserve it and ask the user what to do after reporting its contents.
5. Do not delete local sync branches automatically; branch retention is separate from worktree directory cleanup.
6. Run `git worktree prune`, then verify `git worktree list` and the sibling directory inventory. Any remaining sync directory must have a documented reason.

Shipping is separate. Invoke `release-beta` or `release-stable` only when explicitly requested.

## Failure rules

- A timeout is evidence, not permission to restart production.
- A patch conflict permits only an obvious mechanical reconciliation. If it requires semantic or product judgment, stop and ask.
- Missing generated declarations require rebuilding the owning workspace, not adding duplicate local types.
- Never delete the lockfile to make dependency conflicts disappear.
- Never treat a discovered upstream defect or review suggestion as authorization to fix or harden it.
- Never expand test-driven debugging into new sync functionality; report the decision point instead.
- If the baseline marker cannot be proven, repair it before continuing.

## Required report

- current BySpace base SHA;
- upstream baseline and target tag, commit, and tree;
- unmodified target build result;
- release-delta summary and dispositions;
- candidate commits and changed subsystems;
- focused tests, full gates, fidelity review, and CI if pushed;
- all **Needs user decision** items and the user's explicit choices;
- residual upstream concerns that were observed but not changed;
- explicit list of remote or production mutations.
