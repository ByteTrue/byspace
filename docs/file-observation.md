# File observation

`internal/filewatch` reports changes under a directory tree. One `Observation` owns the platform watchers; a `Subscription` is one root handed to it. Consumers supply a root and absolute excluded roots, and must not branch on the platform.

## Contract

- `Event.Kind` is `Created`, `Written`, `Renamed` (with `From`), or `Removed`. Paths are absolute and already cleaned.
- `Release` is a barrier. Once it returns, no callback, queued event, or descriptor for that subscription remains, including when the root was renamed or deleted. Workspace archive removes worktrees while releasing subscriptions, so teardown cannot assume the root still exists.
- `UpdateExclusions` is an exclusion barrier: once it returns, no event below a newly excluded root is delivered. Re-including a root rebuilds its watch quietly, without announcing the files that already exist there.
- Git owns ignore evaluation. The observer takes the resulting absolute roots and prunes them from the watch set in place; it never reads ignore files itself.
- A watch failure or the entry cap degrades the subscription instead of silently dropping events. `Degraded()` closes once when that happens, and stays closed. A degraded subscription may miss events, so its consumer polls until observation is re-established, and the observer retries the native watch itself. `Diagnostics()` reports subscription count, tracked directories, pending callbacks, degraded subscriptions, and failure count.
- Do not call `Release` or `UpdateExclusions` from inside the callback. The callback runs on the observation goroutine.

## Linux backend

One inotify descriptor per subscription and one watch per directory, because inotify is not recursive. The mask includes `IN_ONLYDIR`, so watcher count tracks directory count rather than file count. The cap is 250,000 watched directories per subscription.

Topology repair is trailing-debounced (50 ms) and scoped to the changed path. A new or moved-in directory scans only its subtree; a file rename costs one classification stat; a rename inside the tree re-keys the path map and does not re-announce the moved files. A full scan runs only at subscribe and when the exclusion set is replaced.

A directory created and scanned before its watch was installed would report the same file from both the scan and the kernel, so `Created` events are deduplicated for two seconds. `Written` events are never deduplicated.

Watches follow the inode, so a rename keeps delivering. A root that is itself moved or deleted has no parent inside the tree to re-key it: it is reported as a `Removed` event for the root and the subscription degrades.

## Windows backend

One `ReadDirectoryChangesW` handle per subscription with subtree watching, read asynchronously against an event, plus a second event used to wake the loop for exclusion updates and teardown. The first read is issued before `Subscribe` returns: the API reports nothing that happened before the call, so a create landing in that window would otherwise be lost.

The handle cannot exclude a subtree, so excluded roots are filtered at delivery. Churn inside a large excluded tree still fills the kernel buffer, which is why the buffer is 64 KiB.

A zero-byte result means the buffer overflowed and the kernel dropped the rest of the batch. Those paths cannot be reconstructed, so the subscription degrades and its consumer polls.

## macOS backend

One kqueue per subscription: an `EVFILT_VNODE` watch per directory, an `EVFILT_TIMER` that drives content discovery, and an `EVFILT_USER` event that wakes the loop for exclusion updates and teardown.

A directory watch reports entries created, removed, or renamed inside it, and the directory itself being deleted or renamed. It does not report a write to a file inside it, and FSEvents is unavailable to a `CGO_ENABLED=0` build, so content is found by comparing file identities on the timer (2 s). Structural events still arrive from kqueue immediately; only content edits wait for the poll. Renames are paired by inode, so a moved file is one `Renamed` event, and a moved directory is not re-announced file by file.

`.github/workflows/ci.yml` runs `go test ./internal/filewatch` on `macos-latest`, because this is the only backend whose content path is not a kernel event.

## Degraded polling

Every platform backend is wrapped. When a watch cannot be installed or reports failure, that root is polled by identity instead, with 5 s → 60 s backoff, and the native watch is retried until it can be re-established.

An identity is modification time, size, and mode — cheap enough to run over a whole root every interval. A same-size rewrite inside one filesystem timestamp tick is invisible to the polled path; hash content there if that ever shows up.

`BYSPACE_DISABLE_FILE_OBSERVATION=1` starts the daemon with no watcher at all. The e2e suite uses it to prove a spec still passes when the event path is the only thing keeping the UI fresh.

## Measurements

`node scripts/measure-filewatch.mjs` runs `BenchmarkLinuxObservation`: it builds 10,000 files in 100 watched directories plus 2,000 files under an excluded `node_modules`, then reports attach time, write-to-callback latency, descriptors held, and tracked directories.

Two consecutive runs on WSL2 (kernel 6.18.58.1, x86_64):

| Metric                      | Run 1   | Run 2   |
| --------------------------- | ------- | ------- |
| Attach (102 directories)    | 9.1 ms  | 8.6 ms  |
| Write → callback, p50       | 102 µs  | 102 µs  |
| Write → callback, max of 20 | 1.43 ms | 1.53 ms |
| Descriptors held            | 3       | 3       |
| Tracked directories         | 102     | 102     |

The descriptors are the inotify descriptor and the two ends of the wake pipe; directory watches are kernel watch descriptors, not file descriptors.
