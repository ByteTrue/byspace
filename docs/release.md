# Release

Use Node 22.20.0 and npm 10.9.3. Run release commands from a clean `main` checkout.

## Published targets

| Target  | Publication path                                               |
| ------- | -------------------------------------------------------------- |
| npm     | `@bytetrue/byspace` with the `beta` or `latest` dist-tag       |
| Web/PWA | Cloudflare Pages (`byspace` stable, `byspace-beta` prerelease) |
| Docker  | `ghcr.io/bytetrue/byspace:<version>`                           |

Stable Web releases deploy to `app.byspace.cc.cd`. Versions with a prerelease suffix deploy to `app-beta.byspace.cc.cd`.

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

## Dry-runs

Before tagging, run these workflows with `workflow_dispatch` on the current `main` SHA:

- iOS Unsigned Release with `ref=<full SHA>`, `publish=false`
- Publish npm with `ref=<full SHA>`, `publish=false`
- Docker with `byspace_version=<version>`

`ref` and `checkout_ref` inputs require the full 40-character SHA — `actions/checkout`
fetch mode fails on abbreviated SHAs.

## Tag and publish

- **Minor** — a user would experience the release as a significant upgrade. This
  includes substantial new workflows, providers, forges, platforms, integrations,
  or meaningful expansions of existing capabilities. Foundational internal work
  also qualifies when it materially changes reliability, performance,
  compatibility, deployment, or operation; diff size alone does not.
- **Patch** — fixes, polish, small enhancements, and reliability or performance
  improvements within existing capabilities. Follow-up corrections to a minor
  release are patches.

The release agent selects patch or minor during preparation and presents the
target version with the changelog for approval. Agents never select a major
version autonomously. A major release requires an explicit user instruction and
approval; BySpace remains on major version zero until that deliberate decision.

Version bumps are never used to retry a failed build. Retry the existing version
as described in **Fixing a failed release build**.

## Standard release (stable)

Before running any stable release command:

- Make sure the resolved release source passed CI, the approved release inputs are committed locally on the intended branch, and the working tree is clean.
- **Run `npm run format`, `npm run lint`, and `npm run typecheck` and commit any resulting changes BEFORE you start any `release:*` command.** `release:check` runs `npm install --workspaces --include-workspace-root` as part of `release:prepare`, which can mutate `package-lock.json` (e.g. churning `"dev": true` markers on optional deps). The next step, `version:all:*`, runs `npm version` which aborts when the working tree is dirty. If this happens mid-flight you have to commit the lockfile churn before retrying — and the pre-commit format hook will reject a lockfile-only commit because oxfmt internally skips `package-lock.json` while lefthook's glob still matches it. Avoid the whole mess by running format/lint/typecheck first, then `release:prepare` once on its own to absorb any lockfile churn into a normal commit, then start the release.
- Do not use a release command as a substitute for checking whether the current commit is actually ready.

```bash
# Run exactly one, matching the approved decision:
npm run release:patch
npm run release:minor
```

After the stable release succeeds, move npm's `beta` pointer to the new stable
version for every published package. This changes dist-tags only; do not
republish the packages:

```bash
BYSPACE_VERSION=$(node -p "require('./package.json').version")
for package in highlight relay protocol client plugin server cli; do
  npm dist-tag add "@getpaseo/$package@$BYSPACE_VERSION" beta
done
```

Verify both npm tags now resolve to `BYSPACE_VERSION` before considering the
stable release complete.

The Docker workflow builds images from the checked-out source tree on pull requests and on `main` as non-publishing checks. Stable `vX.Y.Z` tag pushes publish `ghcr.io/getpaseo/byspace:X.Y.Z` and `ghcr.io/getpaseo/byspace:latest`; beta `vX.Y.Z-beta.N` tag pushes publish only `ghcr.io/getpaseo/byspace:X.Y.Z-beta.N` and never move `latest`.

The production relay is the Elixir service in [getpaseo/byspace-relay](https://github.com/getpaseo/byspace-relay), with its own deployment process. BySpace releases and pushes to this repository do not deploy it. The Cloudflare relay code and workflow in this repository are legacy and are not used in production.

**Stable means stable.** If the user says "stable" or "ship stable", do not ask whether they want a beta first. They picked stable; treat it as a direct stable release. Only run the beta flow when the user explicitly says "beta".

## Manual step-by-step

```bash
npm run typecheck            # Verify the exact commit you intend to release
npm run release:check        # Typecheck, build, dry-run pack
# Run exactly one approved version command:
npm run version:all:patch
npm run version:all:minor
npm run release:publish      # Publish to npm
npm run release:push         # Push HEAD + tag (triggers CI workflows)
# Then move npm's beta dist-tag to this stable version using the command above.
```

## Beta flow

```bash
npm run release:beta:patch       # Start the next patch beta line
npm run release:beta:minor       # Start the next minor beta line
npm run release:beta:next        # Optional: cut X.Y.Z-beta.2, beta.3, ...
npm run release:promote          # Promote X.Y.Z-beta.N to stable X.Y.Z
```

- Beta tags are published GitHub prereleases like `v0.1.41-beta.1`
- Betas publish npm packages with `--tag beta`, so `npm install @getpaseo/cli@beta` opts in while plain `npm install @getpaseo/cli` stays on `latest`
- `release:promote` creates a fresh stable tag like `v0.1.41`; the final release never reuses the beta tag
- **Each beta carries its own changelog entry.** `Release Notes Sync` mirrors the matching `## X.Y.Z-beta.N` entry into that prerelease body. Promotion collapses every beta entry for the version into one final stable entry. See the Changelog policy section.

Use the beta path when you need to:

- smoke a build yourself before promoting it to everyone
- test a build manually in a Linux or Windows VM
- send a build to a user who is hitting a specific problem
- iterate on `beta.1`, `beta.2`, `beta.3`, and so on before deciding to ship broadly

# 1. Cut and publish (default 36h ramp from tag push).

npm run release:patch

-f tag=v0.1.64 \
 -f rollout_hours=0

````


Run the dispatch right after `release:patch` or `release:minor` returns. Don't wait for the tag-push CI to finish.

### Adjusting an already-published release


**Hotfix (instant admit) on an already-shipped release:**

```bash
  -f tag=v0.1.42 \
  -f rollout_hours=0
````

```bash
  -f tag=v0.1.42 \
  -f rollout_hours=72
```

### Custom ramp on a manually-dispatched build

```bash
  -f tag=v0.1.43 \
  -f rollout_hours=6
```

### Releasing during an active rollout

### macOS system floor

- `scripts/merge-mac-manifest.mjs` writes the matching Darwin kernel version to `minimumSystemVersion` in the update manifest. Existing clients check this before downloading an update.

macOS 13 maps to Darwin 22. The two values use different version domains; do not copy the macOS version into the update manifest.

### Limitations

- **No pause / kill switch.** To stop new admissions, ship a superseding release. Clients revalidate on quit and will not install the superseded download, but a client that already completed installation cannot be recalled; ship a hotfix `+1` patch.
- **No rollback.** `allowDowngrade = false`. Bad release = ship a hotfix.

# Recent builds (newest first). Pipe to jq for status only.

# Filter by platform.

# Inspect a specific build.

npx eas build:view <build-id>

# Inspect the full release workflow, including submit_ios, submit_android,

# and submit_ios_for_review.

# Read failed submit/review job logs.

# Stream logs for a build.

````




- `build_ios` — iOS binary built
- `submit_ios_for_review` — iOS build submitted for App Store review via Fastlane
- `build_android` — Android store binary built
- `submit_android` — Android binary submitted to the Play Store



## Release completion and heartbeat

A release is **in progress** after npm publication and tag push. Report it as
**shipped** only after every applicable build, publication, asset, manifest, and
store submission passes the completion checklist.

Immediately after every beta, stable, or promotion tag push, create a heartbeat
that resumes the release in the current conversation. Create it automatically
with `create_heartbeat`. The heartbeat owns the release until it either reaches
the completion checklist or finds a failure that needs new user authority.

Each heartbeat checks the release tag commit, all GitHub Actions runs for the
release branch and tag, npm dist-tags, the GitHub Release body and assets,
workflow. Inspect the GitHub Release itself and confirm that the macOS, Linux,
Windows, and Android APK assets are present along with the channel manifests
(`latest-mac.yml`, `latest-linux.yml`, and `latest.yml` for stable;
`beta-mac.yml`, `beta-linux.yml`, and `beta.yml` for beta).

For stable releases, also confirm every required mobile build, upload, store
submission, and review-submission job for the release commit. For betas, confirm
path. Delete the heartbeat only after every applicable checklist item passes,
then report the release as shipped.

Pattern:

```jsonc
// mcp__byspace__create_heartbeat arguments
{
  "name": "vX.Y.Z release babysit heartbeat",
  "cron": "*/10 * * * *",
  "timezone": "UTC",
  "maxRuns": 120,
  "expiresIn": "24h",
}
````

Run an immediate status check after creating the heartbeat. The heartbeat handles
later transitions and stops itself when the release is complete.

## Release notes on GitHub

The GitHub Release body is populated automatically by the `Release Notes Sync` workflow (`.github/workflows/release-notes-sync.yml`). It triggers on every `v*` tag push and on any push to `main` that touches `CHANGELOG.md`, then runs `scripts/sync-release-notes-from-changelog.mjs` to mirror the matching changelog entry into the release body. You don't need to write release notes on GitHub manually — keep `CHANGELOG.md` correct and the workflow will sync it. To force a re-sync, dispatch the workflow with the tag input.

## Website behavior

- The website download page defaults to GitHub's latest published **stable** release.
- A published beta prerelease is offered behind the Stable/Beta switch on `/download` (`?channel=beta`), never as the default. The switch only appears while the newest prerelease leads stable on its core version, so promoting `X.Y.Z-beta.N` to `X.Y.Z` retires the beta channel from the page until the next beta line opens.
- The default download target only moves when you publish the final stable release tag like `v0.1.41`.
- The public `/changelog` page renders `CHANGELOG.md` as-is, so the in-flight `-beta.N` entry shows there once it lands on `main` — that's intended, it's where beta users check what's coming. Only the **default download target** stays pinned to the latest stable; the download links read GitHub's releases API, not the changelog, so a `-beta.N` heading on top never affects them.
- The download page's "What's new" link deep-links the **minor group** anchor (`/changelog#release-0.3`), not the exact entry: promotion collapses the beta entries into one stable entry, so the minor group remains the durable target. A version with no entry in the bundled changelog — a tag whose changelog commit hasn't redeployed the site yet — links the plain `/changelog` instead of a dead anchor.
- The website itself is deployed by `Deploy Website` (Cloudflare Workers), which redeploys on the `release: published` event emitted when a stable draft is published and on pushes to `main` that touch `CHANGELOG.md` or `packages/website/**`. Its job condition excludes beta prereleases.

## Fixing a failed release build

**NEVER bump the version to fix a build problem.** New versions are reserved for meaningful product changes (features, fixes, improvements). Build/CI failures are fixed on the current version.

**Do not rely on `workflow_dispatch` for tagged code fixes.** The `workflow_dispatch` trigger runs the workflow file from the default branch but checks out the code at the tag ref (`ref: ${{ inputs.tag }}`). That means fixes committed to `main` won't change the tagged source tree being built. `workflow_dispatch` only helps when the fix lives in the workflow file itself.

For Docker-only retries, **do not push or force-push a `v*` release tag**.

```bash
npm run release:push
```

`release:push` waits for successful CI on the exact `main` SHA before creating the version tag.
If CI fails on unchanged test files, check whether the failure is a known flake (seed-timeout
E2E specs, windows vitest timing assertions) and rerun only the failed jobs with
`gh run rerun <run-id> --failed`. A run must be completed before `--failed` reruns are accepted.

uploads manifests from successful platforms before it fails. A later
single-platform retry reuses those manifests, stamps the complete set with one
platform failed. A `workflow_dispatch` rebuild with publishing enabled follows
the same path against the existing draft.

release assets. Prefer Docker workflow dispatch when rebuilding only the Docker
image.

The retry tag patterns below still work and remain the supported way to rebuild specific release targets:

```bash
# Desktop (all platforms)

# Desktop (single platform)

# Android APK
git tag -f android-v0.1.28 HEAD && git push origin android-v0.1.28 --force

# Beta
git tag -f v0.1.29-beta.2 HEAD && git push origin v0.1.29-beta.2 --force
```

This ensures the checkout ref matches the actual code on `main` with the fix included.

- `vX.Y.Z` or `vX.Y.Z-beta.N` rebuilds the full tagged release
- `android-vX.Y.Z` rebuilds the Android APK release only

assets first, then publish it manually:

```bash

# Keep a beta marked as a prerelease:
```

This bypasses the updater-manifest guarantee. Use it only when the release is

## Notes

- `version:all:*` bumps root + syncs workspace versions and `@getpaseo/*` dependency versions
- The npm `version` lifecycle regenerates F-Droid changelog files from `CHANGELOG.md` for stable releases only (`npm run fdroid:changelogs`) and stages them, so the release tag carries them. Betas are a no-op. A stable run **aborts the release** if `CHANGELOG.md` has no entry for the version being cut — commit the changelog entry first. See [docs/android.md](android.md) for why these files are generated per ABI.
- `release:prepare` refreshes workspace `node_modules` links to prevent stale types
- If `release:publish` partially fails, re-run it — npm skips already-published versions
- If `release:publish:beta` partially fails, re-run it — npm skips already-published versions and keeps prereleases off `latest` because every publish uses `--tag beta`
- The website uses GitHub's latest published release API for download links, so published beta prereleases do not replace the stable download target.

## Changelog format

Release notes depend on the changelog heading format. The heading **must** be strictly followed:

```
## X.Y.Z - YYYY-MM-DD
## X.Y.Z-beta.N - YYYY-MM-DD
```

No prefix (`v`), no extra text. `Release Notes Sync` matches the `## X.Y.Z` (or `## X.Y.Z-beta.N`) line for the pushed tag to extract the version. A malformed heading breaks the release-notes sync for that tag.

## Changelog policy

- `CHANGELOG.md` includes stable releases and every entry in the current beta series.
- The first beta of a version inserts a top entry like `## 0.1.60-beta.1 - YYYY-MM-DD`.
- Each subsequent beta inserts a new top entry with the next beta number. Its notes cover the changes since the previous beta tag.
- Stable promotion replaces every beta entry for that version with one `## 0.1.60 - YYYY-MM-DD` entry.
- The promoted stable entry covers the full diff from the previous stable tag and collapses internal iterations across the beta series.

## Changelog ownership

- **The agent running the release writes the changelog entry — beta or stable.** The release context and final wording stay with that agent.
- **Commit history is only an index of the changes. Never draft the changelog from commit subjects or diffs alone.** For every PR in the release range, read the full PR description and every issue it links to before deciding what changed, why users care, or how changes should be grouped. Use the implementation only to verify the resulting understanding.
- For the first beta or a direct stable release, draft from the previous stable tag to the release source. For later betas, draft from the previous beta tag to the release source. Promotion replaces the beta series with one entry drafted from the previous stable tag to the release source. Review the result against the changelog policy below, show it to the user, and wait for approval before committing it.

## Changelog wording

The changelog is shown on the BySpace homepage. Each bullet is a compact factual record of
product behavior that changed.

- **Name the exact change.** Prefer `Added <capability>`, `Removed <behavior>`,
  `Changed <behavior>`, or `Fixed <failure> when <condition>`.
- **Keep the scope exact.** A conditional bug is not a general reliability problem. Do not
  broaden one failure into claims that BySpace is now faster, smoother, responsive, or reliable.
- **Use concrete product and runtime terms.** Git polling, persisted cache, provider catalog,
  and WebSocket reconnects can identify the affected behavior. Component names, internal
  modules, code symbols, and implementation techniques cannot: omit `WorkingIndicator`,
  `reconcileAndEmitWorkspaceUpdates`, remounts, memoization, and controlled inputs.
- **State the consequence only when the change itself is unclear.** Keep the condition that
  makes the consequence true. Do not replace a precise change with a broad benefit claim.
- **Do not invent context.** Mention an upgrade, platform, workload, or user action only when
  the PR or linked issue establishes that scope.

| Avoid                                                        | Write                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| BySpace stays responsive with many idle Git workspaces       | Removed periodic Git polling for idle workspaces      |
| Incompatible saved app data no longer crashes after upgrades | Fixed crash when persisted cache was incompatible     |
| Splitting layouts no longer remounts the active agent        | Fixed scroll position resetting when splitting a pane |
| Mobile model selector is faster and more straightforward     | Added search to the mobile model selector             |

Test each bullet against the source PR and issue: can a reviewer point to the exact behavior
that changed, the failure that was fixed, or the capability that was added? If the bullet only
claims a general improvement, rewrite it with the concrete change.

- **Use the entry's release scope.** Include changes within the matching range in **Changelog scope**.
- **Collapse internal iterations within that scope.** Present a feature added and fixed in one range as working. A later beta can describe a fix to behavior delivered in an earlier beta; promotion folds the complete beta series into the final stable behavior.
- **Cut low-signal entries.** "Toolbar buttons have consistent sizing" is too granular. Combine small polish items or drop them.

## Changelog conciseness

Every bullet must be scannable at a glance. The changelog is not release documentation — it's a list.

- **One sentence per bullet, max.** If a bullet contains two sentences, the second one is doing work that belongs in product docs, not the changelog. Cut it.
- **No trailing periods.** Bullets are list items, not prose. Drop the period at the end of every bullet, including the period inside any bolded lead-in. `**Configurable terminal scrollback**` not `**Configurable terminal scrollback.**`.
- **One line per bullet.** If a bullet wraps to three lines in a narrow column, it's too long.
- **Split bullets that pack multiple distinct changes.** If a bullet uses "and", "plus", a comma list, or an em-dash to chain several independent improvements, break them into separate bullets — even when they share a theme or author. One bullet = one user-facing change.
- **Trim qualifying clauses.** Drop "with a hint shown when…", "matching the CLI's behaviour", "across common install shapes". If the detail doesn't change whether a user cares, cut it.
- **Stop after identifying the change.** Do not explain LAN/WAN topology, TLS handshakes, IPC, or other architecture in a changelog bullet. Put necessary background in product docs.
- **Attribution follows the split.** When you split a dense bullet, move each PR/author to the bullet it belongs to. Never duplicate the same PR across multiple bullets.

## Changelog attribution

Every changelog bullet must credit contributors and link to the PR(s) that delivered the change. This is not one-PR-per-line — a single bullet describes a user-facing change and may reference multiple PRs.

Format: append `([#123](https://github.com/getpaseo/byspace/pull/123) by [@user](https://github.com/user))` at the end of each bullet. For changes spanning multiple PRs or contributors:

```markdown
- Voice mode now works on tablets with proper microphone permissions. ([#210](https://github.com/getpaseo/byspace/pull/210), [#215](https://github.com/getpaseo/byspace/pull/215) by [@alice](https://github.com/alice), [@bob](https://github.com/bob))
```

Rules:

- **Always link the PR number** as `[#N](https://github.com/getpaseo/byspace/pull/N)`.
- **Always link the contributor's GitHub profile** as `[@user](https://github.com/user)`.
- **One bullet = one user-facing change**, regardless of how many PRs went into it. Group related PRs on the same bullet.
- **De-duplicate contributors.** If the same person authored multiple PRs in one bullet, list them once.
- **Only credit external contributors.** Skip attribution for [@boudra](https://github.com/boudra). The changelog credits community contributions — core team work is the default.
- **Credit the commit author, not the PR opener.** A maintainer often opens a PR that lands work authored by someone else (cherry-pick, rebase of a contributor's branch, manual extraction from a stacked PR). The squash commit preserves the original commit's author, but `gh pr view N --json author` returns the PR opener — using that field will silently mis-credit the work to the maintainer (and then the "skip @boudra" rule drops the attribution entirely). Always resolve attribution from commit authors.

  Use this command to get the GitHub logins for each PR:

  ```bash
  gh pr view N --json commits --jq '[.commits[].authors[].login] | unique | .[]'
  ```

  This returns every distinct GitHub login that authored or co-authored a commit in the PR. Use those logins for attribution. Fall back to `gh pr view N --json author` only if the commits command returns nothing (which should not happen for merged PRs).

  When listing PR numbers, `git log --format='%H %s' v<previous>..<release-source-sha> | grep -E '\(#[0-9]+\)$'` pulls the PR number out of squash commit subjects.

## Changelog ordering

Entries within each section (Added, Improved, Fixed) are ordered by user impact:

1. **User-facing features and changes first** — things users will notice, want to try, or that change their workflow.
2. **Quality-of-life improvements** — polish, performance, smoother interactions.
3. **Internal/infra changes last** — only include if they have a tangible user benefit (e.g. "faster startup" is user-facing even if the fix was internal).

## Pre-release sanity check

Before cutting a **stable** release, the release agent reviews the diff as a last line of defence against shipping bugs. Skip this for betas — the beta itself is the smoke test, and gating each beta on a code review defeats the point of using betas as fast release candidates.

Review the diff between the latest release tag and the resolved release source. Focus on:

1. **Breaking changes** — especially in the WebSocket protocol, agent lifecycle, and any server↔client contract.
2. **Regressions** — anything that looks like it could break existing functionality.

Use `git diff <latest-release-tag>..<release-source-sha>` as the review input. This is a deep sanity check, not a full code review. If anything looks risky, investigate before proceeding and surface the finding to the user.

## Changelog scope

Changelog scope follows the release being described:

- **First beta**: `previous stable tag → release source`
- **Later beta**: `previous beta tag → release source`
- **Direct stable release**: `previous stable tag → release source`
- **Stable promotion**: replace the full beta series with one entry covering `previous stable tag → release source`

Each beta entry records what its testers receive. Promotion produces the single stable record for the full jump from one stable version to the next.

## Completion checklist

### Beta release

- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Add a new `CHANGELOG.md` entry for this beta (heading `## X.Y.Z-beta.N - YYYY-MM-DD`), review it against the changelog policy, get approval, and commit it before cutting the release
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `npm run release:beta:patch`, `npm run release:beta:minor`, or `npm run release:beta:next` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] npm shows the version under the `beta` dist-tag, not `latest`
- [ ] The GitHub prerelease was published only after the three beta manifests were uploaded, and it has the changelog body and every expected macOS, Linux, Windows, and Android APK asset
- [ ] The GitHub prerelease contains `beta-mac.yml`, `beta-linux.yml`, and `beta.yml`
- [ ] GitHub `Android APK Release` workflow for the same tag is green
- [ ] GitHub `Docker` workflow is green and the versioned beta image is published without moving `latest`
- [ ] GitHub `Release Notes Sync` mirrored the beta entry into the prerelease body
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed

## Verify

- [ ] Run the pre-release sanity check (see above) and address any findings
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Ensure the approved release inputs are committed locally and the git worktree is clean before running any release command
- [ ] Ensure local `npm run typecheck` passes on that exact commit before running any release command
- [ ] Update `CHANGELOG.md` with user-facing release notes (features, fixes — not refactors). Promotion replaces every `## X.Y.Z-beta.N` entry in the series with one `## X.Y.Z - YYYY-MM-DD` entry covering the full release
- [ ] Verify the changelog heading follows strict `## X.Y.Z - YYYY-MM-DD` format
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `npm run release:patch`, `npm run release:minor`, or `npm run release:promote` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] Move npm's `beta` dist-tag to the new stable version for every published package and verify both `latest` and `beta` resolve to it
- [ ] The GitHub Release was published only after the three stable manifests were uploaded, and it has the changelog body and every expected macOS, Linux, Windows, and Android APK asset
- [ ] The GitHub Release contains `latest-mac.yml`, `latest-linux.yml`, and `latest.yml`
- [ ] `latest-mac.yml` contains the current `minimumSystemVersion` guard
- [ ] GitHub `Android APK Release` workflow for the same tag is green
- [ ] GitHub `Docker` workflow is green and both the versioned and `latest` images are published
- [ ] GitHub `Release Notes Sync` is green and the release body matches the stable changelog entry
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed
