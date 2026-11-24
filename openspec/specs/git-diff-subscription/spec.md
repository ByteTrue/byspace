# git-diff-subscription Specification

## Purpose

Defines how a comparison is computed and delivered: one shared computation per comparison key, per-file result reuse, revision-based incremental delivery to every viewer, size and file-count budgets, and replay for a subscriber that arrives after the comparison settled.

## Requirements

### Requirement: One comparison per key is computed once

The daemon SHALL identify a comparison by its inputs — checkout, base endpoint, head endpoint, merge base, ignore-whitespace, and highlight — and SHALL compute it once for all subscribers sharing that key.

#### Scenario: Two viewers request the same comparison

- **WHEN** two clients subscribe to the same checkout with the same compare options
- **THEN** the daemon runs one comparison and delivers its result to both

#### Scenario: Different options are separate comparisons

- **WHEN** one client ignores whitespace and another does not, on the same checkout
- **THEN** the daemon keeps two comparisons and each subscriber receives the result for its own options

### Requirement: Unchanged files are not re-read

A comparison SHALL cache each file's result under an identity derived from the file's content and interpretation inputs (git config, attributes, and blob id), and SHALL re-read a file only when that identity changes.

#### Scenario: One file edited among many

- **WHEN** one file of a thousand-file comparison changes
- **THEN** the daemon re-reads that file only and reuses the rest

#### Scenario: Content restored

- **WHEN** a file is edited and then reverted to its previous content
- **THEN** the cached result for it is reused rather than recomputed

#### Scenario: Attribute applies a filter

- **WHEN** an attribute or filter setting that affects a file's content changes
- **THEN** that file's identity changes and it is re-read

### Requirement: A result carries a revision

Every committed comparison result SHALL carry a revision that increases when its contents change, and every update SHALL name the revision it supersedes so a subscriber can detect what it missed.

#### Scenario: Subscription receives a revision

- **WHEN** a client subscribes to a comparison
- **THEN** it receives a revision with the initial result and a later revision on each change

#### Scenario: Revision is stable when nothing changed

- **WHEN** an invalidation produces the same file contents as the committed result
- **THEN** the revision does not advance and no update is sent

### Requirement: Updates carry only changed files

An update SHALL contain only the files whose identity or result changed since the revision the subscriber holds, plus the comparison's resolved state. Files the subscriber already holds MUST NOT be resent.

#### Scenario: Large comparison, small edit

- **WHEN** a 1000-file comparison changes in one file
- **THEN** the update carries that file and the resolved state, not the other 999

#### Scenario: Metadata-only change

- **WHEN** a comparison's resolved base changes but no file content does
- **THEN** the update carries the new resolved state and no file bodies

### Requirement: Invalidation is coalesced

Rapid changes to the same comparison SHALL be coalesced into one recomputation, and an in-flight recomputation that becomes stale MUST be abandoned rather than committing a result older than what it superseded.

#### Scenario: Editor save burst

- **WHEN** a file is written several times within a short window
- **THEN** the daemon recomputes the comparison once after the burst settles

#### Scenario: Change during a recomputation

- **WHEN** a file changes while the comparison is being computed
- **THEN** the in-flight result is discarded and the newer state is computed before anything is delivered

### Requirement: Comparisons have size budgets

The daemon SHALL stop reading and sending a comparison that exceeds its total byte budget or file-count budget, and SHALL report the comparison as truncated or as omitted files instead of failing the subscription.

#### Scenario: Diff exceeds the byte budget

- **WHEN** a comparison's content exceeds the byte budget
- **THEN** the subscriber receives the files sent so far and a truncation flag

#### Scenario: Too many files

- **WHEN** a comparison contains more files than the file-count budget
- **THEN** the excess files are reported as omitted placeholders instead of being read

### Requirement: A late subscriber is replayed the committed result

A subscriber that joins a comparison already computed SHALL receive the committed result immediately, without waiting for the next change.

#### Scenario: Second pane opens on a settled comparison

- **WHEN** a client subscribes to a comparison that has already been computed
- **THEN** it receives the current revision and contents immediately

### Requirement: Comparison errors are delivered, not dropped

A comparison that cannot be computed SHALL deliver an error to its subscribers and SHALL keep the subscription open so a later change can produce a result.

#### Scenario: Invalid base ref

- **WHEN** a comparison's base ref no longer resolves
- **THEN** subscribers receive an error and a later valid state delivers a new result
