# Spec Delta

## Purpose

Presents managed and provider-native subagents with consistent hierarchy, progress, and actions while preserving their existing timeline navigation.

## ADDED Requirements

### Requirement: Subagent rows expose title and factual metadata

The system SHALL use a readable title line and secondary metadata, truncating long content without terminal-style command wrapping.

#### Scenario: Subagent has a long title

- **WHEN** its title exceeds the available width
- **THEN** the row remains aligned and the full title remains available through an accessible label or tooltip

### Requirement: Opening preserves the native subagent kind

The system SHALL open managed children in their managed timeline and provider-native subagents in their read-only native timeline with pagination where supported.

#### Scenario: User selects a native subagent

- **WHEN** its row is activated
- **THEN** the existing native timeline opens using the retained native identifiers

### Requirement: Finished managed subagents retain useful actions

The system SHALL keep finished managed subagents available for progress review, retry, or archive when those actions are applicable.

#### Scenario: Finished subagent can be archived

- **WHEN** the user activates Archive
- **THEN** only that managed child is archived and its track state updates

### Requirement: Track actions follow form factor and focus

The system SHALL reveal secondary actions with CSS hover/focus on wide layouts and keep them visible on compact layouts.

#### Scenario: Keyboard focus enters a row

- **WHEN** a row or its action receives focus
- **THEN** its secondary actions remain visible and operable
