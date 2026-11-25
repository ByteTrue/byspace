# Spec Delta

## Purpose

Defines transient feedback for agent lifecycle operations so pending state always resolves to a visible terminal outcome.

## ADDED Requirements

### Requirement: Pending operation feedback reaches a terminal state

Agent operations that show indefinite pending feedback SHALL dismiss or replace that feedback when the operation succeeds or fails.

#### Scenario: Agent reload succeeds

- **WHEN** a reload operation with a loading toast completes successfully
- **THEN** the loading toast is dismissed or replaced and only the terminal success feedback remains

#### Scenario: Agent reload fails

- **WHEN** a reload operation with a loading toast fails
- **THEN** the loading toast is dismissed or replaced and actionable failure feedback remains visible
