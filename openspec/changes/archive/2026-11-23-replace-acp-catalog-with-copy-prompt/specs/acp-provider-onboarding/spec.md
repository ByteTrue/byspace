# Spec Delta

## Purpose

Guides new ACP provider setup through one copyable prompt while preserving existing custom providers and removing preset-catalog duplication.

## ADDED Requirements

### Requirement: Add provider offers one ACP copy-prompt action

The system SHALL replace the built-in searchable ACP creation catalog with one action that copies the daemon-provided onboarding prompt.

#### Scenario: User opens Add provider

- **WHEN** the ACP onboarding area is visible
- **THEN** it contains the copy-prompt action and no searchable preset provider list

### Requirement: Copied prompt contains the daemon-host resource path

The system SHALL copy the complete prompt returned by the daemon, including the absolute SKILL.md path on the daemon host.

#### Scenario: Copy succeeds

- **WHEN** the user activates the copy action
- **THEN** the clipboard contains instructions to read and follow that absolute resource and the UI confirms success

### Requirement: Clipboard and RPC failures are visible

The system SHALL report prompt retrieval or clipboard failure and SHALL NOT report copied success for either failure.

#### Scenario: Clipboard write is rejected

- **WHEN** the browser or platform denies the clipboard write
- **THEN** the UI shows an error and allows the user to retry

### Requirement: Existing ACP providers remain configurable

The system SHALL preserve existing generic ACP configuration, editing, model selection, diagnostics, and runtime behavior without migration.

#### Scenario: User configured a provider before catalog removal

- **WHEN** the updated app loads that provider
- **THEN** the provider remains available with its existing configuration and recognizable icon
