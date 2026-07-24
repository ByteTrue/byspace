# Release process

BySpace has two complete release channels. A channel is the npm package, Web/PWA, and relay together; mixing those surfaces is not a supported release.

Related process docs:

- `docs/release-engineering.md` — incident-derived controls and proof ladder.
- `docs/upstream-sync.md` — source-snapshot update workflow.

| Channel | npm dist-tag | Web                              | Relay                                               |
| ------- | ------------ | -------------------------------- | --------------------------------------------------- |
| Stable  | `latest`     | `https://byspace.pages.dev`      | `wss://byspace-relay.bytetrue.workers.dev:443`      |
| Beta    | `beta`       | `https://byspace-beta.pages.dev` | `wss://byspace-relay-beta.bytetrue.workers.dev:443` |

Electron, native iOS/Android, app-store builds, Browser automation, and a marketing website are not release surfaces.

## Source baseline

The current source snapshot is upstream `v0.2.0-beta.1`, commit `0bec06c2db7d3ee071416cde80229eabd682b03e`. The default branch has clean BySpace-only ancestry; the root commit records the source URL, commit, tree, and AGPL license, while README keeps the public attribution link.

Future upstream updates are release-level snapshot updates, not per-commit cherry-picks. Build the next clean source snapshot, reapply the bounded Web-only/identity/release changes, verify it, then replace `main` only after explicit approval. Follow `docs/upstream-sync.md`.

## Release invariants

- `main` runs CI only. It never deploys either public channel.
- A release tag is created only after push-event `CI` succeeds on that exact current `main` SHA.
- Version scripts update and stage files but do not create a commit or tag; the release commit is reviewed first and the annotated tag is created only after remote exact-SHA CI.
- Immediately before tagging, release SHA, CI SHA, local `HEAD`, and fetched `origin/main` must still be equal.
- Release tags match `vX.Y.Z` or `vX.Y.Z-beta.N` and are immutable under the repository's `Immutable release tags` ruleset.
- `Publish npm` verifies tag, package version, current `main`, and exact-SHA CI before publishing.
- Successful `Publish npm` is the sole trigger for the channel-specific Pages and Relay workflows.
- Deployment workflows accept only successful same-repository tag runs, peel annotated tags, and deploy the immutable tagged SHA. They do not require `main` to remain frozen after npm publication.
- Prerelease daemons default to the Beta Web/Relay and self-update from npm `beta`; stable daemons default to Stable and self-update from npm `latest`. Custom endpoints and environment overrides remain supported.

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

1. Classify the change as patch or minor and select `X.Y.Z-beta.N`; agents never select major autonomously. Run the matching `version:all:beta:*` command, confirm it created no commit/tag, then update the changelog.
2. Run all required checks and channel-focused tests.
3. Commit and push the release preparation; wait for push-event `CI` on that exact SHA.
4. Immediately before tagging, fetch `origin/main` and prove release SHA = CI SHA = local `HEAD` = `origin/main`. Stop if `main` advanced.
5. Confirm the `main` push did not deploy App or Relay, then record npm `latest` and the current Stable deployment IDs.
6. Create and push annotated tag `vX.Y.Z-beta.N` once. Do not move it.
7. `Publish npm` publishes npm dist-tag `beta` and creates a GitHub prerelease.
8. Successful publication deploys `byspace-beta` Pages and `byspace-relay-beta` Worker from the tagged SHA.
9. Verify npm `beta`, `https://byspace-beta.pages.dev`, the Beta Worker deployment, a real Beta daemon pairing URL, and relay connection. Confirm npm `latest` and Stable deployment IDs did not move.

## Stable release or beta promotion

1. Select stable version `X.Y.Z` with `version:all:promote`, `version:all:patch`, or `version:all:minor`; confirm it created no commit/tag. For promotion, replace the Beta changelog heading; for a fresh Stable release, create the Stable entry.
2. Run all required checks.
3. Commit and push the release preparation; wait for exact-SHA CI.
4. Immediately before tagging, fetch `origin/main` and prove release SHA = CI SHA = local `HEAD` = `origin/main`. Stop if `main` advanced.
5. Confirm the `main` push did not deploy App or Relay, then record npm `beta` and the current Beta deployment IDs.
6. Create and push annotated tag `vX.Y.Z` once.
7. `Publish npm` publishes npm dist-tag `latest` and creates the Stable GitHub release.
8. Successful publication deploys `byspace` Pages and `byspace-relay` Worker from the tagged SHA.
9. Verify npm `latest`, Stable Web, Stable Relay, and a real Stable daemon pairing/relay connection. Confirm npm `beta` and Beta deployment IDs did not move.

## Cloudflare resources

Cloudflare account: `835cd580057df97323a7854a8069c5f1`.

All four projects are direct-upload resources with no Cloudflare Git integration. GitHub Actions owns normal release deployments:

- Pages projects: `byspace`, `byspace-beta`
- Workers: `byspace-relay`, `byspace-relay-beta`

Pages rollback uses a prior successful production deployment. Worker rollback uses `wrangler rollback <version-id> --name <worker>`. Rollbacks are operational recovery, not a substitute for publishing a coherent channel release.

## Rollback

npm versions are immutable: fix forward with a new version. If npm publication succeeded but `Publish npm` failed before creating the GitHub release or triggering deployments, rerun `Publish npm`; it skips republishing the immutable version and resumes the downstream release steps once npm dist-tag verification catches up. If a channel deployment itself failed, rerun the failed `Deploy App` or `Deploy Relay` workflow run; the immutable triggering event retains the release tag and SHA. Pages and Relay can be rolled back independently for emergency recovery, then must be reconciled with a new package version.

Before a clean-history cutover, preserve the old repository in a verified offline Git bundle; do not keep old ancestry on the public default branch.
