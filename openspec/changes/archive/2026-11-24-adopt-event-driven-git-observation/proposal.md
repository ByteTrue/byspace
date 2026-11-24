# Proposal

## Why

The Go daemon learns about git changes by polling. Every open Changes pane recomputes its whole
diff once a second (`subscriptionPollInterval` in `internal/server/runtime_services.go`), and every
checkout's sidebar facts are invalidated by a 2-second fingerprint of three files
(`headWatchInterval` in `internal/server/head_watch.go`). That design has two costs: the diff of a
large branch is re-read and re-sent byte-for-byte whenever anything in it moves, and any file the
fingerprint does not read leaves the UI stale forever. The shipped `+23/-30`-after-push bug was the
second kind, and patching the fingerprint field by field is a losing game.

Reference project paseo (our origin for `web/src/git`) already replaced both loops with event
observation: one working-tree watch plus one git-metadata watch per repository, a shared diff target
per comparison, and revision-based incremental bodies. The daemon is where we diverged from it.
`internal/workspace/gitmeta/rules.go` is already a complete port of paseo's
`git-metadata-event-rules.ts` and is dead code today because nothing feeds it events.

## What Changes

Adopt the same shape in the Go daemon, in three landable slices. Each slice ships with the old path
still working.

- **观察层.** Add a recursive filesystem observation service in Go (Linux directory-level watcher,
  macOS/Windows one native recursive watcher), a shared reference-counted working-tree watch per
  cwd, git-metadata watches on the git dir and common dir classified through the existing
  `internal/workspace/gitmeta` rules, and a git ref probe (`git cat-file --batch-check` over the
  watched refs) that only reports a ref as moved when its SHA changed. Failure of any watch degrades
  that root to bounded polling instead of dropping events silently.
- **语义失效.** Replace the three-file HEAD fingerprint with the events above: a branch ref move
  refreshes branch/placement, an upstream ref move refreshes the diff stat and ahead/behind, a
  working-tree event refreshes dirtiness and the diff, an index/attribute/config change refreshes
  interpretation. A push, fetch, `branch -f`, stash or rebase can no longer leave a stale number.
- **引擎.** One diff target per comparison key (cwd, base, head, merge base, ignore-whitespace,
  highlight), shared by every subscriber, with a commit revision and a per-file identity cache
  (`git config --null --list` + `git check-attr --all` + `git hash-object --stdin-paths`) so only
  files whose identity changed are read and sent. Invalidation is coalesced instead of per-tick.
  While this slice ships, the wire payload stays today's `checkout_diff_update` JSON: zero client
  change (paseo proves this path with its own `COMPAT(diffSubscription)` shim).
- **增量协议.** Add diff frames to `packages/protocol/src/binary-frames/` and a demux slot: Begin
  (entries, resolved SHAs, base revision), Bodies (only changed files), End (omitted, too large,
  error). The Changes pane keeps the hunks whose revision it already holds. Only after this lands do
  the 1-second subscription poller and the 2-second HEAD poller get deleted.
- **Docs.** Rewrite `docs/file-observation.md` for the Go watcher; it still describes the deleted
  Node module (`packages/server/src/server/file-observer`).

## Capabilities

### New Capabilities

- `git-change-observation`: how the daemon learns that a repository changed — working-tree and
  git-metadata observation, ref probes, class of change, degraded polling, and which derived
  checkout facts each event invalidates.
- `git-diff-subscription`: the per-comparison diff target shared by all viewers, per-file
  identity and caching, revision-based incremental delivery, byte and file-count budgets, replay to
  a late subscriber, and interpreter errors.

### Modified Capabilities

None.

## Impact

- `internal/server/runtime_services.go` (subscription poller), `internal/server/head_watch.go`
  (HEAD poller), `internal/server/diffstat.go` and `internal/workspace/diffstat.go` (stat cache and
  its invalidation), `internal/workspace/head_fingerprint.go` (retired), `internal/workspace/gitmeta`
  (wired up), `internal/server/ws_agent.go` (`checkoutDiffFiles` becomes a target read).
- New Go packages for observation and the diff engine; `internal/server` owns their lifecycle.
- `packages/protocol/src/binary-frames/diff.ts` + `demux.ts`; `web/src/data/push-router.ts` and
  `web/src/git` consume frames instead of whole snapshots in slice 3.
- `docs/file-observation.md`, `docs/architecture.md` (where the polling note lives),
  `docs/terminal-performance.md`-style perf expectations for the diff path.
- Blast radius: the working-tree watch also feeds checkout status, diff stat, PR status and
  workspace placement, so every sidebar number changes its update path in slice 1, and e2e specs
  that assert sub-2-second freshness become assertions on push delivery.
- No new dependency is chosen in this proposal; the watcher implementation is a design decision.
