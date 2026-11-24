# Spec Delta

## Purpose

Defines reliable cleanup of BySpace-owned worktrees after workspace archival, including resource teardown, transient-failure recovery, deferred cleanup, and actionable failure reporting.

## ADDED Requirements

### Requirement: Archive completion is independent of disk cleanup

The system SHALL archive the workspace even when its managed worktree cannot be removed immediately, and SHALL NOT unarchive or restore the workspace because cleanup fails.

#### Scenario: Directory removal initially fails

- **WHEN** workspace records are archived but the worktree remains locked
- **THEN** the archive succeeds and cleanup continues through the deferred cleanup path

#### Scenario: Deferred cleanup exhausts its attempts

- **WHEN** all deferred cleanup attempts fail
- **THEN** the workspace remains archived and the system reports the cleanup failure

### Requirement: Managed process trees exit before deletion

The system SHALL terminate all BySpace-managed terminal and workspace-script process trees for the archived workspace, including descendants, and wait for their exit before attempting directory removal.

#### Scenario: A workspace script has running descendants

- **WHEN** a workspace with a script-spawned development server is archived
- **THEN** the script and its managed descendants are terminated and awaited before worktree deletion begins

#### Scenario: A process does not exit after graceful termination

- **WHEN** a managed process tree remains alive after the graceful termination interval
- **THEN** the system forcefully terminates that process tree and waits for termination before proceeding

#### Scenario: The root exits before a detached descendant

- **WHEN** a managed root process or its PTY completes while a descendant in its original process group remains alive
- **THEN** shutdown preserves the graceful interval for the remaining managed tree and forcefully terminates it if necessary before deletion proceeds

#### Scenario: A completed root PID has been reused

- **WHEN** shutdown finds a live process whose start identity differs from the captured BySpace-managed root
- **THEN** the replacement process and its tree are not signaled

#### Scenario: Setup completion remains stuck after forced termination

- **WHEN** a setup run does not report completion within the bounded forced-shutdown phase
- **THEN** archive proceeds without waiting indefinitely and directory cleanup can fail into the deferred path

### Requirement: Daemon watchers are released before deletion

The system SHALL synchronously release daemon-owned filesystem and Git watchers for the worktree before deletion, without releasing watchers still required by active sibling workspaces.

#### Scenario: No active sibling uses the checkout

- **WHEN** the last active workspace reference to a managed worktree is archived
- **THEN** its daemon watchers are released before directory removal starts

#### Scenario: A shared observation has another active consumer

- **WHEN** another active workspace or client still requires the same observation
- **THEN** cleanup releases only the archived workspace's ownership and preserves the shared observation

### Requirement: Worktree removal handles transient failures and Git metadata

The system SHALL use bounded directory-removal retries, verify directory absence after each attempt, and attempt Git worktree pruning after both successful Git removal and directory fallback.

#### Scenario: A transient lock clears during foreground retries

- **WHEN** an early directory-removal attempt fails and a later attempt succeeds
- **THEN** cleanup stops retrying, confirms the path is absent, and prunes stale Git worktree metadata

#### Scenario: Git removal fails and fallback removes the directory

- **WHEN** Git cannot remove the worktree but directory fallback succeeds
- **THEN** the system still attempts to prune the stale Git worktree registration

### Requirement: Cleanup preserves active workspace data

The system SHALL restrict deletion to BySpace-owned managed worktrees and SHALL recheck active workspace references before every foreground or deferred destructive attempt.

#### Scenario: A workspace again references the backing path

- **WHEN** an active workspace references the worktree before a cleanup attempt
- **THEN** the system cancels that cleanup without deleting the directory or pruning its active registration

#### Scenario: A path is outside managed worktree ownership

- **WHEN** cleanup is requested for a path that fails managed-worktree ownership validation
- **THEN** the system refuses deletion

#### Scenario: Creation and cleanup race for one path

- **WHEN** a worktree is being created or reclaimed while deferred cleanup targets the same path
- **THEN** creation through active workspace registration and cleanup guard-plus-deletion are serialized so cleanup cannot delete a newly active worktree

#### Scenario: Activation uses a nested path or managed source worktree

- **WHEN** a nested workspace CWD is activated or a new worktree is created from a managed source worktree
- **THEN** lifecycle synchronization uses the canonical managed worktree root and the source is active before creation reads it

### Requirement: Deferred cleanup is bounded and deduplicated

After foreground cleanup fails, the system SHALL schedule one bounded deferred cleanup sequence per worktree, retry while the daemon remains running, and emit a terminal success or failure outcome.

#### Scenario: Background cleanup eventually succeeds

- **WHEN** an external program releases the worktree before the deferred retry budget is exhausted
- **THEN** a subsequent attempt removes and prunes the worktree and emits cleanup success

#### Scenario: Duplicate archive requests target the same worktree

- **WHEN** deferred cleanup for a worktree is already pending
- **THEN** the system reuses the pending sequence instead of running concurrent deletion loops

#### Scenario: A reclaimed path cancels deferred cleanup

- **WHEN** an active workspace reference stops a pending cleanup attempt
- **THEN** the system emits a cancellation outcome and the client dismisses the pending cleanup notification without reporting deletion success or failure

### Requirement: Cleanup failures provide an actionable path

The system SHALL include the exact worktree path in the final cleanup-failure outcome, and connected clients SHALL display that path when reporting final failure.

#### Scenario: External locks persist through every attempt

- **WHEN** deferred cleanup reaches its final attempt without removing the directory
- **THEN** the client reports that the workspace is archived but cleanup failed and displays the exact worktree path

#### Scenario: Cleanup is deferred after the archive request

- **WHEN** the immediate archive response leaves directory removal pending
- **THEN** the client reports that cleanup will continue in the background rather than instructing the user to manually delete the directory immediately

#### Scenario: Directory preservation is not deferred cleanup

- **WHEN** teardown, ownership validation, or workspace-store inspection fails without scheduling deferred cleanup
- **THEN** the client reports the actual directory error and does not claim that background cleanup is running

#### Scenario: Duplicate records share a cleanup notification

- **WHEN** multiple archived workspace records produce pending and terminal outcomes for one worktree path
- **THEN** the client uses one notification keyed by the daemon’s canonical cleanup key so no pending toast remains stranded
