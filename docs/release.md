# Release

Use Node 22.20.0 and npm 10.9.3. Run release commands from a clean `main` checkout.

## Published targets

| Target  | Publication path                                                        |
| ------- | ----------------------------------------------------------------------- |
| npm     | `@bytetrue/byspace` with the `beta` or `latest` dist-tag                |
| Web/PWA | Cloudflare Pages (`byspace` stable, `byspace-beta` prerelease)          |
| Docker  | `ghcr.io/bytetrue/byspace:<version>`                                    |
| Desktop | GitHub Release artifacts for macOS, Windows, and Linux                  |
| iOS     | One unsigned device IPA on the GitHub Release                           |
| Android | CI-built and signed APK on the GitHub Release (android-apk-release.yml) |

The iOS IPA requires user re-signing. The Android APK is built and signed by CI with the long-lived ByteTrue release key and does not depend on Google Play or EAS.

Stable Web releases deploy to `app.byspace.cc.cd`. Versions with a prerelease suffix deploy to `app-beta.byspace.cc.cd`.

The macOS client does not replace the running app in place. It verifies the current-architecture DMG from the release manifest, saves it to Downloads, strips its quarantine attribute, opens it, and exits so the user can drag the new app over the old one. Every desktop release must publish both `arm64` and `x64` DMGs with SHA-512 entries in `latest-mac.yml`.

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

The `Android APK Release` workflow builds, signs, and uploads the APK automatically when the version tag is pushed. It verifies the package id (`com.bytetrue.byspace`), the version against `packages/app/native-release-version.js`, the release certificate, and ABI coverage before uploading `BySpace-<version>-android.apk` and its `.sha256` to the GitHub Release.

Rebuild or repair a published APK with an `android-v*` tag (e.g. `android-v0.11.3`) pointing at a green SHA: the workflow normalizes it to the release tag and replaces the asset. `workflow_dispatch` with a tag input does the same without a new tag.

The numbered path below is the fallback for a CI outage. It follows `docs/android.md`'s local build commands, so keep this list short: verify package id, version, and release certificate on the result, and upload with `scripts/upload-release-asset.sh`.

1. Run `expo prebuild --platform android` once for the release SHA.
2. Run Gradle `:app:assembleRelease`, excluding Android lint tasks already covered by CI.
3. Sign with the ByteTrue Android release key and verify the certificate.
4. Upload the APK and its SHA-256 with `scripts/upload-release-asset.sh`.

Keep the keystore and passwords outside the repository; after any key rotation, refresh the four `ANDROID_RELEASE_*` GitHub secrets before the next release.

## Dry-runs

Before tagging, run these workflows with `workflow_dispatch` on the current `main` SHA:

- Desktop Release with `tag=<version tag>`, `platform=all`, `publish=false`
- iOS Unsigned Release with `ref=<full SHA>`, `publish=false`
- Publish npm with `ref=<full SHA>`, `publish=false`
- Docker with `byspace_version=<version>`

`ref` and `checkout_ref` inputs require the full 40-character SHA — `actions/checkout`
fetch mode fails on abbreviated SHAs.

## Tag and publish

After every prepare step and dry-run succeeds:

```bash
npm run release:push
```

`release:push` waits for successful CI on the exact `main` SHA before creating the version tag.
If CI fails on unchanged test files, check whether the failure is a known flake (seed-timeout
E2E specs, windows vitest timing assertions) and rerun only the failed jobs with
`gh run rerun <run-id> --failed`. A run must be completed before `--failed` reruns are accepted.

The tag starts npm, Web/PWA, Docker, Desktop, iOS, and Android publication. Wait for all workflows to
finish. Android uploads the APK and checksum automatically once the GitHub Release exists (the
ensure-release job creates the draft if the tag workflow raced ahead); the manual fallback remains:

```bash
GITHUB_REPOSITORY=ByteTrue/byspace \
  scripts/upload-release-asset.sh v0.7.0-beta.2 dist/android/BySpace-0.7.0-beta.2-android.apk <exact-sha>
GITHUB_REPOSITORY=ByteTrue/byspace \
  scripts/upload-release-asset.sh v0.7.0-beta.2 dist/android/BySpace-0.7.0-beta.2-android.apk.sha256 <exact-sha>
```

## Verify

- `npm view @bytetrue/byspace@<version>` returns the release.
- Installing the npm tarball or published package provides `byspace`, not `paseo`.
- The GitHub Release contains Desktop artifacts, one unsigned IPA, the signed APK, and checksums.
- The Docker image resolves at `ghcr.io/bytetrue/byspace:<version>`.
- The matching Web channel serves the new build: `app.byspace.cc.cd` for stable or `app-beta.byspace.cc.cd` for prereleases.
- The Android APK Release workflow run for the tag is green; the uploaded APK's signer matches the ByteTrue release certificate (the workflow asserts package, version, and ABI itself — spot-check the cert if anything looks off).
