# provider-background-work Specification

## Purpose

Provides a provider-neutral view of background work and subagents so clients can display live activity without guessing protocol-specific state.

## Requirements

### Requirement: Background activity has normalized identity and state

The system SHALL expose available background-work identity, title or command, kind, status, progress, and timestamps in a shared model while retaining native identifiers.

#### Scenario: Provider starts background work

- **WHEN** a provider reports a new background task
- **THEN** the client receives a normalized item that can be tracked across later updates

### Requirement: Snapshots and live updates describe the same work

The system SHALL supply an initial activity snapshot and subsequent updates keyed by stable identity without duplicating existing rows.

#### Scenario: Running task changes state

- **WHEN** a provider publishes completion or failure for existing background work
- **THEN** the matching item updates to its terminal state instead of creating a duplicate

### Requirement: Subagents retain their navigation target

The system SHALL distinguish managed-child subagents from provider-native subagents and retain the identifiers needed to open the corresponding timeline.

#### Scenario: User opens a native subagent

- **WHEN** a subagent belongs to provider-native history rather than a managed child
- **THEN** the client can open that native read-only timeline with its native identifiers

### Requirement: Unavailable activity details remain absent

The system SHALL NOT fabricate shell output, history, progress, or timing facts that a provider does not expose.

#### Scenario: Provider exposes only command and status

- **WHEN** background work has no output or progress stream
- **THEN** the model contains the known command and status with unavailable fields absent
