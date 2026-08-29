# Release

All workspaces share one source version. Public npm distribution is one package:
`@bytetrue/byspace`.

## Authority

A release has two phases:

1. **Prepare** — format, build, test, review, version, and commit locally.
2. **Publish** — push the release commit to `main`, wait for exact-SHA CI, then push the
   immutable `v*` tag.

The agent may prepare a release after a release request. Pushing `main`, creating the tag,
or publishing public artifacts requires the user's explicit approval. Last-minute source
changes require approval again.

## Toolchain

Use the versions in `.tool-versions`:

- Node `22.20.0`
- npm `10.9.3`

Build workspace declarations before typechecking a fresh checkout:

```bash
npm ci
npm run build:server
npm run build:app-deps
npm run typecheck
npm run lint
npm run format:check
```

Run only targeted local tests. Do not run the full test suite on a development machine.
Do not run daemon start, stop, or restart commands while validating a release. Daemon
lifecycle smoke tests belong on isolated GitHub runners.

Use an isolated `TMPDIR` for Expo/Metro release builds so an existing development cache
cannot contaminate the bundle.

## Release identity

A release commit must satisfy all of these conditions:

- `HEAD` is the intended `main` commit
- `origin/main` resolves to the same SHA
- the working tree is clean
- the root and workspace package versions match
- the release tag is exactly `v<package version>`
- a successful `CI` push run exists for that exact SHA before the tag is pushed

Every production workflow repeats the same current-main and successful-CI checks. Build
jobs checkout the verified commit SHA rather than a mutable branch or tag.

## Prepare a beta

Choose one command:

```bash
npm run release:beta:patch
npm run release:beta:minor
npm run release:beta:next
```

The command runs `release:check`, creates the version commit, and invokes
`release:push`. The first `release:push` invocation pushes the commit to `main` but
refuses to create the tag until CI for that exact SHA is green. This non-zero exit while
CI is pending is expected.

Wait for CI, then run:

```bash
npm run release:push
```

The second invocation verifies the successful CI run and pushes the tag. Tag workflows
publish the beta. npm uses the `beta` dist-tag; `latest` does not move.

## Prepare a stable release

Choose one command:

```bash
npm run release:patch
npm run release:minor
npm run release:promote
```

The same two-phase `release:push` rule applies. Stable npm publication uses `latest`.
After publication, move `beta` to the same stable version so beta users do not remain on
an older prerelease:

```bash
version=$(node -p 'require("./package.json").version')
npm dist-tag add "@bytetrue/byspace@$version" beta
```

A major release requires an explicit product decision. Do not choose it automatically.

## First ByteTrue baseline

The `v0.7.0-beta.2` baseline already has the intended version, so it does not run a
version command. Merge the reviewed derived commit to `main`, wait for exact-SHA CI, and
then run `npm run release:push` from a clean `main` checkout.

The upstream Paseo annotated tag is preserved at
`refs/upstream/tags/v0.7.0-beta.2`. If a local global tag with the same name still points
to the upstream commit, verify the namespaced ref first and remove only the local global
tag before creating the ByteTrue tag. Never move a remote published tag.

## Publication matrix

A `v*` tag starts these production paths:

| Workflow                   | Output                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `npm-release.yml`          | `@bytetrue/byspace`, plus the identical npm tarball and SHA-256 file on the GitHub Release |
| `desktop-release.yml`      | unsigned/unnotarized macOS, Windows, and Linux assets plus updater manifests               |
| `ios-unsigned-release.yml` | unsigned iOS device `.ipa` that requires user re-signing                                   |
| `docker.yml`               | `ghcr.io/bytetrue/byspace:<version>`; stable releases also move `latest`                   |
| `deploy-app.yml`           | Web/PWA deployment to `https://app.byspace.cc.cd`                                          |

Build the Android APK on the release development machine before creating the tag. Upload its
verified bytes after a tag workflow creates the GitHub Release.

Marketing website deployment, relay deployment, release-note mutation, desktop manifest
restamping, Nix publication, EAS cloud builds, store submission, TestFlight, App Store, and
Play Store workflows are absent from this release line. `nix.yml` remains a pull-request
source-build check only.

## Dry-run workflows

iOS, npm, and Desktop accept `workflow_dispatch` with `publish=false`. Dry-run jobs use
read-only source permissions, checkout with `persist-credentials: false`, and upload only
private workflow artifacts. They receive no OIDC, signing, or production upload credentials.

## Local Android APK

From a clean checkout whose `HEAD` equals green `origin/main`, run:

```bash
npm run release:android:local
```

The script uses `eas build --local`; Expo orchestrates the build on the development machine
without entering the EAS cloud queue. It reads the ByteTrue keystore and password variables
from `$BYSPACE_RELEASE_SECRETS_DIR`, defaulting to
`~/.config/byspace/release-secrets`. It writes the verified APK and checksum under
`dist/android/`.

After the tag workflows create the GitHub Release, upload those exact bytes:

```bash
version=$(node -p 'require("./package.json").version')
sha=$(git rev-parse HEAD)
asset="dist/android/BySpace-$version-android.apk"
GITHUB_REPOSITORY=ByteTrue/byspace scripts/upload-release-asset.sh "v$version" "$asset" "$sha"
GITHUB_REPOSITORY=ByteTrue/byspace scripts/upload-release-asset.sh "v$version" "$asset.sha256" "$sha"
```

## npm package

`scripts/package-bytetrue-baseline.mjs` stages one tarball from the existing workspace
builds. It embeds these internal runtime packages under
`node_modules/@getpaseo/`:

- `highlight`
- `relay`
- `protocol`
- `client`
- `plugin`
- `server`

The source workspaces and internal package names remain unchanged. External runtime and
peer dependencies are lifted into the public root manifest. Installation verification
points the `@getpaseo` registry at an invalid URL, proving that installation does not
fetch internal packages.

Useful local checks:

```bash
npm run release:check
npm run release:publish:beta:dry-run
```

`release:check` requires a clean worktree. Local scripts never publish to npm. The npm
workflow publishes through GitHub Actions OIDC Trusted Publishing after the release tag
passes the exact-SHA gate.

## Signing

- Android release artifacts use local EAS Build with the ByteTrue keystore. The local script
  verifies the exact source SHA, sole signer certificate, package ID, version, four native
  ABIs, and SHA-256 checksum before publication.
- macOS and Windows artifacts are unsigned. macOS builds disable signing, hardened
  runtime, and notarization.
- The unsigned device IPA requires the user to re-sign and sideload it. A free Apple
  account cannot produce a generally distributable IPA. Simulator artifacts are not published.

State these limitations in `.github/release/<tag>.md`.

## Desktop rollout

Stable updater manifests are stamped once with a 36-hour linear rollout. Beta clients
bypass the rollout. Manual **Check** bypasses staged admission.

Published manifests are immutable. Do not restamp an existing release to change rollout
speed. Ship a new version to change bytes or release metadata.

## Release notes

Create `.github/release/<tag>.md` before tagging. Workflows use it when creating the
GitHub Release. There is no workflow that creates or rewrites a release from
`CHANGELOG.md`.

Changelog headings use exactly:

```text
## X.Y.Z - YYYY-MM-DD
## X.Y.Z-beta.N - YYYY-MM-DD
```

Each bullet is one short, factual user-facing change without a trailing period. Do not
turn implementation details into product claims. Read the relevant PR descriptions and
linked issues before attributing a change.

## Hosted surfaces

- Web/PWA: `https://app.byspace.cc.cd`
- Relay default: `relay.byspace.cc.cd:443`
- Hub default: `https://hub.byspace.cc.cd`
- Container: `ghcr.io/bytetrue/byspace`
- Source and downloads: `https://github.com/ByteTrue/byspace`

This repository does not deploy the marketing website, Relay, or Hub as part of a core
release.

## Immutability and retries

Never move or force-push a published `v*` tag. Before every public upload, workflows
fetch the remote tag again and compare its peeled commit with the gated SHA.

GitHub Release assets use `scripts/upload-release-asset.sh`. A retry succeeds only when
an existing asset has identical bytes. It fails instead of overwriting different bytes.
If npm, GHCR, or any GitHub Release asset has already been published and source or bytes
must change, cut a new version.

A failed job may be rerun for the same immutable commit. Manual publishing is allowed
only when the workflow repeats the current-main and exact-SHA CI gate.

For a Docker-only retry:

```bash
gh workflow run docker.yml \
  --ref main \
  -f byspace_version=X.Y.Z-beta.N \
  -f publish=true
```

## Completion checklist

A release is shipped only after every applicable item passes:

- [ ] the release commit is the intended `origin/main` SHA
- [ ] the `CI` push run for that exact SHA is green
- [ ] the remote `v*` tag points to that SHA
- [ ] npm resolves `@bytetrue/byspace` under the intended dist-tag
- [ ] a clean install exposes `byspace`, not `paseo`
- [ ] the GitHub Release contains the npm tarball and SHA-256 file
- [ ] macOS, Windows, and Linux assets and channel manifests are present
- [ ] the Android APK signer certificate matches the approved ByteTrue certificate
- [ ] the unsigned iOS IPA and checksum are present
- [ ] the versioned GHCR image resolves and passes its isolated smoke check
- [ ] `https://app.byspace.cc.cd` serves the released Web/PWA
- [ ] published release assets match their recorded checksums
- [ ] no marketing website, Relay, Hub, or store submission was triggered

Report pending workflows as in progress, not shipped.
