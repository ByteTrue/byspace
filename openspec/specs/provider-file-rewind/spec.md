# provider-file-rewind Specification

## Purpose

Protects workspace data by making conversation file rewind session-scoped and provider-native instead of a destructive workspace reset.

## Requirements

### Requirement: File rewind uses native provider scope

The system SHALL perform files/both rewind through the owning provider's native session rewind mechanism and SHALL restore only changes belonging to the rewound conversation.

#### Scenario: Workspace contains unrelated edits

- **WHEN** a user rewinds a session while unrelated tracked and untracked edits exist in the same workspace
- **THEN** the native conversation changes rewind and all unrelated edits survive

### Requirement: Destructive workspace reset is not a fallback

The system MUST NOT use whole-workspace reset, clean, or discard operations as a substitute for provider-native file rewind.

#### Scenario: Two sessions share a worktree

- **WHEN** one session requests file rewind and another session has edits in that worktree
- **THEN** the second session's edits remain untouched

### Requirement: Unsupported native rewind fails safely

The system SHALL report file rewind as unsupported when the owning provider has no native implementation and SHALL leave the workspace unchanged.

#### Scenario: Provider cannot rewind files

- **WHEN** a user requests files/both rewind on such a provider
- **THEN** the request returns an actionable unsupported error and no file is modified

### Requirement: Chat-only rewind leaves files untouched

The system SHALL limit chat-only rewind to conversation state and SHALL NOT invoke a file restoration operation.

#### Scenario: User rewinds only conversation messages

- **WHEN** a user selects chat-only rewind
- **THEN** conversation state rewinds and workspace files remain unchanged
