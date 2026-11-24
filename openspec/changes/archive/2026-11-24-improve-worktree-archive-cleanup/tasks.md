# Tasks

## 1. Stop managed processes and release observation

- [x] 1.1 Add shared process-group/tree termination helpers, apply them to PTY sessions and workspace scripts, and make close/stop await bounded graceful and forceful termination; verify descendant and no-direct-kill regressions with focused `internal/terminal` and `internal/server` tests.
- [x] 1.2 Track running setup commands, configure their process groups, and make archive cancellation prevent later commands, terminate the active tree, and await run completion; verify with `internal/server/archive_teardown_test.go` and focused setup-process tests.
- [x] 1.3 Add goroutine-owned synchronous checkout-watch release after workspace records archive and before deletion; verify in `internal/server/checkout_observation_test.go` that the handle is released before return and shared observations remain alive.

## 2. Make worktree removal retryable and idempotent

- [x] 2.1 Refactor `internal/workspace` deletion to retry directory fallback at the designed intervals, verify absence after every attempt, and best-effort prune after Git removal, fallback, or an already-absent path; verify transient failure, no-error-with-residue, and prune coverage with focused real-repository tests.
- [x] 2.2 Separate archive preparation from immutable cleanup targets and recheck ownership plus active workspace references before every deletion attempt; verify sibling preservation, reclaimed-path cancellation, foreign-path refusal, and successful archive despite removal failure in `internal/server/workspace_archive_test.go`.

## 3. Add bounded deferred cleanup and outcomes

- [x] 3.1 Implement one `bgCtx`-bound deferred cleanup sequence per normalized worktree path using the designed schedule, deduplication, safety cancellation, and terminal outcomes without rerunning project hooks; verify eventual success, final failure, duplicate suppression, active-path cancellation, and daemon cancellation with focused server tests using injected scheduling/deletion.
- [x] 3.2 Broadcast `workspace.worktree.cleanup` success/failure outcomes with workspace ID, exact path, and final error while keeping archive responses independent of disk cleanup; verify emitted payloads and archive response semantics with focused server tests.

## 4. Surface cleanup state in the client

- [x] 4.1 Add the cleanup event to `packages/protocol` and subscribe through the low-level client in `web/src/contexts/session-context.tsx`; update immediate and final archive toasts plus all i18n resources, and verify pending/final messages include the designed behavior and exact path in focused protocol and web tests.
- [x] 4.2 Integrate the archive cleanup lifecycle and daemon-restart limitation into the owning development/observation documentation, and verify the updated documentation links and commands remain accurate.

## 5. Verify the integrated change

- [x] 5.1 Run the focused Go and web tests, `make build`, `npm run typecheck`, `npm run lint`, `npm run format`, and `npm run audit`; resolve failures attributable to this change and record any unavailable platform/browser verification explicitly.

## 6. Close review-identified lifecycle and outcome gaps

- [x] 6.1 Serialize creation/reclamation through workspace registration with cleanup guard-plus-deletion using canonical worktree-root locks, including nested CWDs and managed source worktrees; generate the worktree slug once, keep teardown outside the lock, and cover deterministic creation, nested activation, source reactivation, slug, and teardown-reentrancy regressions.
- [x] 6.2 Bound setup-run completion after forced shutdown, keep tree/group liveness independent of root or PTY completion, preserve the graceful interval for remaining descendants, and validate captured process start identity before root-anchored liveness checks or signals; cover stuck completion, root-exits-first descendants, graceful descendant exit, stale PID non-signaling, and mismatched-identity rejection with focused tests.
- [x] 6.3 Add explicit archive-response pending state and a silent cleanup-cancelled outcome; show real non-deferred errors and dismiss pending toasts on cancellation, with server, protocol, and web regression coverage.
- [x] 6.4 Return the daemon’s canonical cleanup key in archive responses and outcomes, key cleanup toasts by server plus that key, and verify aliases or archived workspace IDs sharing one worktree cannot strand a pending notification.

## 7. Reverify and review the completed change

- [x] 7.1 Run focused regression tests, rebuild generated protocol artifacts and the Go binary, run typecheck/lint/format/audit, repeat the connected-code review, and record unavailable platform/browser verification before archiving.
