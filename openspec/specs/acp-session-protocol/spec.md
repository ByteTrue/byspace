# acp-session-protocol Specification

## Purpose

Aligns generic ACP sessions with the protocol's permission, update, catalog, control, resume, cancellation, and shutdown semantics.

## Requirements

### Requirement: Permission replies use the selected native option

The system SHALL present native permission options and return the exact selected option ID instead of reducing every choice to allow or deny.

#### Scenario: User selects an alternate permission option

- **WHEN** an ACP agent offers multiple permission options and the user selects one
- **THEN** the response contains that option's native ID

### Requirement: Session updates retain native activity

The system SHALL map message chunks, user chunks, thought chunks, plans, modes, configuration, session information, usage, commands, and other supported updates into their corresponding client activity.

#### Scenario: Agent publishes a plan and mode change

- **WHEN** session updates contain plan and current-mode changes
- **THEN** the client displays the updated plan and active mode

### Requirement: Tool updates preserve details and terminal state

The system SHALL retain tool raw input, output content, diffs, locations, kinds, and terminal linkage and SHALL complete tools only on terminal upstream updates or session teardown.

#### Scenario: Tool starts without completing

- **WHEN** an in-progress tool update arrives
- **THEN** the tool remains active with its native details until a later terminal update or explicit cleanup

### Requirement: Dynamic catalogs and controls follow the session

The system SHALL use session-provided model, mode, and configuration catalogs and SHALL apply controls through their native operations with upstream error propagation.

#### Scenario: Agent supplies a new model catalog

- **WHEN** a session update replaces available models
- **THEN** subsequent selection uses that catalog and successful changes reflect the returned current model

### Requirement: Cancellation resolves the active turn

The system SHALL issue native cancellation and map its stop reason to an interrupted or cancelled turn while resolving pending tools and permissions.

#### Scenario: User cancels an ACP prompt

- **WHEN** the agent acknowledges cancellation
- **THEN** the client sees cancellation rather than a successful agent completion

### Requirement: ACP filesystem access is opt-in

The system SHALL disable ACP host filesystem read and write capabilities by default and SHALL enable each only through explicit provider configuration.

#### Scenario: Provider has no filesystem capability configuration

- **WHEN** an ACP session initializes
- **THEN** host filesystem read and write capabilities are both disabled

### Requirement: Resume and close use native lifecycle semantics

The system SHALL select supported native resume/load behavior and SHALL close the ACP session with bounded shutdown and error reporting.

#### Scenario: Resumed agent does not support load

- **WHEN** native capabilities indicate that session load is unavailable
- **THEN** the system uses the supported resume path or reports the limitation without claiming a loaded session
