# Release process

BySpace publishes only:

- `@bytetrue/byspace` — the `byspace` CLI and local daemon;
- the browser Web/PWA to Cloudflare Pages project `byspace`;
- the encrypted relay to Cloudflare Worker `byspace-relay`.

Electron, native iOS/Android, app-store builds, Browser automation, and a marketing website are not release surfaces.

## Source baseline

The current source snapshot is upstream `v0.2.0-beta.1`, commit `0bec06c2db7d3ee071416cde80229eabd682b03e`. The default branch has clean BySpace-only ancestry; the source URL, commit, tree, and AGPL license are recorded in the root commit and README.

Future upstream updates are release-level snapshot updates, not per-commit cherry-picks. Build the next clean source snapshot, reapply the bounded Web-only/identity/release changes, verify it, then replace `main` only after explicit approval.

## Required checks

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

`release:check` builds one `@bytetrue/byspace` tarball, installs it into a clean global prefix, loads native dependencies, and proves CLI plus isolated daemon start/status/stop. Publishing reuses that exact artifact.

## Beta release

1. Start from a clean `main` at version `X.Y.Z-beta.N`.
2. Push the release commit and wait for push-event `CI` on that exact SHA.
3. Push only tag `vX.Y.Z-beta.N`.
4. `npm-release.yml` proves the tag still equals current `main` and that exact-SHA CI succeeded.
5. Trusted Publishing publishes the already-smoked tarball with npm dist-tag `beta` and creates a prerelease.
6. Keep npm `latest` unchanged until a stable release is approved.

## Cloudflare deployment

`Deploy App` and `Deploy Relay` consume successful push-event CI for `main`, reject stale SHAs before work and immediately before deployment, and serialize production deployment.

- Pages: `https://byspace.pages.dev`
- Relay: `wss://byspace-relay.bytetrue.workers.dev:443`
- Account: `835cd580057df97323a7854a8069c5f1`

Manual workflow dispatch is an explicit operator override and still deploys only the current checked-out `main` SHA.

## Rollback

npm versions are immutable: fix forward with a new version. Pages and Relay may be redeployed from a known-good commit. Before a clean-history cutover, preserve the old repository in a verified offline Git bundle; do not keep old ancestry on the public default branch.
