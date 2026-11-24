# Proposal

## Why

Archiving a managed Git worktree on Windows often leaves files and stale Git metadata behind. BySpace-owned processes and watchers can still hold the checkout when deletion starts, and the current one-shot directory fallback neither retries transient failures nor prunes after fallback, so users must manually finish cleanup.

## What Changes

- Terminate the complete BySpace-managed process tree for archived workspaces, including workspace scripts and their descendants, and wait for process exit before deleting the checkout.
- Synchronously release daemon-owned watchers for the worktree before deletion while preserving watchers shared by active sibling workspaces.
- Add bounded directory-removal retries with an existence check after every attempt.
- Always attempt `git worktree prune` after either Git removal or directory fallback.
- Continue cleanup in the background after the foreground attempt fails, using a bounded retry policy and preserving archive semantics.
- Report eventual cleanup success or final failure, including the exact worktree path on failure; keep the immediate archive response informative as well.

## Capabilities

### New Capabilities

- `workspace-archive-cleanup`: Process, watcher, filesystem, and Git-metadata cleanup for archived managed worktrees, including deferred retries and user-visible outcomes.

### Modified Capabilities

None.

## Impact

- Workspace archive orchestration and teardown in `internal/server`.
- Terminal and workspace-script process lifecycle in `internal/terminal` and `internal/server`.
- Worktree deletion and Git pruning in `internal/workspace`.
- Checkout watcher ownership and release in `internal/server`.
- Cleanup outcome delivery and archive toasts in the web client; wire schemas if a new server event is required.
- Focused Go and web tests, including Windows process-tree and transient-lock coverage.
