# Tasks

## 1. Observation service: core and Linux

- [x] 1.1 Add `internal/filewatch` with an `Observation` interface (`Subscribe(root, Options, callback)`, `UpdateExclusions`, `Release`) and an in-memory fake backend; verify with a table test that a callback sees create, write, rename, and delete events in order from the fake.
- [x] 1.2 Implement the Linux backend on `x/sys/unix` inotify with one watch per directory, a tracked-entry cap, and git-ignore pruning passed in as absolute excluded roots; verify with a real-filesystem test that a nested create is reported once and a file below an excluded root never is.
- [x] 1.3 Implement trailing-debounced topology repair: a moved or new directory rescans only its subtree, a file rename costs one classification stat, and a full scan happens only at subscribe and on exclusion replacement; verify the subtree scopes in a test that counts scanned paths.
- [x] 1.4 Enforce the entry cap and per-subscription watch failure handling: exceeding the cap or receiving a watch error marks the subscription degraded instead of dropping events silently; verify both paths report degraded through `Diagnostics()`.
- [x] 1.5 Make `Release` a barrier: once it returns, no callback, queued event, or inotify descriptor for that subscription may remain, including when the root was renamed or deleted; verify with a test that renames the root before releasing and asserts no callback fires afterwards.
- [x] 1.6 Benchmark the Linux backend on a pre-populated tree (10k files with node_modules-style ignored subtrees) through a `scripts/` measurement entry, and record attach time, event latency, and descriptor count in `docs/file-observation.md`; verify the numbers are reproducible by running the script twice.

## 2. Observation service: macOS and Windows

- [x] 2.1 Implement the macOS backend on kqueue over the shared topology code, sharing restart, pruning and degradation with Linux; the real-filesystem conformance suite passed on `macos-latest` in CI run 45264106243.
- [x] 2.2 Implement the Windows backend on one `ReadDirectoryChangesW` handle per root with subtree watching and a serialized drain goroutine; verify create/write/rename/delete in a real-filesystem test on `windows-latest`.
- [x] 2.3 Select the backend by platform behind the same interface and fail subscribe (rather than panic) on an unsupported platform; verify the selection test and that `GOOS=js`/`plan9` builds still compile the package.
- [x] 2.4 Implement degraded polling for a subscription: on install failure or a reported watch error, switch that root to identity-stamped polling with backoff (5 s → 60 s), and return to events when a watch can be re-established; verify with a fake clock test that a degraded root still reports a change and recovers.

## 3. Wire observation into the daemon

- [x] 3.1 Add the reference-counted working-tree watch per cwd and the git-directory watch in `internal/server` (resolve `--absolute-git-dir` and `--git-common-dir`), keeping one observation per root regardless of subscriber count; verify with a test that two subscribers share one observation and the observation is released with the last one.
- [x] 3.2 Classify git-directory events with `gitmeta.Classify` and `gitmeta.PrunedPaths` instead of local path rules, and route `ignore`/`owner`/`all`/`ref` to the right subscribers; verify with a rules-driven test that an object pack write produces no refresh and a branch ref write produces a checkout refresh.
- [x] 3.3 Implement the ref probe with one `git cat-file --batch-check=%(objectname)` call per batch (current branch, upstream, comparison base, `HEAD`) and a short timeout; verify a ref-file rewrite without a new SHA schedules nothing, and a push that moves `refs/remotes/origin/<branch>` schedules a base refresh.
- [x] 3.4 Replace `workspace.HeadFingerprint` and `headWatchInterval` with semantic invalidation: working-tree event → dirtiness + working comparison; branch ref → placement and branch state; base ref → comparison base and stat; upstream ref → stat and ahead/behind; index/attributes/config → interpretation. Verify with tests per row of the table in `design.md` (D6) and delete `internal/workspace/head_fingerprint.go` with its test.
- [x] 3.5 Export observation health (active observations, tracked entries, pending events, degraded state, failure counts) through the existing runtime metrics surface; verify the counters appear in the diagnostics output and that a degraded root is distinguishable from a healthy one.

## 4. Differential validation of the observation layer

- [x] 4.1 Run the new invalidation path in shadow mode next to the existing 1 s diff poll and 2 s HEAD poll, recording every place the two disagree; verify over a scripted scenario set (edit, stage, commit, push, pull, branch switch, stash, rebase, `branch -f`, attribute change) that no scenario leaves the shadow path stale while the poller is fresh.
- [x] 4.2 Fix every disagreement found by 4.1 at the classification or invalidation layer, not by keeping the fingerprint; the scenario set reported zero disagreements on Linux, macOS and Windows in CI run 45264106243.
- [x] 4.3 Sidebar freshness is covered by a dedicated e2e spec. No existing spec asserted freshness — every one calls `checkoutRefresh` first — so `web/e2e/browser/checkout-observation.spec.ts` writes a file in the seeded checkout and waits for the composer's diff pill to appear on its own. Verified: the spec passes with observation on (`1 passed`, 5.7 s) and fails with `BYSPACE_DISABLE_FILE_OBSERVATION=1` (`1 failed`); that switch removes the watcher outright, which is the same absence of pushes a long polling backoff produces.

## 5. Diff engine: shared target and per-file identity

- [x] 5.1 `internal/gitdiff` holds one target per key (cwd, base, ignore-whitespace), reference-counted by subscribers, with `Revision`, resolved SHAs and a per-file cache. Head and merge base are resolved per computation instead of keyed: they are outputs of the comparison, and `Resolved` reports them. `TestCompareSharesOneComputationBetweenSubscribers` proves two subscribers of one key share one computation and different keys stay separate.
- [x] 5.2 Per-file identity is a SHA-256 over the blob ids (one batched `git hash-object --stdin-paths` per comparison — `diff --raw` reports all zeros for the worktree side), the `check-attr --all` values, the modes, the status and a hashed `git config --null --list`. `TestContentIdenticalWriteReusesTheCachedBody` and `TestAttributesChangeRereadsOnlyTheAffectedFiles` cover it.
- [x] 5.3 Edge cases covered: `TestBaseComparisonFollowsNewCommits`, `TestEditedFileIsReread`, `TestUntrackedFileContentChangeIsDetected`, `TestSymlinkedFileIsReadAsALink`, `TestModeOnlyChangeIsNotMissed` (non-Windows: same blob, only the exec bit moves), `TestDeletedAndRecreatedFileKeepsItsIdentity`, `TestConfigurationChangeRereadsEveryCachedBody` (filters and eol arrive as config, so a config change re-reads every body). Red checks: dropping the commit-side blob ids, the worktree blob, the attributes, the config hash, the untracked content or the mode each fails its test. The mode mutant was compiled for Linux; no local Linux runner has git installed, so that one is confirmed by the CI matrix.
- [x] 5.4 Coalesced invalidation on `Engine.coalesce` (150 ms in production, 20 ms and 1 ms in tests, which is the fake clock) plus a generation counter. `TestBurstOfChangesComputesOnce` sees one recomputation for five invalidations; `TestChangeDuringComputationDiscardsTheStaleResult` proves an in-flight result whose generation moved is never delivered and the follow-up is.
- [x] 5.5 `applyBudget` enforces `MaxTotalBytes` and `MaxFiles`, sets `DiffTooLarge` and reports `Omitted`; the kept files stay in the result so the panel renders a truncation notice instead of an error. `TestBudgetsTruncateRatherThanFail` covers both budgets.
- [x] 5.6 A late subscriber is replayed the committed revision (`TestLateSubscriberIsReplayedTheCommittedResult`). `TestBrokenBaseKeepsTheSubscriptionOpen` delivers a missing base ref as an error and then the repaired comparison on the same subscription.

## 6. Slice 2: engine behind the existing payload

- [x] 6.1 `RegisterDiffSubscription` subscribes the engine and `deliverDiffUpdate` sends the same `checkout_diff_update` JSON (`files`, `error`, `diffTooLarge` only when set). `PollSubscriptionsOnce` no longer computes diffs at all; it only prunes dead sinks. `internal/server/diff_subscription_test.go` and the whole `go test ./internal/server` package pass.
- [x] 6.2 The 1 s recompute-with-digest loop is gone; the engine commits a revision and delivers it, and `refreshDiffCheckoutFacts` refreshes the status and diff stat once per key and revision. `TestTwoPanesOnOneCheckoutBothReceiveTheUpdate` sees two deliveries for one shared computation. `subscriptionPollInterval` remains for file subscriptions only, until slice 3.
- [x] 6.3 `internal/gitdiff/bench_test.go` benchmarks one edit on a 1000-file checkout against a full `git diff HEAD`; the numbers and the reproduce command are recorded in `docs/architecture.md` under "Checkout observation and diff delivery".

## 7. Slice 3: incremental binary delivery

- [x] 7.1 `packages/protocol/src/binary-frames/diff.ts` implements `Begin` (0x30), `Bodies` (0x31) and `End` (0x32) with the D10 layout, and `demux.ts` routes them. `diff.test.ts` round-trips every frame, an empty body list and a 100,000-byte body.
- [x] 7.2 `DiffBeginHeaderSchema` and `DiffEndTrailerSchema` sit beside the frame code and share the checkout error enum with the JSON payload. An invalid trailer and a truncated body list both decode to null in tests; `internal/diff/frames.go` is the daemon's encoder.
- [x] 7.3 `deliverDiffUpdate` sends Begin/Bodies/End, skips a revision the pane already has, and sends only `Result.Changed` paths plus files the pane has never seen. `TestDiffSubscriptionSendsOnlyChangedBodies` edits one of two files and finds one body in the second revision; `TestTwoPanesOnOneCheckoutBothReceiveTheUpdate` covers both panes.
- [x] 7.4 `packages/client/src/diff-frame-assembler.ts` folds frames into the existing `checkout_diff_update` payload, so `web/src/data/push-router.ts` needs no second path. Its test proves a one-file update leaves the other file's parsed body the same object, and `daemon-client.ts` decodes diff frames ahead of terminal frames and forgets retained bodies on unsubscribe.
- [x] 7.5 `subscriptionPollInterval`, `headWatchInterval` and `lastDigest` are gone. The remaining `filePollInterval` serves only `fs.file.update`, not checkout facts or diffs. The five diff/sidebar e2e specs passed (21 tests), and `npm run audit -- --no-browser` passed all Go tests plus inbound and outbound parity; the outbound audit now classifies `checkout_diff_update` as binary-only.

## 8. Documentation

- [x] 8.1 `docs/file-observation.md` now documents `internal/filewatch`: the contract and barriers, the inotify, `ReadDirectoryChangesW` and kqueue backends, topology repair, the 250,000-directory cap, degraded polling and diagnostics. The referenced symbols exist and `scripts/measure-filewatch.mjs` is the checked-in benchmark.
- [x] 8.2 `docs/architecture.md` has a "Checkout observation and diff delivery" section and the binary-channel list names Begin/Bodies/End. The only mention of the old 1 s diff poll and 2 s HEAD fingerprint is the sentence saying they are gone; `filePollInterval` remains solely for `fs.file.update`.
- [x] 8.3 The same section states the delivered-vs-cached distinction, that a pane discards an older revision, and that only `Result.Changed` bodies plus never-seen files cross the wire because identity, not mtime, is the comparison.
