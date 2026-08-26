---
name: release-beta
description: Cut and ship a complete BySpace beta release across npm `beta`, Beta Web/Relay, signed Android APK, and Electron Desktop artifacts for macOS/Linux/Windows. Use when the user explicitly asks to cut, publish, or ship a beta, says release:beta, or invokes /release-beta. iOS is never published. Do not use for installation, readiness audits, release review, or failed-release recovery; use `harden-byspace-release` for those.
---

# Release BySpace Beta

Ship one immutable Beta channel tuple and prove Stable did not move.

## Read first

Read completely:

1. `docs/release.md`
2. `docs/client-distribution.md`
3. `docs/release-engineering.md`
4. `CHANGELOG.md`
5. `package.json`

Use `harden-byspace-release` for an independent pre-tag review when available.

## Prepare

1. Require a clean working tree and current `origin/main`.
2. Classify the change as patch or minor from the previous Stable release to `HEAD` using the version classification rules in `docs/release.md`; explain the target from what the user can see, never from diff size. Never choose major autonomously.
3. Select the version command:
   - next beta on the same base: `npm run version:all:beta:next`;
   - beta for the next patch/minor: `npm run version:all:beta:patch` or `npm run version:all:beta:minor`.
4. Confirm versioning changed files but created no commit or tag.
5. Update the single in-place Beta entry in `CHANGELOG.md`.
6. Run focused tests plus every required check in `docs/release.md`.
7. Run an independent release-hardening review; resolve every blocker.
8. Commit the release preparation as `chore(release): cut X.Y.Z-beta.N`.

## Gate before the tag

1. Push the release commit to `main`.
2. Wait for push-event `CI` on that exact SHA; all jobs must pass.
3. Immediately before tagging, fetch `origin/main` and require release SHA = CI SHA = local `HEAD` = `origin/main`. If `main` advanced, stop and obtain CI for the new release commit.
4. Confirm no App/Relay deploy or `Publish clients` run occurred from the `main` push.
5. Record current Stable Pages deployment ID, Stable Worker version ID, npm `latest`, and Stable client Release asset manifest/checksums.
6. Confirm the target npm version and target GitHub client assets do not already exist.

Do not create the tag before these gates pass.

## Publish

1. Create one annotated `vX.Y.Z-beta.N` tag at the exact green SHA.
2. Push it once. Protected release tags cannot be moved or deleted.
3. Wait for `Publish npm` and tag-triggered `Publish clients` to succeed.
4. Wait for `Deploy App` and `Deploy Relay` triggered by the publisher to succeed.
5. If a post-publication step fails, fix forward or rerun only the failed immutable event; a client retry may upload a missing asset only when every existing asset is byte-identical. Never retag different source or overwrite a published asset.

## Verify

Prove all of the following before announcing completion:

- npm `beta` resolves to the exact version; npm `latest` is unchanged;
- GitHub release is prerelease and contains every required Desktop/Android asset;
- `client-release-manifest.json` and `SHA256SUMS.txt` re-verify after public download and contain no iOS asset;
- the Android APK has package `com.bytetrue.byspace`, the tagged version, and the pinned release certificate fingerprint; install and launch it on a clean emulator/device;
- smoke the installable Desktop artifact on each available target; manifest signing state must match reality;
- Beta Pages reports the tagged SHA/version;
- Beta Worker reports the tagged version;
- a clean global `@bytetrue/byspace@beta` install starts an isolated daemon;
- pairing uses `https://app-beta.byspace.cc.cd` and the Beta relay, and a real relay connection succeeds;
- Stable npm/Web/Relay/client manifest and assets are unchanged;
- repository working tree is clean and `main == origin/main`.

Do not restart the user's port-6777 daemon unless explicitly requested.

## Report

Return target version, release SHA/tag, CI/npm/App/Relay/client run IDs, public client asset inventory/checksums/signing state/smoke evidence, explicit iOS absence, Stable non-movement proof, and every production mutation or residual risk.
