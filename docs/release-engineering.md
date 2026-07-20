# Release engineering lessons

This document turns failures encountered while rebuilding and shipping BySpace into reusable controls. `docs/release.md` is the operational release playbook; this document explains the engineering rules behind it.

## Core model

Treat a release as one immutable source and one complete channel tuple:

```text
commit → CI → package artifact → npm dist-tag → Web → Relay → real daemon
```

Stable and Beta are separate tuples:

```text
Stable = npm latest + byspace.pages.dev + byspace-relay
Beta   = npm beta   + byspace-beta.pages.dev + byspace-relay-beta
```

A release is incomplete until every element in its tuple is verified and the other tuple is proven unchanged.

## Lessons converted into controls

| Failure or risk                                                                                | Durable control                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-commit upstream sync produced a deep fork and endless conflicts.                           | Update only from frozen upstream release snapshots; rebuild a bounded overlay on a clean orphan root.                                                                |
| Imported ancestry made GitHub show upstream's contributor history.                             | Make the upstream tree an orphan root and record source attribution in the commit, README, and license.                                                              |
| Deleting packages left cross-layer Browser/Electron/native wiring.                             | Delete capabilities as vertical slices from UI through protocol/client/daemon/tests/docs; run zero-residual searches.                                                |
| False platform stubs hid dead client code.                                                     | Delete unreachable branches instead of returning false/null to preserve obsolete structure.                                                                          |
| Mechanical rename commits carried unrelated feature dependencies.                              | Apply a deterministic identity transform against the new source tree; do not cherry-pick an old rename.                                                              |
| Deleting `package-lock.json` re-resolved floating ranges and caused ecosystem-wide type drift. | Preserve the source lockfile's resolved versions and change only intentional workspace/package identities.                                                           |
| Workspace declarations were stale after cross-package changes.                                 | Rebuild the owning stack before patching consumers; never add duplicate local types to mask stale declarations.                                                      |
| npm `bundleDependencies` behaved differently across platforms.                                 | Stage internal workspaces manually and validate the final tarball on Linux, macOS, and Windows.                                                                      |
| Bundled workspace dependencies became empty directories in global installs.                    | Make embedded workspaces code-only; let the public root package own the flattened external dependency graph.                                                         |
| A local install smoke passed while global install was broken.                                  | Install the tarball into a clean global prefix and exercise the generated global shim.                                                                               |
| JavaScript-only smoke missed native binding failures.                                          | Load `node-pty`, speech bindings, and MCP compatibility modules from the installed package.                                                                          |
| Repacking between smoke and publish changed the artifact.                                      | Publish the exact tarball that passed smoke; never rebuild between verification and publication.                                                                     |
| npm rejected a valid package late because `repository.url` was absent.                         | Assert registry-required metadata from the installed tarball before publication.                                                                                     |
| Trusted Publishing failed with an old npm.                                                     | Pin a Trusted-Publishing-capable npm in the workflow and keep OIDC permissions minimal.                                                                              |
| A release tag was created before remote CI was green.                                          | Version first without a Git tag; push the release commit; create the annotated tag only after exact-SHA CI succeeds.                                                 |
| Annotated tags resolve to tag objects as well as commits.                                      | Compare deployment SHA with `refs/tags/<tag>^{commit}`, never the unpeeled tag object.                                                                               |
| Moving/deleting a tag could deploy different source for an existing npm version.               | Protect `refs/tags/v*` against deletion and non-fast-forward updates with no bypass actors.                                                                          |
| `main` deployment mixed unreleased source with published packages.                             | `main` runs CI only; a successful npm publication is the sole normal deploy trigger.                                                                                 |
| A privileged `workflow_run` can execute untrusted metadata.                                    | Require same repository, push event, successful publisher, strict tag syntax, peeled SHA, ancestor-of-main proof, and successful push CI before secrets are exposed. |
| A newer `main` could race an already-published release.                                        | Deploy from the immutable tag/SHA attested by the publisher; do not require the tag to remain the tip of `main`.                                                     |
| Release jobs cancelled one another.                                                            | Serialize per surface and channel with `cancel-in-progress: false`.                                                                                                  |
| Registry propagation briefly returned the old dist-tag.                                        | Retry bounded npm dist-tag verification before triggering deployment.                                                                                                |
| Beta CLI opened Stable Web/Relay.                                                              | Derive Web, Relay, CORS, pairing, help links, and self-update dist-tag from the installed release version.                                                           |
| Existing canonical Stable settings pinned a daemon to the wrong channel.                       | Treat only known Stable/Beta defaults as managed values; migrate them at load time while preserving custom/env overrides.                                            |
| Cloudflare Git integration could bypass release gates.                                         | Use direct-upload Pages projects with no Git provider; GitHub Actions owns deployments.                                                                              |
| A timeout was mistaken for a restart requirement.                                              | Treat timeouts as evidence; inspect logs and retry bounded probes before considering restart. Never restart port `6777` without permission.                          |
| Windows kept stopped smoke directories locked.                                                 | Make daemon stop a hard gate; make final temporary-directory deletion bounded and non-fatal only for known Windows lock errors.                                      |
| Local Node pins split global npm installs across Node versions.                                | Do not pin Node in the repo; verify CLI and daemon paths both use the user's global mise Node.                                                                       |
| A source replacement risked unrecoverable state/history loss.                                  | Back up daemon state and create an independently cloned, `git fsck`-verified offline bundle before destructive cutover.                                              |
| Reviews found concurrency and trust-boundary bugs after broad green tests.                     | Use independent read-only reviews focused on persistence transactions, client-to-daemon trust, protocol epochs, release trust, and full-diff residuals.              |
| Review hardening silently expanded a “sync” into weeks of work.                                | Report scope expansion immediately, separate source import from hardening, and require approval for the added responsibility.                                        |

## Proof ladder

Stop only after each rung passes; a higher rung does not replace a lower one.

1. **Source proof** — frozen tag/commit/tree, clean baseline, explicit overlay boundary.
2. **Static proof** — generated declarations, typecheck, lint, format, branding, residual search.
3. **Behavior proof** — focused tests for changed branches and trust boundaries.
4. **Artifact proof** — inspect tarball, clean global install, native loads, CLI shim.
5. **Runtime proof** — isolated daemon start/status/pair/stop on a reserved port and home.
6. **CI proof** — exact pushed SHA green on all platform jobs.
7. **Registry proof** — expected immutable version and dist-tag visible from npm.
8. **Deployment proof** — Pages and Worker identify the tagged SHA/version.
9. **Channel proof** — real pairing URL and relay connection use the intended channel; the other channel's deployment IDs remain unchanged.
10. **Recovery proof** — state/archive path exists and rollback target is known.

## Review boundaries

Always review these separately:

- **Persistence:** async read/write races, rollback snapshots, archive/reopen, atomic writes, old state compatibility.
- **Trust:** client-controlled paths/refs/hosts, Git option boundaries, OAuth-authenticated identity, origin/CORS handling.
- **Protocol:** old/new parse compatibility, connection generation/epoch, request/ack correlation.
- **Packaging:** root versus embedded dependency ownership, platform-specific native modules, generated shim.
- **Release:** tag timing, tag immutability, workflow event trust, exact artifact continuity, channel isolation.
- **Product boundary:** no Electron/native/Browser/website resurrection and no accidental loss of Web/PWA behavior.

## Cutover discipline

Order irreversible operations so every stop point is recoverable:

1. finish and review candidate offline;
2. back up state and Git refs;
3. push source, but do not tag;
4. wait for exact-SHA CI;
5. create one immutable tag;
6. wait for npm publication;
7. deploy only the matching channel;
8. verify online package, Web, Relay, pairing, and daemon;
9. confirm the other channel did not move;
10. announce completion.

Before the tag, source can be fixed normally. After the tag, npm is immutable: fix forward with a new version.

## Evidence in this repository

- Packaging implementation: `scripts/pack-byspace.mjs`
- Real global smoke: `scripts/smoke-byspace-package.mjs`
- Exact-artifact publisher: `scripts/publish-byspace.mjs`
- Version policy: `scripts/set-release-version.mjs`
- npm trust chain: `.github/workflows/npm-release.yml`
- Channel deploy gates: `.github/workflows/deploy-app.yml`, `.github/workflows/deploy-relay.yml`
- Operational release flow: `docs/release.md`
- Source update flow: `docs/upstream-sync.md`
