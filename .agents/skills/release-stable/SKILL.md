---
name: release-stable
description: Cut and ship a complete BySpace stable patch/minor release or promote a beta across npm `latest`, Stable Web/Relay, signed Android APK, and Electron Desktop artifacts for macOS/Linux/Windows. Use when the user explicitly asks to cut, publish, ship, or promote Stable, says release:patch/release:minor/release:promote, or invokes /release-stable. iOS is never published. Do not use for readiness audits, release review, or failed-release recovery; use `harden-byspace-release` for those.
---

# Release BySpace Stable

Ship one immutable Stable channel tuple and prove Beta did not move.

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
2. For a fresh release, classify the previous-Stable-to-`HEAD` diff as patch or minor using the version classification rules in `docs/release.md` and explain the target from what the user can see, never from diff size. Never choose major autonomously.
3. Select the version command:
   - promote the current beta: `npm run version:all:promote`;
   - fresh patch/minor: `npm run version:all:patch` or `npm run version:all:minor`.
4. Confirm versioning changed files but created no commit or tag.
5. For promotion, replace the in-place Beta changelog heading with Stable; for a fresh release, create the Stable entry.
6. Run focused tests plus every required check in `docs/release.md`.
7. Run an independent release-hardening review; resolve every blocker.
8. Commit the release preparation as `chore(release): cut X.Y.Z`.

## Gate before the tag

1. Push the release commit to `main`.
2. Wait for push-event `CI` on that exact SHA; all jobs must pass.
3. Immediately before tagging, fetch `origin/main` and require release SHA = CI SHA = local `HEAD` = `origin/main`. If `main` advanced, stop and obtain CI for the new release commit.
4. Confirm no App/Relay deploy or `Publish clients` run occurred from the `main` push.
5. Record current Beta Pages deployment ID, Beta Worker version ID, npm `beta`, and latest Beta client Release asset manifest/checksums.
6. Confirm the target npm version and target GitHub client assets do not already exist.

Do not create the tag before these gates pass.

## Publish

1. Create one annotated `vX.Y.Z` tag at the exact green SHA.
2. Push it once. Protected release tags cannot be moved or deleted.
3. Wait for `Publish npm` and tag-triggered `Publish clients` to succeed.
4. Wait for `Deploy App` and `Deploy Relay` triggered by the publisher to succeed.
5. If a post-publication step fails, fix forward or rerun only failed jobs in the original immutable event. `Publish clients` has no manual dispatch/rebuild path; reuse its retained artifacts, and upload a missing asset only when every existing asset is byte-identical. If retained artifacts are unavailable, cut a new version. Never retag different source or overwrite a published asset.

## Verify

Prove all of the following before announcing completion:

- npm `latest` resolves to the exact version and npm `beta` is unchanged;
- GitHub Stable release exists, is not marked prerelease, and contains every required Desktop/Android asset;
- `client-release-manifest.json` and `SHA256SUMS.txt` re-verify after public download and contain no iOS asset;
- the Android APK has package `com.bytetrue.byspace`, the tagged version, and the pinned release certificate fingerprint; install and launch it on a clean emulator/device;
- smoke the installable Desktop artifact on each available target; manifest signing state must match reality;
- Stable Pages reports the tagged SHA/version;
- Stable Worker reports the tagged version;
- a clean global `@bytetrue/byspace@latest` install starts an isolated daemon;
- pairing uses `https://app.byspace.cc.cd` and the Stable relay, and a real relay connection succeeds;
- Beta npm/Web/Relay/client manifest and assets are unchanged;
- repository working tree is clean and `main == origin/main`.

Do not restart the user's port-6777 daemon unless explicitly requested.

## Report

Return target version, release SHA/tag, CI/npm/App/Relay/client run IDs, public client asset inventory/checksums/signing state/smoke evidence, explicit iOS absence, Beta non-movement proof, and every production mutation or residual risk.
