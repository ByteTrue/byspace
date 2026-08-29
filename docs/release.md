# Release

Use Node 22.20.0 and npm 10.9.3. Run release commands from a clean `main` checkout.

## Published targets

| Target  | Publication path                                         |
| ------- | -------------------------------------------------------- |
| npm     | `@bytetrue/byspace` with the `beta` or `latest` dist-tag |
| Web/PWA | Cloudflare Pages project `byspace`                       |
| Docker  | `ghcr.io/bytetrue/byspace:<version>`                     |
| Desktop | GitHub Release artifacts for macOS, Windows, and Linux   |
| iOS     | One unsigned device IPA on the GitHub Release            |
| Android | One locally built and signed APK on the GitHub Release   |

The iOS IPA requires user re-signing. The Android APK uses the long-lived ByteTrue release key and does not depend on Google Play or EAS.

## Prepare

1. Confirm the worktree is clean and on `main`.
2. Confirm `HEAD` equals `origin/main`.
3. Confirm CI passed for that exact SHA.
4. Run:

   ```bash
   npm ci
   npm run build:server
   npm run build:app-deps
   npm run lint
   npm run typecheck
   npm run format:check
   npm run release:check
   ```

5. Verify the consolidated npm tarball:

   ```bash
   npm run release:publish:beta:dry-run
   ```

6. Build the Web/PWA output:

   ```bash
   npm run build:web --workspace=@getpaseo/app
   ```

## Android APK

Build Android on the release development machine. Do not use EAS Cloud or EAS Local.

1. Run `expo prebuild --platform android` once for the release SHA.
2. Run Gradle `:app:assembleRelease`, excluding Android lint tasks already covered by CI.
3. Reuse the generated `packages/app/android` directory and Gradle cache if the build must be retried.
4. Sign with the ByteTrue Android release key.
5. Verify the APK package is `com.bytetrue.byspace`, its version matches `packages/app/native-release-version.js`, and `apksigner verify --print-certs` reports the expected release certificate.
6. Write `BySpace-<version>-android.apk.sha256` next to the APK.

Keep the keystore and passwords outside the repository. Use the same release key for every future Android update.

## Dry-runs

Before tagging, run these workflows with the current `main` SHA:

- Desktop Release with `dry_run=true`
- iOS Unsigned Release with `dry_run=true`
- npm Release with `dry_run=true`
- Docker with `dry_run=true`

The iOS workflow builds only the unsigned device IPA. It does not build Simulator artifacts.

## Tag and publish

After every prepare step and dry-run succeeds:

```bash
npm run release:push
```

`release:push` waits for successful CI on the exact `main` SHA before creating the version tag.

The tag starts npm, Web/PWA, Docker, Desktop, and iOS publication. Wait for all workflows to finish. Upload the already verified Android APK and checksum after the GitHub Release exists:

```bash
GITHUB_REPOSITORY=ByteTrue/byspace \
  scripts/upload-release-asset.sh v0.7.0-beta.2 <exact-sha> dist/android/BySpace-0.7.0-beta.2-android.apk
GITHUB_REPOSITORY=ByteTrue/byspace \
  scripts/upload-release-asset.sh v0.7.0-beta.2 <exact-sha> dist/android/BySpace-0.7.0-beta.2-android.apk.sha256
```

## Verify

- `npm view @bytetrue/byspace@<version>` returns the release.
- Installing the npm tarball or published package provides `byspace`, not `paseo`.
- The GitHub Release contains Desktop artifacts, one unsigned IPA, the signed APK, and checksums.
- The Docker image resolves at `ghcr.io/bytetrue/byspace:<version>`.
- `app.byspace.cc.cd` serves the new Web/PWA build.
- The Android APK package, version, and signer match the values checked before tagging.
