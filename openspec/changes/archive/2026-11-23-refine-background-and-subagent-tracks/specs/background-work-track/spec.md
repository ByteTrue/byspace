# Spec Delta

## Purpose

Presents active background work with readable status and predictable row actions while avoiding stale terminal-style rows and hidden controls.

## ADDED Requirements

### Requirement: Background visibility follows actionable work

The system SHALL show the Background trigger only for active work or a temporarily unresolved stop/list error and SHALL hide it when no such work remains.

#### Scenario: All work is finished

- **WHEN** no active or unresolved background item remains
- **THEN** the Background trigger is hidden and its badge is zero

### Requirement: Rows use semantic activity presentation

The system SHALL render a readable primary title and secondary facts using normal UI typography, with status and elapsed time when available.

#### Scenario: Work has description and command

- **WHEN** a background item supplies both fields
- **THEN** the description is primary and the distinct command appears only as secondary information

### Requirement: Stop affects only its row

The system SHALL disable duplicate stop submission for a pending row, remove it after acknowledged termination, and retain it with retry/dismiss feedback after failure.

#### Scenario: Stop request fails

- **WHEN** the provider rejects termination for one item
- **THEN** other rows remain unchanged and the affected row exposes its error and retry/dismiss actions

### Requirement: Stale activity can be retried

The system SHALL retain the last known rows with a retry affordance when background activity refresh fails.

#### Scenario: Activity list request fails

- **WHEN** previously loaded work cannot be refreshed
- **THEN** the popover marks the data stale and offers retry instead of silently clearing the rows

### Requirement: Track controls are keyboard accessible

The system SHALL support ArrowUp, ArrowDown, Home, End, Enter/Space, Escape, and focus restoration without requiring the agent pane to have keyboard focus.

#### Scenario: User navigates rows by keyboard

- **WHEN** the popover is open and the user presses ArrowDown then Enter
- **THEN** focus moves to the next row and its primary action opens
