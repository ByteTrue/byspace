# Spec Delta

## Purpose

Defines the common lifecycle guarantees that make every provider session truthful, controllable, and consistent with its advertised capabilities.

## ADDED Requirements

### Requirement: Initialization succeeds before a session becomes usable

The system SHALL expose a provider session only after initialization and native session creation succeed, and SHALL return initialization errors without inventing a native session identifier.

#### Scenario: Native session creation fails

- **WHEN** a provider rejects or fails its initialization or session-create exchange
- **THEN** the start operation fails with the provider error and no usable native session is emitted

### Requirement: Control acknowledgements reflect upstream outcomes

The system SHALL acknowledge model, mode, thinking, steering, cancellation, archive, and close operations only after the provider accepts them, and SHALL surface rejected or unsupported operations.

#### Scenario: Provider rejects a model change

- **WHEN** the provider returns an error for a requested model change
- **THEN** the client receives that error and the active model remains unchanged

#### Scenario: Provider ignores an unsupported operation

- **WHEN** a provider cannot perform a requested operation
- **THEN** the system reports it as unsupported rather than returning success

### Requirement: Advertised capabilities match runtime behavior

The system SHALL advertise only operations and input kinds supported by the selected provider and negotiated session, and SHALL update dynamic capabilities when the provider changes them.

#### Scenario: Provider lacks native archive

- **WHEN** a session's provider has no native archive operation
- **THEN** native archive is not advertised or invoked for that session

### Requirement: User MCP configuration reaches the provider

The system SHALL forward configured MCP servers through each provider's native launch or session configuration mechanism while preserving BySpace-owned integrations.

#### Scenario: Session launches with user MCP servers

- **WHEN** an agent configuration contains MCP servers supported by its provider
- **THEN** the provider receives those server definitions in its native configuration

### Requirement: Native history import uses provider-native parsing

The system SHALL import native history for each supported provider using that provider's persisted format and SHALL report unsupported providers instead of silently returning an empty import.

#### Scenario: Supported native history exists

- **WHEN** a user imports a supported provider's native session
- **THEN** its messages and relevant native metadata appear in the resulting BySpace history

### Requirement: Cancellation leaves no unresolved interaction

The system SHALL give tool calls, permissions, and turn state explicit terminal outcomes when a turn is cancelled or its session closes.

#### Scenario: Turn is cancelled during a tool call

- **WHEN** cancellation interrupts an active tool call
- **THEN** the turn becomes cancelled or interrupted as reported upstream and the tool call no longer remains pending
