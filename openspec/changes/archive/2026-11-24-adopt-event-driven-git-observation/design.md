# Design

## Context

See `proposal.md` — Why. What shapes the approach:

- The daemon has no filesystem watching at all today: `internal/server/runtime_services.go` polls
  every diff subscription once a second and `internal/server/head_watch.go` fingerprints every
  checkout every two seconds.
- `internal/workspace/gitmeta/rules.go` already ports paseo's metadata classification but has no
  caller outside its package.
- The binary channel and its demux exist (`packages/protocol/src/binary-frames/`), but nothing
  carries diff data over it.
- `internal/server/server.go` already exposes `SendBinary` down to the E2EE sink, so transport is
  not a design problem.
- The release build compiles with `CGO_ENABLED=0` (`scripts/dev-daemon.mjs`), which rules out
  FSEvents on macOS.
- `golang.org/x/sys v0.49.0` is already a dependency; no new module is needed for platform APIs.

## Goals / Non-Goals

**Goals:**

- Correctness by meaning: a number the UI shows is refreshed because its input changed, not because
  a guessed fingerprint moved.
- Cost proportional to the change: one working-tree watch per checkout, one comparison per key,
  one file re-read per edited file.
- Every slice is independently shippable and revertable, with the previous delivery path intact
  until the new one is proven.

**Non-Goals:**

- Changing the Changes pane UI, the `ParsedDiffFile` shape, or the comparison options the client
  sends.
- Watching non-git directories (the file explorer's `fs.file` subscriptions keep their own path).
- Incremental hunk-level patching of a single file's diff body. Slice 3 sends whole file diffs,
  selectively.
- A general-purpose file-observation API for other daemon features to adopt in this change.

## Decisions

### D1. Three slices, each with the old path still running

Slice 1 adds observation and semantic invalidation while the 1 s diff poller keeps running; the
delivered output is unchanged. The 2 s HEAD poll cannot survive it (D6 replaces exactly what that
poll computed), so the differential validation compares the daemon's cached facts against a fresh
read of the checkout instead of against a shadow poller. Slice 2 replaces the poller's computation
with a shared target but keeps the `checkout_diff_update` JSON. Slice 3 adds binary delivery and only
then deletes the diff poller. Reverting any slice leaves a working daemon.

Alternative considered: one big switch. Rejected — the blast radius of slice 1 is every sidebar
number, and a single PR would make a bad watcher indistinguishable from a bad engine.

### D2. One observation interface, three platform backends, `golang.org/x/sys` only

A single `Observation` type exposes subscribe/update-ignore/unsubscribe over a root. Under it:

- **Linux**: inotify via `x/sys/unix`, one watch per directory, explicit recursion with a tracked
  entry cap and git-ignore pruning. This is the backend shape paseo settled on after Node's
  recursive `fs.watch` exhausted resources, and the reason `docs/file-observation.md` warns
  against the recursive wrapper.
- **macOS**: kqueue on directories, same topology code as Linux. FSEvents needs cgo, which the
  build disables, so paseo's macOS backend cannot be ported literally.
- **Windows**: one `ReadDirectoryChangesW` handle per root with `bWatchSubtree`, via
  `x/sys/windows`.

Alternative considered: adding a third-party watcher module. Rejected — the repo has exactly the
two platform packages needed, and the hard part (topology repair, ignore reconciliation, caps) is
ours regardless, so a dependency would only hide the part that has failed before.

### D3. The working-tree watch belongs to a service, not to the diff engine

Slice 1 adds one observation owner in `internal/server` with a reference-counted
`WatchWorkingTree(cwd, cb)` and `WatchGitMetadata(cwd, cb)`. The diff engine, checkout status, diff
stat, PR status and placement all subscribe through it. paseo does the same
(`requestWorkingTreeWatch` on its workspace git service), and the alternative — a watch owned by the
diff engine — would duplicate the same recursive watch once per consumer.

### D4. Metadata events are classified, not interpreted ad hoc

`gitmeta.Classify(scope, path)` already returns `ignore`/`owner`/`all`/`ref` plus
`RefreshBase`; the service resolves `--absolute-git-dir` and `--git-common-dir`, watches both, and
maps the result onto the subscribers. `gitmeta.PrunedPaths` supplies the exclusions. No new rules
are written; the dead-code port is wired to an event source.

### D5. Ref movement is confirmed by object id, not by file timestamps

Watched refs (current branch, its upstream, the comparison base, `HEAD`) are probed with one
`git cat-file --batch-check=%(objectname)` call over batches of paths, with a short timeout. A ref
counts as moved only when the SHA differs. Alternatives rejected: watching ref files directly
(fails for packed refs and for rewrites that keep the SHA), and treating any metadata event as
"something moved" (re-reads the world on every `git status`).

### D6. Derived facts are invalidated semantically

The mapping replaces `workspace.HeadFingerprint`:

| Input moved                        | Refresh                              |
| ---------------------------------- | ------------------------------------ |
| working tree event                 | dirtiness, working comparison        |
| current branch ref                 | placement, branch state, branch list |
| base ref or merge base             | comparison base, diff stat           |
| upstream ref (tracked branch only) | diff stat, ahead/behind              |
| index, attributes, config          | interpretation fingerprint           |

`internal/workspace/head_fingerprint.go` and its test are deleted in slice 1 once the event path
covers every input the fingerprint read.

### D7. Per-file identity is content plus interpretation

A file's identity is a SHA-256 over the blob id (`git hash-object --stdin-paths`), the
`check-attr --all` values for its path, and a hash of `git config --null --list`. Interpretation
inputs are fingerprinted once per comparison, so a `.gitattributes` or config change re-reads
bodies without treating every file as edited. mtime is never part of the identity: it changes on
checkout, on `git status`, and on editor writes that leave content identical.

Alternatives rejected: blob id alone (misses filter/attribute changes), stat tuple (fires
constantly on Windows and misses content-equality).

### D8. Invalidation is a coalescing timer with a generation counter

A target keeps `dirty` and a `generation`. Invalidation marks dirty and arms one timer (150 ms,
matching paseo). A computation reads the generation when it starts and refuses to commit if the
generation moved — this is paseo's `isInterrupted`, and it is what stops a slow comparison from
overwriting a fresher one. Delivery of a committed revision happens after commit, never from a
partially computed state.

### D9. Slice 2 keeps the JSON payload

The target's committed revision is rendered into today's `checkout_diff_update` payload. The
protocol does not change in slice 2, so the web client is untouched and the engine can be
benchmarked against the poller's output directly. paseo's `COMPAT(diffSubscription)` shim is the
precedent: the shared engine shipped before the incremental wire.

### D10. Diff frames get their own opcode block

`diff.ts` allocates `0x30`–`0x3f` (after terminal `0x01`–`0x05`, file transfer `0x10`–`0x12`,
tunnel `0x1f`–`0x23`) and `demux.ts` gains a `diff` arm:

- `Begin 0x30`: `[opcode][1B subscription id length][subscription id][JSON header]` — revision,
  entries, resolved SHAs, budgets, error.
- `Bodies 0x31`: `[opcode][1B id length][id][4B file count]` then per file
  `[2B path length][path][4B body length][body]`.
- `End 0x32`: `[opcode][1B id length][id][JSON trailer]` — omitted files, `diffTooLarge`, error.

JSON is used for the two control frames because they are schema-checked like every other daemon
message and the parse cost is irrelevant next to file bodies; bodies stay binary so no escaping or
base64 is involved. The header/trailer schemas live beside the frame code and are validated with the
same zod conventions as the JSON messages.

### D11. Budgets reuse the existing flags

`diffTooLarge` already exists in the protocol and the client renders it, but the daemon never sets
it. Slice 2 starts setting it from a total-byte budget, and adds file-count omission using the same
field shape the client already understands, rather than introducing new protocol fields.

### D12. Health goes into the existing runtime metrics surface

Active observations, watched entries, pending events, degraded-polling state, and failure counts are
recorded through `internal/server/runtime_metrics.go`'s existing counters, next to the binary-channel
counter. No new diagnostics RPC.

## Risks / Trade-offs

- **Linux watcher resource exhaustion** (the failure this repo already had) → tracked entry cap,
  ignore pruning, and a hard fall back to polling when the cap is reached; the backend is benchmarked
  with a pre-populated tree before slice 1 merges.
- **Blast radius on every sidebar number** → slice 1 runs alongside the diff poller and is
  validated per git operation: with no poller running, the cached branch, dirty state, ahead/behind
  and diff stat must equal a fresh read (`internal/server/differential_test.go`). The diff poller is
  removed only in slice 3.
- **A wrong file identity makes a diff silently stop updating** → identity covers blob, attributes,
  and config; tests cover clean/smudge filters, `.gitattributes` edits mid-session, symlinks, and
  executable-bit-only changes (content-identical, mode-different).
- **e2e specs assert sub-2-second freshness through polling** → the freshness the app relies on is
  now a push (`web/e2e/browser/checkout-observation.spec.ts`), and the suite can force the polling
  path with `BYSPACE_DISABLE_FILE_OBSERVATION=1` to prove a spec fails without events.
- **macOS has no native recursive backend in this design** → kqueue directory-level from day one;
  the traversal cost is bounded by the same ignore pruning and cap as Linux. If it proves too slow
  in practice, a cgo-free FSEvents binding would be a separate change.
- **Two subscribers with different compare options on one checkout** → shared working-tree watch,
  separate comparison targets; the sync layer must not assume one target per cwd.
- **Degraded polling hides a broken watcher** → the degraded state and failure count are reported in
  metrics and a recovery returns to events; silent long-term degradation is the thing to watch for
  in soak testing.

## Migration Plan

1. **Slice 1** merges observation + semantic invalidation with the diff poller still running. Rollback:
   revert the slice; nothing the client sees changed.
2. **Slice 2** routes diff reads through a shared target and renders the existing JSON payload.
   Rollback: revert; the poller is untouched and resumes producing the same payload.
3. **Slice 3** adds binary frames and deletes `subscriptionPollInterval`. Rollback: revert; the
   poller returns with the slice-2 engine underneath it.

Each slice ends with `npm run audit` green and the affected e2e specs passing.

## Open Questions

- Concrete byte and file-count budgets, and whether they should be per-comparison or shared across
  a subscription's lifetime.
- Batch size for `git hash-object --stdin-paths` for a 1000+ file comparison on Windows, where
  process spawn dominates.
- Whether the metadata poll backoff (5 s → 60 s) stays the right degraded default on a slow
  filesystem or should be configurable.
