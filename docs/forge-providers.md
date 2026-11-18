# Adding a Git Forge to BySpace

BySpace's forge layer is a manifest plus string-dispatch adapters. A forge is a
runtime concern: shared protocol messages carry neutral/open facts, the Go
adapter owns behavior, and the app owns bundled presentation/runtime
interpretation.

The maintainer litmus test is the rule of thumb:

> Adding a new forge means adding adapter files that implement the shared
> entry-point signatures, one branch in each Go dispatch switch, and one entry
> in the app registries.

## The Three Registrations

For forge `acme`, the expected end state is:

1. **Protocol manifest** - optional, only when the forge should be presented by
   shared manifest data. Add one `ForgeDefinition` to
   `packages/protocol/src/forge-manifest.ts`.

2. **Go adapter** - add `internal/workspace/acme_pr_status.go` implementing
   `currentAcmePullRequest(ctx, cwd, target PRLookupTarget) (map[string]any, error)`,
   plus search/auth/timeline functions beside it. Wire one branch into each
   dispatch switch: `CurrentPRStatus` (`pr_status_poll.go`),
   `SearchIssuesAndPullRequests` (`forge.go`), `forgeBinaryName`/`ProbeForgeAuth`
   (`forgeauth.go`), and the timeline dispatcher (`forge_timeline.go`). Add the
   forge's exact public hosts to `forgeCloudHosts` (`forge.go`).

3. **App modules** - a forge splits into a pure logic half and a view half so
   logic consumers (URL builders, merge-capability, native checks, and the
   Node-based e2e harness) never pull the client rendering stack:
   - `web/src/git/forges/acme.ts` - logic: `id`, optional `urlGrammar`
     (source links and pasted issue/change-request reference paths), optional
     `facts` (schema, merge-capability, native-check fallbacks). No
     React/React-Native imports. Register in `CLIENT_FORGE_LOGIC_MODULES` in
     `web/src/git/forges/index.ts`.
   - `web/src/git/forges/acme.view.tsx` - view: `icon` (SVG component
     under `web/src/components/icons/`), optional `brandColor`, optional
     `paneContributions`. Register in `CLIENT_FORGE_VIEW_MODULES` in
     `web/src/git/forges/view.ts`.

There should be no protocol typed-union arm, no central app icon/color/url/facts
map, and no central server union of known forge facts.

## Protocol

`forgeSpecific` on PR status is an open envelope:

```ts
z.object({ forge: z.string() }).passthrough();
```

The `forgeSpecific.forge` field is a **facts-family tag**, not the workspace
brand id. Gitea, Forgejo, and Codeberg can all emit `forgeSpecific.forge ===
"gitea"` when they share the same facts shape, while top-level `status.forge`
keeps the brand id (`"gitea"`, `"forgejo"`, `"codeberg"`).

Protocol does not validate per-forge fact fields. Consumers that understand a
facts family validate at runtime with their own schema/guard. Unknown or
schema-mismatched facts render neutrally instead of failing the whole message
parse: a client can receive facts from a forge it does not know and still show
the PR/MR in a neutral state.

Check results keep a stable normalized `status` for aggregation and an optional
open `traits: string[]` for composable forge-neutral refinements such as
`manual`, `action_required`, and `warning`. Consumers ignore unknown traits and
fall back to `status`. Do not add provider vocabulary to the normalized status
union. Producers and the presentation layer share the trait constants in
`packages/protocol/src/check-traits.ts` — use those instead of string literals
so classification and emission cannot drift apart.

Every forge delivers its native merge facts through `status.forgeSpecific`.
There is no GitHub mirror: app and daemon ship together, so a single shape
serves every client.

## Server (Go)

The status payload is an open `map[string]any`. Each adapter builds its native
facts under `forgeSpecific` and keeps strong internal types for construction and
command guards, but shared code must not grow a central list of forge fact arms.
`CurrentPRStatus` (`pr_status_poll.go`) dispatches on the detected forge string:
`gitlab` → `currentGitLabMergeRequest`, `gitea` → `currentGiteaPullRequest`,
default → `currentGitHubPullRequest`. Search, auth probe, and timeline dispatch
the same way. There is no registry interface — the switch branch is the
registration.

Current change-request lookup uses two identities deliberately:

- An open PR/MR belongs to the checkout when its head branch and head repository
  match. Its remote head SHA may differ because the checkout can be ahead,
  behind, or contain commits that have not been pushed yet.
- A merged or closed PR/MR belongs to the checkout only when its recorded head
  SHA exactly matches the checkout's current `HEAD`. Branch names are reusable;
  selecting the newest terminal request by branch alone can silently attach an
  old promotion or feature request to new work.

Thread the checkout head SHA through adapter cache and poll identities as well
as the lookup itself. Otherwise a commit made on the same branch can inherit the
previous commit's cached terminal status until the cache expires.

Cloud hosts in the manifest are a bounded public-host list, not a self-host
allowlist. Self-hosted detection is a trust gate: BySpace only talks to a forge
host that is either a known cloud host or one the CLI is already authenticated
to. Adapter probes must not make anonymous HTTP requests to remote-derived
hosts, and adapters must not route credentials to an unauthenticated host.

## App

Each app forge splits into two modules so pure logic never imports the client
rendering stack:

`acme.ts` exports a `ClientForgeLogicModule`:

- `id`
- optional `urlGrammar` (including `referencePaths` for composer auto-attachment)
- optional `facts` registration (schema, merge-capability, native-check fallbacks)

`acme.view.tsx` exports a `ClientForgeViewModule`:

- `id`
- `icon`
- `brandColor` (`null` for neutral; GitHub intentionally uses `null`)
- optional `paneContributions`

Two registries live under `web/src/git/forges/`:
`CLIENT_FORGE_LOGIC_MODULES` (`index.ts`) drives URL grammar, merge-capability
derivation, and native fallback checks; `CLIENT_FORGE_VIEW_MODULES` (`view.ts`)
drives icon/color lookup and PR-pane contributions. Logic consumers must import
the logic registry only — importing the view registry (or a `.view.tsx` module)
from a logic path pulls the React rendering stack and breaks the Node-based e2e harness.

Per-forge brand colors live on the module, not in `styles/theme.ts`, with a light and a dark value.

Facts modules use one source of truth: a Zod schema. Helpers like
`defineForgeFacts`, `defineNativeFallbackCheck`, and `definePaneContribution`
derive guards from `schema.safeParse` and re-parse before invoking typed
derivers/renderers. That keeps typed derivers away from the open wire envelope.

## Checklist

To add `acme`:

1. Add `acme` to `FORGE_DEFINITIONS` if the shared manifest should know its
   label, nouns, icon kind, sign-in CLI, or cloud hosts.
2. Add `internal/workspace/acme_pr_status.go` implementing
   `currentAcmePullRequest(ctx, cwd, target) (map[string]any, error)`, plus
   search/auth/timeline functions.
3. Add one branch to each Go dispatch switch (`CurrentPRStatus`,
   `SearchIssuesAndPullRequests`, `forgeBinaryName`/`ProbeForgeAuth`, timeline)
   and the forge's exact hosts to `forgeCloudHosts`.
4. Add `web/src/git/forges/acme.ts` (logic) and
   `web/src/git/forges/acme.view.tsx` (view).
5. Add one `CLIENT_FORGE_LOGIC_MODULES` entry (`index.ts`) and one
   `CLIENT_FORGE_VIEW_MODULES` entry (`view.ts`).
6. Add/update the icon component only if the client bundle should show a brand
   mark.
7. If the forge's CI/data model does not fit an existing shared field, widen the
   protocol schema (plus its guards) instead of faking a value — e.g. Gitea
   Actions runs carry no check-run id, so `checkRunId` became optional with
   `workflowRunId` as the alternative address. Widening a shared field is not
   forge-local: it also affects the already-shipped forges and the RPC call-site
   guards, so verify every consumer rather than assuming the change only reaches
   the new adapter.
8. Run targeted tests: manifest/resolver, the adapter test, protocol checkout PR
   schema, app forge URL/presentation tests, app merge capability, and any
   PR-pane native data tests touched.

Run `npm run typecheck` after each implementation slice. If protocol or client
declarations are stale, run `npm run build:client`. Go changes need `make build`
before the e2e suite or `npm run cli` sees them.

## Gotchas

- GitHub is a normal registry entry, like every other forge. All forge facts
  flow through `forgeSpecific`; there are no version-compat shims.
- Gitea-family facts use `forgeSpecific.forge === "gitea"` even when the
  top-level brand is Forgejo or Codeberg.
- Gitea's legacy Actions task endpoint cannot filter by commit, may enforce a
  page size below the requested limit, and omits rerun-attempt numbers. Walk a
  bounded number of pages using `total_count` and filter locally. Preserve
  ambiguous same-run tasks: display names are not stable job identities, so
  name-based deduplication can hide a real failure.
- A blocked Gitea Actions task is not necessarily manual: only add the
  `action_required` trait when the matching run metadata reports
  `need_approval`.
- Brand icons are bundled React components, so they cannot come from protocol
  manifest data.
- Source URL grammars are app-side because blob/tree path syntax is
  forge-specific. If a forge has no grammar, omit the "Open on ..." source link
  rather than constructing a wrong URL.
- Pasted issue/change-request URL recognition is also app-side and registry
  driven. Put the forge's route infixes in `urlGrammar.referencePaths`; the
  neutral extractor matches the pasted host and full repository path against
  the current remote before it invokes cwd-routed forge search. Do not add a
  central forge switch or guess a self-hosted Gitea-family brand from URL shape.
- GitLab pipeline status constants belong to the GitLab adapter/client module,
  not protocol.
- GitLab `manual` jobs need `allow_failure` to distinguish optional gray jobs
  (`manual`) from blocking jobs (`manual` plus `action_required`). A failed
  allowed-failure job carries the `warning` trait, and `canceling` remains active
  until GitLab reports a terminal status.
- GitHub PR polling owns one account-wide GraphQL budget. Coordinate retained
  targets per host, batch their reads, and stop until GitHub's reset time when
  the reserve is exhausted. Never add a per-target GitHub request to the poll
  path. Resolve fork PRs through their parent repository without abandoning the
  shared batch.
