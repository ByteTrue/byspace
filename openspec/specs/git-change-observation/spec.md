# git-change-observation Specification

## Purpose

Defines how the daemon learns that a repository changed: which files and git metadata it watches, which changes are allowed to cause work, which derived checkout facts are invalidated by each kind of change, and what happens when observation is unavailable.

## Requirements

### Requirement: Observation follows repository use

The daemon SHALL begin observing a checkout when its diff or checkout facts are first consumed, and SHALL release that observation when the last consumer leaves. Observation SHALL NOT require a global startup pass over every known checkout.

#### Scenario: First consumer starts observation

- **WHEN** a client subscribes to a checkout's diff for the first time in this daemon lifetime
- **THEN** subsequent changes in that checkout are delivered as events, not on the next poll tick

#### Scenario: Last consumer releases observation

- **WHEN** the final subscriber for a checkout unsubscribes
- **THEN** that checkout's watches are released and no further events are delivered for it

### Requirement: A checkout is watched once for all consumers

The daemon SHALL keep at most one recursive working-tree observation per checkout, shared by every consumer, and SHALL deliver each event to all of them.

#### Scenario: Two panes on one checkout

- **WHEN** two clients subscribe to the same checkout and a file changes on disk
- **THEN** one observation exists for that checkout and both subscribers receive the change

### Requirement: Git metadata changes are classified before they cause work

Changes inside a git directory SHALL be classified as ignored, checkout-only, repository-wide, or branch-list-only before any work is scheduled. Object, hook, and log churn MUST NOT cause a diff re-read.

#### Scenario: Object pack is written

- **WHEN** `.git/objects` gains a pack during a fetch
- **THEN** no diff re-read is scheduled from that event

#### Scenario: Branch ref moves

- **WHEN** `refs/heads/<branch>` changes
- **THEN** that branch's checkout refreshes its branch state, and every worktree of the repository refreshes what the branch list feeds

#### Scenario: Interpretation inputs change

- **WHEN** `.gitattributes`, `.git/config`, or the index changes
- **THEN** the comparison's interpretation is re-read before any cached per-file result is reused

### Requirement: Ref movement is confirmed by object identity

The daemon SHALL treat a ref as moved only when its resolved object id differs from the last observed id. File timestamps or sizes alone MUST NOT invalidate a cached comparison.

#### Scenario: Ref file is rewritten without moving

- **WHEN** a watched ref file is rewritten or touched but still resolves to the same commit
- **THEN** no diff, stat, or ahead/behind refresh is scheduled

#### Scenario: Remote ref moves after a push

- **WHEN** `refs/remotes/origin/<branch>` starts resolving to a different commit
- **THEN** every checkout whose comparison uses that ref refreshes its base-derived facts

### Requirement: Derived checkout facts are invalidated semantically

Each change SHALL refresh only the facts whose inputs moved: a working-tree event refreshes dirtiness and the working diff, a base movement refreshes the comparison base and its stat, an upstream movement refreshes the diff stat and ahead/behind for the tracked branch, and a branch change refreshes workspace placement.

#### Scenario: Push leaves the checkout clean

- **WHEN** the user pushes a committed branch and the working tree is clean
- **THEN** the checkout's diff stat becomes empty rather than keeping a pre-push count

#### Scenario: Unrelated remote branch moves

- **WHEN** a remote branch other than the checkout's base or upstream moves
- **THEN** that checkout schedules no stat or comparison refresh

#### Scenario: Commit from a terminal

- **WHEN** a commit changes the working tree while a diff pane is open
- **THEN** the pane and the checkout's dirtiness update without the user refreshing

### Requirement: Observation failure degrades to polling

If a watch cannot be installed or reports an error, the affected repository SHALL fall back to bounded polling with backoff, and SHALL return to events once a watch is re-established. Consumers MUST keep receiving updates throughout the degraded period.

#### Scenario: Watcher cannot be installed

- **WHEN** observation of a repository fails at subscribe time
- **THEN** changes are still delivered within the polling bound and the repository is marked degraded

#### Scenario: Watcher recovers

- **WHEN** a degraded repository's watch can be installed again
- **THEN** the daemon stops polling it and delivers events from that point on

### Requirement: Exclusions are reconciled in place

The git layer SHALL own ignore policy. Excluded roots and git-ignore changes MUST be applied to an existing observation without replacing it, and tracked files inside an otherwise ignored directory MUST remain observable.

#### Scenario: Ignore file changes

- **WHEN** a `.gitignore` gains an entry for a directory
- **THEN** events below that directory stop being delivered without dropping the observation

### Requirement: Release is a barrier

Releasing an observation MUST be safe after the checkout was renamed, archived, or removed, and once release returns no callback, queued event, or platform handle for that observation may remain.

#### Scenario: Archive while observed

- **WHEN** a workspace is archived while its checkout is still observed
- **THEN** release completes without error and no event for the removed checkout is delivered afterwards

### Requirement: Observation health is reported

The daemon SHALL report per-repository observation health — active observations, watched entries, pending events, degraded-polling state, and failure counts — as runtime metrics.

#### Scenario: Degradation is visible

- **WHEN** a repository falls back to polling
- **THEN** its observation health reports the degraded state and the failure that caused it
