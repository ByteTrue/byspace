# Release engineering lessons

This document turns failures encountered while rebuilding and shipping BySpace into reusable controls. `docs/release.md` is the operational release playbook; this document explains the engineering rules behind it.

## Core model

Treat a release as one immutable source and one complete channel tuple:

```text
commit → exact-SHA CI → npm/Web/Relay artifacts + Desktop/Android artifacts → public verification
```

Stable and Beta are separate tuples:

```text
Stable = npm latest + Stable Web/Relay + Stable Desktop/Android GitHub assets
Beta   = npm beta   + Beta Web/Relay   + Beta Desktop/Android GitHub assets
```

A release is incomplete until every element in its tuple is verified and the other tuple is proven unchanged. iOS is a maintained source/prebuild/test surface but is explicitly outside both publication tuples and must be absent from active CD.

## Lessons converted into controls

| Failure or risk                                                                                                                            | Durable control                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-commit upstream sync produced a deep fork and endless conflicts.                                                                       | Freeze two upstream releases and port their aggregate release delta onto the current BySpace `main`; use individual commits only to understand intent.                                                   |
| Importing upstream commits would expose upstream ancestry and authors in BySpace history.                                                  | Do not merge, rebase, or cherry-pick upstream; record ported behavior in normal BySpace-authored sync commits.                                                                                           |
| The Web-only cut deleted client packages while leaving cross-layer Browser/Electron/native seams and made later restoration expensive.     | Add, retire, or restore a client capability as a vertical slice across UI/protocol/client/daemon/tests/docs; keep every maintained platform in the upstream coverage ledger.                             |
| False platform stubs made maintained clients look permanently dead or disappear from the release tuple.                                    | Keep real `.web`/`.native`/Electron boundaries and require Android/Desktop assets for every release tag; delete a branch only when Project Spec explicitly retires that product path.                    |
| Mechanical rename commits carried unrelated feature dependencies.                                                                          | Treat BySpace identity as an existing invariant; rename only newly ported upstream identifiers and verify zero residuals instead of replaying an old transform.                                          |
| Deleting `package-lock.json` re-resolved floating ranges and caused ecosystem-wide type drift.                                             | Preserve the source lockfile's resolved versions and change only intentional workspace/package identities.                                                                                               |
| Workspace declarations were stale after cross-package changes.                                                                             | Rebuild the owning stack before patching consumers; never add duplicate local types to mask stale declarations.                                                                                          |
| npm `bundleDependencies` behaved differently across platforms.                                                                             | Stage internal workspaces manually and validate the final tarball on Linux, macOS, and Windows.                                                                                                          |
| Bundled workspace dependencies became empty directories in global installs.                                                                | Make embedded workspaces code-only; let the public root package own the flattened external dependency graph.                                                                                             |
| A local install smoke passed while global install was broken.                                                                              | Install the tarball into a clean global prefix and exercise the generated global shim.                                                                                                                   |
| JavaScript-only smoke missed native binding failures.                                                                                      | Load `node-pty`, speech bindings, and MCP compatibility modules from the installed package.                                                                                                              |
| Repacking between smoke and publish changed the artifact.                                                                                  | Publish the exact tarball that passed smoke; never rebuild between verification and publication.                                                                                                         |
| Client release workflows rebuilt arbitrary refs or overwrote existing assets with `--clobber`.                                             | Build only the immutable tag at the exact-SHA CI commit; generate a complete manifest/checksum set; accept existing assets only when bytes match; never mutate updater manifests after publication.      |
| Android preview/debug signing made a downloadable APK unable to form a durable update chain.                                               | Require the permanent BySpace release key in CD, pin its public certificate fingerprint in source, verify with `apksigner`, and install/launch the signed APK before upload.                             |
| Maintained iOS source was mistaken for permission to publish iOS.                                                                          | Keep iOS source, prebuild, tests, EAS/Fastlane reference implementation, and platform restrictions; keep executable iOS CD absent until an explicit future product decision.                             |
| Independent CI, package, and Pages builds could differ while sharing a source SHA.                                                         | Build the canonical Web distribution once in exact-SHA push CI, embed it into one npm tarball, attest both with commit/version/SHA-256 manifests, and promote those CI-run artifacts without rebuilding. |
| npm rejected a valid package late because `repository.url` was absent.                                                                     | Assert registry-required metadata from the installed tarball before publication.                                                                                                                         |
| Trusted Publishing failed with an old npm.                                                                                                 | Pin a Trusted-Publishing-capable npm in the workflow and keep OIDC permissions minimal.                                                                                                                  |
| A release tag was created before remote CI was green.                                                                                      | Version first without a Git tag; push the release commit; create the annotated tag only after exact-SHA CI succeeds.                                                                                     |
| Annotated tags resolve to tag objects as well as commits.                                                                                  | Compare deployment SHA with `refs/tags/<tag>^{commit}`, never the unpeeled tag object.                                                                                                                   |
| Moving/deleting a tag could deploy different source for an existing npm version.                                                           | Protect `refs/tags/v*` against deletion and non-fast-forward updates with no bypass actors.                                                                                                              |
| `main` deployment mixed unreleased source with published packages.                                                                         | `main` runs CI only; a successful npm publication is the sole normal deploy trigger.                                                                                                                     |
| A privileged `workflow_run` can execute untrusted metadata.                                                                                | Require same repository, push event, successful publisher, strict tag syntax, peeled SHA, ancestor-of-main proof, and successful push CI before secrets are exposed.                                     |
| A newer `main` could race an already-published release.                                                                                    | Deploy from the immutable tag/SHA attested by the publisher; do not require the tag to remain the tip of `main`.                                                                                         |
| Release jobs cancelled one another.                                                                                                        | Serialize per surface and channel with `cancel-in-progress: false`.                                                                                                                                      |
| Registry propagation briefly returned the old dist-tag.                                                                                    | Retry bounded npm dist-tag verification before triggering deployment.                                                                                                                                    |
| Rerunning the publisher after npm accepted an immutable version retried the release gate's dry-run publish.                                | Detect already-published immutable versions before the release-gate dry run and before the real publish step so reruns resume release notes and deployments instead of attempting a second publish.      |
| Beta CLI opened Stable Web/Relay.                                                                                                          | Derive Web, Relay, CORS, pairing, help links, and self-update dist-tag from the installed release version.                                                                                               |
| Existing canonical Stable settings pinned a daemon to the wrong channel.                                                                   | Treat only known Stable/Beta defaults as managed values; migrate them at load time while preserving custom/env overrides.                                                                                |
| Cloudflare Git integration could bypass release gates.                                                                                     | Use direct-upload Pages projects with no Git provider; GitHub Actions owns deployments.                                                                                                                  |
| A timeout was mistaken for a restart requirement.                                                                                          | Treat timeouts as evidence; inspect logs and retry bounded probes before considering restart. Never restart port `6777` without permission.                                                              |
| A remote self-update killed npm during a slow registry retry and left the global CLI newer than the running daemon.                        | Give the mutating global install enough time for registry retries, skip audit/funding work, and leave the client timeout margin for the server to report failure before any restart.                     |
| Isolated smoke cleanup reached the production daemon through an endpoint fallback.                                                         | Treat the home-scoped PID file as shutdown ownership proof; never send a lifecycle shutdown RPC when it is absent, even if the configured endpoint is reachable.                                         |
| Windows kept stopped smoke directories locked.                                                                                             | Make daemon stop a hard gate; make final temporary-directory deletion bounded and non-fatal only for known Windows lock errors.                                                                          |
| Local Node pins split global npm installs across Node versions.                                                                            | Do not pin Node in the repo; verify CLI and daemon paths both use the user's global mise Node.                                                                                                           |
| Building a sync candidate from the upstream tree risked losing accumulated BySpace work.                                                   | Start every sync candidate from the current BySpace `main` and port only the approved upstream release delta; integrate with ordinary commits and a normal push.                                         |
| Reviews found concurrency and trust-boundary concerns while copying upstream.                                                              | During sync, reviewers check transfer fidelity and fixed BySpace boundaries only. Report possible upstream defects to the user; do not turn them into unapproved sync work.                              |
| Review hardening silently expanded a “sync” into hours or weeks of work.                                                                   | Hard stop: sync copies approved upstream behavior. Any non-mechanical compatibility choice, bug fix, redesign, or hardening requires an explicit user decision before implementation.                    |
| A sync candidate advanced the baseline marker on `main` before exact-SHA CI finished, so `main` briefly claimed an unverified integration. | Sync integration is branch-first: run full CI on the sync branch's exact SHA, then fast-forward `main` to that same green SHA; the baseline marker rides in the sync branch.                             |

### Sync worktree teardown

Persistent sync worktrees and disposable upstream checkouts are temporary resources. Inventory them in the final report, remove clean integrated trees, preserve dirty trees for explicit user disposition, and verify that no stale paths remain.

## Proof ladder

For an upstream source sync, use only the proof and review scopes in `docs/upstream-sync.md`; the remaining release proof ladder and review boundaries below apply only to separately requested release or product work.

Stop only after each applicable rung passes; a higher rung does not replace a lower one.

1. **Source proof** — frozen baseline and target tag/commit/tree, green target baseline, explicit release-delta dispositions.
2. **Static proof** — generated declarations, typecheck, lint, format, branding, residual search.
3. **Behavior proof** — focused tests for changed branches and trust boundaries.
4. **Artifact proof** — verify commit/version/SHA-256 manifests, inspect the npm tarball, clean global install, native loads, CLI shim, Desktop package contents, Android signer/identity, and absence of iOS assets.
5. **Runtime proof** — isolated daemon start/status/pair/stop, packaged Desktop smoke on each supported OS, and Android APK install/launch.
6. **CI proof** — exact pushed SHA green on all platform jobs.
7. **Registry proof** — expected immutable version and dist-tag visible from npm.
8. **Deployment proof** — Pages/Worker identify the tagged SHA/version and the GitHub Release has the exact client inventory.
9. **Channel proof** — real pairing/relay use the intended channel; Desktop updater metadata uses that channel; the other channel's hosted IDs and client manifest remain unchanged.
10. **Public integrity proof** — download published clients, verify `SHA256SUMS.txt` and `client-release-manifest.json`, and re-check the Android certificate fingerprint.
11. **Recovery proof** — state/archive path exists, hosted rollback target is known, Android signing-key recovery is protected, and immutable clients have a fix-forward plan.

## Review boundaries

Always review these separately:

- **Persistence:** async read/write races, rollback snapshots, archive/reopen, atomic writes, old state compatibility.
- **Trust:** client-controlled paths/refs/hosts, Git option boundaries, OAuth-authenticated identity, origin/CORS handling.
- **Protocol:** old/new parse compatibility, connection generation/epoch, request/ack correlation.
- **Packaging:** root versus embedded dependency ownership, platform-specific native modules, generated shim.
- **Release:** tag timing, tag immutability, workflow event trust, exact artifact continuity, channel isolation.
- **Product boundary:** no regression or silent omission across maintained Web/PWA, Android/iOS, Electron Desktop, Desktop Browser automation, and CLI journeys; no replacement of the existing BySpace landing package with the upstream marketing-site implementation, and no superseded product path without an explicit decision.

## Cutover discipline

Order irreversible operations so every stop point is recoverable:

1. finish and review candidate offline;
2. back up state and Git refs;
3. push source, but do not tag;
4. wait for exact-SHA CI;
5. create one immutable tag;
6. let npm and client publication run from that tag;
7. deploy only the matching hosted channel;
8. verify npm, Web, Relay, pairing, daemon, Desktop/Android inventory, public checksums, signing state, and absence of iOS assets;
9. confirm the other channel did not move;
10. announce completion.

Before the tag, source can be fixed normally. After the tag, npm and client asset names/bytes are immutable: fix forward with a new version.

## Incident-derived client build controls

The first `v0.7.1` and `v0.7.2` client matrices failed before asset publication and established these additional controls:

- Electron Web export is owned by the root `build:desktop:web` script. macOS, Linux, Windows, and local Desktop builds call that one script; a workflow must never route `build:web` to the Desktop workspace.
- Electron server runtime and main-process compilation are owned by the tested root `build:desktop:runtime` and `build:desktop:main` scripts. Workflows must not invent package-script names that local builds do not execute.
- Windows jobs must leave npm's default lifecycle shell intact. Do not set npm `script-shell` to Windows PowerShell: transitive package scripts may use `cmd.exe` operators such as `||`. Workflow `shell: pwsh` remains appropriate for explicit PowerShell steps.
- npm registry version metadata may become visible before the tarball CDN serves the new object. Post-publish verification waits up to six minutes for the exact tarball; retrying a failed job for an already-published version must verify without republishing.
- A green source/build gate does not substitute for the first real cross-platform tag matrix. If that immutable tag exposes a workflow defect after npm publication, leave the tag untouched and fix forward to a new version.

## Evidence in this repository

- Packaging implementation: `scripts/pack-byspace.mjs`
- Real global smoke: `scripts/smoke-byspace-package.mjs`
- Exact-artifact publisher: `scripts/publish-byspace.mjs`
- Version policy: `scripts/set-release-version.mjs`
- npm trust chain: `.github/workflows/npm-release.yml`
- Channel deploy gates: `.github/workflows/deploy-app.yml`, `.github/workflows/deploy-relay.yml`
- Client artifact gate: `.github/workflows/client-release.yml`
- Client manifest/integrity implementation: `scripts/client-release-manifest.mjs`
- Client distribution contract: `docs/client-distribution.md`
- Operational release flow: `docs/release.md`
- Source update flow: `docs/upstream-sync.md`
