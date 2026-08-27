# Release process

BySpace has two complete release channels. A channel is the npm package, Web/PWA, Relay, Electron Desktop clients, and Android APK together; mixing those surfaces is not supported. iOS is maintained but intentionally never published.

Related process docs:

- `docs/release-engineering.md` — incident-derived controls and proof ladder.
- `docs/client-distribution.md` — Desktop/Android artifact matrix, signing, checksums, and iOS no-publish boundary.
- `docs/upstream-sync.md` — release-level delta synchronization workflow.

| Channel | npm dist-tag | Web                              | Relay                                | Client assets                            |
| ------- | ------------ | -------------------------------- | ------------------------------------ | ---------------------------------------- |
| Stable  | `latest`     | `https://app.byspace.cc.cd`      | `wss://relay.byspace.cc.cd:443`      | Stable GitHub Release: Desktop + Android |
| Beta    | `beta`       | `https://app-beta.byspace.cc.cd` | `wss://relay-beta.byspace.cc.cd:443` | GitHub prerelease: Desktop + Android     |

The same immutable tag and exact source SHA own every row. Active release CD must not contain an iOS build, submit, or upload path. The existing `packages/website` keeps its separate deployment lifecycle but links to the latest GitHub client release.

## Source baseline

The currently integrated upstream baseline is `v0.5.1`, commit `f517493591a7b4072aa30ee48db13c1a51495103`, tree `fc096ff4bc53515c14a8e53d7d7adc6118f94974`. The default branch keeps BySpace-owned ancestry; README and the root commit retain public source attribution.

Future upstream updates port the aggregate delta between this complete multi-client baseline and an approved newer stable release onto current BySpace `main`. They do not replace the current tree, replay upstream commits, repeat identity migration, omit maintained client surfaces, or rewrite public history. Follow `docs/upstream-sync.md`.

## Release invariants

- `main` runs CI only. It never deploys or publishes either public channel.
- Create a release tag only after push-event `CI` succeeds on that exact current `main` SHA.
- Version scripts update and stage files but do not create a commit or tag. Review the release commit first.
- Immediately before tagging, release SHA, CI SHA, local `HEAD`, and fetched `origin/main` must still be equal.
- Release tags match `vX.Y.Z` or `vX.Y.Z-beta.N` and are immutable.
- `Publish npm` verifies tag, package version, current `main`, and exact-SHA CI before publishing.
- Exact-SHA CI builds the canonical Web distribution and npm tarball once, records commit/version/SHA-256 manifests, and smoke-tests the tarball on Linux/macOS/Windows. Publisher and Pages workflows promote those exact artifacts rather than rebuilding.
- Successful `Publish npm` is the only trigger for the channel-specific Pages and Relay workflows.
- The same tag independently triggers `Publish clients`, which checks exact-SHA CI, builds Desktop and signed Android artifacts, and publishes them idempotently to the matching GitHub Release.
- GitHub Release assets are immutable by name and SHA-256: retries may reuse identical bytes but may never clobber a different file.
- Deployment workflows accept only successful same-repository tag runs, peel annotated tags, and deploy the immutable tagged SHA. They do not require `main` to remain frozen after npm publication.
- Prerelease daemons default to Beta Web/Relay and npm `beta`; stable daemons default to Stable and npm `latest`. Desktop updater metadata follows the same channel.
- iOS source/prebuild/tests remain release-gated, but no active release workflow may build, submit, or upload iOS.

## Version classification

Classify from the product, not from the diff. Commit count, changed-line count, and new RPC count are not inputs.

- **patch** — the user would say “good, that was broken”, or would not notice: fixes, refactors, performance, docs, internal rework, and upstream syncs with no new capability.
- **minor** — the user would say “there is something new”: any capability they can see, reach, or configure. A new `server_info.features.*` gate is minor. Changing a product default users depend on is also minor.
- **major** — reserved and never selected by an agent. It means the upgrade contract broke and users must migrate state, edit config, or change invocation.

While the version is `0.x`, major stays parked and minor carries every user-visible capability. Do not propose `1.0` while BySpace still absorbs deltas from a pre-`1.0` upstream or can retire a shipped endpoint without compatibility work.

## Required local checks

```bash
npm ci
npm run branding:check
npm run build:server
npm run typecheck
npm run lint
npm run format:check
npm run build:web --workspace=@bytetrue/byspace-app
npm run release:check
node --test scripts/apksigner-certificate-sha256.test.mjs scripts/client-release-manifest.test.mjs scripts/release-workflows.test.mjs scripts/verify-desktop-package.test.mjs
```

`release:check` builds and validates a local candidate before version-control changes. Exact-SHA CI independently creates and verifies the canonical Web/npm artifacts. The immutable tag separately causes `Publish clients` to build and smoke packaged Desktop targets plus the signed Android APK, then generate and publicly re-verify `client-release-manifest.json` and `SHA256SUMS.txt`.

## Beta release

1. Classify the change and select `X.Y.Z-beta.N`; agents never select major. Run the matching `version:all:beta:*` command, confirm it created no commit/tag, then update the changelog.
2. Run all required checks and channel-focused tests, including client workflow policy tests.
3. Commit and push release preparation; wait for push-event `CI` on that exact SHA.
4. Fetch `origin/main` and prove release SHA = CI SHA = local `HEAD` = `origin/main`. Stop if `main` advanced.
5. Confirm the `main` push did not deploy App/Relay or publish clients. Record npm `latest`, Stable deployment IDs, and the current Stable client manifest.
6. Create and push annotated tag `vX.Y.Z-beta.N` once. Never move it.
7. `Publish npm` publishes the exact CI tarball under npm `beta` and creates/updates the GitHub prerelease.
8. Publication deploys Beta Pages/Relay; tag-triggered `Publish clients` uploads Desktop and Android assets to that same prerelease. No iOS job or asset may exist.
9. Verify npm `beta`, Beta Web/Relay, a real Beta pairing/relay connection, complete public client manifest/checksums, Android signer/install/launch, and packaged Desktop smokes. Confirm npm `latest`, Stable deployments, and Stable client manifest did not move.

## Stable release or beta promotion

1. Select stable `X.Y.Z` with `version:all:promote`, `version:all:patch`, or `version:all:minor`; confirm it created no commit/tag. Update the changelog.
2. Run all required checks, including client workflow policy tests.
3. Commit and push release preparation; wait for exact-SHA CI.
4. Fetch `origin/main` and prove release SHA = CI SHA = local `HEAD` = `origin/main`. Stop if `main` advanced.
5. Confirm the `main` push did not deploy App/Relay or publish clients. Record npm `beta`, Beta deployment IDs, and the current Beta client manifest.
6. Create and push annotated tag `vX.Y.Z` once.
7. `Publish npm` publishes the exact CI tarball under npm `latest` and creates/updates the Stable GitHub release.
8. Publication deploys Stable Pages/Relay; tag-triggered `Publish clients` uploads Desktop and Android assets to the same release. No iOS job or asset may exist.
9. Verify npm `latest`, Stable Web/Relay, a real Stable pairing/relay connection, complete public client manifest/checksums, Android signer/install/launch, and packaged Desktop smokes. Confirm npm `beta`, Beta deployments, and Beta client manifest did not move.

## Cloudflare resources

Cloudflare account: `835cd580057df97323a7854a8069c5f1`.

All resources are direct-upload resources with no Cloudflare Git integration. GitHub Actions owns normal releases:

- Pages: `byspace`, `byspace-beta`
- Workers: `byspace-relay`, `byspace-relay-beta`

Pages rollback uses a prior successful production deployment. Worker rollback uses `wrangler rollback <version-id> --name <worker>`. Rollback is emergency recovery, not a substitute for publishing a coherent channel.

## Rollback and repair

npm versions and client assets are immutable: fix forward with a new version.

- If npm publication succeeded but its workflow failed later, rerun `Publish npm`; it skips republishing the immutable version and resumes downstream steps after dist-tag verification catches up.
- If client publication failed, rerun only the failed jobs in the original tag-triggered `Publish clients` run so retained build artifacts are reused. There is no manual dispatch/rebuild path for an existing tag. Identical assets are accepted; different bytes under an existing name are rejected. If retained artifacts are unavailable, fix forward with a new version.
- Never delete/reupload a client asset or mutate updater manifests to repair a release.
- If App or Relay failed, rerun that immutable workflow. Emergency hosted-surface rollback must be reconciled with a new package version.
- Published client binaries remain attached to their original tag.

Before any destructive repository operation, preserve affected refs in a verified offline Git bundle. Routine upstream synchronization uses normal commits and does not replace public history.
