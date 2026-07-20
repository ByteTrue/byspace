---
name: release-stable
description: Cut and ship a BySpace stable patch/minor release or promote a beta across npm `latest`, Stable Web, and Stable Relay. Use when the user explicitly asks to cut, publish, ship, or promote Stable, says release:patch/release:minor/release:promote, or invokes /release-stable. Do not use for readiness audits, release review, or failed-release recovery; use `harden-byspace-release` for those.
---

# Release BySpace Stable

Ship one immutable Stable channel tuple and prove Beta did not move.

## Read first

Read completely:

1. `docs/release.md`
2. `docs/release-engineering.md`
3. `CHANGELOG.md`
4. `package.json`

Use `harden-byspace-release` for an independent pre-tag review when available.

## Prepare

1. Require a clean working tree and current `origin/main`.
2. For a fresh release, classify the previous-Stable-to-`HEAD` diff as patch or minor and explain the target. Never choose major autonomously.
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
4. Confirm no App/Relay deploy ran from the `main` push.
5. Record current Beta Pages deployment ID, Beta Worker version ID, and npm `beta` before tagging.
6. Confirm the target npm version does not already exist.

Do not create the tag before these gates pass.

## Publish

1. Create one annotated `vX.Y.Z` tag at the exact green SHA.
2. Push it once. Protected release tags cannot be moved or deleted.
3. Wait for `Publish npm` to succeed.
4. Wait for `Deploy App` and `Deploy Relay` triggered by that publisher to succeed.
5. If a post-publication step fails, fix forward or rerun the failed immutable deployment event; never retag different source.

## Verify

Prove all of the following before announcing completion:

- npm `latest` resolves to the exact version and npm `beta` is unchanged;
- GitHub Stable release exists and is not marked prerelease;
- Stable Pages reports the tagged SHA/version;
- Stable Worker reports the tagged version;
- a clean global `@bytetrue/byspace@latest` install starts an isolated daemon;
- pairing uses `https://byspace.pages.dev` and the Stable relay;
- real relay connection succeeds;
- Beta Pages deployment ID and Beta Worker version ID are unchanged;
- repository working tree is clean and `main == origin/main`.

Do not restart the user's port-6777 daemon unless explicitly requested.

## Report

Return target version, release SHA/tag, CI/publisher/deploy run IDs, npm/Web/Relay/runtime evidence, Beta non-movement proof, and any production mutation or residual risk.
