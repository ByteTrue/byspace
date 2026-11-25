# Spec Delta

## MODIFIED Requirements

### Requirement: Add provider offers one ACP copy-prompt action

The system SHALL offer a searchable catalog of officially preconfigured ACP providers and SHALL retain an action that copies the daemon-provided onboarding prompt for providers outside the catalog.

#### Scenario: User opens Add provider

- **WHEN** the ACP onboarding area is visible
- **THEN** it contains the searchable official preset catalog and the copy-prompt action

#### Scenario: User searches the official catalog

- **WHEN** the user enters text matching a preset's name or other searchable identity
- **THEN** the matching preset is shown without changing provider configuration or starting an agent

## ADDED Requirements

### Requirement: Official presets use declarative ACP configuration

The system SHALL define each official preset with the identity, presentation, launch command, and optional environment or protocol parameters needed by the generic ACP provider. Catalog selection SHALL NOT require a provider-specific runtime adapter.

#### Scenario: User adds an official preset

- **WHEN** the user confirms the preset's add or enable action
- **THEN** the resulting provider uses the preset's declarative values and the existing generic ACP configuration, diagnostics, and session behavior

### Requirement: Catalog presets are inactive until explicitly chosen

The system SHALL NOT enable, add, or start a catalog preset merely because the application starts or the catalog is displayed. Claude, Codex, OpenCode, and Pi SHALL remain the only primary built-in providers.

#### Scenario: Fresh installation displays the catalog

- **WHEN** a user with no custom ACP configuration browses the official catalog
- **THEN** the four primary built-ins retain their existing defaults and no catalog preset becomes an enabled or running provider

#### Scenario: User explicitly chooses a preset

- **WHEN** the user completes the preset's add or enable action
- **THEN** only the chosen preset becomes available according to that action, without enabling other catalog entries

### Requirement: Generic ACP providers expose their runtime catalog

The system SHALL discover models and modes from a configured generic ACP provider through a bounded throwaway ACP session, including the negotiated current model selection. Discovery failure SHALL leave a usable fallback snapshot and SHALL NOT undo provider creation.

#### Scenario: Added preset advertises models and modes

- **WHEN** the user adds a preset and its ACP session advertises runtime catalogs
- **THEN** the refreshed provider snapshot exposes those models and modes and marks the negotiated current model as default

#### Scenario: Explicit model configuration is present

- **WHEN** the provider defines models or additionalModels
- **THEN** the existing replacement or additive override semantics apply to the discovered runtime catalog

#### Scenario: Runtime catalog cannot be discovered

- **WHEN** the provider is disabled, unavailable, or its bounded probe fails
- **THEN** the snapshot retains its configured or fallback catalog and the Add action does not roll back the saved provider

### Requirement: Catalog presets retain recognizable presentation

The system SHALL provide the official preset's recognizable icon and display identity in the catalog and after the provider is configured.

#### Scenario: Configured provider came from a preset

- **WHEN** the configured provider is displayed outside the catalog
- **THEN** it retains the preset's recognizable icon and identity without requiring a provider-specific UI branch
