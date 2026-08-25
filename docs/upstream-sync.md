# Upstream release synchronization

BySpace synchronizes with Paseo by porting the aggregate delta between two frozen upstream releases onto the current BySpace `main`. It does not replace the BySpace tree or import upstream Git ancestry.

## Current baseline

- Upstream: `https://github.com/getpaseo/paseo`
- Integrated source release: `v0.5.1`
- Integrated source commit: `f517493591a7b4072aa30ee48db13c1a51495103`
- Integrated source tree: `fc096ff4bc53515c14a8e53d7d7adc6118f94974`

Update this marker and the matching marker in `docs/release.md` only after a sync is fully implemented and verified.

## Sync model

For baseline `OLD` and approved target `NEW`:

```text
current BySpace main
+ applicable behavior from Paseo OLD..NEW
= synchronized BySpace candidate
```

The current BySpace tree is the product source of truth. The upstream release diff is input to review, not a replacement tree and not a commit queue.

An existing BySpace test, helper, comment, or runtime branch proves only that the behavior existed at the current baseline. It does not prove that BySpace deliberately diverged. Preserve a divergence only when a documented decision, an active BySpace-specific product path, or Git provenance shows an intentional downstream change. Otherwise follow the frozen upstream target implementation and tests.

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
- Before implementation, first give the user a complete plain-language list of what upstream added, fixed, and changed. Every item must include a recommendation and reason; end with a concise summary and only the genuine decision points.
- Do not tag, publish, deploy, or restart production as part of source synchronization.

## Workflow

### 1. Freeze the comparison

1. Require a clean BySpace worktree and record local `main`, `origin/main`, and their relationship.
2. Read the integrated upstream baseline above.
3. Resolve the approved target tag to `TARGET_COMMIT` and `TARGET_TREE`.
4. Verify that the baseline and target objects exist in an isolated upstream checkout.
5. Do not move either endpoint during the sync.

### 2. Build the complete release inventory

Review the aggregate `BASE..TARGET` tree diff and release notes. Use individual commits only to understand intent.

Identify each independent behavior and classify its change type as a new feature, problem fix, experience change, or engineering/dependency/release change. Do not collapse distinct behaviors merely because they share a commit or subsystem.

For internal accounting, summarize impact across:

- protocol and backward compatibility;
- persistence and workspace/agent lifecycle;
- Providers, Pi, and ACP;
- terminal and PTY lifecycle;
- Git, worktrees, Forge, and file operations;
- Web/PWA UI and responsive behavior;
- Relay and connection security;
- dependencies, generated declarations, packaging, and CI.

Give each behavior one internal disposition:

- **Port** — copy the approved upstream behavior with only mechanical BySpace adaptations;
- **Already present**;
- **Excluded surface**;
- **Superseded by a previously documented BySpace decision**;
- **Needs user decision** — stop before implementation; unresolved decisions block baseline advancement.

This is release-level accounting, not a per-commit implementation plan. Keep a separate commit/file coverage index proving that every part of the release delta maps to a behavior, including merge-only and release-metadata changes. The coverage index is audit evidence only: never turn it into a commit-by-commit, path-by-path, or hunk-by-hunk implementation queue.

Before presenting the inventory as final, obtain an independent read-only classification review. It must check omissions, cross-subsystem conflicts, whole-commit exclusions that hide retained behavior, and incorrect Already present or Superseded claims. Correct the ledger first.

### 3. Present the change-by-change recommendation

The first user checkpoint explains the upstream release before discussing implementation phases. Do not lead with internal IDs, commit hashes, file counts, or disposition taxonomy.

Group a numbered list under the applicable headings:

1. **新增功能**
2. **问题修复**
3. **体验调整**
4. **工程、依赖与发布变化**

For every item, report:

- **上游改了什么** — concrete before/after behavior;
- **影响** — affected user, API, runtime, or operational path;
- **我的意见** — 建议采纳 / BySpace 已有，无需重复 / 建议不采纳 / 需要你决定;
- **原因** — the actual product, boundary, compatibility, or correctness reason;
- **BySpace 处理** — only when a mechanical adaptation or preserved invariant matters;
- **依据** — compact commit/file evidence, without making the user decode the diff.

After the complete list, add in this order:

- **审计依据** — baseline → target, frozen coordinates, complete commit/file coverage, independent classification result, and target build status;
- **精炼总结** — counts by recommendation plus the few highest-impact outcomes;
- **需要你介入** — only genuine product, architecture, security, or compatibility choices, each with the recommended default and consequences. If none exist, say so explicitly;
- one approval shortcut such as `按建议冻结`. The user may override individual numbered items. Nothing follows this section.

The complete user list and internal coverage index must describe the same set of behaviors. The concise summary may compress the list but must not replace it.

Wait for explicit target and disposition approval before implementation.

### 4. Prove the upstream target

In a disposable checkout of the exact target:

```bash
npm ci
npm run build:server
npm run typecheck
npm run build --workspace=@getpaseo/app
```

Use the target's documented equivalents if scripts or package names changed. Record upstream failures before touching BySpace. The proof may run alongside inventory work, but a long build should not delay the first change explanation unless it changes a recommendation. It must pass before copying code.

### 5. Plan capability batches

The implementation unit is a coherent capability batch, not an upstream commit, file, hunk, test, or cosmetic token. A good batch owns one user/system capability or a tightly coupled group, includes its dependency closure and support tests, can compile as a whole, and has a clear path boundary from other batches.

1. Group approved Ports by runtime/UI owner, dependency order, and overlapping paths. Prefer a few substantial batches over many micro-checkpoints.
2. Size each batch so one writer can finish it in one bounded execution run. If the execution budget is nearly exhausted, finish and commit the coherent subset already implemented, hand off the remaining owners, and stop exploring; do not leave a broad dirty tree or force the whole batch through.
3. Include a coupled prerequisite from the same approved release in the batch when the frozen target proves one deterministic end state. Stop only when the adaptation introduces a real product or architecture choice.
4. Build the implementation plan once from the approved behavior inventory. Do not remap every upstream commit or regenerate global coverage before each batch. Use commit history as navigation; perform deep provenance analysis only when a hunk does not apply mechanically, a test fails, or a deliberate BySpace seam may exist.
5. Keep one candidate writer. Read-only inventory, review, and failure analysis may run in parallel, but overlapping writers must not modify the candidate.
6. Do not create a checkpoint merely because one upstream commit ended, one file changed, or one focused test can be run. Finish the capability batch before committing and running batch gates.
7. Report progress at capability milestones. Periodic status reporting must read existing artifacts and Git state; it must not rerun builds, tests, or global scans.

### 6. Copy approved upstream code

1. Create a persistent isolated worktree from the recorded current BySpace `main` SHA.
2. For each capability batch, copy every approved Port and its complete support slice as directly as the retained BySpace tree permits. The slice includes production code, tests, shared E2E helpers, fixtures, test factories, benchmarks, generated assets, and smoke/package expectations changed by the same behavior.
3. Without further approval, make only deterministic mechanical adaptations:
   - BySpace product/package/import/path names;
   - omission of wiring used only by excluded surfaces;
   - direct compile and test adjustments caused by those edits;
   - dependency and lockfile changes strictly required by the copied code.
4. Mechanical means there is one obvious result and no product choice. It must not add state, schemas, RPCs, fallbacks, policies, UX, architecture, generalized compatibility layers, bug fixes, or hardening.
5. If copying reveals an apparent upstream defect, a conflict with BySpace, more than one reasonable adaptation, or any additional responsibility, stop that slice before implementing a solution. Report the upstream code, impact, and choices to the user.
6. When upstream removes a feature, transfer the complete removal slice: runtime and UI wiring, CLI, tests, bundled skills, smoke expectations, docs, and stale ownership comments. Preserve protocol parsing compatibility where required by BySpace's protocol contract.
7. Treat copied `COMPAT(...)` comments as release metadata, not literal source text. Before integration, make every new marker name the actual first BySpace release that carries the shim and include its cleanup date; never retain an upstream version number or guess an unknown BySpace release.
8. Do not improve upstream code during sync. If the user wants a fix, record whether to copy upstream first, exclude it, or perform separately scoped follow-up work.
9. Build workspace declarations before interpreting cross-package type errors.
10. Commit completed capability batches as ordinary BySpace commits; never import upstream ancestry or mirror upstream commit granularity.

### 7. Verify the candidate

Before changing runtime behavior to satisfy a failing test or CI job, establish the failure's provenance:

1. Find the earliest causal failure. One failed assertion can leave a deferred operation unresolved or a global lifecycle lock held, turning many later timeouts into secondary noise.
2. Compare four sources: the frozen upstream baseline implementation/tests, the frozen target implementation/tests and support files, BySpace immediately before the candidate, and the candidate diff.
3. Classify the failure before editing:
   - **stale inherited behavior** — baseline had it, target intentionally changed it, and BySpace has no deliberate divergence evidence: follow the target and update or remove the stale test;
   - **intentional BySpace seam** — docs, Git provenance, or an active BySpace-only caller proves a downstream contract: preserve the seam with the smallest adaptation and a focused test;
   - **transfer omission** — target code, test, helper, fixture, factory, generated asset, or smoke expectation was not copied together: port the missing target piece;
   - **upstream defect** — the unchanged frozen target reproduces the failure: stop and ask before fixing it;
   - **test isolation defect** — the focused file passes but the full suite fails because a unit test reaches a real scheduler, filesystem home, credential store, or other shared resource: inject or isolate that dependency without changing production behavior;
   - **platform defect** — only one OS fails: inspect path case/separators, home resolution, watcher readiness, and teardown ordering before changing timeouts or weakening assertions.
4. Keep a compact CI failure ledger: failing job/assertion, provenance evidence, chosen action, focused proof, and replacement exact SHA. Do not assume that every failure in a cluster shares one root cause, or that every timeout is independent.

Use a verification ladder; do not run the final matrix after every small edit:

1. **While editing a batch:** run only the smallest compiler or focused test needed to guide the transfer. A known-incomplete batch may be temporarily red; do not commit it or repeatedly run broad gates in that state.
2. **At a completed capability batch:** run the upstream tests covering the copied behavior plus focused adaptation tests, then run root typecheck, lint, and format check once. Run tests from the owning workspace so its aliases and environment apply.
3. **Build by blast radius:** run `build:server` when the batch changes protocol, client declarations, server/CLI code, dependencies, packaging, or another cross-workspace contract. For App-only batches, defer the real Web export until the end of the aggregate Web stage rather than exporting after every owner.
4. **Keep generated-output commands sequential:** do not run builds, typecheck, or tests concurrently when they read or write shared `dist` declarations.
5. **At the complete candidate:** run the final matrix once:

```bash
npm ci
npm run branding:check
npm run build:server
npm run typecheck
npm run lint
npm run format:check
npm run build --workspace=@bytetrue/byspace-app
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

Use upstream tests for copied behavior and focused tests for mechanical adaptations. Never run the full local test suite, and do not broaden a sync into an exploratory E2E campaign. Broad platform coverage belongs to remote CI. If testing reveals behavior that requires a product decision, stop and ask.

### 8. Review and integrate normally

Review completed capability batches when they are high-risk or cross architectural boundaries; otherwise review the aggregate candidate. Do not launch a fresh independent review for every upstream commit, cosmetic token, or small follow-up fix. Reviewers consume the existing inventory and adaptation record rather than rebuilding the release audit.

Ask independent read-only reviewers to inspect only:

- whether every approved upstream behavior was copied completely and faithfully;
- whether adaptations are mechanical and explicitly recorded;
- whether excluded surfaces or old identity leaked back in;
- whether package and release-channel boundaries regressed.

A reviewer finding is a sync blocker only when code was omitted, copied incorrectly, adapted beyond approval, or crossed a fixed BySpace boundary. A possible upstream bug, security improvement, architecture improvement, or desirable hardening is reported to the user and is not implemented automatically. Missing shell access or duplicated gate evidence is not a code blocker; the candidate writer or supervisor may supply that evidence once.

Fix transfer mistakes and resolve all **Needs user decision** items through explicit user choices. Then update the baseline marker inside the sync branch and report the candidate SHA, tests, reviews, decisions, and residual upstream concerns.

Integration is branch-first: push the sync branch, run the full `CI` workflow on its exact SHA (PR to `main` or `workflow_dispatch`), and only after it is green and the user approves, fast-forward `main` to that same SHA. If CI fails, classify each failure with the provenance procedure above, fix only the transfer or explicitly approved defect, run focused proof and local gates, then submit a replacement exact SHA to the complete matrix. Do not accept rerun luck for a deterministic platform failure. The baseline marker therefore lands on `main` only together with green exact-SHA CI evidence; never merge a red or unverified candidate into `main`.

### 9. Tear down temporary sync trees

A sync worktree is a temporary process resource, not a second BySpace checkout to keep indefinitely.

1. Before creating a candidate or worker, record its absolute path, purpose, branch, base SHA, and owner.
2. Before integration, inventory every sync worktree and disposable upstream checkout. Record `HEAD`, branch, clean/dirty state, and uncommitted file/stat summaries.
3. After the candidate reaches exact-SHA CI green and is integrated, remove every clean worktree whose commits are integrated or explicitly archived with `git worktree remove`. Remove clean disposable upstream baseline/target checkouts too.
4. Never force-remove a dirty worktree, auto-commit its changes, or silently discard untracked files. Preserve it and ask the user what to do after reporting its contents.
5. Do not delete local sync branches automatically; branch retention is separate from worktree directory cleanup.
6. Run `git worktree prune`, then verify `git worktree list` and the sibling directory inventory. Any remaining sync directory must have a documented reason.

Shipping is separate. Invoke `release-beta` or `release-stable` only when explicitly requested.

## Failure rules

- A timeout is evidence, not permission to restart production. Inspect the earliest failure and any unresolved deferred operations, lifecycle locks, scheduler queues, or watcher setup before treating later timeouts as independent.
- An inherited test is not proof of an intentional BySpace contract. Establish provenance before changing target behavior to satisfy it.
- A focused pass plus full-suite failure is evidence of test isolation or shared-resource coupling; do not turn it into production behavior without proof.
- A platform-only failure is evidence of a platform seam; do not weaken a cross-platform assertion until path, environment, watcher, and teardown behavior are understood.
- A patch conflict permits only an obvious mechanical reconciliation. If it requires semantic or product judgment, stop and ask.
- Missing generated declarations require rebuilding the owning workspace, not adding duplicate local types.
- Never delete the lockfile to make dependency conflicts disappear.
- Never treat a discovered upstream defect or review suggestion as authorization to fix or harden it.
- Never expand test-driven debugging into new sync functionality; report the decision point instead.
- If the baseline marker cannot be proven, repair it before continuing.
- If a worker or provider fails before making edits, confirm the candidate is clean and retry the same capability batch. Do not repeat the release inventory or remap the batch.
- If a test fails to parse only from the repository root, rerun it from the owning workspace before changing source or test code; package aliases and setup files are part of the harness.
- Treat status reporting as observation, not verification. Reuse recorded command output instead of rerunning expensive gates for a progress update.

## Required report

The first approval report must contain, in this order:

1. the complete numbered change list grouped into new features, fixes, experience changes, and engineering/release changes, with a recommendation and concrete reason for every item;
2. compact audit evidence: baseline → target, frozen coordinates, complete-coverage result, independent classification review, and target build result if available;
3. a concise summary with counts and highest-impact outcomes;
4. only the items requiring user intervention, with recommended defaults and an approval shortcut; this is the final section.

The final integration report additionally contains:

- current BySpace base SHA;
- upstream baseline and target tag, commit, and tree;
- unmodified target build result;
- the approved change list and user choices;
- all **Needs user decision** items and the user's explicit choices;
- candidate commits and changed subsystems;
- focused tests, full gates, fidelity review, and CI if pushed;
- residual upstream concerns that were observed but not changed;
- explicit list of remote or production mutations.
