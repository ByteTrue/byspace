# Release

Use Node 22.20.0 and npm 10.9.3. Run release commands from a clean `main` checkout.

## Published targets

| Target  | Publication path                                               |
| ------- | -------------------------------------------------------------- |
| npm     | `@bytetrue/byspace` with the `beta` or `latest` dist-tag       |
| Web/PWA | Cloudflare Pages (`byspace` stable, `byspace-beta` prerelease) |
| Docker  | `ghcr.io/bytetrue/byspace:<version>`                           |

Stable Web releases deploy to `app.byspace.cc.cd`. Versions with a prerelease suffix deploy to `app-beta.byspace.cc.cd`.

`@bytetrue/byspace` is the only published package. The `@byspace/*` workspaces are packed into it as bundled dependencies; they are not published separately and have no dist-tags to maintain.

GitHub Release assets are the npm tarball and a container descriptor, each with a `.sha256` sibling:

- `BySpace-<version>-npm.tgz`, `BySpace-<version>-npm.tgz.sha256`
- `BySpace-<version>-container.txt`, `BySpace-<version>-container.txt.sha256`

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
   npm run release:publish:dry-run          # stable
   npm run release:publish:beta:dry-run     # prerelease
   ```

## Dry-runs

Before tagging, run these workflows with `workflow_dispatch` on the current `main` SHA. Both build without publishing:

- **Publish npm** with `ref=<full SHA>`, `publish=false`
- **Docker** with `byspace_version=<version>`

`ref` requires the full 40-character SHA — `actions/checkout` fetch mode fails on abbreviated SHAs.

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
- **Commit everything that should not ride along before starting a release command.** `version:all:*` runs `npm version`, whose `version` lifecycle script runs `release:prepare` (`npm install --workspaces --include-workspace-root`) and then `git add -A`. That `npm install` can churn `package-lock.json`, and the `git add -A` stages whatever else is dirty, so an unrelated working-tree change would land inside the release commit.
- Do not use a release command as a substitute for checking whether the current commit is actually ready.

```bash
# Run exactly one, matching the approved decision:
npm run release:patch
npm run release:minor
```

Each command runs `release:check`, bumps and commits the version, then calls
`release:push`. `release:push` pushes the branch, waits for successful CI on that
exact `main` SHA, and only then creates and pushes the tag. If CI is not green
yet it stops with that message — wait for CI and re-run `npm run release:push`.

Tag pushes start three workflows: **Publish npm**, **Deploy App**, and **Docker**.
Stable `vX.Y.Z` tag pushes publish `ghcr.io/bytetrue/byspace:X.Y.Z` and
`ghcr.io/bytetrue/byspace:latest`; prerelease `vX.Y.Z-beta.N` tag pushes publish only
`ghcr.io/bytetrue/byspace:X.Y.Z-beta.N` and never move `latest`.

After the tag push, **Release Notes Sync** sets the GitHub Release body from the
changelog automatically; confirm it landed (see **Release notes**). Then confirm every
item in the completion checklist.

**Stable means stable.** If the user says "stable" or "ship stable", do not ask whether they want a beta first. They picked stable; treat it as a direct stable release. Only run the beta flow when the user explicitly says "beta".

## Manual step-by-step

```bash
npm run typecheck            # Verify the exact commit you intend to release
npm run release:check        # Typecheck, build, dry-run pack
# Run exactly one approved version command:
npm run version:all:patch
npm run version:all:minor
npm run release:push         # Push the branch, wait for CI, then create and push the tag
```

Publishing is CI-driven. There is no local publish step: the tag push is what makes
**Publish npm** run.

## Beta flow

```bash
npm run release:beta:patch       # Start the next patch beta line
npm run release:beta:minor       # Start the next minor beta line
npm run release:beta:next        # Optional: cut X.Y.Z-beta.2, beta.3, ...
npm run release:promote          # Promote X.Y.Z-beta.N to stable X.Y.Z
```

- Beta tags are published GitHub prereleases like `v0.1.41-beta.1`
- Betas publish `@bytetrue/byspace` with `--tag beta`, so `npm install @bytetrue/byspace@beta` opts in while plain `npm install @bytetrue/byspace` stays on `latest`
- `release:promote` creates a fresh stable tag like `v0.1.41`; the final release never reuses the beta tag
- **Each beta carries its own changelog entry.** Promotion collapses every beta entry for the version into one final stable entry. See the Changelog policy section.

Use the beta path when you need to:

- smoke a build yourself before promoting it to everyone
- test a build manually in a Linux or Windows VM
- send a build to a user who is hitting a specific problem
- iterate on `beta.1`, `beta.2`, `beta.3`, and so on before deciding to ship broadly

## Release branch discipline

While you finalize a release on `main`, use a temporary `next` branch for work intended for the following release. This applies to both beta and stable releases.

- Create each new `next` from freshly fetched `origin/main`. Reuse it while active.
- "This goes to next" means create the PR against `next` or retarget an existing PR, and keep that destination through delivery.
- Keep `next` current by merging `origin/main` into it as release fixes land. Avoid rebasing this shared branch because agents and open PRs depend on its history.
- After the release ships, bring `next` up to date and open a `next` → `main` PR. Pass CI and merge without squashing away the individual PR commits needed for the changelog. Retarget remaining PRs based on `next` to `main` and delete the integrated `next`. Create it fresh when needed again.

**Not yet wired:** in this repository CI and Docker only trigger for `push` and
`pull_request` on `main`, so a PR based on `next` runs no checks and no branch
protection applies to it. Treat the `next` flow as a convention for keeping
release-bound work out of the current release, not as a guarded branch.

### Hotfix from a release tag

If `main` contains changes you do not want to release, branch from the affected release tag and cherry-pick only the required fixes. Run CI on that branch, then use the normal release flow with it as the explicit source, choosing a new patch or beta version. Ensure the fixes and changelog also reach `main` and any active `next`, preserving newer development and version changes there. This is a short-lived hotfix branch, not another maintained release track.

## Release completion and heartbeat

A release is **in progress** after npm publication and tag push. Report it as
**shipped** only after every applicable build, publication, asset, and deployment
passes the completion checklist.

Immediately after every beta, stable, or promotion tag push, create a heartbeat
that resumes the release in the current conversation. Create it automatically
with `create_heartbeat`. The heartbeat owns the release until it either reaches
the completion checklist or finds a failure that needs new user authority.

Each heartbeat checks the release tag commit, all GitHub Actions runs for the
release tag, npm dist-tags, the GitHub Release body and assets, and the deployed
web app. Inspect the GitHub Release itself and confirm both the npm tarball and
container descriptor are present with their `.sha256` siblings.

Delete the heartbeat only after every applicable checklist item passes, then
report the release as shipped.

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
```

Run an immediate status check after creating the heartbeat. The heartbeat handles
later transitions and stops itself when the release is complete.

## Release notes on GitHub

The **Release Notes Sync** workflow (`.github/workflows/release-notes-sync.yml`) makes
the Release body match the changelog. It runs on every `v*` tag push, waits for
**Publish npm** or **Docker** to create the Release, then overwrites the body with the
matching `CHANGELOG.md` entry. It does not create the Release itself: the sync script's
create path marks a Release as a draft, and nothing in this repository publishes drafts.

The workflows that create the Release both pick an initial body, which is why the sync
step exists — whichever runs first wins:

- **Publish npm** uses `.github/release/<tag>.md` when present, otherwise the placeholder `BySpace <tag>`
- **Docker** uses `.github/release/<tag>.md` when present, otherwise `--generate-notes` (the PR-title list)

To re-sync a Release whose body drifted, dispatch the workflow with a tag, or run it
directly:

```bash
node scripts/sync-release-notes-from-changelog.mjs --repo ByteTrue/byspace --tag vX.Y.Z
```

The script updates the existing Release body from the matching `CHANGELOG.md`
entry. Without it, a Release whose body came from `--generate-notes` keeps the
PR-title list.

## Fixing a failed release build

**NEVER bump the version to fix a build problem.** New versions are reserved for meaningful product changes (features, fixes, improvements). Build/CI failures are fixed on the current version.

**Do not rely on `workflow_dispatch` for tagged code fixes.** The `workflow_dispatch` trigger runs the workflow file from the default branch but checks out the code at the tag ref. That means fixes committed to `main` won't change the tagged source tree being built. `workflow_dispatch` only helps when the fix lives in the workflow file itself.

For Docker-only retries, **do not push or force-push a `v*` release tag**.

```bash
npm run release:push
```

`release:push` waits for successful CI on the exact `main` SHA before creating the version tag.
If CI fails on unchanged test files, check whether the failure is a known flake (seed-timeout
E2E specs, windows vitest timing assertions) and rerun only the failed jobs with
`gh run rerun <run-id> --failed`. A run must be completed before `--failed` reruns are accepted.

Tag pushes are the one supported way to rebuild a release: `git tag -f vX.Y.Z HEAD && git push origin vX.Y.Z --force` re-runs the tag workflows against `main` as it stands, so the checkout ref matches the actual code with the fix included. Prefer rerunning the failed job over moving the tag.

## Notes

- `version:all:*` bumps root + syncs workspace versions and `@byspace/*` dependency versions
- `release:prepare` refreshes workspace `node_modules` links to prevent stale types
- A stable run leaves `beta` where it is. `latest` moves on publish; `@bytetrue/byspace@beta` only moves when a prerelease publishes with `--tag beta`
- The public relay is the upstream Elixir service in [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay), with its own deployment process. BySpace releases do not deploy it, and no workflow in this repository does. `packages/relay` holds the client transport and E2E encryption used by the daemon

## Changelog format

Release notes depend on the changelog heading format. The heading **must** be strictly followed:

```
## X.Y.Z - YYYY-MM-DD
## X.Y.Z-beta.N - YYYY-MM-DD
```

No prefix (`v`), no extra text. The sync script matches the `## X.Y.Z` (or `## X.Y.Z-beta.N`) line for the tag to extract the version. A malformed heading breaks the release-notes sync for that tag.

The parser takes everything from a `##` heading to the next one, so the working-notes
comment must stay **above** the first version heading. Placing it under the newest
entry appends it to that entry's body and ships it inside the release notes.

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

Format: append `([#123](https://github.com/ByteTrue/byspace/pull/123) by [@user](https://github.com/user))` at the end of each bullet. For changes spanning multiple PRs or contributors:

```markdown
- Voice mode now works on tablets with proper microphone permissions. ([#210](https://github.com/ByteTrue/byspace/pull/210), [#215](https://github.com/ByteTrue/byspace/pull/215) by [@alice](https://github.com/alice), [@bob](https://github.com/bob))
```

Rules:

- **Always link the PR number** as `[#N](https://github.com/ByteTrue/byspace/pull/N)`.
- **Always link the contributor's GitHub profile** as `[@user](https://github.com/user)`.
- **One bullet = one user-facing change**, regardless of how many PRs went into it. Group related PRs on the same bullet.
- **De-duplicate contributors.** If the same person authored multiple PRs in one bullet, list them once.
- **Only credit external contributors.** Core-team work is the default and carries no attribution; the changelog credits community contributions.
- **Credit the commit author, not the PR opener.** A maintainer often opens a PR that lands work authored by someone else (cherry-pick, rebase of a contributor's branch, manual extraction from a stacked PR). The squash commit preserves the original commit's author, but `gh pr view N --json author` returns the PR opener — using that field will silently mis-credit the work to the maintainer and then the "external contributors only" rule drops the attribution entirely. Always resolve attribution from commit authors.

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
- [ ] Add a new `CHANGELOG.md` entry for this beta (heading `## X.Y.Z-beta.N - YYYY-MM-DD`), with the working-notes comment still above the first heading, reviewed against the changelog policy, approved, and committed before cutting the release
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `release:beta:patch`, `release:beta:minor`, or `release:beta:next` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] npm `@bytetrue/byspace@beta` resolves to the version, and `latest` did not move
- [ ] The GitHub prerelease has the changelog body and both assets with their `.sha256` siblings
- [ ] The GitHub prerelease is marked as a prerelease
- [ ] Docker published the versioned beta image without moving `latest`
- [ ] **Release Notes Sync** overwrote the prerelease body with the changelog entry
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed

### Stable release

- [ ] Run the pre-release sanity check and address any findings
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] The approved release inputs are committed locally and the git worktree is clean before running any release command
- [ ] `npm run typecheck` passes on that exact commit before running any release command
- [ ] `CHANGELOG.md` carries the user-facing release notes (features, fixes — not refactors) under `## X.Y.Z - YYYY-MM-DD`, with the working-notes comment above the first heading
- [ ] The changelog heading is exactly `## X.Y.Z - YYYY-MM-DD`
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `release:patch`, `release:minor`, or `release:promote` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] npm `@bytetrue/byspace@latest` resolves to the version
- [ ] The GitHub Release is published with the changelog body and both assets with their `.sha256` siblings
- [ ] Docker published both the versioned and `latest` images
- [ ] **Deploy App** deployed the stable web build to `app.byspace.cc.cd`
- [ ] **Release Notes Sync** overwrote the Release body with the changelog entry
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed
