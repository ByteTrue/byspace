---
name: harden-byspace-release
description: Audit or repair BySpace release engineering across packaging, global npm installation, Trusted Publishing, exact-SHA CI, immutable tags, Cloudflare Pages/Relay deployment, Stable/Beta isolation, cutover, rollback, and post-release verification. Use for release-readiness reviews, failed releases, packaging/install bugs, CI/CD or Cloudflare changes, channel mismatches, or requests to distill release lessons without necessarily shipping a version.
---

# Harden BySpace release

Audit the full evidence chain, not just whether a build command passed.

## Read first

1. `docs/release-engineering.md`
2. `docs/release.md`
3. `scripts/pack-byspace.mjs`
4. `scripts/smoke-byspace-package.mjs`
5. `scripts/publish-byspace.mjs`
6. `.github/workflows/npm-release.yml`
7. `.github/workflows/deploy-app.yml`
8. `.github/workflows/deploy-relay.yml`

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

### Release trust

- Versioning does not create a tag before remote CI.
- `v*` tags are protected from deletion and non-fast-forward updates.
- Publisher requires strict tag/version match, current-main exact-SHA push CI, OIDC, and bounded npm dist-tag verification.
- Deploy workflows accept only successful same-repository publisher events, peel annotated tags, recheck exact SHA/CI/npm channel, and use minimal permissions.
- Release jobs serialize per channel with cancellation disabled.

### Channel isolation

- Stable maps to npm `latest`, `byspace.pages.dev`, and `byspace-relay`.
- Beta maps to npm `beta`, `byspace-beta.pages.dev`, and `byspace-relay-beta`.
- Runtime version selects app URL, relay, CORS, pairing/help links, and self-update dist-tag.
- Custom and environment endpoints remain authoritative.
- Deploying one channel leaves the other channel's Pages deployment and Worker version unchanged.

### Runtime and recovery

- CLI and daemon use the intended global Node environment.
- Production daemon restarts only with explicit permission.
- State backup and Git bundle exist before destructive cutover.
- Post-release proof includes registry, GitHub release, Pages SHA/version, Worker version, real pairing URL, relay connection, and daemon version.

## Method

Use the proof ladder in `docs/release-engineering.md`. Do not substitute local source execution for an installed-artifact test, a green CI badge for exact-SHA proof, or a successful deploy command for online channel verification.

When a review reveals work outside the requested responsibility, report the scope expansion and request approval. Prefer fix-forward after npm publication because versions and protected tags are immutable.

## Required result

Return blockers or `CLEAR`, the evidence checked at each proof rung, changes made if authorized, remaining risks, and an explicit list of production mutations.
