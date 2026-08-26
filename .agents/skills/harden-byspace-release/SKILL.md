---
name: harden-byspace-release
description: Audit or repair BySpace release engineering across npm packaging, Trusted Publishing, exact-SHA CI, immutable tags, Web/Relay deployment, signed Android APK, Electron Desktop assets, checksums/manifests, Stable/Beta isolation, iOS no-publish enforcement, rollback, and post-release verification. Use for release-readiness reviews, failed releases, packaging/install bugs, client artifacts, signing, CI/CD or Cloudflare changes, or channel mismatches.
---

# Harden BySpace release

Audit the full evidence chain, not just whether a build command passed.

## Read first

1. `docs/release-engineering.md`
2. `docs/release.md`
3. `docs/client-distribution.md`
4. `scripts/pack-byspace.mjs`
5. `scripts/smoke-byspace-package.mjs`
6. `scripts/client-release-manifest.mjs`
7. `scripts/publish-byspace.mjs`
8. `.github/workflows/npm-release.yml`
9. `.github/workflows/client-release.yml`
10. `.github/workflows/deploy-app.yml`
11. `.github/workflows/deploy-relay.yml`

Read only additional files implicated by the failure or proposed change.

## Choose the task

- **Audit only:** return ranked blockers with file/line evidence and the missing proof. Do not edit or deploy.
- **Repair:** fix the smallest root cause, add one regression check, and run the affected proof ladder.
- **Recovery:** preserve evidence, identify the last immutable good package/deployment, and propose rollback or fix-forward steps before mutating production.
- **Pre-release review:** validate every gate below, then hand off to `release-beta` or `release-stable`; do not create a tag yourself unless that release skill is active.

## Audit gates

### Source and artifact

- One version across root and workspaces.
- Clean lockfile and generated workspace declarations.
- Embedded workspaces are code-only; root package owns external dependencies.
- Final tarball has repository metadata, executable shim, expected internal packages, and no empty dependency stubs.
- Smoke installs globally into a clean prefix, loads native modules, and starts/stops an isolated daemon.
- Publish reuses the exact smoke-tested tarball.
- Client jobs build from the same immutable tag/SHA, never from a caller-selected ref.
- Public Desktop/Android assets have an exact inventory, SHA-256 checksums, signing metadata, and public re-download proof.
- iOS workflow definitions are absent from active GitHub/EAS CD directories; maintained reference source is non-executable.

### Release trust

- Versioning does not create a tag before remote CI.
- `v*` tags are protected from deletion and non-fast-forward updates.
- Publisher requires strict tag/version match, current-main exact-SHA push CI, OIDC, and bounded npm dist-tag verification.
- Deploy workflows accept only successful same-repository publisher events, peel annotated tags, recheck exact SHA/CI/npm channel, and use minimal permissions.
- Release jobs serialize per channel with cancellation disabled.

### Channel isolation

- Stable maps to npm `latest`, `app.byspace.cc.cd`, `byspace-relay`, and Stable GitHub Desktop/Android assets.
- Beta maps to npm `beta`, `app-beta.byspace.cc.cd`, `byspace-relay-beta`, and prerelease GitHub Desktop/Android assets.
- Runtime version selects app URL, relay, CORS, pairing/help links, self-update dist-tag, and Desktop update channel.
- Custom and environment endpoints remain authoritative.
- Deploying one channel leaves the other channel's npm/Web/Relay/client assets and manifests unchanged.

### Runtime and recovery

- CLI and daemon use the intended global Node environment.
- Production daemon restarts only with explicit permission.
- State backup and Git bundle exist before destructive cutover.
- Post-release proof includes registry, GitHub release client inventory/checksums/signing state, Android install/launch, Desktop smoke, explicit iOS absence, Pages SHA/version, Worker version, real pairing URL, relay connection, and daemon version.

## Method

Use the proof ladder in `docs/release-engineering.md`. Do not substitute local source execution for an installed-artifact test, a green CI badge for exact-SHA proof, or a successful deploy command for online channel verification.

When a review reveals work outside the requested responsibility, report the scope expansion and request approval. Prefer fix-forward after npm publication because versions and protected tags are immutable.

## Required result

Return blockers or `CLEAR`, the evidence checked at each proof rung, changes made if authorized, remaining risks, and an explicit list of production mutations.
