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

Also pack the public npm artifact, install it into an empty prefix, and run `byspace --version`, `byspace --help`, and an isolated daemon status/start/stop smoke. A release is blocked while any advertised GitHub, npm, Pages, relay, or Docker endpoint is missing.

## Stable release

1. Start from a clean `main` checkout.
2. Update the shared workspace version and changelog.
3. Run all required checks and the clean install smoke.
4. Commit the release as `Release vX.Y.Z`.
5. Push `main` to `ByteTrue/byspace`.
6. Wait for CI on that exact commit to pass.
7. Create and push only tag `vX.Y.Z`.
8. Verify the GitHub release, npm `latest`, Pages, relay health, and Docker image when enabled.

## Beta release

Use `vX.Y.Z-beta.N`, mark the GitHub release as prerelease, and publish npm only with `--tag beta`. Do not move the stable `latest` dist-tag until the stable release is complete.

## Cloudflare deployment

`Deploy App` and `Deploy Relay` run only after the `CI` workflow succeeds for a pushed `main` commit, then deploy that exact SHA with serialized production concurrency. Pages uses project `byspace`; the relay uses Worker `byspace-relay` and its own Durable Object, with no upstream proxy. Both workflows require the repository secret `CLOUDFLARE_API_TOKEN`.

Local emergency deployment uses the same workspace scripts after `wrangler whoami` confirms the intended Cloudflare account.

## npm publishing

The public entry is only `@bytetrue/byspace`. Internal workspace packages are bundled into its tarball and are not user-facing install targets. `release:check` packs, clean-installs, and smoke-tests one artifact; publication uses that same tarball without rebuilding it.

For the first release only, wait for `main` CI, run `npm login`, rerun `release:check` on that exact commit, and execute `npm run release:publish` before pushing the tag. Then configure npm Trusted Publishing for repository `ByteTrue/byspace` and workflow `npm-release.yml`. The tag workflow is idempotent: it skips npm publication when the exact version already exists, then creates the GitHub release. Subsequent releases publish through OIDC and require npm 11.5.1+ plus `id-token: write`, with no long-lived token.

After publishing:

```bash
npm view @bytetrue/byspace version
npm install -g @bytetrue/byspace@latest
byspace --version
```

## Rollback

Do not overwrite an existing tag or npm version. Fix forward with the next patch. Pages and relay can be redeployed from the last known-good commit while the local package is fixed forward.
