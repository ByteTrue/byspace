# Design

## Context

Workspace archive currently stops terminals and marks setup stopped, but terminal close kills only the direct process and setup commands run through an untracked `exec.Cmd`. Checkout watches are released later by observer reconciliation, after deletion may already have failed. Directory fallback runs once and prunes Git metadata only when Git itself removed the worktree. A failed archive response leaves no daemon work that can finish the cleanup later.

Archive must remain a successful soft-delete even when disk cleanup fails. Process teardown, watcher release, foreground deletion, and deferred deletion therefore need separate responsibilities: the first three prepare the checkout, while deletion is safe to retry only when it rechecks ownership and active references.

## Goals / Non-Goals

### Goals

- Stop every BySpace-managed terminal, workspace script, and setup-command process tree for the workspace, with bounded graceful and forceful phases, and wait before deletion.
- Release the archived worktree's daemon observation before deletion without disturbing shared observations.
- Make deletion idempotent, retry transient failures, and prune Git worktree metadata after either deletion path.
- Continue failed foreground cleanup in one bounded, deduplicated background sequence while the daemon remains running.
- Keep archive successful and distinguish deferred cleanup from immediate teardown or safety failures, reporting final outcomes with the exact worktree path.
- Serialize worktree creation/reclamation with cleanup so the active-reference guard cannot be invalidated between checking and deletion.

### Non-Goals

- Killing processes BySpace did not start, including editors, shells, or dev servers opened independently by the user.
- Persisting deferred cleanup across daemon restarts or adding startup recovery.
- Deleting ordinary directory workspaces or paths that fail managed-worktree ownership validation.
- Retrying project teardown commands or rerunning workspace setup during cleanup.
- Adding a general-purpose background job system.

## Decisions

### Use one awaited process-tree shutdown contract

Put process-group preparation and graceful/forceful tree termination behind shared platform helpers in `internal/proc`, reusing the existing Windows `taskkill /T` and Unix process-group behavior rather than adding another Windows implementation. Apply group preparation before starting both PTY sessions and raw setup commands.

Change terminal close and workspace-script stop to terminate the tree, wait a bounded grace period, force-kill it if necessary, and await process exit. Replace the script stop path's fire-and-forget escalation goroutine with this awaited operation. Root-process or PTY completion is not proof that a detached descendant exited: Unix shutdown probes the original process group, and Windows enumerates descendants rather than trusting only the root PID. A live remaining tree still receives the full graceful interval before forceful termination. A wholly absent tree returns before any signal. Process start identity is captured when each terminal or setup command starts and checked before root-anchored liveness probes and signals, so a live replacement with the same numeric PID is not treated as the original tree. Missing original identity and query failures fail closed; only an authoritative absent-root result permits original-group or descendant handling.

Track the active setup run and its completion in the server. `stopWorkspaceSetup` must prevent subsequent setup commands from starting, terminate the active command tree, and bound both the shutdown and final run-completion waits. A stuck run returns control to archive after the forced phase; deletion can then fail and move to deferred cleanup. Setup retains its existing `failed` status and `workspace archived` error; no new setup status is added.

### Release native observation after archiving records

Add a request/acknowledgement release operation to `checkoutObserver`, handled by its existing goroutine so its watch map remains single-owner. Archive invokes it after workspace records are archived, preventing reconciliation from immediately recreating the watch, and before filesystem deletion.

The operation releases only the archived workspace's observation consumer. Existing observation reference counting preserves a shared subscription until its final consumer leaves. Logical client file and diff subscriptions are not cancelled: they do not own the native checkout descriptors and may be shared by other clients.

### Separate one-time preparation from repeatable deletion

Keep project teardown commands and process/watcher teardown in the foreground archive path. Resolve the repository root and managed worktree path once, then pass an immutable cleanup target to deletion. Neither foreground retries nor deferred cleanup rerun project hooks.

Refactor worktree deletion into an idempotent attempt that:

1. Revalidates BySpace ownership from the managed worktree path and refuses foreign paths.
2. Rechecks the workspace store and returns without deletion or pruning if any active record still references the path.
3. Returns success immediately when the directory is already absent.
4. Tries `git worktree remove --force` when Git registration is present, then uses directory removal as fallback.
5. Attempts `git worktree prune` after either path, including when the directory was already absent.

Directory fallback uses bounded delays of 0, 100, 300, 700, and 1500 ms on all platforms. It checks path absence after every removal attempt and treats an existing path as failure even if the remove call returned no error. The foreground operation returns only after confirmed absence or exhausted retries.

### Run one bounded deferred cleanup per worktree

When foreground deletion fails, register a cleanup keyed by normalized worktree path and run it under the server's existing `bgCtx`. A duplicate request reuses the pending entry. Daemon shutdown cancels the sequence; no outcome is promised after shutdown.

Deferred attempts wait 5 s, 15 s, 30 s, 1 min, 2 min, and 5 min between attempts. Every attempt repeats the ownership and active-reference checks and the same deletion/prune operation. Success, cancellation because an active workspace reclaimed the path, or exhaustion removes the pending entry. Exhaustion is the only final failure outcome; an active-reference cancellation emits `cancelled` so the client can dismiss its pending toast without reporting deletion success or failure.

### Preserve archive response and add a cleanup outcome event

Keep `archive_workspace_response` and its optional `directoryError`, and add `directoryCleanupPending` to distinguish a scheduled deferred cleanup from teardown, ownership, or store failures that have no background job. Add `directoryCleanupKey` to carry the daemon’s canonical cleanup identity. Only a pending response shows the persistent background-cleanup warning; other directory errors display their actual message.

Add outbound `workspace.worktree.cleanup` with payload `{workspaceId, path, cleanupKey, status, error?}`, where status is `succeeded`, `failed`, or `cancelled`. Register it in the protocol outbound union and subscribe through the client's low-level typed message listener; no new high-level client facade is needed. An active-reference safety stop emits `cancelled` but no new user-facing message.

Key cleanup toasts by server and the daemon’s canonical `cleanupKey` rather than workspace ID or a client-normalized path, so aliases and duplicate archived records share one notification. The archive hook shows a persistent warning only while cleanup is pending. The active session context replaces that toast with final success or failure, or dismisses it on cancellation; success and failure messages contain the exact path.

## Risks / Trade-offs

- **Waiting for process exit can delay archive.** Graceful and forceful waits are bounded, and archive still completes if a process refuses to exit; deletion then fails safely and moves to deferred cleanup rather than hanging the request.
- **A path can be reused after archival.** A per-normalized-path lifecycle lock spans creation/reclamation through workspace registration and spans the cleanup guard through destructive removal. Every destructive attempt still rechecks active records, and deferred cleanup emits a cancellation that only retires the pending toast.
- **Prune can touch unrelated stale registrations.** Git prune remains scoped to the repository root and runs only after the managed target is absent; active references abort before pruning.
- **Deferred work disappears on daemon restart.** This is an intentional bound on scope. A final failure can only be delivered while the daemon is running; persistent recovery would require a separate persisted-job design.
- **Windows lock behavior varies by external application.** Retries handle transient locks but cannot force release handles owned by unrelated processes. Final failure retains the exact path for manual resolution.

## Migration Plan

Change the daemon, protocol schema, and web listener/toasts together. Existing archive requests keep their shape; responses gain cleanup pending/key fields, and the new outbound event is additive. No stored-state migration or compatibility shim is needed.

## Open Questions

None.
