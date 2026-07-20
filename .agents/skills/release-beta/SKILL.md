---
name: release-beta
description: Cut and ship a BySpace beta release across npm `beta`, Beta Web, and Beta Relay. Use when the user explicitly asks to cut, publish, or ship a beta, says release:beta, or invokes /release-beta. Do not use for installation, readiness audits, release review, or failed-release recovery; use `harden-byspace-release` for those.
---

# Release BySpace Beta

Ship one immutable Beta channel tuple and prove Stable did not move.

## Read first

Read completely:

1. `docs/release.md`
2. `docs/release-engineering.md`
3. `CHANGELOG.md`
4. `package.json`

Use `harden-byspace-release` for an independent pre-tag review when available.

## Prepare

1. Require a clean working tree and current `origin/main`.
2. Classify the change as patch or minor from the previous Stable release to `HEAD`; explain the target. Never choose major autonomously.
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
4. Confirm no App/Relay deploy ran from the `main` push.
5. Record current Stable Pages deployment ID, Stable Worker version ID, and npm `latest` before tagging.
6. Confirm the target npm version does not already exist.

Do not create the tag before these gates pass.

## Publish

1. Create one annotated `vX.Y.Z-beta.N` tag at the exact green SHA.
2. Push it once. Protected release tags cannot be moved or deleted.
3. Wait for `Publish npm` to succeed.
4. Wait for `Deploy App` and `Deploy Relay` triggered by that publisher to succeed.
5. If a post-publication step fails, fix forward or rerun the failed immutable deployment event; never retag different source.

## Verify

Prove all of the following before announcing completion:

- npm `beta` resolves to the exact version; npm `latest` is unchanged;
- GitHub release exists and is marked prerelease;
- Beta Pages reports the tagged SHA/version;
- Beta Worker reports the tagged version;
- a clean global `@bytetrue/byspace@beta` install starts an isolated daemon;
- pairing uses `https://byspace-beta.pages.dev` and the Beta relay;
- real relay connection succeeds;
- Stable Pages deployment ID and Stable Worker version ID are unchanged;
- repository working tree is clean and `main == origin/main`.

Do not restart the user's port-6777 daemon unless explicitly requested.

## Report

Return target version, release SHA/tag, CI/publisher/deploy run IDs, npm/Web/Relay/runtime evidence, Stable non-movement proof, and any production mutation or residual risk.
