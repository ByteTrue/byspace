# Release process

BySpace releases only the retained product surfaces:

- `@bytetrue/byspace`: public npm package containing the CLI and local daemon;
- browser Web/PWA deployed to Cloudflare Pages project `byspace`;
- encrypted relay deployed as Cloudflare Worker `byspace-relay` with its Durable Object;
- optional Docker image `ghcr.io/bytetrue/byspace`;
- GitHub source tags and release notes in `ByteTrue/byspace`.

Electron, native iOS/Android clients, app stores, APKs, and a marketing website are not release surfaces.

## Versioning

The first BySpace release is `v0.1.0`. Stable releases use `vX.Y.Z`; beta candidates use `vX.Y.Z-beta.N` and publish npm with the `beta` dist-tag. Internal workspace packages share the same version because the public package bundles them.

Do not derive the next BySpace version from upstream tags. Fetch upstream without tags and never push all local tags.

### Release version decision

Before changing versions or the changelog, inspect the complete diff from the previous stable tag through `HEAD`:

- **minor**: a significant user upgrade or foundational internal work that materially changes reliability, performance, compatibility, deployment, or operation;
- **patch**: fixes, polish, small enhancements, and improvements within existing capabilities.

Diff size alone does not decide the version. The release agent proposes patch or minor, including the target version and rationale, and waits for explicit user approval. An agent never chooses a major release autonomously and never bumps a version merely to retry a failed build or tag workflow.

## Required checks

Before creating a release:

```bash
npm ci
npm run branding:check
npm run upstream:check
npm run build:client
npm run build:server
npm run typecheck
npm run lint
npm run format:check
npm run build:web --workspace=@bytetrue/byspace-app
npm run release:check
```

Also pack the public npm artifact, install it with `npm install -g --prefix <empty-prefix>`, and run `byspace --version`, `byspace --help`, and an isolated daemon status/start/stop smoke. The global-prefix shape is required because npm treats bundled packages differently during local and global installs. A release is blocked while any advertised GitHub, npm, Pages, relay, or Docker endpoint is missing.

## Stable release

1. Start from a clean `main` checkout.
2. Classify the complete previous-stable-to-`HEAD` diff and obtain approval for the target patch or minor version.
3. Run `npm run version:all:patch` or `npm run version:all:minor`, then update the changelog.
4. Run all required checks and the clean install smoke.
5. Commit the release as `Release vX.Y.Z`.
6. Push `main` to `ByteTrue/byspace`.
7. Wait for CI on that exact commit to pass.
8. Create and push only tag `vX.Y.Z`.
9. Verify the GitHub release, npm `latest`, Pages, relay health, and Docker image when enabled.

## Beta release

Classify the release and obtain approval before changing versions or the changelog. For a fresh beta, use `npm run version:all:beta:patch` or `npm run version:all:beta:minor`; retain the existing beta-next/promote flow for later candidates. Use `vX.Y.Z-beta.N`, mark the GitHub release as prerelease, and publish npm only with `--tag beta`. Do not move the stable `latest` dist-tag until the stable release is complete.

## Cloudflare deployment

For pushed `main` commits, `Deploy App` and `Deploy Relay` run only after the `CI` workflow succeeds and deploy that exact SHA with serialized production concurrency. Both workflows also expose an explicit `workflow_dispatch` operator override for manual redeployment; that path does not assert a prior CI result. Pages uses project `byspace`; the relay uses Worker `byspace-relay` and its own Durable Object, with no upstream proxy. Both workflows require the repository secret `CLOUDFLARE_API_TOKEN`.

Local emergency deployment uses the same workspace scripts after `wrangler whoami` confirms the intended Cloudflare account.

## npm publishing

The public entry is only `@bytetrue/byspace`. Internal workspace code is bundled into its tarball and is not a user-facing install target. The public root manifest alone owns the flattened external runtime dependency graph; bundled workspace manifests must not redeclare it because npm global installs do not install bundled packages' transitive dependencies. External dependencies, including native modules, are installed on the target platform. `release:check` packs, globally installs into an empty prefix, and smoke-tests one artifact; publication uses that same tarball without rebuilding it.

For the first release only, wait for `main` CI, run `npm login`, rerun `release:check` on that exact commit, and execute `npm run release:publish` before pushing the tag. Then configure npm Trusted Publishing for repository `ByteTrue/byspace` and workflow `npm-release.yml`. The tag workflow is idempotent: it skips npm publication when the exact version already exists, then creates the GitHub release. Subsequent releases publish through OIDC and require npm 11.5.1+ plus `id-token: write`, with no long-lived token.

After publishing:

```bash
npm view @bytetrue/byspace version
npm install -g @bytetrue/byspace@latest
byspace --version
```

## Rollback

Do not overwrite an existing tag or npm version. Fix forward with the next patch. Pages and relay can be redeployed from the last known-good commit while the local package is fixed forward.
