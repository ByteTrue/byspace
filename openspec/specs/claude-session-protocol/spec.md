# claude-session-protocol Specification

## Purpose

Aligns Claude sessions with native partial streaming, task lifecycle, status, control, live settings, and file rewind behavior.

## Requirements

### Requirement: Partial stream events update live output

The system SHALL consume supported partial stream deltas for assistant text, reasoning, and tool input and SHALL reconcile them with final messages without duplication.

#### Scenario: Claude streams a partial tool input

- **WHEN** incremental tool-input deltas arrive before the final message
- **THEN** the active tool input updates incrementally and settles to the final payload

### Requirement: Native task events drive subagent state

The system SHALL use task started, updated, progress, and notification events as the authoritative source for native task and subagent activity.

#### Scenario: Native task reports progress

- **WHEN** a task progress event arrives
- **THEN** the corresponding subagent updates without relying on Task-tool text heuristics

### Requirement: Status and compaction remain visible

The system SHALL map rich status, compaction, autonomous/background boundaries, and recovery events into session activity and state.

#### Scenario: Claude compacts context

- **WHEN** native compaction starts and finishes
- **THEN** the client displays its progress and resulting session state

### Requirement: Steering and cancellation are authoritative

The system SHALL use admitted steering and native cancellation, retain message identity, and settle active activity according to the upstream result.

#### Scenario: Claude rejects steering

- **WHEN** the active session does not admit a steering message
- **THEN** the client receives the rejection and does not show the message as accepted steering

### Requirement: Live settings change the active session

The system SHALL apply supported live model and thinking changes to the active Claude query and SHALL surface unsupported or rejected changes.

#### Scenario: User changes model mid-session

- **WHEN** Claude accepts the native model control
- **THEN** subsequent turns use the selected model and the client reflects it

### Requirement: Claude file rewind is native and scoped

The system SHALL use Claude's native file rewind mechanism and SHALL NOT reset the containing workspace.

#### Scenario: Claude session rewinds files

- **WHEN** native rewind completes for a selected checkpoint
- **THEN** unrelated tracked and untracked workspace edits survive
