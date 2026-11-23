# pi-session-protocol Specification

## Purpose

Aligns Pi RPC sessions with native completion, cancellation, capability, compaction, retry, and rich tool-result behavior.

## Requirements

### Requirement: Every accepted prompt reaches a terminal outcome

The system SHALL distinguish active turns from successful no-turn responses and SHALL complete or fail a prompt according to its native payload.

#### Scenario: Pi declines to invoke the agent

- **WHEN** a successful prompt response indicates that no agent turn was invoked
- **THEN** the prompt reaches its specified terminal outcome instead of running indefinitely

### Requirement: Attachments respect negotiated model input

The system SHALL use native model input capabilities to accept or reject image and other attachment kinds before prompt submission.

#### Scenario: Selected model accepts only text

- **WHEN** a user attempts to include an image
- **THEN** the system reports that the model cannot accept images and does not forward an unsupported prompt

### Requirement: Abort clears queued work

The system SHALL issue native abort with queue clearing when cancellation requires it and SHALL report the resulting turn state accurately.

#### Scenario: User cancels with queued prompts

- **WHEN** Pi acknowledges the abort
- **THEN** the active turn stops and queued prompts do not begin unexpectedly

### Requirement: Compaction and retry follow native events

The system SHALL map manual and automatic compaction and automatic retry events, state, and errors into the session timeline.

#### Scenario: Pi retries after a transient failure

- **WHEN** native retry start and completion events arrive
- **THEN** the client shows the retry and final outcome without inventing a separate user turn

### Requirement: Rich tool results and custom messages retain their payloads

The system SHALL preserve tool-result images and supported generic custom-message content in normalized activity.

#### Scenario: Tool returns an image

- **WHEN** Pi emits a tool result containing image content
- **THEN** the client receives that image associated with the originating tool call
