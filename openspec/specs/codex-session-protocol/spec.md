# codex-session-protocol Specification

## Purpose

Aligns Codex app-server sessions with native event, approval, command, goal, compaction, and subagent behavior.

## Requirements

### Requirement: Codex notifications and items retain their semantics

The system SHALL map native output deltas, terminal activity, patches, MCP activity, web/image items, plans, diffs, retries, compaction, collaboration, and errors into corresponding timeline activity.

#### Scenario: Codex emits a file patch

- **WHEN** native patch start, delta, and completion events arrive
- **THEN** the client shows one patch activity with its streamed content and final state

### Requirement: Native approvals and elicitation reach the user

The system SHALL surface tool approvals and MCP elicitation and return the user's native response to the originating request.

#### Scenario: Codex requests tool approval

- **WHEN** the user approves or rejects the pending request
- **THEN** Codex receives that decision and the request resolves

### Requirement: Turn completion and steering are truthful

The system SHALL preserve interrupted and failed turn outcomes, validate steering acknowledgements, and retain client user-message identity.

#### Scenario: Active turn is interrupted

- **WHEN** Codex reports an interrupted turn
- **THEN** the client does not report successful completion

### Requirement: Native subagents are observable

The system SHALL expose Codex subagent activity and native identifiers collected from collaboration events.

#### Scenario: Codex starts a subagent

- **WHEN** collaboration events identify a native child
- **THEN** the subagent list includes that child and its current activity

### Requirement: Custom prompts expand before submission

The system SHALL list native custom prompts with front-matter metadata and expand numbered arguments, all arguments, and escaped dollar signs using reference semantics.

#### Scenario: Prompt uses arguments

- **WHEN** a user invokes a custom prompt with arguments
- **THEN** Codex receives the expanded prompt rather than its slash-command name

### Requirement: Codex skills are discoverable and invocable

The system SHALL merge native and on-disk Codex skill sources, deduplicate them, and invoke a selected skill with its native name, path, and arguments.

#### Scenario: Workspace defines a Codex skill

- **WHEN** commands are listed for that workspace
- **THEN** the skill appears with its hint and invoking it supplies the native skill payload

### Requirement: Compact and goal commands use native operations

The system SHALL execute compact out of band and SHALL expose and control goals only when the connected Codex version supports them.

#### Scenario: User invokes compact

- **WHEN** the active Codex session supports native compaction
- **THEN** compaction starts without sending literal slash-command text as a user turn
