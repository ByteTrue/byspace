# bundled-agent-resources Specification

## Purpose

Provides stable daemon-host instruction resources for agents without treating those resources as installed or selectable agent skills.

## Requirements

### Requirement: Adapter materializes at a stable host path

The system SHALL materialize the ACP adapter and its references on demand under the BySpace-owned resources directory and SHALL return the same absolute SKILL.md path across requests in one daemon home.

#### Scenario: Prompt is requested repeatedly

- **WHEN** onboarding prompts are requested more than once
- **THEN** each prompt references the same existing daemon-host SKILL.md path

### Requirement: Adapter is excluded from ordinary skill discovery

The system SHALL NOT list the ACP adapter as a bundled skill or install it into agent skill directories during onboarding.

#### Scenario: User opens skill selection

- **WHEN** bundled and discovered skills are listed
- **THEN** the ACP adapter resource is absent unless a separate user-installed copy already exists

### Requirement: Resource refresh preserves unrelated user files

The system SHALL atomically refresh its owned adapter resources when embedded content changes and SHALL NOT delete adapter copies outside its resource directory.

#### Scenario: Daemon ships an updated adapter

- **WHEN** the next prompt request materializes the resource
- **THEN** the stable resource contains the updated instructions and pre-existing files in agent skill directories remain untouched
