# Client distribution

BySpace publishes one immutable release tag across the hosted services, npm package, and downloadable clients. The active artifact workflow is `.github/workflows/client-release.yml` (`Publish clients`).

## Public release matrix

| Surface          | Stable | Beta   | Distribution                                                                 |
| ---------------- | ------ | ------ | ---------------------------------------------------------------------------- |
| Browser Web/PWA  | yes    | yes    | Cloudflare Pages                                                             |
| CLI + daemon     | yes    | yes    | npm `latest` / `beta`                                                        |
| Control Relay    | yes    | yes    | Cloudflare Worker                                                            |
| Electron Desktop | yes    | yes    | GitHub Release assets for macOS, Linux, and Windows                          |
| Android          | yes    | yes    | signed universal APK in GitHub Release assets                                |
| iOS              | **no** | **no** | maintained source/prebuild/tests only; active CD never builds or submits iOS |

A Stable tag is `vX.Y.Z`; a Beta tag is `vX.Y.Z-beta.N`. Desktop and Android assets use the same tag, source commit, and package version as npm/Web/Relay. They are not independent release trains.

## Immutable artifact flow

1. Push the release commit to `main` and wait for push-event `CI` to succeed on that exact SHA.
2. Create the immutable annotated release tag at that SHA.
3. `Publish npm`, `Deploy App`, `Deploy Relay`, and `Publish clients` all validate the tag and the successful exact-SHA CI run.
4. `Publish clients` checks out only `refs/tags/<tag>`, builds each public client, and fails if the checked-out commit, package version, and tag disagree.
5. The final publish job downloads all matrix artifacts, merges the per-architecture macOS and Windows updater manifests, stamps immediate rollout metadata, generates `client-release-manifest.json` and `SHA256SUMS.txt`, and verifies every file before upload.
6. Existing GitHub Release assets may only be reused when their SHA-256 matches. A different file with the same asset name is a hard failure; the workflow never uses `--clobber`.
7. The workflow downloads the published assets again and verifies the public copy against the manifest and checksums.

`Publish npm` creates the GitHub Release. `Publish clients` waits for that exact-tag release, then attaches the verified assets idempotently. It has no manual dispatch path: recovery reruns only failed jobs in the original tag-triggered run so successful build artifacts are reused byte-for-byte. If those retained artifacts are unavailable, fix forward with a new version instead of rebuilding an already-partially-published tag.

## Desktop assets and signing

Desktop builds publish:

- macOS arm64 and x64: DMG + ZIP + updater metadata;
- Linux x64: AppImage, deb, rpm, tar.gz + updater metadata;
- Windows x64 and arm64: NSIS installer, ZIP + updater metadata.

Each architecture is built and smoked on a native-architecture GitHub runner (`macos-14` arm64, `macos-15-intel` x64, `windows-11-arm` arm64, `windows-2022` x64). This prevents host-architecture optional/native dependencies from leaking into a cross-compiled package.

All platform packagers run from `packages/desktop`. `scripts/verify-desktop-package.mjs` validates JavaScript runtime entries inside `app.asar`, native `node-pty` and platform `@esbuild` binaries under `app.asar.unpacked`, updater metadata, and the platform CLI wrapper after the packaged runtime smoke; release checks must not assume an unpacked `resources/app` tree.

Every public file is covered by `SHA256SUMS.txt` and the client manifest. OS code signing is applied when the corresponding GitHub release credentials are configured:

- macOS GitHub secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`;
- Windows GitHub secrets: `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`.

Both macOS entitlement files are tracked release inputs. Without Apple credentials, the `afterSign` hook applies and verifies an ad-hoc signature: it proves bundle integrity but is not Developer ID trust or notarization. Without Windows credentials, the checksummed Windows artifact is unsigned. Partially configured credentials are a release error, and release notes must disclose the verified signing state.

Electron updater manifests are immutable release assets. Rollout for a new release starts at 100%; a workflow must never mutate a previously published manifest to change rollout percentage.

## Android signing and update identity

The Android APK is a production release build of `com.bytetrue.byspace`, signed with the permanent BySpace Android release key. Active CD requires all four secrets and fails closed when any is missing:

- `ANDROID_RELEASE_KEYSTORE_BASE64`
- `ANDROID_RELEASE_KEYSTORE_PASSWORD`
- `ANDROID_RELEASE_KEY_ALIAS`
- `ANDROID_RELEASE_KEY_PASSWORD`

The public certificate identity is pinned in `.github/release/android-signing.json`. CD verifies the APK with `apksigner`, compares its certificate SHA-256 with that file, then installs and launches the APK on a clean emulator before publication.

Never rotate or replace the Android signing key as an ordinary release fix: devices only accept upgrades signed by the same key. The private owner recovery bundle is outside the repository at `~/.config/byspace/release-secrets/android-release-v1.jks` plus `android-release-v1.env`; both files must remain mode 600 and be backed up together through the owner's secure secret-storage process.

BySpace currently distributes a signed universal APK directly from GitHub Releases. Google Play publishing is not part of the active release boundary.

## iOS boundary

BySpace intentionally does not publish iOS because no Apple distribution certificate is provisioned for this product boundary. Keep all of the following maintained and tested:

- shared Expo/React Native source and `.native` boundaries;
- iOS prebuild closure and native module autolinking;
- simulator/device test source, Maestro source, EAS profiles, and Fastlane implementation;
- App Store-compatible restrictions such as no daemon-delivered dynamic plugin client bundles.

Do not keep executable iOS CD definitions. Historical upstream EAS workflow source lives under `packages/app/release-source/eas-workflows/`, outside `.eas/workflows/`, so EAS cannot execute it as active CD. Moving it back requires an explicit product decision and release-engineering review.

## Download and verification

The canonical client download page is the latest GitHub Release:

```text
https://github.com/ByteTrue/byspace/releases/latest
```

The website links there directly. Users can verify a download from the Release directory with:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

On Linux, `sha256sum -c SHA256SUMS.txt` is equivalent.

## Release verification

A release is not complete until all applicable public clients are present and checked:

- expected asset inventory matches `client-release-manifest.json` exactly;
- checksums verify after downloading from the public GitHub Release;
- Android signer fingerprint matches `.github/release/android-signing.json` and the APK installs/upgrades;
- packaged Desktop smoke passes on macOS, Linux, and Windows runners;
- updater metadata names only assets in the same Release;
- iOS assets, iOS build jobs, TestFlight submission, and App Store submission are absent;
- npm/Web/Relay channel checks pass and the other channel remains unchanged.
